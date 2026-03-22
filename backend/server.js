// backend/server.js
import "./config/env.js";   // 👈 must be first, before everything
import http from "http";
import { Server } from "socket.io";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import teacherRoutes from "./routes/teachers.js";
import adminReportsRoutes from "./routes/adminReports.js";
import adminAuditLogsRoutes from "./routes/adminAuditLogs.js";
import adminPromotionRoutes from "./routes/adminPromotionRoutes.js";
import authAdmin from "./middleware/authAdmin.js";
import studentRoutes from "./routes/students.js";
import classesRoutes from "./routes/classes.js";
import streamReadinessRoutes from "./routes/streamReadiness.js";
import alevelRoutes from "./modules/alevel/alevel.routes.js";
import newSignupRoutes from "./routes/newSignup.js";
import alevelReports from "./modules/alevel/alevelReports.js";
import vineRoutes from "./modules/vine/vineRoutes.js";
import vineAuth from "./modules/vine/vineAuth.js";
import dmRoutes from "./modules/vine/dms.js";
import path from "path";
import { fileURLToPath } from "url";
import { extractClientIp, logAuditEvent } from "./utils/auditLogger.js";
import { sendTeacherPasswordChangedEmail } from "./utils/email.js";


const app = express();
const PORT = process.env.PORT || 5001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getVineFrontendBase(req) {
  const explicitBase = String(process.env.VINE_PUBLIC_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (explicitBase) return explicitBase;

  const requestProto =
    String(req.get("x-forwarded-proto") || req.protocol || "https")
      .split(",")[0]
      .trim() || "https";
  const requestHost = String(req.get("x-forwarded-host") || req.get("host") || "")
    .split(",")[0]
    .trim();
  const hostName = String(requestHost || "")
    .split(":")[0]
    .trim()
    .toLowerCase();

  if (hostName === "localhost" || hostName === "127.0.0.1") {
    return "http://localhost:5173";
  }

  if (hostName === "api.stphillipsequatorial.com") {
    return "https://www.stphillipsequatorial.com";
  }

  if (hostName.startsWith("api.")) {
    return `https://www.${hostName.slice(4)}`;
  }

  if (
    hostName === "stphillipsequatorial.com" ||
    hostName === "www.stphillipsequatorial.com"
  ) {
    return "https://www.stphillipsequatorial.com";
  }

  return `${requestProto}://${requestHost}`.replace(/\/+$/, "");
}

function fireAndForgetEmail(job, label) {
  Promise.resolve()
    .then(job)
    .catch((err) => {
      console.warn(`⚠️ ${label} email failed:`, err.message);
    });
}
/* =======================
   MIDDLEWARE
======================= */
app.use(cors({
  origin: [
    "https://stphillipsequatorial.com",
    "https://www.stphillipsequatorial.com",
    "http://localhost:5173",
    "http://localhost:5001"
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
}));

// Explicitly handle preflight requests
app.use("/public", express.static("public"));
app.use(express.json());
app.use("/api/teachers", teacherRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/admin/reports", adminReportsRoutes);
app.use("/api/admin/audit-logs", adminAuditLogsRoutes);
app.use("/api/admin", adminPromotionRoutes);
app.use("/api/classes", classesRoutes);
app.use("/api/admin/stream-readiness", streamReadinessRoutes);
app.use("/api/alevel", alevelRoutes);
app.use("/api/new-signup", newSignupRoutes);
app.use("/api/alevel/reports", alevelReports);
app.use("/api/vine", vineRoutes);
app.use("/api/vine/auth", vineAuth);
app.use("/api/vine", vineRoutes);
app.use("/uploads", express.static("uploads"));
app.use("/api/dms", dmRoutes);
app.use("/uploads", express.static("uploads"));

app.get(/^\/vine(?:\/.*)?$/, (req, res) => {
  const frontendBase = getVineFrontendBase(req);
  return res.redirect(302, `${frontendBase}${req.originalUrl}`);
});

/* =======================
   ROUTES
======================= */

/* =======================
   PUBLIC LOOKUPS
======================= */
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
//AdminAuth route//
app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;

  // Example static admin (you can later move to DB)
  if (username !== "admin" || password !== "admin") {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: 1, username: "admin", role: "admin" },
    process.env.JWT_SECRET || "dev_secret",
    { expiresIn: "1d" }
  );

  await logAuditEvent({
    userId: 1,
    userRole: "admin",
    action: "LOGIN",
    entityType: "login",
    entityId: 1,
    description: `Admin login successful (${username})`,
    ipAddress: extractClientIp(req),
  });

  res.json({ token });
});
app.get("/api/admin/me", authAdmin, (req, res) => {
  try {
    res.json({
      id: req.admin?.id || null,
      username: req.admin?.username || null,
    });
  } catch (err) {
    console.error("admin/me error:", err);
    res.status(500).json({ message: "Failed to verify admin" });
  }
});


/* =======================
   DATABASE
======================= */

const dbUrl =
  process.env.MYSQL_URL ||
  process.env.DATABASE_URL ||
  process.env.MYSQL_PUBLIC_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  "";

let poolConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
};

if (dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    poolConfig = {
      host: parsed.hostname,
      user: decodeURIComponent(parsed.username || ""),
      password: decodeURIComponent(parsed.password || ""),
      database: (parsed.pathname || "").replace(/^\//, ""),
      port: Number(parsed.port || 3306),
      waitForConnections: true,
      connectionLimit: 10,
    };
  } catch (err) {
    console.error("Invalid database URL, falling back to DB_* env vars:", err);
  }
}

export const pool = mysql.createPool(poolConfig);
export const db = pool;//alias, no behavior change

const SCHOOL_CALENDAR_ENTRY_DEFINITIONS = [
  { key: "term1", label: "Term I", status: "In Session" },
  { key: "holiday1", label: "Holiday After Term I", status: "Holiday Break" },
  { key: "term2", label: "Term II", status: "In Session" },
  { key: "holiday2", label: "Holiday After Term II", status: "Holiday Break" },
  { key: "term3", label: "Term III", status: "In Session" },
  { key: "holiday3", label: "Holiday After Term III", status: "Holiday Break" },
];

