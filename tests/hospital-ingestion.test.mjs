import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync, strToU8, zipSync } from "fflate";
import { getDatabase, hashPassword, id, now, resetDatabaseForTests } from "../scripts/database.mjs";
import { createIngestionService } from "../scripts/ingestion-service.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const worker = join(projectRoot, "scripts", "hospital-csv-pipeline.py");

function hospitalFixture() {
  const patients = "subject_id,anchor_age,gender,race\nP1,62,F,Asian\nP2,59,M,Chinese\n";
  const diagnoses = "subject_id,icd_code,long_title\nP1,E11,Type 2 diabetes mellitus\nP2,I10,Essential hypertension\n";
  const observationRows = ["subject_id,chartdate,result_name,result_value,result_unit"];
  for (let index = 0; index < 10; index += 1) observationRows.push(`P1,2025-${String(index + 1).padStart(2, "0")}-01,Blood Pressure,${130 + index}/80,mmHg`);
  for (let index = 0; index < 3; index += 1) observationRows.push(`P2,2025-${String(index + 1).padStart(2, "0")}-02,Blood Pressure,140/90,mmHg`);
  return Buffer.from(zipSync({
    "hospital/patients.csv": strToU8(patients),
    "hospital/diagnoses.csv.gz": gzipSync(strToU8(diagnoses)),
    "hospital/observations.csv.gz": gzipSync(strToU8(`${observationRows.join("\n")}\n`)),
  }));
}

test("hospital CSV pipeline discovers multi-table ZIPs and quarantines ineligible longitudinal records", () => {
  const root = mkdtempSync(join(tmpdir(), "ntu-hospital-ingestion-"));
  const source = join(root, "hospital.zip");
  const discovery = join(root, "discovery.json");
  const output = join(root, "processed");
  mkdirSync(output, { recursive: true });
  writeFileSync(source, hospitalFixture());
  const inspected = spawnSync("python", [worker, "inspect", source, discovery], { encoding: "utf8" });
  assert.equal(inspected.status, 0, inspected.stderr);
  const profile = JSON.parse(readFileSync(discovery, "utf8"));
  assert.equal(profile.tableCount, 3);
  assert.equal(profile.suggestedMapping.tables.some((item) => item.role === "observation"), true);
  const mappingPath = join(root, "mapping.json");
  writeFileSync(mappingPath, JSON.stringify(profile.suggestedMapping));
  const processed = spawnSync("python", [worker, "process", source, mappingPath, output], { encoding: "utf8" });
  assert.equal(processed.status, 0, processed.stderr);
  const quality = JSON.parse(readFileSync(join(output, "quality.json"), "utf8"));
  assert.equal(quality.patientsDiscovered, 2);
  assert.equal(quality.eligibleCases, 1);
  assert.equal(quality.quarantinedCases, 1);
  const manifest = readFileSync(join(output, "manifest.csv"), "utf8").trim().split(/\r?\n/);
  assert.equal(manifest.length, 2);
  const patientFile = manifest[1].split(",")[1];
  const patient = JSON.parse(readFileSync(join(output, patientFile), "utf8"));
  assert.equal(patient.deidentified, true);
  assert.equal(patient.patient_id.startsWith("HOSP-"), true);
  assert.equal(patient.visits.length, 10);
  assert.equal(patient.visits[9].data_availability.reference_role, "withheld reference");
});

test("resumable ingestion persists a Doctor upload and requires Admin approval before release", async () => {
  const root = mkdtempSync(join(tmpdir(), "ntu-ingestion-service-"));
  mkdirSync(join(root, "db"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  cpSync(join(projectRoot, "db", "schema.sql"), join(root, "db", "schema.sql"));
  cpSync(worker, join(root, "scripts", "hospital-csv-pipeline.py"));
  const db = getDatabase(root);
  const credentials = hashPassword("doctor");
  const doctorId = id("USR");
  db.prepare(`INSERT INTO users (id,display_name,email,password_hash,password_salt,role,active,access_status,created_at,updated_at)
    VALUES (?,?,?,?,?,'doctor',1,'active',?,?)`).run(doctorId, "Uploader", "uploader@example.test", credentials.hash, credentials.salt, now(), now());
  const doctor = { id: doctorId, role: "doctor" };
  const adminRow = db.prepare("SELECT * FROM users WHERE role='admin'").get();
  const admin = { id: adminRow.id, role: "admin" };
  const service = createIngestionService({ db, root });
  const bytes = hospitalFixture();
  const created = service.create(doctor, { fileName: "hospital.zip", size: bytes.length, name: "Hospital test" });
  await service.appendChunk(doctor, created.id, Readable.from(bytes), 0);
  await service.complete(doctor, created.id);
  const waitFor = async (status, timeoutMs = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const current = service.get(admin, created.id);
      if (current.status === status) return current;
      if (current.status === "Failed") assert.fail(current.errorMessage);
      await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    }
    assert.fail(`Timed out waiting for ${status}`);
  };
  const discovered = await waitFor("Awaiting Mapping");
  service.saveMapping(admin, created.id, discovered.mapping);
  service.process(admin, created.id);
  const reviewed = await waitFor("Awaiting Approval");
  assert.equal(reviewed.quality.eligibleCases, 1);
  assert.equal(db.prepare("SELECT status FROM datasets WHERE id=?").get(reviewed.datasetId).status, "Pending Review");
  service.approve(admin, created.id, { decision: "Approved", visibility: "private" });
  assert.equal(db.prepare("SELECT status FROM datasets WHERE id=?").get(reviewed.datasetId).status, "Approved");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cases WHERE dataset_id=?").get(reviewed.datasetId).count, 1);
  resetDatabaseForTests();
  rmSync(root, { recursive: true, force: true });
});
