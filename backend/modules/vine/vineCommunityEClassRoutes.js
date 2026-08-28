import express from "express";

const mapEClassSession = (row) => row
  ? {
      id: Number(row.id),
      community_id: Number(row.community_id),
      host_user_id: Number(row.host_user_id),
      title: row.title,
      status: row.status,
      started_at: row.started_at,
      ended_at: row.ended_at || null,
      host_username: row.host_username || "",
      host_display_name: row.host_display_name || row.host_username || "",
      host_avatar_url: row.host_avatar_url || null,
      host_is_verified: Number(row.host_is_verified || 0),
      participant_count: Number(row.participant_count || 0),
      message_count: Number(row.message_count || 0),
    }
  : null;

export default function createVineCommunityEClassRouter({
  db,
  authenticate,
  ensureCommunitySchema,
  getCommunityRole,
  isCommunityModOrOwner,
  notifyUsersBulk,
  io,
  endEClassRuntimeSession,
}) {
  const router = express.Router();

  const getSession = async (sessionId, communityId = null) => {
    const params = [Number(sessionId)];
    const communityClause = communityId ? "AND s.community_id = ?" : "";
    if (communityId) params.push(Number(communityId));
    const [[row]] = await db.query(
      `
      SELECT
        s.*,
        u.username AS host_username,
        u.display_name AS host_display_name,
        u.avatar_url AS host_avatar_url,
        u.is_verified AS host_is_verified,
        (SELECT COUNT(*) FROM vine_eclass_participants p WHERE p.session_id = s.id) AS participant_count,
        (SELECT COUNT(*) FROM vine_eclass_messages m WHERE m.session_id = s.id) AS message_count
      FROM vine_eclass_sessions s
      JOIN vine_users u ON u.id = s.host_user_id
      WHERE s.id = ? ${communityClause}
      LIMIT 1
      `,
      params
    );
    return mapEClassSession(row);
  };

  router.get("/communities/:id/eclass/live", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const communityId = Number(req.params.id);
      const userId = Number(req.user.id);
      if (!communityId) return res.status(400).json({ message: "Invalid community" });
      const role = await getCommunityRole(communityId, userId);
      if (!role) return res.status(403).json({ message: "Community membership required" });

      const [[liveRow]] = await db.query(
        `
        SELECT id
        FROM vine_eclass_sessions
        WHERE community_id = ? AND status = 'live' AND active_slot = 1
        ORDER BY id DESC
        LIMIT 1
        `,
        [communityId]
      );
      if (!liveRow?.id) return res.json({ session: null, messages: [] });

      const session = await getSession(liveRow.id, communityId);
      const [messages] = await db.query(
        `
        SELECT * FROM (
          SELECT
            m.id,
            m.session_id,
            m.user_id,
            m.content,
            m.created_at,
            u.username,
            u.display_name,
            u.avatar_url,
            u.is_verified
          FROM vine_eclass_messages m
          JOIN vine_users u ON u.id = m.user_id
          WHERE m.session_id = ? AND m.community_id = ?
          ORDER BY m.id DESC
          LIMIT 150
        ) recent
        ORDER BY recent.id ASC
        `,
        [liveRow.id, communityId]
      );
      return res.json({ session, messages });
    } catch (err) {
      console.error("Get live Vine eClass error:", err);
      return res.status(500).json({ message: "Failed to load Vine eClass" });
    }
  });

  router.get("/communities/:id/eclass/history", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const communityId = Number(req.params.id);
      const userId = Number(req.user.id);
      if (!communityId) return res.status(400).json([]);
      const role = await getCommunityRole(communityId, userId);
      if (!role) return res.status(403).json([]);
      const [rows] = await db.query(
        `
        SELECT
          s.*,
          u.username AS host_username,
          u.display_name AS host_display_name,
          u.avatar_url AS host_avatar_url,
          u.is_verified AS host_is_verified,
          (SELECT COUNT(*) FROM vine_eclass_participants p WHERE p.session_id = s.id) AS participant_count,
          (SELECT COUNT(*) FROM vine_eclass_messages m WHERE m.session_id = s.id) AS message_count
        FROM vine_eclass_sessions s
        JOIN vine_users u ON u.id = s.host_user_id
        WHERE s.community_id = ? AND s.status = 'ended'
        ORDER BY s.started_at DESC, s.id DESC
        LIMIT 20
        `,
        [communityId]
      );
      return res.json(rows.map(mapEClassSession));
    } catch (err) {
      console.error("Get Vine eClass history error:", err);
      return res.status(500).json([]);
    }
  });

  router.post("/communities/:id/eclass/sessions", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const communityId = Number(req.params.id);
      const userId = Number(req.user.id);
      const requestedTitle = String(req.body?.title || "").trim();
      if (!communityId) return res.status(400).json({ message: "Invalid community" });
      const role = await getCommunityRole(communityId, userId);
      if (!isCommunityModOrOwner(role)) {
        return res.status(403).json({ message: "Only community moderators can start Vine eClass" });
      }
      const [[community]] = await db.query(
        "SELECT id, name, slug FROM vine_communities WHERE id = ? LIMIT 1",
        [communityId]
      );
      if (!community) return res.status(404).json({ message: "Community not found" });
      const [[existing]] = await db.query(
        "SELECT id FROM vine_eclass_sessions WHERE community_id = ? AND status = 'live' AND active_slot = 1 LIMIT 1",
        [communityId]
      );
      if (existing?.id) {
        return res.status(409).json({
          message: "A Vine eClass is already live in this community",
          session: await getSession(existing.id, communityId),
        });
      }

      const title = (requestedTitle || `${community.name} eClass`).slice(0, 180);
      let inserted;
      try {
        [inserted] = await db.query(
          `
          INSERT INTO vine_eclass_sessions
            (community_id, host_user_id, title, status, active_slot, started_at)
          VALUES (?, ?, ?, 'live', 1, NOW())
          `,
          [communityId, userId, title]
        );
      } catch (err) {
        if (err?.code === "ER_DUP_ENTRY") {
          const [[active]] = await db.query(
            "SELECT id FROM vine_eclass_sessions WHERE community_id = ? AND status = 'live' AND active_slot = 1 LIMIT 1",
            [communityId]
          );
          return res.status(409).json({
            message: "A Vine eClass is already live in this community",
            session: active?.id ? await getSession(active.id, communityId) : null,
          });
        }
        throw err;
      }

      const session = await getSession(inserted.insertId, communityId);
      const [memberRows] = await db.query(
        "SELECT user_id FROM vine_community_members WHERE community_id = ? AND user_id != ?",
        [communityId, userId]
      );
      const memberIds = memberRows.map((row) => Number(row.user_id)).filter(Boolean);
      const meta = {
        community_id: communityId,
        community_slug: community.slug,
        community_name: community.name,
        session_id: session.id,
        title: session.title,
        target_path: `/vine/communities/${community.slug}?tab=eclass`,
      };
      await notifyUsersBulk({
        userIds: memberIds,
        actorId: userId,
        type: "community_eclass_started",
        meta,
      });
      for (const memberId of memberIds) {
        io.to(`user-${memberId}`).emit("eclass_started", { session, ...meta });
      }
      return res.status(201).json({ session });
    } catch (err) {
      console.error("Start Vine eClass error:", err);
      return res.status(500).json({ message: "Failed to start Vine eClass" });
    }
  });

  router.post("/communities/:id/eclass/sessions/:sessionId/end", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const communityId = Number(req.params.id);
      const sessionId = Number(req.params.sessionId);
      const userId = Number(req.user.id);
      if (!communityId || !sessionId) return res.status(400).json({ message: "Invalid session" });
      const role = await getCommunityRole(communityId, userId);
      if (!isCommunityModOrOwner(role)) {
        return res.status(403).json({ message: "Only community moderators can end Vine eClass" });
      }
      const [result] = await db.query(
        `
        UPDATE vine_eclass_sessions
        SET status = 'ended', active_slot = NULL, ended_at = NOW(), ended_by = ?
        WHERE id = ? AND community_id = ? AND status = 'live'
        `,
        [userId, sessionId, communityId]
      );
      if (!result.affectedRows) return res.status(404).json({ message: "Live class not found" });
      await db.query(
        "UPDATE vine_eclass_participants SET left_at = COALESCE(left_at, NOW()), hand_raised = 0 WHERE session_id = ?",
        [sessionId]
      );
      await endEClassRuntimeSession({ io, sessionId, communityId, endedBy: userId });
      return res.json({ success: true, session: await getSession(sessionId, communityId) });
    } catch (err) {
      console.error("End Vine eClass error:", err);
      return res.status(500).json({ message: "Failed to end Vine eClass" });
    }
  });

  return router;
}
