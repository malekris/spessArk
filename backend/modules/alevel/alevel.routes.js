import express from "express";
import { db } from "../../server.js";
import authTeacher from "../../middleware/authTeacher.js";
import authAdmin, { requireAdminReauth } from "../../middleware/authAdmin.js";
import { pool } from "../../server.js";
import { extractClientIp, logAuditEvent } from "../../utils/auditLogger.js";
import { ensureMarksArchiveTablesReady, archiveALevelMarks } from "../../utils/marksArchive.js";
import { queueAdminYearSnapshotRefresh } from "../../services/adminYearSnapshotService.js";

import {
  getLearners,
  createLearner,
  updateLearner,
  deleteLearner,
} from "./alevel.controller.js";

const router = express.Router();
const AUDIT_ADMIN_USER_ID = 1;

const SINGLE_PAPER_SUBJECTS = new Set(["general paper", "sub math", "submath"]);

const normalizeSubjectName = (value = "") => String(value || "").trim().toLowerCase();

const isSinglePaperSubject = (subjectName = "") =>
  SINGLE_PAPER_SUBJECTS.has(normalizeSubjectName(subjectName));

const getPaperOptionsForSubject = (subjectName = "") =>
  isSinglePaperSubject(subjectName) ? ["Single"] : ["Paper 1", "Paper 2"];

const normalizePaperLabel = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "paper 1" || raw === "paper1" || raw === "p1") return "Paper 1";
  if (raw === "paper 2" || raw === "paper2" || raw === "p2") return "Paper 2";
  if (raw === "single" || raw === "single paper") return "Single";
  return "";
};

const normalizeAlevelTerm = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  const compact = raw.replace(/[\s_-]+/g, "");
  if (compact === "3" || compact === "term3" || compact === "iii" || compact === "termiii" || compact === "term1ii") return "Term 3";
  if (compact === "2" || compact === "term2" || compact === "ii" || compact === "termii" || compact === "term1i") return "Term 2";
  if (compact === "1" || compact === "term1" || compact === "i" || compact === "termi") return "Term 1";
  return String(value || "").trim() || "Term 1";
};

const NORMALIZED_ALEVEL_TERM_SQL = (columnName) => `
  CASE
    WHEN LOWER(REPLACE(REPLACE(REPLACE(TRIM(${columnName}), ' ', ''), '-', ''), '_', '')) IN ('3', 'term3', 'iii', 'termiii', 'term1ii') THEN 'Term 3'
    WHEN LOWER(REPLACE(REPLACE(REPLACE(TRIM(${columnName}), ' ', ''), '-', ''), '_', '')) IN ('2', 'term2', 'ii', 'termii', 'term1i') THEN 'Term 2'
    WHEN LOWER(REPLACE(REPLACE(REPLACE(TRIM(${columnName}), ' ', ''), '-', ''), '_', '')) IN ('1', 'term1', 'i', 'termi') THEN 'Term 1'
    ELSE TRIM(${columnName})
  END
`;

const normalizeAlevelComponent = (value = "") =>
  String(value || "").trim().toUpperCase();
const ALEVEL_MARK_COMPONENTS = ["MID", "EOT"];

const resolvePaperLabel = (subjectName = "", requestedPaper = "") => {
  const allowed = getPaperOptionsForSubject(subjectName);
  if (allowed.length === 1) return "Single";

  const normalized = normalizePaperLabel(requestedPaper);
  return allowed.includes(normalized) ? normalized : "Paper 1";
};

const buildSubjectDisplay = (subjectName = "", paperLabel = "") => {
  const resolvedPaper = normalizePaperLabel(paperLabel);
  return resolvedPaper && resolvedPaper !== "Single"
    ? `${subjectName} — ${resolvedPaper}`
    : subjectName;
};

const normalizeAssignmentStatus = (value = "") =>
  String(value || "active").trim().toLowerCase();

const activeAlevelAssignmentClause = (alias = "ats") =>
  `COALESCE(${alias}.assignment_status, 'active') = 'active' AND ${alias}.ended_at IS NULL`;

