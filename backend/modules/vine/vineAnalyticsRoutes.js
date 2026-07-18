import express from "express";

export default function createVineAnalyticsRouter({
  db,
  authenticate,
  isModeratorAccount,
  ensureLifecycleAnalyticsSchema,
  ensureVinePostSourceSchema,
  getDbName,
  hasTable,
  hasColumn,
  analyticsDaySql,
  analyticsTodaySql,
  analyticsSessionDurationSql,
  buildAnalyticsUnionSql,
  ANALYTICS_ACTIVITY_SOURCES,
  ANALYTICS_ENGAGEMENT_SOURCES,
  VINE_ANALYTICS_TIMEZONE,
  calculatePct,
  getGuardianAnalyticsRange,
  buildGuardianActivitySnapshot,
  runVinePerfRoute,
  getGuardianPerfSnapshot,
  vinePerfLogsEnabled,
  vinePerfConsoleLogsEnabled,
  vineSlowRouteMs,
  vineSlowQueryMs,
}) {
  const router = express.Router();

// Guardian-only analytics overview
const fetchGuardianRetentionStats = async () => {
  await ensureLifecycleAnalyticsSchema();
  const now = new Date();
  const retentionWindowStart = new Date(now.getTime() - 15 * 86400000);
  const activityUnion = buildAnalyticsUnionSql(ANALYTICS_ACTIVITY_SOURCES, {
    rangeStart: retentionWindowStart,
    rangeEnd: now,
    selectBuilder: (source) =>
      `${source.userCol} AS user_id, ${analyticsDaySql(source.timeCol)} AS activity_day`,
  });

  const [[row]] = await db.query(
    `
    WITH activity_days AS (
      SELECT DISTINCT user_id, activity_day
      FROM (
        ${activityUnion.sql}
      ) activity_events
    ),
    bounds AS (
      SELECT ${analyticsTodaySql} AS today_day
    )
    SELECT
      DATE_SUB(today_day, INTERVAL 1 DAY) AS day1_cohort_day,
      (
        SELECT COUNT(DISTINCT cohort.user_id)
        FROM activity_days cohort
        WHERE cohort.activity_day = DATE_SUB(today_day, INTERVAL 1 DAY)
      ) AS day1_cohort_users,
      (
        SELECT COUNT(DISTINCT cohort.user_id)
        FROM activity_days cohort
        WHERE cohort.activity_day = DATE_SUB(today_day, INTERVAL 1 DAY)
          AND EXISTS (
            SELECT 1
            FROM activity_days returned
            WHERE returned.user_id = cohort.user_id
              AND returned.activity_day = today_day
          )
      ) AS day1_retained_users,
      DATE_SUB(today_day, INTERVAL 7 DAY) AS day7_cohort_day,
      (
        SELECT COUNT(DISTINCT cohort.user_id)
        FROM activity_days cohort
        WHERE cohort.activity_day = DATE_SUB(today_day, INTERVAL 7 DAY)
      ) AS day7_cohort_users,
      (
        SELECT COUNT(DISTINCT cohort.user_id)
        FROM activity_days cohort
        WHERE cohort.activity_day = DATE_SUB(today_day, INTERVAL 7 DAY)
          AND EXISTS (
            SELECT 1
            FROM activity_days returned
            WHERE returned.user_id = cohort.user_id
              AND returned.activity_day BETWEEN DATE_SUB(today_day, INTERVAL 6 DAY) AND today_day
          )
      ) AS day7_retained_users
    FROM bounds
    `,
    activityUnion.params
  );

  const day1CohortUsers = Number(row?.day1_cohort_users || 0);
  const day1RetainedUsers = Number(row?.day1_retained_users || 0);
  const day7CohortUsers = Number(row?.day7_cohort_users || 0);
  const day7RetainedUsers = Number(row?.day7_retained_users || 0);

  return {
    timezone: VINE_ANALYTICS_TIMEZONE,
    day1: {
      cohort_day: row?.day1_cohort_day || null,
      cohort_users: day1CohortUsers,
      retained_users: day1RetainedUsers,
      retention_pct: calculatePct(day1RetainedUsers, day1CohortUsers),
    },
    day7: {
      cohort_day: row?.day7_cohort_day || null,
      cohort_users: day7CohortUsers,
      retained_users: day7RetainedUsers,
      retention_pct: calculatePct(day7RetainedUsers, day7CohortUsers),
    },
  };
};

const fetchGuardianLifecycleSummary = async () => {
  await ensureLifecycleAnalyticsSchema();
  const now = new Date();
  const activityWindowStart = new Date(now.getTime() - 40 * 86400000);
  const activityUnion = buildAnalyticsUnionSql(ANALYTICS_ACTIVITY_SOURCES, {
    rangeStart: activityWindowStart,
    rangeEnd: now,
    selectBuilder: (source) =>
      `${source.userCol} AS user_id, ${analyticsDaySql(source.timeCol)} AS activity_day`,
  });

  const [[summaryRow]] = await db.query(
    `
    WITH activity_days AS (
      SELECT DISTINCT user_id, activity_day
      FROM (
        ${activityUnion.sql}
      ) activity_events
    ),
    bounds AS (
      SELECT ${analyticsTodaySql} AS today_day
    )
    SELECT
      (
        SELECT COUNT(DISTINCT ad.user_id)
        FROM activity_days ad, bounds b
        WHERE ad.activity_day = b.today_day
      ) AS dau,
      (
        SELECT COUNT(DISTINCT ad.user_id)
        FROM activity_days ad, bounds b
        WHERE ad.activity_day BETWEEN DATE_SUB(b.today_day, INTERVAL 29 DAY) AND b.today_day
      ) AS mau,
      (
        SELECT COUNT(DISTINCT ad.user_id)
        FROM activity_days ad, bounds b
        WHERE ad.activity_day = b.today_day
          AND EXISTS (
            SELECT 1
            FROM activity_days earlier
            WHERE earlier.user_id = ad.user_id
              AND earlier.activity_day < b.today_day
          )
      ) AS returning_users_today
    FROM bounds
    `,
    activityUnion.params
  );

  const [trendRows] = await db.query(
    `
    WITH activity_days AS (
      SELECT DISTINCT user_id, activity_day
      FROM (
        ${activityUnion.sql}
      ) activity_events
    )
    SELECT
      activity_day,
      COUNT(DISTINCT user_id) AS active_users
    FROM activity_days
    WHERE activity_day BETWEEN DATE_SUB(${analyticsTodaySql}, INTERVAL 6 DAY) AND ${analyticsTodaySql}
    GROUP BY activity_day
    ORDER BY activity_day ASC
    `,
    activityUnion.params
  );

  const [[sessionTodayRow]] = await db.query(
    `
    SELECT
      ROUND(AVG(duration_seconds), 0) AS avg_session_seconds,
      COUNT(*) AS total_sessions
    FROM (
      SELECT
        ${analyticsSessionDurationSql("s.created_at", "COALESCE(s.revoked_at, s.last_seen_at)")} AS duration_seconds
      FROM vine_user_sessions s
      WHERE ${analyticsDaySql("s.created_at")} = ${analyticsTodaySql}
    ) session_rows
    `
  );

  const retention = await fetchGuardianRetentionStats();
  const dau = Number(summaryRow?.dau || 0);
  const mau = Number(summaryRow?.mau || 0);

  return {
    timezone: VINE_ANALYTICS_TIMEZONE,
    dau,
    mau,
    stickiness_pct: calculatePct(dau, mau),
    avg_session_seconds_today: Number(sessionTodayRow?.avg_session_seconds || 0),
    total_sessions_today: Number(sessionTodayRow?.total_sessions || 0),
    returning_users_today: Number(summaryRow?.returning_users_today || 0),
    retention_snapshot: retention,
    dau_trend_7d: (trendRows || []).map((row) => ({
      day: row.activity_day,
      active_users: Number(row.active_users || 0),
    })),
  };
};

const fetchGuardianLoginFrequencyStats = async ({ rangeStart, rangeEnd }) => {
  await ensureLifecycleAnalyticsSchema();
  const now = new Date();
  const trailingWeekStart = new Date(now.getTime() - 6 * 86400000);
  const queryStart = new Date(Math.min(rangeStart.getTime(), trailingWeekStart.getTime()));
  const activityUnion = buildAnalyticsUnionSql(ANALYTICS_ACTIVITY_SOURCES, {
    rangeStart: trailingWeekStart,
    rangeEnd: now,
    selectBuilder: (source) =>
      `${source.userCol} AS user_id, ${analyticsDaySql(source.timeCol)} AS activity_day`,
  });

  const [[activeTodayRow]] = await db.query(
    `
    WITH activity_days AS (
      SELECT DISTINCT user_id, activity_day
      FROM (
        ${activityUnion.sql}
      ) activity_events
    )
    SELECT COUNT(DISTINCT user_id) AS total
    FROM activity_days
    WHERE activity_day = ${analyticsTodaySql}
    `,
    activityUnion.params
  );

  const [[loginTodayRow]] = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM vine_login_events
    WHERE ${analyticsDaySql("created_at")} = ${analyticsTodaySql}
    `
  );

  const [[loginWeekRow]] = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM vine_login_events
    WHERE ${analyticsDaySql("created_at")} BETWEEN DATE_SUB(${analyticsTodaySql}, INTERVAL 6 DAY) AND ${analyticsTodaySql}
    `
  );

  const [topRows] = await db.query(
    `
    SELECT
      le.user_id,
      u.username,
      u.display_name,
      u.avatar_url,
      SUM(CASE WHEN ${analyticsDaySql("le.created_at")} = ${analyticsTodaySql} THEN 1 ELSE 0 END) AS logins_today,
      SUM(
        CASE
          WHEN ${analyticsDaySql("le.created_at")} BETWEEN DATE_SUB(${analyticsTodaySql}, INTERVAL 6 DAY) AND ${analyticsTodaySql}
          THEN 1
          ELSE 0
        END
      ) AS logins_week,
      SUM(CASE WHEN le.created_at >= ? AND le.created_at <= ? THEN 1 ELSE 0 END) AS logins_range
    FROM vine_login_events le
    JOIN vine_users u ON u.id = le.user_id
    WHERE le.created_at >= ? AND le.created_at <= ?
    GROUP BY le.user_id, u.username, u.display_name, u.avatar_url
    HAVING logins_today > 0 OR logins_week > 0 OR logins_range > 0
    ORDER BY logins_today DESC, logins_week DESC, logins_range DESC, u.username ASC
    LIMIT 12
    `,
    [rangeStart, rangeEnd, queryStart, now]
  );

  const activeUsersToday = Number(activeTodayRow?.total || 0);
  const totalLoginsToday = Number(loginTodayRow?.total || 0);

  return {
    timezone: VINE_ANALYTICS_TIMEZONE,
    average_logins_per_active_user_today:
      activeUsersToday > 0 ? Number((totalLoginsToday / activeUsersToday).toFixed(2)) : 0,
    total_logins_today: totalLoginsToday,
    total_logins_last_7d: Number(loginWeekRow?.total || 0),
    active_users_today: activeUsersToday,
    top_users: (topRows || []).map((row) => ({
      user_id: Number(row.user_id || 0),
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      logins_today: Number(row.logins_today || 0),
      logins_week: Number(row.logins_week || 0),
      logins_range: Number(row.logins_range || 0),
    })),
  };
};

