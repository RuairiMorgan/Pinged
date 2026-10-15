import { createHash, randomUUID, ECDH } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import webpush from 'web-push';
import { resolvePinnedIPv4 } from './safeFeedFetch.mjs';

const PROVIDERS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const DAY = 24 * 60 * 60_000;
export const pushSessionKey = token => createHash('sha256').update(token).digest('hex');
export function validateSubscription(input) {
  if (!input || typeof input.endpoint !== 'string' || input.endpoint.length > 2048) fail('Invalid push subscription.');
  let url;
  try { url = new URL(input.endpoint); } catch { fail('Invalid push endpoint.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !PROVIDERS.has(url.hostname)) fail('This browser push provider is not supported yet.');
  const p256dh = input.keys?.p256dh, auth = input.keys?.auth;
  if (typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(p256dh) || Buffer.from(p256dh, 'base64url').length !== 65 || Buffer.from(p256dh, 'base64url')[0] !== 4 ||
      typeof auth !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(auth) || Buffer.from(auth, 'base64url').length !== 16) fail('Invalid browser push keys.');
  try { ECDH.convertKey(Buffer.from(p256dh, 'base64url'), 'prime256v1'); } catch { fail('Invalid browser push public key.'); }
  return { endpoint: url.href, keys: { p256dh, auth } };
}

// web-push handles RFC payload encryption and VAPID signing. Our transport pins
// public DNS, validates TLS against the original provider and never follows redirects.
export function createPushSender(config, { resolveAddress = resolvePinnedIPv4, request = httpsRequest } = {}) {
  // Validate configuration before advertising push capability; no network request.
  webpush.getVapidHeaders('https://fcm.googleapis.com', config.subject, config.publicKey, config.privateKey, 'aes128gcm');
  return async (subscription, payload) => {
    const valid = validateSubscription(subscription);
    const details = webpush.generateRequestDetails(valid, JSON.stringify(payload), { TTL: 3600, urgency: 'normal', contentEncoding: 'aes128gcm', vapidDetails: config });
    const url = new URL(details.endpoint), signal = AbortSignal.timeout(10_000);
    const address = await resolveAddress(url.hostname, { signal });
    return new Promise((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: details.headers, agent: false, family: 4, servername: url.hostname, signal,
        lookup: (_host, options, callback) => options?.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4)
      }, response => {
        // Response bodies can contain endpoint secrets. Discard without logging.
        const statusCode = response.statusCode;
        response.destroy();
        if (Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 300) resolve({ statusCode });
        else reject(Object.assign(new Error('Push provider did not accept delivery'), { statusCode }));
      });
      req.once('error', reject);
      req.end(details.body);
    });
  };
}

