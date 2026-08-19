import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle, Database, LockKey, ShieldCheck, Stethoscope, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { api, sessionStore } from "./api.js";
import { Brand } from "./components.jsx";

function ClinicalParticleField() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let width = 0;
    let height = 0;
    let particles = [];
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * ratio; canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles = Array.from({ length: Math.max(24, Math.round(width / 24)) }, (_, index) => ({
        x: (index * 83) % width, y: (index * 137) % height,
        vx: reducedMotion ? 0 : ((index % 5) - 2) * 0.035,
        vy: reducedMotion ? 0 : (((index * 3) % 5) - 2) * 0.025,
        radius: index % 7 === 0 ? 1.8 : 1.1,
      }));
    };
    const draw = () => {
      context.clearRect(0, 0, width, height);
      particles.forEach((particle, index) => {
        particle.x = (particle.x + particle.vx + width) % width;
        particle.y = (particle.y + particle.vy + height) % height;
        for (let next = index + 1; next < particles.length; next += 1) {
          const other = particles[next];
          const distance = Math.hypot(particle.x - other.x, particle.y - other.y);
          if (distance < 105) {
            context.strokeStyle = `rgba(111, 177, 226, ${0.13 * (1 - distance / 105)})`;
            context.lineWidth = 0.7; context.beginPath(); context.moveTo(particle.x, particle.y); context.lineTo(other.x, other.y); context.stroke();
          }
        }
        context.fillStyle = index % 9 === 0 ? "rgba(219,30,62,.62)" : "rgba(154,207,243,.58)";
        context.beginPath(); context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2); context.fill();
      });
      if (!reducedMotion) frame = window.requestAnimationFrame(draw);
    };
    resize(); draw();
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    return () => { observer.disconnect(); if (frame) window.cancelAnimationFrame(frame); };
  }, []);
  return <canvas className="clinical-particle-field" ref={canvasRef} aria-hidden="true" />;
}

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
      <ClinicalParticleField />
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
