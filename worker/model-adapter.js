export const DEFAULT_PROVIDER = "deepseek";
export const DEFAULT_MODEL = "deepseek-chat";
export const PROMPT_VERSION = "adaptive-clinical-evidence-v1";
export const TASK_PROMPT_VERSIONS = Object.freeze({
  single_visit: "single-visit-evidence-v1",
  short_longitudinal: "short-longitudinal-evidence-v1",
  standard_longitudinal: "standard-longitudinal-evidence-v3",
  undated_snapshot: "undated-snapshot-evidence-v1",
});

const METRIC_LABELS = {
  hba1c: "HbA1c",
  systolic_bp: "Systolic blood pressure",
  diastolic_bp: "Diastolic blood pressure",
  egfr: "eGFR",
  ldl_cholesterol: "LDL cholesterol",
  bmi: "BMI",
  potassium: "Potassium",
  alt: "ALT",
  pulse: "Heart rate",
  uacr: "Urine ACR",
};

const evidenceId = (visitNumber, key) => `V${visitNumber}-${String(key).replaceAll("_", "-").toUpperCase()}`;

export function buildEvidenceCatalog(clinicalData) {
  const visits = Array.isArray(clinicalData?.visits) ? clinicalData.visits : [];
  return visits.flatMap((visit, visitIndex) => {
    const visitNumber = Number(visit.visit_number || visitIndex + 1);
    return Object.entries(visit.clinic_measurements || {}).flatMap(([key, raw]) => {
      const value = raw && typeof raw === "object" ? raw.value : raw;
      if (value === null || value === undefined || value === "") return [];
      if (raw && typeof raw === "object" && (raw.imputed === true || raw.observed === false)) return [];
      const unit = raw && typeof raw === "object" ? raw.unit || "" : "";
      return [{
        id: evidenceId(visitNumber, key),
        visitNumber,
        date: visit.date || null,
        metricKey: key,
        metricLabel: METRIC_LABELS[key] || key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        value,
        unit,
        jsonPath: `$.visits[${visitIndex}].clinic_measurements.${key}`,
      }];
    });
  });
}

export function validateEvidenceCitations(output, catalog) {
  const byId = new Map(catalog.map((item) => [item.id.toUpperCase(), item]));
  const requested = [...String(output || "").matchAll(/\[EVID:([A-Z0-9-]+)\]/gi)].map((match) => match[1].toUpperCase());
  const invalidCitations = [...new Set(requested.filter((citation) => !byId.has(citation)))];
  const evidenceLinks = [...new Set(requested.filter((citation) => byId.has(citation)))].map((citation) => byId.get(citation));
  return { evidenceLinks, invalidCitations };
}

export function buildClinicalPrompt(clinicalData, evidenceCatalog, taskType = "standard_longitudinal", customTemplate = "") {
  const recordLabel = clinicalData?.synthetic === false
    ? "de-identified real-world longitudinal research record"
    : "simulated longitudinal research record";
  const taskInstructions = {
    single_visit: "Use the single supplied clinical record to produce a conservative assessment and next-step plan. No future reference record is being withheld.",
    short_longitudinal: "Use the supplied prior records to produce the proposed plan for the next visit. The latest record is withheld as reference evidence and must not be claimed as observed.",
    standard_longitudinal: "Use the supplied longitudinal records to produce the proposed plan for the next visit. The latest record is withheld as reference evidence and must not be claimed as observed.",
    undated_snapshot: "Use the supplied undated clinical snapshot to produce a conservative assessment and next-step plan. Do not invent chronology or trends.",
  };
  const sourceLabel = taskType === "single_visit" || taskType === "undated_snapshot" ? "SUPPLIED CLINICAL RECORD" : "MODEL-INPUT RECORDS ONLY";
  return `You are generating a candidate clinical plan for research evaluation by qualified clinicians.

TASK
${taskInstructions[taskType] || taskInstructions.standard_longitudinal}

${sourceLabel} (${recordLabel})
${JSON.stringify(clinicalData, null, 2)}

ALLOWED SOURCE EVIDENCE IDS
${evidenceCatalog.map((item) => `${item.id} | Visit ${item.visitNumber} | ${item.date || "date unavailable"} | ${item.metricLabel}: ${item.value} ${item.unit} | ${item.jsonPath}`).join("\n")}

Use these Markdown sections:
## Assessment
## Treatment plan
## Monitoring
## Safety considerations
## Follow-up
## Uncertainty and missing information

Requirements:
- Distinguish observed facts from recommendations.
- Treat fields marked unavailable as unknown. Never convert missingness into a normal finding or invent a medication, laboratory value, symptom, allergy, or history.
- Treat fields marked imputed as display-support estimates, not observations; state this limitation if they influence a recommendation.
- Refer to longitudinal trends only when at least two dated observations support the trend.
- After every sentence that states a patient measurement or trend, append one or more exact source tokens in the form [EVID:V1-SYSTOLIC-BP]. Use only IDs from the allowed list above.
- Never cite or disclose a withheld reference record as model-input evidence.
- Include contraindication checks, medication monitoring and follow-up timing.
- Do not invent measurements, diagnoses, allergies or preferences.
- Do not expose chain-of-thought.
- End with: Research evaluation output only — not clinical advice.
${customTemplate ? `\nADMIN-APPROVED MODEL INSTRUCTIONS\n${customTemplate}` : ""}`;
}

