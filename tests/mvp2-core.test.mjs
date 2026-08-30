import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { previewAggregation, finalizeAggregation } from "../scripts/aggregation.mjs";
import { getDatabase, hashPassword, id, now, resetDatabaseForTests, verifyPassword } from "../scripts/database.mjs";
import { importDatasetBuffer } from "../scripts/dataset-importer.mjs";
import { CRITERIA } from "../scripts/domain.mjs";
import { deserializeEvidenceValidation } from "../scripts/local-api.mjs";
import { buildEvidenceCatalog, isRetryableModelError, runMedicalModel, validateEvidenceCitations } from "../worker/model-adapter.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function testRoot() {
  const root = mkdtempSync(join(tmpdir(), "ntu-mvp2-test-"));
  mkdirSync(join(root, "db"), { recursive: true });
  cpSync(join(projectRoot, "db", "schema.sql"), join(root, "db", "schema.sql"));
  return root;
}

test("passwords are salted and verified without storing plaintext", () => {
  const first = hashPassword("Doctor123!");
  const second = hashPassword("Doctor123!");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(verifyPassword("Doctor123!", first.salt, first.hash), true);
  assert.equal(verifyPassword("incorrect", first.salt, first.hash), false);
});

test("evidence catalog accepts only source measurements from visits 1-9", () => {
  const visits = Array.from({ length: 10 }, (_, index) => ({
    visit_number: index + 1,
    date: `2026-${String(index + 1).padStart(2, "0")}-01`,
    clinic_measurements: { hba1c: { value: 8.1 - index * 0.1, unit: "%" } },
  }));
  const catalog = buildEvidenceCatalog({ visits });
  assert.equal(catalog.length, 9);
  assert.equal(catalog.at(-1).id, "V9-HBA1C");
  assert.equal(catalog.some((item) => item.visitNumber === 10), false);
  const validation = validateEvidenceCitations("Improved [EVID:V1-HBA1C] but future [EVID:V10-HBA1C]", catalog);
  assert.deepEqual(validation.evidenceLinks.map((item) => item.id), ["V1-HBA1C"]);
  assert.deepEqual(validation.invalidCitations, ["V10-HBA1C"]);
});

test("run DTO evidence decoding preserves canonical and legacy evidence links", () => {
  const link = { id: "V9-SYSTOLIC-BP", visitNumber: 9 };
  assert.deepEqual(
    deserializeEvidenceValidation(JSON.stringify({ evidenceLinks: [link], invalidCitations: [] })),
    { evidenceLinks: [link], invalidCitations: [] },
  );
  assert.deepEqual(
    deserializeEvidenceValidation(JSON.stringify({ links: [link], invalidCitations: ["V10-SYSTOLIC-BP"] })),
    { evidenceLinks: [link], invalidCitations: ["V10-SYSTOLIC-BP"] },
  );
  assert.deepEqual(
    deserializeEvidenceValidation(JSON.stringify([link])),
    { evidenceLinks: [link], invalidCitations: [] },
  );
});