export function createPushDelivery({ store, ownerId, config, sender, now = Date.now } = {}) {
  const enabled = Boolean(config && ownerId);
  const send = enabled ? sender || createPushSender(config) : null;
  let running = null;
  function status(state) {
    return { push: enabled, publicKey: enabled ? config.publicKey : null, devices: (state.pushSubscriptions || []).length, email: false, queueOverflow: state.pushQueueOverflow || 0,
      delivery: (state.pushOutbox || []).slice(-20).map(({ id, pingId, status, attempts }) => ({ id, pingId, status, attempts })) };
  }
  async function subscribe(input, sessionKey) {
    if (!enabled) fail('Push is not configured on this server.', 503);
    const subscription = validateSubscription(input);
    const id = createHash('sha256').update(subscription.endpoint).digest('hex');
    return store.transaction(state => {
      state.pushSubscriptions ||= [];
      const existing = state.pushSubscriptions.find(s => s.id === id);
      if (!existing && state.pushSubscriptions.length >= 5) fail('This account already has five push devices. Disconnect one first.');
      if (existing) Object.assign(existing, { subscription, sessionKey });
      else state.pushSubscriptions.push({ id, subscription, sessionKey, createdAt: now() });
      return { id };
    });
  }
  async function unsubscribe(sessionKey) {
    return store.transaction(state => {
      const removed = new Set((state.pushSubscriptions || []).filter(s => s.sessionKey === sessionKey).map(s => s.id));
      state.pushSubscriptions = (state.pushSubscriptions || []).filter(s => !removed.has(s.id));
      for (const event of state.pushOutbox || []) if (removed.has(event.subscriptionId) && ['pending', 'sending'].includes(event.status)) event.status = 'cancelled';
    });
  }
  async function retainSessions(activeKeys) {
    const state = await store.read();
    const stale = new Set((state.pushSubscriptions || []).filter(device => !activeKeys.has(device.sessionKey)).map(device => device.sessionKey));
    for (const key of stale) await unsubscribe(key);
  }
  // Called inside the same transaction that persists new inbox entries.
  function enqueue(state, ping, count) {
    if (!enabled || ping.delivery !== 'push' || !count) return;
    state.pushOutbox ||= [];
    for (const event of state.pushOutbox) if (['pending', 'sending'].includes(event.status) && event.expiresAt <= now()) event.status = 'cancelled';
    const active = state.pushOutbox.filter(e => ['pending', 'sending'].includes(e.status));
    const history = state.pushOutbox.filter(e => !['pending', 'sending'].includes(e.status)).slice(-100);
    state.pushOutbox = [...history, ...active];
    for (const device of state.pushSubscriptions || []) {
      if (active.length >= 900) { state.pushQueueOverflow = Math.min((state.pushQueueOverflow || 0) + 1, Number.MAX_SAFE_INTEGER); continue; }
      const event = { id: randomUUID(), pingId: ping.id, revision: ping.activationRevision || 0,
      subscriptionId: device.id, status: 'pending', attempts: 0, nextDueAt: now(), expiresAt: now() + DAY };
      state.pushOutbox.push(event); active.push(event);
    }
  }
  function drain() {
    if (!enabled) return Promise.resolve([]);
    if (running) return running;
    running = (async () => {
      const results = [];
      // Bounded per tick. In-flight leases recover after restart; delivery is at least once.
      for (let i = 0; i < 20; i++) {
        const job = await store.transaction(state => {
          const events = state.pushOutbox || [];
          for (const event of events) {
            if (!['pending', 'sending'].includes(event.status)) continue;
            const ping = state.pings?.find(p => p.id === event.pingId);
            const device = state.pushSubscriptions?.find(s => s.id === event.subscriptionId);
            if (!ping?.enabled || ping.delivery !== 'push' || (ping.activationRevision || 0) !== event.revision || !device || event.expiresAt <= now()) { event.status = 'cancelled'; continue; }
            if (event.status === 'sending' && event.leaseUntil > now() || event.nextDueAt > now()) continue;
            if (event.attempts >= 5) { event.status = 'failed'; continue; }
            event.status = 'sending'; event.leaseUntil = now() + 60_000; event.attempts++;
            return { event: structuredClone(event), subscription: structuredClone(device.subscription) };
          }
          return null;
        });
        if (!job) break;
        let outcome = 'accepted', code;
        try {
          const response = await send(job.subscription, { title: 'Pinged', body: 'New discoveries are waiting in your inbox.', eventId: job.event.id, userId: ownerId });
          code = response?.statusCode;
          if (!Number.isInteger(code) || code < 200 || code >= 300) throw Object.assign(new Error('Not accepted'), { statusCode: code });
        } catch (error) { outcome = 'failed'; code = error.statusCode; }
        await store.transaction(state => {
          const event = state.pushOutbox?.find(e => e.id === job.event.id);
          if (!event || event.status !== 'sending') return;
          if (outcome === 'accepted') { event.status = 'accepted'; event.acceptedAt = now(); }
          else if ([404, 410].includes(code)) {
            event.status = 'failed'; state.pushSubscriptions = (state.pushSubscriptions || []).filter(s => s.id !== event.subscriptionId);
          } else if (event.attempts < 5 && (!code || code >= 500 || [408, 429].includes(code))) {
            event.status = 'pending'; event.nextDueAt = now() + Math.min(30_000 * 2 ** (event.attempts - 1), 3600_000);
          } else event.status = 'failed';
          delete event.leaseUntil;
          results.push({ id: event.id, status: event.status });
        });
      }
      return results;
    })().finally(() => { running = null; });
    return running;
  }
  return Object.freeze({ status, subscribe, unsubscribe, retainSessions, enqueue, drain });
}
