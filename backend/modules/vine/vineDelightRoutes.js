import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { getQuestProgress, resolveFriendshipCharms } from "./vineDelightLogic.js";
import {
  getAnniversaryPeriod,
  getMonthlyRewindPeriod,
  getWeeklyRewindPeriod,
  getYearlyRewindPeriod,
  renderRewindCardSvg,
} from "./weeklyRewindCard.js";

const GUESTBOOK_MESSAGE_LIMIT = 180;
const QUEST_TITLE_LIMIT = 120;
const QUEST_EMOJIS = ["🏆", "🌱", "📚", "💪", "✨", "🤝"];
const BACKEND_UPLOADS_DIR = fileURLToPath(new URL("../../uploads/", import.meta.url));

const parseDate = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export default function createVineDelightRouter({
  db,
  authenticate,
  authOptional,
  ensureCommunitySchema,
  ensurePokeSchema,
  getCommunityRole,
  isCommunityModOrOwner,
  isUserBlocked,
  notifyUser,
  notifyUsersBulk,
  uploadBufferToCloudinary,
  deleteCloudinaryByUrl,
  emitVineFeedUpdated,
  clearVineReadCache,
}) {
  const router = express.Router();
  let schemaReady = false;
  let schemaPromise = null;

  const ensureDelightSchema = async () => {
    if (schemaReady) return;
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS vine_profile_guestbook (
          id INT AUTO_INCREMENT PRIMARY KEY,
          profile_user_id INT NOT NULL,
          author_id INT NOT NULL,
          message VARCHAR(180) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          approved_at DATETIME NULL,
          INDEX idx_vine_guestbook_profile_status_time (profile_user_id, status, created_at),
          INDEX idx_vine_guestbook_author_profile_time (author_id, profile_user_id, created_at)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS vine_community_quests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          community_id INT NOT NULL,
          created_by INT NOT NULL,
          title VARCHAR(120) NOT NULL,
          emoji VARCHAR(16) NOT NULL DEFAULT '🏆',
          target_count INT NOT NULL DEFAULT 10,
          ends_at DATETIME NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'active',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_vine_quests_community_status_end (community_id, status, ends_at)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS vine_community_quest_checkins (
          id INT AUTO_INCREMENT PRIMARY KEY,
          quest_id INT NOT NULL,
          user_id INT NOT NULL,
          checkin_date DATE NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_vine_quest_user_day (quest_id, user_id, checkin_date),
          INDEX idx_vine_quest_checkins_quest_time (quest_id, created_at)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS vine_weekly_rewind_shares (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          week_key DATE NOT NULL,
          post_id INT NOT NULL,
          image_url TEXT NOT NULL,
          stats_json LONGTEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_vine_weekly_rewind_user_week (user_id, week_key),
          INDEX idx_vine_weekly_rewind_post (post_id)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS vine_monthly_rewind_shares (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          period_key VARCHAR(16) NOT NULL,
          post_id INT NOT NULL,
          image_url TEXT NOT NULL,
          stats_json LONGTEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_vine_monthly_rewind_user_period (user_id, period_key),
          INDEX idx_vine_monthly_rewind_post (post_id)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS vine_yearly_rewind_shares (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          period_key VARCHAR(16) NOT NULL,
          post_id INT NOT NULL,
          image_url TEXT NOT NULL,
          stats_json LONGTEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_vine_yearly_rewind_user_period (user_id, period_key),
          INDEX idx_vine_yearly_rewind_post (post_id)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS vine_anniversary_shares (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          anniversary_year VARCHAR(8) NOT NULL,
          post_id INT NOT NULL,
          image_url TEXT NOT NULL,
          stats_json LONGTEXT NULL,
          years_on_vine INT NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_vine_anniversary_user_year (user_id, anniversary_year),
          INDEX idx_vine_anniversary_post (post_id)
        )
      `);
      const [anniversaryStatsColumn] = await db.query(
        "SHOW COLUMNS FROM vine_anniversary_shares LIKE 'stats_json'"
      );
      if (!anniversaryStatsColumn.length) {
        await db.query("ALTER TABLE vine_anniversary_shares ADD COLUMN stats_json LONGTEXT NULL AFTER image_url");
      }
      schemaReady = true;
    })().finally(() => {
      schemaPromise = null;
    });
    return schemaPromise;
  };

  const findUser = async (username) => {
    const [[user]] = await db.query(
      "SELECT id, username, display_name, avatar_url, created_at, is_private FROM vine_users WHERE LOWER(username) = LOWER(?) LIMIT 1",
      [String(username || "").trim()]
    );
    return user || null;
  };

  const hasBlockConflict = async (firstId, secondId) =>
    (await isUserBlocked(firstId, secondId)) || (await isUserBlocked(secondId, firstId));

  const canViewPrivateProfile = async (viewerId, profileUser) => {
    const safeViewerId = Number(viewerId || 0);
    if (!Number(profileUser?.is_private) || safeViewerId === Number(profileUser?.id)) return true;
    if (!safeViewerId) return false;
    const [[following]] = await db.query(
      "SELECT 1 FROM vine_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
      [safeViewerId, Number(profileUser.id)]
    );
    return Boolean(following);
  };

  const REWIND_CONFIGS = Object.freeze({
    weekly: {
      title: "Weekly Rewind",
      eyebrow: "YOUR WEEK IN BLOOM",
      periodLabel: "WEEKLY",
      emoji: "🎞️",
      topicTag: "weeklyrewind",
      notificationType: "weekly_rewind_shared",
      shareTable: "vine_weekly_rewind_shares",
      periodColumn: "week_key",
      folder: "weekly-rewinds",
    },
    monthly: {
      title: "Monthly Rewind",
      eyebrow: "YOUR MONTH IN BLOOM",
      periodLabel: "MONTHLY",
      emoji: "🌙",
      topicTag: "monthlyrewind",
      notificationType: "monthly_rewind_shared",
      shareTable: "vine_monthly_rewind_shares",
      periodColumn: "period_key",
      folder: "monthly-rewinds",
    },
    yearly: {
      title: "End-of-Year Rewind",
      eyebrow: "YOUR YEAR IN BLOOM",
      periodLabel: "YEARLY",
      emoji: "✨",
      topicTag: "yearlyrewind",
      notificationType: "yearly_rewind_shared",
      shareTable: "vine_yearly_rewind_shares",
      periodColumn: "period_key",
      folder: "yearly-rewinds",
    },
    anniversary: {
      title: "Anniversary",
      eyebrow: "ANOTHER YEAR IN BLOOM",
      periodLabel: "VINE ANNIVERSARY",
      emoji: "🎉",
      topicTag: "anniversary",
      notificationType: "anniversary_shared",
      shareTable: "vine_anniversary_shares",
      periodColumn: "anniversary_year",
      folder: "anniversaries",
    },
  });
  const REWIND_TYPES = Object.keys(REWIND_CONFIGS);
  const SYSTEM_REWIND_TAGS_SQL = "('weeklyrewind', 'monthlyrewind', 'yearlyrewind', 'anniversary')";

  const getRewindDefinition = (type, now = new Date(), joinedAt = null) => {
    const safeType = REWIND_CONFIGS[type] ? type : "weekly";
    const period = safeType === "weekly"
      ? getWeeklyRewindPeriod(now)
      : safeType === "monthly"
      ? getMonthlyRewindPeriod(now)
      : safeType === "yearly"
      ? getYearlyRewindPeriod(now)
      : getAnniversaryPeriod(joinedAt, now);
    const normalizedPeriod = safeType === "anniversary"
      ? {
        ...period,
        start: period.joinedDate,
        end: period.anniversaryDate,
      }
      : period;
    return { ...REWIND_CONFIGS[safeType], ...normalizedPeriod, type: safeType };
  };

  const buildRewind = async (user, type, now = new Date()) => {
    const definition = getRewindDefinition(type, now, user.created_at);
    const base = {
      username: user.username,
      display_name: user.display_name,
      rewind_type: definition.type,
      title: definition.title,
      emoji: definition.emoji,
      available: Boolean(definition.available),
      eyebrow: definition.eyebrow,
      period_label: definition.periodLabel,
      period_key: definition.periodKey,
      week_key: definition.type === "weekly" ? definition.periodKey : undefined,
      starts_at: definition.start?.toISOString() || null,
      ends_at: definition.end?.toISOString() || null,
      shared_post_id: null,
      shared_image_url: null,
    };
    if (!definition.available) return { ...base, stats: null };

    const userId = Number(user.id);
    if (definition.type === "anniversary") {
      const [posts, communities, followers, sharedRows] = await Promise.all([
        db.query(`
          SELECT COUNT(*) AS total
          FROM vine_posts
          WHERE user_id = ? AND COALESCE(topic_tag, '') NOT IN ${SYSTEM_REWIND_TAGS_SQL}
        `, [userId]),
        db.query("SELECT COUNT(*) AS total FROM vine_community_members WHERE user_id = ?", [userId]),
        db.query("SELECT COUNT(*) AS total FROM vine_follows WHERE following_id = ?", [userId]),
        db.query(`
          SELECT rewind.post_id, rewind.image_url
          FROM ${definition.shareTable} rewind
          JOIN vine_posts post ON post.id = rewind.post_id
          WHERE rewind.user_id = ? AND rewind.${definition.periodColumn} = ?
          LIMIT 1
        `, [userId, definition.periodKey]),
      ]);
      const joinedDate = definition.joinedDate;
      const shared = sharedRows[0]?.[0] || null;
      const daysOnVine = joinedDate
        ? Math.max(0, Math.floor((new Date(now).getTime() - joinedDate.getTime()) / 86400000))
        : 0;
      return {
        ...base,
        joined_at: joinedDate?.toISOString() || null,
        anniversary_date: definition.anniversaryDate?.toISOString() || null,
        shared_post_id: shared?.post_id ? Number(shared.post_id) : null,
        shared_image_url: shared?.image_url || null,
        range_label: joinedDate
          ? `Joined ${joinedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · Celebrating year ${definition.years}`
          : "Celebrating another year on Vine",
        stats: {
          years_on_vine: Number(definition.years || 0),
          joined_year: joinedDate?.getFullYear() || 0,
          posts: Number(posts[0]?.[0]?.total || 0),
          communities: Number(communities[0]?.[0]?.total || 0),
          followers: Number(followers[0]?.[0]?.total || 0),
          days_on_vine: daysOnVine,
        },
        stat_rows: [
          [Number(definition.years || 0), "YEAR ON VINE", "01"],
          [joinedDate?.getFullYear() || 0, "JOINED", "02"],
          [Number(posts[0]?.[0]?.total || 0), "POSTS", "03"],
          [Number(communities[0]?.[0]?.total || 0), "COMMUNITIES", "04"],
          [Number(followers[0]?.[0]?.total || 0), "FOLLOWERS", "05"],
          [daysOnVine, "DAYS GROWING", "06"],
        ],
      };
    }

    const startAt = definition.start;
    const endAt = definition.end;
    const [posts, comments, likesReceived, messages, submissions, activeDays, sharedRows] = await Promise.all([
      db.query(`
        SELECT COUNT(*) AS total
        FROM vine_posts
        WHERE user_id = ? AND created_at >= ? AND created_at <= ?
          AND COALESCE(topic_tag, '') NOT IN ${SYSTEM_REWIND_TAGS_SQL}
      `, [userId, startAt, endAt]),
      db.query("SELECT COUNT(*) AS total FROM vine_comments WHERE user_id = ? AND created_at >= ? AND created_at <= ?", [userId, startAt, endAt]),
      db.query(`
        SELECT COUNT(*) AS total
        FROM vine_likes like_row
        JOIN vine_posts post ON post.id = like_row.post_id
        WHERE post.user_id = ?
          AND like_row.user_id != ?
          AND like_row.created_at >= ? AND like_row.created_at <= ?
          AND COALESCE(post.topic_tag, '') NOT IN ${SYSTEM_REWIND_TAGS_SQL}
      `, [userId, userId, startAt, endAt]),
      db.query(`
        SELECT COUNT(*) AS total
        FROM vine_messages
        WHERE sender_id = ?
          AND COALESCE(message_type, 'text') != 'system'
          AND created_at >= ? AND created_at <= ?
      `, [userId, startAt, endAt]),
      db.query("SELECT COUNT(*) AS total FROM vine_community_submissions WHERE user_id = ? AND submitted_at >= ? AND submitted_at <= ?", [userId, startAt, endAt]),
      db.query(`
        SELECT COUNT(DISTINCT activity_day) AS total
        FROM (
          SELECT DATE(created_at) AS activity_day
          FROM vine_posts
          WHERE user_id = ? AND created_at >= ? AND created_at <= ?
            AND COALESCE(topic_tag, '') NOT IN ${SYSTEM_REWIND_TAGS_SQL}
          UNION ALL
          SELECT DATE(created_at) FROM vine_comments WHERE user_id = ? AND created_at >= ? AND created_at <= ?
          UNION ALL
          SELECT DATE(created_at) FROM vine_messages
          WHERE sender_id = ? AND COALESCE(message_type, 'text') != 'system' AND created_at >= ? AND created_at <= ?
          UNION ALL
          SELECT DATE(submitted_at) FROM vine_community_submissions WHERE user_id = ? AND submitted_at >= ? AND submitted_at <= ?
        ) rewind_activity
      `, [userId, startAt, endAt, userId, startAt, endAt, userId, startAt, endAt, userId, startAt, endAt]),
      db.query(`
        SELECT rewind.post_id, rewind.image_url
        FROM ${definition.shareTable} rewind
        JOIN vine_posts post ON post.id = rewind.post_id
        WHERE rewind.user_id = ? AND rewind.${definition.periodColumn} = ?
        LIMIT 1
      `, [userId, definition.periodKey]),
    ]);

    const shared = sharedRows[0]?.[0] || null;
    return {
      ...base,
      shared_post_id: shared?.post_id ? Number(shared.post_id) : null,
      shared_image_url: shared?.image_url || null,
      stats: {
        posts: Number(posts[0]?.[0]?.total || 0),
        comments: Number(comments[0]?.[0]?.total || 0),
        likes_received: Number(likesReceived[0]?.[0]?.total || 0),
        messages: Number(messages[0]?.[0]?.total || 0),
        assignments: Number(submissions[0]?.[0]?.total || 0),
        active_days: Number(activeDays[0]?.[0]?.total || 0),
      },
    };
  };

  const loadAvatarDataUri = async (avatarUrl) => {
    const value = String(avatarUrl || "").trim();
    if (!value) return "";

    let avatarBuffer;
    if (/^https:\/\//i.test(value)) {
      const response = await fetch(value, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error(`Avatar download failed (${response.status})`);
      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (declaredLength > 8 * 1024 * 1024) throw new Error("Avatar file is too large");
      avatarBuffer = Buffer.from(await response.arrayBuffer());
      if (avatarBuffer.length > 8 * 1024 * 1024) throw new Error("Avatar file is too large");
    } else if (value.startsWith("/uploads/")) {
      const relativePath = decodeURIComponent(value.slice("/uploads/".length));
      const resolvedPath = path.resolve(BACKEND_UPLOADS_DIR, relativePath);
      if (!resolvedPath.startsWith(`${BACKEND_UPLOADS_DIR}${path.sep}`)) {
        throw new Error("Invalid avatar path");
      }
      avatarBuffer = await readFile(resolvedPath);
    } else {
      return "";
    }

    const jpeg = await sharp(avatarBuffer)
      .resize(320, 320, { fit: "cover", position: "attention" })
      .jpeg({ quality: 88 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  };

  const publishRewind = async (type, req, res) => {
    const config = REWIND_CONFIGS[type];
    let imageUrl = null;
    let connection = null;
    try {
      await ensureCommunitySchema();
      await ensureDelightSchema();
      const user = await findUser(req.params.username);
      if (!user) return res.status(404).json({ message: "User not found" });
      const userId = Number(user.id);
      if (userId !== Number(req.user.id)) {
        return res.status(403).json({ message: `You can only share your own ${config.title}` });
      }
      const definition = getRewindDefinition(type, new Date(), user.created_at);
      if (!definition.available) {
        return res.status(403).json({ message: `${config.title} sharing opens during its Vine sharing window` });
      }

      await db.query(`
        DELETE rewind
        FROM ${config.shareTable} rewind
        LEFT JOIN vine_posts post ON post.id = rewind.post_id
        WHERE rewind.user_id = ? AND rewind.${config.periodColumn} = ? AND post.id IS NULL
      `, [userId, definition.periodKey]);

      const rewind = await buildRewind(user, type);
      if (rewind.shared_post_id) {
        return res.json({
          success: true,
          rewind_type: type,
          already_shared: true,
          post_id: rewind.shared_post_id,
          image_url: rewind.shared_image_url,
        });
      }

      let avatarDataUri = "";
      try {
        avatarDataUri = await loadAvatarDataUri(user.avatar_url);
      } catch (avatarError) {
        console.warn(`${config.title} avatar fallback:`, avatarError?.message || avatarError);
      }

      const sharedAt = new Date();
      const svg = renderRewindCardSvg({
        rewindType: type,
        title: config.title,
        eyebrow: config.eyebrow,
        periodLabel: config.periodLabel,
        periodKey: definition.periodKey,
        rangeLabel: rewind.range_label,
        statRows: rewind.stat_rows,
        displayName: user.display_name,
        username: user.username,
        avatarDataUri,
        stats: rewind.stats,
        start: rewind.starts_at,
        end: rewind.ends_at,
        sharedAt,
      });
      const imageBuffer = await sharp(Buffer.from(svg))
        .png({ compressionLevel: 9, quality: 95 })
        .toBuffer();
      const uploaded = await uploadBufferToCloudinary(imageBuffer, {
        folder: `vine/${config.folder}`,
        resource_type: "image",
        format: "png",
        content_type: "image/png",
      });
      imageUrl = uploaded?.secure_url || uploaded?.url || null;
      if (!imageUrl) throw new Error(`${config.title} image upload did not return a URL`);

      connection = await db.getConnection();
      await connection.beginTransaction();
      const postCopy = `${user.display_name || user.username} shared a Vine ${config.title} ${config.emoji}`;
      const [createdPost] = await connection.query(`
        INSERT INTO vine_posts (user_id, content, image_url, topic_tag)
        VALUES (?, ?, ?, ?)
      `, [userId, postCopy, JSON.stringify([imageUrl]), config.topicTag]);
      const postId = Number(createdPost.insertId);
      await connection.query(`
        INSERT INTO ${config.shareTable} (user_id, ${config.periodColumn}, post_id, image_url, stats_json)
        VALUES (?, ?, ?, ?, ?)
      `, [userId, definition.periodKey, postId, imageUrl, JSON.stringify(rewind.stats)]);
      await connection.commit();
      connection.release();
      connection = null;
      const sharedImageUrl = imageUrl;
      imageUrl = null;

      const notifyFollowers = async () => {
        const [followers] = await db.query(`
          SELECT follow_row.follower_id
          FROM vine_follows follow_row
          WHERE follow_row.following_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM vine_mutes mute_row
              WHERE mute_row.muter_id = follow_row.follower_id AND mute_row.muted_id = ?
            )
            AND NOT EXISTS (
              SELECT 1 FROM vine_blocks block_row
              WHERE (block_row.blocker_id = follow_row.follower_id AND block_row.blocked_id = ?)
                 OR (block_row.blocker_id = ? AND block_row.blocked_id = follow_row.follower_id)
            )
        `, [userId, userId, userId, userId]);
        await notifyUsersBulk({
          userIds: followers.map((follower) => follower.follower_id),
          actorId: userId,
          type: config.notificationType,
          postId,
          meta: {
            post_id: postId,
            period_key: definition.periodKey,
            rewind_type: type,
            ...(type === "anniversary" ? { years_on_vine: rewind.stats?.years_on_vine || 1 } : {}),
          },
        });
      };
      void notifyFollowers().catch((notificationError) => {
        console.warn(`${config.title} follower notification error:`, notificationError?.message || notificationError);
      });
      clearVineReadCache();
      emitVineFeedUpdated({ type: "post_created", postId, communityId: null, authorId: userId });
      return res.status(201).json({ success: true, rewind_type: type, already_shared: false, post_id: postId, image_url: sharedImageUrl });
    } catch (err) {
      if (connection) {
        await connection.rollback().catch(() => {});
        connection.release();
      }
      if (imageUrl) await deleteCloudinaryByUrl(imageUrl).catch(() => {});

      if (err?.code === "ER_DUP_ENTRY") {
        try {
          const user = await findUser(req.params.username);
          const rewind = user ? await buildRewind(user, type) : null;
          if (rewind?.shared_post_id) {
            return res.json({
              success: true,
              rewind_type: type,
              already_shared: true,
              post_id: rewind.shared_post_id,
              image_url: rewind.shared_image_url,
            });
          }
        } catch {
          // Fall through to the standard error response.
        }
      }
      console.error(`${config.title} share error:`, err);
      return res.status(500).json({ message: `Failed to share your ${config.title}` });
    }
  };

  for (const rewindType of REWIND_TYPES) {
    const readAuth = rewindType === "anniversary" ? authOptional : authenticate;
    router.get(`/users/:username/${rewindType}-rewind`, readAuth, async (req, res) => {
      const config = REWIND_CONFIGS[rewindType];
      try {
        await ensureCommunitySchema();
        await ensureDelightSchema();
        const user = await findUser(req.params.username);
        if (!user) return res.status(404).json({ message: "User not found" });
        if (rewindType !== "anniversary" && Number(user.id) !== Number(req.user?.id)) {
          return res.status(403).json({ message: `Your ${config.title} is private to you` });
        }
        if (rewindType === "anniversary" && !(await canViewPrivateProfile(Number(req.user?.id || 0), user))) {
          return res.json({
            username: user.username,
            display_name: user.display_name,
            rewind_type: rewindType,
            title: config.title,
            emoji: config.emoji,
            available: false,
            stats: null,
          });
        }
        return res.json(await buildRewind(user, rewindType));
      } catch (err) {
        console.error(`${config.title} error:`, err);
        return res.status(500).json({ message: `Failed to build your ${config.title}` });
      }
    });
    router.post(`/users/:username/${rewindType}-rewind/share`, authenticate, (req, res) => publishRewind(rewindType, req, res));
  }

  router.get("/users/:username/friendship-charms", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await ensureDelightSchema();
      await ensurePokeSchema();
      const viewerId = Number(req.user.id);
      const target = await findUser(req.params.username);
      if (!target) return res.status(404).json({ message: "User not found" });
      const targetId = Number(target.id);
      if (viewerId === targetId) return res.json({ charms: [] });
      if (await hasBlockConflict(viewerId, targetId)) return res.status(403).json({ message: "Not available" });
      if (!(await canViewPrivateProfile(viewerId, target))) return res.status(403).json({ message: "This profile is private" });

      const [followRows, communityRows, pokeRows, messageRows] = await Promise.all([
        db.query(`
          SELECT COUNT(DISTINCT CONCAT(follower_id, ':', following_id)) AS total
          FROM vine_follows
          WHERE (follower_id = ? AND following_id = ?)
             OR (follower_id = ? AND following_id = ?)
        `, [viewerId, targetId, targetId, viewerId]),
        db.query(`
          SELECT COUNT(*) AS total
          FROM vine_community_members mine
          JOIN vine_community_members theirs ON theirs.community_id = mine.community_id
          WHERE mine.user_id = ? AND theirs.user_id = ?
        `, [viewerId, targetId]),
        db.query(`
          SELECT COUNT(*) AS total
          FROM vine_pokes
          WHERE user_low_id = LEAST(?, ?)
            AND user_high_id = GREATEST(?, ?)
        `, [viewerId, targetId, viewerId, targetId]),
        db.query(`
          SELECT COUNT(*) AS total
          FROM vine_messages message
          JOIN vine_conversations conversation ON conversation.id = message.conversation_id
          WHERE COALESCE(conversation.conversation_type, 'direct') = 'direct'
            AND ((conversation.user1_id = ? AND conversation.user2_id = ?)
              OR (conversation.user1_id = ? AND conversation.user2_id = ?))
            AND COALESCE(message.message_type, 'text') != 'system'
        `, [viewerId, targetId, targetId, viewerId]),
      ]);
      const charms = resolveFriendshipCharms({
        mutualFollow: Number(followRows[0]?.[0]?.total || 0) >= 2,
        sharedCommunityCount: communityRows[0]?.[0]?.total,
        pokeCount: pokeRows[0]?.[0]?.total,
        directMessageCount: messageRows[0]?.[0]?.total,
      });
      res.json({ charms });
    } catch (err) {
      console.error("Friendship charms error:", err);
      res.status(500).json({ message: "Failed to load friendship charms" });
    }
  });

  router.get("/users/:username/guestbook", authOptional, async (req, res) => {
    try {
      await ensureDelightSchema();
      const profileUser = await findUser(req.params.username);
      if (!profileUser) return res.status(404).json({ message: "User not found" });
      const viewerId = Number(req.user?.id || 0);
      const isOwner = viewerId === Number(profileUser.id);
      if (viewerId && await hasBlockConflict(viewerId, Number(profileUser.id))) {
        return res.json({ entries: [], can_sign: false, is_owner: isOwner });
      }
      if (!(await canViewPrivateProfile(viewerId, profileUser))) {
        return res.json({ entries: [], can_sign: false, is_owner: isOwner });
      }
      const [entries] = await db.query(`
        SELECT
          entry.id,
          entry.message,
          entry.status,
          entry.created_at,
          entry.author_id,
          author.username,
          author.display_name,
          author.avatar_url,
          author.is_verified
        FROM vine_profile_guestbook entry
        JOIN vine_users author ON author.id = entry.author_id
        WHERE entry.profile_user_id = ?
          AND ${isOwner ? "entry.status IN ('pending', 'approved')" : "entry.status = 'approved'"}
        ORDER BY (entry.status = 'pending') DESC, entry.created_at DESC
        LIMIT 40
      `, [profileUser.id]);
      let canSign = Boolean(viewerId && !isOwner);
      if (canSign) {
        const [[recentEntry]] = await db.query(`
          SELECT id
          FROM vine_profile_guestbook
          WHERE author_id = ? AND profile_user_id = ?
            AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          LIMIT 1
        `, [viewerId, profileUser.id]);
        canSign = !recentEntry;
      }
      res.json({
        entries,
        can_sign: canSign,
        is_owner: isOwner,
      });
    } catch (err) {
      console.error("Guestbook load error:", err);
      res.status(500).json({ message: "Failed to load guestbook" });
    }
  });

  router.post("/users/:username/guestbook", authenticate, async (req, res) => {
    try {
      await ensureDelightSchema();
      const authorId = Number(req.user.id);
      const profileUser = await findUser(req.params.username);
      if (!profileUser) return res.status(404).json({ message: "User not found" });
      const profileUserId = Number(profileUser.id);
      if (authorId === profileUserId) return res.status(400).json({ message: "You cannot sign your own guestbook" });
      if (await hasBlockConflict(authorId, profileUserId)) return res.status(403).json({ message: "Not available" });
      if (!(await canViewPrivateProfile(authorId, profileUser))) return res.status(403).json({ message: "This profile is private" });
      const message = String(req.body?.message || "").trim().replace(/\s+/g, " ");
      if (!message) return res.status(400).json({ message: "Write a little note first" });
      if (message.length > GUESTBOOK_MESSAGE_LIMIT) return res.status(400).json({ message: `Keep your note under ${GUESTBOOK_MESSAGE_LIMIT} characters` });
      const [[recent]] = await db.query(`
        SELECT id
        FROM vine_profile_guestbook
        WHERE author_id = ? AND profile_user_id = ?
          AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        LIMIT 1
      `, [authorId, profileUserId]);
      if (recent) return res.status(429).json({ message: "You can leave another note here next week" });
      const [created] = await db.query(`
        INSERT INTO vine_profile_guestbook (profile_user_id, author_id, message, status)
        VALUES (?, ?, ?, 'pending')
      `, [profileUserId, authorId, message]);
      await notifyUser({
        userId: profileUserId,
        actorId: authorId,
        type: "guestbook_entry",
        meta: { profile_username: profileUser.username },
      });
      res.status(201).json({ id: Number(created.insertId), status: "pending", message: "Your note is waiting for approval" });
    } catch (err) {
      console.error("Guestbook sign error:", err);
      res.status(500).json({ message: "Failed to leave your note" });
    }
  });

  router.patch("/guestbook/:entryId/approve", authenticate, async (req, res) => {
    try {
      await ensureDelightSchema();
      const entryId = Number(req.params.entryId);
      const [result] = await db.query(`
        UPDATE vine_profile_guestbook
        SET status = 'approved', approved_at = NOW()
        WHERE id = ? AND profile_user_id = ? AND status = 'pending'
      `, [entryId, Number(req.user.id)]);
      if (!result.affectedRows) return res.status(404).json({ message: "Pending note not found" });
      res.json({ success: true });
    } catch (err) {
      console.error("Guestbook approve error:", err);
      res.status(500).json({ message: "Failed to approve note" });
    }
  });

  router.delete("/guestbook/:entryId", authenticate, async (req, res) => {
    try {
      await ensureDelightSchema();
      const [result] = await db.query(`
        DELETE FROM vine_profile_guestbook
        WHERE id = ? AND (profile_user_id = ? OR author_id = ?)
        LIMIT 1
      `, [Number(req.params.entryId), Number(req.user.id), Number(req.user.id)]);
      if (!result.affectedRows) return res.status(404).json({ message: "Guestbook note not found" });
      res.json({ success: true });
    } catch (err) {
      console.error("Guestbook delete error:", err);
      res.status(500).json({ message: "Failed to remove note" });
    }
  });

  const loadQuestRows = async (communityId, userId) => {
    const [rows] = await db.query(`
      SELECT
        quest.id,
        quest.title,
        quest.emoji,
        quest.target_count,
        quest.ends_at,
        quest.status,
        quest.created_at,
        quest.created_by,
        creator.username AS creator_username,
        creator.display_name AS creator_display_name,
        COUNT(checkin.id) AS progress_count,
        MAX(CASE WHEN checkin.user_id = ? AND checkin.checkin_date = CURDATE() THEN 1 ELSE 0 END) AS viewer_checked_today
      FROM vine_community_quests quest
      JOIN vine_users creator ON creator.id = quest.created_by
      LEFT JOIN vine_community_quest_checkins checkin ON checkin.quest_id = quest.id
      WHERE quest.community_id = ?
      GROUP BY quest.id, quest.title, quest.emoji, quest.target_count, quest.ends_at, quest.status,
        quest.created_at, quest.created_by, creator.username, creator.display_name
      ORDER BY (quest.status = 'active' AND quest.ends_at >= NOW()) DESC, quest.created_at DESC
      LIMIT 30
    `, [userId, communityId]);
    return rows.map((row) => ({
      ...row,
      ...getQuestProgress(row.progress_count, row.target_count),
      viewer_checked_today: Number(row.viewer_checked_today || 0) === 1,
      expired: Boolean(parseDate(row.ends_at) && parseDate(row.ends_at) < new Date()),
    }));
  };

  router.get("/communities/:id/quests", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await ensureDelightSchema();
      const communityId = Number(req.params.id);
      const role = await getCommunityRole(communityId, Number(req.user.id));
      if (!role) return res.status(403).json({ message: "Join this community first" });
      res.json({ quests: await loadQuestRows(communityId, Number(req.user.id)), viewer_role: role });
    } catch (err) {
      console.error("Community quests load error:", err);
      res.status(500).json({ message: "Failed to load community quests" });
    }
  });

  router.post("/communities/:id/quests", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await ensureDelightSchema();
      const communityId = Number(req.params.id);
      const userId = Number(req.user.id);
      const role = await getCommunityRole(communityId, userId);
      if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Only community admins can create quests" });
      const title = String(req.body?.title || "").trim().replace(/\s+/g, " ");
      const emoji = QUEST_EMOJIS.includes(String(req.body?.emoji || "")) ? String(req.body.emoji) : "🏆";
      const requestedTarget = Number(req.body?.target_count);
      const targetCount = Math.min(500, Math.max(2, Number.isFinite(requestedTarget) ? Math.round(requestedTarget) : 10));
      const endsAt = parseDate(req.body?.ends_at);
      if (!title || title.length > QUEST_TITLE_LIMIT) return res.status(400).json({ message: `Quest title must be 1-${QUEST_TITLE_LIMIT} characters` });
      if (!endsAt || endsAt <= new Date()) return res.status(400).json({ message: "Choose a future deadline" });
      const [created] = await db.query(`
        INSERT INTO vine_community_quests (community_id, created_by, title, emoji, target_count, ends_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [communityId, userId, title, emoji, targetCount, endsAt]);
      const [[community]] = await db.query("SELECT name, slug FROM vine_communities WHERE id = ? LIMIT 1", [communityId]);
      const [members] = await db.query("SELECT user_id FROM vine_community_members WHERE community_id = ? AND user_id != ?", [communityId, userId]);
      await notifyUsersBulk({
        userIds: members.map((member) => member.user_id),
        actorId: userId,
        type: "community_quest_created",
        meta: { community_id: communityId, community_slug: community?.slug, community_name: community?.name, quest_id: Number(created.insertId), quest_title: title },
      });
      res.status(201).json({ success: true, id: Number(created.insertId) });
    } catch (err) {
      console.error("Community quest create error:", err);
      res.status(500).json({ message: "Failed to create quest" });
    }
  });

  router.post("/communities/:id/quests/:questId/check-in", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await ensureDelightSchema();
      const communityId = Number(req.params.id);
      const questId = Number(req.params.questId);
      const userId = Number(req.user.id);
      const role = await getCommunityRole(communityId, userId);
      if (!role) return res.status(403).json({ message: "Join this community first" });
      const [[quest]] = await db.query(`
        SELECT id, target_count, status, ends_at
        FROM vine_community_quests
        WHERE id = ? AND community_id = ?
        LIMIT 1
      `, [questId, communityId]);
      if (!quest) return res.status(404).json({ message: "Quest not found" });
      if (quest.status !== "active" || parseDate(quest.ends_at) <= new Date()) return res.status(400).json({ message: "This quest has ended" });
      const [created] = await db.query(`
        INSERT IGNORE INTO vine_community_quest_checkins (quest_id, user_id, checkin_date)
        VALUES (?, ?, CURDATE())
      `, [questId, userId]);
      if (!created.affectedRows) return res.status(409).json({ message: "You already contributed today" });
      const [[countRow]] = await db.query("SELECT COUNT(*) AS total FROM vine_community_quest_checkins WHERE quest_id = ?", [questId]);
      const progress = getQuestProgress(countRow?.total, quest.target_count);
      if (progress.complete) {
        await db.query("UPDATE vine_community_quests SET status = 'completed' WHERE id = ?", [questId]);
      }
      res.json({ success: true, ...progress });
    } catch (err) {
      console.error("Community quest check-in error:", err);
      res.status(500).json({ message: "Failed to add your contribution" });
    }
  });

  router.delete("/communities/:id/quests/:questId", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await ensureDelightSchema();
      const communityId = Number(req.params.id);
      const role = await getCommunityRole(communityId, Number(req.user.id));
      if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Only community admins can remove quests" });
      const questId = Number(req.params.questId);
      const [result] = await db.query("DELETE FROM vine_community_quests WHERE id = ? AND community_id = ? LIMIT 1", [questId, communityId]);
      if (!result.affectedRows) return res.status(404).json({ message: "Quest not found" });
      await db.query("DELETE FROM vine_community_quest_checkins WHERE quest_id = ?", [questId]);
      res.json({ success: true });
    } catch (err) {
      console.error("Community quest delete error:", err);
      res.status(500).json({ message: "Failed to remove quest" });
    }
  });

  return router;
}
