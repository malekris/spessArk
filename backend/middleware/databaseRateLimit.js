// MySQL-backed fixed-window limiter. Unlike an in-process map it is shared by
// all application instances using the same database.
const keys = (req, account) => [
  `ip:${req.socket?.remoteAddress || "unknown"}`,
  account ? `account:${String(account).trim().toLowerCase()}` : null,
].filter(Boolean);

export const createDatabaseRateLimit = (getDb, { namespace, windowSeconds = 900, max = 5, account = () => "" }) => {
  let ready;
  let lastCleanup = 0;
  const ensure = async () => {
    const db = getDb();
    if (!ready) ready = db.query(`CREATE TABLE IF NOT EXISTS security_rate_limits (
      namespace VARCHAR(80) NOT NULL, rate_key VARCHAR(320) NOT NULL,
      window_start BIGINT NOT NULL, attempts INT NOT NULL DEFAULT 0,
      PRIMARY KEY(namespace, rate_key)
    ) ENGINE=InnoDB`);
    return ready;
  };
  return async (req, res, next) => {
    try {
      const db = getDb();
      await ensure();
      const now = Math.floor(Date.now() / 1000);
      const windowStart = now - (now % windowSeconds);
      if (now - lastCleanup > windowSeconds) {
        lastCleanup = now;
        await db.query("DELETE FROM security_rate_limits WHERE window_start < ?", [now - windowSeconds * 2]);
      }
      for (const key of keys(req, account(req))) {
        await db.query(`INSERT INTO security_rate_limits(namespace, rate_key, window_start, attempts)
          VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE
          attempts = IF(window_start = VALUES(window_start), IF(attempts < ?, attempts + 1, attempts), 1),
          window_start = VALUES(window_start)`, [namespace, key, windowStart, max + 1]);
        const [[row]] = await db.query("SELECT attempts, window_start FROM security_rate_limits WHERE namespace = ? AND rate_key = ?", [namespace, key]);
        // Counts never exceed max. A request which sees the saturated bucket
        // is rejected; MySQL row locking makes the increment itself atomic.
        if (Number(row?.window_start) === windowStart && Number(row?.attempts || 0) > max) {
          res.set("Retry-After", String(windowSeconds - (now - windowStart)));
          return res.status(429).json({ message: "Too many attempts. Try again later." });
        }
      }
      next();
    } catch (error) {
      // Authentication endpoints must fail closed in production if the shared
      // limiter store is unavailable; local/test can opt in to availability.
      if (process.env.NODE_ENV === "production") return res.status(503).json({ message: "Authentication temporarily unavailable" });
      next();
    }
  };
};
