import { useState } from "react";
import { ArrowRight, CheckCircle, Database, LockKey, ShieldCheck, Stethoscope, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { api, sessionStore } from "./api.js";
import { Brand } from "./components.jsx";

export function AuthPage({ onAuthenticated }) {
  const [portal, setPortal] = useState("doctor");
  const [mode, setMode] = useState("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const choosePortal = (next) => {
    setPortal(next);
    setMode("login");
    setError("");
    if (next === "admin") { setEmail("admin@ntu-demo.local"); setPassword("123"); }
    else { setEmail(""); setPassword(""); }
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = mode === "register"
        ? await api.register({ displayName, email, password })
        : await api.login({ email, password, portalRole: portal });
      sessionStore.set(result.token);
      onAuthenticated(result.user);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };

  return <div className="auth-page">
    <section className="auth-brand-panel">
      <Brand />
      <div className="auth-copy"><span className="eyebrow light">CLINICIAN-GROUNDED EVALUATION</span><h1>Evaluate medical agents with evidence, independence and traceability.</h1><p>A local research platform for reviewing longitudinal chronic-care cases, comparing model runs and preserving every clinical judgement.</p>
        <div className="auth-principles"><div><ShieldCheck size={22} /><span><b>Independent review</b><small>Doctor scores remain private from peers.</small></span></div><div><Database size={22} /><span><b>Evidence linked</b><small>Trace every case back to source JSON.</small></span></div><div><UsersThree size={22} /><span><b>Admin governed</b><small>Aggregate only after expert review.</small></span></div></div>
      </div>
      <small className="research-disclaimer">Research prototype · Synthetic patient data · Not for clinical care</small>
    </section>
    <section className="auth-form-panel">
      <form className="auth-form" onSubmit={submit}>
        <div className="portal-switch"><button type="button" className={portal === "doctor" ? "active" : ""} onClick={() => choosePortal("doctor")}><Stethoscope size={18} />Doctor</button><button type="button" className={portal === "admin" ? "active" : ""} onClick={() => choosePortal("admin")}><ShieldCheck size={18} />Admin</button></div>
        <span className="auth-seal">{portal === "doctor" ? <Stethoscope size={27} /> : <ShieldCheck size={27} />}</span>
        <h2>{mode === "register" ? "Create doctor account" : `Sign in to ${portal === "admin" ? "Admin" : "Doctor"} Portal`}</h2>
        <p>{mode === "register" ? "Register locally and begin evaluating available synthetic datasets." : "Use your local research account to continue."}</p>
        {mode === "register" && <label>Display name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Dr. Reviewer" /></label>}
        <label>Email address<input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
        <label>Password<input autoComplete={mode === "register" ? "new-password" : "current-password"} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter password" /></label>
        {portal === "admin" && <div className="demo-credential"><LockKey size={16} /><span><b>Local demo administrator</b><small>admin@ntu-demo.local · Password 123</small></span></div>}
        {error && <div className="form-error"><WarningCircle size={17} />{error}</div>}
        <button className="primary-button large" disabled={busy || !email || !password || (mode === "register" && !displayName)}>{busy ? "Please wait…" : mode === "register" ? "Create account" : "Secure sign in"}<ArrowRight size={17} /></button>
        {portal === "doctor" && <button className="auth-mode-link" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "New evaluator? Create a doctor account" : "Already registered? Sign in"}</button>}
        <div className="auth-assurance"><CheckCircle size={15} />Credentials and assessments stay in the local SQLite database.</div>
      </form>
    </section>
  </div>;
}
