import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { id, now, withTransaction } from "./database.mjs";

const DEFAULT_ENDPOINTS = Object.freeze({
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  glm: "https://open.bigmodel.cn/api/paas/v4",
  "openai-compatible": "",
});

const cleanTags = (value) => [...new Set((Array.isArray(value) ? value : String(value || "").split(","))
  .map((item) => String(item).trim().toLowerCase()).filter(Boolean))];

export function normalizeModelEndpoint(provider, value) {
  const candidate = String(value || DEFAULT_ENDPOINTS[String(provider).toLowerCase()] || "").trim().replace(/\/$/, "");
  if (!candidate) throw new Error("Base URL is required for this provider.");
  const parsed = new URL(candidate);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error("Model Base URL must use HTTPS (HTTP is allowed only for localhost).");
  }
  if (parsed.username || parsed.password) throw new Error("Credentials must not be embedded in the Base URL.");
  return candidate;
}

function secretKeyPath(root) {
  return path.join(root, ".data", "secrets", "model-registry.key");
}

function getSecretKey(root) {
  const target = secretKeyPath(root);
  if (!existsSync(target)) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, randomBytes(32), { mode: 0o600 });
  }
  const key = readFileSync(target);
  if (key.length !== 32) throw new Error("The local model-registry encryption key is invalid.");
  return key;
}