const getScopedTeacherIds = async (executor, teacher = {}) => {
  const ids = new Set();
  const teacherId = Number(teacher?.id);
  if (Number.isInteger(teacherId) && teacherId > 0) ids.add(teacherId);

  const teacherEmail = String(teacher?.email || "").trim().toLowerCase();
  if (teacherEmail) {
    const [[teacherRow]] = await executor.query(
      `SELECT id FROM teachers WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
      [teacherEmail]
    );
    if (teacherRow?.id) ids.add(Number(teacherRow.id));
  }

  return Array.from(ids).filter((id) => Number.isInteger(id) && id > 0);
};

let aLevelMarksSchemaReadyPromise = null;
let aLevelMarksHasCreatedAtPromise = null;
let aLevelAssignmentLifecycleReadyPromise = null;

const getActiveSchemaName = async (executor = db) => {
  if (process.env.DB_NAME) return process.env.DB_NAME;
  const [[row]] = await executor.query("SELECT DATABASE() AS db_name");
  return row?.db_name || null;
};

const getAlevelMarksHasCreatedAt = async (executor = db) => {
  if (!aLevelMarksHasCreatedAtPromise) {
    aLevelMarksHasCreatedAtPromise = (async () => {
      const schemaName = await getActiveSchemaName(executor);
      if (!schemaName) return false;

      const [[meta]] = await executor.query(
        `SELECT COUNT(*) AS count
         FROM information_schema.columns
         WHERE table_schema = ?
           AND table_name = 'alevel_marks'
           AND column_name = 'created_at'`,
        [schemaName]
      );

      return Number(meta?.count || 0) > 0;
    })().catch((err) => {
      aLevelMarksHasCreatedAtPromise = null;
      throw err;
    });
  }

  return aLevelMarksHasCreatedAtPromise;
};

const isLegacyAlevelUniqueIndex = (columnsCsv = "") => {
  const columns = String(columnsCsv || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return !columns.includes("assignment_id") &&
    ["learner_id", "subject_id", "exam_id", "teacher_id", "term"].every((column) =>
      columns.includes(column)
    );
};

const escapeIndexName = (value = "") => String(value).replace(/`/g, "``");

const ensureALevelMarksSchemaReady = async (executor = pool) => {
  if (!aLevelMarksSchemaReadyPromise) {
    aLevelMarksSchemaReadyPromise = (async () => {
      const schemaName = await getActiveSchemaName(executor);
      if (!schemaName) return;

      const hasCreatedAt = await getAlevelMarksHasCreatedAt(executor);
      if (!hasCreatedAt) {
        await executor.query(
          `ALTER TABLE alevel_marks
           ADD COLUMN created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP`
        );
        aLevelMarksHasCreatedAtPromise = Promise.resolve(true);
      }

      await executor.query(
        `UPDATE alevel_marks
         SET created_at = NOW()
         WHERE created_at IS NULL`
      );

      // Do not mutate A-Level unique indexes at request time.
      // That is too risky on a live save path and can lock or fail unexpectedly.
      // The save route below now handles legacy unanchored rows without requiring
      // an automatic index rewrite during teacher submissions.
    })().catch((err) => {
      aLevelMarksSchemaReadyPromise = null;
      aLevelMarksHasCreatedAtPromise = null;
      throw err;
    });
  }

  return aLevelMarksSchemaReadyPromise;
};

const alevelColumnExists = async (executor, tableName, columnName) => {
  const [[row]] = await executor.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(row?.total || 0) > 0;
};

const ensureALevelAssignmentLifecycleColumns = async (executor = pool) => {
  if (!aLevelAssignmentLifecycleReadyPromise) {
    aLevelAssignmentLifecycleReadyPromise = (async () => {
      await ensureALevelMarksSchemaReady(executor);

      if (!(await alevelColumnExists(executor, "alevel_teacher_subjects", "created_at"))) {
        await executor.query(
          `ALTER TABLE alevel_teacher_subjects
           ADD COLUMN created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP`
        );
      }

      if (!(await alevelColumnExists(executor, "alevel_teacher_subjects", "assignment_status"))) {
        await executor.query(
          `ALTER TABLE alevel_teacher_subjects
           ADD COLUMN assignment_status VARCHAR(20) NOT NULL DEFAULT 'active'`
        );
      }

      if (!(await alevelColumnExists(executor, "alevel_teacher_subjects", "ended_at"))) {
        await executor.query(
          `ALTER TABLE alevel_teacher_subjects
           ADD COLUMN ended_at TIMESTAMP NULL DEFAULT NULL`
        );
      }

      if (!(await alevelColumnExists(executor, "alevel_teacher_subjects", "ended_reason"))) {
        await executor.query(
          `ALTER TABLE alevel_teacher_subjects
           ADD COLUMN ended_reason VARCHAR(255) NULL DEFAULT NULL`
        );
      }

      if (!(await alevelColumnExists(executor, "alevel_teacher_subjects", "ended_by_admin_id"))) {
        await executor.query(
          `ALTER TABLE alevel_teacher_subjects
           ADD COLUMN ended_by_admin_id INT NULL DEFAULT NULL`
        );
      }

      if (!(await alevelColumnExists(executor, "alevel_teacher_subjects", "replaced_by_assignment_id"))) {
        await executor.query(
          `ALTER TABLE alevel_teacher_subjects
           ADD COLUMN replaced_by_assignment_id INT NULL DEFAULT NULL`
        );
      }

      await executor.query(
        `
        UPDATE alevel_teacher_subjects ats
        LEFT JOIN (
          SELECT assignment_id, MIN(created_at) AS first_mark_at
          FROM alevel_marks
          WHERE assignment_id IS NOT NULL
          GROUP BY assignment_id
        ) am ON am.assignment_id = ats.id
        SET
          ats.created_at = COALESCE(ats.created_at, am.first_mark_at, NOW()),
          ats.assignment_status = COALESCE(NULLIF(ats.assignment_status, ''), 'active')
        WHERE ats.created_at IS NULL
           OR ats.assignment_status IS NULL
           OR ats.assignment_status = ''
        `
      );
    })().catch((err) => {
      aLevelAssignmentLifecycleReadyPromise = null;
      throw err;
    });
  }

  return aLevelAssignmentLifecycleReadyPromise;
};
// ===== A-LEVEL LEARNERS =====
router.get("/learners", getLearners);
router.post("/learners", createLearner);
router.put("/learners/:id", updateLearner);
router.delete("/learners/:id", deleteLearner);

/* =========================================================
   A-LEVEL ADMIN ENDPOINTS
========================================================= */

// subjects
router.get("/subjects", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name 
      FROM alevel_subjects 
      ORDER BY name
    `);
    res.json(
      (rows || []).map((row) => ({
        ...row,
        is_single_paper: isSinglePaperSubject(row.name),
        paper_options: getPaperOptionsForSubject(row.name),
      }))
    );
  } catch (err) {
    console.error("subjects error:", err);
    res.status(500).json([]);
  }
});

// assignments (admin view)
router.get("/admin/assignments", authAdmin, async (req, res) => {
  try {
    await ensureALevelAssignmentLifecycleColumns(pool);

    const includeInactive = ["1", "true", "yes", "all"].includes(
      String(req.query.includeInactive || "").trim().toLowerCase()
    );
    const statusClause = includeInactive
      ? ""
      : `WHERE ${activeAlevelAssignmentClause("ats")}`;

    const [rows] = await db.query(`
      SELECT 
        ats.id,
        ats.teacher_id,
        ats.subject_id,
        ats.stream,
        ats.paper_label,
        s.name AS subject,
        ats.created_at,
        COALESCE(ats.assignment_status, 'active') AS assignment_status,
        ats.ended_at,
        ats.ended_reason,
        ats.ended_by_admin_id,
        ats.replaced_by_assignment_id,
        t.name AS teacher_name,
        t.email AS teacher_email,
        replacement_ats.teacher_id AS replacement_teacher_id,
        replacement_t.name AS replacement_teacher_name,
        replacement_ats.created_at AS replacement_created_at,
        (
          SELECT COUNT(*)
          FROM alevel_marks am
          LEFT JOIN alevel_learners l ON l.id = am.learner_id
          WHERE am.assignment_id = ats.id
             OR (
               am.assignment_id IS NULL
               AND am.subject_id = ats.subject_id
               AND am.teacher_id = ats.teacher_id
               AND l.stream = ats.stream
             )
        ) AS marks_count
      FROM alevel_teacher_subjects ats
      JOIN alevel_subjects s ON s.id = ats.subject_id
      LEFT JOIN teachers t ON t.id = ats.teacher_id
      LEFT JOIN alevel_teacher_subjects replacement_ats ON replacement_ats.id = ats.replaced_by_assignment_id
      LEFT JOIN teachers replacement_t ON replacement_t.id = replacement_ats.teacher_id
      ${statusClause}
      ORDER BY
        CASE WHEN ${activeAlevelAssignmentClause("ats")} THEN 0 ELSE 1 END,
        ats.stream,
        s.name,
        ats.paper_label,
        ats.ended_at DESC,
        ats.id DESC
    `);

    res.json(
      (rows || []).map((row) => ({
        ...row,
        paper_label: normalizePaperLabel(row.paper_label) || resolvePaperLabel(row.subject),
        subject_display: buildSubjectDisplay(row.subject, row.paper_label),
      }))
    );
  } catch (err) {
    console.error("admin assignments error:", err);
    res.status(500).json({ message: "Failed to fetch assignments" });
  }
});
// create assignment
router.post("/admin/assignments", authAdmin, async (req, res) => {
  const teacherId = Number(req.body?.teacherId);
  const subjectId = Number(req.body?.subjectId);
  const stream = String(req.body?.stream || "").trim();
  const paperLabel = String(req.body?.paperLabel || "").trim();
  const replaceAssignmentId = Number(req.body?.replaceAssignmentId || 0);
  const replaceReason = String(req.body?.replaceReason || "").trim();
  let conn;

  if (!teacherId || !subjectId || !stream) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    await ensureALevelAssignmentLifecycleColumns(pool);
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [[teacherRow]] = await conn.query(
      `SELECT id, name FROM teachers WHERE id = ? LIMIT 1`,
      [teacherId]
    );

    if (!teacherRow) {
      await conn.rollback();
      return res.status(404).json({ message: "Teacher not found" });
    }

    const [[subjectRow]] = await conn.query(
      `SELECT name FROM alevel_subjects WHERE id = ?`,
      [subjectId]
    );

    if (!subjectRow) {
      await conn.rollback();
      return res.status(404).json({ message: "Subject not found" });
    }

    const resolvedPaper = resolvePaperLabel(subjectRow.name, paperLabel);

    const [[sameTeacherAssignment]] = await conn.query(
      `SELECT ats.id
       FROM alevel_teacher_subjects ats
       WHERE ats.teacher_id = ?
         AND ats.subject_id = ?
         AND ats.stream = ?
         AND ats.paper_label = ?
         AND ${activeAlevelAssignmentClause("ats")}
       LIMIT 1`,
      [teacherId, subjectId, stream, resolvedPaper]
    );

    if (sameTeacherAssignment) {
      await conn.rollback();
      return res.status(409).json({
        message: `${teacherRow.name || "This teacher"} already owns ${buildSubjectDisplay(subjectRow.name, resolvedPaper)} in ${stream}.`,
      });
    }

    const [conflicts] = await conn.query(
      `SELECT ats.id, ats.teacher_id, COALESCE(t.name, 'Another teacher') AS teacher_name
       FROM alevel_teacher_subjects ats
       LEFT JOIN teachers t ON t.id = ats.teacher_id
       WHERE ats.subject_id = ?
         AND ats.stream = ?
         AND ats.paper_label = ?
         AND ${activeAlevelAssignmentClause("ats")}
       FOR UPDATE`,
      [subjectId, stream, resolvedPaper]
    );
    const activeConflict = conflicts[0] || null;

    if (activeConflict && (!replaceAssignmentId || Number(activeConflict.id) !== replaceAssignmentId)) {
      await conn.rollback();
      const teacherName = String(activeConflict.teacher_name || "Another teacher").trim() || "Another teacher";

      return res.status(409).json({
        message: `${buildSubjectDisplay(subjectRow.name, resolvedPaper)} is already assigned to ${teacherName} in ${stream}. Use Replace Teacher to hand this paper over without deleting marks.`,
        activeAssignment: {
          id: Number(activeConflict.id),
          teacherId: Number(activeConflict.teacher_id),
          teacherName,
          subject: subjectRow.name,
          stream,
          paperLabel: resolvedPaper,
        },
      });
    }

    if (replaceAssignmentId && !activeConflict) {
      await conn.rollback();
      return res.status(404).json({
        message: "The assignment being replaced is no longer active.",
      });
    }

    if (activeConflict && Number(activeConflict.teacher_id) === teacherId) {
      await conn.rollback();
      return res.status(409).json({
        message: "This teacher already owns the active assignment for this A-Level paper.",
      });
    }

    const [result] = await conn.query(
      `INSERT INTO alevel_teacher_subjects
       (teacher_id, subject_id, stream, paper_label, assignment_status, created_at)
       VALUES (?, ?, ?, ?, 'active', NOW())`,
      [teacherId, subjectId, stream, resolvedPaper]
    );

    if (activeConflict) {
      await conn.query(
        `UPDATE alevel_teacher_subjects
         SET assignment_status = 'inactive',
             ended_at = NOW(),
             ended_reason = ?,
             ended_by_admin_id = ?,
             replaced_by_assignment_id = ?
         WHERE id = ?`,
        [
          replaceReason || `Replaced by ${teacherRow.name || `teacher #${teacherId}`}`,
          Number(req.admin?.id) || AUDIT_ADMIN_USER_ID,
          result.insertId,
          activeConflict.id,
        ]
      );
    }

    await conn.commit();
    conn.release();
    conn = null;

    await logAuditEvent({
      userId: Number(req.admin?.id) || AUDIT_ADMIN_USER_ID,
      userRole: "admin",
      action: activeConflict ? "REPLACE_ALEVEL_ASSIGNMENT_TEACHER" : "ASSIGN_SUBJECT",
      entityType: "subject",
      entityId: Number(result.insertId),
      description: activeConflict
        ? `${buildSubjectDisplay(subjectRow.name, resolvedPaper)} in ${stream} handed over from teacher #${activeConflict.teacher_id} to teacher #${teacherId}`
        : `${buildSubjectDisplay(subjectRow.name, resolvedPaper)} assigned to ${stream} (teacher #${teacherId})`,
      ipAddress: extractClientIp(req),
    });

    queueAdminYearSnapshotRefresh(db, activeConflict ? "alevel-assignment-replace" : "alevel-assignment-create");
    res.status(201).json({
      success: true,
      id: Number(result.insertId),
      teacherId,
      teacher_name: teacherRow.name,
      subjectId,
      subject: subjectRow.name,
      stream,
      paperLabel: resolvedPaper,
      assignment_status: "active",
      replacedAssignmentId: activeConflict?.id || null,
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackError) { console.error("A-Level assignment create rollback error:", rollbackError); }
      conn.release();
    }
    console.error("POST assignment error:", err);
    res.status(500).json({ message: "Failed to save assignment" });
  }
});

