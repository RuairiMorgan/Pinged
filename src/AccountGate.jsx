import React, { useEffect, useState, useRef } from 'react';
import { disconnectBrowserPush } from './browserPush.js';

async function authRequest(path, input, accountId) {
  const response = await fetch('/api/' + path, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Pinged-Client': '1', ...(accountId ? { 'X-Pinged-Account': accountId } : {}), ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: input === undefined ? undefined : JSON.stringify(input) });
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Start the Pinged service, then try again.');
  const result = await response.json();
  if (result.code === 'account_changed') window.dispatchEvent(new Event('pinged-session-ended'));
  if (!response.ok) throw new Error(result.error || 'Could not sign in.');
  return result;
}

export default function AccountGate({ children }) {
  const revision = useRef(0);
  const broadcast = () => { try { localStorage.setItem('pinged-session-change', Date.now() + ':' + Math.random()); } catch { /* Focus and API checks still revalidate the session. */ } };
  const [session, setSession] = useState(null), [error, setError] = useState('');
  const [register, setRegister] = useState(false), [busy, setBusy] = useState(false);
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  async function refresh() {
    const current = ++revision.current;
    try { const result = await authRequest('session'); if (current === revision.current) { setSession(result); setError(''); } }
    catch (reason) { if (current === revision.current) setError(reason.message); }
  }
  useEffect(() => {
    void refresh();
    const expired = () => { revision.current++; setSession({ mode: 'accounts', user: null }); setPassword(''); setError('Your session ended. Sign in again to continue.'); };
    const changed = event => { if (event.key === 'pinged-session-change') { setSession(null); setPassword(''); void refresh(); } };
    const focused = () => { void refresh(); };
    window.addEventListener('pinged-session-ended', expired);
    window.addEventListener('storage', changed);
    window.addEventListener('focus', focused);
    return () => { revision.current++; window.removeEventListener('pinged-session-ended', expired); window.removeEventListener('storage', changed); window.removeEventListener('focus', focused); };
  }, []);
  async function logout() {
    setBusy(true);
    try { revision.current++; await authRequest('logout', {}, session.user?.id); try { await disconnectBrowserPush(); } catch { /* Server already revoked this session's subscriptions. */ } setSession({ mode: 'accounts', user: null }); setPassword(''); broadcast(); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  if (session && (session.mode === 'local' || session.user)) return <>{error && <p className="error" role="alert">{error}</p>}{children({ session, logout, busy })}</>;
  return <main className="account-entry"><span className="eyebrow">PINGED</span><h1>{!session ? 'Welcome to Pinged.' : register ? 'Your own space.' : 'Welcome back.'}</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {!session ? <><p>Connecting to your Pinged service…</p><button className="secondary-button" onClick={refresh}>Try again</button></> : <>
      <p>{register ? 'Create a local account to keep your Pings and discoveries separate.' : 'Sign in to see your Pings and discoveries.'}</p>
      <form className="monitor-form" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError('');
        try { const result = await authRequest(register ? 'register' : 'login', { username, password }); revision.current++; setPassword(''); setSession({ mode: 'accounts', user: result.user }); broadcast(); }
        catch (reason) { setError(reason.message); }
        finally { setBusy(false); }
      }}>
        <label>Username<input required autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={40} pattern="[a-zA-Z0-9_-]+" value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label>Password<input required type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {register && <p className="helper-text">Use 12 or more characters. Password recovery is not available in this local preview.</p>}
        <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
      </form>
      <button className="text-button" disabled={busy} onClick={() => { setRegister(!register); setError(''); setPassword(''); }}>{register ? 'Already have an account? Sign in' : 'Create an account'}</button>
    </>}
  </main>;
}
