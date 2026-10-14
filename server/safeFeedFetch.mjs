import { resolve4 as systemResolve4 } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

// Fail closed on private, loopback, link-local, carrier-grade NAT, reserved,
// documentation, benchmarking and multicast IPv4 ranges. IPv6 is deliberately
// unsupported: HTTPS sockets are pinned to a validated IPv4 address.
export function isPublicIPv4(address) {
  if (typeof address !== 'string' || isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 && (c === 0 || c === 2) || b === 88 && c === 99 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export async function resolvePinnedIPv4(hostname, { resolve4 = systemResolve4, signal } = {}) {
  if (typeof hostname !== 'string' || !hostname || isIP(hostname)) throw new Error('Feed hostname must be a DNS name');
  if (signal?.aborted) throw signal.reason || new Error('Feed request aborted');
  const addresses = await new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => finish(reject, signal.reason || new Error('Feed request aborted'));
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      fn(value);
    };
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => resolve4(hostname)).then(value => finish(resolve, value), error => finish(reject, error));
  });
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(address => !isPublicIPv4(address))) {
    throw new Error('Feed DNS did not resolve exclusively to public IPv4 addresses');
  }
  return addresses[0];
}

// Server-side only: unlike fetch(), https.request with a pinned lookup prevents
// DNS rebinding between validation and connection. TLS still validates the
// original hostname. Native https does not follow redirects or proxy env vars.
// This is NOT an arbitrary URL fetch endpoint; callers must enforce the source-ID allowlist.
export async function safeFeedFetch(input, options = {}, { resolve4 = systemResolve4, request = httpsRequest } = {}) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      options.method && options.method !== 'GET' || options.redirect !== 'error') {
    throw new Error('Unsafe feed request');
  }
  const address = await resolvePinnedIPv4(url.hostname, { resolve4, signal: options.signal });
  if (options.signal?.aborted) throw options.signal.reason || new Error('Feed request aborted');
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET', family: 4, agent: false, servername: url.hostname, signal: options.signal, headers: options.headers,
      lookup: (_host, lookupOptions, callback) => {
        if (lookupOptions?.all) callback(null, [{ address, family: 4 }]);
        else callback(null, address, 4);
      }
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.destroy();
        reject(new Error('Feed redirects are not permitted'));
        return;
      }
      if (!Number.isInteger(response.statusCode) || response.statusCode < 200 || response.statusCode > 599) {
        response.destroy();
        reject(new Error('Invalid feed HTTP response'));
        return;
      }
      try {
        const body = [204, 205, 304].includes(response.statusCode) ? null : Readable.toWeb(response);
        resolve(new Response(body, { status: response.statusCode, headers: response.headers }));
      } catch (error) { response.destroy(); reject(error); }
    });
    req.once('error', reject);
    req.end();
  });
}
