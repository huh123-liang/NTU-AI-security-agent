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

test("three independent doctor scores support weighted aggregation and immutable locking", () => {
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
    db.prepare(`INSERT INTO agent_runs (id,case_id,created_by,provider,model_version,prompt_version,status,input_snapshot_json,output,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(runId, caseId, doctors[0].id, "DeepSeek", "deepseek-v4-pro", "test", "Completed", "{}", "plan", now(), now());
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
    assert.equal(result.finalScore, 4.33);
    const zeroExcluded = previewAggregation(db, { level: "run", targetId: runId, method: "weighted", doctorWeights: { [doctors[0].id]: 0, [doctors[1].id]: 1, [doctors[2].id]: 0 } });
    assert.equal(zeroExcluded.finalScore, 4);
    const final = finalizeAggregation(db, admin.id, { level: "run", targetId: runId, method: "weighted", doctorWeights, includedAssessmentIds: assessmentIds });
    assert.equal(final.locked, true);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM assessments WHERE locked = 1").get().count), 3);
  } finally { resetDatabaseForTests(); rmSync(root, { recursive: true, force: true }); }
});
