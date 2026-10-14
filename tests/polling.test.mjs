import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilePollStore, pollAlert } from '../server/polling.mjs';

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'pinged-poll-'));
  try { return await fn(new FilePollStore(join(dir, 'polls.json')), dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
const match = { id: 'story-1', title: 'Climate update', link: 'https://example.org/1', sourceId: 'bbc-news' };
const checker = async (_source, _keyword, { seen }) => ({ status: 'ok', totalEntries: 2, matches: seen.has(match.id) ? [] : [match] });

test('successful check persists discoveries and prevents duplicate inbox entries after reload', async () => fixture(async (store, dir) => {
  const first = await pollAlert({ alertId: 'climate', sourceId: 'bbc-news', keyword: 'climate', store, checker });
  assert.equal(first.newMatches, 1);
  const reloaded = new FilePollStore(join(dir, 'polls.json'));
  const second = await pollAlert({ alertId: 'climate', sourceId: 'bbc-news', keyword: 'climate', store: reloaded, checker });
  assert.equal(second.newMatches, 0);
  const state = await reloaded.read();
  assert.equal(state.alerts.climate.inbox.length, 1);
  assert.equal(state.alerts.climate.seen.length, 1);
  assert.equal(state.alerts.climate.lastCheck.status, 'ok');
}));

test('failed check persists honest error without losing existing discoveries', async () => fixture(async store => {
  await pollAlert({ alertId: 'climate', sourceId: 'bbc-news', keyword: 'climate', store, checker });
  const result = await pollAlert({ alertId: 'climate', sourceId: 'bbc-news', keyword: 'climate', store, checker: async () => { throw Error('network down'); } });
  assert.equal(result.status, 'error');
  assert.deepEqual(result.matches, []);
  assert.equal((await store.read()).alerts.climate.inbox.length, 1);
  assert.equal((await store.read()).alerts.climate.lastCheck.status, 'error');
}));

test('rejects unknown source and changed alert config before any check', async () => fixture(async store => {
  let calls = 0;
  const counting = async (...args) => { calls++; return checker(...args); };
  await assert.rejects(pollAlert({ alertId: 'x', sourceId: 'https://localhost', keyword: 'x', store, checker: counting }), /Unknown/);
  await assert.rejects(pollAlert({ alertId: '__proto__', sourceId: 'bbc-news', keyword: 'x', store, checker: counting }), /Invalid alert ID/);
  await assert.rejects(pollAlert({ alertId: '../escape', sourceId: 'bbc-news', keyword: 'x', store, checker: counting }), /Invalid alert ID/);
  await pollAlert({ alertId: 'x', sourceId: 'bbc-news', keyword: 'x', store, checker: counting });
  await assert.rejects(pollAlert({ alertId: 'x', sourceId: 'bbc-news', keyword: 'y', store, checker: counting }), /configuration changed/);
  assert.equal(calls, 1);
}));

test('serializes concurrent checks against a single store instance', async () => fixture(async store => {
  await Promise.all(Array.from({ length: 5 }, () => pollAlert({ alertId: 'a', sourceId: 'bbc-news', keyword: 'climate', store, checker })));
  assert.equal((await store.read()).alerts.a.inbox.length, 1);
}));

test('corrupt state fails closed rather than erasing user history', async () => fixture(async (store, dir) => {
  await writeFile(join(dir, 'polls.json'), '{broken');
  await assert.rejects(pollAlert({ alertId: 'x', sourceId: 'bbc-news', keyword: 'x', store, checker }), SyntaxError);
  assert.equal(await readFile(join(dir, 'polls.json'), 'utf8'), '{broken');
}));
