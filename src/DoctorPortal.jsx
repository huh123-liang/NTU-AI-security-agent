import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, ArrowsClockwise, Brain, CaretDown, ChartLineUp, ChatText, Check, ClipboardText, CloudArrowUp, Database,
  ArrowSquareOut, Eye, FileArrowUp, FileText, Files, Flask, FolderOpen, Gauge, House, Info, ListChecks, MagnifyingGlass, Pill, Plus, Robot,
  ShareNetwork, ShieldCheck, Sparkle, SquaresFour, Stethoscope, Stop, TrendUp, UploadSimple, UserList, Warning, X,
} from "@phosphor-icons/react";
import { CartesianGrid, Line, LineChart, RadialBar, RadialBarChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, fileToBase64, uploadHospitalZip } from "./api.js";
import { CRITERIA, REASON_TAGS, dateTime, measurement, shortDate, titleCase } from "./constants.js";
import { ConfidentialNote, EmptyState, ErrorState, InfoTip, LoadingState, MetricCard, Modal, PageHeader, StatusBadge } from "./components.jsx";

export const doctorNav = [
  { key: "overview", label: "Home", labelZh: "首页", icon: House },
  { key: "datasets", label: "Cohorts", labelZh: "数据集", icon: Database },
  { key: "cases", label: "Patient Worklist", labelZh: "患者列表", icon: UserList },
  { key: "workspace", label: "Chart", labelZh: "病历工作区", icon: ClipboardText },
  { key: "assessments", label: "My Reviews", labelZh: "我的评审", icon: ListChecks },
];

export function DoctorPortal({ route, routeId, navigate, notify, user, locale = "en" }) {
  if (route === "overview") return <DoctorOverview navigate={navigate} />;
  if (route === "datasets") return <DatasetsPage navigate={navigate} notify={notify} />;
  if (route === "cases") return <CasesPage datasetId={routeId} navigate={navigate} locale={locale} />;
  if (route === "workspace") {
    const [caseId, initialRunId = ""] = routeId.split("~");
    return caseId ? <Workspace caseId={caseId} initialRunId={initialRunId} notify={notify} navigate={navigate} locale={locale} scoringSuspended={user?.accessStatus === "scoring_suspended"} /> : <WorkspaceLanding navigate={navigate} />;
  }
  if (route === "assessments") return <MyAssessments navigate={navigate} />;
  return <DoctorOverview navigate={navigate} />;
}

function DoctorOverview({ navigate }) {
  const [metrics, setMetrics] = useState(null);
  const [datasets, setDatasets] = useState([]);
  useEffect(() => { Promise.all([api.dashboard(), api.datasets()]).then(([dashboard, data]) => { setMetrics(dashboard.metrics); setDatasets(data.items.slice(0, 3)); }); }, []);
  return <div className="content-page">
    <PageHeader eyebrow="DOCTOR PORTAL" title="Clinical evaluation workspace" copy="Select an Admin-approved dataset, inspect a blinded model response and preserve an independent clinical judgement." actions={<button className="primary-button" onClick={() => navigate("datasets")}><Database size={17} />Browse datasets</button>} />
    <div className="metrics-grid four"><MetricCard icon={Database} label="Available datasets" value={metrics?.datasets ?? "—"} note="Admin-approved shared cohorts" /><MetricCard icon={FolderOpen} label="Available cases" value={metrics?.cases ?? "—"} note="Validated clinical records" tone="teal" /><MetricCard icon={Robot} label="Official responses" value={metrics?.runs ?? "—"} note="Blinded fixed answers available for scoring" tone="purple" /><MetricCard icon={ListChecks} label="Submitted reviews" value={metrics?.submitted ?? "—"} note="Editable until final lock" tone="red" /></div>
    <section className="dashboard-grid"><article className="surface dashboard-callout"><span className="callout-icon"><Brain size={27} /></span><div><span className="eyebrow">EVALUATION FLOW</span><h2>From source evidence to an auditable score</h2><p>The platform adapts the evidence window to each case: one record is evaluated as-is, while longitudinal cases reserve the latest visit as reference evidence.</p><div className="flow-steps"><span><b>1</b>Select case</span><span><b>2</b>Open blinded Official Run</span><span><b>3</b>Score six dimensions</span><span><b>4</b>Submit evidence-linked feedback</span></div></div><button className="secondary-button" onClick={() => navigate("datasets")}>Start evaluation<ArrowRight size={16} /></button></article>
      <article className="surface"><div className="section-heading"><div><span className="eyebrow">RECENT DATASETS</span><h2>Ready for review</h2></div></div><div className="compact-list">{datasets.map((dataset) => <button key={dataset.id} onClick={() => navigate("cases", dataset.id)}><Database size={19} /><span><b>{dataset.name}</b><small>{dataset.validCount} valid · {dataset.quarantinedCount} quarantined</small></span><StatusBadge>{dataset.visibility === "shared" ? "Shared" : dataset.status}</StatusBadge><ArrowRight size={15} /></button>)}</div></article>
    </section>
  </div>;
}

function DatasetsPage({ navigate, notify }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = () => api.datasets().then((datasets) => setItems(datasets.items)).finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []);
  const inspect = async (id) => { const result = await api.dataset(id); setSelected(result); };
  return <div className="content-page"><PageHeader eyebrow="DATA GOVERNANCE" title="Approved datasets" copy="Dataset intake and preprocessing are controlled by the administrator. Doctors can select only approved shared cohorts." />
    {loading ? <LoadingState label="Loading datasets…" /> : <section className="surface data-table"><div className="table-head dataset-row"><span>Dataset</span><span>Access</span><span>Quality</span><span>Status</span><span /></div>{items.map((dataset) => <div className="table-row dataset-row" key={dataset.id}><div className="cell-title"><Database size={20} /><span><b>{dataset.name}</b><small>{dataset.sourceFilename}</small></span></div><div><b>Admin governed</b><small>Approved shared cohort</small></div><div><b>{dataset.validCount} valid</b><small>{dataset.quarantinedCount} quarantined · {dataset.declaredCount} declared</small></div><div><StatusBadge>{dataset.status}</StatusBadge></div><div className="row-actions"><button className="text-button" onClick={() => inspect(dataset.id)}><Eye size={15} />Quality</button><button className="secondary-button compact" disabled={!dataset.validCount || dataset.status !== "Approved"} onClick={() => navigate("cases", dataset.id)}>Open<ArrowRight size={14} /></button></div></div>)}</section>}
    {selected && <DatasetQualityModal data={selected} onClose={() => setSelected(null)} />}
  </div>;
}

