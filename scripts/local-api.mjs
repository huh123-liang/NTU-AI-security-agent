import { readFileSync } from "node:fs";
import { getDatabase, publicUser, hashPassword, verifyPassword, createSession, getAuthenticatedUser, removeSession, audit, id, now, withTransaction } from "./database.mjs";
import { importDatasetBuffer, ensureBundledDataset } from "./dataset-importer.mjs";
import { previewAggregation, finalizeAggregation } from "./aggregation.mjs";
import { CRITERIA, safeJson, round } from "./domain.mjs";
import { runMedicalModel, supportedProviders, PROMPT_VERSION } from "../worker/model-adapter.js";

const MAX_BODY_BYTES = 40 * 1024 * 1024;

const readBody = (req) => new Promise((resolve, reject) => {
  let body = "";
  let bytes = 0;
  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      reject(new Error("Request exceeds the 40 MB local upload limit."));
      req.destroy();
      return;
    }
    body += chunk;
  });
  req.on("end", () => {
    try { resolve(body ? JSON.parse(body) : {}); }
    catch { reject(new Error("Request body is not valid JSON.")); }
  });
  req.on("error", reject);
});

const send = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
};

const datasetDto = (row) => ({
  id: row.id,
  ownerId: row.owner_id,
  ownerName: row.owner_name,
  name: row.name,
  description: row.description,
  sourceFilename: row.source_filename,
  sourceFormat: row.source_format,
  sourceSha256: row.source_sha256,
  status: row.status,
  visibility: row.visibility,
  declaredCount: Number(row.declared_count),
  validCount: Number(row.valid_count),
  quarantinedCount: Number(row.quarantined_count),
  schemaVersion: row.schema_version,
  provenance: safeJson(row.provenance_json, {}),
  createdAt: row.created_at,
  reviewedAt: row.reviewed_at,
});

const caseDto = (row, includeClinical = false) => ({
  id: row.id,
  datasetId: row.dataset_id,
  datasetName: row.dataset_name,
  patientId: row.patient_id,
  patientName: row.patient_id,
  age: row.age,
  sex: row.sex,
  ethnicity: row.ethnicity,
  condition: row.condition_summary,
  conditions: safeJson(row.conditions_json, []),
  visits: Number(row.visit_count),
  sourceEntry: row.source_entry,
  sourceSha256: row.source_sha256,
  ...(includeClinical ? { clinicalData: safeJson(row.clinical_json, {}), referenceVisit: safeJson(row.reference_visit_json, {}) } : {}),
});

const runDto = (row) => ({
  id: row.id,
  caseId: row.case_id,
  createdBy: row.created_by,
  creatorName: row.creator_name,
  provider: row.provider,
  modelVersion: row.model_version,
  promptVersion: row.prompt_version,
  status: row.status,
  output: row.output,
  responseId: row.response_id,
  usage: safeJson(row.usage_json, {}),
  errorMessage: row.error_message,
  createdAt: row.created_at,
  completedAt: row.completed_at,
  assessmentCount: Number(row.assessment_count || 0),
});

function assessmentDto(db, row) {
  const criteria = db.prepare("SELECT criterion_key, score, feedback, tags_json, custom_tags_json FROM criterion_scores WHERE assessment_id = ? ORDER BY rowid").all(row.id)
    .map((item) => ({ key: item.criterion_key, score: Number(item.score), feedback: item.feedback, tags: safeJson(item.tags_json, []), customTags: safeJson(item.custom_tags_json, []) }));
  return {
    id: row.id,
    runId: row.run_id,
    caseId: row.case_id,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerEmail: row.reviewer_email,
    patientId: row.patient_id,
    datasetId: row.dataset_id,
    datasetName: row.dataset_name,
    modelVersion: row.model_version,
    status: row.status,
    overallScore: row.overall_score === null ? null : round(row.overall_score),
    safetyIssue: row.safety_issue,
    reasonTags: safeJson(row.reason_tags_json, []),
    caseFeedback: row.case_feedback,
    version: Number(row.version),
    locked: Boolean(row.locked),
    criteria,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
  };
}

