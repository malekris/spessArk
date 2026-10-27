import test from "node:test";
import assert from "node:assert/strict";

import {
  getRegisteredOptionalSubjects,
  validateManualOptionalSubjectSelection,
} from "./optionalSubjectSelectionService.js";

const subjects = JSON.stringify([
  "English",
  "P.E",
  "ICT",
  "CRE",
  "Kiswahili",
]);

test("normalizes the learner's registered optional subjects", () => {
  assert.deepEqual(getRegisteredOptionalSubjects(subjects), [
    "Physical Education",
    "ICT",
    "Christian Religious Education",
    "Kiswahili",
  ]);
});

test("accepts a registered subject from the requested category", () => {
  assert.equal(
    validateManualOptionalSubjectSelection({ subjects, category: "B", value: "CRE" }),
    "Christian Religious Education"
  );
});

test("allows an empty category while the admin is still deciding", () => {
  assert.equal(
    validateManualOptionalSubjectSelection({ subjects, category: "A", value: "" }),
    null
  );
});

test("rejects a subject from the wrong category", () => {
  assert.throws(
    () => validateManualOptionalSubjectSelection({ subjects, category: "A", value: "Kiswahili" }),
    /not a Category A subject/
  );
});

test("rejects a subject the learner is not registered for", () => {
  assert.throws(
    () => validateManualOptionalSubjectSelection({ subjects, category: "A", value: "Agriculture" }),
    /not currently registered/
  );
});
