import {
  DEFAULT_TIMETABLE_CONFIG,
  TIMETABLE_DAYS,
  normalizeClassLevel,
  normalizeStream,
  normalizeSubject,
} from "./timetable.constants.js";

const ORDINARY_SLOTS = {
  Monday: ["P1", "P3", "P4", "P5"],
  Tuesday: ["P1", "P2", "P3", "P4", "P5"],
  Wednesday: ["P1", "P2", "P3", "P4", "P5"],
  Thursday: ["P1", "P2", "P3", "P4", "P5"],
  Friday: ["P1", "P2", "P3A", "P4", "P5"],
};

const slotKey = (day, slotCode) => `${day}::${slotCode}`;

function seededRandom(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalizeAssignment(row) {
  const preferredDays = Array.isArray(row.available_days) ? row.available_days : [];
  return {
    assignmentId: Number(row.assignment_id ?? row.assignmentId),
    teacherId: Number(row.teacher_id ?? row.teacherId),
    teacherName: String(row.teacher_name ?? row.teacherName ?? "Unknown teacher").trim(),
    classLevel: normalizeClassLevel(row.class_level ?? row.classLevel),
    stream: normalizeStream(row.stream),
    subject: String(row.subject || "Untitled subject").trim(),
    subjectKey: normalizeSubject(row.subject),
    lessonsPerWeek: Number(row.lessons_per_week ?? row.lessonsPerWeek ?? 0),
    lessonKind: String(row.lesson_kind ?? row.lessonKind ?? "review").toLowerCase(),
    enabled: Boolean(Number(row.enabled)),
    preferredDays,
    availableDays: new Set(preferredDays),
  };
}

function runAttempt({ version, assignments, config, classLevel, stream, attempt }) {
  const rng = seededRandom(9187 + attempt * 811);
  const removableEvents = version.events.filter(
    (event) =>
      event.classLevel === classLevel &&
      event.stream === stream &&
      event.eventType === "lesson" &&
      !event.isLocked &&
      !event.blockKey
  );
  const removableIds = new Set(removableEvents.map((event) => Number(event.id)));
  const preservedEvents = version.events.filter((event) => !removableIds.has(Number(event.id)));
  const preservedSessions = version.sessions.filter(
    (session) => !session.eventId || !removableIds.has(Number(session.eventId))
  );
  const targetAssignments = assignments
    .map(normalizeAssignment)
    .filter(
      (assignment) =>
        assignment.classLevel === classLevel &&
        assignment.stream === stream &&
        assignment.lessonKind === "ordinary" &&
        assignment.enabled &&
        assignment.lessonsPerWeek > 0
    );

  if (targetAssignments.length === 0) {
    return {
      valid: false,
      reason: `No enabled ordinary lesson requirements exist for ${classLevel} ${stream}.`,
    };
  }

  const streamOccupancy = new Set(
    preservedEvents
      .filter((event) => event.classLevel === classLevel && event.stream === stream)
      .map((event) => slotKey(event.day, event.slotCode))
  );
  const teacherOccupancy = new Map();
  const teacherDayLoads = new Map();
  preservedSessions.forEach((session) => {
    const teacherId = Number(session.teacherId);
    if (!teacherOccupancy.has(teacherId)) teacherOccupancy.set(teacherId, new Set());
    teacherOccupancy.get(teacherId).add(slotKey(session.day, session.slotCode));
    const loadKey = `${teacherId}::${session.day}`;
    teacherDayLoads.set(loadKey, Number(teacherDayLoads.get(loadKey) || 0) + 1);
  });
  const subjectDays = new Map();
  preservedEvents
    .filter(
      (event) =>
        event.classLevel === classLevel &&
        event.stream === stream &&
        event.eventType === "lesson"
    )
    .forEach((event) => {
      const key = normalizeSubject(event.subjectLabel);
      if (!subjectDays.has(key)) subjectDays.set(key, new Set());
      subjectDays.get(key).add(event.day);
    });
  const streamDayLoads = new Map();
  preservedEvents
    .filter((event) => event.classLevel === classLevel && event.stream === stream)
    .forEach((event) => {
      streamDayLoads.set(event.day, Number(streamDayLoads.get(event.day) || 0) + 1);
    });

  const tasks = [];
  for (const assignment of targetAssignments) {
    const alreadyPreserved = preservedEvents.filter(
      (event) =>
        event.classLevel === classLevel &&
        event.stream === stream &&
        event.eventType === "lesson" &&
        normalizeSubject(event.subjectLabel) === assignment.subjectKey
    ).length;
    const remaining = Math.max(0, assignment.lessonsPerWeek - alreadyPreserved);
    for (let occurrence = 0; occurrence < remaining; occurrence += 1) {
      tasks.push({ assignment, occurrence });
    }
  }
  tasks.sort((left, right) =>
    left.assignment.availableDays.size - right.assignment.availableDays.size ||
    right.assignment.lessonsPerWeek - left.assignment.lessonsPerWeek ||
    rng() - 0.5
  );

  const events = [];
  const sessions = [];
  const failures = [];
  let sequence = 0;

  for (const { assignment } of tasks) {
    const usedDays = subjectDays.get(assignment.subjectKey) || new Set();
    const teacherSlots = teacherOccupancy.get(assignment.teacherId) || new Set();
    const candidates = [];
    for (const day of TIMETABLE_DAYS) {
      if (!assignment.availableDays.has(day) || usedDays.has(day)) continue;
      for (const slotCode of ORDINARY_SLOTS[day]) {
        const key = slotKey(day, slotCode);
        if (streamOccupancy.has(key) || teacherSlots.has(key)) continue;
        const preference = assignment.preferredDays.indexOf(day);
        candidates.push({
          day,
          slotCode,
          score:
            Number(streamDayLoads.get(day) || 0) * 5 +
            Number(teacherDayLoads.get(`${assignment.teacherId}::${day}`) || 0) * 3 +
            (preference < 0 ? 5 : preference * 0.3) +
            (slotCode === "P5" ? 0.8 : 0) +
            (slotCode === "P3" ? -2.5 : 0) +
            (slotCode === "P3A" ? -3 : 0) +
            rng(),
        });
      }
    }
    candidates.sort((left, right) => left.score - right.score);
    const selected = candidates[0];
    if (!selected) {
      failures.push({
        assignmentId: assignment.assignmentId,
        subject: assignment.subject,
        teacherName: assignment.teacherName,
        reason: assignment.availableDays.size === 0
          ? `${assignment.teacherName} has no timetable availability configured.`
          : `No clash-free period remains for ${assignment.subject} on ${assignment.teacherName}'s available days.`,
      });
      continue;
    }

    const eventKey = `regen-${++sequence}`;
    streamOccupancy.add(slotKey(selected.day, selected.slotCode));
    if (!teacherOccupancy.has(assignment.teacherId)) teacherOccupancy.set(assignment.teacherId, new Set());
    teacherOccupancy.get(assignment.teacherId).add(slotKey(selected.day, selected.slotCode));
    if (!subjectDays.has(assignment.subjectKey)) subjectDays.set(assignment.subjectKey, new Set());
    subjectDays.get(assignment.subjectKey).add(selected.day);
    streamDayLoads.set(selected.day, Number(streamDayLoads.get(selected.day) || 0) + 1);
    const teacherLoadKey = `${assignment.teacherId}::${selected.day}`;
    teacherDayLoads.set(teacherLoadKey, Number(teacherDayLoads.get(teacherLoadKey) || 0) + 1);
    events.push({
      eventKey,
      classLevel,
      stream,
      day: selected.day,
      slotCode: selected.slotCode,
      eventType: "lesson",
      subjectLabel: assignment.subject,
      assignmentId: assignment.assignmentId,
      teacherId: assignment.teacherId,
      teacherName: assignment.teacherName,
      blockKey: null,
      isLocked: false,
      isManual: false,
    });
    sessions.push({
      eventKey,
      teacherId: assignment.teacherId,
      teacherName: assignment.teacherName,
      assignmentId: assignment.assignmentId,
      subjectLabel: assignment.subject,
      classLevel,
      streamsLabel: stream,
      day: selected.day,
      slotCode: selected.slotCode,
      blockKey: null,
    });
  }

  return {
    valid: failures.length === 0,
    failures,
    removableEventIds: [...removableIds],
    preservedEvents,
    preservedSessions,
    events,
    sessions,
    score:
      failures.length * 100000 +
      Array.from(streamDayLoads.values()).reduce((sum, value) => sum + value * value, 0),
  };
}

export function regenerateOLevelStreamLessons({
  version,
  assignments,
  config = DEFAULT_TIMETABLE_CONFIG,
  classLevel,
  stream,
}) {
  const normalizedClass = normalizeClassLevel(classLevel);
  const normalizedStream = normalizeStream(stream);
  if (!normalizedClass || !normalizedStream) {
    return { valid: false, reason: "Choose an O-Level class and stream." };
  }
  let best = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = runAttempt({
      version,
      assignments,
      config,
      classLevel: normalizedClass,
      stream: normalizedStream,
      attempt,
    });
    if (!best || Number(candidate.score ?? Infinity) < Number(best.score ?? Infinity)) best = candidate;
    if (candidate.valid) break;
  }
  return best;
}
