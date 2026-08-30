PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'doctor')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  access_status TEXT NOT NULL DEFAULT 'active' CHECK (access_status IN ('active', 'scoring_suspended', 'deactivated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_filename TEXT NOT NULL,
  source_format TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending Review', 'Approved', 'Rejected')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
  declared_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  quarantined_count INTEGER NOT NULL DEFAULT 0,
  schema_version TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS dataset_issues (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  patient_id TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  age INTEGER,
  sex TEXT NOT NULL DEFAULT 'unspecified',
  ethnicity TEXT NOT NULL DEFAULT 'unspecified',
  condition_summary TEXT NOT NULL,
  conditions_json TEXT NOT NULL DEFAULT '[]',
  visit_count INTEGER NOT NULL,
  clinical_json TEXT NOT NULL,
  reference_visit_json TEXT NOT NULL,
  source_entry TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (dataset_id, patient_id),
  FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Running', 'Completed', 'Failed')),
  lifecycle_status TEXT NOT NULL DEFAULT 'Running',
  stage TEXT NOT NULL DEFAULT 'preparing_data',
  stage_history_json TEXT NOT NULL DEFAULT '[]',
  evidence_links_json TEXT NOT NULL DEFAULT '[]',
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  study_status TEXT NOT NULL DEFAULT 'Sandbox',
  output_hash TEXT,
  aggregation_config_json TEXT NOT NULL DEFAULT '{}',
  output TEXT,
  response_id TEXT,
  usage_json TEXT NOT NULL DEFAULT '{}',
  input_snapshot_json TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Submitted')),
  overall_score REAL,
  safety_issue TEXT NOT NULL DEFAULT 'Undecided',
  reason_tags_json TEXT NOT NULL DEFAULT '[]',
  case_feedback TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  locked_by_finalization_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  UNIQUE (run_id, reviewer_id),
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS criterion_scores (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  criterion_key TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  feedback TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  custom_tags_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE (assessment_id, criterion_key),
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS finalizations (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('run', 'case', 'dataset', 'model')),
  target_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('mean', 'median', 'weighted')),
  doctor_weights_json TEXT NOT NULL DEFAULT '{}',
  dimension_weights_json TEXT NOT NULL DEFAULT '{}',
  included_assessment_ids_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  final_score REAL NOT NULL,
  locked INTEGER NOT NULL DEFAULT 1 CHECK (locked IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS platform_feedback (
  id TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  clarity_rating INTEGER NOT NULL CHECK (clarity_rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  page TEXT NOT NULL,
  platform_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'New',
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_datasets_owner ON datasets(owner_id);
CREATE INDEX IF NOT EXISTS idx_cases_dataset ON cases(dataset_id);
CREATE INDEX IF NOT EXISTS idx_runs_case ON agent_runs(case_id);
CREATE INDEX IF NOT EXISTS idx_assessments_run ON assessments(run_id);
CREATE INDEX IF NOT EXISTS idx_assessments_case ON assessments(case_id);
CREATE INDEX IF NOT EXISTS idx_assessments_reviewer ON assessments(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_criteria_assessment ON criterion_scores(assessment_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON platform_feedback(status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
