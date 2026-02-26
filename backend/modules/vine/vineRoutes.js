import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../server.js";
import { sendVineWelcomeEmail, sendVineResetCodeEmail, sendVineVerificationCodeEmail, sendVineSuspensionEmail, sendVineUnsuspensionEmail, sendVineWarningEmail } from "../../utils/email.js";
import authMiddleware from "../../middleware/authMiddleware.js";
import authOptional from "../authOptional.js";
import { authenticate } from "../auth.js";
import { uploadAvatarMemory, uploadBannerMemory } from "../../middleware/upload.js";
import { io } from "../../server.js"; 
import { uploadPostCloudinary } from "../../middleware/upload.js";
import cloudinary from "../../config/cloudinary.js";
import sharp from "sharp";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "vine_secret_key";

const extractPublicId = (url) => {
  const parts = url.split("/");
  const filename = parts.pop().split(".")[0]; // abc123
  const folder = parts.slice(parts.indexOf("upload") + 1).join("/");
  return `${folder}/${filename}`;
};

const isUserBlocked = async (blockerId, blockedId) => {
  if (!blockerId || !blockedId) return false;
  const [rows] = await db.query(
    "SELECT 1 FROM vine_blocks WHERE blocker_id = ? AND blocked_id = ? LIMIT 1",
    [blockerId, blockedId]
  );
  return rows.length > 0;
};

const isUserMuted = async (muterId, mutedId) => {
  if (!muterId || !mutedId) return false;
  const [rows] = await db.query(
    "SELECT 1 FROM vine_mutes WHERE muter_id = ? AND muted_id = ? LIMIT 1",
    [muterId, mutedId]
  );
  return rows.length > 0;
};

const isMutedBy = async (muterId, mutedId) => {
  return isUserMuted(muterId, mutedId);
};

const isModeratorAccount = (user) => {
  if (!user) return false;
  if (Number(user.is_admin) === 1) return true;
  if (String(user.role || "").toLowerCase() === "moderator") return true;
  return ["vine guardian","vine_guardian"].includes(String(user.username || "").toLowerCase());
};

const hasTable = async (dbName, tableName) => {
  const [rows] = await db.query(
    `
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    LIMIT 1
    `,
    [dbName, tableName]
  );
  return rows.length > 0;
};

const hasColumn = async (dbName, tableName, columnName) => {
  const [rows] = await db.query(
    `
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [dbName, tableName, columnName]
  );
  return rows.length > 0;
};

let cachedDbName = null;
const getDbName = async () => {
  if (cachedDbName) return cachedDbName;
  const [[row]] = await db.query("SELECT DATABASE() AS dbName");
  cachedDbName = row?.dbName || null;
  return cachedDbName;
};

const getGuardianRecipientIds = async () => {
  const [rows] = await db.query(
    `
    SELECT id
    FROM vine_users
    WHERE is_admin = 1
       OR LOWER(COALESCE(role, '')) = 'moderator'
       OR LOWER(username) IN ('vine guardian', 'vine_guardian')
    `
  );
  return rows.map((r) => Number(r.id)).filter(Boolean);
};

const notifyGuardians = async ({ actorId, type, postId = null, commentId = null, meta = null }) => {
  const guardianIds = await getGuardianRecipientIds();
  if (!guardianIds.length) return;
  const dbName = await getDbName();
  const canStoreMeta = dbName
    ? await hasColumn(dbName, "vine_notifications", "meta_json")
    : false;
  for (const guardianId of guardianIds) {
    if (Number(guardianId) === Number(actorId)) continue;
    if (canStoreMeta) {
      await db.query(
        `
        INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id, meta_json)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [guardianId, actorId, type, postId, commentId, meta ? JSON.stringify(meta) : null]
      );
    } else {
      await db.query(
        `
        INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id)
        VALUES (?, ?, ?, ?, ?)
        `,
        [guardianId, actorId, type, postId, commentId]
      );
    }
    io.to(`user-${guardianId}`).emit("notification");
  }
};

const getActiveInteractionSuspension = async (userId) => {
  if (!userId) return null;
  const dbName = await getDbName();
  if (!dbName) return null;
  const tableExists = await hasTable(dbName, "vine_user_suspensions");
  if (!tableExists) return null;

  const [rows] = await db.query(
    `
    SELECT id, reason, scope, starts_at, ends_at
    FROM vine_user_suspensions
    WHERE user_id = ?
      AND is_active = 1
      AND scope IN ('likes_comments', 'all')
      AND starts_at <= NOW()
      AND (ends_at IS NULL OR ends_at > NOW())
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [userId]
  );
  return rows[0] || null;
};

let eulaSchemaReady = false;
const ensureEulaSchema = async () => {
  if (eulaSchemaReady) return;
  const dbName = await getDbName();
  if (!dbName) return;

  const hasAcceptedAt = await hasColumn(dbName, "vine_users", "eula_accepted_at");
  if (!hasAcceptedAt) {
    await db.query("ALTER TABLE vine_users ADD COLUMN eula_accepted_at DATETIME NULL");
  }

  const hasVersion = await hasColumn(dbName, "vine_users", "eula_version");
  if (!hasVersion) {
    await db.query("ALTER TABLE vine_users ADD COLUMN eula_version VARCHAR(20) NULL");
  }

  eulaSchemaReady = true;
};

let profileAboutSchemaReady = false;
const ensureProfileAboutSchema = async () => {
  if (profileAboutSchemaReady) return;
  const dbName = await getDbName();
  if (!dbName) return;

  const addIfMissing = async (column, definition) => {
    const exists = await hasColumn(dbName, "vine_users", column);
    if (!exists) {
      await db.query(`ALTER TABLE vine_users ADD COLUMN ${column} ${definition}`);
    }
  };

  await addIfMissing("hobbies", "TEXT NULL");
  await addIfMissing("date_of_birth", "DATE NULL");
  await addIfMissing("favorite_movies", "TEXT NULL");
  await addIfMissing("favorite_songs", "TEXT NULL");
  await addIfMissing("favorite_musicians", "TEXT NULL");
  await addIfMissing("favorite_books", "TEXT NULL");
  await addIfMissing("movie_genres", "TEXT NULL");
  await addIfMissing("gender", "VARCHAR(50) NULL");
  await addIfMissing("contact_email", "VARCHAR(120) NULL");
  await addIfMissing("phone_number", "VARCHAR(40) NULL");
  await addIfMissing("tiktok_username", "VARCHAR(100) NULL");
  await addIfMissing("instagram_username", "VARCHAR(100) NULL");
  await addIfMissing("twitter_username", "VARCHAR(100) NULL");
  await addIfMissing("about_privacy", "VARCHAR(20) NOT NULL DEFAULT 'everyone'");

  profileAboutSchemaReady = true;
};

let communitySchemaReady = false;
const slugifyCommunityName = (value = "") =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const ensureCommunitySchema = async () => {
  if (communitySchemaReady) return;
  const dbName = await getDbName();
  if (!dbName) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_communities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      slug VARCHAR(80) NOT NULL UNIQUE,
      description VARCHAR(280) NULL,
      avatar_url VARCHAR(500) NULL,
      banner_url VARCHAR(500) NULL,
      join_policy VARCHAR(20) NOT NULL DEFAULT 'open',
      post_permission VARCHAR(20) NOT NULL DEFAULT 'all',
      auto_welcome_enabled TINYINT(1) NOT NULL DEFAULT 1,
      welcome_message VARCHAR(280) NULL,
      is_private TINYINT(1) NOT NULL DEFAULT 0,
      creator_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      community_id INT NOT NULL,
      user_id INT NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'member',
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_community_member (community_id, user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_join_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      community_id INT NOT NULL,
      user_id INT NOT NULL,
      answers_json TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME NULL,
      reviewed_by INT NULL,
      UNIQUE KEY uniq_community_request (community_id, user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_rules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      community_id INT NOT NULL,
      rule_text VARCHAR(240) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_join_questions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      community_id INT NOT NULL,
      question_text VARCHAR(240) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      community_id INT NOT NULL,
      creator_id INT NOT NULL,
      title VARCHAR(140) NOT NULL,
      description TEXT NULL,
      starts_at DATETIME NOT NULL,
      location VARCHAR(180) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      community_id INT NOT NULL,
      reporter_id INT NOT NULL,
      post_id INT NULL,
      comment_id INT NULL,
      reason VARCHAR(280) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      reviewed_by INT NULL,
      reviewed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_scheduled_posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      community_id INT NOT NULL,
      user_id INT NOT NULL,
      content TEXT NULL,
      image_url LONGTEXT NULL,
      link_preview LONGTEXT NULL,
      topic_tag VARCHAR(50) NULL,
      run_at DATETIME NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const hasCommunityId = await hasColumn(dbName, "vine_posts", "community_id");
  if (!hasCommunityId) {
    await db.query("ALTER TABLE vine_posts ADD COLUMN community_id INT NULL");
  }

  const hasJoinPolicy = await hasColumn(dbName, "vine_communities", "join_policy");
  if (!hasJoinPolicy) {
    await db.query("ALTER TABLE vine_communities ADD COLUMN join_policy VARCHAR(20) NOT NULL DEFAULT 'open'");
  }
  const hasCommunityAvatar = await hasColumn(dbName, "vine_communities", "avatar_url");
  if (!hasCommunityAvatar) {
    await db.query("ALTER TABLE vine_communities ADD COLUMN avatar_url VARCHAR(500) NULL");
  }
  const hasCommunityBanner = await hasColumn(dbName, "vine_communities", "banner_url");
  if (!hasCommunityBanner) {
    await db.query("ALTER TABLE vine_communities ADD COLUMN banner_url VARCHAR(500) NULL");
  }
  const hasPostPermission = await hasColumn(dbName, "vine_communities", "post_permission");
  if (!hasPostPermission) {
    await db.query("ALTER TABLE vine_communities ADD COLUMN post_permission VARCHAR(20) NOT NULL DEFAULT 'all'");
  }
  const hasAutoWelcome = await hasColumn(dbName, "vine_communities", "auto_welcome_enabled");
  if (!hasAutoWelcome) {
    await db.query("ALTER TABLE vine_communities ADD COLUMN auto_welcome_enabled TINYINT(1) NOT NULL DEFAULT 1");
  }
  const hasWelcomeMessage = await hasColumn(dbName, "vine_communities", "welcome_message");
  if (!hasWelcomeMessage) {
    await db.query("ALTER TABLE vine_communities ADD COLUMN welcome_message VARCHAR(280) NULL");
  }
  const hasAnswersJson = await hasColumn(dbName, "vine_community_join_requests", "answers_json");
  if (!hasAnswersJson) {
    await db.query("ALTER TABLE vine_community_join_requests ADD COLUMN answers_json TEXT NULL");
  }
  const hasPinned = await hasColumn(dbName, "vine_posts", "is_community_pinned");
  if (!hasPinned) {
    await db.query("ALTER TABLE vine_posts ADD COLUMN is_community_pinned TINYINT(1) NOT NULL DEFAULT 0");
  }
  const hasPinnedAt = await hasColumn(dbName, "vine_posts", "community_pinned_at");
  if (!hasPinnedAt) {
    await db.query("ALTER TABLE vine_posts ADD COLUMN community_pinned_at DATETIME NULL");
  }
  const hasPinnedBy = await hasColumn(dbName, "vine_posts", "community_pinned_by");
  if (!hasPinnedBy) {
    await db.query("ALTER TABLE vine_posts ADD COLUMN community_pinned_by INT NULL");
  }
  const hasTopicTag = await hasColumn(dbName, "vine_posts", "topic_tag");
  if (!hasTopicTag) {
    await db.query("ALTER TABLE vine_posts ADD COLUMN topic_tag VARCHAR(50) NULL");
  }

  communitySchemaReady = true;
};

let moderationSchemaReady = false;
const ensureColumnExists = async (dbName, tableName, columnName, definitionSql) => {
  const exists = await hasColumn(dbName, tableName, columnName);
  if (exists) return;
  await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
};

const ensureModerationSchema = async () => {
  if (moderationSchemaReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reporter_id INT NOT NULL,
      reported_user_id INT NULL,
      post_id INT NULL,
      comment_id INT NULL,
      reason TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      reviewed_by INT NULL,
      reviewed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_reports_status_created (status, created_at),
      INDEX idx_reports_post (post_id),
      INDEX idx_reports_comment (comment_id),
      INDEX idx_reports_reported_user (reported_user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_user_suspensions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      scope VARCHAR(30) NOT NULL DEFAULT 'likes_comments',
      reason TEXT NULL,
      starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ends_at DATETIME NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_susp_user_active (user_id, is_active, starts_at, ends_at)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_appeals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      reviewed_by INT NULL,
      reviewed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_appeals_status_created (status, created_at),
      INDEX idx_appeals_user (user_id)
    )
  `);

  const dbName = await getDbName();
  if (dbName) {
    // Backfill missing columns for pre-existing moderation tables.
    await ensureColumnExists(dbName, "vine_reports", "reporter_id", "INT NOT NULL");
    await ensureColumnExists(dbName, "vine_reports", "reported_user_id", "INT NULL");
    await ensureColumnExists(dbName, "vine_reports", "post_id", "INT NULL");
    await ensureColumnExists(dbName, "vine_reports", "comment_id", "INT NULL");
    await ensureColumnExists(dbName, "vine_reports", "reason", "TEXT NOT NULL");
    await ensureColumnExists(dbName, "vine_reports", "status", "VARCHAR(20) NOT NULL DEFAULT 'open'");
    await ensureColumnExists(dbName, "vine_reports", "reviewed_by", "INT NULL");
    await ensureColumnExists(dbName, "vine_reports", "reviewed_at", "DATETIME NULL");
    await ensureColumnExists(dbName, "vine_reports", "created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");

    await ensureColumnExists(dbName, "vine_user_suspensions", "user_id", "INT NOT NULL");
    await ensureColumnExists(dbName, "vine_user_suspensions", "scope", "VARCHAR(30) NOT NULL DEFAULT 'likes_comments'");
    await ensureColumnExists(dbName, "vine_user_suspensions", "reason", "TEXT NULL");
    await ensureColumnExists(dbName, "vine_user_suspensions", "starts_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await ensureColumnExists(dbName, "vine_user_suspensions", "ends_at", "DATETIME NULL");
    await ensureColumnExists(dbName, "vine_user_suspensions", "is_active", "TINYINT(1) NOT NULL DEFAULT 1");
    await ensureColumnExists(dbName, "vine_user_suspensions", "created_by", "INT NOT NULL");
    await ensureColumnExists(dbName, "vine_user_suspensions", "created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");

    await ensureColumnExists(dbName, "vine_appeals", "user_id", "INT NOT NULL");
    await ensureColumnExists(dbName, "vine_appeals", "message", "TEXT NOT NULL");
    await ensureColumnExists(dbName, "vine_appeals", "status", "VARCHAR(20) NOT NULL DEFAULT 'open'");
    await ensureColumnExists(dbName, "vine_appeals", "reviewed_by", "INT NULL");
    await ensureColumnExists(dbName, "vine_appeals", "reviewed_at", "DATETIME NULL");
    await ensureColumnExists(dbName, "vine_appeals", "created_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");

    await ensureColumnExists(dbName, "vine_notifications", "meta_json", "LONGTEXT NULL");
  }

  moderationSchemaReady = true;
};

let statusSchemaReady = false;
const ensureStatusSchema = async () => {
  if (statusSchemaReady) return;
  const dbName = await getDbName();
  if (!dbName) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_statuses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      text_content VARCHAR(500) NOT NULL,
      media_url TEXT NULL,
      media_type VARCHAR(20) NULL,
      bg_color VARCHAR(30) NOT NULL DEFAULT '#0f766e',
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      INDEX idx_status_user_created (user_id, created_at),
      INDEX idx_status_expires (expires_at)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_status_views (
      id INT AUTO_INCREMENT PRIMARY KEY,
      status_id INT NOT NULL,
      viewer_id INT NOT NULL,
      viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_status_view (status_id, viewer_id),
      INDEX idx_status_viewer (viewer_id, viewed_at)
    )
  `);

  await ensureColumnExists(dbName, "vine_statuses", "media_url", "TEXT NULL");
  await ensureColumnExists(dbName, "vine_statuses", "media_type", "VARCHAR(20) NULL");

  statusSchemaReady = true;
};

const isHeicFile = (file) => {
  const name = file?.originalname || "";
  const type = file?.mimetype || "";
  return (
    /heic|heif/i.test(type) ||
    /\.heic$/i.test(name) ||
    /\.heif$/i.test(name)
  );
};

const isVideoFile = (file) => {
  const type = String(file?.mimetype || "").toLowerCase();
  const name = String(file?.originalname || "").toLowerCase();
  if (type.startsWith("video/")) return true;
  return /\.(mp4|mov|webm|m4v|avi|mkv|ogv)$/i.test(name);
};

const uploadBufferToCloudinary = async (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });

// Text status (24h) - create
router.post("/statuses", requireVineAuth, uploadPostCloudinary.single("media"), async (req, res) => {
  try {
    await ensureStatusSchema();
    const userId = req.user.id;
    const text = String(req.body?.text || "").trim();
    const bg = String(req.body?.bg_color || "#0f766e").trim().slice(0, 30);
    const file = req.file || null;
    if (!text && !file) return res.status(400).json({ message: "Status text or media required" });
    if (text.length > 500) return res.status(400).json({ message: "Status too long" });

    let mediaUrl = null;
    let mediaType = null;

    if (file) {
      if (isVideoFile(file)) {
        const uploaded = await uploadBufferToCloudinary(file.buffer, {
          folder: "vine/statuses",
          resource_type: "video",
        });
        mediaUrl = uploaded.secure_url;
        mediaType = "video";
      } else {
        const normalized = await normalizeImageBuffer(file);
        const uploaded = await uploadBufferToCloudinary(normalized.buffer, {
          folder: "vine/statuses",
          resource_type: "image",
        });
        mediaUrl = uploaded.secure_url;
        mediaType = "image";
      }
    }

    const [result] = await db.query(
      `
      INSERT INTO vine_statuses (user_id, text_content, media_url, media_type, bg_color, expires_at)
      VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))
      `,
      [userId, text || "", mediaUrl, mediaType, bg || "#0f766e"]
    );

    const [[row]] = await db.query(
      `
      SELECT id, user_id, text_content, media_url, media_type, bg_color, created_at, expires_at
      FROM vine_statuses
      WHERE id = ?
      LIMIT 1
      `,
      [result.insertId]
    );
    res.json(row);
  } catch (err) {
    console.error("Create status error:", err);
    res.status(500).json({ message: "Failed to create status" });
  }
});

// Status rail for feed
router.get("/statuses/rail", requireVineAuth, async (req, res) => {
  try {
    await ensureStatusSchema();
    const viewerId = req.user.id;

    const [rows] = await db.query(
      `
      SELECT
        s.user_id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        MAX(s.created_at) AS latest_created_at,
        COUNT(*) AS status_count,
        SUM(
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM vine_status_views sv
              WHERE sv.status_id = s.id
                AND sv.viewer_id = ?
            ) THEN 0 ELSE 1
          END
        ) AS unseen_count
      FROM vine_statuses s
      JOIN vine_users u ON u.id = s.user_id
      WHERE s.is_deleted = 0
        AND s.expires_at > NOW()
        AND NOT EXISTS (
          SELECT 1
          FROM vine_blocks b
          WHERE (b.blocker_id = s.user_id AND b.blocked_id = ?)
             OR (b.blocker_id = ? AND b.blocked_id = s.user_id)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM vine_mutes m
          WHERE m.muter_id = ?
            AND m.muted_id = s.user_id
        )
      GROUP BY s.user_id, u.username, u.display_name, u.avatar_url, u.is_verified
      ORDER BY (s.user_id = ?) DESC, latest_created_at DESC
      LIMIT 100
      `,
      [viewerId, viewerId, viewerId, viewerId, viewerId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Status rail error:", err);
    res.status(500).json([]);
  }
});

// Active statuses for one user
router.get("/statuses/user/:userId", requireVineAuth, async (req, res) => {
  try {
    await ensureStatusSchema();
    const viewerId = req.user.id;
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json([]);

    const [[targetUser]] = await db.query(
      "SELECT id, is_private FROM vine_users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!targetUser) return res.status(404).json([]);

    const [rows] = await db.query(
      `
      SELECT
        s.id,
        s.user_id,
        s.text_content,
        s.media_url,
        s.media_type,
        s.bg_color,
        s.created_at,
        s.expires_at,
        EXISTS (
          SELECT 1 FROM vine_status_views sv
          WHERE sv.status_id = s.id AND sv.viewer_id = ?
        ) AS seen_by_viewer
      FROM vine_statuses s
      WHERE s.user_id = ?
        AND s.is_deleted = 0
        AND s.expires_at > NOW()
      ORDER BY s.created_at ASC
      `,
      [viewerId, userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Status user feed error:", err);
    res.status(500).json([]);
  }
});

// Mark status seen
router.post("/statuses/:id/view", requireVineAuth, async (req, res) => {
  try {
    await ensureStatusSchema();
    const statusId = Number(req.params.id);
    const viewerId = req.user.id;
    if (!statusId) return res.status(400).json({ success: false });

    await db.query(
      `
      INSERT INTO vine_status_views (status_id, viewer_id, viewed_at)
      VALUES (?, ?, NOW())
      ON DUPLICATE KEY UPDATE viewed_at = VALUES(viewed_at)
      `,
      [statusId, viewerId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Status view error:", err);
    res.status(500).json({ success: false });
  }
});

// Delete own status
router.delete("/statuses/:id", requireVineAuth, async (req, res) => {
  try {
    await ensureStatusSchema();
    const statusId = Number(req.params.id);
    const userId = Number(req.user.id);
    if (!statusId) return res.status(400).json({ success: false, message: "Invalid status id" });

    const [result] = await db.query(
      `
      UPDATE vine_statuses
      SET is_deleted = 1, expires_at = NOW()
      WHERE id = ? AND user_id = ?
      LIMIT 1
      `,
      [statusId, userId]
    );

    if (!result?.affectedRows) {
      return res.status(404).json({ success: false, message: "Status not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Status delete error:", err);
    res.status(500).json({ success: false, message: "Failed to delete status" });
  }
});

// Status viewers (owner only)
router.get("/statuses/:id/views", requireVineAuth, async (req, res) => {
  try {
    await ensureStatusSchema();
    const statusId = Number(req.params.id);
    const userId = Number(req.user.id);
    if (!statusId) return res.status(400).json([]);

    const [[statusRow]] = await db.query(
      `
      SELECT id, user_id
      FROM vine_statuses
      WHERE id = ? AND is_deleted = 0
      LIMIT 1
      `,
      [statusId]
    );
    if (!statusRow) return res.status(404).json([]);
    if (Number(statusRow.user_id) !== userId) return res.status(403).json([]);

    const [rows] = await db.query(
      `
      SELECT
        sv.viewer_id AS id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        sv.viewed_at
      FROM vine_status_views sv
      JOIN vine_users u ON u.id = sv.viewer_id
      WHERE sv.status_id = ?
      ORDER BY sv.viewed_at DESC
      `,
      [statusId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Status views fetch error:", err);
    res.status(500).json([]);
  }
});

const normalizeImageBuffer = async (file) => {
  if (!file?.buffer) {
    return { buffer: Buffer.alloc(0), mimetype: "image/jpeg" };
  }
  if (isHeicFile(file)) {
    try {
      const buffer = await sharp(file.buffer)
        .jpeg({ quality: 90 })
        .toBuffer();
      return { buffer, mimetype: "image/jpeg" };
    } catch (err) {
      console.warn("HEIC decode failed, sending original file to Cloudinary", err);
      return { buffer: file.buffer, mimetype: file.mimetype || "image/heic" };
    }
  }
  return { buffer: file.buffer, mimetype: file.mimetype || "image/jpeg" };
};

const extractFirstUrl = (text) => {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  if (!match) return null;
  return match[0].replace(/[)\].,!?]+$/g, "");
};

const extractMentions = (text) => {
  if (!text) return [];
  const matches = text.match(/@([a-zA-Z0-9._]{1,30})/g) || [];
  const names = matches.map((m) => m.slice(1));
  return Array.from(new Set(names.map((n) => n.toLowerCase())));
};

const notifyMentions = async ({ mentions, actorId, postId, commentId, type }) => {
  if (!mentions?.length) return;
  const placeholders = mentions.map(() => "?").join(", ");
  const [users] = await db.query(
    `SELECT id, username FROM vine_users WHERE LOWER(username) IN (${placeholders})`,
    mentions
  );

  for (const user of users) {
    if (Number(user.id) === Number(actorId)) continue;
    if (await isUserBlocked(user.id, actorId)) continue;
    if (await isUserBlocked(actorId, user.id)) continue;
    if (await isMutedBy(user.id, actorId)) continue;

    await db.query(
      `INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id)
       VALUES (?, ?, ?, ?, ?)`,
      [user.id, actorId, type, postId, commentId || null]
    );

    io.to(`user-${user.id}`).emit("notification");
  }
};

const isPrivateHostname = (hostname) => {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local")) return true;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) {
    const parts = h.split(".").map((n) => Number(n));
    if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  }
  if (h === "::1" || h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) {
    return true;
  }
  return false;
};

const fetchLinkPreview = async (url) => {
  try {
    const parsed = new URL(url);
    if (isPrivateHostname(parsed.hostname)) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(parsed.href, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; VineBot/1.0)",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const html = (await res.text()).slice(0, 1_000_000);
    const getMeta = (key) => {
      const re = new RegExp(
        `<meta[^>]+(?:property|name)=[\"']${key}[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>`,
        "i"
      );
      const match = html.match(re);
      return match ? match[1].trim() : null;
    };
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = getMeta("og:title") || (titleTag ? titleTag[1].trim() : null) || parsed.hostname;
    const description = getMeta("og:description") || getMeta("description");
    const image = getMeta("og:image");
    const imageUrl = image ? new URL(image, parsed.href).href : null;
    const siteName = getMeta("og:site_name") || parsed.hostname;

    return {
      url: parsed.href,
      title,
      description,
      image: imageUrl,
      site_name: siteName,
      domain: parsed.hostname,
    };
  } catch (err) {
    return null;
  }
};

