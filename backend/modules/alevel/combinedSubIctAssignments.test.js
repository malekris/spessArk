import test from "node:test";
import assert from "node:assert/strict";
import {
  isSubIctSubject,
  parseAlevelStream,
  validateCombinedSubIctAssignments,
} from "./combinedSubIctAssignments.js";

const assignment = (overrides = {}) => ({
  id: 1,
  teacher_id: 9,
  subject_id: 4,
  subject_name: "Sub ICT",
  paper_label: "Paper 1",
  stream: "S5 Arts",
  ...overrides,
});

test("recognizes only the Sub ICT subject", () => {
  assert.equal(isSubIctSubject("Sub ICT"), true);
  assert.equal(isSubIctSubject("SUB-ICT"), true);
  assert.equal(isSubIctSubject("ICT"), false);
});

test("parses supported A-Level stream names", () => {
  assert.deepEqual(parseAlevelStream("S5 Arts"), {
    classLevel: "S5",
    streamGroup: "Arts",
  });
  assert.equal(parseAlevelStream("S5 North"), null);
});

test("combines Arts and Sciences for the same Sub ICT paper", () => {
  const result = validateCombinedSubIctAssignments([
    assignment(),
    assignment({ id: 2, stream: "S5 Sciences" }),
  ]);

  assert.equal(result.valid, true);
  assert.equal(result.classLevel, "S5");
  assert.equal(result.assignmentByStream.get("S5 Arts"), 1);
  assert.equal(result.assignmentByStream.get("S5 Sciences"), 2);
});

test("rejects cross-class or cross-teacher combinations", () => {
  const crossClass = validateCombinedSubIctAssignments([
    assignment(),
    assignment({ id: 2, stream: "S6 Sciences" }),
  ]);
  const crossTeacher = validateCombinedSubIctAssignments([
    assignment(),
    assignment({ id: 2, teacher_id: 10, stream: "S5 Sciences" }),
  ]);

  assert.equal(crossClass.valid, false);
  assert.equal(crossTeacher.valid, false);
});
