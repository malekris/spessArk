import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLessonAllocationAnomalies,
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

test("turns raw unallocated reasons into explicit causes and corrective actions", () => {
  const anomalies = buildLessonAllocationAnomalies({
    validation: {
      unallocated: [
        {
          assignmentId: 31,
          teacherId: 9,
          teacherName: "John Kato",
          classLevel: "S3",
          stream: "North & South",
          subject: "VOCATIONAL Cluster",
          reason: "The S3 VOCATIONAL teachers have no shared available day.",
        },
      ],
    },
  });

  assert.equal(anomalies.length, 1);
  assert.match(anomalies[0].cause, /no weekday in common/i);
  assert.match(anomalies[0].solution, /common available day/i);
  assert.equal(anomalies[0].reason, "The S3 VOCATIONAL teachers have no shared available day.");
});
