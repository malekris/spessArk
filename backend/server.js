// server.js
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5001; // we’re using 5001

// Middleware
app.use(cors());
app.use(express.json());

// ---- AUTH HELPERS ----
function signTeacherToken(teacher) {
  const payload = {
    id: teacher.id,
    email: teacher.email,
    name: teacher.name,
    role: "teacher",
  };

  return jwt.sign(payload, process.env.JWT_SECRET || "dev_secret", {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

function authTeacher(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "dev_secret"
    );
    req.teacher = decoded;
    next();
  } catch (err) {
    console.error("JWT error:", err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

/**
 * authAdmin middleware
 * - In development (NODE_ENV !== 'production') OR when DISABLE_ADMIN_AUTH === 'true',
 *   this middleware allows all requests (dev bypass).
 * - Otherwise it compares x-admin-key header against process.env.ADMIN_KEY (if set).
 *
 * IMPORTANT: This is intentionally permissive for dev so you can assign teachers
 * without an admin key. Do NOT enable DISABLE_ADMIN_AUTH=true in production.
 */
function authAdmin(req, res, next) {
  try {
    const disableForDev = process.env.DISABLE_ADMIN_AUTH === "true" || process.env.NODE_ENV !== "production";
    if (disableForDev) {
      return next();
    }

    const key = (req.headers["x-admin-key"] || "").trim();
    const expected = process.env.ADMIN_KEY || "";
    if (key && expected && key === expected) return next();

    return res.status(401).json({ message: "Admin auth required" });
  } catch (err) {
    console.error("authAdmin error:", err);
    // Fail closed in case of error (safer)
    return res.status(401).json({ message: "Admin auth required" });
  }
}

// MySQL pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "spess_ark",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Spess Ark backend running" });
});

// ---- TEACHERS API ----

// GET /api/teachers - list all teachers
app.get("/api/teachers", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, subject1, subject2, created_at FROM teachers ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error in GET /api/teachers:", err);
    res
      .status(500)
      .json({ message: "Database error while fetching teachers" });
  }
});

// Admin: list teachers (thin wrapper) - used by admin UI
app.get("/api/admin/teachers", authAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, subject1, subject2, created_at FROM teachers ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error in GET /api/admin/teachers:", err);
    res.status(500).json({ message: "Database error while fetching teachers" });
  }
});

// POST /api/teacher/marks
// Body: { assignmentId, term, year, aoiLabel, marks: [{ studentId, score }] }
app.post("/api/teacher/marks", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;
    const { assignmentId, term, year, aoiLabel, marks } = req.body;

    if (!assignmentId || !term || !year || !aoiLabel) {
      return res.status(400).json({
        message: "assignmentId, term, year and aoiLabel are required",
      });
    }

    if (!["AOI1", "AOI2", "AOI3"].includes(aoiLabel)) {
      return res.status(400).json({ message: "Invalid AOI label" });
    }

    if (!Array.isArray(marks) || marks.length === 0) {
      return res.status(400).json({
        message: "marks must be a non-empty array",
      });
    }

    const assignmentIdNum = parseInt(assignmentId, 10);
    const yearNum = parseInt(year, 10);

    if (!assignmentIdNum || !yearNum) {
      return res
        .status(400)
        .json({ message: "Invalid assignmentId or year" });
    }

    // Ensure assignment belongs to this teacher
    const [assignRows] = await pool.query(
      "SELECT id FROM teacher_assignments WHERE id = ? AND teacher_id = ?",
      [assignmentIdNum, teacherId]
    );

    if (assignRows.length === 0) {
      return res
        .status(404)
        .json({ message: "Assignment not found for this teacher" });
    }

    let savedCount = 0;

    for (const m of marks) {
      const studentId = parseInt(m.studentId, 10);
      const rawScore = m.score;

      if (!studentId) continue;
      if (rawScore === null || rawScore === undefined || rawScore === "") {
        continue; // skip empty cells
      }

      const score = parseFloat(rawScore);
      if (Number.isNaN(score)) {
        return res
          .status(400)
          .json({ message: `Invalid score for student ${studentId}` });
      }

      if (score < 0.9 || score > 3.0) {
        return res.status(400).json({
          message:
            "Scores must be between 0.9 and 3.0 for all students (no more, no less).",
        });
      }

      // Upsert mark
      await pool.query(
        `INSERT INTO marks
           (teacher_id, assignment_id, student_id, term, year, aoi_label, score)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           score = VALUES(score),
           updated_at = CURRENT_TIMESTAMP`,
        [teacherId, assignmentIdNum, studentId, term, yearNum, aoiLabel, score]
      );

      savedCount += 1;
    }

    res.json({
      message: "Marks saved successfully",
      savedCount,
    });
  } catch (err) {
    console.error("Error in POST /api/teacher/marks:", err);
    res.status(500).json({ message: "Server error while saving marks" });
  }
});

