import React, { useEffect, useState } from 'react';
import { enableBrowserPush, disconnectBrowserPush, supportsPush } from './browserPush.js';

async function api(path, method = 'GET', body, accountId) {
  const response = await fetch('/api/' + path, { method, headers: { 'X-Pinged-Client': '1', ...(accountId ? { 'X-Pinged-Account': accountId } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Start the local monitoring service to connect this dashboard.');
  if (response.status === 401) window.dispatchEvent(new Event('pinged-session-ended'));
  const result = await response.json();
  if (result.code === 'account_changed') window.dispatchEvent(new Event('pinged-session-ended'));
  if (!response.ok) throw new Error(result.error || 'Could not complete this action.');
  return result;
}
export default function LivePings({ tab, draft, accountId }) {
  const client = (path, method, body) => api(path, method, body, accountId);
  const [state, setState] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [request, setRequest] = useState(''), [keyword, setKeyword] = useState(''), [folder, setFolder] = useState('Discoveries'), [source, setSource] = useState('bbc-news'), [editingId, setEditingId] = useState(null), [delivery, setDelivery] = useState('silent');
  const [filter, setFilter] = useState('All'), [savedOnly, setSavedOnly] = useState(false);
  useEffect(() => {
    if (draft) { setRequest(draft.request); setKeyword(""); setFolder(draft.category || "Discoveries"); setEditingId(null); }
  }, [draft]);
  useEffect(() => {
    let mounted = true;
    const refresh = () => client('state').then(result => { if (mounted) { setState(result); setError(''); } }).catch(reason => { if (mounted) setError(reason.message); });
    void refresh(); const timer = setInterval(refresh, 10_000);
    return () => { mounted = false; clearInterval(timer); };
  }, [accountId]);
  async function act(path, method, body) {
    setBusy(true); setError('');
    try { await client(path, method, body); setState(await client('state')); return true; }
    catch (reason) { setError(reason.message); return false; }
    finally { setBusy(false); }
  }
  const pings = state?.pings || [], active = pings.filter(p => p.enabled).length;
  const items = pings.flatMap(p => p.inbox.map(item => ({ ...item, pingId: p.id, folder: p.folder, keyword: p.keyword }))).sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
  if (tab === 'account') return null;
  return <section className="alerts-section live-pings" aria-label={tab === 'inbox' ? 'Discoveries' : 'Active Pings'}>
    <div className="section-heading"><div><span className="eyebrow">{tab === 'inbox' ? 'YOUR DISCOVERIES' : 'KEEP AN EYE ON IT'}</span><h2>{tab === 'inbox' ? 'Your inbox' : 'Active Pings'}</h2></div><span className="muted-label">{state ? `${active} of 3 free active Pings` : 'Monitoring service offline'}</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    {state && tab === 'home' && <>
      {state.notifications.queueOverflow > 0 && <p className="error" role="alert">Some push alerts could not be queued because the local queue was full. Your discoveries remain in your inbox.</p>}
      <p>Start with one of your three most useful Pings. Saved ideas below don’t use an active slot.</p>
      {state.notifications.push && <div className="notice push-controls"><div><strong>Browser notifications</strong><p>Push is optional. Silent Pings stay in your inbox. {state.notifications.devices} connected device{state.notifications.devices === 1 ? '' : 's'}.</p><p className="helper-text">Notifications show a private, generic message. Accepted by the push provider does not confirm display on your device.</p></div><div className="card-actions"><button type="button" className="secondary-button" disabled={busy || !supportsPush()} onClick={async () => {
        setBusy(true); setError('');
        try { const subscription = await enableBrowserPush(state.notifications.publicKey); await client('push/subscription', 'POST', subscription); setState(await client('state')); }
        catch (reason) { setError(reason.message); }
        finally { setBusy(false); }
      }}>Enable on this browser</button><button type="button" className="text-button" disabled={busy} onClick={async () => {
        if (await act('push/subscription', 'DELETE')) { setDelivery('silent'); try { await disconnectBrowserPush(); } catch { setError('Server notifications were disconnected. Check this browser’s notification settings too.'); } }
      }}>Disconnect this browser</button></div></div>}
      {draft && <p className="notice">Set up “{draft.request}”. Confirm the exact phrase and a supported source below. Other suggested sources and price/grade filters are not supported by this RSS checker.</p>}
      <form id="monitor-setup" className="monitor-form" onSubmit={async e => { e.preventDefault(); if (await act(editingId ? 'pings/' + editingId : 'pings', editingId ? 'PUT' : 'POST', { request: request || keyword, keyword, sourceIds: [source], folder, delivery })) { setRequest(''); setKeyword(''); setEditingId(null); } }}>
        <label>What should Pinged watch?<input value={request} maxLength={1000} required onChange={e => setRequest(e.target.value)} placeholder="e.g. Climate technology headlines" /></label>
        <label>Exact keyword or phrase<input value={keyword} maxLength={120} required onChange={e => setKeyword(e.target.value)} placeholder="e.g. climate" /></label>
        <label>Source<select value={source} onChange={e => setSource(e.target.value)}>{state.sources.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        <label>Folder<input value={folder} maxLength={60} onChange={e => setFolder(e.target.value)} /></label>
        <label>Delivery<select value={delivery} onChange={event => setDelivery(event.target.value)}><option value="silent">Silent Ping · inbox only</option><option value="push" disabled={!state.notifications.push || !state.notifications.devices}>{state.notifications.push ? "Push · browser notification" : "Push · not configured yet"}</option></select></label>
        <button className="primary-button" disabled={busy || (!editingId && active >= 3)}>{editingId ? 'Save changes' : 'Start Ping'}</button>
        {editingId && <button type="button" className="text-button" disabled={busy} onClick={() => { setEditingId(null); setRequest(''); setKeyword(''); setFolder('Discoveries'); }}>Cancel editing</button>}
      </form>
      {active >= 3 && <p className="helper-text">Your three free Pings are active. Pause one to try another; keep as many saved ideas as you like.</p>}
      <p className="helper-text">The local service checks while it is running, at most every 15 minutes. Only the listed RSS source is supported here; its status comes from actual checks.</p>
      <div className="alert-list">{pings.map(p => <article className="alert-card" key={p.id}><div className="alert-card-top"><span className="draft-badge">{p.enabled ? 'Active' : 'Paused'} · {p.delivery === 'push' ? 'Push + inbox' : 'Silent Ping'}</span><span>{p.folder}</span></div><h3>{p.request}</h3><p>Exact match: “{p.keyword}”</p>{p.sourceIds.map(id => <p key={id}>{state.sources.find(s => s.id === id)?.name} · {p.checks[id] ? `${p.checks[id].status === 'ok' ? 'Checked' : 'Check failed · will retry'} ${new Date(p.checks[id].checkedAt).toLocaleString()}` : 'Awaiting first check'}</p>)}{p.delivery === 'push' && <p className="helper-text">{!state.notifications.devices ? 'No push devices connected; discoveries still reach your inbox.' : (() => { const latest = state.notifications.delivery.filter(event => event.pingId === p.id).at(-1); return latest ? ({ accepted: 'Latest push accepted by provider · device display unconfirmed', pending: 'Latest push queued · will retry if needed', sending: 'Latest push sending', failed: 'Latest push failed · discovery kept in inbox', cancelled: 'Latest push cancelled' }[latest.status]) : 'Push ready for new discoveries'; })()}</p>}<div className="card-actions"><button disabled={busy} className="text-button" onClick={() => { setEditingId(p.id); setRequest(p.request); setKeyword(p.keyword); setFolder(p.folder); setSource(p.sourceIds[0]); setDelivery(p.delivery); document.getElementById('monitor-setup')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Edit</button><button disabled={busy || (!p.enabled && active >= 3)} className="text-button" onClick={() => act('pings/' + p.id, 'PATCH', { enabled: !p.enabled })}>{p.enabled ? 'Pause' : 'Resume'}</button><button disabled={busy} className="text-button danger" onClick={() => act('pings/' + p.id, 'DELETE')}>Remove</button></div></article>)}</div>
    </>}
    {state && tab === 'inbox' && <>
      <div className="inbox-controls"><label>Folder<select value={filter} onChange={e => setFilter(e.target.value)}>{['All', ...new Set(pings.map(p => p.folder))].map(f => <option key={f}>{f}</option>)}</select></label><label><input type="checkbox" checked={savedOnly} onChange={e => setSavedOnly(e.target.checked)} /> Saved only</label></div>
      {!items.filter(item => (filter === 'All' || item.folder === filter) && (!savedOnly || item.saved)).length && <div className="empty-card"><h3>No discoveries here yet</h3><p>Matches appear here after a successful source check. Check failures remain visible on Home.</p></div>}
      <div className="alert-list">{items.filter(item => (filter === 'All' || item.folder === filter) && (!savedOnly || item.saved)).map(item => <article className="alert-card" key={item.pingId + item.id}><span className="eyebrow">{item.folder} · {item.sourceId}</span><h3><a href={item.link} target="_blank" rel="noopener noreferrer">{item.title}</a></h3><p>{item.summary}</p><p className="helper-text">Matched “{item.keyword}” · discovered {new Date(item.discoveredAt).toLocaleString()}</p><div className="card-actions">{[['saved', item.saved ? 'Unsave' : 'Save'], ['useful', 'Useful'], ['not-useful', 'Not useful']].map(([value, label]) => <button key={value} className="text-button" disabled={busy} aria-pressed={value === 'saved' ? item.saved : item.feedback === value} onClick={() => act(`pings/${item.pingId}/feedback`, 'POST', { itemId: item.id, value: item.feedback === value ? 'none' : value })}>{label}</button>)}</div></article>)}</div>
    </>}
  </section>;
}
