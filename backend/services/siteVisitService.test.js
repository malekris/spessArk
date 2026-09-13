import assert from "node:assert/strict";
import test from "node:test";
import {
  getKampalaDate,
  normalizeVisitorId,
  normalizeVisitSurface,
  readSiteVisitStats,
  recordSiteVisit,
} from "./siteVisitService.js";

test("normalizes supported surfaces and durable visitor IDs", () => {
  assert.equal(normalizeVisitSurface(" ARK "), "ark");
  assert.equal(normalizeVisitSurface("reports"), null);
  assert.equal(normalizeVisitorId("12345678-1234-1234-1234-123456789abc"), "12345678-1234-1234-1234-123456789abc");
  assert.equal(normalizeVisitorId("short"), null);
});

test("uses the Kampala calendar day", () => {
  assert.equal(getKampalaDate(new Date("2026-09-11T22:30:00.000Z")), "2026-09-12");
});

test("reads unique daily visitor and surface totals", async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("CREATE TABLE")) return [[], []];
      return [[{
        total: "21",
        today: "5",
        home_total: "18",
        home_today: "5",
        ark_total: "9",
        ark_today: "2",
        vine_total: "7",
        vine_today: "1",
      }], []];
    },
  };

  const stats = await readSiteVisitStats(pool, new Date("2026-09-12T08:00:00.000Z"));
  assert.equal(stats.total, 21);
  assert.equal(stats.today, 5);
  assert.equal(stats.surfaces.home.today, 5);
  assert.equal(stats.surfaces.ark.today, 2);
  assert.equal(queries.length, 2);
});

test("records refreshes with an idempotent daily visitor key", async () => {
  const queries = [];
  const visitorId = "12345678-1234-1234-1234-123456789abc";
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("SELECT")) {
        return [[{
          total: 1,
          today: 1,
          home_total: 0,
          home_today: 0,
          ark_total: 1,
          ark_today: 1,
          vine_total: 0,
          vine_today: 0,
        }], []];
      }
      return [[], []];
    },
  };

  const stats = await recordSiteVisit(
    pool,
    { surface: "ark", visitorId },
    new Date("2026-09-12T08:00:00.000Z")
  );
  const upsert = queries.find(({ sql }) => sql.includes("ON DUPLICATE KEY UPDATE"));
  assert.equal(upsert.params[0], "2026-09-12");
  assert.deepEqual(upsert.params.slice(2), [0, 1, 0, 0, 1, 0]);
  assert.equal(stats.today, 1);
});
