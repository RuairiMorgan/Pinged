import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildSearchPlan } from "./searchPlanner.js";
import { createDraft, normalizeAlerts, sourceReadiness, STORAGE_KEY, LEGACY_STORAGE_KEY } from "./alertDrafts.js";
import "./style.css";
import LivePings from "./LivePings.jsx";
import AccountGate from "./AccountGate.jsx";

const EXAMPLES = [
  { label: "Collectibles", prompt: "Find 1996 Japanese Pikachu PSA 10 cards under $500", icon: "✦" },
  { label: "News", prompt: "Keep me updated on climate technology news", icon: "◌" },
  { label: "Opportunities", prompt: "Find new product design jobs in Seoul", icon: "↗" }
];

function loadAlerts(storageKey, allowLegacy) {
  try {
    const current = localStorage.getItem(storageKey);
    const legacy = current === null && allowLegacy ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    return normalizeAlerts(JSON.parse(current ?? legacy ?? "[]"));
  } catch { return []; }
}

function Logo() {
  return <span className="brand" aria-label="Pinged home">
    <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="M11 27V10h9.1c4.4 0 7 2.3 7 6.2s-2.6 6.2-7 6.2H11" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="28" cy="7" r="2" fill="currentColor"/><path d="M23 5a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span>
    <span>Pinged<span className="brand-period">.</span></span>
  </span>;
}

function Arrow({ direction = "right" }) {
  return <span className="arrow" aria-hidden="true">{direction === "right" ? "→" : "↗"}</span>;
}

