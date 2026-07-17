import test from "node:test";
import assert from "node:assert/strict";
import { applyManualCredits, applyManualRemoval } from "./timetable.manual.js";

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

test("manual removal creates an exact required-lesson shortage", () => {
  const result = applyManualRemoval(cleanValidation({ valid: true }), {
    lessonsPlaced: 20,
    lessonsRequested: 20,
    timetableCells: 40,
    teacherSessions: 30,
  }, {
    eventsRemoved: 1,
    sessionsRemoved: 1,
    impacts: [{
      assignmentId: 55,
      teacherId: 8,
      teacherName: "Nabirye",
      subjectLabel: "Physics",
      classLevel: "S2",
      stream: "North",
      requiredLessons: 2,
      scheduledBefore: 2,
      scheduledAfter: 1,
    }],
  });

  assert.equal(result.removedRequiredLessons, 1);
  assert.equal(result.stats.lessonsPlaced, 19);
  assert.equal(result.stats.timetableCells, 39);
  assert.equal(result.validation.valid, false);
  assert.deepEqual(result.validation.missingLessons[0], {
    assignmentId: 55,
    label: "Physics - S2 North",
    required: 2,
    placed: 1,
    missing: 1,
  });
  assert.match(result.validation.unallocated[0].reason, /1 of 2 required weekly lessons remain/);
});

test("removing an extra lesson does not create a shortage", () => {
  const result = applyManualRemoval(cleanValidation({ valid: true }), {
    lessonsPlaced: 20,
    lessonsRequested: 20,
    timetableCells: 41,
    teacherSessions: 31,
    manualExtras: 1,
  }, {
    eventsRemoved: 1,
    sessionsRemoved: 1,
    impacts: [{
      assignmentId: 55,
      subjectLabel: "English",
      classLevel: "S2",
      stream: "South",
      requiredLessons: 2,
      scheduledBefore: 3,
      scheduledAfter: 2,
    }],
  });

  assert.equal(result.removedRequiredLessons, 0);
  assert.equal(result.removedExtraLessons, 1);
  assert.equal(result.stats.lessonsPlaced, 20);
  assert.equal(result.stats.manualExtras, 0);
  assert.equal(result.validation.missingLessons.length, 0);
  assert.equal(result.validation.unallocated.length, 0);
  assert.equal(result.validation.valid, true);
});

test("removing a cluster records shortages for every participating stream", () => {
  const result = applyManualRemoval(cleanValidation({ valid: true }), {
    lessonsPlaced: 40,
    lessonsRequested: 40,
    timetableCells: 70,
    teacherSessions: 52,
  }, {
    eventsRemoved: 2,
    sessionsRemoved: 2,
    impacts: [
      {
        assignmentId: 101,
        subjectLabel: "Agriculture",
        classLevel: "S3",
        stream: "North",
        requiredLessons: 2,
        scheduledBefore: 2,
        scheduledAfter: 1,
      },
      {
        assignmentId: 102,
        subjectLabel: "Agriculture",
        classLevel: "S3",
        stream: "South",
        requiredLessons: 2,
        scheduledBefore: 2,
        scheduledAfter: 1,
      },
    ],
  });

  assert.equal(result.removedRequiredLessons, 2);
  assert.equal(result.stats.lessonsPlaced, 38);
  assert.equal(result.stats.timetableCells, 68);
  assert.equal(result.validation.missingLessons.length, 2);
  assert.deepEqual(
    result.validation.missingLessons.map((item) => item.label),
    ["Agriculture - S3 North", "Agriculture - S3 South"]
  );
  assert.equal(result.validation.valid, false);
});
