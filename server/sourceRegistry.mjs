// Server-owned RSS endpoints. Configured candidates, NOT verified live feeds.
// User-supplied URLs and browser draft URLs must never be passed to the fetcher.
export const RSS_SOURCES = Object.freeze({
  "bbc-news": Object.freeze({ id: "bbc-news", label: "BBC News", feedUrl: "https://feeds.bbci.co.uk/news/rss.xml", status: "configured-unverified" }),
  "bbc-technology": Object.freeze({ id: "bbc-technology", label: "BBC Technology", feedUrl: "https://feeds.bbci.co.uk/news/technology/rss.xml", status: "configured-unverified" })
});

export function resolveFeedUrl(sourceId) {
  if (typeof sourceId !== "string" || !Object.hasOwn(RSS_SOURCES, sourceId)) {
    throw new Error("Unsupported RSS source");
  }
  return RSS_SOURCES[sourceId].feedUrl;
}

export function assertAllowedFeedUrl(feedUrl) {
  // Exact comparison prevents subdomains, redirects, query injection and credentials.
  if (typeof feedUrl !== "string" || !Object.values(RSS_SOURCES).some(source => source.feedUrl === feedUrl)) {
    throw new Error("Feed URL is not allowlisted");
  }
  return new URL(feedUrl);
}
