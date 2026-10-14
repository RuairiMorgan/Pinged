import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAlerts, createDraft, sourceReadiness } from "../src/alertDrafts.js";
import { buildSearchPlan } from "../src/searchPlanner.js";

test("legacy alerts migrate to honest drafts, even when enabled", () => {
  const [alert] = normalizeAlerts([{ id: "old-1", keyword: "Pikachu", url: "https://example.com/items", enabled: true }]);
  assert.equal(alert.status, "draft");
  assert.equal(alert.request, "Pikachu");
  assert.equal(alert.sources[0].name, "example.com");
});

test("invalid stored values cannot crash draft rendering", () => {
  assert.deepEqual(normalizeAlerts(null), []);
  assert.deepEqual(normalizeAlerts([null, "bad", {}, { id: "valid", request: "News", sources: "oops", status: "active" }]).map(a => [a.id, a.status, a.sources]), [["valid", "draft", []]]);
});

test("draft includes only selected sources and never claims to be active", () => {
  const plan = buildSearchPlan("latest climate news");
  const draft = createDraft(plan, ["bbc"], null, "2026-10-14T00:00:00.000Z");
  assert.equal(draft.status, "draft");
  assert.deepEqual(draft.sources.map(s => s.id), ["bbc"]);
  assert.equal(draft.createdAt, "2026-10-14T00:00:00.000Z");
  assert.throws(() => createDraft(plan, []), /Choose at least one/);
});

test("editing preserves the original id and created date", () => {
  const plan = buildSearchPlan("latest climate news");
  const previous = createDraft(plan, ["bbc"], null, "2026-10-14T00:00:00.000Z");
  const updated = createDraft(plan, ["google-news"], previous, "2026-10-15T00:00:00.000Z");
  assert.equal(updated.id, previous.id);
  assert.equal(updated.createdAt, previous.createdAt);
  assert.equal(updated.updatedAt, "2026-10-15T00:00:00.000Z");
});

test("source readiness never implies a live connection", () => {
  assert.match(sourceReadiness({ mode: "rss" }), /not connected/);
  assert.equal(sourceReadiness({ mode: "integration-required" }), "Integration required");
});
