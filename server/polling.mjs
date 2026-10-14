import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { checkFeed } from './monitor.mjs';
import { getFeedSource } from './feedSources.mjs';

const MAX_SEEN = 2000;
const MAX_INBOX = 100;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const emptyState = () => ({ version: 1, alerts: {} });

// Local, single-process prototype storage. No concurrent process writers or cloud sync.
export class FilePollStore {
  #queue = Promise.resolve();
  constructor(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('Store path required');
    this.filePath = filePath;
  }

  async read() {
    let raw;
    try { raw = await readFile(this.filePath, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return emptyState(); throw error; }
    const state = JSON.parse(raw);
    if (state?.version !== 1 || !state.alerts || typeof state.alerts !== 'object' || Array.isArray(state.alerts)) {
      throw new Error('Unsupported or corrupt polling state');
    }
    return state;
  }

  // Serializes read-modify-write in this process and replaces the file atomically.
  async transaction(change) {
    const work = this.#queue.then(async () => {
      const state = await this.read();
      const result = await change(state);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' });
        await rename(temp, this.filePath);
      } finally { await rm(temp, { force: true }).catch(() => {}); }
      return result;
    });
    this.#queue = work.then(() => undefined, () => undefined);
    return work;
  }
}

export async function pollAlert({ alertId, sourceId, keyword, store, checker = checkFeed, now = () => new Date() }) {
  if (typeof alertId !== 'string' || !ID_PATTERN.test(alertId) || ['__proto__', 'constructor', 'prototype'].includes(alertId)) throw new Error('Invalid alert ID');
  getFeedSource(sourceId); // Reject arbitrary source URLs before state mutation or network calls.
  if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 120) throw new Error('Invalid keyword');
  if (!store || typeof store.transaction !== 'function') throw new Error('Polling store required');

  return store.transaction(async state => {
    const previous = Object.hasOwn(state.alerts, alertId) ? state.alerts[alertId] : null;
    if (previous && (previous.sourceId !== sourceId || previous.keyword !== keyword.trim())) {
      throw new Error('Alert configuration changed; create a new alert ID');
    }
    const record = previous || { sourceId, keyword: keyword.trim(), seen: [], inbox: [], lastCheck: null };
    const checkedAt = now().toISOString();
    try {
      const result = await checker(sourceId, keyword.trim(), { seen: new Set(record.seen) });
      if (result?.status !== 'ok' || !Array.isArray(result.matches)) throw new Error('Invalid checker response');
      const fresh = result.matches.slice(0, 250).filter(item => item && typeof item.id === 'string' && item.id.length <= 128 && !record.seen.includes(item.id));
      const deduped = [...new Map(fresh.map(item => [item.id, item])).values()];
      record.seen = [...record.seen, ...deduped.map(item => item.id)].slice(-MAX_SEEN);
      record.inbox = [...deduped.map(item => ({ ...item, discoveredAt: checkedAt })), ...record.inbox].slice(0, MAX_INBOX);
      record.lastCheck = { status: 'ok', checkedAt, totalEntries: result.totalEntries, newMatches: deduped.length };
      state.alerts[alertId] = record;
      return { ...record.lastCheck, matches: deduped };
    } catch (error) {
      record.lastCheck = { status: 'error', checkedAt, error: 'Source check failed' };
      state.alerts[alertId] = record;
      return { ...record.lastCheck, matches: [] };
    }
  });
}
