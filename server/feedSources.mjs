// Operator-maintained, exact HTTPS feed allowlist. A configured feed is NOT a verified live connection.
// Do not accept feed URLs, hosts, or redirects from browser drafts or untrusted API input.
export const FEED_SOURCES = Object.freeze({
  "bbc-news": Object.freeze({
    id: "bbc-news",
    name: "BBC News",
    url: "https://feeds.bbci.co.uk/news/rss.xml",
    status: "configured-unverified"
  })
});

export function getFeedSource(sourceId) {
  if (typeof sourceId !== "string" || !Object.hasOwn(FEED_SOURCES, sourceId)) {
    throw new Error("Unknown or unsupported feed source");
  }
  return FEED_SOURCES[sourceId];
}
