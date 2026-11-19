import test from "node:test";
import assert from "node:assert/strict";
import {
  getLearnerLevelForClass,
  normalizeAccountsClass,
  normalizeAccountsTerm,
  normalizeResidenceType,
  parseMoneyAmount,
  safeCredentialEquals,
} from "./accounts.service.js";

test("normalizes Accounts selectors", () => {
  assert.equal(normalizeAccountsClass(" s5 "), "S5");
  assert.equal(normalizeAccountsTerm("Term 2"), "Term 2");
  assert.equal(normalizeAccountsTerm("Holiday"), "");
  assert.equal(normalizeResidenceType("boarding"), "Boarding");
});

test("validates money without floating-point drift", () => {
  assert.equal(parseMoneyAmount("1250000"), 1_250_000);
  assert.equal(parseMoneyAmount("1200.456"), 1200.46);
  assert.equal(parseMoneyAmount("0", { nullable: true }), 0);
  assert.equal(parseMoneyAmount("", { nullable: true }), null);
  assert.equal(parseMoneyAmount("-1"), null);
});

test("resolves learner level and compares credentials safely", () => {
  assert.equal(getLearnerLevelForClass("S4"), "O_LEVEL");
  assert.equal(getLearnerLevelForClass("S6"), "A_LEVEL");
  assert.equal(safeCredentialEquals("bursar-user", "bursar-user"), true);
  assert.equal(safeCredentialEquals("bursar", "bursar-user"), false);
});
