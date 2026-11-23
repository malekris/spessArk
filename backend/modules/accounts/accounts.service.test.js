import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFeesUpdateTracker,
  buildPaymentTransaction,
  getLearnerLevelForClass,
  isValidAccountsEmail,
  isValidAccountsPassword,
  normalizeAccountsClass,
  normalizeAccountsEmail,
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

test("normalizes and validates bursar credentials", () => {
  assert.equal(normalizeAccountsEmail(" Bursar@School.UG "), "bursar@school.ug");
  assert.equal(isValidAccountsEmail("bursar@school.ug"), true);
  assert.equal(isValidAccountsEmail("bursar"), false);
  assert.equal(isValidAccountsPassword("twelve-chars"), true);
  assert.equal(isValidAccountsPassword("short"), false);
});

test("validates money without floating-point drift", () => {
  assert.equal(parseMoneyAmount("1250000"), 1_250_000);
  assert.equal(parseMoneyAmount("1200.456"), 1200.46);
  assert.equal(parseMoneyAmount("0", { nullable: true }), 0);
  assert.equal(parseMoneyAmount("", { nullable: true }), null);
  assert.equal(parseMoneyAmount("-1"), null);
});

test("describes payment changes for the transaction ledger", () => {
  assert.deepEqual(buildPaymentTransaction(null, 50_000), {
    type: "payment_added",
    amountChange: 50_000,
  });
  assert.deepEqual(buildPaymentTransaction(50_000, 80_000), {
    type: "payment_added",
    amountChange: 30_000,
  });
  assert.deepEqual(buildPaymentTransaction(80_000, 50_000), {
    type: "payment_corrected",
    amountChange: -30_000,
  });
  assert.deepEqual(buildPaymentTransaction(null, 0), {
    type: "not_paid",
    amountChange: 0,
  });
  assert.deepEqual(buildPaymentTransaction(50_000, null), {
    type: "payment_cleared",
    amountChange: -50_000,
  });
  assert.equal(buildPaymentTransaction(50_000, 50_000), null);
});

test("groups fee updates by class and keeps Not Paid learners updated", () => {
  const tracker = buildFeesUpdateTracker([
    { learner_level: "O_LEVEL", learner_id: 1, learner_name: "A", class_level: "S1", stream: "North", is_updated: 1, amount_paid: 0 },
    { learner_level: "O_LEVEL", learner_id: 2, learner_name: "B", class_level: "S1", stream: "North", is_updated: 0, amount_paid: null },
    { learner_level: "A_LEVEL", learner_id: 3, learner_name: "C", class_level: "S5", stream: "Arts", is_updated: 0, amount_paid: null },
  ]);

  assert.deepEqual(tracker.summary, {
    total_classes: 2,
    complete_classes: 0,
    in_progress_classes: 1,
    untouched_classes: 1,
    total_learners: 3,
    updated_learners: 1,
    untouched_learners: 2,
    completion_percent: 33,
  });
  assert.equal(tracker.classes[0].status, "in_progress");
  assert.equal(tracker.classes[0].streams[0].learners[0].updated, true);
  assert.equal(tracker.classes[1].status, "untouched");
});

test("resolves learner level and compares credentials safely", () => {
  assert.equal(getLearnerLevelForClass("S4"), "O_LEVEL");
  assert.equal(getLearnerLevelForClass("S6"), "A_LEVEL");
  assert.equal(safeCredentialEquals("bursar-user", "bursar-user"), true);
  assert.equal(safeCredentialEquals("bursar", "bursar-user"), false);
});
