import { readFileSync } from "node:fs";
import { getDatabase, publicUser, hashPassword, verifyPassword, createSession, getAuthenticatedUser, removeSession, audit, id, now, sha256, withTransaction } from "./database.mjs";
import { importDatasetBuffer, ensureBundledDataset } from "./dataset-importer.mjs";
import { createIngestionService } from "./ingestion-service.mjs";
import { previewAggregation, finalizeAggregation } from "./aggregation.mjs";
import { CRITERIA, safeJson, round } from "./domain.mjs";
import { buildEvidenceCatalog, runMedicalModel, supportedProviders, PROMPT_VERSION, validateEvidenceCitations } from "../worker/model-adapter.js";
import { assignDatasetModel, createModelConfig, createModelVersion, ensureDefaultModelConfig, listModelConfigs,
  modelConfigDto, recommendModelForDataset, resolveModelConfig, setModelStatus } from "./model-registry.mjs";

const MAX_BODY_BYTES = 40 * 1024 * 1024;
const DEFAULT_AGGREGATION_CONFIG = Object.freeze({
  version: "official-preset-v1",
  doctorWeights: {},
  dimensionWeights: Object.fromEntries(CRITERIA.map((criterion) => [criterion.key, 1])),
});

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

const caseDto = (row, includeClinical = false) => {
  const clinicalData = safeJson(row.clinical_json, {});
  return ({
  id: row.id,
  datasetId: row.dataset_id,
  datasetVersionId: row.dataset_version_id || null,
  datasetName: row.dataset_name,
  patientId: row.patient_id,
  patientName: row.patient_id,
  age: row.age,
  ageTopCoded: clinicalData.age_top_coded === true,
  sex: row.sex,
  ethnicity: row.ethnicity,
  condition: row.condition_summary,
  conditions: safeJson(row.conditions_json, []),
  visits: Number(row.visit_count),
  taskType: row.task_type || "standard_longitudinal",
  sourceEntry: row.source_entry,
  sourceSha256: row.source_sha256,
  recordType: clinicalData.synthetic === false ? "deidentified_real_world" : "synthetic",
  ...(includeClinical ? { clinicalData, referenceVisit: safeJson(row.reference_visit_json, {}) } : {}),
  });
};

export function deserializeEvidenceValidation(value) {
  const evidence = safeJson(value, { evidenceLinks: [], invalidCitations: [] });
  return {
    // `evidenceLinks` is the canonical shape written by
    // validateEvidenceCitations. Keep `links` and the early array-only shape
    // readable so runs created by older MVP2 builds remain traceable.
    evidenceLinks: Array.isArray(evidence) ? evidence : evidence.evidenceLinks || evidence.links || [],
    invalidCitations: Array.isArray(evidence) ? [] : evidence.invalidCitations || [],
  };
}

const runDto = (row, { blind = false } = {}) => {
  const evidence = deserializeEvidenceValidation(row.evidence_links_json);
  return ({
  id: row.id,
  caseId: row.case_id,
  createdBy: row.created_by,
  creatorName: row.creator_name,
  provider: blind ? "Blinded model" : row.provider,
  modelVersion: blind ? (row.anonymous_model_label || "Model A") : row.model_version,
  promptVersion: row.prompt_version,
  status: row.lifecycle_status || row.status,
  stage: row.stage || null,
  stageHistory: safeJson(row.stage_history_json, []),
  evidenceLinks: evidence.evidenceLinks,
  invalidEvidenceCitations: evidence.invalidCitations,
  cancelRequested: Boolean(row.cancel_requested),
  output: row.output,
  responseId: row.response_id,
  usage: safeJson(row.usage_json, {}),
  errorMessage: row.error_message,
  createdAt: row.created_at,
  completedAt: row.completed_at,
   assessmentCount: Number(row.assessment_count || 0),
   studyStatus: row.study_status || "Sandbox",
   outputHash: row.output_hash || null,
   aggregationConfig: safeJson(row.aggregation_config_json, {}),
   taskType: row.task_type || "standard_longitudinal",
   anonymousModelLabel: row.anonymous_model_label || "Model A",
   evaluationBatchId: row.evaluation_batch_id || null,
   ...(!blind ? { modelConfigId: row.model_config_id || null } : {}),
  });
};

export function buildTaskPlan(clinicalData) {
  const visits = Array.isArray(clinicalData?.visits) ? clinicalData.visits : [];
  if (!visits.length) throw new Error("At least one meaningful clinical record is required.");
  const allUndated = visits.every((visit) => !String(visit?.date || "").trim());
  if (allUndated) return { taskType: "undated_snapshot", modelVisits: visits.slice(-1), reference: null };
  if (visits.length === 1) return { taskType: "single_visit", modelVisits: visits, reference: null };
  const selected = visits.length >= 10 ? visits.slice(-10) : visits;
  return {
    taskType: selected.length >= 10 ? "standard_longitudinal" : "short_longitudinal",
    modelVisits: selected.slice(0, -1), reference: selected.at(-1),
  };
}

