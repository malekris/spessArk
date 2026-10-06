import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProfileMediaComment,
  normalizeProfileMediaType,
} from "./vineProfileMediaRoutes.js";

test("accepts only avatar and banner profile media types", () => {
  assert.equal(normalizeProfileMediaType(" AVATAR "), "avatar");
  assert.equal(normalizeProfileMediaType("banner"), "banner");
  assert.equal(normalizeProfileMediaType("post"), null);
});

test("trims and bounds profile media comments", () => {
  assert.equal(normalizeProfileMediaComment("  beautiful photo  "), "beautiful photo");
  assert.equal(normalizeProfileMediaComment("abcdef", 4), "abcd");
});
