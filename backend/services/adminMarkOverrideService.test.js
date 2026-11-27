import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAdminMarkOverride } from "./adminMarkOverrideService.js";

test("normalizes a present AOI override", () => {
  assert.deepEqual(
    normalizeAdminMarkOverride({ component: "aoi2", status: "Present", score: "2.4" }),
    { component: "AOI2", score: 2.4, status: "Present" }
  );
});

test("allows the full /80 score range", () => {
  assert.equal(
    normalizeAdminMarkOverride({ component: "EXAM80", status: "Present", score: 0 }).score,
    0
  );
  assert.equal(
    normalizeAdminMarkOverride({ component: "EXAM80", status: "Present", score: 80 }).score,
    80
  );
});

test("stores missed overrides without a score", () => {
  assert.deepEqual(
    normalizeAdminMarkOverride({ component: "AOI1", status: "Missed", score: 2.5 }),
    { component: "AOI1", score: null, status: "Missed" }
  );
});

test("rejects values outside each assessment range", () => {
  assert.throws(
    () => normalizeAdminMarkOverride({ component: "AOI3", status: "Present", score: 0.8 }),
    /between 0.9 and 3.0/
  );
  assert.throws(
    () => normalizeAdminMarkOverride({ component: "EXAM80", status: "Present", score: 81 }),
    /between 0 and 80/
  );
});
