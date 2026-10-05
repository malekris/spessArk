import assert from "node:assert/strict";
import test from "node:test";

import {
  averageAlevelScores,
  gradePrincipalAverage,
  gradeSubsidiaryAverage,
} from "./alevelGrading.js";

test("principal grade boundaries follow the revised UNEB bands", () => {
  assert.deepEqual(
    [79.5, 69.5, 59.5, 49.5, 0].map((score) => gradePrincipalAverage(score)?.grade),
    ["A", "B", "C", "D", "E"]
  );
  assert.deepEqual(
    [79.4, 69.4, 59.4, 49.4].map((score) => gradePrincipalAverage(score)?.grade),
    ["B", "C", "D", "E"]
  );
  assert.deepEqual(
    [85, 75, 65, 55, 45].map((score) => gradePrincipalAverage(score)?.points),
    [5, 4, 3, 2, 1]
  );
});

test("every completed principal subject earns at least E and one point", () => {
  assert.deepEqual(gradePrincipalAverage(0), {
    grade: "E",
    indicator: "Elementary",
    minimum: 0,
    maximum: 49.4,
    points: 1,
    average: 0,
  });
});

test("principal grading uses the average of Paper 1 and Paper 2", () => {
  const subjectAverage = averageAlevelScores([30, 60]);
  assert.equal(subjectAverage, 45);
  assert.equal(gradePrincipalAverage(subjectAverage)?.grade, "E");
  assert.equal(gradePrincipalAverage(subjectAverage)?.points, 1);
});

test("a missing or missed paper cannot produce a subject average", () => {
  assert.equal(averageAlevelScores([80, null]), null);
  assert.equal(averageAlevelScores([80, ""]), null);
  assert.equal(gradePrincipalAverage(null), null);
  assert.equal(gradeSubsidiaryAverage(null), null);
});

test("subsidiary subjects use P and F at the 50 percent boundary", () => {
  assert.deepEqual(
    [gradeSubsidiaryAverage(50)?.grade, gradeSubsidiaryAverage(49.9)?.grade],
    ["P", "F"]
  );
  assert.deepEqual(
    [gradeSubsidiaryAverage(50)?.points, gradeSubsidiaryAverage(49.9)?.points],
    [1, 0]
  );
});
