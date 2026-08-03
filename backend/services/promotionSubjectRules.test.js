import test from "node:test";
import assert from "node:assert/strict";

import {
  getS2TransitionProfile,
  normalizeStudentSubjects,
  O_LEVEL_CORE_SUBJECTS,
  validateS2SubjectSelection,
} from "./promotionSubjectRules.js";

test("normalizes stored JSON subjects and removes duplicates", () => {
  assert.deepEqual(
    normalizeStudentSubjects('["English", "ICT", "ict", " Art "]'),
    ["English", "ICT", "Art"]
  );
});

test("separates the seven core subjects from S2 optionals", () => {
  const profile = getS2TransitionProfile([
    ...O_LEVEL_CORE_SUBJECTS,
    "ICT",
    "Art",
    "Kiswahili",
  ]);

  assert.deepEqual(profile.coreSubjects, O_LEVEL_CORE_SUBJECTS);
  assert.deepEqual(profile.optionalSubjects, ["ICT", "Art", "Kiswahili"]);
});

test("builds an exact nine-subject S3 profile", () => {
  const result = validateS2SubjectSelection(
    [...O_LEVEL_CORE_SUBJECTS, "ICT", "Art", "Kiswahili"],
    ["Art", "ICT"]
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.keptSubjects, ["Art", "ICT"]);
  assert.equal(result.resultingSubjects.length, 9);
});

test("rejects missing, excessive, duplicate, or foreign selections", () => {
  const current = [...O_LEVEL_CORE_SUBJECTS, "ICT", "Art", "Kiswahili"];

  assert.equal(validateS2SubjectSelection(current, ["ICT"]).valid, false);
  assert.equal(validateS2SubjectSelection(current, ["ICT", "Art", "Kiswahili"]).valid, false);
  assert.equal(validateS2SubjectSelection(current, ["ICT", "ict"]).valid, false);
  assert.equal(validateS2SubjectSelection(current, ["ICT", "Literature"]).valid, false);
});
