import express from "express";

export default function createVineCommunityDiscoveryRouter({
  db,
  authenticate,
  authOptional,
  ensureCommunitySchema,
  canAccessCommunityByVisibilityPolicy,
  isCommunityMemberUser,
  getCommunityRole,
}) {
  const router = express.Router();

  router.get("/communities", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = Number(req.user.id);
      const [rows] = await db.query(
        `
        SELECT
          c.id,
          c.name,
          c.slug,
          c.description,
          c.avatar_url,
          c.banner_url,
          c.banner_offset_y,
          c.join_policy,
          c.post_permission,
          c.auto_welcome_enabled,
          c.welcome_message,
          c.is_private,
          c.creator_id,
          c.created_at,
          (SELECT COUNT(DISTINCT m.user_id)
           FROM vine_community_members m
           JOIN vine_users u2 ON u2.id = m.user_id
           WHERE m.community_id = c.id) AS member_count,
          (SELECT COUNT(*) FROM vine_community_rules cr WHERE cr.community_id = c.id) AS rules_count,
          (SELECT COUNT(*) FROM vine_community_join_questions cq WHERE cq.community_id = c.id) AS join_questions_count,
          (SELECT COUNT(*) > 0 FROM vine_community_members m WHERE m.community_id = c.id AND m.user_id = ?) AS is_member,
          (SELECT role FROM vine_community_members m WHERE m.community_id = c.id AND m.user_id = ? LIMIT 1) AS viewer_role,
          (SELECT status FROM vine_community_join_requests r WHERE r.community_id = c.id AND r.user_id = ? LIMIT 1) AS join_request_status
        FROM vine_communities c
        ORDER BY member_count DESC, c.created_at DESC
        `,
        [userId, userId, userId]
      );
      res.json(rows);
    } catch (err) {
      console.error("Get communities error:", err);
      res.status(500).json([]);
    }
  });

  router.get("/communities/mine", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = req.user.id;
      const [rows] = await db.query(
        `
        SELECT c.id, c.name, c.slug, m.role
        FROM vine_communities c
        JOIN vine_community_members m ON m.community_id = c.id
        WHERE m.user_id = ?
        ORDER BY c.name ASC
        `,
        [userId]
      );
      res.json(rows);
    } catch (err) {
      console.error("Get my communities error:", err);
      res.status(500).json([]);
    }
  });

  router.get("/communities/:slug", authOptional, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const viewerId = Number(req.user?.id || 0);
      const [[community]] = await db.query(
        `
        SELECT
          c.id,
          c.name,
          c.slug,
          c.description,
          c.avatar_url,
          c.banner_url,
          c.banner_offset_y,
          c.join_policy,
          c.post_permission,
          c.auto_welcome_enabled,
          c.welcome_message,
          c.is_private,
          c.creator_id,
          c.created_at,
          (SELECT COUNT(DISTINCT m.user_id)
           FROM vine_community_members m
           JOIN vine_users u2 ON u2.id = m.user_id
           WHERE m.community_id = c.id) AS member_count,
          (SELECT COUNT(*) FROM vine_community_rules cr WHERE cr.community_id = c.id) AS rules_count,
          (SELECT COUNT(*) FROM vine_community_join_questions cq WHERE cq.community_id = c.id) AS join_questions_count,
          (SELECT COUNT(*) > 0 FROM vine_community_members m WHERE m.community_id = c.id AND m.user_id = ?) AS is_member,
          (SELECT role FROM vine_community_members m WHERE m.community_id = c.id AND m.user_id = ? LIMIT 1) AS viewer_role,
          (SELECT status FROM vine_community_join_requests r WHERE r.community_id = c.id AND r.user_id = ? LIMIT 1) AS join_request_status
        FROM vine_communities c
        WHERE c.slug = ?
        LIMIT 1
        `,
        [viewerId, viewerId, viewerId, req.params.slug]
      );
      if (!community) return res.status(404).json({ message: "Community not found" });
      if (viewerId) {
        const allowed = await canAccessCommunityByVisibilityPolicy(viewerId, community.id);
        if (!allowed) return res.status(403).json({ message: "Not allowed" });
      }
      res.json(community);
    } catch (err) {
      console.error("Get community error:", err);
      res.status(500).json({ message: "Failed to load community" });
    }
  });

  router.get("/communities/:slug/members", authOptional, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const viewerId = Number(req.user?.id || 0);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
      const [[community]] = await db.query(
        "SELECT id FROM vine_communities WHERE slug = ? LIMIT 1",
        [req.params.slug]
      );
      if (!community) return res.status(404).json([]);
      if (!viewerId) return res.status(403).json([]);
      if (!(await isCommunityMemberUser(community.id, viewerId))) return res.status(403).json([]);

      const [rows] = await db.query(
        `
        SELECT
          x.id,
          x.username,
          x.display_name,
          x.avatar_url,
          x.is_verified,
          CASE x.role_rank
            WHEN 0 THEN 'owner'
            WHEN 1 THEN 'moderator'
            ELSE 'member'
          END AS role,
          x.joined_at
        FROM (
          SELECT
            u.id,
            u.username,
            u.display_name,
            u.avatar_url,
            u.is_verified,
            MIN(
              CASE LOWER(m.role)
                WHEN 'owner' THEN 0
                WHEN 'moderator' THEN 1
                ELSE 2
              END
            ) AS role_rank,
            MIN(m.joined_at) AS joined_at
          FROM vine_community_members m
          JOIN vine_users u ON u.id = m.user_id
          WHERE m.community_id = ?
          GROUP BY u.id, u.username, u.display_name, u.avatar_url, u.is_verified
        ) x
        ORDER BY x.role_rank ASC, x.joined_at ASC
        LIMIT ?
        `,
        [community.id, limit]
      );
      res.json(rows);
    } catch (err) {
      console.error("Get community members error:", err);
      res.status(500).json([]);
    }
  });

  router.get("/communities/:id/invite-suggestions", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const viewerId = Number(req.user.id || 0);
      const communityId = Number(req.params.id);
      const limit = Math.min(24, Math.max(1, Number(req.query.limit || 12)));
      if (!communityId || !viewerId) return res.status(400).json([]);

      const role = await getCommunityRole(communityId, viewerId);
      if (!role) {
        return res.status(403).json([]);
      }

      const [rows] = await db.query(
        `
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.bio,
          EXISTS(
            SELECT 1
            FROM vine_follows f
            WHERE f.follower_id = ? AND f.following_id = u.id
          ) AS viewer_is_following,
          EXISTS(
            SELECT 1
            FROM vine_follows f
            WHERE f.follower_id = u.id AND f.following_id = ?
          ) AS follows_viewer,
          (
            SELECT COUNT(*)
            FROM vine_follows a
            JOIN vine_follows b
              ON a.follower_id = b.follower_id
            WHERE a.following_id = ?
              AND b.following_id = u.id
          ) AS mutual_follower_count
        FROM vine_users u
        WHERE u.id <> ?
          AND LOWER(COALESCE(u.username, '')) NOT IN ('vine guardian', 'vine_guardian', 'vine news', 'vine_news')
          AND NOT EXISTS (
            SELECT 1
            FROM vine_community_members cm
            WHERE cm.community_id = ? AND cm.user_id = u.id
          )
          AND (
            EXISTS (
              SELECT 1
              FROM vine_follows vf
              WHERE vf.follower_id = ? AND vf.following_id = u.id
            )
            OR EXISTS (
              SELECT 1
              FROM vine_follows vr
              WHERE vr.follower_id = u.id AND vr.following_id = ?
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM vine_blocks b
            WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
               OR (b.blocker_id = ? AND b.blocked_id = u.id)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM vine_mutes m
            WHERE m.muter_id = ? AND m.muted_id = u.id
          )
        ORDER BY
          mutual_follower_count DESC,
          follows_viewer DESC,
          viewer_is_following DESC,
          COALESCE(u.display_name, u.username) ASC,
          u.username ASC
        LIMIT ?
        `,
        [
          viewerId,
          viewerId,
          viewerId,
          viewerId,
          communityId,
          viewerId,
          viewerId,
          viewerId,
          viewerId,
          viewerId,
          limit,
        ]
      );

      res.json(
        Array.isArray(rows)
          ? rows.map((row) => ({
              ...row,
              id: Number(row.id || 0),
              is_verified: Number(row.is_verified || 0),
              viewer_is_following: Number(row.viewer_is_following || 0),
              follows_viewer: Number(row.follows_viewer || 0),
              mutual_follower_count: Number(row.mutual_follower_count || 0),
            }))
          : []
      );
    } catch (err) {
      console.error("Get community invite suggestions error:", err);
      res.status(500).json([]);
    }
  });

  return router;
}