const fetchGuardianSessionStats = async ({ rangeStart, rangeEnd }) => {
  await ensureLifecycleAnalyticsSchema();
  const durationSql = analyticsSessionDurationSql(
    "s.created_at",
    "COALESCE(s.revoked_at, s.last_seen_at)"
  );

  const [[todayRow]] = await db.query(
    `
    SELECT
      ROUND(AVG(duration_seconds), 0) AS avg_session_seconds,
      COUNT(*) AS total_sessions_today
    FROM (
      SELECT
        ${durationSql} AS duration_seconds
      FROM vine_user_sessions s
      WHERE ${analyticsDaySql("s.created_at")} = ${analyticsTodaySql}
    ) session_rows
    `
  );

  const [[rangeRow]] = await db.query(
    `
    SELECT
      ROUND(AVG(duration_seconds), 0) AS avg_session_seconds,
      COUNT(*) AS total_sessions
    FROM (
      SELECT
        ${durationSql} AS duration_seconds
      FROM vine_user_sessions s
      WHERE s.created_at >= ? AND s.created_at <= ?
    ) session_rows
    `,
    [rangeStart, rangeEnd]
  );

  const [topRows] = await db.query(
    `
    SELECT
      s.user_id,
      u.username,
      u.display_name,
      u.avatar_url,
      COUNT(*) AS session_count,
      ROUND(AVG(${durationSql}), 0) AS avg_session_seconds,
      SUM(${durationSql}) AS total_session_seconds
    FROM vine_user_sessions s
    JOIN vine_users u ON u.id = s.user_id
    WHERE s.created_at >= ? AND s.created_at <= ?
    GROUP BY s.user_id, u.username, u.display_name, u.avatar_url
    HAVING session_count > 0
    ORDER BY avg_session_seconds DESC, total_session_seconds DESC, session_count DESC
    LIMIT 10
    `,
    [rangeStart, rangeEnd]
  );

  const topUsers = (topRows || []).map((row) => ({
    user_id: Number(row.user_id || 0),
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    session_count: Number(row.session_count || 0),
    avg_session_seconds: Number(row.avg_session_seconds || 0),
    total_session_seconds: Number(row.total_session_seconds || 0),
  }));

  return {
    timezone: VINE_ANALYTICS_TIMEZONE,
    avg_session_seconds_today: Number(todayRow?.avg_session_seconds || 0),
    total_sessions_today: Number(todayRow?.total_sessions_today || 0),
    avg_session_seconds_range: Number(rangeRow?.avg_session_seconds || 0),
    total_sessions_range: Number(rangeRow?.total_sessions || 0),
    longest_average_user_session: topUsers[0] || null,
    top_users: topUsers,
  };
};