test("the model adapter retries transient connection failures but not authentication errors", async () => {
  assert.equal(isRetryableModelError({ cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }), true);
  assert.equal(isRetryableModelError({ status: 429 }), true);
  assert.equal(isRetryableModelError({ status: 503 }), true);
  assert.equal(isRetryableModelError({ status: 401 }), false);

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      const error = new TypeError("fetch failed");
      error.cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
      throw error;
    }
    return {
      ok: true,
      json: async () => ({ id: "retry-ok", model: "deepseek-test", choices: [{ message: { content: "## Assessment\nRecovered." } }] }),
    };
  };
  try {
    const result = await runMedicalModel({
      clinicalData: { visits: [] },
      config: { apiKey: "test", model: "deepseek-test", maxAttempts: 2, retryDelayMs: 1, timeoutMs: 1000 },
    });
    assert.equal(calls, 2);
    assert.equal(result.attempts, 2);
    assert.equal(result.output.includes("Recovered"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("run lifecycle columns are available in the real SQLite schema", () => {
  const root = testRoot();
  try {
    const db = getDatabase(root);
    const columns = new Set(db.prepare("PRAGMA table_info(agent_runs)").all().map((item) => item.name));
    for (const column of ["lifecycle_status", "stage", "stage_history_json", "evidence_links_json", "cancel_requested", "updated_at", "study_status", "output_hash", "aggregation_config_json"]) assert.equal(columns.has(column), true);
    const userColumns = new Set(db.prepare("PRAGMA table_info(users)").all().map((item) => item.name));
    assert.equal(userColumns.has("access_status"), true);
  } finally { resetDatabaseForTests(); rmSync(root, { recursive: true, force: true }); }
});

test("the supplied ZIP imports complete cases and quarantines every incomplete manifest entry", () => {
  const root = testRoot();
  try {
    const db = getDatabase(root);
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    const result = importDatasetBuffer({ db, root, ownerId: admin.id, fileName: "data500_v5_Pat1to500.zip", buffer: readFileSync(join(projectRoot, "data-source", "data500_v5_Pat1to500.zip")), name: "QA import", status: "Approved", visibility: "shared" });
    assert.equal(result.declared, 500);
    assert.equal(result.valid, 369);
    assert.equal(result.quarantined, 131);
    const issues = db.prepare("SELECT code, COUNT(*) AS count FROM dataset_issues WHERE dataset_id = ? GROUP BY code").all(result.id);
    assert.deepEqual(Object.fromEntries(issues.map((item) => [item.code, Number(item.count)])), { INVALID_JSON: 33, MISSING_PATIENT_FILE: 98 });
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM cases WHERE dataset_id = ?").get(result.id).count), 369);
  } finally { resetDatabaseForTests(); rmSync(root, { recursive: true, force: true }); }
});

test("three independent doctor scores use the Official Run preset and support immutable locking", () => {
  const root = testRoot();
  try {
    const db = getDatabase(root);
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    const datasetId = id("DATA");
    db.prepare(`INSERT INTO datasets (id,owner_id,name,source_filename,source_path,source_format,source_sha256,status,visibility,declared_count,valid_count,quarantined_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(datasetId, admin.id, "QA", "qa.json", "qa.json", "JSON", "hash", "Approved", "shared", 1, 1, 0, now());
    const caseId = id("CASE");
    db.prepare(`INSERT INTO cases (id,dataset_id,patient_id,condition_summary,conditions_json,visit_count,clinical_json,reference_visit_json,source_entry,source_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(caseId, datasetId, "QA-001", "Chronic care", "[]", 10, "{}", "{}", "patient.json", "hash", now());
    const doctors = [5, 4, 3].map((score, index) => {
      const accountId = id("USR"); const secret = hashPassword("Doctor123!");
      db.prepare(`INSERT INTO users (id,role,display_name,email,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)`).run(accountId, "doctor", `Doctor ${index + 1}`, `doctor${index + 1}@test.local`, secret.hash, secret.salt, now(), now());
      return { id: accountId, score };
    });
    const runId = id("RUN");
    db.prepare(`INSERT INTO agent_runs (id,case_id,created_by,provider,model_version,prompt_version,status,study_status,aggregation_config_json,input_snapshot_json,output,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId, caseId, doctors[0].id, "DeepSeek", "deepseek-v4-pro", "test", "Completed", "Official", '{"version":"official-preset-v1","doctorWeights":{},"dimensionWeights":{"accuracy":1,"completeness":1,"communication":1,"context":1,"instruction":1,"safety":1}}', "{}", "plan", now(), now());
    const assessmentIds = doctors.map((doctor) => {
      const assessmentId = id("ASMT");
      db.prepare(`INSERT INTO assessments (id,run_id,case_id,reviewer_id,status,overall_score,safety_issue,reason_tags_json,case_feedback,version,locked,created_at,updated_at,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,1,0,?,?,?)`).run(assessmentId, runId, caseId, doctor.id, "Submitted", doctor.score, "No", "[]", "", now(), now(), now());
      for (const criterion of CRITERIA) db.prepare(`INSERT INTO criterion_scores (id,assessment_id,criterion_key,score,feedback,tags_json,custom_tags_json) VALUES (?,?,?,?,?,?,?)`).run(id("CRIT"), assessmentId, criterion.key, doctor.score, "", "[]", "[]");
      return assessmentId;
    });
    const doctorWeights = { [doctors[0].id]: 1.5, [doctors[1].id]: 1, [doctors[2].id]: 0.5 };
    const result = previewAggregation(db, { level: "run", targetId: runId, method: "weighted", doctorWeights, includedAssessmentIds: assessmentIds });
    assert.equal(result.sampleSize, 3);
    assert.equal(result.reviewerCount, 3);
    assert.equal(result.finalScore, 4);
    const zeroExcluded = previewAggregation(db, { level: "run", targetId: runId, method: "weighted", doctorWeights: { [doctors[0].id]: 0, [doctors[1].id]: 1, [doctors[2].id]: 0 } });
    assert.equal(zeroExcluded.finalScore, 4);
    const final = finalizeAggregation(db, admin.id, { level: "run", targetId: runId, method: "weighted", doctorWeights, includedAssessmentIds: assessmentIds });
    assert.equal(final.locked, true);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM assessments WHERE locked = 1").get().count), 3);
  } finally { resetDatabaseForTests(); rmSync(root, { recursive: true, force: true }); }
});

test("finalization blocks fewer than three distinct Doctors", () => {
  const root = testRoot();
  try {
    const db = getDatabase(root);
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    const datasetId = id("DATA"); const caseId = id("CASE"); const doctorId = id("USR"); const runId = id("RUN"); const assessmentId = id("ASMT"); const secret = hashPassword("Doctor123!");
    db.prepare(`INSERT INTO datasets (id,owner_id,name,source_filename,source_path,source_format,source_sha256,status,visibility,declared_count,valid_count,quarantined_count,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(datasetId, admin.id, "QA", "qa.json", "qa.json", "JSON", "hash", "Approved", "shared", 1, 1, 0, now());
    db.prepare(`INSERT INTO cases (id,dataset_id,patient_id,condition_summary,conditions_json,visit_count,clinical_json,reference_visit_json,source_entry,source_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(caseId, datasetId, "QA-002", "Chronic care", "[]", 10, "{}", "{}", "patient.json", "hash", now());
    db.prepare(`INSERT INTO users (id,role,display_name,email,password_hash,password_salt,active,access_status,created_at,updated_at) VALUES (?,?,?,?,?,?,1,'active',?,?)`).run(doctorId, "doctor", "Doctor 1", "doctor-one@test.local", secret.hash, secret.salt, now(), now());
    db.prepare(`INSERT INTO agent_runs (id,case_id,created_by,provider,model_version,prompt_version,status,study_status,input_snapshot_json,output,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId, caseId, doctorId, "DeepSeek", "model", "test", "Completed", "Official", "{}", "plan", now(), now());
    db.prepare(`INSERT INTO assessments (id,run_id,case_id,reviewer_id,status,overall_score,safety_issue,reason_tags_json,case_feedback,version,locked,created_at,updated_at,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,1,0,?,?,?)`).run(assessmentId, runId, caseId, doctorId, "Submitted", 4, "No", "[]", "", now(), now(), now());
    for (const criterion of CRITERIA) db.prepare(`INSERT INTO criterion_scores (id,assessment_id,criterion_key,score,feedback,tags_json,custom_tags_json) VALUES (?,?,?,?,?,?,?)`).run(id("CRIT"), assessmentId, criterion.key, 4, "", "[]", "[]");
    assert.throws(() => finalizeAggregation(db, admin.id, { level: "run", targetId: runId, method: "mean", includedAssessmentIds: [assessmentId] }), /At least three distinct Doctors/);
  } finally { resetDatabaseForTests(); rmSync(root, { recursive: true, force: true }); }
});