export function encryptModelSecret(root, plaintext) {
  if (!plaintext) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretKey(root), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptModelSecret(root, encoded) {
  if (!encoded) return "";
  const [version, iv, tag, encrypted] = String(encoded).split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("The stored model credential cannot be decoded.");
  const decipher = createDecipheriv("aes-256-gcm", getSecretKey(root), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}

function nextAnonymousLabel(db) {
  const count = Number(db.prepare("SELECT COUNT(*) AS count FROM model_configs WHERE status != 'archived'").get()?.count || 0);
  let index = count;
  let label = "";
  do {
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return `Model ${label}`;
}

export function modelConfigDto(row) {
  if (!row) return null;
  return {
    id: row.id, familyId: row.family_id, version: Number(row.version),
    displayName: row.display_name, anonymousName: row.anonymous_name,
    provider: row.provider, protocol: row.protocol, baseUrl: row.base_url,
    modelId: row.model_id, apiKeyConfigured: Boolean(row.api_key_encrypted), apiKeyHint: row.api_key_hint || "",
    diseaseTags: JSON.parse(row.disease_tags_json || "[]"), specialtyTags: JSON.parse(row.specialty_tags_json || "[]"),
    capabilityTags: JSON.parse(row.capability_tags_json || "[]"), promptTemplate: row.prompt_template || "",
    temperature: Number(row.temperature), maxTokens: Number(row.max_tokens), timeoutMs: Number(row.timeout_ms),
    status: row.status, isDefault: Boolean(row.is_default), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function insertConfig(db, root, input, actorId, inherited = {}) {
  const provider = String(input.provider || inherited.provider || "openai-compatible").toLowerCase();
  const apiKey = input.apiKey === undefined ? null : String(input.apiKey || "").trim();
  const encrypted = apiKey === null ? inherited.api_key_encrypted || null : encryptModelSecret(root, apiKey);
  const hint = apiKey === null ? inherited.api_key_hint || "" : (apiKey ? `...${apiKey.slice(-4)}` : "");
  const timestamp = now();
  const record = {
    id: id("MOD"), familyId: inherited.family_id || input.familyId || `FAM-${randomUUID().slice(0, 8).toUpperCase()}`,
    version: Number(input.version || (Number(inherited.version || 0) + 1)),
    displayName: String(input.displayName || inherited.display_name || input.modelId || "Clinical model").trim(),
    anonymousName: String(input.anonymousName || inherited.anonymous_name || nextAnonymousLabel(db)).trim(),
    provider, protocol: String(input.protocol || inherited.protocol || "openai_chat"),
    baseUrl: normalizeModelEndpoint(provider, input.baseUrl || inherited.base_url),
    modelId: String(input.modelId || inherited.model_id || "").trim(), encrypted, hint,
    diseaseTags: cleanTags(input.diseaseTags ?? JSON.parse(inherited.disease_tags_json || "[]")),
    specialtyTags: cleanTags(input.specialtyTags ?? JSON.parse(inherited.specialty_tags_json || "[]")),
    capabilityTags: cleanTags(input.capabilityTags ?? JSON.parse(inherited.capability_tags_json || "[]")),
    promptTemplate: String(input.promptTemplate ?? inherited.prompt_template ?? ""),
    temperature: Number(input.temperature ?? inherited.temperature ?? 0.2),
    maxTokens: Number(input.maxTokens ?? inherited.max_tokens ?? 3200),
    timeoutMs: Number(input.timeoutMs ?? inherited.timeout_ms ?? 90000),
    status: String(input.status || "active"), isDefault: input.isDefault ? 1 : 0,
  };
  if (!record.modelId) throw new Error("Model ID is required.");
  if (!Number.isFinite(record.temperature) || record.temperature < 0 || record.temperature > 2) throw new Error("Temperature must be between 0 and 2.");
  if (!Number.isInteger(record.maxTokens) || record.maxTokens < 128 || record.maxTokens > 128000) throw new Error("Max tokens must be between 128 and 128000.");
  if (!Number.isInteger(record.timeoutMs) || record.timeoutMs < 5000 || record.timeoutMs > 600000) throw new Error("Timeout must be between 5 and 600 seconds.");
  withTransaction(db, () => {
    if (record.isDefault) db.prepare("UPDATE model_configs SET is_default = 0").run();
    db.prepare(`INSERT INTO model_configs (id, family_id, version, display_name, anonymous_name, provider, protocol, base_url,
      model_id, api_key_encrypted, api_key_hint, disease_tags_json, specialty_tags_json, capability_tags_json,
      prompt_template, temperature, max_tokens, timeout_ms, status, is_default, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(record.id, record.familyId, record.version, record.displayName, record.anonymousName, record.provider, record.protocol,
        record.baseUrl, record.modelId, record.encrypted, record.hint, JSON.stringify(record.diseaseTags),
        JSON.stringify(record.specialtyTags), JSON.stringify(record.capabilityTags), record.promptTemplate,
        record.temperature, record.maxTokens, record.timeoutMs, record.status, record.isDefault, actorId, timestamp, timestamp);
  });
  return modelConfigDto(db.prepare("SELECT * FROM model_configs WHERE id = ?").get(record.id));
}

export function ensureDefaultModelConfig({ db, root, envConfig = {}, adminId }) {
  const existing = db.prepare("SELECT * FROM model_configs ORDER BY is_default DESC, created_at ASC LIMIT 1").get();
  if (existing) {
    const envApiKey = String(envConfig.apiKey || "").trim();
    if (!existing.api_key_encrypted && envApiKey) {
      db.prepare("UPDATE model_configs SET api_key_encrypted = ?, api_key_hint = ?, updated_at = ? WHERE id = ?")
        .run(encryptModelSecret(root, envApiKey), `...${envApiKey.slice(-4)}`, now(), existing.id);
      return modelConfigDto(db.prepare("SELECT * FROM model_configs WHERE id = ?").get(existing.id));
    }
    return modelConfigDto(existing);
  }
  return insertConfig(db, root, {
    displayName: "DeepSeek Clinical Planning", anonymousName: "Model A", provider: "deepseek",
    baseUrl: envConfig.baseUrl || "https://api.deepseek.com", modelId: envConfig.model || "deepseek-chat",
    apiKey: envConfig.apiKey || "", diseaseTags: ["chronic disease"], capabilityTags: ["clinical planning", "longitudinal"],
    timeoutMs: Number(envConfig.timeoutMs || 90000), maxTokens: 3200, isDefault: true,
  }, adminId);
}

export const listModelConfigs = (db) => db.prepare("SELECT * FROM model_configs ORDER BY is_default DESC, display_name, version DESC").all().map(modelConfigDto);
export const createModelConfig = ({ db, root, input, actorId }) => insertConfig(db, root, input, actorId);
export function createModelVersion({ db, root, modelId, input, actorId }) {
  const prior = db.prepare("SELECT * FROM model_configs WHERE id = ?").get(modelId);
  if (!prior) throw new Error("Model configuration not found.");
  return insertConfig(db, root, { ...input, familyId: prior.family_id }, actorId, prior);
}

export function setModelStatus(db, modelId, { status, isDefault = false }) {
  const row = db.prepare("SELECT * FROM model_configs WHERE id = ?").get(modelId);
  if (!row) throw new Error("Model configuration not found.");
  if (!['active', 'disabled'].includes(status)) throw new Error("Model status must be active or disabled.");
  withTransaction(db, () => {
    if (isDefault) db.prepare("UPDATE model_configs SET is_default = 0").run();
    db.prepare("UPDATE model_configs SET status = ?, is_default = ?, updated_at = ? WHERE id = ?")
      .run(status, isDefault ? 1 : 0, now(), modelId);
  });
  return modelConfigDto(db.prepare("SELECT * FROM model_configs WHERE id = ?").get(modelId));
}

export function resolveModelConfig({ db, root, modelConfigId = null, datasetId = null }) {
  let row = modelConfigId ? db.prepare("SELECT * FROM model_configs WHERE id = ?").get(modelConfigId) : null;
  if (!row && datasetId) row = db.prepare(`SELECT m.* FROM dataset_model_assignments a JOIN model_configs m ON m.id = a.model_config_id
    WHERE a.dataset_id = ? ORDER BY a.assigned_at DESC LIMIT 1`).get(datasetId);
  if (!row) row = db.prepare("SELECT * FROM model_configs WHERE status = 'active' ORDER BY is_default DESC, created_at ASC LIMIT 1").get();
  if (!row) throw new Error("No active model configuration is available.");
  if (row.status !== "active") throw new Error("The selected model configuration is disabled.");
  return {
    ...modelConfigDto(row), apiKey: decryptModelSecret(root, row.api_key_encrypted),
    model: row.model_id, maxAttempts: 3, retryDelayMs: 800,
  };
}

export function recommendModelForDataset(db, datasetId) {
  const dataset = db.prepare("SELECT * FROM datasets WHERE id = ?").get(datasetId);
  if (!dataset) throw new Error("Dataset not found.");
  const conditions = db.prepare("SELECT condition_summary FROM cases WHERE dataset_id = ? LIMIT 200").all(datasetId)
    .flatMap((row) => String(row.condition_summary || "").toLowerCase().split(/[;,·|]/)).map((item) => item.trim()).filter(Boolean);
  const candidates = db.prepare("SELECT * FROM model_configs WHERE status = 'active'").all();
  let best = null;
  for (const row of candidates) {
    const tags = [...JSON.parse(row.disease_tags_json || "[]"), ...JSON.parse(row.specialty_tags_json || "[]")];
    const score = tags.reduce((total, tag) => total + conditions.filter((condition) => condition.includes(tag) || tag.includes(condition)).length, 0);
    if (!best || score > best.score || (score === best.score && row.is_default)) best = { row, score };
  }
  return { datasetId, recommendation: modelConfigDto(best?.row), score: best?.score || 0, reason: best?.score ? "Matched dataset condition tags." : "No specialty match; using the default active model." };
}

export function assignDatasetModel(db, datasetId, modelConfigId, actorId, recommendation = {}) {
  const selected = db.prepare("SELECT * FROM model_configs WHERE id=? AND status='active'").get(modelConfigId);
  if (!selected) throw new Error("Select an active model configuration.");
  const timestamp = now();
  withTransaction(db, () => {
    db.prepare(`INSERT INTO dataset_model_assignments (dataset_id, model_config_id, task_type, recommendation_json, assigned_by, assigned_at)
      VALUES (?, ?, NULL, ?, ?, ?) ON CONFLICT(dataset_id) DO UPDATE SET model_config_id=excluded.model_config_id,
      recommendation_json=excluded.recommendation_json, assigned_by=excluded.assigned_by, assigned_at=excluded.assigned_at`)
      .run(datasetId, modelConfigId, JSON.stringify(recommendation), actorId, timestamp);
  });
  return modelConfigDto(selected);
}
