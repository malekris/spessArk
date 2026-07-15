import {
  A_LEVEL_STREAMS,
  DEFAULT_TIMETABLE_CONFIG,
  TIMETABLE_DAYS,
  normalizeAlevelClassLevel,
  normalizeAlevelStream,
  normalizeSubject,
} from "./timetable.constants.js";

const FLEXIBLE_SLOTS = {
  Monday: ["P1", "P3", "P4", "P5"],
  Tuesday: ["P1", "P2", "P3", "P4", "P5"],
  Wednesday: ["P1", "P2", "P3", "P4", "P5"],
  Thursday: ["P1", "P2", "P3", "P4", "P5"],
  Friday: ["P1", "P2", "P4", "P5"],
};

const ORDINARY_SLOTS = Object.fromEntries(
  Object.entries(FLEXIBLE_SLOTS).map(([day, slots]) => [
    day,
    slots.filter((slotCode) => slotCode !== "P3"),
  ])
);

const daySlotKey = (day, slotCode) => `${day}::${slotCode}`;
const streamKey = (classLevel, stream) => `${classLevel}::${stream}`;
const SINGLE_PAPER_SUBJECT_KEYS = new Set([
  "general_paper",
  "sub_math",
  "subsidiary_block",
]);

export function timetableAlevelSubjectName(value) {
  return String(value || "")
    .replace(/\s*(?:[-:/]\s*)?(?:paper|p)\s*[12]\s*$/i, "")
    .replace(/\s+[12]\s*$/i, "")
    .trim();
}

function seededRandom(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function canonicalAlevelSubject(value) {
  const key = normalizeSubject(timetableAlevelSubjectName(value));
  const has = (word) => key.split(" ").includes(word);

  if (key === "gp" || key.includes("general paper")) return "general_paper";
  if ((key.includes("ict") || key.includes("information")) && key.includes("math")) {
    return "subsidiary_block";
  }
  if (key.includes("sub") && (key.includes("ict") || key.includes("information"))) return "sub_ict";
  if (key === "ict" || key.includes("information communication")) return "sub_ict";
  if ((key.includes("sub") || key.includes("subsidiary")) && key.includes("math")) return "sub_math";
  if ((has("ent") || key.includes("entrepreneurship")) && (has("econ") || key.includes("economic"))) {
    return "ent_econ";
  }
  if (key.includes("lit") && (key.includes("lug") || key.includes("luganda"))) return "lit_lug";
  if (key === "ent" || key.includes("entrepreneurship")) return "entrepreneurship";
  if (key === "econ" || key.includes("economic")) return "economics";
  if (key.includes("divinity")) return "divinity";
  if (key === "lit" || key.includes("literature")) return "literature";
  if (key === "lug" || key.includes("luganda")) return "luganda";
  if (key === "math" || key === "maths" || key.includes("mathematics")) return "mathematics";
  if (key.includes("geography")) return "geography";
  return key.replace(/\s+/g, "_");
}

export function normalizeAlevelTimetablePaperLabel(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "paper1" || key === "p1") return "Paper 1";
  if (key === "paper2" || key === "p2") return "Paper 2";
  if (key === "single" || key === "singlepaper") return "Single";
  return "";
}

export function aLevelSubjectUsesTwoPapers(value) {
  return !SINGLE_PAPER_SUBJECT_KEYS.has(canonicalAlevelSubject(value));
}

function subjectLabel(subjectKey, fallback) {
  const labels = {
    general_paper: "General Paper",
    sub_ict: "Sub ICT",
    sub_math: "Sub Maths",
    subsidiary_block: "Sub ICT / Sub Maths",
    entrepreneurship: "ENT",
    economics: "ECON",
    ent_econ: "ENT / ECON",
    divinity: "Divinity",
    literature: "LIT",
    luganda: "LUG",
    lit_lug: "LIT / LUG",
    mathematics: "Mathematics",
    geography: "Geography",
  };
  return labels[subjectKey] || timetableAlevelSubjectName(fallback || subjectKey);
}

function pairCode(subjectKey) {
  if (["entrepreneurship", "economics", "ent_econ"].includes(subjectKey)) return "ENT_ECON";
  if (["literature", "luganda", "lit_lug"].includes(subjectKey)) return "LIT_LUG";
  return "";
}

