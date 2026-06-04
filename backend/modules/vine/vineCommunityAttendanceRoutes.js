import express from "express";

export default function createVineCommunityAttendanceRouter({
  db,
  authenticate,
  ensureCommunitySchema,
  ensureVinePerformanceSchema,
  getCommunityRole,
  isCommunityModOrOwner,
  buildVineCacheKey,
  readThroughVineCache,
  vineCacheTtls,
  clearVineReadCache,
}) {
  const router = express.Router();
  const parseAttendanceSessionDate = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const parsed = new Date(hasTimezone ? raw : `${raw}+03:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  router.post("/communities/:id/sessions", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      const title = String(req.body?.title || "").trim();
      const startsAtRaw = String(req.body?.starts_at || "").trim();
      const endsAtRaw = String(req.body?.ends_at || "").trim();
      const notes = String(req.body?.notes || "").trim();
      if (!communityId || !title || !startsAtRaw) {
        return res.status(400).json({ message: "title and starts_at required" });
      }
      const role = await getCommunityRole(communityId, userId);
      if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });
      const startsAt = parseAttendanceSessionDate(startsAtRaw);
      const endsAt = endsAtRaw ? parseAttendanceSessionDate(endsAtRaw) : null;
      if (!startsAt || (endsAtRaw && !endsAt)) {
        return res.status(400).json({ message: "Invalid date" });
      }
      await db.query(
        `
        INSERT INTO vine_community_sessions (community_id, title, starts_at, ends_at, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [communityId, title.slice(0, 180), startsAt, endsAt || null, notes || null, userId]
      );
      clearVineReadCache("community-sessions", "community-attendance", "community-progress");
      res.json({ success: true });
    } catch (err) {
      console.error("Create community session error:", err);
      res.status(500).json({ message: "Failed to create session" });
    }
  });

  router.get("/communities/:id/sessions", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await ensureVinePerformanceSchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      if (!communityId) return res.status(400).json([]);
      const role = await getCommunityRole(communityId, userId);
      if (!role) return res.status(403).json([]);
      const cacheKey = buildVineCacheKey("community-sessions", communityId, userId);
      const rows = await readThroughVineCache(cacheKey, vineCacheTtls.communityAttendance, async () => {
        const [sessionRows] = await db.query(
          `
          SELECT
            s.id,
            s.community_id,
            s.title,
            s.starts_at,
            s.ends_at,
            s.notes,
            s.created_by,
            s.created_at,
            u.username AS created_by_username,
            u.display_name AS created_by_display_name,
            (SELECT COUNT(*) FROM vine_community_attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present_count,
            (SELECT COUNT(*) FROM vine_community_attendance a WHERE a.session_id = s.id AND a.status = 'absent') AS absent_count,
            (SELECT COUNT(*) FROM vine_community_attendance a WHERE a.session_id = s.id AND a.status = 'late') AS late_count,
            (SELECT COUNT(*) FROM vine_community_attendance a WHERE a.session_id = s.id AND a.status = 'excused') AS excused_count
          FROM vine_community_sessions s
          JOIN vine_users u ON u.id = s.created_by
          WHERE s.community_id = ?
          ORDER BY s.starts_at DESC
          LIMIT 300
          `,
          [communityId]
        );
        return sessionRows;
      });
      res.json(rows);
    } catch (err) {
      console.error("Get community sessions error:", err);
      res.status(500).json([]);
    }
  });

  router.get("/communities/:id/sessions/:sessionId/attendance", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await ensureVinePerformanceSchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      const sessionId = Number(req.params.sessionId);
      if (!communityId || !sessionId) return res.status(400).json([]);
      const role = await getCommunityRole(communityId, userId);
      if (!role) return res.status(403).json([]);

      const cacheKey = buildVineCacheKey("community-attendance-session", communityId, sessionId, userId);
      const members = await readThroughVineCache(cacheKey, vineCacheTtls.communityAttendance, async () => {
        const [rows] = await db.query(
          `
          SELECT
            u.id AS user_id,
            u.username,
            u.display_name,
            u.avatar_url,
            u.is_verified,
            m.role AS community_role,
            a.status,
            a.marked_at,
            a.marked_by
          FROM vine_community_members m
          JOIN vine_users u ON u.id = m.user_id
          LEFT JOIN vine_community_attendance a
            ON a.user_id = u.id
           AND a.session_id = ?
           AND a.community_id = ?
          WHERE m.community_id = ?
          ORDER BY
            CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
            u.username ASC
          `,
          [sessionId, communityId, communityId]
        );
        return rows;
      });
      res.json(members);
    } catch (err) {
      console.error("Get attendance error:", err);
      res.status(500).json([]);
    }
  });

  router.post("/communities/:id/sessions/:sessionId/attendance/bulk", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      const sessionId = Number(req.params.sessionId);
      if (!communityId || !sessionId) return res.status(400).json({ message: "Invalid request" });
      const role = await getCommunityRole(communityId, userId);
      if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });

      const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
      if (!entries.length) return res.status(400).json({ message: "No entries provided" });
      const allowedStatuses = new Set(["present", "absent", "late", "excused"]);

      const [[session]] = await db.query(
        "SELECT id, starts_at, ends_at FROM vine_community_sessions WHERE id = ? AND community_id = ? LIMIT 1",
        [sessionId, communityId]
      );
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.ends_at) {
        const endsAt = new Date(session.ends_at);
        if (!Number.isNaN(endsAt.getTime()) && endsAt.getTime() <= Date.now()) {
          return res.status(409).json({ message: "Session has ended and attendance is now locked" });
        }
      }

      for (const entry of entries) {
        const targetUserId = Number(entry?.user_id);
        const status = String(entry?.status || "").toLowerCase();
        if (!targetUserId || !allowedStatuses.has(status)) continue;
        await db.query(
          `
          INSERT INTO vine_community_attendance (session_id, community_id, user_id, status, marked_by, marked_at)
          VALUES (?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by), marked_at = NOW()
          `,
          [sessionId, communityId, targetUserId, status, userId]
        );
      }

      clearVineReadCache("community-sessions", "community-attendance", "community-progress");
      res.json({ success: true });
    } catch (err) {
      console.error("Save attendance error:", err);
      res.status(500).json({ message: "Failed to save attendance" });
    }
  });

  router.get("/communities/:id/attendance/summary", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await ensureVinePerformanceSchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      if (!communityId) return res.status(400).json({ lessons_attended: 0 });
      const role = await getCommunityRole(communityId, userId);
      if (!role) return res.status(403).json({ lessons_attended: 0 });

      const cacheKey = buildVineCacheKey("community-attendance-summary", communityId, userId);
      const row = await readThroughVineCache(cacheKey, vineCacheTtls.communityAttendance, async () => {
        const [[summaryRow]] = await db.query(
          `
          SELECT
            (SELECT COUNT(*)
             FROM vine_community_attendance a
             WHERE a.community_id = ?
               AND a.user_id = ?
               AND a.status IN ('present', 'late')) AS lessons_attended
          `,
          [communityId, userId]
        );
        return summaryRow;
      });
      res.json({ lessons_attended: Number(row?.lessons_attended || 0) });
    } catch (err) {
      console.error("Get attendance summary error:", err);
      res.status(500).json({ lessons_attended: 0 });
    }
  });

  router.get("/communities/:id/attendance/my-records", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await ensureVinePerformanceSchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      if (!communityId) return res.status(400).json({ lessons_attended: 0, lessons_missed: 0, rows: [] });
      const role = await getCommunityRole(communityId, userId);
      if (!role) return res.status(403).json({ lessons_attended: 0, lessons_missed: 0, rows: [] });

      const cacheKey = buildVineCacheKey("community-attendance-records", communityId, userId);
      const payload = await readThroughVineCache(cacheKey, vineCacheTtls.communityAttendance, async () => {
        const [rows] = await db.query(
          `
          SELECT
            s.id AS session_id,
            s.title,
            s.starts_at,
            COALESCE(a.status, 'absent') AS status
          FROM vine_community_sessions s
          LEFT JOIN vine_community_attendance a
            ON a.session_id = s.id
           AND a.community_id = s.community_id
           AND a.user_id = ?
          WHERE s.community_id = ?
            AND (
              s.starts_at <= NOW()
              OR a.status IS NOT NULL
            )
          ORDER BY s.starts_at DESC
          LIMIT 500
          `,
          [userId, communityId]
        );

        let attended = 0;
        let missed = 0;
        for (const row of rows) {
          const st = String(row.status || "").toLowerCase();
          if (st === "present" || st === "late") attended += 1;
          else if (st === "absent") missed += 1;
        }

        return {
          lessons_attended: attended,
          lessons_missed: missed,
          rows,
        };
      });

      res.json(payload);
    } catch (err) {
      console.error("Get attendance records error:", err);
      res.status(500).json({ lessons_attended: 0, lessons_missed: 0, rows: [] });
    }
  });

  return router;
}