function datasetAccessRow(db, user, datasetId) {
  const row = db.prepare("SELECT * FROM datasets WHERE id = ?").get(datasetId);
  if (!row) return null;
  if (user.role === "admin" || row.owner_id === user.id || (row.visibility === "shared" && row.status === "Approved")) return row;
  return null;
}

function caseAccessRow(db, user, caseId) {
  const row = db.prepare(`SELECT c.*, d.name AS dataset_name, d.owner_id, d.visibility, d.status AS dataset_status
    FROM cases c JOIN datasets d ON d.id = c.dataset_id WHERE c.id = ?`).get(caseId);
  if (!row) return null;
  if (user.role === "admin" || row.owner_id === user.id || (row.visibility === "shared" && row.dataset_status === "Approved")) return row;
  return null;
}

function requireAdmin(user, res) {
  if (user.role !== "admin") { send(res, 403, { error: "Administrator access is required." }); return false; }
  return true;
}

function joinedAssessmentRows(db, where = "1 = 1", parameters = []) {
  const sql = `SELECT a.*, u.display_name AS reviewer_name, u.email AS reviewer_email, c.patient_id, c.dataset_id,
    d.name AS dataset_name, r.model_version
    FROM assessments a
    JOIN users u ON u.id = a.reviewer_id
    JOIN cases c ON c.id = a.case_id
    JOIN datasets d ON d.id = c.dataset_id
    JOIN agent_runs r ON r.id = a.run_id
    WHERE ${where} ORDER BY a.updated_at DESC`;
  return db.prepare(sql).all(...parameters);
}

