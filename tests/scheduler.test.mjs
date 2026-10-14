import test from 'node:test';
import assert from 'node:assert/strict';
import { createPollingScheduler } from '../server/scheduler.mjs';

const store = { transaction() {} };
const alert = (id = 'news') => ({ alertId: id, sourceId: 'bbc-news', keyword: 'climate' });
const MIN = 15 * 60 * 1000;
function scheduler(opts = {}) {
  return createPollingScheduler({ alerts: [alert()], store,
    poller: async () => ({ status: 'ok', matches: [] }), ...opts });
}

test('rejects unsafe or unsupported configurations before running', () => {
  assert.throws(() => scheduler({ alerts: [alert('a'), alert('a')] }), /duplicate/);
  assert.throws(() => scheduler({ alerts: [{ ...alert(), sourceId: 'https://example.com/rss' }] }), /Unknown/);
  assert.throws(() => scheduler({ alerts: [alert('__proto__')] }), /Invalid/);
  assert.throws(() => scheduler({ alerts: [alert(), { ...alert('b'), keyword: '  ' }] }), /keyword/);
  assert.throws(() => scheduler({ intervalMs: 1000 }), /interval/);
  assert.throws(() => scheduler({ alerts: [] }), /1–25/);
});

test('checks only due alerts and does not start on construction', async () => {
  let time = 1_000_000;
  const calls = [];
  const s = scheduler({ now: () => time, poller: async args => {
    calls.push(args.alertId);
    return { status: 'ok', matches: [{ id: 'story' }] };
  } });
  assert.equal(calls.length, 0);
  assert.equal(s.snapshot()[0].nextDueAt, null);
  assert.equal((await s.runDue())[0].newMatches, 1);
  assert.deepEqual(await s.runDue(), []);
  time += MIN;
  assert.equal((await s.runDue()).length, 1);
  assert.deepEqual(calls, ['news', 'news']);
});

test('backs off failed checks and resets delay after success', async () => {
  let time = 1_000_000, attempts = 0;
  const s = scheduler({ now: () => time, poller: async () => {
    attempts++;
    return attempts === 1 ? { status: 'error', matches: [] } : { status: 'ok', matches: [] };
  } });
  const first = await s.runDue();
  assert.equal(first[0].status, 'error');
  assert.equal(first[0].persisted, true);
  assert.equal(s.snapshot()[0].failures, 1);
  time += MIN;
  assert.deepEqual(await s.runDue(), []);
  time += MIN;
  assert.equal((await s.runDue())[0].status, 'ok');
  assert.equal(s.snapshot()[0].failures, 0);
  time += MIN;
  assert.equal((await s.runDue()).length, 1);
});

test('coalesces concurrent ticks into one network check', async () => {
  let release, calls = 0;
  const s = scheduler({ now: () => 1_000_000, poller: async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    return { status: 'ok', matches: [] };
  } });
  const a = s.runDue(), b = s.runDue();
  assert.equal(a, b);
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
});

test('isolates thrown storage errors and reports not persisted', async () => {
  const s = scheduler({ alerts: [alert('first'), alert('second')], now: () => 1_000_000,
    poller: async ({ alertId }) => {
      if (alertId === 'first') throw new Error('disk full');
      return { status: 'ok', matches: [] };
    } });
  const result = await s.runDue();
  assert.deepEqual(result.map(x => [x.status, x.persisted]), [['error', false], ['ok', true]]);
});

test('start/stop uses an explicit timer and prevents duplicate starts', async () => {
  let tick, cleared, checks = 0;
  const s = scheduler({ now: () => 1_000_000,
    poller: async () => { checks++; return { status: 'ok', matches: [] }; },
    setIntervalFn: (fn, ms) => { tick = fn; assert.equal(ms, MIN); return 7; },
    clearIntervalFn: id => { cleared = id; } });
  assert.equal(s.start(), true);
  assert.equal(s.start(), false);
  await s.runDue();
  tick();
  await s.runDue();
  assert.equal(checks, 1);
  assert.equal(s.stop(), true);
  assert.equal(cleared, 7);
  assert.equal(s.stop(), false);
});
