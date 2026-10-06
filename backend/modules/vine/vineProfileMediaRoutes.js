import express from "express";

export const normalizeProfileMediaType = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "avatar" || normalized === "banner" ? normalized : null;
};

export const normalizeProfileMediaComment = (value, limit = 1000) =>
  String(value || "").trim().slice(0, limit);

export default function createVineProfileMediaRouter({
  db,
  authenticate,
  authOptional,
  isUserBlocked,
  isModeratorAccount,
  notifyUser,
}) {
  const router = express.Router();
  let schemaReady = false;
  let schemaPromise = null;

  const ensureSchema = async () => {
    if (schemaReady) return;
    if (schemaPromise) return schemaPromise;
    schemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS vine_profile_media_comments (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        owner_user_id INT NOT NULL,
        media_type VARCHAR(16) NOT NULL,
        media_url VARCHAR(1000) NOT NULL,
        user_id INT NOT NULL,
        parent_comment_id BIGINT NULL,
        content VARCHAR(1000) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_vine_profile_media_thread (owner_user_id, media_type, media_url(180), created_at),
        INDEX idx_vine_profile_media_parent (parent_comment_id),
        INDEX idx_vine_profile_media_author (user_id, created_at)
      )
    `).then(() => {
      schemaReady = true;
    }).finally(() => {
      schemaPromise = null;
    });
    return schemaPromise;
  };

  const findProfileMedia = async (username, mediaType) => {
    const mediaColumn = mediaType === "banner" ? "banner_url" : "avatar_url";
    const [[user]] = await db.query(
      `SELECT id, username, display_name, avatar_url, is_private, ${mediaColumn} AS media_url
       FROM vine_users
       WHERE LOWER(username) = LOWER(?)
       LIMIT 1`,
      [String(username || "").trim()]
    );
    return user || null;
  };

  const canViewProfile = async (viewerId, owner) => {
    const safeViewerId = Number(viewerId || 0);
    if (!owner) return false;
    if (safeViewerId && (
      (await isUserBlocked(owner.id, safeViewerId)) ||
      (await isUserBlocked(safeViewerId, owner.id))
    )) return false;
    if (!Number(owner.is_private) || safeViewerId === Number(owner.id)) return true;
    if (!safeViewerId) return false;
    const [[follow]] = await db.query(
      "SELECT 1 FROM vine_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
      [safeViewerId, owner.id]
    );
    return Boolean(follow);
  };

  const selectComment = async (commentId, viewerId) => {
    const [[comment]] = await db.query(
      `SELECT
         c.id,
         c.owner_user_id,
         c.media_type,
         c.user_id,
         c.parent_comment_id,
         c.content,
         c.created_at,
         u.username,
         u.display_name,
         u.avatar_url,
         u.is_verified,
         u.badge_type,
         CASE WHEN c.user_id = ? THEN 1 ELSE 0 END AS is_mine
       FROM vine_profile_media_comments c
       JOIN vine_users u ON u.id = c.user_id
       WHERE c.id = ?
       LIMIT 1`,
      [Number(viewerId || 0), commentId]
    );
    return comment || null;
  };

  router.get("/users/:username/profile-media/:mediaType/comments", authOptional, async (req, res) => {
    try {
      const mediaType = normalizeProfileMediaType(req.params.mediaType);
      if (!mediaType) return res.status(400).json({ message: "Invalid profile media type" });
      await ensureSchema();
      const owner = await findProfileMedia(req.params.username, mediaType);
      if (!owner) return res.status(404).json({ message: "Profile not found" });
      if (!(await canViewProfile(req.user?.id, owner))) {
        return res.status(403).json({ message: "Profile media is unavailable" });
      }
      const mediaUrl = String(owner.media_url || "").trim();
      if (!mediaUrl) return res.json({ media_url: null, comments: [] });
      const [comments] = await db.query(
        `SELECT
           c.id,
           c.owner_user_id,
           c.media_type,
           c.user_id,
           c.parent_comment_id,
           c.content,
           c.created_at,
           u.username,
           u.display_name,
           u.avatar_url,
           u.is_verified,
           u.badge_type,
           CASE WHEN c.user_id = ? THEN 1 ELSE 0 END AS is_mine
         FROM vine_profile_media_comments c
         JOIN vine_users u ON u.id = c.user_id
         WHERE c.owner_user_id = ?
           AND c.media_type = ?
           AND c.media_url = ?
         ORDER BY c.created_at ASC, c.id ASC`,
        [Number(req.user?.id || 0), owner.id, mediaType, mediaUrl]
      );
      return res.json({
        media_url: mediaUrl,
        owner: {
          id: owner.id,
          username: owner.username,
          display_name: owner.display_name,
          avatar_url: owner.avatar_url,
        },
        comments,
      });
    } catch (error) {
      console.error("Load profile media comments failed:", error);
      return res.status(500).json({ message: "Failed to load comments" });
    }
  });

  router.post("/users/:username/profile-media/:mediaType/comments", authenticate, async (req, res) => {
    try {
      const mediaType = normalizeProfileMediaType(req.params.mediaType);
      const content = normalizeProfileMediaComment(req.body?.content);
      const parentCommentId = Number(req.body?.parent_comment_id || 0) || null;
      if (!mediaType) return res.status(400).json({ message: "Invalid profile media type" });
      if (!content) return res.status(400).json({ message: "Write a comment first" });
      await ensureSchema();
      const owner = await findProfileMedia(req.params.username, mediaType);
      if (!owner) return res.status(404).json({ message: "Profile not found" });
      if (!(await canViewProfile(req.user.id, owner))) {
        return res.status(403).json({ message: "Profile media is unavailable" });
      }
      const mediaUrl = String(owner.media_url || "").trim();
      if (!mediaUrl) return res.status(404).json({ message: "This profile photo is no longer available" });

      let parent = null;
      if (parentCommentId) {
        const [[parentRow]] = await db.query(
          `SELECT id, user_id
           FROM vine_profile_media_comments
           WHERE id = ? AND owner_user_id = ? AND media_type = ? AND media_url = ?
           LIMIT 1`,
          [parentCommentId, owner.id, mediaType, mediaUrl]
        );
        if (!parentRow) return res.status(400).json({ message: "Reply target is no longer available" });
        parent = parentRow;
      }

      const [inserted] = await db.query(
        `INSERT INTO vine_profile_media_comments
         (owner_user_id, media_type, media_url, user_id, parent_comment_id, content)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [owner.id, mediaType, mediaUrl, req.user.id, parentCommentId, content]
      );
      const comment = await selectComment(inserted.insertId, req.user.id);
      const notificationMeta = {
        profile_username: owner.username,
        media_type: mediaType,
        profile_media_comment_id: Number(inserted.insertId),
      };
      if (Number(owner.id) !== Number(req.user.id)) {
        await notifyUser({
          userId: owner.id,
          actorId: req.user.id,
          type: "profile_media_comment",
          meta: notificationMeta,
        });
      }
      if (
        parent &&
        Number(parent.user_id) !== Number(req.user.id) &&
        Number(parent.user_id) !== Number(owner.id)
      ) {
        await notifyUser({
          userId: parent.user_id,
          actorId: req.user.id,
          type: "profile_media_reply",
          meta: notificationMeta,
        });
      }
      return res.status(201).json({ comment });
    } catch (error) {
      console.error("Create profile media comment failed:", error);
      return res.status(500).json({ message: "Failed to post comment" });
    }
  });

  router.delete("/profile-media-comments/:commentId", authenticate, async (req, res) => {
    try {
      const commentId = Number(req.params.commentId || 0);
      if (!commentId) return res.status(400).json({ message: "Invalid comment" });
      await ensureSchema();
      const [[comment]] = await db.query(
        `SELECT id, user_id, owner_user_id, media_type, media_url
         FROM vine_profile_media_comments
         WHERE id = ?
         LIMIT 1`,
        [commentId]
      );
      if (!comment) return res.status(404).json({ message: "Comment not found" });
      const [[viewer]] = await db.query(
        "SELECT username, role, is_admin, badge_type FROM vine_users WHERE id = ? LIMIT 1",
        [req.user.id]
      );
      const canDelete =
        Number(comment.user_id) === Number(req.user.id) ||
        Number(comment.owner_user_id) === Number(req.user.id) ||
        isModeratorAccount(viewer);
      if (!canDelete) return res.status(403).json({ message: "Not allowed" });

      const [threadComments] = await db.query(
        `SELECT id, parent_comment_id
         FROM vine_profile_media_comments
         WHERE owner_user_id = ? AND media_type = ? AND media_url = ?`,
        [comment.owner_user_id, comment.media_type, comment.media_url]
      );
      const deleteIds = new Set([commentId]);
      let foundDescendant = true;
      while (foundDescendant) {
        foundDescendant = false;
        threadComments.forEach((row) => {
          const rowId = Number(row.id);
          const parentId = Number(row.parent_comment_id || 0);
          if (!deleteIds.has(rowId) && deleteIds.has(parentId)) {
            deleteIds.add(rowId);
            foundDescendant = true;
          }
        });
      }
      const ids = [...deleteIds];
      await db.query(
        `DELETE FROM vine_profile_media_comments WHERE id IN (${ids.map(() => "?").join(",")})`,
        ids
      );
      return res.json({ success: true });
    } catch (error) {
      console.error("Delete profile media comment failed:", error);
      return res.status(500).json({ message: "Failed to delete comment" });
    }
  });

  return router;
}
