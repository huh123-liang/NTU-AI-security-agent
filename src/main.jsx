import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, details) {
    console.error("The evaluation interface could not render.", error, details);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="app-error-boundary" translate="no">
      <span>INTERFACE RECOVERY</span>
      <h1>The evaluation workspace needs to reload</h1>
      <p>The model response and saved clinical data remain in the local SQLite database. Browser translation or an extension may have changed the page while the interface was updating.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload workspace</button>
      <small>If this repeats, turn off automatic translation for 127.0.0.1.</small>
    </main>;
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
