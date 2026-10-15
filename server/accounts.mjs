import { randomBytes, randomUUID, scrypt as deriveKey, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { FilePollStore } from './polling.mjs';
import { createPingService } from './service.mjs';
import { pushSessionKey, createPushSender } from './push.mjs';

const scrypt = promisify(deriveKey);
const hashToken = token => createHash('sha256').update(token).digest('hex');
const reject = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const SESSION_AGE = 7 * 24 * 60 * 60_000;
export const SESSION_COOKIE = 'pinged_session';

// Opt-in local accounts. One process owns all stores; not a hosted identity provider.
export function createAccounts({ directory, store = new FilePollStore(resolve(directory, 'accounts.json')), now = Date.now, checker, pushConfig, pushSender } = {}) {
  const services = new Map(), attempts = new Map();
  const deliverPush = pushConfig ? pushSender || createPushSender(pushConfig) : undefined;
  let hashing = 0;
  async function passwordKey(password, salt) {
    if (hashing >= 4) reject('Sign-in is busy. Try again shortly.', 429);
    hashing++;
    try { return await scrypt(password, salt, 64); } finally { hashing--; }
  }
  function credentials(input) {
    if (!input || typeof input.username !== 'string' || !/^[a-zA-Z0-9_-]{3,40}$/.test(input.username)) reject('Use a username of 3–40 letters, numbers, underscores or hyphens.');
    if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) reject('Use a password of 12–128 characters.');
    return { username: input.username.toLowerCase(), password: input.password };
  }
  function throttle(address) {
    const key = address || 'local';
    const window = attempts.get(key);
    if (!window || now() - window.started >= 15 * 60_000) attempts.set(key, { started: now(), count: 1 });
    else if (++window.count > 20) reject('Too many sign-in attempts. Try again in 15 minutes.', 429);
  }
  function newSession(user) {
    const token = randomBytes(32).toString('base64url');
    user.sessions = (user.sessions || []).filter(s => s.expiresAt > now()).slice(-9);
    user.sessions.push({ hash: hashToken(token), expiresAt: now() + SESSION_AGE });
    return { token, user: { id: user.id, username: user.username } };
  }
  async function register(input, address) {
    throttle(address);
    const { username, password } = credentials(input);
    const salt = randomBytes(16).toString('hex');
    const key = (await passwordKey(password, salt)).toString('hex');
    return store.transaction(state => {
      state.users ||= [];
      if (state.users.some(u => u.username === username)) reject('That username is unavailable.', 409);
      if (state.users.length >= 100) reject('This local preview has reached its account limit.', 409);
      const user = { id: randomUUID(), username, salt, key, sessions: [], createdAt: new Date(now()).toISOString() };
      const session = newSession(user);
      state.users.push(user);
      return session;
    });
  }
  async function login(input, address) {
    throttle(address);
    const { username, password } = credentials(input);
    const user = (await store.read()).users?.find(u => u.username === username);
    // Derive even for an unknown username, avoiding an inexpensive account-existence probe.
    const key = await passwordKey(password, user?.salt || '00000000000000000000000000000000');
    if (!user || !timingSafeEqual(key, Buffer.from(user.key, 'hex'))) reject('Username or password is incorrect.', 401);
    return store.transaction(state => newSession(state.users.find(u => u.id === user.id)));
  }
  async function authenticate(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hashed = hashToken(token);
    const user = (await store.read()).users?.find(u => u.sessions.some(s => s.hash === hashed && s.expiresAt > now()));
    return user ? { id: user.id, username: user.username } : null;
  }
  async function logout(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const user = await authenticate(token);
    if (user) await serviceFor(user).push.unsubscribe(pushSessionKey(token));
    const hashed = hashToken(token);
    await store.transaction(state => { for (const user of state.users || []) user.sessions = user.sessions.filter(s => s.hash !== hashed && s.expiresAt > now()); });
  }
  function serviceFor(user) {
    // Never construct a path from a client-supplied account identifier.
    if (!user || !/^[0-9a-f-]{36}$/.test(user.id)) throw new Error('Invalid account');
    if (!services.has(user.id)) services.set(user.id, createPingService({ store: new FilePollStore(resolve(directory, 'users', user.id + '.json')), now, checker, pushConfig, pushSender: deliverPush, pushOwner: user.id }));
    return services.get(user.id);
  }
  async function runDue() {
    const results = [];
    for (const user of (await store.read()).users || []) {
      try {
        const service = serviceFor(user);
        await service.push.retainSessions(new Set(user.sessions.filter(session => session.expiresAt > now()).map(session => session.hash)));
        results.push({ userId: user.id, results: await service.runDue() });
      }
      catch { results.push({ userId: user.id, error: 'Account check failed' }); }
    }
    return results;
  }
  return Object.freeze({ register, login, authenticate, logout, serviceFor, runDue });
}

export function readSessionCookie(header = '') {
  const tokens = header.split(';').map(part => part.trim()).filter(part => part.startsWith(SESSION_COOKIE + '='));
  return tokens.length === 1 ? tokens[0].slice(SESSION_COOKIE.length + 1) : '';
}
export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? SESSION_AGE / 1000 : 0}`;
}
