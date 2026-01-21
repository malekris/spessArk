import express from "express";
import { db } from "../../server.js";
import authTeacher from "../../middleware/authTeacher.js";

const router = express.Router();

/* =========================================================
   A-LEVEL TEACHER DASHBOARD ENDPOINTS
========================================================= */
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
    res.json(rows || []);
  } catch (err) {
    console.error("subjects error:", err);
    res.status(500).json([]);
  }
});

// assignments (admin view)
router.get("/admin/assignments", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        ats.id,
        ats.stream,
        s.name AS subject,
        t.name AS teacher_name
      FROM alevel_teacher_subjects ats
      LEFT JOIN alevel_subjects s ON s.id = ats.subject_id
      LEFT JOIN teachers t ON t.id = ats.teacher_id
      ORDER BY ats.id DESC
    `);

    res.json(rows || []);
  } catch (err) {
    console.error("admin assignments error:", err);
    res.status(500).json({ message: "Failed to fetch assignments" });
  }
});

// create assignment
router.post("/admin/assignments", async (req, res) => {
  const { teacherId, subjectId, stream } = req.body;

  if (!teacherId || !subjectId || !stream) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    await db.query(
      `INSERT INTO alevel_teacher_subjects (teacher_id, subject_id, stream)
       VALUES (?, ?, ?)`,
      [teacherId, subjectId, stream]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("POST assignment error:", err);
    res.status(500).json({ message: "Failed to save assignment" });
  }
});

// delete assignment
router.delete("/admin/assignments/:id", async (req, res) => {
  try {
    await db.query(
      `DELETE FROM alevel_teacher_subjects WHERE id = ?`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("delete assignment error:", err);
    res.status(500).json({ message: "Failed to delete" });
  }
});

/* GET A-Level assignments */
router.get("/teachers/alevel-assignments", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        ats.id,
        ats.stream,
        ats.teacher_id,
        s.name AS subject,
        t.name AS teacher_name
      FROM alevel_teacher_subjects ats
      LEFT JOIN alevel_subjects s ON s.id = ats.subject_id
      LEFT JOIN teachers t ON t.id = ats.teacher_id
      ORDER BY ats.id DESC
    `);

    res.json(rows || []);
  } catch (err) {
    console.error("alevel assignments error:", err);
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
    const { assignmentId, term } = req.query;

    if (!assignmentId || !term) return res.json([]);

    // Get subject_id and teacher_id from assignment
    const [[ts]] = await db.query(
      `SELECT subject_id, teacher_id 
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
      WHERE am.subject_id = ?
        AND am.teacher_id = ?
        AND am.term = ?
      ORDER BY am.learner_id
    `, [ts.subject_id, ts.teacher_id, term]);

    res.json(rows || []);
  } catch (err) {
    console.error("❌ A-Level marks error:", err);
    res.status(500).json({ message: "Failed to fetch marks" });
  }
});


/* SAVE marks */
router.post("/teachers/alevel-marks", async (req, res) => {
  const { assignmentId, term, marks } = req.body;

  if (!assignmentId || !term || !Array.isArray(marks)) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Get subject_id + teacher_id from assignment
    const [[ts]] = await conn.query(
      `SELECT subject_id, teacher_id 
       FROM alevel_teacher_subjects 
       WHERE id = ?`,
      [assignmentId]
    );

    if (!ts) {
      await conn.rollback();
      return res.status(404).json({ message: "Assignment not found" });
    }

    // 2. Get exam IDs (MID, EOT)
    const [exams] = await conn.query(
      `SELECT id, name FROM alevel_exams WHERE name IN ('MID', 'EOT')`
    );

    const examMap = {};
    exams.forEach(e => examMap[e.name] = e.id);

    // 3. Delete old marks for this subject + teacher + term
    await conn.query(
      `DELETE FROM alevel_marks
       WHERE subject_id = ?
         AND teacher_id = ?
         AND term = ?`,
      [ts.subject_id, ts.teacher_id, term]
    );

    // 4. Insert new marks
    const rows = marks.map(m => [
      m.studentId,
      ts.subject_id,
      examMap[m.aoi],       // MID/EOT → exam_id
      m.score === "Missed" ? null : m.score,
      ts.teacher_id,
      term
    ]);

    if (rows.length > 0) {
      await conn.query(
        `INSERT INTO alevel_marks 
        (learner_id, subject_id, exam_id, score, teacher_id, term)
        VALUES ?`,
        [rows]
      );
    }

    await conn.commit();
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

    if (!assignmentId || !examType || !term || !teacherId) {
      return res.json({ aois: [], overall_average: "—" });
    }

    // 1. Get subject_id
    const [[ts]] = await db.query(
      `SELECT subject_id FROM alevel_teacher_subjects WHERE id = ?`,
      [assignmentId]
    );

    if (!ts) return res.json({ aois: [], overall_average: "—" });

    // 2. Get exam_id
    const [[exam]] = await db.query(
      `SELECT id FROM alevel_exams WHERE name = ?`,
      [examType]
    );

    if (!exam) return res.json({ aois: [], overall_average: "—" });

    // 3. Stats
    const [[stats]] = await db.query(`
      SELECT
        COUNT(*) AS attempts,
        AVG(score) AS average_score,
        SUM(CASE WHEN score IS NULL THEN 1 ELSE 0 END) AS missed_count
      FROM alevel_marks
      WHERE subject_id = ?
        AND exam_id = ?
        AND teacher_id = ?
        AND term = ?
    `, [ts.subject_id, exam.id, teacherId, term]);

    const avg = Number(stats?.average_score);

    return res.json({
      meta: {
        registered_learners: stats?.attempts ?? 0,
        term,
      },
      aois: [
        {
          aoi_label: examType,
          attempts: stats?.attempts ?? 0,
          average_score: Number.isFinite(avg) ? avg.toFixed(2) : "—",
          missed_count: stats?.missed_count ?? 0,
        },
      ],
      overall_average: Number.isFinite(avg) ? avg.toFixed(2) : "—",
      assignment: { subject: "A-Level" },
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
        ats.id AS assignment_id,
        'A-Level' AS class_level,
        l.stream,
        s.name AS subject,
        am.term,
        YEAR(am.created_at) AS year,
        ae.name AS aoi_label,
        t.name AS teacher_name
      FROM alevel_marks am
      JOIN alevel_teacher_subjects ats ON ats.subject_id = am.subject_id
      JOIN alevel_subjects s ON s.id = am.subject_id
      JOIN teachers t ON t.id = am.teacher_id
      JOIN alevel_learners l ON l.id = am.learner_id
      JOIN alevel_exams ae ON ae.id = am.exam_id
      ORDER BY year DESC, term, subject, stream
    `);

    res.json(rows || []);
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
      `SELECT subject_id FROM alevel_teacher_subjects WHERE id = ?`,
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
      WHERE am.subject_id = ?
        AND am.term = ?
        AND am.exam_id = ?
        AND YEAR(am.created_at) = ?
      ORDER BY l.first_name, l.last_name
    `, [ts.subject_id, term, exam.id, year]);

    res.json(rows || []);
  } catch (err) {
    console.error("A-Level marks detail error:", err);
    res.status(500).json({ message: "Failed to load marks detail" });
  }
});



export default router;
