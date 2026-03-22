import express from "express";
import { db } from "../../server.js";
import authTeacher from "../../middleware/authTeacher.js";
import authAdmin from "../../middleware/authAdmin.js";
import { pool } from "../../server.js";
import { extractClientIp, logAuditEvent } from "../../utils/auditLogger.js";

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
    const [rows] = await db.query(`
      SELECT 
        ats.id,
        ats.teacher_id,
        ats.stream,
        ats.paper_label,
        s.name AS subject,
        t.name AS teacher_name,
        t.email AS teacher_email
      FROM alevel_teacher_subjects ats
      JOIN alevel_subjects s ON s.id = ats.subject_id
      JOIN teachers t ON t.id = ats.teacher_id
      ORDER BY ats.id DESC
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
  const { teacherId, subjectId, stream, paperLabel } = req.body;

  if (!teacherId || !subjectId || !stream) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const [[subjectRow]] = await db.query(
      `SELECT name FROM alevel_subjects WHERE id = ?`,
      [subjectId]
    );

    if (!subjectRow) {
      return res.status(404).json({ message: "Subject not found" });
    }

    const resolvedPaper = resolvePaperLabel(subjectRow.name, paperLabel);

    const [[existing]] = await db.query(
      `SELECT id
       FROM alevel_teacher_subjects
       WHERE teacher_id = ?
         AND subject_id = ?
         AND stream = ?
         AND paper_label = ?
       LIMIT 1`,
      [teacherId, subjectId, stream, resolvedPaper]
    );

    if (existing) {
      return res.status(409).json({ message: "Assignment already exists for this paper" });
    }

    const [result] = await db.query(
      `INSERT INTO alevel_teacher_subjects (teacher_id, subject_id, stream, paper_label)
       VALUES (?, ?, ?, ?)`,
      [teacherId, subjectId, stream, resolvedPaper]
    );

    await logAuditEvent({
      userId: AUDIT_ADMIN_USER_ID,
      userRole: "admin",
      action: "ASSIGN_SUBJECT",
      entityType: "subject",
      entityId: Number(result.insertId),
      description: `${buildSubjectDisplay(subjectRow.name, resolvedPaper)} assigned to ${stream} (teacher #${teacherId})`,
      ipAddress: extractClientIp(req),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("POST assignment error:", err);
    res.status(500).json({ message: "Failed to save assignment" });
  }
});