function IngestionStatusModal({ job, onClose }) {
  return <Modal wide title={job.name} copy={`${job.sourceFilename} · ${job.status}`} onClose={onClose}><div className="quality-metrics"><div><small>Stage</small><strong>{titleCase(job.stage.replaceAll("_", " "))}</strong></div><div><small>Progress</small><strong>{job.progress}%</strong></div><div><small>Tables</small><strong>{job.discovery?.tableCount ?? "—"}</strong></div><div><small>Eligible cases</small><strong>{job.quality?.eligibleCases ?? "—"}</strong></div></div><div className="quality-note"><Info size={17} /><p>{job.status === "Awaiting Mapping" ? "Schema discovery is complete. An administrator must confirm field meanings before any clinical transformation runs." : job.status === "Awaiting Approval" ? "Preprocessing is complete. Cases remain unavailable until an administrator approves this exact version." : "The task is persisted locally and can recover after a platform restart."}</p></div>{job.errorMessage && <div className="form-error"><Warning size={17} />{job.errorMessage}</div>}<div className="issue-list"><div className="issue-header"><b>Processing trail</b><span>{job.events?.length || 0} events</span></div>{(job.events || []).slice(0, 12).map((item, index) => <div key={`${item.createdAt}-${index}`}><StatusBadge>{item.status}</StatusBadge><span><b>{titleCase(item.stage.replaceAll("_", " "))}</b><small>{item.message}</small></span><code>{dateTime(item.createdAt)}</code></div>)}</div></Modal>;
}

function DatasetQualityModal({ data, onClose }) {
  const { dataset, issues } = data;
  return <Modal title="Data quality report" copy={`${dataset.name} · SHA-256 ${dataset.sourceSha256.slice(0, 16)}…`} onClose={onClose} wide><div className="quality-metrics"><div><small>Declared</small><strong>{dataset.declaredCount}</strong></div><div className="success"><small>Valid</small><strong>{dataset.validCount}</strong></div><div className="danger"><small>Quarantined</small><strong>{dataset.quarantinedCount}</strong></div><div><small>Schema</small><strong>{dataset.schemaVersion}</strong></div></div><div className="quality-note"><Info size={17} /><p>Missing source records are never reconstructed. They remain in the quarantine report and cannot enter the evaluation workflow.</p></div><div className="issue-list"><div className="issue-header"><b>Validation findings</b><span>{issues.length} displayed</span></div>{issues.slice(0, 80).map((issue) => <div key={issue.id}><StatusBadge tone={issue.severity === "critical" || issue.severity === "high" ? "danger" : "warning"}>{issue.severity}</StatusBadge><span><b>{issue.patientId || "Dataset"}</b><small>{issue.message}</small></span><code>{issue.code}</code></div>)}</div></Modal>;
}

function CasesPage({ datasetId, navigate, locale = "en" }) {
  const [datasets, setDatasets] = useState([]);
  const [selectedId, setSelectedId] = useState(datasetId || "");
  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.datasets().then((result) => { setDatasets(result.items); if (!selectedId && result.items[0]) setSelectedId(result.items[0].id); }); }, []);
  useEffect(() => { if (!selectedId) return; setLoading(true); const timer = window.setTimeout(() => api.cases(selectedId, { search }).then((result) => { setCases(result.items); setTotal(result.total); }).finally(() => setLoading(false)), 180); return () => window.clearTimeout(timer); }, [selectedId, search]);
  const c = locale === "zh" ? {
    kicker: "临床评审队列", title: "患者工作列表", copy: "选择经管理员批准的病例，查看固定 AI 回答并完成独立评审。",
    search: "搜索患者编号或诊断", all: "全部", ready: "待评审", draft: "草稿", submitted: "已提交",
    patient: "患者", context: "临床背景", response: "官方回答", review: "我的评审", updated: "最近更新", open: "打开病历",
    noRun: "尚无官方回答", readyRun: "可开始评审", notStarted: "未开始", records: "病例",
  } : {
    kicker: "CLINICAL REVIEW QUEUE", title: "Patient Worklist", copy: "Select an Admin-approved case, review the fixed AI answer and complete an independent assessment.",
    search: "Search patient ID or diagnosis", all: "All", ready: "Ready", draft: "Draft", submitted: "Submitted",
    patient: "Patient", context: "Clinical context", response: "Official response", review: "My review", updated: "Last updated", open: "Open chart",
    noRun: "No Official Run", readyRun: "Ready for review", notStarted: "Not started", records: "records",
  };
  const visibleCases = cases.filter((item) => {
    if (filter === "ready") return item.officialRun?.studyStatus === "Official" && !item.myAssessment;
    if (filter === "draft") return item.myAssessment?.status === "Draft";
    if (filter === "submitted") return /submitted|locked/i.test(item.myAssessment?.status || "");
    return true;
  });
  return <div className="epic-worklist-page">
    <header className="epic-page-title"><div><span>{c.kicker}</span><h1>{c.title}</h1><p>{c.copy}</p></div><div className="worklist-summary"><strong>{total}</strong><small>{c.records}</small></div></header>
    <section className="worklist-toolbar">
      <label className="epic-search"><MagnifyingGlass size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={c.search} /></label>
      <div className="epic-filter-tabs">{[["all", c.all], ["ready", c.ready], ["draft", c.draft], ["submitted", c.submitted]].map(([key, label]) => <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}</button>)}</div>
      <select className="dataset-select epic-dataset-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select>
    </section>
    {loading ? <LoadingState label="Loading patient worklist…" /> : <section className="epic-worklist-table" aria-label={c.title}>
      <div className="worklist-head"><span>{c.patient}</span><span>{c.context}</span><span>{c.response}</span><span>{c.review}</span><span>{c.updated}</span><span /></div>
      {visibleCases.map((item) => { const status = item.myAssessment?.status || c.notStarted; const runReady = item.officialRun?.studyStatus === "Official"; return <button className="worklist-row" key={item.id} onClick={() => navigate("workspace", item.id)}>
        <span className="worklist-patient"><i>{item.patientId.slice(-2)}</i><span><b>{item.patientId}</b><small>{item.ageTopCoded ? "Age 91+" : `${item.age || "—"}y`} · {titleCase(item.sex)} · {titleCase(item.ethnicity)}</small></span></span>
        <span><b>{item.condition}</b><small>{`${item.visits} longitudinal ${item.visits === 1 ? "visit" : "visits"}`} · {item.recordType === "deidentified_real_world" ? "De-identified" : "Synthetic"}</small></span>
        <span><StatusBadge tone={runReady ? "success" : "warning"}>{runReady ? c.readyRun : c.noRun}</StatusBadge><small>{item.officialRun?.anonymousModelLabel || "Admin pending"}</small></span>
        <span><StatusBadge tone={/submitted|locked/i.test(status) ? "success" : /draft/i.test(status) ? "warning" : "neutral"}>{status}</StatusBadge><small>Peer reviews hidden</small></span>
        <span><b>{item.myAssessment?.updatedAt ? dateTime(item.myAssessment.updatedAt) : "—"}</b><small>{item.myAssessment?.locked ? "Final result locked" : "Editable until final lock"}</small></span>
        <span className="open-chart">{c.open}<ArrowRight size={14} /></span>
      </button>; })}
      {!visibleCases.length && <EmptyState icon={UserList} title="No patients match this view" copy="Change the filter or search term to see more cases." />}
    </section>}
  </div>;
}

