import { createHash } from "node:crypto";
import { getFeedSource } from "./feedSources.mjs";
import { safeFeedFetch } from "./safeFeedFetch.mjs";
import { validateFeedEnvelope } from "./feedEnvelope.mjs";

const MAX_BYTES = 1_000_000;
const MAX_KEYWORD_LENGTH = 120;
const ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml";
const XML_TYPE = /^(?:application\/(?:rss\+xml|atom\+xml|xml)|text\/xml)(?:\s*;|\s*$)/i;
const decode = value => (value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
    const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  })
  .replace(/&(?:amp|lt|gt|quot|apos|#39);/gi, entity => ({
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'"
  })[entity.toLowerCase()] || entity);
const tag = (xml, name) => decode(xml.match(new RegExp("<(?:[\\w-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?" + name + "\\s*>", "i"))?.[1]?.trim());
const strip = value => value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function entries(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  return blocks.slice(0, 250).map(([, , body]) => {
    const atomLink = body.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1];
    const rawLink = tag(body, "link") || decode(atomLink || "");
    let link = "";
    try {
      const parsed = new URL(rawLink);
      if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
        parsed.hash = "";
        link = parsed.href;
      }
    } catch { /* Ignore malformed and relative item URLs. */ }
    return {
      title: strip(tag(body, "title") || ""), link,
      summary: strip(tag(body, "description") || tag(body, "summary") || tag(body, "content") || ""),
      published: tag(body, "pubDate") || tag(body, "updated") || tag(body, "published") || null
    };
  }).filter(item => item.title && item.link);
}

async function readLimitedBody(response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error("Feed too large");
  if (!response.body || typeof response.body.getReader !== "function") throw new Error("Feed body unavailable");
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
  } finally {
    reader.releaseLock();
    if (total > MAX_BYTES) await response.body.cancel().catch(() => {});
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

// Only the server-side source ID is accepted. No user-provided URL is ever fetched.
// Redirects are rejected. The default transport pins DNS-validated public IPv4 addresses to the HTTPS socket.
export async function checkFeed(sourceId, keyword, { seen = new Set(), fetcher = safeFeedFetch, timeoutMs = 12000, now = () => new Date() } = {}) {
  const source = getFeedSource(sourceId);
  if (typeof keyword !== "string" || !keyword.trim() || keyword.length > MAX_KEYWORD_LENGTH) {
    throw new Error("Keyword must be 1–120 characters");
  }
  if (!(seen instanceof Set)) throw new Error("seen must be a Set");
  const url = new URL(source.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Unsafe feed configuration");
  const response = await fetcher(url, {
    method: "GET", redirect: "error", credentials: "omit",
    headers: { Accept: ACCEPT }, signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Feed request failed: ${response.status}`);
  if (!XML_TYPE.test(response.headers.get("content-type") || "")) throw new Error("Unexpected feed content type");
  const xml = await readLimitedBody(response);
  // Reject mislabeled HTML, unsupported declarations and malformed feed envelopes before parsing items.
  // This conservative check is not a substitute for a standards-compliant XML parser.
  validateFeedEnvelope(xml);
  const items = entries(xml);
  const needle = keyword.trim().toLocaleLowerCase();
  const inBatch = new Set();
  const matches = items.filter(item => (item.title + " " + item.summary).toLocaleLowerCase().includes(needle))
    .map(item => ({ ...item, id: createHash("sha256").update(`${sourceId}:${item.link}`).digest("hex"), sourceId }))
    .filter(item => {
      if (seen.has(item.id) || inBatch.has(item.id)) return false;
      inBatch.add(item.id);
      return true;
    });
  return { sourceId, checkedAt: now().toISOString(), status: "ok", totalEntries: items.length, matches };
}
