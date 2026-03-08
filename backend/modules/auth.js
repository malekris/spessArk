import jwt from "jsonwebtoken";
import { db } from "../server.js";

const getDeletionDueAt = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setDate(dt.getDate() + 10);
  return dt;
};

export async function authenticate(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.jti) {
      const [[session]] = await db.query(
        "SELECT revoked_at FROM vine_user_sessions WHERE user_id = ? AND session_jti = ? LIMIT 1",
        [decoded.id, decoded.jti]
      );
      if (!session || session.revoked_at) {
        return res.status(401).json({ message: "Session expired" });
      }
    }
    const [[user]] = await db.query(
      "SELECT delete_requested_at FROM vine_users WHERE id = ? LIMIT 1",
      [decoded.id]
    );
    const dueAt = getDeletionDueAt(user?.delete_requested_at);
    if (dueAt && dueAt <= new Date()) {
      return res.status(403).json({ message: "Account deletion completed." });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}