router.post("/auth/register", async (req, res) => {
  try {
    const { username, display_name, email, password, accepted_eula, eula_version } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }
    if (accepted_eula !== true) {
      return res.status(400).json({ message: "You must agree to Vine Terms before creating an account." });
    }
    await ensureEulaSchema();
    const agreedVersion = String(eula_version || "v1").slice(0, 20);

    // Check duplicate
    const [existing] = await db.query(
      "SELECT id FROM vine_users WHERE username = ? LIMIT 1",
      [username]
    );

    if (existing.length) {
      return res.status(400).json({ message: "Username already taken" });
    }

    const hash = await bcrypt.hash(password, 10);

    const [insertResult] = await db.query(
      `INSERT INTO vine_users (username, display_name, email, password_hash)
       VALUES (?, ?, ?, ?)`,
      [username, display_name || null, email || null, hash]
    );

    await db.query(
      "UPDATE vine_users SET eula_accepted_at = NOW(), eula_version = ? WHERE id = ?",
      [agreedVersion, insertResult.insertId]
    );

    // ✅ Send welcome email (non-blocking safe version)
    if (email) {
      sendVineWelcomeEmail(email, display_name || username)
        .then(() => console.log("📧 Vine welcome email sent"))
        .catch(err => console.warn("⚠️ Email failed but signup succeeded:", err.message));
    }

    res.json({ message: "Account created successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Registration failed" });
  }
});

router.post("/auth/login", async (req, res) => {
    console.log("BODY:", req.body);

    try {
      const { identifier, password } = req.body;
  
      if (!identifier || !password) {
        return res.status(400).json({ message: "Missing credentials" });
      }
  
      const [rows] = await db.query(
        "SELECT * FROM vine_users WHERE username = ? OR email = ? LIMIT 1",
        [identifier, identifier]
      );
  
      if (!rows.length) {
        return res.status(401).json({ message: "Invalid login" });
      }
  
      const user = rows[0];
  
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ message: "Invalid login" });
      }
  
      const token = jwt.sign(
        {
          id: user.id,
          username: user.username,
          is_admin: user.is_admin,
          role: user.role || "user",
          badge_type: user.badge_type || null,
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      // Optional analytics event: no-op if table does not exist
      try {
        await db.query(
          "INSERT INTO vine_login_events (user_id, created_at) VALUES (?, NOW())",
          [user.id]
        );
      } catch (_) {}
  
      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          is_admin: user.is_admin,
          role: user.role || "user",
          badge_type: user.badge_type || null,
        }
      });
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Login failed" });
    }
  });
  
  function auth(req, res, next) {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ message: "No token" });
  
    try {
      const token = header.split(" ")[1];
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ message: "Invalid token" });
    }
  }

// middleware
async function requireVineAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: "No token" });

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // 🔑 UPDATE LAST ACTIVE
    await db.query(
      "UPDATE vine_users SET last_active_at = NOW() WHERE id = ?",
      [req.user.id]
    );

    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

const getCommunityRole = async (communityId, userId) => {
  const [[row]] = await db.query(
    `
    SELECT role
    FROM vine_community_members
    WHERE community_id = ? AND user_id = ?
    LIMIT 1
    `,
    [communityId, userId]
  );
  return row?.role || null;
};

const isCommunityModOrOwner = (role) =>
  ["owner", "moderator"].includes(String(role || "").toLowerCase());

const isMemberOfPostCommunity = async (postId, userId) => {
  const [[post]] = await db.query(
    "SELECT id, community_id FROM vine_posts WHERE id = ? LIMIT 1",
    [postId]
  );
  if (!post) return { exists: false, allowed: false, community_id: null };
  if (!post.community_id) return { exists: true, allowed: true, community_id: null };

  const [membership] = await db.query(
    "SELECT 1 FROM vine_community_members WHERE community_id = ? AND user_id = ? LIMIT 1",
    [post.community_id, userId]
  );
  return {
    exists: true,
    allowed: membership.length > 0,
    community_id: Number(post.community_id),
  };
};

const extractTopicTag = (content = "") => {
  const m = String(content).match(/#([a-zA-Z0-9_]{2,40})/);
  return m ? m[1].toLowerCase() : null;
};

const publishDueScheduledPosts = async () => {
  await ensureCommunitySchema();
  const [rows] = await db.query(
    `
    SELECT *
    FROM vine_scheduled_posts
    WHERE status = 'pending'
      AND run_at <= NOW()
    ORDER BY run_at ASC
    LIMIT 50
    `
  );
  for (const row of rows) {
    try {
      await db.query(
        `
        INSERT INTO vine_posts
          (user_id, community_id, content, image_url, link_preview, topic_tag)
        VALUES
          (?, ?, ?, ?, ?, ?)
        `,
        [
          row.user_id,
          row.community_id,
          row.content || null,
          row.image_url || null,
          row.link_preview || null,
          row.topic_tag || null,
        ]
      );
      await db.query(
        "UPDATE vine_scheduled_posts SET status = 'published' WHERE id = ?",
        [row.id]
      );
    } catch (e) {
      console.error("Publish scheduled post failed:", e);
    }
  }
};

router.get("/communities", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const [rows] = await db.query(
      `
      SELECT
        c.id,
        c.name,
        c.slug,
        c.description,
        c.avatar_url,
        c.banner_url,
        c.join_policy,
        c.post_permission,
        c.auto_welcome_enabled,
        c.welcome_message,
        c.is_private,
        c.creator_id,
        c.created_at,
        (SELECT COUNT(*) FROM vine_community_members m WHERE m.community_id = c.id) AS member_count,
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

router.post("/communities", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const joinPolicy = ["open", "approval", "closed"].includes(String(req.body?.join_policy || "").trim())
      ? String(req.body.join_policy).trim()
      : "open";
    if (!name || name.length < 3) {
      return res.status(400).json({ message: "Community name must be at least 3 characters" });
    }

    let baseSlug = slugifyCommunityName(name) || `community-${Date.now()}`;
    let slug = baseSlug;
    let suffix = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const [exists] = await db.query("SELECT 1 FROM vine_communities WHERE slug = ? LIMIT 1", [slug]);
      if (!exists.length) break;
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const [created] = await db.query(
      `
      INSERT INTO vine_communities (name, slug, description, creator_id, join_policy)
      VALUES (?, ?, ?, ?, ?)
      `,
      [name.slice(0, 80), slug, description.slice(0, 280) || null, userId, joinPolicy]
    );

    await db.query(
      `
      INSERT INTO vine_community_members (community_id, user_id, role)
      VALUES (?, ?, 'owner')
      `,
      [created.insertId, userId]
    );

    const [[community]] = await db.query(
      "SELECT id, name, slug, description, join_policy, post_permission, auto_welcome_enabled, welcome_message, is_private, creator_id, created_at FROM vine_communities WHERE id = ?",
      [created.insertId]
    );
    res.json(community);
  } catch (err) {
    console.error("Create community error:", err);
    res.status(500).json({ message: "Failed to create community" });
  }
});

router.post("/communities/:id/join", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json({ message: "Invalid community" });

    const [[community]] = await db.query(
      "SELECT id, join_policy, creator_id, auto_welcome_enabled, welcome_message, name FROM vine_communities WHERE id = ? LIMIT 1",
      [communityId]
    );
    if (!community) return res.status(404).json({ message: "Community not found" });

    const [[alreadyMember]] = await db.query(
      "SELECT role FROM vine_community_members WHERE community_id = ? AND user_id = ? LIMIT 1",
      [communityId, userId]
    );
    if (alreadyMember) return res.json({ success: true, status: "member" });

    if (community.join_policy === "closed") {
      return res.status(403).json({ message: "This community is closed to new members" });
    }

    if (community.join_policy === "approval") {
      const answers = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 10) : [];
      await db.query(
        `
        INSERT INTO vine_community_join_requests (community_id, user_id, answers_json, status)
        VALUES (?, ?, ?, 'pending')
        ON DUPLICATE KEY UPDATE answers_json = VALUES(answers_json), status = 'pending', reviewed_at = NULL, reviewed_by = NULL
        `,
        [communityId, userId, JSON.stringify(answers)]
      );
      return res.json({ success: true, status: "pending" });
    }

    await db.query(
      `
      INSERT INTO vine_community_members (community_id, user_id, role)
      VALUES (?, ?, 'member')
      ON DUPLICATE KEY UPDATE role = role
      `,
      [communityId, userId]
    );
    if (Number(community.auto_welcome_enabled) === 1) {
      const message = (community.welcome_message || "").trim() || `Welcome to ${community.name}!`;
      await db.query(
        `
        INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id)
        VALUES (?, ?, 'community_welcome', NULL, NULL)
        `,
        [userId, community.creator_id]
      );
      io.to(`user-${userId}`).emit("notification");
      console.log(`Community welcome: ${message}`);
    }
    res.json({ success: true, status: "member" });
  } catch (err) {
    console.error("Join community error:", err);
    res.status(500).json({ message: "Failed to join community" });
  }
});

router.delete("/communities/:id/leave", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json({ message: "Invalid community" });

    await db.query(
      "DELETE FROM vine_community_members WHERE community_id = ? AND user_id = ? AND role != 'owner'",
      [communityId, userId]
    );
    await db.query(
      "DELETE FROM vine_community_join_requests WHERE community_id = ? AND user_id = ?",
      [communityId, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Leave community error:", err);
    res.status(500).json({ message: "Failed to leave community" });
  }
});

router.get("/communities/:slug", authOptional, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const viewerId = req.user?.id || 0;
    const [[community]] = await db.query(
      `
      SELECT
        c.id,
        c.name,
        c.slug,
        c.description,
        c.avatar_url,
        c.banner_url,
        c.join_policy,
        c.post_permission,
        c.auto_welcome_enabled,
        c.welcome_message,
        c.is_private,
        c.creator_id,
        c.created_at,
        (SELECT COUNT(*) FROM vine_community_members m WHERE m.community_id = c.id) AS member_count,
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
    res.json(community);
  } catch (err) {
    console.error("Get community error:", err);
    res.status(500).json({ message: "Failed to load community" });
  }
});

