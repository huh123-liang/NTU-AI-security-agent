import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { audit, id, now, sha256, withTransaction } from "./database.mjs";

const text = (bytes) => strFromU8(bytes).replace(/^\uFEFF/, "");

export function parseCsv(source) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && quoted && source[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "").trim()])));
}

const normaliseEntry = (value) => String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
const patientIdOf = (patient) => String(patient?.patient_id || patient?.patientId || patient?.id || "").trim();

function issueWriter(db, datasetId) {
  const statement = db.prepare(`INSERT INTO dataset_issues (id, dataset_id, patient_id, severity, code, message, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  return (patientId, severity, code, message, details = {}) => statement.run(
    id("ISS"), datasetId, patientId || null, severity, code, message, JSON.stringify(details), now(),
  );
}

function validateLongitudinalPatient(patient, expectedId = null, strictTenVisits = false) {
  const errors = [];
  const warnings = [];
  const patientId = patientIdOf(patient);
  if (!patientId) errors.push("Patient ID is missing.");
  if (expectedId && patientId !== expectedId) errors.push(`Patient ID does not match manifest (${expectedId}).`);
  if (!Array.isArray(patient?.visits) || !patient.visits.length) errors.push("Longitudinal visits are missing.");
  if (strictTenVisits && patient?.visits?.length !== 10) errors.push(`Expected 10 visits, found ${patient?.visits?.length || 0}.`);
  if (!strictTenVisits && patient?.visits?.length < 2) warnings.push("Fewer than two visits; longitudinal evaluation will be limited.");
  const dates = Array.isArray(patient?.visits) ? patient.visits.map((visit) => Date.parse(visit?.date || "")) : [];
  if (dates.some((date) => !Number.isFinite(date))) errors.push("One or more visit dates are invalid.");
  if (dates.some((date, index) => index > 0 && date < dates[index - 1])) errors.push("Visit dates are not chronological.");
  if (patient?.synthetic !== true) warnings.push("The record is not explicitly marked synthetic.");
  return { patientId, errors, warnings };
}

function persistPatient(db, datasetId, patient, sourceEntry, sourceBytes, strictTenVisits, expectedId, writeIssue) {
  const quality = validateLongitudinalPatient(patient, expectedId, strictTenVisits);
  quality.warnings.forEach((message) => writeIssue(quality.patientId || expectedId, "medium", "PATIENT_WARNING", message));
  if (quality.errors.length) {
    quality.errors.forEach((message) => writeIssue(quality.patientId || expectedId, "high", "INVALID_PATIENT", message));
    return false;
  }
  const visits = patient.visits;
  const referenceVisit = visits[visits.length - 1];
  const conditions = Array.isArray(patient.conditions) ? patient.conditions : [];
  const conditionSummary = conditions.map((condition) => condition.display || condition.key || condition.condition).filter(Boolean).join(" · ") || patient.condition || "Chronic-care review";
  db.prepare(`INSERT INTO cases (id, dataset_id, patient_id, age, sex, ethnicity, condition_summary, conditions_json,
    visit_count, clinical_json, reference_visit_json, source_entry, source_sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id("CASE"), datasetId, quality.patientId, Number(patient.age_at_visit_1 ?? patient.age ?? null),
      String(patient.sex || "unspecified"), String(patient.ethnicity || "unspecified"), conditionSummary,
      JSON.stringify(conditions), visits.length, JSON.stringify(patient), JSON.stringify(referenceVisit || {}),
      sourceEntry, sha256(Buffer.from(sourceBytes)), now());
  return true;
}

function createDataset(db, payload, sourcePath, sourceHash) {
  const datasetId = id("DATA");
  db.prepare(`INSERT INTO datasets (id, owner_id, name, description, source_filename, source_format, source_path,
    source_sha256, status, visibility, declared_count, valid_count, quarantined_count, provenance_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, '{}', ?)`)
    .run(datasetId, payload.ownerId, payload.name || payload.fileName, payload.description || "", payload.fileName,
      payload.format, sourcePath, sourceHash, payload.status || "Pending Review", payload.visibility || "private", now());
  return datasetId;
}

function importSyntheaZip(db, datasetId, buffer) {
  const archive = unzipSync(new Uint8Array(buffer));
  const keys = Object.keys(archive).filter((entry) => !entry.startsWith("__MACOSX/") && !entry.endsWith("/"));
  const manifestKey = keys.find((entry) => entry.endsWith("/manifest.csv") || entry === "manifest.csv");
  const summaryKey = keys.find((entry) => entry.endsWith("/RUN_SUMMARY.json") || entry === "RUN_SUMMARY.json");
  const readmeKey = keys.find((entry) => entry.endsWith("/README.md") || entry === "README.md");
  if (!manifestKey) throw new Error("ZIP does not contain manifest.csv.");
  const manifest = parseCsv(text(archive[manifestKey]));
  const writeIssue = issueWriter(db, datasetId);
  const patientEntries = new Map(keys.filter((entry) => /\/patients\/[^/]+\.json$/i.test(`/${entry}`)).map((entry) => [path.posix.basename(entry), entry]));
  let valid = 0;
  let quarantined = 0;

  for (const item of manifest) {
    const expectedId = String(item.patient_id || item.patientId || item.id || "").trim();
    const requested = path.posix.basename(normaliseEntry(item.file || `${expectedId}.json`));
    const entry = patientEntries.get(requested);
    if (!entry) {
      quarantined += 1;
      writeIssue(expectedId, "critical", "MISSING_PATIENT_FILE", "Manifest entry has no corresponding patient JSON file.", { manifestFile: item.file || null });
      continue;
    }
    try {
      const patient = JSON.parse(text(archive[entry]));
      if (persistPatient(db, datasetId, patient, entry, archive[entry], true, expectedId, writeIssue)) valid += 1;
      else quarantined += 1;
    } catch (error) {
      quarantined += 1;
      writeIssue(expectedId, "high", "INVALID_JSON", "Patient JSON could not be parsed.", { error: error.message });
    }
  }

  const manifestFileNames = new Set(manifest.map((item) => path.posix.basename(normaliseEntry(item.file || `${item.patient_id}.json`))));
  for (const [fileName, entry] of patientEntries) {
    if (!manifestFileNames.has(fileName)) writeIssue(null, "medium", "UNLISTED_PATIENT_FILE", "Patient file is not referenced by the manifest.", { entry });
  }
  const summary = summaryKey ? JSON.parse(text(archive[summaryKey])) : {};
  const provenance = {
    ...summary,
    readmeExcerpt: readmeKey ? text(archive[readmeKey]).slice(0, 1200) : "",
    importedFormat: "synthea-sg-zip",
  };
  return { declared: manifest.length, valid, quarantined, schemaVersion: String(summary.schema_version || "unknown"), provenance };
}

function importJson(db, datasetId, buffer) {
  const parsed = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  const patients = Array.isArray(parsed) ? parsed : Array.isArray(parsed.patients) ? parsed.patients : [parsed];
  const writeIssue = issueWriter(db, datasetId);
  let valid = 0;
  let quarantined = 0;
  patients.forEach((patient, index) => {
    const patientBytes = Buffer.from(JSON.stringify(patient));
    if (persistPatient(db, datasetId, patient, `json[${index}]`, patientBytes, false, null, writeIssue)) valid += 1;
    else quarantined += 1;
  });
  return { declared: patients.length, valid, quarantined, schemaVersion: String(parsed.schema_version || "custom-json"), provenance: { importedFormat: "json" } };
}

function importFlatCsv(db, datasetId, buffer) {
  const records = parseCsv(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  const writeIssue = issueWriter(db, datasetId);
  let valid = 0;
  let quarantined = 0;
  const grouped = new Map();
  records.forEach((record, index) => {
    const patientId = String(record.patient_id || record.id || "").trim();
    if (!patientId) {
      writeIssue(null, "high", "MISSING_PATIENT_ID", `CSV row ${index + 2} has no patient_id or id.`);
      return;
    }
    if (!grouped.has(patientId)) grouped.set(patientId, []);
    grouped.get(patientId).push({ ...record, __row: index + 2 });
  });
  for (const [patientId, rows] of grouped) {
    if (rows.length < 2) {
      quarantined += 1;
      writeIssue(patientId, "high", "INSUFFICIENT_VISITS", "A longitudinal evaluation case requires at least two CSV rows/visits for the same patient.", { rows: rows.map((row) => row.__row) });
      continue;
    }
    const ordered = [...rows].sort((a, b) => Date.parse(a.date || "") - Date.parse(b.date || ""));
    const conditions = [...new Set(rows.map((row) => row.condition || row.diagnosis).filter(Boolean))];
    const patient = {
      patient_id: patientId,
      synthetic: String(ordered[0].synthetic || "true").toLowerCase() !== "false",
      age_at_visit_1: Number(ordered[0].age || 0) || null,
      sex: ordered[0].sex || "unspecified",
      ethnicity: ordered[0].ethnicity || "unspecified",
      conditions: (conditions.length ? conditions : ["Chronic-care review"]).map((condition) => ({ key: condition.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_"), display: condition })),
      visits: ordered.map((record, visitIndex) => ({ visit_number: visitIndex + 1, date: record.date, status: "completed", source_row: Object.fromEntries(Object.entries(record).filter(([key]) => key !== "__row")) })),
    };
    const bytes = Buffer.from(JSON.stringify(rows));
    if (persistPatient(db, datasetId, patient, `csv:rows-${rows[0].__row}-${rows.at(-1).__row}`, bytes, false, patientId, writeIssue)) valid += 1;
    else quarantined += 1;
  }
  return { declared: grouped.size, valid, quarantined, schemaVersion: "longitudinal-csv-v2", provenance: { importedFormat: "csv", sourceRows: records.length } };
}

export function importDatasetBuffer({ db, root, ownerId, fileName, buffer, name, description = "", status = "Pending Review", visibility = "private" }) {
  const extension = path.extname(fileName).toLowerCase();
  const format = extension === ".zip" ? "ZIP" : extension === ".json" ? "JSON" : extension === ".csv" ? "CSV" : "";
  if (!format) throw new Error("Supported dataset formats are ZIP, JSON and CSV.");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("Uploaded dataset is empty.");
  const uploadDir = path.join(root, ".data", "uploads");
  mkdirSync(uploadDir, { recursive: true });
  const sourceHash = sha256(buffer);
  const safeFileName = path.basename(fileName).replaceAll(/[^a-zA-Z0-9._-]+/g, "_");
  const sourcePath = path.join(uploadDir, `${Date.now()}-${safeFileName}`);
  writeFileSync(sourcePath, buffer);
  const datasetId = createDataset(db, { ownerId, name, description, fileName, format, status, visibility }, sourcePath, sourceHash);
  try {
    const result = withTransaction(db, () => {
      if (format === "ZIP") return importSyntheaZip(db, datasetId, buffer);
      if (format === "JSON") return importJson(db, datasetId, buffer);
      return importFlatCsv(db, datasetId, buffer);
    });
    db.prepare(`UPDATE datasets SET declared_count = ?, valid_count = ?, quarantined_count = ?, schema_version = ?, provenance_json = ? WHERE id = ?`)
      .run(result.declared, result.valid, result.quarantined, result.schemaVersion, JSON.stringify(result.provenance), datasetId);
    audit(db, ownerId, "dataset.imported", "dataset", datasetId, { format, ...result });
    return { id: datasetId, format, ...result, sourceHash, status, visibility };
  } catch (error) {
    db.prepare("UPDATE datasets SET status = 'Rejected', quarantined_count = declared_count WHERE id = ?").run(datasetId);
    issueWriter(db, datasetId)(null, "critical", "IMPORT_FAILED", error.message);
    throw error;
  }
}

export function ensureBundledDataset({ db, root }) {
  const existing = db.prepare("SELECT id FROM datasets WHERE source_filename = ? LIMIT 1").get("data500_v5_Pat1to500.zip");
  if (existing) {
    db.prepare("UPDATE datasets SET description = ? WHERE id = ?").run("Research-only Synthea-SG cohort. Manifest declares 500 patients; 369 complete records accepted, 33 truncated JSON files and 98 missing files quarantined.", existing.id);
    return existing.id;
  }
  const bundledPath = path.join(root, "data-source", "data500_v5_Pat1to500.zip");
  if (!existsSync(bundledPath)) return null;
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  const result = importDatasetBuffer({
    db,
    root,
    ownerId: admin.id,
    fileName: "data500_v5_Pat1to500.zip",
    buffer: readFileSync(bundledPath),
    name: "Singapore Synthetic Chronic-Care Cohort",
    description: "Research-only Synthea-SG cohort. Manifest declares 500 patients; 369 complete records accepted, 33 truncated JSON files and 98 missing files quarantined.",
    status: "Approved",
    visibility: "shared",
  });
  return result.id;
}