function WorkspaceLanding({ navigate }) {
  return <EmptyState icon={ClipboardText} title="Select a case to open the workspace" copy="Choose a validated longitudinal patient from the case library." action={<button className="primary-button" onClick={() => navigate("cases")}>Browse cases<ArrowRight size={16} /></button>} />;
}

function Workspace({ caseId, initialRunId, notify, navigate, locale = "en", scoringSuspended }) {
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
  const [activeView, setActiveView] = useState("summary");
  const [sidecarTab, setSidecarTab] = useState("response");

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
  const realWorld = caseData?.recordType === "deidentified_real_world";
  const runComplete = selectedRun?.status === "Completed";
  const taskLabel = selectedRun?.taskType?.replaceAll("_", " ") || caseData?.taskType?.replaceAll("_", " ") || "clinical";
  const c = locale === "zh" ? {
    back: "返回患者列表", summary: "患者摘要", chart: "病程回顾", labs: "检验结果", meds: "用药", diagnoses: "诊断", documents: "临床文档", record: "原始病历",
    response: "AI 回答", evidence: "证据", evaluation: "评分", context: "病例背景", official: "官方回答", evaluate: "人工评审", submit: "提交",
    evidencePolicy: "证据窗口", fixed: "已预生成并固定", score: "评分与解释", editable: "锁定前可编辑",
  } : {
    back: "Back to Patient Worklist", summary: "Patient Summary", chart: "Chart Review", labs: "Labs", meds: "Medications", diagnoses: "Diagnoses", documents: "Documents", record: "Source Record",
    response: "AI Response", evidence: "Evidence", evaluation: "Evaluation", context: "Case context", official: "Official response", evaluate: "Clinical review", submit: "Submit",
    evidencePolicy: "Evidence window", fixed: "Pre-generated and fixed", score: "Score and explain", editable: "Editable until final lock",
  };
  const selectEvidence = (evidence) => { setSelectedEvidence(evidence); setActiveView("summary"); setSidecarTab("evidence"); };
  return <div className="workspace-shell epic-chart-shell">
    <PatientHeader patient={caseData} visits={visits} selectedRun={selectedRun} assessment={assessment} navigate={navigate} locale={locale} />
    <div className="workflow-bar epic-workflow-bar"><span className="complete"><b>1</b><i>{c.context}<small>{titleCase(taskLabel)} · {c.evidencePolicy}</small></i></span><span className={runComplete ? "complete" : "active"}><b>2</b><i>{c.official}<small>{c.fixed}</small></i></span><span className={runComplete ? "active" : ""}><b>3</b><i>{c.evaluate}<small>{c.score}</small></i></span><span className={assessment?.status === "Submitted" ? "complete" : ""}><b>4</b><i>{c.submit}<small>{c.editable}</small></i></span></div>
    <div className="epic-clinical-layout">
      <ClinicalNavigator activeView={activeView} setActiveView={setActiveView} copy={c} onBack={() => navigate("cases", caseData.datasetId)} />
      <section className="clinical-workspace">
        <div className="clinical-workspace-title"><div><span>{c[activeView] || c.summary}</span><small>{realWorld ? "De-identified real-world research record" : "Synthetic research record"}</small></div><button className="text-button" onClick={() => setRawEvidenceTarget({ visitNumber: selectedEvidence?.visitNumber || visits.at(-1)?.visit_number || 1, jsonPath: selectedEvidence?.jsonPath || `$.visits[${Math.max(0, visits.length - 1)}]` })}><Eye size={14} />{c.record}</button></div>
        <ClinicalWorkspace view={activeView} patient={caseData} visits={visits} selectedEvidence={selectedEvidence} onOpenRaw={setRawEvidenceTarget} locale={locale} />
      </section>
      <aside className="ai-review-sidecar">
        <div className="sidecar-tabs" role="tablist">{[["response", c.response, Robot], ["evidence", c.evidence, ShareNetwork], ["evaluation", c.evaluation, ListChecks]].map(([key, label, Icon]) => <button role="tab" aria-selected={sidecarTab === key} key={key} className={sidecarTab === key ? "active" : ""} onClick={() => setSidecarTab(key)}><Icon size={15} /><span>{label}</span>{key === "evidence" && selectedRun?.evidenceLinks?.length ? <i>{selectedRun.evidenceLinks.length}</i> : null}</button>)}</div>
        <div className="sidecar-toolbar"><span><b>{sidecarTab === "response" ? c.response : sidecarTab === "evidence" ? c.evidence : c.evaluation}</b><small>{selectedRun?.anonymousModelLabel || selectedRun?.modelVersion || "Model A"}</small></span><div className="run-controls"><StatusBadge tone={selectedRun?.studyStatus === "Official" ? "success" : "warning"}>{selectedRun?.studyStatus || "Admin pending"}</StatusBadge></div></div>
        {error && <div className="inline-alert"><Warning size={16} />{error}</div>}
        {sidecarTab === "response" && (selectedRun ? <ResponsePanel run={selectedRun} selectedEvidence={selectedEvidence} onSelectEvidence={selectEvidence} onOpenRaw={setRawEvidenceTarget} /> : <EmptyState icon={Robot} title="Official response pending" copy="An administrator must pre-generate a fixed blinded response before independent doctor scoring begins." />)}
        {sidecarTab === "evidence" && <EvidencePanel run={selectedRun} selectedEvidence={selectedEvidence} onSelectEvidence={selectEvidence} onOpenRaw={setRawEvidenceTarget} />}
        {sidecarTab === "evaluation" && (scoringSuspended ? <EmptyState icon={ShieldCheck} title="Scoring is suspended" copy="You can review your history, but this account cannot create or edit assessments until an administrator reactivates scoring." /> : runComplete && draft ? <ReviewCockpit draft={draft} setDraft={setDraft} assessment={assessment} saving={saving} onSave={save} /> : <EmptyState icon={Gauge} title={selectedRun?.status === "Running" ? "Generation in progress" : "Choose a completed run"} copy="The rubric opens after a completed Official Run is selected." />)}
      </aside>
    </div>
    {rawEvidenceTarget && <ClinicalRecordModal patient={caseData} target={rawEvidenceTarget} onClose={() => setRawEvidenceTarget(null)} />}
  </div>;
}

