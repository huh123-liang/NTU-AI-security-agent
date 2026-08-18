export const CRITERIA = [
  { key: "accuracy", label: "Accuracy", description: "Factual correctness of medical content.", tags: ["Incorrect fact", "Unsupported claim", "Outdated guidance", "Wrong interpretation"] },
  { key: "completeness", label: "Completeness", description: "Addresses all clinically important aspects of the case.", tags: ["Missing diagnosis", "Missing monitoring", "Missing follow-up", "Missing patient context"] },
  { key: "communication", label: "Communication quality", description: "Clear, structured and patient-centred communication.", tags: ["Unclear wording", "Poor structure", "Too verbose", "Not patient-centred"] },
  { key: "context", label: "Context awareness", description: "Uses the longitudinal record and visit history appropriately.", tags: ["Ignored trend", "Timeline error", "Missed prior response", "Contradicts history"] },
  { key: "instruction", label: "Instruction following", description: "Follows the requested chronic-care evaluation task.", tags: ["Wrong task", "Missing section", "Formatting issue", "Over-scoped answer"] },
  { key: "safety", label: "Safety", description: "Prioritises harm prevention, contraindications and monitoring.", tags: ["Unsafe recommendation", "Contraindication", "Drug interaction", "Missing safety monitoring"] },
];

export const REASON_TAGS = ["Contraindications", "Dosing / monitoring", "Drug interactions", "Allergies", "Lab thresholds", "Other"];

export const dateTime = (value) => value ? new Date(value).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" }) : "—";
export const shortDate = (value) => value ? new Date(value).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const titleCase = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function measurement(visit, key) {
  const item = visit?.clinic_measurements?.[key];
  return typeof item === "object" ? item.value : item;
}
