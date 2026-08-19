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
      "content-type": "application/json",
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
  reviewDataset: (id, payload) => request(`/admin/datasets/${encodeURIComponent(id)}/review`, { method: "PATCH", body: json(payload) }),
  cases: (datasetId, { search = "", page = 1, limit = 40 } = {}) => request(`/datasets/${encodeURIComponent(datasetId)}/cases?search=${encodeURIComponent(search)}&page=${page}&limit=${limit}`),
  case: (id) => request(`/cases/${encodeURIComponent(id)}`),
  runs: (caseId) => request(`/cases/${encodeURIComponent(caseId)}/runs`),
  generateRun: (caseId) => request(`/cases/${encodeURIComponent(caseId)}/runs`, { method: "POST", body: "{}" }),
  run: (id) => request(`/runs/${encodeURIComponent(id)}`),
  cancelRun: (id) => request(`/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
  retryRun: (id) => request(`/runs/${encodeURIComponent(id)}/retry`, { method: "POST", body: "{}" }),
  assessment: (runId) => request(`/runs/${encodeURIComponent(runId)}/assessment`),
  saveAssessment: (runId, payload) => request(`/runs/${encodeURIComponent(runId)}/assessment`, { method: "PUT", body: json(payload) }),
  assessments: () => request("/assessments"),
  submitPlatformFeedback: (payload) => request("/platform-feedback", { method: "POST", body: json(payload) }),
  adminUsers: () => request("/admin/users"),
  setUserActive: (id, active) => request(`/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: json({ active }) }),
  adminFeedback: () => request("/admin/feedback"),
  previewAggregation: (payload) => request("/admin/aggregation/preview", { method: "POST", body: json(payload) }),
  finalizeAggregation: (payload) => request("/admin/finalizations", { method: "POST", body: json(payload) }),
  finalizations: () => request("/admin/finalizations"),
};

export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  return window.btoa(binary);
}
