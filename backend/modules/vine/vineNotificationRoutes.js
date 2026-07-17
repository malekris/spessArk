import express from "express";

export const markOneVineNotificationRead = async ({ db, notificationId, viewerId }) => {
  const id = Number(notificationId);
  const userId = Number(viewerId);
  if (!id || !userId) return { valid: false, id, viewerId: userId, changed: false };

  const [result] = await db.query(
    `
    UPDATE vine_notifications
    SET is_read = 1
    WHERE id = ?
      AND user_id = ?
      AND is_read = 0
    `,
    [id, userId]
  );

  return {
    valid: true,
    id,
    viewerId: userId,
    changed: Number(result?.affectedRows || 0) > 0,
  };
};

export default function createVineNotificationRouter({
  db,
  authenticate,
  cleanupExpiredReadNotifications,
  ensureVinePerformanceSchema,
  getDbName,
  hasColumn,
  io,
  runVinePerfRoute,
  timedVineQuery,
  clearVineReadCache,
  readNotificationRetentionDays,
}) {
  const router = express.Router();

  router.get("/notifications", authenticate, async (req, res) => {
    try {
      void cleanupExpiredReadNotifications();
      const viewerId = Number(req.user.id);
      const rows = await runVinePerfRoute(
        "notifications",
        { viewer_id: viewerId },
        async (perfCtx) => {
          await ensureVinePerformanceSchema();
          const dbName = await getDbName();
          const includeMeta = dbName
            ? await hasColumn(dbName, "vine_notifications", "meta_json")
            : false;
          const [notificationRows] = await timedVineQuery(
            perfCtx,
            "notifications.rows",
            `
            SELECT 
              n.id,
              n.actor_id,
              n.type,
              n.post_id,
              n.comment_id,
              n.is_read,
              n.created_at,
              ${includeMeta ? "n.meta_json," : "NULL AS meta_json,"}
              u.username,
              u.display_name,
              u.avatar_url,
              u.is_verified
            FROM vine_notifications n
            LEFT JOIN vine_users u ON n.actor_id = u.id
            WHERE n.user_id = ?
              AND n.type <> 'birthday'
              AND (n.is_read = 0 OR n.created_at >= DATE_SUB(NOW(), INTERVAL ${readNotificationRetentionDays} DAY))
              AND NOT EXISTS (
                SELECT 1 FROM vine_mutes m
                WHERE m.muter_id = n.user_id AND m.muted_id = n.actor_id
              )
            ORDER BY n.created_at DESC
          `,
            [viewerId]
          );
          return notificationRows;
        }
      );

      res.set("Cache-Control", "no-store");
      res.json(rows);
    } catch (err) {
      console.error("Get notifications error:", err);
      res.status(500).json([]);
    }
  });

  router.get("/notifications/unread-count", authenticate, async (req, res) => {
    void cleanupExpiredReadNotifications();
    await ensureVinePerformanceSchema();
    const viewerId = Number(req.user.id);
    const [[row]] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM vine_notifications n
      WHERE n.user_id = ?
        AND n.type <> 'birthday'
        AND n.is_read = 0
        AND NOT EXISTS (
          SELECT 1
          FROM vine_mutes m
          WHERE m.muter_id = n.user_id AND m.muted_id = n.actor_id
        )
      `,
      [viewerId]
    );

    res.set("Cache-Control", "no-store");
    res.json({ count: Number(row?.total || 0) });
  });

  router.get("/notifications/unseen-count", authenticate, async (req, res) => {
    void cleanupExpiredReadNotifications();
    await ensureVinePerformanceSchema();
    const sinceRaw = String(req.query.since || "").trim();
    const since = new Date(sinceRaw);
    if (!sinceRaw || Number.isNaN(since.getTime())) {
      return res.json({ count: 0 });
    }

    const viewerId = Number(req.user.id);
    const [[row]] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM vine_notifications n
      WHERE n.user_id = ?
        AND n.type <> 'birthday'
        AND n.created_at > ?
        AND NOT EXISTS (
          SELECT 1
          FROM vine_mutes m
          WHERE m.muter_id = n.user_id AND m.muted_id = n.actor_id
        )
      `,
      [viewerId, since]
    );

    res.set("Cache-Control", "no-store");
    res.json({ count: Number(row?.total || 0) });
  });

  router.post("/notifications/:id/read", authenticate, async (req, res) => {
    const readResult = await markOneVineNotificationRead({
      db,
      notificationId: req.params.id,
      viewerId: req.user.id,
    });
    if (!readResult.valid) {
      return res.status(400).json({ message: "Invalid notification" });
    }

    const { id: notificationId, viewerId, changed } = readResult;
    if (changed) {
      clearVineReadCache("notifications", "notifications-unread", "notifications-unseen");
      io?.to(`user-${viewerId}`).emit("notification_read", {
        id: notificationId,
      });
      io?.to(`user-${viewerId}`).emit("notification");
      void cleanupExpiredReadNotifications();
    }
    return res.json({ success: true, id: notificationId, is_read: 1, changed });
  });

  return router;
}
