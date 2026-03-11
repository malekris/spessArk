import express from "express";
import authAdmin from "../middleware/authAdmin.js";
import { pool } from "../server.js";

const router = express.Router();

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// GET /api/admin/audit-logs
// Supports: pagination + filters (userId, action, entityType, dateFrom, dateTo)
router.get("/", authAdmin, async (req, res) => {
  try {
    const page = clamp(Number(req.query.page || 1), 1, 100000);
    const limit = clamp(Number(req.query.limit || 25), 1, 200);
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

    const userId = Number(req.query.userId);
    if (Number.isInteger(userId) && userId > 0) {
      where.push("al.user_id = ?");
      params.push(userId);
    }

    const action = String(req.query.action || "").trim();
    if (action) {
      where.push("al.action = ?");
      params.push(action);
    }

    const entityType = String(req.query.entityType || "").trim().toLowerCase();
    if (entityType) {
      where.push("al.entity_type = ?");
      params.push(entityType);
    }

    const dateFrom = String(req.query.dateFrom || "").trim();
    if (dateFrom) {
      where.push("al.created_at >= ?");
      params.push(dateFrom);
    }

    const dateTo = String(req.query.dateTo || "").trim();
    if (dateTo) {
      where.push("al.created_at <= ?");
      params.push(dateTo);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_logs al ${whereSql}`,
      params
    );
    const total = Number(countRows?.[0]?.total || 0);

    const [rows] = await pool.query(
      `
      SELECT
        al.id,
        al.user_id AS userId,
        al.user_role AS role,
        al.action,
        al.entity_type AS entityType,
        al.entity_id AS entityId,
        al.description,
        al.ip_address AS ipAddress,
        al.created_at AS createdAt,
        CASE
          WHEN al.user_role = 'teacher' THEN COALESCE(t.name, CONCAT('Teacher #', al.user_id))
          WHEN al.user_role = 'admin' THEN 'Admin'
          ELSE 'System'
        END AS user
      FROM audit_logs al
      LEFT JOIN teachers t
        ON al.user_role = 'teacher'
       AND t.id = al.user_id
      ${whereSql}
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    res.json({
      logs: rows || [],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error("Audit logs fetch error:", err);
    res.status(500).json({ message: "Failed to load audit logs" });
  }
});

export default router;

