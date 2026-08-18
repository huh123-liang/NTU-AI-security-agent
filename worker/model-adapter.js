export const DEFAULT_PROVIDER = "deepseek";
export const DEFAULT_MODEL = "deepseek-v4-pro";
export const PROMPT_VERSION = "longitudinal-visit10-plan-v1";

function buildClinicalPrompt(clinicalData) {
  return `You are generating a candidate chronic-care plan for research evaluation by qualified clinicians.

TASK
Use only visits 1-9 in the supplied simulated longitudinal record. Generate the proposed plan for visit 10. The actual visit-10 record is withheld and must not be inferred or claimed as observed.

SIMULATED CASE DATA (VISITS 1-9 ONLY)
${JSON.stringify(clinicalData, null, 2)}

Use these Markdown sections:
## Assessment
## Treatment plan
## Monitoring
## Safety considerations
## Follow-up
## Uncertainty and missing information

Requirements:
- Distinguish observed facts from recommendations.
- Refer to longitudinal trends when relevant.
- Include contraindication checks, medication monitoring and follow-up timing.
- Do not invent measurements, diagnoses, allergies or preferences.
- Do not expose chain-of-thought.
- End with: Research evaluation output only — not clinical advice.`;
}

async function runOpenAICompatible({ provider, clinicalData, apiKey, model, baseUrl, timeoutMs = 90000, extraBody = {} }) {
  if (!apiKey) throw new Error(`${provider} API key is not configured.`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Produce a conservative, auditable medical-agent candidate response. Never claim to replace clinical judgement." },
          { role: "user", content: buildClinicalPrompt(clinicalData) },
        ],
        max_tokens: 3200,
        stream: false,
        // The evaluation needs the final clinician-facing plan, not hidden
        // reasoning tokens. Disabling thinking also prevents the final content
        // from being starved by the output-token ceiling.
        thinking: { type: "disabled" },
        user_id: "ntu-ai-medical-evaluation-v1",
        ...extraBody,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `${provider} request failed (${response.status}).`);
    const output = payload?.choices?.[0]?.message?.content?.trim();
    if (!output) {
      const reason = payload?.choices?.[0]?.finish_reason;
      throw new Error(`${provider} returned an empty response${reason ? ` (finish reason: ${reason})` : ""}.`);
    }
    return {
      provider,
      modelVersion: payload.model || model,
      promptVersion: PROMPT_VERSION,
      output,
      responseId: payload.id || null,
      usage: payload.usage || null,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${provider} request timed out.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const providerAdapters = {
  deepseek: ({ clinicalData, config }) => runOpenAICompatible({
    provider: "DeepSeek",
    clinicalData,
    apiKey: config.apiKey,
    model: config.model || DEFAULT_MODEL,
    baseUrl: config.baseUrl || "https://api.deepseek.com",
    timeoutMs: Number(config.timeoutMs || 90000),
    extraBody: config.extraBody || {},
  }),
};

export function supportedProviders() {
  return Object.keys(providerAdapters);
}

export async function runMedicalModel({ clinicalData, config = {} }) {
  const provider = String(config.provider || DEFAULT_PROVIDER).toLowerCase();
  const adapter = providerAdapters[provider];
  if (!adapter) throw new Error(`Model provider '${provider}' is not installed. Supported providers: ${supportedProviders().join(", ")}.`);
  return adapter({ clinicalData, config });
}