// ---- ADMIN MARKS DOWNLOAD ----

// GET /api/admin/marks-sets
// Returns list of mark "batches" grouped by assignment + term + year + AOI
app.get("/api/admin/marks-sets", authAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         m.assignment_id,
         ta.class_level,
         ta.stream,
         ta.subject,
         t.name AS teacher_name,
         m.term,
         m.year,
         m.aoi_label,
         COUNT(m.id) AS marks_count
       FROM marks m
       JOIN teacher_assignments ta ON m.assignment_id = ta.id
       JOIN teachers t ON m.teacher_id = t.id
       GROUP BY
         m.assignment_id,
         ta.class_level,
         ta.stream,
         ta.subject,
         t.name,
         m.term,
         m.year,
         m.aoi_label
       ORDER BY
         m.year DESC,
         m.term,
         ta.class_level,
         ta.stream,
         ta.subject,
         m.aoi_label`
    );

    res.json(rows);
  } catch (err) {
    console.error("Error in GET /api/admin/marks-sets:", err);
    res
      .status(500)
      .json({ message: "Server error while loading marks summary" });
  }
});

// GET /api/admin/marks-detail?assignmentId=...&term=...&year=...&aoi=AOI1
// Returns detailed marks per learner for that batch
app.get("/api/admin/marks-detail", authAdmin, async (req, res) => {
  try {
    const assignmentId = parseInt(req.query.assignmentId, 10);
    const term = req.query.term;
    const year = parseInt(req.query.year, 10);
    const aoi = req.query.aoi;

    if (!assignmentId || !term || !year || !aoi) {
      return res.status(400).json({
        message: "assignmentId, term, year and aoi are required",
      });
    }

    const [rows] = await pool.query(
      `SELECT
         s.id AS student_id,
         s.name AS student_name,
         s.class_level,
         s.stream,
         m.score,
         m.term,
         m.year,
         m.aoi_label
       FROM marks m
       JOIN students s ON m.student_id = s.id
       WHERE
         m.assignment_id = ?
         AND m.term = ?
         AND m.year = ?
         AND m.aoi_label = ?
       ORDER BY s.name`,
      [assignmentId, term, year, aoi]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error in GET /api/admin/marks-detail:", err);
    res
      .status(500)
      .json({ message: "Server error while loading marks detail" });
  }
});

// ---- SUBJECTS & CLASSES (public endpoints used by admin UI) ----

// GET /api/subjects
app.get("/api/subjects", async (req, res) => {
  try {
    // Try to read from subjects table if it exists, otherwise fall back to distinct subjects in assignments
    try {
      const [rows] = await pool.query("SELECT id, name FROM subjects ORDER BY name");
      return res.json(rows);
    } catch (_) {
      // fallback
      const [rows] = await pool.query("SELECT DISTINCT subject FROM teacher_assignments ORDER BY subject");
      // map to { id, name } style to keep UI simple
      const mapped = rows.map((r, idx) => ({ id: r.subject || idx, name: r.subject }));
      return res.json(mapped);
    }
  } catch (err) {
    console.error("Error in GET /api/subjects:", err);
    res.status(500).json({ message: "Server error while loading subjects" });
  }
});

// GET /api/classes
app.get("/api/classes", async (req, res) => {
  try {
    // Try to read from classes table if it exists, otherwise use distinct class_level from teacher_assignments or students
    try {
      const [rows] = await pool.query("SELECT id, name FROM classes ORDER BY name");
      return res.json(rows);
    } catch (_) {
      // fallback to assignments
      const [rows] = await pool.query("SELECT DISTINCT class_level FROM teacher_assignments ORDER BY class_level");
      const mapped = rows.map((r, idx) => ({ id: r.class_level || idx, name: r.class_level }));
      return res.json(mapped);
    }
  } catch (err) {
    console.error("Error in GET /api/classes:", err);
    res.status(500).json({ message: "Server error while loading classes" });
  }
});

// ---- ADMIN ASSIGNMENTS (create/list/delete assignments) ----

// GET /api/admin/assignments
app.get("/api/admin/assignments", authAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ta.id, ta.class_level, ta.stream, ta.subject, ta.teacher_id, t.name AS teacher_name, ta.created_at
       FROM teacher_assignments ta
       LEFT JOIN teachers t ON ta.teacher_id = t.id
       ORDER BY ta.class_level, ta.stream, ta.subject`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error in GET /api/admin/assignments:", err);
    res.status(500).json({ message: "Server error while loading assignments" });
  }
});