const fetchGuardianDropoffStats = async ({ rangeStart, rangeEnd }) => {
  await ensureLifecycleAnalyticsSchema();
  const feedUnion = buildAnalyticsUnionSql(
    ANALYTICS_ACTIVITY_SOURCES.filter((source) => source.label === "feed_view"),
    {
      rangeStart,
      rangeEnd,
      selectBuilder: (source) => `${source.userCol} AS user_id`,
    }
  );
  const engagementUnion = buildAnalyticsUnionSql(ANALYTICS_ENGAGEMENT_SOURCES, {
    rangeStart,
    rangeEnd,
    selectBuilder: (source) => `${source.userCol} AS user_id`,
  });

  const [[row]] = await db.query(
    `
    WITH logged_in AS (
      SELECT DISTINCT user_id
      FROM vine_login_events
      WHERE created_at >= ? AND created_at <= ?
    ),
    reached_feed AS (
      SELECT DISTINCT event_rows.user_id
      FROM (
        ${feedUnion.sql}
      ) event_rows
      JOIN logged_in li ON li.user_id = event_rows.user_id
    ),
    engaged AS (
      SELECT DISTINCT action_rows.user_id
      FROM (
        ${engagementUnion.sql}
      ) action_rows
      JOIN reached_feed rf ON rf.user_id = action_rows.user_id
    )
    SELECT
      (SELECT COUNT(*) FROM logged_in) AS logged_in_users,
      (SELECT COUNT(*) FROM reached_feed) AS reached_feed_users,
      (SELECT COUNT(*) FROM engaged) AS engaged_users
    `,
    [rangeStart, rangeEnd, ...feedUnion.params, ...engagementUnion.params]
  );

  const [[feedTrackingRow]] = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM vine_user_events
    WHERE event_type = 'feed_view'
      AND created_at >= ? AND created_at <= ?
    `,
    [rangeStart, rangeEnd]
  );

  const loggedInUsers = Number(row?.logged_in_users || 0);
  const reachedFeedUsers = Number(row?.reached_feed_users || 0);
  const engagedUsers = Number(row?.engaged_users || 0);

  return {
    timezone: VINE_ANALYTICS_TIMEZONE,
    steps: [
      {
        key: "logged_in",
        label: "Logged in",
        users: loggedInUsers,
      },
      {
        key: "reached_feed",
        label: "Reached Vine feed",
        users: reachedFeedUsers,
        conversion_pct_from_previous: calculatePct(reachedFeedUsers, loggedInUsers),
        dropoff_pct_from_previous: calculatePct(loggedInUsers - reachedFeedUsers, loggedInUsers),
      },
      {
        key: "engaged",
        label: "Performed engagement action",
        users: engagedUsers,
        conversion_pct_from_previous: calculatePct(engagedUsers, reachedFeedUsers),
        dropoff_pct_from_previous: calculatePct(reachedFeedUsers - engagedUsers, reachedFeedUsers),
      },
    ],
    overall_conversion_pct: calculatePct(engagedUsers, loggedInUsers),
    feed_tracking_events: Number(feedTrackingRow?.total || 0),
  };
};

router.get("/analytics/overview", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    await ensureLifecycleAnalyticsSchema();

    const [[dbMeta]] = await db.query("SELECT DATABASE() AS dbName");
    const dbName = dbMeta?.dbName;
    if (!dbName) {
      return res.status(500).json({ message: "Database not selected" });
    }
    await ensureVinePostSourceSchema();

    const parseDateInput = (value, isEnd = false) => {
      if (!value) return null;
      const raw = String(value).trim();
      if (!raw) return null;
      const normalized = raw.length <= 10
        ? `${raw}${isEnd ? "T23:59:59.999Z" : "T00:00:00.000Z"}`
        : raw;
      const d = new Date(normalized);
      if (Number.isNaN(d.getTime())) return null;
      return d;
    };

    const now = new Date();
    const rangeEnd = parseDateInput(req.query.to, true) || now;
    const rangeStart = parseDateInput(req.query.from, false) || new Date(rangeEnd.getTime() - 6 * 86400000);
    if (rangeStart > rangeEnd) {
      return res.status(400).json({ message: "Invalid date range" });
    }
    const rangeMs = Math.max(1, rangeEnd.getTime() - rangeStart.getTime());
    const prevEnd = new Date(rangeStart.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - rangeMs);

    const countByWindow = async (table, col, windowSql) => {
      const exists = await hasTable(dbName, table);
      if (!exists) return 0;
      const hasCol = await hasColumn(dbName, table, col);
      if (!hasCol) return 0;
      const [[row]] = await db.query(
        `SELECT COUNT(*) AS total FROM ${table} WHERE ${col} >= ${windowSql}`
      );
      return Number(row?.total || 0);
    };

    const countRange = async (table, col = "created_at", start = rangeStart, end = rangeEnd) => {
      const exists = await hasTable(dbName, table);
      if (!exists) return 0;
      const hasCol = await hasColumn(dbName, table, col);
      if (!hasCol) return 0;
      const [[row]] = await db.query(
        `SELECT COUNT(*) AS total FROM ${table} WHERE ${col} >= ? AND ${col} <= ?`,
        [start, end]
      );
      return Number(row?.total || 0);
    };

    const countToday = async (table, col = "created_at") => {
      const exists = await hasTable(dbName, table);
      if (!exists) return 0;
      const hasCol = await hasColumn(dbName, table, col);
      if (!hasCol) return 0;
      const [[row]] = await db.query(
        `SELECT COUNT(*) AS total FROM ${table} WHERE DATE(${col}) = CURDATE()`
      );
      return Number(row?.total || 0);
    };

    const [[activeToday]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_users WHERE DATE(last_active_at) = CURDATE()"
    );
    const [[activeWeek]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_users WHERE last_active_at >= ? AND last_active_at <= ?",
      [rangeStart, rangeEnd]
    );
    const [[activeHoursToday]] = await db.query(
      "SELECT COUNT(DISTINCT HOUR(last_active_at)) AS total FROM vine_users WHERE DATE(last_active_at) = CURDATE()"
    );
    const [[newToday]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_users WHERE DATE(created_at) = CURDATE()"
    );
    const [[newWeek]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_users WHERE created_at >= ? AND created_at <= ?",
      [rangeStart, rangeEnd]
    );
    const [[totalUsersRow]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_users"
    );

    const activityMap = new Map();
    const ensureActivity = (userId) => {
      if (!activityMap.has(Number(userId))) {
        activityMap.set(Number(userId), {
          user_id: Number(userId),
          posts_count: 0,
          comments_count: 0,
          likes_count: 0,
          revines_count: 0,
          dms_count: 0,
          score: 0,
        });
      }
      return activityMap.get(Number(userId));
    };
    const collectActivity = async (table, dateCol, countField, weight) => {
      const exists = await hasTable(dbName, table);
      if (!exists) return;
      const hasUserId = await hasColumn(dbName, table, "user_id");
      const hasDate = await hasColumn(dbName, table, dateCol);
      if (!hasUserId || !hasDate) return;

      const [rows] = await db.query(
        `
        SELECT user_id, COUNT(*) AS total
        FROM ${table}
        WHERE ${dateCol} >= ? AND ${dateCol} <= ?
        GROUP BY user_id
        `,
        [rangeStart, rangeEnd]
      );
      for (const row of rows) {
        const entry = ensureActivity(row.user_id);
        entry[countField] = Number(row.total || 0);
        entry.score += Number(row.total || 0) * weight;
      }
    };

    await Promise.all([
      collectActivity("vine_posts", "created_at", "posts_count", 3),
      collectActivity("vine_comments", "created_at", "comments_count", 2),
      collectActivity("vine_likes", "created_at", "likes_count", 1),
      collectActivity("vine_revines", "created_at", "revines_count", 2),
      collectActivity("vine_messages", "created_at", "dms_count", 1),
    ]);

    const topActivityIds = [...activityMap.values()]
      .filter((x) => Number(x.score) > 0)
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, 15)
      .map((x) => Number(x.user_id));

    let mostActiveUsers = [];
    if (topActivityIds.length > 0) {
      const placeholders = topActivityIds.map(() => "?").join(", ");
      const [users] = await db.query(
        `
        SELECT id, username, display_name, avatar_url, is_verified
        FROM vine_users
        WHERE id IN (${placeholders})
        `,
        topActivityIds
      );
      const userById = new Map(users.map((u) => [Number(u.id), u]));
      mostActiveUsers = topActivityIds
        .map((id) => {
          const user = userById.get(Number(id));
          const activity = activityMap.get(Number(id));
          if (!user || !activity) return null;
          return {
            user_id: Number(id),
            username: user.username,
            display_name: user.display_name,
            avatar_url: user.avatar_url,
            is_verified: user.is_verified,
            posts_count: activity.posts_count,
            comments_count: activity.comments_count,
            likes_count: activity.likes_count,
            revines_count: activity.revines_count,
            dms_count: activity.dms_count,
            score: Number(activity.score || 0),
          };
        })
        .filter(Boolean);
    }

    const loginTableExists = await hasTable(dbName, "vine_login_events");
    const loginToday = loginTableExists
      ? await countToday("vine_login_events", "created_at")
      : Number(activeToday?.total || 0);
    const loginWeek = loginTableExists
      ? await countRange("vine_login_events", "created_at", rangeStart, rangeEnd)
      : Number(activeWeek?.total || 0);

    const [
      postsToday,
      postsWeek,
      commentsToday,
      commentsWeek,
      likesToday,
      likesWeek,
      revinesToday,
      revinesWeek,
      followsToday,
      followsWeek,
      dmsToday,
      dmsWeek,
    ] = await Promise.all([
      countToday("vine_posts"),
      countRange("vine_posts", "created_at", rangeStart, rangeEnd),
      countToday("vine_comments"),
      countRange("vine_comments", "created_at", rangeStart, rangeEnd),
      countToday("vine_likes"),
      countRange("vine_likes", "created_at", rangeStart, rangeEnd),
      countToday("vine_revines"),
      countRange("vine_revines", "created_at", rangeStart, rangeEnd),
      countToday("vine_follows"),
      countRange("vine_follows", "created_at", rangeStart, rangeEnd),
      countToday("vine_messages"),
      countRange("vine_messages", "created_at", rangeStart, rangeEnd),
    ]);

    const totalInteractionsWeek =
      Number(likesWeek) +
      Number(commentsWeek) +
      Number(revinesWeek) +
      Number(followsWeek) +
      Number(dmsWeek);

    // Top posts leaderboard
    let topPostsWeek = [];
    let topPostsToday = [];
    if (await hasTable(dbName, "vine_posts")) {
      const [weekRows] = await db.query(
        `
        SELECT
          p.id,
          p.user_id,
          p.content,
          p.image_url,
          p.created_at,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          (SELECT COUNT(*) FROM vine_likes l WHERE l.post_id = p.id) AS likes,
          (SELECT COUNT(*) FROM vine_comments c WHERE c.post_id = p.id) AS comments,
          (SELECT COUNT(*) FROM vine_revines r WHERE r.post_id = p.id) AS revines
        FROM vine_posts p
        JOIN vine_users u ON u.id = p.user_id
        WHERE p.created_at >= ? AND p.created_at <= ?
        `,
        [rangeStart, rangeEnd]
      );

      const [todayRows] = await db.query(
        `
        SELECT
          p.id,
          p.user_id,
          p.content,
          p.image_url,
          p.created_at,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          (SELECT COUNT(*) FROM vine_likes l WHERE l.post_id = p.id) AS likes,
          (SELECT COUNT(*) FROM vine_comments c WHERE c.post_id = p.id) AS comments,
          (SELECT COUNT(*) FROM vine_revines r WHERE r.post_id = p.id) AS revines
        FROM vine_posts p
        JOIN vine_users u ON u.id = p.user_id
        WHERE DATE(p.created_at) = DATE(?)
        `,
        [rangeEnd]
      );

      const withScore = (rows) =>
        rows
          .map((row) => {
            const score =
              Number(row.likes || 0) * 1 +
              Number(row.comments || 0) * 2 +
              Number(row.revines || 0) * 3;
            return { ...row, score: Number(score.toFixed(2)) };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);

      topPostsWeek = withScore(weekRows);
      topPostsToday = withScore(todayRows);
    }

    // Growth funnel
    const [[newUsers7d]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_users WHERE created_at >= ? AND created_at <= ?",
      [rangeStart, rangeEnd]
    );
    const [[postedByNew7d]] = await db.query(
      `
      SELECT COUNT(DISTINCT p.user_id) AS total
      FROM vine_posts p
      JOIN vine_users u ON u.id = p.user_id
      WHERE u.created_at >= ? AND u.created_at <= ?
        AND p.created_at >= u.created_at
      `,
      [rangeStart, rangeEnd]
    );
    const [[engagedByNew7d]] = await db.query(
      `
      SELECT COUNT(DISTINCT p.user_id) AS total
      FROM vine_posts p
      JOIN vine_users u ON u.id = p.user_id
      WHERE u.created_at >= ? AND u.created_at <= ?
        AND (
          EXISTS (SELECT 1 FROM vine_likes l WHERE l.post_id = p.id)
          OR EXISTS (SELECT 1 FROM vine_comments c WHERE c.post_id = p.id)
          OR EXISTS (SELECT 1 FROM vine_revines r WHERE r.post_id = p.id)
        )
      `,
      [rangeStart, rangeEnd]
    );
    const [[eligibleRetention]] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM vine_users
      WHERE created_at BETWEEN ? AND ?
      `,
      [prevStart, rangeEnd]
    );
    const [[retainedAfter1d]] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM vine_users
      WHERE created_at BETWEEN ? AND ?
        AND last_active_at >= created_at + INTERVAL 1 DAY
      `,
      [prevStart, rangeEnd]
    );

    // Content health
    const [[contentHealthRow]] = await db.query(
      `
      SELECT
        AVG(CHAR_LENGTH(COALESCE(content, ''))) AS avg_post_length_week,
        SUM(CASE WHEN image_url IS NOT NULL AND image_url != '' THEN 1 ELSE 0 END) AS image_posts_week,
        SUM(CASE WHEN link_preview IS NOT NULL AND link_preview != '' THEN 1 ELSE 0 END) AS link_posts_week,
        COUNT(*) AS total_posts_week
      FROM vine_posts
      WHERE created_at >= ? AND created_at <= ?
      `,
      [rangeStart, rangeEnd]
    );

    // Engagement quality
    const [[replyShareRow]] = await db.query(
      `
      SELECT
        SUM(CASE WHEN parent_comment_id IS NOT NULL THEN 1 ELSE 0 END) AS replies,
        COUNT(*) AS total_comments
      FROM vine_comments
      WHERE created_at >= ? AND created_at <= ?
      `,
      [rangeStart, rangeEnd]
    );

    // Network effects
    const [[mutualPairsRow]] = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM vine_follows a
      JOIN vine_follows b
        ON a.follower_id = b.following_id
       AND a.following_id = b.follower_id
      WHERE a.follower_id < a.following_id
      `
    );
    const dmStartsWeek = await countRange("vine_conversations", "created_at", rangeStart, rangeEnd);

    // Guardian alerts (24h vs previous 24h)
    const metricDelta = async (table, col = "created_at") => {
      const exists = await hasTable(dbName, table);
      if (!exists) return { current: 0, previous: 0 };
      const ok = await hasColumn(dbName, table, col);
      if (!ok) return { current: 0, previous: 0 };
      const [[curr]] = await db.query(
        `SELECT COUNT(*) AS total FROM ${table} WHERE ${col} >= ? AND ${col} <= ?`,
        [rangeStart, rangeEnd]
      );
      const [[prev]] = await db.query(
        `SELECT COUNT(*) AS total FROM ${table} WHERE ${col} >= ? AND ${col} <= ?`,
        [prevStart, prevEnd]
      );
      return { current: Number(curr?.total || 0), previous: Number(prev?.total || 0) };
    };

    const [postDelta, commentDelta, likeDelta, signupDelta] = await Promise.all([
      metricDelta("vine_posts"),
      metricDelta("vine_comments"),
      metricDelta("vine_likes"),
      metricDelta("vine_users"),
    ]);

    const buildAlert = (key, label, metric) => {
      const prev = Number(metric.previous || 0);
      const curr = Number(metric.current || 0);
      const pct = prev > 0 ? ((curr - prev) / prev) * 100 : (curr > 0 ? 100 : 0);
      let severity = "normal";
      if (pct >= 100) severity = "high";
      else if (pct >= 35) severity = "medium";
      return {
        key,
        label,
        current: curr,
        previous: prev,
        changePct: Number(pct.toFixed(1)),
        severity,
      };
    };

    const guardianAlerts = [
      buildAlert("posts", "Post spike", postDelta),
      buildAlert("comments", "Comment spike", commentDelta),
      buildAlert("likes", "Like spike", likeDelta),
      buildAlert("signups", "Signup spike", signupDelta),
    ]
      .filter((a) => a.changePct > 20 || (a.previous === 0 && a.current >= 15))
      .sort((a, b) => b.changePct - a.changePct);

    // Creator insights
    let topCreatorsWeek = [];
    let risingCreators = [];
    if (await hasTable(dbName, "vine_posts")) {
      const [creatorRows] = await db.query(
        `
        SELECT
          x.user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          SUM(CASE WHEN x.created_at >= ? AND x.created_at <= ? THEN x.score ELSE 0 END) AS score_week,
          SUM(CASE WHEN x.created_at >= ? AND x.created_at <= ? THEN x.score ELSE 0 END) AS score_prev
        FROM (
          SELECT
            p.id,
            p.user_id,
            p.created_at,
            (
              (SELECT COUNT(*) FROM vine_likes l WHERE l.post_id = p.id) +
              (SELECT COUNT(*) * 2 FROM vine_comments c WHERE c.post_id = p.id) +
              (SELECT COUNT(*) * 3 FROM vine_revines r WHERE r.post_id = p.id)
            ) AS score
          FROM vine_posts p
          WHERE p.created_at >= ? AND p.created_at <= ?
        ) x
        JOIN vine_users u ON u.id = x.user_id
        GROUP BY x.user_id, u.username, u.display_name, u.avatar_url, u.is_verified
        HAVING score_week > 0 OR score_prev > 0
        `,
        [rangeStart, rangeEnd, prevStart, prevEnd, prevStart, rangeEnd]
      );

      topCreatorsWeek = [...creatorRows]
        .sort((a, b) => Number(b.score_week || 0) - Number(a.score_week || 0))
        .slice(0, 10)
        .map((r) => ({
          ...r,
          score_week: Number(r.score_week || 0),
          score_prev: Number(r.score_prev || 0),
        }));

      risingCreators = [...creatorRows]
        .map((r) => {
          const week = Number(r.score_week || 0);
          const prev = Number(r.score_prev || 0);
          const growthPct = prev > 0 ? ((week - prev) / prev) * 100 : (week > 0 ? 100 : 0);
          return {
            ...r,
            score_week: week,
            score_prev: prev,
            growthPct: Number(growthPct.toFixed(1)),
          };
        })
        .filter((r) => r.score_week > 0)
        .sort((a, b) => b.growthPct - a.growthPct)
        .slice(0, 10);
    }

    let vinePrison = [];
    if (await hasTable(dbName, "vine_user_suspensions")) {
      const [rows] = await db.query(
        `
        SELECT
          s.id,
          s.user_id,
          s.scope,
          s.reason,
          s.starts_at,
          s.ends_at,
          s.created_at,
          u.username,
          u.display_name
        FROM vine_user_suspensions s
        JOIN vine_users u ON u.id = s.user_id
        WHERE s.is_active = 1
          AND s.starts_at <= NOW()
          AND (s.ends_at IS NULL OR s.ends_at > NOW())
        ORDER BY s.starts_at DESC
        LIMIT 200
        `
      );
      vinePrison = rows.map((r) => {
        const startsAt = r.starts_at ? new Date(r.starts_at) : null;
        const endsAt = r.ends_at ? new Date(r.ends_at) : null;
        let sentenceLabel = "indefinite";
        if (startsAt && endsAt) {
          const diffMs = Math.max(0, endsAt.getTime() - startsAt.getTime());
          const days = Math.round(diffMs / 86400000);
          if (days === 1) sentenceLabel = "1 day";
          else if (days === 7) sentenceLabel = "1 week";
          else if (days >= 28 && days <= 31) sentenceLabel = "1 month";
          else if (days >= 89 && days <= 93) sentenceLabel = "3 months";
          else sentenceLabel = `${days} days`;
        }
        return {
          ...r,
          sentence_label: sentenceLabel,
        };
      });
    }

    return res.json({
      range: {
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
      },
      kpis: {
        totalUsers: Number(totalUsersRow?.total || 0),
        joinedThisWeek: Number(newWeek?.total || 0),
        activeUsersToday: Number(activeToday?.total || 0),
        activeUsersWeek: Number(activeWeek?.total || 0),
        estimatedActiveHoursToday: Number(activeHoursToday?.total || 0),
        loginsToday: Number(loginToday || 0),
        loginsWeek: Number(loginWeek || 0),
        newUsersToday: Number(newToday?.total || 0),
        newUsersWeek: Number(newWeek?.total || 0),
        postsToday: Number(postsToday || 0),
        postsWeek: Number(postsWeek || 0),
        commentsToday: Number(commentsToday || 0),
        commentsWeek: Number(commentsWeek || 0),
        likesToday: Number(likesToday || 0),
        likesWeek: Number(likesWeek || 0),
        revinesToday: Number(revinesToday || 0),
        revinesWeek: Number(revinesWeek || 0),
        followsToday: Number(followsToday || 0),
        followsWeek: Number(followsWeek || 0),
        dmsToday: Number(dmsToday || 0),
        dmsWeek: Number(dmsWeek || 0),
        totalInteractionsWeek,
      },
      topPostsLeaderboard: {
        today: topPostsToday,
        week: topPostsWeek,
      },
      growthFunnel: {
        newUsers7d: Number(newUsers7d?.total || 0),
        postedByNewUsers7d: Number(postedByNew7d?.total || 0),
        engagedByNewUsers7d: Number(engagedByNew7d?.total || 0),
        eligibleRetentionUsers: Number(eligibleRetention?.total || 0),
        retainedAfter1d: Number(retainedAfter1d?.total || 0),
        retentionRatePct:
          Number(eligibleRetention?.total || 0) > 0
            ? Number(((Number(retainedAfter1d?.total || 0) / Number(eligibleRetention?.total || 1)) * 100).toFixed(1))
            : 0,
      },
      contentHealth: {
        avgPostLengthWeek: Number(contentHealthRow?.avg_post_length_week || 0).toFixed(1),
        imagePostRatioWeek:
          Number(contentHealthRow?.total_posts_week || 0) > 0
            ? Number(((Number(contentHealthRow?.image_posts_week || 0) / Number(contentHealthRow?.total_posts_week || 1)) * 100).toFixed(1))
            : 0,
        linkPostRatioWeek:
          Number(contentHealthRow?.total_posts_week || 0) > 0
            ? Number(((Number(contentHealthRow?.link_posts_week || 0) / Number(contentHealthRow?.total_posts_week || 1)) * 100).toFixed(1))
            : 0,
        commentsPerPostWeek:
          Number(postsWeek || 0) > 0 ? Number((Number(commentsWeek || 0) / Number(postsWeek || 1)).toFixed(2)) : 0,
      },
      engagementQuality: {
        interactionsPerActiveUserWeek:
          Number(activeWeek?.total || 0) > 0
            ? Number((Number(totalInteractionsWeek || 0) / Number(activeWeek?.total || 1)).toFixed(2))
            : 0,
        engagementPerPostWeek:
          Number(postsWeek || 0) > 0
            ? Number(((Number(likesWeek || 0) + Number(commentsWeek || 0) + Number(revinesWeek || 0)) / Number(postsWeek || 1)).toFixed(2))
            : 0,
        replyShareWeek:
          Number(replyShareRow?.total_comments || 0) > 0
            ? Number(((Number(replyShareRow?.replies || 0) / Number(replyShareRow?.total_comments || 1)) * 100).toFixed(1))
            : 0,
      },
      networkEffects: {
        followsWeek: Number(followsWeek || 0),
        followsPerActiveUserWeek:
          Number(activeWeek?.total || 0) > 0
            ? Number((Number(followsWeek || 0) / Number(activeWeek?.total || 1)).toFixed(2))
            : 0,
        mutualFollowPairs: Number(mutualPairsRow?.total || 0),
        dmStartsWeek: Number(dmStartsWeek || 0),
      },
      guardianAlerts,
      creatorInsights: {
        topCreatorsWeek,
        risingCreators,
      },
      networkUsers: {
        totalUsers: Number(totalUsersRow?.total || 0),
        joinedThisWeek: Number(newWeek?.total || 0),
      },
      mostActiveUsers,
      vinePrison,
    });
  } catch (err) {
    console.error("Guardian analytics error:", err);
    return res.status(500).json({ message: "Failed to load analytics" });
  }
});