function PatientHeader({ patient, visits, selectedRun, assessment, navigate, locale }) {
  const latest = visits.at(-1) || {};
  const history = latest.consultation?.relevant_history || {};
  const context = patient.clinicalData?.clinical_context || {};
  const allergies = history.drug_allergies || context.allergies || [];
  const allergyText = Array.isArray(allergies) && allergies.length ? allergies.join(", ") : "Not recorded";
  const completedScores = assessment?.criteria?.filter((item) => item.score)?.length || 0;
  const c = locale === "zh" ? { back: "患者列表", age: "年龄", sex: "性别", allergies: "过敏史", cohort: "数据集", run: "官方回答", progress: "评审进度" } : { back: "Patient Worklist", age: "Age", sex: "Sex", allergies: "Allergies", cohort: "Cohort", run: "Official Run", progress: "Review progress" };
  return <header className="epic-patient-header">
    <button className="patient-back" onClick={() => navigate("cases", patient.datasetId)}><ArrowLeft size={15} /><span>{c.back}</span></button>
    <div className="patient-banner-identity"><span className="patient-monogram">{patient.patientId.slice(-2)}</span><div><small>{patient.recordType === "deidentified_real_world" ? "DE-IDENTIFIED RESEARCH RECORD" : "SYNTHETIC RESEARCH RECORD"}</small><h1 title={patient.patientId}>{patient.patientId}</h1><p>{patient.conditions.slice(0, 3).map((condition) => condition.display || titleCase(condition.key)).join(" · ") || "No active diagnosis recorded"}</p></div></div>
    <dl className="patient-banner-facts"><div><dt>{c.age}</dt><dd>{patient.ageTopCoded ? "91+" : patient.age || "—"}</dd></div><div><dt>{c.sex}</dt><dd>{titleCase(patient.sex)}</dd></div><div className={/no known|none/i.test(allergyText) ? "" : "alert"}><dt>{c.allergies}</dt><dd title={allergyText}>{allergyText}</dd></div><div><dt>{c.cohort}</dt><dd title={patient.datasetName}>{patient.datasetName}</dd></div><div><dt>{c.run}</dt><dd>{selectedRun?.studyStatus || "Pending"}</dd></div><div><dt>{c.progress}</dt><dd>{assessment?.status === "Submitted" ? "Submitted" : `${completedScores}/6`}</dd></div></dl>
  </header>;
}

function ClinicalNavigator({ activeView, setActiveView, copy, onBack }) {
  const items = [
    ["summary", copy.summary, SquaresFour], ["chart", copy.chart, ChartLineUp], ["labs", copy.labs, Flask],
    ["meds", copy.meds, Pill], ["diagnoses", copy.diagnoses, Stethoscope], ["documents", copy.documents, Files], ["record", copy.record, FileText],
  ];
  return <aside className="clinical-navigator"><div className="navigator-label">CLINICAL NAVIGATOR</div><nav>{items.map(([key, label, Icon]) => <button key={key} className={activeView === key ? "active" : ""} onClick={() => setActiveView(key)}><Icon size={16} /><span>{label}</span><ArrowRight size={11} /></button>)}</nav><button className="navigator-back" onClick={onBack}><ArrowLeft size={14} /><span>{copy.back}</span></button></aside>;
}

function ClinicalWorkspace({ view, patient, visits, selectedEvidence, onOpenRaw, locale }) {
  if (view === "chart") return <ChartReview visits={visits} selectedEvidence={selectedEvidence} />;
  if (view === "labs") return <LabsWorkspace visits={visits} selectedEvidence={selectedEvidence} />;
  if (view === "meds") return <MedicationWorkspace visits={visits} />;
  if (view === "diagnoses") return <DiagnosisWorkspace patient={patient} />;
  if (view === "documents") return <DocumentsWorkspace visits={visits} onOpenRaw={onOpenRaw} />;
  if (view === "record") return <SourceRecordWorkspace patient={patient} visits={visits} onOpenRaw={onOpenRaw} />;
  return <PatientContext patient={patient} visits={visits} selectedEvidence={selectedEvidence} locale={locale} />;
}

