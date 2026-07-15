import { DEFAULT_TIMETABLE_CONFIG, SCHOOL_STREAMS } from "./timetable.constants.js";
import { generateALevelTimetable } from "./timetable.alevel.generator.js";
import { generateOLevelTimetableCandidate } from "./timetable.generator.js";

const teacherSlotKey = (session) =>
  `${session.teacherId}::${session.day}::${session.slotCode}`;

function combineCandidate(oLevel, aLevel) {
  const events = [...oLevel.events, ...aLevel.events];
  const sessions = [...oLevel.sessions, ...aLevel.sessions];
  const teacherSlots = new Map();
  const teacherClashes = [];

  sessions.forEach((session) => {
    const key = teacherSlotKey(session);
    const existing = teacherSlots.get(key);
    if (existing) {
      teacherClashes.push({
        teacherId: session.teacherId,
        teacherName: session.teacherName,
        day: session.day,
        slotCode: session.slotCode,
        lessons: [existing.subjectLabel, session.subjectLabel],
      });
      return;
    }
    teacherSlots.set(key, session);
  });

  const missingLessons = [
    ...(oLevel.validation?.missingLessons || []),
    ...(aLevel.validation?.missingLessons || []),
  ];
  const unallocated = [
    ...(oLevel.validation?.unallocated || []),
    ...(aLevel.validation?.unallocated || []),
  ];
  const valid =
    oLevel.validation?.valid &&
    aLevel.validation?.valid &&
    teacherClashes.length === 0;
  const validation = {
    valid,
    teacherClashes,
    streamClashes: [],
    invalidDays: [],
    duplicatePeriods: [],
    missingLessons,
    checks: {
      ...(oLevel.validation?.checks || {}),
      ...(aLevel.validation?.checks || {}),
      crossLevelTeacherClashes: teacherClashes.length === 0 ? "passed" : "failed",
    },
    hardViolations: teacherClashes,
    unallocated,
  };
  const stats = {
    streams: SCHOOL_STREAMS.length,
    oLevelStreams: Number(oLevel.stats?.streams || 0),
    aLevelStreams: Number(aLevel.stats?.streams || 0),
    teachers: new Set(sessions.map((session) => session.teacherId)).size,
    assignments: Number(oLevel.stats?.assignments || 0) + Number(aLevel.stats?.assignments || 0),
    lessonsRequested:
      Number(oLevel.stats?.lessonsRequested || 0) + Number(aLevel.stats?.lessonsRequested || 0),
    lessonsPlaced:
      Number(oLevel.stats?.lessonsPlaced || 0) + Number(aLevel.stats?.lessonsPlaced || 0),
    timetableCells: events.length,
    teacherSessions: sessions.length,
    unallocatedLessons: Math.max(
      missingLessons.reduce((sum, row) => sum + Number(row.missing || 0), 0),
      unallocated.length
    ),
    status: valid ? "complete" : "needs_attention",
  };

  return {
    events,
    sessions,
    validation,
    stats,
    score:
      (valid ? 0 : 1_000_000_000) +
      stats.unallocatedLessons * 1_000_000 +
      unallocated.length * 100_000 +
      teacherClashes.length * 10_000_000 +
      Number(oLevel.score || 0) +
      Number(aLevel.score || 0),
  };
}

export function generateSchoolTimetable(
  oLevelAssignments,
  aLevelAssignments,
  config = DEFAULT_TIMETABLE_CONFIG
) {
  let best = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const aLevel = generateALevelTimetable(aLevelAssignments, config, attempt);
    const oLevel = generateOLevelTimetableCandidate(
      oLevelAssignments,
      config,
      attempt,
      { reservedTeacherSessions: aLevel.sessions }
    );
    const candidate = combineCandidate(oLevel, aLevel);
    if (!best || candidate.score < best.score) best = candidate;
    if (candidate.validation.valid) break;
  }
  return best;
}