router.get("/communities/:slug/members", authOptional, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const limit = Math.min(24, Math.max(1, Number(req.query.limit || 8)));
    const [[community]] = await db.query(
      "SELECT id FROM vine_communities WHERE slug = ? LIMIT 1",
      [req.params.slug]
    );
    if (!community) return res.status(404).json([]);

    const [rows] = await db.query(
      `
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        m.role,
        m.joined_at
      FROM vine_community_members m
      JOIN vine_users u ON u.id = m.user_id
      WHERE m.community_id = ?
      ORDER BY
        CASE m.role
          WHEN 'owner' THEN 0
          WHEN 'moderator' THEN 1
          ELSE 2
        END,
        m.joined_at ASC
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

router.get("/communities/:id/requests", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json([]);

    const [[roleRow]] = await db.query(
      `
      SELECT role
      FROM vine_community_members
      WHERE community_id = ? AND user_id = ?
      LIMIT 1
      `,
      [communityId, userId]
    );
    if (!roleRow || !["owner", "moderator"].includes(String(roleRow.role || "").toLowerCase())) {
      return res.status(403).json([]);
    }

    const [rows] = await db.query(
      `
      SELECT
        r.id,
        r.user_id,
        r.status,
        r.answers_json,
        r.created_at,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified
      FROM vine_community_join_requests r
      JOIN vine_users u ON u.id = r.user_id
      WHERE r.community_id = ?
        AND r.status = 'pending'
      ORDER BY r.created_at ASC
      LIMIT 100
      `,
      [communityId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get community requests error:", err);
    res.status(500).json([]);
  }
});

router.patch("/communities/:id/settings", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const joinPolicy = String(req.body?.join_policy || "").trim();
    const postPermission = String(req.body?.post_permission || "").trim();
    const autoWelcomeEnabled = req.body?.auto_welcome_enabled;
    const welcomeMessage = String(req.body?.welcome_message || "").trim();
    if (!communityId) return res.status(400).json({ message: "Invalid community" });
    if (!["open", "approval", "closed"].includes(joinPolicy)) {
      return res.status(400).json({ message: "Invalid join policy" });
    }
    if (postPermission && !["all", "mods_only"].includes(postPermission)) {
      return res.status(400).json({ message: "Invalid post permission" });
    }

    const [[roleRow]] = await db.query(
      `
      SELECT role
      FROM vine_community_members
      WHERE community_id = ? AND user_id = ?
      LIMIT 1
      `,
      [communityId, userId]
    );
    if (!roleRow || String(roleRow.role || "").toLowerCase() !== "owner") {
      return res.status(403).json({ message: "Only community owner can change settings" });
    }

    await db.query(
      `
      UPDATE vine_communities
      SET join_policy = ?,
          post_permission = ?,
          auto_welcome_enabled = ?,
          welcome_message = ?
      WHERE id = ?
      `,
      [
        joinPolicy,
        postPermission || "all",
        autoWelcomeEnabled === undefined ? 1 : Number(Boolean(autoWelcomeEnabled)),
        welcomeMessage || null,
        communityId,
      ]
    );
    res.json({
      success: true,
      join_policy: joinPolicy,
      post_permission: postPermission || "all",
      auto_welcome_enabled: autoWelcomeEnabled === undefined ? 1 : Number(Boolean(autoWelcomeEnabled)),
      welcome_message: welcomeMessage || null,
    });
  } catch (err) {
    console.error("Update community settings error:", err);
    res.status(500).json({ message: "Failed to update settings" });
  }
});

router.post(
  "/communities/:id/avatar",
  authenticate,
  uploadAvatarMemory.single("avatar"),
  async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = req.user.id;
      const communityId = Number(req.params.id);
      if (!communityId) return res.status(400).json({ message: "Invalid community" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const role = await getCommunityRole(communityId, userId);
      if (!isCommunityModOrOwner(role)) {
        return res.status(403).json({ message: "Only owner/moderators can change community avatar" });
      }

      const normalized = await normalizeImageBuffer(req.file);
      const upload = await cloudinary.uploader.upload(
        `data:${normalized.mimetype};base64,${normalized.buffer.toString("base64")}`,
        {
          folder: "vine/community_avatars",
          transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
        }
      );

      await db.query("UPDATE vine_communities SET avatar_url = ? WHERE id = ?", [upload.secure_url, communityId]);
      res.json({ avatar_url: upload.secure_url });
    } catch (err) {
      console.error("Community avatar upload error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  }
);

router.post(
  "/communities/:id/banner",
  authenticate,
  uploadBannerMemory.single("banner"),
  async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = req.user.id;
      const communityId = Number(req.params.id);
      if (!communityId) return res.status(400).json({ message: "Invalid community" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const role = await getCommunityRole(communityId, userId);
      if (!isCommunityModOrOwner(role)) {
        return res.status(403).json({ message: "Only owner/moderators can change community banner" });
      }

      const normalized = await normalizeImageBuffer(req.file);
      const upload = await cloudinary.uploader.upload(
        `data:${normalized.mimetype};base64,${normalized.buffer.toString("base64")}`,
        {
          folder: "vine/community_banners",
          transformation: [{ width: 1500, height: 500, crop: "fill" }],
        }
      );

      await db.query("UPDATE vine_communities SET banner_url = ? WHERE id = ?", [upload.secure_url, communityId]);
      res.json({ banner_url: upload.secure_url });
    } catch (err) {
      console.error("Community banner upload error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  }
);

router.get("/communities/:id/rules", authOptional, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json([]);
    const [rows] = await db.query(
      `
      SELECT id, rule_text, sort_order, created_at
      FROM vine_community_rules
      WHERE community_id = ?
      ORDER BY sort_order ASC, id ASC
      `,
      [communityId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get community rules error:", err);
    res.status(500).json([]);
  }
});

router.post("/communities/:id/rules", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const text = String(req.body?.rule_text || "").trim();
    if (!communityId || !text) return res.status(400).json({ message: "Invalid rule" });

    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });

    await db.query(
      `
      INSERT INTO vine_community_rules (community_id, rule_text, sort_order)
      VALUES (?, ?, ?)
      `,
      [communityId, text.slice(0, 240), Number(req.body?.sort_order || 0)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Add community rule error:", err);
    res.status(500).json({ message: "Failed to add rule" });
  }
});

router.delete("/communities/:id/rules/:ruleId", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const ruleId = Number(req.params.ruleId);
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });
    await db.query(
      "DELETE FROM vine_community_rules WHERE id = ? AND community_id = ?",
      [ruleId, communityId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Delete community rule error:", err);
    res.status(500).json({ message: "Failed to delete rule" });
  }
});

router.get("/communities/:id/questions", authOptional, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json([]);
    const [rows] = await db.query(
      `
      SELECT id, question_text, sort_order, created_at
      FROM vine_community_join_questions
      WHERE community_id = ?
      ORDER BY sort_order ASC, id ASC
      `,
      [communityId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get community questions error:", err);
    res.status(500).json([]);
  }
});

router.post("/communities/:id/questions", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const question = String(req.body?.question_text || "").trim();
    if (!communityId || !question) return res.status(400).json({ message: "Invalid question" });
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });

    await db.query(
      `
      INSERT INTO vine_community_join_questions (community_id, question_text, sort_order)
      VALUES (?, ?, ?)
      `,
      [communityId, question.slice(0, 240), Number(req.body?.sort_order || 0)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Add community question error:", err);
    res.status(500).json({ message: "Failed to add question" });
  }
});

router.delete("/communities/:id/questions/:questionId", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const questionId = Number(req.params.questionId);
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });
    await db.query(
      "DELETE FROM vine_community_join_questions WHERE id = ? AND community_id = ?",
      [questionId, communityId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Delete community question error:", err);
    res.status(500).json({ message: "Failed to delete question" });
  }
});

router.patch("/communities/:id/members/:memberId/role", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const memberId = Number(req.params.memberId);
    const nextRole = String(req.body?.role || "").trim();
    if (!communityId || !memberId) return res.status(400).json({ message: "Invalid request" });
    if (!["member", "moderator"].includes(nextRole)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (String(role || "").toLowerCase() !== "owner") {
      return res.status(403).json({ message: "Only owner can change roles" });
    }
    await db.query(
      `
      UPDATE vine_community_members
      SET role = ?
      WHERE community_id = ? AND user_id = ? AND role != 'owner'
      `,
      [nextRole, communityId, memberId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Update member role error:", err);
    res.status(500).json({ message: "Failed to update role" });
  }
});

router.post("/communities/:id/scheduled-posts", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const content = String(req.body?.content || "").trim();
    const runAt = String(req.body?.run_at || "").trim();
    if (!communityId || !content || !runAt) {
      return res.status(400).json({ message: "content and run_at are required" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ message: "Join this community first" });
    const runDate = new Date(runAt);
    if (Number.isNaN(runDate.getTime()) || runDate.getTime() <= Date.now()) {
      return res.status(400).json({ message: "run_at must be in the future" });
    }
    const topicTag = extractTopicTag(content);
    await db.query(
      `
      INSERT INTO vine_scheduled_posts (community_id, user_id, content, run_at, topic_tag)
      VALUES (?, ?, ?, ?, ?)
      `,
      [communityId, userId, content, runDate, topicTag]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Create scheduled post error:", err);
    res.status(500).json({ message: "Failed to schedule post" });
  }
});

router.get("/communities/:id/scheduled-posts", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json([]);
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json([]);
    const [rows] = await db.query(
      `
      SELECT id, user_id, content, run_at, status, created_at
      FROM vine_scheduled_posts
      WHERE community_id = ? AND status = 'pending'
      ORDER BY run_at ASC
      `,
      [communityId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get scheduled posts error:", err);
    res.status(500).json([]);
  }
});

router.post("/communities/:id/events", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const title = String(req.body?.title || "").trim();
    const startsAt = String(req.body?.starts_at || "").trim();
    const description = String(req.body?.description || "").trim();
    const location = String(req.body?.location || "").trim();
    if (!communityId || !title || !startsAt) return res.status(400).json({ message: "title and starts_at required" });
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });
    await db.query(
      `
      INSERT INTO vine_community_events (community_id, creator_id, title, description, starts_at, location)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [communityId, userId, title.slice(0, 140), description || null, new Date(startsAt), location || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Create community event error:", err);
    res.status(500).json({ message: "Failed to create event" });
  }
});

router.get("/communities/:slug/events", authOptional, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const [[community]] = await db.query("SELECT id FROM vine_communities WHERE slug = ? LIMIT 1", [req.params.slug]);
    if (!community) return res.status(404).json([]);
    const [rows] = await db.query(
      `
      SELECT id, title, description, starts_at, location, created_at
      FROM vine_community_events
      WHERE community_id = ?
      ORDER BY starts_at ASC
      LIMIT 100
      `,
      [community.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get community events error:", err);
    res.status(500).json([]);
  }
});

router.get("/communities/:slug/media", authOptional, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const [[community]] = await db.query("SELECT id FROM vine_communities WHERE slug = ? LIMIT 1", [req.params.slug]);
    if (!community) return res.status(404).json([]);
    const [rows] = await db.query(
      `
      SELECT id, image_url, content, created_at
      FROM vine_posts
      WHERE community_id = ?
        AND image_url IS NOT NULL
        AND image_url != ''
      ORDER BY created_at DESC
      LIMIT 200
      `,
      [community.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get community media error:", err);
    res.status(500).json([]);
  }
});

router.get("/communities/:id/reputation", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json([]);
    const [rows] = await db.query(
      `
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) AS posts_count,
        SUM(CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END) AS comments_count,
        SUM(CASE WHEN l.id IS NOT NULL THEN 1 ELSE 0 END) AS likes_received
      FROM vine_community_members m
      JOIN vine_users u ON u.id = m.user_id
      LEFT JOIN vine_posts p ON p.user_id = u.id AND p.community_id = ?
      LEFT JOIN vine_comments c ON c.user_id = u.id AND c.post_id IN (SELECT id FROM vine_posts WHERE community_id = ?)
      LEFT JOIN vine_likes l ON l.post_id = p.id
      WHERE m.community_id = ?
      GROUP BY u.id, u.username, u.display_name, u.avatar_url, u.is_verified
      ORDER BY (SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) * 3 + SUM(CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END) + SUM(CASE WHEN l.id IS NOT NULL THEN 1 ELSE 0 END)) DESC
      LIMIT 20
      `,
      [communityId, communityId, communityId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get community reputation error:", err);
    res.status(500).json([]);
  }
});

router.post("/communities/:id/reports", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const communityId = Number(req.params.id);
    const reporterId = req.user.id;
    const postId = req.body?.post_id ? Number(req.body.post_id) : null;
    const commentId = req.body?.comment_id ? Number(req.body.comment_id) : null;
    const reason = String(req.body?.reason || "").trim();
    if (!communityId || !reason || (!postId && !commentId)) {
      return res.status(400).json({ message: "Invalid report" });
    }
    await db.query(
      `
      INSERT INTO vine_community_reports (community_id, reporter_id, post_id, comment_id, reason, status)
      VALUES (?, ?, ?, ?, ?, 'open')
      `,
      [communityId, reporterId, postId, commentId, reason.slice(0, 280)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Create community report error:", err);
    res.status(500).json({ message: "Failed to submit report" });
  }
});

router.get("/communities/:id/reports", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json([]);
    const [rows] = await db.query(
      `
      SELECT
        r.id,
        r.post_id,
        r.comment_id,
        r.reason,
        r.status,
        r.created_at,
        u.username AS reporter_username,
        u.display_name AS reporter_display_name
      FROM vine_community_reports r
      JOIN vine_users u ON u.id = r.reporter_id
      WHERE r.community_id = ?
      ORDER BY r.created_at DESC
      LIMIT 150
      `,
      [communityId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get community reports error:", err);
    res.status(500).json([]);
  }
});

router.patch("/communities/:id/reports/:reportId", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const reportId = Number(req.params.reportId);
    const status = String(req.body?.status || "").trim();
    if (!communityId || !reportId || !["open", "resolved", "dismissed"].includes(status)) {
      return res.status(400).json({ message: "Invalid request" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });
    await db.query(
      `
      UPDATE vine_community_reports
      SET status = ?, reviewed_at = NOW(), reviewed_by = ?
      WHERE id = ? AND community_id = ?
      `,
      [status, userId, reportId, communityId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Update community report error:", err);
    res.status(500).json({ message: "Failed to update report" });
  }
});

router.post("/communities/:id/posts/:postId/pin", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const postId = Number(req.params.postId);
    if (!communityId || !postId) return res.status(400).json({ message: "Invalid request" });
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });
    await db.query(
      `
      UPDATE vine_posts
      SET is_community_pinned = 1, community_pinned_at = NOW(), community_pinned_by = ?
      WHERE id = ? AND community_id = ?
      `,
      [userId, postId, communityId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Pin community post error:", err);
    res.status(500).json({ message: "Failed to pin post" });
  }
});

