// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

import teacherRoutes from "./routes/teachers.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

/* =======================
   MIDDLEWARE
======================= */
app.use(cors());
app.use(express.json());

/* =======================
   ROUTES
======================= */
app.use("/api/teachers", teacherRoutes);

/* =======================
   AUTH HELPERS
======================= */
function generateVerifyToken() {
  return crypto.randomBytes(32).toString("hex");
}
function signTeacherToken(teacher) {
  return jwt.sign(
    {
      id: teacher.id,
      email: teacher.email,
      name: teacher.name,
      role: "teacher",
    },
    process.env.JWT_SECRET || "dev_secret",
    { expiresIn: "7d" }
  );
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
    req.teacher = jwt.verify(
      token,
      process.env.JWT_SECRET || "dev_secret"
    );
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}
function authAdmin(req, res, next) {
  try {
    const devBypass =
      process.env.DISABLE_ADMIN_AUTH === "true" ||
      process.env.NODE_ENV !== "production";

    if (devBypass) return next();

    const key = (req.headers["x-admin-key"] || "").trim();
    const expected = process.env.ADMIN_KEY || "";

    if (key && expected && key === expected) return next();

    return res.status(401).json({ message: "Admin auth required" });
  } catch (err) {
    console.error("authAdmin error:", err);
    return res.status(401).json({ message: "Admin auth required" });
  }
}

/* =======================
   DATABASE
======================= */
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "spess_ark",
});
// ===============================
// ADMIN → LIST TEACHERS
// ===============================
app.get("/api/teachers", authAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, subject1, subject2, created_at
       FROM teachers
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error loading teachers:", err);
    res.status(500).json({ message: "Failed to load teachers" });
  }
});

/* =======================
   HEALTH CHECK
======================= */
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Spess Ark backend running" });
});

/* =======================
   TEACHER AUTH
======================= */
app.post("/api/teachers/login", async (req, res) => {
  const { email, password } = req.body;

  const [rows] = await pool.query(
    "SELECT * FROM teachers WHERE email = ?",
    [email]
  );

  if (!rows.length) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const teacher = rows[0];

  const match = await bcrypt.compare(password, teacher.password_hash);
  if (!match) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = signTeacherToken(teacher);

  res.json({
    token,
    teacher: {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
    },
  });
});

