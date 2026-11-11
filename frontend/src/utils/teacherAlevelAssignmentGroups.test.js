import test from "node:test";
import assert from "node:assert/strict";
import {
  groupSubIctTeacherAssignments,
  isSubIctTeacherAssignment,
} from "./teacherAlevelAssignmentGroups.js";

const assignment = (overrides = {}) => ({
  id: 1,
  subject: "Sub ICT",
  subject_display: "Sub ICT — Paper 1",
  paper_label: "Paper 1",
  stream: "S5 Arts",
  ...overrides,
});

test("recognizes Sub ICT without changing other ICT subjects", () => {
  assert.equal(isSubIctTeacherAssignment(assignment()), true);
  assert.equal(isSubIctTeacherAssignment(assignment({ subject: "ICT" })), false);
});

test("groups one Arts and Sciences pair from the same class and paper", () => {
  const grouped = groupSubIctTeacherAssignments([
    assignment(),
    assignment({ id: 2, stream: "S5 Sciences" }),
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].isCombinedSubIct, true);
  assert.deepEqual(grouped[0].assignmentIds, [1, 2]);
  assert.equal(grouped[0].class_level, "S5");
  assert.equal(grouped[0].stream, "Arts + Sciences");
});

test("reduces four stream assignments to two combined Sub ICT papers", () => {
  const grouped = groupSubIctTeacherAssignments([
    assignment(),
    assignment({ id: 2, stream: "S5 Sciences" }),
    assignment({ id: 3, paper_label: "Paper 2", subject_display: "Sub ICT — Paper 2" }),
    assignment({
      id: 4,
      stream: "S5 Sciences",
      paper_label: "Paper 2",
      subject_display: "Sub ICT — Paper 2",
    }),
  ]);

  assert.equal(grouped.length, 2);
  assert.deepEqual(
    grouped.map((row) => row.assignmentIds),
    [
      [1, 2],
      [3, 4],
    ]
  );
});

test("keeps different classes, papers and ordinary subjects separate", () => {
  const grouped = groupSubIctTeacherAssignments([
    assignment(),
    assignment({ id: 2, stream: "S6 Sciences" }),
    assignment({ id: 3, stream: "S5 Sciences", paper_label: "Paper 2" }),
    assignment({ id: 4, subject: "Mathematics", stream: "S5 Sciences" }),
  ]);

  assert.equal(grouped.length, 4);
  assert.equal(grouped.some((row) => row.isCombinedSubIct), false);
});
