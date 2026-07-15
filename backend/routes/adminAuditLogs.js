import express from "express";
import authAdmin from "../middleware/authAdmin.js";
import { pool } from "../server.js";
import { extractClientIp, logAuditEvent } from "../utils/auditLogger.js";

const router = express.Router();

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const REPORT_GENERATION_ACTIONS = {
  ALEVEL_MID: {
    action: "GENERATE_ALEVEL_MID_REPORTS",
    label: "Generated A-Level MID parent reports",
  },
  ALEVEL_END_OF_TERM: {
    action: "GENERATE_ALEVEL_END_OF_TERM_REPORTS",
    label: "Generated A-Level end-of-term reports",
  },
  OLEVEL_MINI: {
    action: "GENERATE_OLEVEL_MINI_REPORTS",
    label: "Generated O-Level AOI 1 mini reports",
  },
  OLEVEL_END_OF_TERM: {
    action: "GENERATE_OLEVEL_END_OF_TERM_REPORTS",
    label: "Generated O-Level end-of-term reports",
  },
  OLEVEL_END_OF_YEAR: {
    action: "GENERATE_OLEVEL_END_OF_YEAR_REPORTS",
    label: "Generated O-Level end-of-year reports",
  },
};

const cleanLabel = (value, fallback = "—", maxLength = 120) => {
  const normalized = String(value || "").trim();
  return (normalized || fallback).slice(0, maxLength);
};

router.post("/report-generation", authAdmin, async (req, res) => {
  try {
    const reportKind = String(req.body?.reportKind || "").trim().toUpperCase();
    const reportConfig = REPORT_GENERATION_ACTIONS[reportKind];

    if (!reportConfig) {
      return res.status(400).json({ message: "Unsupported report generation type" });
    }

    const classLevel = cleanLabel(req.body?.classLevel, "A-Level");
    const stream = cleanLabel(req.body?.stream);
    const term = cleanLabel(req.body?.term);
    const year = cleanLabel(req.body?.year);
    const requestedLearnerCount = Number(req.body?.learnerCount || 0);
    const learnerCount = Number.isFinite(requestedLearnerCount)
      ? clamp(Math.trunc(requestedLearnerCount), 0, 100000)
      : 0;
    const studentId = Number(req.body?.studentId);
    const selection = `${classLevel} ${stream}`.trim();
    const scope = `${term} ${year}`.trim();
    const logged = await logAuditEvent({
      userId: Number(req.admin?.id) || 1,
      userRole: "admin",
      action: reportConfig.action,
      entityType: "system",
      entityId: Number.isInteger(studentId) && studentId > 0 ? studentId : null,
      description: `${reportConfig.label} for ${selection} (${scope}); learner reports: ${learnerCount}`,
      ipAddress: extractClientIp(req),
    });

    if (!logged) {
      return res.status(500).json({ message: "Report was generated, but its audit event could not be recorded" });
    }

    return res.status(201).json({ success: true, action: reportConfig.action });
  } catch (err) {
    console.error("Report generation audit error:", err);
    return res.status(500).json({ message: "Failed to record report generation" });
  }
});

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
        CASE
          WHEN al.action LIKE 'BOARDING\_%' THEN 'boarding_admin'
          ELSE al.user_role
        END AS role,
        al.action,
        al.entity_type AS entityType,
        al.entity_id AS entityId,
        al.description,
        al.ip_address AS ipAddress,
        al.created_at AS createdAt,
        CASE
          WHEN al.action LIKE 'BOARDING\_%' THEN 'Boarding Admin'
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

    const [[actionRows], [entityTypeRows]] = await Promise.all([
      pool.query(
        `SELECT DISTINCT action
         FROM audit_logs
         WHERE action IS NOT NULL AND TRIM(action) <> ''
         ORDER BY action ASC`
      ),
      pool.query(
        `SELECT DISTINCT entity_type AS entityType
         FROM audit_logs
         WHERE entity_type IS NOT NULL AND TRIM(entity_type) <> ''
         ORDER BY entity_type ASC`
      ),
    ]);

    res.json({
      logs: rows || [],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      actions: (actionRows || []).map((row) => row.action).filter(Boolean),
      entityTypes: (entityTypeRows || []).map((row) => row.entityType).filter(Boolean),
    });
  } catch (err) {
    console.error("Audit logs fetch error:", err);
    res.status(500).json({ message: "Failed to load audit logs" });
  }
});

export default router;
