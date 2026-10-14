// Pure draft helpers: no saved alert is considered actively monitored.
export const STORAGE_KEY = "pinged.alerts.v2";
export const LEGACY_STORAGE_KEY = "pinged.alerts.v1";

export function normalizeAlerts(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === "object" && typeof item.id === "string")
    .map(item => {
      if (typeof item.request === "string") {
        return { ...item, status: "draft", sources: Array.isArray(item.sources) ? item.sources.filter(source => source && typeof source === "object" && typeof source.name === "string") : [] };
      }
      // Migrate the first URL/keyword prototype without pretending its enabled flag meant monitoring.
      const url = typeof item.url === "string" ? item.url : "";
      let name = url;
      try { name = new URL(url).hostname; } catch { /* Keep the original text. */ }
      return {
        id: item.id,
        request: typeof item.keyword === "string" ? item.keyword : "Legacy alert",
        category: "general",
        criteria: {},
        sources: url ? [{ id: `legacy-${item.id}`, name, url, mode: "integration-required" }] : [],
        createdAt: null,
        updatedAt: null,
        status: "draft"
      };
    });
}

export function sourceReadiness(source) {
  return source?.mode === "rss" ? "RSS candidate · not connected" : "Integration required";
}

export function createDraft(plan, selectedIds, previous = null, now = new Date().toISOString()) {
  if (!plan || typeof plan.request !== "string" || !plan.request.trim()) {
    throw new Error("Describe what you want to follow.");
  }
  const ids = new Set(selectedIds);
  const sources = [...(plan.recommendedSources || []), ...(plan.alternativeSources || [])]
    .filter(source => ids.has(source.id));
  if (!sources.length) throw new Error("Choose at least one suggested source.");
  return {
    id: previous?.id || crypto.randomUUID(),
    request: plan.request,
    category: plan.category,
    criteria: plan.criteria,
    sources,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    status: "draft"
  };
}
