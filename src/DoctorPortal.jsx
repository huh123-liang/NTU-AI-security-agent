import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, ArrowsClockwise, Brain, CaretDown, ChartLineUp, ChatText, Check, ClipboardText, CloudArrowUp, Database,
  ArrowSquareOut, Eye, FileArrowUp, FileText, FolderOpen, Gauge, Info, ListChecks, MagnifyingGlass, Plus, Robot,
  ShareNetwork, ShieldCheck, Sparkle, SquaresFour, Stop, TrendUp, UploadSimple, Warning, X,
} from "@phosphor-icons/react";
import { CartesianGrid, Line, LineChart, RadialBar, RadialBarChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, fileToBase64 } from "./api.js";
import { CRITERIA, REASON_TAGS, dateTime, measurement, shortDate, titleCase } from "./constants.js";
import { ConfidentialNote, EmptyState, ErrorState, InfoTip, LoadingState, MetricCard, Modal, PageHeader, StatusBadge } from "./components.jsx";

export const doctorNav = [
  { key: "overview", label: "Overview", icon: SquaresFour },
  { key: "datasets", label: "Datasets", icon: Database },
  { key: "cases", label: "Cases", icon: FolderOpen },
  { key: "workspace", label: "Workspace", icon: ClipboardText },
  { key: "assessments", label: "My Assessments", icon: ListChecks },
];

export function DoctorPortal({ route, routeId, navigate, notify, user }) {
  if (route === "overview") return <DoctorOverview navigate={navigate} />;
  if (route === "datasets") return <DatasetsPage navigate={navigate} notify={notify} />;
  if (route === "cases") return <CasesPage datasetId={routeId} navigate={navigate} />;
  if (route === "workspace") {
    const [caseId, initialRunId = ""] = routeId.split("~");
    return caseId ? <Workspace caseId={caseId} initialRunId={initialRunId} notify={notify} scoringSuspended={user?.accessStatus === "scoring_suspended"} /> : <WorkspaceLanding navigate={navigate} />;
  }
  if (route === "assessments") return <MyAssessments navigate={navigate} />;
  return <DoctorOverview navigate={navigate} />;
}

function DoctorOverview({ navigate }) {
  const [metrics, setMetrics] = useState(null);
  const [datasets, setDatasets] = useState([]);
  useEffect(() => { Promise.all([api.dashboard(), api.datasets()]).then(([dashboard, data]) => { setMetrics(dashboard.metrics); setDatasets(data.items.slice(0, 3)); }); }, []);
  return <div className="content-page">
    <PageHeader eyebrow="DOCTOR PORTAL" title="Clinical evaluation workspace" copy="Select a longitudinal dataset, inspect a model response and preserve an independent clinical judgement." actions={<button className="primary-button" onClick={() => navigate("datasets")}><CloudArrowUp size={17} />Add dataset</button>} />
    <div className="metrics-grid four"><MetricCard icon={Database} label="Available datasets" value={metrics?.datasets ?? "—"} note="Private and approved shared cohorts" /><MetricCard icon={FolderOpen} label="Available cases" value={metrics?.cases ?? "—"} note="Validated longitudinal records" tone="teal" /><MetricCard icon={Robot} label="Official responses" value={metrics?.runs ?? "—"} note="Fixed answers available for scoring" tone="purple" /><MetricCard icon={ListChecks} label="Submitted reviews" value={metrics?.submitted ?? "—"} note="Editable until final lock" tone="red" /></div>
    <section className="dashboard-grid"><article className="surface dashboard-callout"><span className="callout-icon"><Brain size={27} /></span><div><span className="eyebrow">EVALUATION FLOW</span><h2>From source evidence to an auditable score</h2><p>The model receives visits 1–9. Visit 10 remains withheld as reference evidence for the clinician.</p><div className="flow-steps"><span><b>1</b>Select case</span><span><b>2</b>Open Official Run</span><span><b>3</b>Score six dimensions</span><span><b>4</b>Submit evidence-linked feedback</span></div></div><button className="secondary-button" onClick={() => navigate("datasets")}>Start evaluation<ArrowRight size={16} /></button></article>
      <article className="surface"><div className="section-heading"><div><span className="eyebrow">RECENT DATASETS</span><h2>Ready for review</h2></div></div><div className="compact-list">{datasets.map((dataset) => <button key={dataset.id} onClick={() => navigate("cases", dataset.id)}><Database size={19} /><span><b>{dataset.name}</b><small>{dataset.validCount} valid · {dataset.quarantinedCount} quarantined</small></span><StatusBadge>{dataset.visibility === "shared" ? "Shared" : dataset.status}</StatusBadge><ArrowRight size={15} /></button>)}</div></article>
    </section>
  </div>;
}

