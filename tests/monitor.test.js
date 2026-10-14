import test from "node:test";
import assert from "node:assert/strict";
import { checkFeed, checkConfiguredSource } from "../server/monitor.mjs";
import { resolveFeedUrl } from "../server/sourceRegistry.mjs";

const feed = '<rss><channel><item><title>Ocean technology</title><link>https://example.com/story?a=1&amp;b=2</link><description>New clean energy breakthrough</description></item><item><title>Other story</title><link>https://example.com/other</link></item></channel></rss>';
const mockResponse = (body = feed, init = {}) => new Response(body, { status: init.status || 200, headers: { "content-type": "application/rss+xml", ...init.headers } });
const url = resolveFeedUrl("bbc-news");

test("only exact server-owned HTTPS feed URLs may be fetched", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return mockResponse(); };
  for (const unsafe of ["http://127.0.0.1/private", "https://feeds.bbci.co.uk.evil.test/news/rss.xml", url + "?redirect=1", "file:///etc/passwd"]) {
    await assert.rejects(checkFeed(unsafe, "ocean", { fetcher }), /allowlisted/);
  }
  assert.equal(calls, 0);
  assert.throws(() => resolveFeedUrl("__proto__"), /Unsupported/);
});

test("configured source matches keyword and decodes article URL", async () => {
  let requested;
  const results = await checkConfiguredSource("bbc-news", "OCEAN", { fetcher: async (u, options) => {
    requested = { url: String(u), options }; return mockResponse();
  } });
  assert.equal(requested.url, url);
  assert.equal(requested.options.redirect, "manual");
  assert.equal(results.length, 1);
  assert.equal(results[0].link, "https://example.com/story?a=1&b=2");
  assert.match(results[0].id, /^[a-f0-9]{64}$/);
});

test("already-seen IDs are excluded", async () => {
  const fetcher = async () => mockResponse();
  const first = await checkFeed(url, "technology", { fetcher });
  const second = await checkFeed(url, "technology", { fetcher, seen: new Set(first.map(x => x.id)) });
  assert.equal(first.length, 1);
  assert.deepEqual(second, []);
});

test("redirects are rejected even from allowlisted endpoint", async () => {
  await assert.rejects(checkFeed(url, "test", { fetcher: async () => mockResponse("", { status: 302, headers: { location: "http://127.0.0.1" } }) }), /redirects are blocked/);
});

test("content-type and non-success status are rejected", async () => {
  await assert.rejects(checkFeed(url, "test", { fetcher: async () => mockResponse("bad", { headers: { "content-type": "text/html" } }) }), /content type/);
  await assert.rejects(checkFeed(url, "test", { fetcher: async () => mockResponse("", { status: 503 }) }), /503/);
});

test("rejects oversized feeds before and during streaming", async () => {
  await assert.rejects(checkFeed(url, "test", { fetcher: async () => mockResponse("x", { headers: { "content-length": "2000001" } }) }), /too large/);
  await assert.rejects(checkFeed(url, "test", { fetcher: async () => mockResponse("x".repeat(2_000_001)) }), /too large/);
});

test("invalid keywords fail before network requests", async () => {
  let called = false;
  await assert.rejects(checkFeed(url, " ", { fetcher: async () => { called = true; return mockResponse(); } }), /keyword/);
  await assert.rejects(checkFeed(url, "x".repeat(201), { fetcher: async () => { called = true; return mockResponse(); } }), /keyword/);
  assert.equal(called, false);
});

test("unsafe article links are ignored", async () => {
  const xml = '<feed><entry><title>Bad</title><link href="javascript:alert(1)"/></entry><entry><title>Good</title><link href="https://example.org/ok"/></entry></feed>';
  const items = await checkFeed(url, "good", { fetcher: async () => mockResponse(xml) });
  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://example.org/ok");
});

test("Atom link attribute is parsed", async () => {
  const xml = '<feed><entry><title>Tech news</title><link href="https://example.org/tech"/><summary>Interesting</summary></entry></feed>';
  const items = await checkFeed(url, "interesting", { fetcher: async () => mockResponse(xml) });
  assert.equal(items[0].summary, "Interesting");
});
