import test from "node:test";
import assert from "node:assert/strict";
import { formatMoneyInput, normalizeMoneyInput } from "./moneyInput.js";

test("formats whole Uganda shilling amounts with thousand separators", () => {
  assert.equal(formatMoneyInput("120000"), "120,000");
  assert.equal(formatMoneyInput("380000"), "380,000");
});

test("normalizes formatted and database decimal values before saving", () => {
  assert.equal(normalizeMoneyInput("120,000"), "120000");
  assert.equal(normalizeMoneyInput("120000.00"), "120000");
  assert.equal(normalizeMoneyInput(""), "");
});