router.get("/analytics/adoption-summary", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const summary = await fetchGuardianLifecycleSummary();
    return res.json(summary);
  } catch (err) {
    console.error("Guardian adoption summary error:", err);
    return res.status(500).json({ message: "Failed to load adoption summary" });
  }
});

router.get("/analytics/retention", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const retention = await fetchGuardianRetentionStats();
    return res.json(retention);
  } catch (err) {
    console.error("Guardian retention analytics error:", err);
    return res.status(500).json({ message: "Failed to load retention analytics" });
  }
});

router.get("/analytics/login-frequency", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const { rangeStart, rangeEnd } = getGuardianAnalyticsRange(req.query);
    const payload = await fetchGuardianLoginFrequencyStats({ rangeStart, rangeEnd });
    return res.json({
      range: {
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
      },
      ...payload,
    });
  } catch (err) {
    if (err?.status) {
      return res.status(err.status).json({ message: err.message || "Invalid date range" });
    }
    console.error("Guardian login frequency analytics error:", err);
    return res.status(500).json({ message: "Failed to load login frequency analytics" });
  }
});

router.get("/analytics/session-stats", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const { rangeStart, rangeEnd } = getGuardianAnalyticsRange(req.query);
    const payload = await fetchGuardianSessionStats({ rangeStart, rangeEnd });
    return res.json({
      range: {
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
      },
      ...payload,
    });
  } catch (err) {
    if (err?.status) {
      return res.status(err.status).json({ message: err.message || "Invalid date range" });
    }
    console.error("Guardian session analytics error:", err);
    return res.status(500).json({ message: "Failed to load session analytics" });
  }
});

