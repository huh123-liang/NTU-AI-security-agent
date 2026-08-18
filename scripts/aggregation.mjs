import { CRITERIA, DEFAULT_DIMENSION_WEIGHTS, round } from "./domain.mjs";
import { audit, id, now, withTransaction } from "./database.mjs";

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function assessmentRows(db, level, targetId) {
  const filters = {
    run: ["a.run_id = ?", targetId],
    case: ["a.case_id = ?", targetId],
    dataset: ["c.dataset_id = ?", targetId],
    model: ["r.model_version = ?", targetId],
  };
  const filter = filters[level];
  if (!filter) throw new Error("Unsupported aggregation level.");
  return db.prepare(`SELECT a.*, u.display_name, r.model_version, c.dataset_id
    FROM assessments a
    JOIN users u ON u.id = a.reviewer_id
    JOIN agent_runs r ON r.id = a.run_id
    JOIN cases c ON c.id = a.case_id
    WHERE a.status = 'Submitted' AND ${filter[0]}
    ORDER BY a.updated_at`).all(filter[1]);
}

export function previewAggregation(db, payload) {
  const { level, targetId, method = "mean" } = payload;
  const allowedMethods = new Set(["mean", "median", "weighted"]);
  if (!allowedMethods.has(method)) throw new Error("Unsupported aggregation method.");
  let assessments = assessmentRows(db, level, targetId);
  const included = Array.isArray(payload.includedAssessmentIds) ? new Set(payload.includedAssessmentIds) : null;
  if (included?.size) assessments = assessments.filter((item) => included.has(item.id));
  if (!assessments.length) throw new Error("No submitted assessments are available for this target.");

  const doctorWeights = payload.doctorWeights && typeof payload.doctorWeights === "object" ? payload.doctorWeights : {};
  const dimensionWeights = { ...DEFAULT_DIMENSION_WEIGHTS, ...(payload.dimensionWeights || {}) };
  const criteriaByAssessment = new Map();
  for (const assessment of assessments) {
    const rows = db.prepare("SELECT criterion_key, score FROM criterion_scores WHERE assessment_id = ?").all(assessment.id);
    criteriaByAssessment.set(assessment.id, Object.fromEntries(rows.map((row) => [row.criterion_key, Number(row.score)])));
  }

  const criterionResults = {};
  for (const criterion of CRITERIA) {
    const observations = assessments
      .map((assessment) => ({ reviewerId: assessment.reviewer_id, value: criteriaByAssessment.get(assessment.id)?.[criterion.key] }))
      .filter((item) => Number.isFinite(item.value));
    if (!observations.length) continue;
    let value;
    if (method === "median") value = median(observations.map((item) => item.value));
    else if (method === "weighted") {
      const weighted = observations.map((item) => ({ ...item, weight: Math.max(0, Number(doctorWeights[item.reviewerId] ?? 1)) }));
      const configuredWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
      const effective = configuredWeight > 0 ? weighted : weighted.map((item) => ({ ...item, weight: 1 }));
      const totalWeight = effective.reduce((sum, item) => sum + item.weight, 0);
      value = effective.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
    } else value = mean(observations.map((item) => item.value));
    const values = observations.map((item) => item.value);
    criterionResults[criterion.key] = {
      label: criterion.label,
      score: round(value),
      count: values.length,
      minimum: Math.min(...values),
      maximum: Math.max(...values),
      range: Math.max(...values) - Math.min(...values),
    };
  }

  const weightedCriteria = Object.entries(criterionResults).map(([key, item]) => ({
    key,
    score: item.score,
    weight: Math.max(0, Number(dimensionWeights[key] ?? 1)),
  }));
  const configuredDimensionWeight = weightedCriteria.reduce((sum, item) => sum + item.weight, 0);
  const effectiveCriteria = configuredDimensionWeight > 0 ? weightedCriteria : weightedCriteria.map((item) => ({ ...item, weight: 1 }));
  const totalDimensionWeight = effectiveCriteria.reduce((sum, item) => sum + item.weight, 0);
  const finalScore = effectiveCriteria.reduce((sum, item) => sum + item.score * item.weight, 0) / totalDimensionWeight;
  return {
    level,
    targetId,
    method,
    sampleSize: assessments.length,
    reviewerCount: new Set(assessments.map((item) => item.reviewer_id)).size,
    responseRunCount: new Set(assessments.map((item) => item.run_id)).size,
    includedAssessmentIds: assessments.map((item) => item.id),
    doctorWeights,
    dimensionWeights,
    criteria: criterionResults,
    finalScore: round(finalScore),
  };
}

export function finalizeAggregation(db, actorId, payload) {
  const result = previewAggregation(db, payload);
  const finalizationId = id("FIN");
  withTransaction(db, () => {
    db.prepare(`INSERT INTO finalizations (id, level, target_id, method, doctor_weights_json, dimension_weights_json,
      included_assessment_ids_json, result_json, final_score, locked, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(finalizationId, result.level, result.targetId, result.method, JSON.stringify(result.doctorWeights),
        JSON.stringify(result.dimensionWeights), JSON.stringify(result.includedAssessmentIds), JSON.stringify(result),
        result.finalScore, actorId, now());
    const lock = db.prepare("UPDATE assessments SET locked = 1, locked_by_finalization_id = ? WHERE id = ?");
    result.includedAssessmentIds.forEach((assessmentId) => lock.run(finalizationId, assessmentId));
    audit(db, actorId, "finalization.created", result.level, result.targetId, { finalizationId, method: result.method, sampleSize: result.sampleSize });
  });
  return { id: finalizationId, ...result, locked: true, createdAt: now() };
}
