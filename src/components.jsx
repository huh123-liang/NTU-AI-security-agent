import {
  ArrowsClockwise, Bell, CaretRight, CheckCircle, Database, FirstAidKit, Info, LockKey,
  SignOut, Sparkle, UserCircle, WarningCircle, X,
} from "@phosphor-icons/react";

export function Brand() {
  return <div className="brand"><strong>NTU</strong><i /><span>AI Safety &amp; Evaluation</span></div>;
}

export function StatusBadge({ children, tone }) {
  const resolved = tone || (/approved|complete|active|shared|ok/i.test(children) ? "success" : /rejected|failed|inactive|critical/i.test(children) ? "danger" : /pending|draft|running/i.test(children) ? "warning" : "neutral");
  return <span className={`status-badge ${resolved}`}>{children}</span>;
}

export function EmptyState({ icon: Icon = Database, title, copy, action }) {
  return <div className="empty-state"><Icon size={34} /><h3>{title}</h3><p>{copy}</p>{action}</div>;
}

export function LoadingState({ label = "Loading clinical workspace…" }) {
  return <div className="loading-state"><ArrowsClockwise className="spin" size={26} /><b>{label}</b><span>Reading the local SQL record.</span></div>;
}

export function ErrorState({ message, retry }) {
  return <div className="loading-state error-state"><WarningCircle size={28} /><b>Something needs attention</b><span>{message}</span>{retry && <button className="secondary-button" onClick={retry}>Try again</button>}</div>;
}

export function Shell({ user, route, navigate, navItems, children, onLogout, onFeedback }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <div className="portal-label"><span>{user.role === "admin" ? "ADMIN PORTAL" : "DOCTOR PORTAL"}</span><small>Local research environment</small></div>
      <nav>{navItems.map(({ key, label, icon: Icon }) => <button key={key} className={route === key ? "active" : ""} onClick={() => navigate(key)}><Icon size={19} /><span>{label}</span><CaretRight className="nav-caret" size={12} /></button>)}</nav>
      <div className="sidebar-footer">
        {user.role === "doctor" && <button className="sidebar-feedback" onClick={onFeedback}><Sparkle size={17} />Platform feedback</button>}
        <div className="account-card"><UserCircle size={34} weight="fill" /><span><b>{user.displayName}</b><small>{user.role === "admin" ? "Platform administrator" : "Clinical evaluator"}</small></span><button aria-label="Sign out" onClick={onLogout}><SignOut size={18} /></button></div>
      </div>
    </aside>
    <section className="app-main">
      <header className="topbar"><div className="environment-chip"><span />RESEARCH PROTOTYPE · LOCAL SQLITE</div><div className="top-actions"><small>{new Date().toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" })}</small><button className="icon-button" aria-label="Notifications"><Bell size={18} /></button></div></header>
      <main className={route === "workspace" ? "page workspace-page" : "page"}>{children}</main>
    </section>
  </div>;
}

export function PageHeader({ eyebrow, title, copy, actions }) {
  return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

export function MetricCard({ icon: Icon = Database, label, value, note, tone = "blue" }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}><Icon size={21} /></span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article>;
}

export function Modal({ title, copy, children, onClose, wide = false, className = "" }) {
  return <div className="modal-backdrop" role="presentation"><section className={`modal ${wide ? "wide" : ""} ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button><div className="modal-heading"><span><FirstAidKit size={22} /></span><div><h2>{title}</h2>{copy && <p>{copy}</p>}</div></div>{children}</section></div>;
}

export function Toast({ message }) {
  return message ? <div className="toast"><CheckCircle size={19} weight="fill" />{message}</div> : null;
}

export function ConfidentialNote({ children }) {
  return <div className="confidential-note"><LockKey size={14} />{children}</div>;
}

export function InfoTip({ children }) {
  return <span className="info-tip" title={children}><Info size={14} /></span>;
}
