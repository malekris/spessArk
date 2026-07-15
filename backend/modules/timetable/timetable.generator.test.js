import test from "node:test";
import assert from "node:assert/strict";
import { defaultRequirementForAssignment } from "./timetable.constants.js";
import { generateALevelTimetable } from "./timetable.alevel.generator.js";
import { generateOLevelTimetable } from "./timetable.generator.js";
import { regenerateOLevelStreamLessons } from "./timetable.regenerator.js";
import { generateSchoolTimetable } from "./timetable.school.generator.js";

const CORE_SUBJECTS = [
  "English",
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "Geography",
  "History",
];

function buildFeasibleFixture() {
  const rows = [];
  const dayPatterns = [
    ["Monday", "Tuesday", "Wednesday"],
    ["Tuesday", "Thursday", "Friday"],
    ["Monday", "Thursday", "Friday"],
  ];
  let id = 1;
  const add = (classLevel, stream, subject, lessonKind, lessonsPerWeek, clusterCode, days) => {
    const assignmentId = id;
    id += 1;
    rows.push({
      assignment_id: assignmentId,
      teacher_id: assignmentId,
      teacher_name: `Teacher ${assignmentId}`,
      class_level: classLevel,
      stream,
      subject,
      lessons_per_week: lessonsPerWeek,
      lesson_kind: lessonKind,
      cluster_code: clusterCode,
      enabled: 1,
      available_days: days,
    });
  };

  for (const classLevel of ["S1", "S2", "S3", "S4"]) {
    for (const stream of ["North", "South"]) {
      CORE_SUBJECTS.forEach((subject, index) => {
        add(classLevel, stream, subject, "ordinary", 2, null, dayPatterns[index % 3]);
      });
      if (classLevel === "S1" || classLevel === "S2") {
        add(classLevel, stream, "Project", "project", 1, null, ["Friday", "Thursday"]);
        add(classLevel, stream, "Art", "cluster", 1, "VOCATIONAL", ["Monday", "Wednesday"]);
      } else {
        add(classLevel, stream, "Art", "cluster", 2, "VOCATIONAL", ["Tuesday", "Thursday", "Friday"]);
      }
    }
  }
  return rows;
}

function buildAlevelFixture() {
  const rows = [];
  const sharedTeachers = new Map();
  let assignmentId = 10_000;
  let teacherId = 20_000;
  const add = (classLevel, stream, subject, sharedKey = "") => {
    const key = sharedKey ? `${classLevel}-${sharedKey}` : "";
    if (key && !sharedTeachers.has(key)) sharedTeachers.set(key, teacherId++);
    const resolvedTeacherId = key ? sharedTeachers.get(key) : teacherId++;
    const fixedSubs = ["ICT", "Sub Maths"].includes(subject);
    const dayPatterns = [
      ["Monday", "Tuesday", "Wednesday"],
      ["Tuesday", "Thursday", "Friday"],
      ["Monday", "Thursday", "Friday"],
      ["Tuesday", "Wednesday", "Thursday"],
    ];
    const pairedDays = ["Entrepreneurship", "Economics"].includes(subject)
      ? ["Tuesday", "Thursday", "Friday"]
      : ["Literature", "Luganda"].includes(subject)
          ? ["Tuesday", "Wednesday", "Friday"]
          : null;
    const availableDays = fixedSubs
      ? classLevel === "S5"
        ? ["Tuesday", "Thursday", "Friday"]
        : ["Tuesday", "Wednesday", "Thursday"]
      : subject === "General Paper"
        ? ["Monday", "Tuesday", "Wednesday"]
        : pairedDays || dayPatterns[resolvedTeacherId % dayPatterns.length];
    const paperLabels = ["General Paper", "Sub Maths"].includes(subject)
      ? ["Single"]
      : ["Paper 1", "Paper 2"];
    paperLabels.forEach((paperLabel) => {
      rows.push({
        assignment_id: assignmentId++,
        teacher_id: resolvedTeacherId,
        teacher_name: `A Teacher ${resolvedTeacherId}`,
        stream: `${classLevel} ${stream}`,
        subject,
        paper_label: paperLabel,
        available_days: availableDays,
      });
    });
  };

  for (const classLevel of ["S5", "S6"]) {
    for (const subject of [
      "History", "Entrepreneurship", "Economics", "Geography", "Art",
      "Divinity", "Literature", "Luganda",
    ]) add(classLevel, "Arts", subject);
    for (const subject of [
      "Mathematics", "Chemistry", "Physics", "Biology", "Entrepreneurship",
      "Economics", "Agriculture",
    ]) add(classLevel, "Sciences", subject);
    for (const stream of ["Arts", "Sciences"]) {
      add(classLevel, stream, "General Paper", "GP");
      add(classLevel, stream, "ICT", "ICT");
      add(classLevel, stream, "Sub Maths", "SUBMATH");
    }
  }
  return rows;
}

