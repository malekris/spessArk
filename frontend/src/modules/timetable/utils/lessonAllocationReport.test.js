import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLessonAllocationRows,
  buildLessonAllocationSummary,
} from "./lessonAllocationReport.js";

test("groups draft sessions by class, stream, subject and teacher", () => {
  const rows = buildLessonAllocationRows({
    sessions: [
      {
        teacherId: 7,
        teacherName: "Sarah Namusoke",
        classLevel: "S2",
        streamsLabel: "North",
        subjectLabel: "English",
        day: "Thursday",
        slotCode: "P4",
      },
      {
        teacherId: 7,
        teacherName: "Sarah Namusoke",
        classLevel: "S2",
        streamsLabel: "North",
        subjectLabel: "English",
        day: "Monday",
        slotCode: "P1",
      },
      {
        teacherId: 7,
        teacherName: "Sarah Namusoke",
        classLevel: "S2",
        streamsLabel: "North",
        subjectLabel: "English",
        day: "Monday",
        slotCode: "P1",
      },
      {
        teacherId: 12,
        teacherName: "Peter Mugisha",
        classLevel: "S2",
        streamsLabel: "South",
        subjectLabel: "English",
        day: "Tuesday",
        slotCode: "P2",
      },
    ],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    key: "s2::north::english::7",
    classLevel: "S2",
    streamsLabel: "North",
    subject: "English",
    teacherId: 7,
    teacherName: "Sarah Namusoke",
    slots: [
      { day: "Monday", slotCode: "P1" },
      { day: "Thursday", slotCode: "P4" },
    ],
    lessonCount: 2,
    scheduledPeriods: "Mon P1, Thu P4",
  });
  assert.equal(rows[1].lessonCount, 1);
});

test("summarizes combined allocations without double-counting teachers or subjects", () => {
  const rows = buildLessonAllocationRows({
    sessions: [
      {
        teacherId: 4,
        teacherName: "Grace Atim",
        classLevel: "S5",
        streamsLabel: "Arts & Sciences",
        subjectLabel: "General Paper",
        day: "Monday",
        slotCode: "P3",
      },
      {
        teacherId: 4,
        teacherName: "Grace Atim",
        classLevel: "S5",
        streamsLabel: "Arts & Sciences",
        subjectLabel: "General Paper",
        day: "Wednesday",
        slotCode: "P5",
      },
    ],
  });

  assert.deepEqual(buildLessonAllocationSummary(rows), {
    classGroups: 1,
    subjects: 1,
    teachers: 1,
    scheduledLessons: 2,
  });
});
