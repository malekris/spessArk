// backend/routes/teachers.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import {
  sendWelcomeEmail,
  sendTeacherResetCodeEmail,
  sendTeacherPasswordChangedEmail,
  sendTeacherEmailChangedEmail,
} from "../utils/email.js";
import { pool } from "../server.js";
import authTeacher from "../middleware/authTeacher.js";
import { extractClientIp, logAuditEvent } from "../utils/auditLogger.js";
import { queueAdminYearSnapshotRefresh } from "../services/adminYearSnapshotService.js";

dotenv.config();
const router = express.Router();

const normalizeAlevelPaperLabel = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "paper 1" || raw === "paper1" || raw === "p1") return "Paper 1";
  if (raw === "paper 2" || raw === "paper2" || raw === "p2") return "Paper 2";
  if (raw === "single" || raw === "single paper") return "Single";
  return "";
};

const buildAlevelSubjectDisplay = (subject = "", paperLabel = "") => {
  const normalizedPaper = normalizeAlevelPaperLabel(paperLabel);
  return normalizedPaper && normalizedPaper !== "Single"
    ? `${subject} — ${normalizedPaper}`
    : subject;
};

const fireAndForgetTeacherEmail = (job, label) => {
  Promise.resolve()
    .then(job)
    .catch((err) => {
      console.warn(`⚠️ ${label} email failed:`, err.message);
    });
};



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

    // Hash password
    const passwordHash = await bcrypt.hash(password, 6);

    // Create teacher
    const [result] = await pool.query(
      `INSERT INTO teachers (name, email, password_hash, is_verified)
       VALUES (?, ?, ?, 1)`,
      [name, email, passwordHash]
    );

    const teacherId = result.insertId;
    console.log("✅ Teacher created:", teacherId);

    // 🔥 Trigger email (non-blocking)
    sendWelcomeEmail(email, name)
      .then(() => console.log("📧 Welcome email sent to:", email))
      .catch((err) => console.warn("⚠️ Welcome email failed:", err.message));

    // ✅ Respond immediately
    queueAdminYearSnapshotRefresh(pool, "teacher-self-register");
    return res.status(201).json({
      success: true,
      message: "Account created successfully. Please check your email for further information.",
    });

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

    await logAuditEvent({
      userId: teacher.id,
      userRole: "teacher",
      action: "LOGIN",
      entityType: "login",
      entityId: teacher.id,
      description: "Teacher login successful",
      ipAddress: extractClientIp(req),
    });

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

/* =======================
   FORGOT PASSWORD (CODE)
======================= */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const [rows] = await pool.query(
      "SELECT id FROM teachers WHERE email = ?",
      [email]
    );

    // Always respond success to prevent email enumeration
    if (!rows.length) {
      return res.json({ message: "If that email exists, a code was sent." });
    }

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      "UPDATE teachers SET reset_token = ?, reset_expires = ? WHERE id = ?",
      [code, expires, rows[0].id]
    );

    await sendTeacherResetCodeEmail(email, code);
    return res.json({ message: "If that email exists, a code was sent." });
  } catch (err) {
    console.error("❌ Teacher forgot password error:", err);
    return res.status(500).json({ message: "Failed to send reset code" });
  }
});

/* =======================
   VERIFY RESET CODE
======================= */
router.post("/verify-reset-code", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ message: "Email and code are required" });
    }

    const [rows] = await pool.query(
      "SELECT id, name, email, reset_token, reset_expires FROM teachers WHERE email = ?",
      [email]
    );

    const teacher = rows[0];
    if (!teacher || !teacher.reset_token || !teacher.reset_expires) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    const expired = new Date(teacher.reset_expires).getTime() < Date.now();
    if (expired || String(teacher.reset_token) !== String(code)) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    const token = jwt.sign(
      {
        id: teacher.id,
        email: teacher.email,
        role: "teacher",
        resetOnly: true,
      },
      process.env.JWT_SECRET || "dev_secret",
      { expiresIn: "20m" }
    );

    return res.json({
      token,
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
      },
      resetOnly: true,
    });
  } catch (err) {
    console.error("❌ Verify reset code error:", err);
    return res.status(500).json({ message: "Failed to verify code" });
  }
});

