const TOKEN_KEY = "ntu-med-eval-session";

export const sessionStore = {
  get: () => window.localStorage.getItem(TOKEN_KEY) || "",
  set: (token) => token ? window.localStorage.setItem(TOKEN_KEY, token) : window.localStorage.removeItem(TOKEN_KEY),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
};

const request = async (path, options = {}) => {
  const token = sessionStore.get();
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: {
      ...(typeof options.body === "string" ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) sessionStore.clear();
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
};

const json = (value) => JSON.stringify(value);

export const api = {
  health: () => request("/health"),
  register: (payload) => request("/auth/register", { method: "POST", body: json(payload) }),
  login: (payload) => request("/auth/login", { method: "POST", body: json(payload) }),
  me: () => request("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST", body: "{}" }),
  dashboard: () => request("/dashboard"),
  rubrics: () => request("/rubrics"),
  datasets: () => request("/datasets"),
  dataset: (id) => request(`/datasets/${encodeURIComponent(id)}`),
  uploadDataset: (payload) => request("/datasets/import", { method: "POST", body: json(payload) }),
  ingestionJobs: () => request("/ingestion/jobs"),
  ingestionJob: (id) => request(`/ingestion/jobs/${encodeURIComponent(id)}`),
  createIngestionJob: (payload) => request("/ingestion/jobs", { method: "POST", body: json(payload) }),
  completeIngestionUpload: (id) => request(`/ingestion/jobs/${encodeURIComponent(id)}/complete`, { method: "POST", body: "{}" }),
  cancelIngestion: (id) => request(`/ingestion/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
  retryIngestion: (id) => request(`/ingestion/jobs/${encodeURIComponent(id)}/retry`, { method: "POST", body: "{}" }),
  saveIngestionMapping: (id, mapping) => request(`/admin/ingestion/jobs/${encodeURIComponent(id)}/mapping`, { method: "PUT", body: json({ mapping }) }),
  processIngestion: (id, rules = {}) => request(`/admin/ingestion/jobs/${encodeURIComponent(id)}/process`, { method: "POST", body: json({ rules }) }),
  approveIngestion: (id, payload) => request(`/admin/ingestion/jobs/${encodeURIComponent(id)}/approval`, { method: "POST", body: json(payload) }),
  reviewDataset: (id, payload) => request(`/admin/datasets/${encodeURIComponent(id)}/review`, { method: "PATCH", body: json(payload) }),
  models: () => request("/admin/models"),
  createModel: (payload) => request("/admin/models", { method: "POST", body: json(payload) }),
  createModelVersion: (id, payload) => request(`/admin/models/${encodeURIComponent(id)}/versions`, { method: "POST", body: json(payload) }),
  setModelStatus: (id, payload) => request(`/admin/models/${encodeURIComponent(id)}/status`, { method: "PATCH", body: json(payload) }),
  testModel: (id) => request(`/admin/models/${encodeURIComponent(id)}/test`, { method: "POST", body: "{}" }),
  datasetModelAssignment: (id) => request(`/admin/datasets/${encodeURIComponent(id)}/model-assignment`),
  assignDatasetModel: (id, modelConfigId) => request(`/admin/datasets/${encodeURIComponent(id)}/model-assignment`, { method: "PUT", body: json({ modelConfigId }) }),
  cases: (datasetId, { search = "", page = 1, limit = 40 } = {}) => request(`/datasets/${encodeURIComponent(datasetId)}/cases?search=${encodeURIComponent(search)}&page=${page}&limit=${limit}`),
  case: (id) => request(`/cases/${encodeURIComponent(id)}`),
  runs: (caseId) => request(`/cases/${encodeURIComponent(caseId)}/runs`),
  generateRun: (caseId, modelConfigId = null) => request(`/cases/${encodeURIComponent(caseId)}/runs`, { method: "POST", body: json({ modelConfigId }) }),
  generateOfficialRun: (caseId, modelConfigId = null) => request(`/admin/cases/${encodeURIComponent(caseId)}/official-run`, { method: "POST", body: json({ modelConfigId }) }),
  officialRuns: ({ datasetId = "", search = "", modelConfigId = "" } = {}) => request(`/admin/official-runs?datasetId=${encodeURIComponent(datasetId)}&search=${encodeURIComponent(search)}&modelConfigId=${encodeURIComponent(modelConfigId)}`),
  run: (id) => request(`/runs/${encodeURIComponent(id)}`),
  cancelRun: (id) => request(`/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
  retryRun: (id) => request(`/runs/${encodeURIComponent(id)}/retry`, { method: "POST", body: "{}" }),
  assessment: (runId) => request(`/runs/${encodeURIComponent(runId)}/assessment`),
  saveAssessment: (runId, payload) => request(`/runs/${encodeURIComponent(runId)}/assessment`, { method: "PUT", body: json(payload) }),
  assessments: () => request("/assessments"),
  submitPlatformFeedback: (payload) => request("/platform-feedback", { method: "POST", body: json(payload) }),
  adminUsers: () => request("/admin/users"),
  setUserAccessStatus: (id, accessStatus) => request(`/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: json({ accessStatus }) }),
  adminFeedback: () => request("/admin/feedback"),
  previewAggregation: (payload) => request("/admin/aggregation/preview", { method: "POST", body: json(payload) }),
  finalizeAggregation: (payload) => request("/admin/finalizations", { method: "POST", body: json(payload) }),
  finalizations: () => request("/admin/finalizations"),
};

export async function uploadHospitalZip(file, { name, description = "", onProgress = () => {} } = {}) {
  const created = await api.createIngestionJob({ fileName: file.name, size: file.size, name: name || file.name.replace(/\.zip$/i, ""), description });
  const jobId = created.job.id;
  const chunkSize = 4 * 1024 * 1024;
  let offset = Number(created.job.receivedBytes || 0);
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
    const token = sessionStore.get();
    const response = await fetch(`/api/v1/ingestion/jobs/${encodeURIComponent(jobId)}/chunks`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-offset": String(offset),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: chunk,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Chunk upload failed (${response.status}).`);
    offset = Number(payload.receivedBytes || offset + chunk.size);
    onProgress({ stage: "uploading", percent: Math.round(offset / file.size * 100), jobId });
  }
  const completed = await api.completeIngestionUpload(jobId);
  onProgress({ stage: "inspecting", percent: 100, jobId });
  return completed.job;
}

export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  return window.btoa(binary);
}