test("default requirements keep lower compulsory optionals outside clusters", () => {
  const lowerKiswahili = defaultRequirementForAssignment({ class_level: "S1", subject: "Kiswahili" });
  const lowerArt = defaultRequirementForAssignment({ class_level: "S2", subject: "Art" });
  const upperArt = defaultRequirementForAssignment({ class_level: "S4", subject: "Art" });

  assert.deepEqual(lowerKiswahili, {
    lessonsPerWeek: 1,
    lessonKind: "ordinary",
    clusterCode: null,
    enabled: true,
  });
  assert.equal(lowerArt.lessonKind, "cluster");
  assert.equal(lowerArt.lessonsPerWeek, 1);
  assert.equal(upperArt.lessonKind, "cluster");
  assert.equal(upperArt.lessonsPerWeek, 2);
});

test("generator respects assembly, church, project and clash rules", () => {
  const result = generateOLevelTimetable(buildFeasibleFixture());

  assert.equal(result.validation.valid, true);
  assert.equal(result.stats.unallocatedLessons, 0);
  assert.equal(result.events.filter((event) => event.eventType === "assembly").length, 8);
  assert.equal(result.events.filter((event) => event.eventType === "church").length, 8);
  assert.equal(result.events.some((event) => event.day === "Friday" && event.slotCode === "P3"), false);
  assert.equal(
    result.events.some((event) => event.classLevel === "S1" && event.eventType === "project" && event.slotCode !== "P5"),
    false
  );
  assert.equal(
    result.events.some((event) => event.classLevel === "S2" && event.eventType === "project" && event.slotCode !== "P4"),
    false
  );

  const teacherSlots = new Set();
  result.sessions.forEach((session) => {
    const key = `${session.teacherId}::${session.day}::${session.slotCode}`;
    assert.equal(teacherSlots.has(key), false, `teacher clash at ${key}`);
    teacherSlots.add(key);
  });

  const ordinarySubjectDays = new Set();
  result.events.filter((event) => event.eventType === "lesson").forEach((event) => {
    const key = `${event.classLevel}::${event.stream}::${event.subjectLabel}::${event.day}`;
    assert.equal(ordinarySubjectDays.has(key), false, `same-day duplicate at ${key}`);
    ordinarySubjectDays.add(key);
  });
});

test("impossible availability produces diagnostics instead of a clash", () => {
  const result = generateOLevelTimetable([
    {
      assignment_id: 1,
      teacher_id: 1,
      teacher_name: "Unavailable Teacher",
      class_level: "S1",
      stream: "North",
      subject: "English",
      lessons_per_week: 2,
      lesson_kind: "ordinary",
      cluster_code: null,
      enabled: 1,
      available_days: [],
    },
  ]);

  assert.equal(result.validation.valid, false);
  assert.equal(result.validation.teacherClashes.length, 0);
  assert.equal(result.validation.streamClashes.length, 0);
  assert.equal(result.validation.missingLessons[0].missing, 2);
  const unavailableDiagnostic = result.validation.unallocated.find((item) => item.assignmentId === 1);
  assert.match(unavailableDiagnostic.reason, /no timetable availability configured/i);
});

test("selected stream regeneration preserves other streams and locked lessons", () => {
  const assignments = buildFeasibleFixture();
  const generated = generateOLevelTimetable(assignments);
  const eventIdByKey = new Map();
  const events = generated.events.map((event, index) => {
    const id = index + 1;
    eventIdByKey.set(event.eventKey, id);
    return { ...event, id };
  });
  const lockedTarget = events.find(
    (event) => event.classLevel === "S1" && event.stream === "North" && event.eventType === "lesson"
  );
  lockedTarget.isLocked = true;
  const sessions = generated.sessions.map((session, index) => ({
    ...session,
    id: index + 1,
    eventId: eventIdByKey.get(session.eventKey) || null,
  }));
  const version = { events, sessions };

  const result = regenerateOLevelStreamLessons({
    version,
    assignments,
    classLevel: "S1",
    stream: "North",
  });

  assert.equal(result.valid, true);
  assert.equal(result.preservedEvents.some((event) => event.id === lockedTarget.id), true);
  assert.equal(
    events
      .filter((event) => event.classLevel !== "S1" || event.stream !== "North")
      .every((event) => result.preservedEvents.some((preserved) => preserved.id === event.id)),
    true
  );
  assert.equal(
    result.events.every((event) => event.classLevel === "S1" && event.stream === "North"),
    true
  );

  const occupied = new Set();
  [...result.preservedSessions, ...result.sessions].forEach((session) => {
    const key = `${session.teacherId}::${session.day}::${session.slotCode}`;
    assert.equal(occupied.has(key), false, `teacher clash after regeneration at ${key}`);
    occupied.add(key);
  });
});