function assessmentDto(db, row, { blind = false } = {}) {
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
    modelVersion: blind ? (row.anonymous_model_label || "Model A") : row.model_version,
    promptVersion: row.prompt_version,
    studyStatus: row.study_status || "Sandbox",
    outputHash: row.output_hash || null,
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

function datasetAccessRow(db, user, datasetId, requireApproved = false) {
  const row = db.prepare("SELECT * FROM datasets WHERE id = ?").get(datasetId);
  if (!row) return null;
  if (user.role === "admin") return row;
  if (requireApproved && row.status !== "Approved") return null;
  if (row.owner_id === user.id || (row.visibility === "shared" && row.status === "Approved")) return row;
  return null;
}

function caseAccessRow(db, user, caseId) {
  const row = db.prepare(`SELECT c.*, d.name AS dataset_name, d.owner_id, d.visibility, d.status AS dataset_status
    FROM cases c JOIN datasets d ON d.id = c.dataset_id WHERE c.id = ?`).get(caseId);
  if (!row) return null;
  if (user.role === "admin" || (row.dataset_status === "Approved" && (row.owner_id === user.id || row.visibility === "shared"))) return row;
  return null;
}

function requireAdmin(user, res) {
  if (user.role !== "admin") { send(res, 403, { error: "Administrator access is required." }); return false; }
  return true;
}

function joinedAssessmentRows(db, where = "1 = 1", parameters = []) {
  const sql = `SELECT a.*, u.display_name AS reviewer_name, u.email AS reviewer_email, c.patient_id, c.dataset_id,
    d.name AS dataset_name, r.model_version, r.anonymous_model_label, r.prompt_version, r.study_status, r.output_hash, r.aggregation_config_json
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
  const adminId = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1").get()?.id;
  ensureDefaultModelConfig({ db, root, envConfig: modelConfig, adminId });
  const ingestion = createIngestionService({ db, root });
  const activeJobs = new Map();
  let bootstrapError = null;
  try { ensureBundledDataset({ db, root }); }
  catch (error) { bootstrapError = error.message; }

  const interruptedAt = now();
  const interrupted = db.prepare("SELECT id, stage_history_json FROM agent_runs WHERE status = 'Running' OR lifecycle_status = 'Running'").all();
  for (const row of interrupted) {
    const history = safeJson(row.stage_history_json, []);
    history.push({ stage: "interrupted", at: interruptedAt });
    db.prepare(`UPDATE agent_runs SET status = 'Failed', lifecycle_status = 'Interrupted', stage = 'interrupted',
      stage_history_json = ?, error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?`)
      .run(JSON.stringify(history), "Generation was interrupted because the local process stopped.", interruptedAt, interruptedAt, row.id);
    audit(db, null, "agent_run.interrupted", "agent_run", row.id);
  }

  const transitionRun = (runId, stage) => {
    const row = db.prepare("SELECT stage_history_json FROM agent_runs WHERE id = ?").get(runId);
    if (!row) return;
    const timestamp = now();
    const history = safeJson(row.stage_history_json, []);
    history.push({ stage, at: timestamp });
    db.prepare("UPDATE agent_runs SET stage = ?, stage_history_json = ?, updated_at = ? WHERE id = ?")
      .run(stage, JSON.stringify(history), timestamp, runId);
  };

  const runIsCancelled = (runId) => Boolean(db.prepare("SELECT cancel_requested FROM agent_runs WHERE id = ?").get(runId)?.cancel_requested);

  const executeRun = async (runId) => {
    const controller = new AbortController();
    activeJobs.set(runId, controller);
    try {
      const row = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId);
      if (!row || runIsCancelled(runId)) return;
      const clinicalData = safeJson(row.input_snapshot_json, {});
      const evidenceCatalog = buildEvidenceCatalog(clinicalData);
      transitionRun(runId, "calling_model");
      const selectedModel = resolveModelConfig({ db, root, modelConfigId: row.model_config_id });
      const model = await runMedicalModel({ clinicalData, evidenceCatalog, config: { ...selectedModel, taskType: row.task_type }, signal: controller.signal });
      if (modelConfig.runtime) modelConfig.runtime.modelConnectivity = {
        ...modelConfig.runtime.modelConnectivity,
        status: "reachable",
        code: null,
        source: "model_request",
        checkedAt: now(),
      };
      if (runIsCancelled(runId)) return;
      transitionRun(runId, "processing_response");
      const validation = validateEvidenceCitations(model.output, evidenceCatalog);
      transitionRun(runId, "validating_evidence");
      if (runIsCancelled(runId)) return;
      transitionRun(runId, "saving");
      const completedAt = now();
      const history = safeJson(db.prepare("SELECT stage_history_json FROM agent_runs WHERE id = ?").get(runId)?.stage_history_json, []);
      history.push({ stage: "completed", at: completedAt });
      withTransaction(db, () => {
        if (row.study_status === "Official pending") {
          db.prepare(`UPDATE agent_runs SET study_status = 'Archived', updated_at = ? WHERE case_id = ? AND model_config_id = ?
            AND task_type = ? AND study_status = 'Official'`).run(completedAt, row.case_id, row.model_config_id, row.task_type);
        }
        db.prepare(`UPDATE agent_runs SET provider = ?, model_version = ?, prompt_version = ?, status = 'Completed', lifecycle_status = 'Completed',
          stage = 'completed', stage_history_json = ?, output = ?, response_id = ?, usage_json = ?, evidence_links_json = ?, output_hash = ?,
          study_status = CASE WHEN study_status = 'Official pending' THEN 'Official' ELSE study_status END,
          aggregation_config_json = CASE WHEN study_status = 'Official pending' THEN ? ELSE aggregation_config_json END,
          error_message = NULL, updated_at = ?, completed_at = ? WHERE id = ?`)
          .run(model.provider, model.modelVersion, model.promptVersion, JSON.stringify(history), model.output, model.responseId,
            JSON.stringify(model.usage || {}), JSON.stringify(validation), sha256(model.output), JSON.stringify(DEFAULT_AGGREGATION_CONFIG), completedAt, completedAt, runId);
      });
      if (row.evaluation_batch_id) db.prepare("UPDATE evaluation_batches SET status='Ready' WHERE id=?").run(row.evaluation_batch_id);
      audit(db, row.created_by, "agent_run.completed", "agent_run", runId, {
        caseId: row.case_id, provider: model.provider, modelVersion: model.modelVersion,
        verifiedEvidenceCount: validation.evidenceLinks.length, invalidEvidenceCitations: validation.invalidCitations,
      });
    } catch (error) {
      if (runIsCancelled(runId) || error?.name === "RunCancelledError") return;
      if (modelConfig.runtime && error?.networkFailure) modelConfig.runtime.modelConnectivity = {
        ...modelConfig.runtime.modelConnectivity,
        status: "blocked",
        code: error.code || "NETWORK_ERROR",
        source: "model_request",
        checkedAt: now(),
      };
      const failedAt = now();
      const history = safeJson(db.prepare("SELECT stage_history_json FROM agent_runs WHERE id = ?").get(runId)?.stage_history_json, []);
      history.push({ stage: "failed", at: failedAt });
      db.prepare(`UPDATE agent_runs SET status = 'Failed', lifecycle_status = 'Failed', stage = 'failed', stage_history_json = ?,
        study_status = CASE WHEN study_status = 'Official pending' THEN 'Official failed' ELSE study_status END,
        error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?`)
        .run(JSON.stringify(history), error.message, failedAt, failedAt, runId);
      const failedRun = db.prepare("SELECT evaluation_batch_id FROM agent_runs WHERE id=?").get(runId);
      if (failedRun?.evaluation_batch_id) db.prepare("UPDATE evaluation_batches SET status='Failed' WHERE id=?").run(failedRun.evaluation_batch_id);
      const row = db.prepare("SELECT case_id, created_by FROM agent_runs WHERE id = ?").get(runId);
      audit(db, row?.created_by, "agent_run.failed", "agent_run", runId, { caseId: row?.case_id, error: error.message });
    } finally {
      activeJobs.delete(runId);
    }
  };

  const createRun = (selectedCase, userId, { official = false, modelConfigId = null } = {}) => {
    const fullClinical = safeJson(selectedCase.clinical_json, {});
    const plan = buildTaskPlan(fullClinical);
    const selectedModel = resolveModelConfig({ db, root, modelConfigId, datasetId: selectedCase.dataset_id });
    const inputSnapshot = { ...fullClinical, visits: plan.modelVisits,
      evaluationTask: plan.taskType,
      withheldReference: plan.reference ? { visitNumber: plan.reference.visit_number, date: plan.reference.date } : null };
    const runId = id("RUN");
    const batchId = id("BAT");
    const startedAt = now();
    const history = [{ stage: "preparing_data", at: startedAt }];
    const snapshotJson = JSON.stringify(inputSnapshot);
    withTransaction(db, () => {
    db.prepare(`INSERT INTO agent_runs (id, case_id, created_by, provider, model_version, prompt_version, status, lifecycle_status,
      stage, stage_history_json, evidence_links_json, cancel_requested, study_status, aggregation_config_json, input_snapshot_json,
      dataset_version_id, case_snapshot_hash, model_config_id, task_type, anonymous_model_label, evaluation_batch_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'Running', 'Running', 'preparing_data', ?, '{}', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(runId, selectedCase.id, userId, selectedModel.provider, selectedModel.modelId, PROMPT_VERSION,
        JSON.stringify(history), official ? "Official pending" : "Sandbox", JSON.stringify(DEFAULT_AGGREGATION_CONFIG), snapshotJson,
        selectedCase.dataset_version_id || null, sha256(snapshotJson), selectedModel.id, plan.taskType, selectedModel.anonymousName, batchId, startedAt, startedAt);
    db.prepare(`INSERT INTO evaluation_batches (id,dataset_version_id,case_id,task_type,model_config_id,model_config_version,prompt_version,
      anonymous_model_label,run_id,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,'Pending',?,?)`)
      .run(batchId, selectedCase.dataset_version_id || null, selectedCase.id, plan.taskType, selectedModel.id, selectedModel.version,
        PROMPT_VERSION, selectedModel.anonymousName, runId, userId, startedAt);
    });
    audit(db, userId, official ? "official_run.started" : "agent_run.started", "agent_run", runId,
      { caseId: selectedCase.id, modelConfigId: selectedModel.id, taskType: plan.taskType, evaluationBatchId: batchId });
    setImmediate(() => executeRun(runId));
    return db.prepare(`SELECT r.*, u.display_name AS creator_name, 0 AS assessment_count
      FROM agent_runs r JOIN users u ON u.id = r.created_by WHERE r.id = ?`).get(runId);
  };

  return {
    name: "ntu-local-sql-api",
    configureServer(server) {
      server.middlewares.use("/api/v1", async (req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://local");
          const pathname = url.pathname;
          const method = req.method || "GET";

          if (pathname === "/health" && method === "GET") {
            const activeModels = Number(db.prepare("SELECT COUNT(*) AS count FROM model_configs WHERE status='active'").get()?.count || 0);
            const configuredModels = Number(db.prepare("SELECT COUNT(*) AS count FROM model_configs WHERE status='active' AND api_key_encrypted IS NOT NULL").get()?.count || 0);
            return send(res, 200, {
              status: bootstrapError ? "degraded" : "ok",
              database: "SQLite",
              databaseFile: ".data/platform.db",
              modelProvider: "registry",
              modelConfigured: configuredModels > 0,
              activeModels,
              supportedProviders: supportedProviders(),
              runtime: modelConfig.runtime || null,
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
            db.prepare(`INSERT INTO users (id, display_name, email, password_hash, password_salt, role, active, access_status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'doctor', 1, 'active', ?, ?)`)
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
            if (!row || !row.active || row.access_status === "deactivated" || !verifyPassword(String(body.password || ""), row.password_salt, row.password_hash)) return send(res, 401, { error: "Email or password is incorrect." });
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

          if (pathname === "/admin/models" && method === "GET") {
            if (!requireAdmin(user, res)) return;
            return send(res, 200, { items: listModelConfigs(db), supportedProviders: supportedProviders() });
          }
          if (pathname === "/admin/models" && method === "POST") {
            if (!requireAdmin(user, res)) return;
            const created = createModelConfig({ db, root, input: await readBody(req), actorId: user.id });
            audit(db, user.id, "model_config.created", "model_config", created.id, { provider: created.provider, modelId: created.modelId });
            return send(res, 201, { model: created });
          }
          const modelVersionMatch = pathname.match(/^\/admin\/models\/([^/]+)\/versions$/);
          if (modelVersionMatch && method === "POST") {
            if (!requireAdmin(user, res)) return;
            const created = createModelVersion({ db, root, modelId: decodeURIComponent(modelVersionMatch[1]), input: await readBody(req), actorId: user.id });
            audit(db, user.id, "model_config.version_created", "model_config", created.id, { familyId: created.familyId, version: created.version });
            return send(res, 201, { model: created });
          }
          const modelStatusMatch = pathname.match(/^\/admin\/models\/([^/]+)\/status$/);
          if (modelStatusMatch && method === "PATCH") {
            if (!requireAdmin(user, res)) return;
            const updated = setModelStatus(db, decodeURIComponent(modelStatusMatch[1]), await readBody(req));
            audit(db, user.id, "model_config.status_changed", "model_config", updated.id, { status: updated.status, isDefault: updated.isDefault });
            return send(res, 200, { model: updated });
          }
          const modelTestMatch = pathname.match(/^\/admin\/models\/([^/]+)\/test$/);
          if (modelTestMatch && method === "POST") {
            if (!requireAdmin(user, res)) return;
            const selected = resolveModelConfig({ db, root, modelConfigId: decodeURIComponent(modelTestMatch[1]) });
            const clinicalData = { synthetic: true, visits: [{ visit_number: 1, date: null, clinic_measurements: { pulse: { value: 72, unit: "bpm", observed: true } } }] };
            const result = await runMedicalModel({ clinicalData, config: { ...selected, taskType: "undated_snapshot", maxTokens: Math.min(256, selected.maxTokens) } });
            audit(db, user.id, "model_config.connection_tested", "model_config", selected.id, { provider: selected.provider, modelId: selected.modelId });
            return send(res, 200, { ok: true, provider: result.provider, modelVersion: result.modelVersion });
          }

          if (pathname === "/dashboard" && method === "GET") {
            if (user.role === "admin") {
              const metric = (sql) => Number(db.prepare(sql).get().count);
              return send(res, 200, { metrics: {
                doctors: metric("SELECT COUNT(*) AS count FROM users WHERE role = 'doctor'"),
                activeDoctors: metric("SELECT COUNT(*) AS count FROM users WHERE role = 'doctor' AND active = 1 AND access_status = 'active'"),
                datasets: metric("SELECT COUNT(*) AS count FROM datasets"),
                validCases: metric("SELECT COUNT(*) AS count FROM cases"),
                responseRuns: metric("SELECT COUNT(*) AS count FROM agent_runs WHERE status = 'Completed'"),
                submittedAssessments: metric("SELECT COUNT(*) AS count FROM assessments WHERE status = 'Submitted'"),
                pendingDatasets: metric("SELECT COUNT(*) AS count FROM datasets WHERE status = 'Pending Review'"),
                newFeedback: metric("SELECT COUNT(*) AS count FROM platform_feedback WHERE status = 'New'"),
              } });
            }
            const row = db.prepare(`SELECT
              (SELECT COUNT(*) FROM datasets d WHERE d.visibility = 'shared' AND d.status = 'Approved') AS datasets,
              (SELECT COUNT(*) FROM cases c JOIN datasets d ON d.id = c.dataset_id WHERE d.visibility = 'shared' AND d.status = 'Approved') AS cases,
              (SELECT COUNT(*) FROM agent_runs WHERE case_id IN (SELECT c.id FROM cases c JOIN datasets d ON d.id = c.dataset_id WHERE d.visibility = 'shared' AND d.status = 'Approved') AND study_status = 'Official') AS runs,
              (SELECT COUNT(*) FROM assessments WHERE reviewer_id = ? AND status = 'Submitted') AS submitted`).get(user.id);
            return send(res, 200, { metrics: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])) });
          }

          if (pathname === "/datasets" && method === "GET") {
            const rows = user.role === "admin"
              ? db.prepare(`SELECT d.*, u.display_name AS owner_name FROM datasets d JOIN users u ON u.id = d.owner_id ORDER BY d.created_at DESC`).all()
               : db.prepare(`SELECT d.*, u.display_name AS owner_name FROM datasets d JOIN users u ON u.id = d.owner_id
                   WHERE d.visibility = 'shared' AND d.status = 'Approved' ORDER BY d.created_at DESC`).all();
            return send(res, 200, { items: rows.map(datasetDto) });
          }

          if (pathname === "/ingestion/jobs" && method === "GET") {
            return send(res, 200, { items: ingestion.list(user) });
          }

          if (pathname === "/ingestion/jobs" && method === "POST") {
            return send(res, 201, { job: ingestion.create(user, await readBody(req)) });
          }

          const ingestionJobMatch = pathname.match(/^\/ingestion\/jobs\/([^/]+)$/);
          if (ingestionJobMatch && method === "GET") {
            const job = ingestion.get(user, decodeURIComponent(ingestionJobMatch[1]));
            return job ? send(res, 200, { job }) : send(res, 404, { error: "Ingestion job not found or not available to this account." });
          }

          const ingestionChunkMatch = pathname.match(/^\/ingestion\/jobs\/([^/]+)\/chunks$/);
          if (ingestionChunkMatch && method === "POST") {
            const offset = Number(req.headers["x-upload-offset"] || 0);
            const result = await ingestion.appendChunk(user, decodeURIComponent(ingestionChunkMatch[1]), req, offset);
            return result?.error === "not_found" ? send(res, 404, { error: "Ingestion job not found." }) : send(res, 200, result);
          }

          const ingestionCompleteMatch = pathname.match(/^\/ingestion\/jobs\/([^/]+)\/complete$/);
          if (ingestionCompleteMatch && method === "POST") {
            const job = await ingestion.complete(user, decodeURIComponent(ingestionCompleteMatch[1]));
            return job ? send(res, 200, { job }) : send(res, 404, { error: "Ingestion job not found." });
          }

          const ingestionCancelMatch = pathname.match(/^\/ingestion\/jobs\/([^/]+)\/cancel$/);
          if (ingestionCancelMatch && method === "POST") {
            const job = ingestion.cancel(user, decodeURIComponent(ingestionCancelMatch[1]));
            return job ? send(res, 200, { job }) : send(res, 404, { error: "Ingestion job not found." });
          }

          const ingestionRetryMatch = pathname.match(/^\/ingestion\/jobs\/([^/]+)\/retry$/);
          if (ingestionRetryMatch && method === "POST") {
            const job = ingestion.retry(user, decodeURIComponent(ingestionRetryMatch[1]));
            return job ? send(res, 200, { job }) : send(res, 404, { error: "Ingestion job not found." });
          }

          const ingestionMappingMatch = pathname.match(/^\/admin\/ingestion\/jobs\/([^/]+)\/mapping$/);
          if (ingestionMappingMatch && method === "PUT") {
            const job = ingestion.saveMapping(user, decodeURIComponent(ingestionMappingMatch[1]), (await readBody(req)).mapping);
            return job ? send(res, 200, { job }) : send(res, 404, { error: "Ingestion job not found." });
          }

          const ingestionProcessMatch = pathname.match(/^\/admin\/ingestion\/jobs\/([^/]+)\/process$/);
          if (ingestionProcessMatch && method === "POST") {
            const job = ingestion.process(user, decodeURIComponent(ingestionProcessMatch[1]), (await readBody(req)).rules || {});
            return job ? send(res, 202, { job }) : send(res, 404, { error: "Ingestion job not found." });
          }

          const ingestionApprovalMatch = pathname.match(/^\/admin\/ingestion\/jobs\/([^/]+)\/approval$/);
          if (ingestionApprovalMatch && method === "POST") {
            const job = ingestion.approve(user, decodeURIComponent(ingestionApprovalMatch[1]), await readBody(req));
            return job ? send(res, 200, { job }) : send(res, 404, { error: "Ingestion job not found." });
          }

          if (pathname === "/datasets/import" && method === "POST") {
            if (!requireAdmin(user, res)) return;
            const body = await readBody(req);
            const fileName = String(body.fileName || "");
            const encoded = String(body.contentBase64 || "");
            if (!fileName || !encoded) return send(res, 422, { error: "Dataset file and filename are required." });
            const result = importDatasetBuffer({
              db, root, ownerId: user.id, fileName, buffer: Buffer.from(encoded, "base64"),
              name: String(body.name || fileName).trim(), description: String(body.description || "").trim(),
              status: "Pending Review",
              visibility: "private",
            });
            return send(res, 201, result);
          }

          const datasetMatch = pathname.match(/^\/datasets\/([^/]+)$/);
          if (datasetMatch && method === "GET") {
            const dataset = datasetAccessRow(db, user, decodeURIComponent(datasetMatch[1]));
            if (!dataset) return send(res, 404, { error: "Dataset not found or not available to this account." });
            const owner = db.prepare("SELECT display_name AS owner_name FROM users WHERE id = ?").get(dataset.owner_id);
            const versions = db.prepare(`SELECT id,version_number,status,source_sha256,quality_json,created_at,approved_at
              FROM dataset_versions WHERE dataset_id=? ORDER BY version_number DESC`).all(dataset.id).map((item) => ({
                id: item.id, versionNumber: Number(item.version_number), status: item.status, sourceSha256: item.source_sha256,
                quality: safeJson(item.quality_json, {}), createdAt: item.created_at, approvedAt: item.approved_at,
              }));
            const issues = db.prepare("SELECT * FROM dataset_issues WHERE dataset_id = ? ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, patient_id LIMIT 250").all(dataset.id)
              .map((item) => ({ id: item.id, patientId: item.patient_id, severity: item.severity, code: item.code, message: item.message, details: safeJson(item.details_json, {}) }));
            return send(res, 200, { dataset: datasetDto({ ...dataset, ...owner }), versions, issues });
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
            const version = db.prepare("SELECT id, ingestion_job_id FROM dataset_versions WHERE dataset_id=? ORDER BY version_number DESC LIMIT 1").get(datasetId);
            if (version) {
              const reviewedAt = now();
              db.prepare("UPDATE dataset_versions SET status=?, approved_by=?, approved_at=? WHERE id=?")
                .run(status, user.id, reviewedAt, version.id);
              if (version.ingestion_job_id) db.prepare("UPDATE ingestion_jobs SET status=?, stage=?, updated_at=? WHERE id=?")
                .run(status, status === "Approved" ? "approved" : status === "Rejected" ? "rejected" : "quality_review", reviewedAt, version.ingestion_job_id);
            }
            audit(db, user.id, "dataset.reviewed", "dataset", datasetId, { status, visibility });
            return send(res, 200, { ok: true, status, visibility });
          }

          const datasetModelMatch = pathname.match(/^\/admin\/datasets\/([^/]+)\/model-assignment$/);
          if (datasetModelMatch && method === "GET") {
            if (!requireAdmin(user, res)) return;
            const datasetId = decodeURIComponent(datasetModelMatch[1]);
            const assigned = db.prepare(`SELECT m.* FROM dataset_model_assignments a JOIN model_configs m ON m.id=a.model_config_id WHERE a.dataset_id=?`).get(datasetId);
            return send(res, 200, { assigned: modelConfigDto(assigned), recommendation: recommendModelForDataset(db, datasetId) });
          }
          if (datasetModelMatch && method === "PUT") {
            if (!requireAdmin(user, res)) return;
            const datasetId = decodeURIComponent(datasetModelMatch[1]);
            const body = await readBody(req);
            if (!String(body.modelConfigId || "")) return send(res, 422, { error: "Select an active model configuration." });
            const recommendation = recommendModelForDataset(db, datasetId);
            const assigned = assignDatasetModel(db, datasetId, String(body.modelConfigId || ""), user.id, recommendation);
            audit(db, user.id, "dataset.model_assigned", "dataset", datasetId, { modelConfigId: assigned.id });
            return send(res, 200, { assigned, recommendation });
          }

          const datasetCasesMatch = pathname.match(/^\/datasets\/([^/]+)\/cases$/);
          if (datasetCasesMatch && method === "GET") {
            const datasetId = decodeURIComponent(datasetCasesMatch[1]);
            const dataset = datasetAccessRow(db, user, datasetId, true);
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
          if (pathname === "/admin/official-runs" && method === "GET") {
            if (!requireAdmin(user, res)) return;
            const datasetId = String(url.searchParams.get("datasetId") || "");
            const modelConfigId = String(url.searchParams.get("modelConfigId") || "");
            const search = `%${String(url.searchParams.get("search") || "").trim()}%`;
            const rows = db.prepare(`SELECT c.*, d.name AS dataset_name, r.id AS run_id, r.status AS run_status, r.lifecycle_status,
              r.study_status, r.model_version, r.prompt_version, r.output_hash, r.created_at AS run_created_at,
              r.model_config_id, r.task_type, r.anonymous_model_label, r.evaluation_batch_id,
              (SELECT COUNT(DISTINCT a.reviewer_id) FROM assessments a WHERE a.run_id = r.id AND a.status = 'Submitted') AS submitted_doctors
              FROM cases c JOIN datasets d ON d.id = c.dataset_id
              LEFT JOIN agent_runs r ON r.id = (SELECT r2.id FROM agent_runs r2 WHERE r2.case_id = c.id
                AND r2.study_status IN ('Official', 'Official pending', 'Official failed') AND (? = '' OR r2.model_config_id = ?)
                ORDER BY CASE r2.study_status WHEN 'Official' THEN 0 WHEN 'Official pending' THEN 1 ELSE 2 END, r2.created_at DESC LIMIT 1)
              WHERE d.status = 'Approved' AND (? = '' OR c.dataset_id = ?) AND (c.patient_id LIKE ? OR c.condition_summary LIKE ?)
              ORDER BY c.patient_id LIMIT 100`).all(modelConfigId, modelConfigId, datasetId, datasetId, search, search);
            return send(res, 200, { items: rows.map((row) => ({
              ...caseDto(row), officialRun: row.run_id ? {
                id: row.run_id, status: row.lifecycle_status || row.run_status, studyStatus: row.study_status,
                 modelVersion: row.model_version, promptVersion: row.prompt_version, outputHash: row.output_hash,
                 modelConfigId: row.model_config_id, taskType: row.task_type, anonymousModelLabel: row.anonymous_model_label,
                 evaluationBatchId: row.evaluation_batch_id,
                createdAt: row.run_created_at, submittedDoctors: Number(row.submitted_doctors || 0),
              } : null,
            })) });
          }
          if (caseMatch && method === "GET") {
            const row = caseAccessRow(db, user, decodeURIComponent(caseMatch[1]));
            if (!row) return send(res, 404, { error: "Case not found or not available to this account." });
            return send(res, 200, { case: caseDto(row, true) });
          }

          const caseLineageMatch = pathname.match(/^\/cases\/([^/]+)\/lineage$/);
          if (caseLineageMatch && method === "GET") {
            const caseId = decodeURIComponent(caseLineageMatch[1]);
            if (!caseAccessRow(db, user, caseId)) return send(res, 404, { error: "Case not found or not available to this account." });
            const rows = db.prepare(`SELECT canonical_path,source_file,source_row,source_column,original_json,transformed_json,rule_json
              FROM record_lineage WHERE case_id=? ORDER BY canonical_path`).all(caseId);
            return send(res, 200, { items: rows.map((item) => ({ canonicalPath: item.canonical_path, sourceFile: item.source_file,
              sourceRow: item.source_row, sourceColumn: item.source_column, original: safeJson(item.original_json),
              transformed: safeJson(item.transformed_json), rule: safeJson(item.rule_json) })) });
          }

          const officialRunMatch = pathname.match(/^\/admin\/cases\/([^/]+)\/official-run$/);
          if (officialRunMatch && method === "POST") {
            if (!requireAdmin(user, res)) return;
            const caseId = decodeURIComponent(officialRunMatch[1]);
            const selectedCase = caseAccessRow(db, user, caseId);
            if (!selectedCase) return send(res, 404, { error: "Case not found." });
            if (selectedCase.dataset_status !== "Approved") return send(res, 409, { error: "The processed dataset version must be approved before an Official Run can be generated." });
            const body = await readBody(req);
            try { return send(res, 202, { run: runDto(createRun(selectedCase, user.id, { official: true, modelConfigId: body.modelConfigId || null })) }); }
            catch (error) { return send(res, 422, { error: error.message }); }
          }

          const caseRunsMatch = pathname.match(/^\/cases\/([^/]+)\/runs$/);
          if (caseRunsMatch && method === "GET") {
            const caseId = decodeURIComponent(caseRunsMatch[1]);
            if (!caseAccessRow(db, user, caseId)) return send(res, 404, { error: "Case not found or not available to this account." });
            const rows = db.prepare(`SELECT r.*, u.display_name AS creator_name,
              (SELECT COUNT(*) FROM assessments a WHERE a.run_id = r.id AND a.status = 'Submitted') AS assessment_count
              FROM agent_runs r JOIN users u ON u.id = r.created_by WHERE r.case_id = ? ${user.role === "admin" ? "" : "AND r.study_status = 'Official'"} ORDER BY r.created_at DESC`).all(caseId);
            return send(res, 200, { items: rows.map((row) => runDto(row, { blind: user.role === "doctor" })) });
          }

          if (caseRunsMatch && method === "POST") {
            const caseId = decodeURIComponent(caseRunsMatch[1]);
            if (!requireAdmin(user, res)) return;
            const selectedCase = caseAccessRow(db, user, caseId);
            if (!selectedCase) return send(res, 404, { error: "Case not found or not available to this account." });
            if (selectedCase.dataset_status !== "Approved") return send(res, 409, { error: "The processed dataset version must be approved before an Official Run can be generated." });
            try {
              const body = await readBody(req);
              return send(res, 202, runDto(createRun(selectedCase, user.id, { official: true, modelConfigId: body.modelConfigId || null })));
            } catch (error) {
              return send(res, 422, { error: error.message });
            }
          }

          const runCancelMatch = pathname.match(/^\/runs\/([^/]+)\/cancel$/);
          if (runCancelMatch && method === "POST") {
            const runId = decodeURIComponent(runCancelMatch[1]);
            const row = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId);
            if (!row || !caseAccessRow(db, user, row.case_id)) return send(res, 404, { error: "Response run not found." });
            if (!requireAdmin(user, res)) return;
            if ((row.lifecycle_status || row.status) !== "Running") return send(res, 409, { error: "Only a running generation can be cancelled." });
            const cancelledAt = now();
            const history = safeJson(row.stage_history_json, []);
            history.push({ stage: "cancelled", at: cancelledAt });
            db.prepare(`UPDATE agent_runs SET status = 'Failed', lifecycle_status = 'Cancelled', stage = 'cancelled', cancel_requested = 1,
              study_status = CASE WHEN study_status = 'Official pending' THEN 'Official failed' ELSE study_status END,
              stage_history_json = ?, error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?`)
              .run(JSON.stringify(history), "Cancelled by user.", cancelledAt, cancelledAt, runId);
            activeJobs.get(runId)?.abort(new Error("Cancelled by user."));
            audit(db, user.id, "agent_run.cancelled", "agent_run", runId, { caseId: row.case_id });
            const updated = db.prepare(`SELECT r.*, u.display_name AS creator_name, 0 AS assessment_count
              FROM agent_runs r JOIN users u ON u.id = r.created_by WHERE r.id = ?`).get(runId);
            return send(res, 200, { run: runDto(updated) });
          }

          const runRetryMatch = pathname.match(/^\/runs\/([^/]+)\/retry$/);
          if (runRetryMatch && method === "POST") {
            if (!requireAdmin(user, res)) return;
            const original = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(decodeURIComponent(runRetryMatch[1]));
            if (!original) return send(res, 404, { error: "Response run not found." });
            const selectedCase = caseAccessRow(db, user, original.case_id);
            if (!selectedCase) return send(res, 404, { error: "Response run not found." });
            try { return send(res, 202, runDto(createRun(selectedCase, user.id, { official: true, modelConfigId: original.model_config_id || null }))); }
            catch (error) { return send(res, 422, { error: error.message }); }
          }

          const runMatch = pathname.match(/^\/runs\/([^/]+)$/);
          if (runMatch && method === "GET") {
            const row = db.prepare(`SELECT r.*, u.display_name AS creator_name,
              (SELECT COUNT(*) FROM assessments a WHERE a.run_id = r.id AND a.status = 'Submitted') AS assessment_count
              FROM agent_runs r JOIN users u ON u.id = r.created_by WHERE r.id = ?`).get(decodeURIComponent(runMatch[1]));
            if (!row || !caseAccessRow(db, user, row.case_id) || (user.role === "doctor" && row.study_status !== "Official")) return send(res, 404, { error: "Official response run not found." });
            return send(res, 200, { run: runDto(row, { blind: user.role === "doctor" }) });
          }

          const runAssessmentMatch = pathname.match(/^\/runs\/([^/]+)\/assessment$/);
          if (runAssessmentMatch && method === "GET") {
            const runId = decodeURIComponent(runAssessmentMatch[1]);
            const run = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId);
            if (!run || !caseAccessRow(db, user, run.case_id) || (user.role === "doctor" && run.study_status !== "Official")) return send(res, 404, { error: "Official response run not found." });
            if (user.role === "admin") {
              const rows = joinedAssessmentRows(db, "a.run_id = ?", [runId]);
              return send(res, 200, { items: rows.map((row) => assessmentDto(db, row)) });
            }
            const row = joinedAssessmentRows(db, "a.run_id = ? AND a.reviewer_id = ?", [runId, user.id])[0];
            return send(res, 200, { assessment: row ? assessmentDto(db, row, { blind: true }) : null });
          }

          if (runAssessmentMatch && method === "PUT") {
            if (user.role !== "doctor") return send(res, 403, { error: "Only Doctor accounts can create assessments." });
            if (user.accessStatus === "scoring_suspended") return send(res, 403, { error: "This account is scoring suspended. Your assessment history remains readable." });
            const runId = decodeURIComponent(runAssessmentMatch[1]);
            const run = db.prepare("SELECT * FROM agent_runs WHERE id = ? AND status = 'Completed' AND study_status = 'Official'").get(runId);
            if (!run || !caseAccessRow(db, user, run.case_id)) return send(res, 404, { error: "The current Official Run was not found." });
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
            return send(res, existing ? 200 : 201, { assessment: assessmentDto(db, row, { blind: true }) });
          }

          if (pathname === "/assessments" && method === "GET") {
            const rows = user.role === "admin" ? joinedAssessmentRows(db) : joinedAssessmentRows(db, "a.reviewer_id = ? AND r.study_status = 'Official'", [user.id]);
            return send(res, 200, { items: rows.map((row) => assessmentDto(db, row, { blind: user.role === "doctor" })) });
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
            if (!target || target.role === "admin") return send(res, 422, { error: "Only Doctor accounts can be updated." });
            const body = await readBody(req);
            const accessStatus = ["active", "scoring_suspended", "deactivated"].includes(body.accessStatus)
              ? body.accessStatus : (body.active ? "active" : "deactivated");
            const active = accessStatus === "deactivated" ? 0 : 1;
            db.prepare("UPDATE users SET active = ?, access_status = ?, updated_at = ? WHERE id = ?").run(active, accessStatus, now(), targetId);
            audit(db, user.id, `doctor.${accessStatus}`, "user", targetId);
            return send(res, 200, { ok: true, active: Boolean(active), accessStatus });
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
          const status = Number(error.status) || (/UNIQUE constraint failed/.test(error.message) ? 409 : 500);
          send(res, status, { error: status === 409 ? "A record with the same unique identifier already exists." : error.message });
        }
      });
    },
  };
}
