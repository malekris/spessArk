import test from "node:test";
import assert from "node:assert/strict";
import {
  getCombinedOptionalSubjectKey,
  validateCombinedOLevelOptionalAssignments,
} from "./combinedOLevelOptionalAssignments.js";

const assignment = (overrides = {}) => ({
  id: 1,
  teacher_id: 7,
  class_level: "S3",
  stream: "North",
  subject: "Christian Religious Education",
  ...overrides,
});

test("recognizes optional aliases but excludes compulsory subjects", () => {
  assert.equal(getCombinedOptionalSubjectKey("CRE"), "christianreligiouseducation");
  assert.equal(getCombinedOptionalSubjectKey("Entrepreneurship"), "entrepreneurship");
  assert.equal(getCombinedOptionalSubjectKey("Mathematics"), null);
});

test("combines two S3 streams owned by one optional-subject teacher", () => {
  const result = validateCombinedOLevelOptionalAssignments([
    assignment(),
    assignment({ id: 2, stream: "South" }),
  ]);

  assert.equal(result.valid, true);
  assert.equal(result.classLevel, "S3");
  assert.equal(result.assignmentByStream.get("North"), 1);
  assert.equal(result.assignmentByStream.get("South"), 2);
});

test("rejects S1 and S2 even when the teacher and subject match", () => {
  for (const classLevel of ["S1", "S2"]) {
    const result = validateCombinedOLevelOptionalAssignments([
      assignment({ class_level: classLevel }),
      assignment({ id: 2, class_level: classLevel, stream: "South" }),
    ]);
    assert.equal(result.valid, false);
  }
});

test("rejects compulsory, cross-class and cross-teacher pairs", () => {
  const compulsory = validateCombinedOLevelOptionalAssignments([
    assignment({ subject: "English" }),
    assignment({ id: 2, stream: "South", subject: "English" }),
  ]);
  const crossClass = validateCombinedOLevelOptionalAssignments([
    assignment(),
    assignment({ id: 2, class_level: "S4", stream: "South" }),
  ]);
  const crossTeacher = validateCombinedOLevelOptionalAssignments([
    assignment(),
    assignment({ id: 2, teacher_id: 8, stream: "South" }),
  ]);

  assert.equal(compulsory.valid, false);
  assert.equal(crossClass.valid, false);
  assert.equal(crossTeacher.valid, false);
});