const DEFAULT_SCHOOL_CALENDAR = {
  academicYear: "2026",
  entries: [
    { key: "term1", from: "2026-02-10", to: "2026-05-01" },
    { key: "holiday1", from: "2026-05-02", to: "2026-05-24" },
    { key: "term2", from: "2026-05-25", to: "2026-08-21" },
    { key: "holiday2", from: "2026-08-22", to: "2026-09-13" },
    { key: "term3", from: "2026-09-14", to: "2026-12-04" },
    { key: "holiday3", from: "2026-12-05", to: "2027-01-31" },
  ],
};

const normalizeCalendarDate = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeSchoolCalendarPayload = (raw = {}) => {
  const academicYear =
    String(raw?.academicYear ?? raw?.academic_year ?? DEFAULT_SCHOOL_CALENDAR.academicYear).trim() ||
    DEFAULT_SCHOOL_CALENDAR.academicYear;

  const rawEntries = Array.isArray(raw?.entries)
    ? raw.entries
    : Array.isArray(raw?.terms)
    ? raw.terms
    : [];

  const entries = SCHOOL_CALENDAR_ENTRY_DEFINITIONS.map((definition, index) => {
    const matched =
      rawEntries.find((entry) => String(entry?.key || "").trim().toLowerCase() === definition.key) ||
      rawEntries.find(
        (entry) =>
          String(entry?.label || "").trim().toLowerCase() === definition.label.toLowerCase()
      ) ||
      rawEntries[index] ||
      {};

    return {
      key: definition.key,
      label: definition.label,
      status: definition.status,
      from: normalizeCalendarDate(matched.from ?? matched.starts_on ?? matched.startDate),
      to: normalizeCalendarDate(matched.to ?? matched.ends_on ?? matched.endDate),
    };
  });

  return {
    academicYear,
    entries,
  };
};

let schoolCalendarReadyPromise = null;

async function ensureSchoolCalendarSettingsTable() {
  if (!schoolCalendarReadyPromise) {
    schoolCalendarReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS school_calendar_settings (
          id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
          academic_year VARCHAR(20) NOT NULL,
          calendar_json LONGTEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      const [rows] = await pool.query(
        `SELECT id FROM school_calendar_settings WHERE id = 1 LIMIT 1`
      );

      if (!rows.length) {
        const seeded = normalizeSchoolCalendarPayload(DEFAULT_SCHOOL_CALENDAR);
        await pool.query(
          `INSERT INTO school_calendar_settings (id, academic_year, calendar_json)
           VALUES (1, ?, ?)`,
          [seeded.academicYear, JSON.stringify(seeded.entries)]
        );
      }
    })().catch((err) => {
      schoolCalendarReadyPromise = null;
      throw err;
    });
  }

  return schoolCalendarReadyPromise;
}

async function readSchoolCalendarSettings() {
  await ensureSchoolCalendarSettingsTable();

  const [[row]] = await pool.query(
    `SELECT academic_year, calendar_json, updated_at
     FROM school_calendar_settings
     WHERE id = 1
     LIMIT 1`
  );

  const fallback = normalizeSchoolCalendarPayload(DEFAULT_SCHOOL_CALENDAR);
  if (!row) {
    return {
      ...fallback,
      updatedAt: null,
    };
  }

  let parsedEntries = [];
  try {
    parsedEntries = JSON.parse(row.calendar_json || "[]");
  } catch {
    parsedEntries = [];
  }

  return {
    ...normalizeSchoolCalendarPayload({
      academicYear: row.academic_year,
      entries: parsedEntries,
    }),
    updatedAt: row.updated_at ?? null,
  };
}
// ===============================
// ADMIN → LIST TEACHERS
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
   LOAD STUDENTS (subject-aware)
   ================================ */
   app.get( "/api/teachers/assignments/:assignmentId/students",
    authTeacher,
    async (req, res) => {
      try {
        const assignmentId = Number(req.params.assignmentId);
        if (!assignmentId) return res.status(400).json({ message: "Invalid assignment id" });
  
        // 1) Load assignment including subject
        const [[assignment]] = await pool.query(
          `SELECT class_level, stream, subject
           FROM teacher_assignments
           WHERE id = ? AND teacher_id = ?`,
          [assignmentId, req.teacher.id]
        );
  
        if (!assignment) {
          return res.status(404).json({ message: "Assignment not found" });
        }
  
        const assignmentSubject = (assignment.subject || "").trim();
  
        // 2) Detect whether we have a normalized subject_registrations table
        const [[{ registrations_table_count }]] = await pool.query(
          `SELECT COUNT(*) AS registrations_table_count
           FROM information_schema.tables
           WHERE table_schema = ? AND table_name = 'subject_registrations'`,
          [process.env.DB_NAME]
        );
  
        let studentsQuery;
        let params;
  
        if (registrations_table_count > 0) {
          // Use normalized subject_registrations table (preferred)
          studentsQuery = `
            SELECT s.id, s.name, s.gender
            FROM students s
            INNER JOIN subject_registrations sr
              ON sr.student_id = s.id
            WHERE s.class_level = ?
              AND s.stream = ?
              AND sr.subject = ?
            ORDER BY s.name
          `;
          params = [assignment.class_level, assignment.stream, assignmentSubject];
        } else {
          // Fallback — students.subjects is stored as JSON (e.g. ["Kiswahili","Math"])
          // JSON_CONTAINS checks if students.subjects contains the subject string
          studentsQuery = `
            SELECT id, name, gender
            FROM students
            WHERE class_level = ?
              AND stream = ?
              AND JSON_CONTAINS(subjects, JSON_QUOTE(?))
            ORDER BY name
          `;
          params = [assignment.class_level, assignment.stream, assignmentSubject];
        }
  
        const [students] = await pool.query(studentsQuery, params);
  
        // Ensure we always return an array
        res.json({ students: Array.isArray(students) ? students : [] });
      } catch (err) {
        console.error("Load students error:", err);
        res.status(500).json({ message: "Failed to load learners" });
      }
    }
  );
  
