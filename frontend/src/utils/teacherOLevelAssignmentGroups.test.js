import test from "node:test";
import assert from "node:assert/strict";
import {
  groupOLevelOptionalTeacherAssignments,
  isS3S4OptionalTeacherAssignment,
} from "./teacherOLevelAssignmentGroups.js";

const assignment = (overrides = {}) => ({
  id: 1,
  class_level: "S3",
  stream: "North",
  subject: "Agriculture",
  ...overrides,
});

test("groups an S3 optional subject across two streams", () => {
  const grouped = groupOLevelOptionalTeacherAssignments([
    assignment(),
    assignment({ id: 2, stream: "South" }),
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].isCombinedOLevelOptional, true);
  assert.deepEqual(grouped[0].assignmentIds, [1, 2]);
  assert.equal(grouped[0].stream, "North + South");
});

test("supports S4 optional subjects and aliases", () => {
  assert.equal(
    isS3S4OptionalTeacherAssignment(assignment({ class_level: "S4", subject: "CRE" })),
    true
  );
});

test("leaves S1, S2 and compulsory subjects unchanged", () => {
  const rows = [
    assignment({ class_level: "S1" }),
    assignment({ id: 2, class_level: "S1", stream: "South" }),
    assignment({ id: 3, class_level: "S3", subject: "English" }),
    assignment({ id: 4, class_level: "S3", stream: "South", subject: "English" }),
  ];
  const grouped = groupOLevelOptionalTeacherAssignments(rows);

  assert.equal(grouped.length, 4);
  assert.equal(grouped.some((row) => row.isCombinedOLevelOptional), false);
});

test("does not combine incomplete or duplicate-stream pairs", () => {
  const grouped = groupOLevelOptionalTeacherAssignments([
    assignment(),
    assignment({ id: 2, stream: "North" }),
  ]);

  assert.equal(grouped.length, 2);
});
