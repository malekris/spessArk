import test from "node:test";
import assert from "node:assert/strict";

import {
  ALEVEL_ARCHIVED_STATUS,
  getAlevelPromotionTarget,
  normalizeAlevelStream,
} from "./alevelPromotionRules.js";

test("normalizes supported A-Level streams", () => {
  assert.equal(normalizeAlevelStream("s5   sciences"), "S5 Sciences");
  assert.equal(normalizeAlevelStream("S6 Arts"), "S6 Arts");
  assert.equal(normalizeAlevelStream("S4 North"), "");
});

test("moves S5 learners to the matching S6 stream", () => {
  assert.deepEqual(getAlevelPromotionTarget("S5 Arts"), {
    fromStream: "S5 Arts",
    toStream: "S6 Arts",
    promotionType: "PROMOTED",
    nextStatus: "active",
  });
});

test("graduates S6 learners into the archive without changing their historical stream", () => {
  const target = getAlevelPromotionTarget("S6 Sciences");
  assert.equal(target.toStream, "S6 Sciences");
  assert.equal(target.promotionType, "GRADUATED");
  assert.equal(target.nextStatus, ALEVEL_ARCHIVED_STATUS);
});