export function localApiPlugin(root, modelConfig = {}) {
  const db = getDatabase(root);
  let bootstrapError = null;
  try { ensureBundledDataset({ db, root }); }
  catch (error) { bootstrapError = error.message; }

  return {
    name: "ntu-local-sql-api",
    configureServer(server) {
      server.middlewares.use("/api/v1", async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://local");
          const pathname = url.pathname;
          const method = req.method || "GET";

          if (pathname === "/health" && method === "GET") {
            return send(res, 200, {
              status: bootstrapError ? "degraded" : "ok",
              database: "SQLite",
              databaseFile: ".data/platform.db",
              modelProvider: modelConfig.provider || "deepseek",
              modelConfigured: Boolean(modelConfig.apiKey),
              supportedProviders: supportedProviders(),
              bootstrapError,
            });
          }

          if (pathname === "/auth/register" && method === "POST") {
            const body = await readBody(req);
            const displayName = String(body.displayName || "").trim();
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");
            if (!displayName || !email.includes("@") || !password) return send(res, 422, { error: "Display name, valid email and password are required." });
            if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) return send(res, 409, { error: "An account already exists for this email." });
            const credentials = hashPassword(password);
            const userId = id("USR");
            const timestamp = now();
            db.prepare(`INSERT INTO users (id, display_name, email, password_hash, password_salt, role, active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'doctor', 1, ?, ?)`)
              .run(userId, displayName, email, credentials.hash, credentials.salt, timestamp, timestamp);
            const session = createSession(db, userId);
            const user = publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(userId));
            audit(db, userId, "doctor.registered", "user", userId);
            return send(res, 201, { user, ...session });
          }

          if (pathname === "/auth/login" && method === "POST") {
            const body = await readBody(req);
            const email = String(body.email || "").trim().toLowerCase();
            const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
            if (!row || !row.active || !verifyPassword(String(body.password || ""), row.password_salt, row.password_hash)) return send(res, 401, { error: "Email or password is incorrect." });
            if (body.portalRole && body.portalRole !== row.role) return send(res, 403, { error: `This account belongs to the ${row.role} portal.` });
            const session = createSession(db, row.id);
            audit(db, row.id, "session.login", "user", row.id, { role: row.role });
            return send(res, 200, { user: publicUser(row), ...session });
          }

          const user = getAuthenticatedUser(db, req);
          if (!user) return send(res, 401, { error: "Please sign in to continue." });

          if (pathname === "/auth/me" && method === "GET") return send(res, 200, { user });
          if (pathname === "/auth/logout" && method === "POST") { removeSession(db, req); return send(res, 200, { ok: true }); }
          if (pathname === "/rubrics" && method === "GET") return send(res, 200, { criteria: CRITERIA });

          if (pathname === "/dashboard" && method === "GET") {
            if (user.role === "admin") {
              const metric = (sql) => Number(db.prepare(sql).get().count);
              return send(res, 200, { metrics: {
                doctors: metric("SELECT COUNT(*) AS count FROM users WHERE role = 'doctor'"),
                activeDoctors: metric("SELECT COUNT(*) AS count FROM users WHERE role = 'doctor' AND active = 1"),
                datasets: metric("SELECT COUNT(*) AS count FROM datasets"),
                validCases: metric("SELECT COUNT(*) AS count FROM cases"),
                responseRuns: metric("SELECT COUNT(*) AS count FROM agent_runs WHERE status = 'Completed'"),
                submittedAssessments: metric("SELECT COUNT(*) AS count FROM assessments WHERE status = 'Submitted'"),
                pendingDatasets: metric("SELECT COUNT(*) AS count FROM datasets WHERE status = 'Pending Review'"),
                newFeedback: metric("SELECT COUNT(*) AS count FROM platform_feedback WHERE status = 'New'"),
              } });
            }
            const row = db.prepare(`SELECT
              (SELECT COUNT(*) FROM datasets d WHERE d.owner_id = ? OR (d.visibility = 'shared' AND d.status = 'Approved')) AS datasets,
              (SELECT COUNT(*) FROM cases c JOIN datasets d ON d.id = c.dataset_id WHERE d.owner_id = ? OR (d.visibility = 'shared' AND d.status = 'Approved')) AS cases,
              (SELECT COUNT(*) FROM agent_runs WHERE created_by = ?) AS runs,
              (SELECT COUNT(*) FROM assessments WHERE reviewer_id = ? AND status = 'Submitted') AS submitted`).get(user.id, user.id, user.id, user.id);
            return send(res, 200, { metrics: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])) });
          }

          if (pathname === "/datasets" && method === "GET") {
            const rows = user.role === "admin"
              ? db.prepare(`SELECT d.*, u.display_name AS owner_name FROM datasets d JOIN users u ON u.id = d.owner_id ORDER BY d.created_at DESC`).all()
              : db.prepare(`SELECT d.*, u.display_name AS owner_name FROM datasets d JOIN users u ON u.id = d.owner_id
                  WHERE d.owner_id = ? OR (d.visibility = 'shared' AND d.status = 'Approved') ORDER BY d.created_at DESC`).all(user.id);
            return send(res, 200, { items: rows.map(datasetDto) });
          }

          if (pathname === "/datasets/import" && method === "POST") {
            const body = await readBody(req);
            const fileName = String(body.fileName || "");
            const encoded = String(body.contentBase64 || "");
            if (!fileName || !encoded) return send(res, 422, { error: "Dataset file and filename are required." });
            const result = importDatasetBuffer({
              db, root, ownerId: user.id, fileName, buffer: Buffer.from(encoded, "base64"),
              name: String(body.name || fileName).trim(), description: String(body.description || "").trim(),
              status: user.role === "admin" ? "Approved" : "Pending Review",
              visibility: user.role === "admin" && body.visibility === "shared" ? "shared" : "private",
            });
            return send(res, 201, result);
          }

          const datasetMatch = pathname.match(/^\/datasets\/([^/]+)$/);
          if (datasetMatch && method === "GET") {
            const dataset = datasetAccessRow(db, user, decodeURIComponent(datasetMatch[1]));
            if (!dataset) return send(res, 404, { error: "Dataset not found or not available to this account." });
            const owner = db.prepare("SELECT display_name AS owner_name FROM users WHERE id = ?").get(dataset.owner_id);
            const issues = db.prepare("SELECT * FROM dataset_issues WHERE dataset_id = ? ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, patient_id LIMIT 250").all(dataset.id)
              .map((item) => ({ id: item.id, patientId: item.patient_id, severity: item.severity, code: item.code, message: item.message, details: safeJson(item.details_json, {}) }));
            return send(res, 200, { dataset: datasetDto({ ...dataset, ...owner }), issues });
          }

          const reviewDatasetMatch = pathname.match(/^\/admin\/datasets\/([^/]+)\/review$/);
          if (reviewDatasetMatch && method === "PATCH") {
            if (!requireAdmin(user, res)) return;
            const datasetId = decodeURIComponent(reviewDatasetMatch[1]);
            const body = await readBody(req);
            const status = ["Approved", "Rejected", "Pending Review"].includes(body.status) ? body.status : "Pending Review";
            const visibility = body.visibility === "shared" ? "shared" : "private";
            db.prepare("UPDATE datasets SET status = ?, visibility = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?")
              .run(status, visibility, now(), user.id, datasetId);
            audit(db, user.id, "dataset.reviewed", "dataset", datasetId, { status, visibility });
            return send(res, 200, { ok: true, status, visibility });
          }

          const datasetCasesMatch = pathname.match(/^\/datasets\/([^/]+)\/cases$/);
          if (datasetCasesMatch && method === "GET") {
            const datasetId = decodeURIComponent(datasetCasesMatch[1]);
            const dataset = datasetAccessRow(db, user, datasetId);
            if (!dataset) return send(res, 404, { error: "Dataset not found or not available to this account." });
            const search = `%${String(url.searchParams.get("search") || "").trim()}%`;
            const page = Math.max(1, Number(url.searchParams.get("page") || 1));
            const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") || 40)));
            const offset = (page - 1) * limit;
            const total = Number(db.prepare("SELECT COUNT(*) AS count FROM cases WHERE dataset_id = ? AND (patient_id LIKE ? OR condition_summary LIKE ?)").get(datasetId, search, search).count);
            const rows = db.prepare(`SELECT c.*, d.name AS dataset_name FROM cases c JOIN datasets d ON d.id = c.dataset_id
              WHERE c.dataset_id = ? AND (c.patient_id LIKE ? OR c.condition_summary LIKE ?) ORDER BY c.patient_id LIMIT ? OFFSET ?`)
              .all(datasetId, search, search, limit, offset);
            return send(res, 200, { items: rows.map((row) => caseDto(row)), total, page, limit });
          }

          const caseMatch = pathname.match(/^\/cases\/([^/]+)$/);
          if (caseMatch && method === "GET") {
            const row = caseAccessRow(db, user, decodeURIComponent(caseMatch[1]));
            if (!row) return send(res, 404, { error: "Case not found or not available to this account." });
            return send(res, 200, { case: caseDto(row, true) });
          }

          const caseRunsMatch = pathname.match(/^\/cases\/([^/]+)\/runs$/);
          if (caseRunsMatch && method === "GET") {
            const caseId = decodeURIComponent(caseRunsMatch[1]);
            if (!caseAccessRow(db, user, caseId)) return send(res, 404, { error: "Case not found or not available to this account." });
            const rows = db.prepare(`SELECT r.*, u.display_name AS creator_name,
              (SELECT COUNT(*) FROM assessments a WHERE a.run_id = r.id AND a.status = 'Submitted') AS assessment_count
              FROM agent_runs r JOIN users u ON u.id = r.created_by WHERE r.case_id = ? ORDER BY r.created_at DESC`).all(caseId);
            return send(res, 200, { items: rows.map(runDto) });
          }

          if (caseRunsMatch && method === "POST") {
            const caseId = decodeURIComponent(caseRunsMatch[1]);
            const selectedCase = caseAccessRow(db, user, caseId);
            if (!selectedCase) return send(res, 404, { error: "Case not found or not available to this account." });
            const fullClinical = safeJson(selectedCase.clinical_json, {});
            const visits = Array.isArray(fullClinical.visits) ? fullClinical.visits : [];
            if (visits.length < 2) return send(res, 422, { error: "At least two visits are required to withhold a reference visit." });
            const inputSnapshot = { ...fullClinical, visits: visits.slice(0, -1), withheldReference: { visitNumber: visits.at(-1)?.visit_number, date: visits.at(-1)?.date } };
            const runId = id("RUN");
            const startedAt = now();
            db.prepare(`INSERT INTO agent_runs (id, case_id, created_by, provider, model_version, prompt_version, status, input_snapshot_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'Running', ?, ?)`)
              .run(runId, caseId, user.id, modelConfig.provider || "deepseek", modelConfig.model || "pending", PROMPT_VERSION, JSON.stringify(inputSnapshot), startedAt);
            try {
              const model = await runMedicalModel({ clinicalData: inputSnapshot, config: modelConfig });
              const completedAt = now();
              db.prepare(`UPDATE agent_runs SET provider = ?, model_version = ?, prompt_version = ?, status = 'Completed', output = ?, response_id = ?, usage_json = ?, completed_at = ? WHERE id = ?`)
                .run(model.provider, model.modelVersion, model.promptVersion, model.output, model.responseId, JSON.stringify(model.usage || {}), completedAt, runId);
              audit(db, user.id, "agent_run.completed", "agent_run", runId, { caseId, provider: model.provider, modelVersion: model.modelVersion });
              const row = db.prepare(`SELECT r.*, u.display_name AS creator_name, 0 AS assessment_count FROM agent_runs r JOIN users u ON u.id = r.created_by WHERE r.id = ?`).get(runId);
              return send(res, 201, runDto(row));
            } catch (error) {
              db.prepare("UPDATE agent_runs SET status = 'Failed', error_message = ?, completed_at = ? WHERE id = ?").run(error.message, now(), runId);
              audit(db, user.id, "agent_run.failed", "agent_run", runId, { caseId, error: error.message });
              return send(res, 502, { error: error.message, runId });
            }
          }

          const runMatch = pathname.match(/^\/runs\/([^/]+)$/);
          if (runMatch && method === "GET") {
            const row = db.prepare(`SELECT r.*, u.display_name AS creator_name,
              (SELECT COUNT(*) FROM assessments a WHERE a.run_id = r.id AND a.status = 'Submitted') AS assessment_count
              FROM agent_runs r JOIN users u ON u.id = r.created_by WHERE r.id = ?`).get(decodeURIComponent(runMatch[1]));
            if (!row || !caseAccessRow(db, user, row.case_id)) return send(res, 404, { error: "Response run not found." });
            return send(res, 200, { run: runDto(row) });
          }

          const runAssessmentMatch = pathname.match(/^\/runs\/([^/]+)\/assessment$/);
          if (runAssessmentMatch && method === "GET") {
            const runId = decodeURIComponent(runAssessmentMatch[1]);
            const run = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId);
            if (!run || !caseAccessRow(db, user, run.case_id)) return send(res, 404, { error: "Response run not found." });
            if (user.role === "admin") {
              const rows = joinedAssessmentRows(db, "a.run_id = ?", [runId]);
              return send(res, 200, { items: rows.map((row) => assessmentDto(db, row)) });
            }
            const row = joinedAssessmentRows(db, "a.run_id = ? AND a.reviewer_id = ?", [runId, user.id])[0];
            return send(res, 200, { assessment: row ? assessmentDto(db, row) : null });
          }

          if (runAssessmentMatch && method === "PUT") {
            if (user.role !== "doctor") return send(res, 403, { error: "Only Doctor accounts can create assessments." });
            const runId = decodeURIComponent(runAssessmentMatch[1]);
            const run = db.prepare("SELECT * FROM agent_runs WHERE id = ? AND status = 'Completed'").get(runId);
            if (!run || !caseAccessRow(db, user, run.case_id)) return send(res, 404, { error: "Completed response run not found." });
            const body = await readBody(req);
            const criteria = Array.isArray(body.criteria) ? body.criteria : [];
            if (criteria.length !== CRITERIA.length || criteria.some((item) => !CRITERIA.some((criterion) => criterion.key === item.key) || Number(item.score) < 1 || Number(item.score) > 5)) {
              return send(res, 422, { error: "All six rubric dimensions require a score from 1 to 5." });
            }
            const existing = db.prepare("SELECT * FROM assessments WHERE run_id = ? AND reviewer_id = ?").get(runId, user.id);
            if (existing?.locked) return send(res, 423, { error: "This assessment is locked by a finalized result." });
            const assessmentId = existing?.id || id("ASMT");
            const timestamp = now();
            const status = body.status === "Submitted" ? "Submitted" : "Draft";
            const overallScore = criteria.reduce((sum, item) => sum + Number(item.score), 0) / criteria.length;
            withTransaction(db, () => {
              if (existing) {
                db.prepare(`UPDATE assessments SET status = ?, overall_score = ?, safety_issue = ?, reason_tags_json = ?, case_feedback = ?,
                  version = version + 1, updated_at = ?, submitted_at = ? WHERE id = ?`)
                  .run(status, overallScore, body.safetyIssue || "Undecided", JSON.stringify(body.reasonTags || []), String(body.caseFeedback || ""),
                    timestamp, status === "Submitted" ? timestamp : existing.submitted_at, assessmentId);
                db.prepare("DELETE FROM criterion_scores WHERE assessment_id = ?").run(assessmentId);
              } else {
                db.prepare(`INSERT INTO assessments (id, run_id, case_id, reviewer_id, status, overall_score, safety_issue, reason_tags_json,
                  case_feedback, version, locked, created_at, updated_at, submitted_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`)
                  .run(assessmentId, runId, run.case_id, user.id, status, overallScore, body.safetyIssue || "Undecided",
                    JSON.stringify(body.reasonTags || []), String(body.caseFeedback || ""), timestamp, timestamp, status === "Submitted" ? timestamp : null);
              }
              const insertCriterion = db.prepare(`INSERT INTO criterion_scores (id, assessment_id, criterion_key, score, feedback, tags_json, custom_tags_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)`);
              criteria.forEach((item) => insertCriterion.run(id("CRIT"), assessmentId, item.key, Number(item.score), String(item.feedback || ""), JSON.stringify(item.tags || []), JSON.stringify(item.customTags || [])));
              audit(db, user.id, status === "Submitted" ? "assessment.submitted" : "assessment.saved", "assessment", assessmentId, { runId, version: Number(existing?.version || 0) + 1 });
            });
            const row = joinedAssessmentRows(db, "a.id = ?", [assessmentId])[0];
            return send(res, existing ? 200 : 201, { assessment: assessmentDto(db, row) });
          }

          if (pathname === "/assessments" && method === "GET") {
            const rows = user.role === "admin" ? joinedAssessmentRows(db) : joinedAssessmentRows(db, "a.reviewer_id = ?", [user.id]);
            return send(res, 200, { items: rows.map((row) => assessmentDto(db, row)) });
          }

          if (pathname === "/platform-feedback" && method === "POST") {
            const body = await readBody(req);
            if (!String(body.comment || "").trim() || Number(body.clarityRating) < 1 || Number(body.clarityRating) > 5) return send(res, 422, { error: "Rating and comment are required." });
            const feedbackId = id("FDBK");
            db.prepare(`INSERT INTO platform_feedback (id, reviewer_id, topic, clarity_rating, comment, page, platform_version, status, submitted_at)
              VALUES (?, ?, ?, ?, ?, ?, 'mvp2-v1', 'New', ?)`)
              .run(feedbackId, user.id, String(body.topic || "General"), Number(body.clarityRating), String(body.comment).trim(), String(body.page || "unknown"), now());
            audit(db, user.id, "platform_feedback.created", "platform_feedback", feedbackId);
            return send(res, 201, { id: feedbackId });
          }

          if (pathname === "/admin/users" && method === "GET") {
            if (!requireAdmin(user, res)) return;
            const rows = db.prepare(`SELECT u.*,
              (SELECT COUNT(*) FROM assessments a WHERE a.reviewer_id = u.id AND a.status = 'Submitted') AS assessment_count,
              (SELECT COUNT(*) FROM datasets d WHERE d.owner_id = u.id) AS dataset_count
              FROM users u ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at`).all();
            return send(res, 200, { items: rows.map((row) => ({ ...publicUser(row), assessmentCount: Number(row.assessment_count), datasetCount: Number(row.dataset_count) })) });
          }

          const adminUserMatch = pathname.match(/^\/admin\/users\/([^/]+)$/);
          if (adminUserMatch && method === "PATCH") {
            if (!requireAdmin(user, res)) return;
            const targetId = decodeURIComponent(adminUserMatch[1]);
            const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
            if (!target || target.role === "admin") return send(res, 422, { error: "Only Doctor accounts can be activated or deactivated." });
            const body = await readBody(req);
            db.prepare("UPDATE users SET active = ?, updated_at = ? WHERE id = ?").run(body.active ? 1 : 0, now(), targetId);
            audit(db, user.id, body.active ? "doctor.activated" : "doctor.deactivated", "user", targetId);
            return send(res, 200, { ok: true, active: Boolean(body.active) });
          }

          if (pathname === "/admin/feedback" && method === "GET") {
            if (!requireAdmin(user, res)) return;
            const rows = db.prepare(`SELECT f.*, u.display_name AS reviewer_name, u.email AS reviewer_email FROM platform_feedback f
              JOIN users u ON u.id = f.reviewer_id ORDER BY f.submitted_at DESC`).all();
            return send(res, 200, { items: rows.map((item) => ({ id: item.id, reviewerId: item.reviewer_id, reviewerName: item.reviewer_name,
              reviewerEmail: item.reviewer_email, topic: item.topic, clarityRating: Number(item.clarity_rating), comment: item.comment,
              page: item.page, status: item.status, submittedAt: item.submitted_at })) });
          }

          if (pathname === "/admin/aggregation/preview" && method === "POST") {
            if (!requireAdmin(user, res)) return;
            return send(res, 200, { result: previewAggregation(db, await readBody(req)) });
          }

          if (pathname === "/admin/finalizations" && method === "POST") {
            if (!requireAdmin(user, res)) return;
            return send(res, 201, { finalization: finalizeAggregation(db, user.id, await readBody(req)) });
          }

          if (pathname === "/admin/finalizations" && method === "GET") {
            if (!requireAdmin(user, res)) return;
            const rows = db.prepare(`SELECT f.*, u.display_name AS creator_name FROM finalizations f JOIN users u ON u.id = f.created_by ORDER BY f.created_at DESC`).all();
            return send(res, 200, { items: rows.map((item) => ({ id: item.id, level: item.level, targetId: item.target_id, method: item.method,
              doctorWeights: safeJson(item.doctor_weights_json, {}), dimensionWeights: safeJson(item.dimension_weights_json, {}),
              includedAssessmentIds: safeJson(item.included_assessment_ids_json, []), result: safeJson(item.result_json, {}),
              finalScore: Number(item.final_score), locked: Boolean(item.locked), creatorName: item.creator_name, createdAt: item.created_at })) });
          }

          next();
        } catch (error) {
          const status = /UNIQUE constraint failed/.test(error.message) ? 409 : 500;
          send(res, status, { error: status === 409 ? "A record with the same unique identifier already exists." : error.message });
        }
      });
    },
  };
}