// delete assignment
router.delete("/admin/assignments/:id", authAdmin, requireAdminReauth, async (req, res) => {
  let conn;
  try {
    const assignmentId = Number(req.params.id);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ message: "Invalid assignment id" });
    }

    await ensureALevelAssignmentLifecycleColumns(pool);
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [[assignment]] = await conn.query(
      `SELECT ats.id, ats.subject_id, ats.teacher_id, ats.stream, ats.paper_label, s.name AS subject,
              COALESCE(ats.assignment_status, 'active') AS assignment_status,
              ats.ended_at
       FROM alevel_teacher_subjects ats
       JOIN alevel_subjects s ON s.id = ats.subject_id
       WHERE ats.id = ?
       FOR UPDATE`,
      [assignmentId]
    );

    if (!assignment) {
      await conn.rollback();
      return res.status(404).json({ message: "Assignment not found" });
    }

    const [[marksMeta]] = await conn.query(
      `SELECT COUNT(*) AS count
       FROM alevel_marks am
       LEFT JOIN alevel_learners l ON l.id = am.learner_id
       WHERE am.assignment_id = ?
          OR (
            am.assignment_id IS NULL
            AND am.subject_id = ?
            AND am.teacher_id = ?
            AND l.stream = ?
          )`,
      [assignment.id, assignment.subject_id, assignment.teacher_id, assignment.stream]
    );

    if (Number(marksMeta?.count || 0) > 0) {
      const [result] = await conn.query(
        `UPDATE alevel_teacher_subjects
         SET assignment_status = 'inactive',
             ended_at = COALESCE(ended_at, NOW()),
             ended_reason = COALESCE(?, ended_reason, 'Ended by admin; marks retained'),
             ended_by_admin_id = COALESCE(ended_by_admin_id, ?)
         WHERE id = ?`,
        [
          String(req.body?.reason || "").trim() || "Ended by admin; marks retained",
          Number(req.admin?.id) || AUDIT_ADMIN_USER_ID,
          assignmentId,
        ]
      );

      if (result.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({ message: "Assignment not found" });
      }

      await conn.commit();
      conn.release();
      conn = null;

      await logAuditEvent({
        userId: Number(req.admin?.id) || AUDIT_ADMIN_USER_ID,
        userRole: "admin",
        action: "END_ALEVEL_ASSIGNMENT",
        entityType: "subject",
        entityId: Number(assignment.id),
        description: `Ended A-Level assignment ${buildSubjectDisplay(assignment.subject, assignment.paper_label)} in ${assignment.stream}; retained ${marksMeta.count} mark rows`,
        ipAddress: extractClientIp(req),
      });
      queueAdminYearSnapshotRefresh(db, "alevel-assignment-end");
      return res.json({
        success: true,
        message: "A-Level assignment ended. Existing marks were retained for reports and handover history.",
        action: "ended",
        retainedMarks: Number(marksMeta.count || 0),
      });
    }

    await conn.query(
      `UPDATE alevel_teacher_subjects
       SET replaced_by_assignment_id = NULL
       WHERE replaced_by_assignment_id = ?`,
      [assignmentId]
    );

    await conn.query(`DELETE FROM alevel_teacher_subjects WHERE id = ?`, [assignmentId]);
    await conn.commit();
    conn.release();
    conn = null;

    await logAuditEvent({
      userId: AUDIT_ADMIN_USER_ID,
      userRole: "admin",
      action: "REMOVE_ASSIGNMENT",
      entityType: "subject",
      entityId: Number(assignment.id),
      description: `Removed A-Level assignment ${buildSubjectDisplay(assignment.subject, assignment.paper_label)} from ${assignment.stream} (teacher #${assignment.teacher_id})`,
      ipAddress: extractClientIp(req),
    });
    queueAdminYearSnapshotRefresh(db, "alevel-assignment-delete");
    res.json({
      success: true,
      message: "Empty A-Level assignment deleted successfully.",
      action: "deleted",
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackError) { console.error("A-Level delete assignment rollback error:", rollbackError); }
      conn.release();
    }
    console.error("delete assignment error:", err);
    res.status(500).json({ message: "Failed to delete" });
  }
});

/* GET A-Level assignments (scoped to logged-in teacher) */
router.get("/teachers/alevel-assignments", authTeacher, async (req, res) => {
  try {
    await ensureALevelAssignmentLifecycleColumns(pool);
    const scopedTeacherIds = await getScopedTeacherIds(db, req.teacher);
    if (scopedTeacherIds.length === 0) return res.json([]);
    const teacherPlaceholders = scopedTeacherIds.map(() => "?").join(", ");

    const [rows] = await db.query(`
      SELECT
        ats.id,
        ats.stream,
        ats.paper_label,
        s.name AS subject
      FROM alevel_teacher_subjects ats
      JOIN alevel_subjects s ON s.id = ats.subject_id
      WHERE ats.teacher_id IN (${teacherPlaceholders})
        AND ${activeAlevelAssignmentClause("ats")}
      ORDER BY ats.id DESC
    `, scopedTeacherIds);

    res.json(
      (rows || []).map((row) => ({
        ...row,
        paper_label: normalizePaperLabel(row.paper_label) || resolvePaperLabel(row.subject),
        subject_display: buildSubjectDisplay(row.subject, row.paper_label),
      }))
    );
  } catch (err) {
    console.error("alevel assignments error:", err);
    res.status(500).json({ message: "Failed to fetch alevel assignments" });
  }
});

/* GET A-Level assignments by logged-in teacher email (id-drift safe) */
router.get("/teachers/alevel-assignments-by-email", authTeacher, async (req, res) => {
  try {
    await ensureALevelAssignmentLifecycleColumns(pool);
    const scopedTeacherIds = await getScopedTeacherIds(db, req.teacher);
    if (scopedTeacherIds.length === 0) return res.json([]);
    const teacherPlaceholders = scopedTeacherIds.map(() => "?").join(", ");

    const [rows] = await db.query(
      `
      SELECT
        ats.id,
        ats.stream,
        ats.paper_label,
        s.name AS subject
      FROM alevel_teacher_subjects ats
      JOIN alevel_subjects s ON s.id = ats.subject_id
      WHERE ats.teacher_id IN (${teacherPlaceholders})
        AND ${activeAlevelAssignmentClause("ats")}
      ORDER BY ats.id DESC
      `,
      scopedTeacherIds
    );

    res.json(
      (rows || []).map((row) => ({
        ...row,
        paper_label: normalizePaperLabel(row.paper_label) || resolvePaperLabel(row.subject),
        subject_display: buildSubjectDisplay(row.subject, row.paper_label),
      }))
    );
  } catch (err) {
    console.error("alevel assignments by email error:", err);
    res.status(500).json({ message: "Failed to fetch alevel assignments" });
  }
});