function App({ session, logout, busy }) {
  const storageKey = session.user ? STORAGE_KEY + ':' + session.user.id : STORAGE_KEY;
  const [tab, setTab] = useState(() => window.location.hash === "#inbox" ? "inbox" : "home");
  useEffect(() => {
    const navigate = () => { if (window.location.hash === "#inbox") setTab("inbox"); };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  const [monitoringDraft, setMonitoringDraft] = useState(null);
  const [alerts, setAlerts] = useState(() => loadAlerts(storageKey, !session.user));
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(alerts)); }
    catch { setNotice("Browser storage is unavailable. Drafts may not survive a refresh."); }
  }, [alerts, storageKey]);

  function reviewAlert(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const plan = buildSearchPlan(query);
      setPreview(plan);
      setSelectedIds(editingId ? alerts.find(item => item.id === editingId)?.sources.filter(source => plan.recommendedSources.some(candidate => candidate.id === source.id)).map(source => source.id) || [] : plan.recommendedSources.map(source => source.id));
    } catch (reason) { setError(reason.message || "Please describe your alert."); }
  }

  function toggleSource(id) {
    setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
    setError("");
  }

  function saveDraft() {
    setError("");
    try {
      const previous = alerts.find(item => item.id === editingId) || null;
      const draft = createDraft(preview, selectedIds, previous);
      setAlerts(current => previous ? current.map(item => item.id === previous.id ? draft : item) : [draft, ...current]);
      setQuery("");
      setPreview(null);
      setSelectedIds([]);
      setEditingId(null);
      setNotice("Idea saved on this device. Choose Set up monitoring when you’re ready.");
    } catch (reason) { setError(reason.message || "Could not save the draft."); }
  }

  function editDraft(alert) {
    try {
      const plan = buildSearchPlan(alert.request);
      setQuery(alert.request);
      setPreview(plan);
      setSelectedIds(alert.sources.filter(source => plan.recommendedSources.some(candidate => candidate.id === source.id)).map(source => source.id));
      setEditingId(alert.id);
      setTab("home");
      setNotice("Review the suggested sources, then save your changes.");
      setError("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch { setError("This draft cannot be edited. Create a new alert instead."); }
  }

  function removeDraft(id) {
    setAlerts(current => current.filter(alert => alert.id !== id));
    setNotice("Draft removed from this browser.");
  }

  function exportDrafts() {
    const data = new Blob([JSON.stringify(alerts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pinged-drafts.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Your drafts were exported as a JSON file.");
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="logo-button" onClick={() => setTab("home")}><Logo /></button>
        <nav className="desktop-nav" aria-label="Main navigation">
          {[["home", "Home"], ["inbox", "Inbox"], ["account", "Account"]].map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
        <span className="prototype-pill"><span className="tiny-dot" /> Early preview</span>
      </div>
    </header>

    <main id="main-content" className="main-content">
      {notice && <p className="notice" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></p>}
      {tab === "inbox" && <LivePings accountId={session.user?.id} tab={tab} />}
      {tab === "home" && <>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-kicker"><span className="kicker-line" /> THE THINGS THAT MATTER, ALL IN ONE PLACE</div>
          <h1 id="hero-title">What would you like to <em>stay updated on?</em></h1>
          <p className="hero-subtitle">Tell us what you’re interested in. We’ll keep you updated.</p>
          <form className="prompt-box" onSubmit={reviewAlert}>
            <label htmlFor="alert-request" className="sr-only">Describe what you want Pinged to monitor</label>
            <textarea id="alert-request" value={query} onChange={event => { setQuery(event.target.value); if (preview) setPreview(null); }} placeholder="e.g. Find vintage Pokémon cards under $500, or news about electric cars…" rows="3" maxLength="1000" required />
            <div className="prompt-actions"><span><span className="sparkle" aria-hidden="true">✳</span> Describe it naturally</span><button className="primary-button" type="submit">Review alert <Arrow /></button></div>
          </form>
          <p className="helper-text">No complicated filters. Just tell us what you're looking for.</p>
        </section>

        {preview && <section className="review-panel" aria-labelledby="review-heading">
          <div className="section-heading"><div><span className="eyebrow">STEP 2 OF 2</span><h2 id="review-heading">Review your alert</h2><p>Check the details and choose which sources you want us to support.</p></div><button type="button" className="text-button" onClick={() => { setPreview(null); setEditingId(null); }}>Cancel</button></div>
          <div className="request-summary"><span className="summary-icon" aria-hidden="true">✳</span><div><span className="summary-label">YOUR REQUEST</span><strong>{preview.request}</strong></div></div>
          <div className="criteria-row"><span className="chip">{preview.category === "collectibles" ? "Collectibles" : preview.category === "news" ? "News" : "General"}</span>{preview.criteria.year && <span className="chip">{preview.criteria.year}</span>}{preview.criteria.gradeCompany && <span className="chip">{preview.criteria.gradeCompany} {preview.criteria.grade}</span>}{preview.criteria.maxPrice !== null && <span className="chip">Under {preview.criteria.currency === "USD" ? "$" : preview.criteria.currency === "GBP" ? "£" : preview.criteria.currency === "KRW" ? "₩" : ""}{preview.criteria.maxPrice.toLocaleString()}</span>}</div>
          <h3 className="sources-title">Suggested sources <span>Choose one or more</span></h3>
          <div className="source-grid">{preview.recommendedSources.map(source => <label key={source.id} className={`source-card ${selectedIds.includes(source.id) ? "is-selected" : ""}`}><input type="checkbox" checked={selectedIds.includes(source.id)} onChange={() => toggleSource(source.id)} /><span className="source-name">{source.name}</span><span className="source-readiness">{sourceReadiness(source)}</span></label>)}</div>
          <div className="review-footer"><p><strong>Heads up:</strong> These are suggested sources, not live connections. Saving creates a draft; it does not start monitoring or send notifications.</p><button type="button" className="primary-button" onClick={saveDraft}>{editingId ? "Save changes" : "Save draft"} <Arrow /></button></div>
          {error && <p className="error" role="alert">{error}</p>}
        </section>}
        {!preview && error && <p className="error standalone-error" role="alert">{error}</p>}

        <LivePings accountId={session.user?.id} tab={tab} draft={monitoringDraft} />

        <section className="explore-section" aria-labelledby="explore-heading"><div className="section-heading"><div><span className="eyebrow">A LITTLE INSPIRATION</span><h2 id="explore-heading">Discover what Pinged can do</h2></div><span className="muted-label">Try an example <Arrow /></span></div><div className="example-grid">{EXAMPLES.map(example => <button key={example.label} type="button" className="example-card" onClick={() => { setQuery(example.prompt); setPreview(null); setEditingId(null); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}><span className="example-icon" aria-hidden="true">{example.icon}</span><span className="example-category">{example.label}</span><strong>{example.prompt}</strong><span className="example-cta">Use this idea <Arrow /></span></button>)}</div></section>

        <section className="alerts-section" aria-labelledby="alerts-heading"><div className="section-heading"><div><span className="eyebrow">YOUR SPACE</span><h2 id="alerts-heading">Saved ideas <span className="count-badge">{alerts.length}</span></h2></div><span className="muted-label">Saved on this device</span></div>
          {alerts.length === 0 ? <div className="empty-card"><span className="empty-icon" aria-hidden="true">◎</span><h3>A little quiet here. For now.</h3><p>Describe something above to save your first alert draft.</p></div> : <div className="alert-list">{alerts.map(alert => <article className="alert-card" key={alert.id}><div className="alert-card-top"><span className="draft-badge"><span className="tiny-dot" /> Draft · not monitoring</span><span className="alert-category">{alert.category || "General"}</span></div><h3>{alert.request}</h3><p className="alert-sources">{alert.sources.length ? alert.sources.map(source => source.name).join(" · ") : "No sources selected"}</p><div className="alert-card-bottom"><details><summary>Details</summary><p>Monitoring is not connected. No checks have run for this draft.</p><p>Suggested sources: {alert.sources.length ? alert.sources.map(source => `${source.name} (${sourceReadiness(source)})`).join("; ") : "none"}.</p></details><div className="card-actions"><button type="button" className="text-button" onClick={() => { setMonitoringDraft(alert); document.getElementById("monitor-setup")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Set up monitoring</button><button type="button" className="text-button" onClick={() => editDraft(alert)}>Edit</button><button type="button" className="text-button danger" onClick={() => removeDraft(alert.id)} aria-label={`Remove alert ${alert.request}`}>Remove</button></div></div></article>)}</div>}
        </section>
      </>}



      {tab === "account" && <section className="tab-page"><span className="eyebrow">YOUR PINGED</span><h1>Account<span className="brand-period">.</span></h1><p className="tab-intro">A simple, transparent place for your preferences.</p><div className="account-grid"><div className="account-card"><span className="account-icon" aria-hidden="true">⌂</span><h2>{session.user ? session.user.username : 'Local preview'}</h2><p>{session.user ? 'Your active Pings and inbox are stored separately for this account. Saved ideas stay in this browser, separated by account.' : 'Your saved ideas stay in this browser. This preview uses a single local workspace.'}</p><span className="status-label">{session.user ? 'Signed in · local account' : 'Local workspace'}</span>{session.user && <button className="secondary-button" disabled={busy} onClick={logout}>Sign out</button>}</div><div className="account-card"><span className="account-icon" aria-hidden="true">↓</span><h2>Your data, your control</h2><p>Download a copy of your saved ideas from this browser. Active Pings and inbox discoveries are not included in this export.</p><button className="secondary-button" type="button" onClick={exportDrafts} disabled={!alerts.length}>Export my drafts <Arrow /></button></div></div></section>}
    </main>

    <footer className="site-footer"><div><Logo /><p>Stay close to what matters.</p></div><span>Local preview · RSS inbox · Optional configured push</span></footer>
    <nav className="mobile-nav" aria-label="Mobile navigation">{[["home", "⌂", "Home"], ["inbox", "✉", "Inbox"], ["account", "◎", "Account"]].map(([id, icon, label]) => <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => { setTab(id); window.scrollTo({ top: 0, behavior: "smooth" }); }}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>
  </div>;
}

createRoot(document.getElementById("root")).render(<AccountGate>{props => <App key={props.session.user?.id || "local"} {...props} />}</AccountGate>);