router.delete("/communities/:id/posts/:postId/pin", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const postId = Number(req.params.postId);
    if (!communityId || !postId) return res.status(400).json({ message: "Invalid request" });
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });
    await db.query(
      `
      UPDATE vine_posts
      SET is_community_pinned = 0, community_pinned_at = NULL, community_pinned_by = NULL
      WHERE id = ? AND community_id = ?
      `,
      [postId, communityId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Unpin community post error:", err);
    res.status(500).json({ message: "Failed to unpin post" });
  }
});

router.post("/communities/:id/requests/:requestId/approve", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const requestId = Number(req.params.requestId);
    if (!communityId || !requestId) return res.status(400).json({ message: "Invalid request" });

    const [[roleRow]] = await db.query(
      `
      SELECT role
      FROM vine_community_members
      WHERE community_id = ? AND user_id = ?
      LIMIT 1
      `,
      [communityId, userId]
    );
    if (!roleRow || !["owner", "moderator"].includes(String(roleRow.role || "").toLowerCase())) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const [[requestRow]] = await db.query(
      `
      SELECT user_id, status
      FROM vine_community_join_requests
      WHERE id = ? AND community_id = ?
      LIMIT 1
      `,
      [requestId, communityId]
    );
    if (!requestRow) return res.status(404).json({ message: "Request not found" });
    if (requestRow.status !== "pending") return res.status(400).json({ message: "Request already handled" });

    await db.query(
      `
      INSERT INTO vine_community_members (community_id, user_id, role)
      VALUES (?, ?, 'member')
      ON DUPLICATE KEY UPDATE role = role
      `,
      [communityId, requestRow.user_id]
    );

    await db.query(
      `
      UPDATE vine_community_join_requests
      SET status = 'approved', reviewed_at = NOW(), reviewed_by = ?
      WHERE id = ?
      `,
      [userId, requestId]
    );

    const [[community]] = await db.query(
      "SELECT creator_id, auto_welcome_enabled, welcome_message, name FROM vine_communities WHERE id = ? LIMIT 1",
      [communityId]
    );
    if (community && Number(community.auto_welcome_enabled) === 1) {
      await db.query(
        `
        INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id)
        VALUES (?, ?, 'community_welcome', NULL, NULL)
        `,
        [requestRow.user_id, community.creator_id]
      );
      io.to(`user-${requestRow.user_id}`).emit("notification");
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Approve community request error:", err);
    res.status(500).json({ message: "Failed to approve request" });
  }
});

router.post("/communities/:id/requests/:requestId/reject", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = req.user.id;
    const communityId = Number(req.params.id);
    const requestId = Number(req.params.requestId);
    if (!communityId || !requestId) return res.status(400).json({ message: "Invalid request" });

    const [[roleRow]] = await db.query(
      `
      SELECT role
      FROM vine_community_members
      WHERE community_id = ? AND user_id = ?
      LIMIT 1
      `,
      [communityId, userId]
    );
    if (!roleRow || !["owner", "moderator"].includes(String(roleRow.role || "").toLowerCase())) {
      return res.status(403).json({ message: "Not allowed" });
    }

    await db.query(
      `
      UPDATE vine_community_join_requests
      SET status = 'rejected', reviewed_at = NOW(), reviewed_by = ?
      WHERE id = ? AND community_id = ? AND status = 'pending'
      `,
      [userId, requestId, communityId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Reject community request error:", err);
    res.status(500).json({ message: "Failed to reject request" });
  }
});

router.get("/communities/:slug/posts", authOptional, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await publishDueScheduledPosts();
    const viewerId = req.user?.id || null;
    const topic = String(req.query?.topic || "").trim().toLowerCase();
    const [[community]] = await db.query(
      "SELECT id, name, slug FROM vine_communities WHERE slug = ? LIMIT 1",
      [req.params.slug]
    );
    if (!community) return res.status(404).json([]);

    const [posts] = await db.query(
      `
      SELECT
        CONCAT('post-', p.id) AS feed_id,
        p.id,
        p.user_id,
        p.community_id,
        p.topic_tag,
        p.is_community_pinned,
        c.name AS community_name,
        c.slug AS community_slug,
        p.content,
        p.image_url,
        p.link_preview,
        p.created_at AS sort_time,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        u.hide_like_counts,
        NULL AS revined_by,
        NULL AS reviner_username,
        (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
        (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
        (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,
        (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS views,
        ${viewerId ? `(SELECT COUNT(*) > 0 FROM vine_likes WHERE post_id = p.id AND user_id = ${viewerId})` : "0"} AS user_liked,
        ${viewerId ? `(SELECT COUNT(*) > 0 FROM vine_revines WHERE post_id = p.id AND user_id = ${viewerId})` : "0"} AS user_revined,
        ${viewerId ? `(SELECT COUNT(*) > 0 FROM vine_bookmarks WHERE post_id = p.id AND user_id = ${viewerId})` : "0"} AS user_bookmarked
      FROM vine_posts p
      JOIN vine_users u ON u.id = p.user_id
      LEFT JOIN vine_communities c ON c.id = p.community_id
      WHERE p.community_id = ?
      ${topic ? "AND p.topic_tag = ?" : ""}
      ORDER BY p.is_community_pinned DESC, COALESCE(p.community_pinned_at, p.created_at) DESC, p.created_at DESC
      LIMIT 100
      `,
      topic ? [community.id, topic] : [community.id]
    );
    res.json(posts);
  } catch (err) {
    console.error("Get community posts error:", err);
    res.status(500).json([]);
  }
});

  // create posts
  router.get("/posts", authOptional, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await publishDueScheduledPosts();
      const viewerId = req.user?.id || null;
      const feedTag = String(req.query.tag || "").trim().replace(/^#/, "").toLowerCase();
      const tagFilterSql = feedTag
        ? ` AND (LOWER(COALESCE(p.content, '')) LIKE ${db.escape(`%#${feedTag}%`)} OR LOWER(COALESCE(p.topic_tag, '')) = ${db.escape(feedTag)})`
        : "";
  
      const [rows] = await db.query(`
        SELECT *
        FROM (
          -- Normal posts
          SELECT 
            CONCAT('post-', p.id) AS feed_id,
            p.id,
            p.user_id,
            p.community_id,
            p.topic_tag,
            p.is_community_pinned,
            c.name AS community_name,
            c.slug AS community_slug,
            ${
              viewerId
                ? `CASE
                    WHEN p.community_id IS NULL THEN 1
                    WHEN EXISTS (
                      SELECT 1
                      FROM vine_community_members cm
                      WHERE cm.community_id = p.community_id
                        AND cm.user_id = ${viewerId}
                    ) THEN 1
                    ELSE 0
                  END`
                : "CASE WHEN p.community_id IS NULL THEN 1 ELSE 0 END"
            } AS viewer_community_member,
            p.content,
            p.image_url,
            p.link_preview,
            p.created_at AS sort_time,
            u.username,
            u.display_name,
            u.avatar_url,
            u.is_verified,
            u.hide_like_counts,
            NULL AS revined_by,
            NULL AS reviner_username,
  
            (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
            (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
            (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,
            (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS views,
  
            ${
              viewerId
                ? `(SELECT COUNT(*) > 0 FROM vine_likes WHERE post_id = p.id AND user_id = ${viewerId})`
                : "0"
            } AS user_liked,
  
            ${
              viewerId
                ? `(SELECT COUNT(*) > 0 FROM vine_revines WHERE post_id = p.id AND user_id = ${viewerId})`
                : "0"
            } AS user_revined,

            ${
              viewerId
                ? `(SELECT COUNT(*) > 0 FROM vine_bookmarks WHERE post_id = p.id AND user_id = ${viewerId})`
                : "0"
            } AS user_bookmarked
  
          FROM vine_posts p
          JOIN vine_users u ON p.user_id = u.id
          LEFT JOIN vine_communities c ON c.id = p.community_id
          WHERE ${
            viewerId
              ? `(u.is_private = 0 OR u.id = ${viewerId} OR EXISTS (
                    SELECT 1 FROM vine_follows
                    WHERE follower_id = ${viewerId} AND following_id = u.id
                  ))`
              : "u.is_private = 0"
          }
          ${
            viewerId
              ? ` AND NOT EXISTS (
                    SELECT 1 FROM vine_blocks b
                    WHERE (b.blocker_id = u.id AND b.blocked_id = ${viewerId})
                       OR (b.blocker_id = ${viewerId} AND b.blocked_id = u.id)
                  )`
              : ""
          }
          ${
            viewerId
              ? ` AND NOT EXISTS (
                    SELECT 1 FROM vine_mutes m
                    WHERE m.muter_id = ${viewerId} AND m.muted_id = u.id
                  )`
              : ""
          }
          ${tagFilterSql}
  
          UNION ALL
  
          -- Revines
          SELECT 
            CONCAT('revine-', r.id) AS feed_id,
            p.id,
            p.user_id,
            p.community_id,
            p.topic_tag,
            p.is_community_pinned,
            c.name AS community_name,
            c.slug AS community_slug,
            ${
              viewerId
                ? `CASE
                    WHEN p.community_id IS NULL THEN 1
                    WHEN EXISTS (
                      SELECT 1
                      FROM vine_community_members cm
                      WHERE cm.community_id = p.community_id
                        AND cm.user_id = ${viewerId}
                    ) THEN 1
                    ELSE 0
                  END`
                : "CASE WHEN p.community_id IS NULL THEN 1 ELSE 0 END"
            } AS viewer_community_member,
            p.content,
            p.image_url,
            p.link_preview,
            r.created_at AS sort_time,
            u.username,
            u.display_name,
            u.avatar_url,
            u.is_verified,
            u.hide_like_counts,
            r.user_id AS revined_by,
            ru.username AS reviner_username,
  
            (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
            (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
            (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,
            (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS views,
  
            ${
              viewerId
                ? `(SELECT COUNT(*) > 0 FROM vine_likes WHERE post_id = p.id AND user_id = ${viewerId})`
                : "0"
            } AS user_liked,
  
            ${
              viewerId
                ? `(SELECT COUNT(*) > 0 FROM vine_revines WHERE post_id = p.id AND user_id = ${viewerId})`
                : "0"
            } AS user_revined,

            ${
              viewerId
                ? `(SELECT COUNT(*) > 0 FROM vine_bookmarks WHERE post_id = p.id AND user_id = ${viewerId})`
                : "0"
            } AS user_bookmarked
  
          FROM vine_revines r
          JOIN vine_posts p ON r.post_id = p.id
          JOIN vine_users u ON p.user_id = u.id
          LEFT JOIN vine_communities c ON c.id = p.community_id
          JOIN vine_users ru ON r.user_id = ru.id
          WHERE ${
            viewerId
              ? `(u.is_private = 0 OR u.id = ${viewerId} OR EXISTS (
                    SELECT 1 FROM vine_follows
                    WHERE follower_id = ${viewerId} AND following_id = u.id
                  ))`
              : "u.is_private = 0"
          }
          ${
            viewerId
              ? ` AND NOT EXISTS (
                    SELECT 1 FROM vine_blocks b
                    WHERE (b.blocker_id = u.id AND b.blocked_id = ${viewerId})
                       OR (b.blocker_id = ${viewerId} AND b.blocked_id = u.id)
                  )`
              : ""
          }
          ${
            viewerId
              ? ` AND NOT EXISTS (
                    SELECT 1 FROM vine_mutes m
                    WHERE m.muter_id = ${viewerId} AND m.muted_id = u.id
                  )`
              : ""
          }
          ${tagFilterSql}
        ) feed
        ORDER BY sort_time DESC
        LIMIT 100
      `);
  
      res.json(rows);
    } catch (err) {
      console.error("Feed error:", err);
      res.status(500).json([]);
    }
  });
  // Create new post(with image to TL)
  router.post(
    "/posts",
    requireVineAuth,
    uploadPostCloudinary.array("images", 10),
    async (req, res) => {
      try {
        await ensureCommunitySchema();
        const userId = req.user.id;
        const { content } = req.body;
        const communityId =
          req.body?.community_id !== undefined &&
          req.body?.community_id !== null &&
          String(req.body.community_id).trim() !== ""
            ? Number(req.body.community_id)
            : null;
  
        let imageUrls = [];
  
        if (req.files?.length) {
          const uploads = await Promise.all(
            req.files.map(async (file) => {
              if (isVideoFile(file)) {
                return uploadBufferToCloudinary(file.buffer, {
                  folder: "vine/posts",
                  resource_type: "video",
                });
              }
              const normalized = await normalizeImageBuffer(file);
              return uploadBufferToCloudinary(normalized.buffer, {
                folder: "vine/posts",
                resource_type: "image",
              });
            })
          );
  
          imageUrls = uploads.map(u => u.secure_url);
        }
  
        if ((!content || !content.trim()) && imageUrls.length === 0) {
          return res.status(400).json({ message: "Post cannot be empty" });
        }

        if (communityId) {
          const [[community]] = await db.query(
            "SELECT id, post_permission FROM vine_communities WHERE id = ? LIMIT 1",
            [communityId]
          );
          if (!community) {
            return res.status(404).json({ message: "Community not found" });
          }
          const [[membership]] = await db.query(
            `
            SELECT role
            FROM vine_community_members
            WHERE community_id = ? AND user_id = ?
            LIMIT 1
            `,
            [communityId, userId]
          );
          if (!membership) {
            return res.status(403).json({ message: "Join this community to post" });
          }
          if (
            String(community.post_permission || "all") === "mods_only" &&
            !isCommunityModOrOwner(membership.role)
          ) {
            return res.status(403).json({ message: "Only moderators can post in this community" });
          }
        }
  
        const image_url =
          imageUrls.length > 0 ? JSON.stringify(imageUrls) : null;
  
        let linkPreview = null;
        const firstUrl = extractFirstUrl(content?.trim() || "");
        if (firstUrl) {
          linkPreview = await fetchLinkPreview(firstUrl);
        }

        const topicTag = extractTopicTag(content?.trim() || "");
        const [result] = await db.query(
          `INSERT INTO vine_posts (user_id, community_id, content, image_url, link_preview, topic_tag)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            userId,
            communityId,
            content?.trim() || null,
            image_url,
            linkPreview ? JSON.stringify(linkPreview) : null,
            topicTag,
          ]
        );

        const mentions = extractMentions(content?.trim() || "");
        await notifyMentions({
          mentions,
          actorId: userId,
          postId: result.insertId,
          commentId: null,
          type: "mention_post",
        });
  
        const [[post]] = await db.query(`
          SELECT 
            CONCAT('post-', p.id) AS feed_id,
            p.id,
            p.user_id,
            p.community_id,
            p.topic_tag,
            p.is_community_pinned,
            c.name AS community_name,
            c.slug AS community_slug,
            p.content,
            p.image_url,
            p.link_preview,
            p.created_at AS sort_time,
            u.username,
            u.display_name,
            u.avatar_url,
            NULL AS revined_by,
            NULL AS reviner_username,
            0 AS likes,
            0 AS comments,
            0 AS revines,
            0 AS views,
            0 AS user_liked,
            0 AS user_revined,
            0 AS user_bookmarked
          FROM vine_posts p
          JOIN vine_users u ON p.user_id = u.id
          LEFT JOIN vine_communities c ON c.id = p.community_id
          WHERE p.id = ?
        `, [result.insertId]);
  
        res.json(post);
      } catch (err) {
        console.error("Create post error:", err);
        res.status(500).json({ message: "Failed to create post" });
      }
    }
  );
    
/* =========================
   SEARCH USERS
========================= */
router.get("/users/search", authenticate, async (req, res) => {
  console.log("🔥 Vine search route registered");

  const q = req.query.q?.trim();

  if (!q || q.length < 1) {
    return res.json([]);
  }

  try {
    const viewerId = req.user?.id || null;
    const [rows] = await db.query(
      `
      SELECT 
        id,
        username,
        display_name,
        avatar_url,
        is_verified
      FROM vine_users
      WHERE (username LIKE ? OR display_name LIKE ?)
        AND id != ${viewerId || 0}
        AND NOT EXISTS (
          SELECT 1 FROM vine_follows f
          WHERE f.follower_id = ${viewerId || 0}
            AND f.following_id = id
        )
        AND NOT EXISTS (
          SELECT 1 FROM vine_mutes m
          WHERE m.muter_id = ${viewerId || 0}
            AND m.muted_id = id
        )
        ${
          viewerId
            ? `AND NOT EXISTS (
                SELECT 1 FROM vine_blocks b
                WHERE (b.blocker_id = id AND b.blocked_id = ${viewerId})
                   OR (b.blocker_id = ${viewerId} AND b.blocked_id = id)
              )`
            : ""
        }
      ORDER BY username ASC
      LIMIT 20
      `,
      [`%${q}%`, `%${q}%`]
    );

    res.json(rows);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json([]);
  }

});

// 🔐 Forgot password (send 4-digit code)
router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const [[user]] = await db.query(
      "SELECT id FROM vine_users WHERE email = ?",
      [email]
    );

    // Always respond success to avoid account enumeration
    if (!user) {
      return res.json({ success: true });
    }

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await db.query(
      "UPDATE vine_users SET reset_token = ?, reset_expires = ? WHERE id = ?",
      [code, expires, user.id]
    );

    await sendVineResetCodeEmail(email, code);

    res.json({ success: true });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ message: "Failed to send reset code" });
  }
});

// 🔐 Reset password with code
router.post("/auth/reset-password-code", async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: "Missing fields" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password too short" });
    }

    const [[user]] = await db.query(
      "SELECT id, reset_token, reset_expires FROM vine_users WHERE email = ?",
      [email]
    );

    if (!user || !user.reset_token || !user.reset_expires) {
      return res.status(400).json({ message: "Invalid code" });
    }

    const expired = new Date(user.reset_expires).getTime() < Date.now();
    if (expired || String(user.reset_token) !== String(code)) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query(
      "UPDATE vine_users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?",
      [hash, user.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Reset password code error:", err);
    res.status(500).json({ message: "Failed to reset password" });
  }
});

// 🔐 Request email verification code
router.post("/users/me/verify-email", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await db.query(
      `UPDATE vine_users
       SET email = ?, is_verified = 0, email_verify_token = ?, email_verify_expires = ?
       WHERE id = ?`,
      [email, code, expires, userId]
    );

    await sendVineVerificationCodeEmail(email, code);
    res.json({ success: true });
  } catch (err) {
    console.error("Verify email request error:", err);
    res.status(500).json({ message: "Failed to send verification code" });
  }
});

// 🔐 Confirm verification code
router.post("/users/me/verify-email-code", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: "Code required" });

    const [[user]] = await db.query(
      "SELECT id, email_verify_token, email_verify_expires FROM vine_users WHERE id = ?",
      [userId]
    );

    if (!user || !user.email_verify_expires) {
      return res.status(400).json({ message: "Invalid code" });
    }

    const expired = new Date(user.email_verify_expires).getTime() < Date.now();
    if (expired || String(user.email_verify_token) !== String(code)) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    await db.query(
      `UPDATE vine_users
       SET is_verified = 1, email_verify_token = NULL, email_verify_expires = NULL
       WHERE id = ?`,
      [userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Verify email code error:", err);
    res.status(500).json({ message: "Verification failed" });
  }
});

// Mention autocomplete
router.get("/users/mention", authenticate, async (req, res) => {
  const q = req.query.q?.trim();
  if (!q || q.length < 1) return res.json([]);

  try {
    const viewerId = req.user?.id || null;
    const [rows] = await db.query(
      `
      SELECT id, username, display_name, avatar_url, is_verified
      FROM vine_users
      WHERE (username LIKE ? OR display_name LIKE ?)
        AND id != ${viewerId || 0}
        ${
          viewerId
            ? `AND NOT EXISTS (
                SELECT 1 FROM vine_blocks b
                WHERE (b.blocker_id = id AND b.blocked_id = ${viewerId})
                   OR (b.blocker_id = ${viewerId} AND b.blocked_id = id)
              )`
            : ""
        }
      ORDER BY username ASC
      LIMIT 8
      `,
      [`${q}%`, `%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error("Mention search error:", err);
    res.status(500).json([]);
  }
});

// New Viners / Suggestions
router.get("/users/new", authOptional, async (req, res) => {
  try {
    const viewerId = req.user?.id;

    if (!viewerId) {
      return res.json([]);
    }

    const [rows] = await db.query(`
      SELECT 
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified
      FROM vine_users u
      WHERE u.id != ?
        AND u.id NOT IN (
          SELECT following_id
          FROM vine_follows
          WHERE follower_id = ?
        )
        AND u.id NOT IN (
          SELECT muted_id
          FROM vine_mutes
          WHERE muter_id = ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM vine_blocks b
          WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
             OR (b.blocker_id = ? AND b.blocked_id = u.id)
        )
      ORDER BY u.created_at DESC
    `, [viewerId, viewerId, viewerId, viewerId, viewerId]);

    res.json(rows);
  } catch (err) {
    console.error("Suggestions error:", err);
    res.status(500).json([]);
  }
});

// user profile
router.get("/users/:username", authOptional, async (req, res) => {
  try {
    await ensureProfileAboutSchema();
    const { username } = req.params;
    const viewerId = req.user?.id || null;

    // 1. Get user + counts + follow state
    const [[user]] = await db.query(
      `
      SELECT 
        u.id, 
        u.username, 
        u.display_name, 
        u.bio, 
        u.avatar_url, 
        u.banner_url,
        u.location,
        u.website,
        u.hobbies,
        u.date_of_birth,
        u.favorite_movies,
        u.favorite_songs,
        u.favorite_musicians,
        u.favorite_books,
        u.movie_genres,
        u.gender,
        u.contact_email,
        u.phone_number,
        u.tiktok_username,
        u.instagram_username,
        u.twitter_username,
        u.about_privacy,
        u.created_at,
        u.last_active_at,
        u.is_verified,
        u.dm_privacy,
        u.is_private,
        u.hide_like_counts,
        u.show_last_active,

        (SELECT COUNT(*) FROM vine_follows WHERE following_id = u.id) AS follower_count,
        (SELECT COUNT(*) FROM vine_follows WHERE follower_id = u.id) AS following_count,

        ${
          viewerId
            ? `(SELECT COUNT(*) > 0 
                 FROM vine_follows 
                 WHERE follower_id = ${viewerId} 
                 AND following_id = u.id)`
            : "0"
        } AS is_following,

        ${
          viewerId
            ? `(SELECT COUNT(*) > 0 
                 FROM vine_follows 
                 WHERE follower_id = u.id 
                 AND following_id = ${viewerId})`
            : "0"
        } AS is_followed_by

      FROM vine_users u
      WHERE u.username = ?
      `,
      [username]
    );

    if (!user) return res.status(404).json({ message: "Not found" });

    const isSelf = viewerId && Number(viewerId) === Number(user.id);
    const isFollowing =
      viewerId && Number(user.is_following) === 1;

    const canViewAbout =
      isSelf ||
      user.about_privacy === "everyone" ||
      (user.about_privacy === "followers" && isFollowing);

    const blockedByUser = await isUserBlocked(user.id, viewerId);
    const blockingUser = await isUserBlocked(viewerId, user.id);

    if (!isSelf && blockedByUser) {
      return res.json({ user, posts: [], blocked: true });
    }

    user.is_blocking = blockingUser ? 1 : 0;
    user.is_muting = (await isUserMuted(viewerId, user.id)) ? 1 : 0;

    if (!isSelf && !user.show_last_active) {
      user.last_active_at = null;
    }

    if (!canViewAbout) {
      user.hobbies = null;
      user.date_of_birth = null;
      user.favorite_movies = null;
      user.favorite_songs = null;
      user.favorite_musicians = null;
      user.favorite_books = null;
      user.movie_genres = null;
      user.gender = null;
      user.contact_email = null;
      user.phone_number = null;
      user.tiktok_username = null;
      user.instagram_username = null;
      user.twitter_username = null;
    }

    // 2. Posts + Revines (stable keys + correct ordering)
    const [posts] = await db.query(
      `
      SELECT *
      FROM (
        -- Normal posts
        SELECT 
          CONCAT('post-', p.id) AS feed_id,
          p.id,
          p.user_id,
          p.content,
          p.image_url,
          p.link_preview,
          p.created_at,
          p.is_pinned,
          p.created_at AS sort_time,

          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.hide_like_counts,

          NULL AS reviner_username,
          0 AS revined_by,

          (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
          (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
          (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,
          (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS views,

          ${
            viewerId
              ? `(SELECT COUNT(*) > 0 FROM vine_likes WHERE post_id = p.id AND user_id = ${viewerId})`
              : "0"
          } AS user_liked,

          ${
            viewerId
              ? `(SELECT COUNT(*) > 0 FROM vine_revines WHERE post_id = p.id AND user_id = ${viewerId})`
              : "0"
          } AS user_revined

        FROM vine_posts p
        JOIN vine_users u ON p.user_id = u.id
        WHERE p.user_id = ?

        UNION ALL

        -- Revines
        SELECT 
          CONCAT('revine-', r.id) AS feed_id,
          p.id,
          p.user_id,
          p.content,
          p.image_url,
          p.link_preview,
          p.created_at,
          p.is_pinned,
          r.created_at AS sort_time,

          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.hide_like_counts,

          ru.username AS reviner_username,
          1 AS revined_by,

          (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
          (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
          (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,
          (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS views,

          ${
            viewerId
              ? `(SELECT COUNT(*) > 0 FROM vine_likes WHERE post_id = p.id AND user_id = ${viewerId})`
              : "0"
          } AS user_liked,

          ${
            viewerId
              ? `(SELECT COUNT(*) > 0 FROM vine_revines WHERE post_id = p.id AND user_id = ${viewerId})`
              : "0"
          } AS user_revined

        FROM vine_revines r
        JOIN vine_posts p ON r.post_id = p.id
        JOIN vine_users u ON p.user_id = u.id
        JOIN vine_users ru ON r.user_id = ru.id
        WHERE r.user_id = ?
      ) profile_feed
      ORDER BY is_pinned DESC, sort_time DESC
      `,
      [user.id, user.id]
    );

    if (user.is_private && !isSelf && !isFollowing) {
      return res.json({ user, posts: [], privateLocked: true });
    }

    res.json({ user, posts });

  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: "Failed to load profile" });
  }
});
// Get comments for post (threaded, enriched)
router.get("/posts/:id/likes", authOptional, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    if (!postId) return res.status(400).json({ total: 0, latest: null, users: [] });

    const [[post]] = await db.query("SELECT id FROM vine_posts WHERE id = ? LIMIT 1", [postId]);
    if (!post) return res.status(404).json({ total: 0, latest: null, users: [] });

    const [[count]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_likes WHERE post_id = ?",
      [postId]
    );

    const [users] = await db.query(
      `
      SELECT
        u.id,
        u.username,
        u.display_name,
        COALESCE(u.avatar_url, '/default-avatar.png') AS avatar_url,
        u.is_verified,
        l.created_at AS liked_at
      FROM vine_likes l
      JOIN vine_users u ON u.id = l.user_id
      WHERE l.post_id = ?
      ORDER BY l.created_at DESC
      LIMIT ?
      `,
      [postId, limit]
    );

    res.json({
      total: Number(count?.total || 0),
      latest: users[0] || null,
      users,
    });
  } catch (err) {
    console.error("Fetch post likes failed:", err);
    res.status(500).json({ total: 0, latest: null, users: [] });
  }
});

