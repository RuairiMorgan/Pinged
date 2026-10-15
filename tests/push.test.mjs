import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import webpush from 'web-push';
import { FilePollStore } from '../server/polling.mjs';
import { createPingService } from '../server/service.mjs';
import { createPushSender, validateSubscription, pushSessionKey } from '../server/push.mjs';
import { createAccounts } from '../server/accounts.mjs';
import { createApiServer } from '../server/api.mjs';
const config = { ...webpush.generateVAPIDKeys(), subject: 'mailto:test@example.com' };
function subscription(path = 'device') {
  const client = createECDH('prime256v1'); client.generateKeys();
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/' + path, keys: { p256dh: client.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}
const input = { request: 'Private climate search', keyword: 'climate', sourceIds: ['bbc-news'], delivery: 'push' };
async function fixture(t, sender) {
  const directory = await mkdtemp(join(tmpdir(), 'pinged-push-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let clock = 1_800_000_000_000;
  const store = new FilePollStore(join(directory, 'state.json'));
  const options = { store, now: () => clock, pushOwner: 'owner', pushConfig: config, pushSender: sender,
    checker: async () => ({ status: 'ok', matches: [{ id: 'story', title: 'Private climate discovery', link: 'https://example.com/story' }] }) };
  return { store, service: createPingService(options), restart: () => createPingService(options), directory, advance: ms => { clock += ms; } };
}

test('push is opt-in, requires a connected device, keeps silent Pings silent and deduplicates discoveries', async t => {
  const sent = [];
  const f = await fixture(t, async (sub, payload) => { sent.push({ sub, payload }); return { statusCode: 201 }; });
  await assert.rejects(f.service.create(input), /Enable push/);
  await f.service.push.subscribe(subscription(), 'session');
  await f.service.create(input); await f.service.create({ ...input, delivery: 'silent' });
  await f.service.runDue();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.body, 'New discoveries are waiting in your inbox.');
  assert.equal(JSON.stringify(sent[0].payload).includes('climate'), false);
  assert.equal(sent[0].payload.userId, 'owner');
  let snapshot = await f.service.snapshot();
  assert.equal(snapshot.notifications.delivery[0].status, 'accepted');
  assert.equal(JSON.stringify(snapshot.notifications).includes('endpoint'), false);
  assert.equal(snapshot.pings.every(p => p.inbox.length === 1), true);
  f.advance(15 * 60_000); await f.service.runDue();
  assert.equal(sent.length, 1);
});

test('transient push failures retry durably without refetching or losing discoveries', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { if (++calls === 1) throw Object.assign(Error('unavailable'), { statusCode: 503 }); return { statusCode: 201 }; });
  await f.service.push.subscribe(subscription(), 'session'); await f.service.create(input); await f.service.runDue();
  assert.equal((await f.service.snapshot()).notifications.delivery[0].status, 'pending');
  const restarted = f.restart(); await restarted.runDue(); assert.equal(calls, 1);
  f.advance(30_000); await restarted.runDue();
  assert.equal(calls, 2);
  const snapshot = await restarted.snapshot();
  assert.equal(snapshot.notifications.delivery[0].status, 'accepted');
  assert.equal(snapshot.pings[0].inbox.length, 1);
});

test('retired endpoints are removed and permanent provider failures never report acceptance', async t => {
  for (const statusCode of [410, 400]) {
    const f = await fixture(t, async () => { throw Object.assign(Error('rejected'), { statusCode }); });
    await f.service.push.subscribe(subscription(), 'session'); await f.service.create(input); await f.service.runDue();
    const state = await f.service.snapshot();
    assert.equal(state.notifications.delivery[0].status, 'failed');
    assert.equal(state.notifications.devices, statusCode === 410 ? 0 : 1);
    assert.equal(state.pings[0].inbox.length, 1);
  }
});

test('pause, deletion, changed criteria and silent preferences cancel queued retries', async t => {
  for (const change of ['pause', 'remove', 'edit', 'silent']) {
    let calls = 0;
    const f = await fixture(t, async () => { calls++; throw Object.assign(Error('retry'), { statusCode: 503 }); });
    await f.service.push.subscribe(subscription(), 'session'); const ping = await f.service.create(input); await f.service.runDue();
    if (change === 'pause') await f.service.setEnabled(ping.id, false);
    if (change === 'remove') await f.service.remove(ping.id);
    if (change === 'edit') await f.service.update(ping.id, { ...input, keyword: 'battery' });
    if (change === 'silent') await f.service.update(ping.id, { ...input, delivery: 'silent' });
    f.advance(30_000); await f.service.runDue();
    // Criteria edits can enqueue a new event; the old event must always be cancelled.
    const first = (await f.store.read()).pushOutbox[0];
    assert.equal(first.status, 'cancelled');
    if (change !== 'edit') assert.equal(calls, 1);
  }
});

