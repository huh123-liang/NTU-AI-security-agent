import { useEffect, useMemo, useState } from "react";
import {
  CaretDown, ChartBar, ChatText, CheckCircle, Database, Eye, FileText, Gauge, LockKey, Sparkle,
  MagnifyingGlass, ShieldCheck, SlidersHorizontal, UsersThree, WarningCircle, Robot, ArrowRight, ArrowsClockwise, Plus, UploadSimple,
} from "@phosphor-icons/react";
import { api } from "./api.js";
import { CRITERIA, dateTime, titleCase } from "./constants.js";
import { EmptyState, ErrorState, LoadingState, MetricCard, Modal, PageHeader, StatusBadge } from "./components.jsx";
import { AdminDatasetUploadModal } from "./AdminDatasetUploadModal.jsx";

export const adminNav = [
  { key: "overview", label: "Overview", icon: Gauge },
  { key: "users", label: "Doctor accounts", icon: UsersThree },
  { key: "datasets", label: "Data processing", icon: Database },
  { key: "models", label: "Model registry", icon: Robot },
  { key: "official", label: "Official responses", icon: Robot },
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
  if (route === "models") return <ModelRegistry notify={notify} />;
  if (route === "official") return <OfficialRuns notify={notify} />;
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
        {["Admin imports, reviews and approves a dataset", "Admin assigns a registered model and pre-generates one Official Run", "Doctors independently score the same fixed blinded answer", "Admin previews the governed result", "Three or more submitted doctors enable the final lock"].map((label, index) => <div className="workflow-row" key={label}><span>{index + 1}</span><p>{label}</p>{index === 4 && <LockKey size={17} />}</div>)}
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
  const updateStatus = async (user, accessStatus) => { try { await api.setUserAccessStatus(user.id, accessStatus); notify(`${user.displayName}: ${accessStatus.replaceAll("_", " ")}.`); resource.refresh(); } catch (error) { notify(error.message); } };
  if (resource.loading) return <LoadingState label="Loading local accounts…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.refresh} />;
  const users = resource.value.items.filter((item) => item.role === "doctor" && `${item.displayName} ${item.email}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="content-page"><PageHeader eyebrow="ACCESS GOVERNANCE" title="Doctor accounts" copy="Doctors self-register and receive immediate local access. Preserve history while choosing active, scoring-suspended, or deactivated access." />
    <div className="toolbar surface"><label className="search-field"><MagnifyingGlass size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search doctor or email" /></label><span className="table-count">{users.length} doctor accounts</span></div>
    <section className="surface table-surface"><table className="data-table"><thead><tr><th>Doctor</th><th>Status</th><th>Assessments</th><th>Datasets</th><th>Registered</th><th>Account control</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><b>{user.displayName}</b><small>{user.email}</small></td><td><StatusBadge tone={user.accessStatus === "active" ? "success" : user.accessStatus === "scoring_suspended" ? "warning" : "danger"}>{titleCase((user.accessStatus || "deactivated").replaceAll("_", " "))}</StatusBadge></td><td>{user.assessmentCount}</td><td>{user.datasetCount}</td><td>{dateTime(user.createdAt)}</td><td><div className="account-actions"><button className="secondary-button compact" disabled={user.accessStatus === "active"} onClick={() => updateStatus(user, "active")}>Activate</button><button className="secondary-button compact" disabled={user.accessStatus === "scoring_suspended"} onClick={() => updateStatus(user, "scoring_suspended")}>Suspend scoring</button><button className="danger-button compact" disabled={user.accessStatus === "deactivated"} onClick={() => updateStatus(user, "deactivated")}>Deactivate</button></div></td></tr>)}</tbody></table>{!users.length && <EmptyState icon={UsersThree} title="No doctor accounts" copy="A doctor can create the first account from the unified login screen." />}</section>
  </div>;
}

function DatasetGovernance({ notify }) {
  const resource = useResource(() => Promise.all([api.datasets(), api.ingestionJobs()]), []);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [jobDetail, setJobDetail] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const open = async (dataset) => { setSelected(dataset); try { setDetail(await api.dataset(dataset.id)); } catch (error) { notify(error.message); } };
  const openJob = async (job) => { try { setJobDetail((await api.ingestionJob(job.id)).job); } catch (error) { notify(error.message); } };
  const review = async (status, visibility) => { try { await api.reviewDataset(selected.id, { status, visibility }); notify(`${selected.name}: ${status}, ${visibility}.`); setSelected(null); setDetail(null); resource.refresh(); } catch (error) { notify(error.message); } };
  useEffect(() => {
    const jobs = resource.value?.[1]?.items || [];
    if (!jobs.some((job) => ["Uploading", "Inspecting", "Processing"].includes(job.status))) return undefined;
    const timer = window.setInterval(resource.refresh, 1500); return () => window.clearInterval(timer);
  }, [resource.value]);
  if (resource.loading) return <LoadingState label="Loading dataset register…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.refresh} />;
  const [datasets, ingestion] = resource.value;
  const items = datasets.items;
  const jobs = ingestion.items;
  return <div className="content-page"><PageHeader eyebrow="LOCAL DATA PROCESSING PIPELINE" title="Discover, map, preprocess and approve" copy="Dataset intake is Admin-only. Raw hospital ZIPs stay local until mapping, quality review and explicit release." actions={<button className="primary-button" onClick={() => setUploadOpen(true)}><UploadSimple size={17} />Upload dataset</button>} />
    <section className="surface admin-ingestion-board"><div className="section-heading"><div><span className="eyebrow">PROCESSING QUEUE</span><h2>Hospital CSV ingestion</h2><p>Admin controls source upload, mapping confirmation, preprocessing and release approval.</p></div><span className="table-count">{jobs.length} jobs</span></div>{jobs.length ? <div className="admin-ingestion-list">{jobs.map((job) => <button key={job.id} onClick={() => openJob(job)}><span className="ingestion-stage-icon"><ArrowsClockwise className={["Inspecting", "Processing"].includes(job.status) ? "spin" : ""} size={18} /></span><span><b>{job.name}</b><small>{job.ownerName} · {job.sourceFilename}</small></span><div className="ingestion-progress"><i style={{ width: `${job.progress}%` }} /><small>{titleCase(job.stage.replaceAll("_", " "))} · {job.progress}%</small></div><StatusBadge tone={job.status === "Failed" || job.status === "Rejected" ? "danger" : job.status === "Approved" ? "success" : "warning"}>{job.status}</StatusBadge><ArrowRight size={16} /></button>)}</div> : <EmptyState icon={Database} title="No hospital preprocessing jobs" copy="Use Upload dataset to add ZIP bundles containing CSV or CSV.GZ tables." />}</section>
    <section className="surface table-surface"><table className="data-table"><thead><tr><th>Dataset</th><th>Owner</th><th>Data quality</th><th>Status</th><th>Visibility</th><th>Imported</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><b>{item.name}</b><small>{item.sourceFilename}</small></td><td>{item.ownerName}</td><td><b className="success-text">{item.validCount} valid</b><small className={item.quarantinedCount ? "danger-text" : ""}>{item.quarantinedCount} quarantined · {item.declaredCount} declared</small></td><td><StatusBadge>{item.status}</StatusBadge></td><td>{titleCase(item.visibility)}</td><td>{dateTime(item.createdAt)}</td><td><button className="row-button" onClick={() => open(item)}><Eye size={17} />Review</button></td></tr>)}</tbody></table></section>
    {selected && <Modal wide title={selected.name} copy="Source provenance, validation results and the administrative release decision." onClose={() => { setSelected(null); setDetail(null); }}>
      {!detail ? <LoadingState label="Reading validation report…" /> : <div className="dataset-review"><div className="provenance-grid"><span>SHA-256<b className="hash-value">{selected.sourceSha256}</b></span><span>Format<b>{selected.sourceFormat}</b></span><span>Declared<b>{selected.declaredCount}</b></span><span>Accepted<b>{selected.validCount}</b></span></div>
        <div className="quality-summary"><div><CheckCircle size={20} /><span><b>{selected.validCount} records accepted</b><small>Stored with original evidence and per-case hash.</small></span></div><div><WarningCircle size={20} /><span><b>{selected.quarantinedCount} entries quarantined</b><small>No missing patient record was invented.</small></span></div></div>
        <div className="issue-list"><h3>Validation issues</h3>{detail.issues.slice(0, 12).map((issue) => <article key={issue.id}><StatusBadge tone={issue.severity === "high" ? "danger" : "warning"}>{issue.severity}</StatusBadge><div><b>{issue.code} · {issue.patientId || "dataset"}</b><p>{issue.message}</p></div></article>)}{!detail.issues.length && <p className="muted">No validation issues were recorded.</p>}</div>
        <div className="modal-actions"><button className="danger-button" onClick={() => review("Rejected", "private")}>Reject &amp; keep private</button><button className="secondary-button" onClick={() => review("Approved", "private")}>Approve for owner only</button><button className="primary-button" onClick={() => review("Approved", "shared")}>Approve &amp; share</button></div>
      </div>}
    </Modal>}
    {jobDetail && <AdminIngestionModal initialJob={jobDetail} onClose={() => setJobDetail(null)} onChanged={() => { setJobDetail(null); resource.refresh(); }} notify={notify} />}
    {uploadOpen && <AdminDatasetUploadModal onClose={() => setUploadOpen(false)} onDone={(result) => { setUploadOpen(false); resource.refresh(); notify(result.job ? "Upload complete. Local schema discovery is running." : `Dataset imported: ${result.valid} valid, ${result.quarantined} quarantined; Admin approval is required.`); }} />}
  </div>;
}

function AdminIngestionModal({ initialJob, onClose, onChanged, notify }) {
  const [job, setJob] = useState(initialJob);
  const [mapping, setMapping] = useState(initialJob.mapping || { tables: [] });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setJob(initialJob); setMapping(initialJob.mapping || { tables: [] }); }, [initialJob]);
  useEffect(() => {
    if (!["Inspecting", "Processing"].includes(job.status)) return undefined;
    const timer = window.setInterval(async () => { const next = (await api.ingestionJob(job.id)).job; setJob(next); setMapping(next.mapping || { tables: [] }); }, 1300);
    return () => window.clearInterval(timer);
  }, [job.id, job.status]);
  const updateRole = (entry, role) => setMapping((current) => ({ ...current, tables: current.tables.map((table) => table.entry === entry ? { ...table, role } : table) }));
  const updateField = (entry, field, canonical) => setMapping((current) => ({ ...current, tables: current.tables.map((table) => table.entry === entry ? { ...table, fields: { ...table.fields, [field]: canonical } } : table) }));
  const start = async () => { setBusy(true); try { await api.saveIngestionMapping(job.id, mapping); await api.processIngestion(job.id); notify("Mapping confirmed. Local preprocessing started."); onChanged(); } catch (error) { notify(error.message); } finally { setBusy(false); } };
  const retry = async () => { setBusy(true); try { await api.retryIngestion(job.id); notify("Processing retry started."); onChanged(); } catch (error) { notify(error.message); } finally { setBusy(false); } };
  const decide = async (decision, visibility = "private") => { setBusy(true); try { await api.approveIngestion(job.id, { decision, visibility }); notify(`${job.name}: ${decision}.`); onChanged(); } catch (error) { notify(error.message); } finally { setBusy(false); } };
  const discovery = job.discovery || {};
  const quality = job.quality || {};
  const fieldLookup = new Map((discovery.tables || []).map((table) => [table.entry, table]));
  return <Modal wide className="ingestion-admin-modal" title={job.name} copy={`${job.ownerName} · ${job.sourceFilename} · ${job.status}`} onClose={onClose}>
    <div className="ingestion-stage-strip">{[["uploading", "Upload"], ["inspecting", "Discover"], ["awaiting_mapping", "Map"], ["processing", "Process"], ["quality_review", "Approve"]].map(([stage, label], index) => { const order = ["uploading", "inspecting", "awaiting_mapping", "processing", "building_cases", "quality_review", "approved"]; const current = order.indexOf(job.stage); const target = order.indexOf(stage); return <span className={current >= target ? "done" : ""} key={stage}><b>{index + 1}</b>{label}</span>; })}</div>
    <div className="quality-metrics"><div><small>Progress</small><strong>{job.progress}%</strong></div><div><small>Detected tables</small><strong>{discovery.tableCount ?? "—"}</strong></div><div className="success"><small>Eligible cases</small><strong>{quality.eligibleCases ?? "—"}</strong></div><div className="danger"><small>Quarantined</small><strong>{quality.quarantinedCases ?? "—"}</strong></div></div>
      {job.status === "Awaiting Mapping" && <><div className="mapping-safety-note"><ShieldCheck size={19} /><div><b>Human confirmation boundary</b><p>Suggestions are local and rules-based. Low-confidence fields remain ignored; no raw patient value is sent to an external model.</p></div></div><div className="mapping-table-list">{(mapping.tables || []).map((table) => { const discovered = fieldLookup.get(table.entry); return <section key={table.entry}><header><div><b>{table.entry}</b><small>{discovered?.sampleRows || 0} rows sampled · {(discovered?.uncompressedSize / 1024 / 1024 || 0).toFixed(1)} MB expanded</small></div><label>Table role<select value={table.role} onChange={(event) => updateRole(table.entry, event.target.value)}><option value="patient">Patient</option><option value="encounter">Encounter</option><option value="diagnosis">Diagnosis</option><option value="dictionary">Code dictionary</option><option value="observation">Observation</option><option value="medication">Medication</option><option value="procedure">Procedure</option><option value="allergy">Allergy</option><option value="note">Clinical note (restricted)</option><option value="mixed">Mixed</option><option value="ignore">Ignore table</option></select></label></header><div className="mapping-field-grid"><span>Source field</span><span>Detected evidence</span><span>Canonical field</span>{(discovered?.fields || []).map((field) => <div className="mapping-field-row" key={field.name}><b>{field.name}</b><span><small>{Math.round(field.confidence * 100)}% confidence</small>{field.sample?.length ? field.sample.join(" · ").slice(0, 90) : "No non-empty sample"}</span><select value={table.fields?.[field.name] || "ignore"} onChange={(event) => updateField(table.entry, field.name, event.target.value)}>{(discovery.canonicalFields || ["ignore"]).map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}</select></div>)}</div></section>; })}</div><div className="modal-actions"><button className="secondary-button" onClick={onClose}>Close without changes</button><button className="primary-button" disabled={busy} onClick={start}>{busy ? <ArrowsClockwise className="spin" size={16} /> : <ShieldCheck size={16} />}Confirm mapping &amp; preprocess</button></div></>}
    {["Inspecting", "Processing", "Uploading"].includes(job.status) && <LoadingState label={`${titleCase(job.stage.replaceAll("_", " "))} · ${job.progress}%`} />}
    {job.status === "Awaiting Approval" && <><div className="quality-review-grid"><article><b>Clinical cases</b><strong>{quality.eligibleCases || 0}</strong><p>One or more meaningful clinical records; any diagnosis type and undated snapshots are supported.</p></article><article><b>Source measurements</b><strong>{quality.validMeasurements || 0}</strong><p>{quality.invalidMeasurements || 0} invalid or unparseable measurements excluded.</p></article><article><b>Transparent imputation</b><strong>{quality.imputedFields || 0}</strong><p>Only limited height, weight or BMI LOCF; critical clinical values were never fabricated.</p></article></div><div className="mapping-safety-note"><ShieldCheck size={19} /><div><b>Approval creates an immutable version</b><p>Task routing adapts to single-record, short longitudinal, standard longitudinal or undated snapshot cases. Doctors cannot open cases until shared approval.</p></div></div><div className="modal-actions"><button className="danger-button" disabled={busy} onClick={() => decide("Rejected")}>Reject version</button><button className="secondary-button" disabled={busy} onClick={() => decide("Approved", "private")}>Approve privately</button><button className="primary-button" disabled={busy} onClick={() => decide("Approved", "shared")}>Approve &amp; share</button></div></>}
    {job.status === "Failed" && <><div className="form-error"><WarningCircle size={18} />{job.errorMessage || "Processing failed."}</div><div className="modal-actions"><button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" disabled={busy} onClick={retry}><ArrowsClockwise size={16} />Retry current stage</button></div></>}
    {["Approved", "Rejected", "Cancelled"].includes(job.status) && <div className="mapping-safety-note"><CheckCircle size={19} /><div><b>{job.status}</b><p>This decision and the exact processed version remain in the local audit trail.</p></div></div>}
  </Modal>;
}

const PROVIDER_DEFAULTS = {
  deepseek: { baseUrl: "https://api.deepseek.com", modelId: "deepseek-chat" },
  openai: { baseUrl: "https://api.openai.com/v1", modelId: "gpt-5" },
  qwen: { baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", modelId: "qwen-plus" },
  glm: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", modelId: "glm-4.5" },
  "openai-compatible": { baseUrl: "https://", modelId: "" },
};

function ModelRegistry({ notify }) {
  const resource = useResource(() => Promise.all([api.models(), api.datasets()]), []);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [assignment, setAssignment] = useState(null);
  const [form, setForm] = useState({ displayName: "", anonymousName: "", provider: "deepseek", protocol: "openai_chat", baseUrl: PROVIDER_DEFAULTS.deepseek.baseUrl, modelId: PROVIDER_DEFAULTS.deepseek.modelId, apiKey: "", diseaseTags: "", specialtyTags: "", capabilityTags: "clinical planning, evidence citation", promptTemplate: "", temperature: 0.2, maxTokens: 3200, timeoutMs: 90000 });
  useEffect(() => { if (!datasetId && resource.value?.[1]?.items?.[0]) setDatasetId(resource.value[1].items[0].id); }, [resource.value, datasetId]);
  useEffect(() => { if (!datasetId) return; api.datasetModelAssignment(datasetId).then(setAssignment).catch((error) => notify(error.message)); }, [datasetId]);
  if (resource.loading) return <LoadingState label="Loading model registry…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.refresh} />;
  const [modelsResult, datasetsResult] = resource.value;
  const models = modelsResult.items;
  const create = async () => { setBusy("create"); try { await api.createModel({ ...form, diseaseTags: form.diseaseTags.split(","), specialtyTags: form.specialtyTags.split(","), capabilityTags: form.capabilityTags.split(",") }); notify("Model configuration saved with its API key encrypted locally."); setOpen(false); resource.refresh(); } catch (error) { notify(error.message); } finally { setBusy(""); } };
  const test = async (model) => { setBusy(model.id); try { await api.testModel(model.id); notify(`${model.displayName}: connection test succeeded.`); } catch (error) { notify(error.message); } finally { setBusy(""); } };
  const toggle = async (model, isDefault = false) => { setBusy(model.id); try { await api.setModelStatus(model.id, { status: model.status === "active" ? "disabled" : "active", isDefault }); notify(`${model.displayName} updated.`); resource.refresh(); } catch (error) { notify(error.message); } finally { setBusy(""); } };
  const assign = async (modelId) => { if (!datasetId) return; setBusy("assign"); try { const result = await api.assignDatasetModel(datasetId, modelId); setAssignment(result); notify("Dataset routing confirmed."); } catch (error) { notify(error.message); } finally { setBusy(""); } };
  return <div className="content-page"><PageHeader eyebrow="MODEL GOVERNANCE" title="Model registry & routing" copy="Register versioned clinical models through the OpenAI-compatible Chat Completions protocol. Credentials are encrypted locally and never returned to the browser." actions={<button className="primary-button" onClick={() => setOpen(true)}><Plus size={16} />Register model</button>} />
    <div className="model-registry-grid">{models.map((model) => <article className="surface model-card" key={model.id}><header><span className="model-icon"><Robot size={21} /></span><div><h3>{model.displayName}</h3><p>{model.anonymousName} · v{model.version}</p></div><StatusBadge tone={model.status === "active" ? "success" : "warning"}>{model.status}</StatusBadge></header><dl><div><dt>Provider / protocol</dt><dd>{titleCase(model.provider)} · {model.protocol}</dd></div><div><dt>Model ID</dt><dd>{model.modelId}</dd></div><div><dt>Credential</dt><dd>{model.apiKeyConfigured ? `Encrypted ${model.apiKeyHint}` : "Not configured"}</dd></div><div><dt>Capabilities</dt><dd>{model.capabilityTags.join(", ") || "General"}</dd></div></dl><footer><button className="secondary-button compact" disabled={Boolean(busy)} onClick={() => test(model)}>{busy === model.id ? <ArrowsClockwise className="spin" size={14} /> : <ShieldCheck size={14} />}Test</button><button className="secondary-button compact" disabled={Boolean(busy)} onClick={() => toggle(model)}>{model.status === "active" ? "Disable" : "Enable"}</button>{model.isDefault ? <StatusBadge tone="success">Default</StatusBadge> : model.status === "active" && <button className="text-button" onClick={() => api.setModelStatus(model.id, { status: "active", isDefault: true }).then(() => resource.refresh()).catch((error) => notify(error.message))}>Set default</button>}</footer></article>)}</div>
    <section className="surface model-routing-panel"><div className="section-heading"><div><span className="eyebrow">DATASET ROUTING</span><h2>Confirm the model for a cohort</h2><p>The platform suggests a model from tags; Admin makes the final assignment. Individual cases may still be run against another active model.</p></div></div><div className="routing-controls"><label>Dataset<select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{datasetsResult.items.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><label>Assigned model<select value={assignment?.assigned?.id || ""} onChange={(event) => assign(event.target.value)} disabled={busy === "assign"}><option value="">Select model…</option>{models.filter((model) => model.status === "active").map((model) => <option key={model.id} value={model.id}>{model.displayName} · {model.modelId}</option>)}</select></label><div className="routing-recommendation"><Sparkle size={18} /><span><b>Recommendation: {assignment?.recommendation?.recommendation?.displayName || "Loading…"}</b><small>{assignment?.recommendation?.reason || "Matching conditions and capability tags locally."}</small></span></div></div></section>
    {open && <Modal wide title="Register a model" copy="Use a supported provider preset or any endpoint implementing OpenAI-compatible /chat/completions." onClose={() => setOpen(false)}><div className="form-grid model-form"><label>Display name<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Cardiology planning model" /></label><label>Blinded Doctor label<input value={form.anonymousName} onChange={(event) => setForm({ ...form, anonymousName: event.target.value })} placeholder="Model B" /></label><label>Provider<select value={form.provider} onChange={(event) => { const provider = event.target.value; setForm({ ...form, provider, ...PROVIDER_DEFAULTS[provider] }); }}><option value="deepseek">DeepSeek</option><option value="qwen">Qwen</option><option value="openai">OpenAI</option><option value="glm">GLM</option><option value="openai-compatible">Other OpenAI-compatible</option></select></label><label>Model ID<input value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })} /></label><label className="full">Base URL<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /></label><label className="full">API key<input type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="Stored encrypted on this computer" /></label><label>Disease tags<input value={form.diseaseTags} onChange={(event) => setForm({ ...form, diseaseTags: event.target.value })} placeholder="cardiology, heart failure" /></label><label>Specialty tags<input value={form.specialtyTags} onChange={(event) => setForm({ ...form, specialtyTags: event.target.value })} placeholder="cardiology" /></label><label>Temperature<input type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={(event) => setForm({ ...form, temperature: Number(event.target.value) })} /></label><label>Max tokens<input type="number" min="128" value={form.maxTokens} onChange={(event) => setForm({ ...form, maxTokens: Number(event.target.value) })} /></label><label className="full">Admin prompt extension<textarea value={form.promptTemplate} onChange={(event) => setForm({ ...form, promptTemplate: event.target.value })} placeholder="Optional specialty-specific constraints…" /></label></div><div className="modal-actions"><button className="secondary-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" disabled={busy === "create" || !form.displayName || !form.modelId || !form.baseUrl} onClick={create}>{busy === "create" ? <ArrowsClockwise className="spin" size={15} /> : <ShieldCheck size={15} />}Save encrypted configuration</button></div></Modal>}
  </div>;
}

function OfficialRuns({ notify }) {
  const datasets = useResource(api.datasets, []);
  const models = useResource(api.models, []);
  const [datasetId, setDatasetId] = useState("");
  const [modelConfigId, setModelConfigId] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState({ loading: false, error: "", items: [] });
  const [busyId, setBusyId] = useState("");
  useEffect(() => { if (!datasetId && datasets.value?.items?.[0]) setDatasetId(datasets.value.items[0].id); }, [datasets.value, datasetId]);
  useEffect(() => { if (!modelConfigId && models.value?.items?.length) setModelConfigId(models.value.items.find((item) => item.isDefault)?.id || models.value.items[0].id); }, [models.value, modelConfigId]);
  const refresh = () => { if (!datasetId) return; setState((current) => ({ ...current, loading: true, error: "" })); api.officialRuns({ datasetId, search, modelConfigId }).then((result) => setState({ loading: false, error: "", items: result.items })).catch((error) => setState({ loading: false, error: error.message, items: [] })); };
  useEffect(() => { const timer = window.setTimeout(refresh, 120); return () => window.clearTimeout(timer); }, [datasetId, search, modelConfigId]);
  useEffect(() => { if (!state.items.some((item) => item.officialRun?.status === "Running")) return undefined; const timer = window.setInterval(refresh, 1200); return () => window.clearInterval(timer); }, [state.items, datasetId, search]);
  const generate = async (item) => { const replace = item.officialRun?.studyStatus === "Official"; const retry = item.officialRun?.studyStatus === "Official failed"; if (replace && !window.confirm("Regenerate this Official Run? The existing answer for this model and task will be archived; its assessments remain separate.")) return; setBusyId(item.id); try { if (retry) await api.retryRun(item.officialRun.id); else await api.generateOfficialRun(item.id, modelConfigId); notify(retry ? "Official Run retry started." : replace ? "Replacement Official Run started." : "Official Run generation started for the selected model."); refresh(); } catch (error) { notify(error.message); } finally { setBusyId(""); } };
  if (datasets.loading || models.loading) return <LoadingState label="Loading study cohorts and models…" />;
  if (datasets.error || models.error) return <ErrorState message={datasets.error || models.error} retry={() => { datasets.refresh(); models.refresh(); }} />;
  return <div className="content-page"><PageHeader eyebrow="STUDY ANSWER GOVERNANCE" title="Official AI responses" copy="Create separate immutable evaluation batches for each case, task and model. Doctors see only blinded model labels." />
    <div className="toolbar surface"><label className="search-field"><MagnifyingGlass size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patient or condition" /></label><select className="dataset-select" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{datasets.value.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className="dataset-select" value={modelConfigId} onChange={(event) => setModelConfigId(event.target.value)}>{models.value.items.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.modelId}</option>)}</select></div>
    {state.loading && !state.items.length ? <LoadingState label="Loading study cases…" /> : state.error ? <ErrorState message={state.error} retry={refresh} /> : <section className="surface table-surface"><table className="data-table"><thead><tr><th>Case</th><th>Conditions</th><th>Official Run</th><th>Independent scores</th><th /></tr></thead><tbody>{state.items.map((item) => <tr key={item.id}><td><b>{item.patientId}</b><small>{item.age || "—"} years · {titleCase(item.sex)}</small></td><td>{item.condition}</td><td>{item.officialRun ? <><StatusBadge tone={item.officialRun.studyStatus === "Official" ? "success" : item.officialRun.studyStatus === "Official failed" ? "danger" : "warning"}>{item.officialRun.studyStatus}</StatusBadge><small>{item.officialRun.status} · {item.officialRun.modelVersion}<br />{item.officialRun.outputHash ? `Hash ${item.officialRun.outputHash.slice(0, 10)}…` : item.officialRun.studyStatus === "Official failed" ? "Generation failed — retry when network is available" : "Answer not yet saved"}</small></> : <span className="muted">Not generated</span>}</td><td><b>{item.officialRun?.submittedDoctors || 0} / 3 Doctors</b><small>{item.officialRun?.submittedDoctors >= 3 ? "Eligible for finalization" : "Minimum required before final lock"}</small></td><td><button className={item.officialRun?.studyStatus === "Official" ? "secondary-button compact" : "primary-button compact"} disabled={Boolean(busyId) || item.officialRun?.studyStatus === "Official pending"} onClick={() => generate(item)}>{busyId === item.id ? <ArrowsClockwise className="spin" size={14} /> : <Robot size={14} />}{item.officialRun?.studyStatus === "Official" ? "Regenerate" : item.officialRun?.studyStatus === "Official failed" ? "Retry official" : "Generate official"}</button></td></tr>)}</tbody></table></section>}
  </div>;
}

function EvaluationRegister() {
  const resource = useResource(api.assessments, []);
  const [query, setQuery] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [selected, setSelected] = useState(null);
  const [comparison, setComparison] = useState(null);
  if (resource.loading) return <LoadingState label="Loading clinician evaluations…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.refresh} />;
  const visible = resource.value.items.filter((item) => `${item.reviewerName} ${item.reviewerEmail} ${item.patientId} ${item.datasetName}`.toLowerCase().includes(query.toLowerCase()));
  const doctors = [...new Map(visible.map((item) => [item.reviewerId, { id: item.reviewerId, name: item.reviewerName, email: item.reviewerEmail, count: visible.filter((entry) => entry.reviewerId === item.reviewerId).length }])).values()];
  const doctorItems = visible.filter((item) => item.reviewerId === doctorId);
  const comparable = comparison ? resource.value.items.filter((item) => item.runId === comparison.runId && item.caseId === comparison.caseId && item.promptVersion === comparison.promptVersion && item.outputHash === comparison.outputHash) : [];
  return <div className="content-page"><PageHeader eyebrow="GROUND TRUTH REGISTER" title="Clinician evaluations" copy="Start with a doctor, inspect the cases they scored, then compare only assessments of the exact same Official Run." />
    <div className="toolbar surface"><label className="search-field"><MagnifyingGlass size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setDoctorId(""); }} placeholder="Search doctor, patient or dataset" /></label><span className="table-count">{doctors.length} doctors · {visible.length} records</span></div>
    {!doctorId ? <section className="doctor-directory">{doctors.map((doctor) => <button className="surface doctor-directory-card" key={doctor.id} onClick={() => setDoctorId(doctor.id)}><span className="directory-avatar">{doctor.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><b>{doctor.name}</b><small>{doctor.email}</small></span><strong>{doctor.count}<small>assessments</small></strong><ArrowRight size={18} /></button>)}{!doctors.length && <EmptyState title="No evaluations yet" copy="Submitted doctor assessments will appear here." />}</section> : <><div className="register-breadcrumb"><button className="text-button" onClick={() => { setDoctorId(""); setSelected(null); }}>All doctors</button><ArrowRight size={14} /><b>{doctorItems[0]?.reviewerName}</b><span>{doctorItems.length} assessments</span></div><section className="surface table-surface"><table className="data-table"><thead><tr><th>Patient / dataset</th><th>Official run</th><th>Overall</th><th>Status</th><th>Updated</th><th /></tr></thead><tbody>{doctorItems.map((item) => { const peers = resource.value.items.filter((peer) => peer.runId === item.runId && peer.caseId === item.caseId && peer.promptVersion === item.promptVersion && peer.outputHash === item.outputHash); return <tr key={item.id}><td><b>{item.patientId}</b><small>{item.datasetName}</small></td><td><span className="mono">{item.runId}</span><small>{item.studyStatus} · {item.modelVersion}</small></td><td><span className="score-pill">{item.overallScore ?? "—"} / 5</span></td><td><StatusBadge>{item.locked ? "Locked" : item.status}</StatusBadge></td><td>{dateTime(item.updatedAt)}</td><td><div className="row-actions"><button className="row-button" onClick={() => setSelected(item)}><Eye size={17} />Inspect</button><button className="row-button" disabled={!item.outputHash || peers.length < 2} onClick={() => setComparison(item)}>Compare</button></div></td></tr>; })}</tbody></table></section></>}
    {selected && <AssessmentDetail assessment={selected} onClose={() => setSelected(null)} />}
    {comparison && <ComparisonModal anchor={comparison} candidates={comparable} onClose={() => setComparison(null)} />}
  </div>;
}

function ComparisonModal({ anchor, candidates, onClose }) {
  const [selectedIds, setSelectedIds] = useState(() => candidates.slice(0, 4).map((item) => item.id));
  const [expandedFeedback, setExpandedFeedback] = useState(() => new Set());
  const selected = candidates.filter((item) => selectedIds.includes(item.id));
  const toggle = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleFeedback = (key) => setExpandedFeedback((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const detailed = selected.length <= 4;
  const feedbackCell = (item, criterion) => {
    const value = item.criteria.find((entry) => entry.key === criterion.key) || { score: null, feedback: "", tags: [], customTags: [] };
    const key = `${item.id}:${criterion.key}`;
    const expanded = expandedFeedback.has(key);
    const tags = [...(value.tags || []), ...(value.customTags || [])];
    return { value, key, expanded, tags };
  };
  return <Modal wide className="comparison-modal" title={`Compare assessments · ${anchor.patientId}`} copy="Only the same case, Official Run, prompt version, and output hash can be compared. Peer doctors never see this view." onClose={onClose}><div className="comparison-modal-body"><div className="comparison-toolbar"><div className="comparison-picker">{candidates.map((item) => <label key={item.id}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} />{item.reviewerName}<small>{item.overallScore ?? "—"} / 5</small></label>)}</div><span className="comparison-count">{selected.length} selected</span></div>{selected.length < 2 ? <EmptyState title="Select at least two doctors" copy="Comparison requires independent assessments of the exact same official answer." /> : detailed ? <div className="comparison-scroll"><div className={`comparison-board count-${selected.length}`} style={{ "--compare-columns": selected.length }}><div className="comparison-row comparison-doctor-row">{selected.map((item) => <article className="comparison-doctor-head" key={item.id}><span className="directory-avatar">{item.reviewerName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><b>{item.reviewerName}</b><small>{item.reviewerEmail}</small></div><span className="score-pill">{item.overallScore ?? "—"} / 5</span></article>)}</div>{CRITERIA.map((criterion, criterionIndex) => { const cells = selected.map((item) => ({ item, ...feedbackCell(item, criterion) })); const scores = cells.map(({ value }) => Number(value.score || 0)); const highest = Math.max(...scores); const lowest = Math.min(...scores); const spread = highest - lowest; const disagreement = spread >= 2; return <div className={`comparison-row comparison-rubric-row${disagreement ? " high-disagreement" : ""}`} key={criterion.key}>{cells.map(({ item, value, key, expanded, tags }) => <article className="comparison-cell" key={item.id}><header><span><small>{criterionIndex + 1}</small><b>{criterion.label}</b></span><div><strong>{value.score ?? "—"}<small>/5</small></strong>{disagreement && value.score === highest && <em className="score-extreme high">Highest</em>}{disagreement && value.score === lowest && <em className="score-extreme low">Lowest</em>}</div></header>{disagreement && <span className="disagreement-label">High disagreement · Δ {spread}</span>}<div className="tag-row">{tags.map((tag) => <span key={tag}>{tag}</span>)}{!tags.length && <small>No tags selected</small>}</div>{value.feedback ? <><button type="button" className="compare-feedback-toggle" aria-expanded={expanded} onClick={() => toggleFeedback(key)}><ChatText size={13} />{expanded ? "Collapse feedback" : "View feedback"}<CaretDown className={expanded ? "open" : ""} size={13} /></button>{expanded && <p className="compare-feedback-text">{value.feedback}</p>}</> : <p className="no-feedback">No text feedback provided.</p>}</article>)}</div>; })}<div className="comparison-row comparison-support-row">{selected.map((item) => <article className="comparison-cell" key={item.id}><header><b>Safety-critical check</b></header><strong className={`safety-value ${String(item.safetyIssue).toLowerCase() === "yes" ? "concern" : ""}`}>{item.safetyIssue || "Undecided"}</strong></article>)}</div><div className="comparison-row comparison-support-row">{selected.map((item) => <article className="comparison-cell" key={item.id}><header><b>Missing / needs clarification</b></header><div className="tag-row">{(item.reasonTags || []).map((tag) => <span key={tag}>{tag}</span>)}{!item.reasonTags?.length && <small>None selected</small>}</div></article>)}</div><div className="comparison-row comparison-support-row comparison-final-row">{selected.map((item) => { const key = `${item.id}:case-feedback`; const expanded = expandedFeedback.has(key); const text = item.caseFeedback || ""; return <article className="comparison-cell" key={item.id}><header><b>Case feedback</b></header>{text ? <><p className={`case-feedback-preview${expanded ? " expanded" : ""}`}>{text}</p><button type="button" className="compare-feedback-toggle" aria-expanded={expanded} onClick={() => toggleFeedback(key)}><ChatText size={13} />{expanded ? "Collapse feedback" : "View full feedback"}<CaretDown className={expanded ? "open" : ""} size={13} /></button></> : <p className="no-feedback">No case feedback provided.</p>}</article>; })}</div></div></div> : <div className="comparison-scroll"><div className="comparison-matrix"><table><thead><tr><th>Rubric</th>{selected.map((item) => <th key={item.id}>{item.reviewerName}</th>)}</tr></thead><tbody>{CRITERIA.map((criterion) => { const values = selected.map((item) => item.criteria.find((entry) => entry.key === criterion.key)?.score || 0); const spread = Math.max(...values) - Math.min(...values); return <tr key={criterion.key} className={spread >= 2 ? "high-disagreement" : ""}><td>{criterion.label}{spread >= 2 && <small>High disagreement</small>}</td>{values.map((value, index) => <td key={`${criterion.key}-${index}`}>{value}/5</td>)}</tr>; })}</tbody></table><p>Five or more doctors are shown as a score matrix. Reduce selection to four or fewer to inspect tags and free-text feedback side-by-side.</p></div></div>}</div></Modal>;
}

function AssessmentDetail({ assessment, onClose }) {
  return <Modal wide title={`${assessment.reviewerName} · ${assessment.patientId}`} copy={`Assessment ${assessment.id}, version ${assessment.version}.`} onClose={onClose}><div className="assessment-detail">
    <div className="detail-summary"><span>Overall score<b>{assessment.overallScore} / 5</b></span><span>Safety concern<b>{assessment.safetyIssue}</b></span><span>State<b>{assessment.locked ? "Locked" : assessment.status}</b></span><span>Model<b>{assessment.modelVersion}</b></span></div>
    <div className="criterion-detail-list">{assessment.criteria.map((item) => <article key={item.key}><div className="criterion-score"><strong>{item.score}</strong><small>/5</small></div><div><h3>{CRITERIA.find((criterion) => criterion.key === item.key)?.label || item.key}</h3><p>{item.feedback || "No free-text feedback provided."}</p><div className="tag-row">{[...item.tags, ...item.customTags].map((tag) => <span key={tag}>{tag}</span>)}{!item.tags.length && !item.customTags.length && <small>No tags selected</small>}</div></div></article>)}</div>
    <div className="case-feedback"><h3>Overall case feedback</h3><p>{assessment.caseFeedback || "No overall feedback provided."}</p></div>
  </div></Modal>;
}

function AggregationStudio({ notify, navigate }) {
  const resource = useResource(api.assessments, []);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [method, setMethod] = useState("mean");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const submitted = resource.value?.items?.filter((item) => item.status === "Submitted" && item.studyStatus === "Official") || [];
  const targets = useMemo(() => { const map = new Map(); submitted.forEach((item) => map.set(item.runId, `${item.patientId} · Official Run ${item.runId.slice(-8)}`)); return [...map].map(([id, label]) => ({ id, label })); }, [submitted]);
  const included = submitted.filter((item) => item.runId === selectedTarget && !item.locked);
  const reviewerCount = new Set(included.map((item) => item.reviewerId)).size;
  useEffect(() => { setSelectedTarget(targets[0]?.id || ""); setPreview(null); }, [resource.loading, targets.length]);
  const payload = { level: "run", targetId: selectedTarget, method, includedAssessmentIds: included.map((item) => item.id) };
  const runPreview = async () => { setBusy(true); try { const value = await api.previewAggregation(payload); setPreview(value.result); } catch (error) { notify(error.message); } finally { setBusy(false); } };
  const finalize = async () => { if (!window.confirm("Finalize this result and lock all included assessments? This action cannot be edited in the current MVP.")) return; setBusy(true); try { const value = await api.finalizeAggregation(payload); notify(`Final result ${value.finalization.id} locked.`); navigate("results"); } catch (error) { notify(error.message); } finally { setBusy(false); } };
  if (resource.loading) return <LoadingState label="Preparing aggregation inputs…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.refresh} />;
  return <div className="content-page"><PageHeader eyebrow="CONSENSUS ENGINE" title="Aggregation studio" copy="Preview and lock one Official Run at a time. The equal doctor and rubric-weight preset was recorded before clinicians scored." />
    <div className="aggregation-layout"><section className="surface aggregation-controls"><h2>1. Select an Official Run</h2><div className="form-grid"><label>Target<select value={selectedTarget} onChange={(event) => { setSelectedTarget(event.target.value); setPreview(null); }}><option value="">Select a target</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Method<select value={method} onChange={(event) => { setMethod(event.target.value); setPreview(null); }}><option value="mean">Arithmetic mean</option><option value="median">Median</option><option value="weighted">Weighted mean</option></select></label></div>
      <h2>2. Locked study preset</h2><div className="preset-card"><ShieldCheck size={20} /><div><b>Official preset v1</b><p>All Doctors = 1.0 · all six dimensions = 1.0. This preset is retained with the Official Run before scoring begins.</p></div></div>
      <h2>3. Finalization eligibility</h2><div className={`eligibility-card${reviewerCount >= 3 ? " eligible" : ""}`}><b>{reviewerCount} / 3 distinct Doctors submitted</b><small>{reviewerCount >= 3 ? "Eligible to lock the final result." : "Preview is available now; final locking is blocked until three Doctors submit."}</small></div>
      <button className="primary-button wide" disabled={busy || !included.length} onClick={runPreview}>{busy ? "Calculating…" : "Preview governed result"}</button>
    </section>
    <section className="surface aggregation-result"><h2>Result preview</h2>{!preview ? <EmptyState icon={ChartBar} title="No preview calculated" copy="Select a target and calculate the result. Nothing is locked at the preview stage." /> : <><div className="consensus-score"><span><strong>{preview.finalScore}</strong><small>/5</small></span><div><b>{titleCase(preview.method)} result</b><p>{preview.sampleSize} assessments · {preview.reviewerCount} doctors · one Official Run</p></div></div><div className="result-bars">{Object.entries(preview.criteria).map(([key, item]) => <div key={key}><span>{item.label}<small>{item.minimum}–{item.maximum} observed</small></span><div><i style={{ width: `${item.score / 5 * 100}%` }} /><b>{item.score}</b></div></div>)}</div><div className="lock-warning"><LockKey size={20} /><p><b>Finalization is permanent in this MVP.</b> The {preview.sampleSize} included assessments become read-only and retain the method plus Official Run preset in the audit record.</p></div><button className="danger-button wide" disabled={busy || preview.reviewerCount < 3} onClick={finalize}><LockKey size={17} />Finalize and lock result</button></>}</section></div>
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