/* ===============================
   LOAD STUDENTS
=============================== */
app.get(
  "/api/teachers/assignments/:assignmentId/students",
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



app.get("/api/admin/assignments", authAdmin, async (req, res) => {
  try {
    const [[dbRow]] = await pool.query("SELECT DATABASE() AS db_name");
    const schemaName = process.env.DB_NAME || poolConfig.database || dbRow?.db_name;

    if (!schemaName) {
      throw new Error("Could not resolve active database schema name");
    }

    const [[{ has_created_at }]] = await pool.query(
      `
      SELECT COUNT(*) AS has_created_at
      FROM information_schema.columns
      WHERE table_schema = ?
        AND table_name = 'teacher_assignments'
        AND column_name = 'created_at'
      `,
      [schemaName]
    );

    if (!has_created_at) {
      await pool.query(
        `ALTER TABLE teacher_assignments
         ADD COLUMN created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP`
      );

      // Backfill existing rows with earliest marks timestamp where possible.
      await pool.query(
        `
        UPDATE teacher_assignments ta
        LEFT JOIN (
          SELECT assignment_id, MIN(created_at) AS first_mark_at
          FROM marks
          GROUP BY assignment_id
        ) m ON m.assignment_id = ta.id
        SET ta.created_at = COALESCE(m.first_mark_at, NOW())
        WHERE ta.created_at IS NULL
        `
      );
    }

    // Keep legacy rows populated even when column already exists.
    await pool.query(
      `
      UPDATE teacher_assignments ta
      LEFT JOIN (
        SELECT assignment_id, MIN(created_at) AS first_mark_at
        FROM marks
        GROUP BY assignment_id
      ) m ON m.assignment_id = ta.id
      SET ta.created_at = COALESCE(m.first_mark_at, NOW())
      WHERE ta.created_at IS NULL
      `
    );

    const [rows] = await pool.query(`
      SELECT ta.id, ta.class_level, ta.stream, ta.subject,
             t.name AS teacher_name,
             ta.created_at
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
        COUNT(m.id) AS marks_count,
        MAX(m.updated_at) AS submitted_at
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
        m.term DESC
    `);

    res.json(rows);
  } catch (err) {
    if (
      err?.code === "ER_BAD_FIELD_ERROR" &&
      String(err?.message || "").includes("updated_at")
    ) {
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
            COUNT(m.id) AS marks_count,
            NULL AS submitted_at
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
            m.term DESC
        `);
        return res.json(rows);
      } catch (fallbackErr) {
        console.error("Admin marks sets fallback error:", fallbackErr);
      }
    }
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
      // DELETE /api/students/:id  (admin only)
      app.delete("/api/admin/students/:id", authAdmin, async (req, res) => {
        try {
          const { id } = req.params;
      
          const [result] = await pool.query(
            "DELETE FROM students WHERE id = ?",
            [id]
          );
      
          if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Student not found" });
          }
      
          res.json({
            message: "Student deleted successfully",
            deletedId: id,
            affectedRows: result.affectedRows,
          });
        } catch (err) {
          console.error("Error deleting student:", err);
          res.status(500).json({ message: "Server error while deleting student" });
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
// ADMIN → DELETE TEACHER
app.delete("/api/admin/teachers/:id", authAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    await conn.beginTransaction();

    const [existing] = await conn.query(
      "SELECT id FROM teachers WHERE id = ?",
      [id]
    );

    if (!existing.length) {
      await conn.rollback();
      return res.status(404).json({ message: "Teacher not found" });
    }

    const [oLevelCleanup] = await conn.query(
      "DELETE FROM teacher_assignments WHERE teacher_id = ?",
      [id]
    );

    let aLevelCleanupCount = 0;
    try {
      const [aLevelCleanup] = await conn.query(
        "DELETE FROM alevel_teacher_subjects WHERE teacher_id = ?",
        [id]
      );
      aLevelCleanupCount = aLevelCleanup.affectedRows || 0;
    } catch (cleanupErr) {
      // Keep delete behavior compatible where A-Level tables are not provisioned.
      if (cleanupErr?.code !== "ER_NO_SUCH_TABLE") throw cleanupErr;
    }

    const [result] = await conn.query(
      "DELETE FROM teachers WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    await conn.commit();

    return res.json({
      message: "Teacher deleted successfully",
      deletedId: id,
      affectedRows: result.affectedRows,
      deletedAssignments: {
        oLevel: oLevelCleanup.affectedRows || 0,
        aLevel: aLevelCleanupCount,
      },
    });
  } catch (err) {
    await conn.rollback();
    console.error("Error deleting teacher:", err);
    res.status(500).json({ message: "Failed to delete teacher" });
  } finally {
    conn.release();
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

    // Guard against accidental duplicate submissions on slow networks.
    const [existing] = await pool.query(
      `SELECT id, name, class_level, stream, dob
       FROM students
       WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
         AND class_level = ?
         AND stream = ?
         AND (dob <=> ?)
       LIMIT 1`,
      [name, class_level, stream, dob || null]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        message: "Possible duplicate learner detected. This learner already exists for the same class/stream/date of birth.",
        existing: existing[0],
      });
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
// LOOKUP → TEACHERS (no admin auth, safe)
app.get("/api/lookup/teachers", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name FROM teachers ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    console.error("Lookup teachers error:", err);
    res.status(500).json({ message: "Failed to load teachers" });
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
    // Prevent same subject being assigned to multiple teachers in same class + stream
    const [conflict] = await pool.query(
     `SELECT teacher_id FROM teacher_assignments
       WHERE class_level = ? AND stream = ? AND subject = ?`,
       [class_level, stream, subject]
      );

          if (conflict.length > 0) {
          return res.status(409).json({
       message: `This subject is already assigned to another teacher for ${class_level} ${stream}.`,
        });
}

    const [result] = await pool.query(
      `INSERT INTO teacher_assignments
       (teacher_id, class_level, stream, subject)
       VALUES (?, ?, ?, ?)`,
      [teacherId, class_level, stream, subject]
    );

    await logAuditEvent({
      userId: Number(req.admin?.id) || 1,
      userRole: "admin",
      action: "ASSIGN_SUBJECT",
      entityType: "subject",
      entityId: Number(result.insertId),
      description: `${subject} assigned to ${class_level} ${stream} (teacher #${teacherId})`,
      ipAddress: extractClientIp(req),
    });

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
// delete assignment 
app.delete("/api/admin/assignments/:id", authAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // 1) Always delete related marks first (admin authority)
    await pool.query(
      "DELETE FROM marks WHERE assignment_id = ?",
      [id]
    );

    // 2) Then delete the assignment itself
    const [result] = await pool.query(
      "DELETE FROM teacher_assignments WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    res.json({ message: "Assignment deleted successfully" });
  } catch (err) {
    console.error("Delete assignment error:", err);
    res.status(500).json({ message: "Failed to delete assignment" });
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
        m.status,
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

// ===============================
// ADMIN → SCORE SHEET (NOTICEBOARD PDF SOURCE)
// ===============================
app.get("/api/admin/score-sheet", authAdmin, async (req, res) => {
  try {
    const classLevel = String(req.query.class_level || "").trim();
    const stream = String(req.query.stream || "").trim();
    const term = String(req.query.term || "").trim();
    const year = parseInt(req.query.year, 10);

    if (!classLevel || !stream || !term || !year) {
      return res.status(400).json({
        message: "class_level, stream, term and year are required",
      });
    }

    const [subjects] = await pool.query(
      `
      SELECT
        ta.id AS assignment_id,
        ta.subject,
        COALESCE(t.name, '—') AS teacher_name
      FROM marks m
      JOIN teacher_assignments ta ON ta.id = m.assignment_id
      LEFT JOIN teachers t ON t.id = ta.teacher_id
      WHERE ta.class_level = ?
        AND ta.stream = ?
        AND m.term = ?
        AND m.year = ?
        AND m.aoi_label IN ('AOI1', 'AOI2', 'AOI3')
      GROUP BY ta.id, ta.subject, t.name
      ORDER BY ta.subject
      `,
      [classLevel, stream, term, year]
    );

    const [students] = await pool.query(
      `
      SELECT id, name, gender
      FROM students
      WHERE class_level = ?
        AND stream = ?
      ORDER BY name
      `,
      [classLevel, stream]
    );

    const assignmentIds = (subjects || [])
      .map((s) => Number(s.assignment_id))
      .filter((id) => Number.isInteger(id) && id > 0);

    let marks = [];
    if (assignmentIds.length > 0) {
      const placeholders = assignmentIds.map(() => "?").join(",");
      const [rows] = await pool.query(
        `
        SELECT
          assignment_id,
          student_id,
          aoi_label,
          score,
          status
        FROM marks
        WHERE term = ?
          AND year = ?
          AND assignment_id IN (${placeholders})
          AND aoi_label IN ('AOI1', 'AOI2', 'AOI3')
        `,
        [term, year, ...assignmentIds]
      );
      marks = rows || [];
    }

    return res.json({
      class_level: classLevel,
      stream,
      term,
      year,
      students: students || [],
      subjects: subjects || [],
      marks,
    });
  } catch (err) {
    console.error("Score sheet source error:", err);
    return res.status(500).json({ message: "Failed to load score sheet data" });
  }
});
app.post("/api/teacher/marks", authTeacher, async (req, res) => {
  let conn;
  try {
    const teacherId = req.teacher.id;

    const assignmentId = parseInt(req.body.assignmentId, 10);
    const year = parseInt(req.body.year, 10);
    const term = req.body.term?.trim();
    const marks = req.body.marks;
    const clearMarks = Array.isArray(req.body.clearMarks) ? req.body.clearMarks : [];

    if (!assignmentId || !year || !term || !Array.isArray(marks)) {
      return res.status(400).json({ message: "Invalid marks payload" });
    }

    // 1) Ensure assignment exists and belongs to this teacher
    const [[assignmentRow]] = await pool.query(
      `SELECT subject, class_level, stream
       FROM teacher_assignments
       WHERE id = ? AND teacher_id = ?`,
      [assignmentId, teacherId]
    );

    if (!assignmentRow) {
      return res.status(404).json({ message: "Assignment not found or not assigned to this teacher" });
    }

    const assignmentSubject = (assignmentRow.subject || "").trim();
    const [[existingMarksMeta]] = await pool.query(
      `SELECT COUNT(*) AS count
       FROM marks
       WHERE assignment_id = ?
         AND teacher_id = ?
         AND year = ?
         AND term = ?`,
      [assignmentId, teacherId, year, term]
    );
    const hasExistingMarks = Number(existingMarksMeta?.count || 0) > 0;

    // 2) Collect unique studentIds from payload (upserts + clears)
    const studentIds = Array.from(
      new Set(
        [...marks, ...clearMarks]
          .map((m) => Number(m.studentId))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );

    if (studentIds.length === 0) {
      return res.status(400).json({ message: "No valid studentIds provided" });
    }

    // 3) Start transaction and validate registrations in batch
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // detect if subject_registrations table exists
    const [[{ registrations_table_count }]] = await conn.query(
      `SELECT COUNT(*) AS registrations_table_count
       FROM information_schema.tables
       WHERE table_schema = ? AND table_name = 'subject_registrations'`,
      [process.env.DB_NAME]
    );

    const placeholders = studentIds.map(() => "?").join(",");

    const registeredIdsSet = new Set();

    if (registrations_table_count > 0) {
      // detect if 'year' column exists in subject_registrations
      const [[{ year_col_count }]] = await conn.query(
        `SELECT COUNT(*) AS year_col_count
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = 'subject_registrations' AND column_name = 'year'`,
        [process.env.DB_NAME]
      );

      if (year_col_count > 0) {
        const [rows] = await conn.query(
          `SELECT student_id FROM subject_registrations
           WHERE student_id IN (${placeholders}) AND subject = ? AND year = ?`,
          [...studentIds, assignmentSubject, year]
        );
        rows.forEach((r) => registeredIdsSet.add(r.student_id));
      } else {
        const [rows] = await conn.query(
          `SELECT student_id FROM subject_registrations
           WHERE student_id IN (${placeholders}) AND subject = ?`,
          [...studentIds, assignmentSubject]
        );
        rows.forEach((r) => registeredIdsSet.add(r.student_id));
      }
    } else {
      // fallback: students.subjects stored as JSON array
      const [rows] = await conn.query(
        `SELECT id AS student_id FROM students
         WHERE id IN (${placeholders}) AND JSON_CONTAINS(subjects, JSON_QUOTE(?))`,
        [...studentIds, assignmentSubject]
      );
      rows.forEach((r) => registeredIdsSet.add(r.student_id));
    }

    const notRegistered = studentIds.filter((id) => !registeredIdsSet.has(id));
    if (notRegistered.length > 0) {
      await conn.rollback();
      return res.status(400).json({
        message: `Students not registered for ${assignmentSubject}: ${notRegistered.join(",")}`,
      });
    }

    const allowedAois = term === "Term 3"
      ? ["AOI1", "AOI2", "AOI3", "EXAM80"]
      : ["AOI1", "AOI2", "AOI3"];

    // 4) Clear explicitly emptied marks first
    for (const m of clearMarks) {
      const aoi = (m.aoi || "").trim().toUpperCase();
      const sid = Number(m.studentId);

      if (!aoi || !allowedAois.includes(aoi) || !Number.isInteger(sid) || sid <= 0) {
        await conn.rollback();
        return res.status(400).json({ message: "Invalid clearMarks payload" });
      }

      if (!registeredIdsSet.has(sid)) {
        await conn.rollback();
        return res.status(400).json({ message: `Student ${sid} is not registered for ${assignmentSubject}` });
      }

      await conn.query(
        `DELETE FROM marks
         WHERE assignment_id = ?
           AND student_id = ?
           AND year = ?
           AND term = ?
           AND aoi_label = ?`,
        [assignmentId, sid, year, term, aoi]
      );
    }

    // 5) Validate each mark entry and insert/upsert using the transaction connection
    for (const m of marks) {
      const isMissed = m.score === "Missed";
      const aoi = (m.aoi || "").trim().toUpperCase();

      if (!aoi || !allowedAois.includes(aoi)) {
        await conn.rollback();
        return res.status(400).json({
          message: `Each mark must include a valid AOI (${allowedAois.join(", ")})`,
        });
      }

      // Ensure the student is actually part of the validated list (extra safety)
      const sid = Number(m.studentId);
      if (!registeredIdsSet.has(sid)) {
        await conn.rollback();
        return res.status(400).json({ message: `Student ${sid} is not registered for ${assignmentSubject}` });
      }

      // score presence/format for present students
      if (!isMissed) {
        if (
          m.score === "" ||
          m.score === null ||
          m.score === undefined ||
          Number.isNaN(Number(m.score))
        ) {
          await conn.rollback();
          return res.status(400).json({
            message: "Present students must have a valid score",
          });
        }

        const scoreNum = Number(m.score);
        if (aoi === "EXAM80") {
          if (scoreNum < 0 || scoreNum > 80) {
            await conn.rollback();
            return res.status(400).json({ message: "EXAM80 score must be between 0 and 80" });
          }
        } else if (scoreNum < 0.9 || scoreNum > 3.0) {
          await conn.rollback();
          return res.status(400).json({ message: "AOI score must be between 0.9 and 3.0" });
        }
      }

      // upsert mark (same logic as before), use transaction connection
      await conn.query(
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
          sid,
          isMissed ? null : Number(m.score),
          isMissed ? "Missed" : "Present",
          year,
          term,
          aoi,
        ]
      );
    }

    // commit transaction
    await conn.commit();
    conn.release();
    conn = null;

    const marksAction =
      hasExistingMarks || clearMarks.length > 0 ? "UPDATE_MARKS" : "SUBMIT_MARKS";
    const marksVerb = marksAction === "UPDATE_MARKS" ? "Updated" : "Submitted";
    await logAuditEvent({
      userId: teacherId,
      userRole: "teacher",
      action: marksAction,
      entityType: "marks",
      entityId: assignmentId,
      description: `${marksVerb} ${assignmentSubject} marks for ${assignmentRow.class_level} ${assignmentRow.stream} (${term} ${year})`,
      ipAddress: extractClientIp(req),
    });

    res.json({ message: "Marks saved successfully" });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {
        console.error("Rollback error:", e);
      }
      conn.release();
    }
    console.error("❌ Save marks error:", err);
    res.status(500).json({ message: "Failed to save marks" });
  }
});


app.get("/api/teacher/marks", authTeacher, async (req, res) => {
  try {
    const assignmentId = parseInt(req.query.assignmentId, 10);
    const year = parseInt(req.query.year, 10);
    const term = req.query.term?.trim();

    if (!assignmentId || !year || !term) {
      return res.status(400).json({ message: "Missing parameters" });
    }

    const [rows] = await pool.query(
      `
      SELECT
        student_id,
        score,
        status,
        aoi_label
      FROM marks
      WHERE assignment_id = ?
        AND year = ?
        AND term = ?
      `,
      [assignmentId, year, term]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ Load marks error:", err);
    res.status(500).json({ message: "Failed to load marks" });
  }
});
// -----------------------
// PLURAL ALIAS: students for an assignment
// -----------------------
app.get(
  "/api/teachers/assignments/:assignmentId/students",
  authTeacher,
  async (req, res) => {
    try {
      const assignmentId = Number(req.params.assignmentId);
      if (!assignmentId) return res.status(400).json({ message: "Invalid assignment id" });

      const [[assignment]] = await pool.query(
        `SELECT class_level, stream, subject
         FROM teacher_assignments
         WHERE id = ? AND teacher_id = ?`,
        [assignmentId, req.teacher.id]
      );

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      const subject = assignment.subject;

      // If you have subject_registrations, change JOIN accordingly;
      // this fallback uses JSON stored subjects (existing pattern).
      const [students] = await pool.query(
        `
        SELECT s.id, s.name, s.gender
        FROM students s
        WHERE s.class_level = ?
          AND s.stream = ?
          AND JSON_CONTAINS(s.subjects, JSON_QUOTE(?))
        ORDER BY s.name
        `,
        [assignment.class_level, assignment.stream, subject]
      );

      res.json({ students: Array.isArray(students) ? students : [] });
    } catch (err) {
      console.error("❌ Load students error (plural):", err);
      res.status(500).json({ message: "Failed to load learners" });
    }
  }
);
// -----------------------
// PLURAL: GET marks (for frontend 'load marks')
// -----------------------
app.get("/api/teachers/marks", authTeacher, async (req, res) => {
  try {
    const assignmentId = parseInt(req.query.assignmentId, 10);
    const year = parseInt(req.query.year, 10);
    const term = req.query.term?.trim();

    if (!assignmentId || !year || !term) {
      return res.status(400).json({ message: "Missing parameters" });
    }

    const [rows] = await pool.query(
      `
      SELECT
        student_id,
        score,
        status,
        aoi_label
      FROM marks
      WHERE assignment_id = ?
        AND year = ?
        AND term = ?
      `,
      [assignmentId, year, term]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ Load marks error (plural):", err);
    res.status(500).json({ message: "Failed to load marks" });
  }
});
// -----------------------
// PLURAL: POST marks (save) — transactional, validates registration
// Paste this if your frontend posts to /api/teachers/marks
// -----------------------
app.post("/api/teachers/marks", authTeacher, async (req, res) => {
  let conn;
  try {
    const teacherId = req.teacher.id;

    const assignmentId = parseInt(req.body.assignmentId, 10);
    const year = parseInt(req.body.year, 10);
    const term = req.body.term?.trim();
    const marks = req.body.marks;
    const clearMarks = Array.isArray(req.body.clearMarks) ? req.body.clearMarks : [];

    if (!assignmentId || !year || !term || !Array.isArray(marks)) {
      return res.status(400).json({ message: "Invalid marks payload" });
    }

    // ensure assignment belongs to teacher
    const [[assignmentRow]] = await pool.query(
      `SELECT subject, class_level, stream
       FROM teacher_assignments
       WHERE id = ? AND teacher_id = ?`,
      [assignmentId, teacherId]
    );
    if (!assignmentRow) {
      return res.status(404).json({ message: "Assignment not found or not assigned to this teacher" });
    }
    const assignmentSubject = (assignmentRow.subject || "").trim();
    const [[existingMarksMeta]] = await pool.query(
      `SELECT COUNT(*) AS count
       FROM marks
       WHERE assignment_id = ?
         AND teacher_id = ?
         AND year = ?
         AND term = ?`,
      [assignmentId, teacherId, year, term]
    );
    const hasExistingMarks = Number(existingMarksMeta?.count || 0) > 0;

    // build unique student id list (upserts + clears)
    const studentIds = Array.from(
      new Set(
        [...marks, ...clearMarks]
          .map((m) => Number(m.studentId))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
    if (studentIds.length === 0) {
      return res.status(400).json({ message: "No valid studentIds provided" });
    }

    // transaction
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // check if subject_registrations exists
    const [[{ registrations_table_count }]] = await conn.query(
      `SELECT COUNT(*) AS registrations_table_count
       FROM information_schema.tables
       WHERE table_schema = ? AND table_name = 'subject_registrations'`,
      [process.env.DB_NAME]
    );

    const placeholders = studentIds.map(() => "?").join(",");
    const registeredIdsSet = new Set();

    if (registrations_table_count > 0) {
      // detect year column presence
      const [[{ year_col_count }]] = await conn.query(
        `SELECT COUNT(*) AS year_col_count
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = 'subject_registrations' AND column_name = 'year'`,
        [process.env.DB_NAME]
      );

      if (year_col_count > 0) {
        const [rows] = await conn.query(
          `SELECT student_id FROM subject_registrations
           WHERE student_id IN (${placeholders}) AND subject = ? AND year = ?`,
          [...studentIds, assignmentSubject, year]
        );
        rows.forEach((r) => registeredIdsSet.add(r.student_id));
      } else {
        const [rows] = await conn.query(
          `SELECT student_id FROM subject_registrations
           WHERE student_id IN (${placeholders}) AND subject = ?`,
          [...studentIds, assignmentSubject]
        );
        rows.forEach((r) => registeredIdsSet.add(r.student_id));
      }
    } else {
      // fallback: JSON_CONTAINS on students.subjects
      const [rows] = await conn.query(
        `SELECT id AS student_id FROM students
         WHERE id IN (${placeholders}) AND JSON_CONTAINS(subjects, JSON_QUOTE(?))`,
        [...studentIds, assignmentSubject]
      );
      rows.forEach((r) => registeredIdsSet.add(r.student_id));
    }

    const notRegistered = studentIds.filter((id) => !registeredIdsSet.has(id));
    if (notRegistered.length > 0) {
      await conn.rollback();
      return res.status(400).json({
        message: `Students not registered for ${assignmentSubject}: ${notRegistered.join(",")}`,
      });
    }

    const allowedAois = term === "Term 3"
      ? ["AOI1", "AOI2", "AOI3", "EXAM80"]
      : ["AOI1", "AOI2", "AOI3"];

    // clear explicitly emptied marks first
    for (const m of clearMarks) {
      const aoi = (m.aoi || "").trim().toUpperCase();
      const sid = Number(m.studentId);

      if (!aoi || !allowedAois.includes(aoi) || !Number.isInteger(sid) || sid <= 0) {
        await conn.rollback();
        return res.status(400).json({ message: "Invalid clearMarks payload" });
      }

      if (!registeredIdsSet.has(sid)) {
        await conn.rollback();
        return res.status(400).json({ message: `Student ${sid} is not registered for ${assignmentSubject}` });
      }

      await conn.query(
        `DELETE FROM marks
         WHERE assignment_id = ?
           AND student_id = ?
           AND year = ?
           AND term = ?
           AND aoi_label = ?`,
        [assignmentId, sid, year, term, aoi]
      );
    }

    // validate and upsert marks using transaction connection
    for (const m of marks) {
      const isMissed = m.score === "Missed";
      const aoi = (m.aoi || "").trim().toUpperCase();

      if (!aoi || !allowedAois.includes(aoi)) {
        await conn.rollback();
        return res.status(400).json({
          message: `Each mark must include a valid AOI (${allowedAois.join(", ")})`,
        });
      }

      const sid = Number(m.studentId);
      if (!registeredIdsSet.has(sid)) {
        await conn.rollback();
        return res.status(400).json({ message: `Student ${sid} is not registered for ${assignmentSubject}` });
      }

      if (!isMissed) {
        if (
          m.score === "" ||
          m.score === null ||
          m.score === undefined ||
          Number.isNaN(Number(m.score))
        ) {
          await conn.rollback();
          return res.status(400).json({ message: "Present students must have a valid score" });
        }

        const scoreNum = Number(m.score);
        if (aoi === "EXAM80") {
          if (scoreNum < 0 || scoreNum > 80) {
            await conn.rollback();
            return res.status(400).json({ message: "EXAM80 score must be between 0 and 80" });
          }
        } else if (scoreNum < 0.9 || scoreNum > 3.0) {
          await conn.rollback();
          return res.status(400).json({ message: "AOI score must be between 0.9 and 3.0" });
        }
      }

      await conn.query(
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
          sid,
          isMissed ? null : Number(m.score),
          isMissed ? "Missed" : "Present",
          year,
          term,
          aoi,
        ]
      );
    }

    await conn.commit();
    conn.release();
    conn = null;

    const marksAction =
      hasExistingMarks || clearMarks.length > 0 ? "UPDATE_MARKS" : "SUBMIT_MARKS";
    const marksVerb = marksAction === "UPDATE_MARKS" ? "Updated" : "Submitted";
    await logAuditEvent({
      userId: teacherId,
      userRole: "teacher",
      action: marksAction,
      entityType: "marks",
      entityId: assignmentId,
      description: `${marksVerb} ${assignmentSubject} marks for ${assignmentRow.class_level} ${assignmentRow.stream} (${term} ${year})`,
      ipAddress: extractClientIp(req),
    });

    res.json({ message: "Marks saved successfully" });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (e) { console.error("Rollback error:", e); }
      conn.release();
    }
    console.error("❌ Save marks error (plural):", err);
    res.status(500).json({ message: "Failed to save marks" });
  }
});

// DELETE /api/admin/marks-set
app.delete("/api/admin/marks-set", authAdmin, async (req, res) => {
  try {
    const { assignmentId, term, year, aoi } = req.body;

    if (!assignmentId || !term || !year || !aoi) {
      return res.status(400).json({
        message: "assignmentId, term, year and aoi are required",
      });
    }

    const [[assignmentRow]] = await pool.query(
      `SELECT class_level, stream, subject
       FROM teacher_assignments
       WHERE id = ?
       LIMIT 1`,
      [assignmentId]
    );

    const [result] = await pool.query(
      `DELETE FROM marks
       WHERE assignment_id = ?
         AND term = ?
         AND year = ?
         AND aoi_label = ?`,
      [assignmentId, term, year, aoi]
    );

    await logAuditEvent({
      userId: Number(req.admin?.id) || 1,
      userRole: "admin",
      action: "UNLOCK_MARKS",
      entityType: "marks",
      entityId: Number(assignmentId),
      description:
        `Unlocked ${aoi} for ${assignmentRow?.subject || "subject"} (${assignmentRow?.class_level || "?"} ${assignmentRow?.stream || "?"}) ${term} ${year}; rows affected: ${result.affectedRows}`,
      ipAddress: extractClientIp(req),
    });

    res.json({
      message: "Mark set deleted successfully",
      deletedRows: result.affectedRows,
    });
  } catch (err) {
    console.error("Error deleting mark set:", err);
    res.status(500).json({ message: "Server error while deleting mark set" });
  }
});
// GET /api/notices (teachers)
app.get("/api/school-calendar", async (req, res) => {
  try {
    const calendar = await readSchoolCalendarSettings();
    res.json(calendar);
  } catch (err) {
    console.error("Load school calendar error:", err);
    res.status(500).json({ message: "Failed to load school calendar" });
  }
});

app.get("/api/admin/school-calendar", authAdmin, async (req, res) => {
  try {
    const calendar = await readSchoolCalendarSettings();
    res.json(calendar);
  } catch (err) {
    console.error("Admin load school calendar error:", err);
    res.status(500).json({ message: "Failed to load school calendar" });
  }
});

app.put("/api/admin/school-calendar", authAdmin, async (req, res) => {
  try {
    const normalized = normalizeSchoolCalendarPayload(req.body || {});
    const missingDates = normalized.entries.filter((entry) => !entry.from || !entry.to);
    if (missingDates.length) {
      return res.status(400).json({
        message: `Fill in both dates for ${missingDates[0].label}.`,
      });
    }

    const invalidRange = normalized.entries.find((entry) => entry.from > entry.to);
    if (invalidRange) {
      return res.status(400).json({
        message: `${invalidRange.label} has an end date before its start date.`,
      });
    }

    await ensureSchoolCalendarSettingsTable();
    await pool.query(
      `INSERT INTO school_calendar_settings (id, academic_year, calendar_json)
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE
         academic_year = VALUES(academic_year),
         calendar_json = VALUES(calendar_json)`,
      [normalized.academicYear, JSON.stringify(normalized.entries)]
    );

    const saved = await readSchoolCalendarSettings();

    await logAuditEvent({
      userId: Number(req.admin?.id) || 1,
      userRole: "admin",
      action: "UPDATE_SCHOOL_CALENDAR",
      entityType: "system",
      entityId: 1,
      description: `Updated school calendar for academic year ${saved.academicYear}`,
      ipAddress: extractClientIp(req),
    });

    res.json(saved);
  } catch (err) {
    console.error("Save school calendar error:", err);
    res.status(500).json({ message: "Failed to save school calendar" });
  }
});

// GET /api/notices (teachers)
app.get("/api/notices", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, title, body, created_at FROM notices ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("Load notices error:", err);
    res.status(500).json({ message: "Failed to load notices" });
  }
});

// POST /api/admin/notices
app.post("/api/admin/notices", authAdmin, async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ message: "Title and body required" });
    }

    const [result] = await pool.query(
      "INSERT INTO notices (title, body) VALUES (?, ?)",
      [title, body]
    );

    res.json({
      id: result.insertId,
      title,
      body,
      created_at: new Date(),
    });
  } catch (err) {
    console.error("Create notice error:", err);
    res.status(500).json({ message: "Failed to create notice" });
  }
});
// DELETE /api/admin/notices/:id
app.delete("/api/admin/notices/:id", authAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      "DELETE FROM notices WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Notice not found" });
    }

    res.json({ message: "Notice deleted successfully" });
  } catch (err) {
    console.error("Delete notice error:", err);
    res.status(500).json({ message: "Failed to delete notice" });
  }
});