// POST /api/admin/assignments
// Body: { classId or class_level (string), subjectId or subject (string), teacherId (number), stream (string) }
app.post("/api/admin/assignments", authAdmin, async (req, res) => {
  try {
    // Support both { classId } (from classes table) or { class_level } directly
    const { classId, class_level, subjectId, subject, teacherId, stream } = req.body;

    // determine class_label and subject_label strings
    let classLabel = class_level || null;
    if (!classLabel && classId) {
      // try lookup
      const [clsRows] = await pool.query("SELECT name FROM classes WHERE id = ? LIMIT 1", [classId]);
      if (clsRows.length > 0) classLabel = clsRows[0].name;
    }
    let subjectLabel = subject || null;
    if (!subjectLabel && subjectId) {
      const [subRows] = await pool.query("SELECT name FROM subjects WHERE id = ? LIMIT 1", [subjectId]);
      if (subRows.length > 0) subjectLabel = subRows[0].name;
    }

    // fallback: if subjectLabel still missing, but "subject" field exists in body, use it
    if (!subjectLabel && typeof subject === "string") subjectLabel = subject;

    if (!classLabel || !subjectLabel || !teacherId) {
      return res.status(400).json({ message: "class_level, subject and teacherId are required" });
    }

    const streamValue = stream || "Main";

    // Insert assignment (avoid duplicates if same teacher/class/subject exists)
  // --- replace the existing INSERT ... ON DUPLICATE KEY UPDATE ... block with this ---
const [result] = await pool.query(
  `INSERT INTO teacher_assignments (teacher_id, class_level, stream, subject)
   VALUES (?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE
     teacher_id = VALUES(teacher_id),
     class_level = VALUES(class_level),
     stream = VALUES(stream),
     subject = VALUES(subject)`,
  [teacherId, classLabel, streamValue, subjectLabel]
);


    // If insertId is 0 due to duplicate-key update, try to find existing row id
    let insertedId = result.insertId;
    if (!insertedId) {
      const [rows] = await pool.query(
        "SELECT id FROM teacher_assignments WHERE teacher_id = ? AND class_level = ? AND stream = ? AND subject = ? LIMIT 1",
        [teacherId, classLabel, streamValue, subjectLabel]
      );
      if (rows.length > 0) insertedId = rows[0].id;
    }

    // Return created/updated assignment row
    const [rows] = await pool.query(
      `SELECT ta.id, ta.class_level, ta.stream, ta.subject, ta.teacher_id, t.name as teacher_name, ta.created_at
       FROM teacher_assignments ta
       LEFT JOIN teachers t ON ta.teacher_id = t.id
       WHERE ta.id = ? LIMIT 1`,
      [insertedId]
    );

    res.status(201).json(rows[0] || null);
  } catch (err) {
    console.error("Error in POST /api/admin/assignments:", err);
    res.status(500).json({ message: "Server error while creating assignment" });
  }
});

// DELETE /api/admin/assignments/:id
app.delete("/api/admin/assignments/:id", authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM teacher_assignments WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }
    res.json({ message: "Assignment deleted successfully" });
  } catch (err) {
    console.error("Error in DELETE /api/admin/assignments/:id:", err);
    res.status(500).json({ message: "Server error while deleting assignment" });
  }
});

// ---- TEACHER AUTH ----

