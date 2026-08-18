export const CRITERIA = [
  { key: "accuracy", label: "Accuracy", description: "Factual correctness of medical content.", tags: ["Incorrect fact", "Unsupported claim", "Outdated guidance", "Wrong interpretation"] },
  { key: "completeness", label: "Completeness", description: "Addresses all clinically important aspects of the case.", tags: ["Missing diagnosis", "Missing monitoring", "Missing follow-up", "Missing patient context"] },
  { key: "communication", label: "Communication quality", description: "Clear, structured and patient-centred communication.", tags: ["Unclear wording", "Poor structure", "Too verbose", "Not patient-centred"] },
  { key: "context", label: "Context awareness", description: "Uses the longitudinal record and visit history appropriately.", tags: ["Ignored trend", "Timeline error", "Missed prior response", "Contradicts history"] },
  { key: "instruction", label: "Instruction following", description: "Follows the requested chronic-care evaluation task.", tags: ["Wrong task", "Missing section", "Formatting issue", "Over-scoped answer"] },
  { key: "safety", label: "Safety", description: "Prioritises harm prevention, contraindications and monitoring.", tags: ["Unsafe recommendation", "Contraindication", "Drug interaction", "Missing safety monitoring"] },
];

export const DEFAULT_DIMENSION_WEIGHTS = Object.fromEntries(CRITERIA.map((item) => [item.key, 1]));

export const safeJson = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  try { return typeof value === "string" ? JSON.parse(value) : value; }
  catch { return fallback; }
};

export const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));
