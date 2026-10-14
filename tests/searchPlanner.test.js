import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchPlan, PLAN_LIMITS } from "../src/searchPlanner.js";

test("collectible query extracts grade, year and price", () => {
  const p = buildSearchPlan("Find 1996 Japanese Pikachu PSA 10 under $500");
  assert.equal(p.category, "collectibles");
  assert.deepEqual(p.criteria, { year: 1996, gradeCompany: "PSA", grade: 10, maxPrice: 500, currency: "USD" });
  assert.equal(p.recommendedSources.length, 3);
  assert.equal(p.schedule.intervalHours, 24);
  assert.equal(p.status, "draft");
});
test("pro plan searches hourly", () => {
  const p = buildSearchPlan("Pokémon card", "pro");
  assert.equal(p.schedule.intervalHours, 1);
  assert.equal(p.limits.maxAlerts, 25);
});
test("news sources are suggested for news searches", () => {
  assert.equal(buildSearchPlan("latest climate news").category, "news");
});
test("invalid requests and plans are rejected", () => {
  assert.throws(() => buildSearchPlan(" "));
  assert.throws(() => buildSearchPlan("Pikachu", "enterprise"));
});
test("limits stay consistent", () => {
  assert.equal(PLAN_LIMITS.free.maxSourcesPerAlert, 3);
  assert.equal(PLAN_LIMITS.pro.maxSourcesPerAlert, 10);
});