test("A-Level generator keeps fixed subsidiaries, combined GP and maths separation", () => {
  const fixture = buildAlevelFixture();
  const historyPaperOne = fixture.find(
    (row) => row.stream === "S5 Arts" && row.subject === "History" && row.paper_label === "Paper 1"
  );
  const historyPaperTwo = fixture.find(
    (row) => row.stream === "S5 Arts" && row.subject === "History" && row.paper_label === "Paper 2"
  );
  historyPaperOne.subject = "History Paper 1";
  historyPaperTwo.teacher_id = 99_002;
  historyPaperTwo.teacher_name = "A Teacher 99002";
  historyPaperTwo.subject = "History Paper 2";
  historyPaperTwo.available_days = ["Thursday"];
  const result = generateALevelTimetable(fixture);

  assert.equal(
    result.validation.valid,
    true,
    JSON.stringify(result.validation.unallocated, null, 2)
  );
  for (const stream of ["Arts", "Sciences"]) {
    assert.equal(
      result.events.some((event) =>
        event.classLevel === "S5" && event.stream === stream &&
        event.day === "Thursday" && event.slotCode === "P1" &&
        /Sub ICT/.test(event.subjectLabel)
      ),
      true
    );
    assert.equal(
      result.events.some((event) =>
        event.classLevel === "S6" && event.stream === stream &&
        event.day === "Tuesday" && event.slotCode === "P1" &&
        /Sub ICT/.test(event.subjectLabel)
      ),
      true
    );
    assert.equal(
      result.events.some((event) =>
        event.classLevel === "S6" && event.stream === stream &&
        event.day === "Wednesday" && event.slotCode === "P3" &&
        /Sub ICT/.test(event.subjectLabel)
      ),
      true
    );
  }

  for (const classLevel of ["S5", "S6"]) {
    const mathsSlots = new Set(
      result.events
        .filter((event) =>
          event.classLevel === classLevel && event.stream === "Sciences" &&
          event.subjectLabel === "Mathematics"
        )
        .map((event) => `${event.day}::${event.slotCode}`)
    );
    const geographySlots = result.events
      .filter((event) =>
        event.classLevel === classLevel && event.stream === "Arts" &&
        event.subjectLabel === "Geography"
      )
      .map((event) => `${event.day}::${event.slotCode}`);
    assert.equal(geographySlots.some((slot) => mathsSlots.has(slot)), false);
  }

  const s5GeneralPaper = result.events.filter(
    (event) => event.classLevel === "S5" && event.subjectLabel === "General Paper"
  );
  assert.equal(s5GeneralPaper.length, 4);
  assert.equal(s5GeneralPaper.filter((event) => event.slotCode === "P3").length, 2);
  for (const classLevel of ["S5", "S6"]) {
    assert.equal(
      result.events.filter((event) =>
        event.classLevel === classLevel &&
        event.stream === "Arts" &&
        event.subjectLabel === "Divinity"
      ).length,
      2,
      `${classLevel} Arts must receive two Divinity lessons`
    );
  }
  assert.equal(
    result.sessions.filter((session) => session.assignmentId === historyPaperOne.assignment_id).length,
    1,
    "Paper 1 owner must receive exactly one weekly History lesson"
  );
  assert.equal(
    result.sessions.filter((session) => session.assignmentId === historyPaperTwo.assignment_id).length,
    1,
    "Paper 2 owner must receive exactly one weekly History lesson"
  );
  assert.equal(
    [...result.events, ...result.sessions].some((item) => /(?:paper|p)\s*[12]\b/i.test(item.subjectLabel)),
    false,
    "paper numbers must never appear in timetable labels"
  );
  assert.equal(
    result.events.filter((event) =>
      event.classLevel === "S5" && event.stream === "Arts" && event.subjectLabel === "History"
    ).length,
    2,
    "paper assignments must produce two neutral subject lessons"
  );
});

test("A-Level generation blocks incomplete paper staffing", () => {
  const fixture = buildAlevelFixture().filter((row) => !(
    row.stream === "S5 Sciences" &&
    row.subject === "Mathematics" &&
    row.paper_label === "Paper 2"
  ));
  const result = generateALevelTimetable(fixture);

  assert.equal(result.validation.valid, false);
  assert.equal(
    result.validation.unallocated.some((item) =>
      item.classLevel === "S5" &&
      item.stream === "Sciences" &&
      item.subject === "Mathematics" &&
      /Paper 2 has no active teacher assignment/.test(item.reason)
    ),
    true
  );
  assert.equal(
    result.events.some((event) =>
      event.classLevel === "S5" &&
      event.stream === "Sciences" &&
      event.subjectLabel === "Mathematics"
    ),
    false,
    "an incomplete subject must not be partially scheduled"
  );
});

test("school generator prevents collisions between shared O-Level and A-Level teachers", () => {
  const oLevel = buildFeasibleFixture();
  const aLevel = buildAlevelFixture();
  const sharedTeacher = aLevel.find((row) => row.subject === "History");
  oLevel[0].teacher_id = sharedTeacher.teacher_id;
  oLevel[0].teacher_name = sharedTeacher.teacher_name;
  oLevel[0].available_days = sharedTeacher.available_days;

  const result = generateSchoolTimetable(oLevel, aLevel);
  const occupied = new Set();
  result.sessions.forEach((session) => {
    const key = `${session.teacherId}::${session.day}::${session.slotCode}`;
    assert.equal(occupied.has(key), false, `cross-level teacher clash at ${key}`);
    occupied.add(key);
  });
  assert.equal(result.validation.teacherClashes.length, 0);
  assert.equal(result.stats.streams, 12);
});