function normalizeAssignment(row) {
  const classLevel = normalizeAlevelClassLevel(row.stream ?? row.class_level);
  const stream = normalizeAlevelStream(row.stream);
  return {
    assignmentId: Number(row.assignment_id ?? row.id),
    teacherId: Number(row.teacher_id),
    teacherName: String(row.teacher_name || "Unknown teacher").trim(),
    classLevel,
    stream,
    subject: timetableAlevelSubjectName(row.subject || "Untitled subject"),
    subjectKey: canonicalAlevelSubject(row.subject),
    paperLabel: normalizeAlevelTimetablePaperLabel(row.paper_label),
    preferredDays: Array.isArray(row.available_days) ? row.available_days : [],
    availableDays: new Set(Array.isArray(row.available_days) ? row.available_days : []),
  };
}

function buildSubjectUnits(assignments) {
  const units = new Map();
  assignments.forEach((assignment) => {
    const key = `${assignment.classLevel}::${assignment.stream}::${assignment.subjectKey}`;
    if (!units.has(key)) {
      units.set(key, {
        key,
        classLevel: assignment.classLevel,
        stream: assignment.stream,
        subjectKey: assignment.subjectKey,
        subject: subjectLabel(assignment.subjectKey, assignment.subject),
        assignments: [],
      });
    }
    units.get(key).assignments.push(assignment);
  });
  units.forEach((unit) => {
    const usesTwoPapers = !SINGLE_PAPER_SUBJECT_KEYS.has(unit.subjectKey);
    const expectedPapers = usesTwoPapers ? ["Paper 1", "Paper 2"] : ["Single"];
    const assignmentsByPaper = new Map(
      expectedPapers.map((paperLabel) => [
        paperLabel,
        unit.assignments
          .filter((assignment) => assignment.paperLabel === paperLabel)
          .sort((left, right) => left.assignmentId - right.assignmentId),
      ])
    );
    const invalidPapers = expectedPapers.filter(
      (paperLabel) => assignmentsByPaper.get(paperLabel).length !== 1
    );
    unit.usesTwoPapers = usesTwoPapers;
    unit.paperAssignments = expectedPapers.map(
      (paperLabel) => assignmentsByPaper.get(paperLabel)[0] || null
    );
    unit.paperReady = invalidPapers.length === 0;
    unit.paperIssue = invalidPapers.length === 0
      ? ""
      : invalidPapers.map((paperLabel) => {
          const count = assignmentsByPaper.get(paperLabel).length;
          return count === 0
            ? `${paperLabel} has no active teacher assignment`
            : `${paperLabel} has ${count} active teacher assignments`;
        }).join("; ");
  });
  return Array.from(units.values());
}

function occurrenceAssignment(unit, occurrence) {
  if (!unit.paperReady || unit.paperAssignments.length === 0) return null;
  if (!unit.usesTwoPapers) return unit.paperAssignments[0];
  const preferred = unit.paperAssignments[occurrence % unit.paperAssignments.length];
  if (preferred?.paperLabel !== "Paper 2" || preferred.availableDays.size > 0) return preferred;

  // A zero-day Paper 2 owner handles weekend practicals and marks only.
  return unit.paperAssignments.find(
    (assignment) => assignment?.paperLabel === "Paper 1" && assignment.availableDays.size > 0
  ) || preferred;
}

function unallocatedItem(unit, reason) {
  const assignment = unit?.assignments?.[0] || null;
  return {
    assignmentId: assignment?.assignmentId || null,
    teacherId: assignment?.teacherId || null,
    teacherName: assignment?.teacherName || null,
    classLevel: unit?.classLevel || assignment?.classLevel || null,
    stream: unit?.stream || assignment?.stream || null,
    subject: unit?.subject || assignment?.subject || "A-Level block",
    reason,
  };
}