app.post("/api/teacher/change-password", authTeacher, async (req, res) => {
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

    fireAndForgetEmail(
      () => sendTeacherPasswordChangedEmail(rows[0].email, rows[0].name),
      "Legacy teacher password change notice"
    );

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("❌ Change password error:", err);
    res.status(500).json({ message: "Server error" });
  }
});
// add to server.js (or routes/teachers.js if you keep teacher routes there)
// GET analytics for a class (AOI breakdown)
app.get("/api/teachers/analytics/class", authTeacher, async (req, res) => {
  try {
    const assignmentId = parseInt(req.query.assignmentId, 10);
    const term = (req.query.term || "").trim();
    const year = parseInt(req.query.year, 10);

    if (!assignmentId || !term || !year) {
      return res.status(400).json({ message: "assignmentId, term and year are required" });
    }

    const [rows] = await pool.query(
      `
      SELECT 
        m.aoi_label AS aoi_label,
        COUNT(*) AS total,
        AVG(m.score) AS average,
        SUM(CASE WHEN m.status = 'Missed' THEN 1 ELSE 0 END) AS missed
      FROM marks m
      WHERE m.assignment_id = ?
        AND m.term = ?
        AND m.year = ?
      GROUP BY m.aoi_label
      `,
      [assignmentId, term, year]
    );

    res.json({
      assignmentId,
      term,
      year,
      breakdown: Array.isArray(rows) ? rows : []
    });
  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ message: "Failed to load analytics" });
  }
});
// ===============================
// TEACHER → SUBJECT ANALYTICS
// ===============================
app.get("/api/teachers/analytics/subject", authTeacher, async (req, res) => {
  try {
    const teacherId = req.teacher.id;
    const assignmentId = parseInt(req.query.assignmentId, 10);
    const year = parseInt(req.query.year, 10);
    const term = req.query.term?.trim();

    if (!assignmentId || !year || !term) {
      return res.status(400).json({
        message: "assignmentId, year and term are required",
      });
    }

    // 1️⃣ Validate assignment belongs to teacher
    const [[assignment]] = await pool.query(
      `
      SELECT class_level, stream, subject
      FROM teacher_assignments
      WHERE id = ? AND teacher_id = ?
      `,
      [assignmentId, teacherId]
    );

    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    // 2️⃣ Count registered learners for this subject
    const [[{ registered_count }]] = await pool.query(
      `
      SELECT COUNT(*) AS registered_count
      FROM students
      WHERE class_level = ?
        AND stream = ?
        AND JSON_CONTAINS(subjects, JSON_QUOTE(?))
      `,
      [assignment.class_level, assignment.stream, assignment.subject]
    );

    // 3️⃣ AOI analytics (only for this assignment)
    const [aoiRows] = await pool.query(
      `
      SELECT
        aoi_label,
        COUNT(*) AS attempts,
        ROUND(AVG(score), 2) AS average_score,
        SUM(status = 'Missed') AS missed_count
      FROM marks
      WHERE assignment_id = ?
        AND year = ?
        AND term = ?
      GROUP BY aoi_label
      ORDER BY aoi_label
      `,
      [assignmentId, year, term]
    );

    // 4️⃣ Overall subject average (across all AOIs)
    const [[overall]] = await pool.query(
      `
      SELECT ROUND(AVG(score), 2) AS overall_average
      FROM marks
      WHERE assignment_id = ?
        AND year = ?
        AND term = ?
        AND status = 'Present'
      `,
      [assignmentId, year, term]
    );

    res.json({
      assignment: {
        id: assignmentId,
        subject: assignment.subject,
        class_level: assignment.class_level,
        stream: assignment.stream,
      },
      meta: {
        registered_learners: registered_count,
        year,
        term,
      },
      aois: aoiRows || [],
      overall_average: overall?.overall_average ?? "—",
    });
  } catch (err) {
    console.error("❌ Subject analytics error:", err);
    res.status(500).json({ message: "Failed to load subject analytics" });
  }
});
// Put this in server.js (or your admin router) where `app` and `db` are available
app.put("/api/admin/students/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;

    console.log("[UPDATE STUDENT] route hit, id =", id);
    console.log("[UPDATE STUDENT] body:", JSON.stringify(payload));

    if (!payload || typeof payload !== "object") {
      console.error("[UPDATE STUDENT] missing body or invalid JSON");
      return res.status(400).json({ message: "Invalid request body" });
    }

    const { name, gender, class_level, stream, subjects } = payload;

    if (!name || !gender || !class_level || !stream) {
      console.warn("[UPDATE STUDENT] validation failed", { name, gender, class_level, stream });
      return res.status(400).json({ message: "Missing required fields" });
    }

    const subjectsJson = JSON.stringify(Array.isArray(subjects) ? subjects : []);

    const sql =
      "UPDATE students SET name = ?, gender = ?, class_level = ?, stream = ?, subjects = ? WHERE id = ?";

    const params = [name, gender, class_level, stream, subjectsJson, id];

    // Promise-based mysql2 pool (current backend setup)
    const [result] = await db.query(sql, params);
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ message: "Student not found" });
    }

    const [rows] = await db.query("SELECT * FROM students WHERE id = ?", [id]);
    const row = rows && rows[0];
    if (!row) return res.status(404).json({ message: "Student not found after update" });

    try {
      row.subjects = row.subjects ? JSON.parse(row.subjects) : [];
    } catch (e) {
      console.warn("[UPDATE STUDENT] subjects JSON parse failed:", e);
      row.subjects = [];
    }
    return res.json(row);
  } catch (err) {
    console.error("[UPDATE STUDENT] Unexpected server error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Server error", detail: err.message || String(err) });
  }
});