/* GET learners for an A-Level assignment */
router.get("/teachers/alevel-assignments/:id/students", authTeacher, async (req, res) => {
  const { id } = req.params;

  try {
    await ensureALevelAssignmentLifecycleColumns(pool);
    const scopedTeacherIds = await getScopedTeacherIds(db, req.teacher);
    if (scopedTeacherIds.length === 0) return res.json([]);
    const teacherPlaceholders = scopedTeacherIds.map(() => "?").join(", ");

    const [[assignment]] = await db.query(
      `SELECT subject_id, stream
       FROM alevel_teacher_subjects ats
       WHERE ats.id = ?
         AND ats.teacher_id IN (${teacherPlaceholders})
         AND ${activeAlevelAssignmentClause("ats")}`,
      [id, ...scopedTeacherIds]
    );

    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    const [rows] = await db.query(`
      SELECT 
        l.id,
        CONCAT(l.first_name, ' ', l.last_name) AS name,
        l.gender,
        l.stream
      FROM alevel_learner_subjects als
      JOIN alevel_learners l ON l.id = als.learner_id
      WHERE als.subject_id = ?
        AND l.stream = ?
      ORDER BY l.first_name, l.last_name
    `, [assignment.subject_id, assignment.stream]);

    res.json(rows || []);
  } catch (err) {
    console.error("alevel students error:", err);
    res.status(500).json({ message: "Failed to load learners" });
  }
});
/* GET marks */
router.get("/teachers/alevel-marks", authTeacher, async (req, res) => {
  try {
    const { assignmentId, term, year } = req.query;

    if (!assignmentId || !term) return res.json([]);
    await ensureALevelAssignmentLifecycleColumns(pool);
    const scopedTeacherIds = await getScopedTeacherIds(db, req.teacher);
    if (scopedTeacherIds.length === 0) return res.json([]);
    const teacherPlaceholders = scopedTeacherIds.map(() => "?").join(", ");
    const normalizedTerm = normalizeAlevelTerm(term);

    // Get assignment context scoped to the logged-in teacher.
    const [[ts]] = await db.query(
      `SELECT ats.id, ats.subject_id, ats.teacher_id, ats.stream, ats.paper_label, s.name AS subject_name
       FROM alevel_teacher_subjects ats
       JOIN alevel_subjects s ON s.id = ats.subject_id
       WHERE ats.id = ?
         AND ats.teacher_id IN (${teacherPlaceholders})
         AND ${activeAlevelAssignmentClause("ats")}`,
      [assignmentId, ...scopedTeacherIds]
    );

    if (!ts) return res.json([]);
    const resolvedPaper = normalizePaperLabel(ts.paper_label) || resolvePaperLabel(ts.subject_name, ts.paper_label);
    const hasCreatedAt = await getAlevelMarksHasCreatedAt(db);
    const yearClause =
      year && hasCreatedAt ? "AND YEAR(am.created_at) = ?" : "";

    const [rows] = await db.query(`
      SELECT 
        am.assignment_id,
        am.learner_id AS student_id,
        ae.name AS aoi_label,
        am.score,
        CASE 
          WHEN am.score IS NULL THEN 'Missed' 
          ELSE 'Present' 
        END AS status
      FROM alevel_marks am
      JOIN alevel_exams ae 
        ON ae.id = am.exam_id
      LEFT JOIN alevel_learners l ON l.id = am.learner_id
      WHERE ${NORMALIZED_ALEVEL_TERM_SQL("am.term")} = ?
        AND (
          am.assignment_id IN (
            SELECT slot.id
            FROM alevel_teacher_subjects slot
            WHERE slot.subject_id = ?
              AND slot.stream = ?
              AND COALESCE(NULLIF(slot.paper_label, ''), 'Single') = ?
          )
          OR (
            am.assignment_id IS NULL
            AND am.subject_id = ?
            AND l.stream = ?
          )
        )
        ${yearClause}
      ORDER BY
        am.learner_id,
        FIELD(ae.name, 'MID', 'EOT'),
        CASE WHEN am.assignment_id = ? THEN 0 ELSE 1 END,
        am.id DESC
    `, [
      normalizedTerm,
      ts.subject_id,
      ts.stream,
      resolvedPaper,
      ts.subject_id,
      ts.stream,
      ...(year && hasCreatedAt ? [year] : []),
      ts.id,
    ]);

    const deduped = new Map();
    for (const row of rows || []) {
      const key = `${row.student_id}:${row.aoi_label}`;
      const existing = deduped.get(key);
      const currentIsAnchored = Number(row.assignment_id || 0) === Number(ts.id);
      const existingIsAnchored =
        Number(existing?.assignment_id || 0) === Number(ts.id);

      if (!existing || (currentIsAnchored && !existingIsAnchored)) {
        deduped.set(key, row);
      }
    }

    res.json(
      Array.from(deduped.values()).map(({ assignment_id, ...row }) => row)
    );
  } catch (err) {
    console.error("❌ A-Level marks error:", err);
    res.status(500).json({ message: "Failed to fetch marks" });
  }
});


