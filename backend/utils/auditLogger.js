import { pool } from "../server.js";

const VALID_ROLES = new Set(["admin", "teacher"]);
const VALID_ENTITY_TYPES = new Set([
  "marks",
  "subject",
  "stream",
  "teacher",
  "login",
  "system",
]);

const trimOrNull = (value, maxLen = 255) => {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  if (!out) return null;
  return out.slice(0, maxLen);
};

/**
 * Normalize client IP from proxy headers and req.ip.
 */
export function extractClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = String(forwarded).split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = req.headers["x-real-ip"];
  if (realIp) return String(realIp).trim();

  return trimOrNull(req.ip, 45) || "unknown";
}

/**
 * Reusable audit logger.
 * This function is intentionally fail-safe and never throws to callers.
 */
export async function logAuditEvent({
  userId = null,
  userRole = "admin",
  action,
  entityType = "system",
  entityId = null,
  description = null,
  ipAddress = null,
}) {
  try {
    const normalizedRole = VALID_ROLES.has(String(userRole).toLowerCase())
      ? String(userRole).toLowerCase()
      : "admin";

    const normalizedEntityType = VALID_ENTITY_TYPES.has(
      String(entityType).toLowerCase()
    )
      ? String(entityType).toLowerCase()
      : "system";

    const normalizedAction = trimOrNull(action, 100);
    if (!normalizedAction) return false;

    await pool.query(
      `
      INSERT INTO audit_logs
        (user_id, user_role, action, entity_type, entity_id, description, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        Number.isInteger(Number(userId)) ? Number(userId) : null,
        normalizedRole,
        normalizedAction,
        normalizedEntityType,
        Number.isInteger(Number(entityId)) ? Number(entityId) : null,
        trimOrNull(description, 1000),
        trimOrNull(ipAddress, 45),
      ]
    );

    return true;
  } catch (err) {
    // Audit logs should not break business actions.
    console.error("Audit log write failed:", err?.code || err?.message || err);
    return false;
  }
}
