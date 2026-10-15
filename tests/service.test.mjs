import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilePollStore } from '../server/polling.mjs';
import { createPingService } from '../server/service.mjs';
import { createApiServer } from '../server/api.mjs';

const input = { request: 'Climate headlines', keyword: 'climate', sourceIds: ['bbc-news'], delivery: 'silent', folder: 'News' };
const match = { id: 'a'.repeat(64), title: 'Climate story', link: 'https://example.com/story', summary: 'A report' };
async function fixture(t, checker) {
  const dir = await mkdtemp(join(tmpdir(), 'pinged-service-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json'); let clock = 1_800_000_000_000;
  const store = new FilePollStore(path), service = createPingService({ store, checker, now: () => clock });
  return { service, store, path, now: () => clock, advance: ms => { clock += ms; } };
}

test('three active slots are enforced atomically across concurrent creates and resume', async t => {
  const { service } = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => service.create(input)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
  const { pings } = await service.snapshot();
  await service.setEnabled(pings[0].id, false);
  await service.create(input);
  await assert.rejects(service.setEnabled(pings[0].id, true), /Pause another/);
  assert.equal((await service.snapshot()).pings.filter(p => p.enabled).length, 3);
});

test('unsupported sources, too many sources, unavailable notifications and bad payloads fail before mutation', async t => {
  const { service } = await fixture(t);
  for (const overrides of [{ sourceIds: ['https://127.0.0.1'] }, { sourceIds: Array(4).fill('bbc-news') }, { delivery: 'push' }, { keyword: '' }, { folder: 2 }]) {
    await assert.rejects(service.create({ ...input, ...overrides }));
  }
  assert.deepEqual((await service.snapshot()).pings, []);
});

test('matching, durable scheduling, inbox deduplication and feedback survive a service restart', async t => {
  let calls = 0;
  const checker = async () => { calls++; return { status: 'ok', matches: [match, match, { ...match, id: 'unsafe', link: 'javascript:alert(1)' }] }; };
  const f = await fixture(t, checker);
  const ping = await f.service.create(input);
  await Promise.all([f.service.runDue(), f.service.runDue()]);
  assert.equal(calls, 1);
  assert.equal((await f.service.snapshot()).pings[0].inbox.length, 1);
  await f.service.feedback(ping.id, match.id, 'useful');
  await f.service.feedback(ping.id, match.id, 'saved');
  const restarted = createPingService({ store: new FilePollStore(f.path), checker, now: f.now });
  await restarted.runDue(); assert.equal(calls, 1);
  f.advance(15 * 60_000); await restarted.runDue(); assert.equal(calls, 2);
  const record = (await restarted.snapshot()).pings[0];
  assert.equal(record.inbox.length, 1); assert.equal(record.inbox[0].saved, true);
  assert.equal(record.inbox[0].feedback, 'useful'); assert.equal(record.keyword, 'climate');
});

test('failed source checks keep discoveries and persist backoff across restart', async t => {
  let failed = false;
  const checker = async () => { if (failed) throw Error('down'); return { status: 'ok', matches: [match] }; };
  const f = await fixture(t, checker); await f.service.create(input); await f.service.runDue();
  failed = true; f.advance(15 * 60_000); await f.service.runDue();
  const ping = (await f.service.snapshot()).pings[0];
  assert.equal(ping.checks['bbc-news'].status, 'error'); assert.equal(ping.inbox.length, 1);
  assert.equal(ping.nextDueAt, f.now() + 30 * 60_000);
  const restarted = createPingService({ store: new FilePollStore(f.path), checker, now: f.now });
  assert.deepEqual(await restarted.runDue(), []);
});

test('pause during an in-flight check discards arrivals without blocking pause', async t => {
  let release, started;
  const entered = new Promise(r => { started = r; });
  const f = await fixture(t, () => { started(); return new Promise(r => { release = r; }); });
  const ping = await f.service.create(input), running = f.service.runDue();
  await entered; await f.service.setEnabled(ping.id, false);
  release({ status: 'ok', matches: [match] }); await running;
  assert.equal((await f.service.snapshot()).pings[0].inbox.length, 0);
});

test('real HTTP API persists create/pause and rejects browser cross-origin and untrusted input', async t => {
  const { service } = await fixture(t);
  const server = createApiServer({ service });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-Pinged-Client': '1', 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/state')).status, 403);
  assert.equal((await fetch(base + '/api/state', { headers: { ...headers, Origin: 'https://attacker.example' } })).status, 403);
  const response = await fetch(base + '/api/pings', { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(response.status, 201); const ping = await response.json();
  assert.equal((await fetch(base + '/api/pings/' + ping.id, { method: 'PATCH', headers, body: '{bad' })).status, 400);
  assert.equal((await fetch(base + '/api/pings/' + ping.id, { method: 'PATCH', headers, body: 'null' })).status, 400);
  assert.equal((await fetch(base + '/api/pings/' + ping.id, { method: 'PATCH', headers, body: JSON.stringify({ enabled: false }) })).status, 200);
  const state = await (await fetch(base + '/api/state', { headers })).json();
  assert.equal(state.pings[0].enabled, false);
  assert.equal(state.notifications.push, false);
});

test('HTTP creation flows through the actual RSS parser into the persistent inbox', async t => {
  const { checkFeed } = await import('../server/monitor.mjs');
  const xml = '<rss version="2.0"><channel><title>News</title><item><title>Climate technology</title><link>https://example.com/climate</link><description>A new report</description></item></channel></rss>';
  const f = await fixture(t, (id, keyword, options) => checkFeed(id, keyword, { ...options, fetcher: async () => new Response(xml, { headers: { 'content-type': 'application/rss+xml' } }) }));
  const server = createApiServer({ service: f.service });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-Pinged-Client': '1', 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/pings', { method: 'POST', headers, body: JSON.stringify(input) })).status, 201);
  await f.service.runDue();
  const state = await (await fetch(base + '/api/state', { headers })).json();
  assert.equal(state.pings[0].inbox[0].title, 'Climate technology');
  assert.equal(state.pings[0].checks['bbc-news'].status, 'ok');
  assert.equal(state.pings[0].delivery, 'silent');
  f.advance(15 * 60_000); await f.service.runDue();
  assert.equal((await f.service.snapshot()).pings[0].inbox.length, 1);
});
