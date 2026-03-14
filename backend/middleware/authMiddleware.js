import jwt from "jsonwebtoken";
import { db } from "../server.js";

const SESSION_IDLE_MS = 1 * 60 * 60 * 1000;

const getDeletionDueAt = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setDate(dt.getDate() + 10);
  return dt;
};

export default async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.jti) {
      const [[session]] = await db.query(
        "SELECT revoked_at, last_seen_at FROM vine_user_sessions WHERE user_id = ? AND session_jti = ? LIMIT 1",
        [decoded.id, decoded.jti]
      );
      if (!session || session.revoked_at) {
        return res.status(401).json({ message: "Session expired" });
      }
      const lastSeenAt = new Date(session.last_seen_at || 0).getTime();
      if (!lastSeenAt || Date.now() - lastSeenAt > SESSION_IDLE_MS) {
        await db.query(
          "UPDATE vine_user_sessions SET revoked_at = NOW() WHERE user_id = ? AND session_jti = ? AND revoked_at IS NULL",
          [decoded.id, decoded.jti]
        ).catch(() => {});
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
    await db.query("UPDATE vine_users SET last_active_at = NOW() WHERE id = ?", [decoded.id]).catch(() => {});
    if (decoded?.jti) {
      await db.query(
        "UPDATE vine_user_sessions SET last_seen_at = NOW() WHERE user_id = ? AND session_jti = ? AND revoked_at IS NULL",
        [decoded.id, decoded.jti]
      ).catch(() => {});
    }
    req.user = decoded; // now req.user.id works
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}
