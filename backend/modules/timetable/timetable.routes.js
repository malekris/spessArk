import express from "express";
import authAdmin from "../../middleware/authAdmin.js";
import { extractClientIp, logAuditEvent } from "../../utils/auditLogger.js";
import { deriveOperationalTerm } from "../../services/adminYearSnapshotService.js";
import {
  DEFAULT_TIMETABLE_CONFIG,
  TIMETABLE_DAYS,
  defaultRequirementForAssignment,
  normalizeAlevelClassLevel,
  normalizeAlevelStream,
  normalizeClassLevel,
  normalizeStream,
  normalizeSubject,
} from "./timetable.constants.js";
import { generateSchoolTimetable } from "./timetable.school.generator.js";
import {
  aLevelSubjectUsesTwoPapers,
  canonicalAlevelSubject,
  normalizeAlevelTimetablePaperLabel,
  timetableAlevelSubjectName,
} from "./timetable.alevel.generator.js";
import { buildTeacherAvailabilityRows } from "./timetable.availability.js";
import { applyManualCredits, applyManualRemoval } from "./timetable.manual.js";
import { regenerateOLevelStreamLessons } from "./timetable.regenerator.js";
import { ensureTimetableSchemaReady } from "./timetable.schema.js";

const ALLOWED_REQUIREMENT_KINDS = new Set(["ordinary", "cluster", "project", "review"]);
const ALLOWED_VERSION_STATUSES = new Set(["draft", "frozen", "published", "archived"]);
const LOWER_RULE_V4_SUBJECTS = new Set([
  "entrepreneurship",
  "ent",
  "physical education",
  "pe",
  "kiswahili",
  "swahili",
  "cre",
  "christian religious education",
  "ire",
  "islamic religious education",
  "art",
  "agriculture",
  "agric",
  "ict",
  "information communication technology",
  "information and communication technology",
  "luganda",
  "lug",
]);
const MANUAL_ORDINARY_SLOTS = {
  Monday: new Set(["P1", "P3", "P4", "P5"]),
  Tuesday: new Set(["P1", "P2", "P3", "P4", "P5"]),
  Wednesday: new Set(["P1", "P2", "P3", "P4", "P5"]),
  Thursday: new Set(["P1", "P2", "P3", "P4", "P5"]),
  Friday: new Set(["P1", "P2", "P3A", "P4", "P5"]),
};
const MANUAL_ALEVEL_GROUPED_SUBJECTS = new Set([
  "general_paper",
  "sub_ict",
  "sub_math",
  "subsidiary_block",
  "entrepreneurship",
  "economics",
  "ent_econ",
  "literature",
  "luganda",
  "lit_lug",
]);

