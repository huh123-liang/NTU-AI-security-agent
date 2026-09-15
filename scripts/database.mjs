import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

let instance = null;

export const now = () => new Date().toISOString();
export const id = (prefix) => `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 18).toUpperCase()}`;
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(String(password), salt, 64).toString("hex") };
}

export function verifyPassword(password, salt, expectedHex) {
  const actual = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function seedAdmin(db) {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existing) return existing.id;
  const timestamp = now();
  const credentials = hashPassword("123");
  const adminId = id("USR");
  db.prepare(`INSERT INTO users (id, display_name, email, password_hash, password_salt, role, active, access_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'admin', 1, 'active', ?, ?)`)
    .run(adminId, "Platform Administrator", "admin@ntu-demo.local", credentials.hash, credentials.salt, timestamp, timestamp);
  return adminId;
}

function ensureColumn(db, table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
  if (exists) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function migrateRunLifecycle(db) {
  const lifecycleAdded = ensureColumn(db, "agent_runs", "lifecycle_status", "TEXT NOT NULL DEFAULT 'Running'");
  ensureColumn(db, "agent_runs", "stage", "TEXT NOT NULL DEFAULT 'preparing_data'");
  ensureColumn(db, "agent_runs", "stage_history_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "agent_runs", "evidence_links_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "agent_runs", "cancel_requested", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "agent_runs", "updated_at", "TEXT");
  if (lifecycleAdded) db.prepare("UPDATE agent_runs SET lifecycle_status = status").run();
  db.prepare("UPDATE agent_runs SET updated_at = COALESCE(updated_at, completed_at, created_at)").run();
}

function migrateStudyGovernance(db) {
  ensureColumn(db, "users", "access_status", "TEXT NOT NULL DEFAULT 'active'");
  db.prepare("UPDATE users SET access_status = CASE WHEN active = 1 THEN COALESCE(NULLIF(access_status, ''), 'active') ELSE 'deactivated' END").run();
  ensureColumn(db, "agent_runs", "study_status", "TEXT NOT NULL DEFAULT 'Sandbox'");
  ensureColumn(db, "agent_runs", "output_hash", "TEXT");
  ensureColumn(db, "agent_runs", "aggregation_config_json", "TEXT NOT NULL DEFAULT '{}'");
  db.prepare("UPDATE agent_runs SET study_status = COALESCE(NULLIF(study_status, ''), 'Sandbox')").run();
  // A failed pre-generation must not remain "pending" forever, otherwise the
  // Admin UI correctly prevents a duplicate answer but incorrectly hides retry.
  db.prepare(`UPDATE agent_runs SET study_status = 'Official failed'
    WHERE study_status = 'Official pending' AND (status = 'Failed' OR lifecycle_status IN ('Failed', 'Cancelled', 'Interrupted'))`).run();
  db.exec("CREATE INDEX IF NOT EXISTS idx_runs_case_study ON agent_runs(case_id, study_status)");
}

function migrateDatasetVersioning(db) {
  ensureColumn(db, "cases", "dataset_version_id", "TEXT");
  ensureColumn(db, "agent_runs", "dataset_version_id", "TEXT");
  ensureColumn(db, "agent_runs", "case_snapshot_hash", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_cases_dataset_version ON cases(dataset_version_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_runs_dataset_version ON agent_runs(dataset_version_id)");
}

function migrateFlexibleEvaluation(db) {
  ensureColumn(db, "cases", "task_type", "TEXT NOT NULL DEFAULT 'standard_longitudinal'");
  ensureColumn(db, "agent_runs", "model_config_id", "TEXT");
  ensureColumn(db, "agent_runs", "task_type", "TEXT NOT NULL DEFAULT 'standard_longitudinal'");
  ensureColumn(db, "agent_runs", "anonymous_model_label", "TEXT NOT NULL DEFAULT 'Model A'");
  ensureColumn(db, "agent_runs", "evaluation_batch_id", "TEXT");
  db.prepare(`UPDATE cases SET task_type = CASE
    WHEN visit_count <= 1 AND COALESCE(json_extract(clinical_json, '$.visits[0].date'), '') = '' THEN 'undated_snapshot'
    WHEN visit_count <= 1 THEN 'single_visit'
    WHEN visit_count < 10 THEN 'short_longitudinal'
    ELSE 'standard_longitudinal' END`).run();
  db.exec("CREATE INDEX IF NOT EXISTS idx_models_status ON model_configs(status, is_default)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_runs_model_config ON agent_runs(model_config_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_batches_case ON evaluation_batches(case_id, task_type, model_config_id)");
}

function migrateDatasetOwnershipToAdmin(db, adminId) {
  const rows = db.prepare("SELECT id, owner_id, provenance_json FROM datasets WHERE owner_id != ?").all(adminId);
  for (const row of rows) {
    let provenance = {};
    try { provenance = JSON.parse(row.provenance_json || "{}"); } catch { provenance = {}; }
    if (!provenance.originalUploaderId) provenance.originalUploaderId = row.owner_id;
    provenance.adminOwnershipMigratedAt ||= now();
    db.prepare("UPDATE datasets SET owner_id = ?, provenance_json = ? WHERE id = ?")
      .run(adminId, JSON.stringify(provenance), row.id);
    audit(db, adminId, "dataset.ownership_migrated_to_admin", "dataset", row.id, { originalOwnerId: row.owner_id });
  }
  db.prepare("UPDATE ingestion_jobs SET owner_id = ? WHERE owner_id != ?").run(adminId, adminId);
}

export function getDatabase(root) {
  if (instance?.root === root) return instance.db;
  const dataDir = path.join(root, ".data");
  mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, "platform.db");
  const db = new DatabaseSync(databasePath);
  const schemaPath = path.join(root, "db", "schema.sql");
  if (!existsSync(schemaPath)) throw new Error("SQL schema is missing.");
  db.exec(readFileSync(schemaPath, "utf8"));
  const adminId = seedAdmin(db);
  migrateRunLifecycle(db);
  migrateStudyGovernance(db);
  migrateDatasetVersioning(db);
  migrateFlexibleEvaluation(db);
  migrateDatasetOwnershipToAdmin(db, adminId);
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
  instance = { root, db };
  return db;
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    active: Boolean(row.active),
    accessStatus: row.access_status || (row.active ? "active" : "deactivated"),
    createdAt: row.created_at,
  };
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(sha256(token), userId, expiresAt, createdAt);
  return { token, expiresAt };
}

export function getAuthenticatedUser(db, req) {
  const authorization = String(req.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1 AND COALESCE(u.access_status, 'active') != 'deactivated'`).get(sha256(token), now());
  return publicUser(row);
}

export function removeSession(db, req) {
  const authorization = String(req.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function audit(db, actorId, action, entityType, entityId = null, details = {}) {
  db.prepare(`INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id("AUD"), actorId || null, action, entityType, entityId, JSON.stringify(details), now());
}

export function withTransaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function resetDatabaseForTests() {
  try { instance?.db?.close(); } catch { /* best effort */ }
  instance = null;
}
