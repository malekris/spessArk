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
import { regenerateOLevelStreamLessons } from "./timetable.regenerator.js";
import { ensureTimetableSchemaReady } from "./timetable.schema.js";

const ALLOWED_REQUIREMENT_KINDS = new Set(["ordinary", "cluster", "project", "review"]);
const ALLOWED_VERSION_STATUSES = new Set(["draft", "frozen", "published", "archived"]);
const MANUAL_ORDINARY_SLOTS = {
  Monday: new Set(["P1", "P4", "P5"]),
  Tuesday: new Set(["P1", "P2", "P4", "P5"]),
  Wednesday: new Set(["P1", "P2", "P4", "P5"]),
  Thursday: new Set(["P1", "P2", "P4", "P5"]),
  Friday: new Set(["P1", "P2", "P3A", "P4", "P5"]),
};

const parseJson = (value, fallback) => {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const mergeConfig = (value) => ({
  ...DEFAULT_TIMETABLE_CONFIG,
  ...(value || {}),
  clusterWindows: {
    ...DEFAULT_TIMETABLE_CONFIG.clusterWindows,
    ...(value?.clusterWindows || {}),
  },
  aLevel: {
    ...DEFAULT_TIMETABLE_CONFIG.aLevel,
    ...(value?.aLevel || {}),
    subsidiaryBlocks: {
      ...DEFAULT_TIMETABLE_CONFIG.aLevel.subsidiaryBlocks,
      ...(value?.aLevel?.subsidiaryBlocks || {}),
    },
  },
});

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
  const config = mergeConfig(parseJson(row?.config_json, DEFAULT_TIMETABLE_CONFIG));
  if (String(row?.academic_year || "") !== academicYear) {
    await pool.query(
      "UPDATE timetable_settings SET academic_year = ?, updated_at = NOW() WHERE id = 1",
      [academicYear]
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
      (row.availableDays.length < 1 || row.availableDays.length > 3)
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
    if (targetDay === "Friday" && targetSlotCode === "P3A") {
      const { config } = await readTimetableConfig(pool);
      const simpleSubjects = new Set((config.simpleFridaySubjects || []).map(normalizeSubject));
      if (!simpleSubjects.has(normalizeSubject(event.subject_label))) {
        return `${event.subject_label} is not configured as a Friday short-lesson subject.`;
      }
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

  router.get("/setup", async (_req, res) => {
    try {
      const [{ academicYear, currentTerm, config, updatedAt }, seededAssignments, aLevelRows, versions] = await Promise.all([
        readTimetableConfig(pool),
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
      if (days.length < 1 || days.length > 3) {
        return res.status(400).json({ message: "Each teacher must have between 1 and 3 available days." });
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
      const [{ academicYear, config }, seededAssignments, aLevelRows] = await Promise.all([
        readTimetableConfig(pool),
        seedLessonRequirements(pool),
        loadActiveALevelAssignments(pool),
      ]);
      const allAssignments = await attachAvailability(pool, [...seededAssignments, ...aLevelRows]);
      const assignments = allAssignments.filter((row) => row.assignment_scope === "olevel");
      const aLevelAssignments = allAssignments.filter((row) => row.assignment_scope === "alevel");
      const readiness = buildReadiness(allAssignments);
      if (!readiness.ready) {
        return res.status(409).json({
          message: "Finish teacher availability, subject coverage, and A-Level paper staffing before generating.",
          readiness,
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
      const [{ config }, seededAssignments] = await Promise.all([
        readTimetableConfig(pool),
        seedLessonRequirements(pool),
      ]);
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
           AND action_type IN ('move', 'swap', 'lock_event', 'pin_teacher', 'status_change')
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