function ChartReview({ visits, selectedEvidence }) {
  const metrics = TREND_METRICS.filter((metric) => visits.some((visit) => measurement(visit, metric.key) !== undefined));
  return <div className="clinical-view-scroll chart-review-view"><div className="clinical-info-banner"><ChartLineUp size={17} /><span><b>Longitudinal flowsheet</b><small>Observed values only. Missing measurements remain blank.</small></span></div><div className="flowsheet-wrap"><table className="flowsheet-table"><thead><tr><th>Measure</th>{visits.map((visit) => <th key={visit.visit_number}><b>V{visit.visit_number}</b><small>{shortDate(visit.date)}</small></th>)}</tr></thead><tbody>{metrics.map((metric) => <tr key={metric.key} className={selectedEvidence?.metricKey === metric.key ? "evidence-selected" : ""}><th>{metric.label}</th>{visits.map((visit) => { const value = measurement(visit, metric.key); const selected = selectedEvidence?.metricKey === metric.key && selectedEvidence?.visitNumber === Number(visit.visit_number); return <td key={visit.visit_number} className={selected ? "source-focus" : ""}>{value ?? "—"}</td>; })}</tr>)}</tbody></table></div><div className="chart-review-plots">{metrics.map((metric) => <TrendMini key={metric.key} metric={metric} visits={visits} selectedEvidence={selectedEvidence} />)}</div></div>;
}

function LabsWorkspace({ visits, selectedEvidence }) {
  const labKeys = [...new Set(visits.flatMap((visit) => Object.keys(visit.clinic_measurements || {})))];
  const labels = Object.fromEntries(visits.flatMap((visit) => Object.entries(visit.clinic_measurements || {}).map(([key, value]) => [key, value.display || titleCase(key)])));
  return <div className="clinical-view-scroll"><div className="clinical-info-banner"><Flask size={17} /><span><b>Laboratory and vital results</b><small>Source-backed measurements across all available encounters.</small></span></div><div className="flowsheet-wrap"><table className="flowsheet-table lab-flowsheet"><thead><tr><th>Result</th>{visits.map((visit) => <th key={visit.visit_number}>V{visit.visit_number}<small>{shortDate(visit.date)}</small></th>)}</tr></thead><tbody>{labKeys.map((key) => <tr key={key} className={selectedEvidence?.metricKey === key ? "evidence-selected" : ""}><th>{labels[key]}</th>{visits.map((visit) => { const item = visit.clinic_measurements?.[key]; const selected = selectedEvidence?.metricKey === key && selectedEvidence?.visitNumber === Number(visit.visit_number); return <td key={visit.visit_number} className={selected ? "source-focus" : ""}>{item ? <><b>{item.value}</b><small>{item.unit}</small></> : "—"}</td>; })}</tr>)}</tbody></table></div></div>;
}

function MedicationWorkspace({ visits }) {
  const entries = visits.flatMap((visit) => (visit.consultation?.medication_actions || visit.medication_actions || []).map((item) => ({ ...item, visit: visit.visit_number, date: visit.date })));
  return <div className="clinical-view-scroll"><div className="clinical-info-banner"><Pill size={17} /><span><b>Medication history</b><small>Actions documented in the source encounters; this is not an active prescribing module.</small></span></div>{entries.length ? <div className="clinical-list-table"><div className="clinical-list-head"><span>Medication</span><span>Action</span><span>Dose / frequency</span><span>Source encounter</span></div>{entries.map((item, index) => <div className="clinical-list-row" key={`${item.course_id || item.ingredient}-${index}`}><span><b>{item.ingredient || "Medication not named"}</b><small>{item.course_id || "Source entry"}</small></span><StatusBadge>{titleCase(item.action || "recorded")}</StatusBadge><span>{[item.dose, item.frequency?.replaceAll("_", " ")].filter(Boolean).join(" · ") || "Not recorded"}</span><span>V{item.visit} · {shortDate(item.date)}</span></div>)}</div> : <EmptyState icon={Pill} title="No medication actions recorded" copy="The source record does not include structured medication actions." />}</div>;
}

function DiagnosisWorkspace({ patient }) {
  return <div className="clinical-view-scroll"><div className="clinical-info-banner"><Stethoscope size={17} /><span><b>Problem list</b><small>Diagnoses supplied by the approved research dataset.</small></span></div><div className="problem-list">{patient.conditions.map((condition, index) => <article key={condition.key || condition.display}><span>{index + 1}</span><div><b>{condition.display || titleCase(condition.key)}</b><small>{condition.code || condition.key || "Structured diagnosis"}</small></div><StatusBadge>Active</StatusBadge></article>)}</div></div>;
}

function DocumentsWorkspace({ visits, onOpenRaw }) {
  return <div className="clinical-view-scroll"><div className="clinical-info-banner"><Files size={17} /><span><b>Clinical documents</b><small>Human-readable encounter summaries linked to the original source location.</small></span></div><div className="document-list"><div className="document-head"><span>Date</span><span>Type</span><span>Summary</span><span>Source</span></div>{visits.map((visit) => <button key={visit.visit_number} onClick={() => onOpenRaw({ visitNumber: visit.visit_number, jsonPath: `$.visits[${Number(visit.visit_number) - 1}]` })}><span>{shortDate(visit.date)}</span><span>Visit note</span><span>{visit.consultation?.assessment_and_plan?.[0]?.status?.replaceAll("_", " ") || visit.consultation?.reason_for_consultation?.type?.replaceAll("_", " ") || "Clinical review"}</span><span>Visit {visit.visit_number}<ArrowSquareOut size={12} /></span></button>)}</div></div>;
}

function SourceRecordWorkspace({ patient, visits, onOpenRaw }) {
  return <div className="clinical-view-scroll"><div className="clinical-info-banner"><FileText size={17} /><span><b>Source record</b><small>Human-readable clinical records. Technical JSON is restricted to Admin and development audit.</small></span></div><div className="source-record-list">{visits.map((visit, index) => { const measures = Object.values(visit.clinic_measurements || {}); return <article key={visit.visit_number}><header><span><b>Visit {visit.visit_number}</b><small>{shortDate(visit.date)} · {visit.consultation?.reason_for_consultation?.type?.replaceAll("_", " ") || "Clinical encounter"}</small></span><button className="secondary-button compact" onClick={() => onOpenRaw({ visitNumber: visit.visit_number, jsonPath: `$.visits[${index}]` })}>Open record<ArrowSquareOut size={13} /></button></header><div>{measures.slice(0, 6).map((item) => <span key={item.loinc || item.display}><small>{item.display || item.loinc}</small><b>{item.value} {item.unit}</b></span>)}</div></article>; })}</div><p className="source-note">Dataset: {patient.datasetName} · SHA-256 {patient.sourceSha256}</p></div>;
}

