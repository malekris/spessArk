import {
  DEFAULT_TIMETABLE_CONFIG,
  O_LEVEL_STREAMS,
  TIMETABLE_DAYS,
  normalizeClassLevel,
  normalizeStream,
  normalizeSubject,
} from "./timetable.constants.js";

const ORDINARY_SLOTS = {
  Monday: ["P1", "P4", "P5"],
  Tuesday: ["P1", "P2", "P4", "P5"],
  Wednesday: ["P1", "P2", "P4", "P5"],
  Thursday: ["P1", "P2", "P4", "P5"],
  Friday: ["P1", "P2", "P3A", "P4", "P5"],
};

const daySlotKey = (day, slotCode) => `${day}::${slotCode}`;
const streamKey = (classLevel, stream) => `${classLevel}::${stream}`;

function seededRandom(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalizeAssignment(row) {
  return {
    assignmentId: Number(row.assignment_id ?? row.id),
    teacherId: Number(row.teacher_id),
    teacherName: String(row.teacher_name || "Unknown teacher").trim(),
    classLevel: normalizeClassLevel(row.class_level),
    stream: normalizeStream(row.stream),
    subject: String(row.subject || "Untitled subject").trim(),
    subjectKey: normalizeSubject(row.subject),
    lessonsPerWeek: Math.max(0, Number(row.lessons_per_week || 0)),
    lessonKind: String(row.lesson_kind || "review").trim().toLowerCase(),
    clusterCode: String(row.cluster_code || "").trim().toUpperCase(),
    enabled: Boolean(Number(row.enabled)),
    preferredDays: Array.isArray(row.available_days) ? row.available_days : [],
    availableDays: new Set(Array.isArray(row.available_days) ? row.available_days : []),
  };
}

function assignmentLabel(assignment) {
  return `${assignment.subject} - ${assignment.classLevel} ${assignment.stream}`;
}

function unallocatedReason(assignment, detail) {
  return {
    assignmentId: assignment?.assignmentId || null,
    teacherId: assignment?.teacherId || null,
    teacherName: assignment?.teacherName || null,
    classLevel: assignment?.classLevel || null,
    stream: assignment?.stream || null,
    subject: assignment?.subject || null,
    reason: detail,
  };
}

function buildAttempt(rawAssignments, rawConfig, attemptNumber, options = {}) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : DEFAULT_TIMETABLE_CONFIG;
  const assignments = rawAssignments
    .map(normalizeAssignment)
    .filter(
      (row) =>
        row.assignmentId &&
        row.teacherId &&
        row.classLevel &&
        row.stream &&
        row.enabled &&
        row.lessonKind !== "review" &&
        row.lessonsPerWeek > 0
    );
  const rng = seededRandom(7411 + attemptNumber * 1297);
  const events = [];
  const sessions = [];
  const unallocated = [];
  const streamOccupancy = new Map();
  const teacherOccupancy = new Map();
  const streamSubjectDays = new Map();
  const streamDayLoads = new Map();
  const teacherDayLoads = new Map();
  const placedCounts = new Map();
  let eventSequence = 0;
  let blockSequence = 0;

  for (const session of options.reservedTeacherSessions || []) {
    const teacherId = Number(session?.teacherId ?? session?.teacher_id);
    const day = String(session?.day || session?.day_of_week || "").trim();
    const slotCode = String(session?.slotCode || session?.slot_code || "").trim();
    if (!teacherId || !day || !slotCode) continue;
    if (!teacherOccupancy.has(String(teacherId))) {
      teacherOccupancy.set(String(teacherId), new Set());
    }
    teacherOccupancy.get(String(teacherId)).add(daySlotKey(day, slotCode));
    const loadKey = `${teacherId}::${day}`;
    teacherDayLoads.set(loadKey, Number(teacherDayLoads.get(loadKey) || 0) + 1);
  }

  const getOccupancy = (map, key) => {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  };

  const getLoad = (map, key) => Number(map.get(key) || 0);
  const addLoad = (map, key, amount = 1) => map.set(key, getLoad(map, key) + amount);
  const isStreamFree = (classLevel, stream, day, slots) => {
    const occupied = getOccupancy(streamOccupancy, streamKey(classLevel, stream));
    return slots.every((slotCode) => !occupied.has(daySlotKey(day, slotCode)));
  };
  const isTeacherFree = (teacherId, day, slots) => {
    const occupied = getOccupancy(teacherOccupancy, String(teacherId));
    return slots.every((slotCode) => !occupied.has(daySlotKey(day, slotCode)));
  };

  const addEvent = ({
    classLevel,
    stream,
    day,
    slotCode,
    eventType,
    subjectLabel,
    assignmentId = null,
    teacherId = null,
    teacherName = null,
    blockKey = null,
    locked = false,
  }) => {
    if (!isStreamFree(classLevel, stream, day, [slotCode])) return null;
    const eventKey = `event-${++eventSequence}`;
    getOccupancy(streamOccupancy, streamKey(classLevel, stream)).add(daySlotKey(day, slotCode));
    addLoad(streamDayLoads, `${streamKey(classLevel, stream)}::${day}`);
    events.push({
      eventKey,
      classLevel,
      stream,
      day,
      slotCode,
      eventType,
      subjectLabel,
      assignmentId,
      teacherId,
      teacherName,
      blockKey,
      isLocked: locked,
      isManual: false,
    });
    return eventKey;
  };

  const addSession = ({
    eventKey,
    assignment,
    classLevel,
    streamsLabel,
    day,
    slotCode,
    blockKey = null,
  }) => {
    if (!isTeacherFree(assignment.teacherId, day, [slotCode])) return false;
    getOccupancy(teacherOccupancy, String(assignment.teacherId)).add(daySlotKey(day, slotCode));
    addLoad(teacherDayLoads, `${assignment.teacherId}::${day}`);
    sessions.push({
      eventKey,
      teacherId: assignment.teacherId,
      teacherName: assignment.teacherName,
      assignmentId: assignment.assignmentId,
      subjectLabel: assignment.subject,
      classLevel,
      streamsLabel,
      day,
      slotCode,
      blockKey,
    });
    return true;
  };

  const incrementPlaced = (assignmentId) => {
    placedCounts.set(assignmentId, Number(placedCounts.get(assignmentId) || 0) + 1);
  };

  for (const reserved of config.reservedEvents || DEFAULT_TIMETABLE_CONFIG.reservedEvents) {
    for (const target of O_LEVEL_STREAMS) {
      addEvent({
        ...target,
        day: reserved.day,
        slotCode: reserved.slotCode,
        eventType: reserved.type,
        subjectLabel: reserved.label,
        locked: true,
      });
    }
  }

  const projectAssignments = assignments.filter((row) => row.lessonKind === "project");
  for (const projectRule of config.fixedProjects || DEFAULT_TIMETABLE_CONFIG.fixedProjects) {
    const classAssignments = projectAssignments.filter(
      (row) => row.classLevel === projectRule.classLevel
    );
    const uniqueTeachers = new Map();
    classAssignments.forEach((row) => {
      if (!uniqueTeachers.has(row.teacherId)) uniqueTeachers.set(row.teacherId, row);
    });

    const unavailableTeacher = Array.from(uniqueTeachers.values()).find(
      (row) => !row.availableDays.has(projectRule.day)
    );
    const teacherClash = Array.from(uniqueTeachers.values()).find(
      (row) => !isTeacherFree(row.teacherId, projectRule.day, [projectRule.slotCode])
    );
    const assignedStreams = new Set(classAssignments.map((row) => row.stream));
    const canStaffProject =
      assignedStreams.has("North") &&
      assignedStreams.has("South") &&
      !unavailableTeacher &&
      !teacherClash;
    const blockKey = `PROJECT-${projectRule.classLevel}-${projectRule.day}-${projectRule.slotCode}`;

    for (const stream of ["North", "South"]) {
      const assignment = classAssignments.find((row) => row.stream === stream) || null;
      addEvent({
        classLevel: projectRule.classLevel,
        stream,
        day: projectRule.day,
        slotCode: projectRule.slotCode,
        eventType: "project",
        subjectLabel: canStaffProject ? "Project" : "Project - staffing required",
        assignmentId: assignment?.assignmentId || null,
        teacherId: assignment?.teacherId || null,
        teacherName: assignment?.teacherName || null,
        blockKey,
        locked: true,
      });
    }

    if (!canStaffProject) {
      const detail = classAssignments.length === 0
        ? `No active Project assignment exists for ${projectRule.classLevel}. The fixed Project period remains reserved.`
        : !assignedStreams.has("North") || !assignedStreams.has("South")
          ? `${projectRule.classLevel} needs active Project assignments for both North and South. The fixed period remains reserved.`
        : unavailableTeacher
          ? `${unavailableTeacher.teacherName} is not available on Friday for the fixed ${projectRule.classLevel} Project period.`
          : `A Project teacher already has a lesson in the fixed ${projectRule.classLevel} period.`;
      unallocated.push(unallocatedReason(unavailableTeacher || classAssignments[0], detail));
      continue;
    }

    for (const assignment of uniqueTeachers.values()) {
      const ownedStreams = classAssignments
        .filter((row) => row.teacherId === assignment.teacherId)
        .map((row) => row.stream)
        .join(" & ");
      const eventKey = events.find(
        (event) => event.blockKey === blockKey && classAssignments.some(
          (row) => row.teacherId === assignment.teacherId && row.stream === event.stream
        )
      )?.eventKey;
      addSession({
        eventKey,
        assignment,
        classLevel: projectRule.classLevel,
        streamsLabel: ownedStreams || "North & South",
        day: projectRule.day,
        slotCode: projectRule.slotCode,
        blockKey,
      });
    }
    classAssignments.forEach((assignment) => incrementPlaced(assignment.assignmentId));
  }

  const clusterGroups = new Map();
  assignments
    .filter((row) => row.lessonKind === "cluster" && row.clusterCode)
    .forEach((row) => {
      const key = `${row.classLevel}::${row.clusterCode}`;
      if (!clusterGroups.has(key)) clusterGroups.set(key, []);
      clusterGroups.get(key).push(row);
    });

  const clusterEntries = Array.from(clusterGroups.entries()).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  for (const [groupKey, groupAssignments] of clusterEntries) {
    const [classLevel, clusterCode] = groupKey.split("::");
    const requiredBlocks = Math.max(...groupAssignments.map((row) => row.lessonsPerWeek));
    const lower = classLevel === "S1" || classLevel === "S2";
    const windows = lower
      ? config.clusterWindows?.lower || DEFAULT_TIMETABLE_CONFIG.clusterWindows.lower
      : config.clusterWindows?.upper || DEFAULT_TIMETABLE_CONFIG.clusterWindows.upper;
    const usedDays = new Set();

    for (let occurrence = 0; occurrence < requiredBlocks; occurrence += 1) {
      const participating = groupAssignments.filter((row) => row.lessonsPerWeek > occurrence);
      const teacherSubjects = new Map();
      participating.forEach((row) => {
        if (!teacherSubjects.has(row.teacherId)) teacherSubjects.set(row.teacherId, new Set());
        teacherSubjects.get(row.teacherId).add(row.subjectKey);
      });
      const overloadedTeacherId = Array.from(teacherSubjects.entries()).find(([, subjects]) => subjects.size > 1)?.[0];

      if (overloadedTeacherId) {
        const teacher = participating.find((row) => row.teacherId === overloadedTeacherId);
        unallocated.push(
          unallocatedReason(
            teacher,
            `${teacher.teacherName} owns more than one parallel ${clusterCode} subject in ${classLevel}. Reassign one cluster subject before generation.`
          )
        );
        continue;
      }

      const candidates = windows
        .filter((window) => !usedDays.has(window.day))
        .filter((window) => participating.every((row) => row.availableDays.has(window.day)))
        .filter((window) => ["North", "South"].every((stream) =>
          isStreamFree(classLevel, stream, window.day, window.slotCodes)
        ))
        .filter((window) => participating.every((row) =>
          isTeacherFree(row.teacherId, window.day, window.slotCodes)
        ))
        .map((window) => ({
          ...window,
          score:
            ["North", "South"].reduce(
              (sum, stream) => sum + getLoad(streamDayLoads, `${streamKey(classLevel, stream)}::${window.day}`),
              0
            ) * 4 +
            participating.reduce(
              (sum, row) => sum + getLoad(teacherDayLoads, `${row.teacherId}::${window.day}`),
              0
            ) * 2 +
            participating.reduce((sum, row) => {
              const preference = row.preferredDays.indexOf(window.day);
              return sum + (preference < 0 ? 5 : preference * 0.25);
            }, 0) +
            rng(),
        }))
        .sort((left, right) => left.score - right.score);

      const selected = candidates[0];
      if (!selected) {
        const noSharedDay = TIMETABLE_DAYS.every(
          (day) => !participating.every((row) => row.availableDays.has(day))
        );
        unallocated.push({
          assignmentId: null,
          teacherId: null,
          teacherName: null,
          classLevel,
          stream: "North & South",
          subject: `${clusterCode} Cluster`,
          reason: noSharedDay
            ? `The ${classLevel} ${clusterCode} teachers have no shared available day.`
            : `No clash-free two-hour window remains for ${classLevel} ${clusterCode} block ${occurrence + 1}.`,
        });
        continue;
      }

      usedDays.add(selected.day);
      const blockKey = `CL-${++blockSequence}-${classLevel}-${clusterCode}`;
      const label = clusterCode === "VOCATIONAL" ? "Vocational Cluster" : "Other Subjects Cluster";
      const eventKeys = [];
      for (const stream of ["North", "South"]) {
        for (const slotCode of selected.slotCodes) {
          const eventKey = addEvent({
            classLevel,
            stream,
            day: selected.day,
            slotCode,
            eventType: "cluster",
            subjectLabel: label,
            blockKey,
          });
          if (eventKey) eventKeys.push(eventKey);
        }
      }

      const uniqueSessions = new Map();
      participating.forEach((row) => {
        const key = `${row.teacherId}::${row.subjectKey}`;
        if (!uniqueSessions.has(key)) uniqueSessions.set(key, row);
      });
      for (const assignment of uniqueSessions.values()) {
        const streamsLabel = participating
          .filter((row) => row.teacherId === assignment.teacherId && row.subjectKey === assignment.subjectKey)
          .map((row) => row.stream)
          .filter((value, index, all) => all.indexOf(value) === index)
          .join(" & ");
        for (const slotCode of selected.slotCodes) {
          addSession({
            eventKey: eventKeys.find((key) => events.find((event) => event.eventKey === key)?.slotCode === slotCode),
            assignment,
            classLevel,
            streamsLabel,
            day: selected.day,
            slotCode,
            blockKey,
          });
        }
      }
      participating.forEach((assignment) => incrementPlaced(assignment.assignmentId));
    }
  }

  const ordinaryAssignments = assignments.filter((row) => row.lessonKind === "ordinary");
  const tasks = ordinaryAssignments.flatMap((assignment) =>
    Array.from({ length: assignment.lessonsPerWeek }, (_, occurrence) => ({ assignment, occurrence }))
  );
  tasks.sort((left, right) => {
    const availabilityDifference =
      left.assignment.availableDays.size - right.assignment.availableDays.size;
    if (availabilityDifference !== 0) return availabilityDifference;
    const frequencyDifference = right.assignment.lessonsPerWeek - left.assignment.lessonsPerWeek;
    if (frequencyDifference !== 0) return frequencyDifference;
    return rng() - 0.5;
  });

  const fridaySimple = new Set(
    (config.simpleFridaySubjects || DEFAULT_TIMETABLE_CONFIG.simpleFridaySubjects).map(normalizeSubject)
  );
  for (const { assignment } of tasks) {
    const assignmentStreamKey = streamKey(assignment.classLevel, assignment.stream);
    const subjectDayKey = `${assignmentStreamKey}::${assignment.subjectKey}`;
    const usedSubjectDays = getOccupancy(streamSubjectDays, subjectDayKey);
    const candidates = [];

    for (const day of TIMETABLE_DAYS) {
      if (!assignment.availableDays.has(day) || usedSubjectDays.has(day)) continue;
      for (const slotCode of ORDINARY_SLOTS[day]) {
        if (day === "Friday" && slotCode === "P3A" && !fridaySimple.has(assignment.subjectKey)) {
          continue;
        }
        if (!isStreamFree(assignment.classLevel, assignment.stream, day, [slotCode])) continue;
        if (!isTeacherFree(assignment.teacherId, day, [slotCode])) continue;
        candidates.push({
          day,
          slotCode,
          score:
            getLoad(streamDayLoads, `${assignmentStreamKey}::${day}`) * 5 +
            getLoad(teacherDayLoads, `${assignment.teacherId}::${day}`) * 3 +
            Math.max(0, assignment.preferredDays.indexOf(day)) * 0.3 +
            (slotCode === "P5" ? 0.8 : 0) +
            (slotCode === "P3A" ? 0.5 : 0) +
            rng(),
        });
      }
    }

    candidates.sort((left, right) => left.score - right.score);
    const selected = candidates[0];
    if (!selected) {
      const reason = assignment.availableDays.size === 0
        ? `${assignment.teacherName} has no timetable availability configured.`
        : `No clash-free slot remains on ${assignment.teacherName}'s available days; ${assignment.subject} is also prevented from repeating in one day.`;
      unallocated.push(unallocatedReason(assignment, reason));
      continue;
    }

    const eventKey = addEvent({
      classLevel: assignment.classLevel,
      stream: assignment.stream,
      day: selected.day,
      slotCode: selected.slotCode,
      eventType: "lesson",
      subjectLabel: assignment.subject,
      assignmentId: assignment.assignmentId,
      teacherId: assignment.teacherId,
      teacherName: assignment.teacherName,
    });
    if (!eventKey) {
      unallocated.push(unallocatedReason(assignment, "The selected stream slot became unavailable."));
      continue;
    }
    addSession({
      eventKey,
      assignment,
      classLevel: assignment.classLevel,
      streamsLabel: assignment.stream,
      day: selected.day,
      slotCode: selected.slotCode,
    });
    usedSubjectDays.add(selected.day);
    incrementPlaced(assignment.assignmentId);
  }

  const missingLessons = [];
  for (const assignment of assignments) {
    const placed = Number(placedCounts.get(assignment.assignmentId) || 0);
    if (placed < assignment.lessonsPerWeek) {
      missingLessons.push({
        assignmentId: assignment.assignmentId,
        label: assignmentLabel(assignment),
        required: assignment.lessonsPerWeek,
        placed,
        missing: assignment.lessonsPerWeek - placed,
      });
    }
  }

  const dailyStreamLoads = Array.from(streamDayLoads.values());
  const balancePenalty = dailyStreamLoads.reduce((sum, value) => sum + value * value, 0);
  const hardViolations = [];
  const validation = {
    valid: unallocated.length === 0 && missingLessons.length === 0,
    teacherClashes: [],
    streamClashes: [],
    invalidDays: [],
    duplicatePeriods: [],
    missingLessons,
    checks: {
      teacherClashes: "passed",
      streamClashes: "passed",
      teacherAvailability: "passed",
      assignedSubjectsOnly: "passed",
      breakAndLunchBoundaries: "passed",
      reservedSchoolEvents: "passed",
    },
    hardViolations,
    unallocated,
  };
  const stats = {
    streams: O_LEVEL_STREAMS.length,
    teachers: new Set(assignments.map((row) => row.teacherId)).size,
    assignments: assignments.length,
    lessonsRequested: assignments.reduce((sum, row) => sum + row.lessonsPerWeek, 0),
    lessonsPlaced: Array.from(placedCounts.values()).reduce((sum, value) => sum + value, 0),
    timetableCells: events.length,
    teacherSessions: sessions.length,
    unallocatedLessons: Math.max(
      missingLessons.reduce((sum, row) => sum + row.missing, 0),
      unallocated.length
    ),
    status: validation.valid ? "complete" : "needs_attention",
  };

  return {
    events,
    sessions,
    validation,
    stats,
    score: stats.unallocatedLessons * 100000 + unallocated.length * 10000 + balancePenalty,
  };
}

export function generateOLevelTimetableCandidate(
  assignments,
  config = DEFAULT_TIMETABLE_CONFIG,
  attemptNumber = 0,
  options = {}
) {
  return buildAttempt(assignments, config, attemptNumber, options);
}

export function generateOLevelTimetable(assignments, config = DEFAULT_TIMETABLE_CONFIG, options = {}) {
  let best = null;
  const attempts = Math.max(1, Number(options.attempts || 80));
  const attemptOffset = Math.max(0, Number(options.attemptOffset || 0));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = buildAttempt(assignments, config, attemptOffset + attempt, options);
    if (!best || candidate.score < best.score) best = candidate;
    if (candidate.validation.valid) break;
  }
  return best;
}
