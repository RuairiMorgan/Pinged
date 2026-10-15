import React, { useEffect, useState } from 'react';

async function request(path, method = 'GET', body, accountId) {
  const response = await fetch('/api/' + path, { method, headers: { 'X-Pinged-Client': '1', ...(accountId ? { 'X-Pinged-Account': accountId } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 401) window.dispatchEvent(new Event('pinged-session-ended'));
  const result = await response.json();
  if (result.code === 'account_changed') window.dispatchEvent(new Event('pinged-session-ended'));
  if (!response.ok) throw new Error(result.error || 'Could not update learning preferences.');
  return result;
}

export default function LearningPreferences({ accountId }) {
  const [learning, setLearning] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let active = true; request('state', 'GET', undefined, accountId).then(state => { if (active) setLearning(state.learning); }).catch(reason => { if (active) setError(reason.message); }); return () => { active = false; }; }, [accountId]);
  async function update(method, body) {
    setBusy(true); setError('');
    try { setLearning(await request('preferences/learning', method, body, accountId)); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  if (!learning) return <div className="account-card"><h2>Interest learning</h2><p>{error || 'Loading your preference controls…'}</p></div>;
  return <div className="account-card"><span className="account-icon" aria-hidden="true">✳</span><h2>Interest learning</h2>
    <p>Optional learning uses only your Useful and Not useful feedback. It never changes a Ping’s words, sources or delivery, and it never starts a suggested Ping without your approval.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <label><input type="checkbox" checked={learning.enabled} disabled={busy} onChange={event => update('PUT', { enabled: event.target.checked })} /> Learn from my feedback</label>
    <p className="status-label">{learning.enabled ? 'Learning on' : 'Learning off'}</p>
    {learning.profile.length ? <><h3>What Pinged has learned</h3><ul>{learning.profile.map(signal => <li key={`${signal.keyword}-${signal.folder}-${signal.sourceId}`}><strong>{signal.keyword}</strong> · {signal.folder} · {signal.useful} useful / {signal.notUseful} not useful</li>)}</ul></> : <p className="helper-text">No learned interests yet. Turn learning on, then rate inbox discoveries.</p>}
    <button type="button" className="text-button danger" disabled={busy || (!learning.enabled && !learning.profile.length)} onClick={() => update('DELETE')}>Reset learning</button>
  </div>;
}
