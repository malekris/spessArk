// backend/routes/teachers.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { sendWelcomeEmail } from "../utils/email.js";
import { pool } from "../server.js";
import authTeacher from "../middleware/authTeacher.js";

dotenv.config();
const router = express.Router();



/* =======================
   REGISTER TEACHER
======================= */
router.post("/register", async (req, res) => {
  console.log("🟢 /api/teachers/register HIT:", req.body);

  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email and password are required" });
  }

  try {
    // Check if teacher exists
    const [rows] = await pool.query(
      "SELECT id FROM teachers WHERE email = ?",
      [email]
    );

    if (rows.length > 0) {
      return res.status(409).json({ message: "Teacher already exists" });
    }

    // Hash password (keep it light for performance)
    const passwordHash = await bcrypt.hash(password, 6);

    // Create teacher (always verified)
    const [result] = await pool.query(
      `INSERT INTO teachers (name, email, password_hash, is_verified)
       VALUES (?, ?, ?, 1)`,
      [name, email, passwordHash]
    );

    const teacherId = result.insertId;
    console.log("✅ Teacher created:", teacherId);

    // Respond immediately (no waiting for email)
    return res.status(201).json({
      success: true,
      message: "Account created successfully. Please check your email for further information.",
    });
    
    // Send welcome email in background (never blocks UI)
    sendWelcomeEmail(email, name)
      .then(() => console.log("📧 Welcome email sent to:", email))
      .catch((err) => console.warn("⚠️ Welcome email failed:", err.message));

  } catch (err) {
    console.error("❌ Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


/* =======================
   VERIFY EMAIL
======================= */
router.get("/verify/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "dev_secret"
    );

    await pool.query(
      "UPDATE teachers SET is_verified = 1 WHERE id = ?",
      [decoded.id]
    );

    res.send(`
      <h2>Email verified successfully ✅</h2>
      <p>You may now return to the app and log in.</p>
    `);
  } catch (err) {
    console.error("❌ Verification error:", err);
    res.status(400).send("Invalid or expired verification link.");
  }
});

/* =======================
   LOGIN (LOCKED UNTIL VERIFIED)
======================= */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await pool.query(
      "SELECT * FROM teachers WHERE email = ?",
      [email]
    );

    if (rows.length === 0) {
      return res
        .status(401)
        .json({ message: "Invalid email or password" });
    }

    const teacher = rows[0];

    // 🔒 Block unverified
    if (!teacher.is_verified) {
      return res.status(403).json({
        message:
          "Your email is not verified. Please check your inbox and verify your account.",
      });
    }

    // 🔐 Password check
    const match = await bcrypt.compare(password, teacher.password_hash);
    if (!match) {
      return res
        .status(401)
        .json({ message: "Invalid email or password" });
    }

    // 🎫 Token
    const token = jwt.sign(
      {
        id: teacher.id,
        email: teacher.email,
        role: "teacher",
      },
      process.env.JWT_SECRET || "dev_secret",
      { expiresIn: "7d" }
    );

    res.json({
      token,
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
      },
    });
  } catch (err) {
    console.error("❌ Teacher login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});
// GET teacher assigned subjects (classes + streams)
router.get("/assignments", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;

    const [rows] = await pool.query(
      `
      SELECT
        ta.id,
        ta.subject,
        ta.class_level,
        ta.stream
      FROM teacher_assignments ta
      WHERE ta.teacher_id = ?
      ORDER BY ta.class_level, ta.stream, ta.subject
      `,
      [teacherId]
    );

    // ✅ Always return JSON
    return res.json(rows || []);
  } catch (err) {
    console.error("❌ Teacher assignments error:", err);
    return res.status(500).json({
      message: "Failed to load teacher assignments",
    });
  }
});
// =======================
// GET A-Level teacher assignments (this powers the dashboard list)
// =======================
router.get("/alevel-assignments", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;

    const [rows] = await pool.query(
      `
      SELECT
        ats.id,
        ats.stream,
        s.name AS subject,
        NULL AS class_level
      FROM alevel_teacher_subjects ats
      LEFT JOIN alevel_subjects s 
        ON s.id = ats.subject_id
      WHERE ats.teacher_id = ?
      ORDER BY ats.stream, s.name
      `,
      [teacherId]
    );

    return res.json(rows || []);
  } catch (err) {
    console.error("❌ A-Level teacher assignments error:", err);
    return res.status(500).json({
      message: "Failed to load A-Level assignments",
    });
  }
});