function DatasetsPage({ navigate, notify }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const refresh = () => api.datasets().then((result) => setItems(result.items)).finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []);
  const inspect = async (id) => { const result = await api.dataset(id); setSelected(result); };
  return <div className="content-page"><PageHeader eyebrow="DATA GOVERNANCE" title="Datasets" copy="Your uploads remain private to you and the administrator. Approved system cohorts are available to every doctor." actions={<button className="primary-button" onClick={() => setUploadOpen(true)}><UploadSimple size={17} />Upload dataset</button>} />
    {loading ? <LoadingState label="Loading datasets…" /> : <section className="surface data-table"><div className="table-head dataset-row"><span>Dataset</span><span>Owner / access</span><span>Quality</span><span>Status</span><span /></div>{items.map((dataset) => <div className="table-row dataset-row" key={dataset.id}><div className="cell-title"><Database size={20} /><span><b>{dataset.name}</b><small>{dataset.sourceFilename}</small></span></div><div><b>{dataset.ownerName}</b><small>{dataset.visibility === "shared" ? "Approved shared cohort" : "Private to uploader + Admin"}</small></div><div><b>{dataset.validCount} valid</b><small>{dataset.quarantinedCount} quarantined · {dataset.declaredCount} declared</small></div><div><StatusBadge>{dataset.status}</StatusBadge></div><div className="row-actions"><button className="text-button" onClick={() => inspect(dataset.id)}><Eye size={15} />Quality</button><button className="secondary-button compact" disabled={!dataset.validCount} onClick={() => navigate("cases", dataset.id)}>Open<ArrowRight size={14} /></button></div></div>)}</section>}
    {uploadOpen && <UploadDatasetModal onClose={() => setUploadOpen(false)} onDone={(result) => { setUploadOpen(false); refresh(); notify(`Dataset imported: ${result.valid} valid, ${result.quarantined} quarantined`); }} />}
    {selected && <DatasetQualityModal data={selected} onClose={() => setSelected(null)} />}
  </div>;
}

function UploadDatasetModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true); setError("");
    try { const result = await api.uploadDataset({ fileName: file.name, name: name || file.name.replace(/\.[^.]+$/, ""), description, contentBase64: await fileToBase64(file) }); onDone(result); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <Modal title="Upload a clinical dataset" copy="Supported formats: Synthea-SG ZIP, standard JSON and the platform CSV template." onClose={onClose} wide><div className="upload-zone"><FileArrowUp size={38} /><h3>{file ? file.name : "Choose a dataset file"}</h3><p>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ready for local validation` : "The original file is retained locally and fingerprinted with SHA-256 for evidence traceability."}</p><label className="secondary-button file-picker">Select ZIP, JSON or CSV<input type="file" accept=".zip,.json,.csv" onChange={(event) => { const next = event.target.files?.[0]; setFile(next); if (next && !name) setName(next.name.replace(/\.[^.]+$/, "")); }} /></label></div><div className="form-grid"><label>Dataset name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Longitudinal chronic-care cohort" /></label><label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Purpose, source and limitations…" /></label></div><div className="import-policy"><ShieldCheck size={18} /><span><b>Private by default</b><small>Only you and the administrator can access this upload until Admin shares it.</small></span></div>{error && <div className="form-error"><Warning size={17} />{error}</div>}<div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!file || busy} onClick={submit}>{busy ? <><ArrowsClockwise className="spin" size={16} />Validating and importing…</> : <><UploadSimple size={16} />Import dataset</>}</button></div></Modal>;
}

function DatasetQualityModal({ data, onClose }) {
  const { dataset, issues } = data;
  return <Modal title="Data quality report" copy={`${dataset.name} · SHA-256 ${dataset.sourceSha256.slice(0, 16)}…`} onClose={onClose} wide><div className="quality-metrics"><div><small>Declared</small><strong>{dataset.declaredCount}</strong></div><div className="success"><small>Valid</small><strong>{dataset.validCount}</strong></div><div className="danger"><small>Quarantined</small><strong>{dataset.quarantinedCount}</strong></div><div><small>Schema</small><strong>{dataset.schemaVersion}</strong></div></div><div className="quality-note"><Info size={17} /><p>Missing source records are never reconstructed. They remain in the quarantine report and cannot enter the evaluation workflow.</p></div><div className="issue-list"><div className="issue-header"><b>Validation findings</b><span>{issues.length} displayed</span></div>{issues.slice(0, 80).map((issue) => <div key={issue.id}><StatusBadge tone={issue.severity === "critical" || issue.severity === "high" ? "danger" : "warning"}>{issue.severity}</StatusBadge><span><b>{issue.patientId || "Dataset"}</b><small>{issue.message}</small></span><code>{issue.code}</code></div>)}</div></Modal>;
}

function CasesPage({ datasetId, navigate }) {
  const [datasets, setDatasets] = useState([]);
  const [selectedId, setSelectedId] = useState(datasetId || "");
  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.datasets().then((result) => { setDatasets(result.items); if (!selectedId && result.items[0]) setSelectedId(result.items[0].id); }); }, []);
  useEffect(() => { if (!selectedId) return; setLoading(true); const timer = window.setTimeout(() => api.cases(selectedId, { search }).then((result) => { setCases(result.items); setTotal(result.total); }).finally(() => setLoading(false)), 180); return () => window.clearTimeout(timer); }, [selectedId, search]);
  return <div className="content-page"><PageHeader eyebrow="CASE LIBRARY" title="Validated longitudinal cases" copy="Choose a patient record. Every visible case passed structural validation and retains its original evidence." actions={<select className="dataset-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select>} />
    <div className="list-toolbar"><label><MagnifyingGlass size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient ID or condition" /></label><span>{total} eligible cases</span></div>{loading ? <LoadingState label="Loading validated cases…" /> : <section className="surface data-table"><div className="table-head case-row"><span>Patient</span><span>Longitudinal context</span><span>Demographics</span><span>Evidence</span><span /></div>{cases.map((item) => <button className="table-row case-row clickable" key={item.id} onClick={() => navigate("workspace", item.id)}><div className="cell-title"><span className="patient-avatar">{item.patientId.slice(-2)}</span><span><b>{item.patientId}</b><small>Synthetic patient</small></span></div><div><b>{item.condition}</b><small>{item.visits} completed visits</small></div><div><b>{item.age || "—"} years · {titleCase(item.sex)}</b><small>{titleCase(item.ethnicity)}</small></div><div><StatusBadge>Validated</StatusBadge><small>SHA {item.sourceSha256.slice(0, 8)}…</small></div><ArrowRight size={16} /></button>)}</section>}
  </div>;
}

function WorkspaceLanding({ navigate }) {
  return <EmptyState icon={ClipboardText} title="Select a case to open the workspace" copy="Choose a validated longitudinal patient from the case library." action={<button className="primary-button" onClick={() => navigate("cases")}>Browse cases<ArrowRight size={16} /></button>} />;
}

function Workspace({ caseId, initialRunId, notify, scoringSuspended }) {
  const [caseData, setCaseData] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [assessment, setAssessment] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [rawEvidenceTarget, setRawEvidenceTarget] = useState(null);
  const [selectedEvidence, setSelectedEvidence] = useState(null);

  useEffect(() => { setLoading(true); Promise.all([api.case(caseId), api.runs(caseId)]).then(([caseResult, runResult]) => { setCaseData(caseResult.case); setRuns(runResult.items); setSelectedRunId(runResult.items.find((item) => item.id === initialRunId)?.id || runResult.items.find((item) => item.studyStatus === "Official")?.id || ""); }).catch((failure) => setError(failure.message)).finally(() => setLoading(false)); }, [caseId, initialRunId]);
  const selectedRun = runs.find((item) => item.id === selectedRunId);
  useEffect(() => {
    if (!runs.some((run) => run.status === "Running")) return undefined;
    const timer = window.setInterval(() => api.runs(caseId).then((result) => setRuns(result.items)).catch(() => {}), 900);
    return () => window.clearInterval(timer);
  }, [caseId, runs]);
  useEffect(() => {
    setSelectedEvidence(null);
    if (!selectedRunId || selectedRun?.status !== "Completed") { setAssessment(null); setDraft(null); return; }
    api.assessment(selectedRunId).then((result) => { const value = result.assessment; setAssessment(value); setDraft(buildDraft(value)); });
  }, [selectedRunId, selectedRun?.status]);
  const save = async (status) => { if (!draft) return; setSaving(true); setError(""); try { const result = await api.saveAssessment(selectedRunId, { ...draft, status, criteria: CRITERIA.map((criterion) => ({ key: criterion.key, ...draft.criteria[criterion.key] })) }); setAssessment(result.assessment); setDraft(buildDraft(result.assessment)); notify(status === "Submitted" ? "Assessment submitted and remains editable until Admin locks it" : "Draft saved to SQLite"); } catch (failure) { setError(failure.message); } finally { setSaving(false); } };
  if (loading) return <LoadingState />;
  if (error && !caseData) return <ErrorState message={error} />;
  const visits = caseData?.clinicalData?.visits || [];
  const runComplete = selectedRun?.status === "Completed";
  return <div className="workspace-shell"><div className="workflow-bar"><span className="complete"><b>1</b><i>Case context<small>Visits 1–9 + withheld reference</small></i></span><span className={runComplete ? "complete" : "active"}><b>2</b><i>Official AI response<small>Pre-generated and fixed</small></i></span><span className={runComplete ? "active" : ""}><b>3</b><i>Evaluation<small>Score and explain</small></i></span><span className={assessment?.status === "Submitted" ? "complete" : ""}><b>4</b><i>Submit<small>Editable until final lock</small></i></span></div>
    <div className="workspace-grid"><section className="workspace-column patient-column"><div className="column-heading"><span>SIMULATED PATIENT DATA</span><button className="text-button" onClick={() => setRawEvidenceTarget({ visitNumber: 10, jsonPath: "$.visits[9]" })}><Eye size={14} />Clinical record</button></div><PatientContext patient={caseData} visits={visits} selectedEvidence={selectedEvidence} /></section>
      <section className="workspace-column response-column"><div className="column-heading"><span>OFFICIAL AI RESPONSE · VISIT 10 PLAN</span><div className="run-controls"><StatusBadge tone={selectedRun?.studyStatus === "Official" ? "success" : "warning"}>{selectedRun?.studyStatus || "Awaiting Admin"}</StatusBadge></div></div>{error && <div className="inline-alert"><Warning size={16} />{error}</div>}{selectedRun ? <ResponsePanel run={selectedRun} selectedEvidence={selectedEvidence} onSelectEvidence={setSelectedEvidence} onOpenRaw={(evidence) => setRawEvidenceTarget(evidence)} /> : <EmptyState icon={Robot} title="Official response pending" copy="An administrator must pre-generate the fixed AI response before independent doctor scoring begins." />}</section>
      <section className="workspace-column review-column"><div className="column-heading"><span>SAFETY REVIEW COCKPIT</span><InfoTip>Scores are private from other doctors.</InfoTip></div>{scoringSuspended ? <EmptyState icon={ShieldCheck} title="Scoring is suspended" copy="You can review your history, but this account cannot create or edit assessments until an administrator reactivates scoring." /> : runComplete && draft ? <ReviewCockpit draft={draft} setDraft={setDraft} assessment={assessment} saving={saving} onSave={save} /> : <EmptyState icon={Gauge} title={selectedRun?.status === "Running" ? "Generation in progress" : "Choose a completed run"} copy="The rubric opens after a completed AI response is selected." />}</section></div>
    {rawEvidenceTarget && <ClinicalRecordModal patient={caseData} target={rawEvidenceTarget} onClose={() => setRawEvidenceTarget(null)} />}
  </div>;
}

function buildDraft(assessment) {
  const criteria = Object.fromEntries(CRITERIA.map((item) => { const existing = assessment?.criteria?.find((score) => score.key === item.key); return [item.key, existing || { score: null, feedback: "", tags: [], customTags: [] }]; }));
  return { criteria, safetyIssue: assessment?.safetyIssue || "Undecided", reasonTags: assessment?.reasonTags || [], caseFeedback: assessment?.caseFeedback || "" };
}

const TREND_METRICS = [
  { key: "hba1c", label: "HbA1c", color: "#c8102e" },
  { key: "systolic_bp", label: "BP", color: "#2a6aa5" },
  { key: "egfr", label: "eGFR", color: "#087a5b" },
  { key: "ldl_cholesterol", label: "LDL", color: "#7857a8" },
];

function PatientContext({ patient, visits, selectedEvidence }) {
  const timelineRefs = useRef({});
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const availableMetrics = TREND_METRICS.filter((metric) => visits.some((visit) => measurement(visit, metric.key) !== undefined));
  useEffect(() => {
    if (!selectedEvidence) return;
    window.setTimeout(() => timelineRefs.current[selectedEvidence.visitNumber]?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }, [selectedEvidence]);
  const latest = visits.at(-1) || {};
  return <div className="patient-scroll"><article className="patient-summary"><header className="patient-summary-head"><div className="patient-identity"><span className="patient-avatar large">{patient.patientId.slice(-2)}</span><div><span className="summary-kicker">PATIENT RECORD</span><h2>{patient.patientId}</h2><p>{patient.age || "—"}-year-old · {titleCase(patient.sex)} · {titleCase(patient.ethnicity)}</p></div></div><StatusBadge>Synthetic</StatusBadge></header><dl className="patient-meta-strip"><div><dt>Dataset</dt><dd title={patient.datasetName}>{patient.datasetName}</dd></div><div><dt>Reference visit</dt><dd>{shortDate(latest.date)}</dd></div><div><dt>History</dt><dd>{visits.length} longitudinal visits</dd></div></dl><div className="diagnosis-block"><div className="diagnosis-heading"><b>Active conditions</b><span>{patient.conditions.length}</span></div><ul>{patient.conditions.map((condition) => <li key={condition.key || condition.display}>{condition.display || titleCase(condition.key)}</li>)}</ul></div></article>
    <article className="research-signals"><div className="subsection-title"><b>Research signals</b><span>Rule-based · source-backed</span></div><SignalSummary visits={visits} /></article>
    <article className="trend-card"><div className="subsection-title"><b>Longitudinal trends</b><span>Four source measurements</span></div><div className="small-multiple-grid">{availableMetrics.map((metric) => <TrendMini key={metric.key} metric={metric} visits={visits} selectedEvidence={selectedEvidence} />)}</div><div className="trend-legend"><small>Each panel has its own measurement scale. Select an evidence citation in the AI response to highlight its source point.</small></div></article>
    <article className="timeline-card compact"><div className="subsection-title"><b>Visit strip</b><span>{visits.length} visits · <button className="text-button" onClick={() => setTimelineExpanded((value) => !value)}>{timelineExpanded ? "Collapse timeline" : "View full timeline"}</button></span></div><div className={`timeline compact-timeline${timelineExpanded ? " expanded" : ""}`}>{visits.map((visit, index) => { const selected = selectedEvidence?.visitNumber === Number(visit.visit_number); return <button ref={(element) => { timelineRefs.current[visit.visit_number] = element; }} type="button" key={`${visit.visit_number}-${visit.date}`} className={`${index === visits.length - 1 ? "reference" : ""}${selected ? " evidence-selected" : ""}`}><i /><span><b>V{visit.visit_number}</b><small>{shortDate(visit.date)}</small></span><p>{selected ? `${selectedEvidence.metricLabel}: ${selectedEvidence.value} ${selectedEvidence.unit}` : visit.consultation?.assessment_and_plan?.[0]?.status?.replaceAll("_", " ") || "Chronic-care review"}</p></button>; })}</div></article>
    <p className="source-note">Source: synthetic research dataset · SHA {patient.sourceSha256.slice(0, 16)}…</p></div>;
}

function TrendMini({ metric, visits, selectedEvidence }) {
  const data = visits.map((visit) => ({ visitNumber: Number(visit.visit_number), date: `V${visit.visit_number}`, value: measurement(visit, metric.key) }));
  const selected = selectedEvidence?.metricKey === metric.key ? data.find((item) => item.visitNumber === selectedEvidence.visitNumber) : null;
  return <section className={`mini-trend${selected ? " evidence-selected" : ""}`}><header><b>{metric.label}</b><small>{data.at(-1)?.value ?? "—"}</small></header><ResponsiveContainer width="100%" height={86}><LineChart data={data} margin={{ top: 5, right: 2, left: -22, bottom: 0 }}><CartesianGrid stroke="#edf1f5" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 7, fill: "#8794a6" }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 7, fill: "#8794a6" }} width={28} /><Tooltip formatter={(value) => [`${value}`, metric.label]} /><Line type="monotone" dataKey="value" stroke={metric.color} strokeWidth={2} dot={false} connectNulls />{selected?.value !== undefined && <ReferenceDot x={selected.date} y={selected.value} r={4} fill="#fff" stroke="#c8102e" strokeWidth={2} />}</LineChart></ResponsiveContainer></section>;
}

function SignalSummary({ visits }) {
  const latest = visits.at(-2) || visits.at(-1) || {};
  const signals = [];
  const bp = measurement(latest, "systolic_bp"); const hba1c = measurement(latest, "hba1c"); const egfr = measurement(latest, "egfr"); const ldl = measurement(latest, "ldl_cholesterol");
  if (Number.isFinite(bp) && bp >= 140) signals.push(`Clinic systolic BP ${bp} mmHg in visit ${latest.visit_number}.`);
  if (Number.isFinite(hba1c) && hba1c >= 7) signals.push(`HbA1c ${hba1c}% in visit ${latest.visit_number}.`);
  if (Number.isFinite(egfr) && egfr < 60) signals.push(`eGFR ${egfr} mL/min/1.73m² in visit ${latest.visit_number}.`);
  if (Number.isFinite(ldl) && ldl >= 3) signals.push(`LDL ${ldl} mmol/L in visit ${latest.visit_number}.`);
  return signals.length ? <ul>{signals.slice(0, 3).map((signal) => <li key={signal}>{signal}</li>)}</ul> : <p>No rule-based research signal was triggered in the latest model-input visit.</p>;
}

const GENERATION_STAGES = [
  ["preparing_data", "Preparing data"], ["calling_model", "Calling model"], ["processing_response", "Processing response"],
  ["validating_evidence", "Validating evidence"], ["saving", "Saved"],
];

function GenerationTrail({ run }) {
  const visited = new Set((run.stageHistory || []).map((item) => item.stage));
  const activeIndex = GENERATION_STAGES.findIndex(([stage]) => stage === run.stage);
  return <div className={`generation-trail status-${String(run.status).toLowerCase()}`}>{GENERATION_STAGES.map(([stage, label], index) => { const done = visited.has(stage) || run.status === "Completed"; const active = run.status === "Running" && index === activeIndex; return <div key={stage} className={`${done ? "done" : ""}${active ? " active" : ""}`}><i>{done && !active ? <Check size={10} /> : index + 1}</i><span>{label}</span></div>; })}</div>;
}

function GenerationPanel({ run, onCancel, onRetry }) {
  const running = run.status === "Running";
  return <div className="generation-state"><div className="generation-orbit"><Robot size={28} /></div><span className="eyebrow">MODEL RUN · {run.id.slice(-8)}</span><h2>{running ? "Building an evidence-linked response" : `${run.status} generation`}</h2><p>{running ? `The backend is currently ${String(run.stage || "preparing_data").replaceAll("_", " ")}. This state is persisted in SQLite and will recover after refresh.` : run.errorMessage || "This run ended before a response was saved."}</p><div className="generation-data-route" aria-label="Live generation data route"><span><Database size={15} />Visits 1–9</span><ArrowRight size={13} /><span className={running ? "active" : ""}><Robot size={15} />Model</span><ArrowRight size={13} /><span><ShieldCheck size={15} />Evidence check</span></div><GenerationTrail run={run} />{running ? <button className="danger-button" onClick={onCancel}><Stop size={15} />Cancel generation</button> : <button className="secondary-button" onClick={onRetry}><ArrowsClockwise size={15} />Retry as new run</button>}</div>;
}

function EvidenceLensCard({ evidence, onOpenRaw }) {
  if (!evidence) return null;
  return <article className="evidence-lens"><header><span className="evidence-lens-icon"><ShareNetwork size={18} /></span><div><span className="eyebrow">EVIDENCE LENS</span><h3>Verified source connection</h3></div><StatusBadge>Verified</StatusBadge></header><div className="evidence-lens-grid"><span><small>Source</small><b>Visit {evidence.visitNumber} · {shortDate(evidence.date)}</b></span><span><small>Metric</small><b>{evidence.metricLabel}</b></span><span><small>Patient value</small><b>{evidence.value} {evidence.unit}</b></span></div><div className="evidence-path"><small>Original JSON path</small><code>{evidence.jsonPath}</code></div><button className="text-button" onClick={() => onOpenRaw(evidence)}>Open original evidence<ArrowSquareOut size={13} /></button></article>;
}

function ResponsePanel({ run, selectedEvidence, onSelectEvidence, onOpenRaw, onCancel, onRetry }) {
  if (run.status !== "Completed") return <GenerationPanel run={run} onCancel={onCancel} onRetry={onRetry} />;
  const evidenceMap = new Map((run.evidenceLinks || []).map((item) => [item.id.toUpperCase(), item]));
  const lines = String(run.output || "").split("\n");
  const inline = (line) => renderInlineMarkdown(line, evidenceMap, onSelectEvidence);
  return <div className="response-scroll"><div className="response-meta"><span><Robot size={17} /><b>{run.provider}</b><small>{run.modelVersion}</small></span><span><FileText size={17} /><b>{run.promptVersion}</b><small>{dateTime(run.completedAt)}</small></span><StatusBadge>{run.status}</StatusBadge></div>{selectedEvidence && <EvidenceLensCard evidence={selectedEvidence} onOpenRaw={onOpenRaw} />}<article className="model-output">{lines.map((line, index) => line.startsWith("### ") ? <h3 key={index}>{inline(line.slice(4))}</h3> : line.startsWith("## ") ? <h2 key={index}>{inline(line.slice(3))}</h2> : /^\d+\./.test(line.trim()) ? <p className="numbered" key={index}>{inline(line)}</p> : line.trim().startsWith("-") ? <p className="bullet" key={index}>{inline(line.replace(/^\s*-\s*/, ""))}</p> : line.trim() ? <p key={index}>{inline(line)}</p> : null)}</article><div className="evidence-callout"><ShieldCheck size={19} /><div><b>{run.evidenceLinks?.length || 0} verified evidence links</b><p>Only Visit 1–9 source IDs validated by the backend are interactive. Visit 10 remains withheld reference evidence.</p>{run.invalidEvidenceCitations?.length > 0 && <small>{run.invalidEvidenceCitations.length} unverified citation token(s) were not linked.</small>}</div></div><GenerationTrail run={run} /></div>;
}

function renderInlineMarkdown(text, evidenceMap = new Map(), onSelectEvidence = () => {}) {
  return String(text).split(/(\*\*[^*]+\*\*|\[EVID:[A-Z0-9-]+\])/gi).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    const citation = part.match(/^\[EVID:([A-Z0-9-]+)\]$/i);
    if (citation) {
      const evidence = evidenceMap.get(citation[1].toUpperCase());
      return evidence ? <button key={`${part}-${index}`} className="evidence-citation" onClick={() => onSelectEvidence(evidence)}>V{evidence.visitNumber} · {evidence.metricLabel}</button> : <span key={`${part}-${index}`} className="evidence-unverified">Unverified source</span>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function ReviewCockpit({ draft, setDraft, assessment, saving, onSave }) {
  const [customInputs, setCustomInputs] = useState({});
  const [expandedFeedback, setExpandedFeedback] = useState(() => new Set(CRITERIA.filter((criterion) => { const value = draft.criteria[criterion.key]; return value.feedback || value.tags.length || value.customTags.length; }).map((criterion) => criterion.key)));
  const scores = CRITERIA.map((criterion) => draft.criteria[criterion.key].score).filter(Boolean);
  const overall = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  const updateCriterion = (key, changes) => setDraft((current) => ({ ...current, criteria: { ...current.criteria, [key]: { ...current.criteria[key], ...changes } } }));
  const allScored = scores.length === CRITERIA.length;
  const locked = assessment?.locked;
  const toggleFeedback = (key) => setExpandedFeedback((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return <div className="review-scroll"><div className="overall-score"><div className="score-ring"><ResponsiveContainer width="100%" height="100%"><RadialBarChart innerRadius="76%" outerRadius="100%" data={[{ value: overall * 20, fill: "#c8102e" }]} startAngle={90} endAngle={-270}><RadialBar dataKey="value" cornerRadius={3} background={{ fill: "#e9eef3" }} /></RadialBarChart></ResponsiveContainer><strong>{overall ? overall.toFixed(1) : "—"}<small>/5</small></strong></div><div><span>OVERALL ASSESSMENT</span><h2>{overall >= 4 ? "Good" : overall >= 3 ? "Moderate" : overall ? "Needs attention" : "Not scored"}</h2><p>{scores.length} of {CRITERIA.length} dimensions completed.</p></div>{locked && <StatusBadge tone="danger">Locked</StatusBadge>}</div>
    <div className="rubric-intro"><b>Clinical rubric</b><span>1 = Poor · 5 = Excellent</span></div><div className="criteria-list">{CRITERIA.map((criterion, index) => { const value = draft.criteria[criterion.key]; const isOpen = expandedFeedback.has(criterion.key); const feedbackCount = value.tags.length + value.customTags.length + (value.feedback.trim() ? 1 : 0); return <article className={`criterion-card${isOpen ? " feedback-open" : ""}`} key={criterion.key}><div className="criterion-title"><span>{index + 1}</span><div><b>{criterion.label}</b><small>{criterion.description}</small></div><InfoTip>Feedback is optional and visible only to Admin.</InfoTip></div><div className="score-buttons" role="radiogroup" aria-label={criterion.label}>{[1, 2, 3, 4, 5].map((score) => <button disabled={locked} key={score} aria-checked={value.score === score} role="radio" className={value.score === score ? "selected" : ""} onClick={() => updateCriterion(criterion.key, { score })}>{score}</button>)}</div><button type="button" className="criterion-feedback-toggle" aria-expanded={isOpen} onClick={() => toggleFeedback(criterion.key)}><ChatText size={13} /><span>{feedbackCount ? `${feedbackCount} feedback item${feedbackCount > 1 ? "s" : ""}` : "Add optional feedback"}</span><CaretDown className={isOpen ? "open" : ""} size={13} /></button>{isOpen && <div className="criterion-feedback"><div className="feedback-tags">{criterion.tags.map((tag) => <button disabled={locked} key={tag} className={value.tags.includes(tag) ? "selected" : ""} onClick={() => updateCriterion(criterion.key, { tags: value.tags.includes(tag) ? value.tags.filter((item) => item !== tag) : [...value.tags, tag] })}>{value.tags.includes(tag) && <Check size={11} />}{tag}</button>)}{value.customTags.map((tag) => <button disabled={locked} className="selected custom" key={tag} onClick={() => updateCriterion(criterion.key, { customTags: value.customTags.filter((item) => item !== tag) })}>{tag}<X size={11} /></button>)}</div><div className="custom-tag-row"><input disabled={locked} value={customInputs[criterion.key] || ""} onChange={(event) => setCustomInputs({ ...customInputs, [criterion.key]: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter" && event.currentTarget.value.trim()) { event.preventDefault(); const tag = event.currentTarget.value.trim(); updateCriterion(criterion.key, { customTags: [...new Set([...value.customTags, tag])] }); setCustomInputs({ ...customInputs, [criterion.key]: "" }); } }} placeholder="Add a custom tag and press Enter" /></div><textarea disabled={locked} value={value.feedback} onChange={(event) => updateCriterion(criterion.key, { feedback: event.target.value })} placeholder={`Optional feedback on ${criterion.label.toLowerCase()}…`} /></div>}</article>; })}</div>
    <section className="review-section"><b>Safety-critical check</b><span>Any unsafe or potentially harmful recommendations?</span><div className="binary-choice">{["Yes", "No", "Undecided"].map((value) => <button disabled={locked} className={draft.safetyIssue === value ? "selected" : ""} key={value} onClick={() => setDraft({ ...draft, safetyIssue: value })}>{value}</button>)}</div></section>
    <section className="review-section"><b>Missing / needs clarification</b><span>Select all that apply.</span><div className="feedback-tags">{REASON_TAGS.map((tag) => <button disabled={locked} className={draft.reasonTags.includes(tag) ? "selected" : ""} key={tag} onClick={() => setDraft({ ...draft, reasonTags: draft.reasonTags.includes(tag) ? draft.reasonTags.filter((item) => item !== tag) : [...draft.reasonTags, tag] })}>{tag}</button>)}</div></section>
    <label className="case-feedback"><b>Overall case feedback <small>(optional)</small></b><textarea disabled={locked} value={draft.caseFeedback} onChange={(event) => setDraft({ ...draft, caseFeedback: event.target.value })} placeholder="Summarise the most important concern or strength…" /></label>
    <div className="review-actions"><button className="secondary-button" disabled={!allScored || saving || locked} onClick={() => onSave("Draft")}>Save draft</button><button className="primary-button" disabled={!allScored || saving || locked} onClick={() => onSave("Submitted")}>{saving ? "Saving…" : assessment?.status === "Submitted" ? "Update submitted assessment" : "Submit assessment"}</button></div><ConfidentialNote>{locked ? "Included in a finalized Admin result; editing is disabled." : "Your scoring is not visible to other doctors and remains editable until Admin finalizes it."}</ConfidentialNote></div>;
}

function ClinicalRecordModal({ patient, target = {}, onClose }) {
  const [visit, setVisit] = useState(Number(target.visitNumber || patient.clinicalData.visits.length));
  const selected = patient.clinicalData.visits[visit - 1];
  const exactTarget = visit === Number(target.visitNumber) && target.metricKey ? selected?.clinic_measurements?.[target.metricKey] : null;
  const history = selected?.consultation?.relevant_history || {};
  const measures = Object.values(selected?.clinic_measurements || {});
  const medications = selected?.consultation?.medication_actions || selected?.medication_actions || [];
  return <Modal title="Clinical record trace" copy={`${patient.sourceEntry} · Synthetic research record · SHA-256 ${patient.sourceSha256}`} onClose={onClose} wide><div className="evidence-toolbar"><label>Visit<select value={visit} onChange={(event) => setVisit(Number(event.target.value))}>{patient.clinicalData.visits.map((item) => <option key={item.visit_number} value={item.visit_number}>Visit {item.visit_number} · {shortDate(item.date)}</option>)}</select></label><StatusBadge>{visit === patient.clinicalData.visits.length ? "Withheld reference" : "Model input"}</StatusBadge></div>{exactTarget && <section className="exact-evidence"><span><ShieldCheck size={16} />Backend-validated source measurement</span><b>{target.metricLabel}: {exactTarget.value} {exactTarget.unit}</b></section>}<div className="clinical-record-grid"><section><h3>Visit summary</h3><dl><div><dt>Date</dt><dd>{shortDate(selected?.date)}</dd></div><div><dt>Encounter</dt><dd>{titleCase(selected?.consultation?.reason_for_consultation?.type || "chronic-care review")}</dd></div><div><dt>Adherence</dt><dd>{titleCase(selected?.consultation?.interval_history?.medication_adherence_status || "not recorded")}</dd></div><div><dt>Acute complaints</dt><dd>{titleCase(selected?.consultation?.interval_history?.acute_complaints || "not recorded")}</dd></div></dl></section><section><h3>Relevant history</h3><dl><div><dt>Smoking</dt><dd>{titleCase(history.smoking || patient.clinicalData?.clinical_context?.smoking_status || "not recorded")}</dd></div><div><dt>Allergies</dt><dd>{(history.drug_allergies || patient.clinicalData?.clinical_context?.allergies || ["not recorded"]).join(", ")}</dd></div><div><dt>Frailty</dt><dd>{titleCase(history.frailty || patient.clinicalData?.clinical_context?.frailty || "not recorded")}</dd></div><div><dt>Priority</dt><dd>{titleCase(history.patient_priority || patient.clinicalData?.clinical_context?.patient_priority || "not recorded")}</dd></div></dl></section><section><h3>Clinic measurements</h3><div className="record-measurements">{measures.map((item) => <span key={item.loinc || item.display}><small>{item.display || item.loinc}</small><b>{item.value} {item.unit}</b></span>)}</div></section><section><h3>Plan and medication actions</h3>{medications.length ? <ul>{medications.map((item) => <li key={item.course_id || item.ingredient}><b>{titleCase(item.action || "continue")}</b> {item.ingredient} {item.dose || ""} {item.frequency?.replaceAll("_", " ") || ""}</li>)}</ul> : <p>No medication action recorded for this visit.</p>}</section></div><p className="source-note">Trace path retained for audit: {exactTarget ? target.jsonPath : `$.visits[${visit - 1}]`}. Technical JSON remains restricted to Admin/development audit.</p></Modal>;
}

function MyAssessments({ navigate }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api.assessments().then((result) => setItems(result.items)); }, []);
  return <div className="content-page"><PageHeader eyebrow="MY JUDGEMENTS" title="Assessment history" copy="Submitted assessments remain editable until the administrator finalizes a result that includes them." />{!items ? <LoadingState label="Loading assessment history…" /> : items.length ? <section className="surface data-table"><div className="table-head assessment-row"><span>Case / model run</span><span>Dataset</span><span>Score</span><span>Status</span><span>Updated</span><span /></div>{items.map((item) => <div className="table-row assessment-row" key={item.id}><div><b>{item.patientId}</b><small>{item.modelVersion} · {item.runId.slice(-8)}</small></div><div><b>{item.datasetName}</b><small>{item.criteria.length} dimensions</small></div><strong className="table-score">{item.overallScore?.toFixed(1) || "—"}</strong><div><StatusBadge>{item.locked ? "Locked" : item.status}</StatusBadge></div><span>{dateTime(item.updatedAt)}</span><button className="secondary-button compact" onClick={() => navigate("workspace", `${item.caseId}~${item.runId}`)}>{item.locked ? "View" : "Edit"}</button></div>)}</section> : <EmptyState icon={ListChecks} title="No assessments yet" copy="Open a case and evaluate a completed model response." />}</div>;
}