router.get("/analytics/dropoff", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const { rangeStart, rangeEnd } = getGuardianAnalyticsRange(req.query);
    const payload = await fetchGuardianDropoffStats({ rangeStart, rangeEnd });
    return res.json({
      range: {
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
      },
      ...payload,
    });
  } catch (err) {
    if (err?.status) {
      return res.status(err.status).json({ message: err.message || "Invalid date range" });
    }
    console.error("Guardian drop-off analytics error:", err);
    return res.status(500).json({ message: "Failed to load drop-off analytics" });
  }
});

router.get("/analytics/activity", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const dbName = await getDbName();
    if (!dbName) {
      return res.status(500).json({ message: "Database not selected" });
    }

    const loginLimit = Math.max(10, Math.min(120, Number(req.query.loginLimit || 60)));
    const actionLimit = Math.max(30, Math.min(200, Number(req.query.actionLimit || 120)));

    const payload = await runVinePerfRoute(
      "guardian-activity",
      { viewer_id: Number(req.user?.id || 0) },
      async (perfCtx) =>
        buildGuardianActivitySnapshot(perfCtx, dbName, {
          loginLimit,
          actionLimit,
        })
    );

    return res.json(payload);
  } catch (err) {
    console.error("Guardian activity analytics error:", err);
    return res.status(500).json({ message: "Failed to load activity analytics" });
  }
});

