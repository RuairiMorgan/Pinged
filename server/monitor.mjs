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
export async function checkFeed(feedUrl, keyword, { seen = new Set(), fetcher = fetch } = {}) {
  const url = new URL(feedUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Unsupported protocol");
  if (!keyword?.trim()) throw new Error("Keyword required");
  // IMPORTANT: Call only with feeds from a trusted allowlist. Arbitrary URLs require SSRF protections.
  const response = await fetcher(url, { headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("Feed request failed: " + response.status);
  const xml = await response.text();
  if (Buffer.byteLength(xml) > MAX_BYTES) throw new Error("Feed too large");
  const needle = keyword.toLocaleLowerCase();
  return entries(xml).filter(x => (x.title + " " + x.summary).toLocaleLowerCase().includes(needle)).map(x => ({ ...x, id: createHash("sha256").update(x.link).digest("hex"), keyword })).filter(x => !seen.has(x.id));
}
