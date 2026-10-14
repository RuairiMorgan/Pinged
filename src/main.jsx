import { useEffect, useState } from "react";
import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const KEY = "pinged.alerts.v1";
function App() {
  const [alerts, setAlerts] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
  });
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(alerts)); }, [alerts]);
  function add(e) {
    e.preventDefault();
    try {
      const site = new URL(url.startsWith("http") ? url : "https://" + url);
      if (!["http:", "https:"].includes(site.protocol)) throw Error();
      if (!keyword.trim()) return;
      setAlerts(current => [{ id: crypto.randomUUID(), url: site.href, keyword: keyword.trim(), enabled: true }, ...current]);
      setUrl(""); setKeyword("");
    } catch { window.alert("Enter a valid website URL."); }
  }
  return <main>
    <header><strong>◉ Pinged</strong><span>Never miss what matters.</span></header>
    <section className="hero"><p className="eyebrow">YOUR PERSONAL WATCHLIST</p><h1>Stay in the know.</h1><p>Choose a website and a keyword. Pinged will help you organize what matters.</p></section>
    <section className="panel"><h2>Create an alert</h2><form onSubmit={add}>
      <label>Website URL<input required type="text" value={url} onChange={e=>setUrl(e.target.value)} placeholder="example.com/news" /></label>
      <label>Keyword or phrase<input required value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="e.g. Pokémon" /></label>
      <button type="submit">+ Add alert</button>
    </form></section>
    <section className="panel"><div className="heading"><h2>My watchlist</h2><small>{alerts.length} alerts</small></div>
      {alerts.length===0 ? <p className="empty">No alerts yet. Add your first website and keyword above.</p> :
      <ul>{alerts.map(a=><li key={a.id}><div><b>{a.keyword}</b><a href={a.url} target="_blank" rel="noopener noreferrer">{a.url}</a></div><div className="actions"><button className="secondary" onClick={()=>setAlerts(xs=>xs.map(x=>x.id===a.id?{...x,enabled:!x.enabled}:x))}>{a.enabled?"Enabled":"Paused"}</button><button className="secondary" aria-label={"Remove "+a.keyword} onClick={()=>setAlerts(xs=>xs.filter(x=>x.id!==a.id))}>×</button></div></li>)}</ul>}
    </section><p className="note">Prototype: alerts are stored in this browser only. Automated monitoring, accounts, and notifications are not connected yet.</p>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