test('disconnect cancels queued notifications; expired in-flight leases recover with the same event ID', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return { statusCode: 201 }; });
  await f.service.push.subscribe(subscription(), 'session'); const ping = await f.service.create(input);
  await f.store.transaction(state => { f.service.push.enqueue(state, state.pings[0], 1); state.pushOutbox[0].status = 'sending'; state.pushOutbox[0].leaseUntil = 1; });
  const eventId = (await f.store.read()).pushOutbox[0].id;
  await f.restart().push.drain();
  assert.equal(calls, 1); assert.equal((await f.store.read()).pushOutbox[0].id, eventId);
  await f.store.transaction(state => f.service.push.enqueue(state, state.pings.find(p => p.id === ping.id), 1));
  await f.service.push.unsubscribe('session'); await f.service.push.drain();
  assert.equal(calls, 1); assert.equal((await f.service.snapshot()).notifications.devices, 0);
});

test('subscription validation rejects arbitrary hosts, credentials, redirects-as-endpoints and invalid keys', () => {
  const valid = subscription();
  for (const endpoint of ['https://127.0.0.1/push', 'https://evil.example/push', 'http://fcm.googleapis.com/push', 'https://fcm.googleapis.com.evil.example/push', 'https://user:pass@fcm.googleapis.com/push', 'https://fcm.googleapis.com:444/push']) assert.throws(() => validateSubscription({ ...valid, endpoint }));
  assert.throws(() => validateSubscription({ ...valid, keys: { ...valid.keys, auth: 'bad' } }));
  assert.throws(() => validateSubscription({ ...valid, keys: { ...valid.keys, p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64url') } }));
  assert.deepEqual(validateSubscription(valid), valid);
});

test('real encryption/VAPID uses pinned provider transport and rejects redirects without following them', async () => {
  let observed, requests = 0, responseCode = 201;
  const sender = createPushSender(config, { resolveAddress: async host => { assert.equal(host, 'fcm.googleapis.com'); return '8.8.8.8'; }, request: (url, options, callback) => {
    requests++; observed = { url, options };
    const req = new EventEmitter(); req.end = encrypted => {
      assert.ok(Buffer.isBuffer(encrypted)); assert.ok(encrypted.length > 100);
      assert.equal(encrypted.includes(Buffer.from('private payload')), false);
      assert.match(options.headers.Authorization || options.headers.authorization, /vapid/);
      options.lookup(url.hostname, {}, (_error, address, family) => { assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
      queueMicrotask(() => callback({ statusCode: responseCode, destroy() {} }));
    }; return req;
  } });
  assert.equal((await sender(subscription(), { body: 'private payload' })).statusCode, 201);
  assert.equal(observed.options.method, 'POST'); assert.equal(observed.options.servername, 'fcm.googleapis.com'); assert.equal(observed.options.agent, false);
  responseCode = 302;
  await assert.rejects(sender(subscription(), {}), error => error.statusCode === 302);
  assert.equal(requests, 2);
});

test('HTTP push subscriptions belong to sessions and accounts; logout and expired sessions stop delivery', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pinged-push-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let clock = 1_800_000_000_000;
  const { checkFeed } = await import('../server/monitor.mjs');
  let sent = 0;
  const checker = (source, keyword, options) => checkFeed(source, keyword, { ...options, fetcher: async () => new Response('<rss version="2.0"><channel><item><title>Climate report</title><link>https://example.com/news</link></item></channel></rss>', { headers: { 'content-type': 'application/rss+xml' } }) });
  const accounts = createAccounts({ directory, now: () => clock, checker, pushConfig: config, pushSender: async () => { sent++; return { statusCode: 201 }; } });
  const server = createApiServer({ accounts }); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const request = (path, method = 'GET', body, cookie) => fetch(base + path, { method, headers: { 'X-Pinged-Client': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await request('push/subscription', 'POST', subscription())).status, 401);
  const a = await request('register', 'POST', { username: 'alice', password: 'long enough password' }); const cookieA = a.headers.get('set-cookie').split(';')[0]; const alice = (await a.json()).user;
  const b = await request('register', 'POST', { username: 'bob', password: 'long enough password' }); const cookieB = b.headers.get('set-cookie').split(';')[0];
  const staleHeaders = { 'X-Pinged-Client': '1', 'X-Pinged-Account': alice.id, Cookie: cookieB, 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + 'state', { headers: staleHeaders })).status, 409);
  assert.equal((await fetch(base + 'pings', { method: 'POST', headers: staleHeaders, body: JSON.stringify(input) })).status, 409);
  assert.equal((await fetch(base + 'logout', { method: 'POST', headers: staleHeaders, body: '{}' })).status, 409);
  assert.equal((await request('state', 'GET', undefined, cookieB)).status, 200);
  assert.equal((await request('push/subscription', 'POST', subscription(), cookieA)).status, 200);
  assert.equal((await request('pings', 'POST', input, cookieA)).status, 201);
  await accounts.runDue();
  assert.equal(sent, 1);
  const stateA = await (await request('state', 'GET', undefined, cookieA)).json();
  assert.equal(stateA.pings[0].inbox[0].title, 'Climate report');
  assert.equal(stateA.notifications.delivery[0].status, 'accepted');
  await accounts.runDue(); assert.equal(sent, 1);
  assert.equal((await (await request('state', 'GET', undefined, cookieB)).json()).notifications.devices, 0);
  await request('push/subscription', 'DELETE', undefined, cookieB);
  assert.equal((await accounts.serviceFor(alice).snapshot()).notifications.devices, 1);
  await request('logout', 'POST', {}, cookieA);
  assert.equal((await accounts.serviceFor(alice).snapshot()).notifications.devices, 0);
  // Expired sessions are also pruned by the scheduler, even without an explicit logout.
  const login = await accounts.login({ username: 'alice', password: 'long enough password' });
  await accounts.serviceFor(alice).push.subscribe(subscription('second'), pushSessionKey(login.token));
  clock += 7 * 24 * 60 * 60_000;
  await accounts.runDue();
  assert.equal((await accounts.serviceFor(alice).snapshot()).notifications.devices, 0);
});

test('worker shows only generic notifications for the currently signed-in account and opens its own inbox', async () => {
  const handlers = {}, shown = [], opened = [];
  let currentUser = 'alice', networkFails = false;
  const context = { URL, fetch: async () => { if (networkFails) throw Error('offline'); return { ok: true, json: async () => ({ user: currentUser ? { id: currentUser } : null }) }; }, self: {
    addEventListener: (name, callback) => { handlers[name] = callback; }, location: { origin: 'https://pinged.example' },
    registration: { showNotification: async (...args) => { shown.push(args); } },
    clients: { matchAll: async () => [], openWindow: async url => { opened.push(url); } }
  } };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  async function push(userId) { let pending; handlers.push({ data: { json: () => ({ userId, eventId: 'stable-id', body: 'private content', url: 'https://evil.example' }) }, waitUntil: promise => { pending = promise; } }); await pending; }
  await push('alice'); assert.equal(shown.length, 1); assert.equal(shown[0][1].body, 'New discoveries are waiting in your inbox.');
  currentUser = 'bob'; await push('alice'); currentUser = null; await push('alice'); networkFails = true; await push('alice'); assert.equal(shown.length, 1);
  let pending; handlers.notificationclick({ notification: { close() {} }, waitUntil: promise => { pending = promise; } }); await pending;
  assert.deepEqual(opened, ['https://pinged.example/#inbox']);
});


test('push retries stop after five attempts while inbox data remains intact', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; throw Object.assign(Error('busy'), { statusCode: 429 }); });
  await f.service.push.subscribe(subscription(), 'session'); await f.service.create(input); await f.service.runDue();
  for (let i = 0; i < 5; i++) { f.advance(5 * 60_000); await f.service.runDue(); }
  assert.equal(calls, 5);
  const state = await f.service.snapshot();
  assert.equal(state.notifications.delivery[0].status, 'failed');
  assert.equal(state.pings[0].inbox.length, 1);
});

test('full push queues never silently discard pending events or lose inbox discoveries', async t => {
  const f = await fixture(t, async () => ({ statusCode: 201 }));
  await f.service.push.subscribe(subscription(), 'session'); const ping = await f.service.create(input);
  await f.store.transaction(state => {
    const current = state.pings.find(p => p.id === ping.id);
    for (let i = 0; i < 901; i++) f.service.push.enqueue(state, current, 1);
    assert.equal(state.pushOutbox.filter(event => event.status === 'pending').length, 900);
    assert.equal(state.pushQueueOverflow, 1);
  });
  const state = await f.service.snapshot();
  assert.equal(state.notifications.queueOverflow, 1);
});