// POST /api/teachers/set-password
app.post("/api/teachers/set-password", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "email and password are required" });
    }

    const [rows] = await pool.query(
      "SELECT id, name, email, password_hash FROM teachers WHERE email = ?",
      [email]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const teacher = rows[0];

    if (teacher.password_hash) {
      return res.status(400).json({
        message:
          "Password already set. Please log in or contact admin to reset.",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      "UPDATE teachers SET password_hash = ? WHERE id = ?",
      [hash, teacher.id]
    );

    res.json({ message: "Password set successfully. You can now log in." });
  } catch (err) {
    console.error("Error in POST /api/teachers/set-password:", err);
    res.status(500).json({ message: "Server error while setting password" });
  }
});

// POST /api/teachers/login
app.post("/api/teachers/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "email and password are required" });
    }

    const [rows] = await pool.query(
      "SELECT id, name, email, subject1, subject2, password_hash FROM teachers WHERE email = ?",
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const teacher = rows[0];

    if (!teacher.password_hash) {
      return res.status(400).json({
        message: "Password not set yet. Please set your password first.",
      });
    }

    const match = await bcrypt.compare(password, teacher.password_hash);
    if (!match) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = signTeacherToken(teacher);

    res.json({
      token,
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        subject1: teacher.subject1,
        subject2: teacher.subject2,
      },
    });
  } catch (err) {
    console.error("Error in POST /api/teachers/login:", err);
    res.status(500).json({ message: "Server error while logging in" });
  }
});

// ---- TEACHER ASSIGNMENTS API ----

// GET /api/teacher/assignments - list assignments for logged-in teacher
app.get("/api/teacher/assignments", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;

    const [rows] = await pool.query(
      `SELECT id, class_level, stream, subject, created_at
       FROM teacher_assignments
       WHERE teacher_id = ?
       ORDER BY class_level, stream, subject`,
      [teacherId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error in GET /api/teacher/assignments:", err);
    res
      .status(500)
      .json({ message: "Server error while loading assignments" });
  }
});

// GET /api/teacher/me - teacher profile (protected)
app.get("/api/teacher/me", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;

    const [rows] = await pool.query(
      "SELECT id, name, email, subject1, subject2, created_at FROM teachers WHERE id = ?",
      [teacherId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error in GET /api/teacher/me:", err);
    res.status(500).json({ message: "Server error while loading profile" });
  }
});

// GET /api/teacher/assignments/:assignmentId/students
app.get(
  "/api/teacher/assignments/:assignmentId/students",
  authTeacher,
  async (req, res) => {
    try {
      const teacherId = req.teacher.id;
      const assignmentId = parseInt(req.params.assignmentId, 10);

      if (!assignmentId) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      const [assignRows] = await pool.query(
        "SELECT id, class_level, stream FROM teacher_assignments WHERE id = ? AND teacher_id = ?",
        [assignmentId, teacherId]
      );

      if (assignRows.length === 0) {
        return res
          .status(404)
          .json({ message: "Assignment not found for this teacher" });
      }

      const assignment = assignRows[0];

      const [students] = await pool.query(
        `SELECT id, name, gender, dob, class_level, stream
         FROM students
         WHERE class_level = ? AND stream = ?
         ORDER BY name`,
        [assignment.class_level, assignment.stream]
      );

      res.json({
        assignment: assignment,
        students: students,
      });
    } catch (err) {
      console.error(
        "Error in GET /api/teacher/assignments/:assignmentId/students:",
        err
      );
      res
        .status(500)
        .json({ message: "Server error while loading students" });
    }
  }
);

// GET /api/teacher/marks?assignmentId=...&term=...&year=...&aoi=AOI1
app.get("/api/teacher/marks", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;
    const assignmentId = parseInt(req.query.assignmentId, 10);
    const term = req.query.term;
    const year = parseInt(req.query.year, 10);
    const aoi = req.query.aoi;

    if (!assignmentId || !term || !year || !aoi) {
      return res.status(400).json({
        message: "assignmentId, term, year and aoi are required",
      });
    }

    if (!["AOI1", "AOI2", "AOI3"].includes(aoi)) {
      return res.status(400).json({ message: "Invalid AOI label" });
    }

    const [assignRows] = await pool.query(
      "SELECT id FROM teacher_assignments WHERE id = ? AND teacher_id = ?",
      [assignmentId, teacherId]
    );

    if (assignRows.length === 0) {
      return res
        .status(404)
        .json({ message: "Assignment not found for this teacher" });
    }

    const [rows] = await pool.query(
      `SELECT id, student_id, score
       FROM marks
       WHERE teacher_id = ?
         AND assignment_id = ?
         AND term = ?
         AND year = ?
         AND aoi_label = ?`,
      [teacherId, assignmentId, term, year, aoi]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error in GET /api/teacher/marks:", err);
    res.status(500).json({ message: "Server error while loading marks" });
  }
});

