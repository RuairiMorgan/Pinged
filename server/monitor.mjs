import { assertAllowedFeedUrl, resolveFeedUrl } from "./sourceRegistry.mjs";
import { createHash } from "node:crypto";

const MAX_BYTES = 2_000_000;
const decode = s => (s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const tag = (xml, name) => decode(xml.match(new RegExp("<(?:[\\w-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?" + name + "\\s*>", "i"))?.[1]?.trim());
const strip = s => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
function entries(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  return blocks.map(([, , body]) => {
    const link = tag(body, "link") || body.match(/<link\b[^>]*href=["']([^"']+)/i)?.[1] || "";
    return { title: strip(tag(body, "title") || ""), link, summary: strip(tag(body, "description") || tag(body, "summary") || tag(body, "content") || ""), published: tag(body, "pubDate") || tag(body, "updated") || tag(body, "published") || null };
  }).filter(x => x.title && x.link);
}

function safeArticleLink(raw) {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

async function readLimited(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error("Feed too large");
  if (!response.body?.getReader) throw new Error("Streaming response body required");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error("Feed too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
}

export async function checkFeed(feedUrl, keyword, { seen = new Set(), fetcher = fetch } = {}) {
  const url = assertAllowedFeedUrl(feedUrl);
  if (typeof keyword !== "string" || !keyword.trim() || keyword.length > 200) {
    throw new Error("Valid keyword required (1–200 characters)");
  }
  // No redirects: a trusted endpoint must not bounce requests to private networks.
  const response = await fetcher(url, {
    redirect: "manual",
    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(12000)
  });
  if (response.status >= 300 && response.status < 400) throw new Error("Feed redirects are blocked");
  if (!response.ok) throw new Error("Feed request failed: " + response.status);
  const type = (response.headers?.get?.("content-type") || "").toLowerCase();
  if (type && !/^(application\/(rss\+xml|atom\+xml|xml)|text\/xml)(?:\s*;|\s*$)/.test(type)) {
    throw new Error("Unexpected feed content type");
  }
  const xml = await readLimited(response);
  const needle = keyword.trim().toLocaleLowerCase();
  return entries(xml)
    .map(item => ({ ...item, link: safeArticleLink(item.link) }))
    .filter(item => item.link && (item.title + " " + item.summary).toLocaleLowerCase().includes(needle))
    .map(item => ({ ...item, id: createHash("sha256").update(item.link).digest("hex"), keyword: keyword.trim() }))
    .filter(item => !seen.has(item.id));
}

export function checkConfiguredSource(sourceId, keyword, options) {
  return checkFeed(resolveFeedUrl(sourceId), keyword, options);
}
