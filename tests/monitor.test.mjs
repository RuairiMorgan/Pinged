import test from "node:test";
import assert from "node:assert/strict";
import { checkFeed } from "../server/monitor.mjs";
import { getFeedSource } from "../server/feedSources.mjs";

const rss = `<?xml version="1.0"?><rss><channel>
<item><title>Climate &amp; energy</title><link>https://example.org/story#section</link><description>New clean energy plans</description></item>
<item><title>Climate &amp; energy</title><link>https://example.org/story</link><description>duplicate</description></item>
<item><title>Other topic</title><link>javascript:alert(1)</link><description>climate</description></item>
</channel></rss>`;
const feedResponse = (body = rss, opts = {}) => new Response(body, { status: opts.status || 200, headers: { "content-type": opts.type || "application/rss+xml", ...opts.headers } });

test("only exact operator configured source IDs are accepted before network access", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return feedResponse(); };
  await assert.rejects(checkFeed("https://127.0.0.1/admin", "climate", { fetcher }), /Unknown/);
  await assert.rejects(checkFeed("__proto__", "climate", { fetcher }), /Unknown/);
  await assert.rejects(checkFeed("bbc-news", "", { fetcher }), /Keyword/);
  await assert.rejects(checkFeed("bbc-news", "x".repeat(121), { fetcher }), /Keyword/);
  assert.equal(calls, 0);
  assert.equal(getFeedSource("bbc-news").status, "configured-unverified");
});

test("fetches HTTPS allowlisted URL with redirects disabled and truthful check metadata", async () => {
  const result = await checkFeed("bbc-news", "CLIMATE", { fetcher: async (url, opts) => {
    assert.equal(url.href, "https://feeds.bbci.co.uk/news/rss.xml");
    assert.equal(opts.redirect, "error");
    assert.equal(opts.credentials, "omit");
    return feedResponse();
  }, now: () => new Date("2026-10-14T00:00:00.000Z") });
  assert.equal(result.status, "ok");
  assert.equal(result.checkedAt, "2026-10-14T00:00:00.000Z");
  assert.equal(result.totalEntries, 2);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].title, "Climate & energy");
  assert.equal(result.matches[0].link, "https://example.org/story");
});

test("previously seen IDs are suppressed", async () => {
  const fetcher = async () => feedResponse();
  const first = await checkFeed("bbc-news", "climate", { fetcher });
  const next = await checkFeed("bbc-news", "climate", { fetcher, seen: new Set(first.matches.map(x => x.id)) });
  assert.equal(next.matches.length, 0);
});

test("Atom entries and numeric entities are parsed", async () => {
  const atom = `<feed><entry><title>News &#38; science</title><link rel="alternate" href="https://example.org/atom"/><summary>Climate</summary><updated>2026-10-14</updated></entry></feed>`;
  const result = await checkFeed("bbc-news", "science", { fetcher: async () => feedResponse(atom, { type: "application/atom+xml; charset=utf-8" }) });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].title, "News & science");
});

test("rejects errors, unexpected content and declared oversize", async () => {
  await assert.rejects(checkFeed("bbc-news", "news", { fetcher: async () => feedResponse("no", { status: 500 }) }), /500/);
  await assert.rejects(checkFeed("bbc-news", "news", { fetcher: async () => feedResponse("<html/>", { type: "text/html" }) }), /content type/);
  await assert.rejects(checkFeed("bbc-news", "news", { fetcher: async () => feedResponse("x", { headers: { "content-length": "1000001" } }) }), /too large/);
});

test("rejects streamed body over the limit without treating it as an empty result", async () => {
  const huge = `<rss><item><title>news</title><link>https://example.org</link></item>${" ".repeat(1_000_001)}</rss>`;
  await assert.rejects(checkFeed("bbc-news", "news", { fetcher: async () => feedResponse(huge) }), /too large/);
});
