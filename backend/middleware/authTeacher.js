 // backend/middleware/authTeacher.js
import jwt from "jsonwebtoken";
import { ensureTeacherAccountLifecycleColumns, pool } from "../server.js";
import { getJwtSecret } from "../config/security.js";

export default async function authTeacher(req, res, next) {
  const authHeader = req.headers.authorization || "";

  // Expect: Authorization: Bearer <token>
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: "Teacher authentication required" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret());
  } catch (err) {
    console.warn("Teacher token verification failed:", err?.message || err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  if (decoded?.resetOnly || decoded?.purpose === "password_reset" || decoded?.role !== "teacher") {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  try {
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

    req.teacher = decoded;
    return next();
  } catch (err) {
    console.error("Teacher account status check failed:", err);
    return res.status(503).json({
      code: "TEACHER_AUTH_CHECK_UNAVAILABLE",
      message: "Teacher session check is temporarily unavailable. Please retry.",
    });
  }
}
