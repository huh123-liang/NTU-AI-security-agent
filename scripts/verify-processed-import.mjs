#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { importProcessedDirectory } from "./dataset-importer.mjs";
import { hashPassword, sha256 } from "./database.mjs";
import { buildTaskPlan } from "./local-api.mjs";
import { buildClinicalPrompt, buildEvidenceCatalog } from "../worker/model-adapter.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const processedPath = path.resolve(process.argv[2] || "");
const sourcePath = path.resolve(process.argv[3] || "");
const databasePath = path.resolve(process.argv[4] || path.join(root, ".data", "validation", "platform-import-test.db"));
const validationRoot = `${path.resolve(root, ".data", "validation")}${path.sep}`;

if (!processedPath || !existsSync(path.join(processedPath, "manifest.csv"))) throw new Error("Processed directory with manifest.csv is required.");
if (!sourcePath || !existsSync(sourcePath)) throw new Error("Source ZIP is required.");
if (!databasePath.startsWith(validationRoot)) throw new Error("Validation database must stay inside .data/validation.");

mkdirSync(path.dirname(databasePath), { recursive: true });
if (existsSync(databasePath)) rmSync(databasePath);
const db = new DatabaseSync(databasePath);
try {
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(readFileSync(path.join(root, "db", "schema.sql"), "utf8"));
  // The live service applies this backward-compatible runtime migration in
  // scripts/database.mjs. Mirror it here so the isolated validation database
  // has the same effective schema as the running platform.
  if (!db.prepare("PRAGMA table_info(cases)").all().some((column) => column.name === "dataset_version_id")) {
    db.exec("ALTER TABLE cases ADD COLUMN dataset_version_id TEXT");
  }
  const timestamp = new Date().toISOString();
  const credentials = hashPassword("validation-only");
  db.prepare(`INSERT INTO users (id, display_name, email, password_hash, password_salt, role, active, access_status, created_at, updated_at)
    VALUES ('USR-VALIDATION-ADMIN', 'Validation Administrator', 'validation-admin@local.invalid', ?, ?, 'admin', 1, 'active', ?, ?)`)
    .run(credentials.hash, credentials.salt, timestamp, timestamp);
  const quality = JSON.parse(readFileSync(path.join(processedPath, "quality.json"), "utf8"));
  const mapping = JSON.parse(readFileSync(path.join(root, ".data", "validation", "mimic-hosp-corrected-mapping.json"), "utf8"));
  const result = importProcessedDirectory({
    db,
    ownerId: "USR-VALIDATION-ADMIN",
    name: "MIMIC HOSP platform validation pilot",
    description: "Local compatibility test only",
    sourceFileName: path.basename(sourcePath),
    sourcePath,
    sourceHash: sha256(readFileSync(sourcePath)),
    processedPath,
    ingestionJobId: null,
    mapping,
    rules: quality.rules || {},
    quality,
  });
  const taskTypes = db.prepare("SELECT task_type, COUNT(*) AS cases FROM cases GROUP BY task_type ORDER BY task_type").all();
  const promptChecks = db.prepare("SELECT task_type, clinical_json FROM cases GROUP BY task_type ORDER BY task_type").all().map((row) => {
    const patient = JSON.parse(row.clinical_json);
    const plan = buildTaskPlan(patient);
    const clinicalData = { ...patient, visits: plan.modelVisits };
    const evidence = buildEvidenceCatalog(clinicalData);
    const prompt = buildClinicalPrompt(clinicalData, evidence, plan.taskType);
    return {
      taskType: plan.taskType,
      sourceRecords: patient.visits.length,
      modelInputRecords: plan.modelVisits.length,
      referenceWithheld: Boolean(plan.reference),
      evidenceItems: evidence.length,
      promptCharacters: prompt.length,
    };
  });
  const issueSummary = db.prepare("SELECT code, severity, COUNT(*) AS count FROM dataset_issues GROUP BY code, severity ORDER BY count DESC, code").all();
  const issueSamples = db.prepare("SELECT patient_id, code, message, details_json FROM dataset_issues ORDER BY created_at LIMIT 8").all()
    .map((item) => ({ ...item, details: JSON.parse(item.details_json || "{}"), details_json: undefined }));
  const counts = {
    datasets: db.prepare("SELECT COUNT(*) AS count FROM datasets").get().count,
    versions: db.prepare("SELECT COUNT(*) AS count FROM dataset_versions").get().count,
    cases: db.prepare("SELECT COUNT(*) AS count FROM cases").get().count,
    lineageRows: db.prepare("SELECT COUNT(*) AS count FROM record_lineage").get().count,
    issues: db.prepare("SELECT COUNT(*) AS count FROM dataset_issues").get().count,
  };
  console.log(JSON.stringify({ ok: true, databasePath, result, counts, taskTypes, promptChecks, issueSummary, issueSamples }, null, 2));
} finally {
  db.close();
}
