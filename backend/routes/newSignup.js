import express from "express";
import bcrypt from "bcrypt";
import { sendWelcomeEmail } from "../utils/newEmail.js";
import { pool } from "../server.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const { name, email, password } = req.body;

  console.log("🆕 New signup hit:", email);

  if (!name || !email || !password) {
    return res.status(400).json({ message: "All fields required" });
  }

  try {
    // Check duplicate
    const [existing] = await pool.query(
      "SELECT id FROM teachers WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: "Teacher already exists" });
    }

    // Fast hash
    const hash = await bcrypt.hash(password, 6);

    // Insert
    const [result] = await pool.query(
      "INSERT INTO teachers (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
      [name, email, hash]
    );

    console.log("✅ Account created:", result.insertId);

    // Respond immediately
    res.status(201).json({
      message: "Account created successfully. Please check your email for further information.",
    });

    // Send email in background
    sendWelcomeEmail(email, name)
      .then(() => console.log("📧 Email sent:", email))
      .catch(err => console.warn("⚠️ Email failed:", err.message));

  } catch (err) {
    console.error("❌ New signup error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