/* SAVE marks */
router.post("/teachers/alevel-marks", authTeacher, async (req, res) => {
  const { assignmentId, term, year, marks } = req.body;
  const clearMarks = Array.isArray(req.body?.clearMarks) ? req.body.clearMarks : [];
  let conn = null;

  if (!assignmentId || !term || !Array.isArray(marks)) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  try {
    await ensureALevelAssignmentLifecycleColumns(pool);
    await ensureMarksArchiveTablesReady(pool);
    conn = await db.getConnection();
    await conn.beginTransaction();
    const teacherId = Number(req.teacher?.id);
    const scopedTeacherIds = await getScopedTeacherIds(conn, req.teacher);
    if (scopedTeacherIds.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: "Assignment not found" });
    }
    const teacherPlaceholders = scopedTeacherIds.map(() => "?").join(", ");

    // 1. Get assignment context scoped to the logged-in teacher
    const [[ts]] = await conn.query(
      `SELECT ats.id, ats.subject_id, ats.teacher_id, ats.stream, ats.paper_label, s.name AS subject_name
       FROM alevel_teacher_subjects ats
       JOIN alevel_subjects s ON s.id = ats.subject_id
       WHERE ats.id = ?
         AND ats.teacher_id IN (${teacherPlaceholders})
         AND ${activeAlevelAssignmentClause("ats")}`,
      [assignmentId, ...scopedTeacherIds]
    );

    if (!ts) {
      await conn.rollback();
      return res.status(404).json({ message: "Assignment not found" });
    }

    const normalizedYear =
      Number.isInteger(Number(year)) && Number(year) > 0
        ? Number(year)
        : new Date().getFullYear();
    const normalizedTerm = normalizeAlevelTerm(term);
    const resolvedPaper = normalizePaperLabel(ts.paper_label) || resolvePaperLabel(ts.subject_name, ts.paper_label);

    const [slotAssignments] = await conn.query(
      `SELECT id
       FROM alevel_teacher_subjects slot
       WHERE slot.subject_id = ?
         AND slot.stream = ?
         AND COALESCE(NULLIF(slot.paper_label, ''), 'Single') = ?`,
      [ts.subject_id, ts.stream, resolvedPaper]
    );
    const slotAssignmentIds = Array.from(
      new Set(
        [...(slotAssignments || []).map((row) => Number(row.id)), Number(ts.id)]
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
    const slotPlaceholders = slotAssignmentIds.map(() => "?").join(", ");

    const [[existingMarksMeta]] = await conn.query(
      `SELECT COUNT(*) AS count
       FROM alevel_marks am
       LEFT JOIN alevel_learners l ON l.id = am.learner_id
       WHERE ${NORMALIZED_ALEVEL_TERM_SQL("am.term")} = ?
         AND (
           am.assignment_id IN (${slotPlaceholders})
           OR (
             am.assignment_id IS NULL
             AND am.subject_id = ?
             AND l.stream = ?
           )
         )`,
      [normalizedTerm, ...slotAssignmentIds, ts.subject_id, ts.stream]
    );
    const hasExistingMarks = Number(existingMarksMeta?.count || 0) > 0;

    // 2. Get exam IDs (MID, EOT)
    const [exams] = await conn.query(
      `SELECT id, name FROM alevel_exams WHERE name IN ('MID', 'EOT')`
    );

    const examMap = {};
    exams.forEach(e => examMap[e.name] = e.id);
    const touchedComponents = Array.from(
      new Set(
        [...marks, ...clearMarks]
          .map((entry) => normalizeAlevelComponent(entry?.aoi))
          .filter((component) => ALEVEL_MARK_COMPONENTS.includes(component))
      )
    );

    for (const component of touchedComponents) {
      if (!examMap[component]) {
        await conn.rollback();
        return res.status(400).json({ message: `Exam setup missing for ${component}` });
      }
    }

    // 3. Replace only the unlocked components being saved, keeping locked components intact.
    if (touchedComponents.length > 0) {
      const examIdsToReplace = touchedComponents.map((component) => examMap[component]);
      const placeholders = examIdsToReplace.map(() => "?").join(", ");
      const replaceParams = [
        normalizedTerm,
        ...examIdsToReplace,
        ...slotAssignmentIds,
        ts.subject_id,
        ts.stream,
      ];

      await archiveALevelMarks(conn, {
        whereSql: `
          ${NORMALIZED_ALEVEL_TERM_SQL("am.term")} = ?
          AND am.exam_id IN (${placeholders})
          AND (
            am.assignment_id IN (${slotPlaceholders})
            OR (
              am.assignment_id IS NULL
              AND am.subject_id = ?
              AND am.learner_id IN (
                SELECT id FROM alevel_learners WHERE stream = ?
              )
            )
          )
        `,
        params: replaceParams,
        deletedByUserId: teacherId,
        deletedByRole: "teacher",
        deleteReason: `Teacher replaced ${touchedComponents.join(", ")} for ${buildSubjectDisplay(ts.subject_name, ts.paper_label)} in ${normalizedTerm} ${normalizedYear}`,
        sourceAction: "REPLACE_MARKS_SET",
      });

      await conn.query(
        `DELETE am
         FROM alevel_marks am
         WHERE ${NORMALIZED_ALEVEL_TERM_SQL("am.term")} = ?
           AND am.exam_id IN (${placeholders})
           AND (
             am.assignment_id IN (${slotPlaceholders})
             OR (
               am.assignment_id IS NULL
               AND am.subject_id = ?
               AND am.learner_id IN (
                 SELECT id FROM alevel_learners WHERE stream = ?
               )
             )
           )`,
        replaceParams
      );
    }

    // 4. Insert new marks
    const rows = [];
    for (const mark of marks) {
      const aoi = normalizeAlevelComponent(mark?.aoi);
      if (!ALEVEL_MARK_COMPONENTS.includes(aoi)) {
        await conn.rollback();
        return res.status(400).json({ message: "A-Level marks must use MID or EOT." });
      }

      const isMissed = mark.score === "Missed";
      if (!isMissed) {
        const scoreNum = Number(mark.score);
        if (!Number.isFinite(scoreNum) || scoreNum < 0 || scoreNum > 100) {
          await conn.rollback();
          return res.status(400).json({ message: "A-Level score must be between 0 and 100." });
        }
      }

      rows.push([
        mark.studentId,
        ts.id,
        ts.subject_id,
        examMap[aoi],
        isMissed ? null : Number(mark.score),
        teacherId,
        normalizedTerm,
      ]);
    }

    if (rows.length > 0) {
      await conn.query(
        `INSERT INTO alevel_marks 
        (learner_id, assignment_id, subject_id, exam_id, score, teacher_id, term)
        VALUES ?`,
        [rows]
      );
    }

    await conn.commit();

    const marksAction = hasExistingMarks ? "UPDATE_MARKS" : "SUBMIT_MARKS";
    const marksVerb = marksAction === "UPDATE_MARKS" ? "Updated" : "Submitted";
    await logAuditEvent({
      userId: teacherId,
      userRole: "teacher",
      action: marksAction,
      entityType: "marks",
      entityId: Number(ts.id),
      description: `${marksVerb} A-Level marks for ${buildSubjectDisplay(ts.subject_name, ts.paper_label)} in ${ts.stream} (${normalizedTerm} ${normalizedYear})`,
      ipAddress: extractClientIp(req),
    });

    res.json({ success: true });
  } catch (err) {
    if (conn) {
      await conn.rollback();
    }
    console.error("❌ Save A-Level marks error:", err);
    if (err?.code === "ER_DUP_ENTRY") {
      if (String(err?.sqlMessage || "").includes("alevel_marks.uniq_mark")) {
        return res.status(409).json({
          message:
            "Paper-based A-Level saving is being blocked by the old alevel_marks unique key in the database. Existing marks are still safe, but the database now needs the Paper 1 / Paper 2 unique-key migration before this save can succeed.",
        });
      }
      return res.status(409).json({
        message:
          "A-Level marks could not be saved because older marks for this paper are still colliding with the new paper-based setup. The save path has been tightened; please try again after redeploy.",
      });
    }
    res.status(500).json({ message: "Failed to save marks" });
  } finally {
    if (conn) {
      conn.release();
    }
  }
});
// ================================
// A-LEVEL ANALYTICS (Teacher)
// ================================
router.get("/alevel-analytics/subject", authTeacher, async (req, res) => {
  try {
    const { assignmentId, examType, term } = req.query;
    const teacherId = req.teacher?.id;

    if (!assignmentId || !term || !teacherId) {
      return res.json({ aois: [], overall_average: "—" });
    }

    // 1. Get assignment context (subject + stream)
    const [[ts]] = await db.query(
      `SELECT ats.id, ats.subject_id, ats.stream, ats.paper_label, s.name AS subject_name
       FROM alevel_teacher_subjects ats
       JOIN alevel_subjects s ON s.id = ats.subject_id
       WHERE ats.id = ?`,
      [assignmentId]
    );

    if (!ts) return res.json({ aois: [], overall_average: "—" });

    const examFilter = examType ? "AND ae.name = ?" : "";
    const examParams = examType ? [examType] : [];

    // 2. AOI-level stats (stream-aware)
    const [aoiRows] = await db.query(
      `
      SELECT
        ae.name AS aoi_label,
        COUNT(*) AS attempts,
        AVG(am.score) AS average_score,
        SUM(CASE WHEN am.score IS NULL THEN 1 ELSE 0 END) AS missed_count
      FROM alevel_marks am
      JOIN alevel_exams ae ON ae.id = am.exam_id
      JOIN alevel_learners l ON l.id = am.learner_id
      WHERE am.assignment_id = ?
        AND am.term = ?
        AND l.stream = ?
        ${examFilter}
      GROUP BY ae.name
      ORDER BY FIELD(ae.name, 'MID', 'EOT'), ae.name
      `,
      [ts.id, term, ts.stream, ...examParams]
    );

    // 3. Overall average (stream-aware)
    const [[overall]] = await db.query(
      `
      SELECT
        AVG(am.score) AS overall_average
      FROM alevel_marks am
      JOIN alevel_learners l ON l.id = am.learner_id
      JOIN alevel_exams ae ON ae.id = am.exam_id
      WHERE am.assignment_id = ?
        AND am.term = ?
        AND l.stream = ?
        ${examFilter}
      `,
      [ts.id, term, ts.stream, ...examParams]
    );

    // 4. Registered learners for this subject + stream
    const [[reg]] = await db.query(
      `
      SELECT COUNT(DISTINCT als.learner_id) AS registered_learners
      FROM alevel_learner_subjects als
      JOIN alevel_learners l ON l.id = als.learner_id
      WHERE als.subject_id = ?
        AND l.stream = ?
      `,
      [ts.subject_id, ts.stream]
    );

    return res.json({
      meta: {
        registered_learners: reg?.registered_learners ?? 0,
        term,
      },
      aois: (aoiRows || []).map((r) => {
        const avg = Number(r.average_score);
        return {
          aoi_label: r.aoi_label,
          attempts: r.attempts ?? 0,
          average_score: Number.isFinite(avg) ? avg.toFixed(2) : "—",
          missed_count: r.missed_count ?? 0,
        };
      }),
      overall_average: Number.isFinite(Number(overall?.overall_average))
        ? Number(overall.overall_average).toFixed(2)
        : "—",
      assignment: { subject: ts.subject_name || "A-Level" },
      assignment_paper: normalizePaperLabel(ts.paper_label) || resolvePaperLabel(ts.subject_name),
      subject_display: buildSubjectDisplay(ts.subject_name || "A-Level", ts.paper_label),
    });
  } catch (err) {
    console.error("❌ A-Level analytics crash:", err);
    res.status(500).json({ message: "Failed to load analytics" });
  }
});
// =======================================
// A-LEVEL DOWNLOAD — FETCH MARK SETS
// =======================================
router.get("/admin/marks-sets", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT DISTINCT
        am.assignment_id AS assignment_id,
        'A-Level' AS class_level,
        l.stream,
        s.name AS subject,
        ats.paper_label,
      ${NORMALIZED_ALEVEL_TERM_SQL("am.term")} AS term,
        YEAR(am.created_at) AS year,
        ae.name AS aoi_label,
        t.name AS teacher_name
      FROM alevel_marks am
      JOIN alevel_teacher_subjects ats ON ats.id = am.assignment_id
      JOIN alevel_subjects s ON s.id = am.subject_id
      JOIN teachers t ON t.id = am.teacher_id
      JOIN alevel_learners l ON l.id = am.learner_id
      JOIN alevel_exams ae ON ae.id = am.exam_id
      ORDER BY year DESC, term, subject, stream
    `);

    res.json(
      (rows || []).map((row) => ({
        ...row,
        paper_label: normalizePaperLabel(row.paper_label) || resolvePaperLabel(row.subject),
        subject_display: buildSubjectDisplay(row.subject, row.paper_label),
      }))
    );
  } catch (err) {
    console.error("A-Level marks sets error:", err);
    res.status(500).json({ message: "Failed to load A-Level mark sets" });
  }
});
// =======================================
// A-LEVEL DOWNLOAD — FETCH MARK DETAILS
// =======================================
router.get("/admin/marks-detail", async (req, res) => {
  try {
    const { assignmentId, term, year, aoi } = req.query;

    if (!assignmentId || !term || !year || !aoi) {
      return res.status(400).json({ message: "Missing params" });
    }

    const [[ts]] = await db.query(
      `SELECT id, subject_id, paper_label FROM alevel_teacher_subjects WHERE id = ?`,
      [assignmentId]
    );

    if (!ts) return res.json([]);

    const [[exam]] = await db.query(
      `SELECT id FROM alevel_exams WHERE name = ?`,
      [aoi] // MID / EOT
    );

    if (!exam) return res.json([]);

    const [rows] = await db.query(`
      SELECT
        CONCAT(l.first_name, ' ', l.last_name) AS student_name,
        'A-Level' AS class_level,
        l.stream,
        am.score,
        ae.name AS aoi_label
      FROM alevel_marks am
      JOIN alevel_learners l ON l.id = am.learner_id
      JOIN alevel_exams ae ON ae.id = am.exam_id
      WHERE am.assignment_id = ?
        AND am.term = ?
        AND am.exam_id = ?
        AND YEAR(am.created_at) = ?
      ORDER BY l.first_name, l.last_name
    `, [ts.id, term, exam.id, year]);

    res.json(
      (rows || []).map((row) => ({
        ...row,
        paper_label: normalizePaperLabel(ts.paper_label) || null,
      }))
    );
  } catch (err) {
    console.error("A-Level marks detail error:", err);
    res.status(500).json({ message: "Failed to load marks detail" });
  }
});
router.get("/stats", async (req, res) => {
  try {
    const [learners] = await db.query(`
      SELECT 
        stream,
        SUM(gender = 'Male') AS boys,
        SUM(gender = 'Female') AS girls,
        COUNT(*) AS total
      FROM alevel_learners
      GROUP BY stream
      ORDER BY stream
    `);

    const [[teachers]] = await db.query(`
      SELECT COUNT(*) AS total FROM teachers
    `);
    

    res.json({
      streams: learners,
      teachers: teachers.total
    });
  } catch (err) {
    console.error("A-Level stats error:", err);
    res.status(500).json({ message: "Failed to load stats" });
  }
});

const buildAlevelDashboardInsights = async ({ term, year }, executor = db) => {
  await ensureALevelMarksSchemaReady(pool);

  const normalizedTerm = normalizeAlevelTerm(term || "Term 1");
  const normalizedYear =
    Number.isFinite(Number(year)) && Number(year) > 0
      ? Number(year)
      : new Date().getFullYear();

  const [registrationRows] = await executor.query(
    `
    SELECT
      l.id AS learner_id,
      CONCAT(l.first_name, ' ', l.last_name) AS learner_name,
      l.stream,
      COALESCE(l.combination, '—') AS combination,
      s.id AS subject_id,
      s.name AS subject_name
    FROM alevel_learners l
    JOIN alevel_learner_subjects als ON als.learner_id = l.id
    JOIN alevel_subjects s ON s.id = als.subject_id
    ORDER BY l.stream ASC, l.first_name ASC, l.last_name ASC, s.name ASC
    `
  );

  const [assignmentRows] = await executor.query(
    `
    SELECT
      ats.id AS assignment_id,
      ats.stream,
      ats.subject_id,
      ats.paper_label,
      COALESCE(t.name, 'Unassigned') AS teacher_name
    FROM alevel_teacher_subjects ats
    LEFT JOIN teachers t ON t.id = ats.teacher_id
    `
  );

  const hasCreatedAt = await getAlevelMarksHasCreatedAt(executor);
  const markParams = [normalizedTerm];
  let markYearClause = "";
  if (hasCreatedAt) {
    markYearClause = "AND YEAR(COALESCE(am.created_at, NOW())) = ?";
    markParams.push(normalizedYear);
  }

  const [markRows] = await executor.query(
    `
    SELECT
      am.id,
      am.learner_id,
      am.subject_id,
      s.name AS subject_name,
      ae.name AS component,
      ats.paper_label,
      am.score
    FROM alevel_marks am
    JOIN alevel_exams ae ON ae.id = am.exam_id
    JOIN alevel_subjects s ON s.id = am.subject_id
    LEFT JOIN alevel_teacher_subjects ats ON ats.id = am.assignment_id
    WHERE ${NORMALIZED_ALEVEL_TERM_SQL("am.term")} = ?
      ${markYearClause}
      AND ae.name IN ('MID', 'EOT')
    ORDER BY am.id DESC
    `,
    markParams
  );

  const assignmentsByKey = new Map();
  for (const row of assignmentRows || []) {
    const paperLabel = normalizePaperLabel(row.paper_label) || "Single";
    const key = `${row.stream}|${row.subject_id}|${paperLabel}`;
    assignmentsByKey.set(key, {
      assignmentId: row.assignment_id,
      teacherName: row.teacher_name || "Unassigned",
      paperLabel,
    });
  }

  const marksByKey = new Map();
  for (const row of markRows || []) {
    const resolvedPaper = normalizePaperLabel(row.paper_label) ||
      (isSinglePaperSubject(row.subject_name) ? "Single" : "");
    if (!resolvedPaper) continue;

    const key = `${row.learner_id}|${row.subject_id}|${resolvedPaper}|${normalizeAlevelComponent(row.component)}`;
    if (!marksByKey.has(key)) {
      marksByKey.set(key, {
        score: row.score,
        component: normalizeAlevelComponent(row.component),
      });
    }
  }

  const candidateMap = new Map();
  const coverageMap = new Map();
  const assignmentCoverageMap = new Map();

  for (const row of assignmentRows || []) {
    const paperLabel = normalizePaperLabel(row.paper_label) || "Single";
    const subjectName =
      (registrationRows || []).find((entry) => Number(entry.subject_id) === Number(row.subject_id))?.subject_name ||
      "";
    const subjectDisplay = buildSubjectDisplay(subjectName || "Subject", paperLabel);
    const assignmentKey = `${row.stream}|${row.subject_id}|${paperLabel}`;
    if (!assignmentCoverageMap.has(assignmentKey)) {
      assignmentCoverageMap.set(assignmentKey, {
        stream: row.stream || "—",
        subjectId: Number(row.subject_id),
        subject: subjectName || "Subject",
        paperLabel,
        subjectDisplay,
        teacherName: row.teacher_name || "Unassigned",
        expectedCount: 0,
        midCapturedCount: 0,
        eotCapturedCount: 0,
      });
    }
  }

  for (const row of registrationRows || []) {
    const learnerId = Number(row.learner_id);
    if (!candidateMap.has(learnerId)) {
      candidateMap.set(learnerId, {
        learnerId,
        learnerName: row.learner_name || "—",
        stream: row.stream || "—",
        combination: row.combination || "—",
        missingMid: false,
        missingEot: false,
        missingPaper1: false,
        missingPaper2: false,
        missingDetails: [],
      });
    }

    const candidate = candidateMap.get(learnerId);
    const paperOptions = getPaperOptionsForSubject(row.subject_name);

    for (const paperLabel of paperOptions) {
      const assignment = assignmentsByKey.get(`${row.stream}|${row.subject_id}|${paperLabel}`);
      const subjectDisplay = buildSubjectDisplay(row.subject_name, paperLabel);
      const coverageKey = `${row.subject_id}|${paperLabel}`;
      const assignmentKey = `${row.stream}|${row.subject_id}|${paperLabel}`;

      if (!coverageMap.has(coverageKey)) {
        coverageMap.set(coverageKey, {
          subject: row.subject_name,
          paperLabel,
          subjectDisplay,
          expectedCount: 0,
          midCapturedCount: 0,
          eotCapturedCount: 0,
          teachers: new Set(),
          streams: new Set(),
        });
      }
      if (!assignmentCoverageMap.has(assignmentKey)) {
        assignmentCoverageMap.set(assignmentKey, {
          stream: row.stream || "—",
          subjectId: Number(row.subject_id),
          subject: row.subject_name,
          paperLabel,
          subjectDisplay,
          teacherName: assignment?.teacherName || "Unassigned",
          expectedCount: 0,
          midCapturedCount: 0,
          eotCapturedCount: 0,
        });
      }

      const coverage = coverageMap.get(coverageKey);
      const assignmentCoverage = assignmentCoverageMap.get(assignmentKey);
      coverage.expectedCount += 1;
      coverage.streams.add(row.stream || "—");
      coverage.teachers.add(assignment?.teacherName || "Unassigned");
      assignmentCoverage.expectedCount += 1;
      assignmentCoverage.subject = row.subject_name;
      assignmentCoverage.subjectDisplay = subjectDisplay;
      assignmentCoverage.teacherName = assignment?.teacherName || assignmentCoverage.teacherName || "Unassigned";

      const midMark = marksByKey.get(`${learnerId}|${row.subject_id}|${paperLabel}|MID`);
      const eotMark = marksByKey.get(`${learnerId}|${row.subject_id}|${paperLabel}|EOT`);

      if (midMark) {
        coverage.midCapturedCount += 1;
        assignmentCoverage.midCapturedCount += 1;
      }
      if (eotMark) {
        coverage.eotCapturedCount += 1;
        assignmentCoverage.eotCapturedCount += 1;
      }

      const missingComponents = [];
      const hasMidScore = midMark && midMark.score !== null && midMark.score !== undefined;
      const hasEotScore = eotMark && eotMark.score !== null && eotMark.score !== undefined;

      if (!hasMidScore) {
        candidate.missingMid = true;
        missingComponents.push("MID");
      }
      if (!hasEotScore) {
        candidate.missingEot = true;
        missingComponents.push("EOT");
      }
      if (missingComponents.length > 0) {
        if (paperLabel === "Paper 1") candidate.missingPaper1 = true;
        if (paperLabel === "Paper 2") candidate.missingPaper2 = true;
        candidate.missingDetails.push({
          subject: row.subject_name,
          paperLabel,
          subjectDisplay,
          components: missingComponents,
          teacherName: assignment?.teacherName || "Assignment missing",
        });
      }
    }
  }

  const candidates = Array.from(candidateMap.values())
    .map((candidate) => ({
      ...candidate,
      isReady: candidate.missingDetails.length === 0,
      missingCount: candidate.missingDetails.reduce(
        (sum, detail) => sum + detail.components.length,
        0
      ),
    }))
    .sort((a, b) => {
      if (b.missingCount !== a.missingCount) return b.missingCount - a.missingCount;
      return String(a.learnerName || "").localeCompare(String(b.learnerName || ""));
    });

  const totalCandidates = candidates.length;
  const readyCandidates = candidates.filter((candidate) => candidate.isReady).length;
  const missingMidCandidates = candidates.filter((candidate) => candidate.missingMid).length;
  const missingEotCandidates = candidates.filter((candidate) => candidate.missingEot).length;
  const missingPaper1Candidates = candidates.filter((candidate) => candidate.missingPaper1).length;
  const missingPaper2Candidates = candidates.filter((candidate) => candidate.missingPaper2).length;

  const paperCoverage = Array.from(coverageMap.values())
    .map((row) => ({
      subject: row.subject,
      paperLabel: row.paperLabel,
      subjectDisplay: row.subjectDisplay,
      expectedCount: row.expectedCount,
      midCapturedCount: row.midCapturedCount,
      midPendingCount: Math.max(0, row.expectedCount - row.midCapturedCount),
      midRate: row.expectedCount > 0 ? Math.round((row.midCapturedCount / row.expectedCount) * 100) : 0,
      eotCapturedCount: row.eotCapturedCount,
      eotPendingCount: Math.max(0, row.expectedCount - row.eotCapturedCount),
      eotRate: row.expectedCount > 0 ? Math.round((row.eotCapturedCount / row.expectedCount) * 100) : 0,
      streams: Array.from(row.streams).sort(),
      teachers: Array.from(row.teachers).sort(),
    }))
    .sort((a, b) => {
      const subjectCompare = String(a.subject || "").localeCompare(String(b.subject || ""));
      if (subjectCompare !== 0) return subjectCompare;
      return String(a.paperLabel || "").localeCompare(String(b.paperLabel || ""));
    });

  const combinationReadiness = Array.from(
    candidates.reduce((acc, candidate) => {
      const key = candidate.combination || "—";
      if (!acc.has(key)) {
        acc.set(key, {
          combination: key,
          totalCandidates: 0,
          readyCandidates: 0,
          incompleteCandidates: 0,
        });
      }
      const bucket = acc.get(key);
      bucket.totalCandidates += 1;
      if (candidate.isReady) {
        bucket.readyCandidates += 1;
      } else {
        bucket.incompleteCandidates += 1;
      }
      return acc;
    }, new Map())
      .values()
  )
    .map((row) => ({
      ...row,
      readinessRate:
        row.totalCandidates > 0
          ? Math.round((row.readyCandidates / row.totalCandidates) * 100)
          : 0,
    }))
    .sort((a, b) => {
      if (b.incompleteCandidates !== a.incompleteCandidates) return b.incompleteCandidates - a.incompleteCandidates;
      return String(a.combination || "").localeCompare(String(b.combination || ""));
    });

  const streamPerformance = Array.from(
    candidates.reduce((acc, candidate) => {
      const key = candidate.stream || "—";
      if (!acc.has(key)) {
        acc.set(key, {
          stream: key,
          totalCandidates: 0,
          readyCandidates: 0,
          incompleteCandidates: 0,
          missingMidCandidates: 0,
          missingEotCandidates: 0,
        });
      }
      const bucket = acc.get(key);
      bucket.totalCandidates += 1;
      if (candidate.isReady) {
        bucket.readyCandidates += 1;
      } else {
        bucket.incompleteCandidates += 1;
      }
      if (candidate.missingMid) bucket.missingMidCandidates += 1;
      if (candidate.missingEot) bucket.missingEotCandidates += 1;
      return acc;
    }, new Map())
      .values()
  )
    .map((row) => ({
      ...row,
      readinessRate:
        row.totalCandidates > 0
          ? Math.round((row.readyCandidates / row.totalCandidates) * 100)
          : 0,
    }))
    .sort((a, b) => String(a.stream || "").localeCompare(String(b.stream || "")));

  const assignmentCoverageRows = Array.from(assignmentCoverageMap.values())
    .map((row) => {
      const midPendingCount = Math.max(0, row.expectedCount - row.midCapturedCount);
      const eotPendingCount = Math.max(0, row.expectedCount - row.eotCapturedCount);
      const midRate = row.expectedCount > 0 ? Math.round((row.midCapturedCount / row.expectedCount) * 100) : 0;
      const eotRate = row.expectedCount > 0 ? Math.round((row.eotCapturedCount / row.expectedCount) * 100) : 0;
      return {
        ...row,
        midPendingCount,
        eotPendingCount,
        midRate,
        eotRate,
        pendingTotal: midPendingCount + eotPendingCount,
      };
    })
    .sort((a, b) => {
      const streamCompare = String(a.stream || "").localeCompare(String(b.stream || ""));
      if (streamCompare !== 0) return streamCompare;
      return String(a.subjectDisplay || "").localeCompare(String(b.subjectDisplay || ""));
    });

  const teacherPaperOwnership = Array.from(
    assignmentCoverageRows.reduce((acc, row) => {
      const teacherKey = row.teacherName || "Unassigned";
      if (!acc.has(teacherKey)) {
        acc.set(teacherKey, {
          teacherName: teacherKey,
          papersAssigned: 0,
          fullySubmitted: 0,
          pendingPapers: 0,
          expectedSlots: 0,
          capturedSlots: 0,
          streams: new Set(),
        });
      }
      const bucket = acc.get(teacherKey);
      const isFullySubmitted =
        row.expectedCount > 0 &&
        row.midCapturedCount >= row.expectedCount &&
        row.eotCapturedCount >= row.expectedCount;
      bucket.papersAssigned += 1;
      bucket.fullySubmitted += isFullySubmitted ? 1 : 0;
      bucket.pendingPapers += isFullySubmitted ? 0 : 1;
      bucket.expectedSlots += row.expectedCount * 2;
      bucket.capturedSlots += row.midCapturedCount + row.eotCapturedCount;
      bucket.streams.add(row.stream || "—");
      return acc;
    }, new Map())
      .values()
  )
    .map((row) => ({
      teacherName: row.teacherName,
      papersAssigned: row.papersAssigned,
      fullySubmitted: row.fullySubmitted,
      pendingPapers: row.pendingPapers,
      coverageRate: row.expectedSlots > 0 ? Math.round((row.capturedSlots / row.expectedSlots) * 100) : 0,
      streams: Array.from(row.streams).sort(),
    }))
    .sort((a, b) => {
      if (b.pendingPapers !== a.pendingPapers) return b.pendingPapers - a.pendingPapers;
      return String(a.teacherName || "").localeCompare(String(b.teacherName || ""));
    });

  const subjectLoadRisks = assignmentCoverageRows
    .map((row) => {
      const unassigned = row.teacherName === "Unassigned";
      const weakestRate = Math.min(row.midRate, row.eotRate);
      let riskLabel = "Stable";
      let riskPriority = 0;

      if (unassigned) {
        riskLabel = "Unassigned";
        riskPriority = 3;
      } else if (weakestRate < 50 || row.pendingTotal >= Math.max(6, row.expectedCount)) {
        riskLabel = "Critical";
        riskPriority = 2;
      } else if (weakestRate < 85 || row.pendingTotal > 0) {
        riskLabel = "Watch";
        riskPriority = 1;
      }

      return {
        ...row,
        weakestRate,
        riskLabel,
        riskPriority,
      };
    })
    .sort((a, b) => {
      if (b.riskPriority !== a.riskPriority) return b.riskPriority - a.riskPriority;
      if (b.pendingTotal !== a.pendingTotal) return b.pendingTotal - a.pendingTotal;
      return String(a.subjectDisplay || "").localeCompare(String(b.subjectDisplay || ""));
    });

  return {
    term: normalizedTerm,
    year: normalizedYear,
    generatedAt: new Date().toISOString(),
    summary: {
      totalCandidates,
      readyCandidates,
      incompleteCandidates: Math.max(0, totalCandidates - readyCandidates),
      missingMidCandidates,
      missingEotCandidates,
      missingPaper1Candidates,
      missingPaper2Candidates,
    },
    candidates,
    paperCoverage,
    combinationReadiness,
    streamPerformance,
    teacherPaperOwnership,
    subjectLoadRisks,
  };
};

router.get("/admin/dashboard-insights", authAdmin, async (req, res) => {
  try {
    const insights = await buildAlevelDashboardInsights(
      {
        term: req.query.term,
        year: req.query.year,
      },
      db
    );

    res.json(insights);
  } catch (err) {
    console.error("A-Level dashboard insights error:", err);
    res.status(500).json({ message: "Failed to load A-Level dashboard insights" });
  }
});

router.get("/download/sets", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        CONCAT(am.assignment_id, '-', am.term, '-', am.exam_id) AS setId,
        am.assignment_id,
        subj.name AS subject,
        ats.paper_label,
        ats.stream,
        t.name AS submitted_by,
        am.term,
        YEAR(COALESCE(am.created_at, NOW())) AS year,
        ae.name AS exam
      FROM alevel_marks am
      JOIN alevel_teacher_subjects ats ON ats.id = am.assignment_id
      JOIN alevel_subjects subj ON subj.id = am.subject_id
      JOIN teachers t ON t.id = am.teacher_id
      JOIN alevel_exams ae ON ae.id = am.exam_id
      GROUP BY 
        am.assignment_id,
        am.term,
        am.exam_id,
        subj.name,
        ats.paper_label,
        ats.stream,
        t.name,
        YEAR(COALESCE(am.created_at, NOW())),
        ae.name
      ORDER BY YEAR(COALESCE(am.created_at, NOW())) DESC, am.term DESC, subj.name, ats.stream, ae.name
    `);

    res.json(
      (rows || []).map((row) => ({
        ...row,
        paper_label: normalizePaperLabel(row.paper_label) || resolvePaperLabel(row.subject),
        subject_display: buildSubjectDisplay(row.subject, row.paper_label),
      }))
    );
  } catch (err) {
    console.error("❌ Download sets error:", err);
    res.status(500).json({ message: "Failed to load mark sets" });
  }
});

