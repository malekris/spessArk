import crypto from "node:crypto";

const VISIT_SURFACES = new Set(["home", "ark", "vine"]);
const schemaReadyByPool = new WeakMap();

export function normalizeVisitSurface(value) {
  const surface = String(value || "").trim().toLowerCase();
  return VISIT_SURFACES.has(surface) ? surface : null;
}

export function normalizeVisitorId(value) {
  const visitorId = String(value || "").trim();
  return visitorId.length >= 16 && visitorId.length <= 128 ? visitorId : null;
}

export function getKampalaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function ensureSiteVisitSchemaReady(pool) {
  if (!schemaReadyByPool.has(pool)) {
    const ready = pool.query(`
      CREATE TABLE IF NOT EXISTS site_daily_visitors (
        visit_date DATE NOT NULL,
        visitor_hash BINARY(32) NOT NULL,
        visited_home TINYINT(1) NOT NULL DEFAULT 0,
        visited_ark TINYINT(1) NOT NULL DEFAULT 0,
        visited_vine TINYINT(1) NOT NULL DEFAULT 0,
        first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (visit_date, visitor_hash)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).catch((error) => {
      schemaReadyByPool.delete(pool);
      throw error;
    });
    schemaReadyByPool.set(pool, ready);
  }

  return schemaReadyByPool.get(pool);
}

export async function readSiteVisitStats(pool, now = new Date()) {
  await ensureSiteVisitSchemaReady(pool);
  const today = getKampalaDate(now);
  const [[row = {}]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN visit_date = ? THEN 1 ELSE 0 END), 0) AS today,
       COALESCE(SUM(visited_home), 0) AS home_total,
       COALESCE(SUM(CASE WHEN visit_date = ? THEN visited_home ELSE 0 END), 0) AS home_today,
       COALESCE(SUM(visited_ark), 0) AS ark_total,
       COALESCE(SUM(CASE WHEN visit_date = ? THEN visited_ark ELSE 0 END), 0) AS ark_today,
       COALESCE(SUM(visited_vine), 0) AS vine_total,
       COALESCE(SUM(CASE WHEN visit_date = ? THEN visited_vine ELSE 0 END), 0) AS vine_today
     FROM site_daily_visitors`,
    [today, today, today, today]
  );

  return {
    total: Number(row.total) || 0,
    today: Number(row.today) || 0,
    surfaces: {
      home: { total: Number(row.home_total) || 0, today: Number(row.home_today) || 0 },
      ark: { total: Number(row.ark_total) || 0, today: Number(row.ark_today) || 0 },
      vine: { total: Number(row.vine_total) || 0, today: Number(row.vine_today) || 0 },
    },
    date: today,
  };
}

export async function recordSiteVisit(pool, { surface: surfaceValue, visitorId: visitorIdValue }, now = new Date()) {
  const surface = normalizeVisitSurface(surfaceValue);
  const visitorId = normalizeVisitorId(visitorIdValue);
  if (!surface || !visitorId) {
    const error = new Error("Invalid daily visitor record.");
    error.code = "INVALID_VISITOR_RECORD";
    throw error;
  }

  await ensureSiteVisitSchemaReady(pool);
  const flags = {
    home: surface === "home" ? 1 : 0,
    ark: surface === "ark" ? 1 : 0,
    vine: surface === "vine" ? 1 : 0,
  };
  const visitorHash = crypto.createHash("sha256").update(visitorId).digest("hex");

  // The date + anonymous hash key makes refreshes idempotent for the whole day.
  await pool.query(
    `INSERT INTO site_daily_visitors
       (visit_date, visitor_hash, visited_home, visited_ark, visited_vine)
     VALUES (?, UNHEX(?), ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       visited_home = GREATEST(visited_home, ?),
       visited_ark = GREATEST(visited_ark, ?),
       visited_vine = GREATEST(visited_vine, ?),
       last_seen_at = CURRENT_TIMESTAMP`,
    [
      getKampalaDate(now),
      visitorHash,
      flags.home,
      flags.ark,
      flags.vine,
      flags.home,
      flags.ark,
      flags.vine,
    ]
  );

  return readSiteVisitStats(pool, now);
}
