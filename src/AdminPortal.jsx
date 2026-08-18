import { useEffect, useMemo, useState } from "react";
import {
  ChartBar, CheckCircle, Database, Eye, FileText, Gauge, LockKey, Sparkle,
  MagnifyingGlass, ShieldCheck, SlidersHorizontal, UsersThree, WarningCircle,
} from "@phosphor-icons/react";
import { api } from "./api.js";
import { CRITERIA, dateTime, titleCase } from "./constants.js";
import { EmptyState, ErrorState, LoadingState, MetricCard, Modal, PageHeader, StatusBadge } from "./components.jsx";

export const adminNav = [
  { key: "overview", label: "Overview", icon: Gauge },
  { key: "users", label: "Doctor accounts", icon: UsersThree },
  { key: "datasets", label: "Dataset governance", icon: Database },
  { key: "evaluations", label: "All evaluations", icon: FileText },
  { key: "aggregation", label: "Aggregation studio", icon: SlidersHorizontal },
  { key: "results", label: "Final results", icon: LockKey },
  { key: "feedback", label: "Feedback inbox", icon: Sparkle },
];

function useResource(loader, dependencies = []) {
  const [state, setState] = useState({ loading: true, error: "", value: null });
  const refresh = () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    loader().then((value) => setState({ loading: false, error: "", value })).catch((error) => setState({ loading: false, error: error.message, value: null }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, dependencies);
  return { ...state, refresh };
}

export function AdminPortal({ route, navigate, notify }) {
  if (route === "overview") return <AdminOverview navigate={navigate} />;
  if (route === "users") return <DoctorAccounts notify={notify} />;
  if (route === "datasets") return <DatasetGovernance notify={notify} />;
  if (route === "evaluations") return <EvaluationRegister />;
  if (route === "aggregation") return <AggregationStudio notify={notify} navigate={navigate} />;
  if (route === "results") return <FinalResults />;
  if (route === "feedback") return <FeedbackInbox />;
  return <AdminOverview navigate={navigate} />;
}

function AdminOverview({ navigate }) {
  const dashboard = useResource(api.dashboard, []);
  if (dashboard.loading) return <LoadingState label="Loading administrator overview…" />;
  if (dashboard.error) return <ErrorState message={dashboard.error} retry={dashboard.refresh} />;
  const m = dashboard.value.metrics;
  return <div className="content-page">
    <PageHeader eyebrow="ADMINISTRATOR CONTROL CENTRE" title="Evaluation programme overview" copy="Govern local users, datasets, clinician judgements and locked consensus results from one auditable workspace." actions={<button className="primary-button" onClick={() => navigate("aggregation")}>Open aggregation studio</button>} />
    <div className="notice-banner"><ShieldCheck size={21} /><span><b>Administrative boundary</b><small>Doctors cannot view peer assessments. Only this portal can inspect and aggregate the complete evaluation record.</small></span></div>
    <div className="metric-grid admin-metrics">
      <MetricCard icon={UsersThree} label="Registered doctors" value={m.doctors} note={`${m.activeDoctors} active locally`} tone="blue" />
      <MetricCard icon={Database} label="Datasets" value={m.datasets} note={`${m.pendingDatasets} pending review`} tone="amber" />
      <MetricCard icon={FileText} label="Submitted assessments" value={m.submittedAssessments} note={`${m.responseRuns} completed model runs`} tone="green" />
      <MetricCard icon={Sparkle} label="New platform feedback" value={m.newFeedback} note="Separate from clinical Ground Truth" tone="red" />
    </div>
    <div className="admin-overview-grid">
      <section className="surface workflow-card"><div className="section-heading"><div><h2>Governance workflow</h2><p>The current local operating sequence.</p></div></div>
        {["Doctor registers and selects an approved dataset", "DeepSeek receives visits 1–9 and generates a visit-10 plan", "Doctors independently score the same or different model runs", "Admin reviews evidence and chooses the aggregation rule", "Final result locks every included assessment"].map((label, index) => <div className="workflow-row" key={label}><span>{index + 1}</span><p>{label}</p>{index === 4 && <LockKey size={17} />}</div>)}
      </section>
      <section className="surface governance-card"><div className="section-heading"><div><h2>Data integrity status</h2><p>Imported Synthea-SG cohort.</p></div></div>
        <div className="integrity-score"><strong>{m.validCases}</strong><span><b>valid longitudinal cases</b><small>Actual records accepted without fabrication</small></span></div>
        <div className="integrity-note warning"><WarningCircle size={19} /><p>The supplied manifest declares 500 patients. Of 402 files present, 33 are truncated at 256 KiB and cannot be parsed; 98 files are absent. The platform accepts 369 complete cases and quarantines all 131 incomplete entries without fabrication.</p></div>
        <button className="secondary-button wide" onClick={() => navigate("datasets")}>Review dataset provenance</button>
      </section>
    </div>
  </div>;
}

function DoctorAccounts({ notify }) {
  const resource = useResource(api.adminUsers, []);
  const [query, setQuery] = useState("");
  const toggle = async (user) => { try { await api.setUserActive(user.id, !user.active); notify(`${user.displayName} is now ${user.active ? "inactive" : "active"}.`); resource.refresh(); } catch (error) { notify(error.message); } };
  if (resource.loading) return <LoadingState label="Loading local accounts…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.refresh} />;
  const users = resource.value.items.filter((item) => item.role === "doctor" && `${item.displayName} ${item.email}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="content-page"><PageHeader eyebrow="ACCESS GOVERNANCE" title="Doctor accounts" copy="Doctors self-register and receive immediate local access. Administrators can disable an account without deleting its audit history." />
    <div className="toolbar surface"><label className="search-field"><MagnifyingGlass size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search doctor or email" /></label><span className="table-count">{users.length} doctor accounts</span></div>
    <section className="surface table-surface"><table className="data-table"><thead><tr><th>Doctor</th><th>Status</th><th>Assessments</th><th>Datasets</th><th>Registered</th><th>Account control</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><b>{user.displayName}</b><small>{user.email}</small></td><td><StatusBadge>{user.active ? "Active" : "Inactive"}</StatusBadge></td><td>{user.assessmentCount}</td><td>{user.datasetCount}</td><td>{dateTime(user.createdAt)}</td><td><button className={user.active ? "danger-button compact" : "secondary-button compact"} onClick={() => toggle(user)}>{user.active ? "Deactivate" : "Reactivate"}</button></td></tr>)}</tbody></table>{!users.length && <EmptyState icon={UsersThree} title="No doctor accounts" copy="A doctor can create the first account from the unified login screen." />}</section>
  </div>;
}

function DatasetGovernance({ notify }) {
  const resource = useResource(api.datasets, []);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const open = async (dataset) => { setSelected(dataset); try { setDetail(await api.dataset(dataset.id)); } catch (error) { notify(error.message); } };
  const review = async (status, visibility) => { try { await api.reviewDataset(selected.id, { status, visibility }); notify(`${selected.name}: ${status}, ${visibility}.`); setSelected(null); setDetail(null); resource.refresh(); } catch (error) { notify(error.message); } };
  if (resource.loading) return <LoadingState label="Loading dataset register…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.refresh} />;
  const items = resource.value.items;
  return <div className="content-page"><PageHeader eyebrow="DATASET GOVERNANCE" title="Cohorts, provenance and sharing" copy="Inspect every uploaded source, retain missing-data evidence, and decide whether other doctors may access a cohort." />
    <section className="surface table-surface"><table className="data-table"><thead><tr><th>Dataset</th><th>Owner</th><th>Data quality</th><th>Status</th><th>Visibility</th><th>Imported</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><b>{item.name}</b><small>{item.sourceFilename}</small></td><td>{item.ownerName}</td><td><b className="success-text">{item.validCount} valid</b><small className={item.quarantinedCount ? "danger-text" : ""}>{item.quarantinedCount} quarantined · {item.declaredCount} declared</small></td><td><StatusBadge>{item.status}</StatusBadge></td><td>{titleCase(item.visibility)}</td><td>{dateTime(item.createdAt)}</td><td><button className="row-button" onClick={() => open(item)}><Eye size={17} />Review</button></td></tr>)}</tbody></table></section>
    {selected && <Modal wide title={selected.name} copy="Source provenance, validation results and the administrative release decision." onClose={() => { setSelected(null); setDetail(null); }}>
      {!detail ? <LoadingState label="Reading validation report…" /> : <div className="dataset-review"><div className="provenance-grid"><span>SHA-256<b className="hash-value">{selected.sourceSha256}</b></span><span>Format<b>{selected.sourceFormat}</b></span><span>Declared<b>{selected.declaredCount}</b></span><span>Accepted<b>{selected.validCount}</b></span></div>
        <div className="quality-summary"><div><CheckCircle size={20} /><span><b>{selected.validCount} records accepted</b><small>Stored with original evidence and per-case hash.</small></span></div><div><WarningCircle size={20} /><span><b>{selected.quarantinedCount} entries quarantined</b><small>No missing patient record was invented.</small></span></div></div>
        <div className="issue-list"><h3>Validation issues</h3>{detail.issues.slice(0, 12).map((issue) => <article key={issue.id}><StatusBadge tone={issue.severity === "high" ? "danger" : "warning"}>{issue.severity}</StatusBadge><div><b>{issue.code} · {issue.patientId || "dataset"}</b><p>{issue.message}</p></div></article>)}{!detail.issues.length && <p className="muted">No validation issues were recorded.</p>}</div>
        <div className="modal-actions"><button className="danger-button" onClick={() => review("Rejected", "private")}>Reject &amp; keep private</button><button className="secondary-button" onClick={() => review("Approved", "private")}>Approve for owner only</button><button className="primary-button" onClick={() => review("Approved", "shared")}>Approve &amp; share</button></div>
      </div>}
    </Modal>}
  </div>;
}

function EvaluationRegister() {
  const resource = useResource(api.assessments, []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  if (resource.loading) return <LoadingState label="Loading clinician evaluations…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.refresh} />;
  const items = resource.value.items.filter((item) => `${item.reviewerName} ${item.patientId} ${item.datasetName}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="content-page"><PageHeader eyebrow="GROUND TRUTH REGISTER" title="All clinician evaluations" copy="Inspect scores and dimension-level reasoning. These records are invisible to peer doctors." />
    <div className="toolbar surface"><label className="search-field"><MagnifyingGlass size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search doctor, patient or dataset" /></label><span className="table-count">{items.length} records</span></div>
    <section className="surface table-surface"><table className="data-table"><thead><tr><th>Reviewer</th><th>Patient / dataset</th><th>Model run</th><th>Overall</th><th>Status</th><th>Updated</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><b>{item.reviewerName}</b><small>{item.reviewerEmail}</small></td><td><b>{item.patientId}</b><small>{item.datasetName}</small></td><td><span className="mono">{item.runId}</span><small>{item.modelVersion}</small></td><td><span className="score-pill">{item.overallScore ?? "—"} / 5</span></td><td><StatusBadge>{item.locked ? "Locked" : item.status}</StatusBadge></td><td>{dateTime(item.updatedAt)}</td><td><button className="row-button" onClick={() => setSelected(item)}><Eye size={17} />Inspect</button></td></tr>)}</tbody></table>{!items.length && <EmptyState title="No evaluations yet" copy="Submitted doctor assessments will appear here." />}</section>
    {selected && <AssessmentDetail assessment={selected} onClose={() => setSelected(null)} />}
  </div>;
}

