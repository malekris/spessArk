export const VINE_READ_NOTIFICATION_RETENTION_DAYS = 30;

export const createCleanupExpiredReadNotifications = ({
  db,
  clearVineReadCache,
  readNotificationRetentionDays = VINE_READ_NOTIFICATION_RETENTION_DAYS,
  minIntervalMs = 6 * 60 * 60 * 1000,
}) => {
  let cleanupInFlight = false;
  let lastCleanupAt = 0;

  return async () => {
    const now = Date.now();
    if (cleanupInFlight) return;
    if (now - lastCleanupAt < minIntervalMs) return;

    cleanupInFlight = true;
    try {
      const [result] = await db.query(
        `
        DELETE FROM vine_notifications
        WHERE is_read = 1
          AND created_at < DATE_SUB(NOW(), INTERVAL ${readNotificationRetentionDays} DAY)
        `
      );
      lastCleanupAt = Date.now();
      if (Number(result?.affectedRows || 0)) {
        clearVineReadCache("notifications", "notifications-unread", "notifications-unseen");
      }
    } catch (err) {
      console.error("Notification cleanup error:", err?.message || err);
    } finally {
      cleanupInFlight = false;
    }
  };
};