router.get("/download/sets/:setId", async (req, res) => {
  try {
    const { setId } = req.params;

    const [assignment_id, term, exam_id] = setId.split("-");

    const [rows] = await pool.query(`
      SELECT 
        CONCAT(l.first_name, ' ', l.last_name) AS learner,
        ae.name AS exam,
        CASE WHEN am.score IS NULL THEN 'Missed' ELSE 'Submitted' END AS status,
        am.score
      FROM alevel_marks am
      JOIN alevel_learners l ON l.id = am.learner_id
      JOIN alevel_exams ae ON ae.id = am.exam_id
      WHERE am.assignment_id = ?
        AND am.term = ?
        AND am.exam_id = ?
      ORDER BY learner
    `, [assignment_id, term, exam_id]);

    res.json({
      columns: ["learner", "exam", "status", "score"],
      rows
    });
  } catch (err) {
    console.error("❌ Preview set error:", err);
    res.status(500).json({ message: "Failed to preview marks" });
  }
});

router.delete("/download/sets/:setId", authAdmin, async (req, res) => {
  let conn;
  try {
    const { setId } = req.params;
    const [assignment_id, term, exam_id] = setId.split("-");

    await ensureMarksArchiveTablesReady(pool);
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[setMeta]] = await conn.query(
      `SELECT ats.id, ats.stream, ats.paper_label, s.name AS subject, ae.name AS exam_name
       FROM alevel_teacher_subjects ats
       JOIN alevel_subjects s ON s.id = ats.subject_id
       LEFT JOIN alevel_exams ae ON ae.id = ?
       WHERE ats.id = ?`,
      [exam_id, assignment_id]
    );

    const archivedRows = await archiveALevelMarks(conn, {
      whereSql: "am.assignment_id = ? AND am.term = ? AND am.exam_id = ?",
      params: [assignment_id, term, exam_id],
      deletedByUserId: Number(req.admin?.id) || AUDIT_ADMIN_USER_ID,
      deletedByRole: "admin",
      deleteReason: `Admin deleted A-Level marks set ${setMeta?.exam_name || "Exam"} for ${buildSubjectDisplay(setMeta?.subject, setMeta?.paper_label)} in ${term}`,
      sourceAction: "DELETE_MARKS_SET",
    });

    await conn.query(`
      DELETE FROM alevel_marks
      WHERE assignment_id = ?
        AND term = ?
        AND exam_id = ?
    `, [assignment_id, term, exam_id]);

    await conn.commit();
    conn.release();
    conn = null;

    if (setMeta) {
      await logAuditEvent({
        userId: Number(req.admin?.id) || AUDIT_ADMIN_USER_ID,
        userRole: "admin",
        action: "DELETE_MARKS_SET",
        entityType: "marks",
        entityId: Number(assignment_id),
        description: `Deleted A-Level marks set for ${buildSubjectDisplay(setMeta.subject, setMeta.paper_label)} in ${setMeta.stream} (${setMeta.exam_name || "Exam"} ${term}); archived: ${archivedRows}`,
        ipAddress: extractClientIp(req),
      });
    }

    res.status(204).end();
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackError) { console.error("A-Level marks-set rollback error:", rollbackError); }
      conn.release();
    }
    console.error("❌ Delete set error:", err);
    res.status(500).json({ message: "Failed to delete marks" });
  }
});

