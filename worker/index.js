import { runMedicalModel } from "./model-adapter.js";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, patient_name TEXT NOT NULL, age INTEGER NOT NULL, sex TEXT NOT NULL DEFAULT 'Unspecified', condition TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'Routine', status TEXT NOT NULL DEFAULT 'Pending', visits INTEGER NOT NULL DEFAULT 1, clinical_data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, provider TEXT NOT NULL, model_version TEXT NOT NULL, prompt_version TEXT NOT NULL, status TEXT NOT NULL, output TEXT, error_message TEXT, created_at TEXT NOT NULL, completed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS assessments (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, agent_run_id TEXT NOT NULL, reviewer_id TEXT NOT NULL, rubric_version TEXT NOT NULL, scores TEXT NOT NULL, overall_score REAL NOT NULL, safety_issue TEXT NOT NULL, reason_tags TEXT NOT NULL, case_feedback TEXT NOT NULL, status TEXT NOT NULL, submitted_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS platform_feedback (id TEXT PRIMARY KEY, reviewer_id TEXT NOT NULL, topic TEXT NOT NULL, clarity_rating INTEGER NOT NULL, comment TEXT NOT NULL, page TEXT NOT NULL, platform_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'New', submitted_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS import_jobs (id TEXT PRIMARY KEY, source_name TEXT NOT NULL, format TEXT NOT NULL, total_records INTEGER NOT NULL, imported_records INTEGER NOT NULL, rejected_records INTEGER NOT NULL, status TEXT NOT NULL, errors TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_case_id ON agent_runs(case_id)`,
  `CREATE INDEX IF NOT EXISTS idx_assessments_case_id ON assessments(case_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_feedback_status ON platform_feedback(status)`,
];

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const authUser = (request) => request.headers.get("oai-authenticated-user-id") || "demo-clinician";
const modelConfig = (env) => ({ provider: env.MEDICAL_MODEL_PROVIDER || "mock", apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL || "deepseek-v4-pro", baseUrl: env.DEEPSEEK_API_URL || "https://api.deepseek.com" });

async function init(db) {
  await db.batch(schemaStatements.map((sql) => db.prepare(sql)));
  const count = await db.prepare("SELECT COUNT(*) AS count FROM cases").first();
  if (Number(count?.count || 0) > 0) return;
  const sample = sampleCase();
  await upsertCase(db, sample);
  const model = await runMedicalModel({ clinicalData: sample.clinicalData });
  await db.prepare("INSERT INTO agent_runs (id, case_id, provider, model_version, prompt_version, status, output, error_message, created_at, completed_at) VALUES (?, ?, ?, ?, ?, 'Completed', ?, NULL, ?, ?)")
    .bind("RUN-SIM-0842", sample.id, model.provider, model.modelVersion, model.promptVersion, model.output, now(), now()).run();
}

function sampleCase() {
  return { id: "SIM-2026-0842", patientName: "John Doe", age: 58, sex: "Male", condition: "T2DM · Hypertension · CKD risk", priority: "High", status: "Pending", visits: 4, clinicalData: { simulated: true, diagnoses: ["Type 2 diabetes mellitus", "Hypertension", "Dyslipidaemia", "CKD risk with albuminuria"], allergies: ["No known drug allergies"], medications: ["Metformin 1000 mg twice daily", "Lisinopril 10 mg daily", "Atorvastatin 20 mg nightly"], labs: [{ date: "2026-08-12", a1c: 7.8, egfr: 62, uacr: 38, bp: "138/84" }], summary: "Longitudinal chronic-disease review with persistent albuminuria." } };
}

async function upsertCase(db, item) {
  const timestamp = now();
  await db.prepare("INSERT INTO cases (id, patient_name, age, sex, condition, priority, status, visits, clinical_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET patient_name=excluded.patient_name, age=excluded.age, sex=excluded.sex, condition=excluded.condition, priority=excluded.priority, status=excluded.status, visits=excluded.visits, clinical_data=excluded.clinical_data, updated_at=excluded.updated_at")
    .bind(item.id, item.patientName, Number(item.age), item.sex || "Unspecified", item.condition, item.priority || "Routine", item.status || "Pending", Number(item.visits || 1), JSON.stringify(item.clinicalData || {}), timestamp, timestamp).run();
}

const mapCase = (row) => ({ id: row.id, patientName: row.patient_name, age: row.age, sex: row.sex, condition: row.condition, priority: row.priority, status: row.status, visits: row.visits, clinicalData: parse(row.clinical_data, {}), createdAt: row.created_at, updatedAt: row.updated_at });
const mapRun = (row) => row && ({ id: row.id, caseId: row.case_id, provider: row.provider, modelVersion: row.model_version, promptVersion: row.prompt_version, status: row.status, output: row.output, errorMessage: row.error_message, createdAt: row.created_at, completedAt: row.completed_at });

async function api(request, env, url) {
  if (!env.DB) return json({ error: "Persistent database binding is unavailable." }, 503);
  await init(env.DB);
  const path = url.pathname;
  if (path === "/api/v1/health" && request.method === "GET") return json({ status: "ok", database: "connected", modelAdapter: "mock" });
  if (path === "/api/v1/cases" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT * FROM cases ORDER BY updated_at DESC").all();
    return json({ items: result.results.map(mapCase) });
  }
  if (path.startsWith("/api/v1/cases/") && request.method === "GET") {
    const id = decodeURIComponent(path.split("/").pop());
    const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(id).first();
    if (!row) return json({ error: "Case not found." }, 404);
    const run = await env.DB.prepare("SELECT * FROM agent_runs WHERE case_id = ? ORDER BY created_at DESC LIMIT 1").bind(id).first();
    return json({ case: mapCase(row), agentRun: mapRun(run) });
  }
  if (path === "/api/v1/cases/import" && request.method === "POST") {
    const body = await request.json();
    const records = Array.isArray(body.records) ? body.records : [];
    const errors = [];
    let imported = 0;
    for (const [index, item] of records.entries()) {
      if (!item.id || !item.patientName || !item.age || !item.condition) { errors.push({ row: index + 1, message: "Missing id, patientName, age or condition." }); continue; }
      await upsertCase(env.DB, item); imported += 1;
    }
    const job = { id: makeId("IMP"), sourceName: body.sourceName || "Uploaded dataset", format: body.format || "JSON", totalRecords: records.length, importedRecords: imported, rejectedRecords: errors.length, status: errors.length ? (imported ? "Completed with warnings" : "Failed") : "Completed", errors, createdAt: now() };
    await env.DB.prepare("INSERT INTO import_jobs (id, source_name, format, total_records, imported_records, rejected_records, status, errors, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(job.id, job.sourceName, job.format, job.totalRecords, job.importedRecords, job.rejectedRecords, job.status, JSON.stringify(errors), job.createdAt).run();
    return json(job, imported ? 201 : 422);
  }
  if (path === "/api/v1/import-jobs" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 20").all();
    return json({ items: result.results.map((r) => ({ id:r.id, sourceName:r.source_name, format:r.format, totalRecords:r.total_records, importedRecords:r.imported_records, rejectedRecords:r.rejected_records, status:r.status, errors:parse(r.errors,[]), createdAt:r.created_at })) });
  }
  if (path === "/api/v1/agent-runs" && request.method === "POST") {
    const body = await request.json();
    const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(body.caseId).first();
    if (!row) return json({ error: "Case not found." }, 404);
    const id = makeId("RUN"); const createdAt = now();
    await env.DB.prepare("INSERT INTO agent_runs (id, case_id, provider, model_version, prompt_version, status, output, error_message, created_at, completed_at) VALUES (?, ?, 'Mock Medical Model Adapter', 'pending', 'chronic-care-review-v1', 'Analysing', NULL, NULL, ?, NULL)").bind(id, body.caseId, createdAt).run();
    try {
      const model = await runMedicalModel({ clinicalData: parse(row.clinical_data, {}), config: modelConfig(env) });
      const completedAt = now();
      await env.DB.prepare("UPDATE agent_runs SET provider=?, model_version=?, prompt_version=?, status='Completed', output=?, completed_at=? WHERE id=?").bind(model.provider, model.modelVersion, model.promptVersion, model.output, completedAt, id).run();
      return json({ id, caseId: body.caseId, status: "Completed", ...model, createdAt, completedAt }, 201);
    } catch (error) {
      await env.DB.prepare("UPDATE agent_runs SET status='Failed', error_message=? WHERE id=?").bind(String(error), id).run();
      return json({ error: "Model run failed.", runId: id }, 502);
    }
  }
  if (path === "/api/v1/assessments" && request.method === "POST") {
    const body = await request.json();
    if (!body.caseId || !body.agentRunId || !body.caseFeedback?.trim() || !Array.isArray(body.scores) || body.scores.length !== 6) return json({ error: "Assessment is incomplete." }, 422);
    const id = makeId("ASMT"); const submittedAt = now(); const overall = body.scores.reduce((a,b)=>a+Number(b),0)/body.scores.length;
    await env.DB.prepare("INSERT INTO assessments (id, case_id, agent_run_id, reviewer_id, rubric_version, scores, overall_score, safety_issue, reason_tags, case_feedback, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Complete', ?)").bind(id, body.caseId, body.agentRunId, authUser(request), "chronic-care-rubric-v1", JSON.stringify(body.scores), overall, body.safetyIssue || "No", JSON.stringify(body.reasonTags || []), body.caseFeedback.trim(), submittedAt).run();
    await env.DB.prepare("UPDATE cases SET status='Completed', updated_at=? WHERE id=?").bind(submittedAt, body.caseId).run();
    return json({ id, status: "Complete", overallScore: overall, submittedAt }, 201);
  }
  if (path === "/api/v1/assessments" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT assessments.*, cases.patient_name, cases.condition FROM assessments JOIN cases ON cases.id=assessments.case_id ORDER BY submitted_at DESC").all();
    return json({ items: result.results.map((r)=>({ id:r.id, caseId:r.case_id, patientName:r.patient_name, condition:r.condition, overallScore:r.overall_score, safetyIssue:r.safety_issue, scores:parse(r.scores,[]), reasonTags:parse(r.reason_tags,[]), caseFeedback:r.case_feedback, submittedAt:r.submitted_at })) });
  }
  if (path === "/api/v1/platform-feedback" && request.method === "POST") {
    const body = await request.json();
    if (!body.comment?.trim() || !Number(body.clarityRating)) return json({ error: "Rating and comment are required." }, 422);
    const item = { id:makeId("FDBK"), submittedAt:now() };
    await env.DB.prepare("INSERT INTO platform_feedback (id, reviewer_id, topic, clarity_rating, comment, page, platform_version, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, 'p0.1', 'New', ?)").bind(item.id, authUser(request), body.topic || "General", Number(body.clarityRating), body.comment.trim(), body.page || "unknown", item.submittedAt).run();
    return json({ ...item, status:"New" }, 201);
  }
  if (path === "/api/v1/admin/platform-feedback" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT * FROM platform_feedback ORDER BY submitted_at DESC").all();
    return json({ items: result.results.map((r)=>({ id:r.id, reviewerId:r.reviewer_id, topic:r.topic, clarityRating:r.clarity_rating, comment:r.comment, page:r.page, platformVersion:r.platform_version, status:r.status, submittedAt:r.submitted_at })) });
  }
  return json({ error: "API route not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env, url); }
      catch (error) { return json({ error: "Unexpected server error.", detail: String(error?.message || error) }, 500); }
    }
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return response;
    const indexUrl = new URL(request.url); indexUrl.pathname = "/index.html"; indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
