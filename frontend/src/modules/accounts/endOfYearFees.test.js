import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEndOfYearFeeCells,
  buildFeeContributionTitle,
  formatAccountsSection,
  getEndOfYearFeeSummary,
} from "./endOfYearFees.js";

test("formats report sections as Day or Hostel", () => {
  assert.equal(formatAccountsSection("DAY"), "Day");
  assert.equal(formatAccountsSection("Boarding"), "Hostel");
});

test("allocates Day payments to Lunch before other fee bands", () => {
  const summary = getEndOfYearFeeSummary({ residenceType: "Day", amountPaid: 30_000 });

  assert.equal(summary.residence, "DAY");
  assert.equal(summary.lunchPaid, 30_000);
  assert.equal(summary.developmentPaid, 0);
  assert.equal(summary.churchPaid, 0);
  assert.equal(summary.balance, 100_000);
  assert.deepEqual(buildEndOfYearFeeCells(summary), [
    "Lunch Fee: 30,000/=",
    "Development Fee: Not Paid",
    "Church Fee: Not Paid",
    "Balance: 100,000/=",
  ]);
});

test("fills all Day fee bands in order", () => {
  const summary = getEndOfYearFeeSummary({ residenceType: "day", amountPaid: 120_000 });

  assert.equal(summary.lunchPaid, 70_000);
  assert.equal(summary.developmentPaid, 40_000);
  assert.equal(summary.churchPaid, 10_000);
  assert.equal(summary.balance, 10_000);
  assert.deepEqual(buildEndOfYearFeeCells(summary), [
    "Lunch Fee: 70,000/=",
    "Development Fee: 40,000/=",
    "Church Fee: 10,000/=",
    "Balance: 10,000/=",
  ]);
});

test("builds the contribution heading with only the reporting period", () => {
  assert.equal(
    buildFeeContributionTitle({ term: "3", year: 2026 }),
    "FEES CONTRIBUTIONS (Term 3 2026)"
  );
});

test("shows Nil when a learner has cleared the full fee balance", () => {
  const daySummary = getEndOfYearFeeSummary({
    residenceType: "Day",
    amountPaid: 130_000,
  });
  const boardingSummary = getEndOfYearFeeSummary({
    residenceType: "Boarding",
    amountPaid: 380_000,
  });

  assert.equal(buildEndOfYearFeeCells(daySummary)[3], "Balance: Nil");
  assert.equal(buildEndOfYearFeeCells(boardingSummary)[3], "Balance: Nil");
});

test("carries an explicit zero payment to the report as Not Paid", () => {
  const summary = getEndOfYearFeeSummary({ residenceType: "Day", amountPaid: 0 });

  assert.equal(summary.paymentRecorded, true);
  assert.equal(summary.paid, 0);
  assert.deepEqual(buildEndOfYearFeeCells(summary), [
    "Lunch Fee: Not Paid",
    "Development Fee: Not Paid",
    "Church Fee: Not Paid",
    "Balance: 130,000/=",
  ]);
});

test("keeps Boarding as one fee without Day bands", () => {
  const summary = getEndOfYearFeeSummary({ residenceType: "Boarding", amountPaid: 80_000 });

  assert.equal(summary.residence, "BOARDING");
  assert.equal(summary.termFee, 380_000);
  assert.equal(summary.balance, 300_000);
  assert.deepEqual(buildEndOfYearFeeCells(summary), [
    "Section: Hostel",
    "Term Fee: 380,000/=",
    "Paid: 80,000/=",
    "Balance: 300,000/=",
  ]);
});
