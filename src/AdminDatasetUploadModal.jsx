import { useState } from "react";
import { ArrowsClockwise, FileArrowUp, ShieldCheck, UploadSimple, Warning } from "@phosphor-icons/react";
import { api, fileToBase64, uploadHospitalZip } from "./api.js";
import { Modal } from "./components.jsx";

export function AdminDatasetUploadModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);
  const submit = async () => {
    setBusy(true); setError("");
    try {
      if (file.name.toLowerCase().endsWith(".zip")) {
        const job = await uploadHospitalZip(file, { name: name || file.name.replace(/\.zip$/i, ""), description, onProgress: setProgress });
        onDone({ job });
      } else {
        onDone(await api.uploadDataset({ fileName: file.name, name: name || file.name.replace(/\.[^.]+$/, ""), description, contentBase64: await fileToBase64(file) }));
      }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <Modal title="Admin dataset intake" copy="Upload prepared JSON/CSV or a ZIP containing hospital CSV/CSV.GZ tables. Every source remains private until preprocessing and Admin approval are complete." onClose={onClose} wide>
    <div className="upload-zone"><FileArrowUp size={38} /><h3>{file ? file.name : "Choose a clinical dataset"}</h3><p>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.name.toLowerCase().endsWith(".zip") ? "resumable schema discovery" : "standard local validation"}` : "The immutable local source is fingerprinted with SHA-256."}</p>{progress && <div className="upload-progress"><i style={{ width: `${progress.percent}%` }} /><span>{progress.stage === "uploading" ? `Uploading ${progress.percent}%` : "Upload complete · discovering tables"}</span></div>}<label className="secondary-button file-picker">Select ZIP, JSON or CSV<input type="file" accept=".zip,.json,.csv" onChange={(event) => { const next = event.target.files?.[0]; setFile(next); setProgress(null); if (next && !name) setName(next.name.replace(/\.[^.]+$/, "")); }} /></label></div>
    <div className="form-grid"><label>Dataset name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Hospital research cohort" /></label><label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Source, purpose and limitations…" /></label></div>
    <div className="import-policy"><ShieldCheck size={18} /><span><b>Admin-only, private and local by default</b><small>Raw rows are not sent to an external model during preprocessing. Clinical notes remain restricted until de-identification and approval.</small></span></div>
    {error && <div className="form-error"><Warning size={17} />{error}</div>}
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!file || busy} onClick={submit}>{busy ? <><ArrowsClockwise className="spin" size={16} />Working…</> : <><UploadSimple size={16} />Start local intake</>}</button></div>
  </Modal>;
}
