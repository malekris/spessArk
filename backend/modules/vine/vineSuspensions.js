const ACTIVE_SUSPENSION_SCOPES = ["likes_comments", "likes_comments_messages", "all"];

const isMissingSuspensionTable = (error) =>
  ["ER_NO_SUCH_TABLE", "ER_BAD_TABLE_ERROR"].includes(String(error?.code || ""));

export const getActiveVineSuspension = async (db, userId) => {
  const numericUserId = Number(userId);
  if (!numericUserId) return null;

  try {
    const [rows] = await db.query(
      `
      SELECT
        id,
        reason,
        scope,
        starts_at,
        ends_at,
        CASE
          WHEN ends_at IS NULL THEN NULL
          ELSE GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), ends_at))
        END AS remaining_seconds
      FROM vine_user_suspensions
      WHERE user_id = ?
        AND is_active = 1
        AND scope IN (?)
        AND starts_at <= NOW()
        AND (ends_at IS NULL OR ends_at > NOW())
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [numericUserId, ACTIVE_SUSPENSION_SCOPES]
    );
    return rows[0] || null;
  } catch (error) {
    if (isMissingSuspensionTable(error)) return null;
    throw error;
  }
};

export const buildSuspensionResponse = (suspension) => ({
  message: "Your Vine feed and statuses are temporarily paused, including posting, revines, likes, comments, and messaging.",
  error: "Your Vine feed and statuses are temporarily paused, including posting, revines, likes, comments, and messaging.",
  code: "VINE_ACCOUNT_SUSPENDED",
  suspension,
});