// ---- STUDENTS API ----

// GET /api/students - list all students
app.get("/api/students", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, gender, dob, class_level, stream, subjects, created_at FROM students ORDER BY created_at DESC"
    );

    const mapped = rows.map((row) => {
      let subjectsArray = [];
      try {
        subjectsArray = row.subjects ? JSON.parse(row.subjects) : [];
        if (!Array.isArray(subjectsArray)) subjectsArray = [];
      } catch (e) {
        subjectsArray = [];
      }
      return { ...row, subjects: subjectsArray };
    });

    res.json(mapped);
  } catch (err) {
    console.error("Error in GET /api/students:", err);
    res
      .status(500)
      .json({ message: "Database error while fetching students" });
  }
});

// POST /api/students - add a student
app.post("/api/students", async (req, res) => {
  try {
    const { name, gender, dob, class_level, stream, subjects } = req.body;

    if (!name || !gender || !dob || !class_level || !stream) {
      return res.status(400).json({
        message: "name, gender, dob, class_level and stream are required",
      });
    }

    if (!Array.isArray(subjects) || subjects.length === 0) {
      return res.status(400).json({
        message: "subjects must be a non-empty array",
      });
    }

    const subjectsJson = JSON.stringify(subjects);

    const [result] = await pool.query(
      "INSERT INTO students (name, gender, dob, class_level, stream, subjects) VALUES (?, ?, ?, ?, ?, ?)",
      [name, gender, dob, class_level, stream, subjectsJson]
    );

    const [rows] = await pool.query(
      "SELECT id, name, gender, dob, class_level, stream, subjects, created_at FROM students WHERE id = ?",
      [result.insertId]
    );

    const row = rows[0];
    let subjectsArray = [];
    try {
      subjectsArray = row.subjects ? JSON.parse(row.subjects) : [];
      if (!Array.isArray(subjectsArray)) subjectsArray = [];
    } catch (_) {
      subjectsArray = [];
    }

    res.status(201).json({ ...row, subjects: subjectsArray });
  } catch (err) {
    console.error("Error in POST /api/students:", err);
    res.status(500).json({ message: "Database error while adding student" });
  }
});

// DELETE /api/students/:id - delete a student
app.delete("/api/students/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query("DELETE FROM students WHERE id = ?", [
      id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.json({ message: "Student deleted successfully" });
  } catch (err) {
    console.error("Error in DELETE /api/students/:id:", err);
    res
      .status(500)
      .json({ message: "Database error while deleting student" });
  }
});
// --- BEGIN: Ensure POST /api/teachers and DELETE /api/teachers/:id exist ---

// POST /api/teachers - add a teacher (public)
app.post("/api/teachers", async (req, res) => {
  try {
    const { name, email, subject1, subject2 } = req.body || {};

    if (!name || !email || !subject1 || !subject2) {
      return res.status(400).json({ message: "name, email, subject1 and subject2 are required" });
    }

    console.log("[POST /api/teachers] incoming:", { name, email, subject1, subject2 });

    const [result] = await pool.query(
      "INSERT INTO teachers (name, email, subject1, subject2) VALUES (?, ?, ?, ?)",
      [name, email, subject1, subject2]
    );

    const [rows] = await pool.query(
      "SELECT id, name, email, subject1, subject2, created_at FROM teachers WHERE id = ?",
      [result.insertId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error in POST /api/teachers:", err);
    return res.status(500).json({ message: "Database error while adding teacher" });
  }
});

// DELETE /api/teachers/:id - delete a teacher (admin protected)
app.delete("/api/teachers/:id", authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM teachers WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Teacher not found" });
    }
    console.log(`[DELETE /api/teachers/${id}] deleted`);
    return res.json({ message: "Teacher deleted successfully" });
  } catch (err) {
    console.error("Error in DELETE /api/teachers/:id:", err);
    return res.status(500).json({ message: "Database error while deleting teacher" });
  }
});

// --- END snippet ---

// Start server
app.listen(PORT, () => {
  console.log(`Spess Ark backend running on http://localhost:${PORT}`);
});
