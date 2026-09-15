import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statfsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { audit, id, now } from "./database.mjs";
import { importProcessedDirectory } from "./dataset-importer.mjs";

const active = new Map();
const safeJson = (value, fallback = {}) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };

function event(db, jobId, stage, status, message, details = {}) {
  db.prepare(`INSERT INTO ingestion_events (id, job_id, stage, status, message, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id("EVT"), jobId, stage, status, message, JSON.stringify(details), now());
}

function dto(row, { events = [], includeDetails = false } = {}) {
  if (!row) return null;
  const result = {
    id: row.id, ownerId: row.owner_id, ownerName: row.owner_name, name: row.name,
    description: row.description, sourceFilename: row.source_filename, sourceSize: Number(row.source_size || 0),
    receivedBytes: Number(row.received_bytes || 0), sourceSha256: row.source_sha256,
    status: row.status, stage: row.stage, progress: Number(row.progress || 0),
    datasetId: row.dataset_id, versionId: row.version_id, errorMessage: row.error_message,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
  };
  if (includeDetails) Object.assign(result, {
    discovery: safeJson(row.discovery_json), mapping: safeJson(row.mapping_json), rules: safeJson(row.rules_json),
    quality: safeJson(row.quality_json), events,
  });
  return result;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function pythonCommand() {
  return process.platform === "win32" ? { command: "python", prefix: [] } : { command: "python3", prefix: [] };
}

export function createIngestionService({ db, root }) {
  const baseDir = path.join(root, ".data", "ingestion");
  mkdirSync(baseDir, { recursive: true });

  const find = (jobId) => db.prepare(`SELECT j.*, u.display_name AS owner_name FROM ingestion_jobs j
    JOIN users u ON u.id = j.owner_id WHERE j.id = ?`).get(jobId);

  const requireAdmin = (user) => {
    if (user?.role !== "admin") throw Object.assign(new Error("Administrator access is required for dataset ingestion."), { status: 403 });
  };
  const canAccess = (job, user) => Boolean(job && user?.role === "admin");

  const updateFromMessage = (jobId, message) => {
    const stage = String(message.stage || "processing");
    const progress = Math.min(100, Math.max(0, Number(message.progress || 0)));
    db.prepare("UPDATE ingestion_jobs SET stage = ?, progress = ?, updated_at = ? WHERE id = ?")
      .run(stage, progress, now(), jobId);
    if (message.message) event(db, jobId, stage, "progress", String(message.message), message.details || {});
  };

  const runWorker = (jobId, mode) => {
    if (active.has(jobId)) return;
    const job = find(jobId);
    if (!job || !existsSync(job.source_path)) return;
    const workDir = path.join(baseDir, jobId);
    mkdirSync(workDir, { recursive: true });
    const python = pythonCommand();
    const script = path.join(root, "scripts", "hospital-csv-pipeline.py");
    const discoveryPath = path.join(workDir, "discovery.json");
    const mappingPath = path.join(workDir, "mapping.json");
    const processedPath = path.join(workDir, "processed");
    const args = mode === "inspect"
      ? [...python.prefix, script, "inspect", job.source_path, discoveryPath]
      : [...python.prefix, script, "process", job.source_path, mappingPath, processedPath];
    const status = mode === "inspect" ? "Inspecting" : "Processing";
    db.prepare("UPDATE ingestion_jobs SET status = ?, stage = ?, progress = ?, error_message = NULL, cancel_requested = 0, updated_at = ? WHERE id = ?")
      .run(status, mode === "inspect" ? "inspecting" : "processing", 1, now(), jobId);
    event(db, jobId, mode, "started", mode === "inspect" ? "Schema discovery started." : "Data preprocessing started.");
    const child = spawn(python.command, args, { cwd: root, windowsHide: true });
    active.set(jobId, child);
    createInterface({ input: child.stdout }).on("line", (line) => {
      try { updateFromMessage(jobId, JSON.parse(line)); } catch { /* non-JSON worker output is intentionally ignored */ }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.once("error", (error) => {
      active.delete(jobId);
      const message = error.code === "ENOENT" ? "Python 3 is required for large hospital CSV preprocessing." : error.message;
      db.prepare("UPDATE ingestion_jobs SET status='Failed', stage='failed', error_message=?, updated_at=? WHERE id=?").run(message, now(), jobId);
      event(db, jobId, "failed", "failed", message);
    });
    child.once("close", (code) => {
      active.delete(jobId);
      const current = find(jobId);
      if (!current || current.cancel_requested) return;
      if (code !== 0) {
        const message = stderr.trim().split(/\r?\n/).at(-1) || `Preprocessing worker exited with code ${code}.`;
        db.prepare("UPDATE ingestion_jobs SET status='Failed', stage='failed', error_message=?, updated_at=? WHERE id=?").run(message, now(), jobId);
        event(db, jobId, "failed", "failed", message, { exitCode: code });
        return;
      }
      try {
        if (mode === "inspect") {
          const discovery = JSON.parse(readFileSync(discoveryPath, "utf8"));
          const profile = db.prepare("SELECT mapping_json FROM mapping_profiles WHERE structure_fingerprint = ?").get(discovery.structureFingerprint);
          const mapping = profile ? safeJson(profile.mapping_json) : discovery.suggestedMapping;
          db.prepare(`UPDATE ingestion_jobs SET status='Awaiting Mapping', stage='awaiting_mapping', progress=100,
            discovery_json=?, mapping_json=?, updated_at=? WHERE id=?`)
            .run(JSON.stringify(discovery), JSON.stringify(mapping), now(), jobId);
          event(db, jobId, "awaiting_mapping", "completed", profile ? "Schema matched a saved mapping profile; Admin confirmation is still required." : "Schema discovery completed; Admin mapping confirmation is required.", { reusedProfile: Boolean(profile) });
        } else {
          const quality = JSON.parse(readFileSync(path.join(processedPath, "quality.json"), "utf8"));
          const mapping = safeJson(current.mapping_json);
          const rules = safeJson(current.rules_json);
          const imported = importProcessedDirectory({
            db, ownerId: current.owner_id, name: current.name, description: current.description,
            sourceFileName: current.source_filename, sourcePath: current.source_path, sourceHash: current.source_sha256,
            processedPath, ingestionJobId: jobId, mapping, rules, quality,
          });
          db.prepare(`UPDATE ingestion_jobs SET status='Awaiting Approval', stage='quality_review', progress=100,
            quality_json=?, processed_path=?, dataset_id=?, version_id=?, completed_at=?, updated_at=? WHERE id=?`)
            .run(JSON.stringify(quality), processedPath, imported.datasetId, imported.versionId, now(), now(), jobId);
          event(db, jobId, "quality_review", "completed", "Preprocessing completed; the dataset is unavailable until Admin approval.", imported);
        }
      } catch (error) {
        db.prepare("UPDATE ingestion_jobs SET status='Failed', stage='failed', error_message=?, updated_at=? WHERE id=?").run(error.message, now(), jobId);
        event(db, jobId, "failed", "failed", error.message);
      }
    });
  };

  const resume = () => {
    for (const row of db.prepare("SELECT id, status FROM ingestion_jobs WHERE status IN ('Inspecting','Processing')").all()) {
      event(db, row.id, "recovery", "resumed", "The local service restarted; the current stage is being safely replayed from the immutable source file.");
      runWorker(row.id, row.status === "Inspecting" ? "inspect" : "process");
    }
  };
  setImmediate(resume);

  return {
    list(user) {
      requireAdmin(user);
      const rows = db.prepare(`SELECT j.*, u.display_name AS owner_name FROM ingestion_jobs j JOIN users u ON u.id=j.owner_id ORDER BY j.created_at DESC`).all();
      return rows.map((row) => dto(row));
    },
    get(user, jobId) {
      requireAdmin(user);
      const job = find(jobId);
      if (!canAccess(job, user)) return null;
      const events = db.prepare("SELECT stage,status,message,details_json,created_at FROM ingestion_events WHERE job_id=? ORDER BY created_at DESC LIMIT 100").all(jobId)
        .map((item) => ({ stage: item.stage, status: item.status, message: item.message, details: safeJson(item.details_json), createdAt: item.created_at }));
      return dto(job, { includeDetails: true, events });
    },
    create(user, payload) {
      requireAdmin(user);
      const fileName = path.basename(String(payload.fileName || ""));
      const size = Number(payload.size || 0);
      if (!fileName.toLowerCase().endsWith(".zip")) throw new Error("The preprocessing pipeline accepts ZIP files containing CSV or CSV.GZ tables.");
      if (!Number.isSafeInteger(size) || size <= 0) throw new Error("A valid source file size is required.");
      const volume = statfsSync(baseDir);
      const availableBytes = Number(volume.bavail) * Number(volume.bsize);
      if (size * 2.2 > availableBytes) throw new Error("Insufficient local disk space. Keep at least 2.2 times the ZIP size free for the immutable upload and preprocessing workspace.");
      const jobId = id("ING");
      const jobDir = path.join(baseDir, jobId);
      mkdirSync(jobDir, { recursive: true });
      const sourcePath = path.join(jobDir, "source-upload.zip.part");
      writeFileSync(sourcePath, Buffer.alloc(0));
      const timestamp = now();
      db.prepare(`INSERT INTO ingestion_jobs (id,owner_id,name,description,source_filename,source_path,source_size,received_bytes,status,stage,progress,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,0,'Uploading','uploading',0,?,?)`)
        .run(jobId, user.id, String(payload.name || fileName).trim(), String(payload.description || "").trim(), fileName, sourcePath, size, timestamp, timestamp);
      event(db, jobId, "uploading", "started", "Resumable local upload created.", { sourceSize: size });
      audit(db, user.id, "ingestion.created", "ingestion_job", jobId, { fileName, size });
      return this.get(user, jobId);
    },
    async appendChunk(user, jobId, req, offset) {
      requireAdmin(user);
      const job = find(jobId);
      if (!canAccess(job, user)) return { error: "not_found" };
      if (job.status !== "Uploading") throw new Error("This upload is no longer accepting chunks.");
      const expected = Number(job.received_bytes || 0);
      if (offset < expected) return { receivedBytes: expected, duplicate: true };
      if (offset !== expected) {
        const error = new Error(`Upload offset mismatch. Server expects byte ${expected}.`); error.status = 409; throw error;
      }
      const remaining = Number(job.source_size) - expected;
      let received = 0;
      await new Promise((resolve, reject) => {
        const target = createWriteStream(job.source_path, { flags: "a" });
        req.on("data", (chunk) => {
          received += chunk.length;
          if (received > Math.min(remaining, 8 * 1024 * 1024)) {
            req.destroy(new Error("Upload chunk exceeds the 8 MB limit."));
          }
        });
        req.on("error", reject); target.on("error", reject); target.on("finish", resolve); req.pipe(target);
      });
      const next = expected + received;
      db.prepare("UPDATE ingestion_jobs SET received_bytes=?, progress=?, updated_at=? WHERE id=?")
        .run(next, Math.min(99, Math.floor(next / Number(job.source_size) * 100)), now(), jobId);
      return { receivedBytes: next, complete: next === Number(job.source_size) };
    },
    async complete(user, jobId) {
      requireAdmin(user);
      const job = find(jobId);
      if (!canAccess(job, user)) return null;
      if (Number(job.received_bytes) !== Number(job.source_size)) throw new Error(`Upload is incomplete: ${job.received_bytes} of ${job.source_size} bytes received.`);
      if (statSync(job.source_path).size !== Number(job.source_size)) throw new Error("Uploaded file size does not match the declared size.");
      const finalPath = job.source_path.replace(/\.part$/, "");
      if (job.source_path !== finalPath) renameSync(job.source_path, finalPath);
      const digest = await hashFile(finalPath);
      db.prepare("UPDATE ingestion_jobs SET source_path=?, source_sha256=?, status='Inspecting', stage='inspecting', progress=1, updated_at=? WHERE id=?")
        .run(finalPath, digest, now(), jobId);
      event(db, jobId, "uploading", "completed", "Upload completed and fingerprinted.", { sha256: digest });
      setImmediate(() => runWorker(jobId, "inspect"));
      return this.get(user, jobId);
    },
    saveMapping(user, jobId, mapping) {
      if (user.role !== "admin") throw Object.assign(new Error("Administrator access is required."), { status: 403 });
      const job = find(jobId);
      if (!job) return null;
      const discovery = safeJson(job.discovery_json);
      if (!Array.isArray(mapping?.tables) || !mapping.tables.length) throw new Error("At least one source table mapping is required.");
      const allowedEntries = new Set((discovery.tables || []).map((item) => item.entry));
      for (const table of mapping.tables) {
        if (!allowedEntries.has(table.entry)) throw new Error(`Unknown source table: ${table.entry}`);
        for (const canonical of Object.values(table.fields || {})) {
          if (!safeJson(JSON.stringify(discovery.canonicalFields), []).includes(canonical)) throw new Error(`Unsupported canonical field: ${canonical}`);
        }
      }
      const timestamp = now();
      db.prepare("UPDATE ingestion_jobs SET mapping_json=?, status='Awaiting Mapping', stage='awaiting_mapping', updated_at=? WHERE id=?")
        .run(JSON.stringify(mapping), timestamp, jobId);
      if (discovery.structureFingerprint) db.prepare(`INSERT INTO mapping_profiles (id,name,structure_fingerprint,mapping_json,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(structure_fingerprint) DO UPDATE SET mapping_json=excluded.mapping_json, updated_at=excluded.updated_at`)
        .run(id("MAP"), `${job.name} mapping`, discovery.structureFingerprint, JSON.stringify(mapping), user.id, timestamp, timestamp);
      event(db, jobId, "awaiting_mapping", "confirmed", "Admin confirmed the field mapping.");
      audit(db, user.id, "ingestion.mapping_confirmed", "ingestion_job", jobId, { fingerprint: discovery.structureFingerprint });
      return this.get(user, jobId);
    },
    process(user, jobId, rules = {}) {
      if (user.role !== "admin") throw Object.assign(new Error("Administrator access is required."), { status: 403 });
      const job = find(jobId);
      if (!job) return null;
      if (!job.source_sha256) throw new Error("Upload and schema discovery must complete first.");
      const mapping = safeJson(job.mapping_json);
      if (!Array.isArray(mapping.tables) || !mapping.tables.length) throw new Error("Admin must confirm a field mapping before processing.");
      const confirmedRules = { minimumVisits: 1, taskRouting: "adaptive", referencePolicy: "withhold_latest_only_when_multiple_records",
        criticalClinicalImputation: "forbidden", limitedLocf: { weightDays: 365, bmiDays: 365, heightDays: 1825 }, ...rules };
      const workDir = path.join(baseDir, jobId);
      writeFileSync(path.join(workDir, "mapping.json"), JSON.stringify(mapping, null, 2), "utf8");
      db.prepare("UPDATE ingestion_jobs SET rules_json=?, status='Processing', stage='processing', progress=1, updated_at=? WHERE id=?")
        .run(JSON.stringify(confirmedRules), now(), jobId);
      setImmediate(() => runWorker(jobId, "process"));
      return this.get(user, jobId);
    },
    approve(user, jobId, { visibility = "private", decision = "Approved" } = {}) {
      if (user.role !== "admin") throw Object.assign(new Error("Administrator access is required."), { status: 403 });
      const job = find(jobId);
      if (!job || !job.dataset_id || !job.version_id) return null;
      const status = decision === "Rejected" ? "Rejected" : "Approved";
      const releasedVisibility = status === "Approved" && visibility === "shared" ? "shared" : "private";
      const timestamp = now();
      db.prepare("UPDATE datasets SET status=?, visibility=?, reviewed_at=?, reviewed_by=? WHERE id=?")
        .run(status, releasedVisibility, timestamp, user.id, job.dataset_id);
      db.prepare("UPDATE dataset_versions SET status=?, approved_by=?, approved_at=? WHERE id=?")
        .run(status, user.id, timestamp, job.version_id);
      db.prepare("UPDATE ingestion_jobs SET status=?, stage=?, updated_at=? WHERE id=?")
        .run(status, status === "Approved" ? "approved" : "rejected", timestamp, jobId);
      event(db, jobId, status.toLowerCase(), "completed", status === "Approved" ? "Admin approved this immutable processed version." : "Admin rejected this processed version.", { visibility: releasedVisibility });
      audit(db, user.id, `ingestion.${status.toLowerCase()}`, "ingestion_job", jobId, { datasetId: job.dataset_id, versionId: job.version_id, visibility: releasedVisibility });
      return this.get(user, jobId);
    },
    retry(user, jobId) {
      requireAdmin(user);
      const job = find(jobId);
      if (!canAccess(job, user)) return null;
      if (active.has(jobId)) throw new Error("This processing job is already running.");
      const mode = job.discovery_json && job.discovery_json !== "{}" ? "process" : "inspect";
      if (mode === "process" && user.role !== "admin") throw Object.assign(new Error("Admin must retry preprocessing after reviewing the failure."), { status: 403 });
      setImmediate(() => runWorker(jobId, mode));
      return this.get(user, jobId);
    },
    cancel(user, jobId) {
      requireAdmin(user);
      const job = find(jobId);
      if (!canAccess(job, user)) return null;
      active.get(jobId)?.kill();
      active.delete(jobId);
      db.prepare("UPDATE ingestion_jobs SET status='Cancelled', stage='cancelled', cancel_requested=1, updated_at=? WHERE id=?").run(now(), jobId);
      event(db, jobId, "cancelled", "completed", "Processing was cancelled; the immutable source upload remains available for audit.");
      return this.get(user, jobId);
    },
  };
}

export { dto as ingestionJobDto };