function EvidencePanel({ run, selectedEvidence, onSelectEvidence, onOpenRaw }) {
  if (!run || run.status !== "Completed") return <EmptyState icon={ShareNetwork} title="Evidence is not available" copy="Evidence links appear after a completed Official Run is selected." />;
  const links = run.evidenceLinks || [];
  return <div className="evidence-panel-scroll">{selectedEvidence ? <EvidenceLensCard evidence={selectedEvidence} onOpenRaw={onOpenRaw} /> : <div className="clinical-info-banner"><ShareNetwork size={17} /><span><b>{links.length} verified source links</b><small>Select an evidence item to locate it in the clinical workspace.</small></span></div>}<div className="evidence-index"><div className="evidence-index-title"><b>Evidence index</b><span>Validated for this exact response</span></div>{links.map((evidence) => <button key={evidence.id} className={selectedEvidence?.id === evidence.id ? "active" : ""} onClick={() => onSelectEvidence(evidence)}><span><b>{evidence.metricLabel}</b><small>Visit {evidence.visitNumber} · {shortDate(evidence.date)}</small></span><strong>{evidence.value} {evidence.unit}</strong><ArrowRight size={12} /></button>)}</div><div className="evidence-governance"><ShieldCheck size={16} /><p>Only backend-validated citations from the model-input snapshot can open a source record.</p></div></div>;
}

function buildDraft(assessment) {
  const criteria = Object.fromEntries(CRITERIA.map((item) => { const existing = assessment?.criteria?.find((score) => score.key === item.key); return [item.key, existing || { score: null, feedback: "", tags: [], customTags: [] }]; }));
  return { criteria, safetyIssue: assessment?.safetyIssue || "Undecided", reasonTags: assessment?.reasonTags || [], caseFeedback: assessment?.caseFeedback || "" };
}

const TREND_METRICS = [
  { key: "systolic_bp", label: "BP", color: "#2a6aa5" },
  { key: "hba1c", label: "HbA1c", color: "#c8102e" },
  { key: "egfr", label: "eGFR", color: "#087a5b" },
  { key: "ldl_cholesterol", label: "LDL", color: "#7857a8" },
];