app.get("/health", async (req, res) => {
  try {
    // if you have a pool
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", db: "disconnected" });
  }
});

/* =======================
   START SERVER
======================= */

const server = http.createServer(app);

export const io = new Server(server, {
  cors: {
    origin: "*", // fine for dev
  },
});
const socketToUserId = new Map();
const userIdToSockets = new Map();

export const getOnlineUserIds = () => Array.from(userIdToSockets.keys());

io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  socket.on("register", (userId) => {
    const uid = Number(userId);
    if (!uid) return;
    socket.join(`user-${uid}`);
    socketToUserId.set(socket.id, uid);
    if (!userIdToSockets.has(uid)) userIdToSockets.set(uid, new Set());
    userIdToSockets.get(uid).add(socket.id);
    console.log("👤 User joined room:", uid);
  });

  socket.on("join_conversation", (conversationId) => {
    socket.join(`conversation-${conversationId}`);
    console.log("💬 Joined conversation:", conversationId);
  });

  socket.on("send_dm", ({ conversationId, message }) => {
    io.to(`conversation-${conversationId}`).emit("dm_received", message);
  });

  socket.on("dm_typing_start", ({ conversationId, userId }) => {
    if (!conversationId || !userId) return;
    socket.to(`conversation-${conversationId}`).emit("dm_typing_start", {
      conversationId,
      userId,
    });
  });

  socket.on("dm_typing_stop", ({ conversationId, userId }) => {
    if (!conversationId || !userId) return;
    socket.to(`conversation-${conversationId}`).emit("dm_typing_stop", {
      conversationId,
      userId,
    });
  });

  socket.on("disconnect", () => {
    const uid = socketToUserId.get(socket.id);
    if (uid) {
      const set = userIdToSockets.get(uid);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) userIdToSockets.delete(uid);
      }
      socketToUserId.delete(socket.id);
    }
    console.log("❌ Socket disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Spess Ark backend + WS running on http://localhost:${PORT}`);
});