function AssessmentDetail({ assessment, onClose }) {
  return <Modal wide title={`${assessment.reviewerName} · ${assessment.patientId}`} copy={`Assessment ${assessment.id}, version ${assessment.version}.`} onClose={onClose}><div className="assessment-detail">
    <div className="detail-summary"><span>Overall score<b>{assessment.overallScore} / 5</b></span><span>Safety concern<b>{assessment.safetyIssue}</b></span><span>State<b>{assessment.locked ? "Locked" : assessment.status}</b></span><span>Model<b>{assessment.modelVersion}</b></span></div>
    <div className="criterion-detail-list">{assessment.criteria.map((item) => <article key={item.key}><div className="criterion-score"><strong>{item.score}</strong><small>/5</small></div><div><h3>{CRITERIA.find((criterion) => criterion.key === item.key)?.label || item.key}</h3><p>{item.feedback || "No free-text feedback provided."}</p><div className="tag-row">{[...item.tags, ...item.customTags].map((tag) => <span key={tag}>{tag}</span>)}{!item.tags.length && !item.customTags.length && <small>No tags selected</small>}</div></div></article>)}</div>
    <div className="case-feedback"><h3>Overall case feedback</h3><p>{assessment.caseFeedback || "No overall feedback provided."}</p></div>
  </div></Modal>;
}

