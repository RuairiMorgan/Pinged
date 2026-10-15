import { randomUUID } from 'node:crypto';
import { FEED_SOURCES, getFeedSource } from './feedSources.mjs';
import { checkFeed } from './monitor.mjs';

const INTERVAL = 15 * 60_000;
const MAX_INTERVAL = 24 * 60 * 60_000;
const bad = message => { throw Object.assign(new Error(message), { status: 400 }); };
const find = (state, id) => {
  const ping = state.pings?.find(p => p.id === id);
  if (!ping) throw Object.assign(new Error('Ping not found'), { status: 404 });
  return ping;
};

// Single-owner local service. Production accounts and multi-process storage are separate release gates.
export function createPingService({ store, checker = checkFeed, now = Date.now } = {}) {
  if (!store?.transaction || !store?.read) throw new Error('Store required');
  let running = null;
  function normalizeInput(input) {
    if (!input || typeof input.request !== 'string' || !input.request.trim() || input.request.length > 1000) bad('Describe your Ping (up to 1,000 characters).');
    if (typeof input.keyword !== 'string' || !input.keyword.trim() || input.keyword.length > 120) bad('Choose an exact keyword or phrase (up to 120 characters).');
    if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || input.sourceIds.length > 3 || new Set(input.sourceIds).size !== input.sourceIds.length) bad('Choose between one and three different supported sources.');
    input.sourceIds.forEach(id => { try { getFeedSource(id); } catch { bad('This source is not connected yet.'); } });
    if (input.delivery !== undefined && input.delivery !== 'silent') bad('Push and email are not connected yet. Silent inbox delivery is available.');
    if (input.folder !== undefined && (typeof input.folder !== 'string' || input.folder.length > 60)) bad('Folder must be at most 60 characters.');
    return { request: input.request.trim(), keyword: input.keyword.trim(), sourceIds: [...input.sourceIds], folder: input.folder?.trim() || 'Discoveries', delivery: 'silent' };
  }
  async function snapshot() {
    const state = await store.read();
    return { pings: state.pings || [], sources: Object.values(FEED_SOURCES).map(({ id, name, status }) => ({ id, name, status })),
      limits: { active: 3, sourcesPerPing: 3 }, service: 'local-single-owner', notifications: { push: false, email: false } };
  }
  async function create(input) {
    const normalized = normalizeInput(input);
    return store.transaction(state => {
      state.pings ||= [];
      if (state.pings.filter(p => p.enabled).length >= 3) bad('Your three free Pings are active. Pause one first; your saved ideas can stay.');
      if (state.pings.length >= 100) bad('Local monitor storage is full. Remove an old monitor first.');
      const ping = { id: randomUUID(), ...normalized, enabled: true, createdAt: new Date(now()).toISOString(),
        checks: {}, nextDueAt: now(), failures: 0, inbox: [], seen: [] };
      state.pings.unshift(ping);
      return ping;
    });
  }
  async function update(id, input) {
    const normalized = normalizeInput(input);
    return store.transaction(state => {
      const ping = find(state, id);
      const monitoringChanged = ping.keyword !== normalized.keyword || ping.sourceIds.length !== normalized.sourceIds.length || ping.sourceIds.some((sourceId, index) => sourceId !== normalized.sourceIds[index]);
      Object.assign(ping, normalized, { updatedAt: new Date(now()).toISOString() });
      if (monitoringChanged) {
        ping.activationRevision = (ping.activationRevision || 0) + 1;
        ping.checks = {};
        ping.failures = 0;
        ping.nextDueAt = ping.enabled ? now() : ping.nextDueAt;
      }
      return ping;
    });
  }
  async function setEnabled(id, enabled) {
    if (typeof enabled !== 'boolean') bad('Enabled must be true or false.');
    return store.transaction(state => {
      const ping = find(state, id);
      if (enabled && !ping.enabled && state.pings.filter(p => p.enabled).length >= 3) bad('Pause another Ping before resuming this one.');
      if (ping.enabled !== enabled) {
        ping.enabled = enabled;
        ping.activationRevision = (ping.activationRevision || 0) + 1;
      }
      return ping;
    });
  }
  async function remove(id) {
    return store.transaction(state => { find(state, id); state.pings = state.pings.filter(p => p.id !== id); });
  }
  async function feedback(id, itemId, value) {
    if (!['useful', 'not-useful', 'saved', 'none'].includes(value)) bad('Invalid feedback.');
    return store.transaction(state => {
      const item = find(state, id).inbox.find(item => item.id === itemId);
      if (!item) throw Object.assign(new Error('Discovery not found'), { status: 404 });
      // Explicit preference only; never rewrite the Ping's keyword or sources.
      if (value === 'saved') item.saved = !item.saved;
      else item.feedback = value === 'none' ? null : value;
    });
  }
  function runDue() {
    if (running) return running;
    running = (async () => {
      const { pings } = await snapshot();
      const results = [];
      for (const candidate of pings.filter(p => p.enabled && p.nextDueAt <= now())) {
        // Reserve durable next run before network access. Restart cannot immediately refetch.
        const reserved = await store.transaction(state => {
          const ping = state.pings.find(p => p.id === candidate.id);
          if (!ping?.enabled || ping.nextDueAt > now()) return null;
          ping.nextDueAt = now() + INTERVAL;
          return structuredClone(ping);
        });
        if (!reserved) continue;
        for (const sourceId of reserved.sourceIds) {
          // Recheck pause/delete between sources, and discard results if paused in flight.
          if (!(await snapshot()).pings.some(p => p.id === reserved.id && p.enabled)) break;
          let result;
          try {
            result = await checker(sourceId, reserved.keyword, { seen: new Set(reserved.seen) });
            if (result?.status !== 'ok' || !Array.isArray(result.matches)) throw new Error('Invalid check response');
          } catch { result = { status: 'error', matches: [] }; }
          await store.transaction(state => {
            const ping = state.pings.find(p => p.id === reserved.id);
            if (!ping?.enabled || (ping.activationRevision || 0) !== (reserved.activationRevision || 0)) return;
            const checkedAt = new Date(now()).toISOString();
            ping.checks[sourceId] = { status: result.status, checkedAt, newMatches: 0 };
            if (result.status === 'ok') {
              const seen = new Set(ping.seen);
              for (const item of result.matches.slice(0, 250)) {
                if (!item || typeof item.id !== 'string' || item.id.length > 128 || seen.has(item.id)) continue;
                let link;
                try { link = new URL(item.link); } catch { continue; }
                if (!['https:', 'http:'].includes(link.protocol) || link.username || link.password || typeof item.title !== 'string') continue;
                seen.add(item.id);
                ping.inbox.unshift({ id: item.id, title: item.title.slice(0, 1000), link: link.href, summary: typeof item.summary === 'string' ? item.summary.slice(0, 4000) : '',
                  sourceId, discoveredAt: checkedAt, saved: false, feedback: null });
                ping.checks[sourceId].newMatches++;
              }
              ping.seen = [...seen].slice(-2000);
              ping.inbox = ping.inbox.slice(0, 100);
            }
          });
        }
        await store.transaction(state => {
          const ping = state.pings.find(p => p.id === reserved.id);
          if (!ping?.enabled || (ping.activationRevision || 0) !== (reserved.activationRevision || 0)) return;
          const failed = reserved.sourceIds.some(id => ping.checks[id]?.status !== 'ok');
          ping.failures = failed ? Math.min(ping.failures + 1, 8) : 0;
          ping.nextDueAt = now() + Math.min(INTERVAL * 2 ** ping.failures, MAX_INTERVAL);
          results.push({ id: ping.id, status: failed ? 'error' : 'ok' });
        });
      }
      return results;
    })().finally(() => { running = null; });
    return running;
  }
  return Object.freeze({ snapshot, create, update, setEnabled, remove, feedback, runDue });
}