// delete assignment
router.delete("/admin/assignments/:id", authAdmin, async (req, res) => {
  try {
    const [[assignment]] = await db.query(
      `SELECT ats.id, ats.subject_id, ats.teacher_id, ats.stream, ats.paper_label, s.name AS subject
       FROM alevel_teacher_subjects ats
       JOIN alevel_subjects s ON s.id = ats.subject_id
       WHERE ats.id = ?`,
      [req.params.id]
    );

    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    await db.query(
      `DELETE am
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

    await db.query(
      `DELETE FROM alevel_teacher_subjects WHERE id = ?`,
      [req.params.id]
    );

    await logAuditEvent({
      userId: AUDIT_ADMIN_USER_ID,
      userRole: "admin",
      action: "REMOVE_ASSIGNMENT",
      entityType: "subject",
      entityId: Number(assignment.id),
      description: `Removed A-Level assignment ${buildSubjectDisplay(assignment.subject, assignment.paper_label)} from ${assignment.stream} (teacher #${assignment.teacher_id})`,
      ipAddress: extractClientIp(req),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("delete assignment error:", err);
    res.status(500).json({ message: "Failed to delete" });
  }
});

/* GET A-Level assignments (scoped to logged-in teacher) */
router.get("/teachers/alevel-assignments", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;

    const [rows] = await db.query(`
      SELECT
        ats.id,
        ats.stream,
        ats.paper_label,
        s.name AS subject
      FROM alevel_teacher_subjects ats
      JOIN alevel_subjects s ON s.id = ats.subject_id
      WHERE ats.teacher_id = ?
      ORDER BY ats.id DESC
    `, [teacherId]);

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
    const teacherEmail = String(req.teacher?.email || "").trim();
    if (!teacherEmail) return res.json([]);

    const [rows] = await db.query(
      `
      SELECT
        ats.id,
        ats.stream,
        ats.paper_label,
        s.name AS subject
      FROM alevel_teacher_subjects ats
      JOIN alevel_subjects s ON s.id = ats.subject_id
      JOIN teachers t ON t.id = ats.teacher_id
      WHERE LOWER(t.email) = LOWER(?)
      ORDER BY ats.id DESC
      `,
      [teacherEmail]
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
router.get("/teachers/alevel-assignments/:id/students", async (req, res) => {
  const { id } = req.params;

  try {
    const [[assignment]] = await db.query(
      `SELECT subject_id, stream FROM alevel_teacher_subjects WHERE id = ?`,
      [id]
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
router.get("/teachers/alevel-marks", async (req, res) => {
  try {
    const { assignmentId, term, year } = req.query;

    if (!assignmentId || !term) return res.json([]);

    // Get subject_id and teacher_id from assignment
    const [[ts]] = await db.query(
      `SELECT id, subject_id, teacher_id 
       FROM alevel_teacher_subjects 
       WHERE id = ?`,
      [assignmentId]
    );

    if (!ts) return res.json([]);

    const [rows] = await db.query(`
      SELECT 
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
      WHERE am.assignment_id = ?
        AND am.term = ?
        ${year ? "AND YEAR(am.created_at) = ?" : ""}
      ORDER BY am.learner_id
    `, year ? [ts.id, term, year] : [ts.id, term]);

    res.json(rows || []);
  } catch (err) {
    console.error("❌ A-Level marks error:", err);
    res.status(500).json({ message: "Failed to fetch marks" });
  }
});


/* SAVE marks */
router.post("/teachers/alevel-marks", authTeacher, async (req, res) => {
  const { assignmentId, term, year, marks } = req.body;

  if (!assignmentId || !term || !Array.isArray(marks)) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    const teacherId = Number(req.teacher?.id);

    // 1. Get assignment context scoped to the logged-in teacher
    const [[ts]] = await conn.query(
      `SELECT ats.id, ats.subject_id, ats.teacher_id, ats.stream, ats.paper_label, s.name AS subject_name
       FROM alevel_teacher_subjects ats
       JOIN alevel_subjects s ON s.id = ats.subject_id
       WHERE ats.id = ?
         AND ats.teacher_id = ?`,
      [assignmentId, teacherId]
    );

    if (!ts) {
      await conn.rollback();
      return res.status(404).json({ message: "Assignment not found" });
    }

    const [[existingMarksMeta]] = await conn.query(
      `SELECT COUNT(*) AS count
       FROM alevel_marks
       WHERE assignment_id = ?
         AND term = ?`,
      [ts.id, term]
    );
    const hasExistingMarks = Number(existingMarksMeta?.count || 0) > 0;

    // 2. Get exam IDs (MID, EOT)
    const [exams] = await conn.query(
      `SELECT id, name FROM alevel_exams WHERE name IN ('MID', 'EOT')`
    );

    const examMap = {};
    exams.forEach(e => examMap[e.name] = e.id);

    // 3. Delete old marks for this subject + teacher + term
    await conn.query(
      `DELETE FROM alevel_marks
       WHERE assignment_id = ?
         AND term = ?`,
      [ts.id, term]
    );

    // 4. Insert new marks
    const rows = marks.map(m => [
      m.studentId,
      ts.id,
      ts.subject_id,
      examMap[m.aoi],       // MID/EOT → exam_id
      m.score === "Missed" ? null : m.score,
      teacherId,
      term
    ]);

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
      description: `${marksVerb} A-Level marks for ${buildSubjectDisplay(ts.subject_name, ts.paper_label)} in ${ts.stream} (${term}${year ? ` ${year}` : ""})`,
      ipAddress: extractClientIp(req),
    });

    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("❌ Save A-Level marks error:", err);
    res.status(500).json({ message: "Failed to save marks" });
  } finally {
    conn.release();
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
        am.term,
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
router.get("/download/sets", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        CONCAT(am.assignment_id, '-', am.term, '-', am.exam_id) AS setId,
        am.assignment_id,
        subj.name AS subject,
        ats.paper_label,
        t.name AS submitted_by,
        am.term,
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
        t.name,
        ae.name
      ORDER BY am.term DESC, subj.name, ae.name
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
      columns: ["learner", "exam", "score"],
      rows
    });
  } catch (err) {
    console.error("❌ Preview set error:", err);
    res.status(500).json({ message: "Failed to preview marks" });
  }
});

router.delete("/download/sets/:setId", async (req, res) => {
  try {
    const { setId } = req.params;
    const [assignment_id, term, exam_id] = setId.split("-");

    const [[setMeta]] = await pool.query(
      `SELECT ats.id, ats.stream, ats.paper_label, s.name AS subject, ae.name AS exam_name
       FROM alevel_teacher_subjects ats
       JOIN alevel_subjects s ON s.id = ats.subject_id
       LEFT JOIN alevel_exams ae ON ae.id = ?
       WHERE ats.id = ?`,
      [exam_id, assignment_id]
    );

    await pool.query(`
      DELETE FROM alevel_marks
      WHERE assignment_id = ?
        AND term = ?
        AND exam_id = ?
    `, [assignment_id, term, exam_id]);

    if (setMeta) {
      await logAuditEvent({
        userId: AUDIT_ADMIN_USER_ID,
        userRole: "admin",
        action: "DELETE_MARKS_SET",
        entityType: "marks",
        entityId: Number(assignment_id),
        description: `Deleted A-Level marks set for ${buildSubjectDisplay(setMeta.subject, setMeta.paper_label)} in ${setMeta.stream} (${setMeta.exam_name || "Exam"} ${term})`,
        ipAddress: extractClientIp(req),
      });
    }

    res.status(204).end();
  } catch (err) {
    console.error("❌ Delete set error:", err);
    res.status(500).json({ message: "Failed to delete marks" });
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
