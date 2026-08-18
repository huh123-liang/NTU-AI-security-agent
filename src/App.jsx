import { useEffect, useState } from "react";
import { Check, WarningCircle } from "@phosphor-icons/react";
import { api, sessionStore } from "./api.js";
import { AdminPortal, adminNav } from "./AdminPortal.jsx";
import { AuthPage } from "./AuthPage.jsx";
import { DoctorPortal, doctorNav } from "./DoctorPortal.jsx";
import { LoadingState, Modal, Shell, Toast } from "./components.jsx";

function readRoute() {
  const [route = "overview", id = ""] = window.location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  return { route: route || "overview", routeId: id || "" };
}

export function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(sessionStore.get()));
  const [location, setLocation] = useState(readRoute);
  const [toast, setToast] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    if (!sessionStore.get()) return;
    api.me().then(({ user: account }) => setUser(account)).catch(() => sessionStore.clear()).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const onHash = () => setLocation(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const notify = (message) => {
    setToast(message);
    window.clearTimeout(window.__ntuToastTimer);
    window.__ntuToastTimer = window.setTimeout(() => setToast(""), 3600);
  };

  const navigate = (route, id = "") => { window.location.hash = `#/${route}${id ? `/${encodeURIComponent(id)}` : ""}`; };
  const authenticated = (account) => { setUser(account); navigate("overview"); };
  const logout = async () => {
    try { await api.logout(); } catch { /* Always clear the local session. */ }
    sessionStore.clear(); setUser(null); window.location.hash = "";
  };

  if (checking) return <div className="boot-screen"><LoadingState label="Opening the local evaluation platform…" /></div>;
  if (!user) return <AuthPage onAuthenticated={authenticated} />;

  const navItems = user.role === "admin" ? adminNav : doctorNav;
  const allowed = new Set(navItems.map((item) => item.key));
  const activeRoute = allowed.has(location.route) ? location.route : "overview";

  return <>
    <Shell user={user} route={activeRoute} navigate={navigate} navItems={navItems} onLogout={logout} onFeedback={() => setFeedbackOpen(true)}>
      {user.role === "admin"
        ? <AdminPortal route={activeRoute} routeId={location.routeId} navigate={navigate} notify={notify} />
        : <DoctorPortal route={activeRoute} routeId={location.routeId} navigate={navigate} notify={notify} />}
    </Shell>
    {feedbackOpen && <PlatformFeedbackModal page={activeRoute} onClose={() => setFeedbackOpen(false)} onSaved={() => { setFeedbackOpen(false); notify("Platform feedback saved to the Admin inbox."); }} />}
    <Toast message={toast} />
  </>;
}

function PlatformFeedbackModal({ page, onClose, onSaved }) {
  const [topic, setTopic] = useState("Layout & navigation");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try { await api.submitPlatformFeedback({ topic, clarityRating: rating, comment, page }); onSaved(); }
    catch (failure) { setError(failure.message); setBusy(false); }
  };
  return <Modal title="Platform feedback" copy="This product feedback is stored separately from clinical Ground Truth and is visible to the administrator." onClose={onClose}>
    <div className="feedback-form"><label>Feedback area<select value={topic} onChange={(event) => setTopic(event.target.value)}><option>Layout &amp; navigation</option><option>Longitudinal patient data</option><option>AI response presentation</option><option>Rubrics &amp; scoring</option><option>Missing functionality</option></select></label>
      <label>Workflow clarity (1 = unclear, 5 = excellent)<div className="rating-buttons">{[1, 2, 3, 4, 5].map((value) => <button type="button" className={rating === value ? "selected" : ""} key={value} onClick={() => setRating(value)}>{value}</button>)}</div></label>
      <label>Comment<textarea rows="5" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What worked, and what should be changed?" /></label>
      {error && <div className="form-error"><WarningCircle size={17} />{error}</div>}
      <div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !rating || !comment.trim()} onClick={save}>{busy ? "Saving…" : "Send feedback"}<Check size={17} /></button></div>
    </div>
  </Modal>;
}