function targetLabel(item, level) {
  if (level === "run") return `${item.patientId} · ${item.runId}`;
  if (level === "case") return `${item.patientId} · ${item.caseId}`;
  if (level === "dataset") return item.datasetName;
  return item.modelVersion;
}

function targetId(item, level) { return level === "run" ? item.runId : level === "case" ? item.caseId : level === "dataset" ? item.datasetId : item.modelVersion; }

function AggregationStudio({ notify, navigate }) {
  const resource = useResource(api.assessments, []);
  const [level, setLevel] = useState("run");
  const [selectedTarget, setSelectedTarget] = useState("");
  const [method, setMethod] = useState("mean");
  const [doctorWeights, setDoctorWeights] = useState({});
  const [dimensionWeights, setDimensionWeights] = useState(Object.fromEntries(CRITERIA.map((item) => [item.key, 1])));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitted = resource.value?.items?.filter((item) => item.status === "Submitted") || [];
  const targets = useMemo(() => { const map = new Map(); submitted.forEach((item) => map.set(targetId(item, level), targetLabel(item, level))); return [...map].map(([id, label]) => ({ id, label })); }, [submitted, level]);
  const included = submitted.filter((item) => targetId(item, level) === selectedTarget && !item.locked);
  const reviewers = [...new Map(included.map((item) => [item.reviewerId, { id: item.reviewerId, name: item.reviewerName }])).values()];
  useEffect(() => { setSelectedTarget(targets[0]?.id || ""); setPreview(null); }, [level, resource.loading]);
  const payload = { level, targetId: selectedTarget, method, includedAssessmentIds: included.map((item) => item.id), doctorWeights, dimensionWeights };
  const runPreview = async () => { setBusy(true); try { const value = await api.previewAggregation(payload); setPreview(value.result); } catch (error) { notify(error.message); } finally { setBusy(false); } };
  const finalize = async () => { if (!window.confirm("Finalize this result and lock all included assessments? This action cannot be edited in the current MVP.")) return; setBusy(true); try { const value = await api.finalizeAggregation(payload); notify(`Final result ${value.finalization.id} locked.`); navigate("results"); } catch (error) { notify(error.message); } finally { setBusy(false); } };
  if (resource.loading) return <LoadingState label="Preparing aggregation inputs…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.refresh} />;
  return <div className="content-page"><PageHeader eyebrow="CONSENSUS ENGINE" title="Aggregation studio" copy="Choose the unit of analysis, statistical method and two independent weight layers before locking a result." />
    <div className="aggregation-layout"><section className="surface aggregation-controls"><h2>1. Define the cohort</h2><div className="form-grid"><label>Aggregation level<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="run">Model response run</option><option value="case">Patient case</option><option value="dataset">Dataset</option><option value="model">Model version</option></select></label><label>Target<select value={selectedTarget} onChange={(event) => { setSelectedTarget(event.target.value); setPreview(null); }}><option value="">Select a target</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Method<select value={method} onChange={(event) => { setMethod(event.target.value); setPreview(null); }}><option value="mean">Arithmetic mean</option><option value="median">Median</option><option value="weighted">Weighted mean</option></select></label></div>
      <h2>2. Doctor weights</h2><p className="section-copy">Default is equal influence. A weight of zero explicitly excludes that doctor from the weighted calculation.</p><div className="weight-list">{reviewers.map((doctor) => <label key={doctor.id}><span>{doctor.name}<small>{doctor.id}</small></span><input min="0" step="0.1" type="number" value={doctorWeights[doctor.id] ?? 1} onChange={(event) => setDoctorWeights((current) => ({ ...current, [doctor.id]: Number(event.target.value) }))} /></label>)}{!reviewers.length && <p className="muted">No unlocked submitted assessments for this target.</p>}</div>
      <h2>3. Dimension weights</h2><div className="weight-list dimension-weights">{CRITERIA.map((criterion) => <label key={criterion.key}><span>{criterion.label}</span><input min="0" step="0.1" type="number" value={dimensionWeights[criterion.key]} onChange={(event) => setDimensionWeights((current) => ({ ...current, [criterion.key]: Number(event.target.value) }))} /></label>)}</div>
      <button className="primary-button wide" disabled={busy || !included.length} onClick={runPreview}>{busy ? "Calculating…" : "Preview governed result"}</button>
    </section>
    <section className="surface aggregation-result"><h2>Result preview</h2>{!preview ? <EmptyState icon={ChartBar} title="No preview calculated" copy="Select a target and calculate the result. Nothing is locked at the preview stage." /> : <><div className="consensus-score"><span><strong>{preview.finalScore}</strong><small>/5</small></span><div><b>{titleCase(preview.method)} result</b><p>{preview.sampleSize} assessments · {preview.reviewerCount} doctors · {preview.responseRunCount} response runs</p></div></div><div className="result-bars">{Object.entries(preview.criteria).map(([key, item]) => <div key={key}><span>{item.label}<small>{item.minimum}–{item.maximum} observed</small></span><div><i style={{ width: `${item.score / 5 * 100}%` }} /><b>{item.score}</b></div></div>)}</div><div className="lock-warning"><LockKey size={20} /><p><b>Finalization is permanent in this MVP.</b> The {preview.sampleSize} included assessments become read-only and retain this method and both weight maps in the audit record.</p></div><button className="danger-button wide" disabled={busy} onClick={finalize}><LockKey size={17} />Finalize and lock result</button></>}</section></div>
  </div>;
}