/* ===============================
   TEACHER ASSIGNMENTS
=============================== */
app.get("/api/teacher/assignments", authTeacher, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, class_level, stream, subject
     FROM teacher_assignments
     WHERE teacher_id = ?
     ORDER BY class_level, stream, subject`,
    [req.teacher.id]
  );

  res.json(rows);
});

/* ===============================
   LOAD STUDENTS
=============================== */
app.get(
  "/api/teacher/assignments/:assignmentId/students",
  authTeacher,
  async (req, res) => {
    const assignmentId = Number(req.params.assignmentId);

    const [[assignment]] = await pool.query(
      `SELECT class_level, stream
       FROM teacher_assignments
       WHERE id = ? AND teacher_id = ?`,
      [assignmentId, req.teacher.id]
    );

    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    const [students] = await pool.query(
      `SELECT id, name, gender
       FROM students
       WHERE class_level = ? AND stream = ?
       ORDER BY name`,
      [assignment.class_level, assignment.stream]
    );

    res.json({ students });
  }
);

/* ===============================
   🔥 THIS IS THE FIX (MARKS LOAD)
=============================== */
app.get("/api/teacher/marks", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;

    const assignmentId = parseInt(req.query.assignmentId, 10);
    const year = parseInt(req.query.year, 10);

    /* 🔧 NORMALIZE TERM & AOI */
    const term = req.query.term?.trim();
    const aoi = req.query.aoi?.trim().toUpperCase();

    if (!assignmentId || !year || !term || !aoi) {
      return res.status(400).json({ message: "Missing parameters" });
    }

    const [rows] = await pool.query(
      `
      SELECT
        student_id,
        score
      FROM marks
      WHERE teacher_id = ?
        AND assignment_id = ?
        AND year = ?
        AND term = ?
        AND aoi_label = ?
      ORDER BY student_id
      `,
      [teacherId, assignmentId, year, term, aoi]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ GET MARKS ERROR:", err);
    res.status(500).json({ message: "Failed to load marks" });
  }
});

app.get("/api/admin/assignments", authAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT ta.id, ta.class_level, ta.stream, ta.subject,
             t.name AS teacher_name
      FROM teacher_assignments ta
      LEFT JOIN teachers t ON ta.teacher_id = t.id
      ORDER BY ta.class_level, ta.stream, ta.subject
    `);
    res.json(rows);
  } catch (err) {
    console.error("Admin assignments error:", err);
    res.status(500).json({ message: "Failed to load assignments" });
  }
});
app.get("/api/admin/marks-sets", authAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
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
        m.assignment_id, ta.class_level, ta.stream,
        ta.subject, t.name, m.term, m.year, m.aoi_label
      ORDER BY m.year DESC, m.term
    `);
    res.json(rows);
  } catch (err) {
    console.error("Admin marks sets error:", err);
    res.status(500).json({ message: "Failed to load marks sets" });
  }
});
app.get("/api/students", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM students ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("Students error:", err);
    res.status(500).json({ message: "Failed to load students" });
  }
});
// ===============================
// ADMIN → TEACHERS
// ===============================
app.get("/api/admin/teachers", authAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, subject1, subject2, created_at
       FROM teachers
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error loading teachers:", err);
    res.status(500).json({ message: "Failed to load teachers" });
  }
});

app.post("/api/admin/teachers", authAdmin, async (req, res) => {
  try {
    const { name, email, subject1, subject2 } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email required" });
    }

    const [result] = await pool.query(
      `INSERT INTO teachers (name, email, subject1, subject2)
       VALUES (?, ?, ?, ?)`,
      [name, email, subject1 || null, subject2 || null]
    );

    const [rows] = await pool.query(
      "SELECT * FROM teachers WHERE id = ?",
      [result.insertId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error adding teacher:", err);
    res.status(500).json({ message: "Failed to add teacher" });
  }
});

app.delete("/api/admin/teachers/:id", authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query(
      "DELETE FROM teachers WHERE id = ?",
      [id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    res.json({ message: "Teacher deleted" });
  } catch (err) {
    console.error("Error deleting teacher:", err);
    res.status(500).json({ message: "Failed to delete teacher" });
  }
});
// ===============================
// ADMIN → ADD TEACHER
// ===============================
app.post("/api/teachers", authAdmin, async (req, res) => {
  try {
    const { name, email, subject1, subject2 } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        message: "Name and email are required",
      });
    }

    const [existing] = await pool.query(
      "SELECT id FROM teachers WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        message: "Teacher with this email already exists",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO teachers (name, email, subject1, subject2)
       VALUES (?, ?, ?, ?)`,
      [name, email, subject1 || null, subject2 || null]
    );

    const [rows] = await pool.query(
      `SELECT id, name, email, subject1, subject2, created_at
       FROM teachers WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error adding teacher:", err);
    res.status(500).json({ message: "Failed to add teacher" });
  }
});
// ===============================
// ADMIN → DELETE TEACHER
// ===============================
app.delete("/api/teachers/:id", authAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      "DELETE FROM teachers WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    res.json({ message: "Teacher deleted successfully" });
  } catch (err) {
    console.error("Error deleting teacher:", err);
    res.status(500).json({ message: "Failed to delete teacher" });
  }
});

// ===============================
// ADMIN → STUDENTS
// ===============================
app.get("/api/students", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM students ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error loading students:", err);
    res.status(500).json({ message: "Failed to load students" });
  }
});

app.post("/api/students", async (req, res) => {
  try {
    const { name, gender, dob, class_level, stream, subjects } = req.body;

    if (!name || !class_level || !stream) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const subjectsJson = JSON.stringify(subjects || []);

    const [result] = await pool.query(
      `INSERT INTO students
       (name, gender, dob, class_level, stream, subjects)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, gender, dob, class_level, stream, subjectsJson]
    );

    const [rows] = await pool.query(
      "SELECT * FROM students WHERE id = ?",
      [result.insertId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error adding student:", err);
    res.status(500).json({ message: "Failed to add student" });
  }
});
// ===============================
// LOOKUP → TEACHERS (Admin UI)
// ===============================
app.get("/api/teachers", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email
       FROM teachers
       ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error loading teachers:", err);
    res.status(500).json({ message: "Failed to load teachers" });
  }
});
// ===============================
// LOOKUP → SUBJECTS
// ===============================
app.get("/api/subjects", async (req, res) => {
  try {
    try {
      const [rows] = await pool.query(
        "SELECT id, name FROM subjects ORDER BY name"
      );
      return res.json(rows);
    } catch {
      // fallback: derive from assignments
      const [rows] = await pool.query(
        "SELECT DISTINCT subject FROM teacher_assignments ORDER BY subject"
      );
      const mapped = rows.map((r, i) => ({
        id: i + 1,
        name: r.subject,
      }));
      return res.json(mapped);
    }
  } catch (err) {
    console.error("Error loading subjects:", err);
    res.status(500).json({ message: "Failed to load subjects" });
  }
});
// ===============================
// LOOKUP → CLASSES
// ===============================
app.get("/api/classes", async (req, res) => {
  try {
    try {
      const [rows] = await pool.query(
        "SELECT id, name FROM classes ORDER BY name"
      );
      return res.json(rows);
    } catch {
      const [rows] = await pool.query(
        "SELECT DISTINCT class_level FROM teacher_assignments ORDER BY class_level"
      );
      const mapped = rows.map((r, i) => ({
        id: i + 1,
        name: r.class_level,
      }));
      return res.json(mapped);
    }
  } catch (err) {
    console.error("Error loading classes:", err);
    res.status(500).json({ message: "Failed to load classes" });
  }
});
// ===============================
// ADMIN → ASSIGN SUBJECT TO TEACHER
// ===============================
app.post("/api/admin/assignments", authAdmin, async (req, res) => {
  try {
    const { teacherId, class_level, stream, subject } = req.body;

    if (!teacherId || !class_level || !stream || !subject) {
      return res.status(400).json({
        message: "teacherId, class_level, stream and subject are required",
      });
    }

    // Prevent duplicates
    const [existing] = await pool.query(
      `SELECT id FROM teacher_assignments
       WHERE teacher_id = ? AND class_level = ? AND stream = ? AND subject = ?`,
      [teacherId, class_level, stream, subject]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        message: "This assignment already exists",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO teacher_assignments
       (teacher_id, class_level, stream, subject)
       VALUES (?, ?, ?, ?)`,
      [teacherId, class_level, stream, subject]
    );

    res.status(201).json({
      id: result.insertId,
      teacherId,
      class_level,
      stream,
      subject,
    });
  } catch (err) {
    console.error("Error assigning subject:", err);
    res.status(500).json({ message: "Failed to assign subject" });
  }
});
// ===============================
// ADMIN → MARKS DETAIL (PREVIEW)
// ===============================
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

    // Normalize (IMPORTANT — fixes empty previews)
    const normTerm = term.trim();
    const normAoi = aoi.trim().toUpperCase();

    const [rows] = await pool.query(
      `
      SELECT
        s.id AS student_id,
        s.name AS student_name,
        s.gender,
        s.class_level,
        s.stream,
        m.score,
        m.term,
        m.year,
        m.aoi_label
      FROM marks m
      JOIN students s ON s.id = m.student_id
      WHERE
        m.assignment_id = ?
        AND m.term = ?
        AND m.year = ?
        AND m.aoi_label = ?
      ORDER BY s.name
      `,
      [assignmentId, normTerm, year, normAoi]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error loading admin marks detail:", err);
    res.status(500).json({ message: "Failed to load marks detail" });
  }
});
app.post("/api/teacher/marks", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;

    const assignmentId = parseInt(req.body.assignmentId, 10);
    const year = parseInt(req.body.year, 10);
    const term = req.body.term?.trim();
    const aoi = req.body.aoiLabel?.trim().toUpperCase();
    const marks = req.body.marks;

    if (!assignmentId || !year || !term || !aoi || !Array.isArray(marks)) {
      return res.status(400).json({ message: "Invalid marks payload" });
    }
     /* 💾 INSERT OR UPDATE MARKS */
     for (const m of marks) {
      const isMissed = m.score === "Missed";
    
      // 🚨 HARD BACKEND VALIDATION
      if (!isMissed) {
        if (
          m.score === "" ||
          m.score === null ||
          m.score === undefined ||
          Number.isNaN(Number(m.score))
        ) {
          return res.status(400).json({
            message: "Present students must have a valid score",
          });
        }
      }
    
      await pool.query(
        `
        INSERT INTO marks
          (teacher_id, assignment_id, student_id, score, status, year, term, aoi_label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          score = VALUES(score),
          status = VALUES(status),
          year = VALUES(year),
          term = VALUES(term),
          teacher_id = VALUES(teacher_id)
        `,
        [
          teacherId,
          assignmentId,
          m.studentId,
          isMissed ? null : Number(m.score),
          isMissed ? "Missed" : "Present",
          year,
          term,
          aoi,
        ]
      );
    }
    
    
    res.json({ message: "Marks saved successfully" });
  } catch (err) {
    console.error("❌ Save marks error:", err);
    res.status(500).json({ message: "Failed to save marks" });
  }
});

app.get("/api/teacher/marks", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;
    const assignmentId = parseInt(req.query.assignmentId, 10);
    const term = req.query.term?.trim();
    const year = parseInt(req.query.year, 10);
    const aoi = req.query.aoi?.trim();

    if (!assignmentId || !term || !year || !aoi) {
      return res.status(400).json({
        message: "assignmentId, term, year and aoi are required",
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        student_id,
        CASE
          WHEN status = 'Missed' THEN 'Missed'
          ELSE score
        END AS score
      FROM marks
      WHERE teacher_id = ?
        AND assignment_id = ?
        AND term = ?
        AND year = ?
        AND aoi_label = ?
      `,
      [teacherId, assignmentId, term, year, aoi]
    );
    

    res.json(rows);
  } catch (err) {
    console.error("Load marks error:", err);
    res.status(500).json({ message: "Failed to load marks" });
  }
});
// ===============================
// TEACHER ANALYTICS — CLASS PERFORMANCE
// ===============================
app.get("/api/teacher/analytics/class", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;
    const { assignmentId, term, year, aoi } = req.query;

    if (!assignmentId || !term || !year || !aoi) {
      return res.status(400).json({
        message: "assignmentId, term, year and aoi are required",
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        COUNT(score) AS learners,
        ROUND(AVG(score), 2) AS average,
        MIN(score) AS lowest,
        MAX(score) AS highest
      FROM marks
      WHERE
        teacher_id = ?
        AND assignment_id = ?
        AND term = ?
        AND year = ?
        AND aoi_label = ?
      `,
      [teacherId, assignmentId, term, year, aoi]
    );

    const stats = rows[0];

    // Distribution buckets
    const [distribution] = await pool.query(
      `
      SELECT
        SUM(score BETWEEN 0.9 AND 1.5) AS low,
        SUM(score BETWEEN 1.6 AND 2.2) AS mid,
        SUM(score BETWEEN 2.3 AND 3.0) AS high
      FROM marks
      WHERE
        teacher_id = ?
        AND assignment_id = ?
        AND term = ?
        AND year = ?
        AND aoi_label = ?
      `,
      [teacherId, assignmentId, term, year, aoi]
    );

    res.json({
      ...stats,
      distribution: distribution[0],
    });
  } catch (err) {
    console.error("Teacher analytics error:", err);
    res.status(500).json({ message: "Failed to load analytics" });
  }
});

/* =======================
   START SERVER
======================= */
app.listen(PORT, () => {
  console.log(`✅ Spess Ark backend running on http://localhost:${PORT}`);
});