// Get comments for post (threaded, enriched)
router.get("/posts/:id/comments", authOptional, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user?.id || 0;

    const [rows] = await db.query(`
      SELECT 
        c.id,
        c.user_id,
        c.content,
        c.created_at,
        c.parent_comment_id,
        u.username,
        u.display_name,
        u.is_verified,
        COALESCE(u.avatar_url, '/default-avatar.png') AS avatar_url,

        /* ✅ FIXED LIKE COUNT */
        COUNT(DISTINCT cl.id) AS like_count,

        /* ✅ FIXED USER_LIKED FLAG */
        SUM(cl.user_id = ?) > 0 AS user_liked

      FROM vine_comments c
      JOIN vine_users u ON u.id = c.user_id
      LEFT JOIN vine_comment_likes cl ON cl.comment_id = c.id
      WHERE c.post_id = ?
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `, [userId, postId]);

    res.json(rows);
  } catch (err) {
    console.error("Fetch comments failed:", err);
    res.status(500).json([]);
  }
});

// 🔥 Trending posts (last 24h)
router.get("/posts/trending", authOptional, async (req, res) => {
  try {
    const viewerId = req.user?.id || null;
    const limit = Math.min(Number(req.query.limit || 8), 20);

    const [rows] = await db.query(
      `
      SELECT 
        p.id,
        p.user_id,
        p.content,
        p.image_url,
        p.link_preview,
        p.created_at AS created_at,
        p.created_at AS sort_time,

        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        u.hide_like_counts,

        (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id)    AS like_count,
        (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comment_count,
        (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id)  AS revine_count,
        (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS view_count,

        ${viewerId ? "(SELECT COUNT(*) > 0 FROM vine_likes WHERE post_id = p.id AND user_id = " + viewerId + ") AS user_liked," : "0 AS user_liked,"}
        ${viewerId ? "(SELECT COUNT(*) > 0 FROM vine_revines WHERE post_id = p.id AND user_id = " + viewerId + ") AS user_revined," : "0 AS user_revined,"}
        ${viewerId ? "(SELECT COUNT(*) > 0 FROM vine_bookmarks WHERE post_id = p.id AND user_id = " + viewerId + ") AS user_bookmarked" : "0 AS user_bookmarked"}

      FROM vine_posts p
      JOIN vine_users u ON p.user_id = u.id
      WHERE p.created_at >= NOW() - INTERVAL 1 DAY
        ${
          viewerId
            ? `AND NOT EXISTS (
                SELECT 1 FROM vine_blocks b
                WHERE (b.blocker_id = u.id AND b.blocked_id = ${viewerId})
                   OR (b.blocker_id = ${viewerId} AND b.blocked_id = u.id)
              )
              AND NOT EXISTS (
                SELECT 1 FROM vine_blocks b2
                WHERE (b2.blocker_id = ${viewerId} AND b2.blocked_id = u.id)
              )`
            : ""
        }
        ${
          viewerId
            ? `AND NOT EXISTS (
                SELECT 1 FROM vine_mutes m
                WHERE m.muter_id = ${viewerId} AND m.muted_id = u.id
              )`
            : ""
        }
        ${
          viewerId
            ? `AND (
                u.is_private = 0
                OR u.id = ${viewerId}
                OR EXISTS (
                  SELECT 1 FROM vine_follows f
                  WHERE f.follower_id = ${viewerId} AND f.following_id = u.id
                )
              )`
            : "AND u.is_private = 0"
        }
      ORDER BY like_count DESC, comment_count DESC, p.created_at DESC
      LIMIT ?
      `,
      [limit]
    );

    res.json(rows);
  } catch (err) {
    console.error("Trending posts error:", err);
    res.status(500).json([]);
  }
});

// Ranked Feed (open network)
router.get("/posts", authOptional, async (req, res) => {
  try {
    const viewerId = req.user?.id || null;

    // LOGGED OUT FEED
    if (!viewerId) {
      const [rows] = await db.query(`
        SELECT 
          p.id,
          p.user_id,
          p.content,
          p.image_url,
          p.link_preview,
          p.created_at AS created_at,
          p.created_at AS sort_time,

          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,

          (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id)    AS like_count,
          (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comment_count,
          (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id)  AS revine_count,
          (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS view_count,


          0 AS user_liked,
          0 AS user_revined,
          0 AS user_bookmarked,

          (
            (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) * 2 +
            (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) * 3 +
            (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) * 4 -
            (TIMESTAMPDIFF(HOUR, p.created_at, NOW()) * 0.2)
          ) AS score

        FROM vine_posts p
        JOIN vine_users u ON p.user_id = u.id
        ORDER BY score DESC
        LIMIT 100
      `);

      return res.json(rows);
    }

    // LOGGED IN FEED
    const [rows] = await db.query(`
      SELECT 
        p.id,
        p.user_id,
        p.content,
        p.image_url,
        p.link_preview,
        p.created_at AS created_at,
        p.created_at AS sort_time,

        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,

        (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id)    AS like_count,
        (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comment_count,
        (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id)  AS revine_count,
        (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS view_count,

        (SELECT COUNT(*) > 0 
          FROM vine_likes 
          WHERE post_id = p.id AND user_id = ?) AS user_liked,

        (SELECT COUNT(*) > 0 
          FROM vine_revines 
          WHERE post_id = p.id AND user_id = ?) AS user_revined,

        (SELECT COUNT(*) > 0
          FROM vine_bookmarks
          WHERE post_id = p.id AND user_id = ?) AS user_bookmarked,

        (
          (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) * 2 +
          (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) * 3 +
          (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) * 4 +

          IF(EXISTS (
            SELECT 1 FROM vine_follows 
            WHERE follower_id = ? AND following_id = p.user_id
          ), 5, 0) -

          (TIMESTAMPDIFF(HOUR, p.created_at, NOW()) * 0.2)
        ) AS score

      FROM vine_posts p
      JOIN vine_users u ON p.user_id = u.id
      WHERE NOT EXISTS (
        SELECT 1 FROM vine_blocks b
        WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
           OR (b.blocker_id = ? AND b.blocked_id = u.id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM vine_mutes m
        WHERE m.muter_id = ? AND m.muted_id = u.id
      )
      ORDER BY score DESC
      LIMIT 100
    `, [viewerId, viewerId, viewerId, viewerId, viewerId, viewerId, viewerId]);

    res.json(rows);

  } catch (err) {
    console.error("Feed error:", err);
    res.status(500).json([]);
  }
});

