import test from "node:test";
import assert from "node:assert/strict";
import { matchesLearnerSearch, normalizeLearnerSearchText } from "./learnerSearch.js";

test("finds learners from any part of their full name", () => {
  assert.equal(matchesLearnerSearch("Sara Tancredi", "sa"), true);
  assert.equal(matchesLearnerSearch("Sara Tancredi", "ta"), true);
  assert.equal(matchesLearnerSearch("Sara Tancredi", "credi"), true);
});

test("tolerates register punctuation, spacing and close surname variants", () => {
  assert.equal(normalizeLearnerSearchText("  Sara   Tancredi "), "sara tancredi");
  assert.equal(matchesLearnerSearch("Sara-Trancredi", "ta"), true);
  assert.equal(matchesLearnerSearch("José Álvarez", "jose alv"), true);
});

test("does not return unrelated learners", () => {
  assert.equal(matchesLearnerSearch("John Abruzzi", "ta"), false);
  assert.equal(matchesLearnerSearch("Martha Jones", "ta"), false);
});