// =======================
// GET A-Level learners for assignment
// =======================
router.get("/teachers/alevel-assignments/:id/students", authTeacher, async (req, res) => {
  try {
    const teacherSubjectId = req.params.id;

    // Get subject_id from teacher_subjects
    const [[ts]] = await pool.query(
      `SELECT subject_id FROM alevel_teacher_subjects WHERE id = ?`,
      [teacherSubjectId]
    );

    if (!ts) return res.json([]);

    const subjectId = ts.subject_id;

    const [rows] = await pool.query(`
      SELECT 
        l.id,
        CONCAT(l.first_name, ' ', l.last_name) AS name,
        l.gender
      FROM alevel_learner_subjects als
      JOIN alevel_learners l ON l.id = als.learner_id
      WHERE als.subject_id = ?
      ORDER BY l.first_name, l.last_name
    `, [subjectId]);

    res.json(rows || []);
  } catch (err) {
    console.error("❌ A-Level learners error:", err);
    res.status(500).json({ message: "Failed to load learners" });
  }
});

// =======================
// GET A-Level marks
// =======================
router.get("/alevel-marks", authTeacher, async (req, res) => {
  try {
    const { assignmentId, term } = req.query;
    const teacherId = req.teacher.id;

    const [[ts]] = await pool.query(
      `SELECT subject_id FROM alevel_teacher_subjects WHERE id = ?`,
      [assignmentId]
    );

    if (!ts || !term) return res.json([]);

    const [rows] = await pool.query(`
      SELECT 
        am.learner_id AS student_id,
        ae.name AS aoi_label,
        am.score,
        CASE WHEN am.score IS NULL THEN 'Missed' ELSE 'Present' END AS status
      FROM alevel_marks am
      JOIN alevel_exams ae ON ae.id = am.exam_id
      WHERE am.subject_id = ?
        AND am.teacher_id = ?
        AND am.term = ?
    `, [ts.subject_id, teacherId, term]);

    res.json(rows || []);
  } catch (err) {
    console.error("❌ A-Level marks error:", err);
    res.status(500).json({ message: "Failed to load marks" });
  }
});


// =======================
// POST save A-Level marks
// =======================
router.post("/alevel-marks", authTeacher, async (req, res) => {
  try {
    const { assignmentId, examType, term, marks } = req.body;
    const teacherId = req.teacher.id;

    // 1. Resolve subject from assignment
    const [[ts]] = await pool.query(
      `SELECT subject_id FROM alevel_teacher_subjects WHERE id = ?`,
      [assignmentId]
    );

    // 2. Resolve exam from name (MID / EOT)
    const [[exam]] = await pool.query(
      `SELECT id FROM alevel_exams WHERE name = ?`,
      [examType]
    );

    if (!ts || !exam || !term) {
      return res.status(400).json({ message: "Invalid assignment, exam or term" });
    }

    // 3. Save marks scoped by subject + exam + teacher + term
for (const m of marks) {
  // Resolve exam per column (MID / EOT)
  const [[exam]] = await pool.query(
    `SELECT id FROM alevel_exams WHERE name = ?`,
    [m.aoi]   // 🔥 THIS IS THE KEY FIX
  );

  if (!exam) {
    console.warn("Unknown exam type:", m.aoi);
    continue;
  }

  await pool.query(`
    INSERT INTO alevel_marks 
      (learner_id, subject_id, exam_id, teacher_id, term, score)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE score = VALUES(score)
  `, [
    m.studentId,
    ts.subject_id,
    exam.id,
    teacherId,
    term,
    m.score === "Missed" ? null : m.score
  ]);
}


    res.json({ message: "A-Level marks saved successfully" });
  } catch (err) {
    console.error("❌ Save A-Level marks error:", err);
    res.status(500).json({ message: "Failed to save marks" });
  }
});

// =======================
// GET A-Level analytics
// =======================
router.get("/alevel-analytics/subject", authTeacher, async (req, res) => {
  try {
    const { assignmentId, examType, term } = req.query;
    const teacherId = req.teacher.id;

    const [[ts]] = await pool.query(
      `SELECT subject_id FROM alevel_teacher_subjects WHERE id = ?`,
      [assignmentId]
    );

    const [[exam]] = await pool.query(
      `SELECT id FROM alevel_exams WHERE name = ?`,
      [examType]
    );

    if (!ts || !exam || !term) {
      return res.json({ aois: [], overall_average: "—" });
    }

    const [[stats]] = await pool.query(`
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

    res.json({
      meta: {
        registered_learners: stats?.attempts ?? 0,
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
    console.error("❌ A-Level analytics error:", err);
    res.status(500).json({ message: "Failed to load analytics" });
  }
});


router.delete("/assignments/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      "DELETE FROM teacher_assignments WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    res.json({ message: "Assignment deleted" });
  } catch (err) {
    console.error("Delete assignment error:", err);
    res.status(500).json({ message: "Failed to delete assignment" });
  }
});

export default router;
