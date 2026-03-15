import express from "express";
import { db, io, getOnlineUserIds } from "../../server.js";
import { authenticate } from "../auth.js";
import multer from "multer";
import cloudinary from "../../config/cloudinary.js";
import { recordPerfQuery, recordPerfRoute } from "./perfStore.js";

const router = express.Router();
const DISAPPEARING_MODES = new Set(["after_read", "1h", "24h"]);
const uploadDmMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

let dmSchemaReady = false;
let dmDbName = null;
let dmPerformanceReady = false;
let dmPerformancePromise = null;

const DM_CACHE_TTLS = {
  conversations: 6_000,
  messages: 4_000,
  settings: 10_000,
  unread: 4_000,
  presence: 5_000,
};
const dmReadCache = new Map();
const DM_READ_CACHE_MAX = 300;

const getDmDbName = async () => {
  if (dmDbName) return dmDbName;
  const [[row]] = await db.query("SELECT DATABASE() AS dbName");
  dmDbName = row?.dbName || null;
  return dmDbName;
};

const buildDmCacheKey = (...parts) =>
  parts
    .map((part) => {
      if (part === null || part === undefined) return "";
      if (typeof part === "string") return part;
      if (typeof part === "number" || typeof part === "boolean") return String(part);
      return JSON.stringify(part);
    })
    .join("::");

