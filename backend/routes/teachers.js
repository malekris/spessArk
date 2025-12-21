// backend/routes/teachers.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { sendVerificationEmail } from "../utils/email.js";
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
    return res
      .status(400)
      .json({ message: "Name, email and password are required" });
  }

  try {
    // 🔍 Check if teacher exists
    const [rows] = await pool.query(
      "SELECT id, is_verified FROM teachers WHERE email = ?",
      [email]
    );

    // 🔁 EXISTS
    if (rows.length > 0) {
      const teacher = rows[0];

      // Not verified → resend email
      if (!teacher.is_verified) {
        console.log("🔁 Resending verification email to:", email);
        try {
          await sendVerificationEmail(email, teacher.id);
        } catch (emailErr) {
          console.warn("⚠️ Email resend failed, continuing:", emailErr.message);
        }
        

        return res.json({
          message:
            "Account exists but is not verified. Verification email resent.",
        });
      }

      // Verified → block duplicate
      return res.status(409).json({
        message: "Teacher already exists",
      });
    }

    // 🔐 Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // 🧑‍🏫 Create teacher
    const [result] = await pool.query(
      `INSERT INTO teachers (name, email, password_hash, is_verified)
       VALUES (?, ?, ?, 1)`,
      [name, email, passwordHash]
    );

    const teacherId = result.insertId;
    console.log("✅ Teacher created with ID:", teacherId);

    // 📧 Send verification email
      // 📧 Send verification email (non-blocking)
try {
  await sendVerificationEmail(email, teacherId);
} catch (emailErr) {
  console.warn("⚠️ Verification email failed, continuing:", emailErr.message);
}


    res.status(201).json({
      message:
        "Account created successfully. Please check your email to verify your account.",
    });
  } catch (err) {
    console.error("❌ Teacher register error:", err);
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

export default router;
