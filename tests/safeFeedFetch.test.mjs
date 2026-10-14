import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { isPublicIPv4, resolvePinnedIPv4, safeFeedFetch } from '../server/safeFeedFetch.mjs';

test('rejects non-public, reserved, IPv4-mapped IPv6 and malformed addresses', () => {
  for (const ip of ['0.1.2.3','10.1.2.3','100.64.1.1','100.127.0.1','127.0.0.1','169.254.1.1','172.16.0.1','172.31.0.1','192.0.0.1','192.0.2.1','192.88.99.1','192.168.1.1','198.18.0.1','198.19.1.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::ffff:127.0.0.1','invalid']) {
    assert.equal(isPublicIPv4(ip), false, ip);
  }
  for (const ip of ['1.1.1.1','8.8.8.8','9.9.9.9','93.184.215.14']) assert.equal(isPublicIPv4(ip), true, ip);
});

test('fails closed on DNS with any unsafe address and on IPv6-only or literal hostnames', async () => {
  await assert.rejects(resolvePinnedIPv4('feeds.example.org', { resolve4: async () => ['8.8.8.8','127.0.0.1'] }), /public IPv4/);
  await assert.rejects(resolvePinnedIPv4('feeds.example.org', { resolve4: async () => [] }), /public IPv4/);
  await assert.rejects(resolvePinnedIPv4('127.0.0.1', { resolve4: async () => ['8.8.8.8'] }), /DNS name/);
  assert.equal(await resolvePinnedIPv4('feeds.example.org', { resolve4: async () => ['8.8.8.8'] }), '8.8.8.8');
});

test('rejects unsafe URL and redirect policy before DNS or socket access', async () => {
  let calls = 0;
  const resolve4 = async () => { calls++; return ['8.8.8.8']; };
  for (const url of ['http://feeds.example.org/rss', 'https://user:pass@feeds.example.org/rss', 'https://feeds.example.org:8443/rss', 'https://127.0.0.1/rss', 'https://feeds.example.org/rss#fragment']) {
    await assert.rejects(safeFeedFetch(url, { redirect: 'error' }, { resolve4 }), /Unsafe|DNS name/);
  }
  await assert.rejects(safeFeedFetch('https://feeds.example.org/rss', { redirect: 'follow' }, { resolve4 }), /Unsafe/);
  assert.equal(calls, 0, 'unsafe inputs are rejected before DNS resolution');
});

test('pins validated DNS address in HTTPS lookup while retaining original TLS hostname', async () => {
  let seenOptions;
  const request = (url, options, callback) => {
    assert.equal(url.hostname, 'feeds.example.org');
    seenOptions = options;
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const response = Readable.from([Buffer.from('<rss/>')]);
      response.statusCode = 200;
      response.headers = { 'content-type': 'application/rss+xml' };
      callback(response);
    });
    return req;
  };
  const response = await safeFeedFetch('https://feeds.example.org/rss', { redirect: 'error', method: 'GET', headers: { Accept: 'application/rss+xml' } }, { resolve4: async () => ['8.8.8.8'], request });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<rss/>');
  assert.equal(seenOptions.family, 4);
  assert.equal(seenOptions.method, 'GET');
  assert.equal(seenOptions.headers.Accept, 'application/rss+xml');
  seenOptions.lookup('feeds.example.org', { family: 4 }, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4);
  });
});

test('redirect response fails closed and never becomes a discovery', async () => {
  const request = (_url, _options, callback) => {
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const response = Readable.from([]);
      response.statusCode = 302;
      response.headers = { location: 'http://127.0.0.1/private' };
      callback(response);
    });
    return req;
  };
  await assert.rejects(safeFeedFetch('https://feeds.example.org/rss', { redirect: 'error' }, { resolve4: async () => ['8.8.8.8'], request }), /redirects/);
});

test('aborted DNS lookup fails without opening a socket', async () => {
  const controller = new AbortController();
  let opened = false;
  const work = safeFeedFetch('https://feeds.example.org/rss', { redirect: 'error', signal: controller.signal }, {
    resolve4: async () => new Promise(() => {}),
    request: () => { opened = true; throw Error('should not connect'); }
  });
  controller.abort(new Error('timeout'));
  await assert.rejects(work, /timeout/);
  assert.equal(opened, false);
});
