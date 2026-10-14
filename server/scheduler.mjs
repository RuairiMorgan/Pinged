import { getFeedSource } from './feedSources.mjs';
import { pollAlert } from './polling.mjs';

const MIN = 15 * 60_000;
const MAX = 24 * 60 * 60_000;
const ID = /^[a-zA-Z0-9_-]{1,80}$/;

// Opt-in, operator-configured, single-process polling prototype. Nothing runs on import.
export function createPollingScheduler({
  alerts, store, poller = pollAlert, intervalMs = MIN, now = Date.now,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval
} = {}) {
  if (!store || typeof store.transaction !== 'function') throw new Error('Polling store required');
  if (!Number.isSafeInteger(intervalMs) || intervalMs < MIN || intervalMs > MAX) throw new Error('Invalid polling interval');
  if (!Array.isArray(alerts) || alerts.length < 1 || alerts.length > 25) throw new Error('Provide 1–25 alerts');
  const ids = new Set();
  const configured = alerts.map(a => {
    if (!a || typeof a.alertId !== 'string' || !ID.test(a.alertId) ||
        ['__proto__', 'constructor', 'prototype'].includes(a.alertId) || ids.has(a.alertId)) {
      throw new Error('Invalid or duplicate alert ID');
    }
    ids.add(a.alertId);
    getFeedSource(a.sourceId);
    if (typeof a.keyword !== 'string' || !a.keyword.trim() || a.keyword.length > 120) throw new Error('Invalid keyword');
    return Object.freeze({ alertId: a.alertId, sourceId: a.sourceId, keyword: a.keyword.trim() });
  });
  const state = new Map(configured.map(a => [a.alertId, { due: 0, failures: 0 }]));
  let pending = null;
  let timer = null;
  function runDue() {
    if (pending) return pending;
    pending = (async () => {
      const at = now();
      if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid scheduler clock');
      const results = [];
      for (const alert of configured) {
        const slot = state.get(alert.alertId);
        if (at < slot.due) continue;
        slot.due = at + intervalMs;
        let status = 'error', persisted = false, newMatches = 0;
        try {
          const result = await poller({ ...alert, store });
          if (!result || !['ok', 'error'].includes(result.status)) throw new Error('Invalid poll result');
          status = result.status;
          persisted = true;
          if (status === 'ok' && Array.isArray(result.matches)) newMatches = result.matches.length;
        } catch { /* Fail closed; unexpected storage errors are not persisted checks. */ }
        slot.failures = status === 'ok' ? 0 : Math.min(slot.failures + 1, 8);
        slot.due = at + Math.min(intervalMs * 2 ** slot.failures, MAX);
        results.push({ alertId: alert.alertId, status, persisted, newMatches,
          nextDueAt: new Date(slot.due).toISOString() });
      }
      return results;
    })().finally(() => { pending = null; });
    return pending;
  }
  function start() {
    if (timer !== null) return false;
    timer = setIntervalFn(() => { void runDue().catch(() => {}); }, intervalMs);
    timer?.unref?.();
    void runDue().catch(() => {});
    return true;
  }
  function stop() {
    if (timer === null) return false;
    clearIntervalFn(timer);
    timer = null;
    return true; // Does not cancel an in-flight poll.
  }
  function snapshot() {
    return configured.map(a => {
      const s = state.get(a.alertId);
      return { alertId: a.alertId, failures: s.failures, nextDueAt: s.due ? new Date(s.due).toISOString() : null };
    });
  }
  return Object.freeze({ runDue, start, stop, snapshot });
}