// 🔁 Toggle revine (single source of truth)
router.post("/posts/:id/revine", authMiddleware, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    // Get post owner
    const [[post]] = await db.query(
      "SELECT user_id FROM vine_posts WHERE id = ?",
      [postId]
    );

    if (!post) return res.status(404).json({ message: "Post not found" });
    if (await isUserBlocked(post.user_id, userId)) {
      return res.status(403).json({ message: "You have been blocked" });
    }
    const communityAccess = await isMemberOfPostCommunity(postId, userId);
    if (!communityAccess.exists) return res.status(404).json({ message: "Post not found" });
    if (!communityAccess.allowed) {
      return res.status(403).json({ message: "Join this community to comment or revine." });
    }

    const postOwnerId = post.user_id;

    const [existing] = await db.query(
      "SELECT 1 FROM vine_revines WHERE user_id = ? AND post_id = ?",
      [userId, postId]
    );

    if (existing.length) {
      await db.query(
        "DELETE FROM vine_revines WHERE user_id = ? AND post_id = ?",
        [userId, postId]
      );
    } else {
      await db.query(
        "INSERT INTO vine_revines (user_id, post_id) VALUES (?, ?)",
        [userId, postId]
      );

      // ✅ Create notification only if not revining own post
      if (postOwnerId !== userId) {
        const muted = await isMutedBy(postOwnerId, userId);
        if (!muted) {
        await db.query(
          `INSERT INTO vine_notifications 
           (user_id, actor_id, type, post_id)
           VALUES (?, ?, 'revine', ?)`,
          [postOwnerId, userId, postId]
        );

        // 🔥 REAL-TIME PUSH
        io.to(`user-${postOwnerId}`).emit("notification");
        }
      }
    }

    const [[count]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_revines WHERE post_id = ?",
      [postId]
    );

    res.json({
      revines: count.total,
      user_revined: !existing.length
    });

  } catch (err) {
    console.error("REVINE ERROR:", err);
    res.status(500).json({ message: "Failed to revine" });
  }
});

// ❤️ Toggle like
router.post("/posts/:id/like", requireVineAuth, async (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;
  const activeSuspension = await getActiveInteractionSuspension(userId);
  if (activeSuspension) {
    return res.status(403).json({
      message: "Your account is temporarily suspended from likes/comments.",
      suspension: activeSuspension,
    });
  }

  // Find post owner
  const [[post]] = await db.query(
    "SELECT user_id FROM vine_posts WHERE id = ?",
    [postId]
  );

  if (!post) return res.status(404).json({ message: "Post not found" });
  if (await isUserBlocked(post.user_id, userId)) {
    return res.status(403).json({ message: "You have been blocked" });
  }

  const postOwnerId = post.user_id;

  const [existing] = await db.query(
    "SELECT 1 FROM vine_likes WHERE user_id = ? AND post_id = ?",
    [userId, postId]
  );

  if (existing.length) {
    await db.query(
      "DELETE FROM vine_likes WHERE user_id = ? AND post_id = ?",
      [userId, postId]
    );
  } else {
    await db.query(
      "INSERT INTO vine_likes (user_id, post_id) VALUES (?, ?)",
      [userId, postId]
    );

    // ✅ Create notification (only if not liking own post)
    if (postOwnerId !== userId) {
      const muted = await isMutedBy(postOwnerId, userId);
      if (!muted) {
      await db.query(`
        INSERT INTO vine_notifications (user_id, actor_id, type, post_id)
        VALUES (?, ?, 'like', ?)
      `, [postOwnerId, userId, postId]);

      // 🔥 REAL-TIME PUSH
      io.to(`user-${postOwnerId}`).emit("notification");
      }
    }
  }

  const [[count]] = await db.query(
    "SELECT COUNT(*) AS total FROM vine_likes WHERE post_id = ?",
    [postId]
  );

  res.json({
    likes: count.total,
    user_liked: !existing.length
  });
});

// 🔒 Change password
router.patch("/users/me/change-password", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Missing password fields" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password too short" });
    }

    const [[user]] = await db.query(
      "SELECT password_hash FROM vine_users WHERE id = ?",
      [userId]
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE vine_users SET password_hash = ? WHERE id = ?", [
      hash,
      userId,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ message: "Failed to update password" });
  }
});

// 🔖 Toggle bookmark
router.post("/posts/:id/bookmark", requireVineAuth, async (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  const [[post]] = await db.query(
    "SELECT user_id FROM vine_posts WHERE id = ?",
    [postId]
  );

  if (!post) return res.status(404).json({ message: "Post not found" });
  if (await isUserBlocked(post.user_id, userId)) {
    return res.status(403).json({ message: "You have been blocked" });
  }

  const [existing] = await db.query(
    "SELECT 1 FROM vine_bookmarks WHERE user_id = ? AND post_id = ?",
    [userId, postId]
  );

  if (existing.length) {
    await db.query(
      "DELETE FROM vine_bookmarks WHERE user_id = ? AND post_id = ?",
      [userId, postId]
    );
  } else {
    await db.query(
      "INSERT INTO vine_bookmarks (user_id, post_id, created_at) VALUES (?, ?, NOW())",
      [userId, postId]
    );
  }

  res.json({ user_bookmarked: !existing.length });
});

// 👀 Record view (unique per user)
router.post("/posts/:id/view", requireVineAuth, async (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  try {
    await db.query(
      "INSERT IGNORE INTO vine_post_views (post_id, user_id, created_at) VALUES (?, ?, NOW())",
      [postId, userId]
    );

    const [[count]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_post_views WHERE post_id = ?",
      [postId]
    );

    res.json({ views: count.total || 0 });
  } catch (err) {
    console.error("View record error:", err);
    res.status(500).json({ message: "Failed to record view" });
  }
});

// Add comment or reply
router.post("/posts/:id/comments", authMiddleware, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const userId = req.user?.id;
    let { content, parent_comment_id } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "No user in token" });
    }
    const activeSuspension = await getActiveInteractionSuspension(userId);
    if (activeSuspension) {
      return res.status(403).json({
        message: "Your account is temporarily suspended from likes/comments.",
        suspension: activeSuspension,
      });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ message: "Comment required" });
    }

    if (!parent_comment_id) parent_comment_id = null;

    // Get post owner
    const [[post]] = await db.query(
      "SELECT user_id FROM vine_posts WHERE id = ?",
      [postId]
    );

    if (!post) return res.status(404).json({ message: "Post not found" });
    if (await isUserBlocked(post.user_id, userId)) {
      return res.status(403).json({ message: "You have been blocked" });
    }
    const communityAccess = await isMemberOfPostCommunity(postId, userId);
    if (!communityAccess.exists) return res.status(404).json({ message: "Post not found" });
    if (!communityAccess.allowed) {
      return res.status(403).json({ message: "Join this community to comment or revine." });
    }

    const postOwnerId = post.user_id;

    // Insert comment
    const [result] = await db.query(
      `INSERT INTO vine_comments (post_id, user_id, content, parent_comment_id)
       VALUES (?, ?, ?, ?)`,
      [postId, userId, content, parent_comment_id]
    );

    const commentId = result.insertId;

    // -------- COMMENT NOTIFICATION ----------
    if (!parent_comment_id && postOwnerId !== userId) {
      const muted = await isMutedBy(postOwnerId, userId);
      if (!muted) {
      await db.query(
        `INSERT INTO vine_notifications 
         (user_id, actor_id, type, post_id, comment_id)
         VALUES (?, ?, 'comment', ?, ?)`,
        [postOwnerId, userId, postId, commentId]
      );

      // 🔥 REAL-TIME PUSH
      io.to(`user-${postOwnerId}`).emit("notification");
      }
    }

    // -------- REPLY NOTIFICATION ----------
    if (parent_comment_id) {
      const [[parent]] = await db.query(
        "SELECT user_id FROM vine_comments WHERE id = ?",
        [parent_comment_id]
      );

      if (parent && parent.user_id !== userId) {
        const muted = await isMutedBy(parent.user_id, userId);
        if (!muted) {
        await db.query(
          `INSERT INTO vine_notifications 
           (user_id, actor_id, type, post_id, comment_id)
           VALUES (?, ?, 'reply', ?, ?)`,
          [parent.user_id, userId, postId, commentId]
        );

        // 🔥 REAL-TIME PUSH
        io.to(`user-${parent.user_id}`).emit("notification");
        }
      }
    }

    const mentions = extractMentions(content || "");
    await notifyMentions({
      mentions,
      actorId: userId,
      postId,
      commentId,
      type: "mention_comment",
    });

    res.json({ success: true });

  } catch (err) {
    console.error("COMMENT ROUTE ERROR:", err);
    res.status(500).json({ message: "Failed to add comment" });
  }
});
// ❤️ Like / Unlike a comment
router.post("/comments/:id/like", requireVineAuth, async (req, res) => {
  try {
    const commentId = req.params.id;
    const userId = req.user.id;
    const activeSuspension = await getActiveInteractionSuspension(userId);
    if (activeSuspension) {
      return res.status(403).json({
        message: "Your account is temporarily suspended from likes/comments.",
        suspension: activeSuspension,
      });
    }

    // Get comment owner + post
    const [[comment]] = await db.query(
      "SELECT user_id, post_id FROM vine_comments WHERE id = ?",
      [commentId]
    );

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const [existing] = await db.query(
      "SELECT 1 FROM vine_comment_likes WHERE user_id = ? AND comment_id = ?",
      [userId, commentId]
    );

    if (existing.length) {
      // Unlike
      await db.query(
        "DELETE FROM vine_comment_likes WHERE user_id = ? AND comment_id = ?",
        [userId, commentId]
      );
    } else {
      // Like
      await db.query(
        "INSERT INTO vine_comment_likes (user_id, comment_id) VALUES (?, ?)",
        [userId, commentId]
      );

      // 🔔 Create notification (only if not your own comment)
      if (comment.user_id !== userId) {
        const muted = await isMutedBy(comment.user_id, userId);
        if (!muted) {
        await db.query(
          `INSERT INTO vine_notifications
           (user_id, actor_id, type, post_id, comment_id)
           VALUES (?, ?, 'like_comment', ?, ?)`,
          [comment.user_id, userId, comment.post_id, commentId]
        );
        }
      }
    }

    const [[count]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_comment_likes WHERE comment_id = ?",
      [commentId]
    );

    res.json({
      like_count: count.total,
      user_liked: !existing.length
    });

  } catch (err) {
    console.error("Failed to like comment:", err);
    res.status(500).json({ message: "Failed to like comment" });
  }
});

// 🔁 Toggle revine (reshares)
router.post("/posts/:id/revine", authMiddleware, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const userId = req.user.id;

    // Find post owner
    const [[post]] = await db.query(
      "SELECT user_id FROM vine_posts WHERE id = ?",
      [postId]
    );

    if (!post) return res.status(404).json({ message: "Post not found" });
    const communityAccess = await isMemberOfPostCommunity(postId, userId);
    if (!communityAccess.exists) return res.status(404).json({ message: "Post not found" });
    if (!communityAccess.allowed) {
      return res.status(403).json({ message: "Join this community to comment or revine." });
    }

    const postOwnerId = post.user_id;

    const [existing] = await db.query(
      "SELECT 1 FROM vine_revines WHERE user_id = ? AND post_id = ?",
      [userId, postId]
    );

    if (existing.length) {
      await db.query(
        "DELETE FROM vine_revines WHERE user_id = ? AND post_id = ?",
        [userId, postId]
      );
    } else {
      await db.query(
        "INSERT INTO vine_revines (user_id, post_id) VALUES (?, ?)",
        [userId, postId]
      );

      // 🔔 Create notification (only if not own post)
      if (postOwnerId !== userId) {
        await db.query(`
          INSERT INTO vine_notifications (user_id, actor_id, type, post_id)
          VALUES (?, ?, 'revine', ?)
        `, [postOwnerId, userId, postId]);

        // optional realtime later:
        // io.to(`user-${postOwnerId}`).emit("notification");
      }
    }

    const [[count]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_revines WHERE post_id = ?",
      [postId]
    );

    res.json({
      revines: count.total,
      user_revined: !existing.length
    });

  } catch (err) {
    console.error("REVINE ERROR:", err);
    res.status(500).json({ message: "Failed to revine" });
  }
});

