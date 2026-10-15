import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccounts, readSessionCookie } from '../server/accounts.mjs';
import { createApiServer } from '../server/api.mjs';

const password = 'a good long password!';
const input = { request: 'Climate news', keyword: 'climate', sourceIds: ['bbc-news'] };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pinged-accounts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let clock = 1_800_000_000_000;
  const checker = async () => ({ status: 'ok', matches: [{ id: 'story', title: 'Climate', link: 'https://example.com/story' }] });
  const options = { directory, now: () => clock, checker };
  return { accounts: createAccounts(options), directory, restart: () => createAccounts(options), advance: ms => { clock += ms; } };
}

test('passwords and session tokens are never persisted in plaintext; sessions survive restart, expire and revoke', async t => {
  const f = await fixture(t);
  const registered = await f.accounts.register({ username: 'Rory', password });
  assert.equal(registered.user.username, 'rory');
  const disk = await readFile(join(f.directory, 'accounts.json'), 'utf8');
  assert.equal(disk.includes(password), false); assert.equal(disk.includes(registered.token), false);
  const restarted = f.restart();
  assert.deepEqual(await restarted.authenticate(registered.token), registered.user);
  await assert.rejects(restarted.login({ username: 'rory', password: 'another long password' }), /incorrect/);
  await assert.rejects(restarted.login({ username: 'missing', password }), /incorrect/);
  const login = await restarted.login({ username: 'RORY', password });
  assert.notEqual(login.token, registered.token);
  await restarted.logout(login.token);
  assert.equal(await restarted.authenticate(login.token), null);
  assert.deepEqual(await restarted.authenticate(registered.token), registered.user);
  f.advance(7 * 24 * 60 * 60_000);
  assert.equal(await restarted.authenticate(registered.token), null);
});

test('registration validates credentials and serializes duplicate usernames', async t => {
  const { accounts } = await fixture(t);
  for (const credentials of [{ username: '../escape', password }, { username: 'valid', password: 'short' }, null]) await assert.rejects(accounts.register(credentials));
  const attempts = await Promise.allSettled([accounts.register({ username: 'same', password }), accounts.register({ username: 'SAME', password })]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(r => r.status === 'rejected').reason.status, 409);
});

test('failed sign-ins are rate limited before password derivation and recover after the window', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 20; i++) await assert.rejects(f.accounts.login({ username: 'nobody', password }, 'local'), error => error.status === 401);
  await assert.rejects(f.accounts.login({ username: 'nobody', password }, 'local'), error => error.status === 429);
  f.advance(15 * 60_000);
  await assert.rejects(f.accounts.login({ username: 'nobody', password }, 'local'), error => error.status === 401);
});

test('HTTP accounts isolate reads, writes, inbox, slots and sessions across restart', async t => {
  const f = await fixture(t);
  const server = createApiServer({ accounts: f.accounts });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', data, cookie) => fetch(base + '/api/' + path, { method, headers: { 'X-Pinged-Client': '1', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  assert.equal((await request('state')).status, 401);
  assert.deepEqual(await (await request('session')).json(), { mode: 'accounts', user: null });
  assert.equal((await fetch(base + '/api/register', { method: 'POST', headers: { 'X-Pinged-Client': '1', 'Content-Type': 'application/json', Origin: 'https://attacker.example' }, body: JSON.stringify({ username: 'attacker', password }) })).status, 403);
  const aliceResponse = await request('register', 'POST', { username: 'alice', password });
  assert.equal(aliceResponse.status, 200);
  const cookieA = aliceResponse.headers.get('set-cookie').split(';')[0];
  assert.match(aliceResponse.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const alice = (await aliceResponse.json()).user;
  const bobResponse = await request('register', 'POST', { username: 'bob', password });
  const cookieB = bobResponse.headers.get('set-cookie').split(';')[0];
  const bob = (await bobResponse.json()).user;
  const learning = await request('preferences/learning', 'PUT', { enabled: true }, cookieA);
  assert.equal(learning.status, 200);
  assert.equal((await learning.json()).enabled, true);
  assert.equal((await (await request('state', 'GET', undefined, cookieA)).json()).learning.enabled, true);
  assert.equal((await (await request('state', 'GET', undefined, cookieB)).json()).learning.enabled, false);
  const created = await request('pings', 'POST', { ...input, userId: bob.id }, cookieA);
  const ping = await created.json(); assert.equal(created.status, 201);
  await request('pings', 'POST', input, cookieA); await request('pings', 'POST', input, cookieA);
  assert.equal((await request('pings', 'POST', input, cookieA)).status, 400);
  assert.equal((await request('pings', 'POST', input, cookieB)).status, 201);
  assert.equal((await request('pings/' + ping.id, 'DELETE', undefined, cookieB)).status, 404);
  assert.equal((await request('pings/' + ping.id, 'PUT', input, cookieB)).status, 404);
  assert.equal((await request('pings/' + ping.id, 'PATCH', { enabled: false }, cookieB)).status, 404);
  await f.accounts.runDue();
  const aliceState = await (await request('state', 'GET', undefined, cookieA)).json();
  const bobState = await (await request('state', 'GET', undefined, cookieB)).json();
  assert.equal(aliceState.pings.length, 3); assert.equal(bobState.pings.length, 1);
  assert.equal(aliceState.pings[0].inbox.length, 1);
  assert.equal(bobState.pings.some(p => p.id === ping.id), false);
  assert.equal((await request(`pings/${ping.id}/feedback`, 'POST', { itemId: 'story', value: 'saved' }, cookieB)).status, 404);
  const restarted = f.restart();
  assert.equal((await restarted.serviceFor(alice).snapshot()).pings.length, 3);
  assert.equal((await restarted.serviceFor(bob).snapshot()).pings.length, 1);
  assert.deepEqual(await restarted.authenticate(readSessionCookie(cookieA)), alice);
  assert.equal((await request('logout', 'POST', {}, cookieA)).status, 200);
  assert.equal((await request('state', 'GET', undefined, cookieA)).status, 401);
  assert.equal((await request('state', 'GET', undefined, cookieB)).status, 200);
});

test('duplicate and malformed session cookies fail closed', () => {
  assert.equal(readSessionCookie('pinged_session=a; pinged_session=b'), '');
  assert.equal(readSessionCookie('other=1; pinged_session=abc'), 'abc');
});
