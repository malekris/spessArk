import test from "node:test";
import assert from "node:assert/strict";
import { applyManualCredits } from "./timetable.manual.js";

const cleanValidation = (overrides = {}) => ({
  valid: false,
  teacherClashes: [],
  streamClashes: [],
  invalidDays: [],
  duplicatePeriods: [],
  hardViolations: [],
  missingLessons: [],
  unallocated: [],
  ...overrides,
});

test("manual subject credit does not cross O-Level and A-Level assignment id scopes", () => {
  const validation = cleanValidation({
    missingLessons: [
      { assignmentId: 7, label: "Mathematics - S1 North", placed: 1, missing: 1 },
      { assignmentId: 7, label: "Chemistry - S5 Sciences", placed: 1, missing: 1 },
    ],
    unallocated: [
      { assignmentId: 7, subject: "Mathematics", classLevel: "S1", stream: "North" },
      { assignmentId: 7, subject: "Chemistry", classLevel: "S5", stream: "Sciences" },
    ],
  });
  const result = applyManualCredits(validation, {
    lessonsPlaced: 20,
    timetableCells: 40,
    teacherSessions: 30,
  }, {
    mode: "subject",
    label: "Chemistry",
    classLevel: "S5",
    streams: ["Sciences"],
    events: [{}],
    sessions: [{}],
    credits: [{ assignmentId: 7, classLevel: "S5", stream: "Sciences", subjectLabel: "Chemistry" }],
  });

  assert.equal(result.creditedLessons, 1);
  assert.deepEqual(result.validation.missingLessons.map((item) => item.label), ["Mathematics - S1 North"]);
  assert.deepEqual(result.validation.unallocated.map((item) => item.subject), ["Mathematics"]);
  assert.equal(result.stats.lessonsPlaced, 21);
  assert.equal(result.stats.unallocatedLessons, 1);
  assert.equal(result.validation.valid, false);
});

test("manual cluster credit clears every participating missing assignment", () => {
  const validation = cleanValidation({
    missingLessons: [
      { assignmentId: 101, label: "CRE - S1 North", placed: 1, missing: 1 },
      { assignmentId: 102, label: "IRE - S1 South", placed: 1, missing: 1 },
    ],
    unallocated: [
      { assignmentId: null, subject: "OTHERS Cluster", classLevel: "S1", stream: "North & South" },
    ],
  });
  const result = applyManualCredits(validation, {
    lessonsPlaced: 18,
    timetableCells: 35,
    teacherSessions: 24,
  }, {
    mode: "cluster",
    clusterCode: "OTHERS",
    label: "CRE / IRE",
    classLevel: "S1",
    streams: ["North", "South"],
    events: [{}, {}],
    sessions: [{}, {}],
    credits: [
      { assignmentId: 101, classLevel: "S1", stream: "North", subjectLabel: "CRE" },
      { assignmentId: 102, classLevel: "S1", stream: "South", subjectLabel: "IRE" },
    ],
  });

  assert.equal(result.creditedLessons, 2);
  assert.equal(result.validation.missingLessons.length, 0);
  assert.equal(result.validation.unallocated.length, 0);
  assert.equal(result.validation.valid, true);
  assert.equal(result.stats.lessonsPlaced, 20);
  assert.equal(result.stats.unallocatedLessons, 0);
  assert.equal(result.stats.status, "complete");
});

test("manual extra lesson is recorded without exceeding generated lesson completion", () => {
  const validation = cleanValidation({ valid: true });
  const result = applyManualCredits(validation, {
    lessonsPlaced: 20,
    lessonsRequested: 20,
    timetableCells: 40,
    teacherSessions: 30,
  }, {
    mode: "subject",
    label: "English",
    classLevel: "S2",
    streams: ["North"],
    events: [{}],
    sessions: [{}],
    credits: [{ assignmentId: 55, classLevel: "S2", stream: "North", subjectLabel: "English" }],
  });

  assert.equal(result.creditedLessons, 0);
  assert.equal(result.stats.lessonsPlaced, 20);
  assert.equal(result.stats.manualExtras, 1);
  assert.equal(result.validation.valid, true);
});