/* =======================
   RESET PASSWORD (RESET TOKEN)
======================= */
router.post("/reset-password", authTeacher, async (req, res) => {
  try {
    if (!req.teacher?.resetOnly) {
      return res.status(403).json({ message: "Reset token required" });
    }

    const { newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ message: "New password is required" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    const [teacherRows] = await pool.query(
      "SELECT id, name, email FROM teachers WHERE id = ? LIMIT 1",
      [req.teacher.id]
    );

    await pool.query(
      "UPDATE teachers SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?",
      [hashed, req.teacher.id]
    );

    const teacher = teacherRows[0];
    if (teacher?.email) {
      fireAndForgetTeacherEmail(
        () => sendTeacherPasswordChangedEmail(teacher.email, teacher.name),
        "Teacher password reset notice"
      );
    }

    return res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("❌ Reset password error:", err);
    return res.status(500).json({ message: "Failed to reset password" });
  }
});

/* =======================
   CHANGE PASSWORD (TEACHER)
======================= */
router.post("/change-password", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const [rows] = await pool.query(
      "SELECT name, email, password_hash FROM teachers WHERE id = ?",
      [teacherId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const valid = await bcrypt.compare(
      currentPassword,
      rows[0].password_hash
    );

    if (!valid) {
      return res.status(401).json({ message: "Incorrect current password" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      "UPDATE teachers SET password_hash = ? WHERE id = ?",
      [hashed, teacherId]
    );

    fireAndForgetTeacherEmail(
      () => sendTeacherPasswordChangedEmail(rows[0].email, rows[0].name),
      "Teacher password change notice"
    );

    await logAuditEvent({
      userId: teacherId,
      userRole: "teacher",
      action: "CHANGE_PASSWORD",
      entityType: "teacher",
      entityId: teacherId,
      description: "Teacher changed account password",
      ipAddress: extractClientIp(req),
    });

    return res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("❌ Change password error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

/* =======================
   CHANGE EMAIL (TEACHER)
======================= */
router.post("/change-email", authTeacher, async (req, res) => {
  try {
    const teacherId = Number(req.teacher.id);
    const { currentPassword, newEmail } = req.body;

    if (!currentPassword || !newEmail) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const normalizedEmail = String(newEmail || "").trim().toLowerCase();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(normalizedEmail)) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }

    const [rows] = await pool.query(
      "SELECT id, name, email, password_hash FROM teachers WHERE id = ?",
      [teacherId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const teacher = rows[0];
    const currentEmail = String(teacher.email || "").trim().toLowerCase();

    if (currentEmail === normalizedEmail) {
      return res.status(400).json({ message: "Enter a different email address" });
    }

    const passwordValid = await bcrypt.compare(currentPassword, teacher.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ message: "Incorrect current password" });
    }

    const [existing] = await pool.query(
      "SELECT id FROM teachers WHERE email = ? AND id <> ? LIMIT 1",
      [normalizedEmail, teacherId]
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: "That email is already in use" });
    }

    await pool.query("UPDATE teachers SET email = ? WHERE id = ?", [normalizedEmail, teacherId]);

    await logAuditEvent({
      userId: teacherId,
      userRole: "teacher",
      action: "CHANGE_EMAIL",
      entityType: "teacher",
      entityId: teacherId,
      description: `Teacher changed account email from ${teacher.email} to ${normalizedEmail}`,
      ipAddress: extractClientIp(req),
    });

    fireAndForgetTeacherEmail(
      () =>
        sendTeacherEmailChangedEmail({
          toEmail: teacher.email,
          name: teacher.name,
          oldEmail: teacher.email,
          newEmail: normalizedEmail,
          audience: "old",
        }),
      "Teacher old-email change notice"
    );

    fireAndForgetTeacherEmail(
      () =>
        sendTeacherEmailChangedEmail({
          toEmail: normalizedEmail,
          name: teacher.name,
          oldEmail: teacher.email,
          newEmail: normalizedEmail,
          audience: "new",
        }),
      "Teacher new-email change notice"
    );

    const token = jwt.sign(
      {
        id: teacherId,
        email: normalizedEmail,
        role: "teacher",
      },
      process.env.JWT_SECRET || "dev_secret",
      { expiresIn: "7d" }
    );

    return res.json({
      message: "Email updated successfully",
      token,
      teacher: {
        id: teacherId,
        name: teacher.name,
        email: normalizedEmail,
      },
    });
  } catch (err) {
    console.error("❌ Change email error:", err);
    return res.status(500).json({ message: "Server error" });
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
    const teacherId = Number(req.teacher.id);
    const teacherEmail = String(req.teacher.email || "").trim();

    // Resolve canonical teacher id by email to survive id drift across environments.
    let canonicalTeacherId = teacherId;
    if (teacherEmail) {
      const [[teacherRow]] = await pool.query(
        `SELECT id FROM teachers WHERE email = ? LIMIT 1`,
        [teacherEmail]
      );
      if (teacherRow?.id) canonicalTeacherId = Number(teacherRow.id);
    }

    const [rows] = await pool.query(
      `
      SELECT
        ats.id,
        ats.stream,
        ats.paper_label,
        s.name AS subject,
        NULL AS class_level
      FROM alevel_teacher_subjects ats
      LEFT JOIN alevel_subjects s 
        ON s.id = ats.subject_id
      WHERE ats.teacher_id = ?
         OR ats.teacher_id = ?
      ORDER BY ats.stream, s.name
      `,
      [teacherId, canonicalTeacherId]
    );

    return res.json(
      (rows || []).map((row) => ({
        ...row,
        paper_label: normalizeAlevelPaperLabel(row.paper_label) || "Single",
        subject_display: buildAlevelSubjectDisplay(row.subject, row.paper_label),
      }))
    );
  } catch (err) {
    console.error("❌ A-Level teacher assignments error:", err);
    return res.status(500).json({
      message: "Failed to load A-Level assignments",
    });
  }
});

// Alias for mixed frontend deployments that request the nested path.
router.get("/teachers/alevel-assignments", authTeacher, async (req, res) => {
  try {
    const teacherId = Number(req.teacher.id);
    const teacherEmail = String(req.teacher.email || "").trim();

    let canonicalTeacherId = teacherId;
    if (teacherEmail) {
      const [[teacherRow]] = await pool.query(
        `SELECT id FROM teachers WHERE email = ? LIMIT 1`,
        [teacherEmail]
      );
      if (teacherRow?.id) canonicalTeacherId = Number(teacherRow.id);
    }

    const [rows] = await pool.query(
      `
      SELECT
        ats.id,
        ats.stream,
        ats.paper_label,
        s.name AS subject,
        NULL AS class_level
      FROM alevel_teacher_subjects ats
      LEFT JOIN alevel_subjects s
        ON s.id = ats.subject_id
      WHERE ats.teacher_id = ?
         OR ats.teacher_id = ?
      ORDER BY ats.stream, s.name
      `,
      [teacherId, canonicalTeacherId]
    );

    return res.json(
      (rows || []).map((row) => ({
        ...row,
        paper_label: normalizeAlevelPaperLabel(row.paper_label) || "Single",
        subject_display: buildAlevelSubjectDisplay(row.subject, row.paper_label),
      }))
    );
  } catch (err) {
    console.error("❌ A-Level teacher assignments alias error:", err);
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
      `SELECT subject_id, stream FROM alevel_teacher_subjects WHERE id = ?`,
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

    const [[existingMarksMeta]] = await pool.query(
      `
      SELECT COUNT(*) AS count
      FROM alevel_marks
      WHERE subject_id = ?
        AND teacher_id = ?
        AND term = ?
      `,
      [ts.subject_id, teacherId, term]
    );
    const hasExistingMarks = Number(existingMarksMeta?.count || 0) > 0;

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

    const action = hasExistingMarks ? "UPDATE_MARKS" : "SUBMIT_MARKS";
    const verb = action === "UPDATE_MARKS" ? "Updated" : "Submitted";
    await logAuditEvent({
      userId: teacherId,
      userRole: "teacher",
      action,
      entityType: "marks",
      entityId: Number(assignmentId),
      description: `${verb} A-Level marks for stream ${ts.stream || "Unknown"} (${term})`,
      ipAddress: extractClientIp(req),
    });


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