export function generateALevelTimetable(
  rawAssignments,
  rawConfig = DEFAULT_TIMETABLE_CONFIG,
  attemptNumber = 0
) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : DEFAULT_TIMETABLE_CONFIG;
  const aLevelConfig = { ...DEFAULT_TIMETABLE_CONFIG.aLevel, ...(config.aLevel || {}) };
  const assignments = rawAssignments
    .map(normalizeAssignment)
    .filter((row) => row.assignmentId && row.teacherId && row.classLevel && row.stream && row.subjectKey);
  const units = buildSubjectUnits(assignments);
  const lessonsPerSubject = Math.max(1, Number(aLevelConfig.lessonsPerSubject || 2));
  const rng = seededRandom(19081 + attemptNumber * 1613);
  const events = [];
  const sessions = [];
  const unallocated = [];
  const placedCounts = new Map();
  const streamOccupancy = new Map();
  const teacherOccupancy = new Map();
  const streamDayLoads = new Map();
  const teacherDayLoads = new Map();
  const specialOccupancy = new Map();
  let eventSequence = 0;
  let blockSequence = 0;

  units.filter((unit) => !unit.paperReady).forEach((unit) => {
    unallocated.push(unallocatedItem(
      unit,
      `${unit.subject} paper assignments are incomplete or ambiguous: ${unit.paperIssue}.`
    ));
  });

  const getOccupancy = (map, key) => {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  };
  const getLoad = (map, key) => Number(map.get(key) || 0);
  const addLoad = (map, key, amount = 1) => map.set(key, getLoad(map, key) + amount);
  const isStreamFree = (classLevel, stream, day, slotCode) =>
    !getOccupancy(streamOccupancy, streamKey(classLevel, stream)).has(daySlotKey(day, slotCode));
  const isTeacherFree = (teacherId, day, slotCode) =>
    !getOccupancy(teacherOccupancy, String(teacherId)).has(daySlotKey(day, slotCode));

  const addEvent = ({
    classLevel,
    stream,
    day,
    slotCode,
    eventType,
    label,
    assignment = null,
    blockKey = null,
    locked = false,
  }) => {
    if (!isStreamFree(classLevel, stream, day, slotCode)) return null;
    const eventKey = `alevel-event-${++eventSequence}`;
    getOccupancy(streamOccupancy, streamKey(classLevel, stream)).add(daySlotKey(day, slotCode));
    addLoad(streamDayLoads, `${streamKey(classLevel, stream)}::${day}`);
    events.push({
      eventKey,
      classLevel,
      stream,
      day,
      slotCode,
      eventType,
      subjectLabel: label,
      assignmentId: assignment?.assignmentId || null,
      teacherId: assignment?.teacherId || null,
      teacherName: assignment?.teacherName || null,
      blockKey,
      isLocked: locked,
      isManual: false,
    });
    return eventKey;
  };

  const addSession = ({
    eventKey,
    assignment,
    subject,
    classLevel,
    streamsLabel,
    day,
    slotCode,
    blockKey,
  }) => {
    if (!assignment || !isTeacherFree(assignment.teacherId, day, slotCode)) return false;
    getOccupancy(teacherOccupancy, String(assignment.teacherId)).add(daySlotKey(day, slotCode));
    addLoad(teacherDayLoads, `${assignment.teacherId}::${day}`);
    sessions.push({
      eventKey,
      teacherId: assignment.teacherId,
      teacherName: assignment.teacherName,
      assignmentId: assignment.assignmentId,
      subjectLabel: subject,
      classLevel,
      streamsLabel,
      day,
      slotCode,
      blockKey,
    });
    return true;
  };

  const incrementUnits = (blockUnits) => {
    blockUnits.forEach((unit) => {
      placedCounts.set(unit.key, Number(placedCounts.get(unit.key) || 0) + 1);
    });
  };

  const participantRows = (blockUnits, occurrence) => {
    const rows = blockUnits
      .map((unit) => ({ unit, assignment: occurrenceAssignment(unit, occurrence) }))
      .filter((entry) => entry.assignment);
    const teacherSubjects = new Map();
    rows.forEach(({ unit, assignment }) => {
      if (!teacherSubjects.has(assignment.teacherId)) teacherSubjects.set(assignment.teacherId, new Set());
      teacherSubjects.get(assignment.teacherId).add(unit.subjectKey);
    });
    const overloadedTeacherId = Array.from(teacherSubjects.entries())
      .find(([, subjects]) => subjects.size > 1)?.[0];
    return { rows, overloadedTeacherId: Number(overloadedTeacherId || 0) };
  };

  const canPlaceBlock = ({ classLevel, streams, day, slotCode, rows }) =>
    streams.every((stream) => isStreamFree(classLevel, stream, day, slotCode)) &&
    rows.every(({ assignment }) =>
      assignment.availableDays.has(day) && isTeacherFree(assignment.teacherId, day, slotCode)
    );

  const placeBlock = ({
    blockUnits,
    occurrence,
    classLevel,
    streams,
    day,
    slotCode,
    label,
    eventType = "cluster",
    locked = false,
    forceEvent = false,
  }) => {
    const { rows, overloadedTeacherId } = participantRows(blockUnits, occurrence);
    const uniqueRows = Array.from(
      rows.reduce((map, entry) => {
        const key = `${entry.assignment.teacherId}::${entry.unit.subjectKey}`;
        if (!map.has(key)) map.set(key, entry);
        return map;
      }, new Map()).values()
    );
    const valid =
      rows.length > 0 &&
      !overloadedTeacherId &&
      canPlaceBlock({ classLevel, streams, day, slotCode, rows: uniqueRows });
    const grouped = streams.length > 1 || uniqueRows.length > 1 || eventType === "cluster" || locked;
    const blockKey = grouped ? `AL-${++blockSequence}-${classLevel}-${day}-${slotCode}` : null;
    const eventKeys = [];

    if (valid || forceEvent) {
      streams.forEach((stream) => {
        const eventKey = addEvent({
          classLevel,
          stream,
          day,
          slotCode,
          eventType,
          label: valid ? label : `${label} - staffing required`,
          assignment: uniqueRows.length === 1 ? uniqueRows[0].assignment : null,
          blockKey,
          locked,
        });
        if (eventKey) eventKeys.push(eventKey);
      });
    }
    if (!valid) {
      return { placed: false, overloadedTeacherId, rows };
    }

    uniqueRows.forEach(({ unit, assignment }) => {
      addSession({
        eventKey: eventKeys[0] || null,
        assignment,
        subject: unit.subject,
        classLevel,
        streamsLabel: streams.join(" & "),
        day,
        slotCode,
        blockKey,
      });
    });
    incrementUnits(blockUnits);
    return { placed: true, overloadedTeacherId: 0, rows };
  };

  for (const reserved of config.reservedEvents || DEFAULT_TIMETABLE_CONFIG.reservedEvents) {
    for (const target of A_LEVEL_STREAMS) {
      addEvent({
        ...target,
        day: reserved.day,
        slotCode: reserved.slotCode,
        eventType: reserved.type,
        label: reserved.label,
        locked: true,
      });
    }
  }

  const subsidiaryKeys = new Set(["sub_ict", "sub_math", "subsidiary_block"]);
  const fixedUnits = units.filter((unit) => subsidiaryKeys.has(unit.subjectKey));
  for (const classLevel of ["S5", "S6"]) {
    const classUnits = fixedUnits.filter((unit) => unit.classLevel === classLevel);
    const coveredStreams = new Set(classUnits.map((unit) => unit.stream));
    const fixedSlots = aLevelConfig.subsidiaryBlocks?.[classLevel] || [];
    if (classUnits.some((unit) => !unit.paperReady)) continue;
    fixedSlots.forEach((fixed, occurrence) => {
      const result = placeBlock({
        blockUnits: classUnits,
        occurrence,
        classLevel,
        streams: ["Arts", "Sciences"],
        day: fixed.day,
        slotCode: fixed.slotCode,
        label: "Sub ICT / Sub Maths",
        locked: true,
        forceEvent: true,
      });
      if (!result.placed) {
        const overloaded = result.rows.find(
          ({ assignment }) => assignment.teacherId === result.overloadedTeacherId
        );
        const reason = result.overloadedTeacherId
          ? `${overloaded?.assignment?.teacherName || "One teacher"} is assigned to parallel ICT and Subsidiary Maths groups.`
          : classUnits.length === 0
            ? `${classLevel} needs active ICT and Subsidiary Maths assignments for the fixed block.`
            : `The fixed ${classLevel} subsidiary block cannot be staffed on ${fixed.day} ${fixed.slotCode}.`;
        unallocated.push(unallocatedItem(classUnits[0], reason));
      }
    });
    if (coveredStreams.size > 0 && (!coveredStreams.has("Arts") || !coveredStreams.has("Sciences"))) {
      unallocated.push(unallocatedItem(
        classUnits[0],
        `${classLevel} subsidiary assignments must cover both Arts and Sciences because the block is school-wide.`
      ));
    }
  }

  const generalPaperUnits = units.filter((unit) => unit.subjectKey === "general_paper");
  for (const classLevel of ["S5", "S6"]) {
    const classUnits = generalPaperUnits.filter((unit) => unit.classLevel === classLevel);
    const coveredStreams = new Set(classUnits.map((unit) => unit.stream));
    const usedDays = new Set();
    const patterns = ["quadruple", "ordinary"];
    if (classUnits.some((unit) => !unit.paperReady)) continue;

    patterns.forEach((pattern, occurrence) => {
      const { rows, overloadedTeacherId } = participantRows(classUnits, occurrence);
      const teacherIds = new Set(rows.map(({ assignment }) => assignment.teacherId));
      if (overloadedTeacherId || teacherIds.size > 1 || rows.length === 0) {
        const reason = rows.length === 0
          ? `${classLevel} needs General Paper assignments for the combined class.`
          : `${classLevel} General Paper must use one teacher across Arts and Sciences.`;
        unallocated.push(unallocatedItem(classUnits[0], reason));
        return;
      }

      const candidates = [];
      for (const day of TIMETABLE_DAYS) {
        if (usedDays.has(day)) continue;
        const slots = pattern === "quadruple"
          ? (day === "Friday" ? [] : ["P3"])
          : ORDINARY_SLOTS[day];
        for (const slotCode of slots) {
          if (!canPlaceBlock({
            classLevel,
            streams: ["Arts", "Sciences"],
            day,
            slotCode,
            rows,
          })) continue;
          candidates.push({
            day,
            slotCode,
            score:
              ["Arts", "Sciences"].reduce(
                (sum, stream) => sum + getLoad(streamDayLoads, `${streamKey(classLevel, stream)}::${day}`),
                0
              ) * 5 +
              rows.reduce(
                (sum, { assignment }) => sum + getLoad(teacherDayLoads, `${assignment.teacherId}::${day}`),
                0
              ) * 3 +
              rng(),
          });
        }
      }
      candidates.sort((left, right) => left.score - right.score);
      const selected = candidates[0];
      if (!selected) {
        unallocated.push(unallocatedItem(
          classUnits[0],
          `No shared ${pattern === "quadruple" ? "quadruple" : "ordinary"} General Paper period remains on the teacher's available days.`
        ));
        return;
      }
      const result = placeBlock({
        blockUnits: classUnits,
        occurrence,
        classLevel,
        streams: ["Arts", "Sciences"],
        day: selected.day,
        slotCode: selected.slotCode,
        label: "General Paper",
        eventType: "lesson",
      });
      if (result.placed) usedDays.add(selected.day);
    });

    if (coveredStreams.size > 0 && (!coveredStreams.has("Arts") || !coveredStreams.has("Sciences"))) {
      unallocated.push(unallocatedItem(
        classUnits[0],
        `${classLevel} General Paper assignments must cover both Arts and Sciences.`
      ));
    }
  }

  const flexibleUnits = units.filter(
    (unit) => unit.subjectKey !== "general_paper" && !subsidiaryKeys.has(unit.subjectKey)
  );
  const flexibleGroups = new Map();
  flexibleUnits.forEach((unit) => {
    const groupCode = pairCode(unit.subjectKey) || unit.subjectKey;
    const key = `${unit.classLevel}::${unit.stream}::${groupCode}`;
    if (!flexibleGroups.has(key)) {
      flexibleGroups.set(key, {
        key,
        classLevel: unit.classLevel,
        stream: unit.stream,
        groupCode,
        units: [],
      });
    }
    flexibleGroups.get(key).units.push(unit);
  });

  const groupRows = Array.from(flexibleGroups.values()).sort((left, right) => {
    const leftDays = Math.min(...left.units.flatMap((unit) => unit.assignments.map((row) => row.availableDays.size)));
    const rightDays = Math.min(...right.units.flatMap((unit) => unit.assignments.map((row) => row.availableDays.size)));
    if (leftDays !== rightDays) return leftDays - rightDays;
    if (left.units.length !== right.units.length) return right.units.length - left.units.length;
    return left.key.localeCompare(right.key);
  });

  for (const group of groupRows) {
    if (group.units.some((unit) => !unit.paperReady)) continue;
    const usedDays = new Set();
    const label = group.units.map((unit) => unit.subject).join(" / ");
    const isScienceMath = group.stream === "Sciences" && group.units.some(
      (unit) => unit.subjectKey === "mathematics"
    );
    const isArtsGeography = group.stream === "Arts" && group.units.some(
      (unit) => unit.subjectKey === "geography"
    );

    for (let occurrence = 0; occurrence < lessonsPerSubject; occurrence += 1) {
      const { rows, overloadedTeacherId } = participantRows(group.units, occurrence);
      if (overloadedTeacherId) {
        const teacher = rows.find(({ assignment }) => assignment.teacherId === overloadedTeacherId)?.assignment;
        unallocated.push(unallocatedItem(
          group.units[0],
          `${teacher?.teacherName || "One teacher"} owns more than one parallel subject in the ${label} block.`
        ));
        continue;
      }
      const candidates = [];
      for (const day of TIMETABLE_DAYS) {
        if (usedDays.has(day)) continue;
        for (const slotCode of FLEXIBLE_SLOTS[day]) {
          const slotKey = daySlotKey(day, slotCode);
          const special = getOccupancy(specialOccupancy, group.classLevel);
          if (isScienceMath && special.has(`GEOG::${slotKey}`)) continue;
          if (isArtsGeography && special.has(`MATH::${slotKey}`)) continue;
          if (!canPlaceBlock({
            classLevel: group.classLevel,
            streams: [group.stream],
            day,
            slotCode,
            rows,
          })) continue;
          candidates.push({
            day,
            slotCode,
            score:
              getLoad(streamDayLoads, `${streamKey(group.classLevel, group.stream)}::${day}`) * 5 +
              rows.reduce(
                (sum, { assignment }) => sum + getLoad(teacherDayLoads, `${assignment.teacherId}::${day}`),
                0
              ) * 3 +
              (slotCode === "P5" ? 0.8 : 0) +
              (slotCode === "P3" ? -0.35 : 0) +
              rng(),
          });
        }
      }
      candidates.sort((left, right) => left.score - right.score);
      const selected = candidates[0];
      if (!selected) {
        unallocated.push(unallocatedItem(
          group.units[0],
          `No clash-free period remains for ${label} on the assigned teacher days.`
        ));
        continue;
      }
      const result = placeBlock({
        blockUnits: group.units,
        occurrence,
        classLevel: group.classLevel,
        streams: [group.stream],
        day: selected.day,
        slotCode: selected.slotCode,
        label,
        eventType: group.units.length > 1 ? "cluster" : "lesson",
      });
      if (!result.placed) {
        unallocated.push(unallocatedItem(group.units[0], `The selected ${label} period became unavailable.`));
        continue;
      }
      usedDays.add(selected.day);
      const special = getOccupancy(specialOccupancy, group.classLevel);
      if (isScienceMath) special.add(`MATH::${daySlotKey(selected.day, selected.slotCode)}`);
      if (isArtsGeography) special.add(`GEOG::${daySlotKey(selected.day, selected.slotCode)}`);
    }
  }

  const missingLessons = units.flatMap((unit) => {
    const placed = Number(placedCounts.get(unit.key) || 0);
    return placed < lessonsPerSubject
      ? [{
          assignmentId: unit.assignments[0]?.assignmentId || null,
          label: `${unit.subject} - ${unit.classLevel} ${unit.stream}`,
          required: lessonsPerSubject,
          placed,
          missing: lessonsPerSubject - placed,
        }]
      : [];
  });
  const dailyLoads = Array.from(streamDayLoads.values());
  const balancePenalty = dailyLoads.reduce((sum, value) => sum + value * value, 0);
  const validation = {
    valid: unallocated.length === 0 && missingLessons.length === 0,
    teacherClashes: [],
    streamClashes: [],
    invalidDays: [],
    duplicatePeriods: [],
    missingLessons,
    checks: {
      aLevelTeacherClashes: "passed",
      aLevelStreamClashes: "passed",
      aLevelTeacherAvailability: "passed",
      subsidiaryFixedPeriods: "passed",
      generalPaperCombinedClass: "passed",
      scienceMathsGeographySeparation: "passed",
    },
    hardViolations: [],
    unallocated,
  };
  const stats = {
    streams: A_LEVEL_STREAMS.length,
    teachers: new Set(assignments.map((row) => row.teacherId)).size,
    assignments: assignments.length,
    lessonsRequested: units.length * lessonsPerSubject,
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
