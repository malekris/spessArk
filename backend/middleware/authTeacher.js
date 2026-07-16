 // backend/middleware/authTeacher.js
import jwt from "jsonwebtoken";
import { ensureTeacherAccountLifecycleColumns, pool } from "../server.js";

export default async function authTeacher(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";

    // Expect: Authorization: Bearer <token>
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ message: "Teacher authentication required" });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "dev_secret"
    );

    await ensureTeacherAccountLifecycleColumns(pool);
    const [[teacherAccount]] = await pool.query(
      `SELECT id
       FROM teachers
       WHERE id = ?
         AND COALESCE(NULLIF(account_status, ''), 'active') = 'active'
         AND retired_at IS NULL
       LIMIT 1`,
      [decoded.id]
    );

    if (!teacherAccount) {
      return res.status(403).json({
        code: "TEACHER_ACCOUNT_RETIRED",
        message: "This teacher account is no longer active.",
      });
    }

    // Attach teacher info to request
    req.teacher = decoded;

    next();
  } catch (err) {
    console.error("❌ authTeacher error:", err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}