function PatientContext({ patient, visits, selectedEvidence }) {
  const timelineRefs = useRef({});
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  useEffect(() => {
    if (!selectedEvidence) return;
    window.setTimeout(() => timelineRefs.current[selectedEvidence.visitNumber]?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }, [selectedEvidence]);
  const latest = visits.at(-1) || {};
  const realWorld = patient.recordType === "deidentified_real_world";
  return <div className="patient-scroll"><article className="patient-summary"><header className="patient-summary-head"><div className="patient-identity"><span className="patient-avatar large">{patient.patientId.slice(-2)}</span><div><span className="summary-kicker">PATIENT RECORD</span><h2 title={patient.patientId}>{patient.patientId}</h2><p>{patient.ageTopCoded ? "Age 91+" : `${patient.age || "—"}-year-old`} · {titleCase(patient.sex)} · {titleCase(patient.ethnicity)}</p></div></div><StatusBadge tone={realWorld ? "success" : undefined}>{realWorld ? "De-identified" : "Synthetic"}</StatusBadge></header><dl className="patient-meta-strip"><div><dt>Dataset</dt><dd title={patient.datasetName}>{patient.datasetName}</dd></div><div><dt>Reference visit</dt><dd>{shortDate(latest.date)}</dd></div><div><dt>History</dt><dd>{visits.length} longitudinal visits</dd></div></dl><div className="diagnosis-block"><div className="diagnosis-heading"><b>Active conditions</b><span>{patient.conditions.length}</span></div><ul>{patient.conditions.map((condition) => <li key={condition.key || condition.display}>{condition.display || titleCase(condition.key)}</li>)}</ul></div></article>
    <article className="research-signals"><div className="subsection-title"><b>Research signals</b><span>Rule-based · source-backed</span></div><SignalSummary visits={visits} /></article>
    <article className="trend-card"><div className="subsection-title"><b>Longitudinal trends</b><span>4 monitored metrics</span></div><div className="small-multiple-grid">{TREND_METRICS.map((metric) => <TrendMini key={metric.key} metric={metric} visits={visits} selectedEvidence={selectedEvidence} />)}</div><div className="trend-legend"><small>Only source-backed measurements are plotted. Missing laboratory series are not reconstructed.</small></div></article>
    <article className="timeline-card compact"><div className="subsection-title"><b>Visit strip</b><span>{visits.length} visits · <button className="text-button" onClick={() => setTimelineExpanded((value) => !value)}>{timelineExpanded ? "Collapse timeline" : "View full timeline"}</button></span></div><div className={`timeline compact-timeline${timelineExpanded ? " expanded" : ""}`}>{visits.map((visit, index) => { const selected = selectedEvidence?.visitNumber === Number(visit.visit_number); return <button ref={(element) => { timelineRefs.current[visit.visit_number] = element; }} type="button" key={`${visit.visit_number}-${visit.date}`} className={`${index === visits.length - 1 ? "reference" : ""}${selected ? " evidence-selected" : ""}`}><i /><span><b>V{visit.visit_number}</b><small>{shortDate(visit.date)}</small></span><p>{selected ? `${selectedEvidence.metricLabel}: ${selectedEvidence.value} ${selectedEvidence.unit}` : visit.consultation?.assessment_and_plan?.[0]?.status?.replaceAll("_", " ") || "Chronic-care review"}</p></button>; })}</div></article>
    <p className="source-note">Source: {realWorld ? "de-identified real-world research dataset" : "synthetic research dataset"} · SHA {patient.sourceSha256.slice(0, 16)}…{realWorld ? " · Dates are de-identified" : ""}</p></div>;
}

function TrendMini({ metric, visits, selectedEvidence }) {
  const data = visits.map((visit) => ({ visitNumber: Number(visit.visit_number), date: `V${visit.visit_number}`, value: measurement(visit, metric.key) }));
  const sourceData = data.filter((item) => Number.isFinite(item.value));
  const selected = selectedEvidence?.metricKey === metric.key ? data.find((item) => item.visitNumber === selectedEvidence.visitNumber) : null;
  return <section className={`mini-trend${selected ? " evidence-selected" : ""}`}><header><b>{metric.label}</b><small>{sourceData.at(-1)?.value ?? "—"}</small></header>{sourceData.length ? <ResponsiveContainer width="100%" height={86}><LineChart data={data} margin={{ top: 5, right: 2, left: -22, bottom: 0 }}><CartesianGrid stroke="#edf1f5" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 7, fill: "#8794a6" }} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 7, fill: "#8794a6" }} width={28} /><Tooltip formatter={(value) => [`${value}`, metric.label]} /><Line type="monotone" dataKey="value" stroke={metric.color} strokeWidth={2} dot={false} connectNulls />{selected?.value !== undefined && <ReferenceDot x={selected.date} y={selected.value} r={4} fill="#fff" stroke="#c8102e" strokeWidth={2} />}</LineChart></ResponsiveContainer> : <div className="missing-series">No source series</div>}</section>;
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
  return <div className="generation-state"><div className="generation-orbit"><Robot size={28} /></div><span className="eyebrow">MODEL RUN · {run.id.slice(-8)}</span><h2>{running ? "Building an evidence-linked response" : `${run.status} generation`}</h2><p>{running ? `The backend is currently ${String(run.stage || "preparing_data").replaceAll("_", " ")}. This state is persisted in SQLite and will recover after refresh.` : run.errorMessage || "This run ended before a response was saved."}</p><div className="generation-data-route" aria-label="Live generation data route"><span><Database size={15} />{titleCase(String(run.taskType || "clinical evidence").replaceAll("_", " "))}</span><ArrowRight size={13} /><span className={running ? "active" : ""}><Robot size={15} />{run.modelVersion || "Blinded model"}</span><ArrowRight size={13} /><span><ShieldCheck size={15} />Evidence check</span></div><GenerationTrail run={run} />{running ? <button className="danger-button" onClick={onCancel}><Stop size={15} />Cancel generation</button> : <button className="secondary-button" onClick={onRetry}><ArrowsClockwise size={15} />Retry as new run</button>}</div>;
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
  return <div className="response-scroll"><div className="response-meta"><span><Robot size={17} /><b>{run.anonymousModelLabel || "Model A"}</b><small>Blinded Official Run</small></span><span><FileText size={17} /><b>{run.promptVersion}</b><small>{dateTime(run.completedAt)}</small></span><StatusBadge>{run.status}</StatusBadge></div>{selectedEvidence && <EvidenceLensCard evidence={selectedEvidence} onOpenRaw={onOpenRaw} />}<article className="model-output">{lines.map((line, index) => line.startsWith("### ") ? <h3 key={index}>{inline(line.slice(4))}</h3> : line.startsWith("## ") ? <h2 key={index}>{inline(line.slice(3))}</h2> : /^\d+\./.test(line.trim()) ? <p className="numbered" key={index}>{inline(line)}</p> : line.trim().startsWith("-") ? <p className="bullet" key={index}>{inline(line.replace(/^\s*-\s*/, ""))}</p> : line.trim() ? <p key={index}>{inline(line)}</p> : null)}</article><div className="evidence-callout"><ShieldCheck size={19} /><div><b>{run.evidenceLinks?.length || 0} verified evidence links</b><p>Interactive links are limited to source IDs accepted by the backend for this exact run snapshot. Any reserved reference record remains visible to the clinician but outside the model input.</p>{run.invalidEvidenceCitations?.length > 0 && <small>{run.invalidEvidenceCitations.length} unverified citation token(s) were not linked.</small>}</div></div><GenerationTrail run={run} /></div>;
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
  const [expandedCriteria, setExpandedCriteria] = useState(() => new Set([CRITERIA.find((criterion) => !draft.criteria[criterion.key].score)?.key || CRITERIA[0].key]));
  const scores = CRITERIA.map((criterion) => draft.criteria[criterion.key].score).filter(Boolean);
  const overall = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  const updateCriterion = (key, changes) => setDraft((current) => ({ ...current, criteria: { ...current.criteria, [key]: { ...current.criteria[key], ...changes } } }));
  const allScored = scores.length === CRITERIA.length;
  const locked = assessment?.locked;
  const toggleCriterion = (key) => setExpandedCriteria((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return <div className="review-scroll epic-review-scroll"><div className="overall-score"><div className="score-ring"><ResponsiveContainer width="100%" height="100%"><RadialBarChart innerRadius="76%" outerRadius="100%" data={[{ value: overall * 20, fill: "#c8102e" }]} startAngle={90} endAngle={-270}><RadialBar dataKey="value" cornerRadius={3} background={{ fill: "#e9eef3" }} /></RadialBarChart></ResponsiveContainer><strong>{overall ? overall.toFixed(1) : "—"}<small>/5</small></strong></div><div><span>OVERALL ASSESSMENT</span><h2>{overall >= 4 ? "Good" : overall >= 3 ? "Moderate" : overall ? "Needs attention" : "Not scored"}</h2><p>{scores.length} of {CRITERIA.length} dimensions completed.</p></div>{locked && <StatusBadge tone="danger">Locked</StatusBadge>}</div>
    <div className="rubric-intro"><b>Clinical rubric</b><span>1 = Poor · 5 = Excellent</span></div><div className="criteria-list epic-criteria-list">{CRITERIA.map((criterion, index) => { const value = draft.criteria[criterion.key]; const isOpen = expandedCriteria.has(criterion.key); const feedbackCount = value.tags.length + value.customTags.length + (value.feedback.trim() ? 1 : 0); return <article className={`criterion-card epic-criterion${isOpen ? " feedback-open" : ""}`} key={criterion.key}><button type="button" className="criterion-summary" aria-expanded={isOpen} onClick={() => toggleCriterion(criterion.key)}><span>{value.score || index + 1}</span><div><b>{criterion.label}</b><small>{criterion.description}</small></div>{value.score ? <strong>{value.score}/5</strong> : <em>Not scored</em>}<CaretDown className={isOpen ? "open" : ""} size={14} /></button>{isOpen && <div className="criterion-body"><div className="score-buttons" role="radiogroup" aria-label={criterion.label}>{[1, 2, 3, 4, 5].map((score) => <button disabled={locked} key={score} aria-checked={value.score === score} role="radio" className={value.score === score ? "selected" : ""} onClick={() => updateCriterion(criterion.key, { score })}>{score}</button>)}</div><div className="criterion-feedback"><div className="feedback-label"><ChatText size={13} /><span>{feedbackCount ? `${feedbackCount} feedback item${feedbackCount > 1 ? "s" : ""}` : "Optional structured feedback"}</span></div><div className="feedback-tags">{criterion.tags.map((tag) => <button disabled={locked} key={tag} className={value.tags.includes(tag) ? "selected" : ""} onClick={() => updateCriterion(criterion.key, { tags: value.tags.includes(tag) ? value.tags.filter((item) => item !== tag) : [...value.tags, tag] })}>{value.tags.includes(tag) && <Check size={11} />}{tag}</button>)}{value.customTags.map((tag) => <button disabled={locked} className="selected custom" key={tag} onClick={() => updateCriterion(criterion.key, { customTags: value.customTags.filter((item) => item !== tag) })}>{tag}<X size={11} /></button>)}</div><div className="custom-tag-row"><input disabled={locked} value={customInputs[criterion.key] || ""} onChange={(event) => setCustomInputs({ ...customInputs, [criterion.key]: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter" && event.currentTarget.value.trim()) { event.preventDefault(); const tag = event.currentTarget.value.trim(); updateCriterion(criterion.key, { customTags: [...new Set([...value.customTags, tag])] }); setCustomInputs({ ...customInputs, [criterion.key]: "" }); } }} placeholder="Add custom feedback tag and press Enter" /></div><textarea disabled={locked} value={value.feedback} onChange={(event) => updateCriterion(criterion.key, { feedback: event.target.value })} placeholder={`Optional feedback on ${criterion.label.toLowerCase()}…`} /></div></div>}</article>; })}</div>
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
  const recordLabel = patient.recordType === "deidentified_real_world" ? "De-identified real-world research record" : "Synthetic research record";
  return <Modal title="Clinical record trace" copy={`${patient.sourceEntry} · ${recordLabel} · SHA-256 ${patient.sourceSha256}`} onClose={onClose} wide><div className="evidence-toolbar"><label>Visit<select value={visit} onChange={(event) => setVisit(Number(event.target.value))}>{patient.clinicalData.visits.map((item) => <option key={item.visit_number} value={item.visit_number}>Visit {item.visit_number} · {shortDate(item.date)}</option>)}</select></label><StatusBadge>{visit === patient.clinicalData.visits.length ? "Withheld reference" : "Model input"}</StatusBadge></div>{exactTarget && <section className="exact-evidence"><span><ShieldCheck size={16} />Backend-validated source measurement</span><b>{target.metricLabel}: {exactTarget.value} {exactTarget.unit}</b></section>}<div className="clinical-record-grid"><section><h3>Visit summary</h3><dl><div><dt>Date</dt><dd>{shortDate(selected?.date)}</dd></div><div><dt>Encounter</dt><dd>{titleCase(selected?.consultation?.reason_for_consultation?.type || "chronic-care review")}</dd></div><div><dt>Adherence</dt><dd>{titleCase(selected?.consultation?.interval_history?.medication_adherence_status || "not recorded")}</dd></div><div><dt>Acute complaints</dt><dd>{titleCase(selected?.consultation?.interval_history?.acute_complaints || "not recorded")}</dd></div></dl></section><section><h3>Relevant history</h3><dl><div><dt>Smoking</dt><dd>{titleCase(history.smoking || patient.clinicalData?.clinical_context?.smoking_status || "not recorded")}</dd></div><div><dt>Allergies</dt><dd>{(history.drug_allergies || patient.clinicalData?.clinical_context?.allergies || ["not recorded"]).join(", ")}</dd></div><div><dt>Frailty</dt><dd>{titleCase(history.frailty || patient.clinicalData?.clinical_context?.frailty || "not recorded")}</dd></div><div><dt>Priority</dt><dd>{titleCase(history.patient_priority || patient.clinicalData?.clinical_context?.patient_priority || "not recorded")}</dd></div></dl></section><section><h3>Clinic measurements</h3><div className="record-measurements">{measures.map((item) => <span key={item.loinc || item.display}><small>{item.display || item.loinc}</small><b>{item.value} {item.unit}</b></span>)}</div></section><section><h3>Plan and medication actions</h3>{medications.length ? <ul>{medications.map((item) => <li key={item.course_id || item.ingredient}><b>{titleCase(item.action || "continue")}</b> {item.ingredient} {item.dose || ""} {item.frequency?.replaceAll("_", " ") || ""}</li>)}</ul> : <p>No medication action recorded for this visit.</p>}</section></div><p className="source-note">Trace path retained for audit: {exactTarget ? target.jsonPath : `$.visits[${visit - 1}]`}. Technical JSON remains restricted to Admin/development audit.</p></Modal>;
}

function MyAssessments({ navigate }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api.assessments().then((result) => setItems(result.items)); }, []);
  return <div className="content-page"><PageHeader eyebrow="MY JUDGEMENTS" title="Assessment history" copy="Submitted assessments remain editable until the administrator finalizes a result that includes them." />{!items ? <LoadingState label="Loading assessment history…" /> : items.length ? <section className="surface data-table"><div className="table-head assessment-row"><span>Case / model run</span><span>Dataset</span><span>Score</span><span>Status</span><span>Updated</span><span /></div>{items.map((item) => <div className="table-row assessment-row" key={item.id}><div><b>{item.patientId}</b><small>{item.modelVersion} · {item.runId.slice(-8)}</small></div><div><b>{item.datasetName}</b><small>{item.criteria.length} dimensions</small></div><strong className="table-score">{item.overallScore?.toFixed(1) || "—"}</strong><div><StatusBadge>{item.locked ? "Locked" : item.status}</StatusBadge></div><span>{dateTime(item.updatedAt)}</span><button className="secondary-button compact" onClick={() => navigate("workspace", `${item.caseId}~${item.runId}`)}>{item.locked ? "View" : "Edit"}</button></div>)}</section> : <EmptyState icon={ListChecks} title="No assessments yet" copy="Open a case and evaluate a completed model response." />}</div>;
}