const parseJson = (value, fallback) => {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const mergeConfig = (value) => {
  const source = value || {};
  const needsSinglePeriodClusterUpgrade = Number(source.version || 0) < 3;
  return {
    ...DEFAULT_TIMETABLE_CONFIG,
    ...source,
    version: DEFAULT_TIMETABLE_CONFIG.version,
    clusterWindows: {
      ...DEFAULT_TIMETABLE_CONFIG.clusterWindows,
      ...(source.clusterWindows || {}),
      upper: needsSinglePeriodClusterUpgrade
        ? DEFAULT_TIMETABLE_CONFIG.clusterWindows.upper
        : source.clusterWindows?.upper || DEFAULT_TIMETABLE_CONFIG.clusterWindows.upper,
    },
    aLevel: {
      ...DEFAULT_TIMETABLE_CONFIG.aLevel,
      ...(source.aLevel || {}),
      subsidiaryBlocks: {
        ...DEFAULT_TIMETABLE_CONFIG.aLevel.subsidiaryBlocks,
        ...(source.aLevel?.subsidiaryBlocks || {}),
      },
    },
  };
};

async function readAcademicContext(pool) {
  try {
    const [[calendar]] = await pool.query(
      "SELECT academic_year, calendar_json FROM school_calendar_settings WHERE id = 1 LIMIT 1"
    );
    const academicYear = String(calendar?.academic_year || "").trim();
    if (academicYear) {
      return {
        academicYear,
        currentTerm: deriveOperationalTerm({
          academicYear,
          entries: parseJson(calendar?.calendar_json, []),
        }),
      };
    }
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
  }
  return {
    academicYear: String(new Date().getFullYear()),
    currentTerm: "Current Term",
  };
}

async function readTimetableConfig(pool) {
  const { academicYear, currentTerm } = await readAcademicContext(pool);
  const [[row]] = await pool.query(
    "SELECT academic_year, config_json, updated_at FROM timetable_settings WHERE id = 1 LIMIT 1"
  );
  const storedConfig = parseJson(row?.config_json, DEFAULT_TIMETABLE_CONFIG);
  if (Number(storedConfig?.version || 0) < 4) {
    await migrateLowerLessonRulesV4(pool);
  }
  const config = mergeConfig(storedConfig);
  if (
    String(row?.academic_year || "") !== academicYear ||
    Number(storedConfig?.version || 0) < DEFAULT_TIMETABLE_CONFIG.version
  ) {
    await pool.query(
      "UPDATE timetable_settings SET academic_year = ?, config_json = ?, updated_at = NOW() WHERE id = 1",
      [academicYear, JSON.stringify(config)]
    );
  }
  return { academicYear, currentTerm, config, updatedAt: row?.updated_at || null };
}

async function loadActiveOLevelAssignments(pool) {
  const [rows] = await pool.query(`
    SELECT
      ta.id AS assignment_id,
      ta.teacher_id,
      ta.class_level,
      ta.stream,
      ta.subject,
      t.name AS teacher_name,
      r.lessons_per_week,
      r.lesson_kind,
      r.cluster_code,
      r.enabled,
      'olevel' AS assignment_scope
    FROM teacher_assignments ta
    JOIN teachers t ON t.id = ta.teacher_id
    LEFT JOIN timetable_lesson_requirements r ON r.assignment_id = ta.id
    WHERE COALESCE(ta.assignment_status, 'active') = 'active'
      AND ta.ended_at IS NULL
    ORDER BY ta.class_level, ta.stream, ta.subject, t.name
  `);

  return rows.filter(
    (row) => normalizeClassLevel(row.class_level) && normalizeStream(row.stream)
  );
}

async function migrateLowerLessonRulesV4(pool) {
  const assignments = await loadActiveOLevelAssignments(pool);
  const affected = assignments.filter((assignment) =>
    ["S1", "S2"].includes(normalizeClassLevel(assignment.class_level)) &&
    LOWER_RULE_V4_SUBJECTS.has(normalizeSubject(assignment.subject))
  );

  for (const assignment of affected) {
    const rule = defaultRequirementForAssignment(assignment);
    const alreadyCurrent =
      Number(assignment.lessons_per_week) === rule.lessonsPerWeek &&
      String(assignment.lesson_kind || "") === rule.lessonKind &&
      String(assignment.cluster_code || "") === String(rule.clusterCode || "") &&
      Boolean(Number(assignment.enabled)) === rule.enabled;
    if (alreadyCurrent) continue;

    await pool.query(
      `INSERT INTO timetable_lesson_requirements
        (assignment_id, lessons_per_week, lesson_kind, cluster_code, enabled)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         lessons_per_week = VALUES(lessons_per_week),
         lesson_kind = VALUES(lesson_kind),
         cluster_code = VALUES(cluster_code),
         enabled = VALUES(enabled),
         updated_at = NOW()`,
      [
        assignment.assignment_id,
        rule.lessonsPerWeek,
        rule.lessonKind,
        rule.clusterCode,
        rule.enabled ? 1 : 0,
      ]
    );
  }
}

async function loadActiveALevelAssignments(pool) {
  const [rows] = await pool.query(`
    SELECT
      ats.id AS assignment_id,
      ats.teacher_id,
      ats.stream,
      ats.paper_label,
      s.name AS subject,
      t.name AS teacher_name,
      'alevel' AS assignment_scope
    FROM alevel_teacher_subjects ats
    JOIN alevel_subjects s ON s.id = ats.subject_id
    JOIN teachers t ON t.id = ats.teacher_id
    WHERE COALESCE(ats.assignment_status, 'active') = 'active'
      AND ats.ended_at IS NULL
    ORDER BY ats.stream, s.name, ats.paper_label, t.name
  `);

  return rows.filter(
    (row) => normalizeAlevelClassLevel(row.stream) && normalizeAlevelStream(row.stream)
  );
}

async function seedLessonRequirements(pool) {
  const assignments = await loadActiveOLevelAssignments(pool);
  const missing = assignments.filter((row) => row.lesson_kind === null || row.lesson_kind === undefined);
  if (missing.length === 0) return assignments;

  for (const assignment of missing) {
    const defaults = defaultRequirementForAssignment(assignment);
    await pool.query(
      `INSERT INTO timetable_lesson_requirements
        (assignment_id, lessons_per_week, lesson_kind, cluster_code, enabled)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE assignment_id = assignment_id`,
      [
        assignment.assignment_id,
        defaults.lessonsPerWeek,
        defaults.lessonKind,
        defaults.clusterCode,
        defaults.enabled ? 1 : 0,
      ]
    );
  }

  return loadActiveOLevelAssignments(pool);
}

async function attachAvailability(pool, assignments) {
  const teacherIds = [...new Set(assignments.map((row) => Number(row.teacher_id)).filter(Boolean))];
  if (teacherIds.length === 0) return assignments.map((row) => ({ ...row, available_days: [] }));
  const placeholders = teacherIds.map(() => "?").join(",");
  const [availabilityRows] = await pool.query(
    `SELECT teacher_id, day_of_week
     FROM timetable_teacher_availability
     WHERE teacher_id IN (${placeholders})
     ORDER BY teacher_id, preference_rank,
              FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')`,
    teacherIds
  );
  const byTeacher = new Map();
  availabilityRows.forEach((row) => {
    const teacherId = Number(row.teacher_id);
    if (!byTeacher.has(teacherId)) byTeacher.set(teacherId, []);
    byTeacher.get(teacherId).push(row.day_of_week);
  });
  return assignments.map((row) => ({
    ...row,
    normalized_class_level: row.assignment_scope === "alevel"
      ? normalizeAlevelClassLevel(row.stream)
      : normalizeClassLevel(row.class_level),
    normalized_stream: row.assignment_scope === "alevel"
      ? normalizeAlevelStream(row.stream)
      : normalizeStream(row.stream),
    available_days: byTeacher.get(Number(row.teacher_id)) || [],
  }));
}

function buildReadiness(assignments) {
  const teacherRows = buildTeacherAvailabilityRows(assignments);
  const reviewAssignments = assignments.filter(
    (row) => String(row.lesson_kind || "") === "review"
  );
  const invalidAvailability = teacherRows.filter(
    (row) => row.availabilityRequired &&
      (row.availableDays.length < 1 || row.availableDays.length > 4)
  );
  const availabilityExemptTeachers = teacherRows.filter((row) => !row.availabilityRequired);
  const aLevelAssignments = assignments.filter((row) => row.assignment_scope === "alevel");
  const aLevelCoverageIssues = [];
  const aLevelPaperIssues = [];
  const coverageRules = {
    Arts: [
      ["History", ["history"]],
      ["ENT / Economics", ["entrepreneurship", "economics", "ent_econ"]],
      ["Geography", ["geography"]],
      ["Art", ["art"]],
      ["Divinity", ["divinity"]],
      ["Literature / Luganda", ["literature", "luganda", "lit_lug"]],
      ["General Paper", ["general_paper"]],
    ],
    Sciences: [
      ["Mathematics", ["mathematics"]],
      ["Chemistry", ["chemistry"]],
      ["Physics", ["physics"]],
      ["Biology", ["biology"]],
      ["ENT / Economics", ["entrepreneurship", "economics", "ent_econ"]],
      ["Agriculture", ["agriculture"]],
      ["General Paper", ["general_paper"]],
    ],
  };

  for (const classLevel of ["S5", "S6"]) {
    for (const stream of ["Arts", "Sciences"]) {
      const subjectKeys = new Set(
        aLevelAssignments
          .filter((row) =>
            row.normalized_class_level === classLevel && row.normalized_stream === stream
          )
          .map((row) => canonicalAlevelSubject(row.subject))
      );
      for (const [label, acceptedKeys] of coverageRules[stream]) {
        if (!acceptedKeys.some((key) => subjectKeys.has(key))) {
          aLevelCoverageIssues.push({ classLevel, stream, subjectGroup: label });
        }
      }
      const combinedSubsidiary = subjectKeys.has("subsidiary_block");
      if (!combinedSubsidiary && !subjectKeys.has("sub_ict")) {
        aLevelCoverageIssues.push({ classLevel, stream, subjectGroup: "Sub ICT" });
      }
      if (!combinedSubsidiary && !subjectKeys.has("sub_math")) {
        aLevelCoverageIssues.push({ classLevel, stream, subjectGroup: "Subsidiary Maths" });
      }
    }
  }

  const paperGroups = new Map();
  aLevelAssignments.forEach((row) => {
    const classLevel = row.normalized_class_level;
    const stream = row.normalized_stream;
    const subjectKey = canonicalAlevelSubject(row.subject);
    const key = `${classLevel}::${stream}::${subjectKey}`;
    if (!paperGroups.has(key)) {
      paperGroups.set(key, {
        classLevel,
        stream,
        subject: timetableAlevelSubjectName(row.subject),
        rows: [],
      });
    }
    paperGroups.get(key).rows.push(row);
  });

  paperGroups.forEach((group) => {
    const expectedPapers = aLevelSubjectUsesTwoPapers(group.subject)
      ? ["Paper 1", "Paper 2"]
      : ["Single"];
    const invalid = expectedPapers.flatMap((paperLabel) => {
      const count = group.rows.filter(
        (row) => normalizeAlevelTimetablePaperLabel(row.paper_label) === paperLabel
      ).length;
      if (count === 1) return [];
      return [{ paperLabel, count }];
    });
    if (invalid.length === 0) return;

    const details = invalid.map(({ paperLabel, count }) =>
      count === 0
        ? `${paperLabel} is missing`
        : `${paperLabel} has ${count} active teachers`
    ).join("; ");
    aLevelPaperIssues.push({
      classLevel: group.classLevel,
      stream: group.stream,
      subjectGroup: group.subject,
      message: `${group.subject}: ${details}. Keep exactly one active assignment for each required paper.`,
    });
  });

  return {
    ready:
      reviewAssignments.length === 0 &&
      invalidAvailability.length === 0 &&
      aLevelCoverageIssues.length === 0 &&
      aLevelPaperIssues.length === 0,
    assignments: assignments.length,
    configuredAssignments: assignments.length - reviewAssignments.length,
    teachers: teacherRows.length,
    configuredTeachers: teacherRows.length - invalidAvailability.length,
    reviewAssignments: reviewAssignments.map((row) => ({
      assignmentId: Number(row.assignment_id),
      classLevel: row.normalized_class_level,
      stream: row.normalized_stream,
      subject: row.subject,
      teacherName: row.teacher_name,
    })),
    teachersNeedingAvailability: invalidAvailability.map((row) => ({
      teacherId: row.teacherId,
      teacherName: row.teacherName,
      selectedDays: row.availableDays.length,
    })),
    availabilityExemptTeachers: availabilityExemptTeachers.map((row) => ({
      teacherId: row.teacherId,
      teacherName: row.teacherName,
      reason: row.availabilityExemptReason,
    })),
    aLevelCoverageIssues,
    aLevelPaperIssues,
  };
}

function describeReadinessBlockers(readiness) {
  return [
    ...(readiness.teachersNeedingAvailability || []).map(
      (teacher) => `${teacher.teacherName} needs 1-4 weekday availability days.`
    ),
    ...(readiness.reviewAssignments || []).map(
      (assignment) =>
        `${assignment.classLevel} ${assignment.stream}: review the ${assignment.subject} lesson rule.`
    ),
    ...(readiness.aLevelCoverageIssues || []).map(
      (issue) => `${issue.classLevel} ${issue.stream}: assign ${issue.subjectGroup}.`
    ),
    ...(readiness.aLevelPaperIssues || []).map(
      (issue) => `${issue.classLevel} ${issue.stream}: ${issue.message}`
    ),
  ];
}

async function readVersions(pool) {
  const [rows] = await pool.query(`
    SELECT id, academic_year, name, status, generation_stats_json, validation_json,
           created_by_admin_id, created_at, updated_at, published_at
    FROM timetable_versions
    ORDER BY created_at DESC
    LIMIT 30
  `);
  return rows.map((row) => ({
    id: Number(row.id),
    academicYear: row.academic_year,
    name: row.name,
    status: row.status,
    stats: parseJson(row.generation_stats_json, {}),
    validation: parseJson(row.validation_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  }));
}

async function readVersionDetail(pool, versionId) {
  const [[row]] = await pool.query(
    `SELECT id, academic_year, name, status, generation_stats_json, validation_json,
            created_at, updated_at, published_at
     FROM timetable_versions WHERE id = ? LIMIT 1`,
    [versionId]
  );
  if (!row) return null;
  const [events] = await pool.query(
    `SELECT id, class_level, stream, day_of_week, slot_code, event_type, subject_label,
            assignment_id, teacher_id, teacher_name, block_key, is_locked, is_manual
     FROM timetable_events
     WHERE version_id = ?
     ORDER BY FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'),
              FIELD(slot_code, 'P1', 'P2', 'P3', 'P3A', 'CHURCH', 'P4', 'P5'),
              class_level, stream`,
    [versionId]
  );
  const [sessions] = await pool.query(
    `SELECT id, event_id, teacher_id, teacher_name, assignment_id, subject_label,
            class_level, streams_label, day_of_week, slot_code, block_key
     FROM timetable_teacher_sessions
     WHERE version_id = ?
     ORDER BY teacher_name,
              FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'),
              FIELD(slot_code, 'P1', 'P2', 'P3', 'P3A', 'P4', 'P5')`,
    [versionId]
  );

  return {
    id: Number(row.id),
    academicYear: row.academic_year,
    name: row.name,
    status: row.status,
    stats: parseJson(row.generation_stats_json, {}),
    validation: parseJson(row.validation_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    events: events.map((event) => ({
      id: Number(event.id),
      classLevel: event.class_level,
      stream: event.stream,
      day: event.day_of_week,
      slotCode: event.slot_code,
      eventType: event.event_type,
      subjectLabel: event.subject_label,
      assignmentId: event.assignment_id ? Number(event.assignment_id) : null,
      teacherId: event.teacher_id ? Number(event.teacher_id) : null,
      teacherName: event.teacher_name,
      blockKey: event.block_key,
      isLocked: Boolean(Number(event.is_locked)),
      isManual: Boolean(Number(event.is_manual)),
    })),
    sessions: sessions.map((session) => ({
      id: Number(session.id),
      eventId: session.event_id ? Number(session.event_id) : null,
      teacherId: Number(session.teacher_id),
      teacherName: session.teacher_name,
      assignmentId: Number(session.assignment_id),
      subjectLabel: session.subject_label,
      classLevel: session.class_level,
      streamsLabel: session.streams_label,
      day: session.day_of_week,
      slotCode: session.slot_code,
      blockKey: session.block_key,
    })),
  };
}

export default function createTimetableRoutes(pool) {
  const router = express.Router();
  router.use(authAdmin);
  router.use(async (_req, res, next) => {
    try {
      await ensureTimetableSchemaReady(pool);
      next();
    } catch (error) {
      console.error("Timetable schema setup failed:", error);
      res.status(500).json({ message: "Timetable storage could not be prepared." });
    }
  });

  const readDraftEvent = async (executor, versionId, eventId, forUpdate = false) => {
    const [[event]] = await executor.query(
      `SELECT e.id, e.version_id, e.class_level, e.stream, e.day_of_week, e.slot_code,
              e.event_type, e.subject_label, e.assignment_id, e.teacher_id, e.teacher_name,
              e.block_key, e.is_locked, e.is_manual, v.status AS version_status, v.name AS version_name
       FROM timetable_events e
       JOIN timetable_versions v ON v.id = e.version_id
       WHERE e.id = ? AND e.version_id = ?
       LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [eventId, versionId]
    );
    return event || null;
  };

  const validateManualTarget = async (
    executor,
    versionId,
    event,
    targetDay,
    targetSlotCode,
    excludedEventIds = []
  ) => {
    if (!TIMETABLE_DAYS.includes(targetDay) || !MANUAL_ORDINARY_SLOTS[targetDay]?.has(targetSlotCode)) {
      return "Choose a schedulable ordinary lesson period.";
    }
    const excluded = [...new Set(excludedEventIds.map(Number).filter(Boolean))];
    const exclusionSql = excluded.length > 0
      ? `AND id NOT IN (${excluded.map(() => "?").join(",")})`
      : "";
    const [[streamConflict]] = await executor.query(
      `SELECT id FROM timetable_events
       WHERE version_id = ? AND class_level = ? AND stream = ?
         AND day_of_week = ? AND slot_code = ? ${exclusionSql}
       LIMIT 1`,
      [versionId, event.class_level, event.stream, targetDay, targetSlotCode, ...excluded]
    );
    if (streamConflict) return `${event.class_level} ${event.stream} already has an event in that period.`;

    const [[availability]] = await executor.query(
      `SELECT id FROM timetable_teacher_availability
       WHERE teacher_id = ? AND day_of_week = ? LIMIT 1`,
      [event.teacher_id, targetDay]
    );
    if (!availability) return `${event.teacher_name} is not available on ${targetDay}.`;

    const sessionExclusionSql = excluded.length > 0
      ? `AND (event_id IS NULL OR event_id NOT IN (${excluded.map(() => "?").join(",")}))`
      : "";
    const [[teacherConflict]] = await executor.query(
      `SELECT id FROM timetable_teacher_sessions
       WHERE version_id = ? AND teacher_id = ? AND day_of_week = ? AND slot_code = ?
         ${sessionExclusionSql}
       LIMIT 1`,
      [versionId, event.teacher_id, targetDay, targetSlotCode, ...excluded]
    );
    if (teacherConflict) return `${event.teacher_name} already teaches another class in that period.`;

    const [[sameDaySubject]] = await executor.query(
      `SELECT id FROM timetable_events
       WHERE version_id = ? AND class_level = ? AND stream = ? AND subject_label = ?
         AND day_of_week = ? ${exclusionSql}
       LIMIT 1`,
      [versionId, event.class_level, event.stream, event.subject_label, targetDay, ...excluded]
    );
    if (sameDaySubject) return `${event.subject_label} already appears on ${targetDay} for this stream.`;
    return "";
  };

  const buildManualInsertionPlan = async (executor, versionId, payload, { lockVersion = false } = {}) => {
    const mode = String(payload?.mode || "subject").trim().toLowerCase();
    const day = String(payload?.day || "").trim();
    const slotCode = String(payload?.slotCode || "").trim().toUpperCase();
    const conflicts = [];
    const warnings = [];
    const [[versionRow]] = await executor.query(
      `SELECT id, name, status, generation_stats_json, validation_json
       FROM timetable_versions WHERE id = ? LIMIT 1${lockVersion ? " FOR UPDATE" : ""}`,
      [versionId]
    );
    if (!versionRow) {
      return { valid: false, status: 404, conflicts: ["Timetable version not found."], warnings };
    }
    if (versionRow.status !== "draft") {
      return { valid: false, status: 409, conflicts: ["Manual lessons can only be added to a draft timetable."], warnings };
    }
    if (!TIMETABLE_DAYS.includes(day) || !MANUAL_ORDINARY_SLOTS[day]?.has(slotCode)) {
      return { valid: false, status: 400, conflicts: ["Choose a schedulable school day and period."], warnings };
    }

    const plan = {
      mode,
      day,
      slotCode,
      label: "",
      classLevel: "",
      streams: [],
      events: [],
      sessions: [],
      credits: [],
      requiredLessons: 0,
      conflicts,
      warnings,
      versionRow,
    };

    if (mode === "subject") {
      const scope = String(payload?.scope || "olevel").trim().toLowerCase();
      const assignmentId = Number(payload?.assignmentId);
      if (!assignmentId || !["olevel", "alevel"].includes(scope)) {
        conflicts.push("Choose a valid subject assignment.");
        return { ...plan, valid: false, status: 400 };
      }

      let assignment = null;
      if (scope === "olevel") {
        const [[row]] = await executor.query(
          `SELECT ta.id AS assignment_id, ta.teacher_id, ta.class_level, ta.stream, ta.subject,
                  t.name AS teacher_name, r.lessons_per_week, r.lesson_kind, r.cluster_code, r.enabled
           FROM teacher_assignments ta
           JOIN teachers t ON t.id = ta.teacher_id
           LEFT JOIN timetable_lesson_requirements r ON r.assignment_id = ta.id
           WHERE ta.id = ? AND COALESCE(ta.assignment_status, 'active') = 'active'
             AND ta.ended_at IS NULL LIMIT 1`,
          [assignmentId]
        );
        if (row) {
          const fallback = defaultRequirementForAssignment(row);
          assignment = {
            assignmentId,
            teacherId: Number(row.teacher_id),
            teacherName: row.teacher_name,
            classLevel: normalizeClassLevel(row.class_level),
            stream: normalizeStream(row.stream),
            subjectLabel: String(row.subject || "").trim(),
            lessonKind: String(row.lesson_kind || fallback.lessonKind).toLowerCase(),
            enabled: row.enabled === null || row.enabled === undefined
              ? fallback.enabled
              : Boolean(Number(row.enabled)),
            requiredLessons: Number(row.lessons_per_week ?? fallback.lessonsPerWeek),
            scope,
          };
        }
      } else {
        const [[row]] = await executor.query(
          `SELECT ats.id AS assignment_id, ats.teacher_id, ats.stream, ats.paper_label,
                  s.name AS subject, t.name AS teacher_name
           FROM alevel_teacher_subjects ats
           JOIN alevel_subjects s ON s.id = ats.subject_id
           JOIN teachers t ON t.id = ats.teacher_id
           WHERE ats.id = ? AND COALESCE(ats.assignment_status, 'active') = 'active'
             AND ats.ended_at IS NULL LIMIT 1`,
          [assignmentId]
        );
        if (row) {
          const subjectKey = canonicalAlevelSubject(row.subject);
          assignment = {
            assignmentId,
            teacherId: Number(row.teacher_id),
            teacherName: row.teacher_name,
            classLevel: normalizeAlevelClassLevel(row.stream),
            stream: normalizeAlevelStream(row.stream),
            subjectLabel: timetableAlevelSubjectName(row.subject),
            subjectKey,
            paperLabel: normalizeAlevelTimetablePaperLabel(row.paper_label),
            lessonKind: "ordinary",
            enabled: !MANUAL_ALEVEL_GROUPED_SUBJECTS.has(subjectKey),
            requiredLessons: Number(DEFAULT_TIMETABLE_CONFIG.aLevel?.lessonsPerSubject || 2),
            scope,
          };
        }
      }

      if (!assignment || !assignment.classLevel || !assignment.stream) {
        conflicts.push("The selected assignment is no longer active.");
        return { ...plan, valid: false, status: 404 };
      }
      if (!assignment.enabled || assignment.lessonKind !== "ordinary") {
        conflicts.push(scope === "alevel"
          ? "This A-Level subject belongs to a combined or fixed block. Add it through its group rather than as an individual lesson."
          : "This assignment belongs to a cluster or fixed lesson. Choose Cluster mode instead.");
        return { ...plan, valid: false, status: 409 };
      }

      plan.label = assignment.subjectLabel;
      plan.classLevel = assignment.classLevel;
      plan.streams = [assignment.stream];
      plan.requiredLessons = assignment.requiredLessons;
      plan.events.push({
        classLevel: assignment.classLevel,
        stream: assignment.stream,
        eventType: "lesson",
        subjectLabel: assignment.subjectLabel,
        assignmentId: assignment.assignmentId,
        teacherId: assignment.teacherId,
        teacherName: assignment.teacherName,
        blockKey: null,
      });
      plan.sessions.push({
        teacherId: assignment.teacherId,
        teacherName: assignment.teacherName,
        assignmentId: assignment.assignmentId,
        subjectLabel: assignment.subjectLabel,
        classLevel: assignment.classLevel,
        streamsLabel: assignment.stream,
        blockKey: null,
      });
      plan.credits.push({
        assignmentId: assignment.assignmentId,
        classLevel: assignment.classLevel,
        stream: assignment.stream,
        subjectLabel: assignment.subjectLabel,
      });
    } else if (mode === "cluster") {
      const classLevel = normalizeClassLevel(payload?.classLevel);
      const clusterCode = String(payload?.clusterCode || "").trim().toUpperCase();
      if (!classLevel || !["VOCATIONAL", "OTHERS"].includes(clusterCode)) {
        conflicts.push("Choose a valid O-Level class and cluster.");
        return { ...plan, valid: false, status: 400 };
      }
      const lowerVocational = ["S1", "S2"].includes(classLevel) && clusterCode === "VOCATIONAL";
      if (lowerVocational && (day === "Friday" || slotCode !== "P3")) {
        conflicts.push(`${classLevel} Vocational must remain in the Monday-Thursday P3 block.`);
      } else if (slotCode === "P3A") {
        conflicts.push("The Friday short lesson is reserved for individual subjects, not clusters.");
      }

      const activeAssignments = await loadActiveOLevelAssignments(executor);
      const assignments = activeAssignments.filter((row) =>
        normalizeClassLevel(row.class_level) === classLevel &&
        String(row.lesson_kind || "").toUpperCase() === "CLUSTER" &&
        String(row.cluster_code || "").toUpperCase() === clusterCode &&
        Boolean(Number(row.enabled))
      );
      if (assignments.length === 0) {
        conflicts.push(`No active ${classLevel} ${clusterCode.toLowerCase()} assignments were found.`);
        return { ...plan, valid: false, status: 404 };
      }
      const coveredStreams = new Set(assignments.map((row) => normalizeStream(row.stream)).filter(Boolean));
      if (!coveredStreams.has("North") || !coveredStreams.has("South")) {
        conflicts.push(`${classLevel} ${clusterCode.toLowerCase()} assignments must cover both North and South before the block can be added.`);
      }

      const label = clusterCode === "VOCATIONAL"
        ? "Vocational Cluster"
        : ["S1", "S2"].includes(classLevel)
          ? "CRE / IRE"
          : "Other Subjects Cluster";
      const teacherSubjects = new Map();
      assignments.forEach((assignment) => {
        const teacherId = Number(assignment.teacher_id);
        if (!teacherSubjects.has(teacherId)) teacherSubjects.set(teacherId, new Set());
        teacherSubjects.get(teacherId).add(normalizeSubject(assignment.subject));
      });
      const overloadedTeacher = Array.from(teacherSubjects.entries()).find(([, subjects]) => subjects.size > 1);
      if (overloadedTeacher) {
        const assignment = assignments.find((row) => Number(row.teacher_id) === overloadedTeacher[0]);
        conflicts.push(`${assignment?.teacher_name || "One teacher"} owns more than one parallel subject in this cluster.`);
      }

      plan.label = label;
      plan.classLevel = classLevel;
      plan.streams = ["North", "South"];
      plan.clusterCode = clusterCode;
      plan.requiredLessons = Math.max(...assignments.map((row) => Number(row.lessons_per_week || 0)));
      for (const stream of plan.streams) {
        plan.events.push({
          classLevel,
          stream,
          eventType: "cluster",
          subjectLabel: label,
          assignmentId: null,
          teacherId: null,
          teacherName: null,
          blockKey: "__MANUAL_CLUSTER__",
        });
      }
      const uniqueSessions = new Map();
      assignments.forEach((assignment) => {
        const key = `${Number(assignment.teacher_id)}::${normalizeSubject(assignment.subject)}`;
        if (!uniqueSessions.has(key)) uniqueSessions.set(key, []);
        uniqueSessions.get(key).push(assignment);
        plan.credits.push({
          assignmentId: Number(assignment.assignment_id),
          classLevel,
          stream: normalizeStream(assignment.stream),
          subjectLabel: assignment.subject,
        });
      });
      uniqueSessions.forEach((rows) => {
        const assignment = rows[0];
        plan.sessions.push({
          teacherId: Number(assignment.teacher_id),
          teacherName: assignment.teacher_name,
          assignmentId: Number(assignment.assignment_id),
          subjectLabel: assignment.subject,
          classLevel,
          streamsLabel: [...new Set(rows.map((row) => normalizeStream(row.stream)).filter(Boolean))].join(" & "),
          blockKey: "__MANUAL_CLUSTER__",
        });
      });
    } else {
      conflicts.push("Choose Subject or Cluster mode.");
      return { ...plan, valid: false, status: 400 };
    }

    for (const event of plan.events) {
      const [[occupied]] = await executor.query(
        `SELECT subject_label FROM timetable_events
         WHERE version_id = ? AND class_level = ? AND stream = ?
           AND day_of_week = ? AND slot_code = ? LIMIT 1`,
        [versionId, event.classLevel, event.stream, day, slotCode]
      );
      if (occupied) {
        conflicts.push(`${event.classLevel} ${event.stream} already has ${occupied.subject_label} in ${day} ${slotCode}.`);
      }
    }

    for (const session of plan.sessions) {
      const [[availability]] = await executor.query(
        `SELECT id FROM timetable_teacher_availability
         WHERE teacher_id = ? AND day_of_week = ? LIMIT 1`,
        [session.teacherId, day]
      );
      if (!availability) conflicts.push(`${session.teacherName} is not available on ${day}.`);
      const [[teacherConflict]] = await executor.query(
        `SELECT subject_label, class_level, streams_label FROM timetable_teacher_sessions
         WHERE version_id = ? AND teacher_id = ? AND day_of_week = ? AND slot_code = ? LIMIT 1`,
        [versionId, session.teacherId, day, slotCode]
      );
      if (teacherConflict) {
        conflicts.push(`${session.teacherName} already teaches ${teacherConflict.subject_label} in ${teacherConflict.class_level} ${teacherConflict.streams_label}.`);
      }
    }

    const [[sameDay]] = await executor.query(
      `SELECT id FROM timetable_events
       WHERE version_id = ? AND class_level = ? AND stream = ?
         AND subject_label = ? AND day_of_week = ? LIMIT 1`,
      [versionId, plan.classLevel, plan.streams[0], plan.label, day]
    );
    if (sameDay) conflicts.push(`${plan.label} already appears on ${day} for ${plan.classLevel} ${plan.streams.join(" & ")}.`);

    const [[existingCount]] = await executor.query(
      `SELECT COUNT(DISTINCT CONCAT(day_of_week, '::', slot_code)) AS lesson_count
       FROM timetable_events
       WHERE version_id = ? AND class_level = ? AND stream = ? AND subject_label = ?`,
      [versionId, plan.classLevel, plan.streams[0], plan.label]
    );
    const scheduledLessons = Number(existingCount?.lesson_count || 0);
    if (plan.requiredLessons > 0 && scheduledLessons >= plan.requiredLessons) {
      warnings.push(`${plan.label} already has ${scheduledLessons}/${plan.requiredLessons} required weekly lessons. This will be an extra lesson.`);
    }

    plan.valid = conflicts.length === 0;
    plan.status = plan.valid ? 200 : 409;
    plan.scheduledLessons = scheduledLessons;
    return plan;
  };

  const publicManualPlan = (plan) => ({
    valid: Boolean(plan.valid),
    conflicts: [...new Set(plan.conflicts || [])],
    warnings: [...new Set(plan.warnings || [])],
    summary: plan.label ? {
      mode: plan.mode,
      label: plan.label,
      classLevel: plan.classLevel,
      streams: plan.streams,
      teacherNames: [...new Set((plan.sessions || []).map((session) => session.teacherName))],
      day: plan.day,
      slotCode: plan.slotCode,
      scheduledLessons: plan.scheduledLessons,
      requiredLessons: plan.requiredLessons,
      locked: true,
    } : null,
  });

  const buildManualRemovalPlan = async (
    executor,
    versionId,
    eventId,
    { lockVersion = false } = {}
  ) => {
    const conflicts = [];
    const warnings = [];
    const [[versionRow]] = await executor.query(
      `SELECT id, name, status, generation_stats_json, validation_json
       FROM timetable_versions WHERE id = ? LIMIT 1${lockVersion ? " FOR UPDATE" : ""}`,
      [versionId]
    );
    if (!versionRow) {
      return { valid: false, status: 404, conflicts: ["Timetable version not found."], warnings };
    }
    if (versionRow.status !== "draft") {
      return {
        valid: false,
        status: 409,
        conflicts: ["Lessons can only be deleted from a draft timetable."],
        warnings,
        versionRow,
      };
    }

    const [[selectedEvent]] = await executor.query(
      `SELECT id, version_id, class_level, stream, day_of_week, slot_code, event_type,
              subject_label, assignment_id, teacher_id, teacher_name, block_key,
              is_locked, is_manual, created_at, updated_at
       FROM timetable_events
       WHERE version_id = ? AND id = ? LIMIT 1${lockVersion ? " FOR UPDATE" : ""}`,
      [versionId, eventId]
    );
    if (!selectedEvent) {
      return {
        valid: false,
        status: 404,
        conflicts: ["The selected timetable lesson no longer exists."],
        warnings,
        versionRow,
      };
    }
    if (!["lesson", "cluster"].includes(String(selectedEvent.event_type || "").toLowerCase())) {
      return {
        valid: false,
        status: 409,
        conflicts: ["Assembly, church and project periods cannot be deleted here."],
        warnings,
        versionRow,
      };
    }

    const blockKey = String(selectedEvent.block_key || "").trim();
    const [events] = blockKey
      ? await executor.query(
          `SELECT id, version_id, class_level, stream, day_of_week, slot_code, event_type,
                  subject_label, assignment_id, teacher_id, teacher_name, block_key,
                  is_locked, is_manual, created_at, updated_at
           FROM timetable_events
           WHERE version_id = ? AND block_key = ?${lockVersion ? " FOR UPDATE" : ""}`,
          [versionId, blockKey]
        )
      : await executor.query(
          `SELECT id, version_id, class_level, stream, day_of_week, slot_code, event_type,
                  subject_label, assignment_id, teacher_id, teacher_name, block_key,
                  is_locked, is_manual, created_at, updated_at
           FROM timetable_events
           WHERE version_id = ? AND id = ?${lockVersion ? " FOR UPDATE" : ""}`,
          [versionId, eventId]
        );
    const eventIds = events.map((row) => Number(row.id));
    const [sessions] = blockKey
      ? await executor.query(
          `SELECT id, version_id, event_id, teacher_id, teacher_name, assignment_id,
                  subject_label, class_level, streams_label, day_of_week, slot_code,
                  block_key, created_at
           FROM timetable_teacher_sessions
           WHERE version_id = ? AND block_key = ?${lockVersion ? " FOR UPDATE" : ""}`,
          [versionId, blockKey]
        )
      : eventIds.length > 0
        ? await executor.query(
            `SELECT id, version_id, event_id, teacher_id, teacher_name, assignment_id,
                    subject_label, class_level, streams_label, day_of_week, slot_code,
                    block_key, created_at
             FROM timetable_teacher_sessions
             WHERE version_id = ? AND event_id IN (${eventIds.map(() => "?").join(",")})${lockVersion ? " FOR UPDATE" : ""}`,
            [versionId, ...eventIds]
          )
        : [[]];

    const impacts = [];
    const selectedClass = normalizeClassLevel(selectedEvent.class_level) ||
      normalizeAlevelClassLevel(selectedEvent.class_level);
    const isOLevel = ["S1", "S2", "S3", "S4"].includes(selectedClass);
    const selectedIsCluster = events.some((event) => event.event_type === "cluster");

    if (isOLevel && selectedIsCluster) {
      const clusterCode = String(selectedEvent.subject_label || "").toLowerCase().includes("vocational")
        ? "VOCATIONAL"
        : "OTHERS";
      const assignments = (await loadActiveOLevelAssignments(executor)).filter((row) =>
        normalizeClassLevel(row.class_level) === selectedClass &&
        String(row.lesson_kind || "").trim().toUpperCase() === "CLUSTER" &&
        String(row.cluster_code || "").trim().toUpperCase() === clusterCode &&
        Boolean(Number(row.enabled))
      );
      for (const assignment of assignments) {
        const stream = normalizeStream(assignment.stream);
        const fallback = defaultRequirementForAssignment(assignment);
        const requiredLessons = Number(assignment.lessons_per_week ?? fallback.lessonsPerWeek);
        const [[countRow]] = await executor.query(
          `SELECT COUNT(DISTINCT CONCAT(day_of_week, '::', slot_code)) AS lesson_count
           FROM timetable_events
           WHERE version_id = ? AND class_level = ? AND stream = ?
             AND event_type = 'cluster' AND subject_label = ?`,
          [versionId, selectedClass, stream, selectedEvent.subject_label]
        );
        const removedSlots = new Set(
          events
            .filter((event) => event.class_level === selectedClass && normalizeStream(event.stream) === stream)
            .map((event) => `${event.day_of_week}::${event.slot_code}`)
        ).size;
        const scheduledBefore = Number(countRow?.lesson_count || 0);
        impacts.push({
          assignmentId: Number(assignment.assignment_id),
          teacherId: Number(assignment.teacher_id),
          teacherName: assignment.teacher_name,
          subjectLabel: assignment.subject,
          classLevel: selectedClass,
          stream,
          requiredLessons,
          scheduledBefore,
          scheduledAfter: Math.max(0, scheduledBefore - removedSlots),
        });
      }
    } else if (isOLevel) {
      const assignmentIds = [...new Set([
        ...events.map((event) => Number(event.assignment_id)),
        ...sessions.map((session) => Number(session.assignment_id)),
      ].filter(Boolean))];
      if (assignmentIds.length > 0) {
        const [assignments] = await executor.query(
          `SELECT ta.id AS assignment_id, ta.teacher_id, ta.class_level, ta.stream, ta.subject,
                  t.name AS teacher_name, r.lessons_per_week, r.lesson_kind, r.cluster_code, r.enabled
           FROM teacher_assignments ta
           LEFT JOIN teachers t ON t.id = ta.teacher_id
           LEFT JOIN timetable_lesson_requirements r ON r.assignment_id = ta.id
           WHERE ta.id IN (${assignmentIds.map(() => "?").join(",")})`,
          assignmentIds
        );
        for (const assignment of assignments) {
          const fallback = defaultRequirementForAssignment(assignment);
          const requiredLessons = Number(assignment.lessons_per_week ?? fallback.lessonsPerWeek);
          const [[countRow]] = await executor.query(
            `SELECT COUNT(DISTINCT CONCAT(day_of_week, '::', slot_code)) AS lesson_count
             FROM timetable_events WHERE version_id = ? AND assignment_id = ?`,
            [versionId, assignment.assignment_id]
          );
          const removedSlots = new Set(
            events
              .filter((event) => Number(event.assignment_id) === Number(assignment.assignment_id))
              .map((event) => `${event.day_of_week}::${event.slot_code}`)
          ).size;
          const scheduledBefore = Number(countRow?.lesson_count || 0);
          impacts.push({
            assignmentId: Number(assignment.assignment_id),
            teacherId: Number(assignment.teacher_id),
            teacherName: assignment.teacher_name,
            subjectLabel: assignment.subject,
            classLevel: normalizeClassLevel(assignment.class_level),
            stream: normalizeStream(assignment.stream),
            requiredLessons,
            scheduledBefore,
            scheduledAfter: Math.max(0, scheduledBefore - removedSlots),
          });
        }
      }
    } else {
      const [allSessions] = await executor.query(
        `SELECT ts.id, ts.assignment_id, ts.teacher_id, ts.teacher_name, ts.subject_label,
                ts.class_level, ts.streams_label, ts.day_of_week, ts.slot_code,
                ats.subject_id, ats.stream AS assignment_stream, s.name AS assignment_subject
         FROM timetable_teacher_sessions ts
         LEFT JOIN alevel_teacher_subjects ats ON ats.id = ts.assignment_id
         LEFT JOIN alevel_subjects s ON s.id = ats.subject_id
         WHERE ts.version_id = ? AND ts.class_level IN ('S5', 'S6')`,
        [versionId]
      );
      const removedSessionIds = new Set(sessions.map((session) => Number(session.id)));
      const affectedKeys = new Set();
      const unitRows = new Map();
      for (const session of allSessions) {
        if (!session.subject_id) continue;
        const coveredStreams = String(session.streams_label || "")
          .split("&")
          .map((stream) => normalizeAlevelStream(stream))
          .filter(Boolean);
        const streams = coveredStreams.length > 0
          ? coveredStreams
          : [normalizeAlevelStream(session.assignment_stream)].filter(Boolean);
        for (const stream of streams) {
          const key = `${session.class_level}::${stream}::${session.subject_id}`;
          if (!unitRows.has(key)) unitRows.set(key, []);
          unitRows.get(key).push(session);
          if (removedSessionIds.has(Number(session.id))) affectedKeys.add(key);
        }
      }

      for (const key of affectedKeys) {
        const rows = unitRows.get(key) || [];
        const [classLevel, stream] = key.split("::");
        const subjectId = Number(key.split("::")[2]);
        const slotsBefore = new Set(rows.map((row) => `${row.day_of_week}::${row.slot_code}`));
        const removedSlots = new Set(
          rows
            .filter((row) => removedSessionIds.has(Number(row.id)))
            .map((row) => `${row.day_of_week}::${row.slot_code}`)
        );
        const representative = rows[0] || {};
        const [[assignment]] = await executor.query(
          `SELECT ats.id, ats.teacher_id, t.name AS teacher_name
           FROM alevel_teacher_subjects ats
           LEFT JOIN teachers t ON t.id = ats.teacher_id
           WHERE ats.subject_id = ? AND ats.stream = ?
           ORDER BY CASE WHEN COALESCE(ats.assignment_status, 'active') = 'active' AND ats.ended_at IS NULL THEN 0 ELSE 1 END,
                    ats.id DESC LIMIT 1`,
          [subjectId, `${classLevel} ${stream}`]
        );
        const scheduledBefore = slotsBefore.size;
        impacts.push({
          assignmentId: Number(assignment?.id || representative.assignment_id) || null,
          teacherId: Number(assignment?.teacher_id || representative.teacher_id) || null,
          teacherName: assignment?.teacher_name || representative.teacher_name,
          subjectLabel: representative.assignment_subject || representative.subject_label,
          classLevel,
          stream,
          requiredLessons: Number(DEFAULT_TIMETABLE_CONFIG.aLevel?.lessonsPerSubject || 2),
          scheduledBefore,
          scheduledAfter: Math.max(0, scheduledBefore - removedSlots.size),
        });
      }
    }

    const createsShortage = impacts.some((impact) =>
      Number(impact.scheduledAfter) < Number(impact.requiredLessons)
    );
    const consequenceRows = impacts.map((impact) => {
      const remaining = Number(impact.scheduledAfter || 0);
      const required = Number(impact.requiredLessons || 0);
      if (remaining < required) {
        const remainingLabel = remaining === 0
          ? "no lessons"
          : `only ${remaining} lesson${remaining === 1 ? "" : "s"}`;
        return `Deleting this lesson means ${remainingLabel} for ${impact.subjectLabel} will remain in ${impact.classLevel} ${impact.stream}, below the required ${required}.`;
      }
      return `${impact.subjectLabel} will retain ${remaining}/${required} required weekly lessons in ${impact.classLevel} ${impact.stream}.`;
    });
    if (selectedIsCluster && impacts.length > 0) {
      const remaining = Math.min(...impacts.map((impact) => Number(impact.scheduledAfter || 0)));
      const required = Math.max(...impacts.map((impact) => Number(impact.requiredLessons || 0)));
      const clusterRemaining = remaining === 0
        ? "no cluster sessions"
        : `only ${remaining} cluster session${remaining === 1 ? "" : "s"}`;
      consequenceRows.unshift(
        `Deleting this cluster means ${clusterRemaining} will remain for ${selectedClass} ${[...new Set(events.map((event) => event.stream))].join(" & ")}, against ${required} required. Every subject in the block loses one weekly lesson.`
      );
    }
    if (impacts.length === 0) {
      consequenceRows.push("This scheduling cell will be removed. It has no matched teacher session, so no additional required-lesson shortage was detected.");
    }
    if (events.some((event) => Boolean(Number(event.is_locked)))) {
      warnings.push("This selection contains a locked lesson. Confirming deletion will remove it anyway.");
    }
    if (createsShortage) {
      warnings.push("The draft will return to Needs Attention until the missing lesson is replaced.");
    }

    return {
      valid: true,
      status: 200,
      conflicts,
      warnings,
      versionRow,
      selectedEvent,
      events,
      sessions,
      impacts,
      consequences: [...new Set(consequenceRows)],
      createsShortage,
      summary: {
        kind: selectedIsCluster ? "cluster" : blockKey ? "linked block" : "lesson",
        label: selectedEvent.subject_label,
        classLevel: selectedClass || selectedEvent.class_level,
        streams: [...new Set(events.map((event) => event.stream))],
        day: selectedEvent.day_of_week,
        slotCode: selectedEvent.slot_code,
        eventCount: events.length,
        sessionCount: sessions.length,
        locked: events.some((event) => Boolean(Number(event.is_locked))),
      },
    };
  };

  const publicManualRemovalPlan = (plan) => ({
    valid: Boolean(plan.valid),
    conflicts: [...new Set(plan.conflicts || [])],
    warnings: [...new Set(plan.warnings || [])],
    consequences: [...new Set(plan.consequences || [])],
    createsShortage: Boolean(plan.createsShortage),
    summary: plan.summary || null,
    impacts: (plan.impacts || []).map((impact) => ({
      subject: impact.subjectLabel,
      classLevel: impact.classLevel,
      stream: impact.stream,
      requiredLessons: Number(impact.requiredLessons || 0),
      scheduledBefore: Number(impact.scheduledBefore || 0),
      scheduledAfter: Number(impact.scheduledAfter || 0),
    })),
  });

  router.get("/setup", async (_req, res) => {
    try {
      const { academicYear, currentTerm, config, updatedAt } = await readTimetableConfig(pool);
      const [seededAssignments, aLevelRows, versions] = await Promise.all([
        seedLessonRequirements(pool),
        loadActiveALevelAssignments(pool),
        readVersions(pool),
      ]);
      const allAssignments = await attachAvailability(pool, [...seededAssignments, ...aLevelRows]);
      const assignments = allAssignments.filter((row) => row.assignment_scope === "olevel");
      const aLevelAssignments = allAssignments.filter((row) => row.assignment_scope === "alevel");
      const readiness = buildReadiness(allAssignments);
      const teachers = buildTeacherAvailabilityRows(allAssignments);

      res.json({
        academicYear,
        currentTerm,
        config,
        configUpdatedAt: updatedAt,
        readiness,
        teachers,
        assignments: assignments.map((row) => ({
          scope: "olevel",
          assignmentId: Number(row.assignment_id),
          teacherId: Number(row.teacher_id),
          teacherName: row.teacher_name,
          classLevel: row.normalized_class_level,
          stream: row.normalized_stream,
          subject: row.subject,
          lessonsPerWeek: Number(row.lessons_per_week || 0),
          lessonKind: row.lesson_kind,
          clusterCode: row.cluster_code,
          enabled: Boolean(Number(row.enabled)),
          availableDays: row.available_days,
        })),
        aLevelAssignments: aLevelAssignments.map((row) => ({
          scope: "alevel",
          assignmentId: Number(row.assignment_id),
          teacherId: Number(row.teacher_id),
          teacherName: row.teacher_name,
          classLevel: row.normalized_class_level,
          stream: row.normalized_stream,
          subject: timetableAlevelSubjectName(row.subject),
          subjectKey: canonicalAlevelSubject(row.subject),
          paperLabel: normalizeAlevelTimetablePaperLabel(row.paper_label),
          weekdaySchedulable:
            normalizeAlevelTimetablePaperLabel(row.paper_label) !== "Paper 2" ||
            row.available_days.length > 0,
          lessonsPerWeek: Number(config.aLevel?.lessonsPerSubject || 2),
          lessonKind: "A-Level rule",
          enabled: true,
          availableDays: row.available_days,
        })),
        versions,
      });
    } catch (error) {
      console.error("Load timetable setup failed:", error);
      res.status(500).json({ message: "Failed to load timetable setup." });
    }
  });

  router.put("/teachers/:teacherId/availability", async (req, res) => {
    let connection;
    try {
      const teacherId = Number(req.params.teacherId);
      const days = [...new Set((Array.isArray(req.body?.days) ? req.body.days : []).map((day) =>
        String(day || "").trim()
      ))];
      if (!teacherId || days.some((day) => !TIMETABLE_DAYS.includes(day))) {
        return res.status(400).json({ message: "Select valid school days." });
      }
      if (days.length < 1 || days.length > 4) {
        return res.status(400).json({ message: "Each teacher must have between 1 and 4 available days." });
      }
      const [[teacher]] = await pool.query("SELECT id, name FROM teachers WHERE id = ? LIMIT 1", [teacherId]);
      if (!teacher) return res.status(404).json({ message: "Teacher not found." });

      connection = await pool.getConnection();
      await connection.beginTransaction();
      await connection.query("DELETE FROM timetable_teacher_availability WHERE teacher_id = ?", [teacherId]);
      for (const [index, day] of days.entries()) {
        await connection.query(
          `INSERT INTO timetable_teacher_availability
            (teacher_id, day_of_week, preference_rank) VALUES (?, ?, ?)`,
          [teacherId, day, index + 1]
        );
      }
      await connection.commit();
      connection.release();
      connection = null;

      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "TIMETABLE_AVAILABILITY_UPDATED",
        entityType: "system",
        entityId: teacherId,
        description: `${teacher.name} timetable availability set to ${days.join(", ")}`,
        ipAddress: extractClientIp(req),
      });
      res.json({ teacherId, days });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (connection) connection.release();
      console.error("Save teacher timetable availability failed:", error);
      res.status(500).json({ message: "Failed to save teacher availability." });
    }
  });

  router.put("/requirements/:assignmentId", async (req, res) => {
    try {
      const assignmentId = Number(req.params.assignmentId);
      const lessonKind = String(req.body?.lessonKind || "").trim().toLowerCase();
      const lessonsPerWeek = Number(req.body?.lessonsPerWeek);
      const enabled = Boolean(req.body?.enabled);
      const clusterCode = lessonKind === "cluster"
        ? String(req.body?.clusterCode || "").trim().toUpperCase()
        : null;
      if (!assignmentId || !ALLOWED_REQUIREMENT_KINDS.has(lessonKind)) {
        return res.status(400).json({ message: "Choose a valid lesson type." });
      }
      if (!Number.isInteger(lessonsPerWeek) || lessonsPerWeek < 0 || lessonsPerWeek > 5) {
        return res.status(400).json({ message: "Weekly lessons must be between 0 and 5." });
      }
      if (lessonKind === "cluster" && !clusterCode) {
        return res.status(400).json({ message: "Cluster lessons require a cluster name." });
      }
      const [[assignment]] = await pool.query(
        `SELECT ta.id, ta.class_level, ta.stream, ta.subject, t.name AS teacher_name
         FROM teacher_assignments ta
         JOIN teachers t ON t.id = ta.teacher_id
         WHERE ta.id = ?
           AND COALESCE(ta.assignment_status, 'active') = 'active'
           AND ta.ended_at IS NULL
         LIMIT 1`,
        [assignmentId]
      );
      if (!assignment || !normalizeClassLevel(assignment.class_level) || !normalizeStream(assignment.stream)) {
        return res.status(404).json({ message: "Active O-Level assignment not found." });
      }

      await pool.query(
        `INSERT INTO timetable_lesson_requirements
          (assignment_id, lessons_per_week, lesson_kind, cluster_code, enabled, configured_by_admin_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           lessons_per_week = VALUES(lessons_per_week),
           lesson_kind = VALUES(lesson_kind),
           cluster_code = VALUES(cluster_code),
           enabled = VALUES(enabled),
           configured_by_admin_id = VALUES(configured_by_admin_id),
           updated_at = NOW()`,
        [assignmentId, lessonsPerWeek, lessonKind, clusterCode, enabled ? 1 : 0, Number(req.admin?.id) || 1]
      );
      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "TIMETABLE_REQUIREMENT_UPDATED",
        entityType: "system",
        entityId: assignmentId,
        description: `${assignment.subject} in ${assignment.class_level} ${assignment.stream}: ${lessonsPerWeek} ${lessonKind} lesson${lessonsPerWeek === 1 ? "" : "s"} weekly`,
        ipAddress: extractClientIp(req),
      });
      res.json({ assignmentId, lessonsPerWeek, lessonKind, clusterCode, enabled });
    } catch (error) {
      console.error("Save timetable lesson requirement failed:", error);
      res.status(500).json({ message: "Failed to save the lesson requirement." });
    }
  });

  router.post("/generate", async (req, res) => {
    let connection;
    try {
      const { academicYear, config } = await readTimetableConfig(pool);
      const [seededAssignments, aLevelRows] = await Promise.all([
        seedLessonRequirements(pool),
        loadActiveALevelAssignments(pool),
      ]);
      const allAssignments = await attachAvailability(pool, [...seededAssignments, ...aLevelRows]);
      const assignments = allAssignments.filter((row) => row.assignment_scope === "olevel");
      const aLevelAssignments = allAssignments.filter((row) => row.assignment_scope === "alevel");
      const readiness = buildReadiness(allAssignments);
      if (!readiness.ready) {
        const blockers = describeReadinessBlockers(readiness);
        return res.status(409).json({
          message: blockers.length === 1
            ? `Cannot generate the timetable. ${blockers[0]}`
            : `Cannot generate the timetable. Resolve the ${blockers.length} listed setup blockers.`,
          readiness,
          blockers,
        });
      }

      const result = generateSchoolTimetable(assignments, aLevelAssignments, config);
      const requestedName = String(req.body?.name || "").trim();
      const name = (requestedName || `School Draft ${new Date().toLocaleDateString("en-GB")}`).slice(0, 120);
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [versionInsert] = await connection.query(
        `INSERT INTO timetable_versions
          (academic_year, name, status, generation_stats_json, validation_json, created_by_admin_id)
         VALUES (?, ?, 'draft', ?, ?, ?)`,
        [
          academicYear,
          name,
          JSON.stringify(result.stats),
          JSON.stringify(result.validation),
          Number(req.admin?.id) || 1,
        ]
      );
      const versionId = Number(versionInsert.insertId);
      const eventIds = new Map();
      for (const event of result.events) {
        const [eventInsert] = await connection.query(
          `INSERT INTO timetable_events
            (version_id, class_level, stream, day_of_week, slot_code, event_type,
             subject_label, assignment_id, teacher_id, teacher_name, block_key, is_locked, is_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            versionId,
            event.classLevel,
            event.stream,
            event.day,
            event.slotCode,
            event.eventType,
            event.subjectLabel,
            event.assignmentId,
            event.teacherId,
            event.teacherName,
            event.blockKey,
            event.isLocked ? 1 : 0,
            event.isManual ? 1 : 0,
          ]
        );
        eventIds.set(event.eventKey, Number(eventInsert.insertId));
      }
      for (const session of result.sessions) {
        await connection.query(
          `INSERT INTO timetable_teacher_sessions
            (version_id, event_id, teacher_id, teacher_name, assignment_id, subject_label,
             class_level, streams_label, day_of_week, slot_code, block_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            versionId,
            eventIds.get(session.eventKey) || null,
            session.teacherId,
            session.teacherName,
            session.assignmentId,
            session.subjectLabel,
            session.classLevel,
            session.streamsLabel,
            session.day,
            session.slotCode,
            session.blockKey,
          ]
        );
      }
      await connection.query(
        `INSERT INTO timetable_actions (version_id, admin_id, action_type, payload_json)
         VALUES (?, ?, 'generate', ?)`,
        [versionId, Number(req.admin?.id) || 1, JSON.stringify({ name, stats: result.stats })]
      );
      await connection.commit();
      connection.release();
      connection = null;

      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "TIMETABLE_DRAFT_GENERATED",
        entityType: "system",
        entityId: versionId,
        description: `${name}: ${result.stats.lessonsPlaced}/${result.stats.lessonsRequested} lesson requirements placed; ${result.stats.unallocatedLessons} unallocated`,
        ipAddress: extractClientIp(req),
      });
      const detail = await readVersionDetail(pool, versionId);
      res.status(201).json(detail);
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (connection) connection.release();
      console.error("Generate school timetable failed:", error);
      res.status(500).json({ message: "Failed to generate the timetable draft." });
    }
  });

  router.post("/versions/:versionId/regenerate-stream", async (req, res) => {
    let connection;
    try {
      const versionId = Number(req.params.versionId);
      const classLevel = normalizeClassLevel(req.body?.classLevel);
      const stream = normalizeStream(req.body?.stream);
      if (!versionId || !classLevel || !stream) {
        return res.status(400).json({ message: "Choose an O-Level class and stream." });
      }
      const source = await readVersionDetail(pool, versionId);
      if (!source) return res.status(404).json({ message: "Timetable version not found." });
      if (source.status !== "draft") {
        return res.status(409).json({ message: "Only a draft timetable can be regenerated." });
      }
      if (!source.validation?.valid) {
        return res.status(409).json({
          message: "Resolve unallocated lessons with a full generation before regenerating one stream.",
        });
      }
      const { config } = await readTimetableConfig(pool);
      const seededAssignments = await seedLessonRequirements(pool);
      const assignments = await attachAvailability(pool, seededAssignments);
      const result = regenerateOLevelStreamLessons({
        version: source,
        assignments,
        config,
        classLevel,
        stream,
      });
      if (!result?.valid) {
        return res.status(409).json({
          message: result?.reason || `No complete clash-free regeneration was found for ${classLevel} ${stream}.`,
          failures: result?.failures || [],
        });
      }

      const placementDelta = result.events.length - result.removableEventIds.length;
      const stats = {
        ...(source.stats || {}),
        lessonsPlaced: Math.max(0, Number(source.stats?.lessonsPlaced || 0) + placementDelta),
        lessonsRequested: Math.max(0, Number(source.stats?.lessonsRequested || 0) + placementDelta),
        regeneratedFromVersionId: versionId,
        regeneratedStream: `${classLevel} ${stream}`,
      };
      const validation = {
        ...(source.validation || {}),
        valid: true,
        regeneratedStream: `${classLevel} ${stream}`,
        regeneratedAt: new Date().toISOString(),
      };
      const name = `${source.name} / ${classLevel} ${stream} refresh`.slice(0, 120);
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [[currentSource]] = await connection.query(
        "SELECT id, status, updated_at FROM timetable_versions WHERE id = ? LIMIT 1 FOR UPDATE",
        [versionId]
      );
      if (!currentSource || currentSource.status !== "draft") {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(409).json({ message: "The source draft changed before regeneration completed." });
      }
      const [versionInsert] = await connection.query(
        `INSERT INTO timetable_versions
          (academic_year, name, status, generation_stats_json, validation_json, created_by_admin_id)
         VALUES (?, ?, 'draft', ?, ?, ?)`,
        [
          source.academicYear,
          name,
          JSON.stringify(stats),
          JSON.stringify(validation),
          Number(req.admin?.id) || 1,
        ]
      );
      const newVersionId = Number(versionInsert.insertId);
      const eventIds = new Map();
      for (const event of result.preservedEvents) {
        const [insert] = await connection.query(
          `INSERT INTO timetable_events
            (version_id, class_level, stream, day_of_week, slot_code, event_type,
             subject_label, assignment_id, teacher_id, teacher_name, block_key, is_locked, is_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newVersionId,
            event.classLevel,
            event.stream,
            event.day,
            event.slotCode,
            event.eventType,
            event.subjectLabel,
            event.assignmentId,
            event.teacherId,
            event.teacherName,
            event.blockKey,
            event.isLocked ? 1 : 0,
            event.isManual ? 1 : 0,
          ]
        );
        eventIds.set(`existing-${event.id}`, Number(insert.insertId));
      }
      for (const event of result.events) {
        const [insert] = await connection.query(
          `INSERT INTO timetable_events
            (version_id, class_level, stream, day_of_week, slot_code, event_type,
             subject_label, assignment_id, teacher_id, teacher_name, block_key, is_locked, is_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
          [
            newVersionId,
            event.classLevel,
            event.stream,
            event.day,
            event.slotCode,
            event.eventType,
            event.subjectLabel,
            event.assignmentId,
            event.teacherId,
            event.teacherName,
            event.blockKey,
          ]
        );
        eventIds.set(event.eventKey, Number(insert.insertId));
      }
      for (const session of result.preservedSessions) {
        await connection.query(
          `INSERT INTO timetable_teacher_sessions
            (version_id, event_id, teacher_id, teacher_name, assignment_id, subject_label,
             class_level, streams_label, day_of_week, slot_code, block_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newVersionId,
            session.eventId ? eventIds.get(`existing-${session.eventId}`) || null : null,
            session.teacherId,
            session.teacherName,
            session.assignmentId,
            session.subjectLabel,
            session.classLevel,
            session.streamsLabel,
            session.day,
            session.slotCode,
            session.blockKey,
          ]
        );
      }
      for (const session of result.sessions) {
        await connection.query(
          `INSERT INTO timetable_teacher_sessions
            (version_id, event_id, teacher_id, teacher_name, assignment_id, subject_label,
             class_level, streams_label, day_of_week, slot_code, block_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newVersionId,
            eventIds.get(session.eventKey) || null,
            session.teacherId,
            session.teacherName,
            session.assignmentId,
            session.subjectLabel,
            session.classLevel,
            session.streamsLabel,
            session.day,
            session.slotCode,
            session.blockKey,
          ]
        );
      }
      await connection.query(
        `INSERT INTO timetable_actions (version_id, admin_id, action_type, payload_json)
         VALUES (?, ?, 'regenerate_stream', ?)`,
        [
          newVersionId,
          Number(req.admin?.id) || 1,
          JSON.stringify({ sourceVersionId: versionId, classLevel, stream }),
        ]
      );
      await connection.commit();
      connection.release();
      connection = null;
      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "TIMETABLE_STREAM_REGENERATED",
        entityType: "system",
        entityId: newVersionId,
        description: `${classLevel} ${stream} ordinary lessons regenerated from ${source.name}; all other streams and locked lessons preserved in new draft ${name}`,
        ipAddress: extractClientIp(req),
      });
      res.status(201).json(await readVersionDetail(pool, newVersionId));
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (connection) connection.release();
      console.error("Regenerate timetable stream failed:", error);
      res.status(500).json({ message: "Failed to regenerate the selected stream." });
    }
  });

  router.get("/versions", async (_req, res) => {
    try {
      res.json(await readVersions(pool));
    } catch (error) {
      console.error("Load timetable versions failed:", error);
      res.status(500).json({ message: "Failed to load timetable versions." });
    }
  });

  router.get("/versions/:versionId", async (req, res) => {
    try {
      const versionId = Number(req.params.versionId);
      const detail = versionId ? await readVersionDetail(pool, versionId) : null;
      if (!detail) return res.status(404).json({ message: "Timetable version not found." });
      res.json(detail);
    } catch (error) {
      console.error("Load timetable version failed:", error);
      res.status(500).json({ message: "Failed to load the timetable version." });
    }
  });

  router.post("/versions/:versionId/manual/preview", async (req, res) => {
    try {
      const versionId = Number(req.params.versionId);
      if (!versionId) return res.status(400).json({ message: "Choose a timetable draft." });
      const plan = await buildManualInsertionPlan(pool, versionId, req.body);
      if (plan.status === 404 && !plan.versionRow) {
        return res.status(404).json({ message: plan.conflicts[0], ...publicManualPlan(plan) });
      }
      res.json(publicManualPlan(plan));
    } catch (error) {
      console.error("Preview manual timetable lesson failed:", error);
      res.status(500).json({ message: "Failed to check the selected timetable period." });
    }
  });

  router.post("/versions/:versionId/manual/remove/preview", async (req, res) => {
    try {
      const versionId = Number(req.params.versionId);
      const eventId = Number(req.body?.eventId);
      if (!versionId || !eventId) {
        return res.status(400).json({ message: "Choose a timetable draft and lesson." });
      }
      const plan = await buildManualRemovalPlan(pool, versionId, eventId);
      if (!plan.valid) {
        return res.status(plan.status || 409).json({
          message: plan.conflicts?.[0] || "This timetable lesson cannot be deleted.",
          ...publicManualRemovalPlan(plan),
        });
      }
      res.json(publicManualRemovalPlan(plan));
    } catch (error) {
      console.error("Preview timetable lesson deletion failed:", error);
      res.status(500).json({ message: "Failed to calculate the consequence of deleting this lesson." });
    }
  });

  router.post("/versions/:versionId/manual", async (req, res) => {
    let connection;
    try {
      const versionId = Number(req.params.versionId);
      if (!versionId) return res.status(400).json({ message: "Choose a timetable draft." });
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const plan = await buildManualInsertionPlan(
        connection,
        versionId,
        req.body,
        { lockVersion: true }
      );
      if (!plan.valid) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(plan.status || 409).json({
          message: plan.conflicts?.[0] || "The manual lesson would create a clash.",
          ...publicManualPlan(plan),
        });
      }

      const previousStats = parseJson(plan.versionRow.generation_stats_json, {});
      const previousValidation = parseJson(plan.versionRow.validation_json, {});
      const blockKey = plan.mode === "cluster"
        ? `MAN-${versionId}-${Date.now().toString(36)}`
        : null;
      const eventIds = [];
      for (const event of plan.events) {
        const [insert] = await connection.query(
          `INSERT INTO timetable_events
            (version_id, class_level, stream, day_of_week, slot_code, event_type,
             subject_label, assignment_id, teacher_id, teacher_name, block_key,
             is_locked, is_manual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
          [
            versionId,
            event.classLevel,
            event.stream,
            plan.day,
            plan.slotCode,
            event.eventType,
            event.subjectLabel,
            event.assignmentId,
            event.teacherId,
            event.teacherName,
            blockKey,
          ]
        );
        eventIds.push(Number(insert.insertId));
      }
      const sessionEventId = eventIds[0] || null;
      for (const session of plan.sessions) {
        await connection.query(
          `INSERT INTO timetable_teacher_sessions
            (version_id, event_id, teacher_id, teacher_name, assignment_id, subject_label,
             class_level, streams_label, day_of_week, slot_code, block_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            versionId,
            sessionEventId,
            session.teacherId,
            session.teacherName,
            session.assignmentId,
            session.subjectLabel,
            session.classLevel,
            session.streamsLabel,
            plan.day,
            plan.slotCode,
            blockKey,
          ]
        );
      }

      const updatedReport = applyManualCredits(previousValidation, previousStats, plan);
      await connection.query(
        `UPDATE timetable_versions
         SET generation_stats_json = ?, validation_json = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          JSON.stringify(updatedReport.stats),
          JSON.stringify(updatedReport.validation),
          versionId,
        ]
      );
      await connection.query(
        `INSERT INTO timetable_actions
          (version_id, admin_id, action_type, payload_json, undo_payload_json)
         VALUES (?, ?, 'manual_add', ?, ?)`,
        [
          versionId,
          Number(req.admin?.id) || 1,
          JSON.stringify({
            eventIds,
            blockKey,
            summary: publicManualPlan(plan).summary,
            warnings: plan.warnings,
            creditedLessons: updatedReport.creditedLessons,
          }),
          JSON.stringify({
            eventIds,
            blockKey,
            stats: previousStats,
            validation: previousValidation,
          }),
        ]
      );
      await connection.commit();
      connection.release();
      connection = null;

      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "TIMETABLE_MANUAL_LESSON_ADDED",
        entityType: "system",
        entityId: versionId,
        description: `${plan.label} manually added to ${plan.classLevel} ${plan.streams.join(" & ")} on ${plan.day} ${plan.slotCode} and locked`,
        ipAddress: extractClientIp(req),
      });
      const detail = await readVersionDetail(pool, versionId);
      res.status(201).json({
        ...detail,
        manualOverride: {
          summary: publicManualPlan(plan).summary,
          warnings: plan.warnings,
          creditedLessons: updatedReport.creditedLessons,
        },
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (connection) connection.release();
      console.error("Add manual timetable lesson failed:", error);
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "That stream or teacher became occupied. Check the slot again." });
      }
      res.status(500).json({ message: "Failed to add the manual timetable lesson." });
    }
  });

  router.delete("/versions/:versionId/events/:eventId", async (req, res) => {
    let connection;
    try {
      const versionId = Number(req.params.versionId);
      const eventId = Number(req.params.eventId);
      if (!versionId || !eventId) {
        return res.status(400).json({ message: "Choose a timetable draft and lesson." });
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();
      const plan = await buildManualRemovalPlan(
        connection,
        versionId,
        eventId,
        { lockVersion: true }
      );
      if (!plan.valid) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(plan.status || 409).json({
          message: plan.conflicts?.[0] || "This timetable lesson cannot be deleted.",
          ...publicManualRemovalPlan(plan),
        });
      }

      const previousStats = parseJson(plan.versionRow.generation_stats_json, {});
      const previousValidation = parseJson(plan.versionRow.validation_json, {});
      const eventIds = plan.events.map((event) => Number(event.id)).filter(Boolean);
      const sessionIds = plan.sessions.map((session) => Number(session.id)).filter(Boolean);
      const updatedReport = applyManualRemoval(previousValidation, previousStats, {
        impacts: plan.impacts,
        eventsRemoved: eventIds.length,
        sessionsRemoved: sessionIds.length,
      });

      if (sessionIds.length > 0) {
        await connection.query(
          `DELETE FROM timetable_teacher_sessions
           WHERE version_id = ? AND id IN (${sessionIds.map(() => "?").join(",")})`,
          [versionId, ...sessionIds]
        );
      }
      if (eventIds.length > 0) {
        await connection.query(
          `DELETE FROM timetable_events
           WHERE version_id = ? AND id IN (${eventIds.map(() => "?").join(",")})`,
          [versionId, ...eventIds]
        );
      }
      await connection.query(
        `UPDATE timetable_versions
         SET generation_stats_json = ?, validation_json = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          JSON.stringify(updatedReport.stats),
          JSON.stringify(updatedReport.validation),
          versionId,
        ]
      );
      await connection.query(
        `INSERT INTO timetable_actions
          (version_id, admin_id, action_type, payload_json, undo_payload_json)
         VALUES (?, ?, 'manual_remove', ?, ?)`,
        [
          versionId,
          Number(req.admin?.id) || 1,
          JSON.stringify({
            eventIds,
            sessionIds,
            summary: plan.summary,
            consequences: plan.consequences,
            removedRequiredLessons: updatedReport.removedRequiredLessons,
          }),
          JSON.stringify({
            events: plan.events,
            sessions: plan.sessions,
            stats: previousStats,
            validation: previousValidation,
          }),
        ]
      );
      await connection.commit();
      connection.release();
      connection = null;

      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "TIMETABLE_LESSON_DELETED",
        entityType: "system",
        entityId: versionId,
        description: `${plan.summary.label} ${plan.summary.kind} deleted from ${plan.summary.classLevel} ${plan.summary.streams.join(" & ")} on ${plan.summary.day} ${plan.summary.slotCode}; ${updatedReport.removedRequiredLessons} required lesson allocation${updatedReport.removedRequiredLessons === 1 ? "" : "s"} removed`,
        ipAddress: extractClientIp(req),
      });
      const detail = await readVersionDetail(pool, versionId);
      res.json({
        ...detail,
        manualRemoval: {
          ...publicManualRemovalPlan(plan),
          removedRequiredLessons: updatedReport.removedRequiredLessons,
        },
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (connection) connection.release();
      console.error("Delete timetable lesson failed:", error);
      res.status(500).json({ message: "Failed to delete the timetable lesson." });
    }
  });

  router.patch("/versions/:versionId/status", async (req, res) => {
    try {
      const versionId = Number(req.params.versionId);
      const status = String(req.body?.status || "").trim().toLowerCase();
      if (!versionId || !ALLOWED_VERSION_STATUSES.has(status)) {
        return res.status(400).json({ message: "Choose a valid timetable status." });
      }
      const detail = await readVersionDetail(pool, versionId);
      if (!detail) return res.status(404).json({ message: "Timetable version not found." });
      if (status === "published" && !detail.validation?.valid) {
        return res.status(409).json({ message: "A timetable with missing lessons cannot be published." });
      }
      if (status === "published") {
        await pool.query(
          `UPDATE timetable_versions SET status = 'archived'
           WHERE academic_year = ? AND status = 'published' AND id <> ?`,
          [detail.academicYear, versionId]
        );
      }
      await pool.query(
        `UPDATE timetable_versions
         SET status = ?, published_at = CASE WHEN ? = 'published' THEN NOW() ELSE published_at END
         WHERE id = ?`,
        [status, status, versionId]
      );
      await pool.query(
        `INSERT INTO timetable_actions (version_id, admin_id, action_type, payload_json, undo_payload_json)
         VALUES (?, ?, 'status_change', ?, ?)`,
        [
          versionId,
          Number(req.admin?.id) || 1,
          JSON.stringify({ status }),
          JSON.stringify({ status: detail.status }),
        ]
      );
      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: `TIMETABLE_${status.toUpperCase()}`,
        entityType: "system",
        entityId: versionId,
        description: `${detail.name} changed from ${detail.status} to ${status}`,
        ipAddress: extractClientIp(req),
      });
      res.json(await readVersionDetail(pool, versionId));
    } catch (error) {
      console.error("Update timetable status failed:", error);
      res.status(500).json({ message: "Failed to update timetable status." });
    }
  });

  router.patch("/versions/:versionId/events/:eventId/lock", async (req, res) => {
    try {
      const versionId = Number(req.params.versionId);
      const eventId = Number(req.params.eventId);
      const locked = Boolean(req.body?.locked);
      const [[version]] = await pool.query(
        "SELECT id, status FROM timetable_versions WHERE id = ? LIMIT 1",
        [versionId]
      );
      if (!version) return res.status(404).json({ message: "Timetable version not found." });
      if (version.status !== "draft") {
        return res.status(409).json({ message: "Only draft timetable lessons can be locked or unlocked." });
      }
      const [[event]] = await pool.query(
        `SELECT id, block_key, event_type, subject_label FROM timetable_events
         WHERE id = ? AND version_id = ? LIMIT 1`,
        [eventId, versionId]
      );
      if (!event) return res.status(404).json({ message: "Timetable lesson not found." });
      if (["assembly", "church", "project"].includes(event.event_type)) {
        return res.status(409).json({ message: "School-wide fixed events remain locked." });
      }
      const [affected] = event.block_key
        ? await pool.query(
            "SELECT id, is_locked FROM timetable_events WHERE version_id = ? AND block_key = ?",
            [versionId, event.block_key]
          )
        : await pool.query(
            "SELECT id, is_locked FROM timetable_events WHERE id = ? AND version_id = ?",
            [eventId, versionId]
          );
      const ids = affected.map((row) => Number(row.id));
      if (ids.length > 0) {
        await pool.query(
          `UPDATE timetable_events SET is_locked = ? WHERE id IN (${ids.map(() => "?").join(",")})`,
          [locked ? 1 : 0, ...ids]
        );
        await pool.query(
          `INSERT INTO timetable_actions
            (version_id, admin_id, action_type, payload_json, undo_payload_json)
           VALUES (?, ?, 'lock_event', ?, ?)`,
          [
            versionId,
            Number(req.admin?.id) || 1,
            JSON.stringify({ eventIds: ids, locked }),
            JSON.stringify({ events: affected.map((row) => ({ id: Number(row.id), isLocked: Boolean(Number(row.is_locked)) })) }),
          ]
        );
      }
      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: locked ? "TIMETABLE_LESSON_LOCKED" : "TIMETABLE_LESSON_UNLOCKED",
        entityType: "system",
        entityId: versionId,
        description: `${event.subject_label} ${locked ? "locked" : "unlocked"} in timetable draft #${versionId}`,
        ipAddress: extractClientIp(req),
      });
      res.json({ eventId, locked, blockKey: event.block_key || null });
    } catch (error) {
      console.error("Lock timetable lesson failed:", error);
      res.status(500).json({ message: "Failed to update the lesson lock." });
    }
  });

  router.post("/versions/:versionId/events/:eventId/move", async (req, res) => {
    let connection;
    try {
      const versionId = Number(req.params.versionId);
      const eventId = Number(req.params.eventId);
      const targetDay = String(req.body?.day || "").trim();
      const targetSlotCode = String(req.body?.slotCode || "").trim().toUpperCase();
      if (!versionId || !eventId) return res.status(400).json({ message: "Choose a timetable lesson." });
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const event = await readDraftEvent(connection, versionId, eventId, true);
      if (!event) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(404).json({ message: "Timetable lesson not found." });
      }
      if (event.version_status !== "draft") {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(409).json({ message: "Only draft timetable lessons can be moved." });
      }
      if (event.event_type !== "lesson" || event.block_key) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(409).json({ message: "Move applies to ordinary lessons. Move cluster blocks through a new generation." });
      }
      if (Number(event.is_locked)) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(409).json({ message: "Unlock this lesson before moving it." });
      }
      if (event.day_of_week === targetDay && event.slot_code === targetSlotCode) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(400).json({ message: "Choose a different period." });
      }
      const invalidReason = await validateManualTarget(
        connection,
        versionId,
        event,
        targetDay,
        targetSlotCode,
        [eventId]
      );
      if (invalidReason) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(409).json({ message: invalidReason });
      }
      const previous = {
        eventId,
        day: event.day_of_week,
        slotCode: event.slot_code,
        isManual: Boolean(Number(event.is_manual)),
      };
      await connection.query(
        `UPDATE timetable_events
         SET day_of_week = ?, slot_code = ?, is_manual = 1
         WHERE id = ? AND version_id = ?`,
        [targetDay, targetSlotCode, eventId, versionId]
      );
      await connection.query(
        `UPDATE timetable_teacher_sessions
         SET day_of_week = ?, slot_code = ?
         WHERE version_id = ? AND event_id = ?`,
        [targetDay, targetSlotCode, versionId, eventId]
      );
      await connection.query("UPDATE timetable_versions SET updated_at = NOW() WHERE id = ?", [versionId]);
      await connection.query(
        `INSERT INTO timetable_actions
          (version_id, admin_id, action_type, payload_json, undo_payload_json)
         VALUES (?, ?, 'move', ?, ?)`,
        [
          versionId,
          Number(req.admin?.id) || 1,
          JSON.stringify({ eventId, day: targetDay, slotCode: targetSlotCode }),
          JSON.stringify(previous),
        ]
      );
      await connection.commit();
      connection.release();
      connection = null;
      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "TIMETABLE_LESSON_MOVED",
        entityType: "system",
        entityId: versionId,
        description: `${event.subject_label} in ${event.class_level} ${event.stream} moved from ${event.day_of_week} ${event.slot_code} to ${targetDay} ${targetSlotCode}`,
        ipAddress: extractClientIp(req),
      });
      res.json(await readVersionDetail(pool, versionId));
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (connection) connection.release();
      console.error("Move timetable lesson failed:", error);
      res.status(500).json({ message: "Failed to move the timetable lesson." });
    }
  });

  router.post("/versions/:versionId/swap", async (req, res) => {
    let connection;
    try {
      const versionId = Number(req.params.versionId);
      const firstEventId = Number(req.body?.firstEventId);
      const secondEventId = Number(req.body?.secondEventId);
      if (!versionId || !firstEventId || !secondEventId || firstEventId === secondEventId) {
        return res.status(400).json({ message: "Choose two different lessons." });
      }
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const first = await readDraftEvent(connection, versionId, firstEventId, true);
      const second = await readDraftEvent(connection, versionId, secondEventId, true);
      if (!first || !second) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(404).json({ message: "One of the timetable lessons no longer exists." });
      }
      if (first.version_status !== "draft" || second.version_status !== "draft") {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(409).json({ message: "Only draft timetable lessons can be swapped." });
      }
      if (
        first.event_type !== "lesson" || second.event_type !== "lesson" ||
        first.block_key || second.block_key || Number(first.is_locked) || Number(second.is_locked)
      ) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(409).json({ message: "Swap requires two unlocked ordinary lessons." });
      }
      if (first.day_of_week === second.day_of_week && first.slot_code === second.slot_code) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(400).json({ message: "These lessons already occupy the same school period." });
      }
      const excluded = [firstEventId, secondEventId];
      const firstReason = await validateManualTarget(
        connection,
        versionId,
        first,
        second.day_of_week,
        second.slot_code,
        excluded
      );
      const secondReason = firstReason ? "" : await validateManualTarget(
        connection,
        versionId,
        second,
        first.day_of_week,
        first.slot_code,
        excluded
      );
      if (firstReason || secondReason) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(409).json({ message: firstReason || secondReason });
      }
      const undoPayload = {
        first: {
          eventId: firstEventId,
          day: first.day_of_week,
          slotCode: first.slot_code,
          isManual: Boolean(Number(first.is_manual)),
        },
        second: {
          eventId: secondEventId,
          day: second.day_of_week,
          slotCode: second.slot_code,
          isManual: Boolean(Number(second.is_manual)),
        },
      };
      const temporarySlot = "__TMP_SWAP__";
      await connection.query(
        "UPDATE timetable_events SET slot_code = ? WHERE id = ? AND version_id = ?",
        [temporarySlot, firstEventId, versionId]
      );
      await connection.query(
        `UPDATE timetable_events SET day_of_week = ?, slot_code = ?, is_manual = 1
         WHERE id = ? AND version_id = ?`,
        [first.day_of_week, first.slot_code, secondEventId, versionId]
      );
      await connection.query(
        `UPDATE timetable_events SET day_of_week = ?, slot_code = ?, is_manual = 1
         WHERE id = ? AND version_id = ?`,
        [second.day_of_week, second.slot_code, firstEventId, versionId]
      );
      await connection.query(
        "UPDATE timetable_teacher_sessions SET slot_code = ? WHERE version_id = ? AND event_id = ?",
        [temporarySlot, versionId, firstEventId]
      );
      await connection.query(
        `UPDATE timetable_teacher_sessions SET day_of_week = ?, slot_code = ?
         WHERE version_id = ? AND event_id = ?`,
        [first.day_of_week, first.slot_code, versionId, secondEventId]
      );
      await connection.query(
        `UPDATE timetable_teacher_sessions SET day_of_week = ?, slot_code = ?
         WHERE version_id = ? AND event_id = ?`,
        [second.day_of_week, second.slot_code, versionId, firstEventId]
      );
      await connection.query("UPDATE timetable_versions SET updated_at = NOW() WHERE id = ?", [versionId]);
      await connection.query(
        `INSERT INTO timetable_actions
          (version_id, admin_id, action_type, payload_json, undo_payload_json)
         VALUES (?, ?, 'swap', ?, ?)`,
        [
          versionId,
          Number(req.admin?.id) || 1,
          JSON.stringify({ firstEventId, secondEventId }),
          JSON.stringify(undoPayload),
        ]
      );
      await connection.commit();
      connection.release();
      connection = null;
      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "TIMETABLE_LESSONS_SWAPPED",
        entityType: "system",
        entityId: versionId,
        description: `${first.subject_label} (${first.class_level} ${first.stream}) swapped with ${second.subject_label} (${second.class_level} ${second.stream})`,
        ipAddress: extractClientIp(req),
      });
      res.json(await readVersionDetail(pool, versionId));
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (connection) connection.release();
      console.error("Swap timetable lessons failed:", error);
      res.status(500).json({ message: "Failed to swap timetable lessons." });
    }
  });

  router.patch("/versions/:versionId/teachers/:teacherId/pin", async (req, res) => {
    let connection;
    try {
      const versionId = Number(req.params.versionId);
      const teacherId = Number(req.params.teacherId);
      const pinned = Boolean(req.body?.pinned);
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [[versionRow]] = await connection.query(
        "SELECT id, name, status FROM timetable_versions WHERE id = ? LIMIT 1 FOR UPDATE",
        [versionId]
      );
      if (!versionRow) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(404).json({ message: "Timetable version not found." });
      }
      if (versionRow.status !== "draft") {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(409).json({ message: "Teachers can only be pinned in a draft timetable." });
      }
      const [sessions] = await connection.query(
        `SELECT event_id, block_key, teacher_name
         FROM timetable_teacher_sessions
         WHERE version_id = ? AND teacher_id = ?`,
        [versionId, teacherId]
      );
      if (sessions.length === 0) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(404).json({ message: "This teacher has no scheduled lessons in the draft." });
      }
      const eventIds = [...new Set(sessions.map((row) => Number(row.event_id)).filter(Boolean))];
      const blockKeys = [...new Set(sessions.map((row) => row.block_key).filter(Boolean))];
      const conditions = [];
      const params = [versionId];
      if (eventIds.length > 0) {
        conditions.push(`id IN (${eventIds.map(() => "?").join(",")})`);
        params.push(...eventIds);
      }
      if (blockKeys.length > 0) {
        conditions.push(`block_key IN (${blockKeys.map(() => "?").join(",")})`);
        params.push(...blockKeys);
      }
      const [events] = await connection.query(
        `SELECT id, is_locked FROM timetable_events
         WHERE version_id = ? AND (${conditions.join(" OR ")})
           AND event_type NOT IN ('assembly', 'church', 'project')
         FOR UPDATE`,
        params
      );
      const ids = events.map((row) => Number(row.id));
      if (ids.length === 0) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(409).json({ message: "This teacher has no movable timetable lessons to pin." });
      }
      await connection.query(
        `UPDATE timetable_events SET is_locked = ? WHERE id IN (${ids.map(() => "?").join(",")})`,
        [pinned ? 1 : 0, ...ids]
      );
      await connection.query(
        `INSERT INTO timetable_actions
          (version_id, admin_id, action_type, payload_json, undo_payload_json)
         VALUES (?, ?, 'pin_teacher', ?, ?)`,
        [
          versionId,
          Number(req.admin?.id) || 1,
          JSON.stringify({ teacherId, pinned, eventIds: ids }),
          JSON.stringify({ events: events.map((row) => ({ id: Number(row.id), isLocked: Boolean(Number(row.is_locked)) })) }),
        ]
      );
      await connection.commit();
      connection.release();
      connection = null;
      const teacherName = sessions[0]?.teacher_name || `Teacher #${teacherId}`;
      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: pinned ? "TIMETABLE_TEACHER_PINNED" : "TIMETABLE_TEACHER_UNPINNED",
        entityType: "system",
        entityId: versionId,
        description: `${teacherName}'s timetable lessons ${pinned ? "pinned" : "unpinned"} in ${versionRow.name}`,
        ipAddress: extractClientIp(req),
      });
      res.json(await readVersionDetail(pool, versionId));
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (connection) connection.release();
      console.error("Pin timetable teacher failed:", error);
      res.status(500).json({ message: "Failed to update teacher pinning." });
    }
  });

  router.post("/versions/:versionId/undo", async (req, res) => {
    let connection;
    try {
      const versionId = Number(req.params.versionId);
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [[action]] = await connection.query(
        `SELECT id, action_type, undo_payload_json
         FROM timetable_actions
         WHERE version_id = ? AND undone_at IS NULL
           AND action_type IN ('move', 'swap', 'lock_event', 'pin_teacher', 'status_change', 'manual_add', 'manual_remove')
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [versionId]
      );
      if (!action) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(404).json({ message: "There is no timetable action to undo." });
      }
      const undo = parseJson(action.undo_payload_json, {});
      if (action.action_type === "move") {
        await connection.query(
          `UPDATE timetable_events SET day_of_week = ?, slot_code = ?, is_manual = ?
           WHERE id = ? AND version_id = ?`,
          [undo.day, undo.slotCode, undo.isManual ? 1 : 0, undo.eventId, versionId]
        );
        await connection.query(
          `UPDATE timetable_teacher_sessions SET day_of_week = ?, slot_code = ?
           WHERE event_id = ? AND version_id = ?`,
          [undo.day, undo.slotCode, undo.eventId, versionId]
        );
      } else if (action.action_type === "swap") {
        const temporarySlot = "__TMP_UNDO__";
        await connection.query(
          "UPDATE timetable_events SET slot_code = ? WHERE id = ? AND version_id = ?",
          [temporarySlot, undo.first.eventId, versionId]
        );
        await connection.query(
          `UPDATE timetable_events SET day_of_week = ?, slot_code = ?, is_manual = ?
           WHERE id = ? AND version_id = ?`,
          [undo.second.day, undo.second.slotCode, undo.second.isManual ? 1 : 0, undo.second.eventId, versionId]
        );
        await connection.query(
          `UPDATE timetable_events SET day_of_week = ?, slot_code = ?, is_manual = ?
           WHERE id = ? AND version_id = ?`,
          [undo.first.day, undo.first.slotCode, undo.first.isManual ? 1 : 0, undo.first.eventId, versionId]
        );
        await connection.query(
          "UPDATE timetable_teacher_sessions SET slot_code = ? WHERE event_id = ? AND version_id = ?",
          [temporarySlot, undo.first.eventId, versionId]
        );
        await connection.query(
          `UPDATE timetable_teacher_sessions SET day_of_week = ?, slot_code = ?
           WHERE event_id = ? AND version_id = ?`,
          [undo.second.day, undo.second.slotCode, undo.second.eventId, versionId]
        );
        await connection.query(
          `UPDATE timetable_teacher_sessions SET day_of_week = ?, slot_code = ?
           WHERE event_id = ? AND version_id = ?`,
          [undo.first.day, undo.first.slotCode, undo.first.eventId, versionId]
        );
      } else if (action.action_type === "lock_event" || action.action_type === "pin_teacher") {
        for (const event of undo.events || []) {
          await connection.query(
            "UPDATE timetable_events SET is_locked = ? WHERE id = ? AND version_id = ?",
            [event.isLocked ? 1 : 0, event.id, versionId]
          );
        }
      } else if (action.action_type === "status_change") {
        await connection.query(
          "UPDATE timetable_versions SET status = ? WHERE id = ?",
          [undo.status, versionId]
        );
      } else if (action.action_type === "manual_add") {
        const eventIds = [...new Set((undo.eventIds || []).map(Number).filter(Boolean))];
        if (undo.blockKey) {
          await connection.query(
            "DELETE FROM timetable_teacher_sessions WHERE version_id = ? AND block_key = ?",
            [versionId, undo.blockKey]
          );
        } else if (eventIds.length > 0) {
          await connection.query(
            `DELETE FROM timetable_teacher_sessions
             WHERE version_id = ? AND event_id IN (${eventIds.map(() => "?").join(",")})`,
            [versionId, ...eventIds]
          );
        }
        if (eventIds.length > 0) {
          await connection.query(
            `DELETE FROM timetable_events
             WHERE version_id = ? AND id IN (${eventIds.map(() => "?").join(",")})`,
            [versionId, ...eventIds]
          );
        }
        await connection.query(
          `UPDATE timetable_versions
           SET generation_stats_json = ?, validation_json = ?
           WHERE id = ?`,
          [JSON.stringify(undo.stats || {}), JSON.stringify(undo.validation || {}), versionId]
        );
      } else if (action.action_type === "manual_remove") {
        for (const event of undo.events || []) {
          await connection.query(
            `INSERT INTO timetable_events
              (id, version_id, class_level, stream, day_of_week, slot_code, event_type,
               subject_label, assignment_id, teacher_id, teacher_name, block_key,
               is_locked, is_manual, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              event.id,
              event.version_id,
              event.class_level,
              event.stream,
              event.day_of_week,
              event.slot_code,
              event.event_type,
              event.subject_label,
              event.assignment_id,
              event.teacher_id,
              event.teacher_name,
              event.block_key,
              event.is_locked,
              event.is_manual,
              event.created_at,
              event.updated_at,
            ]
          );
        }
        for (const session of undo.sessions || []) {
          await connection.query(
            `INSERT INTO timetable_teacher_sessions
              (id, version_id, event_id, teacher_id, teacher_name, assignment_id,
               subject_label, class_level, streams_label, day_of_week, slot_code,
               block_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              session.id,
              session.version_id,
              session.event_id,
              session.teacher_id,
              session.teacher_name,
              session.assignment_id,
              session.subject_label,
              session.class_level,
              session.streams_label,
              session.day_of_week,
              session.slot_code,
              session.block_key,
              session.created_at,
            ]
          );
        }
        await connection.query(
          `UPDATE timetable_versions
           SET generation_stats_json = ?, validation_json = ?
           WHERE id = ?`,
          [JSON.stringify(undo.stats || {}), JSON.stringify(undo.validation || {}), versionId]
        );
      }
      await connection.query(
        "UPDATE timetable_actions SET undone_at = NOW() WHERE id = ?",
        [action.id]
      );
      await connection.query("UPDATE timetable_versions SET updated_at = NOW() WHERE id = ?", [versionId]);
      await connection.commit();
      connection.release();
      connection = null;
      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "TIMETABLE_ACTION_UNDONE",
        entityType: "system",
        entityId: versionId,
        description: `Undid timetable ${action.action_type.replace(/_/g, " ")} action`,
        ipAddress: extractClientIp(req),
      });
      res.json(await readVersionDetail(pool, versionId));
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (connection) connection.release();
      console.error("Undo timetable action failed:", error);
      res.status(500).json({ message: "Failed to undo the timetable action." });
    }
  });

  return router;
}
