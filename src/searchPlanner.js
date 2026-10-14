// Initial rule-based search planning. Future versions may use an LLM for richer intent extraction.
// Suggestions are candidates, not evidence of available listings or supported automated access.
export const SOURCE_CATALOG = {
  collectibles: [
    { id: "ebay", name: "eBay", url: "https://www.ebay.com", mode: "integration-required" },
    { id: "mercari-jp", name: "Mercari Japan", url: "https://jp.mercari.com", mode: "integration-required" },
    { id: "yahoo-jp", name: "Yahoo! Auctions Japan", url: "https://auctions.yahoo.co.jp", mode: "integration-required" },
    { id: "cardmarket", name: "Cardmarket", url: "https://www.cardmarket.com", mode: "integration-required" },
    { id: "tcgplayer", name: "TCGplayer", url: "https://www.tcgplayer.com", mode: "integration-required" }
  ],
  news: [
    { id: "google-news", name: "Google News", url: "https://news.google.com", mode: "rss" },
    { id: "bbc", name: "BBC News", url: "https://www.bbc.com/news", mode: "rss" },
    { id: "reuters", name: "Reuters", url: "https://www.reuters.com", mode: "integration-required" }
  ],
  general: [
    { id: "google", name: "Google Search", url: "https://www.google.com", mode: "integration-required" },
    { id: "bing", name: "Bing", url: "https://www.bing.com", mode: "integration-required" },
    { id: "google-news", name: "Google News", url: "https://news.google.com", mode: "rss" }
  ]
};
export const PLAN_LIMITS = Object.freeze({
  free: { intervalHours: 24, maxAlerts: 3, maxSourcesPerAlert: 3 },
  pro: { intervalHours: 1, maxAlerts: 25, maxSourcesPerAlert: 10 }
});
export function buildSearchPlan(description, plan = "free") {
  if (typeof description !== "string" || !description.trim()) throw new Error("Describe what to find");
  if (!PLAN_LIMITS[plan]) throw new Error("Unknown plan");
  const request = description.trim().slice(0, 1000);
  const collectibles = /pok[eé]mon|pikachu|psa\s*\d+|trading card|graded card|charizard/i.test(request);
  const news = /news|article|headline|breaking|reporting/i.test(request);
  const category = collectibles ? "collectibles" : news ? "news" : "general";
  const grade = request.match(/\b(PSA|BGS|CGC)\s*(10|[1-9])\b/i);
  const price = request.match(/(?:under|below|less than|max(?:imum)?|up to)\s*(?:\$|USD\s*|£|GBP\s*|₩|KRW\s*)?([\d,]+(?:\.\d{1,2})?)/i);
  const currency = /₩|\bKRW\b/i.test(request) ? "KRW" : /£|\bGBP\b/i.test(request) ? "GBP" : /\$|\bUSD\b/i.test(request) ? "USD" : null;
  const year = request.match(/\b(19\d{2}|20\d{2})\b/);
  const limits = PLAN_LIMITS[plan];
  return {
    request, category,
    criteria: { year: year ? Number(year[1]) : null, gradeCompany: grade?.[1]?.toUpperCase() || null, grade: grade ? Number(grade[2]) : null, maxPrice: price ? Number(price[1].replaceAll(",", "")) : null, currency },
    recommendedSources: SOURCE_CATALOG[category].slice(0, 3),
    alternativeSources: SOURCE_CATALOG[category].slice(3),
    schedule: { intervalHours: limits.intervalHours },
    limits,
    status: "draft",
    disclaimer: "Suggested sources require working integrations before automated searches can run."
  };
}
