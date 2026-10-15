import test from 'node:test';
import assert from 'node:assert/strict';
import { createPingService } from '../server/service.mjs';

test('pause and resume invalidates a response from an earlier activation', async () => {
  let state = {};
  const store = {
    async read() { return structuredClone(state); },
    async transaction(fn) {
      const draft = structuredClone(state);
      const result = await fn(draft);
      state = draft;
      return result;
    }
  };
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let started;
  const called = new Promise(resolve => { started = resolve; });
  const checker = async () => {
    started();
    await pending;
    return { status: 'ok', matches: [{ id: 'old', title: 'Old discovery', link: 'https://example.org/a' }] };
  };
  const service = createPingService({ store, checker });
  const ping = await service.create({ request: 'Track climate', keyword: 'climate', sourceIds: ['bbc-news'] });
  const running = service.runDue();
  await called;
  await service.setEnabled(ping.id, false);
  await service.setEnabled(ping.id, true);
  release();
  await running;
  const updated = (await service.snapshot()).pings[0];
  assert.deepEqual(updated.inbox, []);
  assert.deepEqual(updated.checks, {});
  assert.equal(updated.failures, 0);
  assert.equal(updated.enabled, true);
});