router.get("/download/score-sheet", authAdmin, async (req, res) => {
  try {
    const stream = String(req.query.stream || "").trim();
    const term = String(req.query.term || "").trim();
    const year = Number.parseInt(req.query.year, 10);

    if (!stream || !term || !Number.isFinite(year)) {
      return res.status(400).json({
        message: "stream, term and year are required",
      });
    }

    const [papers] = await pool.query(
      `
      SELECT
        ats.id AS assignment_id,
        ats.stream,
        ats.paper_label,
        s.name AS subject,
        COALESCE(t.name, '—') AS teacher_name
      FROM alevel_marks am
      JOIN alevel_teacher_subjects ats ON ats.id = am.assignment_id
      JOIN alevel_subjects s ON s.id = am.subject_id
      LEFT JOIN teachers t ON t.id = ats.teacher_id
      JOIN alevel_exams ae ON ae.id = am.exam_id
      WHERE ats.stream = ?
        AND am.term = ?
        AND YEAR(COALESCE(am.created_at, NOW())) = ?
        AND ae.name IN ('MID', 'EOT')
      GROUP BY ats.id, ats.stream, ats.paper_label, s.name, t.name
      ORDER BY s.name ASC, ats.paper_label ASC, t.name ASC
      `,
      [stream, term, year]
    );

    const [learners] = await pool.query(
      `
      SELECT
        id,
        CONCAT(first_name, ' ', COALESCE(last_name, '')) AS name,
        gender
      FROM alevel_learners
      WHERE stream = ?
      ORDER BY first_name ASC, last_name ASC
      `,
      [stream]
    );

    const assignmentIds = (papers || [])
      .map((paper) => Number(paper.assignment_id))
      .filter((id) => Number.isInteger(id) && id > 0);

    let marks = [];
    if (assignmentIds.length > 0) {
      const placeholders = assignmentIds.map(() => "?").join(",");
      const [rows] = await pool.query(
        `
        SELECT
          am.assignment_id,
          am.learner_id,
          ae.name AS exam_name,
          am.score,
          CASE WHEN am.score IS NULL THEN 'Missed' ELSE 'Submitted' END AS status
        FROM alevel_marks am
        JOIN alevel_exams ae ON ae.id = am.exam_id
        WHERE am.term = ?
          AND YEAR(COALESCE(am.created_at, NOW())) = ?
          AND am.assignment_id IN (${placeholders})
          AND ae.name IN ('MID', 'EOT')
        `,
        [term, year, ...assignmentIds]
      );
      marks = rows || [];
    }

    return res.json({
      stream,
      term,
      year,
      learners: learners || [],
      papers: (papers || []).map((row) => ({
        ...row,
        paper_label: normalizePaperLabel(row.paper_label) || resolvePaperLabel(row.subject),
        subject_display: buildSubjectDisplay(row.subject, row.paper_label),
      })),
      marks,
    });
  } catch (err) {
    console.error("A-Level score sheet source error:", err);
    return res.status(500).json({ message: "Failed to load A-Level score sheet data" });
  }
});


router.get("/download/sets/:assignmentId/export", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { term } = req.query;

    const [[ts]] = await pool.query(
      `SELECT id, subject_id, teacher_id 
       FROM alevel_teacher_subjects 
       WHERE id = ?`,
      [assignmentId]
    );

    if (!ts || !term) return res.status(400).send("Invalid request");

    const [rows] = await pool.query(`
      SELECT 
        CONCAT(l.first_name, ' ', l.last_name) AS Learner,
        ae.name AS Exam,
        am.score AS Score
      FROM alevel_marks am
      JOIN alevel_learners l ON l.id = am.learner_id
      JOIN alevel_exams ae ON ae.id = am.exam_id
      WHERE am.assignment_id = ?
        AND am.term = ?
      ORDER BY Learner
    `, [ts.id, term]);

    const csv = [
      Object.keys(rows[0] || {}).join(","),
      ...rows.map(r => Object.values(r).join(","))
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="marks_${assignmentId}_${term}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("❌ Export error:", err);
    res.status(500).send("Export failed");
  }
});




export default router;