const RETRYABLE_NETWORK_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET",
  "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENETUNREACH", "ECONNREFUSED",
]);
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const retryDelay = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason || new DOMException("Aborted", "AbortError")); return; }
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(signal.reason || new DOMException("Aborted", "AbortError"));
  }, { once: true });
});

export function isRetryableModelError(error) {
  const code = error?.cause?.code || error?.cause?.errno || error?.code;
  return RETRYABLE_NETWORK_CODES.has(code) || RETRYABLE_HTTP_STATUS.has(Number(error?.status));
}

async function runOpenAICompatible({ provider, clinicalData, evidenceCatalog, apiKey, model, baseUrl, timeoutMs = 90000,
  maxAttempts = 3, retryDelayMs = 800, extraBody = {}, temperature = 0.2, maxTokens = 3200,
  taskType = "standard_longitudinal", promptTemplate = "", signal }) {
  if (!apiKey) throw new Error(`${provider} API key is not configured.`);
  const controller = new AbortController();
  let timedOut = false;
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) relayAbort();
  else signal?.addEventListener("abort", relayAbort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: "Produce a conservative, auditable medical-agent candidate response. Never claim to replace clinical judgement." },
              { role: "user", content: buildClinicalPrompt(clinicalData, evidenceCatalog, taskType, promptTemplate) },
            ],
            max_tokens: Number(maxTokens || 3200),
            temperature: Number(temperature ?? 0.2),
            stream: false,
            ...extraBody,
          }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const requestError = new Error(payload?.error?.message || `${provider} request failed (${response.status}).`);
          requestError.status = response.status;
          requestError.code = `HTTP_${response.status}`;
          throw requestError;
        }
        const output = payload?.choices?.[0]?.message?.content?.trim();
        if (!output) {
          const reason = payload?.choices?.[0]?.finish_reason;
          throw new Error(`${provider} returned an empty response${reason ? ` (finish reason: ${reason})` : ""}.`);
        }
        return {
          provider,
          modelVersion: payload.model || model,
          promptVersion: TASK_PROMPT_VERSIONS[taskType] || PROMPT_VERSION,
          output,
          responseId: payload.id || null,
          usage: payload.usage || null,
          attempts: attempt,
        };
      } catch (error) {
        if ((error?.name === "AbortError" || controller.signal.aborted) && signal?.aborted && !timedOut) {
          const cancelled = new Error(`${provider} request was cancelled.`);
          cancelled.name = "RunCancelledError";
          throw cancelled;
        }
        if (error?.name === "AbortError" || controller.signal.aborted) throw new Error(`${provider} request timed out after ${timeoutMs} ms.`);
        if (isRetryableModelError(error) && attempt < attempts) {
          await retryDelay(Number(retryDelayMs) * (2 ** (attempt - 1)), controller.signal);
          continue;
        }
        if (error instanceof TypeError && error.message === "fetch failed") {
          const code = error.cause?.code || error.cause?.errno || "NETWORK_UNREACHABLE";
          const networkError = new Error(`Unable to reach the ${provider} API (${code}) after ${attempt} attempt${attempt === 1 ? "" : "s"}. Check internet access, firewall, proxy settings, and outbound HTTPS port 443.`);
          networkError.code = code;
          networkError.networkFailure = true;
          networkError.attempts = attempt;
          throw networkError;
        }
        throw error;
      }
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", relayAbort);
  }
}

const PROVIDER_LABELS = Object.freeze({ deepseek: "DeepSeek", openai: "OpenAI", qwen: "Qwen", glm: "GLM", "openai-compatible": "OpenAI-compatible" });
const PROVIDER_BASE_URLS = Object.freeze({ deepseek: "https://api.deepseek.com", openai: "https://api.openai.com/v1", qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", glm: "https://open.bigmodel.cn/api/paas/v4" });
const providerAdapters = Object.fromEntries(Object.entries(PROVIDER_LABELS).map(([key, label]) => [key,
  ({ clinicalData, evidenceCatalog, config, signal }) => runOpenAICompatible({
    provider: label,
    clinicalData,
    evidenceCatalog,
    apiKey: config.apiKey,
    model: config.model || DEFAULT_MODEL,
    baseUrl: config.baseUrl || PROVIDER_BASE_URLS[key] || "",
    timeoutMs: Number(config.timeoutMs || 90000),
    maxAttempts: Number(config.maxAttempts || 3),
    retryDelayMs: Number(config.retryDelayMs || 800),
    temperature: Number(config.temperature ?? 0.2),
    maxTokens: Number(config.maxTokens || 3200),
    taskType: config.taskType || "standard_longitudinal",
    promptTemplate: config.promptTemplate || "",
    extraBody: config.extraBody || {},
    signal,
  })]));

export function supportedProviders() {
  return Object.keys(providerAdapters);
}

export async function runMedicalModel({ clinicalData, evidenceCatalog = buildEvidenceCatalog(clinicalData), config = {}, signal }) {
  const provider = String(config.provider || DEFAULT_PROVIDER).toLowerCase();
  const adapter = providerAdapters[provider];
  if (!adapter) throw new Error(`Model provider '${provider}' is not installed. Supported providers: ${supportedProviders().join(", ")}.`);
  return adapter({ clinicalData, evidenceCatalog, config, signal });
}
