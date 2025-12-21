 // backend/middleware/authTeacher.js
import jwt from "jsonwebtoken";

export default function authTeacher(req, res, next) {
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

    // Attach teacher info to request
    req.teacher = decoded;

    next();
  } catch (err) {
    console.error("❌ authTeacher error:", err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}
