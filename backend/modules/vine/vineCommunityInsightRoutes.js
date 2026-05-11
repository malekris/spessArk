import express from "express";

export default function createVineCommunityInsightRouter({
  db,
  authenticate,
  ensureCommunitySchema,
  getCommunityRole,
  isCommunityMemberUser,
  isCommunityModOrOwner,
  summarizeLearnerBadges,
}) {
  const router = express.Router();

  router.get("/communities/:id/badges-streaks", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const viewerId = Number(req.user.id);
      const communityId = Number(req.params.id);
      if (!communityId) return res.status(400).json([]);
      const role = await getCommunityRole(communityId, viewerId);
      if (!role) return res.status(403).json([]);

      const [members] = await db.query(
        `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified
        FROM vine_community_members m
        JOIN vine_users u ON u.id = m.user_id
        WHERE m.community_id = ?
        ORDER BY u.username ASC
        `,
        [communityId]
      );

      const [rows] = await db.query(
        `
        SELECT
          s.user_id,
          s.assignment_id,
          s.submitted_at,
          s.score,
          a.points,
          a.due_at
        FROM vine_community_submissions s
        JOIN vine_community_assignments a ON a.id = s.assignment_id
        WHERE s.community_id = ?
        `,
        [communityId]
      );

      const byUser = new Map();
      for (const row of rows) {
        const key = Number(row.user_id);
        if (!byUser.has(key)) byUser.set(key, []);
        byUser.get(key).push(row);
      }

      const result = members.map((m) => {
        const submissions = byUser.get(Number(m.id)) || [];
        return {
          ...m,
          ...summarizeLearnerBadges(submissions),
        };
      });

      res.json(result);
    } catch (err) {
      console.error("Community badges/streaks error:", err);
      res.status(500).json([]);
    }
  });

  router.get("/communities/:id/reputation", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const viewerId = Number(req.user.id);
      const communityId = Number(req.params.id);
      if (!communityId) return res.status(400).json([]);
      if (!(await isCommunityMemberUser(communityId, viewerId))) return res.status(403).json([]);
      const [rows] = await db.query(
        `
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) AS posts_count,
          SUM(CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END) AS comments_count,
          SUM(CASE WHEN l.id IS NOT NULL THEN 1 ELSE 0 END) AS likes_received
        FROM vine_community_members m
        JOIN vine_users u ON u.id = m.user_id
        LEFT JOIN vine_posts p ON p.user_id = u.id AND p.community_id = ?
        LEFT JOIN vine_comments c ON c.user_id = u.id AND c.post_id IN (SELECT id FROM vine_posts WHERE community_id = ?)
        LEFT JOIN vine_likes l ON l.post_id = p.id
        WHERE m.community_id = ?
        GROUP BY u.id, u.username, u.display_name, u.avatar_url, u.is_verified
        ORDER BY (SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) * 3 + SUM(CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END) + SUM(CASE WHEN l.id IS NOT NULL THEN 1 ELSE 0 END)) DESC
        LIMIT 20
        `,
        [communityId, communityId, communityId]
      );
      res.json(rows);
    } catch (err) {
      console.error("Get community reputation error:", err);
      res.status(500).json([]);
    }
  });

  router.post("/communities/:id/reports", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const communityId = Number(req.params.id);
      const reporterId = req.user.id;
      const postId = req.body?.post_id ? Number(req.body.post_id) : null;
      const commentId = req.body?.comment_id ? Number(req.body.comment_id) : null;
      const reason = String(req.body?.reason || "").trim();
      if (!communityId || !reason || (!postId && !commentId)) {
        return res.status(400).json({ message: "Invalid report" });
      }
      await db.query(
        `
        INSERT INTO vine_community_reports (community_id, reporter_id, post_id, comment_id, reason, status)
        VALUES (?, ?, ?, ?, ?, 'open')
        `,
        [communityId, reporterId, postId, commentId, reason.slice(0, 280)]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Create community report error:", err);
      res.status(500).json({ message: "Failed to submit report" });
    }
  });

  router.get("/communities/:id/reports", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = req.user.id;
      const communityId = Number(req.params.id);
      const role = await getCommunityRole(communityId, userId);
      if (!isCommunityModOrOwner(role)) return res.status(403).json([]);
      const [rows] = await db.query(
        `
        SELECT
          r.id,
          r.post_id,
          r.comment_id,
          r.reason,
          r.status,
          r.created_at,
          u.username AS reporter_username,
          u.display_name AS reporter_display_name
        FROM vine_community_reports r
        JOIN vine_users u ON u.id = r.reporter_id
        WHERE r.community_id = ?
        ORDER BY r.created_at DESC
        LIMIT 150
        `,
        [communityId]
      );
      res.json(rows);
    } catch (err) {
      console.error("Get community reports error:", err);
      res.status(500).json([]);
    }
  });

  router.patch("/communities/:id/reports/:reportId", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = req.user.id;
      const communityId = Number(req.params.id);
      const reportId = Number(req.params.reportId);
      const status = String(req.body?.status || "").trim();
      if (!communityId || !reportId || !["open", "resolved", "dismissed"].includes(status)) {
        return res.status(400).json({ message: "Invalid request" });
      }
      const role = await getCommunityRole(communityId, userId);
      if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });
      await db.query(
        `
        UPDATE vine_community_reports
        SET status = ?, reviewed_at = NOW(), reviewed_by = ?
        WHERE id = ? AND community_id = ?
        `,
        [status, userId, reportId, communityId]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Update community report error:", err);
      res.status(500).json({ message: "Failed to update report" });
    }
  });

  return router;
}