function FinalResults() {
  const resource = useResource(api.finalizations, []);
  const [selected, setSelected] = useState(null);
  if (resource.loading) return <LoadingState label="Loading locked results…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.refresh} />;
  const items = resource.value.items;
  return <div className="content-page"><PageHeader eyebrow="LOCKED OUTCOMES" title="Final evaluation results" copy="Every record preserves the target, aggregation method, weights and included assessment IDs used at finalization." />
    <section className="surface table-surface"><table className="data-table"><thead><tr><th>Finalization</th><th>Level / target</th><th>Method</th><th>Sample</th><th>Final score</th><th>Created</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><b>{item.id}</b><small>By {item.creatorName}</small></td><td><b>{titleCase(item.level)}</b><small>{item.targetId}</small></td><td>{titleCase(item.method)}</td><td>{item.includedAssessmentIds.length}</td><td><span className="score-pill">{item.finalScore} / 5</span></td><td>{dateTime(item.createdAt)}</td><td><button className="row-button" onClick={() => setSelected(item)}><Eye size={17} />Audit</button></td></tr>)}</tbody></table>{!items.length && <EmptyState icon={LockKey} title="No finalized results" copy="Preview and lock the first governed result in Aggregation Studio." />}</section>
    {selected && <Modal wide title={selected.id} copy="Immutable aggregation record and retained calculation settings." onClose={() => setSelected(null)}><div className="final-audit"><div className="detail-summary"><span>Final score<b>{selected.finalScore} / 5</b></span><span>Method<b>{titleCase(selected.method)}</b></span><span>Assessments<b>{selected.includedAssessmentIds.length}</b></span><span>State<b>Locked</b></span></div><h3>Dimension results</h3><div className="audit-criteria">{Object.entries(selected.result.criteria || {}).map(([key, item]) => <span key={key}>{item.label}<b>{item.score}</b></span>)}</div><h3>Included assessment IDs</h3><p className="mono-block">{selected.includedAssessmentIds.join("\n")}</p></div></Modal>}
  </div>;
}

function FeedbackInbox() {
  const resource = useResource(api.adminFeedback, []);
  if (resource.loading) return <LoadingState label="Loading platform feedback…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.refresh} />;
  const items = resource.value.items;
  return <div className="content-page"><PageHeader eyebrow="PRODUCT FEEDBACK" title="Doctor feedback inbox" copy="Interface and workflow comments are stored separately from clinical assessments and remain attributable to the submitting account." />
    <div className="feedback-grid">{items.map((item) => <article className="surface feedback-card" key={item.id}><header><StatusBadge>{item.status}</StatusBadge><span className="score-pill">{item.clarityRating} / 5 clarity</span></header><h3>{item.topic}</h3><p>{item.comment}</p><footer><span><b>{item.reviewerName}</b><small>{item.reviewerEmail}</small></span><small>{item.page} · {dateTime(item.submittedAt)}</small></footer></article>)}</div>{!items.length && <EmptyState icon={Sparkle} title="No platform feedback yet" copy="Doctor comments submitted from the portal will appear here." />}
  </div>;
}