// DELETE a comment or reply (post owner, comment author, or moderator)
router.delete("/comments/:id", requireVineAuth, async (req, res) => {
  const commentId = req.params.id;
  const requesterId = req.user.id; // From your requireVineAuth middleware

  try {
    // 1. Find comment author and post owner
    const [rows] = await db.query(`
      SELECT c.user_id AS comment_owner_id, p.user_id AS post_owner_id
      FROM vine_comments c
      JOIN vine_posts p ON c.post_id = p.id 
      WHERE c.id = ?
    `, [commentId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const isModerator = isModeratorAccount(req.user);
    const canDelete =
      Number(rows[0].post_owner_id) === Number(requesterId) ||
      Number(rows[0].comment_owner_id) === Number(requesterId) ||
      isModerator;

    if (!canDelete) {
      return res.status(403).json({ message: "Not allowed" });
    }

    // 3. Delete replies + comment
    await db.query("DELETE FROM vine_comments WHERE parent_comment_id = ?", [commentId]);
    await db.query("DELETE FROM vine_comments WHERE id = ?", [commentId]);

    res.json({ success: true, message: "Comment deleted successfully" });
  } catch (err) {
    console.error("Delete Error:", err);
    res.status(500).json({ message: "Failed to delete comment" });
  }
});
// DELETE an original post (DB + Cloudinary)
router.delete("/posts/:id", requireVineAuth, async (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  try {
    // 1️⃣ Fetch post + ownership + images
    const [[post]] = await db.query(
      "SELECT user_id, image_url FROM vine_posts WHERE id = ?",
      [postId]
    );

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const isModerator = isModeratorAccount(req.user);
    if (Number(post.user_id) !== Number(userId) && !isModerator) {
      return res
        .status(403)
        .json({ message: "Not allowed" });
    }

    // 2️⃣ Delete images from Cloudinary (if any)
    if (post.image_url) {
      const images = Array.isArray(post.image_url)
        ? post.image_url
        : JSON.parse(post.image_url);

      const extractPublicId = (url) => {
        const parts = url.split("/");
        const file = parts.pop().split(".")[0];
        const folder = parts
          .slice(parts.indexOf("upload") + 1)
          .join("/");
        return `${folder}/${file}`;
      };

      await Promise.all(
        images.map((url) => {
          const asString = String(url || "");
          const isVideo = /\/video\/upload\//i.test(asString) || /\.(mp4|mov|webm|m4v|avi|mkv|ogv)(\?|$)/i.test(asString);
          return cloudinary.uploader.destroy(extractPublicId(asString), {
            resource_type: isVideo ? "video" : "image",
          });
        })
      );
    }

    // 3️⃣ Delete post from DB
    await db.query("DELETE FROM vine_posts WHERE id = ?", [postId]);

    res.json({ success: true, message: "Post deleted" });
  } catch (err) {
    console.error("Delete Post Error:", err);
    res.status(500).json({ message: "Server error during deletion" });
  }
});

// avatars (Cloudinary)
const uploadAvatarMiddleware = (req, res, next) => {
  uploadAvatarMemory.single("avatar")(req, res, (err) => {
    if (err) {
      console.error("Avatar upload error:", err);
      const message =
        err?.message ||
        err?.error?.message ||
        err?.code ||
        "Upload failed";
      const details = (() => {
        try {
          return JSON.stringify(err, Object.getOwnPropertyNames(err));
        } catch {
          return "";
        }
      })();
      return res.status(400).json({
        message,
        code: err?.code,
        name: err?.name,
        http_code: err?.http_code || err?.error?.http_code,
        details,
      });
    }
    return next();
  });
};

router.post("/users/avatar", authenticate, uploadAvatarMiddleware, async (req, res) => {
  try {
    if (!req.file) {
      console.warn("Avatar upload missing file", {
        hasBody: Boolean(req.body),
        contentType: req.headers["content-type"],
      });
      return res.status(400).json({ message: "No file uploaded" });
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const normalized = await normalizeImageBuffer(req.file);
    const upload = await cloudinary.uploader.upload(
      `data:${normalized.mimetype};base64,${normalized.buffer.toString("base64")}`,
      {
        folder: "vine/avatars",
        transformation: [
          { width: 400, height: 400, crop: "fill", gravity: "face" },
        ],
      }
    );
    const avatarUrl = upload.secure_url;

    await db.query(
      "UPDATE vine_users SET avatar_url = ? WHERE id = ?",
      [avatarUrl, req.user.id]
    );

    res.json({ avatar_url: avatarUrl });
  } catch (err) {
    console.error("Avatar upload error:", err);
    res.status(500).json({ message: "Upload failed" });
  }
});

// banners (NEW)
router.post(
  "/users/banner",
  authenticate,
  uploadBannerMemory.single("banner"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const normalized = await normalizeImageBuffer(req.file);
      const upload = await cloudinary.uploader.upload(
        `data:${normalized.mimetype};base64,${normalized.buffer.toString("base64")}`,
        {
          folder: "vine/banners",
          transformation: [
            { width: 1500, height: 500, crop: "fill" },
          ],
        }
      );
      const bannerUrl = upload.secure_url;


      await db.query(
        "UPDATE vine_users SET banner_url = ? WHERE id = ?",
        [bannerUrl, req.user.id]
      );

      res.json({ banner_url: bannerUrl });

    } catch (err) {
      console.error("Banner upload error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  }
);
//update profile
router.post("/users/update-profile", authenticate, async (req, res) => {
  try {
    await ensureProfileAboutSchema();
    const {
      display_name,
      bio,
      location,
      website,
      hobbies,
      date_of_birth,
      favorite_movies,
      favorite_songs,
      favorite_musicians,
      favorite_books,
      movie_genres,
      gender,
      contact_email,
      phone_number,
      tiktok_username,
      instagram_username,
      twitter_username,
    } = req.body;

    await db.query(
      `
      UPDATE vine_users
      SET 
        display_name = ?,
        bio = ?,
        location = ?,
        website = ?,
        hobbies = ?,
        date_of_birth = ?,
        favorite_movies = ?,
        favorite_songs = ?,
        favorite_musicians = ?,
        favorite_books = ?,
        movie_genres = ?,
        gender = ?,
        contact_email = ?,
        phone_number = ?,
        tiktok_username = ?,
        instagram_username = ?,
        twitter_username = ?
      WHERE id = ?
      `,
      [
        display_name || null,
        bio || null,
        location || null,
        website || null,
        hobbies || null,
        date_of_birth || null,
        favorite_movies || null,
        favorite_songs || null,
        favorite_musicians || null,
        favorite_books || null,
        movie_genres || null,
        gender || null,
        contact_email || null,
        phone_number || null,
        tiktok_username || null,
        instagram_username || null,
        twitter_username || null,
        req.user.id
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

// update privacy/settings
router.patch("/users/me/settings", authenticate, async (req, res) => {
  try {
    await ensureProfileAboutSchema();
    const {
      dm_privacy,
      is_private,
      hide_like_counts,
      show_last_active,
      about_privacy,
    } = req.body || {};

    const allowedDm = new Set(["everyone", "followers", "no_one"]);
    const allowedAbout = new Set(["everyone", "followers", "no_one"]);
    const updates = [];
    const params = [];

    if (dm_privacy !== undefined) {
      if (!allowedDm.has(dm_privacy)) {
        return res.status(400).json({ message: "Invalid dm_privacy" });
      }
      updates.push("dm_privacy = ?");
      params.push(dm_privacy);
    }

    if (is_private !== undefined) {
      updates.push("is_private = ?");
      params.push(is_private ? 1 : 0);
    }

    if (hide_like_counts !== undefined) {
      updates.push("hide_like_counts = ?");
      params.push(hide_like_counts ? 1 : 0);
    }

    if (show_last_active !== undefined) {
      updates.push("show_last_active = ?");
      params.push(show_last_active ? 1 : 0);
    }

    if (about_privacy !== undefined) {
      if (!allowedAbout.has(about_privacy)) {
        return res.status(400).json({ message: "Invalid about_privacy" });
      }
      updates.push("about_privacy = ?");
      params.push(about_privacy);
    }

    if (!updates.length) {
      return res.json({ success: true });
    }

    await db.query(
      `
      UPDATE vine_users
      SET ${updates.join(", ")}
      WHERE id = ?
      `,
      [...params, req.user.id]
    );

    const [[user]] = await db.query(
      `
      SELECT dm_privacy, is_private, hide_like_counts, show_last_active, about_privacy
      FROM vine_users
      WHERE id = ?
      `,
      [req.user.id]
    );

    res.json({ success: true, user });
  } catch (err) {
    console.error("Update settings error:", err);
    res.status(500).json({ message: "Failed to update settings" });
  }
});

// follow
router.post("/users/:id/follow", authenticate, async (req, res) => {
  try {
    const targetId = Number(req.params.id);   // person being followed
    const actorId = req.user.id;              // person doing the following

    if (targetId === actorId) {
      return res.status(400).json({ message: "Cannot follow yourself" });
    }
    if (await isUserBlocked(targetId, actorId)) {
      return res.status(403).json({ message: "You have been blocked" });
    }

    // Insert follow (ignore duplicates)
    const [result] = await db.query(
      "INSERT IGNORE INTO vine_follows (follower_id, following_id) VALUES (?, ?)",
      [actorId, targetId]
    );

    // Only create notification if follow actually happened
    if (result.affectedRows > 0) {
      const muted = await isMutedBy(targetId, actorId);
      if (!muted) {
        await db.query(
          `INSERT INTO vine_notifications (user_id, actor_id, type)
           VALUES (?, ?, 'follow')`,
          [targetId, actorId]
        );

        // 🔥 Real-time push
        io.to(`user-${targetId}`).emit("notification");
      }
    }

    res.json({ success: true });

  } catch (err) {
    console.error("FOLLOW ERROR:", err);
    res.status(500).json({ message: "Failed to follow" });
  }
});

// unfollow
router.delete("/users/:id/follow", authenticate, async (req, res) => {
  await db.query(
    "DELETE FROM vine_follows WHERE follower_id = ? AND following_id = ?",
    [req.user.id, req.params.id]
  );
  res.json({ success: true });
});

// block a user
router.post("/users/:id/block", authenticate, async (req, res) => {
  const blockerId = req.user.id;
  const blockedId = Number(req.params.id);

  if (blockerId === blockedId) {
    return res.status(400).json({ message: "Cannot block yourself" });
  }

  try {
    await db.query(
      "INSERT IGNORE INTO vine_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, NOW())",
      [blockerId, blockedId]
    );
    // remove follow relationships both ways
    await db.query(
      "DELETE FROM vine_follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)",
      [blockerId, blockedId, blockedId, blockerId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Block error:", err);
    res.status(500).json({ message: "Failed to block user" });
  }
});

// mute a user
router.post("/users/:id/mute", authenticate, async (req, res) => {
  const muterId = req.user.id;
  const mutedId = Number(req.params.id);

  if (muterId === mutedId) {
    return res.status(400).json({ message: "Cannot mute yourself" });
  }

  try {
    await db.query(
      "INSERT IGNORE INTO vine_mutes (muter_id, muted_id, created_at) VALUES (?, ?, NOW())",
      [muterId, mutedId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Mute error:", err);
    res.status(500).json({ message: "Failed to mute user" });
  }
});

// list muted users for someone else? blocked by design

// unmute a user
router.delete("/users/:id/mute", authenticate, async (req, res) => {
  const muterId = req.user.id;
  const mutedId = Number(req.params.id);

  try {
    await db.query(
      "DELETE FROM vine_mutes WHERE muter_id = ? AND muted_id = ?",
      [muterId, mutedId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Unmute error:", err);
    res.status(500).json({ message: "Failed to unmute user" });
  }
});

// unblock a user
router.delete("/users/:id/block", authenticate, async (req, res) => {
  const blockerId = req.user.id;
  const blockedId = Number(req.params.id);

  try {
    await db.query(
      "DELETE FROM vine_blocks WHERE blocker_id = ? AND blocked_id = ?",
      [blockerId, blockedId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Unblock error:", err);
    res.status(500).json({ message: "Failed to unblock user" });
  }
});
// Get followers of a user
router.get("/users/:username/followers", authOptional, async (req, res) => {
  try {
    const { username } = req.params;
    const viewerId = req.user?.id || null;

    const [[user]] = await db.query(
      "SELECT id FROM vine_users WHERE username = ?",
      [username]
    );
    if (!user) return res.status(404).json({ message: "Not found" });

    const [rows] = await db.query(`
      SELECT 
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        u.bio,
        ${
          viewerId
            ? `(SELECT COUNT(*) > 0 FROM vine_follows 
                WHERE follower_id = ${viewerId} AND following_id = u.id)`
            : "0"
        } AS is_following
      FROM vine_follows f
      JOIN vine_users u ON f.follower_id = u.id
      WHERE f.following_id = ?
        ${
          viewerId
            ? `AND NOT EXISTS (
                SELECT 1 FROM vine_blocks b
                WHERE (b.blocker_id = u.id AND b.blocked_id = ${viewerId})
                   OR (b.blocker_id = ${viewerId} AND b.blocked_id = u.id)
              )`
            : ""
        }
    `, [user.id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load followers" });
  }
});
// Get users someone is following
router.get("/users/:username/following", authOptional, async (req, res) => {
  try {
    const { username } = req.params;
    const viewerId = req.user?.id || null;

    const [[user]] = await db.query(
      "SELECT id FROM vine_users WHERE username = ?",
      [username]
    );
    if (!user) return res.status(404).json({ message: "Not found" });

    const [rows] = await db.query(`
      SELECT 
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        u.bio,
        ${
          viewerId
            ? `(SELECT COUNT(*) > 0 FROM vine_follows 
                WHERE follower_id = ${viewerId} AND following_id = u.id)`
            : "0"
        } AS is_following
      FROM vine_follows f
      JOIN vine_users u ON f.following_id = u.id
      WHERE f.follower_id = ?
        ${
          viewerId
            ? `AND NOT EXISTS (
                SELECT 1 FROM vine_blocks b
                WHERE (b.blocker_id = u.id AND b.blocked_id = ${viewerId})
                   OR (b.blocker_id = ${viewerId} AND b.blocked_id = u.id)
              )`
            : ""
        }
    `, [user.id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load following" });
  }
});

// Guardian-only analytics overview
router.get("/analytics/overview", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const [[dbMeta]] = await db.query("SELECT DATABASE() AS dbName");
    const dbName = dbMeta?.dbName;
    if (!dbName) {
      return res.status(500).json({ message: "Database not selected" });
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

    const series7d = async (table, col = "created_at", start = rangeStart, end = rangeEnd) => {
      const exists = await hasTable(dbName, table);
      if (!exists) return {};
      const hasCol = await hasColumn(dbName, table, col);
      if (!hasCol) return {};
      const [rows] = await db.query(
        `
        SELECT DATE(${col}) AS day, COUNT(*) AS total
        FROM ${table}
        WHERE ${col} >= ? AND ${col} <= ?
        GROUP BY DATE(${col})
        `,
        [start, end]
      );
      const out = {};
      for (const row of rows) {
        const d = new Date(row.day).toISOString().slice(0, 10);
        out[d] = Number(row.total || 0);
      }
      return out;
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

    const [postsSeries, commentsSeries, likesSeries, revinesSeries, followsSeries, dmsSeries] =
      await Promise.all([
        series7d("vine_posts"),
        series7d("vine_comments"),
        series7d("vine_likes"),
        series7d("vine_revines"),
        series7d("vine_follows"),
        series7d("vine_messages"),
      ]);

    const activeSeries = await series7d("vine_users", "last_active_at", rangeStart, rangeEnd);

    const usageByDay = [];
    const daysInRange = Math.max(1, Math.min(31, Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1));
    for (let i = daysInRange - 1; i >= 0; i -= 1) {
      const day = new Date(rangeEnd.getTime() - i * 86400000).toISOString().slice(0, 10);
      usageByDay.push({
        day,
        posts: postsSeries[day] || 0,
        comments: commentsSeries[day] || 0,
        likes: likesSeries[day] || 0,
        revines: revinesSeries[day] || 0,
        follows: followsSeries[day] || 0,
        dms: dmsSeries[day] || 0,
        activeUsers: activeSeries[day] || 0,
      });
    }

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
          (SELECT COUNT(*) FROM vine_revines r WHERE r.post_id = p.id) AS revines,
          (SELECT COUNT(*) FROM vine_post_views v WHERE v.post_id = p.id) AS views
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
          (SELECT COUNT(*) FROM vine_revines r WHERE r.post_id = p.id) AS revines,
          (SELECT COUNT(*) FROM vine_post_views v WHERE v.post_id = p.id) AS views
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
              Number(row.revines || 0) * 3 +
              Number(row.views || 0) * 0.25;
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
      usageByDay,
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
          (SELECT COUNT(*) FROM vine_revines r WHERE r.post_id = p.id) AS revines,
          (SELECT COUNT(*) FROM vine_post_views v WHERE v.post_id = p.id) AS views
        FROM vine_posts p
        JOIN vine_users u ON u.id = p.user_id
        WHERE p.created_at >= ? AND p.created_at <= ?
        ORDER BY p.created_at DESC
        LIMIT ?
        `,
        [from, to, limit]
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
        ORDER BY c.created_at DESC
        LIMIT ?
        `,
        [from, to, limit]
      );
      return res.json({ type, items: rows });
    }

    if (type === "users") {
      const [rows] = await db.query(
        `
        SELECT id, username, display_name, created_at, last_active_at, role
        FROM vine_users
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY created_at DESC
        LIMIT ?
        `,
        [from, to, limit]
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
        GROUP BY p.user_id, u.username, u.display_name
        ORDER BY (likes + comments * 2 + revines * 3) DESC
        LIMIT ?
        `,
        [from, to, Math.min(limit, 100)]
      );
      return res.json({ type, items: rows });
    }

    return res.status(400).json({ message: "Unsupported drilldown type" });
  } catch (err) {
    console.error("Guardian drilldown error:", err);
    return res.status(500).json({ message: "Failed to load drilldown" });
  }
});

// Report content (post/comment) to Guardian
router.post("/reports", authenticate, async (req, res) => {
  try {
    await ensureModerationSchema();
    const reporterId = Number(req.user.id);
    const { post_id, comment_id, reason } = req.body || {};
    let postId = post_id ? Number(post_id) : null;
    const commentId = comment_id ? Number(comment_id) : null;
    const cleanReason = String(reason || "").trim().slice(0, 500);

    if (!postId && !commentId) {
      return res.status(400).json({ message: "post_id or comment_id is required" });
    }
    if (!cleanReason) {
      return res.status(400).json({ message: "Reason is required" });
    }

    let reportedUserId = null;
    if (commentId) {
      const [[comment]] = await db.query(
        "SELECT id, user_id, post_id FROM vine_comments WHERE id = ?",
        [commentId]
      );
      if (!comment) return res.status(404).json({ message: "Comment not found" });
      if (!postId && comment.post_id) {
        postId = Number(comment.post_id);
      }
      reportedUserId = Number(comment.user_id);
    } else if (postId) {
      const [[post]] = await db.query(
        "SELECT id, user_id FROM vine_posts WHERE id = ?",
        [postId]
      );
      if (!post) return res.status(404).json({ message: "Post not found" });
      reportedUserId = Number(post.user_id);
    }

    const [insertResult] = await db.query(
      `
      INSERT INTO vine_reports
      (reporter_id, reported_user_id, post_id, comment_id, reason, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'open', NOW())
      `,
      [reporterId, reportedUserId, postId, commentId, cleanReason]
    );

    await notifyGuardians({
      actorId: reporterId,
      type: commentId ? "report_comment" : "report_post",
      postId,
      commentId,
      meta: { report_id: insertResult.insertId, reason: cleanReason, reported_user_id: reportedUserId },
    });

    res.json({ success: true, report_id: insertResult.insertId });
  } catch (err) {
    console.error("Create report error:", err);
    res.status(500).json({ message: "Failed to submit report", details: String(err?.message || "") });
  }
});

// Guardian moderation queue
router.get("/moderation/reports", authenticate, async (req, res) => {
  try {
    await ensureModerationSchema();
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const [rows] = await db.query(
      `
      SELECT
        r.id,
        r.reporter_id,
        r.reported_user_id,
        r.post_id,
        r.comment_id,
        r.reason,
        r.status,
        r.created_at,
        ru.username AS reporter_username,
        ru.display_name AS reporter_display_name,
        tu.username AS reported_username,
        tu.display_name AS reported_display_name
      FROM vine_reports r
      JOIN vine_users ru ON ru.id = r.reporter_id
      LEFT JOIN vine_users tu ON tu.id = r.reported_user_id
      WHERE r.status = 'open'
      ORDER BY r.created_at DESC
      LIMIT 300
      `
    );
    res.json(rows);
  } catch (err) {
    console.error("Load reports error:", err);
    res.status(500).json({ message: "Failed to load reports" });
  }
});

router.get("/moderation/appeals", authenticate, async (req, res) => {
  try {
    await ensureModerationSchema();
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const [rows] = await db.query(
      `
      SELECT
        a.id,
        a.user_id,
        a.message,
        a.status,
        a.created_at,
        u.username,
        u.display_name
      FROM vine_appeals a
      JOIN vine_users u ON u.id = a.user_id
      WHERE a.status = 'open'
      ORDER BY a.created_at DESC
      LIMIT 300
      `
    );
    res.json(rows);
  } catch (err) {
    console.error("Load appeals error:", err);
    res.status(500).json({ message: "Failed to load appeals" });
  }
});

router.post("/moderation/reports/:id/resolve", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }
    const reportId = Number(req.params.id);
    const { status = "resolved" } = req.body || {};
    const nextStatus = ["resolved", "dismissed"].includes(String(status))
      ? String(status)
      : "resolved";
    await db.query(
      "UPDATE vine_reports SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
      [nextStatus, req.user.id, reportId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Resolve report error:", err);
    res.status(500).json({ message: "Failed to resolve report" });
  }
});

router.post("/moderation/appeals/:id/resolve", authenticate, async (req, res) => {
  try {
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }
    const appealId = Number(req.params.id);
    const { status = "resolved" } = req.body || {};
    const nextStatus = ["resolved", "dismissed"].includes(String(status))
      ? String(status)
      : "resolved";
    await db.query(
      "UPDATE vine_appeals SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
      [nextStatus, req.user.id, appealId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Resolve appeal error:", err);
    res.status(500).json({ message: "Failed to resolve appeal" });
  }
});

router.post("/moderation/suspend", authenticate, async (req, res) => {
  try {
    await ensureModerationSchema();
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }
    const { user_id, duration = "day", reason = "", report_id = null } = req.body || {};
    const targetUserId = Number(user_id);
    if (!targetUserId) return res.status(400).json({ message: "user_id is required" });

    const durationSql = {
      day: "DATE_ADD(NOW(), INTERVAL 1 DAY)",
      week: "DATE_ADD(NOW(), INTERVAL 1 WEEK)",
      month: "DATE_ADD(NOW(), INTERVAL 1 MONTH)",
      "three_months": "DATE_ADD(NOW(), INTERVAL 3 MONTH)",
      indefinite: "NULL",
    };
    const durationLabels = {
      day: "1 day",
      week: "1 week",
      month: "1 month",
      "three_months": "3 months",
      indefinite: "indefinite",
    };
    const normalizedDuration = Object.prototype.hasOwnProperty.call(durationSql, duration)
      ? duration
      : "day";

    const endsExpr = durationSql[normalizedDuration];
    await db.query(
      "UPDATE vine_user_suspensions SET is_active = 0 WHERE user_id = ? AND is_active = 1",
      [targetUserId]
    );

    if (endsExpr === "NULL") {
      await db.query(
        `
        INSERT INTO vine_user_suspensions
        (user_id, scope, reason, starts_at, ends_at, is_active, created_by, created_at)
        VALUES (?, 'likes_comments', ?, NOW(), NULL, 1, ?, NOW())
        `,
        [targetUserId, String(reason || "").slice(0, 500), req.user.id]
      );
    } else {
      await db.query(
        `
        INSERT INTO vine_user_suspensions
        (user_id, scope, reason, starts_at, ends_at, is_active, created_by, created_at)
        VALUES (?, 'likes_comments', ?, NOW(), ${endsExpr}, 1, ?, NOW())
        `,
        [targetUserId, String(reason || "").slice(0, 500), req.user.id]
      );
    }

    if (report_id) {
      await db.query(
        "UPDATE vine_reports SET status = 'resolved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
        [req.user.id, Number(report_id)]
      );
    }

    await db.query(
      `
      INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id)
      VALUES (?, ?, 'account_suspended', NULL, NULL)
      `,
      [targetUserId, req.user.id]
    );
    io.to(`user-${targetUserId}`).emit("notification");

    const [[targetUser]] = await db.query(
      "SELECT email, username FROM vine_users WHERE id = ? LIMIT 1",
      [targetUserId]
    );
    if (targetUser?.email) {
      sendVineSuspensionEmail(
        targetUser.email,
        targetUser.username,
        durationLabels[normalizedDuration] || normalizedDuration,
        String(reason || "")
      ).catch((err) => {
        console.warn("Suspension email failed:", err.message);
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Suspend user error:", err);
    res.status(500).json({ message: "Failed to suspend user" });
  }
});

router.post("/moderation/warn", authenticate, async (req, res) => {
  try {
    await ensureModerationSchema();
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const {
      user_id,
      report_id = null,
      reason = "",
      post_id = null,
      comment_id = null,
    } = req.body || {};
    const targetUserId = Number(user_id);
    if (!targetUserId) return res.status(400).json({ message: "user_id is required" });

    await db.query(
      `
      INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id)
      VALUES (?, ?, 'guardian_warning', ?, ?)
      `,
      [targetUserId, req.user.id, post_id ? Number(post_id) : null, comment_id ? Number(comment_id) : null]
    );
    io.to(`user-${targetUserId}`).emit("notification");

    if (report_id) {
      await db.query(
        "UPDATE vine_reports SET status = 'resolved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
        [req.user.id, Number(report_id)]
      );
    }

    const [[targetUser]] = await db.query(
      "SELECT email, username FROM vine_users WHERE id = ? LIMIT 1",
      [targetUserId]
    );
    if (targetUser?.email) {
      sendVineWarningEmail(targetUser.email, targetUser.username, String(reason || "")).catch((err) => {
        console.warn("Warning email failed:", err.message);
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Warn user error:", err);
    res.status(500).json({ message: "Failed to warn user", details: String(err?.message || "") });
  }
});

router.post("/moderation/unsuspend", authenticate, async (req, res) => {
  try {
    await ensureModerationSchema();
    if (!isModeratorAccount(req.user)) {
      return res.status(403).json({ message: "Moderator access required" });
    }

    const { user_id, appeal_id = null, reason = "Appeal approved by Guardian" } = req.body || {};
    const targetUserId = Number(user_id);
    if (!targetUserId) return res.status(400).json({ message: "user_id is required" });

    await db.query(
      `
      UPDATE vine_user_suspensions
      SET is_active = 0, ends_at = NOW()
      WHERE user_id = ? AND is_active = 1
      `,
      [targetUserId]
    );

    if (appeal_id) {
      await db.query(
        "UPDATE vine_appeals SET status = 'resolved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
        [req.user.id, Number(appeal_id)]
      );
    }

    await db.query(
      `
      INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id)
      VALUES (?, ?, 'account_unsuspended', NULL, NULL)
      `,
      [targetUserId, req.user.id]
    );
    io.to(`user-${targetUserId}`).emit("notification");

    const [[targetUser]] = await db.query(
      "SELECT email, username FROM vine_users WHERE id = ? LIMIT 1",
      [targetUserId]
    );
    if (targetUser?.email) {
      sendVineUnsuspensionEmail(targetUser.email, targetUser.username).catch((err) => {
        console.warn("Unsuspension email failed:", err.message);
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Unsuspend user error:", err);
    res.status(500).json({ message: "Failed to unsuspend user", details: String(err?.message || "") });
  }
});

router.get("/users/me/restrictions", authenticate, async (req, res) => {
  try {
    await ensureModerationSchema();
    const suspension = await getActiveInteractionSuspension(req.user.id);
    res.json({ suspended: Boolean(suspension), suspension: suspension || null });
  } catch (err) {
    console.error("Restrictions lookup error:", err);
    res.status(500).json({ suspended: false });
  }
});

router.post("/moderation/appeals", authenticate, async (req, res) => {
  try {
    await ensureModerationSchema();
    const appellantId = Number(req.user.id);
    const { message } = req.body || {};
    const cleanMessage = String(message || "").trim().slice(0, 1000);
    if (!cleanMessage) {
      return res.status(400).json({ message: "Appeal message is required" });
    }

    const [insertResult] = await db.query(
      `
      INSERT INTO vine_appeals (user_id, message, status, created_at)
      VALUES (?, ?, 'open', NOW())
      `,
      [appellantId, cleanMessage]
    );

    await notifyGuardians({
      actorId: appellantId,
      type: "appeal",
      meta: { appeal_id: insertResult.insertId },
    });

    res.json({ success: true, appeal_id: insertResult.insertId });
  } catch (err) {
    console.error("Submit appeal error:", err);
    res.status(500).json({ message: "Failed to submit appeal", details: String(err?.message || "") });
  }
});

// Get notifications
router.get("/notifications", authenticate, async (req, res) => {
  const dbName = await getDbName();
  const includeMeta = dbName
    ? await hasColumn(dbName, "vine_notifications", "meta_json")
    : false;
  const [rows] = await db.query(
    `
    SELECT 
      n.id,
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
    JOIN vine_users u ON n.actor_id = u.id
    WHERE n.user_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM vine_mutes m
        WHERE m.muter_id = n.user_id AND m.muted_id = n.actor_id
      )
    ORDER BY n.created_at DESC
    LIMIT 80
  `,
    [req.user.id]
  );

  res.json(rows);
});
// Get unread count
router.get("/notifications/unread-count", authenticate, async (req, res) => {
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS total FROM vine_notifications WHERE user_id = ? AND is_read = 0",
    [req.user.id]
  );

  res.json({ count: row.total });
});

// Count notifications received since a given timestamp (ignores is_read)
router.get("/notifications/unseen-count", authenticate, async (req, res) => {
  const sinceRaw = String(req.query.since || "").trim();
  const since = new Date(sinceRaw);
  if (!sinceRaw || Number.isNaN(since.getTime())) {
    return res.json({ count: 0 });
  }

  const [[row]] = await db.query(
    "SELECT COUNT(*) AS total FROM vine_notifications WHERE user_id = ? AND created_at > ?",
    [req.user.id, since]
  );

  res.json({ count: Number(row?.total || 0) });
});
// Mark all as read
router.post("/notifications/mark-read", authenticate, async (req, res) => {
  await db.query(
    "UPDATE vine_notifications SET is_read = 1 WHERE user_id = ?",
    [req.user.id]
  );

  res.json({ success: true });
});
// Mark single notification as read
router.post("/notifications/:id/read", authenticate, async (req, res) => {
  await db.query(
    "UPDATE vine_notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
    [req.params.id, req.user.id]
  );

  res.json({ success: true });
});

// Update banner position
router.post("/users/banner-position", requireVineAuth, async (req, res) => {
  const userId = req.user.id;
  const { offsetY } = req.body;

  await db.query(
    "UPDATE vine_users SET banner_offset_y = ? WHERE id = ?",
    [offsetY, userId]
  );

  res.json({ success: true });
});
// ❤️ GET liked posts by a user (Profile Likes tab)
router.get("/users/:username/likes", authOptional, async (req, res) => {
  const { username } = req.params;
  const viewerId = req.user?.id || null;

  try {
    // 1️⃣ Resolve user ID from username
    const [[user]] = await db.query(
      "SELECT id, is_private FROM vine_users WHERE username = ?",
      [username]
    );

    if (!user) {
      return res.status(200).json([]);
    }

    if (await isUserBlocked(user.id, viewerId)) {
      return res.status(200).json([]);
    }

    if (user.is_private && Number(user.id) !== Number(viewerId || 0)) {
      const [follow] = await db.query(
        "SELECT 1 FROM vine_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
        [viewerId, user.id]
      );
      if (!follow.length) return res.status(200).json([]);
    }

    // 2️⃣ Fetch liked posts (feed-compatible)
    const [rows] = await db.query(
      `
      SELECT DISTINCT
        p.id,
        CONCAT('post-', p.id) AS feed_id,
        p.user_id,
        p.content,
        p.image_url,
        p.link_preview,
        p.created_at,
        l.created_at AS sort_time,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        u.hide_like_counts,
        (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
        (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
        (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,
        (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS views,
        ${
          viewerId
            ? `(SELECT COUNT(*) > 0 FROM vine_likes WHERE post_id = p.id AND user_id = ${viewerId})`
            : "0"
        } AS user_liked,
        ${
          viewerId
            ? `(SELECT COUNT(*) > 0 FROM vine_revines WHERE post_id = p.id AND user_id = ${viewerId})`
            : "0"
        } AS user_revined
      FROM vine_likes l
      JOIN vine_posts p ON l.post_id = p.id
      JOIN vine_users u ON p.user_id = u.id
      WHERE l.user_id = ?
      ORDER BY sort_time DESC
      `,
      [user.id]
    );

    // 3️⃣ Return feed-ready rows
    res.status(200).json(rows);
  } catch (err) {
    console.error("Fetch liked posts error:", err);
    res.status(500).json([]);
  }
});
// 📸 GET photo posts by a user (Profile Photos tab)
router.get("/users/:username/photos", authOptional, async (req, res) => {
  const { username } = req.params;
  const viewerId = req.user?.id || null;

  try {
    // 1️⃣ Resolve user
    const [[user]] = await db.query(
      "SELECT id, is_private FROM vine_users WHERE username = ?",
      [username]
    );

    if (!user) {
      return res.status(200).json([]);
    }

    if (await isUserBlocked(user.id, viewerId)) {
      return res.status(200).json([]);
    }

    if (user.is_private && Number(user.id) !== Number(viewerId || 0)) {
      const [follow] = await db.query(
        "SELECT 1 FROM vine_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
        [viewerId, user.id]
      );
      if (!follow.length) return res.status(200).json([]);
    }

    // 2️⃣ Fetch posts with images only
    const [rows] = await db.query(
      `
      SELECT
        p.id,
        CONCAT('post-', p.id) AS feed_id,
        p.user_id,
        p.content,
        p.image_url,
        p.link_preview,
        p.created_at AS sort_time,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        u.hide_like_counts,
        (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS views,
        (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS like_count,
        (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comment_count,
        (SELECT COUNT(*) > 0 FROM vine_likes WHERE post_id = p.id AND user_id = ?) AS user_liked
      FROM vine_posts p
      JOIN vine_users u ON p.user_id = u.id
      WHERE p.user_id = ?
        AND p.image_url IS NOT NULL
      ORDER BY sort_time DESC
      `,
      [viewerId || 0, user.id]
    );

    res.status(200).json(rows);
  } catch (err) {
    console.error("Fetch photo posts error:", err);
    res.status(500).json([]);
  }
});

// 🔖 Saved posts (bookmarks) — only for self
router.get("/users/:username/bookmarks", authOptional, async (req, res) => {
  try {
    const { username } = req.params;
    const viewerId = req.user?.id || null;

    const [[user]] = await db.query(
      "SELECT id FROM vine_users WHERE username = ?",
      [username]
    );

    if (!user || !viewerId || Number(user.id) !== Number(viewerId)) {
      return res.json([]);
    }

    const [rows] = await db.query(
      `
      SELECT 
        p.id,
        CONCAT('post-', p.id) AS feed_id,
        p.user_id,
        p.content,
        p.image_url,
        p.link_preview,
        p.created_at AS sort_time,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        u.hide_like_counts,
        (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
        (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
        (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,
        (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS views,
        (SELECT COUNT(*) > 0 FROM vine_likes WHERE post_id = p.id AND user_id = ?) AS user_liked,
        (SELECT COUNT(*) > 0 FROM vine_revines WHERE post_id = p.id AND user_id = ?) AS user_revined,
        1 AS user_bookmarked
      FROM vine_bookmarks b
      JOIN vine_posts p ON b.post_id = p.id
      JOIN vine_users u ON p.user_id = u.id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
      `,
      [viewerId, viewerId, viewerId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Fetch bookmarks error:", err);
    res.status(500).json([]);
  }
});

// 🔇 List muted users for current user
router.get("/users/me/mutes", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      `
      SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified
      FROM vine_mutes m
      JOIN vine_users u ON u.id = m.muted_id
      WHERE m.muter_id = ?
      ORDER BY m.created_at DESC
      `,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Muted list error:", err);
    res.status(500).json([]);
  }
});
// 🗑️ Delete comment or reply (author, post owner, or moderator)
router.delete("/comments/:id", requireVineAuth, async (req, res) => {
  try {
    const commentId = req.params.id;
    const userId = req.user.id;

    const [[comment]] = await db.query(
      `
      SELECT c.user_id, p.user_id AS post_owner_id
      FROM vine_comments c
      JOIN vine_posts p ON p.id = c.post_id
      WHERE c.id = ?
      `,
      [commentId]
    );

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const isModerator = isModeratorAccount(req.user);
    const canDelete =
      Number(comment.user_id) === Number(userId) ||
      Number(comment.post_owner_id) === Number(userId) ||
      isModerator;

    if (!canDelete) {
      return res.status(403).json({ message: "Not allowed" });
    }

    // delete replies first (safe for threaded)
    await db.query(
      "DELETE FROM vine_comments WHERE parent_comment_id = ?",
      [commentId]
    );

    await db.query(
      "DELETE FROM vine_comments WHERE id = ?",
      [commentId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Delete comment failed:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});
// Toggle pin / unpin
router.post("/posts/:id/pin", requireVineAuth, async (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  // Check current state
  const [[post]] = await db.query(
    "SELECT is_pinned FROM vine_posts WHERE id = ? AND user_id = ?",
    [postId, userId]
  );

  if (!post) {
    return res.status(404).json({ message: "Post not found" });
  }

  if (post.is_pinned === 1) {
    // 🔓 UNPIN (allow empty profile)
    await db.query(
      "UPDATE vine_posts SET is_pinned = 0 WHERE id = ? AND user_id = ?",
      [postId, userId]
    );

    return res.json({ is_pinned: 0 });
  }

  // 📌 PIN (clear others first)
  await db.query(
    "UPDATE vine_posts SET is_pinned = 0 WHERE user_id = ?",
    [userId]
  );

  await db.query(
    "UPDATE vine_posts SET is_pinned = 1 WHERE id = ? AND user_id = ?",
    [postId, userId]
  );

  res.json({ is_pinned: 1 });
});

  export default router;