router.get("/analytics/performance", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    return res.json({
      enabled: vinePerfLogsEnabled,
      console_enabled: vinePerfConsoleLogsEnabled,
      thresholds: {
        vine_slow_route_ms: vineSlowRouteMs,
        vine_slow_query_ms: vineSlowQueryMs,
        dm_slow_route_ms: Number(process.env.DM_SLOW_ROUTE_MS || process.env.VINE_SLOW_ROUTE_MS || 500),
        dm_slow_query_ms: Number(process.env.DM_SLOW_QUERY_MS || process.env.VINE_SLOW_QUERY_MS || 150),
      },
      ...getGuardianPerfSnapshot({
        routeLimit: 10,
        queryLimit: 12,
        sampleLimit: 12,
      }),
    });
  } catch (err) {
    console.error("Guardian performance analytics error:", err);
    return res.status(500).json({ message: "Failed to load performance analytics" });
  }
});

// Guardian-only drilldown for moderation view
router.get("/analytics/drilldown", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const parseDateInput = (value, isEnd = false) => {
      if (!value) return null;
      const raw = String(value).trim();
      if (!raw) return null;
      const normalized = raw.length <= 10
        ? `${raw}${isEnd ? "T23:59:59.999Z" : "T00:00:00.000Z"}`
        : raw;
      const d = new Date(normalized);
      if (Number.isNaN(d.getTime())) return null;
      return d;
    };

    const to = parseDateInput(req.query.to, true) || new Date();
    const from = parseDateInput(req.query.from, false) || new Date(to.getTime() - 6 * 86400000);
    if (from > to) return res.status(400).json({ message: "Invalid date range" });

    const type = String(req.query.type || "posts").toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 300);
    const userId = Number(req.query.userId || 0);

    if (type === "posts") {
      const [rows] = await db.query(
        `
        SELECT
          p.id,
          p.user_id,
          p.content,
          p.created_at,
          u.username,
          u.display_name,
          (SELECT COUNT(*) FROM vine_likes l WHERE l.post_id = p.id) AS likes,
          (SELECT COUNT(*) FROM vine_comments c WHERE c.post_id = p.id) AS comments,
          (SELECT COUNT(*) FROM vine_revines r WHERE r.post_id = p.id) AS revines
        FROM vine_posts p
        JOIN vine_users u ON u.id = p.user_id
        WHERE p.created_at >= ? AND p.created_at <= ?
          AND (? = 0 OR p.user_id = ?)
        ORDER BY p.created_at DESC
        LIMIT ?
        `,
        [from, to, userId, userId, limit]
      );
      return res.json({ type, items: rows });
    }

    if (type === "comments") {
      const [rows] = await db.query(
        `
        SELECT
          c.id,
          c.post_id,
          c.user_id,
          c.content,
          c.parent_comment_id,
          c.created_at,
          u.username,
          u.display_name
        FROM vine_comments c
        JOIN vine_users u ON u.id = c.user_id
        WHERE c.created_at >= ? AND c.created_at <= ?
          AND (? = 0 OR c.user_id = ?)
        ORDER BY c.created_at DESC
        LIMIT ?
        `,
        [from, to, userId, userId, limit]
      );
      return res.json({ type, items: rows });
    }

    if (type === "users") {
      const [rows] = await db.query(
        `
        SELECT id, username, display_name, created_at, last_active_at, role
        FROM vine_users
        WHERE (? > 0 AND id = ?)
           OR (? = 0 AND created_at >= ? AND created_at <= ?)
        ORDER BY last_active_at DESC, created_at DESC
        LIMIT ?
        `,
        [userId, userId, userId, from, to, limit]
      );
      return res.json({ type, items: rows });
    }

    if (type === "creators") {
      const [rows] = await db.query(
        `
        SELECT
          p.user_id,
          u.username,
          u.display_name,
          COUNT(*) AS posts,
          SUM((SELECT COUNT(*) FROM vine_likes l WHERE l.post_id = p.id)) AS likes,
          SUM((SELECT COUNT(*) FROM vine_comments c WHERE c.post_id = p.id)) AS comments,
          SUM((SELECT COUNT(*) FROM vine_revines r WHERE r.post_id = p.id)) AS revines
        FROM vine_posts p
        JOIN vine_users u ON u.id = p.user_id
        WHERE p.created_at >= ? AND p.created_at <= ?
          AND (? = 0 OR p.user_id = ?)
        GROUP BY p.user_id, u.username, u.display_name
        ORDER BY (likes + comments * 2 + revines * 3) DESC
        LIMIT ?
        `,
        [from, to, userId, userId, Math.min(limit, 100)]
      );
      return res.json({ type, items: rows });
    }

    return res.status(400).json({ message: "Unsupported drilldown type" });
  } catch (err) {
    console.error("Guardian drilldown error:", err);
    return res.status(500).json({ message: "Failed to load drilldown" });
  }
});

  return router;
}