const cloneDmCachedValue = (value) => {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const pruneDmReadCache = () => {
  const now = Date.now();
  for (const [key, entry] of dmReadCache.entries()) {
    if (!entry || entry.expiresAt <= now) dmReadCache.delete(key);
  }
  if (dmReadCache.size <= DM_READ_CACHE_MAX) return;
  const oldest = [...dmReadCache.entries()]
    .sort((a, b) => (a[1]?.expiresAt || 0) - (b[1]?.expiresAt || 0))
    .slice(0, dmReadCache.size - DM_READ_CACHE_MAX);
  for (const [key] of oldest) dmReadCache.delete(key);
};

const getDmReadCache = (key) => {
  const entry = dmReadCache.get(key);
  if (!entry) return { hit: false, value: undefined };
  if (entry.expiresAt <= Date.now()) {
    dmReadCache.delete(key);
    return { hit: false, value: undefined };
  }
  return { hit: true, value: cloneDmCachedValue(entry.value) };
};

const setDmReadCache = (key, value, ttlMs) => {
  pruneDmReadCache();
  dmReadCache.set(key, {
    value: cloneDmCachedValue(value),
    expiresAt: Date.now() + ttlMs,
  });
};

const readThroughDmCache = async (key, ttlMs, loader) => {
  const cached = getDmReadCache(key);
  if (cached.hit) return cached.value;
  const value = await loader();
  if (value !== undefined) setDmReadCache(key, value, ttlMs);
  return cloneDmCachedValue(value);
};

const clearDmReadCache = (...prefixes) => {
  if (!prefixes.length) {
    dmReadCache.clear();
    return;
  }
  const normalized = prefixes
    .flat()
    .map((prefix) => String(prefix || "").trim())
    .filter(Boolean);
  if (!normalized.length) {
    dmReadCache.clear();
    return;
  }
  for (const key of dmReadCache.keys()) {
    if (normalized.some((prefix) => key === prefix || key.startsWith(`${prefix}::`))) {
      dmReadCache.delete(key);
    }
  }
};

const DM_PERF_LOGS_ENABLED = process.env.VINE_PERF_LOGS !== "0";
const DM_SLOW_ROUTE_MS = Math.max(50, Number(process.env.DM_SLOW_ROUTE_MS || process.env.VINE_SLOW_ROUTE_MS || 500));
const DM_SLOW_QUERY_MS = Math.max(25, Number(process.env.DM_SLOW_QUERY_MS || process.env.VINE_SLOW_QUERY_MS || 150));

const createDmPerfContext = (routeKey, meta = {}) => ({
  routeKey,
  meta,
  startedAt: Date.now(),
  queries: [],
});

const getDmPerfRowCount = (rows) => {
  if (Array.isArray(rows)) return rows.length;
  if (rows && typeof rows === "object") {
    if (Number.isFinite(Number(rows.affectedRows))) return Number(rows.affectedRows);
    if (Number.isFinite(Number(rows.insertId)) && Number(rows.insertId) > 0) return 1;
  }
  return 0;
};

const timedDmQuery = async (perfCtx, label, sql, params = []) => {
  const startedAt = Date.now();
  const result = await db.query(sql, params);
  const elapsedMs = Date.now() - startedAt;
  const rows = Array.isArray(result) ? result[0] : undefined;
  const rowCount = getDmPerfRowCount(rows);
  if (perfCtx) perfCtx.queries.push({ label, ms: elapsedMs, rows: rowCount });
  if (DM_PERF_LOGS_ENABLED && elapsedMs >= DM_SLOW_QUERY_MS) {
    recordPerfQuery("dm", {
      route: perfCtx?.routeKey || "unknown",
      label,
      ms: elapsedMs,
      rows: rowCount,
    });
    console.info(
      "[dm-perf][query]",
      JSON.stringify({
        route: perfCtx?.routeKey || "unknown",
        label,
        ms: elapsedMs,
        rows: rowCount,
      })
    );
  }
  return result;
};

const finalizeDmPerfContext = (perfCtx, extra = {}) => {
  if (!DM_PERF_LOGS_ENABLED || !perfCtx) return;
  const durationMs = Date.now() - perfCtx.startedAt;
  const totalQueryMs = perfCtx.queries.reduce((sum, query) => sum + Number(query.ms || 0), 0);
  const topQueries = [...perfCtx.queries]
    .sort((a, b) => Number(b.ms || 0) - Number(a.ms || 0))
    .slice(0, 3);
  const shouldLog =
    durationMs >= DM_SLOW_ROUTE_MS ||
    topQueries.some((query) => Number(query.ms || 0) >= DM_SLOW_QUERY_MS);
  if (!shouldLog) return;
  recordPerfRoute("dm", {
    route: perfCtx.routeKey,
    ms: durationMs,
    query_count: perfCtx.queries.length,
    query_ms: totalQueryMs,
    top_queries: topQueries,
    ...perfCtx.meta,
    ...extra,
  });
  console.info(
    "[dm-perf][route]",
    JSON.stringify({
      route: perfCtx.routeKey,
      ms: durationMs,
      query_count: perfCtx.queries.length,
      query_ms: totalQueryMs,
      top_queries: topQueries,
      ...perfCtx.meta,
      ...extra,
    })
  );
};

const runDmPerfRoute = async (routeKey, meta, work) => {
  const perfCtx = createDmPerfContext(routeKey, meta);
  try {
    return await work(perfCtx);
  } finally {
    finalizeDmPerfContext(perfCtx);
  }
};

const hasDmIndexNamed = async (dbName, tableName, indexName) => {
  const [rows] = await db.query(
    `
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
    LIMIT 1
    `,
    [dbName, tableName, indexName]
  );
  return rows.length > 0;
};

const hasDmTable = async (dbName, tableName) => {
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

const hasDmIndexWithColumns = async (dbName, tableName, columns = []) => {
  const normalizedColumns = columns.map((col) => String(col).trim().toLowerCase());
  if (!normalizedColumns.length) return false;
  const [rows] = await db.query(
    `
    SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `,
    [dbName, tableName]
  );
  const grouped = new Map();
  for (const row of rows) {
    const indexName = String(row.INDEX_NAME || "");
    if (!grouped.has(indexName)) grouped.set(indexName, []);
    grouped.get(indexName).push(String(row.COLUMN_NAME || "").trim().toLowerCase());
  }
  for (const cols of grouped.values()) {
    if (cols.length !== normalizedColumns.length) continue;
    if (cols.every((col, idx) => col === normalizedColumns[idx])) return true;
  }
  return false;
};

const ensureDmIndexExists = async (dbName, tableName, indexName, columns = []) => {
  if (!dbName || !columns.length) return;
  if (!(await hasDmTable(dbName, tableName))) return;
  if (await hasDmIndexNamed(dbName, tableName, indexName)) return;
  if (await hasDmIndexWithColumns(dbName, tableName, columns)) return;
  await db.query(`CREATE INDEX ${indexName} ON ${tableName} (${columns.join(", ")})`);
};
const addColumnIfMissing = async (tableName, columnName, definitionSql) => {
  const [rows] = await db.query(
    `
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [tableName, columnName]
  );
  if (rows.length) return;
  await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
};

const ensureDmSchema = async () => {
  if (dmSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_message_meta (
      message_id INT PRIMARY KEY,
      reply_to_id INT NULL,
      media_url TEXT NULL,
      media_type VARCHAR(20) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_conversation_pins (
      user_id INT NOT NULL,
      conversation_id INT NOT NULL,
      pinned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, conversation_id),
      INDEX idx_pins_user_time (user_id, pinned_at)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_message_reactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message_id INT NOT NULL,
      user_id INT NOT NULL,
      reaction VARCHAR(16) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_dm_reaction (message_id, user_id),
      INDEX idx_dm_reaction_msg (message_id)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_conversation_settings (
      conversation_id INT PRIMARY KEY,
      disappearing_enabled TINYINT(1) NOT NULL DEFAULT 0,
      disappear_mode VARCHAR(20) NOT NULL DEFAULT 'after_read',
      updated_by INT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await addColumnIfMissing("vine_messages", "read_at", "read_at DATETIME NULL");
  await addColumnIfMissing(
    "vine_messages",
    "is_disappearing",
    "is_disappearing TINYINT(1) NOT NULL DEFAULT 0"
  );
  await addColumnIfMissing("vine_messages", "disappeared_at", "disappeared_at DATETIME NULL");
  await addColumnIfMissing(
    "vine_messages",
    "disappear_mode",
    "disappear_mode VARCHAR(20) NOT NULL DEFAULT 'after_read'"
  );
  await addColumnIfMissing("vine_messages", "expires_at", "expires_at DATETIME NULL");
  dmSchemaReady = true;
};

const ensureDmPerformanceSchema = async () => {
  if (dmPerformanceReady) return;
  if (dmPerformancePromise) return dmPerformancePromise;

  dmPerformancePromise = (async () => {
    await ensureDmSchema();
    const dbName = await getDmDbName();
    if (!dbName) return;

    const indexes = [
      ["vine_conversations", "idx_vine_conversations_user1_user2", ["user1_id", "user2_id"]],
      ["vine_conversations", "idx_vine_conversations_user2_user1", ["user2_id", "user1_id"]],
      ["vine_messages", "idx_vine_messages_conversation_created", ["conversation_id", "created_at"]],
      ["vine_messages", "idx_vine_messages_conversation_read_sender", ["conversation_id", "is_read", "sender_id"]],
      ["vine_messages", "idx_vine_messages_disappearing_expiry", ["is_disappearing", "disappear_mode", "expires_at"]],
      ["vine_messages", "idx_vine_messages_sender_created", ["sender_id", "created_at"]],
      ["vine_conversation_deletes", "idx_vine_conv_deletes_user_conversation", ["user_id", "conversation_id"]],
      ["vine_conversation_deletes", "idx_vine_conv_deletes_conversation_user", ["conversation_id", "user_id"]],
      ["vine_message_meta", "idx_vine_message_meta_reply", ["reply_to_id"]],
      ["vine_message_reactions", "idx_vine_message_reactions_user_message", ["user_id", "message_id"]],
      ["vine_conversation_settings", "idx_vine_conv_settings_updated", ["updated_at"]],
    ];

    for (const [tableName, indexName, columns] of indexes) {
      try {
        await ensureDmIndexExists(dbName, tableName, indexName, columns);
      } catch (err) {
        console.warn(`DM index ensure skipped for ${tableName}.${indexName}:`, err?.message || err);
      }
    }

    dmPerformanceReady = true;
  })().finally(() => {
    dmPerformancePromise = null;
  });

  return dmPerformancePromise;
};

const uploadBufferToCloudinary = (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { timeout: 180000, ...options },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    stream.end(buffer);
  });

const extractCloudinaryPublicId = (rawUrl) => {
  const asString = String(rawUrl || "").trim();
  if (!asString) return null;
  try {
    const parsed = new URL(asString);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const uploadIndex = pathParts.findIndex((p) => p === "upload");
    if (uploadIndex < 0) return null;
    const tail = pathParts.slice(uploadIndex + 1);
    if (!tail.length) return null;
    if (/^(image|video|raw)$/i.test(tail[0])) tail.shift();
    if (/^(upload|private|authenticated)$/i.test(tail[0])) tail.shift();
    if (tail[0] && /^v\d+$/i.test(tail[0])) tail.shift();
    if (!tail.length) return null;
    const last = tail[tail.length - 1] || "";
    tail[tail.length - 1] = last.replace(/\.[^/.?#]+$/, "");
    return tail.join("/") || null;
  } catch {
    return null;
  }
};

const deleteCloudinaryByUrl = async (url, mediaType) => {
  const publicId = extractCloudinaryPublicId(url);
  if (!publicId) return;
  const resourceTypes =
    mediaType === "voice" ? ["video", "raw"] : mediaType === "image" ? ["image"] : ["image", "video", "raw"];
  for (const resourceType of resourceTypes) {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      });
      if (result?.result === "ok" || result?.result === "deleted") return;
    } catch {
      // try next resource type
    }
  }
};

const getConversationForUser = async (conversationId, userId) => {
  const [[row]] = await db.query(
    `
    SELECT id, user1_id, user2_id
    FROM vine_conversations
    WHERE id = ?
      AND (user1_id = ? OR user2_id = ?)
    LIMIT 1
    `,
    [conversationId, userId, userId]
  );
  return row || null;
};

const getConversationSettings = async (conversationId) => {
  await ensureDmPerformanceSchema();
  const cacheKey = buildDmCacheKey("dm-settings", Number(conversationId || 0));
  return readThroughDmCache(cacheKey, DM_CACHE_TTLS.settings, async () => {
    const [[row]] = await db.query(
      `
      SELECT disappearing_enabled, disappear_mode, updated_by, updated_at
      FROM vine_conversation_settings
      WHERE conversation_id = ?
      LIMIT 1
      `,
      [conversationId]
    );
    return {
      disappearing_enabled: Number(row?.disappearing_enabled || 0) === 1,
      disappear_mode: DISAPPEARING_MODES.has(String(row?.disappear_mode || ""))
        ? row.disappear_mode
        : "after_read",
      updated_by: row?.updated_by || null,
      updated_at: row?.updated_at || null,
    };
  });
};

const getDisappearingExpiryForMode = (mode) => {
  if (mode === "1h") {
    return new Date(Date.now() + 60 * 60 * 1000);
  }
  if (mode === "24h") {
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  return null;
};

const removeMessagesPermanently = async (conversationId, messageIds = []) => {
  const ids = Array.from(new Set((messageIds || []).map((id) => Number(id)).filter(Boolean)));
  if (!ids.length) return [];
  const [[conversation]] = await db.query(
    `
    SELECT user1_id, user2_id
    FROM vine_conversations
    WHERE id = ?
    LIMIT 1
    `,
    [conversationId]
  );

  const placeholders = ids.map(() => "?").join(",");
  const [mediaRows] = await db.query(
    `
    SELECT message_id, media_url, media_type
    FROM vine_message_meta
    WHERE message_id IN (${placeholders})
    `,
    ids
  );

  for (const row of mediaRows) {
    if (row?.media_url) {
      await deleteCloudinaryByUrl(row.media_url, row.media_type).catch(() => {});
    }
  }

  await db.query(
    `DELETE FROM vine_message_reactions WHERE message_id IN (${placeholders})`,
    ids
  );
  await db.query(
    `DELETE FROM vine_message_meta WHERE message_id IN (${placeholders})`,
    ids
  );
  await db.query(
    `DELETE FROM vine_messages WHERE id IN (${placeholders})`,
    ids
  );

  io.to(`conversation-${conversationId}`).emit("dm_messages_disappeared", {
    conversation_id: conversationId,
    message_ids: ids,
  });
  if (conversation?.user1_id) io.to(`user-${conversation.user1_id}`).emit("inbox_updated");
  if (conversation?.user2_id) io.to(`user-${conversation.user2_id}`).emit("inbox_updated");
  clearDmReadCache("dm-conversations", "dm-unread", "dm-messages", buildDmCacheKey("dm-settings", Number(conversationId || 0)));

  return ids;
};

const cleanupExpiredDisappearingMessages = async (conversationId = null) => {
  await ensureDmSchema();
  const params = [];
  let whereConversation = "";
  if (conversationId) {
    whereConversation = "AND conversation_id = ?";
    params.push(conversationId);
  }

  const [rows] = await db.query(
    `
    SELECT id, conversation_id
    FROM vine_messages
    WHERE is_disappearing = 1
      AND disappear_mode IN ('1h', '24h')
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
      ${whereConversation}
    ORDER BY conversation_id ASC, id ASC
    `,
    params
  );

  if (!rows.length) return [];

  const grouped = new Map();
  rows.forEach((row) => {
    const key = Number(row.conversation_id);
    const cur = grouped.get(key) || [];
    cur.push(Number(row.id));
    grouped.set(key, cur);
  });

  const removed = [];
  for (const [cid, ids] of grouped.entries()) {
    const deleted = await removeMessagesPermanently(cid, ids);
    removed.push(...deleted);
  }
  return removed;
};

const markConversationReadAndDisappear = async (conversationId, userId) => {
  await ensureDmSchema();
  const convo = await getConversationForUser(conversationId, userId);
  if (!convo) return null;

  const expiredIds = await cleanupExpiredDisappearingMessages(conversationId);

  const [disappearingRows] = await db.query(
    `
    SELECT id
    FROM vine_messages
    WHERE conversation_id = ?
      AND sender_id != ?
      AND is_read = 0
      AND is_disappearing = 1
      AND COALESCE(disappear_mode, 'after_read') = 'after_read'
    ORDER BY created_at ASC
    `,
    [conversationId, userId]
  );

  await db.query(
    `
    UPDATE vine_messages
    SET is_read = 1,
        read_at = NOW()
    WHERE conversation_id = ?
      AND sender_id != ?
      AND is_read = 0
    `,
    [conversationId, userId]
  );

  const disappearedIds = await removeMessagesPermanently(
    conversationId,
    disappearingRows.map((row) => row.id)
  );

  return {
    ...convo,
    disappearedIds: [...expiredIds, ...disappearedIds],
  };
};

const hydrateMessages = async (messages, viewerId) => {
  if (!Array.isArray(messages) || !messages.length) return messages || [];
  await ensureDmSchema();
  const ids = messages.map((m) => Number(m.id)).filter(Boolean);
  const placeholders = ids.map(() => "?").join(",");

  const [metaRows] = await db.query(
    `
    SELECT message_id, reply_to_id, media_url, media_type
    FROM vine_message_meta
    WHERE message_id IN (${placeholders})
    `,
    ids
  );

  const [reactionRows] = await db.query(
    `
    SELECT message_id, reaction, COUNT(*) AS total
    FROM vine_message_reactions
    WHERE message_id IN (${placeholders})
    GROUP BY message_id, reaction
    `,
    ids
  );

  const [viewerRows] = await db.query(
    `
    SELECT message_id, reaction
    FROM vine_message_reactions
    WHERE user_id = ? AND message_id IN (${placeholders})
    `,
    [viewerId, ...ids]
  );

  const metaMap = new Map();
  metaRows.forEach((r) => metaMap.set(Number(r.message_id), r));

  const reactionMap = new Map();
  reactionRows.forEach((r) => {
    const key = Number(r.message_id);
    const cur = reactionMap.get(key) || {};
    cur[String(r.reaction)] = Number(r.total || 0);
    reactionMap.set(key, cur);
  });

  const viewerReactionMap = new Map();
  viewerRows.forEach((r) =>
    viewerReactionMap.set(Number(r.message_id), String(r.reaction || ""))
  );

  const replyIds = Array.from(
    new Set(
      metaRows.map((m) => Number(m.reply_to_id)).filter(Boolean)
    )
  );
  const replyMap = new Map();
  if (replyIds.length) {
    const replyPlaceholders = replyIds.map(() => "?").join(",");
    const [replies] = await db.query(
      `
      SELECT
        m.id,
        m.sender_id,
        m.content,
        u.username,
        u.display_name
      FROM vine_messages m
      JOIN vine_users u ON u.id = m.sender_id
      WHERE m.id IN (${replyPlaceholders})
      `,
      replyIds
    );
    replies.forEach((r) =>
      replyMap.set(Number(r.id), {
        id: Number(r.id),
        sender_id: Number(r.sender_id),
        username: r.username,
        display_name: r.display_name || r.username,
        content: String(r.content || "").slice(0, 220),
      })
    );
  }

  return messages.map((m) => {
    const id = Number(m.id);
    const meta = metaMap.get(id);
    const replyToId = Number(meta?.reply_to_id || 0) || null;
    return {
      ...m,
      media_url: meta?.media_url || null,
      media_type: meta?.media_type || null,
      reply_to_id: replyToId,
      reply_to_message: replyToId ? replyMap.get(replyToId) || null : null,
      reactions: reactionMap.get(id) || {},
      viewer_reaction: viewerReactionMap.get(id) || null,
    };
  });
};

/* =========================
   HELPER: check following
========================= */
async function isFollowing(followerId, followingId) {
  const [rows] = await db.query(
    `
    SELECT 1
    FROM vine_follows
    WHERE follower_id = ? AND following_id = ?
    LIMIT 1
    `,
    [followerId, followingId]
  );
  return rows.length > 0;
}
/* =========================
   GET conversations list
========================= */
router.get("/conversations", authenticate, async (req, res) => {
  const userId = req.user.id;
  const q = String(req.query?.q || "").trim().toLowerCase();

  try {
    const rows = await runDmPerfRoute(
      "dm-conversations",
      { user_id: Number(userId), q: q || null },
      async (perfCtx) => {
        await ensureDmPerformanceSchema();
        await cleanupExpiredDisappearingMessages();
        const cacheKey = buildDmCacheKey("dm-conversations", Number(userId), q || "");
        return readThroughDmCache(cacheKey, DM_CACHE_TTLS.conversations, async () => {
          const qWhere = q
            ? `
              AND (
                LOWER(u.username) LIKE ?
                OR LOWER(COALESCE(u.display_name, '')) LIKE ?
                OR LOWER(COALESCE((
                  SELECT content
                  FROM vine_messages
                  WHERE conversation_id = c.id
                  ORDER BY created_at DESC
                  LIMIT 1
                ), '')) LIKE ?
              )
            `
            : "";
          const params = [
            userId,
            userId,
            userId,
            userId,
            userId,
            userId,
            userId,
            userId,
            userId,
            ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []),
          ];
          const [conversationRows] = await timedDmQuery(
            perfCtx,
            "dm-conversations.rows",
            `
            SELECT 
              c.id AS conversation_id,

              u.id AS user_id,
              u.username,
              u.avatar_url,
              u.last_active_at,
              u.show_last_active,
              u.is_verified,

              (
                SELECT content
                FROM vine_messages
                WHERE conversation_id = c.id
                ORDER BY created_at DESC
                LIMIT 1
              ) AS last_message,

              (
                SELECT created_at
                FROM vine_messages
                WHERE conversation_id = c.id
                ORDER BY created_at DESC
                LIMIT 1
              ) AS last_message_time,

              (
                SELECT COUNT(*)
                FROM vine_messages
                WHERE conversation_id = c.id
                  AND is_read = 0
                  AND sender_id != ?
              ) AS unread_count,
              EXISTS (
                SELECT 1
                FROM vine_conversation_pins cp
                WHERE cp.user_id = ?
                  AND cp.conversation_id = c.id
              ) AS is_pinned,
              (
                SELECT cp.pinned_at
                FROM vine_conversation_pins cp
                WHERE cp.user_id = ?
                  AND cp.conversation_id = c.id
                LIMIT 1
              ) AS pinned_at

            FROM vine_conversations c
            JOIN vine_users u 
              ON u.id = IF(c.user1_id = ?, c.user2_id, c.user1_id)

            WHERE (c.user1_id = ? OR c.user2_id = ?)
              AND EXISTS (
                SELECT 1
                FROM vine_messages vm
                WHERE vm.conversation_id = c.id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM vine_conversation_deletes d
                WHERE d.conversation_id = c.id
                  AND d.user_id = ?
              )
              AND NOT EXISTS (
                SELECT 1
                FROM vine_mutes m
                WHERE m.muter_id = ?
                  AND m.muted_id = IF(c.user1_id = ?, c.user2_id, c.user1_id)
              )
              ${qWhere}

            ORDER BY is_pinned DESC, COALESCE(pinned_at, '1970-01-01') DESC, last_message_time DESC
          `,
            params
          );
          return conversationRows;
        });
      }
    );

    res.json(rows);
  } catch (err) {
    console.error("Get conversations error:", err);
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

/* =========================
   GET messages in conversation (RESPECT DELETE)
========================= */
router.get("/conversations/:id/messages", authenticate, async (req, res) => {
  const userId = req.user.id;
  const conversationId = req.params.id;

  try {
    const result = await runDmPerfRoute(
      "dm-messages",
      { conversation_id: Number(conversationId), user_id: Number(userId) },
      async (perfCtx) => {
        await ensureDmPerformanceSchema();
        await cleanupExpiredDisappearingMessages(conversationId);
        const [check] = await timedDmQuery(
          perfCtx,
          "dm-messages.check",
          `
          SELECT 1
          FROM vine_conversations
          WHERE id = ?
            AND (user1_id = ? OR user2_id = ?)
          LIMIT 1
          `,
          [conversationId, userId, userId]
        );

        if (!check.length) {
          return { status: 403, body: { error: "Access denied" } };
        }

        const cacheKey = buildDmCacheKey("dm-messages", Number(conversationId), Number(userId));
        const hydrated = await readThroughDmCache(cacheKey, DM_CACHE_TTLS.messages, async () => {
          const [messages] = await timedDmQuery(
            perfCtx,
            "dm-messages.rows",
            `
            SELECT 
              m.id,
              m.sender_id,
              m.content,
              m.created_at,
              m.is_read,
              m.is_disappearing,
              m.disappear_mode,
              m.expires_at,
              u.username,
              u.avatar_url,
              u.is_verified
            FROM vine_messages m
            JOIN vine_users u ON m.sender_id = u.id
            WHERE m.conversation_id = ?
            ORDER BY m.created_at ASC
            `,
            [conversationId]
          );

          return hydrateMessages(messages, userId);
        });

        return { status: 200, body: hydrated };
      }
    );
    if (result.status !== 200) {
      return res.status(result.status).json(result.body);
    }
    res.json(result.body);
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

/* =========================
   START OR GET CONVERSATION
========================= */
router.post("/start", authenticate, async (req, res) => {
  const senderId = req.user.id;
  const { userId: receiverId } = req.body;

  try {
    await ensureDmPerformanceSchema();
    if (!receiverId || Number(receiverId) === Number(senderId)) {
      return res.status(400).json({ error: "Invalid recipient" });
    }

    const [muted] = await db.query(
      `
      SELECT 1
      FROM vine_mutes
      WHERE (muter_id = ? AND muted_id = ?)
      LIMIT 1
      `,
      [receiverId, senderId]
    );

    if (muted.length) {
      return res.status(403).json({ error: "User has muted you" });
    }

    const [blocked] = await db.query(
      `
      SELECT 1
      FROM vine_blocks
      WHERE (blocker_id = ? AND blocked_id = ?)
         OR (blocker_id = ? AND blocked_id = ?)
      LIMIT 1
      `,
      [receiverId, senderId, senderId, receiverId]
    );

    if (blocked.length) {
      return res.status(403).json({ error: "You have been blocked" });
    }

    const [[receiver]] = await db.query(
      "SELECT id FROM vine_users WHERE id = ?",
      [receiverId]
    );

    if (!receiver) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if exists
    const [existing] = await db.query(
      `
      SELECT id FROM vine_conversations
      WHERE (user1_id = ? AND user2_id = ?)
         OR (user1_id = ? AND user2_id = ?)
      LIMIT 1
      `,
      [senderId, receiverId, receiverId, senderId]
    );

    if (existing.length) {
      // Restore conversation in sender's inbox if previously deleted
      await db.query(
        `
        DELETE FROM vine_conversation_deletes
        WHERE conversation_id = ? AND user_id = ?
        `,
        [existing[0].id, senderId]
      );
      clearDmReadCache("dm-conversations", "dm-unread");
      return res.json({ conversationId: existing[0].id });
    }

    // Do not create empty conversations.
    // Conversation will be created on first actual message send.
    return res.json({ conversationId: null });
  } catch (err) {
    console.error("Start conversation error:", err);
    res.status(500).json({ error: "Failed to start conversation" });
  }
});

router.get("/conversations/:id/settings", authenticate, async (req, res) => {
  const userId = Number(req.user.id);
  const conversationId = Number(req.params.id);
  if (!conversationId) return res.status(400).json({ error: "Invalid conversation" });
  try {
    await ensureDmPerformanceSchema();
    const convo = await getConversationForUser(conversationId, userId);
    if (!convo) return res.status(403).json({ error: "Access denied" });
    const settings = await getConversationSettings(conversationId);
    res.json({ conversation_id: conversationId, ...settings });
  } catch (err) {
    console.error("Get conversation settings error:", err);
    res.status(500).json({ error: "Failed to load chat settings" });
  }
});

router.patch("/conversations/:id/settings", authenticate, async (req, res) => {
  const userId = Number(req.user.id);
  const conversationId = Number(req.params.id);
  if (!conversationId) return res.status(400).json({ error: "Invalid conversation" });

  try {
    await ensureDmSchema();
    await ensureDmPerformanceSchema();
    const convo = await getConversationForUser(conversationId, userId);
    if (!convo) return res.status(403).json({ error: "Access denied" });

    const disappearingEnabled = Boolean(req.body?.disappearing_enabled);
    const requestedMode = String(req.body?.disappear_mode || "after_read").trim().toLowerCase();
    const disappearMode = DISAPPEARING_MODES.has(requestedMode) ? requestedMode : "after_read";
    await db.query(
      `
      INSERT INTO vine_conversation_settings
        (conversation_id, disappearing_enabled, disappear_mode, updated_by, updated_at)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        disappearing_enabled = VALUES(disappearing_enabled),
        disappear_mode = VALUES(disappear_mode),
        updated_by = VALUES(updated_by),
        updated_at = NOW()
      `,
      [conversationId, disappearingEnabled ? 1 : 0, disappearMode, userId]
    );

    const settings = await getConversationSettings(conversationId);
    io.to(`conversation-${conversationId}`).emit("dm_settings_updated", {
      conversation_id: conversationId,
      ...settings,
    });
    io.to(`user-${convo.user1_id}`).emit("inbox_updated");
    io.to(`user-${convo.user2_id}`).emit("inbox_updated");
    clearDmReadCache("dm-conversations", "dm-unread", buildDmCacheKey("dm-settings", conversationId), buildDmCacheKey("dm-messages", conversationId));

    res.json({ success: true, conversation_id: conversationId, ...settings });
  } catch (err) {
    console.error("Update conversation settings error:", err);
    res.status(500).json({ error: "Failed to update chat settings" });
  }
});
/* =========================
   SEND MESSAGE (REALTIME FIXED)
========================= */
router.post("/send", authenticate, async (req, res) => {
  const senderId = req.user.id;
  const { conversationId, receiverId, content, media_url, media_type, reply_to_id } = req.body;
  const safeContent = String(content || "").trim();
  const safeMediaUrl = String(media_url || "").trim();
  const safeMediaType = String(media_type || "").trim().toLowerCase();
  const replyToId = Number(reply_to_id) || null;

  if (!safeContent && !safeMediaUrl) {
    return res.status(400).json({ error: "Message empty" });
  }

  try {
    await ensureDmPerformanceSchema();
    let activeConversationId = conversationId;
    let user1_id;
    let user2_id;
    let otherId;

    let createConversationWithUserId = null;

    if (activeConversationId) {
      // Ensure user belongs to this conversation
      const [check] = await db.query(
        `
        SELECT user1_id, user2_id
        FROM vine_conversations
        WHERE id = ? AND (user1_id = ? OR user2_id = ?)
        `,
        [activeConversationId, senderId, senderId]
      );

      if (!check.length) {
        return res.status(403).json({ error: "Not your conversation" });
      }

      ({ user1_id, user2_id } = check[0]);
      otherId = user1_id === senderId ? user2_id : user1_id;
    } else {
      if (!receiverId || Number(receiverId) === Number(senderId)) {
        return res.status(400).json({ error: "Recipient required" });
      }

      const [[receiver]] = await db.query(
        "SELECT id FROM vine_users WHERE id = ?",
        [receiverId]
      );
      if (!receiver) {
        return res.status(404).json({ error: "User not found" });
      }

      const [existing] = await db.query(
        `
        SELECT id, user1_id, user2_id
        FROM vine_conversations
        WHERE (user1_id = ? AND user2_id = ?)
           OR (user1_id = ? AND user2_id = ?)
        LIMIT 1
        `,
        [senderId, receiverId, receiverId, senderId]
      );

      if (existing.length) {
        activeConversationId = existing[0].id;
        user1_id = existing[0].user1_id;
        user2_id = existing[0].user2_id;
        otherId = user1_id === senderId ? user2_id : user1_id;
      } else {
        otherId = receiverId;
        createConversationWithUserId = receiverId;
      }
    }

    const [muted] = await db.query(
      `
      SELECT 1
      FROM vine_mutes
      WHERE muter_id = ? AND muted_id = ?
      LIMIT 1
      `,
      [otherId, senderId]
    );
    if (muted.length) {
      return res.status(403).json({ error: "User has muted you" });
    }

    const [blocked] = await db.query(
      `
      SELECT 1
      FROM vine_blocks
      WHERE (blocker_id = ? AND blocked_id = ?)
         OR (blocker_id = ? AND blocked_id = ?)
      LIMIT 1
      `,
      [otherId, senderId, senderId, otherId]
    );
    if (blocked.length) {
      return res.status(403).json({ error: "You have been blocked" });
    }

    if (!activeConversationId && createConversationWithUserId) {
      const [created] = await db.query(
        `
        INSERT INTO vine_conversations (user1_id, user2_id)
        VALUES (?, ?)
        `,
        [senderId, createConversationWithUserId]
      );
      activeConversationId = created.insertId;
      user1_id = senderId;
      user2_id = createConversationWithUserId;
    }

    if (replyToId) {
      const [[replyExists]] = await db.query(
        "SELECT id FROM vine_messages WHERE id = ? AND conversation_id = ? LIMIT 1",
        [replyToId, activeConversationId]
      );
      if (!replyExists) {
        return res.status(400).json({ error: "Reply target not found in this chat" });
      }
    }

    const conversationSettings = await getConversationSettings(activeConversationId);
    const isDisappearing = conversationSettings.disappearing_enabled ? 1 : 0;
    const disappearMode = conversationSettings.disappearing_enabled
      ? conversationSettings.disappear_mode || "after_read"
      : "after_read";
    const expiresAt = isDisappearing ? getDisappearingExpiryForMode(disappearMode) : null;

    // Insert message
    const [result] = await db.query(
      `
      INSERT INTO vine_messages (
        conversation_id, sender_id, content, is_disappearing, disappear_mode, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        activeConversationId,
        senderId,
        safeContent || (safeMediaType === "voice" ? "Voice note" : "Attachment"),
        isDisappearing,
        disappearMode,
        expiresAt,
      ]
    );

    if (replyToId || safeMediaUrl) {
      await db.query(
        `
        INSERT INTO vine_message_meta (message_id, reply_to_id, media_url, media_type, created_at)
        VALUES (?, ?, ?, ?, NOW())
        `,
        [
          result.insertId,
          replyToId || null,
          safeMediaUrl || null,
          safeMediaType || null,
        ]
      );
    }

    // Fetch full message (with username + avatar)
    const [[fullMessageRaw]] = await db.query(
      `
      SELECT 
        m.id,
        m.conversation_id,
        m.sender_id,
        m.content,
        m.created_at,
        m.is_disappearing,
        m.disappear_mode,
        m.expires_at,
        u.username,
        u.avatar_url,
        u.is_verified
      FROM vine_messages m
      JOIN vine_users u ON m.sender_id = u.id
      WHERE m.id = ?
      `,
      [result.insertId]
    );
    const [hydrated] = await hydrateMessages([fullMessageRaw], senderId);
    const fullMessage = hydrated || fullMessageRaw;

    // ✅ Send to open chat window
    io.to(`conversation-${activeConversationId}`).emit("dm_received", fullMessage);

    // ✅ Send to both users inbox (conversation list realtime)
    io.to(`user-${user1_id}`).emit("dm_received", fullMessage);
    io.to(`user-${user2_id}`).emit("dm_received", fullMessage);
    clearDmReadCache("dm-conversations", "dm-unread", buildDmCacheKey("dm-messages", Number(activeConversationId)));

    // Respond normally
    res.json({ message: fullMessage, conversationId: activeConversationId });

  } catch (err) {
    console.error("Send DM error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.post("/upload-media", authenticate, uploadDmMedia.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const mime = String(file.mimetype || "").toLowerCase();
    const isImage = mime.startsWith("image/");
    const isAudio = mime.startsWith("audio/");
    if (!isImage && !isAudio) {
      return res.status(400).json({ error: "Only image or audio allowed" });
    }
    const uploaded = await uploadBufferToCloudinary(file.buffer, {
      folder: isImage ? "vine/dms/images" : "vine/dms/voice",
      resource_type: isImage ? "image" : "video",
    });
    res.json({
      url: uploaded?.secure_url || uploaded?.url || null,
      media_type: isImage ? "image" : "voice",
      mime_type: file.mimetype || null,
    });
  } catch (err) {
    console.error("Upload DM media error:", err);
    res.status(500).json({ error: "Failed to upload media" });
  }
});

router.post("/messages/:id/reaction", authenticate, async (req, res) => {
  const userId = Number(req.user.id);
  const messageId = Number(req.params.id);
  const reaction = String(req.body?.reaction || "").trim().slice(0, 16);
  if (!messageId) return res.status(400).json({ error: "Invalid message id" });
  const allowed = new Set(["👍", "❤️", "😂", "🔥", "😮", "😢"]);
  if (reaction && !allowed.has(reaction)) {
    return res.status(400).json({ error: "Unsupported reaction" });
  }

  try {
    await ensureDmPerformanceSchema();
    const [[messageRow]] = await db.query(
      `
      SELECT m.id, m.conversation_id
      FROM vine_messages m
      JOIN vine_conversations c ON c.id = m.conversation_id
      WHERE m.id = ?
        AND (c.user1_id = ? OR c.user2_id = ?)
      LIMIT 1
      `,
      [messageId, userId, userId]
    );
    if (!messageRow) return res.status(404).json({ error: "Message not found" });

    if (!reaction) {
      await db.query(
        "DELETE FROM vine_message_reactions WHERE message_id = ? AND user_id = ?",
        [messageId, userId]
      );
    } else {
      await db.query(
        `
        INSERT INTO vine_message_reactions (message_id, user_id, reaction, created_at, updated_at)
        VALUES (?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE reaction = VALUES(reaction), updated_at = NOW()
        `,
        [messageId, userId, reaction]
      );
    }

    const [countsRows] = await db.query(
      `
      SELECT reaction, COUNT(*) AS total
      FROM vine_message_reactions
      WHERE message_id = ?
      GROUP BY reaction
      `,
      [messageId]
    );
    const counts = {};
    countsRows.forEach((r) => {
      counts[String(r.reaction || "")] = Number(r.total || 0);
    });

    io.to(`conversation-${messageRow.conversation_id}`).emit("dm_reaction_updated", {
      message_id: messageId,
      reactions: counts,
      viewer_reaction: reaction || null,
      actor_id: userId,
    });
    clearDmReadCache(buildDmCacheKey("dm-messages", Number(messageRow.conversation_id)));

    res.json({ success: true, message_id: messageId, reactions: counts, viewer_reaction: reaction || null });
  } catch (err) {
    console.error("DM reaction error:", err);
    res.status(500).json({ error: "Failed to update reaction" });
  }
});
/* =========================
   MARK MESSAGES AS READ (REALTIME FIXED)
 ========================= */
router.post("/conversations/:id/read", authenticate, async (req, res) => {
  const userId = req.user.id;
  const conversationId = req.params.id;

  try {
    await ensureDmPerformanceSchema();
    const convo = await markConversationReadAndDisappear(conversationId, userId);
    if (!convo) {
      return res.status(403).json({ error: "Access denied" });
    }

    // 🔥 Notify BOTH users to refresh inbox immediately
    io.to(`user-${convo.user1_id}`).emit("inbox_updated");
    io.to(`user-${convo.user2_id}`).emit("inbox_updated");

    // 🔥 Optional: update open chat UI
    io.to(`conversation-${conversationId}`).emit("messages_seen", {
      conversationId,
      seenBy: userId
    });
    clearDmReadCache("dm-conversations", "dm-unread", buildDmCacheKey("dm-messages", Number(conversationId)));

    res.json({ success: true, disappeared_message_ids: convo.disappearedIds || [] });

  } catch (err) {
    console.error("Read update error:", err);
    res.status(500).json({ error: "Failed to update read status" });
  }
});
/* =========================
   DELETE CONVERSATION (FOR ME)
========================= */
router.delete("/conversations/:id", authenticate, async (req, res) => {
  const userId = req.user.id;
  const conversationId = req.params.id;

  try {
    await ensureDmPerformanceSchema();
    // Ensure user belongs to this conversation
    const [check] = await db.query(
      `
      SELECT 1 
      FROM vine_conversations 
      WHERE id = ? 
        AND (user1_id = ? OR user2_id = ?)
      `,
      [conversationId, userId, userId]
    );

    if (!check.length) {
      return res.status(403).json({ error: "Not your conversation" });
    }

    // Insert delete record (if not already deleted)
    await db.query(
      `
      INSERT IGNORE INTO vine_conversation_deletes (conversation_id, user_id)
      VALUES (?, ?)
      `,
      [conversationId, userId]
    );

    // Notify frontend live
    io.to(`user-${userId}`).emit("inbox_updated");
    clearDmReadCache("dm-conversations", "dm-unread", buildDmCacheKey("dm-messages", Number(conversationId)));

    res.json({ success: true });

  } catch (err) {
    console.error("Delete conversation error:", err);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.post("/conversations/:id/pin", authenticate, async (req, res) => {
  const userId = Number(req.user.id);
  const conversationId = Number(req.params.id);
  const pinned = Boolean(req.body?.pinned);
  if (!conversationId) return res.status(400).json({ error: "Invalid conversation" });
  try {
    await ensureDmPerformanceSchema();
    const [[check]] = await db.query(
      `
      SELECT id
      FROM vine_conversations
      WHERE id = ? AND (user1_id = ? OR user2_id = ?)
      LIMIT 1
      `,
      [conversationId, userId, userId]
    );
    if (!check) return res.status(403).json({ error: "Access denied" });

    if (pinned) {
      await db.query(
        `
        INSERT INTO vine_conversation_pins (user_id, conversation_id, pinned_at)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE pinned_at = NOW()
        `,
        [userId, conversationId]
      );
    } else {
      await db.query(
        "DELETE FROM vine_conversation_pins WHERE user_id = ? AND conversation_id = ?",
        [userId, conversationId]
      );
    }
    io.to(`user-${userId}`).emit("inbox_updated");
    clearDmReadCache("dm-conversations", "dm-unread");
    res.json({ success: true, pinned });
  } catch (err) {
    console.error("Pin conversation error:", err);
    res.status(500).json({ error: "Failed to pin conversation" });
  }
});

router.delete("/messages/:id", authenticate, async (req, res) => {
  const userId = Number(req.user.id);
  const messageId = Number(req.params.id);
  if (!messageId) return res.status(400).json({ error: "Invalid message id" });
  try {
    await ensureDmPerformanceSchema();
    const [[row]] = await db.query(
      `
      SELECT id, conversation_id, sender_id
      FROM vine_messages
      WHERE id = ?
      LIMIT 1
      `,
      [messageId]
    );
    if (!row) return res.status(404).json({ error: "Message not found" });
    if (Number(row.sender_id) !== userId) {
      return res.status(403).json({ error: "You can only delete your own message" });
    }

    await removeMessagesPermanently(row.conversation_id, [messageId]);
    io.to(`user-${userId}`).emit("inbox_updated");

    res.json({ success: true });
  } catch (err) {
    console.error("Delete message error:", err);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

/* =========================
   GET messages in conversation (SAFE)
========================= */
router.get("/conversations/:id/messages", authenticate, async (req, res) => {
  const userId = req.user.id;
  const conversationId = req.params.id;

  try {
    const result = await runDmPerfRoute(
      "dm-messages",
      { conversation_id: Number(conversationId), user_id: Number(userId), variant: "safe" },
      async (perfCtx) => {
        await ensureDmPerformanceSchema();
        await cleanupExpiredDisappearingMessages(conversationId);
        const [check] = await timedDmQuery(
          perfCtx,
          "dm-messages.check",
          `
          SELECT 1
          FROM vine_conversations
          WHERE id = ?
            AND (user1_id = ? OR user2_id = ?)
          `,
          [conversationId, userId, userId]
        );

        if (!check.length) {
          return { status: 403, body: { error: "Access denied" } };
        }

        const cacheKey = buildDmCacheKey("dm-messages", Number(conversationId), Number(userId));
        const hydrated = await readThroughDmCache(cacheKey, DM_CACHE_TTLS.messages, async () => {
          const [messages] = await timedDmQuery(
            perfCtx,
            "dm-messages.rows",
            `
            SELECT 
              m.id,
              m.sender_id,
              m.content,
              m.created_at,
              m.is_read,
              m.is_disappearing,
              m.disappear_mode,
              m.expires_at,
              u.username,
              u.avatar_url
            FROM vine_messages m
            JOIN vine_users u ON m.sender_id = u.id
            WHERE m.conversation_id = ?
            ORDER BY m.created_at ASC
            `,
            [conversationId]
          );

          return hydrateMessages(messages, userId);
        });

        return { status: 200, body: hydrated };
      }
    );
    if (result.status !== 200) {
      return res.status(result.status).json(result.body);
    }
    res.json(result.body);
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

/* =========================
   GET TOTAL UNREAD DMS
========================= */
router.get("/unread-total", authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    const row = await runDmPerfRoute(
      "dm-unread-total",
      { user_id: Number(userId) },
      async (perfCtx) => {
        await ensureDmPerformanceSchema();
        await cleanupExpiredDisappearingMessages();
        const cacheKey = buildDmCacheKey("dm-unread", Number(userId));
        return readThroughDmCache(cacheKey, DM_CACHE_TTLS.unread, async () => {
          const [[countRow]] = await timedDmQuery(
            perfCtx,
            "dm-unread-total.count",
            `
            SELECT COUNT(*) AS total
            FROM vine_messages m
            JOIN vine_conversations c ON c.id = m.conversation_id
            LEFT JOIN vine_conversation_deletes d
              ON d.conversation_id = c.id AND d.user_id = ?
            WHERE m.is_read = 0
              AND m.sender_id != ?
              AND (c.user1_id = ? OR c.user2_id = ?)
              AND d.conversation_id IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM vine_mutes m2
                WHERE m2.muter_id = ?
                  AND m2.muted_id = m.sender_id
              )
          `,
            [userId, userId, userId, userId, userId]
          );
          return countRow;
        });
      }
    );

    res.json({ total: Number(row?.total || 0) });
  } catch (err) {
    console.error("Unread total error:", err);
    res.status(500).json({ total: 0 });
  }
});

/* =========================
   PRESENCE RAIL (ACTIVE / RECENT)
========================= */
router.get("/presence", authenticate, async (req, res) => {
  const userId = Number(req.user.id);
  try {
    const payload = await runDmPerfRoute(
      "dm-presence",
      { user_id: Number(userId) },
      async (perfCtx) => {
        await ensureDmPerformanceSchema();
        const onlineUserIds = getOnlineUserIds()
          .map((id) => Number(id))
          .filter((id) => id && id !== userId);
        const cacheKey = buildDmCacheKey("dm-presence", Number(userId), onlineUserIds.sort((a, b) => a - b).join(","));
        return readThroughDmCache(cacheKey, DM_CACHE_TTLS.presence, async () => {
          let activeNow = [];
          if (onlineUserIds.length > 0) {
            const [rows] = await timedDmQuery(
              perfCtx,
              "dm-presence.active",
              `
              SELECT
                u.id,
                u.username,
                u.display_name,
                u.avatar_url,
                u.is_verified,
                u.last_active_at
              FROM vine_users u
              WHERE u.id IN (?)
                AND EXISTS (
                  SELECT 1
                  FROM vine_follows f
                  WHERE f.follower_id = u.id
                    AND f.following_id = ?
                )
                AND u.show_last_active = 1
                AND NOT EXISTS (
                  SELECT 1
                  FROM vine_blocks b
                  WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
                     OR (b.blocker_id = u.id AND b.blocked_id = ?)
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM vine_mutes m
                  WHERE m.muter_id = ?
                    AND m.muted_id = u.id
                )
              ORDER BY u.last_active_at DESC
              LIMIT 20
              `,
              [onlineUserIds, userId, userId, userId, userId]
            );
            activeNow = Array.isArray(rows) ? rows : [];
          }

          const excludeIds = [userId, ...activeNow.map((u) => Number(u.id)).filter(Boolean)];
          const [recentlyActive] = await timedDmQuery(
            perfCtx,
            "dm-presence.recent",
            `
            SELECT
              u.id,
              u.username,
              u.display_name,
              u.avatar_url,
              u.is_verified,
              u.last_active_at
            FROM vine_users u
            WHERE u.id NOT IN (?)
              AND EXISTS (
                SELECT 1
                FROM vine_follows f
                WHERE f.follower_id = u.id
                  AND f.following_id = ?
              )
              AND u.show_last_active = 1
              AND u.last_active_at IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM vine_blocks b
                WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
                   OR (b.blocker_id = u.id AND b.blocked_id = ?)
              )
              AND NOT EXISTS (
                SELECT 1
                FROM vine_mutes m
                WHERE m.muter_id = ?
                  AND m.muted_id = u.id
              )
            ORDER BY u.last_active_at DESC
            LIMIT 40
            `,
            [excludeIds, userId, userId, userId, userId]
          );

          return {
            active_now: activeNow,
            recently_active: Array.isArray(recentlyActive) ? recentlyActive : [],
          };
        });
      }
    );

    res.json(payload);
  } catch (err) {
    console.error("Presence rail error:", err);
    res.status(500).json({ active_now: [], recently_active: [] });
  }
});


export default router;
