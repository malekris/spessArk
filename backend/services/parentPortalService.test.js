import test from "node:test";
import assert from "node:assert/strict";
import {
  maskParentPhone,
  normalizeLearnerLevel,
  normalizeParentAudience,
  normalizeParentPhone,
  normalizeParentStatus,
} from "./parentPortalService.js";

test("normalizes supported Ugandan parent phone formats", () => {
  assert.equal(normalizeParentPhone("0772 123 456"), "+256772123456");
  assert.equal(normalizeParentPhone("+256 772-123-456"), "+256772123456");
  assert.equal(normalizeParentPhone("256772123456"), "+256772123456");
  assert.equal(normalizeParentPhone("772123456"), "+256772123456");
});

test("rejects malformed or non-mobile parent numbers", () => {
  assert.equal(normalizeParentPhone("12345"), "");
  assert.equal(normalizeParentPhone("0414123456"), "");
  assert.equal(normalizeParentPhone(""), "");
});

test("normalizes parent portal enums safely", () => {
  assert.equal(normalizeLearnerLevel("O-Level"), "O_LEVEL");
  assert.equal(normalizeLearnerLevel("alevel"), "A_LEVEL");
  assert.equal(normalizeLearnerLevel("boarding"), "");
  assert.equal(normalizeParentAudience("A Level"), "A_LEVEL");
  assert.equal(normalizeParentAudience("unknown"), "ALL_PARENTS");
  assert.equal(normalizeParentStatus("SUSPENDED"), "suspended");
  assert.equal(normalizeParentStatus("unknown"), "pending");
  assert.equal(maskParentPhone("0772123456"), "+256772***456");
});
