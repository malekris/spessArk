import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db } from "../../server.js";
import { sendVineWelcomeEmail, sendVineResetCodeEmail, sendVineVerificationCodeEmail, sendVineSuspensionEmail, sendVineUnsuspensionEmail, sendVineWarningEmail, sendVineDeletionScheduledEmail, sendVineDeletionCancelledEmail } from "../../utils/email.js";
import authMiddleware from "../../middleware/authMiddleware.js";
import authOptional from "../authOptional.js";
import { authenticate } from "../auth.js";
import { uploadAvatarMemory, uploadBannerMemory } from "../../middleware/upload.js";
import { io } from "../../server.js"; 
import { uploadPostCloudinary } from "../../middleware/upload.js";
import cloudinary from "../../config/cloudinary.js";
import sharp from "sharp";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getGuardianPerfSnapshot, recordPerfQuery, recordPerfRoute } from "./perfStore.js";

const router = express.Router();
const SESSION_IDLE_MS = 1 * 60 * 60 * 1000;
const JWT_SECRET = process.env.JWT_SECRET || "vine_secret_key";
const VINE_JWT_EXPIRES_IN = process.env.VINE_JWT_EXPIRES_IN || "7d";
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || "";
const USE_R2_UPLOADS = String(process.env.USE_R2_UPLOADS || "").toLowerCase() === "true";
const R2_ACCOUNT_ID = String(process.env.R2_ACCOUNT_ID || "").trim();
const R2_BUCKET = String(process.env.R2_BUCKET || "").trim();
const R2_ACCESS_KEY_ID = String(process.env.R2_ACCESS_KEY_ID || "").trim();
const R2_SECRET_ACCESS_KEY = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
const R2_PUBLIC_BASE_URL = String(process.env.R2_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const R2_ENDPOINT =
  R2_ACCOUNT_ID
    ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : String(process.env.R2_ENDPOINT || "").trim();
const r2Ready = Boolean(
  R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ENDPOINT && R2_PUBLIC_BASE_URL
);
const r2Client = r2Ready
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

const isR2Url = (rawUrl) => {
  const asString = String(rawUrl || "").trim();
  if (!asString) return false;
  if (R2_PUBLIC_BASE_URL && asString.startsWith(R2_PUBLIC_BASE_URL)) return true;
  return /\.r2\.dev\//i.test(asString) || /\.r2\.cloudflarestorage\.com\//i.test(asString);
};

const extractR2KeyFromUrl = (rawUrl) => {
  const asString = String(rawUrl || "").trim();
  if (!asString) return null;
  if (R2_PUBLIC_BASE_URL && asString.startsWith(R2_PUBLIC_BASE_URL)) {
    return asString.slice(R2_PUBLIC_BASE_URL.length).replace(/^\/+/, "");
  }
  try {
    const parsed = new URL(asString);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;
    if (
      /\.r2\.cloudflarestorage\.com$/i.test(parsed.hostname) &&
      parts[0] === R2_BUCKET
    ) {
      parts.shift();
    }
    return parts.join("/") || null;
  } catch {
    return null;
  }
};

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
    const publicId = tail.join("/");
    return publicId || null;
  } catch {
    return null;
  }
};

const mapGiphyGif = (item) => {
  const images = item?.images || {};
  const full =
    images.fixed_width?.url ||
    images.downsized?.url ||
    images.original?.url ||
    null;
  const preview =
    images.fixed_width_small?.url ||
    images.fixed_height_small?.url ||
    images.preview_gif?.url ||
    images.fixed_width?.url ||
    full;
  if (!full) return null;
  return {
    id: item?.id || crypto.randomUUID(),
    title: item?.title || "GIF",
    url: full,
    preview_url: preview,
  };
};

const fetchGiphy = async (endpoint, params = {}) => {
  if (!GIPHY_API_KEY) {
    return { results: [], error: "GIPHY_API_KEY missing" };
  }
  const qs = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    rating: "pg-13",
    lang: "en",
    ...params,
  });
  const url = `https://api.giphy.com/v1/gifs/${endpoint}?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GIPHY ${endpoint} failed (${res.status}): ${txt}`);
  }
  const json = await res.json();
  const results = Array.isArray(json?.data) ? json.data.map(mapGiphyGif).filter(Boolean) : [];
  return { results };
};

const emitVineFeedUpdated = (payload = {}) => {
  clearVineReadCache();
  try {
    io.emit("vine_feed_updated", payload);
  } catch (err) {
    console.warn("Failed to emit vine_feed_updated", err?.message || err);
  }
};

const emitVineStatusUpdated = (payload = {}) => {
  clearVineReadCache();
  try {
    io.emit("vine_status_updated", payload);
  } catch (err) {
    console.warn("Failed to emit vine_status_updated", err?.message || err);
  }
};

const isLikelyVideoUrl = (url) =>
  /\/video\/upload\//i.test(url) || /\.(mp4|mov|webm|m4v|avi|mkv|ogv)(\?|$)/i.test(url);

const isLikelyRawUrl = (url) =>
  /\/raw\/upload\//i.test(url) || /\.pdf(\?|$)/i.test(url);

const isLikelyImageUrl = (url) => {
  const value = String(url || "").trim();
  if (!value) return false;
  if (isLikelyVideoUrl(value) || isLikelyRawUrl(value)) return false;
  return (
    /\/image\/upload\//i.test(value) ||
    /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)(\?|$)/i.test(value)
  );
};

const VINE_POST_MAX_LENGTH = 5000;
const VINE_SYSTEM_NOTICE_VERSION = String(
  process.env.VINE_SYSTEM_NOTICE_VERSION || "2026-03-vine-refresh"
).trim();
const VINE_SYSTEM_NOTICE_TITLE = String(
  process.env.VINE_SYSTEM_NOTICE_TITLE || "A quick Vine update"
).trim();
const VINE_SYSTEM_NOTICE_MESSAGE = String(
  process.env.VINE_SYSTEM_NOTICE_MESSAGE ||
    "We have polished a few things across Vine to keep it lighter, cleaner, and easier to use. Tap okay to continue."
).trim();
const VINE_SYSTEM_NOTICE_ENABLED = !["0", "false", "off"].includes(
  String(process.env.VINE_SYSTEM_NOTICE_ENABLED || "true").trim().toLowerCase()
);

const deleteCloudinaryByUrl = async (url) => {
  if (isR2Url(url) && r2Client && r2Ready) {
    const key = extractR2KeyFromUrl(url);
    if (!key) return;
    try {
      await r2Client.send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
        })
      );
    } catch {
      // ignore r2 delete misses
    }
    return;
  }

  const asString = String(url || "");
  const publicId = extractCloudinaryPublicId(asString);
  if (!publicId) return;

  const resourceTypes = isLikelyRawUrl(asString)
    ? ["raw"]
    : isLikelyVideoUrl(asString)
    ? ["video"]
    : ["image", "video", "raw"];

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

const getClientIp = (req) => {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (forwarded) return forwarded.slice(0, 64);
  return String(req.socket?.remoteAddress || "").slice(0, 64);
};

const extractBirthdayMonthDay = (value) => {
  const raw = String(value || "").trim();
  const directMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (directMatch) {
    return {
      month: Number(directMatch[2]),
      day: Number(directMatch[3]),
    };
  }

  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return {
    month: Number(dt.getUTCMonth()) + 1,
    day: Number(dt.getUTCDate()),
  };
};

const isLeapYear = (year) =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const buildBirthdayDateForYear = (year, month, day) => {
  const normalizedMonth = Number(month || 0);
  const normalizedDay = Number(day || 0);
  if (!normalizedMonth || !normalizedDay) return null;
  if (normalizedMonth === 2 && normalizedDay === 29 && !isLeapYear(year)) {
    return new Date(year, 1, 28, 12, 0, 0, 0);
  }
  return new Date(year, normalizedMonth - 1, normalizedDay, 12, 0, 0, 0);
};

const getUpcomingBirthdayData = (value, reference = new Date()) => {
  const monthDay = extractBirthdayMonthDay(value);
  if (!monthDay) return null;

  const today = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
    0,
    0,
    0,
    0
  );
  let nextBirthday = buildBirthdayDateForYear(today.getFullYear(), monthDay.month, monthDay.day);
  if (!nextBirthday) return null;

  let birthdayStart = new Date(
    nextBirthday.getFullYear(),
    nextBirthday.getMonth(),
    nextBirthday.getDate(),
    0,
    0,
    0,
    0
  );

  if (birthdayStart < today) {
    nextBirthday = buildBirthdayDateForYear(today.getFullYear() + 1, monthDay.month, monthDay.day);
    if (!nextBirthday) return null;
    birthdayStart = new Date(
      nextBirthday.getFullYear(),
      nextBirthday.getMonth(),
      nextBirthday.getDate(),
      0,
      0,
      0,
      0
    );
  }

  const daysUntil = Math.round((birthdayStart.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  return {
    birthMonth: monthDay.month,
    birthDay: monthDay.day,
    daysUntil,
    nextBirthdayAt: birthdayStart.toISOString(),
  };
};

const BIRTHDAY_EDIT_WINDOW_DAYS = 365;
const BIRTHDAY_EDIT_LIMIT = 2;

const normalizeBirthdayDateValue = (value) => {
  const raw = String(value || "").trim();
  const directMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (directMatch) {
    return `${directMatch[1]}-${directMatch[2]}-${directMatch[3]}`;
  }
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
};

const validateBirthdayInput = (rawValue) => {
  const rawDate = String(rawValue || "").trim();
  const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return { ok: false, message: "Please enter a valid birthday" };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    Number.isNaN(parsed.getTime()) ||
    Number(parsed.getUTCFullYear()) !== year ||
    Number(parsed.getUTCMonth()) !== month - 1 ||
    Number(parsed.getUTCDate()) !== day
  ) {
    return { ok: false, message: "Please enter a valid birthday" };
  }

  if (parsed > new Date()) {
    return { ok: false, message: "Birthday cannot be in the future" };
  }

  return { ok: true, rawDate, parsed };
};

const buildBirthdayEditState = (rows = []) => {
  const recentRows = Array.isArray(rows) ? rows : [];
  const count = recentRows.length;
  const remaining = Math.max(0, BIRTHDAY_EDIT_LIMIT - count);
  const newest = recentRows[0] || null;
  const oldest = recentRows[count - 1] || null;
  const nextAvailableAt =
    count >= BIRTHDAY_EDIT_LIMIT && oldest?.edited_at
      ? new Date(new Date(oldest.edited_at).getTime() + BIRTHDAY_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : null;
  return {
    birthday_edits_used_last_365_days: count,
    birthday_edits_remaining: remaining,
    birthday_last_edited_at: newest?.edited_at ? new Date(newest.edited_at).toISOString() : null,
    birthday_next_edit_available_at: nextAvailableAt,
  };
};

const buildDisplayNameEditState = (rows = []) => {
  const recentRows = Array.isArray(rows) ? rows : [];
  const count = recentRows.length;
  const remaining = Math.max(0, BIRTHDAY_EDIT_LIMIT - count);
  const newest = recentRows[0] || null;
  const oldest = recentRows[count - 1] || null;
  const nextAvailableAt =
    count >= BIRTHDAY_EDIT_LIMIT && oldest?.edited_at
      ? new Date(new Date(oldest.edited_at).getTime() + BIRTHDAY_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : null;
  return {
    display_name_edits_used_last_365_days: count,
    display_name_edits_remaining: remaining,
    display_name_last_edited_at: newest?.edited_at ? new Date(newest.edited_at).toISOString() : null,
    display_name_next_edit_available_at: nextAvailableAt,
  };
};

const normalizeDisplayNameInput = (value) => {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 100);
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

const normalizeClientRequestId = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 80);
};

let cachedDbName = null;
const getDbName = async () => {
  if (cachedDbName) return cachedDbName;
  const [[row]] = await db.query("SELECT DATABASE() AS dbName");
  cachedDbName = row?.dbName || null;
  return cachedDbName;
};

const VINE_READ_CACHE_MAX = 600;
const VINE_CACHE_TTLS = {
  feed: 8_000,
  communityPosts: 8_000,
  profileHeader: 20_000,
  profilePosts: 12_000,
  profileLikes: 12_000,
  profilePhotos: 12_000,
  profileBookmarks: 8_000,
  publicPost: 20_000,
  comments: 8_000,
  trending: 15_000,
  followers: 20_000,
  following: 20_000,
  communityAssignments: 10_000,
  communityAssignmentSubmissions: 10_000,
  communityGradebook: 12_000,
  communityProgress: 10_000,
  communityLibrary: 20_000,
  communityAttendance: 8_000,
  mutedUsers: 20_000,
  blockedUsers: 20_000,
  birthdays: 20_000,
  notifications: 5_000,
  notificationCounts: 4_000,
  guardianActivity: 10_000,
};
const vineReadCache = new Map();

const cloneCachedValue = (value) => {
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const buildVineCacheKey = (...parts) =>
  parts
    .map((part) => {
      if (part === null || part === undefined) return "";
      if (typeof part === "string") return part;
      if (typeof part === "number" || typeof part === "boolean") return String(part);
      return JSON.stringify(part);
    })
    .join("::");

const pruneVineReadCache = () => {
  const now = Date.now();
  for (const [key, entry] of vineReadCache.entries()) {
    if (!entry || entry.expiresAt <= now) {
      vineReadCache.delete(key);
    }
  }
  if (vineReadCache.size <= VINE_READ_CACHE_MAX) return;
  const oldestEntries = [...vineReadCache.entries()]
    .sort((a, b) => (a[1]?.expiresAt || 0) - (b[1]?.expiresAt || 0))
    .slice(0, vineReadCache.size - VINE_READ_CACHE_MAX);
  for (const [key] of oldestEntries) {
    vineReadCache.delete(key);
  }
};

const getVineReadCache = (key) => {
  const entry = vineReadCache.get(key);
  if (!entry) return { hit: false, value: undefined };
  if (entry.expiresAt <= Date.now()) {
    vineReadCache.delete(key);
    return { hit: false, value: undefined };
  }
  return { hit: true, value: cloneCachedValue(entry.value) };
};

const setVineReadCache = (key, value, ttlMs) => {
  pruneVineReadCache();
  vineReadCache.set(key, {
    value: cloneCachedValue(value),
    expiresAt: Date.now() + ttlMs,
  });
};

const readThroughVineCache = async (key, ttlMs, loader) => {
  const cached = getVineReadCache(key);
  if (cached.hit) return cached.value;
  const value = await loader();
  if (value !== undefined) {
    setVineReadCache(key, value, ttlMs);
  }
  return cloneCachedValue(value);
};

const clearVineReadCache = (...prefixes) => {
  if (!prefixes.length) {
    vineReadCache.clear();
    return;
  }
  const normalizedPrefixes = prefixes
    .flat()
    .map((prefix) => String(prefix || "").trim())
    .filter(Boolean);
  if (!normalizedPrefixes.length) {
    vineReadCache.clear();
    return;
  }
  for (const key of vineReadCache.keys()) {
    if (
      normalizedPrefixes.some(
        (prefix) => key === prefix || key.startsWith(`${prefix}::`)
      )
    ) {
      vineReadCache.delete(key);
    }
  }
};

const GUARDIAN_ACTIVITY_ONLINE_MS = 5 * 60 * 1000;
const GUARDIAN_ACTIVITY_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

const summarizeGuardianDevice = (rawValue) => {
  const raw = String(rawValue || "").trim();
  if (!raw) return "Unknown device";
  const lower = raw.toLowerCase();
  const browser =
    lower.includes("edg/")
      ? "Edge"
      : lower.includes("opr/") || lower.includes("opera")
      ? "Opera"
      : lower.includes("chrome/")
      ? "Chrome"
      : lower.includes("firefox/")
      ? "Firefox"
      : lower.includes("safari/") && !lower.includes("chrome/")
      ? "Safari"
      : "Browser";
  const platform =
    lower.includes("iphone")
      ? "iPhone"
      : lower.includes("ipad")
      ? "iPad"
      : lower.includes("android")
      ? "Android"
      : lower.includes("mac os") || lower.includes("macintosh")
      ? "Mac"
      : lower.includes("windows")
      ? "Windows"
      : lower.includes("linux")
      ? "Linux"
      : lower.includes("mobile")
      ? "Mobile"
      : "Desktop";
  return `${platform} • ${browser}`;
};

const buildGuardianActivityPath = (item = {}) => {
  if (item.post_id) {
    if (item.comment_id) {
      return `/vine/feed?post=${item.post_id}&comment=${item.comment_id}`;
    }
    return `/vine/feed?post=${item.post_id}`;
  }
  if (item.community_slug) {
    if (item.assignment_id) {
      return `/vine/communities/${item.community_slug}?tab=assignments`;
    }
    return `/vine/communities/${item.community_slug}`;
  }
  if (item.target_username) {
    return `/vine/profile/${item.target_username}`;
  }
  if (item.username) {
    return `/vine/profile/${item.username}`;
  }
  return "/vine/feed";
};

const normalizeGuardianActivityRows = (rows = []) =>
  rows.map((row) => ({
    event_key: row.event_key,
    user_id: Number(row.user_id || 0),
    username: row.username || "",
    display_name: row.display_name || row.username || "",
    avatar_url: row.avatar_url || "",
    is_verified: Number(row.is_verified || 0),
    badge_type: row.badge_type || null,
    role: row.role || "user",
    action_type: row.action_type || "activity",
    action_label: row.action_label || "Did something",
    target_label: row.target_label || "",
    detail: row.detail || "",
    created_at: row.created_at || null,
    post_id: row.post_id ? Number(row.post_id) : null,
    comment_id: row.comment_id ? Number(row.comment_id) : null,
    assignment_id: row.assignment_id ? Number(row.assignment_id) : null,
    community_slug: row.community_slug || "",
    target_username: row.target_username || "",
    navigate_path: buildGuardianActivityPath(row),
  }));

const buildGuardianActivitySnapshot = async (perfCtx, dbName, { loginLimit = 12, actionLimit = 28 } = {}) => {
  const safeLoginLimit = Math.max(10, Math.min(120, Number(loginLimit || 60)));
  const safeActionLimit = Math.max(30, Math.min(200, Number(actionLimit || 120)));
  const cacheKey = buildVineCacheKey("guardian-activity", safeLoginLimit, safeActionLimit);
  const nonGuardianActorSql =
    `LOWER(COALESCE(u.username, '')) NOT IN ('vine guardian', 'vine_guardian') AND LOWER(COALESCE(u.badge_type, '')) <> 'guardian'`;

  return readThroughVineCache(cacheKey, VINE_CACHE_TTLS.guardianActivity, async () => {
    const loginTableExists = await hasTable(dbName, "vine_user_sessions");
    if (!loginTableExists) {
      return { recent_logins: [], recent_actions: [] };
    }

    const [loginRows] = await timedVineQuery(
      perfCtx,
      "guardian-activity.recent-logins",
      `
      SELECT
        s.id AS session_id,
        s.user_id,
        s.created_at AS login_at,
        s.last_seen_at,
        s.revoked_at,
        s.device_info,
        s.ip_address,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        u.badge_type,
        u.role
      FROM vine_user_sessions s
      JOIN vine_users u ON u.id = s.user_id
      WHERE ${nonGuardianActorSql}
      ORDER BY s.created_at DESC
      LIMIT ?
      `,
      [safeLoginLimit]
    );

    const recentLoginRows = Array.isArray(loginRows) ? loginRows : [];
    const actionSince = new Date(Date.now() - GUARDIAN_ACTIVITY_LOOKBACK_MS);
    const hasActivityColumns = async (tableName, columns = []) => {
      if (!(await hasTable(dbName, tableName))) return false;
      const checks = await Promise.all(columns.map((column) => hasColumn(dbName, tableName, column)));
      return checks.every(Boolean);
    };

    const postsExists = await hasActivityColumns("vine_posts", ["id", "user_id", "created_at"]);
    const commentsExists = await hasActivityColumns("vine_comments", ["id", "user_id", "post_id", "created_at"]);
    const likesExists = await hasActivityColumns("vine_likes", ["id", "user_id", "post_id", "created_at"]);
    const revinesExists = await hasActivityColumns("vine_revines", ["id", "user_id", "post_id", "created_at"]);
    const followsExists = await hasActivityColumns("vine_follows", ["id", "follower_id", "following_id", "created_at"]);
    const messagesExists =
      (await hasActivityColumns("vine_messages", ["id", "sender_id", "conversation_id", "created_at"])) &&
      (await hasTable(dbName, "vine_conversations"));
    const communityMembersExists = await hasActivityColumns("vine_community_members", ["id", "user_id", "community_id", "joined_at"]);
    const submissionsExists =
      (await hasActivityColumns("vine_community_submissions", ["id", "user_id", "community_id", "submitted_at"])) &&
      (await hasTable(dbName, "vine_community_assignments"));

    const actionSelects = [];
    const actionParams = [];

    if (postsExists) {
      actionSelects.push(`
        SELECT
          CONCAT('post-', p.id) AS event_key,
          u.id AS user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.role,
          'post' AS action_type,
          CASE WHEN p.community_id IS NULL THEN 'Posted on feed' ELSE 'Posted in community' END AS action_label,
          COALESCE(c.name, '') AS target_label,
          LEFT(TRIM(COALESCE(p.content, '')), 120) AS detail,
          p.created_at,
          p.id AS post_id,
          NULL AS comment_id,
          NULL AS assignment_id,
          COALESCE(c.slug, '') AS community_slug,
          '' AS target_username
        FROM vine_posts p
        JOIN vine_users u ON u.id = p.user_id
        LEFT JOIN vine_communities c ON c.id = p.community_id
        WHERE p.created_at >= ?
          AND ${nonGuardianActorSql}
      `);
      actionParams.push(actionSince);
    }

    if (commentsExists) {
      actionSelects.push(`
        SELECT
          CONCAT('comment-', cm.id) AS event_key,
          u.id AS user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.role,
          CASE WHEN cm.parent_comment_id IS NULL THEN 'comment' ELSE 'reply' END AS action_type,
          CASE WHEN cm.parent_comment_id IS NULL THEN 'Commented on a post' ELSE 'Replied in comments' END AS action_label,
          COALESCE(c.name, '') AS target_label,
          LEFT(TRIM(COALESCE(cm.content, '')), 120) AS detail,
          cm.created_at,
          cm.post_id AS post_id,
          cm.id AS comment_id,
          NULL AS assignment_id,
          COALESCE(c.slug, '') AS community_slug,
          '' AS target_username
        FROM vine_comments cm
        JOIN vine_users u ON u.id = cm.user_id
        LEFT JOIN vine_posts p ON p.id = cm.post_id
        LEFT JOIN vine_communities c ON c.id = p.community_id
        WHERE cm.created_at >= ?
          AND ${nonGuardianActorSql}
      `);
      actionParams.push(actionSince);
    }

    if (likesExists) {
      actionSelects.push(`
        SELECT
          CONCAT('like-', l.id) AS event_key,
          u.id AS user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.role,
          'like' AS action_type,
          'Liked a post' AS action_label,
          COALESCE(c.name, '') AS target_label,
          '' AS detail,
          l.created_at,
          l.post_id AS post_id,
          NULL AS comment_id,
          NULL AS assignment_id,
          COALESCE(c.slug, '') AS community_slug,
          '' AS target_username
        FROM vine_likes l
        JOIN vine_users u ON u.id = l.user_id
        LEFT JOIN vine_posts p ON p.id = l.post_id
        LEFT JOIN vine_communities c ON c.id = p.community_id
        WHERE l.created_at >= ?
          AND ${nonGuardianActorSql}
      `);
      actionParams.push(actionSince);
    }

    if (revinesExists) {
      actionSelects.push(`
        SELECT
          CONCAT('revine-', r.id) AS event_key,
          u.id AS user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.role,
          'revine' AS action_type,
          'Revined a post' AS action_label,
          COALESCE(c.name, '') AS target_label,
          '' AS detail,
          r.created_at,
          r.post_id AS post_id,
          NULL AS comment_id,
          NULL AS assignment_id,
          COALESCE(c.slug, '') AS community_slug,
          '' AS target_username
        FROM vine_revines r
        JOIN vine_users u ON u.id = r.user_id
        LEFT JOIN vine_posts p ON p.id = r.post_id
        LEFT JOIN vine_communities c ON c.id = p.community_id
        WHERE r.created_at >= ?
          AND ${nonGuardianActorSql}
      `);
      actionParams.push(actionSince);
    }

    if (followsExists) {
      actionSelects.push(`
        SELECT
          CONCAT('follow-', f.id) AS event_key,
          u.id AS user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.role,
          'follow' AS action_type,
          'Started following' AS action_label,
          COALESCE(target.display_name, target.username, '') AS target_label,
          '' AS detail,
          f.created_at,
          NULL AS post_id,
          NULL AS comment_id,
          NULL AS assignment_id,
          '' AS community_slug,
          COALESCE(target.username, '') AS target_username
        FROM vine_follows f
        JOIN vine_users u ON u.id = f.follower_id
        JOIN vine_users target ON target.id = f.following_id
        WHERE f.created_at >= ?
          AND ${nonGuardianActorSql}
      `);
      actionParams.push(actionSince);
    }

    if (messagesExists) {
      actionSelects.push(`
        SELECT
          CONCAT('dm-', m.id) AS event_key,
          u.id AS user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.role,
          'dm' AS action_type,
          'Sent a DM' AS action_label,
          COALESCE(target.display_name, target.username, '') AS target_label,
          '' AS detail,
          m.created_at,
          NULL AS post_id,
          NULL AS comment_id,
          NULL AS assignment_id,
          '' AS community_slug,
          COALESCE(target.username, '') AS target_username
        FROM vine_messages m
        JOIN vine_users u ON u.id = m.sender_id
        JOIN vine_conversations vc ON vc.id = m.conversation_id
        JOIN vine_users target
          ON target.id = CASE
            WHEN vc.user1_id = m.sender_id THEN vc.user2_id
            ELSE vc.user1_id
          END
        WHERE m.created_at >= ?
          AND ${nonGuardianActorSql}
      `);
      actionParams.push(actionSince);
    }

    if (communityMembersExists) {
      actionSelects.push(`
        SELECT
          CONCAT('community-member-', m.id) AS event_key,
          u.id AS user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.role,
          'community_join' AS action_type,
          'Joined a community' AS action_label,
          COALESCE(c.name, '') AS target_label,
          '' AS detail,
          m.joined_at AS created_at,
          NULL AS post_id,
          NULL AS comment_id,
          NULL AS assignment_id,
          COALESCE(c.slug, '') AS community_slug,
          '' AS target_username
        FROM vine_community_members m
        JOIN vine_users u ON u.id = m.user_id
        JOIN vine_communities c ON c.id = m.community_id
        WHERE m.joined_at >= ?
          AND ${nonGuardianActorSql}
      `);
      actionParams.push(actionSince);
    }

    if (submissionsExists) {
      actionSelects.push(`
        SELECT
          CONCAT('submission-', s.id) AS event_key,
          u.id AS user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.role,
          'assignment_submit' AS action_type,
          'Submitted an assignment' AS action_label,
          COALESCE(a.title, '') AS target_label,
          '' AS detail,
          s.submitted_at AS created_at,
          NULL AS post_id,
          NULL AS comment_id,
          a.id AS assignment_id,
          COALESCE(c.slug, '') AS community_slug,
          '' AS target_username
        FROM vine_community_submissions s
        JOIN vine_users u ON u.id = s.user_id
        LEFT JOIN vine_community_assignments a ON a.id = s.assignment_id
        LEFT JOIN vine_communities c ON c.id = s.community_id
        WHERE s.submitted_at >= ?
          AND ${nonGuardianActorSql}
      `);
      actionParams.push(actionSince);
    }

    const sessionActionLimit = Math.max(160, safeActionLimit * 12);
    let allRecentActionRows = [];
    if (actionSelects.length) {
      const [rows] = await timedVineQuery(
        perfCtx,
        "guardian-activity.recent-actions",
        `
        SELECT *
        FROM (
          ${actionSelects.join("\nUNION ALL\n")}
        ) activity_feed
        ORDER BY created_at DESC
        LIMIT ?
        `,
        [...actionParams, sessionActionLimit]
      );
      allRecentActionRows = normalizeGuardianActivityRows(Array.isArray(rows) ? rows : []);
    }

    const nowMs = Date.now();
    const allRecentActions = allRecentActionRows.map((row) => ({
      ...row,
      is_online_now: Boolean(
        row.user_id &&
          recentLoginRows.some(
            (sessionRow) =>
              Number(sessionRow.user_id) === Number(row.user_id) &&
              !sessionRow.revoked_at &&
              nowMs - new Date(sessionRow.last_seen_at || 0).getTime() <= GUARDIAN_ACTIVITY_ONLINE_MS
          )
      ),
    }));
    const recentActions = allRecentActions.slice(0, safeActionLimit);

    const burstWindowStart = new Date(Date.now() - 15 * 60 * 1000);
    const burstMap = new Map();
    const ensureBurst = (userId) => {
      const numericUserId = Number(userId || 0);
      if (!numericUserId) return null;
      if (!burstMap.has(numericUserId)) {
        burstMap.set(numericUserId, {
          user_id: numericUserId,
          posts_count: 0,
          comments_count: 0,
          likes_count: 0,
          follows_count: 0,
          dms_count: 0,
          total_actions: 0,
          last_activity_at: null,
        });
      }
      return burstMap.get(numericUserId);
    };

    const collectBurstCounts = async (tableName, actorColumn, dateColumn, countField, label) => {
      const tableExists = await hasTable(dbName, tableName);
      if (!tableExists) return;
      const hasActor = await hasColumn(dbName, tableName, actorColumn);
      const hasDate = await hasColumn(dbName, tableName, dateColumn);
      if (!hasActor || !hasDate) return;
      const [rows] = await timedVineQuery(
        perfCtx,
        `guardian-activity.${label}`,
        `
        SELECT ${actorColumn} AS actor_id, COUNT(*) AS total, MAX(${dateColumn}) AS last_activity_at
        FROM ${tableName}
        WHERE ${dateColumn} >= ?
        GROUP BY ${actorColumn}
        `,
        [burstWindowStart]
      );
      for (const row of rows || []) {
        const entry = ensureBurst(row.actor_id);
        if (!entry) continue;
        const total = Number(row.total || 0);
        entry[countField] = total;
        entry.total_actions += total;
        const rowTs = new Date(row.last_activity_at || 0).getTime();
        const entryTs = new Date(entry.last_activity_at || 0).getTime();
        if (Number.isFinite(rowTs) && (!Number.isFinite(entryTs) || rowTs > entryTs)) {
          entry.last_activity_at = row.last_activity_at;
        }
      }
    };

    await Promise.all([
      collectBurstCounts("vine_posts", "user_id", "created_at", "posts_count", "burst-posts"),
      collectBurstCounts("vine_comments", "user_id", "created_at", "comments_count", "burst-comments"),
      collectBurstCounts("vine_likes", "user_id", "created_at", "likes_count", "burst-likes"),
      collectBurstCounts("vine_follows", "follower_id", "created_at", "follows_count", "burst-follows"),
      collectBurstCounts("vine_messages", "sender_id", "created_at", "dms_count", "burst-dms"),
    ]);

    const suspiciousCandidates = [...burstMap.values()].filter((entry) => {
      if (!entry) return false;
      return (
        entry.total_actions >= 15 ||
        entry.dms_count >= 8 ||
        entry.follows_count >= 8 ||
        entry.comments_count >= 10 ||
        entry.posts_count >= 4 ||
        entry.likes_count >= 18
      );
    });

    let suspiciousBursts = [];
    if (suspiciousCandidates.length) {
      const userIds = suspiciousCandidates.map((entry) => Number(entry.user_id)).filter(Boolean);
      const placeholders = userIds.map(() => "?").join(", ");
      const [rows] = await timedVineQuery(
        perfCtx,
        "guardian-activity.burst-users",
        `
        SELECT id, username, display_name, avatar_url, is_verified, badge_type, role
        FROM vine_users
        WHERE id IN (${placeholders})
        `,
        userIds
      );
      const userMap = new Map((rows || []).map((row) => [Number(row.id), row]));
      suspiciousBursts = suspiciousCandidates
        .map((entry) => {
          const user = userMap.get(Number(entry.user_id));
          if (!user) return null;
          const reasons = [];
          if (entry.total_actions >= 15) reasons.push(`${entry.total_actions} actions in 15m`);
          if (entry.dms_count >= 8) reasons.push(`${entry.dms_count} DMs in 15m`);
          if (entry.follows_count >= 8) reasons.push(`${entry.follows_count} follows in 15m`);
          if (entry.comments_count >= 10) reasons.push(`${entry.comments_count} comments/replies in 15m`);
          if (entry.posts_count >= 4) reasons.push(`${entry.posts_count} posts in 15m`);
          if (entry.likes_count >= 18) reasons.push(`${entry.likes_count} likes in 15m`);
          const matchingSession = recentLoginRows.find((sessionRow) => Number(sessionRow.user_id) === Number(entry.user_id));
          const lastSeenMs = new Date(matchingSession?.last_seen_at || 0).getTime();
          return {
            user_id: Number(entry.user_id),
            username: user.username,
            display_name: user.display_name || user.username,
            avatar_url: user.avatar_url || "",
            is_verified: Number(user.is_verified || 0),
            badge_type: user.badge_type || null,
            role: user.role || "user",
            total_actions: Number(entry.total_actions || 0),
            posts_count: Number(entry.posts_count || 0),
            comments_count: Number(entry.comments_count || 0),
            likes_count: Number(entry.likes_count || 0),
            follows_count: Number(entry.follows_count || 0),
            dms_count: Number(entry.dms_count || 0),
            last_activity_at: entry.last_activity_at || null,
            reasons,
            is_online_now:
              Number.isFinite(lastSeenMs) &&
              nowMs - lastSeenMs <= GUARDIAN_ACTIVITY_ONLINE_MS,
            navigate_path: `/vine/profile/${user.username}`,
          };
        })
        .filter(Boolean)
        .sort(
          (a, b) =>
            Number(b.total_actions || 0) - Number(a.total_actions || 0) ||
            new Date(b.last_activity_at || 0).getTime() - new Date(a.last_activity_at || 0).getTime()
        )
        .slice(0, 8);
    }

    const groupedLoginRows = new Map();
    for (const row of recentLoginRows) {
      const userId = Number(row.user_id || 0);
      if (!groupedLoginRows.has(userId)) groupedLoginRows.set(userId, []);
      groupedLoginRows.get(userId).push(row);
    }

    const recentLogins = recentLoginRows.map((row) => {
      const userId = Number(row.user_id || 0);
      const loginAtMs = new Date(row.login_at || 0).getTime();
      const lastSeenMs = new Date(row.last_seen_at || 0).getTime();
      const userSessions = groupedLoginRows.get(userId) || [];
      const currentSessionIndex = userSessions.findIndex((sessionRow) => Number(sessionRow.session_id) === Number(row.session_id));
      const newerSession = currentSessionIndex > 0 ? userSessions[currentSessionIndex - 1] : null;
      const windowEndMs = newerSession ? new Date(newerSession.login_at || 0).getTime() : Number.POSITIVE_INFINITY;
      const actionsDuringSession = allRecentActions.filter((activity) => {
        if (Number(activity.user_id) !== userId) return false;
        const actionMs = new Date(activity.created_at || 0).getTime();
        return Number.isFinite(actionMs) && actionMs >= loginAtMs && actionMs < windowEndMs;
      });
      const latestAction = actionsDuringSession[0] || null;
      const recentActionPreview = actionsDuringSession.slice(0, 3).map((activity) => ({
        event_key: activity.event_key,
        action_type: activity.action_type || "activity",
        action_label: activity.action_label || "Did something",
        target_label: activity.target_label || "",
        detail: activity.detail || "",
        created_at: activity.created_at || null,
        navigate_path: activity.navigate_path || buildGuardianActivityPath(activity),
      }));
      const isRevoked = Boolean(row.revoked_at);
      const isSessionActive =
        !isRevoked &&
        Number.isFinite(lastSeenMs) &&
        nowMs - lastSeenMs <= SESSION_IDLE_MS;
      const isOnlineNow =
        !isRevoked &&
        Number.isFinite(lastSeenMs) &&
        nowMs - lastSeenMs <= GUARDIAN_ACTIVITY_ONLINE_MS;

      return {
        session_id: Number(row.session_id || 0),
        user_id: userId,
        username: row.username || "",
        display_name: row.display_name || row.username || "",
        avatar_url: row.avatar_url || "",
        is_verified: Number(row.is_verified || 0),
        badge_type: row.badge_type || null,
        role: row.role || "user",
        login_at: row.login_at || null,
        last_seen_at: row.last_seen_at || null,
        revoked_at: row.revoked_at || null,
        device_label: summarizeGuardianDevice(row.device_info),
        ip_address: row.ip_address || "",
        session_state: isRevoked ? "ended" : isSessionActive ? "active" : "expired",
        is_online_now: isOnlineNow,
        actions_since_login: actionsDuringSession.length,
        recent_actions_preview: recentActionPreview,
        latest_action_label: latestAction?.action_label || "",
        latest_action_at: latestAction?.created_at || null,
        latest_target_label: latestAction?.target_label || "",
        latest_detail: latestAction?.detail || "",
        latest_action_type: latestAction?.action_type || "",
        navigate_path: latestAction?.navigate_path || `/vine/profile/${row.username}`,
      };
    });

    return {
      recent_logins: recentLogins,
      recent_actions: recentActions,
      suspicious_bursts: suspiciousBursts,
    };
  });
};

const VINE_PERF_LOGS_ENABLED = process.env.VINE_PERF_LOGS !== "0";
const VINE_PERF_CONSOLE_LOGS_ENABLED = process.env.VINE_PERF_CONSOLE_LOGS === "1";
const VINE_SLOW_ROUTE_MS = Math.max(50, Number(process.env.VINE_SLOW_ROUTE_MS || 700));
const VINE_SLOW_QUERY_MS = Math.max(25, Number(process.env.VINE_SLOW_QUERY_MS || 180));

const createVinePerfContext = (routeKey, meta = {}) => ({
  routeKey,
  meta,
  startedAt: Date.now(),
  queries: [],
});

const getPerfRowCount = (rows) => {
  if (Array.isArray(rows)) return rows.length;
  if (rows && typeof rows === "object") {
    if (Number.isFinite(Number(rows.affectedRows))) return Number(rows.affectedRows);
    if (Number.isFinite(Number(rows.insertId)) && Number(rows.insertId) > 0) return 1;
  }
  return 0;
};

const timedVineQuery = async (perfCtx, label, sql, params = []) => {
  const startedAt = Date.now();
  const result = await db.query(sql, params);
  const elapsedMs = Date.now() - startedAt;
  const rows = Array.isArray(result) ? result[0] : undefined;
  const rowCount = getPerfRowCount(rows);
  if (perfCtx && Array.isArray(perfCtx.queries)) {
    perfCtx.queries.push({ label, ms: elapsedMs, rows: rowCount });
  }
  if (VINE_PERF_LOGS_ENABLED && elapsedMs >= VINE_SLOW_QUERY_MS) {
    recordPerfQuery("vine", {
      route: perfCtx?.routeKey || "unknown",
      label,
      ms: elapsedMs,
      rows: rowCount,
    });
    if (VINE_PERF_CONSOLE_LOGS_ENABLED) {
      console.info(
        "[vine-perf][query]",
        JSON.stringify({
          route: perfCtx?.routeKey || "unknown",
          label,
          ms: elapsedMs,
          rows: rowCount,
        })
      );
    }
  }
  return result;
};

const finalizeVinePerfContext = (perfCtx, extra = {}) => {
  if (!VINE_PERF_LOGS_ENABLED || !perfCtx) return;
  const durationMs = Date.now() - perfCtx.startedAt;
  const totalQueryMs = perfCtx.queries.reduce((sum, query) => sum + Number(query.ms || 0), 0);
  const topQueries = [...perfCtx.queries]
    .sort((a, b) => Number(b.ms || 0) - Number(a.ms || 0))
    .slice(0, 3);
  const shouldLog =
    durationMs >= VINE_SLOW_ROUTE_MS ||
    topQueries.some((query) => Number(query.ms || 0) >= VINE_SLOW_QUERY_MS);
  if (!shouldLog) return;
  recordPerfRoute("vine", {
    route: perfCtx.routeKey,
    ms: durationMs,
    query_count: perfCtx.queries.length,
    query_ms: totalQueryMs,
    top_queries: topQueries,
    ...perfCtx.meta,
    ...extra,
  });
  if (VINE_PERF_CONSOLE_LOGS_ENABLED) {
    console.info(
      "[vine-perf][route]",
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
  }
};

const runVinePerfRoute = async (routeKey, meta, work) => {
  const perfCtx = createVinePerfContext(routeKey, meta);
  try {
    return await work(perfCtx);
  } finally {
    finalizeVinePerfContext(perfCtx);
  }
};

const hasIndexNamed = async (dbName, tableName, indexName) => {
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

const hasIndexWithColumns = async (dbName, tableName, columns = []) => {
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
    if (cols.every((col, idx) => col === normalizedColumns[idx])) {
      return true;
    }
  }

  return false;
};

const ensureIndexExists = async (dbName, tableName, indexName, columns = []) => {
  if (!dbName || !columns.length) return;
  if (!(await hasTable(dbName, tableName))) return;
  if (await hasIndexNamed(dbName, tableName, indexName)) return;
  if (await hasIndexWithColumns(dbName, tableName, columns)) return;
  await db.query(`CREATE INDEX ${indexName} ON ${tableName} (${columns.join(", ")})`);
};

const ensureUniqueIndexExists = async (dbName, tableName, indexName, columns = []) => {
  if (!dbName || !columns.length) return;
  if (!(await hasTable(dbName, tableName))) return;
  if (await hasIndexNamed(dbName, tableName, indexName)) return;
  await db.query(`CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${columns.join(", ")})`);
};

let vinePerformanceSchemaReady = false;
let vinePerformanceSchemaPromise = null;

const ensureVinePerformanceSchema = async () => {
  if (vinePerformanceSchemaReady) return;
  if (vinePerformanceSchemaPromise) return vinePerformanceSchemaPromise;

  vinePerformanceSchemaPromise = (async () => {
    const dbName = await getDbName();
    if (!dbName) return;

    const indexes = [
      ["vine_posts", "idx_vine_posts_created_id", ["created_at", "id"]],
      ["vine_posts", "idx_vine_posts_user_created", ["user_id", "created_at"]],
      ["vine_posts", "idx_vine_posts_community_created", ["community_id", "created_at"]],
      ["vine_posts", "idx_vine_posts_topic_created", ["topic_tag", "created_at"]],
      ["vine_revines", "idx_vine_revines_created_id", ["created_at", "id"]],
      ["vine_revines", "idx_vine_revines_user_created", ["user_id", "created_at"]],
      ["vine_revines", "idx_vine_revines_user_post", ["user_id", "post_id"]],
      ["vine_revines", "idx_vine_revines_post_user", ["post_id", "user_id"]],
      ["vine_comments", "idx_vine_comments_post_created", ["post_id", "created_at"]],
      ["vine_comments", "idx_vine_comments_parent_created", ["parent_comment_id", "created_at"]],
      ["vine_comments", "idx_vine_comments_user_created", ["user_id", "created_at"]],
      ["vine_likes", "idx_vine_likes_post_user", ["post_id", "user_id"]],
      ["vine_likes", "idx_vine_likes_user_post", ["user_id", "post_id"]],
      ["vine_likes", "idx_vine_likes_post_created", ["post_id", "created_at"]],
      ["vine_comment_likes", "idx_vine_comment_likes_comment_user", ["comment_id", "user_id"]],
      ["vine_comment_likes", "idx_vine_comment_likes_user_comment", ["user_id", "comment_id"]],
      ["vine_bookmarks", "idx_vine_bookmarks_user_post", ["user_id", "post_id"]],
      ["vine_bookmarks", "idx_vine_bookmarks_post_user", ["post_id", "user_id"]],
      ["vine_follows", "idx_vine_follows_follower_following", ["follower_id", "following_id"]],
      ["vine_follows", "idx_vine_follows_following_follower", ["following_id", "follower_id"]],
      ["vine_follow_requests", "idx_vine_follow_requests_requester_target_status", ["requester_id", "target_id", "status"]],
      ["vine_follow_requests", "idx_vine_follow_requests_target_status_created", ["target_id", "status", "created_at"]],
      ["vine_notifications", "idx_vine_notifications_user_read_created", ["user_id", "is_read", "created_at"]],
      ["vine_notifications", "idx_vine_notifications_user_created", ["user_id", "created_at"]],
      ["vine_notifications", "idx_vine_notifications_actor", ["actor_id"]],
      ["vine_statuses", "idx_vine_statuses_user_expires_created", ["user_id", "expires_at", "created_at"]],
      ["vine_statuses", "idx_vine_statuses_expires_created", ["expires_at", "created_at"]],
      ["vine_blocks", "idx_vine_blocks_blocker_blocked", ["blocker_id", "blocked_id"]],
      ["vine_blocks", "idx_vine_blocks_blocked_blocker", ["blocked_id", "blocker_id"]],
      ["vine_mutes", "idx_vine_mutes_muter_muted", ["muter_id", "muted_id"]],
      ["vine_community_members", "idx_vine_community_members_community_user", ["community_id", "user_id"]],
      ["vine_community_members", "idx_vine_community_members_user_community", ["user_id", "community_id"]],
      ["vine_community_join_requests", "idx_vine_comm_join_req_comm_status_created", ["community_id", "status", "created_at"]],
      ["vine_community_join_requests", "idx_vine_comm_join_req_user_comm", ["user_id", "community_id"]],
    ];

    for (const [tableName, indexName, columns] of indexes) {
      try {
        await ensureIndexExists(dbName, tableName, indexName, columns);
      } catch (err) {
        console.warn(`Index ensure skipped for ${tableName}.${indexName}:`, err?.message || err);
      }
    }

    vinePerformanceSchemaReady = true;
  })().finally(() => {
    vinePerformanceSchemaPromise = null;
  });

  return vinePerformanceSchemaPromise;
};

let vineRequestDedupSchemaReady = false;
const ensureVineRequestDedupSchema = async () => {
  if (vineRequestDedupSchemaReady) return;
  const dbName = await getDbName();
  if (!dbName) return;
  if (await hasTable(dbName, "vine_posts")) {
    if (!(await hasColumn(dbName, "vine_posts", "client_request_id"))) {
      await db.query("ALTER TABLE vine_posts ADD COLUMN client_request_id VARCHAR(80) NULL");
    }
    await ensureUniqueIndexExists(
      dbName,
      "vine_posts",
      "uniq_vine_posts_user_request",
      ["user_id", "client_request_id"]
    );
  }
  vineRequestDedupSchemaReady = true;
};

const buildPostIdPlaceholders = (rows = []) => {
  const postIds = [...new Set((rows || []).map((row) => Number(row?.id)).filter((id) => id > 0))];
  if (!postIds.length) {
    return { postIds: [], placeholders: "" };
  }
  return {
    postIds,
    placeholders: postIds.map(() => "?").join(", "),
  };
};

const buildCountMap = (rows = []) => {
  const map = new Map();
  for (const row of rows || []) {
    map.set(Number(row.post_id), Number(row.total || 0));
  }
  return map;
};

const enrichVinePostRows = async (rows, viewerId, perfCtx = null) => {
  const inputRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!inputRows.length) return [];

  await ensurePollSchema();

  const safeViewerId = Number(viewerId || 0);
  const { postIds, placeholders } = buildPostIdPlaceholders(inputRows);
  if (!postIds.length) {
    return inputRows;
  }

  const uniqueCommunityIds = [
    ...new Set(
      inputRows
        .map((row) => Number(row?.community_id || 0))
        .filter((communityId) => communityId > 0)
    ),
  ];
  const communityPlaceholders = uniqueCommunityIds.map(() => "?").join(", ");

  const [
    [likeCountRows],
    [commentCountRows],
    [revineCountRows],
    [pollRows],
    [likedRows],
    [revinedRows],
    [bookmarkRows],
    [communityRows],
  ] = await Promise.all([
    timedVineQuery(
      perfCtx,
      "post-metrics.likes",
      `SELECT post_id, COUNT(*) AS total FROM vine_likes WHERE post_id IN (${placeholders}) GROUP BY post_id`,
      postIds
    ),
    timedVineQuery(
      perfCtx,
      "post-metrics.comments",
      `SELECT post_id, COUNT(*) AS total FROM vine_comments WHERE post_id IN (${placeholders}) GROUP BY post_id`,
      postIds
    ),
    timedVineQuery(
      perfCtx,
      "post-metrics.revines",
      `SELECT post_id, COUNT(*) AS total FROM vine_revines WHERE post_id IN (${placeholders}) GROUP BY post_id`,
      postIds
    ),
    timedVineQuery(
      perfCtx,
      "post-metrics.polls",
      `SELECT post_id FROM vine_polls WHERE post_id IN (${placeholders})`,
      postIds
    ),
    safeViewerId
      ? timedVineQuery(
          perfCtx,
          "post-metrics.viewer-likes",
          `
          SELECT
            post_id,
            COALESCE(NULLIF(LOWER(reaction), ''), 'like') AS reaction
          FROM vine_likes
          WHERE user_id = ? AND post_id IN (${placeholders})
          `,
          [safeViewerId, ...postIds]
        )
      : Promise.resolve([[]]),
    safeViewerId
      ? timedVineQuery(
          perfCtx,
          "post-metrics.viewer-revines",
          `SELECT post_id FROM vine_revines WHERE user_id = ? AND post_id IN (${placeholders})`,
          [safeViewerId, ...postIds]
        )
      : Promise.resolve([[]]),
    safeViewerId
      ? timedVineQuery(
          perfCtx,
          "post-metrics.viewer-bookmarks",
          `SELECT post_id FROM vine_bookmarks WHERE user_id = ? AND post_id IN (${placeholders})`,
          [safeViewerId, ...postIds]
        )
      : Promise.resolve([[]]),
    safeViewerId && uniqueCommunityIds.length
      ? timedVineQuery(
          perfCtx,
          "post-metrics.viewer-communities",
          `
          SELECT community_id
          FROM vine_community_members
          WHERE user_id = ? AND community_id IN (${communityPlaceholders})
          `,
          [safeViewerId, ...uniqueCommunityIds]
        )
      : Promise.resolve([[]]),
  ]);

  const likeCountMap = buildCountMap(likeCountRows);
  const commentCountMap = buildCountMap(commentCountRows);
  const revineCountMap = buildCountMap(revineCountRows);
  const pollPostIds = new Set((pollRows || []).map((row) => Number(row.post_id)));
  const viewerReactionMap = new Map(
    (likedRows || []).map((row) => [Number(row.post_id), normalizePostReaction(row.reaction)])
  );
  const viewerRevinedPostIds = new Set((revinedRows || []).map((row) => Number(row.post_id)));
  const viewerBookmarkedPostIds = new Set((bookmarkRows || []).map((row) => Number(row.post_id)));
  const viewerCommunityIds = new Set((communityRows || []).map((row) => Number(row.community_id)));

  return inputRows.map((row) => {
    const postId = Number(row.id);
    const communityId = Number(row.community_id || 0);
    const viewerReaction = viewerReactionMap.get(postId) || null;
    return {
      ...row,
      likes: likeCountMap.get(postId) || 0,
      comments: commentCountMap.get(postId) || 0,
      revines: revineCountMap.get(postId) || 0,
      user_liked: viewerReaction ? 1 : 0,
      user_revined: viewerRevinedPostIds.has(postId) ? 1 : 0,
      user_bookmarked: viewerBookmarkedPostIds.has(postId) ? 1 : 0,
      viewer_reaction: viewerReaction,
      has_poll: pollPostIds.has(postId) ? 1 : 0,
      viewer_community_member: communityId > 0 ? (viewerCommunityIds.has(communityId) ? 1 : 0) : 1,
    };
  });
};

const getVinePostRowById = async (postId, viewerId, perfCtx = null) => {
  const [rows] = await timedVineQuery(
    perfCtx,
    "post.row-by-id",
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
      p.created_at,
      p.created_at AS sort_time,
      u.username,
      u.display_name,
      u.avatar_url,
      u.is_verified,
      u.is_private,
      u.badge_type,
      u.hide_like_counts,
      NULL AS revined_by,
      NULL AS reviner_username
    FROM vine_posts p
    JOIN vine_users u ON p.user_id = u.id
    LEFT JOIN vine_communities c ON c.id = p.community_id
    WHERE p.id = ?
    LIMIT 1
    `,
    [postId]
  );
  if (!rows[0]) return null;
  const [enriched] = await enrichVinePostRows(rows, viewerId);
  return enriched || null;
};

const FEED_PAGE_SIZE = 40;
const FEED_FOLLOWED_CANDIDATE_LIMIT = 120;
const FEED_PUBLIC_CANDIDATE_LIMIT = 140;
const FEED_REVINE_CANDIDATE_LIMIT = 120;
const FEED_NEWS_CANDIDATE_LIMIT = 160;
const TRENDING_POST_CANDIDATE_LIMIT = 160;

const parseFeedCursor = (query = {}) => {
  const rawTime = String(query.cursor_time || "").trim();
  const rawFeedId = String(query.cursor_feed_id || "").trim();
  if (!rawTime || !rawFeedId) {
    return { time: null, feedId: "", kind: null, sourceId: 0 };
  }
  const parsed = new Date(rawTime);
  if (Number.isNaN(parsed.getTime())) {
    return { time: null, feedId: "", kind: null, sourceId: 0 };
  }
  const kind = rawFeedId.startsWith("revine-")
    ? "revine"
    : rawFeedId.startsWith("post-")
      ? "post"
      : null;
  const sourceId = Number(rawFeedId.split("-")[1] || 0);
  return {
    time: parsed,
    feedId: rawFeedId,
    kind,
    sourceId: Number.isFinite(sourceId) ? sourceId : 0,
  };
};

const buildSourceCursorClause = (alias, sourceKind, cursor) => {
  if (!cursor?.time) return { sql: "", params: [] };
  const mysqlTime = cursor.time.toISOString().slice(0, 19).replace("T", " ");
  if (cursor.kind === sourceKind && cursor.sourceId > 0) {
    return {
      sql: ` AND (${alias}.created_at < ? OR (${alias}.created_at = ? AND ${alias}.id < ?))`,
      params: [mysqlTime, mysqlTime, cursor.sourceId],
    };
  }
  return {
    sql: ` AND ${alias}.created_at <= ?`,
    params: [mysqlTime],
  };
};

const isNewsUserRow = (row = {}) => {
  const username = String(row?.username || "").trim().toLowerCase();
  const displayName = String(row?.display_name || "").trim().toLowerCase();
  const badgeType = String(row?.badge_type || "").trim().toLowerCase();
  return (
    username === "vine_news" ||
    username === "vine news" ||
    displayName === "vine news" ||
    badgeType === "news"
  );
};

const buildFeedCursorToken = (item = {}) => ({
  time: item?.sort_time ? new Date(item.sort_time).toISOString() : "",
  feedId: String(item?.feed_id || ""),
});

const compareFeedCandidatesDesc = (a, b) => {
  const aTime = new Date(a?.sort_time || 0).getTime();
  const bTime = new Date(b?.sort_time || 0).getTime();
  if (aTime !== bTime) return bTime - aTime;
  return String(b?.feed_id || "").localeCompare(String(a?.feed_id || ""));
};

const isCandidateBeforeCursor = (item, cursor) => {
  if (!cursor?.time || !cursor?.feedId) return true;
  const itemTime = new Date(item?.sort_time || 0).getTime();
  const cursorTime = cursor.time.getTime();
  if (itemTime !== cursorTime) return itemTime < cursorTime;
  return String(item?.feed_id || "") < String(cursor.feedId);
};

const loadViewerFeedState = async (viewerId, perfCtx = null) => {
  const safeViewerId = Number(viewerId || 0);
  if (!safeViewerId) {
    return {
      followedIds: new Set(),
      blockedIds: new Set(),
      mutedIds: new Set(),
    };
  }

  const [[followRows], [blockRows], [muteRows]] = await Promise.all([
    timedVineQuery(
      perfCtx,
      "feed.viewer-follows",
      "SELECT following_id FROM vine_follows WHERE follower_id = ?",
      [safeViewerId]
    ),
    timedVineQuery(
      perfCtx,
      "feed.viewer-blocks",
      `
      SELECT blocker_id, blocked_id
      FROM vine_blocks
      WHERE blocker_id = ? OR blocked_id = ?
      `,
      [safeViewerId, safeViewerId]
    ),
    timedVineQuery(
      perfCtx,
      "feed.viewer-mutes",
      "SELECT muted_id FROM vine_mutes WHERE muter_id = ?",
      [safeViewerId]
    ),
  ]);

  const followedIds = new Set((followRows || []).map((row) => Number(row.following_id)).filter(Boolean));
  const blockedIds = new Set();
  for (const row of blockRows || []) {
    const blockerId = Number(row.blocker_id || 0);
    const blockedId = Number(row.blocked_id || 0);
    if (blockerId === safeViewerId && blockedId > 0) blockedIds.add(blockedId);
    if (blockedId === safeViewerId && blockerId > 0) blockedIds.add(blockerId);
  }
  const mutedIds = new Set((muteRows || []).map((row) => Number(row.muted_id)).filter(Boolean));

  return { followedIds, blockedIds, mutedIds };
};

const getFeedPageData = async ({ viewerId, feedTag = "", feedTab = "for-you", cursor }, perfCtx = null) => {
  await ensureVinePerformanceSchema();
  const safeViewerId = Number(viewerId || 0);
  const normalizedTag = String(feedTag || "").trim().toLowerCase();
  const viewerState = await loadViewerFeedState(safeViewerId, perfCtx);
  const followTargets = safeViewerId
    ? [safeViewerId, ...viewerState.followedIds].filter((value, idx, arr) => value > 0 && arr.indexOf(value) === idx)
    : [];

  const followedCursor = buildSourceCursorClause("p", "post", cursor);
  const publicCursor = buildSourceCursorClause("p", "post", cursor);
  const revineCursor = buildSourceCursorClause("r", "revine", cursor);

  const sourceQueries = [];

  if (feedTab !== "news" && followTargets.length) {
    const placeholders = followTargets.map(() => "?").join(", ");
    sourceQueries.push(
      timedVineQuery(
        perfCtx,
        "feed.source.followed-posts",
        `
        SELECT
          p.id,
          p.user_id,
          p.community_id,
          p.topic_tag,
          p.content,
          p.created_at
        FROM vine_posts p
        WHERE p.user_id IN (${placeholders})
          ${followedCursor.sql}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ?
        `,
        [...followTargets, ...followedCursor.params, FEED_FOLLOWED_CANDIDATE_LIMIT]
      )
    );
  } else {
    sourceQueries.push(Promise.resolve([[]]));
  }

  if (feedTab === "news") {
    sourceQueries.push(
      timedVineQuery(
        perfCtx,
        "feed.source.news-posts",
        `
        SELECT
          p.id,
          p.user_id,
          p.community_id,
          p.topic_tag,
          p.content,
          p.created_at
        FROM vine_posts p
        WHERE 1 = 1
          ${publicCursor.sql}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ?
        `,
        [...publicCursor.params, FEED_NEWS_CANDIDATE_LIMIT]
      )
    );
  } else {
    sourceQueries.push(Promise.resolve([[]]));
  }

  if (feedTab !== "news" && followTargets.length) {
    const placeholders = followTargets.map(() => "?").join(", ");
    sourceQueries.push(
      timedVineQuery(
        perfCtx,
        "feed.source.followed-revines",
        `
        SELECT
          r.id,
          r.post_id,
          r.user_id,
          r.created_at
        FROM vine_revines r
        WHERE r.user_id IN (${placeholders})
          ${revineCursor.sql}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ?
        `,
        [...followTargets, ...revineCursor.params, FEED_REVINE_CANDIDATE_LIMIT]
      )
    );
  } else {
    sourceQueries.push(Promise.resolve([[]]));
  }

  const [
    [followedRows],
    [recentPostRows],
    [revineRows],
  ] = await Promise.all(sourceQueries);

  const revinePostIds = [...new Set((revineRows || []).map((row) => Number(row.post_id || 0)).filter(Boolean))];
  let revinePostMetaRows = [];
  if (revinePostIds.length) {
    const placeholders = revinePostIds.map(() => "?").join(", ");
    [revinePostMetaRows] = await timedVineQuery(
      perfCtx,
      "feed.source.revine-post-meta",
      `
      SELECT
        p.id,
        p.user_id,
        p.community_id,
        p.topic_tag,
        p.content
      FROM vine_posts p
      WHERE p.id IN (${placeholders})
      `,
      revinePostIds
    );
  }

  const revinePostMap = new Map(
    (revinePostMetaRows || []).map((row) => [Number(row.id), row])
  );

  const userIds = new Set();
  for (const row of followedRows || []) userIds.add(Number(row.user_id || 0));
  for (const row of recentPostRows || []) userIds.add(Number(row.user_id || 0));
  for (const row of revineRows || []) {
    const revineRow = revinePostMap.get(Number(row.post_id || 0));
    userIds.add(Number(revineRow?.user_id || 0));
    userIds.add(Number(row.user_id || 0));
  }

  let userRows = [];
  const normalizedUserIds = [...userIds].filter(Boolean);
  if (normalizedUserIds.length) {
    const placeholders = normalizedUserIds.map(() => "?").join(", ");
    [userRows] = await timedVineQuery(
      perfCtx,
      "feed.source.users",
      `
      SELECT
        id,
        username,
        display_name,
        is_private,
        badge_type
      FROM vine_users
      WHERE id IN (${placeholders})
      `,
      normalizedUserIds
    );
  }

  const userMap = new Map((userRows || []).map((row) => [Number(row.id), row]));
  const postCandidateMap = new Map();

  const matchesTag = (row) => {
    if (!normalizedTag) return true;
    const topicTag = String(row?.topic_tag || "").trim().toLowerCase();
    if (topicTag === normalizedTag) return true;
    const content = String(row?.content || "").toLowerCase();
    return content.includes(`#${normalizedTag}`);
  };

  const isAuthorVisible = (authorId, authorRow) => {
    const safeAuthorId = Number(authorId || 0);
    if (!safeAuthorId || !authorRow) return false;
    if (viewerState.blockedIds.has(safeAuthorId) || viewerState.mutedIds.has(safeAuthorId)) return false;
    if (feedTab === "news") return isNewsUserRow(authorRow);
    if (isNewsUserRow(authorRow)) return false;
    if (!safeViewerId) return Number(authorRow.is_private || 0) === 0;
    if (safeAuthorId === safeViewerId) return true;
    if (viewerState.followedIds.has(safeAuthorId)) return true;
    return Number(authorRow.is_private || 0) === 0;
  };

  for (const row of followedRows || []) {
    const postId = Number(row.id || 0);
    if (!postId || postCandidateMap.has(postId)) continue;
    const authorRow = userMap.get(Number(row.user_id || 0));
    if (!isAuthorVisible(row.user_id, authorRow)) continue;
    if (!matchesTag(row)) continue;
    const candidate = {
      kind: "post",
      feed_id: `post-${postId}`,
      source_id: postId,
      id: postId,
      post_id: postId,
      post_user_id: Number(row.user_id || 0),
      revined_by: null,
      sort_time: row.created_at,
    };
    if (!isCandidateBeforeCursor(candidate, cursor)) continue;
    postCandidateMap.set(postId, candidate);
  }

  for (const row of recentPostRows || []) {
    const postId = Number(row.id || 0);
    if (!postId || postCandidateMap.has(postId)) continue;
    const authorRow = userMap.get(Number(row.user_id || 0));
    if (!isAuthorVisible(row.user_id, authorRow)) continue;
    if (!matchesTag(row)) continue;
    const candidate = {
      kind: "post",
      feed_id: `post-${postId}`,
      source_id: postId,
      id: postId,
      post_id: postId,
      post_user_id: Number(row.user_id || 0),
      revined_by: null,
      sort_time: row.created_at,
    };
    if (!isCandidateBeforeCursor(candidate, cursor)) continue;
    postCandidateMap.set(postId, candidate);
  }

  const feedCandidates = [...postCandidateMap.values()];

  for (const row of revineRows || []) {
    const sourceId = Number(row.id || 0);
    const postRow = revinePostMap.get(Number(row.post_id || 0));
    if (!sourceId || !postRow) continue;
    const authorRow = userMap.get(Number(postRow.user_id || 0));
    if (!isAuthorVisible(postRow.user_id, authorRow)) continue;
    if (!matchesTag(postRow)) continue;
    const candidate = {
      kind: "revine",
      feed_id: `revine-${sourceId}`,
      source_id: sourceId,
      id: Number(postRow.id || 0),
      post_id: Number(postRow.id || 0),
      post_user_id: Number(postRow.user_id || 0),
      revined_by: Number(row.user_id || 0),
      sort_time: row.created_at,
    };
    if (!isCandidateBeforeCursor(candidate, cursor)) continue;
    feedCandidates.push(candidate);
  }

  feedCandidates.sort(compareFeedCandidatesDesc);
  const finalCandidates = feedCandidates.slice(0, FEED_PAGE_SIZE);
  const nextCursor = finalCandidates.length === FEED_PAGE_SIZE
    ? buildFeedCursorToken(finalCandidates[finalCandidates.length - 1])
    : null;

  if (!finalCandidates.length) {
    return { items: [], nextCursor: null };
  }

  const postIds = [...new Set(finalCandidates.map((row) => Number(row.post_id || row.id || 0)).filter(Boolean))];
  const postPlaceholders = postIds.map(() => "?").join(", ");
  const [hydratedRows] = await timedVineQuery(
    perfCtx,
    "feed.hydrate.posts",
    `
    SELECT
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
      p.created_at,
      u.username,
      u.display_name,
      u.avatar_url,
      u.is_verified,
      u.badge_type,
      u.hide_like_counts
    FROM vine_posts p
    JOIN vine_users u ON p.user_id = u.id
    LEFT JOIN vine_communities c ON c.id = p.community_id
    WHERE p.id IN (${postPlaceholders})
    `,
    postIds
  );

  const hydratedPostMap = new Map((hydratedRows || []).map((row) => [Number(row.id), row]));
  const revinerIds = [...new Set(finalCandidates.map((row) => Number(row.revined_by || 0)).filter(Boolean))];
  let revinerRows = [];
  if (revinerIds.length) {
    const placeholders = revinerIds.map(() => "?").join(", ");
    [revinerRows] = await timedVineQuery(
      perfCtx,
      "feed.hydrate.reviners",
      `SELECT id, username FROM vine_users WHERE id IN (${placeholders})`,
      revinerIds
    );
  }
  const revinerMap = new Map((revinerRows || []).map((row) => [Number(row.id), row]));

  const orderedRows = finalCandidates
    .map((candidate) => {
      const postRow = hydratedPostMap.get(Number(candidate.post_id || candidate.id || 0));
      if (!postRow) return null;
      return {
        ...postRow,
        feed_id: candidate.feed_id,
        sort_time: candidate.sort_time,
        revined_by: candidate.revined_by || null,
        reviner_username: candidate.revined_by ? (revinerMap.get(Number(candidate.revined_by))?.username || null) : null,
      };
    })
    .filter(Boolean);

  const enrichedItems = await enrichVinePostRows(orderedRows, viewerId, perfCtx);
  return { items: enrichedItems, nextCursor };
};

const getTrendingPostRows = async ({ viewerId, limit }, perfCtx = null) => {
  const safeViewerId = Number(viewerId || 0);
  const safeLimit = Math.max(1, Math.min(Number(limit || 8) || 8, 20));
  const candidateLimit = Math.max(safeLimit * 8, 80);
  const viewerState = await loadViewerFeedState(safeViewerId, perfCtx);

  const [candidateRows] = await timedVineQuery(
    perfCtx,
    "trending.source.candidates",
    `
    SELECT
      p.id,
      p.user_id,
      p.community_id,
      p.content,
      p.image_url,
      p.link_preview,
      p.created_at
    FROM vine_posts p
    WHERE p.created_at >= NOW() - INTERVAL 1 DAY
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ?
    `,
    [Math.min(candidateLimit, TRENDING_POST_CANDIDATE_LIMIT)]
  );

  if (!Array.isArray(candidateRows) || !candidateRows.length) {
    return [];
  }

  const authorIds = [...new Set(candidateRows.map((row) => Number(row.user_id || 0)).filter(Boolean))];
  let authorRows = [];
  if (authorIds.length) {
    const placeholders = authorIds.map(() => "?").join(", ");
    [authorRows] = await timedVineQuery(
      perfCtx,
      "trending.source.authors",
      `
      SELECT
        id,
        username,
        display_name,
        avatar_url,
        is_verified,
        is_private,
        badge_type,
        hide_like_counts
      FROM vine_users
      WHERE id IN (${placeholders})
      `,
      authorIds
    );
  }

  const authorMap = new Map((authorRows || []).map((row) => [Number(row.id), row]));
  const visibleRows = candidateRows.filter((row) => {
    const authorId = Number(row.user_id || 0);
    const authorRow = authorMap.get(authorId);
    if (!authorId || !authorRow) return false;
    if (viewerState.blockedIds.has(authorId) || viewerState.mutedIds.has(authorId)) return false;
    if (!safeViewerId) return Number(authorRow.is_private || 0) === 0;
    if (authorId === safeViewerId) return true;
    if (viewerState.followedIds.has(authorId)) return true;
    return Number(authorRow.is_private || 0) === 0;
  });

  if (!visibleRows.length) {
    return [];
  }

  const baseRows = visibleRows.map((row) => {
    const authorRow = authorMap.get(Number(row.user_id || 0)) || {};
    return {
      feed_id: `post-${row.id}`,
      id: Number(row.id || 0),
      user_id: Number(row.user_id || 0),
      community_id: Number(row.community_id || 0),
      content: row.content || "",
      image_url: row.image_url || "",
      link_preview: row.link_preview || null,
      created_at: row.created_at,
      sort_time: row.created_at,
      username: authorRow.username || "",
      display_name: authorRow.display_name || authorRow.username || "",
      avatar_url: authorRow.avatar_url || "",
      is_verified: Number(authorRow.is_verified || 0),
      badge_type: authorRow.badge_type || null,
      hide_like_counts: Number(authorRow.hide_like_counts || 0),
      revined_by: null,
      reviner_username: null,
    };
  });

  const enrichedRows = await enrichVinePostRows(baseRows, safeViewerId, perfCtx);
  return enrichedRows
    .sort((a, b) => {
      const likeDelta = Number(b.likes || 0) - Number(a.likes || 0);
      if (likeDelta !== 0) return likeDelta;
      const commentDelta = Number(b.comments || 0) - Number(a.comments || 0);
      if (commentDelta !== 0) return commentDelta;
      const aTime = new Date(a.created_at || 0).getTime();
      const bTime = new Date(b.created_at || 0).getTime();
      if (aTime !== bTime) return bTime - aTime;
      return Number(b.id || 0) - Number(a.id || 0);
    })
    .slice(0, safeLimit);
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
  clearVineReadCache("notifications", "notifications-unread", "notifications-unseen");
};

const notifyUser = async ({ userId, actorId, type, postId = null, commentId = null, meta = null }) => {
  const targetId = Number(userId);
  const sourceId = Number(actorId || 0);
  if (!targetId || !type) return;
  const dbName = await getDbName();
  const canStoreMeta = dbName
    ? await hasColumn(dbName, "vine_notifications", "meta_json")
    : false;

  if (canStoreMeta) {
    await db.query(
      `
      INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id, meta_json)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [targetId, sourceId || null, type, postId, commentId, meta ? JSON.stringify(meta) : null]
    );
  } else {
    await db.query(
      `
      INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id)
      VALUES (?, ?, ?, ?, ?)
      `,
      [targetId, sourceId || null, type, postId, commentId]
    );
  }

  io.to(`user-${targetId}`).emit("notification");
  clearVineReadCache("notifications", "notifications-unread", "notifications-unseen");
};

const notifyUsersBulk = async ({ userIds = [], actorId, type, postId = null, commentId = null, meta = null }) => {
  const recipients = Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [])
        .map((value) => Number(value))
        .filter(Boolean)
    )
  );
  const sourceId = Number(actorId || 0);
  if (!recipients.length || !type) return 0;

  const dbName = await getDbName();
  const canStoreMeta = dbName
    ? await hasColumn(dbName, "vine_notifications", "meta_json")
    : false;

  for (const targetId of recipients) {
    if (canStoreMeta) {
      await db.query(
        `
        INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id, meta_json)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [targetId, sourceId || null, type, postId, commentId, meta ? JSON.stringify(meta) : null]
      );
    } else {
      await db.query(
        `
        INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id)
        VALUES (?, ?, ?, ?, ?)
        `,
        [targetId, sourceId || null, type, postId, commentId]
      );
    }
    io.to(`user-${targetId}`).emit("notification");
  }

  clearVineReadCache("notifications", "notifications-unread", "notifications-unseen");
  return recipients.length;
};

const buildVineAuthUser = (user) => ({
  id: user.id,
  username: user.username,
  display_name: user.display_name,
  email: user.email || null,
  is_admin: user.is_admin,
  role: user.role || "user",
  badge_type: user.badge_type || null,
  delete_requested_at: user.delete_requested_at || null,
  deactivated_at: user.deactivated_at || null,
  deletion_due_at: user.delete_requested_at
    ? getAccountDeletionDueAt(user.delete_requested_at)?.toISOString() || null
    : null,
});

const signVineSessionToken = (user, sessionJti) =>
  jwt.sign(
    {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin,
      role: user.role || "user",
      badge_type: user.badge_type || null,
      jti: sessionJti,
    },
    JWT_SECRET,
    { expiresIn: VINE_JWT_EXPIRES_IN }
  );

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
  await addIfMissing("birthday_on_profile", "TINYINT(1) NOT NULL DEFAULT 0");
  await addIfMissing("birthday_on_profile_mode", "VARCHAR(20) NOT NULL DEFAULT 'month_day'");
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

let advancedSettingsSchemaReady = false;
const ensureAdvancedSettingsSchema = async () => {
  if (advancedSettingsSchemaReady) return;
  const dbName = await getDbName();
  if (!dbName) return;

  const addIfMissing = async (column, definition) => {
    const exists = await hasColumn(dbName, "vine_users", column);
    if (!exists) {
      await db.query(`ALTER TABLE vine_users ADD COLUMN ${column} ${definition}`);
    }
  };

  await addIfMissing("two_factor_email", "TINYINT(1) NOT NULL DEFAULT 0");
  await addIfMissing("mentions_privacy", "VARCHAR(20) NOT NULL DEFAULT 'everyone'");
  await addIfMissing("tags_privacy", "VARCHAR(20) NOT NULL DEFAULT 'everyone'");
  await addIfMissing("hide_from_search", "TINYINT(1) NOT NULL DEFAULT 0");
  await addIfMissing("notif_inapp_likes", "TINYINT(1) NOT NULL DEFAULT 1");
  await addIfMissing("notif_inapp_comments", "TINYINT(1) NOT NULL DEFAULT 1");
  await addIfMissing("notif_inapp_mentions", "TINYINT(1) NOT NULL DEFAULT 1");
  await addIfMissing("notif_inapp_messages", "TINYINT(1) NOT NULL DEFAULT 1");
  await addIfMissing("notif_inapp_reports", "TINYINT(1) NOT NULL DEFAULT 1");
  await addIfMissing("notif_email_likes", "TINYINT(1) NOT NULL DEFAULT 0");
  await addIfMissing("notif_email_comments", "TINYINT(1) NOT NULL DEFAULT 0");
  await addIfMissing("notif_email_mentions", "TINYINT(1) NOT NULL DEFAULT 1");
  await addIfMissing("notif_email_messages", "TINYINT(1) NOT NULL DEFAULT 0");
  await addIfMissing("notif_email_reports", "TINYINT(1) NOT NULL DEFAULT 1");
  await addIfMissing("quiet_hours_enabled", "TINYINT(1) NOT NULL DEFAULT 0");
  await addIfMissing("quiet_hours_start", "VARCHAR(5) NOT NULL DEFAULT '22:00'");
  await addIfMissing("quiet_hours_end", "VARCHAR(5) NOT NULL DEFAULT '07:00'");
  await addIfMissing("notif_digest", "VARCHAR(20) NOT NULL DEFAULT 'instant'");
  await addIfMissing("muted_words", "TEXT NULL");
  await addIfMissing("autoplay_media", "TINYINT(1) NOT NULL DEFAULT 1");
  await addIfMissing("blur_sensitive_media", "TINYINT(1) NOT NULL DEFAULT 0");
  await addIfMissing("last_seen_notice_version", "VARCHAR(80) NULL");
  await addIfMissing("deactivated_at", "DATETIME NULL");
  await addIfMissing("delete_requested_at", "DATETIME NULL");

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_user_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      session_jti VARCHAR(64) NOT NULL UNIQUE,
      device_info VARCHAR(255) NULL,
      ip_address VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME NULL,
      INDEX idx_vus_user (user_id),
      INDEX idx_vus_revoked (revoked_at)
    )
  `);

  advancedSettingsSchemaReady = true;
};

let postTagSchemaReady = false;
const ensurePostTagSchema = async () => {
  if (postTagSchemaReady) return;
  const dbName = await getDbName();
  if (!dbName) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_post_tags (
      post_id INT NOT NULL,
      tagged_user_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, tagged_user_id),
      KEY idx_vine_post_tags_tagged_post (tagged_user_id, post_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  postTagSchemaReady = true;
};

let systemNoticeSchemaReady = false;
let systemNoticeCache = null;
let systemNoticeLoadedAt = 0;
const SYSTEM_NOTICE_CACHE_MS = 60 * 1000;

const normalizeSystemNoticeSettings = (value = {}) => {
  const enabled =
    value.enabled === undefined || value.enabled === null
      ? VINE_SYSTEM_NOTICE_ENABLED
      : Number(value.enabled) === 1 || value.enabled === true;
  const version = String(value.version || VINE_SYSTEM_NOTICE_VERSION || "").trim();
  const title = String(
    value.title || VINE_SYSTEM_NOTICE_TITLE || "A quick Vine update"
  )
    .trim()
    .slice(0, 140);
  const message = String(
    value.message ||
      VINE_SYSTEM_NOTICE_MESSAGE ||
      "We have polished a few things across Vine to keep it lighter, cleaner, and easier to use. Tap okay to continue."
  )
    .trim()
    .slice(0, 4000);

  return {
    enabled,
    version,
    title: title || "A quick Vine update",
    message:
      message ||
      "We have polished a few things across Vine to keep it lighter, cleaner, and easier to use. Tap okay to continue.",
    updated_by: value.updated_by ? Number(value.updated_by) : null,
    updated_at: value.updated_at || null,
  };
};

const buildSystemNoticeVersion = () => `notice-${Date.now()}`;

const ensureSystemNoticeSchema = async () => {
  if (systemNoticeSchemaReady) return;
  await ensureAdvancedSettingsSchema();
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_system_notice_settings (
      id TINYINT PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      version VARCHAR(80) NOT NULL,
      title VARCHAR(140) NOT NULL,
      message TEXT NOT NULL,
      updated_by INT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  systemNoticeSchemaReady = true;
};

const getCurrentVineSystemNotice = async ({ force = false, includeDisabled = false } = {}) => {
  await ensureSystemNoticeSchema();
  if (!force && systemNoticeCache && Date.now() - systemNoticeLoadedAt < SYSTEM_NOTICE_CACHE_MS) {
    return includeDisabled || systemNoticeCache.enabled ? systemNoticeCache : null;
  }

  const [[row]] = await db.query(
    `
    SELECT enabled, version, title, message, updated_by, updated_at
    FROM vine_system_notice_settings
    WHERE id = 1
    LIMIT 1
    `
  );

  const next = normalizeSystemNoticeSettings(row || {});
  systemNoticeCache = next;
  systemNoticeLoadedAt = Date.now();
  return includeDisabled || next.enabled ? next : null;
};

const saveSystemNoticeSettings = async (payload = {}, updatedBy = null) => {
  await ensureSystemNoticeSchema();
  const current = await getCurrentVineSystemNotice({ force: true, includeDisabled: true });
  const merged = normalizeSystemNoticeSettings({
    ...current,
    enabled: payload.enabled,
    title: payload.title,
    message: payload.message,
  });

  if (!String(merged.message || "").trim()) {
    const err = new Error("Notice message cannot be empty");
    err.statusCode = 400;
    throw err;
  }

  const currentVersion = String(current?.version || VINE_SYSTEM_NOTICE_VERSION || "").trim();
  const changed =
    !current ||
    Boolean(current.enabled) !== Boolean(merged.enabled) ||
    String(current.title || "") !== String(merged.title || "") ||
    String(current.message || "") !== String(merged.message || "");

  const next = {
    ...merged,
    version: changed ? buildSystemNoticeVersion() : currentVersion || buildSystemNoticeVersion(),
    updated_by: updatedBy ? Number(updatedBy) : null,
  };

  await db.query(
    `
    INSERT INTO vine_system_notice_settings
      (id, enabled, version, title, message, updated_by, updated_at)
    VALUES
      (1, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      enabled = VALUES(enabled),
      version = VALUES(version),
      title = VALUES(title),
      message = VALUES(message),
      updated_by = VALUES(updated_by),
      updated_at = NOW()
    `,
    [next.enabled ? 1 : 0, next.version, next.title, next.message, next.updated_by]
  );

  const [[savedRow]] = await db.query(
    `
    SELECT enabled, version, title, message, updated_by, updated_at
    FROM vine_system_notice_settings
    WHERE id = 1
    LIMIT 1
    `
  );
  const saved = normalizeSystemNoticeSettings(savedRow || next);
  systemNoticeCache = saved;
  systemNoticeLoadedAt = Date.now();
  return saved;
};

let followRequestSchemaReady = false;
const ensureFollowRequestSchema = async () => {
  if (followRequestSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_follow_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      requester_id INT NOT NULL,
      target_id INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME NULL,
      reviewed_by INT NULL,
      UNIQUE KEY uniq_follow_request_pair (requester_id, target_id),
      INDEX idx_follow_request_target_status (target_id, status),
      INDEX idx_follow_request_requester_status (requester_id, status)
    )
  `);
  followRequestSchemaReady = true;
};

const ACCOUNT_DELETE_GRACE_DAYS = 10;
const ACCOUNT_DELETE_SWEEP_MS = 60 * 60 * 1000;

const getAccountDeletionDueAt = (deleteRequestedAt) => {
  if (!deleteRequestedAt) return null;
  const dt = new Date(deleteRequestedAt);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setDate(dt.getDate() + ACCOUNT_DELETE_GRACE_DAYS);
  return dt;
};

const collectJsonUrls = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
    return parsed ? [parsed] : [];
  } catch {
    return [raw];
  }
};

const purgeUserAccount = async (userId) => {
  const numericUserId = Number(userId);
  if (!numericUserId) return false;

  const [[user]] = await db.query(
    "SELECT id, avatar_url, banner_url FROM vine_users WHERE id = ? LIMIT 1",
    [numericUserId]
  );
  if (!user) return false;

  const [posts] = await db.query(
    "SELECT id, image_url FROM vine_posts WHERE user_id = ?",
    [numericUserId]
  );
  const [statuses] = await db.query(
    "SELECT media_url FROM vine_statuses WHERE user_id = ?",
    [numericUserId]
  );
  const [submissionFiles] = await db.query(
    `
    SELECT f.file_url
    FROM vine_community_submission_files f
    JOIN vine_community_submissions s ON s.id = f.submission_id
    WHERE s.user_id = ?
    `,
    [numericUserId]
  );
  const [assignmentFiles] = await db.query(
    "SELECT attachment_url FROM vine_community_assignments WHERE creator_id = ? AND attachment_url IS NOT NULL AND attachment_url != ''",
    [numericUserId]
  );
  const [ownedCommunities] = await db.query(
    "SELECT id, avatar_url, banner_url FROM vine_communities WHERE creator_id = ?",
    [numericUserId]
  );

  const urlsToDelete = [
    ...posts.flatMap((row) => collectJsonUrls(row.image_url)),
    ...statuses.map((row) => row.media_url).filter(Boolean),
    ...submissionFiles.map((row) => row.file_url).filter(Boolean),
    ...assignmentFiles.map((row) => row.attachment_url).filter(Boolean),
    ...ownedCommunities.flatMap((row) => [row.avatar_url, row.banner_url].filter(Boolean)),
    ...[user.avatar_url, user.banner_url].filter(Boolean),
  ];
  await Promise.allSettled(Array.from(new Set(urlsToDelete)).map((url) => deleteCloudinaryByUrl(url)));

  const communityIds = ownedCommunities.map((row) => Number(row.id)).filter(Boolean);
  if (communityIds.length) {
    const placeholders = communityIds.map(() => "?").join(", ");
    await db.query(`DELETE FROM vine_community_submission_files WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_community_submission_drafts WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_community_submissions WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_community_assignments WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_community_attendance WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_community_sessions WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_community_reports WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_community_events WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_community_join_questions WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_community_rules WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_community_join_requests WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_community_members WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_scheduled_posts WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_post_tags WHERE post_id IN (SELECT id FROM vine_posts WHERE community_id IN (${placeholders}))`, communityIds).catch(() => {});
    await db.query(`DELETE FROM vine_posts WHERE community_id IN (${placeholders})`, communityIds);
    await db.query(`DELETE FROM vine_communities WHERE id IN (${placeholders})`, communityIds);
  }

  await db.query("DELETE FROM vine_community_submission_files WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_community_submission_drafts WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_community_submissions WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_community_members WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_community_join_requests WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_community_sessions WHERE created_by = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_community_attendance WHERE user_id = ? OR marked_by = ?", [numericUserId, numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_community_assignments WHERE creator_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_status_views WHERE viewer_id = ? OR user_id = ?", [numericUserId, numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_statuses WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_comment_likes WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_comments WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_bookmarks WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_likes WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_revines WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_post_tags WHERE tagged_user_id = ? OR post_id IN (SELECT id FROM vine_posts WHERE user_id = ?)", [numericUserId, numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_posts WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_notifications WHERE user_id = ? OR actor_id = ?", [numericUserId, numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_reports WHERE reporter_id = ? OR reported_user_id = ?", [numericUserId, numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_user_suspensions WHERE user_id = ? OR created_by = ?", [numericUserId, numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_blocks WHERE blocker_id = ? OR blocked_id = ?", [numericUserId, numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_mutes WHERE muter_id = ? OR muted_id = ?", [numericUserId, numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_follows WHERE follower_id = ? OR following_id = ?", [numericUserId, numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_follow_requests WHERE requester_id = ? OR target_id = ? OR reviewed_by = ?", [numericUserId, numericUserId, numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_messages WHERE sender_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_conversation_deletes WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_conversations WHERE user1_id = ? OR user2_id = ?", [numericUserId, numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_user_sessions WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_login_events WHERE user_id = ?", [numericUserId]).catch(() => {});
  await db.query("DELETE FROM vine_users WHERE id = ?", [numericUserId]).catch(() => {});
  return true;
};

const sweepExpiredAccountDeletions = async () => {
  await ensureAdvancedSettingsSchema();
  const [rows] = await db.query(
    `
    SELECT id, delete_requested_at
    FROM vine_users
    WHERE delete_requested_at IS NOT NULL
    `
  );
  for (const row of rows) {
    const dueAt = getAccountDeletionDueAt(row.delete_requested_at);
    if (dueAt && dueAt <= new Date()) {
      await purgeUserAccount(row.id);
    }
  }
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
      banner_offset_y INT NOT NULL DEFAULT 0,
      join_policy VARCHAR(20) NOT NULL DEFAULT 'open',
      post_permission VARCHAR(20) NOT NULL DEFAULT 'mods_only',
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
    CREATE TABLE IF NOT EXISTS vine_community_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      community_id INT NOT NULL,
      title VARCHAR(180) NOT NULL,
      starts_at DATETIME NOT NULL,
      ends_at DATETIME NULL,
      notes TEXT NULL,
      created_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sessions_community_time (community_id, starts_at),
      INDEX idx_sessions_creator (created_by)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_attendance (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id INT NOT NULL,
      community_id INT NOT NULL,
      user_id INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'absent',
      marked_by INT NOT NULL,
      marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_session_user_attendance (session_id, user_id),
      INDEX idx_attendance_session (session_id),
      INDEX idx_attendance_community_user (community_id, user_id)
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
  if (!(await hasIndexNamed(dbName, "vine_scheduled_posts", "idx_vine_scheduled_posts_status_run"))) {
    await db.query(
      "ALTER TABLE vine_scheduled_posts ADD INDEX idx_vine_scheduled_posts_status_run (status, run_at, id)"
    );
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      community_id INT NOT NULL,
      creator_id INT NOT NULL,
      title VARCHAR(160) NOT NULL,
      instructions TEXT NULL,
      assignment_type VARCHAR(20) NOT NULL DEFAULT 'theory',
      attachment_url TEXT NULL,
      attachment_name VARCHAR(255) NULL,
      due_at DATETIME NULL,
      points DECIMAL(8,2) NOT NULL DEFAULT 100.00,
      rubric TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL,
      INDEX idx_assignment_community_due (community_id, due_at),
      INDEX idx_assignment_creator (creator_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_submissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      assignment_id INT NOT NULL,
      community_id INT NOT NULL,
      user_id INT NOT NULL,
      content TEXT NULL,
      attachment_url TEXT NULL,
      attachment_name VARCHAR(255) NULL,
      attachment_mime VARCHAR(120) NULL,
      attempt_count INT NOT NULL DEFAULT 1,
      status VARCHAR(20) NOT NULL DEFAULT 'submitted',
      score DECIMAL(6,2) NULL,
      feedback TEXT NULL,
      submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      graded_at DATETIME NULL,
      graded_by INT NULL,
      updated_at DATETIME NULL,
      UNIQUE KEY uniq_assignment_submission (assignment_id, user_id),
      INDEX idx_submission_assignment (assignment_id, submitted_at),
      INDEX idx_submission_community_user (community_id, user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_submission_drafts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      assignment_id INT NOT NULL,
      community_id INT NOT NULL,
      user_id INT NOT NULL,
      content TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_assignment_draft_user (assignment_id, user_id),
      INDEX idx_assignment_draft_community_user (community_id, user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_submission_files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      submission_id INT NOT NULL,
      assignment_id INT NOT NULL,
      community_id INT NOT NULL,
      user_id INT NOT NULL,
      file_url TEXT NOT NULL,
      file_name VARCHAR(255) NULL,
      file_mime VARCHAR(120) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_submission_files_submission (submission_id, created_at),
      INDEX idx_submission_files_assignment (assignment_id, community_id),
      INDEX idx_submission_files_user (user_id, created_at)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_community_library (
      id INT AUTO_INCREMENT PRIMARY KEY,
      community_id INT NOT NULL,
      uploader_id INT NOT NULL,
      title VARCHAR(180) NOT NULL,
      pdf_url TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_library_community_created (community_id, created_at),
      INDEX idx_library_uploader (uploader_id)
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
  const hasCommunityBannerOffset = await hasColumn(dbName, "vine_communities", "banner_offset_y");
  if (!hasCommunityBannerOffset) {
    await db.query("ALTER TABLE vine_communities ADD COLUMN banner_offset_y INT NOT NULL DEFAULT 0");
  }
  const hasPostPermission = await hasColumn(dbName, "vine_communities", "post_permission");
  if (!hasPostPermission) {
    await db.query("ALTER TABLE vine_communities ADD COLUMN post_permission VARCHAR(20) NOT NULL DEFAULT 'mods_only'");
  }
  await db.query("UPDATE vine_communities SET post_permission = 'mods_only'");
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

  await ensureColumnExists(dbName, "vine_community_assignments", "rubric", "TEXT NULL");
  await ensureColumnExists(dbName, "vine_community_assignments", "attachment_url", "TEXT NULL");
  await ensureColumnExists(dbName, "vine_community_assignments", "attachment_name", "VARCHAR(255) NULL");
  await ensureColumnExists(dbName, "vine_community_assignments", "assignment_type", "VARCHAR(20) NOT NULL DEFAULT 'theory'");
  try {
    await db.query(
      "ALTER TABLE vine_community_assignments MODIFY COLUMN points DECIMAL(8,2) NOT NULL DEFAULT 100.00"
    );
  } catch (err) {
    console.warn("Community assignments points type migration skipped:", err?.message || err);
  }
  await ensureColumnExists(dbName, "vine_community_submissions", "status", "VARCHAR(20) NOT NULL DEFAULT 'submitted'");
  await ensureColumnExists(dbName, "vine_community_submissions", "attempt_count", "INT NOT NULL DEFAULT 1");
  await ensureColumnExists(dbName, "vine_community_submissions", "score", "DECIMAL(6,2) NULL");
  await ensureColumnExists(dbName, "vine_community_submissions", "feedback", "TEXT NULL");
  await ensureColumnExists(dbName, "vine_community_submissions", "graded_at", "DATETIME NULL");
  await ensureColumnExists(dbName, "vine_community_submissions", "graded_by", "INT NULL");
  await ensureColumnExists(dbName, "vine_community_submissions", "attachment_url", "TEXT NULL");
  await ensureColumnExists(dbName, "vine_community_submissions", "attachment_name", "VARCHAR(255) NULL");
  await ensureColumnExists(dbName, "vine_community_submissions", "attachment_mime", "VARCHAR(120) NULL");

  const communityIndexes = [
    ["vine_community_members", "idx_comm_members_community_role_user", ["community_id", "role", "user_id"]],
    ["vine_community_sessions", "idx_comm_sessions_community_start_end", ["community_id", "starts_at", "ends_at"]],
    ["vine_community_attendance", "idx_comm_attendance_session_status", ["session_id", "status"]],
    ["vine_community_attendance", "idx_comm_attendance_community_user_status", ["community_id", "user_id", "status"]],
    ["vine_community_assignments", "idx_comm_assignments_community_created", ["community_id", "created_at"]],
    ["vine_community_assignments", "idx_comm_assignments_community_type_due", ["community_id", "assignment_type", "due_at"]],
    ["vine_community_submissions", "idx_comm_submissions_community_assignment_submitted", ["community_id", "assignment_id", "submitted_at"]],
    ["vine_community_submissions", "idx_comm_submissions_user_assignment", ["user_id", "assignment_id"]],
    ["vine_community_submissions", "idx_comm_submissions_community_graded", ["community_id", "graded_at"]],
    ["vine_community_submission_drafts", "idx_comm_submission_drafts_community_assignment_user", ["community_id", "assignment_id", "user_id"]],
    ["vine_community_submission_files", "idx_comm_submission_files_assignment_submission_created", ["assignment_id", "submission_id", "created_at"]],
    ["vine_community_library", "idx_comm_library_community_created_id", ["community_id", "created_at", "id"]],
  ];
  for (const [tableName, indexName, columns] of communityIndexes) {
    try {
      await ensureIndexExists(dbName, tableName, indexName, columns);
    } catch (err) {
      console.warn(`Community index ensure skipped for ${tableName}.${indexName}:`, err?.message || err);
    }
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

let pollSchemaReady = false;
const ensurePollSchema = async () => {
  if (pollSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_polls (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL UNIQUE,
      question VARCHAR(240) NOT NULL,
      expires_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_poll_post (post_id)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_poll_options (
      id INT AUTO_INCREMENT PRIMARY KEY,
      poll_id INT NOT NULL,
      option_text VARCHAR(180) NOT NULL,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_poll_option_poll (poll_id, position)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_poll_votes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      poll_id INT NOT NULL,
      option_id INT NOT NULL,
      user_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_poll_vote_user (poll_id, user_id),
      INDEX idx_poll_vote_poll_option (poll_id, option_id),
      INDEX idx_poll_vote_user (user_id)
    )
  `);
  pollSchemaReady = true;
};

let postReactionSchemaReady = false;
const normalizePostReaction = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["love", "happy", "sad", "care", "like"].includes(normalized)) return normalized;
  return "like";
};

const ensurePostReactionSchema = async () => {
  if (postReactionSchemaReady) return;
  const dbName = await getDbName();
  if (!dbName) return;
  await ensureColumnExists(
    dbName,
    "vine_likes",
    "reaction",
    "VARCHAR(20) NOT NULL DEFAULT 'like'"
  );
  postReactionSchemaReady = true;
};

let commentReactionSchemaReady = false;
const normalizeCommentReaction = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["love", "happy", "sad", "care", "like"].includes(normalized)) return normalized;
  return "like";
};

const ensureCommentReactionSchema = async () => {
  if (commentReactionSchemaReady) return;
  const dbName = await getDbName();
  if (!dbName) return;
  await ensureColumnExists(
    dbName,
    "vine_comment_likes",
    "reaction",
    "VARCHAR(20) NOT NULL DEFAULT 'like'"
  );
  commentReactionSchemaReady = true;
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

  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_status_reactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      status_id INT NOT NULL,
      user_id INT NOT NULL,
      reaction VARCHAR(20) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_status_reaction (status_id, user_id),
      INDEX idx_status_reactions_status (status_id, reaction)
    )
  `);

  await ensureColumnExists(dbName, "vine_statuses", "media_url", "TEXT NULL");
  await ensureColumnExists(dbName, "vine_statuses", "media_type", "VARCHAR(20) NULL");

  statusSchemaReady = true;
};

let newsSchemaReady = false;
const ensureNewsSchema = async () => {
  if (newsSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_news_ingest (
      id INT AUTO_INCREMENT PRIMARY KEY,
      source VARCHAR(80) NOT NULL,
      external_id CHAR(64) NOT NULL,
      title VARCHAR(280) NOT NULL,
      article_url TEXT NOT NULL,
      published_at DATETIME NULL,
      post_id INT NULL,
      ingested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_news_external (external_id),
      INDEX idx_news_ingested (ingested_at),
      INDEX idx_news_source (source, ingested_at)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_news_settings (
      id TINYINT PRIMARY KEY,
      timezone VARCHAR(80) NOT NULL,
      daily_hour TINYINT NOT NULL DEFAULT 12,
      daily_minute TINYINT NOT NULL DEFAULT 0,
      allowed_weekdays VARCHAR(64) NULL,
      updated_by INT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  newsSchemaReady = true;
};

let birthdayBroadcastSchemaReady = false;
const ensureBirthdayBroadcastSchema = async () => {
  if (birthdayBroadcastSchemaReady) return;
  await ensureProfileAboutSchema();
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_birthday_notices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      birthday_user_id INT NOT NULL,
      day_key VARCHAR(10) NOT NULL,
      notified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_vine_birthday_notice_user_day (birthday_user_id, day_key),
      INDEX idx_vine_birthday_notice_day (day_key, notified_at)
    )
  `);
  birthdayBroadcastSchemaReady = true;
};

let birthdayEditSchemaReady = false;
const ensureBirthdayEditSchema = async () => {
  if (birthdayEditSchemaReady) return;
  await ensureProfileAboutSchema();
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_birthday_edit_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      old_date_of_birth DATE NULL,
      new_date_of_birth DATE NOT NULL,
      edited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_vine_birthday_edit_user_recent (user_id, edited_at)
    )
  `);
  birthdayEditSchemaReady = true;
};

let displayNameEditSchemaReady = false;
const ensureDisplayNameEditSchema = async () => {
  if (displayNameEditSchemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS vine_display_name_edit_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      old_display_name VARCHAR(100) NULL,
      new_display_name VARCHAR(100) NOT NULL,
      edited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_vine_display_name_edit_user_recent (user_id, edited_at)
    )
  `);
  displayNameEditSchemaReady = true;
};

const getBirthdayEditState = async (executor, userId) => {
  await ensureBirthdayEditSchema();
  const [rows] = await executor.query(
    `
    SELECT edited_at
    FROM vine_birthday_edit_log
    WHERE user_id = ?
      AND edited_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${BIRTHDAY_EDIT_WINDOW_DAYS} DAY)
    ORDER BY edited_at DESC
    `,
    [userId]
  );
  return buildBirthdayEditState(rows);
};

const getDisplayNameEditState = async (executor, userId) => {
  await ensureDisplayNameEditSchema();
  const [rows] = await executor.query(
    `
    SELECT edited_at
    FROM vine_display_name_edit_log
    WHERE user_id = ?
      AND edited_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${BIRTHDAY_EDIT_WINDOW_DAYS} DAY)
    ORDER BY edited_at DESC
    `,
    [userId]
  );
  return buildDisplayNameEditState(rows);
};

const updateUserBirthday = async (executor, userId, rawValue) => {
  await ensureBirthdayEditSchema();
  const validation = validateBirthdayInput(rawValue);
  if (!validation.ok) {
    const err = new Error(validation.message);
    err.statusCode = 400;
    throw err;
  }

  const [[user]] = await executor.query(
    "SELECT date_of_birth FROM vine_users WHERE id = ? LIMIT 1",
    [userId]
  );

  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }

  const currentDate = normalizeBirthdayDateValue(user.date_of_birth);
  if (currentDate === validation.rawDate) {
    return {
      success: true,
      date_of_birth: validation.rawDate,
      changed: false,
      is_initial_set: !currentDate,
      ...await getBirthdayEditState(executor, userId),
    };
  }

  const isInitialSet = !currentDate;
  const currentState = await getBirthdayEditState(executor, userId);
  const isSecondEditAttempt =
    !isInitialSet && Number(currentState.birthday_edits_remaining || 0) === 1;

  if (!isInitialSet && Number(currentState.birthday_edits_remaining || 0) <= 0) {
    const err = new Error(
      currentState.birthday_next_edit_available_at
        ? `You can only change your birthday twice every 365 days. Your next edit opens on ${new Date(
            currentState.birthday_next_edit_available_at
          ).toLocaleDateString()}.`
        : "You can only change your birthday twice every 365 days."
    );
    err.statusCode = 400;
    err.code = "birthday_edit_limit";
    err.details = currentState;
    throw err;
  }

  await executor.query("UPDATE vine_users SET date_of_birth = ? WHERE id = ?", [
    validation.rawDate,
    userId,
  ]);

  if (!isInitialSet) {
    await executor.query(
      `
      INSERT INTO vine_birthday_edit_log (user_id, old_date_of_birth, new_date_of_birth, edited_at)
      VALUES (?, ?, ?, UTC_TIMESTAMP())
      `,
      [userId, currentDate, validation.rawDate]
    );
  }

  return {
    success: true,
    date_of_birth: validation.rawDate,
    changed: true,
    is_initial_set: isInitialSet,
    used_final_birthday_edit: isSecondEditAttempt,
    ...await getBirthdayEditState(executor, userId),
  };
};

const updateUserDisplayName = async (executor, userId, rawValue) => {
  await ensureDisplayNameEditSchema();
  const nextDisplayName = normalizeDisplayNameInput(rawValue);
  if (!nextDisplayName) {
    const err = new Error("Display name cannot be empty");
    err.statusCode = 400;
    throw err;
  }

  const [[user]] = await executor.query(
    "SELECT display_name, username FROM vine_users WHERE id = ? LIMIT 1",
    [userId]
  );

  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }

  const currentDisplayName = normalizeDisplayNameInput(user.display_name || "");
  if (currentDisplayName === nextDisplayName) {
    return {
      success: true,
      display_name: nextDisplayName,
      changed: false,
      is_initial_set: !currentDisplayName,
      ...await getDisplayNameEditState(executor, userId),
    };
  }

  const isInitialSet = !currentDisplayName;
  const currentState = await getDisplayNameEditState(executor, userId);
  const isSecondEditAttempt =
    !isInitialSet && Number(currentState.display_name_edits_remaining || 0) === 1;

  if (!isInitialSet && Number(currentState.display_name_edits_remaining || 0) <= 0) {
    const err = new Error(
      currentState.display_name_next_edit_available_at
        ? `You can only change your display name twice every 365 days. Your next edit opens on ${new Date(
            currentState.display_name_next_edit_available_at
          ).toLocaleDateString()}.`
        : "You can only change your display name twice every 365 days."
    );
    err.statusCode = 400;
    err.code = "display_name_edit_limit";
    err.details = currentState;
    throw err;
  }

  await executor.query("UPDATE vine_users SET display_name = ? WHERE id = ?", [
    nextDisplayName,
    userId,
  ]);

  if (!isInitialSet) {
    await executor.query(
      `
      INSERT INTO vine_display_name_edit_log (user_id, old_display_name, new_display_name, edited_at)
      VALUES (?, ?, ?, UTC_TIMESTAMP())
      `,
      [userId, currentDisplayName || null, nextDisplayName]
    );
  }

  return {
    success: true,
    display_name: nextDisplayName,
    changed: true,
    is_initial_set: isInitialSet,
    used_final_display_name_edit: isSecondEditAttempt,
    ...await getDisplayNameEditState(executor, userId),
  };
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
};

const stripHtml = (raw) => String(raw || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const pickFirst = (xml, regex) => {
  const m = String(xml || "").match(regex);
  return m?.[1] ? String(m[1]).trim() : "";
};

const parseRssItems = (xml, source) => {
  const xmlText = String(xml || "");
  const items = xmlText.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const rssRows = items
    .map((item) => {
      const title = pickFirst(item, /<title>([\s\S]*?)<\/title>/i).replace(/<!\[CDATA\[|\]\]>/g, "");
      const url = pickFirst(item, /<link>([\s\S]*?)<\/link>/i).replace(/<!\[CDATA\[|\]\]>/g, "");
      const pub = pickFirst(item, /<pubDate>([\s\S]*?)<\/pubDate>/i);
      const descriptionRaw = pickFirst(item, /<description>([\s\S]*?)<\/description>/i).replace(/<!\[CDATA\[|\]\]>/g, "");
      const description = stripHtml(descriptionRaw);
      const mediaUrl =
        pickFirst(item, /<media:content[^>]*url=["']([^"']+)["']/i) ||
        pickFirst(item, /<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image\//i);
      if (!title || !url) return null;
      return {
        source,
        title: title.slice(0, 280),
        url,
        publishedAt: toDateOrNull(pub),
        summary: description.slice(0, 240),
        image: mediaUrl || null,
      };
    })
    .filter(Boolean);

  const entries = xmlText.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  const atomRows = entries
    .map((entry) => {
      const title = pickFirst(entry, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(/<!\[CDATA\[|\]\]>/g, "");
      const url =
        pickFirst(entry, /<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i) ||
        pickFirst(entry, /<id>([\s\S]*?)<\/id>/i);
      const pub =
        pickFirst(entry, /<published[^>]*>([\s\S]*?)<\/published>/i) ||
        pickFirst(entry, /<updated[^>]*>([\s\S]*?)<\/updated>/i);
      const summaryRaw =
        pickFirst(entry, /<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
        pickFirst(entry, /<content[^>]*>([\s\S]*?)<\/content>/i);
      const description = stripHtml(summaryRaw);
      const mediaUrl =
        pickFirst(entry, /<media:content[^>]*url=["']([^"']+)["']/i) ||
        pickFirst(entry, /<link[^>]*rel=["']enclosure["'][^>]*href=["']([^"']+)["']/i);
      if (!title || !url) return null;
      return {
        source,
        title: title.slice(0, 280),
        url: url.trim(),
        publishedAt: toDateOrNull(pub),
        summary: description.slice(0, 240),
        image: mediaUrl || null,
      };
    })
    .filter(Boolean);

  return [...rssRows, ...atomRows];
};

const fetchRssNews = async () => {
  const rssFeeds = (process.env.NEWS_RSS_FEEDS || "").trim();
  const feeds = rssFeeds
    ? rssFeeds.split(",").map((s) => s.trim()).filter(Boolean)
    : [
        "https://feeds.bbci.co.uk/news/world/rss.xml",
        "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
        "https://www.reuters.com/world/rss",
      ];
  const all = [];
  for (const feed of feeds.slice(0, 20)) {
    const startedAt = new Date().toISOString();
    const prev = newsFeedRuntimeStats.get(feed);
    updateNewsFeedStat(feed, {
      attempts: Number(prev?.attempts || 0) + 1,
      last_checked_at: startedAt,
      last_error: null,
    });
    try {
      const res = await fetch(feed, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      if (!res.ok) {
        const cur = newsFeedRuntimeStats.get(feed);
        updateNewsFeedStat(feed, {
          last_status: Number(res.status || 0),
          failures: Number(cur?.failures || 0) + 1,
          consecutive_failures: Number(cur?.consecutive_failures || 0) + 1,
          last_error: `HTTP ${res.status}`,
          last_parsed_items: 0,
        });
        continue;
      }
      const xml = await res.text();
      const parsed = parseRssItems(xml, new URL(feed).hostname.replace(/^www\./, ""));
      if (parsed.length === 0) {
        // Some publishers block non-browser clients on first pass; retry once.
        const retry = await fetch(feed, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        });
        if (retry.ok) {
          const retryXml = await retry.text();
          const retryParsed = parseRssItems(retryXml, new URL(feed).hostname.replace(/^www\./, ""));
          if (retryParsed.length > 0) {
            all.push(...retryParsed);
            const cur = newsFeedRuntimeStats.get(feed);
            updateNewsFeedStat(feed, {
              last_status: Number(retry.status || 200),
              successes: Number(cur?.successes || 0) + 1,
              consecutive_failures: 0,
              last_ok_at: new Date().toISOString(),
              last_error: null,
              last_parsed_items: retryParsed.length,
            });
            continue;
          }
        }
      }
      all.push(...parsed);
      const cur = newsFeedRuntimeStats.get(feed);
      updateNewsFeedStat(feed, {
        last_status: Number(res.status || 200),
        successes: Number(cur?.successes || 0) + 1,
        consecutive_failures: 0,
        last_ok_at: new Date().toISOString(),
        last_error: null,
        last_parsed_items: parsed.length,
      });
    } catch (err) {
      const cur = newsFeedRuntimeStats.get(feed);
      updateNewsFeedStat(feed, {
        failures: Number(cur?.failures || 0) + 1,
        consecutive_failures: Number(cur?.consecutive_failures || 0) + 1,
        last_error: String(err?.message || "Fetch failed"),
        last_parsed_items: 0,
      });
    }
  }
  return all;
};

const fetchGdeltNews = async () => {
  const query = encodeURIComponent('(news OR "breaking news") lang:English');
  const endpoint = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=ArtList&maxrecords=25&format=json&sort=datedesc`;
  try {
    const res = await fetch(endpoint, { headers: { "User-Agent": "VineNewsBot/1.0" } });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const rows = Array.isArray(data?.articles) ? data.articles : [];
    return rows
      .map((a) => {
        const title = String(a?.title || "").trim();
        const url = String(a?.url || "").trim();
        if (!title || !url) return null;
        return {
          source: String(a?.sourceCommonName || a?.domain || "gdelt").slice(0, 80),
          title: title.slice(0, 280),
          url,
          publishedAt: toDateOrNull(a?.seendate || a?.socialimage || a?.date),
          summary: stripHtml(a?.snippet || "").slice(0, 240),
          image: String(a?.socialimage || "").trim() || null,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const getOrCreateNewsBotUserId = async () => {
  const botUsername = (process.env.VINE_NEWS_BOT_USERNAME || "vine_news").trim().toLowerCase();
  const [[existing]] = await db.query("SELECT id FROM vine_users WHERE username = ? LIMIT 1", [botUsername]);
  if (existing?.id) return Number(existing.id);
  const hash = await bcrypt.hash(`vine-news-${Date.now()}`, 10);
  const [inserted] = await db.query(
    `
    INSERT INTO vine_users (username, display_name, password_hash, bio, is_verified, is_admin)
    VALUES (?, 'Vine News', ?, 'Automated news feed (RSS + GDELT).', 1, 0)
    `,
    [botUsername, hash]
  );
  return Number(inserted.insertId);
};

let newsIngestInFlight = false;
let lastNewsIngestAt = 0;
let lastNewsIngestDayKey = "";
const NEWS_INGEST_TIMEZONE =
  String(process.env.NEWS_INGEST_TIMEZONE || "Africa/Kampala").trim() ||
  "Africa/Kampala";
const NEWS_WEEKDAY_INDEX = new Map([
  ["sun", 0],
  ["sunday", 0],
  ["mon", 1],
  ["monday", 1],
  ["tue", 2],
  ["tues", 2],
  ["tuesday", 2],
  ["wed", 3],
  ["wednesday", 3],
  ["thu", 4],
  ["thur", 4],
  ["thurs", 4],
  ["thursday", 4],
  ["fri", 5],
  ["friday", 5],
  ["sat", 6],
  ["saturday", 6],
]);
const parseNewsAllowedWeekdays = (value) =>
  Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((entry) => String(entry || "").trim().toLowerCase())
        .map((entry) =>
          /^\d+$/.test(entry) ? Number.parseInt(entry, 10) : NEWS_WEEKDAY_INDEX.get(entry)
        )
        .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6)
    )
  ).sort((a, b) => a - b);

const DEFAULT_NEWS_ALLOWED_WEEKDAYS = parseNewsAllowedWeekdays(
  process.env.NEWS_ALLOWED_WEEKDAYS || ""
);
const NEWS_DAILY_HOUR = Math.min(
  23,
  Math.max(0, Number.parseInt(process.env.NEWS_DAILY_HOUR || "12", 10) || 12)
);
const NEWS_DAILY_MINUTE = Math.min(
  59,
  Math.max(0, Number.parseInt(process.env.NEWS_DAILY_MINUTE || "0", 10) || 0)
);
const NEWS_BACKGROUND_TICK_MS = 5 * 60 * 1000;
const SCHEDULED_POST_SWEEP_MS = 60 * 1000;
const BIRTHDAY_NOTIFICATION_TIMEZONE =
  String(process.env.VINE_BIRTHDAY_TIMEZONE || NEWS_INGEST_TIMEZONE).trim() ||
  NEWS_INGEST_TIMEZONE;
const BIRTHDAY_BACKGROUND_TICK_MS = 15 * 60 * 1000;
const newsFeedRuntimeStats = new Map();
let newsBootIngestScheduled = false;
let scheduledPostSweepInFlight = false;
let lastScheduledPostSweepAt = 0;
let newsSettingsCache = null;
let newsSettingsLoadedAt = 0;
const NEWS_SETTINGS_CACHE_MS = 60 * 1000;

const normalizeNewsScheduleSettings = (value = {}) => {
  const dailyHour = Math.min(
    23,
    Math.max(0, Number.parseInt(value.daily_hour ?? value.dailyHour ?? NEWS_DAILY_HOUR, 10) || NEWS_DAILY_HOUR)
  );
  const dailyMinute = Math.min(
    59,
    Math.max(
      0,
      Number.parseInt(value.daily_minute ?? value.dailyMinute ?? NEWS_DAILY_MINUTE, 10) || NEWS_DAILY_MINUTE
    )
  );
  const timezone = String(value.timezone || NEWS_INGEST_TIMEZONE).trim() || NEWS_INGEST_TIMEZONE;
  const allowedWeekdays = parseNewsAllowedWeekdays(
    Array.isArray(value.allowed_weekdays ?? value.allowedWeekdays)
      ? (value.allowed_weekdays ?? value.allowedWeekdays).join(",")
      : value.allowed_weekdays ?? value.allowedWeekdays ?? DEFAULT_NEWS_ALLOWED_WEEKDAYS.join(",")
  );
  return {
    timezone,
    daily_hour: dailyHour,
    daily_minute: dailyMinute,
    allowed_weekdays: allowedWeekdays,
  };
};

const getNewsScheduleSettings = async ({ force = false } = {}) => {
  await ensureNewsSchema();
  if (!force && newsSettingsCache && Date.now() - newsSettingsLoadedAt < NEWS_SETTINGS_CACHE_MS) {
    return newsSettingsCache;
  }
  const [[row]] = await db.query(
    `
    SELECT timezone, daily_hour, daily_minute, allowed_weekdays
    FROM vine_news_settings
    WHERE id = 1
    LIMIT 1
    `
  );
  const next = normalizeNewsScheduleSettings(row || {});
  newsSettingsCache = next;
  newsSettingsLoadedAt = Date.now();
  return next;
};

const saveNewsScheduleSettings = async (payload = {}, updatedBy = null) => {
  await ensureNewsSchema();
  const current = await getNewsScheduleSettings({ force: true });
  const next = normalizeNewsScheduleSettings({ ...current, ...payload });
  await db.query(
    `
    INSERT INTO vine_news_settings
      (id, timezone, daily_hour, daily_minute, allowed_weekdays, updated_by, updated_at)
    VALUES
      (1, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      timezone = VALUES(timezone),
      daily_hour = VALUES(daily_hour),
      daily_minute = VALUES(daily_minute),
      allowed_weekdays = VALUES(allowed_weekdays),
      updated_by = VALUES(updated_by),
      updated_at = NOW()
    `,
    [
      next.timezone,
      next.daily_hour,
      next.daily_minute,
      next.allowed_weekdays.join(","),
      updatedBy ? Number(updatedBy) : null,
    ]
  );
  newsSettingsCache = next;
  newsSettingsLoadedAt = Date.now();
  return next;
};

const getNewsZonedParts = (timeZone = NEWS_INGEST_TIMEZONE) => {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const year = Number(map.year || 0);
  const month = Number(map.month || 0);
  const day = Number(map.day || 0);
  const hour = Number(map.hour || 0);
  const minute = Number(map.minute || 0);
  const weekdayLabel = String(map.weekday || "").trim().toLowerCase();
  const weekdayIndex = NEWS_WEEKDAY_INDEX.get(weekdayLabel);
  return {
    year,
    month,
    day,
    dayKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
      2,
      "0"
    )}`,
    minutesOfDay: hour * 60 + minute,
    weekdayIndex: Number.isInteger(weekdayIndex) ? weekdayIndex : null,
    weekdayLabel,
  };
};

const getNewsDueWindow = async () => {
  const settings = await getNewsScheduleSettings();
  const now = getNewsZonedParts(settings.timezone);
  const targetMinutes = settings.daily_hour * 60 + settings.daily_minute;
  const dayAllowed =
    settings.allowed_weekdays.length === 0 ||
    (Number.isInteger(now.weekdayIndex) && settings.allowed_weekdays.includes(now.weekdayIndex));
  const due =
    dayAllowed &&
    now.minutesOfDay >= targetMinutes &&
    lastNewsIngestDayKey !== now.dayKey;
  return { ...now, targetMinutes, dayAllowed, due, settings };
};

const isBirthdayTodayForZonedParts = (dateOfBirth, zonedParts) => {
  const monthDay = extractBirthdayMonthDay(dateOfBirth);
  if (!monthDay || !zonedParts?.year || !zonedParts?.month || !zonedParts?.day) {
    return false;
  }
  const normalizedDate = buildBirthdayDateForYear(zonedParts.year, monthDay.month, monthDay.day);
  if (!normalizedDate) return false;
  return (
    normalizedDate.getMonth() + 1 === Number(zonedParts.month) &&
    normalizedDate.getDate() === Number(zonedParts.day)
  );
};

const updateNewsFeedStat = (feed, patch = {}) => {
  const key = String(feed || "").trim();
  if (!key) return;
  const prev = newsFeedRuntimeStats.get(key) || {
    feed: key,
    attempts: 0,
    successes: 0,
    failures: 0,
    consecutive_failures: 0,
    last_status: null,
    last_ok_at: null,
    last_error: null,
    last_checked_at: null,
    last_parsed_items: 0,
  };
  const next = { ...prev, ...patch };
  newsFeedRuntimeStats.set(key, next);
};

const ingestExternalNews = async () => {
  await ensureNewsSchema();
  const botUserId = await getOrCreateNewsBotUserId();
  const [rss, gdelt] = await Promise.all([fetchRssNews(), fetchGdeltNews()]);
  const merged = [...rss, ...gdelt]
    .filter((row) => row?.url && row?.title)
    .slice(0, 60);

  for (const item of merged) {
    const externalId = crypto
      .createHash("sha256")
      .update(String(item.url).trim().toLowerCase())
      .digest("hex");
    const [[exists]] = await db.query(
      "SELECT id FROM vine_news_ingest WHERE external_id = ? LIMIT 1",
      [externalId]
    );
    if (exists) continue;

    const textParts = [
      item.title,
      item.summary ? item.summary : "",
      item.url,
      "#news",
    ].filter(Boolean);
    const content = textParts.join("\n\n").slice(0, 1900);
    const imageUrl = item.image ? JSON.stringify([item.image]) : null;
    let linkPreview = {
      url: item.url,
      title: item.title,
      description: item.summary || null,
      image: item.image || null,
      site_name: item.source || null,
      domain: (() => {
        try {
          return new URL(item.url).hostname.replace(/^www\./i, "");
        } catch {
          return null;
        }
      })(),
    };
    if (!linkPreview.description || !linkPreview.image) {
      const scraped = await fetchLinkPreview(item.url);
      if (scraped) {
        linkPreview = {
          ...linkPreview,
          title: scraped.title || linkPreview.title,
          description: scraped.description || linkPreview.description,
          image: scraped.image || linkPreview.image,
          site_name: scraped.site_name || linkPreview.site_name,
          domain: scraped.domain || linkPreview.domain,
        };
      }
    }

    const [postResult] = await db.query(
      `
      INSERT INTO vine_posts (user_id, content, image_url, link_preview, created_at)
      VALUES (?, ?, ?, ?, ?)
      `,
      [botUserId, content, imageUrl, JSON.stringify(linkPreview), item.publishedAt || new Date()]
    );

    await db.query(
      `
      INSERT INTO vine_news_ingest (source, external_id, title, article_url, published_at, post_id)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [item.source || "news", externalId, item.title, item.url, item.publishedAt, postResult.insertId]
    );
  }
};

const triggerNewsIngestIfDue = async () => {
  if (newsIngestInFlight) return;
  const dueWindow = await getNewsDueWindow();
  if (!dueWindow.due) return;
  newsIngestInFlight = true;
  lastNewsIngestAt = Date.now();
  lastNewsIngestDayKey = dueWindow.dayKey;
  ingestExternalNews()
    .catch((err) => console.error("News ingest error:", err?.message || err))
    .finally(() => {
      newsIngestInFlight = false;
      lastNewsIngestAt = Date.now();
    });
};

let birthdayBroadcastInFlight = false;
const triggerBirthdayNotificationsIfDue = async () => {
  if (birthdayBroadcastInFlight) return;
  birthdayBroadcastInFlight = true;

  try {
    await ensureBirthdayBroadcastSchema();
    const todayParts = getNewsZonedParts(BIRTHDAY_NOTIFICATION_TIMEZONE);
    const [birthdayUsers] = await db.query(
      `
      SELECT id, username, display_name, badge_type, date_of_birth
      FROM vine_users
      WHERE date_of_birth IS NOT NULL
        AND deactivated_at IS NULL
        AND LOWER(COALESCE(username, '')) NOT IN ('vine news', 'vine_news')
        AND LOWER(COALESCE(badge_type, '')) <> 'news'
      `
    );

    const todaysCelebrants = (Array.isArray(birthdayUsers) ? birthdayUsers : []).filter((row) =>
      isBirthdayTodayForZonedParts(row.date_of_birth, todayParts)
    );

    for (const celebrant of todaysCelebrants) {
      const birthdayUserId = Number(celebrant.id || 0);
      if (!birthdayUserId) continue;

      const [claim] = await db.query(
        `
        INSERT IGNORE INTO vine_birthday_notices (birthday_user_id, day_key, notified_at)
        VALUES (?, ?, NOW())
        `,
        [birthdayUserId, todayParts.dayKey]
      );
      if (!Number(claim?.affectedRows || 0)) continue;

      const [recipientRows] = await db.query(
        `
        SELECT id
        FROM vine_users
        WHERE id != ?
          AND deactivated_at IS NULL
          AND LOWER(COALESCE(username, '')) NOT IN ('vine news', 'vine_news')
          AND LOWER(COALESCE(badge_type, '')) <> 'news'
        `,
        [birthdayUserId]
      );
      const recipientIds = (Array.isArray(recipientRows) ? recipientRows : [])
        .map((row) => Number(row.id || 0))
        .filter(Boolean);
      if (!recipientIds.length) continue;

      await notifyUsersBulk({
        userIds: recipientIds,
        actorId: birthdayUserId,
        type: "birthday",
        meta: {
          birthday_user_id: birthdayUserId,
          birthday_day_key: todayParts.dayKey,
          birthday_prompt: "Send them a birthday message",
        },
      });
    }
  } catch (err) {
    console.error("Birthday notification sweep error:", err?.message || err);
  } finally {
    birthdayBroadcastInFlight = false;
  }
};

const scheduleNewsIngestOnBoot = () => {
  if (newsBootIngestScheduled) return;
  newsBootIngestScheduled = true;
  setTimeout(() => {
    void triggerNewsIngestIfDue();
  }, 12_000);
  const ticker = setInterval(() => {
    void triggerNewsIngestIfDue();
  }, NEWS_BACKGROUND_TICK_MS);
  if (typeof ticker.unref === "function") ticker.unref();
};

scheduleNewsIngestOnBoot();

setTimeout(() => {
  void triggerScheduledPostPublishIfDue({ force: true });
}, 18_000);
const scheduledPostTicker = setInterval(() => {
  void triggerScheduledPostPublishIfDue();
}, SCHEDULED_POST_SWEEP_MS);
if (typeof scheduledPostTicker.unref === "function") scheduledPostTicker.unref();

setTimeout(() => {
  void triggerBirthdayNotificationsIfDue();
}, 20_000);
const birthdayTicker = setInterval(() => {
  void triggerBirthdayNotificationsIfDue();
}, BIRTHDAY_BACKGROUND_TICK_MS);
if (typeof birthdayTicker.unref === "function") birthdayTicker.unref();

setTimeout(() => {
  sweepExpiredAccountDeletions().catch((err) =>
    console.error("Account deletion sweep error:", err?.message || err)
  );
}, 15_000);
const accountDeletionTicker = setInterval(() => {
  sweepExpiredAccountDeletions().catch((err) =>
    console.error("Account deletion sweep error:", err?.message || err)
  );
}, ACCOUNT_DELETE_SWEEP_MS);
if (typeof accountDeletionTicker.unref === "function") accountDeletionTicker.unref();

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

const isPdfFile = (file) => {
  const type = String(file?.mimetype || "").toLowerCase();
  const name = String(file?.originalname || "").toLowerCase();
  return type === "application/pdf" || /\.pdf$/i.test(name);
};

const isPracticalSubmissionFile = (file) => {
  const type = String(file?.mimetype || "").toLowerCase();
  const name = String(file?.originalname || "").toLowerCase();
  const allowedByExt = /\.(ppt|pptx|xls|xlsx|doc|docx|mdb|accdb|pub|pdf)$/i.test(name);
  const allowedMimes = new Set([
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/x-msaccess",
    "application/msaccess",
    "application/vnd.ms-access",
    "application/vnd.ms-publisher",
    "application/pdf",
  ]);
  return allowedByExt || allowedMimes.has(type);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asyncMapLimit = async (items, limit, mapper) => {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(null).map(async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      out[idx] = await mapper(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
};

const shouldRetryCloudinaryUpload = (err) => {
  const name = String(err?.name || "").toLowerCase();
  const code = Number(err?.http_code || 0);
  return name.includes("timeout") || code === 499 || code === 500 || code === 503;
};

const inferExtAndMime = (options = {}) => {
  const format = String(options?.format || "").trim().toLowerCase();
  const providedMime = String(options?.content_type || options?.mime_type || "").trim().toLowerCase();
  const resourceType = String(options?.resource_type || "image").toLowerCase();
  if (format) {
    if (format === "pdf") return { ext: "pdf", mime: providedMime || "application/pdf" };
    if (format === "webp") return { ext: "webp", mime: providedMime || "image/webp" };
    if (format === "png") return { ext: "png", mime: providedMime || "image/png" };
    if (format === "jpg" || format === "jpeg")
      return { ext: "jpg", mime: providedMime || "image/jpeg" };
    return { ext: format, mime: providedMime || "application/octet-stream" };
  }
  if (resourceType === "video") return { ext: "mp4", mime: providedMime || "video/mp4" };
  if (resourceType === "raw") return { ext: "bin", mime: providedMime || "application/octet-stream" };
  return { ext: "jpg", mime: providedMime || "image/jpeg" };
};

const buildR2ObjectKey = (options = {}) => {
  const folder = String(options?.folder || "vine").replace(/^\/+|\/+$/g, "");
  const publicIdRaw = String(options?.public_id || "").trim();
  const { ext } = inferExtAndMime(options);
  const seed = `${Date.now()}-${crypto.randomUUID()}`;
  const publicIdBase = publicIdRaw
    ? publicIdRaw.replace(/^\/+|\/+$/g, "").replace(/\.[a-z0-9]+$/i, "")
    : seed;
  return `${folder}/${publicIdBase}.${ext}`;
};

const uploadBufferToR2 = async (buffer, options = {}) => {
  if (!r2Client || !r2Ready) {
    throw new Error("R2 is not configured");
  }
  const key = buildR2ObjectKey(options);
  const { mime } = inferExtAndMime(options);
  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mime,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  const url = `${R2_PUBLIC_BASE_URL}/${key}`;
  return {
    secure_url: url,
    url,
    public_id: key,
    provider: "r2",
  };
};

const uploadBufferToCloudinaryOnce = (buffer, options = {}) =>
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

const uploadBufferToCloudinary = async (buffer, options = {}) => {
  if (USE_R2_UPLOADS && r2Ready) {
    return uploadBufferToR2(buffer, options);
  }
  let attempt = 0;
  let lastErr = null;
  while (attempt < 3) {
    try {
      return await uploadBufferToCloudinaryOnce(buffer, options);
    } catch (err) {
      lastErr = err;
      attempt += 1;
      if (attempt >= 3 || !shouldRetryCloudinaryUpload(err)) break;
      await sleep(500 * attempt);
    }
  }
  throw lastErr;
};

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
    emitVineStatusUpdated({ type: "created", statusId: result.insertId, userId });
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
    await ensureVinePerformanceSchema();
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
    await ensureVinePerformanceSchema();
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
        ) AS seen_by_viewer,
        (
          SELECT sr.reaction
          FROM vine_status_reactions sr
          WHERE sr.status_id = s.id AND sr.user_id = ?
          LIMIT 1
        ) AS viewer_reaction,
        (SELECT COUNT(*) FROM vine_status_reactions sr WHERE sr.status_id = s.id AND sr.reaction = 'like') AS reaction_like_count,
        (SELECT COUNT(*) FROM vine_status_reactions sr WHERE sr.status_id = s.id AND sr.reaction = 'love') AS reaction_love_count,
        (SELECT COUNT(*) FROM vine_status_reactions sr WHERE sr.status_id = s.id AND sr.reaction = 'laugh') AS reaction_laugh_count,
        (SELECT COUNT(*) FROM vine_status_reactions sr WHERE sr.status_id = s.id AND sr.reaction = 'sad') AS reaction_sad_count,
        (SELECT COUNT(*) FROM vine_status_reactions sr WHERE sr.status_id = s.id AND sr.reaction = 'fire') AS reaction_fire_count
      FROM vine_statuses s
      WHERE s.user_id = ?
        AND s.is_deleted = 0
        AND s.expires_at > NOW()
      ORDER BY s.created_at ASC
      `,
      [viewerId, viewerId, userId]
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

    const [[statusRow]] = await db.query(
      "SELECT media_url FROM vine_statuses WHERE id = ? AND user_id = ? LIMIT 1",
      [statusId, userId]
    );
    if (!statusRow) {
      return res.status(404).json({ success: false, message: "Status not found" });
    }

    const [result] = await db.query(
      `
      UPDATE vine_statuses
      SET is_deleted = 1, expires_at = NOW()
      WHERE id = ? AND user_id = ?
      LIMIT 1
      `,
      [statusId, userId]
    );

    if (!result?.affectedRows) return res.status(404).json({ success: false, message: "Status not found" });

    if (statusRow.media_url) {
      await deleteCloudinaryByUrl(statusRow.media_url);
    }

    emitVineStatusUpdated({ type: "deleted", statusId, userId });
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
    await ensureVinePerformanceSchema();
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

router.post("/statuses/:id/react", requireVineAuth, async (req, res) => {
  try {
    await ensureStatusSchema();
    const statusId = Number(req.params.id);
    const userId = Number(req.user.id);
    const reaction = String(req.body?.reaction || "").trim().toLowerCase();
    const allowed = new Set(["like", "love", "laugh", "sad", "fire"]);
    if (!statusId) return res.status(400).json({ message: "Invalid status id" });
    if (!allowed.has(reaction)) return res.status(400).json({ message: "Invalid reaction" });

    const [[statusRow]] = await db.query(
      `
      SELECT id, user_id
      FROM vine_statuses
      WHERE id = ? AND is_deleted = 0 AND expires_at > NOW()
      LIMIT 1
      `,
      [statusId]
    );
    if (!statusRow) return res.status(404).json({ message: "Status not found" });

    if (await isUserBlocked(statusRow.user_id, userId)) {
      return res.status(403).json({ message: "You have been blocked" });
    }
    if (await isUserBlocked(userId, statusRow.user_id)) {
      return res.status(403).json({ message: "You have blocked this user" });
    }

    const [[existing]] = await db.query(
      "SELECT reaction FROM vine_status_reactions WHERE status_id = ? AND user_id = ? LIMIT 1",
      [statusId, userId]
    );

    let viewerReaction = reaction;
    if (existing && String(existing.reaction || "").toLowerCase() === reaction) {
      await db.query(
        "DELETE FROM vine_status_reactions WHERE status_id = ? AND user_id = ?",
        [statusId, userId]
      );
      viewerReaction = null;
    } else {
      await db.query(
        `
        INSERT INTO vine_status_reactions (status_id, user_id, reaction, created_at, updated_at)
        VALUES (?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE reaction = VALUES(reaction), updated_at = NOW()
        `,
        [statusId, userId, reaction]
      );
    }

    const [countsRows] = await db.query(
      `
      SELECT reaction, COUNT(*) AS total
      FROM vine_status_reactions
      WHERE status_id = ?
      GROUP BY reaction
      `,
      [statusId]
    );
    const counts = { like: 0, love: 0, laugh: 0, sad: 0, fire: 0 };
    countsRows.forEach((r) => {
      const key = String(r.reaction || "").toLowerCase();
      if (counts[key] !== undefined) counts[key] = Number(r.total || 0);
    });

    res.json({ success: true, viewer_reaction: viewerReaction, counts });
  } catch (err) {
    console.error("Status react error:", err);
    res.status(500).json({ message: "Failed to react" });
  }
});

router.post("/statuses/:id/reply", requireVineAuth, async (req, res) => {
  try {
    await ensureStatusSchema();
    const statusId = Number(req.params.id);
    const senderId = Number(req.user.id);
    const text = String(req.body?.text || "").trim();
    if (!statusId) return res.status(400).json({ message: "Invalid status id" });
    if (!text) return res.status(400).json({ message: "Reply cannot be empty" });
    if (text.length > 1000) return res.status(400).json({ message: "Reply is too long" });

    const [[statusRow]] = await db.query(
      `
      SELECT s.id, s.user_id, u.username, u.display_name
      FROM vine_statuses s
      JOIN vine_users u ON u.id = s.user_id
      WHERE s.id = ? AND s.is_deleted = 0 AND s.expires_at > NOW()
      LIMIT 1
      `,
      [statusId]
    );
    if (!statusRow) return res.status(404).json({ message: "Status not found" });
    if (Number(statusRow.user_id) === senderId) {
      return res.status(400).json({ message: "Cannot reply to your own status" });
    }

    const receiverId = Number(statusRow.user_id);
    if (await isUserBlocked(receiverId, senderId)) {
      return res.status(403).json({ message: "You have been blocked" });
    }
    if (await isUserBlocked(senderId, receiverId)) {
      return res.status(403).json({ message: "You have blocked this user" });
    }
    if (await isUserMuted(receiverId, senderId)) {
      return res.status(403).json({ message: "User has muted you" });
    }

    let conversationId = null;
    let user1Id = senderId;
    let user2Id = receiverId;
    const [existingConvo] = await db.query(
      `
      SELECT id, user1_id, user2_id
      FROM vine_conversations
      WHERE (user1_id = ? AND user2_id = ?)
         OR (user1_id = ? AND user2_id = ?)
      LIMIT 1
      `,
      [senderId, receiverId, receiverId, senderId]
    );
    if (existingConvo.length) {
      conversationId = Number(existingConvo[0].id);
      user1Id = Number(existingConvo[0].user1_id);
      user2Id = Number(existingConvo[0].user2_id);
    } else {
      const [createdConvo] = await db.query(
        "INSERT INTO vine_conversations (user1_id, user2_id) VALUES (?, ?)",
        [senderId, receiverId]
      );
      conversationId = Number(createdConvo.insertId);
      user1Id = senderId;
      user2Id = receiverId;
    }

    const dmContent = `[Status reply] ${text}`;
    const [insertedMsg] = await db.query(
      "INSERT INTO vine_messages (conversation_id, sender_id, content) VALUES (?, ?, ?)",
      [conversationId, senderId, dmContent]
    );
    await db.query(
      "DELETE FROM vine_conversation_deletes WHERE conversation_id = ? AND user_id IN (?, ?)",
      [conversationId, senderId, receiverId]
    );

    const [[fullMessage]] = await db.query(
      `
      SELECT
        m.id,
        m.conversation_id,
        m.sender_id,
        m.content,
        m.created_at,
        u.username,
        u.avatar_url,
        u.is_verified
      FROM vine_messages m
      JOIN vine_users u ON u.id = m.sender_id
      WHERE m.id = ?
      LIMIT 1
      `,
      [insertedMsg.insertId]
    );

    io.to(`conversation-${conversationId}`).emit("dm_received", fullMessage);
    io.to(`user-${user1Id}`).emit("dm_received", fullMessage);
    io.to(`user-${user2Id}`).emit("dm_received", fullMessage);
    io.to(`user-${user1Id}`).emit("inbox_updated");
    io.to(`user-${user2Id}`).emit("inbox_updated");
    io.to(`user-${user2Id}`).emit("notification");

    res.json({ success: true, conversationId, message: fullMessage });
  } catch (err) {
    console.error("Status reply error:", err);
    res.status(500).json({ message: "Failed to send status reply" });
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
  const mime = String(file.mimetype || "").toLowerCase();
  if (mime.startsWith("image/")) {
    try {
      const buffer = await sharp(file.buffer)
        .rotate()
        .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer();
      return { buffer, mimetype: "image/jpeg" };
    } catch {
      return { buffer: file.buffer, mimetype: file.mimetype || "image/jpeg" };
    }
  }
  return { buffer: file.buffer, mimetype: file.mimetype || "image/jpeg" };
};

const buildCommunityAvatarBuffer = async (buffer) => {
  const out = await sharp(buffer)
    .resize(400, 400, { fit: "cover", position: sharp.strategy.attention })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { buffer: out, mimetype: "image/jpeg" };
};

const buildCommunityBannerBuffer = async (buffer) => {
  const out = await sharp(buffer)
    .resize(1500, 500, { fit: "cover", position: sharp.strategy.attention })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { buffer: out, mimetype: "image/jpeg" };
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

const resolveAtAllTargetIds = async ({ actorId, postId }) => {
  if (!actorId) return [];
  let communityId = null;
  if (postId) {
    const [[postRow]] = await db.query(
      "SELECT community_id FROM vine_posts WHERE id = ? LIMIT 1",
      [postId]
    );
    communityId = postRow?.community_id ?? null;
  }

  if (communityId) {
    const [communityMembers] = await db.query(
      "SELECT user_id FROM vine_community_members WHERE community_id = ?",
      [communityId]
    );
    return communityMembers.map((m) => Number(m.user_id)).filter((id) => Number.isFinite(id));
  }

  const [followers] = await db.query(
    "SELECT follower_id AS user_id FROM vine_follows WHERE following_id = ?",
    [actorId]
  );
  return followers.map((f) => Number(f.user_id)).filter((id) => Number.isFinite(id));
};

const notifyMentions = async ({ mentions, actorId, postId, commentId, type }) => {
  if (!mentions?.length) return;
  await ensureAdvancedSettingsSchema();
  const mentionSet = new Set((mentions || []).map((m) => String(m || "").toLowerCase()).filter(Boolean));
  const hasAtAll = mentionSet.has("all");
  mentionSet.delete("all");

  const userRows = [];
  if (mentionSet.size > 0) {
    const explicitMentions = Array.from(mentionSet);
    const placeholders = explicitMentions.map(() => "?").join(", ");
    const [users] = await db.query(
      `SELECT id, username, mentions_privacy, tags_privacy FROM vine_users WHERE LOWER(username) IN (${placeholders})`,
      explicitMentions
    );
    userRows.push(...users);
  }

  if (hasAtAll) {
    const atAllIds = await resolveAtAllTargetIds({ actorId, postId });
    if (atAllIds.length > 0) {
      const placeholders = atAllIds.map(() => "?").join(", ");
      const [allUsers] = await db.query(
        `SELECT id, username, mentions_privacy, tags_privacy FROM vine_users WHERE id IN (${placeholders})`,
        atAllIds
      );
      userRows.push(...allUsers);
    }
  }

  const users = Array.from(
    new Map(userRows.map((u) => [Number(u.id), u])).values()
  );

  for (const user of users) {
    if (Number(user.id) === Number(actorId)) continue;
    if (await isUserBlocked(user.id, actorId)) continue;
    if (await isUserBlocked(actorId, user.id)) continue;
    if (await isMutedBy(user.id, actorId)) continue;
    const privacyValue = String(
      type === "mention_post" || type === "mention_comment"
        ? user.mentions_privacy || "everyone"
        : user.tags_privacy || "everyone"
    ).toLowerCase();
    if (privacyValue === "no_one") continue;
    if (privacyValue === "followers") {
      const [[isFollower]] = await db.query(
        `
        SELECT 1 AS ok
        FROM vine_follows
        WHERE follower_id = ? AND following_id = ?
        LIMIT 1
        `,
        [actorId, user.id]
      );
      if (!isFollower?.ok) continue;
    }

    await db.query(
      `INSERT INTO vine_notifications (user_id, actor_id, type, post_id, comment_id)
       VALUES (?, ?, ?, ?, ?)`,
      [user.id, actorId, type, postId, commentId || null]
    );

    io.to(`user-${user.id}`).emit("notification");
  }
};

const resolveEligiblePostTagUserIds = async ({ mentions, actorId }) => {
  await ensureAdvancedSettingsSchema();
  const explicitMentions = Array.from(
    new Set(
      (mentions || [])
        .map((mention) => String(mention || "").trim().toLowerCase())
        .filter(Boolean)
    )
  ).filter((username) => username !== "all");

  if (!explicitMentions.length) return [];

  const placeholders = explicitMentions.map(() => "?").join(", ");
  const [users] = await db.query(
    `SELECT id, username, tags_privacy FROM vine_users WHERE LOWER(username) IN (${placeholders})`,
    explicitMentions
  );

  const taggedUserIds = [];
  for (const user of users || []) {
    const taggedUserId = Number(user.id || 0);
    if (!taggedUserId || taggedUserId === Number(actorId || 0)) continue;
    if (await isUserBlocked(taggedUserId, actorId)) continue;
    if (await isUserBlocked(actorId, taggedUserId)) continue;
    if (await isMutedBy(taggedUserId, actorId)) continue;

    const privacyValue = String(user.tags_privacy || "everyone").toLowerCase();
    if (privacyValue === "no_one") continue;
    if (privacyValue === "followers") {
      const [[isFollower]] = await db.query(
        `
        SELECT 1 AS ok
        FROM vine_follows
        WHERE follower_id = ? AND following_id = ?
        LIMIT 1
        `,
        [actorId, taggedUserId]
      );
      if (!isFollower?.ok) continue;
    }

    taggedUserIds.push(taggedUserId);
  }

  return taggedUserIds;
};

const syncPostTagLinks = async ({ postId, actorId, content }) => {
  const safePostId = Number(postId || 0);
  if (!safePostId) return;

  await ensurePostTagSchema();
  const mentions = extractMentions(String(content || ""));
  const taggedUserIds = await resolveEligiblePostTagUserIds({ mentions, actorId });

  await db.query("DELETE FROM vine_post_tags WHERE post_id = ?", [safePostId]);

  if (!taggedUserIds.length) return;

  const valuesSql = taggedUserIds.map(() => "(?, ?, NOW())").join(", ");
  const params = [];
  taggedUserIds.forEach((taggedUserId) => {
    params.push(safePostId, taggedUserId);
  });

  await db.query(
    `
    INSERT IGNORE INTO vine_post_tags (post_id, tagged_user_id, created_at)
    VALUES ${valuesSql}
    `,
    params
  );
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
      await ensureAdvancedSettingsSchema();
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
      if (user?.delete_requested_at) {
        const dueAt = getAccountDeletionDueAt(user.delete_requested_at);
        if (dueAt && dueAt <= new Date()) {
          await purgeUserAccount(user.id);
          return res.status(403).json({ message: "Account deletion completed." });
        }
      }
  
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ message: "Invalid login" });
      }
  
      const sessionJti = crypto.randomBytes(16).toString("hex");
      const token = signVineSessionToken(user, sessionJti);

      // Optional analytics event: no-op if table does not exist
      try {
        await db.query(
          "INSERT INTO vine_login_events (user_id, created_at) VALUES (?, NOW())",
          [user.id]
        );
      } catch (_) {}
      try {
        await db.query(
          `
          INSERT INTO vine_user_sessions (user_id, session_jti, device_info, ip_address, created_at, last_seen_at)
          VALUES (?, ?, ?, ?, NOW(), NOW())
          `,
          [user.id, sessionJti, String(req.headers["user-agent"] || "").slice(0, 255), getClientIp(req)]
        );
      } catch (_) {}
  
      res.json({
        token,
        user: buildVineAuthUser(user),
      });
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Login failed" });
    }
  });

router.get("/auth/session", authenticate, async (req, res) => {
  try {
    const [[user]] = await db.query(
      `
      SELECT id, username, display_name, email, is_admin, role, badge_type,
             delete_requested_at, deactivated_at
      FROM vine_users
      WHERE id = ?
      LIMIT 1
      `,
      [req.user.id]
    );

    if (!user) {
      return res.status(401).json({ message: "Session expired" });
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({
      authenticated: true,
      user: buildVineAuthUser(user),
    });
  } catch (err) {
    console.error("Auth session check failed:", err);
    res.status(500).json({ message: "Failed to validate session" });
  }
});

router.post("/auth/renew", authenticate, async (req, res) => {
  try {
    const [[user]] = await db.query(
      `
      SELECT id, username, display_name, email, is_admin, role, badge_type,
             delete_requested_at, deactivated_at
      FROM vine_users
      WHERE id = ?
      LIMIT 1
      `,
      [req.user.id]
    );

    if (!user) {
      return res.status(401).json({ message: "Session expired" });
    }

    const token = signVineSessionToken(user, req.user.jti);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      renewed: true,
      token,
      user: buildVineAuthUser(user),
    });
  } catch (err) {
    console.error("Auth renew failed:", err);
    res.status(500).json({ message: "Failed to renew session" });
  }
});

router.post("/auth/activity", authenticate, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      activity_touched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Auth activity touch failed:", err);
    res.status(500).json({ message: "Failed to keep session active" });
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
    if (req.user?.jti) {
      const [[session]] = await db.query(
        "SELECT revoked_at, last_seen_at FROM vine_user_sessions WHERE user_id = ? AND session_jti = ? LIMIT 1",
        [req.user.id, req.user.jti]
      );
      if (!session || session.revoked_at) {
        return res.status(401).json({ message: "Session expired" });
      }
      const lastSeenAt = new Date(session.last_seen_at || 0).getTime();
      if (!lastSeenAt || Date.now() - lastSeenAt > SESSION_IDLE_MS) {
        await db.query(
          "UPDATE vine_user_sessions SET revoked_at = NOW() WHERE user_id = ? AND session_jti = ? AND revoked_at IS NULL",
          [req.user.id, req.user.jti]
        ).catch(() => {});
        return res.status(401).json({ message: "Session expired" });
      }
    }
    const [[userRow]] = await db.query(
      "SELECT delete_requested_at FROM vine_users WHERE id = ? LIMIT 1",
      [req.user.id]
    );
    const dueAt = getAccountDeletionDueAt(userRow?.delete_requested_at);
    if (dueAt && dueAt <= new Date()) {
      await purgeUserAccount(req.user.id);
      return res.status(403).json({ message: "Account deletion completed." });
    }

    // 🔑 UPDATE LAST ACTIVE
    await db.query(
      "UPDATE vine_users SET last_active_at = NOW() WHERE id = ?",
      [req.user.id]
    );
    if (req.user?.jti) {
      try {
        await db.query(
          "UPDATE vine_user_sessions SET last_seen_at = NOW() WHERE user_id = ? AND session_jti = ? AND revoked_at IS NULL",
          [req.user.id, req.user.jti]
        );
      } catch (_) {}
    }

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

const getCommunityVisibilityScope = async (userId) => {
  const uid = Number(userId || 0);
  if (!uid) return { isOwner: false, hasMembership: false };
  const [[row]] = await db.query(
    `
    SELECT
      SUM(CASE WHEN LOWER(role) = 'owner' THEN 1 ELSE 0 END) AS owner_count,
      COUNT(*) AS membership_count
    FROM vine_community_members
    WHERE user_id = ?
    `,
    [uid]
  );
  return {
    isOwner: Number(row?.owner_count || 0) > 0,
    hasMembership: Number(row?.membership_count || 0) > 0,
  };
};

const canAccessCommunityByVisibilityPolicy = async (userId, communityId) => {
  const uid = Number(userId || 0);
  const cid = Number(communityId || 0);
  if (!uid || !cid) return true;
  const scope = await getCommunityVisibilityScope(uid);
  if (scope.isOwner || !scope.hasMembership) return true;
  const [membership] = await db.query(
    "SELECT 1 FROM vine_community_members WHERE community_id = ? AND user_id = ? LIMIT 1",
    [cid, uid]
  );
  return membership.length > 0;
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
      const [publishResult] = await db.query(
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
      await syncPostTagLinks({
        postId: Number(publishResult.insertId),
        actorId: Number(row.user_id || 0),
        content: row.content || "",
      });
      await db.query(
        "UPDATE vine_scheduled_posts SET status = 'published' WHERE id = ?",
        [row.id]
      );
    } catch (e) {
      console.error("Publish scheduled post failed:", e);
    }
  }
};

const triggerScheduledPostPublishIfDue = async ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && scheduledPostSweepInFlight) return;
  if (!force && now - lastScheduledPostSweepAt < SCHEDULED_POST_SWEEP_MS) return;

  scheduledPostSweepInFlight = true;
  lastScheduledPostSweepAt = now;
  try {
    await publishDueScheduledPosts();
  } catch (err) {
    console.error("Scheduled post sweep error:", err?.message || err);
  } finally {
    scheduledPostSweepInFlight = false;
    lastScheduledPostSweepAt = Date.now();
  }
};

router.get("/communities", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const scope = await getCommunityVisibilityScope(userId);
    const params = [userId, userId, userId];
    let visibilityWhere = "";
    if (!scope.isOwner && scope.hasMembership) {
      visibilityWhere = `
        WHERE EXISTS (
          SELECT 1
          FROM vine_community_members vm
          WHERE vm.community_id = c.id
            AND vm.user_id = ?
        )
      `;
      params.push(userId);
    }
    const [rows] = await db.query(
      `
      SELECT
        c.id,
        c.name,
        c.slug,
        c.description,
        c.avatar_url,
        c.banner_url,
        c.banner_offset_y,
        c.join_policy,
        c.post_permission,
        c.auto_welcome_enabled,
        c.welcome_message,
        c.is_private,
        c.creator_id,
        c.created_at,
        (SELECT COUNT(DISTINCT m.user_id)
         FROM vine_community_members m
         JOIN vine_users u2 ON u2.id = m.user_id
         WHERE m.community_id = c.id) AS member_count,
        (SELECT COUNT(*) FROM vine_community_rules cr WHERE cr.community_id = c.id) AS rules_count,
        (SELECT COUNT(*) FROM vine_community_join_questions cq WHERE cq.community_id = c.id) AS join_questions_count,
        (SELECT COUNT(*) > 0 FROM vine_community_members m WHERE m.community_id = c.id AND m.user_id = ?) AS is_member,
        (SELECT role FROM vine_community_members m WHERE m.community_id = c.id AND m.user_id = ? LIMIT 1) AS viewer_role,
        (SELECT status FROM vine_community_join_requests r WHERE r.community_id = c.id AND r.user_id = ? LIMIT 1) AS join_request_status
      FROM vine_communities c
      ${visibilityWhere}
      ORDER BY member_count DESC, c.created_at DESC
      `,
      params
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
    const [[ownerRow]] = await db.query(
      `
      SELECT COUNT(*) AS owner_count
      FROM vine_community_members
      WHERE user_id = ?
        AND LOWER(role) = 'owner'
      `,
      [userId]
    );
    if (Number(ownerRow?.owner_count || 0) < 1) {
      return res.status(403).json({ message: "Only existing community owners can create new communities" });
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
      INSERT INTO vine_communities (name, slug, description, creator_id, join_policy, post_permission)
      VALUES (?, ?, ?, ?, ?, 'mods_only')
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
      "SELECT id, slug, join_policy, creator_id, auto_welcome_enabled, welcome_message, name FROM vine_communities WHERE id = ? LIMIT 1",
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
      const [mods] = await db.query(
        `
        SELECT user_id
        FROM vine_community_members
        WHERE community_id = ?
          AND LOWER(role) IN ('owner', 'moderator')
          AND user_id != ?
        `,
        [communityId, userId]
      );
      for (const mod of mods) {
        await notifyUser({
          userId: mod.user_id,
          actorId: userId,
          type: "community_join_request",
          meta: {
            community_id: communityId,
            community_slug: community.slug || null,
            community_name: community.name || null,
          },
        });
      }
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
    const viewerId = Number(req.user?.id || 0);
    const [[community]] = await db.query(
      `
      SELECT
        c.id,
        c.name,
        c.slug,
        c.description,
        c.avatar_url,
        c.banner_url,
        c.banner_offset_y,
        c.join_policy,
        c.post_permission,
        c.auto_welcome_enabled,
        c.welcome_message,
        c.is_private,
        c.creator_id,
        c.created_at,
        (SELECT COUNT(DISTINCT m.user_id)
         FROM vine_community_members m
         JOIN vine_users u2 ON u2.id = m.user_id
         WHERE m.community_id = c.id) AS member_count,
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
    if (viewerId) {
      const allowed = await canAccessCommunityByVisibilityPolicy(viewerId, community.id);
      if (!allowed) return res.status(403).json({ message: "Not allowed" });
    }
    res.json(community);
  } catch (err) {
    console.error("Get community error:", err);
    res.status(500).json({ message: "Failed to load community" });
  }
});

router.get("/communities/:slug/members", authOptional, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const viewerId = Number(req.user?.id || 0);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const [[community]] = await db.query(
      "SELECT id FROM vine_communities WHERE slug = ? LIMIT 1",
      [req.params.slug]
    );
    if (!community) return res.status(404).json([]);
    if (viewerId) {
      const allowed = await canAccessCommunityByVisibilityPolicy(viewerId, community.id);
      if (!allowed) return res.status(403).json([]);
    }

    const [rows] = await db.query(
      `
      SELECT
        x.id,
        x.username,
        x.display_name,
        x.avatar_url,
        x.is_verified,
        CASE x.role_rank
          WHEN 0 THEN 'owner'
          WHEN 1 THEN 'moderator'
          ELSE 'member'
        END AS role,
        x.joined_at
      FROM (
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          MIN(
            CASE LOWER(m.role)
              WHEN 'owner' THEN 0
              WHEN 'moderator' THEN 1
              ELSE 2
            END
          ) AS role_rank,
          MIN(m.joined_at) AS joined_at
        FROM vine_community_members m
        JOIN vine_users u ON u.id = m.user_id
        WHERE m.community_id = ?
        GROUP BY u.id, u.username, u.display_name, u.avatar_url, u.is_verified
      ) x
      ORDER BY x.role_rank ASC, x.joined_at ASC
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
    const autoWelcomeEnabled = req.body?.auto_welcome_enabled;
    const welcomeMessage = String(req.body?.welcome_message || "").trim();
    if (!communityId) return res.status(400).json({ message: "Invalid community" });
    if (!["open", "approval", "closed"].includes(joinPolicy)) {
      return res.status(400).json({ message: "Invalid join policy" });
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
        "mods_only",
        autoWelcomeEnabled === undefined ? 1 : Number(Boolean(autoWelcomeEnabled)),
        welcomeMessage || null,
        communityId,
      ]
    );
    res.json({
      success: true,
      join_policy: joinPolicy,
      post_permission: "mods_only",
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
      if (String(role || "").toLowerCase() !== "owner") {
        return res.status(403).json({ message: "Only community owner can change community avatar" });
      }

      const normalized = await normalizeImageBuffer(req.file);
      const prepared = await buildCommunityAvatarBuffer(normalized.buffer);
      const [[communityRow]] = await db.query(
        "SELECT avatar_url FROM vine_communities WHERE id = ? LIMIT 1",
        [communityId]
      );
      const upload = await uploadBufferToCloudinary(prepared.buffer, {
          folder: "vine/community_avatars",
          resource_type: "image",
          format: "jpg",
          content_type: prepared.mimetype,
          transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
        });

      await db.query("UPDATE vine_communities SET avatar_url = ? WHERE id = ?", [upload.secure_url, communityId]);
      if (communityRow?.avatar_url && communityRow.avatar_url !== upload.secure_url) {
        await deleteCloudinaryByUrl(communityRow.avatar_url).catch(() => {});
      }
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
      if (String(role || "").toLowerCase() !== "owner") {
        return res.status(403).json({ message: "Only community owner can change community banner" });
      }

      const normalized = await normalizeImageBuffer(req.file);
      const prepared = await buildCommunityBannerBuffer(normalized.buffer);
      const [[communityRow]] = await db.query(
        "SELECT banner_url FROM vine_communities WHERE id = ? LIMIT 1",
        [communityId]
      );
      const upload = await uploadBufferToCloudinary(prepared.buffer, {
          folder: "vine/community_banners",
          resource_type: "image",
          format: "jpg",
          content_type: prepared.mimetype,
          transformation: [{ width: 1500, height: 500, crop: "fill" }],
        });

      await db.query("UPDATE vine_communities SET banner_url = ? WHERE id = ?", [upload.secure_url, communityId]);
      if (communityRow?.banner_url && communityRow.banner_url !== upload.secure_url) {
        await deleteCloudinaryByUrl(communityRow.banner_url).catch(() => {});
      }
      res.json({ banner_url: upload.secure_url });
    } catch (err) {
      console.error("Community banner upload error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  }
);

router.post("/communities/:id/banner-position", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const raw = Number(req.body?.offsetY);
    if (!communityId || !Number.isFinite(raw)) {
      return res.status(400).json({ message: "Invalid request" });
    }
    const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (role !== "owner") {
      return res.status(403).json({ message: "Only community owner can adjust banner position" });
    }
    const offsetY = Math.max(-260, Math.min(260, Math.round(raw)));
    await db.query("UPDATE vine_communities SET banner_offset_y = ? WHERE id = ?", [offsetY, communityId]);
    res.json({ success: true, banner_offset_y: offsetY });
  } catch (err) {
    console.error("Update community banner position error:", err);
    res.status(500).json({ message: "Failed to update banner position" });
  }
});

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

    const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (role !== "owner") return res.status(403).json({ message: "Only community owner can create assignments" });

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
    const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (role !== "owner") return res.status(403).json({ message: "Only community owner can delete assignments" });
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
    if (String(role || "").toLowerCase() !== "owner") {
      return res.status(403).json({ message: "Only community owner can add join questions" });
    }

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
    if (String(role || "").toLowerCase() !== "owner") {
      return res.status(403).json({ message: "Only community owner can delete join questions" });
    }
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

router.delete("/communities/:id/members/:memberId", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const memberId = Number(req.params.memberId);
    if (!communityId || !memberId) return res.status(400).json({ message: "Invalid request" });
    if (memberId === userId) {
      return res.status(400).json({ message: "Use leave to remove yourself" });
    }

    const actorRole = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (!isCommunityModOrOwner(actorRole)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const [[targetRow]] = await db.query(
      `
      SELECT role
      FROM vine_community_members
      WHERE community_id = ? AND user_id = ?
      LIMIT 1
      `,
      [communityId, memberId]
    );
    if (!targetRow) return res.status(404).json({ message: "Member not found" });

    const targetRole = String(targetRow.role || "").toLowerCase();
    if (targetRole === "owner") {
      return res.status(403).json({ message: "Owner cannot be removed" });
    }
    if (actorRole === "moderator" && targetRole !== "member") {
      return res.status(403).json({ message: "Moderators can only remove members" });
    }

    await db.query(
      "DELETE FROM vine_community_members WHERE community_id = ? AND user_id = ? LIMIT 1",
      [communityId, memberId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Kick community member error:", err);
    res.status(500).json({ message: "Failed to remove member" });
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
    if (String(role || "").toLowerCase() !== "owner") {
      return res.status(403).json({ message: "Only community owner can schedule posts" });
    }
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
    if (String(role || "").toLowerCase() !== "owner") return res.status(403).json([]);
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

router.post("/communities/:id/sessions", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const title = String(req.body?.title || "").trim();
    const startsAtRaw = String(req.body?.starts_at || "").trim();
    const endsAtRaw = String(req.body?.ends_at || "").trim();
    const notes = String(req.body?.notes || "").trim();
    if (!communityId || !title || !startsAtRaw) {
      return res.status(400).json({ message: "title and starts_at required" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });
    const startsAt = new Date(startsAtRaw);
    const endsAt = endsAtRaw ? new Date(endsAtRaw) : null;
    if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) {
      return res.status(400).json({ message: "Invalid date" });
    }
    await db.query(
      `
      INSERT INTO vine_community_sessions (community_id, title, starts_at, ends_at, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [communityId, title.slice(0, 180), startsAt, endsAt || null, notes || null, userId]
    );
    clearVineReadCache("community-sessions", "community-attendance", "community-progress");
    res.json({ success: true });
  } catch (err) {
    console.error("Create community session error:", err);
    res.status(500).json({ message: "Failed to create session" });
  }
});

router.get("/communities/:id/sessions", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json([]);
    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json([]);
    const cacheKey = buildVineCacheKey("community-sessions", communityId, userId);
    const rows = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.communityAttendance, async () => {
      const [sessionRows] = await db.query(
        `
        SELECT
          s.id,
          s.community_id,
          s.title,
          s.starts_at,
          s.ends_at,
          s.notes,
          s.created_by,
          s.created_at,
          u.username AS created_by_username,
          u.display_name AS created_by_display_name,
          (SELECT COUNT(*) FROM vine_community_attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present_count,
          (SELECT COUNT(*) FROM vine_community_attendance a WHERE a.session_id = s.id AND a.status = 'absent') AS absent_count,
          (SELECT COUNT(*) FROM vine_community_attendance a WHERE a.session_id = s.id AND a.status = 'late') AS late_count,
          (SELECT COUNT(*) FROM vine_community_attendance a WHERE a.session_id = s.id AND a.status = 'excused') AS excused_count
        FROM vine_community_sessions s
        JOIN vine_users u ON u.id = s.created_by
        WHERE s.community_id = ?
        ORDER BY s.starts_at DESC
        LIMIT 300
        `,
        [communityId]
      );
      return sessionRows;
    });
    res.json(rows);
  } catch (err) {
    console.error("Get community sessions error:", err);
    res.status(500).json([]);
  }
});

router.get("/communities/:id/sessions/:sessionId/attendance", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const sessionId = Number(req.params.sessionId);
    if (!communityId || !sessionId) return res.status(400).json([]);
    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json([]);

    const cacheKey = buildVineCacheKey("community-attendance-session", communityId, sessionId, userId);
    const members = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.communityAttendance, async () => {
      const [rows] = await db.query(
        `
        SELECT
          u.id AS user_id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          m.role AS community_role,
          a.status,
          a.marked_at,
          a.marked_by
        FROM vine_community_members m
        JOIN vine_users u ON u.id = m.user_id
        LEFT JOIN vine_community_attendance a
          ON a.user_id = u.id
         AND a.session_id = ?
         AND a.community_id = ?
        WHERE m.community_id = ?
        ORDER BY
          CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
          u.username ASC
        `,
        [sessionId, communityId, communityId]
      );
      return rows;
    });
    res.json(members);
  } catch (err) {
    console.error("Get attendance error:", err);
    res.status(500).json([]);
  }
});

router.post("/communities/:id/sessions/:sessionId/attendance/bulk", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const sessionId = Number(req.params.sessionId);
    if (!communityId || !sessionId) return res.status(400).json({ message: "Invalid request" });
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });

    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!entries.length) return res.status(400).json({ message: "No entries provided" });
    const allowedStatuses = new Set(["present", "absent", "late", "excused"]);

    const [[session]] = await db.query(
      "SELECT id, starts_at, ends_at FROM vine_community_sessions WHERE id = ? AND community_id = ? LIMIT 1",
      [sessionId, communityId]
    );
    if (!session) return res.status(404).json({ message: "Session not found" });
    if (session.ends_at) {
      const endsAt = new Date(session.ends_at);
      if (!Number.isNaN(endsAt.getTime()) && endsAt.getTime() <= Date.now()) {
        return res.status(409).json({ message: "Session has ended and attendance is now locked" });
      }
    }

    for (const entry of entries) {
      const targetUserId = Number(entry?.user_id);
      const status = String(entry?.status || "").toLowerCase();
      if (!targetUserId || !allowedStatuses.has(status)) continue;
      await db.query(
        `
        INSERT INTO vine_community_attendance (session_id, community_id, user_id, status, marked_by, marked_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by), marked_at = NOW()
        `,
        [sessionId, communityId, targetUserId, status, userId]
      );
    }

    clearVineReadCache("community-sessions", "community-attendance", "community-progress");
    res.json({ success: true });
  } catch (err) {
    console.error("Save attendance error:", err);
    res.status(500).json({ message: "Failed to save attendance" });
  }
});

router.get("/communities/:id/attendance/summary", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json({ lessons_attended: 0 });
    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ lessons_attended: 0 });

    const cacheKey = buildVineCacheKey("community-attendance-summary", communityId, userId);
    const row = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.communityAttendance, async () => {
      const [[summaryRow]] = await db.query(
        `
        SELECT
          (SELECT COUNT(*)
           FROM vine_community_attendance a
           WHERE a.community_id = ?
             AND a.user_id = ?
             AND a.status IN ('present', 'late')) AS lessons_attended
        `,
        [communityId, userId]
      );
      return summaryRow;
    });
    res.json({ lessons_attended: Number(row?.lessons_attended || 0) });
  } catch (err) {
    console.error("Get attendance summary error:", err);
    res.status(500).json({ lessons_attended: 0 });
  }
});

router.get("/communities/:id/attendance/my-records", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json({ lessons_attended: 0, lessons_missed: 0, rows: [] });
    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ lessons_attended: 0, lessons_missed: 0, rows: [] });

    const cacheKey = buildVineCacheKey("community-attendance-records", communityId, userId);
    const payload = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.communityAttendance, async () => {
      const [rows] = await db.query(
        `
        SELECT
          s.id AS session_id,
          s.title,
          s.starts_at,
          COALESCE(a.status, 'absent') AS status
        FROM vine_community_sessions s
        LEFT JOIN vine_community_attendance a
          ON a.session_id = s.id
         AND a.community_id = s.community_id
         AND a.user_id = ?
        WHERE s.community_id = ?
          AND (
            s.starts_at <= NOW()
            OR a.status IS NOT NULL
          )
        ORDER BY s.starts_at DESC
        LIMIT 500
        `,
        [userId, communityId]
      );

      let attended = 0;
      let missed = 0;
      for (const row of rows) {
        const st = String(row.status || "").toLowerCase();
        if (st === "present" || st === "late") attended += 1;
        else if (st === "absent") missed += 1;
      }

      return {
        lessons_attended: attended,
        lessons_missed: missed,
        rows,
      };
    });

    res.json(payload);
  } catch (err) {
    console.error("Get attendance records error:", err);
    res.status(500).json({ lessons_attended: 0, lessons_missed: 0, rows: [] });
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

router.get("/communities/:slug/library", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const viewerId = Number(req.user.id);
    const [[community]] = await db.query(
      "SELECT id FROM vine_communities WHERE slug = ? LIMIT 1",
      [req.params.slug]
    );
    if (!community) return res.status(404).json([]);
    const allowed = await canAccessCommunityByVisibilityPolicy(viewerId, community.id);
    if (!allowed) return res.status(403).json([]);

    const cacheKey = buildVineCacheKey("community-library", req.params.slug.toLowerCase(), viewerId);
    const rows = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.communityLibrary, async () => {
      const [libraryRows] = await db.query(
        `
        SELECT
          l.id,
          l.community_id,
          l.uploader_id,
          l.title,
          l.pdf_url,
          l.created_at,
          u.username AS uploader_username,
          u.display_name AS uploader_display_name
        FROM vine_community_library l
        JOIN vine_users u ON u.id = l.uploader_id
        WHERE l.community_id = ?
        ORDER BY l.created_at DESC, l.id DESC
        `,
        [community.id]
      );
      return libraryRows;
    });

    res.json(rows);
  } catch (err) {
    console.error("Get community library error:", err);
    res.status(500).json([]);
  }
});

router.post("/communities/:id/library", authenticate, uploadPostCloudinary.single("library_pdf"), async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const title = String(req.body?.title || "").trim();
    if (!communityId || !title) {
      return res.status(400).json({ message: "title is required" });
    }
    if (!req.file || !isPdfFile(req.file)) {
      return res.status(400).json({ message: "PDF file is required" });
    }

    const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (role !== "owner") {
      return res.status(403).json({ message: "Only community owner can upload library PDFs" });
    }

    const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
      folder: "vine/community-library",
      resource_type: "raw",
      public_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      format: "pdf",
      content_type: req.file.mimetype || "application/pdf",
    });
    const pdfUrl = uploaded.secure_url || uploaded.url || null;
    if (!pdfUrl) {
      return res.status(500).json({ message: "Upload failed" });
    }

    await db.query(
      `
      INSERT INTO vine_community_library (community_id, uploader_id, title, pdf_url, created_at)
      VALUES (?, ?, ?, ?, NOW())
      `,
      [communityId, userId, title.slice(0, 180), pdfUrl]
    );

    clearVineReadCache("community-library");
    res.json({ success: true });
  } catch (err) {
    console.error("Upload community library PDF error:", err);
    res.status(500).json({ message: "Failed to upload PDF" });
  }
});

router.delete("/communities/:id/library/:itemId", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!communityId || !itemId) return res.status(400).json({ message: "Invalid request" });

    const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (role !== "owner") {
      return res.status(403).json({ message: "Only community owner can remove library PDFs" });
    }

    const [[item]] = await db.query(
      "SELECT id, pdf_url FROM vine_community_library WHERE id = ? AND community_id = ? LIMIT 1",
      [itemId, communityId]
    );
    if (!item) return res.status(404).json({ message: "Library item not found" });

    await db.query(
      "DELETE FROM vine_community_library WHERE id = ? AND community_id = ?",
      [itemId, communityId]
    );
    if (item.pdf_url) {
      await deleteCloudinaryByUrl(item.pdf_url);
    }
    clearVineReadCache("community-library");
    res.json({ success: true });
  } catch (err) {
    console.error("Delete community library PDF error:", err);
    res.status(500).json({ message: "Failed to delete PDF" });
  }
});

router.post("/communities/:id/assignments", authenticate, uploadPostCloudinary.single("assignment_file"), async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const title = String(req.body?.title || "").trim();
    const instructions = String(req.body?.instructions || "").trim();
    const rubric = String(req.body?.rubric || "").trim();
    const assignmentTypeRaw = String(req.body?.assignment_type || "theory").trim().toLowerCase();
    const assignmentType = ["theory", "practical"].includes(assignmentTypeRaw) ? assignmentTypeRaw : "theory";
    const dueAtRaw = String(req.body?.due_at || "").trim();
    const parsedPoints = Number(req.body?.points);
    const points = Number.isFinite(parsedPoints) && parsedPoints > 0
      ? parsedPoints
      : 100;
    if (!communityId || !title) {
      return res.status(400).json({ message: "title is required" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });
    const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
    if (dueAtRaw && Number.isNaN(dueAt?.getTime?.())) {
      return res.status(400).json({ message: "Invalid due date" });
    }
    let attachmentUrl = null;
    let attachmentName = null;
    if (req.file) {
      if (!isPdfFile(req.file)) {
        return res.status(400).json({ message: "Only PDF is allowed for assignment attachment." });
      }
      const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
        folder: "vine/assignment-docs",
        resource_type: "raw",
        public_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        format: "pdf",
        content_type: req.file.mimetype || "application/pdf",
      });
      attachmentUrl = uploaded.secure_url || uploaded.url || null;
      attachmentName = String(req.file.originalname || "").slice(0, 255) || "assignment.pdf";
    }
    const [result] = await db.query(
      `
      INSERT INTO vine_community_assignments
      (community_id, creator_id, title, instructions, assignment_type, attachment_url, attachment_name, due_at, points, rubric, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [communityId, userId, title.slice(0, 160), instructions || null, assignmentType, attachmentUrl, attachmentName, dueAt || null, points, rubric || null]
    );

    const [members] = await db.query(
      `
      SELECT user_id
      FROM vine_community_members
      WHERE community_id = ?
        AND user_id != ?
      `,
      [communityId, userId]
    );
    const [[community]] = await db.query(
      "SELECT slug FROM vine_communities WHERE id = ? LIMIT 1",
      [communityId]
    );
    const assignmentId = Number(result?.insertId || 0);
    for (const row of members) {
      await notifyUser({
        userId: row.user_id,
        actorId: userId,
        type: "community_assignment_created",
        meta: {
          community_id: communityId,
          community_slug: community?.slug || null,
          assignment_id: assignmentId,
          title: title.slice(0, 160),
        },
      });
    }

    clearVineReadCache("community-assignments", "community-gradebook", "community-progress");
    res.json({ success: true });
  } catch (err) {
    console.error("Create community assignment error:", err);
    res.status(500).json({ message: "Failed to create assignment" });
  }
});

router.delete("/communities/:id/assignments/:assignmentId", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!communityId || !assignmentId) {
      return res.status(400).json({ message: "Invalid request" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });

    const [[assignment]] = await db.query(
      "SELECT id, attachment_url FROM vine_community_assignments WHERE id = ? AND community_id = ? LIMIT 1",
      [assignmentId, communityId]
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });

    const [submissionFiles] = await db.query(
      "SELECT file_url FROM vine_community_submission_files WHERE assignment_id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    const urlsToDelete = [
      assignment.attachment_url,
      ...submissionFiles.map((row) => row.file_url),
    ].filter(Boolean);

    await db.query(
      "DELETE FROM vine_community_submissions WHERE assignment_id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    await db.query(
      "DELETE FROM vine_community_submission_files WHERE assignment_id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    await db.query(
      "DELETE FROM vine_community_submission_drafts WHERE assignment_id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    await db.query(
      "DELETE FROM vine_community_assignments WHERE id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    await Promise.all(urlsToDelete.map((url) => deleteCloudinaryByUrl(url)));

    clearVineReadCache(
      "community-assignments",
      "community-assignment-submissions",
      "community-gradebook",
      "community-progress",
      "profile-header"
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Delete assignment error:", err);
    res.status(500).json({ message: "Failed to delete assignment" });
  }
});

router.patch("/communities/:id/assignments/:assignmentId/deadline", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const dueAtRaw = String(req.body?.due_at || "").trim();
    if (!communityId || !assignmentId || !dueAtRaw) {
      return res.status(400).json({ message: "due_at is required" });
    }

    const role = await getCommunityRole(communityId, userId);
    if (String(role || "").toLowerCase() !== "owner") {
      return res.status(403).json({ message: "Only community owner can extend deadlines" });
    }

    const [[assignment]] = await db.query(
      "SELECT id, due_at FROM vine_community_assignments WHERE id = ? AND community_id = ? LIMIT 1",
      [assignmentId, communityId]
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    if (!assignment.due_at) {
      return res.status(400).json({ message: "Assignment has no existing deadline to extend" });
    }

    const currentDue = new Date(assignment.due_at);
    const nextDue = new Date(dueAtRaw);
    if (Number.isNaN(nextDue.getTime())) {
      return res.status(400).json({ message: "Invalid due date" });
    }
    if (currentDue.getTime() <= Date.now()) {
      return res.status(403).json({ message: "Deadline already elapsed. Extension is locked." });
    }
    if (nextDue.getTime() <= currentDue.getTime()) {
      return res.status(400).json({ message: "New deadline must be later than current deadline" });
    }

    await db.query(
      "UPDATE vine_community_assignments SET due_at = ?, updated_at = NOW() WHERE id = ? AND community_id = ?",
      [nextDue, assignmentId, communityId]
    );

    clearVineReadCache("community-assignments", "community-gradebook", "community-progress", "profile-header");
    return res.json({ success: true, due_at: nextDue.toISOString() });
  } catch (err) {
    console.error("Extend assignment deadline error:", err);
    return res.status(500).json({ message: "Failed to extend deadline" });
  }
});

router.get("/communities/:slug/assignments", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const viewerId = Number(req.user.id);
    const [[community]] = await db.query("SELECT id FROM vine_communities WHERE slug = ? LIMIT 1", [req.params.slug]);
    if (!community) return res.status(404).json([]);
    const allowed = await canAccessCommunityByVisibilityPolicy(viewerId, community.id);
    if (!allowed) return res.status(403).json([]);

    const rows = await runVinePerfRoute(
      "community-assignments",
      { slug: req.params.slug, community_id: community.id, viewer_id: viewerId },
      async (perfCtx) => {
        const cacheKey = buildVineCacheKey("community-assignments", req.params.slug.toLowerCase(), viewerId);
        return readThroughVineCache(cacheKey, VINE_CACHE_TTLS.communityAssignments, async () => {
          const [assignmentRows] = await timedVineQuery(
            perfCtx,
            "community-assignments.rows",
            `
            SELECT
              a.id,
              a.community_id,
              a.creator_id,
              a.title,
              a.instructions,
              a.assignment_type,
              a.attachment_url,
              a.attachment_name,
              a.rubric,
              a.due_at,
              a.points,
              a.created_at,
              cu.username AS creator_username,
              cu.display_name AS creator_display_name,
              (SELECT COUNT(*) FROM vine_community_submissions s WHERE s.assignment_id = a.id) AS submission_count,
              vs.id AS viewer_submission_id,
              vs.status AS viewer_submission_status,
              vs.graded_at AS viewer_submission_graded_at,
              vs.attempt_count AS viewer_submission_attempts,
              vs.score AS viewer_submission_score,
              vs.submitted_at AS viewer_submitted_at,
              vs.content AS viewer_submission_content,
              vs.attachment_url AS viewer_submission_attachment_url,
              vs.attachment_name AS viewer_submission_attachment_name,
              vs.attachment_mime AS viewer_submission_attachment_mime,
              vd.content AS viewer_draft_content,
              vd.updated_at AS viewer_draft_updated_at
            FROM vine_community_assignments a
            JOIN vine_users cu ON cu.id = a.creator_id
            LEFT JOIN vine_community_submissions vs
              ON vs.assignment_id = a.id
             AND vs.user_id = ?
            LEFT JOIN vine_community_submission_drafts vd
              ON vd.assignment_id = a.id
             AND vd.user_id = ?
            WHERE a.community_id = ?
            ORDER BY (a.due_at IS NULL) ASC, a.due_at ASC, a.created_at DESC
            `,
            [viewerId, viewerId, community.id]
          );
          const submissionIds = assignmentRows
            .map((r) => Number(r.viewer_submission_id))
            .filter((id) => Number.isFinite(id) && id > 0);
          if (submissionIds.length > 0) {
            const placeholders = submissionIds.map(() => "?").join(", ");
            const [fileRows] = await timedVineQuery(
              perfCtx,
              "community-assignments.files",
              `
              SELECT id, submission_id, file_url, file_name, file_mime, created_at
              FROM vine_community_submission_files
              WHERE submission_id IN (${placeholders})
              ORDER BY created_at ASC, id ASC
              `,
              submissionIds
            );
            const bySubmission = {};
            for (const row of fileRows) {
              const sid = Number(row.submission_id);
              if (!bySubmission[sid]) bySubmission[sid] = [];
              bySubmission[sid].push({
                id: row.id,
                file_url: row.file_url,
                file_name: row.file_name,
                file_mime: row.file_mime,
                created_at: row.created_at,
              });
            }
            for (const row of assignmentRows) {
              const sid = Number(row.viewer_submission_id || 0);
              row.viewer_submission_files = sid > 0 ? (bySubmission[sid] || []) : [];
            }
          } else {
            for (const row of assignmentRows) row.viewer_submission_files = [];
          }
          return assignmentRows;
        });
      }
    );
    res.json(rows);
  } catch (err) {
    console.error("Get community assignments error:", err);
    res.status(500).json([]);
  }
});

router.post("/communities/:id/assignments/:assignmentId/submissions", authenticate, uploadPostCloudinary.array("submission_files", 10), async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const content = String(req.body?.content || "").trim();
    const files = Array.isArray(req.files) ? req.files : [];
    if (!communityId || !assignmentId) return res.status(400).json({ message: "Invalid request" });
    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ message: "Join this community first" });

    const [[assignment]] = await db.query(
      "SELECT id, community_id, due_at, assignment_type FROM vine_community_assignments WHERE id = ? AND community_id = ? LIMIT 1",
      [assignmentId, communityId]
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    const isPractical = String(assignment.assignment_type || "theory").toLowerCase() === "practical";
    if (!content && files.length === 0) {
      return res.status(400).json({ message: isPractical ? "Upload a file or add notes" : "content is required" });
    }
    if (files.length > 0 && !isPractical) {
      return res.status(400).json({ message: "File upload is only allowed for practical assignments" });
    }
    if (files.length > 0 && isPractical && files.some((file) => !isPracticalSubmissionFile(file))) {
      return res.status(400).json({ message: "Invalid practical file type. Use PPT, XLS, DOC, Access, Publisher, or PDF files." });
    }
    const normalizedRole = String(role || "").toLowerCase();
    const canBypassDueDate = normalizedRole === "owner";
    if (assignment.due_at && !canBypassDueDate) {
      const dueAt = new Date(assignment.due_at);
      if (!Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now()) {
        return res.status(403).json({ message: "Submission window closed. Due date has passed." });
      }
    }

    const uploadedFiles = [];
    if (files.length > 0 && isPractical) {
      for (const file of files) {
        const originalName = String(file.originalname || "").trim();
        const ext = originalName.includes(".") ? originalName.split(".").pop().toLowerCase() : "bin";
        const uploaded = await uploadBufferToCloudinary(file.buffer, {
          folder: "vine/assignment-submissions",
          resource_type: "raw",
          public_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          format: ext,
          content_type: file.mimetype || "application/octet-stream",
        });
        uploadedFiles.push({
          url: uploaded.secure_url || uploaded.url || null,
          name: originalName.slice(0, 255) || `submission.${ext}`,
          mime: String(file.mimetype || "").slice(0, 120) || null,
        });
      }
    }

    const [[existing]] = await db.query(
      "SELECT id, attempt_count, graded_at, score, status, attachment_url, attachment_name, attachment_mime FROM vine_community_submissions WHERE assignment_id = ? AND user_id = ? LIMIT 1",
      [assignmentId, userId]
    );

    const primaryAttachment = uploadedFiles[0] || null;
    let submissionId = null;
    if (existing) {
      if (!isPractical) {
        const isGraded =
          existing.graded_at !== null ||
          existing.score !== null ||
          ["graded", "needs_revision", "missing"].includes(String(existing.status || "").toLowerCase());
        if (isGraded) {
          return res.status(403).json({ message: "Assignment already graded. Resubmission is closed." });
        }
        const attempts = Number(existing.attempt_count || 1);
        if (attempts >= 2) {
          return res.status(403).json({ message: "Submission limit reached (2 attempts)." });
        }
      }
      await db.query(
        `
        UPDATE vine_community_submissions
        SET content = ?,
            attachment_url = ?,
            attachment_name = ?,
            attachment_mime = ?,
            attempt_count = CASE WHEN ? THEN attempt_count ELSE attempt_count + 1 END,
            status = 'resubmitted',
            submitted_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
        `,
        [
          content || null,
          primaryAttachment?.url || existing.attachment_url || null,
          primaryAttachment?.name || existing.attachment_name || null,
          primaryAttachment?.mime || existing.attachment_mime || null,
          isPractical ? 1 : 0,
          existing.id,
        ]
      );
      submissionId = Number(existing.id);
    } else {
      const [inserted] = await db.query(
        `
        INSERT INTO vine_community_submissions
        (assignment_id, community_id, user_id, content, attachment_url, attachment_name, attachment_mime, attempt_count, status, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'submitted', NOW())
        `,
        [
          assignmentId,
          communityId,
          userId,
          content || null,
          primaryAttachment?.url || null,
          primaryAttachment?.name || null,
          primaryAttachment?.mime || null,
        ]
      );
      submissionId = Number(inserted?.insertId || 0);
    }
    if (submissionId && uploadedFiles.length > 0 && isPractical) {
      for (const file of uploadedFiles) {
        if (!file.url) continue;
        await db.query(
          `
          INSERT INTO vine_community_submission_files
          (submission_id, assignment_id, community_id, user_id, file_url, file_name, file_mime, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
          `,
          [submissionId, assignmentId, communityId, userId, file.url, file.name || null, file.mime || null]
        );
      }
    }
    await db.query(
      "DELETE FROM vine_community_submission_drafts WHERE assignment_id = ? AND community_id = ? AND user_id = ?",
      [assignmentId, communityId, userId]
    );

    const [[assignmentMeta]] = await db.query(
      `
      SELECT a.title, a.assignment_type, c.slug AS community_slug
      FROM vine_community_assignments a
      LEFT JOIN vine_communities c ON c.id = a.community_id
      WHERE a.id = ? AND a.community_id = ?
      LIMIT 1
      `,
      [assignmentId, communityId]
    );
    const [mods] = await db.query(
      `
      SELECT user_id
      FROM vine_community_members
      WHERE community_id = ?
        AND LOWER(role) IN ('owner', 'moderator')
        AND user_id != ?
      `,
      [communityId, userId]
    );
    for (const row of mods) {
      await notifyUser({
        userId: row.user_id,
        actorId: userId,
        type: "community_assignment_submission",
        meta: {
          community_id: communityId,
          community_slug: assignmentMeta?.community_slug || null,
          assignment_id: assignmentId,
          assignment_title: assignmentMeta?.title || null,
          assignment_type: assignmentMeta?.assignment_type || "theory",
          submitted_at: new Date().toISOString(),
          attempt_count: existing
            ? (isPractical ? Number(existing.attempt_count || 1) : Number(existing.attempt_count || 1) + 1)
            : 1,
          is_resubmission: Boolean(existing),
        },
      });
    }

    clearVineReadCache(
      "community-assignments",
      "community-assignment-submissions",
      "community-gradebook",
      "community-progress",
      "profile-header"
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Submit assignment error:", err);
    res.status(500).json({ message: "Failed to submit assignment" });
  }
});

router.delete("/communities/:id/assignments/:assignmentId/submission-files/:fileId", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const fileId = Number(req.params.fileId);
    if (!communityId || !assignmentId || !fileId) {
      return res.status(400).json({ message: "Invalid request" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ message: "Join this community first" });

    const [[assignment]] = await db.query(
      "SELECT id, due_at, assignment_type FROM vine_community_assignments WHERE id = ? AND community_id = ? LIMIT 1",
      [assignmentId, communityId]
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    if (String(assignment.assignment_type || "").toLowerCase() !== "practical") {
      return res.status(400).json({ message: "File deletion is only available for practical assignments" });
    }
    if (assignment.due_at) {
      const dueAt = new Date(assignment.due_at);
      if (!Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now()) {
        return res.status(403).json({ message: "Submission window closed. Due date has passed." });
      }
    }

    const [[row]] = await db.query(
      `
      SELECT
        f.id,
        f.submission_id,
        f.file_url,
        s.user_id
      FROM vine_community_submission_files f
      JOIN vine_community_submissions s ON s.id = f.submission_id
      WHERE f.id = ?
        AND f.assignment_id = ?
        AND f.community_id = ?
      LIMIT 1
      `,
      [fileId, assignmentId, communityId]
    );
    if (!row) return res.status(404).json({ message: "File not found" });
    if (Number(row.user_id) !== Number(userId)) {
      return res.status(403).json({ message: "You can only delete your own uploaded files" });
    }

    await db.query("DELETE FROM vine_community_submission_files WHERE id = ? LIMIT 1", [fileId]);
    await deleteCloudinaryByUrl(row.file_url);

    const [remaining] = await db.query(
      `
      SELECT file_url, file_name, file_mime
      FROM vine_community_submission_files
      WHERE submission_id = ?
      ORDER BY created_at ASC, id ASC
      `,
      [row.submission_id]
    );
    const latest = remaining.length ? remaining[remaining.length - 1] : null;
    await db.query(
      `
      UPDATE vine_community_submissions
      SET attachment_url = ?, attachment_name = ?, attachment_mime = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [latest?.file_url || null, latest?.file_name || null, latest?.file_mime || null, row.submission_id]
    );

    clearVineReadCache(
      "community-assignments",
      "community-assignment-submissions",
      "community-gradebook",
      "community-progress",
      "profile-header"
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Delete practical submission file error:", err);
    res.status(500).json({ message: "Failed to delete file" });
  }
});

router.post("/communities/:id/assignments/:assignmentId/draft", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const content = String(req.body?.content || "").trim();
    if (!communityId || !assignmentId || !content) {
      return res.status(400).json({ message: "content is required" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ message: "Join this community first" });

    const [[assignment]] = await db.query(
      "SELECT id FROM vine_community_assignments WHERE id = ? AND community_id = ? LIMIT 1",
      [assignmentId, communityId]
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });

    await db.query(
      `
      INSERT INTO vine_community_submission_drafts (assignment_id, community_id, user_id, content, updated_at)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = NOW()
      `,
      [assignmentId, communityId, userId, content]
    );
    clearVineReadCache("community-assignments");
    res.json({ success: true });
  } catch (err) {
    console.error("Save assignment draft error:", err);
    res.status(500).json({ message: "Failed to save draft" });
  }
});

router.get("/communities/:id/assignments/:assignmentId/submissions", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!communityId || !assignmentId) return res.status(400).json([]);
    const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (role !== "owner") return res.status(403).json([]);

    const rows = await runVinePerfRoute(
      "community-assignment-submissions",
      { community_id: communityId, assignment_id: assignmentId, viewer_id: userId },
      async (perfCtx) => {
        const cacheKey = buildVineCacheKey("community-assignment-submissions", communityId, assignmentId, userId);
        return readThroughVineCache(cacheKey, VINE_CACHE_TTLS.communityAssignmentSubmissions, async () => {
          const [submissionRows] = await timedVineQuery(
            perfCtx,
            "community-assignment-submissions.rows",
            `
            SELECT
              s.id,
              s.assignment_id,
              s.user_id,
              s.content,
              s.status,
              s.score,
              s.feedback,
              s.attachment_url,
              s.attachment_name,
              s.attachment_mime,
              s.submitted_at,
              s.graded_at,
              u.username,
              u.display_name,
              u.avatar_url,
              u.is_verified
            FROM vine_community_submissions s
            JOIN vine_users u ON u.id = s.user_id
            WHERE s.community_id = ?
              AND s.assignment_id = ?
            ORDER BY s.submitted_at DESC
            `,
            [communityId, assignmentId]
          );
          const submissionIds = submissionRows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
          if (submissionIds.length > 0) {
            const placeholders = submissionIds.map(() => "?").join(", ");
            const [fileRows] = await timedVineQuery(
              perfCtx,
              "community-assignment-submissions.files",
              `
              SELECT id, submission_id, file_url, file_name, file_mime, created_at
              FROM vine_community_submission_files
              WHERE submission_id IN (${placeholders})
              ORDER BY created_at ASC, id ASC
              `,
              submissionIds
            );
            const bySubmission = {};
            for (const row of fileRows) {
              const sid = Number(row.submission_id);
              if (!bySubmission[sid]) bySubmission[sid] = [];
              bySubmission[sid].push({
                id: row.id,
                file_url: row.file_url,
                file_name: row.file_name,
                file_mime: row.file_mime,
                created_at: row.created_at,
              });
            }
            for (const row of submissionRows) {
              const sid = Number(row.id || 0);
              row.submission_files = sid > 0 ? (bySubmission[sid] || []) : [];
            }
          } else {
            for (const row of submissionRows) row.submission_files = [];
          }
          return submissionRows;
        });
      }
    );
    res.json(rows);
  } catch (err) {
    console.error("Get assignment submissions error:", err);
    res.status(500).json([]);
  }
});

router.patch("/communities/:id/submissions/:submissionId/grade", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const submissionId = Number(req.params.submissionId);
    const scoreRaw = req.body?.score;
    const feedback = String(req.body?.feedback || "").trim();
    const requestedStatus = String(req.body?.status || "graded").trim().toLowerCase();
    const status = ["graded", "needs_revision", "missing"].includes(requestedStatus)
      ? requestedStatus
      : "graded";
    const score = scoreRaw === "" || scoreRaw === null || scoreRaw === undefined ? null : Number(scoreRaw);
    if (!communityId || !submissionId) return res.status(400).json({ message: "Invalid request" });
    const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (role !== "owner") return res.status(403).json({ message: "Only community owner can grade assignments" });
    if (score !== null && !Number.isFinite(score)) return res.status(400).json({ message: "Invalid score" });

    const [[submission]] = await db.query(
      `
      SELECT
        s.id,
        s.user_id,
        s.assignment_id,
        s.graded_at,
        s.score,
        s.status,
        a.title AS assignment_title,
        a.points AS assignment_points,
        c.slug AS community_slug
      FROM vine_community_submissions s
      JOIN vine_community_assignments a ON a.id = s.assignment_id
      LEFT JOIN vine_communities c ON c.id = s.community_id
      WHERE s.id = ? AND s.community_id = ?
      LIMIT 1
      `,
      [submissionId, communityId]
    );
    if (!submission) return res.status(404).json({ message: "Submission not found" });
    const alreadyFinalized =
      submission.graded_at !== null ||
      submission.score !== null ||
      ["graded", "needs_revision", "missing"].includes(String(submission.status || "").toLowerCase());
    if (alreadyFinalized) {
      return res.status(403).json({ message: "Grade already finalized. This submission is locked." });
    }

    await db.query(
      `
      UPDATE vine_community_submissions
      SET score = ?, feedback = ?, status = ?, graded_at = NOW(), graded_by = ?, updated_at = NOW()
      WHERE id = ? AND community_id = ?
      `,
      [score, feedback || null, status || "graded", userId, submissionId, communityId]
    );

    if (Number(submission.user_id) !== userId) {
      await notifyUser({
        userId: submission.user_id,
        actorId: userId,
        type: "community_assignment_graded",
        meta: {
          community_id: communityId,
          community_slug: submission.community_slug || null,
          assignment_id: Number(submission.assignment_id || 0),
          assignment_title: submission.assignment_title || null,
          assignment_points: submission.assignment_points ?? null,
          submission_id: submissionId,
          score: score,
          status: status || "graded",
        },
      });
    }
    clearVineReadCache(
      "community-assignments",
      "community-assignment-submissions",
      "community-gradebook",
      "community-progress",
      "profile-header"
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Grade submission error:", err);
    res.status(500).json({ message: "Failed to grade submission" });
  }
});

router.get("/communities/:id/gradebook", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json([]);
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json([]);

    const cacheKey = buildVineCacheKey("community-gradebook", communityId, userId);
    const rows = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.communityGradebook, async () => {
      const [gradebookRows] = await db.query(
        `
        SELECT
          a.id AS assignment_id,
          a.title AS assignment_title,
          a.points AS assignment_points,
          a.due_at AS assignment_due_at,
          u.id AS learner_id,
          u.username AS learner_username,
          u.display_name AS learner_display_name,
          s.id AS submission_id,
          s.status AS submission_status,
          s.score AS submission_score,
          s.submitted_at AS submitted_at,
          s.graded_at AS graded_at
        FROM vine_community_assignments a
        JOIN vine_community_members m ON m.community_id = a.community_id
        JOIN vine_users u ON u.id = m.user_id
        LEFT JOIN vine_community_submissions s
          ON s.assignment_id = a.id
         AND s.user_id = u.id
        WHERE a.community_id = ?
          AND LOWER(COALESCE(m.role, 'member')) != 'owner'
        ORDER BY a.created_at DESC, u.username ASC
        `,
        [communityId]
      );
      return gradebookRows;
    });

    if (String(req.query.format || "").toLowerCase() === "csv") {
      const csvHeader = [
        "assignment_id",
        "assignment_title",
        "assignment_points",
        "assignment_due_at",
        "learner_id",
        "learner_username",
        "learner_display_name",
        "submission_id",
        "submission_status",
        "submission_score",
        "submitted_at",
        "graded_at",
      ];
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [csvHeader.join(",")];
      for (const row of rows) {
        lines.push(
          [
            row.assignment_id,
            row.assignment_title,
            row.assignment_points,
            row.assignment_due_at ? new Date(row.assignment_due_at).toISOString() : "",
            row.learner_id,
            row.learner_username,
            row.learner_display_name,
            row.submission_id,
            row.submission_status,
            row.submission_score,
            row.submitted_at ? new Date(row.submitted_at).toISOString() : "",
            row.graded_at ? new Date(row.graded_at).toISOString() : "",
          ]
            .map(esc)
            .join(",")
        );
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="community-${communityId}-gradebook.csv"`);
      return res.status(200).send(lines.join("\n"));
    }

    res.json(rows);
  } catch (err) {
    console.error("Get gradebook error:", err);
    res.status(500).json([]);
  }
});

router.get("/communities/:id/progress", authenticate, async (req, res) => {
  try {
    const viewerId = Number(req.user.id);
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json([]);

    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const role = await getCommunityRole(communityId, viewerId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json([]);

    const payload = await runVinePerfRoute(
      "community-progress",
      { community_id: communityId, viewer_id: viewerId },
      async (perfCtx) => {
        const cacheKey = buildVineCacheKey("community-progress", communityId, viewerId);
        return readThroughVineCache(cacheKey, VINE_CACHE_TTLS.communityProgress, async () => {
          const [[assignmentTotals]] = await timedVineQuery(
            perfCtx,
            "community-progress.assignment-totals",
            `SELECT COUNT(*) AS total_assignments
             FROM vine_community_assignments
             WHERE community_id = ?`,
            [communityId]
          );
          const totalAssignments = Number(assignmentTotals?.total_assignments || 0);

          const [[sessionTotals]] = await timedVineQuery(
            perfCtx,
            "community-progress.session-totals",
            `SELECT COUNT(*) AS total_sessions
             FROM vine_community_sessions
             WHERE community_id = ?
               AND starts_at <= NOW()`,
            [communityId]
          );
          const totalSessions = Number(sessionTotals?.total_sessions || 0);

          const [rows] = await timedVineQuery(
            perfCtx,
            "community-progress.rows",
            `
            SELECT
              u.id AS learner_id,
              u.username AS learner_username,
              u.display_name AS learner_display_name,
              u.avatar_url AS learner_avatar_url,
              u.is_verified AS learner_is_verified,
              m.role AS community_role,
              COALESCE(subq.submission_count, 0) AS submission_count,
              COALESCE(subq.avg_score, NULL) AS avg_score,
              COALESCE(attq.present_count, 0) AS present_count
            FROM vine_community_members m
            JOIN vine_users u ON u.id = m.user_id
            LEFT JOIN (
              SELECT
                s.user_id,
                COUNT(DISTINCT s.assignment_id) AS submission_count,
                AVG(s.score) AS avg_score
              FROM vine_community_submissions s
              WHERE s.community_id = ?
              GROUP BY s.user_id
            ) subq ON subq.user_id = m.user_id
            LEFT JOIN (
              SELECT
                a.user_id,
                COUNT(*) AS present_count
              FROM vine_community_attendance a
              JOIN vine_community_sessions sess ON sess.id = a.session_id
              WHERE a.community_id = ?
                AND sess.starts_at <= NOW()
                AND a.status = 'present'
              GROUP BY a.user_id
            ) attq ON attq.user_id = m.user_id
            WHERE m.community_id = ?
              AND LOWER(COALESCE(m.role, 'member')) != 'owner'
            ORDER BY m.role = 'owner' DESC, m.role = 'moderator' DESC, u.username ASC
            `,
            [communityId, communityId, communityId]
          );

          return rows.map((r) => {
            const submissionRate = totalAssignments > 0
              ? Math.round((Number(r.submission_count || 0) / totalAssignments) * 100)
              : 0;
            const attendanceRate = totalSessions > 0
              ? Math.round((Number(r.present_count || 0) / totalSessions) * 100)
              : 0;
            const avgScoreNum = r.avg_score === null || r.avg_score === undefined ? null : Number(r.avg_score);
            let riskFlag = "on_track";
            if (attendanceRate < 60 || submissionRate < 50 || (avgScoreNum !== null && avgScoreNum < 40)) {
              riskFlag = "at_risk";
            } else if (attendanceRate < 75 || submissionRate < 75 || (avgScoreNum !== null && avgScoreNum < 60)) {
              riskFlag = "watch";
            }

            return {
              ...r,
              total_assignments: totalAssignments,
              total_sessions: totalSessions,
              submission_rate: submissionRate,
              attendance_rate: attendanceRate,
              avg_score: avgScoreNum,
              risk_flag: riskFlag,
            };
          });
        });
      }
    );

    res.json(payload);
  } catch (err) {
    console.error("Get community progress error:", err);
    res.status(500).json([]);
  }
});

const summarizeLearnerBadges = (submissionRows = []) => {
  const submissions = Array.isArray(submissionRows) ? submissionRows : [];
  let totalOnTime = 0;
  let perfectCount = 0;
  let gradedCount = 0;
  let gradedTotal = 0;
  let normalizedCount = 0;
  let normalizedTotal = 0;

  for (const row of submissions) {
    const dueAt = row?.due_at ? new Date(row.due_at) : null;
    const submittedAt = row?.submitted_at ? new Date(row.submitted_at) : null;
    const score = Number(row?.score);
    const points = Number(row?.points);

    if (dueAt && submittedAt && submittedAt.getTime() <= dueAt.getTime()) {
      totalOnTime += 1;
    }
    if (
      row?.score !== null &&
      row?.score !== undefined &&
      Number.isFinite(score) &&
      Number.isFinite(points) &&
      points > 0 &&
      score >= points
    ) {
      perfectCount += 1;
    }
    if (row?.score !== null && row?.score !== undefined && Number.isFinite(score)) {
      gradedCount += 1;
      gradedTotal += score;
      if (Number.isFinite(points) && points > 0) {
        normalizedCount += 1;
        normalizedTotal += score / points;
      }
    }
  }

  const dueMap = new Map();
  for (const row of submissions) {
    if (!row?.due_at) continue;
    const assignmentId = Number(row.assignment_id);
    const dueAt = new Date(row.due_at).getTime();
    const submittedAt = row.submitted_at ? new Date(row.submitted_at).getTime() : null;
    const onTime = submittedAt !== null && submittedAt <= dueAt;
    if (!dueMap.has(assignmentId)) {
      dueMap.set(assignmentId, { dueAt, onTime });
    } else if (onTime) {
      const previous = dueMap.get(assignmentId);
      dueMap.set(assignmentId, { dueAt: previous.dueAt, onTime: true });
    }
  }

  const dueEntries = [...dueMap.values()].sort((a, b) => b.dueAt - a.dueAt);
  let currentStreak = 0;
  for (const entry of dueEntries) {
    if (entry.onTime) currentStreak += 1;
    else break;
  }

  const avgScore = gradedCount > 0 ? Number((gradedTotal / gradedCount).toFixed(2)) : null;
  const avgPercent =
    normalizedCount > 0 ? Number(((normalizedTotal / normalizedCount) * 100).toFixed(1)) : null;
  const badges = [];
  if (currentStreak >= 3) badges.push("🔥 On-Time Streak");
  if (perfectCount >= 1) badges.push("🎯 Perfect Score");
  if (submissions.length >= 5) badges.push("📚 Consistent Learner");
  if (avgPercent !== null && avgPercent >= 85 && gradedCount >= 3) badges.push("🏅 High Achiever");

  return {
    submission_count: submissions.length,
    total_on_time: totalOnTime,
    current_streak: currentStreak,
    avg_score: avgScore,
    avg_percent: avgPercent,
    badges,
  };
};

router.get("/communities/:id/badges-streaks", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const viewerId = Number(req.user.id);
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json([]);
    const role = await getCommunityRole(communityId, viewerId);
    if (!role) return res.status(403).json([]);

    const [members] = await db.query(
      `
      SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified
      FROM vine_community_members m
      JOIN vine_users u ON u.id = m.user_id
      WHERE m.community_id = ?
      ORDER BY u.username ASC
      `,
      [communityId]
    );

    const [rows] = await db.query(
      `
      SELECT
        s.user_id,
        s.assignment_id,
        s.submitted_at,
        s.score,
        a.points,
        a.due_at
      FROM vine_community_submissions s
      JOIN vine_community_assignments a ON a.id = s.assignment_id
      WHERE s.community_id = ?
      `,
      [communityId]
    );

    const byUser = new Map();
    for (const row of rows) {
      const key = Number(row.user_id);
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key).push(row);
    }

    const result = members.map((m) => {
      const submissions = byUser.get(Number(m.id)) || [];
      return {
        ...m,
        ...summarizeLearnerBadges(submissions),
      };
    });

    res.json(result);
  } catch (err) {
    console.error("Community badges/streaks error:", err);
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
      "SELECT creator_id, auto_welcome_enabled, welcome_message, name, slug FROM vine_communities WHERE id = ? LIMIT 1",
      [communityId]
    );
    await notifyUser({
      userId: requestRow.user_id,
      actorId: userId,
      type: "community_join_approved",
      meta: {
        community_id: communityId,
        community_slug: community?.slug || null,
        community_name: community?.name || null,
      },
    });
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
    await ensureVinePerformanceSchema();
    await ensureCommunitySchema();
    await ensurePollSchema();
    void triggerScheduledPostPublishIfDue();
    const viewerId = Number(req.user?.id || 0) || null;
    const topic = String(req.query?.topic || "").trim().toLowerCase();
    const cacheKey = buildVineCacheKey("community-posts", req.params.slug, viewerId || 0, topic || "all");
    const [[community]] = await db.query(
      "SELECT id, name, slug FROM vine_communities WHERE slug = ? LIMIT 1",
      [req.params.slug]
    );
    if (!community) return res.status(404).json([]);
    if (viewerId) {
      const allowed = await canAccessCommunityByVisibilityPolicy(viewerId, community.id);
      if (!allowed) return res.status(403).json([]);
    }

    const posts = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.communityPosts, async () => {
      const [baseRows] = await db.query(
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
          p.created_at,
          p.created_at AS sort_time,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.hide_like_counts,
          NULL AS revined_by,
          NULL AS reviner_username
        FROM vine_posts p
        JOIN vine_users u ON u.id = p.user_id
        LEFT JOIN vine_communities c ON c.id = p.community_id
        WHERE p.community_id = ?
        ${topic ? "AND p.topic_tag = ?" : ""}
        ORDER BY p.is_community_pinned DESC, p.community_pinned_at DESC, p.created_at DESC, p.id DESC
        LIMIT 100
        `,
        topic ? [community.id, topic] : [community.id]
      );
      return enrichVinePostRows(baseRows, viewerId);
    });
    res.json(posts);
  } catch (err) {
    console.error("Get community posts error:", err);
    res.status(500).json([]);
  }
});

  // create posts
router.get("/posts", authOptional, async (req, res) => {
    try {
      const viewerId = req.user?.id || null;
      const feedTag = String(req.query.tag || "").trim().replace(/^#/, "").toLowerCase();
      const feedTab = String(req.query.tab || "for-you").trim().toLowerCase() === "news" ? "news" : "for-you";
      const cursor = parseFeedCursor(req.query);
      const rows = await runVinePerfRoute(
        "feed",
        {
          viewer_id: Number(viewerId || 0),
          tag: feedTag || null,
          tab: feedTab,
          cursor_time: cursor.time ? cursor.time.toISOString() : null,
          cursor_feed_id: cursor.feedId || null,
        },
        async (perfCtx) => {
          await ensureVinePerformanceSchema();
          await ensureCommunitySchema();
          await ensurePollSchema();
          triggerNewsIngestIfDue();
          void triggerScheduledPostPublishIfDue();
          const cacheKey = buildVineCacheKey(
            "feed",
            viewerId || 0,
            feedTab,
            feedTag || "all",
            cursor.time ? cursor.time.toISOString() : "first-page",
            cursor.feedId || "start"
          );

          return readThroughVineCache(cacheKey, VINE_CACHE_TTLS.feed, async () => {
            return getFeedPageData(
              {
                viewerId,
                feedTag,
                feedTab,
                cursor,
              },
              perfCtx
            );
          });
        }
      );

      if (rows?.nextCursor?.time && rows?.nextCursor?.feedId) {
        res.set("X-Vine-Next-Cursor-Time", rows.nextCursor.time);
        res.set("X-Vine-Next-Cursor-Feed", rows.nextCursor.feedId);
      } else {
        res.set("X-Vine-Next-Cursor-Time", "");
        res.set("X-Vine-Next-Cursor-Feed", "");
      }

      res.json(Array.isArray(rows?.items) ? rows.items : []);
    } catch (err) {
      console.error("Feed error:", err);
      res.status(500).json([]);
    }
  });

router.post("/news/refresh", authenticate, async (req, res) => {
  try {
    const user = req.user || {};
    if (!isModeratorAccount(user)) {
      return res.status(403).json({ message: "Only moderators can refresh news." });
    }
    await ingestExternalNews();
    lastNewsIngestAt = Date.now();
    const schedule = await getNewsScheduleSettings();
    lastNewsIngestDayKey = getNewsZonedParts(schedule.timezone).dayKey;
    res.json({ success: true });
  } catch (err) {
    console.error("Manual news refresh error:", err);
    res.status(500).json({ message: "Failed to refresh news" });
  }
});

router.get("/news/settings", authenticate, async (req, res) => {
  try {
    const user = req.user || {};
    if (!isModeratorAccount(user)) {
      return res.status(403).json({ message: "Only moderators can view news settings." });
    }
    const settings = await getNewsScheduleSettings();
    res.json(settings);
  } catch (err) {
    console.error("News settings fetch error:", err);
    res.status(500).json({ message: "Failed to load news settings" });
  }
});

router.put("/news/settings", authenticate, async (req, res) => {
  try {
    const user = req.user || {};
    if (!isModeratorAccount(user)) {
      return res.status(403).json({ message: "Only moderators can update news settings." });
    }

    const payload = {
      timezone: req.body?.timezone,
      daily_hour: req.body?.daily_hour,
      daily_minute: req.body?.daily_minute,
      allowed_weekdays: Array.isArray(req.body?.allowed_weekdays)
        ? req.body.allowed_weekdays
        : req.body?.allowed_weekdays,
    };

    const settings = await saveNewsScheduleSettings(payload, user.id || null);
    res.json({ success: true, settings });
  } catch (err) {
    console.error("News settings update error:", err);
    res.status(500).json({ message: "Failed to save news settings" });
  }
});

router.get("/system-notice/settings", authenticate, async (req, res) => {
  try {
    const user = req.user || {};
    if (!isModeratorAccount(user)) {
      return res.status(403).json({ message: "Only moderators can view the login notice." });
    }

    const settings = await getCurrentVineSystemNotice({ includeDisabled: true });
    res.json(settings || normalizeSystemNoticeSettings({}));
  } catch (err) {
    console.error("System notice settings fetch error:", err);
    res.status(500).json({ message: "Failed to load login notice" });
  }
});

router.put("/system-notice/settings", authenticate, async (req, res) => {
  try {
    const user = req.user || {};
    if (!isModeratorAccount(user)) {
      return res.status(403).json({ message: "Only moderators can update the login notice." });
    }

    const settings = await saveSystemNoticeSettings(
      {
        enabled: req.body?.enabled,
        title: req.body?.title,
        message: req.body?.message,
      },
      user.id || null
    );

    res.json({ success: true, settings });
  } catch (err) {
    console.error("System notice settings update error:", err);
    res.status(err?.statusCode || 500).json({
      message: err?.message || "Failed to save login notice",
    });
  }
});

router.get("/news/health", authenticate, async (req, res) => {
  try {
    const user = req.user || {};
    if (!isModeratorAccount(user)) {
      return res.status(403).json({ message: "Only moderators can view news health." });
    }
    const scheduleSettings = await getNewsScheduleSettings();
    const rssFeeds = (process.env.NEWS_RSS_FEEDS || "").trim();
    const feeds = rssFeeds
      ? rssFeeds.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const checks = [];
    for (const feed of feeds.slice(0, 12)) {
      try {
        const r = await fetch(feed, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        });
        const text = r.ok ? await r.text() : "";
        const parsed = r.ok ? parseRssItems(text, new URL(feed).hostname) : [];
        const runtime = newsFeedRuntimeStats.get(feed);
        checks.push({
          feed,
          ok: r.ok,
          status: r.status,
          parsed_items: parsed.length,
          runtime: runtime || null,
        });
      } catch (err) {
        const runtime = newsFeedRuntimeStats.get(feed);
        checks.push({
          feed,
          ok: false,
          status: null,
          parsed_items: 0,
          error: String(err?.message || err),
          runtime: runtime || null,
        });
      }
    }
    const runtime_feeds = Array.from(newsFeedRuntimeStats.values()).sort((a, b) =>
      String(a.feed).localeCompare(String(b.feed))
    );

    const [[ingestRow]] = await db.query(
      "SELECT COUNT(*) AS total, MAX(ingested_at) AS last_ingested_at FROM vine_news_ingest"
    );
    const [sources] = await db.query(
      `
      SELECT source, COUNT(*) AS total
      FROM vine_news_ingest
      GROUP BY source
      ORDER BY total DESC
      LIMIT 20
      `
    );

    res.json({
      feeds: checks,
      ingest: {
        total: Number(ingestRow?.total || 0),
        last_ingested_at: ingestRow?.last_ingested_at || null,
        by_source: sources || [],
      },
      runtime: {
        in_flight: newsIngestInFlight,
        last_ingest_at: lastNewsIngestAt ? new Date(lastNewsIngestAt).toISOString() : null,
        mode: "daily",
        timezone: scheduleSettings.timezone,
        daily_hour: scheduleSettings.daily_hour,
        daily_minute: scheduleSettings.daily_minute,
        allowed_weekdays: scheduleSettings.allowed_weekdays,
        last_ingest_day_key: lastNewsIngestDayKey || null,
        feeds: runtime_feeds,
      },
    });
  } catch (err) {
    console.error("News health error:", err);
    res.status(500).json({ message: "Failed to load news health" });
  }
});

const fetchSharedPostRow = async (postId) => {
  const [[post]] = await db.query(
    `
    SELECT
      p.id,
      p.content,
      p.image_url,
      p.link_preview,
      p.created_at,
      (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
      (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,
      u.username,
      u.display_name,
      u.avatar_url
    FROM vine_posts p
    JOIN vine_users u ON u.id = p.user_id
    WHERE p.id = ?
    LIMIT 1
    `,
    [postId]
  );
  return post || null;
};

const resolveVineFrontendBase = (req) => {
  const requestProto = String(req.get("x-forwarded-proto") || req.protocol || "https")
    .split(",")[0]
    .trim() || "https";
  const requestHost = String(req.get("x-forwarded-host") || req.get("host") || "")
    .split(",")[0]
    .trim();
  const explicitBase = String(process.env.VINE_PUBLIC_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (explicitBase) return explicitBase;

  const hostName = String(requestHost || "")
    .split(":")[0]
    .trim()
    .toLowerCase();

  if (hostName === "localhost" || hostName === "127.0.0.1") {
    return "http://localhost:5173";
  }

  if (hostName === "api.stphillipsequatorial.com") {
    return "https://www.stphillipsequatorial.com";
  }

  if (hostName.startsWith("api.")) {
    return `https://www.${hostName.slice(4)}`;
  }

  if (
    hostName === "stphillipsequatorial.com" ||
    hostName === "www.stphillipsequatorial.com"
  ) {
    return "https://www.stphillipsequatorial.com";
  }

  return `${requestProto}://${requestHost}`.replace(/\/+$/, "");
};

const absolutizeVinePreviewUrl = (value, frontendBase) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${frontendBase}${raw.startsWith("/") ? "" : "/"}${raw}`;
};

const extractSharedPreviewImage = (post, frontendBase) => {
  let previewImage = "";
  try {
    const arr = JSON.parse(post?.image_url || "[]");
    if (Array.isArray(arr)) {
      previewImage =
        arr.find((u) => typeof u === "string" && isLikelyImageUrl(u)) || "";
    }
  } catch {
    previewImage = "";
  }
  if (!previewImage && post?.link_preview) {
    try {
      const link = typeof post.link_preview === "string"
        ? JSON.parse(post.link_preview)
        : post.link_preview;
      const candidate = String(link?.image || "").trim();
      previewImage = isLikelyImageUrl(candidate) ? candidate : "";
    } catch {
      previewImage = "";
    }
  }
  return absolutizeVinePreviewUrl(previewImage, frontendBase);
};

const resolveSharePreviewImageType = (value) => {
  const raw = String(value || "").toLowerCase();
  if (!raw) return "image/png";
  if (/\.avif(\?|$)/i.test(raw)) return "image/avif";
  if (/\.gif(\?|$)/i.test(raw)) return "image/gif";
  if (/\.webp(\?|$)/i.test(raw)) return "image/webp";
  if (/\.svg(\?|$)/i.test(raw)) return "image/svg+xml";
  if (/\.jpe?g(\?|$)/i.test(raw)) return "image/jpeg";
  return "image/png";
};

const fetchPreviewImagePayload = async (imageUrl) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const imageRes = await fetch(imageUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; VinePreviewBot/1.0)",
      },
    });
    if (!imageRes.ok) {
      throw new Error(`image fetch failed (${imageRes.status})`);
    }
    const contentType = String(imageRes.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      throw new Error("preview source is not an image");
    }
    const body = Buffer.from(await imageRes.arrayBuffer());
    return { body, contentType };
  } finally {
    clearTimeout(timeout);
  }
};

router.get("/share/:id/image", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!postId) return res.status(400).send("Invalid post");

    const post = await fetchSharedPostRow(postId);
    if (!post) return res.status(404).send("Post not found");

    const frontendBase = resolveVineFrontendBase(req);
    const previewImage = extractSharedPreviewImage(post, frontendBase);
    if (!previewImage) {
      return res.redirect(302, `${frontendBase}/vine-og-badge.png`);
    }

    try {
      const payload = await fetchPreviewImagePayload(previewImage);
      res.setHeader("Content-Type", payload.contentType || resolveSharePreviewImageType(previewImage));
      res.setHeader("Cache-Control", "public, max-age=900, s-maxage=900");
      return res.send(payload.body);
    } catch (err) {
      console.warn("Share preview image fallback:", err?.message || err);
      return res.redirect(302, `${frontendBase}/vine-og-badge.png`);
    }
  } catch (err) {
    console.error("Share preview image error:", err);
    return res.status(500).send("Failed to load preview image");
  }
});

router.get("/share/:id", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!postId) return res.status(400).send("Invalid post");

    const post = await fetchSharedPostRow(postId);
    if (!post) return res.status(404).send("Post not found");

    const requestProto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim() || "https";
    const requestHost = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
    const frontendBase = resolveVineFrontendBase(req);
    const appTarget = `${frontendBase}/vine/post/${postId}`;
    const requestPath = String(req.originalUrl || `/api/vine/share/${postId}`);
    const shareUrl = `${requestProto}://${requestHost}${
      requestPath.startsWith("/") ? "" : "/"
    }${requestPath}`;
    const userAgent = String(req.get("user-agent") || "").toLowerCase();
    const isSocialCrawler = /(facebookexternalhit|facebot|whatsapp|twitterbot|xbot|slackbot|discordbot|linkedinbot|telegrambot|skypeuripreview|embedly|pinterest|vkshare|googlebot|bingbot|crawler|bot)/i.test(
      userAgent
    );

    const rawText = String(post.content || "")
      .replace(/^\s*\[\[feeling:[^\]]+\]\]\s*/i, "")
      .replace(/^\s*\[\[postbg:[^\]]+\]\]\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    const sourcePreviewImage = extractSharedPreviewImage(post, frontendBase);
    const hasVisualPreview = Boolean(sourcePreviewImage);
    let previewImage = `${requestProto}://${requestHost}${String(req.baseUrl || "/api/vine")}/share/${postId}/image`;
    if (!previewImage) {
      previewImage = `${frontendBase}/vine-og-badge.png`;
    }
    if (!previewImage) {
      previewImage = `${frontendBase}/og-image.png`;
    }
    const previewImageType = resolveSharePreviewImageType(previewImage);

    const countsLine = `${Number(post.likes || 0)} likes · ${Number(post.comments || 0)} comments · ${Number(post.revines || 0)} revines`;
    const displayName = String(post.display_name || "").trim();
    const username = String(post.username || "").trim();
    const authorLine =
      displayName && username && displayName.toLowerCase() !== username.toLowerCase()
        ? `${displayName} (@${username})`
        : displayName || (username ? `@${username}` : "Someone");
    const title = `${authorLine} on SPESS Vine`;
    const previewDescription = (rawText || `Join SPESS Vine Today and see what ${post.display_name || post.username} posted.`).slice(0, 220);
    const publishedIso = new Date(post.created_at).toISOString();
    const imageAlt = hasVisualPreview
      ? rawText
        ? `${post.display_name || post.username}'s post on SPESS Vine`
        : `Post by ${post.display_name || post.username} on SPESS Vine`
      : `SPESS Vine branded preview for ${post.display_name || post.username}'s post`;
    const esc = (v) =>
      String(v || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=900, s-maxage=900");
    res.setHeader("Vary", "User-Agent");
    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="title" content="${esc(title)}" />
  <meta name="description" content="${esc(previewDescription)}" />
  <meta name="author" content="${esc(post.display_name || post.username)}" />
  <meta name="application-name" content="SPESS Vine" />
  <meta name="apple-mobile-web-app-title" content="SPESS Vine" />
  <meta name="theme-color" content="#064e3b" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="SPESS Vine" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(previewDescription)}" />
  <meta property="og:url" content="${esc(shareUrl)}" />
  <meta property="og:image" content="${esc(previewImage)}" />
  <meta property="og:image:secure_url" content="${esc(previewImage)}" />
  <meta property="og:image:type" content="${esc(previewImageType)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(imageAlt)}" />
  <meta property="article:published_time" content="${esc(publishedIso)}" />
  <meta property="article:author" content="${esc(post.display_name || post.username)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(previewDescription)}" />
  <meta name="twitter:image" content="${esc(previewImage)}" />
  <meta name="twitter:image:alt" content="${esc(imageAlt)}" />
  <meta name="image" content="${esc(previewImage)}" />
  <meta itemprop="image" content="${esc(previewImage)}" />
  <link rel="canonical" href="${esc(shareUrl)}" />
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background:
        radial-gradient(circle at top, rgba(16,185,129,0.16), transparent 34%),
        linear-gradient(180deg, #eefbf2 0%, #f8fdf9 100%);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #0f172a;
    }
    .share-card {
      width: min(100%, 620px);
      display: grid;
      gap: 16px;
      padding: 18px;
      background: rgba(255,255,255,0.98);
      border: 1px solid rgba(16,185,129,0.14);
      border-radius: 30px;
      box-shadow: 0 24px 60px rgba(15,23,42,0.12);
    }
    .share-image {
      width: 100%;
      aspect-ratio: 1200 / 630;
      object-fit: cover;
      border-radius: 22px;
      background: #dff7ea;
    }
    .share-kicker {
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #059669;
    }
    .share-title {
      font-size: 28px;
      line-height: 1.1;
      font-weight: 900;
      color: #0f3d2b;
    }
    .share-desc {
      font-size: 16px;
      line-height: 1.65;
      color: #475569;
    }
    .share-counts {
      font-size: 14px;
      font-weight: 800;
      color: #64748b;
    }
    .share-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      padding: 0 18px;
      border-radius: 999px;
      background: linear-gradient(135deg, #065f46, #10b981);
      color: #fff;
      text-decoration: none;
      font-weight: 900;
      box-shadow: 0 16px 34px rgba(16,185,129,0.22);
    }
  </style>
</head>
<body>
  ${isSocialCrawler ? "" : `<script>window.location.replace(${JSON.stringify(appTarget)});</script>`}
  <main class="share-card">
    <img class="share-image" src="${esc(previewImage)}" alt="${esc(imageAlt)}" />
    <div class="share-kicker">SPESS Vine</div>
    <div class="share-title">${esc(title)}</div>
    <div class="share-desc">${esc(previewDescription)}</div>
    <div class="share-counts">${esc(countsLine)}</div>
    <a class="share-cta" href="${esc(appTarget)}">Open in SPESS Vine</a>
  </main>
</body>
</html>`);
  } catch (err) {
    console.error("Share preview error:", err);
    res.status(500).send("Failed to load share preview");
  }
});

router.get("/posts/:id/public", authOptional, async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const viewerId = Number(req.user?.id || 0) || null;

    if (!postId) {
      return res.status(400).json({ message: "Invalid post" });
    }

    const post = await runVinePerfRoute(
      "public-post",
      { post_id: postId, viewer_id: Number(viewerId || 0) },
      async (perfCtx) => {
        await ensureVinePerformanceSchema();
        await ensurePostReactionSchema();
        const cacheKey = buildVineCacheKey("public-post", postId, viewerId || 0);
        return readThroughVineCache(cacheKey, VINE_CACHE_TTLS.publicPost, async () => {
          const row = await getVinePostRowById(postId, viewerId, perfCtx);
          return row || null;
        });
      }
    );

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (await isUserBlocked(post.user_id, viewerId) || (viewerId && await isUserBlocked(viewerId, post.user_id))) {
      return res.status(404).json({ message: "Post unavailable" });
    }

    if (Number(post.is_private) === 1 && Number(post.user_id) !== Number(viewerId || 0)) {
      if (!viewerId) {
        return res.status(403).json({ message: "This post is private" });
      }
      const [follow] = await db.query(
        "SELECT 1 FROM vine_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
        [viewerId, post.user_id]
      );
      if (!follow.length) {
        return res.status(403).json({ message: "This post is private" });
      }
    }

    res.json({
      ...post,
      reaction_counts: { like: 0, love: 0, happy: 0, sad: 0, care: 0 },
    });
  } catch (err) {
    console.error("Fetch public post failed:", err);
    res.status(500).json({ message: "Failed to fetch post" });
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
        await ensurePollSchema();
        await ensureVineRequestDedupSchema();
        const userId = req.user.id;
        const { content } = req.body;
        const clientRequestId = normalizeClientRequestId(req.body?.client_request_id);
        const pollQuestionRaw = String(req.body?.poll_question || "").trim();
        let pollOptionsRaw = req.body?.poll_options || "[]";
        const pollDurationRaw = Number(req.body?.poll_duration_hours);
        const communityId =
          req.body?.community_id !== undefined &&
          req.body?.community_id !== null &&
          String(req.body.community_id).trim() !== ""
            ? Number(req.body.community_id)
            : null;
  
        let imageUrls = [];

        if (clientRequestId) {
          const [[existingPost]] = await db.query(
            `
            SELECT id
            FROM vine_posts
            WHERE user_id = ? AND client_request_id = ?
            LIMIT 1
            `,
            [userId, clientRequestId]
          );
          if (existingPost?.id) {
            const existingRow = await getVinePostRowById(existingPost.id, userId);
            return res.json(existingRow || { id: existingPost.id });
          }
        }
  
        if (req.files?.length) {
          if (!communityId && req.files.some((f) => isPdfFile(f))) {
            return res.status(400).json({ message: "PDF uploads are only allowed in communities." });
          }
          const uploads = await asyncMapLimit(req.files, 3, async (file, idx) => {
            if (isPdfFile(file)) {
              return uploadBufferToCloudinary(file.buffer, {
                folder: "vine/community-docs",
                resource_type: "raw",
                public_id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 10)}`,
                format: "pdf",
                content_type: file.mimetype || "application/pdf",
              });
            }
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
          });

          imageUrls = uploads.map((u) => u.secure_url);
        }
  
        if ((!content || !content.trim()) && imageUrls.length === 0) {
          return res.status(400).json({ message: "Post cannot be empty" });
        }
        if (String(content || "").trim().length > VINE_POST_MAX_LENGTH) {
          return res.status(400).json({ message: "Post too long" });
        }
        let pollOptions = [];
        let pollExpiresAt = null;
        if (pollQuestionRaw) {
          try {
            pollOptions = JSON.parse(String(pollOptionsRaw || "[]"));
          } catch {
            pollOptions = [];
          }
          if (!Array.isArray(pollOptions)) pollOptions = [];
          pollOptions = pollOptions
            .map((o) => String(o || "").trim())
            .filter(Boolean)
            .slice(0, 4);
          if (pollOptions.length < 2) {
            return res.status(400).json({ message: "Poll needs at least 2 options" });
          }
          const safeDurationHours = Number.isFinite(pollDurationRaw)
            ? Math.min(24 * 30, Math.max(1, Math.floor(pollDurationRaw)))
            : 24;
          pollExpiresAt = new Date(Date.now() + safeDurationHours * 60 * 60 * 1000);
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
          if (!isCommunityModOrOwner(membership.role)) {
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
        let createdPostId = null;
        try {
          const [result] = await db.query(
            `INSERT INTO vine_posts (user_id, community_id, content, image_url, link_preview, topic_tag, client_request_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              communityId,
              content?.trim() || null,
              image_url,
              linkPreview ? JSON.stringify(linkPreview) : null,
              topicTag,
              clientRequestId || null,
            ]
          );
          createdPostId = Number(result.insertId);
        } catch (insertErr) {
          if (insertErr?.code !== "ER_DUP_ENTRY" || !clientRequestId) {
            throw insertErr;
          }
          const [[existingPost]] = await db.query(
            `
            SELECT id
            FROM vine_posts
            WHERE user_id = ? AND client_request_id = ?
            LIMIT 1
            `,
            [userId, clientRequestId]
          );
          if (!existingPost?.id) throw insertErr;
          const existingRow = await getVinePostRowById(existingPost.id, userId);
          return res.json(existingRow || { id: existingPost.id });
        }

        if (pollQuestionRaw && pollOptions.length >= 2) {
          const [pollInsert] = await db.query(
            `
            INSERT INTO vine_polls (post_id, question, expires_at, created_at)
            VALUES (?, ?, ?, NOW())
            `,
            [createdPostId, pollQuestionRaw.slice(0, 240), pollExpiresAt]
          );
          const pollId = Number(pollInsert.insertId);
          for (let i = 0; i < pollOptions.length; i += 1) {
            await db.query(
              `
              INSERT INTO vine_poll_options (poll_id, option_text, position, created_at)
              VALUES (?, ?, ?, NOW())
              `,
              [pollId, pollOptions[i].slice(0, 180), i]
            );
          }
        }

        const mentions = extractMentions(content?.trim() || "");
        await syncPostTagLinks({
          postId: createdPostId,
          actorId: userId,
          content: content?.trim() || "",
        });
        await notifyMentions({
          mentions,
          actorId: userId,
          postId: createdPostId,
          commentId: null,
          type: "mention_post",
        });
 
        const post = await getVinePostRowById(createdPostId, userId);

        emitVineFeedUpdated({
          type: "post_created",
          postId: createdPostId,
          communityId,
          authorId: userId,
        });
  
        res.json(post);
      } catch (err) {
        console.error("Create post error:", err);
        res.status(500).json({ message: "Failed to create post" });
      }
    }
  );

router.get("/posts/:id/poll", authOptional, async (req, res) => {
  try {
    await ensurePollSchema();
    const postId = Number(req.params.id);
    const viewerId = req.user?.id ? Number(req.user.id) : null;
    if (!postId) return res.status(400).json({ message: "Invalid post id" });

    const [[poll]] = await db.query(
      "SELECT id, post_id, question, expires_at FROM vine_polls WHERE post_id = ? LIMIT 1",
      [postId]
    );
    if (!poll) return res.status(404).json({ message: "Poll not found" });

    const [options] = await db.query(
      `
      SELECT
        o.id,
        o.option_text,
        o.position,
        (SELECT COUNT(*) FROM vine_poll_votes v WHERE v.option_id = o.id) AS votes
      FROM vine_poll_options o
      WHERE o.poll_id = ?
      ORDER BY o.position ASC, o.id ASC
      `,
      [poll.id]
    );

    const [[totals]] = await db.query(
      "SELECT COUNT(*) AS total_votes FROM vine_poll_votes WHERE poll_id = ?",
      [poll.id]
    );
    let userVoteOptionId = null;
    if (viewerId) {
      const [[vote]] = await db.query(
        "SELECT option_id FROM vine_poll_votes WHERE poll_id = ? AND user_id = ? LIMIT 1",
        [poll.id, viewerId]
      );
      userVoteOptionId = vote?.option_id || null;
    }

    res.json({
      poll_id: poll.id,
      post_id: poll.post_id,
      question: poll.question,
      expires_at: poll.expires_at,
      total_votes: Number(totals?.total_votes || 0),
      user_vote_option_id: userVoteOptionId,
      options: (options || []).map((o) => ({
        id: o.id,
        option_text: o.option_text,
        position: o.position,
        votes: Number(o.votes || 0),
      })),
    });
  } catch (err) {
    console.error("Get poll error:", err);
    res.status(500).json({ message: "Failed to load poll" });
  }
});

router.post("/posts/:id/poll/vote", requireVineAuth, async (req, res) => {
  try {
    await ensurePollSchema();
    const postId = Number(req.params.id);
    const userId = Number(req.user.id);
    const optionId = Number(req.body?.option_id);
    if (!postId || !optionId) return res.status(400).json({ message: "option_id is required" });

    const [[poll]] = await db.query(
      "SELECT id, expires_at FROM vine_polls WHERE post_id = ? LIMIT 1",
      [postId]
    );
    if (!poll) return res.status(404).json({ message: "Poll not found" });
    if (poll.expires_at) {
      const exp = new Date(poll.expires_at);
      if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
        return res.status(403).json({ message: "Poll has ended" });
      }
    }

    const [[option]] = await db.query(
      "SELECT id FROM vine_poll_options WHERE id = ? AND poll_id = ? LIMIT 1",
      [optionId, poll.id]
    );
    if (!option) return res.status(404).json({ message: "Option not found" });

    await db.query(
      `
      INSERT INTO vine_poll_votes (poll_id, option_id, user_id, created_at)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE option_id = VALUES(option_id), created_at = NOW()
      `,
      [poll.id, optionId, userId]
    );

    const [options] = await db.query(
      `
      SELECT
        o.id,
        o.option_text,
        o.position,
        (SELECT COUNT(*) FROM vine_poll_votes v WHERE v.option_id = o.id) AS votes
      FROM vine_poll_options o
      WHERE o.poll_id = ?
      ORDER BY o.position ASC, o.id ASC
      `,
      [poll.id]
    );
    const [[totals]] = await db.query(
      "SELECT COUNT(*) AS total_votes FROM vine_poll_votes WHERE poll_id = ?",
      [poll.id]
    );
    res.json({
      success: true,
      poll_id: poll.id,
      total_votes: Number(totals?.total_votes || 0),
      user_vote_option_id: optionId,
      options: (options || []).map((o) => ({
        id: o.id,
        option_text: o.option_text,
        position: o.position,
        votes: Number(o.votes || 0),
      })),
    });
  } catch (err) {
    console.error("Vote poll error:", err);
    res.status(500).json({ message: "Failed to vote poll" });
  }
});
    
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
    await ensureAdvancedSettingsSchema();
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
        AND COALESCE(hide_from_search, 0) = 0
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

/* =========================
   SEARCH (USERS + POSTS)
========================= */
router.get("/search", authenticate, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const viewerId = Number(req.user?.id || 0);

  if (!q) {
    return res.json({ users: [], posts: [] });
  }

  try {
    await ensureAdvancedSettingsSchema();
    await ensureVinePerformanceSchema();
    const like = `%${q}%`;

    const [users] = await db.query(
      `
      SELECT 
        id,
        username,
        display_name,
        avatar_url,
        is_verified
      FROM vine_users
      WHERE (username LIKE ? OR display_name LIKE ?)
        AND id != ?
        AND COALESCE(hide_from_search, 0) = 0
        AND NOT EXISTS (
          SELECT 1 FROM vine_mutes m
          WHERE m.muter_id = ?
            AND m.muted_id = id
        )
        AND NOT EXISTS (
          SELECT 1 FROM vine_blocks b
          WHERE (b.blocker_id = id AND b.blocked_id = ?)
             OR (b.blocker_id = ? AND b.blocked_id = id)
        )
      ORDER BY username ASC
      LIMIT 20
      `,
      [like, like, viewerId, viewerId, viewerId, viewerId]
    );

    const [posts] = await db.query(
      `
      SELECT
        p.id,
        p.content,
        p.image_url,
        p.created_at,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
        (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
        (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
        (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines
      FROM vine_posts p
      JOIN vine_users u ON u.id = p.user_id
      WHERE p.content LIKE ?
        AND NOT EXISTS (
          SELECT 1 FROM vine_blocks b
          WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
             OR (b.blocker_id = ? AND b.blocked_id = u.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM vine_mutes m
          WHERE m.muter_id = ?
            AND m.muted_id = u.id
        )
        AND (
          p.community_id IS NULL
          OR p.community_id = 0
          OR EXISTS (
            SELECT 1
            FROM vine_community_members cm
            WHERE cm.community_id = p.community_id
              AND cm.user_id = ?
          )
        )
      ORDER BY p.created_at DESC
      LIMIT 25
      `,
      [like, viewerId, viewerId, viewerId, viewerId]
    );

    res.json({ users, posts });
  } catch (err) {
    console.error("Unified search error:", err);
    res.status(500).json({ users: [], posts: [] });
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
    await ensureAdvancedSettingsSchema();
    const viewerId = req.user?.id || null;
    const [rows] = await db.query(
      `
      SELECT id, username, display_name, avatar_url, is_verified
      FROM vine_users
      WHERE (username LIKE ? OR display_name LIKE ?)
        AND id != ${viewerId || 0}
        AND COALESCE(hide_from_search, 0) = 0
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
    const list = [...rows];
    if ("all".startsWith(String(q).toLowerCase())) {
      list.unshift({
        id: -1,
        username: "all",
        display_name: "Everyone",
        avatar_url: null,
        is_verified: 0,
      });
    }
    res.json(list.slice(0, 8));
  } catch (err) {
    console.error("Mention search error:", err);
    res.status(500).json([]);
  }
});

router.get("/gifs/trending", authenticate, async (req, res) => {
  try {
    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 20)));
    const { results, error } = await fetchGiphy("trending", { limit: String(limit) });
    if (error) {
      return res.status(503).json({ message: error, results: [] });
    }
    res.json({ results });
  } catch (err) {
    console.error("GIF trending error:", err);
    res.status(500).json({ message: "Failed to load trending GIFs", results: [] });
  }
});

router.get("/gifs/search", authenticate, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 20)));
    if (!q) return res.json({ results: [] });
    const { results, error } = await fetchGiphy("search", { q, limit: String(limit) });
    if (error) {
      return res.status(503).json({ message: error, results: [] });
    }
    res.json({ results });
  } catch (err) {
    console.error("GIF search error:", err);
    res.status(500).json({ message: "Failed to search GIFs", results: [] });
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
        u.is_verified,
        COUNT(f.follower_id) AS follower_count
      FROM vine_users u
      LEFT JOIN vine_follows f ON f.following_id = u.id
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
      GROUP BY u.id, u.username, u.display_name, u.avatar_url, u.is_verified, u.created_at
      ORDER BY u.created_at DESC, u.id DESC
    `, [viewerId, viewerId, viewerId, viewerId, viewerId]);

    res.json(rows);
  } catch (err) {
    console.error("Suggestions error:", err);
    res.status(500).json([]);
  }
});

const getProfileUserPayload = async (username, viewerId, perfCtx = null) => {
  await ensureVinePerformanceSchema();
  await ensureProfileAboutSchema();
  await ensureFollowRequestSchema();
  await ensureCommunitySchema();
  await ensurePostTagSchema();

  const safeViewerId = Number(viewerId || 0);
  const cacheKey = buildVineCacheKey(
    "profile-header",
    String(username || "").trim().toLowerCase(),
    safeViewerId
  );

  return readThroughVineCache(cacheKey, VINE_CACHE_TTLS.profileHeader, async () => {
    const [[user]] = await timedVineQuery(
      perfCtx,
      "profile-header.user",
      `
      SELECT
        u.id,
        u.username,
        u.display_name,
        u.email,
        u.bio,
        u.avatar_url,
        u.banner_url,
        u.location,
        u.website,
        u.hobbies,
        u.date_of_birth,
        u.birthday_on_profile,
        u.birthday_on_profile_mode,
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
        (
          (SELECT COUNT(*) FROM vine_posts WHERE user_id = u.id) +
          (SELECT COUNT(*) FROM vine_revines WHERE user_id = u.id) +
          (
            SELECT COUNT(*)
            FROM vine_post_tags pt
            JOIN vine_posts ptag ON ptag.id = pt.post_id
            WHERE pt.tagged_user_id = u.id
              AND ptag.user_id <> u.id
          )
        ) AS post_count,
        (SELECT COUNT(*) FROM vine_follows WHERE following_id = u.id) AS follower_count,
        (SELECT COUNT(*) FROM vine_follows WHERE follower_id = u.id) AS following_count,
        ${
          safeViewerId
            ? `(SELECT COUNT(*) > 0
                 FROM vine_follows
                 WHERE follower_id = ${safeViewerId}
                   AND following_id = u.id)`
            : "0"
        } AS is_following,
        ${
          safeViewerId
            ? `(SELECT COUNT(*) > 0
                 FROM vine_follow_requests fr
                 WHERE fr.requester_id = ${safeViewerId}
                   AND fr.target_id = u.id
                   AND fr.status = 'pending')`
            : "0"
        } AS follow_request_pending,
        ${
          safeViewerId
            ? `(SELECT COUNT(*) > 0
                 FROM vine_follows
                 WHERE follower_id = u.id
                   AND following_id = ${safeViewerId})`
            : "0"
        } AS is_followed_by
      FROM vine_users u
      WHERE u.username = ?
      LIMIT 1
      `,
      [username]
    );

    if (!user) return null;

    const isSelf = safeViewerId && Number(safeViewerId) === Number(user.id);
    const isFollowing = safeViewerId && Number(user.is_following) === 1;
    const canViewAbout =
      isSelf ||
      user.about_privacy === "everyone" ||
      (user.about_privacy === "followers" && isFollowing);

    const blockedByUser = await isUserBlocked(user.id, safeViewerId);
    const blockingUser = await isUserBlocked(safeViewerId, user.id);

    if (!isSelf && blockedByUser) {
      return { user, blocked: true, privateLocked: false, isSelf, isFollowing };
    }

    user.is_blocking = blockingUser ? 1 : 0;
    user.is_muting = (await isUserMuted(safeViewerId, user.id)) ? 1 : 0;

    if (!isSelf && !user.show_last_active) {
      user.last_active_at = null;
    }

    if (!isSelf) {
      user.email = null;
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

    if (!Number(user.birthday_on_profile)) {
      user.date_of_birth = null;
    }

    const [badgeRows] = await timedVineQuery(
      perfCtx,
      "profile-header.learning-badges",
      `
      SELECT
        s.assignment_id,
        s.submitted_at,
        s.score,
        a.points,
        a.due_at
      FROM vine_community_submissions s
      JOIN vine_community_assignments a ON a.id = s.assignment_id
      WHERE s.user_id = ?
      `,
      [user.id]
    );
    user.learning_badges = summarizeLearnerBadges(badgeRows).badges;

    return {
      user,
      blocked: false,
      privateLocked: Boolean(user.is_private) && !isSelf && !isFollowing,
      isSelf,
      isFollowing,
    };
  });
};

const getProfileFeedRows = async (profileUserId, viewerId, { limit = null, offset = 0 } = {}, perfCtx = null) => {
  await ensureVinePerformanceSchema();
  await ensurePostTagSchema();
  const safeViewerId = Number(viewerId || 0);
  const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : null;
  const safeOffset = Math.max(0, Number(offset || 0));

  const cacheKey = buildVineCacheKey(
    "profile-posts",
    profileUserId,
    safeViewerId,
    safeLimit || "all",
    safeOffset
  );

  return readThroughVineCache(cacheKey, VINE_CACHE_TTLS.profilePosts, async () => {
    const branchLimit = safeLimit && safeLimit > 0 ? safeLimit + safeOffset : null;
    const profileParams = [];
    const postBranchLimitSql = branchLimit ? "LIMIT ?" : "";
    const taggedBranchLimitSql = branchLimit ? "LIMIT ?" : "";
    const revineBranchLimitSql = branchLimit ? "LIMIT ?" : "";
    const outerLimitSql = safeLimit && safeLimit > 0 ? "LIMIT ? OFFSET ?" : "";
    profileParams.push(profileUserId);
    if (branchLimit) profileParams.push(branchLimit);
    profileParams.push(profileUserId, profileUserId);
    if (branchLimit) profileParams.push(branchLimit);
    profileParams.push(profileUserId);
    if (branchLimit) profileParams.push(branchLimit);
    if (safeLimit && safeLimit > 0) {
      profileParams.push(safeLimit, safeOffset);
    }

    const [baseRows] = await timedVineQuery(
      perfCtx,
      "profile-posts.rows",
      `
      (
        SELECT
          CONCAT('post-', p.id) AS feed_id,
          p.id,
          p.user_id,
          p.community_id,
          p.topic_tag,
          p.content,
          p.image_url,
          p.link_preview,
          p.created_at,
          p.is_pinned,
          p.created_at AS sort_time,

          u.username,
          u.display_name,
          u.avatar_url,
          u.badge_type,
          u.is_verified,
          u.hide_like_counts,
          NULL AS reviner_username,
          0 AS revined_by

        FROM vine_posts p
        JOIN vine_users u ON p.user_id = u.id
        WHERE p.user_id = ?
        ORDER BY p.is_pinned DESC, p.created_at DESC, p.id DESC
        ${postBranchLimitSql}
      )
      UNION ALL

      (
        SELECT
          CONCAT('tagged-', p.id, '-', pt.tagged_user_id) AS feed_id,
          p.id,
          p.user_id,
          p.community_id,
          p.topic_tag,
          p.content,
          p.image_url,
          p.link_preview,
          p.created_at,
          0 AS is_pinned,
          p.created_at AS sort_time,

          u.username,
          u.display_name,
          u.avatar_url,
          u.badge_type,
          u.is_verified,
          u.hide_like_counts,
          NULL AS reviner_username,
          0 AS revined_by

        FROM vine_post_tags pt
        JOIN vine_posts p ON pt.post_id = p.id
        JOIN vine_users u ON p.user_id = u.id
        WHERE pt.tagged_user_id = ?
          AND p.user_id <> ?
        ORDER BY p.created_at DESC, p.id DESC
        ${taggedBranchLimitSql}
      )
      UNION ALL

      (
        SELECT
          CONCAT('revine-', r.id) AS feed_id,
          p.id,
          p.user_id,
          p.community_id,
          p.topic_tag,
          p.content,
          p.image_url,
          p.link_preview,
          p.created_at,
          p.is_pinned,
          r.created_at AS sort_time,

          u.username,
          u.display_name,
          u.avatar_url,
          u.badge_type,
          u.is_verified,
          u.hide_like_counts,
          ru.username AS reviner_username,
          1 AS revined_by

        FROM vine_revines r
        JOIN vine_posts p ON r.post_id = p.id
        JOIN vine_users u ON p.user_id = u.id
        JOIN vine_users ru ON r.user_id = ru.id
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC, r.id DESC
        ${revineBranchLimitSql}
      )
      ORDER BY is_pinned DESC, sort_time DESC, feed_id DESC
      ${outerLimitSql}
      `,
      profileParams
    );

    return enrichVinePostRows(baseRows, viewerId, perfCtx);
  });
};

router.get("/users/:username/header", authOptional, async (req, res) => {
  try {
    const viewerId = req.user?.id || null;
    const result = await runVinePerfRoute(
      "profile-header",
      { username: req.params.username, viewer_id: Number(viewerId || 0) },
      async (perfCtx) => {
        const payload = await getProfileUserPayload(req.params.username, viewerId, perfCtx);
        if (!payload) {
          return { status: 404, body: { message: "Not found" } };
        }
        return { status: 200, body: payload };
      }
    );

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("Profile header fetch error:", err);
    return res.status(500).json({ message: "Failed to load profile" });
  }
});

router.get("/users/:username/posts", authOptional, async (req, res) => {
  try {
    const viewerId = req.user?.id || null;
    const limit = Math.min(15, Math.max(1, Number(req.query.limit || 12)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const result = await runVinePerfRoute(
      "profile-posts",
      {
        username: req.params.username,
        viewer_id: Number(viewerId || 0),
        limit,
        offset,
      },
      async (perfCtx) => {
        const payload = await getProfileUserPayload(req.params.username, viewerId, perfCtx);

        if (!payload) {
          return { status: 404, body: { message: "Not found" } };
        }

        if (payload.blocked || payload.privateLocked) {
          return {
            status: 200,
            body: {
              items: [],
              hasMore: false,
              nextOffset: offset,
              blocked: payload.blocked,
              privateLocked: payload.privateLocked,
            },
          };
        }

        const rows = await getProfileFeedRows(
          payload.user.id,
          viewerId,
          {
            limit: limit + 1,
            offset,
          },
          perfCtx
        );
        const items = rows.slice(0, limit);

        return {
          status: 200,
          body: {
            items,
            hasMore: rows.length > limit,
            nextOffset: offset + items.length,
          },
        };
      }
    );

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("Profile posts fetch error:", err);
    return res.status(500).json({ message: "Failed to load posts" });
  }
});

// user profile
router.get("/users/:username", authOptional, async (req, res) => {
  try {
    const { username } = req.params;
    const viewerId = req.user?.id || null;
    const result = await runVinePerfRoute(
      "profile-full",
      { username, viewer_id: Number(viewerId || 0) },
      async (perfCtx) => {
        const payload = await getProfileUserPayload(username, viewerId, perfCtx);
        if (!payload) return { status: 404, body: { message: "Not found" } };
        if (payload.blocked) {
          return { status: 200, body: { user: payload.user, posts: [], blocked: true } };
        }

        if (payload.privateLocked) {
          return { status: 200, body: { user: payload.user, posts: [], privateLocked: true } };
        }

        const posts = await getProfileFeedRows(payload.user.id, viewerId, {}, perfCtx);
        return { status: 200, body: { user: payload.user, posts } };
      }
    );
    res.status(result.status).json(result.body);

  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: "Failed to load profile" });
  }
});
// Get comments for post (threaded, enriched)
router.get("/posts/:id/likes", authOptional, async (req, res) => {
  try {
    await ensurePostReactionSchema();
    const postId = Number(req.params.id);
    const viewerId = Number(req.user?.id || 0) || null;
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
        COALESCE(NULLIF(LOWER(l.reaction), ''), 'like') AS reaction,
        l.created_at AS liked_at
      FROM vine_likes l
      JOIN vine_users u ON u.id = l.user_id
      WHERE l.post_id = ?
      ORDER BY l.created_at DESC
      LIMIT ?
      `,
      [postId, limit]
    );

    const [reactionRows] = await db.query(
      `
      SELECT
        COALESCE(NULLIF(LOWER(reaction), ''), 'like') AS reaction,
        COUNT(*) AS total
      FROM vine_likes
      WHERE post_id = ?
      GROUP BY COALESCE(NULLIF(LOWER(reaction), ''), 'like')
      `,
      [postId]
    );

    const reactionCounts = { like: 0, love: 0, happy: 0, sad: 0, care: 0 };
    for (const row of reactionRows) {
      const key = normalizePostReaction(row.reaction);
      reactionCounts[key] = Number(row.total || 0);
    }

    let viewerReaction = null;
    if (viewerId) {
      const [[viewerRow]] = await db.query(
        `
        SELECT COALESCE(NULLIF(LOWER(reaction), ''), 'like') AS reaction
        FROM vine_likes
        WHERE post_id = ? AND user_id = ?
        LIMIT 1
        `,
        [postId, viewerId]
      );
      viewerReaction = viewerRow ? normalizePostReaction(viewerRow.reaction) : null;
    }

    res.json({
      total: Number(count?.total || 0),
      latest: users[0] || null,
      users,
      reaction_counts: reactionCounts,
      viewer_reaction: viewerReaction,
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
    const rows = await runVinePerfRoute(
      "post-comments",
      { post_id: Number(postId), viewer_id: Number(userId || 0) },
      async (perfCtx) => {
        await ensureVinePerformanceSchema();
        await ensureCommentReactionSchema();
        const cacheKey = buildVineCacheKey("post-comments", postId, userId || 0);
        return readThroughVineCache(cacheKey, VINE_CACHE_TTLS.comments, async () => {
          const [results] = await timedVineQuery(
            perfCtx,
            "post-comments.rows",
            `
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

          COUNT(DISTINCT cl.id) AS like_count,
          SUM(cl.user_id = ?) > 0 AS user_liked,
          COALESCE(MAX(CASE WHEN cl.user_id = ? THEN LOWER(cl.reaction) END), '') AS user_reaction

        FROM vine_comments c
        JOIN vine_users u ON u.id = c.user_id
        LEFT JOIN vine_comment_likes cl ON cl.comment_id = c.id
        WHERE c.post_id = ?
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `,
            [userId, userId, postId]
          );
          return results;
        });
      }
    );

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
    const rows = await runVinePerfRoute(
      "trending",
      {
        viewer_id: Number(viewerId || 0),
        limit,
      },
      async (perfCtx) => {
        await ensureVinePerformanceSchema();
        const cacheKey = buildVineCacheKey("trending", viewerId || 0, limit);
        return readThroughVineCache(cacheKey, VINE_CACHE_TTLS.trending, async () =>
          getTrendingPostRows({ viewerId, limit }, perfCtx)
        );
      }
    );

    res.json(rows);
  } catch (err) {
    console.error("Trending posts error:", err);
    res.status(500).json([]);
  }
});

// Deprecated ranked feed kept only as an emergency debug route.
router.get("/posts/_legacy-ranked-debug", authOptional, async (req, res) => {
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

    clearVineReadCache();
    res.json({
      revines: count.total,
      user_revined: !existing.length
    });
    emitVineFeedUpdated({
      type: existing.length ? "revine_removed" : "revine_added",
      postId,
      actorId: userId,
    });

  } catch (err) {
    console.error("REVINE ERROR:", err);
    res.status(500).json({ message: "Failed to revine" });
  }
});

// ❤️ Toggle like
router.post("/posts/:id/like", requireVineAuth, async (req, res) => {
  await ensurePostReactionSchema();
  const postId = req.params.id;
  const userId = req.user.id;
  const selectedReaction = normalizePostReaction(req.body?.reaction || "like");
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
    "SELECT COALESCE(NULLIF(LOWER(reaction), ''), 'like') AS reaction FROM vine_likes WHERE user_id = ? AND post_id = ?",
    [userId, postId]
  );

  let viewerReaction = selectedReaction;
  if (existing.length) {
    const currentReaction = normalizePostReaction(existing[0].reaction);
    if (currentReaction === selectedReaction) {
      await db.query(
        "DELETE FROM vine_likes WHERE user_id = ? AND post_id = ?",
        [userId, postId]
      );
      viewerReaction = null;
    } else {
      await db.query(
        "UPDATE vine_likes SET reaction = ? WHERE user_id = ? AND post_id = ?",
        [selectedReaction, userId, postId]
      );
      viewerReaction = selectedReaction;
    }
  } else {
    await db.query(
      "INSERT INTO vine_likes (user_id, post_id, reaction) VALUES (?, ?, ?)",
      [userId, postId, selectedReaction]
    );

    // ✅ Create notification (only if not liking own post)
    if (postOwnerId !== userId) {
      const muted = await isMutedBy(postOwnerId, userId);
      if (!muted) {
      await notifyUser({
        userId: postOwnerId,
        actorId: userId,
        type: "like",
        postId,
        meta: { reaction: selectedReaction },
      });
      }
    }
  }

  const [[count]] = await db.query(
    "SELECT COUNT(*) AS total FROM vine_likes WHERE post_id = ?",
    [postId]
  );

  const [reactionRows] = await db.query(
    `
    SELECT
      COALESCE(NULLIF(LOWER(reaction), ''), 'like') AS reaction,
      COUNT(*) AS total
    FROM vine_likes
    WHERE post_id = ?
    GROUP BY COALESCE(NULLIF(LOWER(reaction), ''), 'like')
    `,
    [postId]
  );
  const reactionCounts = { like: 0, love: 0, happy: 0, sad: 0, care: 0 };
  for (const row of reactionRows) {
    const key = normalizePostReaction(row.reaction);
    reactionCounts[key] = Number(row.total || 0);
  }

  res.json({
    likes: count.total,
    user_liked: Boolean(viewerReaction),
    viewer_reaction: viewerReaction,
    reaction_counts: reactionCounts,
  });
  clearVineReadCache();
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

  clearVineReadCache();
  res.json({ user_bookmarked: !existing.length });
});

// Post-view tracking is intentionally disabled in the budget-first path.
router.post("/posts/:id/view", authOptional, async (req, res) => {
  res.status(204).end();
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
    emitVineFeedUpdated({
      type: parent_comment_id ? "reply_created" : "comment_created",
      postId,
      commentId,
      actorId: userId,
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
    await ensureCommentReactionSchema();
    const commentId = req.params.id;
    const userId = req.user.id;
    const selectedReaction = normalizeCommentReaction(req.body?.reaction || "like");
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
      "SELECT COALESCE(NULLIF(LOWER(reaction), ''), 'like') AS reaction FROM vine_comment_likes WHERE user_id = ? AND comment_id = ?",
      [userId, commentId]
    );

    let viewerReaction = selectedReaction;
    if (existing.length) {
      const currentReaction = normalizeCommentReaction(existing[0].reaction);
      if (currentReaction === selectedReaction) {
        // Unlike
        await db.query(
          "DELETE FROM vine_comment_likes WHERE user_id = ? AND comment_id = ?",
          [userId, commentId]
        );
        viewerReaction = null;
      } else {
        await db.query(
          "UPDATE vine_comment_likes SET reaction = ? WHERE user_id = ? AND comment_id = ?",
          [selectedReaction, userId, commentId]
        );
        viewerReaction = selectedReaction;
      }
    } else {
      // Like
      await db.query(
        "INSERT INTO vine_comment_likes (user_id, comment_id, reaction) VALUES (?, ?, ?)",
        [userId, commentId, selectedReaction]
      );

      // 🔔 Create notification (only if not your own comment)
      if (comment.user_id !== userId) {
        const muted = await isMutedBy(comment.user_id, userId);
        if (!muted) {
        await notifyUser({
          userId: comment.user_id,
          actorId: userId,
          type: "like_comment",
          postId: comment.post_id,
          commentId,
          meta: { reaction: selectedReaction },
        });
        }
      }
    }

    const [[count]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_comment_likes WHERE comment_id = ?",
      [commentId]
    );

    const [reactionRows] = await db.query(
      `
      SELECT
        COALESCE(NULLIF(LOWER(reaction), ''), 'like') AS reaction,
        COUNT(*) AS total
      FROM vine_comment_likes
      WHERE comment_id = ?
      GROUP BY COALESCE(NULLIF(LOWER(reaction), ''), 'like')
      `,
      [commentId]
    );
    const reactionCounts = { like: 0, love: 0, happy: 0, sad: 0, care: 0 };
    for (const row of reactionRows) {
      const key = normalizeCommentReaction(row.reaction);
      reactionCounts[key] = Number(row.total || 0);
    }

    res.json({
      like_count: count.total,
      user_liked: Boolean(viewerReaction),
      user_reaction: viewerReaction,
      reaction_counts: reactionCounts,
    });
    clearVineReadCache();

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

    emitVineFeedUpdated({
      type: "comment_deleted",
      commentId: Number(commentId),
      actorId: requesterId,
    });
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
      let images = [];
      try {
        const parsed = JSON.parse(post.image_url);
        images = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      } catch {
        images = [post.image_url];
      }
      await Promise.all(images.map((url) => deleteCloudinaryByUrl(url)));
    }

    // 3️⃣ Delete post from DB
    await db.query("DELETE FROM vine_post_tags WHERE post_id = ?", [postId]).catch(() => {});
    await db.query("DELETE FROM vine_posts WHERE id = ?", [postId]);

    emitVineFeedUpdated({
      type: "post_deleted",
      postId: Number(postId),
      actorId: userId,
    });
    res.json({ success: true, message: "Post deleted" });
  } catch (err) {
    console.error("Delete Post Error:", err);
    res.status(500).json({ message: "Server error during deletion" });
  }
});

// EDIT a post (owner or moderator)
router.patch("/posts/:id", requireVineAuth, async (req, res) => {
  const postId = Number(req.params.id);
  const userId = Number(req.user.id);
  const content = String(req.body?.content || "").trim();

  if (!postId) return res.status(400).json({ message: "Invalid post id" });
  if (!content) return res.status(400).json({ message: "Post content is required" });
  if (content.length > VINE_POST_MAX_LENGTH) {
    return res.status(400).json({ message: "Post too long" });
  }

  try {
    const [[post]] = await db.query(
      "SELECT id, user_id FROM vine_posts WHERE id = ? LIMIT 1",
      [postId]
    );
    if (!post) return res.status(404).json({ message: "Post not found" });

    const isModerator = isModeratorAccount(req.user);
    if (Number(post.user_id) !== userId && !isModerator) {
      return res.status(403).json({ message: "Not allowed" });
    }

    await db.query(
      "UPDATE vine_posts SET content = ?, updated_at = NOW() WHERE id = ?",
      [content, postId]
    );

    await syncPostTagLinks({
      postId,
      actorId: userId,
      content,
    });

    clearVineReadCache();
    return res.json({ success: true });
  } catch (err) {
    console.error("Edit post error:", err);
    return res.status(500).json({ message: "Failed to edit post" });
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

    clearVineReadCache();
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

      clearVineReadCache();
      res.json({ banner_url: bannerUrl });

    } catch (err) {
      console.error("Banner upload error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  }
);
//update profile
router.post("/users/update-profile", authenticate, async (req, res) => {
  let conn;
  try {
    await ensureProfileAboutSchema();
    const {
      email,
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

    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (normalizedEmail) {
      const [[existing]] = await db.query(
        "SELECT id FROM vine_users WHERE email = ? AND id != ? LIMIT 1",
        [normalizedEmail, req.user.id]
      );
      if (existing) {
        return res.status(409).json({ message: "Email already in use" });
      }
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    await conn.query(
      `
      UPDATE vine_users
      SET 
        email = COALESCE(?, email),
        bio = ?,
        location = ?,
        website = ?,
        hobbies = ?,
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
        normalizedEmail || null,
        bio || null,
        location || null,
        website || null,
        hobbies || null,
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

    let displayNameResult = null;
    const normalizedDisplayName = normalizeDisplayNameInput(display_name);
    if (normalizedDisplayName) {
      displayNameResult = await updateUserDisplayName(conn, req.user.id, normalizedDisplayName);
    }

    let birthdayResult = null;
    const normalizedBirthday = String(date_of_birth || "").trim();
    if (normalizedBirthday) {
      birthdayResult = await updateUserBirthday(conn, req.user.id, normalizedBirthday);
    }

    await conn.commit();
    conn.release();
    conn = null;

    clearVineReadCache();
    res.json({
      success: true,
      ...(displayNameResult ? { display_name: displayNameResult } : {}),
      ...(birthdayResult ? { birthday: birthdayResult } : {}),
    });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback failures
      }
      conn.release();
    }
    console.error("Update profile error:", err);
    res.status(err?.statusCode || 500).json({
      message: err?.message || "Failed to update profile",
      ...(err?.details || {}),
    });
  }
});

router.patch("/users/me/birthday", authenticate, async (req, res) => {
  let conn;
  try {
    await ensureProfileAboutSchema();
    conn = await db.getConnection();
    await conn.beginTransaction();
    const result = await updateUserBirthday(conn, req.user.id, req.body?.date_of_birth);
    await conn.commit();
    conn.release();
    conn = null;
    clearVineReadCache();
    res.json(result);
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback failures
      }
      conn.release();
    }
    console.error("Update birthday error:", err);
    res.status(err?.statusCode || 500).json({
      message: err?.message || "Failed to save birthday",
      ...(err?.details || {}),
    });
  }
});

router.patch("/users/me/display-name", authenticate, async (req, res) => {
  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();
    const result = await updateUserDisplayName(conn, req.user.id, req.body?.display_name);
    await conn.commit();
    conn.release();
    conn = null;
    clearVineReadCache();
    res.json(result);
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback failures
      }
      conn.release();
    }
    console.error("Update display name error:", err);
    res.status(err?.statusCode || 500).json({
      message: err?.message || "Failed to save display name",
      ...(err?.details || {}),
    });
  }
});

// update privacy/settings
router.patch("/users/me/settings", authenticate, async (req, res) => {
  try {
    await ensureProfileAboutSchema();
    await ensureAdvancedSettingsSchema();
    const {
      dm_privacy,
      is_private,
      hide_like_counts,
      show_last_active,
      about_privacy,
      two_factor_email,
      mentions_privacy,
      tags_privacy,
      hide_from_search,
      notif_inapp_likes,
      notif_inapp_comments,
      notif_inapp_mentions,
      notif_inapp_messages,
      notif_inapp_reports,
      notif_email_likes,
      notif_email_comments,
      notif_email_mentions,
      notif_email_messages,
      notif_email_reports,
      quiet_hours_enabled,
      quiet_hours_start,
      quiet_hours_end,
      notif_digest,
      muted_words,
      autoplay_media,
      blur_sensitive_media,
      birthday_on_profile,
      birthday_on_profile_mode,
    } = req.body || {};

    const allowedDm = new Set(["everyone", "followers", "no_one"]);
    const allowedAbout = new Set(["everyone", "followers", "no_one"]);
    const allowedMentions = new Set(["everyone", "followers", "no_one"]);
    const allowedTags = new Set(["everyone", "followers", "no_one"]);
    const allowedDigest = new Set(["instant", "hourly", "daily"]);
    const allowedBirthdayModes = new Set(["month_day", "full_year"]);
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

    if (two_factor_email !== undefined) {
      updates.push("two_factor_email = ?");
      params.push(two_factor_email ? 1 : 0);
    }

    if (mentions_privacy !== undefined) {
      if (!allowedMentions.has(String(mentions_privacy))) {
        return res.status(400).json({ message: "Invalid mentions_privacy" });
      }
      updates.push("mentions_privacy = ?");
      params.push(mentions_privacy);
    }

    if (tags_privacy !== undefined) {
      if (!allowedTags.has(String(tags_privacy))) {
        return res.status(400).json({ message: "Invalid tags_privacy" });
      }
      updates.push("tags_privacy = ?");
      params.push(tags_privacy);
    }

    if (hide_from_search !== undefined) {
      updates.push("hide_from_search = ?");
      params.push(hide_from_search ? 1 : 0);
    }

    const boolFields = [
      ["notif_inapp_likes", notif_inapp_likes],
      ["notif_inapp_comments", notif_inapp_comments],
      ["notif_inapp_mentions", notif_inapp_mentions],
      ["notif_inapp_messages", notif_inapp_messages],
      ["notif_inapp_reports", notif_inapp_reports],
      ["notif_email_likes", notif_email_likes],
      ["notif_email_comments", notif_email_comments],
      ["notif_email_mentions", notif_email_mentions],
      ["notif_email_messages", notif_email_messages],
      ["notif_email_reports", notif_email_reports],
      ["quiet_hours_enabled", quiet_hours_enabled],
      ["autoplay_media", autoplay_media],
      ["blur_sensitive_media", blur_sensitive_media],
    ];
    for (const [field, value] of boolFields) {
      if (value !== undefined) {
        updates.push(`${field} = ?`);
        params.push(value ? 1 : 0);
      }
    }

    if (quiet_hours_start !== undefined) {
      updates.push("quiet_hours_start = ?");
      params.push(String(quiet_hours_start || "").slice(0, 5) || "22:00");
    }
    if (quiet_hours_end !== undefined) {
      updates.push("quiet_hours_end = ?");
      params.push(String(quiet_hours_end || "").slice(0, 5) || "07:00");
    }
    if (notif_digest !== undefined) {
      if (!allowedDigest.has(String(notif_digest))) {
        return res.status(400).json({ message: "Invalid notif_digest" });
      }
      updates.push("notif_digest = ?");
      params.push(notif_digest);
    }
    if (muted_words !== undefined) {
      updates.push("muted_words = ?");
      params.push(String(muted_words || "").slice(0, 5000) || null);
    }

    if (birthday_on_profile !== undefined) {
      updates.push("birthday_on_profile = ?");
      params.push(birthday_on_profile ? 1 : 0);
    }

    if (birthday_on_profile_mode !== undefined) {
      if (!allowedBirthdayModes.has(String(birthday_on_profile_mode))) {
        return res.status(400).json({ message: "Invalid birthday_on_profile_mode" });
      }
      updates.push("birthday_on_profile_mode = ?");
      params.push(String(birthday_on_profile_mode));
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
      SELECT dm_privacy, is_private, hide_like_counts, show_last_active, about_privacy,
             two_factor_email, mentions_privacy, tags_privacy, hide_from_search,
             notif_inapp_likes, notif_inapp_comments, notif_inapp_mentions, notif_inapp_messages, notif_inapp_reports,
             notif_email_likes, notif_email_comments, notif_email_mentions, notif_email_messages, notif_email_reports,
             quiet_hours_enabled, quiet_hours_start, quiet_hours_end, notif_digest,
             muted_words, autoplay_media, blur_sensitive_media,
             birthday_on_profile, birthday_on_profile_mode
      FROM vine_users
      WHERE id = ?
      `,
      [req.user.id]
    );

    clearVineReadCache();
    res.json({ success: true, user });
  } catch (err) {
    console.error("Update settings error:", err);
    res.status(500).json({ message: "Failed to update settings" });
  }
});

router.get("/users/me/preferences", authenticate, async (req, res) => {
  try {
    await ensureProfileAboutSchema();
    await ensureAdvancedSettingsSchema();
    const birthdayEditState = await getBirthdayEditState(db, req.user.id);
    const displayNameEditState = await getDisplayNameEditState(db, req.user.id);
    const [[prefs]] = await db.query(
      `
      SELECT display_name, dm_privacy, is_private, hide_like_counts, show_last_active, about_privacy, date_of_birth,
             birthday_on_profile, birthday_on_profile_mode,
             two_factor_email, mentions_privacy, tags_privacy, hide_from_search,
             notif_inapp_likes, notif_inapp_comments, notif_inapp_mentions, notif_inapp_messages, notif_inapp_reports,
             notif_email_likes, notif_email_comments, notif_email_mentions, notif_email_messages, notif_email_reports,
             quiet_hours_enabled, quiet_hours_start, quiet_hours_end, notif_digest,
             muted_words, autoplay_media, blur_sensitive_media,
             last_seen_notice_version,
             deactivated_at, delete_requested_at
      FROM vine_users
      WHERE id = ?
      LIMIT 1
      `,
      [req.user.id]
    );
    const currentNotice = await getCurrentVineSystemNotice();
    const lastSeenNoticeVersion = String(prefs?.last_seen_notice_version || "").trim();
    const systemNotice = currentNotice
      ? {
          ...currentNotice,
          last_seen_notice_version: lastSeenNoticeVersion || null,
          needs_ack: lastSeenNoticeVersion !== currentNotice.version,
        }
      : null;

    res.json({
      ...(prefs || {}),
      ...birthdayEditState,
      ...displayNameEditState,
      system_notice: systemNotice,
    });
  } catch (err) {
    console.error("Get preferences error:", err);
    res.status(500).json({ message: "Failed to load preferences" });
  }
});

router.post("/system-notice/ack", authenticate, async (req, res) => {
  try {
    const currentNotice = await getCurrentVineSystemNotice();
    if (!currentNotice) {
      return res.json({ success: true, version: null });
    }

    await db.query(
      `
      UPDATE vine_users
      SET last_seen_notice_version = ?
      WHERE id = ?
      `,
      [currentNotice.version, req.user.id]
    );

    res.json({ success: true, version: currentNotice.version });
  } catch (err) {
    console.error("Acknowledge system notice error:", err);
    res.status(500).json({ message: "Failed to save notice acknowledgment" });
  }
});

router.get("/birthdays/upcoming", authenticate, async (req, res) => {
  try {
    await ensureProfileAboutSchema();
    const viewerId = Number(req.user.id || 0);
    const safeDays = Math.max(1, Math.min(60, Number(req.query.days || 14)));
    const cacheKey = buildVineCacheKey("birthdays", viewerId, safeDays);

    const payload = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.birthdays, async () => {
      const [rows] = await timedVineQuery(
        null,
        "birthdays-upcoming.users",
        `
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.date_of_birth,
          u.about_privacy,
          (
            SELECT COUNT(*) > 0
            FROM vine_follows f
            WHERE f.follower_id = ? AND f.following_id = u.id
          ) AS is_following,
          (
            SELECT COUNT(*) > 0
            FROM vine_follows f
            WHERE f.follower_id = u.id AND f.following_id = ?
          ) AS is_followed_by
        FROM vine_users u
        WHERE u.id != ?
          AND u.date_of_birth IS NOT NULL
          AND LOWER(COALESCE(u.username, '')) NOT IN ('vine guardian', 'vine_guardian', 'vine news', 'vine_news')
          AND LOWER(COALESCE(u.badge_type, '')) NOT IN ('guardian', 'news')
          AND NOT EXISTS (
            SELECT 1
            FROM vine_blocks b
            WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
               OR (b.blocker_id = ? AND b.blocked_id = u.id)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM vine_mutes m
            WHERE m.muter_id = ? AND m.muted_id = u.id
          )
        `,
        [viewerId, viewerId, viewerId, viewerId, viewerId, viewerId]
      );

      const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => {
        const privacy = String(row.about_privacy || "everyone").toLowerCase();
        if (privacy === "everyone") return true;
        if (privacy === "followers") return Number(row.is_following) === 1;
        return false;
      });

      const rankedBirthdays = visibleRows
        .map((row) => {
          const birthdayData = getUpcomingBirthdayData(row.date_of_birth);
          if (!birthdayData || birthdayData.daysUntil > safeDays) return null;
          return {
            id: Number(row.id || 0),
            username: row.username || "",
            display_name: row.display_name || row.username || "",
            avatar_url: row.avatar_url || "",
            is_verified: Number(row.is_verified || 0),
            badge_type: row.badge_type || null,
            next_birthday_at: birthdayData.nextBirthdayAt,
            days_until: birthdayData.daysUntil,
            birth_month: birthdayData.birthMonth,
            birth_day: birthdayData.birthDay,
            is_following: Number(row.is_following || 0),
            is_followed_by: Number(row.is_followed_by || 0),
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          if (a.days_until !== b.days_until) return a.days_until - b.days_until;
          if (a.birth_month !== b.birth_month) return a.birth_month - b.birth_month;
          if (a.birth_day !== b.birth_day) return a.birth_day - b.birth_day;
          return String(a.display_name || a.username).localeCompare(String(b.display_name || b.username));
        });

      return {
        today: rankedBirthdays.filter((row) => row.days_until === 0).slice(0, 8),
        upcoming: rankedBirthdays.filter((row) => row.days_until > 0).slice(0, 12),
        window_days: safeDays,
      };
    });

    res.json(payload);
  } catch (err) {
    console.error("Upcoming birthdays error:", err);
    res.status(500).json({ message: "Failed to load birthdays" });
  }
});

router.get("/users/me/sessions", authenticate, async (req, res) => {
  try {
    await ensureAdvancedSettingsSchema();
    const [rows] = await db.query(
      `
      SELECT id, session_jti, device_info, ip_address, created_at, last_seen_at, revoked_at
      FROM vine_user_sessions
      WHERE user_id = ?
      ORDER BY last_seen_at DESC, created_at DESC
      LIMIT 30
      `,
      [req.user.id]
    );
    const currentJti = String(req.user?.jti || "");
    res.json(
      (rows || []).map((row) => ({
        ...row,
        is_current: currentJti && String(row.session_jti) === currentJti,
      }))
    );
  } catch (err) {
    console.error("Get sessions error:", err);
    res.status(500).json([]);
  }
});

router.post("/users/me/sessions/logout-all", authenticate, async (req, res) => {
  try {
    await ensureAdvancedSettingsSchema();
    const currentJti = String(req.user?.jti || "");
    if (currentJti) {
      await db.query(
        "UPDATE vine_user_sessions SET revoked_at = NOW() WHERE user_id = ? AND session_jti != ? AND revoked_at IS NULL",
        [req.user.id, currentJti]
      );
    } else {
      await db.query(
        "UPDATE vine_user_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
        [req.user.id]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Logout all sessions error:", err);
    res.status(500).json({ message: "Failed to log out sessions" });
  }
});

router.get("/users/me/export", authenticate, async (req, res) => {
  try {
    const format = String(req.query.format || "json").toLowerCase();
    const userId = req.user.id;
    const [[user]] = await db.query(
      "SELECT id, username, display_name, email, bio, created_at FROM vine_users WHERE id = ? LIMIT 1",
      [userId]
    );
    const [posts] = await db.query(
      "SELECT id, content, created_at FROM vine_posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000",
      [userId]
    );
    const [comments] = await db.query(
      "SELECT id, post_id, content, created_at FROM vine_comments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000",
      [userId]
    );
    const [likes] = await db.query(
      "SELECT post_id, created_at FROM vine_likes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000",
      [userId]
    );

    if (format === "csv") {
      const csvRows = [
        ["section", "id", "ref", "content", "created_at"].join(","),
        ...posts.map((p) => ["post", p.id, "", JSON.stringify(p.content || ""), p.created_at].join(",")),
        ...comments.map((c) => ["comment", c.id, c.post_id, JSON.stringify(c.content || ""), c.created_at].join(",")),
        ...likes.map((l, idx) => ["like", idx + 1, l.post_id, "", l.created_at].join(",")),
      ].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="vine-data-export.csv"');
      return res.send(csvRows);
    }

    res.json({
      exported_at: new Date().toISOString(),
      user: user || null,
      posts: posts || [],
      comments: comments || [],
      likes: likes || [],
    });
  } catch (err) {
    console.error("Export data error:", err);
    res.status(500).json({ message: "Failed to export data" });
  }
});

router.post("/users/me/deactivate", authenticate, async (req, res) => {
  try {
    await ensureAdvancedSettingsSchema();
    const [[user]] = await db.query(
      "SELECT email, display_name, username FROM vine_users WHERE id = ? LIMIT 1",
      [req.user.id]
    );
    const now = new Date();
    const dueAt = getAccountDeletionDueAt(now);
    await db.query(
      "UPDATE vine_users SET deactivated_at = NOW(), delete_requested_at = NOW() WHERE id = ?",
      [req.user.id]
    );
    await db.query(
      "UPDATE vine_user_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
      [req.user.id]
    ).catch(() => {});
    sendVineDeletionScheduledEmail(
      user?.email,
      user?.display_name || user?.username || "Viner",
      dueAt
    ).catch((err) => console.warn("Deletion scheduled email failed:", err?.message || err));
    res.json({ success: true, delete_requested_at: now.toISOString(), deletion_due_at: dueAt?.toISOString() || null });
  } catch (err) {
    console.error("Deactivate account error:", err);
    res.status(500).json({ message: "Failed to deactivate account" });
  }
});

router.post("/users/me/delete-request", authenticate, async (req, res) => {
  try {
    await ensureAdvancedSettingsSchema();
    const [[user]] = await db.query(
      "SELECT email, display_name, username FROM vine_users WHERE id = ? LIMIT 1",
      [req.user.id]
    );
    const now = new Date();
    const dueAt = getAccountDeletionDueAt(now);
    await db.query(
      "UPDATE vine_users SET delete_requested_at = NOW(), deactivated_at = COALESCE(deactivated_at, NOW()) WHERE id = ?",
      [req.user.id]
    );
    sendVineDeletionScheduledEmail(
      user?.email,
      user?.display_name || user?.username || "Viner",
      dueAt
    ).catch((err) => console.warn("Deletion request email failed:", err?.message || err));
    res.json({ success: true, delete_requested_at: now.toISOString(), deletion_due_at: dueAt?.toISOString() || null });
  } catch (err) {
    console.error("Delete request error:", err);
    res.status(500).json({ message: "Failed to submit delete request" });
  }
});

router.post("/users/me/cancel-deletion", authenticate, async (req, res) => {
  try {
    await ensureAdvancedSettingsSchema();
    const [[user]] = await db.query(
      "SELECT email, display_name, username, delete_requested_at FROM vine_users WHERE id = ? LIMIT 1",
      [req.user.id]
    );
    if (!user?.delete_requested_at) {
      return res.json({ success: true, pending: false });
    }
    await db.query(
      "UPDATE vine_users SET delete_requested_at = NULL, deactivated_at = NULL WHERE id = ?",
      [req.user.id]
    );
    sendVineDeletionCancelledEmail(
      user?.email,
      user?.display_name || user?.username || "Viner"
    ).catch((err) => console.warn("Deletion cancelled email failed:", err?.message || err));
    res.json({ success: true, pending: false });
  } catch (err) {
    console.error("Cancel deletion error:", err);
    res.status(500).json({ message: "Failed to cancel deletion" });
  }
});

// follow
router.post("/users/:id/follow", authenticate, async (req, res) => {
  try {
    await ensureFollowRequestSchema();
    const targetId = Number(req.params.id);   // person being followed
    const actorId = req.user.id;              // person doing the following

    if (targetId === actorId) {
      return res.status(400).json({ message: "Cannot follow yourself" });
    }
    if (await isUserBlocked(targetId, actorId)) {
      return res.status(403).json({ message: "You have been blocked" });
    }
    const [[targetUser]] = await db.query(
      "SELECT id, is_private FROM vine_users WHERE id = ? LIMIT 1",
      [targetId]
    );
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }
    const [[alreadyFollowing]] = await db.query(
      "SELECT 1 AS ok FROM vine_follows WHERE follower_id = ? AND following_id = ? LIMIT 1",
      [actorId, targetId]
    );
    if (alreadyFollowing?.ok) {
      return res.json({ success: true, following: true, pending: false });
    }

    if (Number(targetUser.is_private) === 1) {
      await db.query(
        `
        INSERT INTO vine_follow_requests (requester_id, target_id, status, created_at, reviewed_at, reviewed_by)
        VALUES (?, ?, 'pending', NOW(), NULL, NULL)
        ON DUPLICATE KEY UPDATE status = 'pending', created_at = NOW(), reviewed_at = NULL, reviewed_by = NULL
        `,
        [actorId, targetId]
      );
      const muted = await isMutedBy(targetId, actorId);
      if (!muted) {
        await db.query(
          `INSERT INTO vine_notifications (user_id, actor_id, type)
           VALUES (?, ?, 'follow_request')`,
          [targetId, actorId]
        );
        io.to(`user-${targetId}`).emit("notification");
      }
      clearVineReadCache();
      return res.json({ success: true, following: false, pending: true });
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

    clearVineReadCache();
    res.json({ success: true, following: true, pending: false });

  } catch (err) {
    console.error("FOLLOW ERROR:", err);
    res.status(500).json({ message: "Failed to follow" });
  }
});

// unfollow
router.delete("/users/:id/follow", authenticate, async (req, res) => {
  await ensureFollowRequestSchema();
  await db.query(
    "DELETE FROM vine_follows WHERE follower_id = ? AND following_id = ?",
    [req.user.id, req.params.id]
  );
  await db.query(
    "DELETE FROM vine_follow_requests WHERE requester_id = ? AND target_id = ?",
    [req.user.id, req.params.id]
  );
  clearVineReadCache();
  res.json({ success: true });
});

router.get("/users/me/follow-requests", authenticate, async (req, res) => {
  try {
    await ensureFollowRequestSchema();
    const userId = Number(req.user.id);
    const [rows] = await db.query(
      `
      SELECT
        fr.id,
        fr.requester_id,
        fr.created_at,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified
      FROM vine_follow_requests fr
      JOIN vine_users u ON u.id = fr.requester_id
      WHERE fr.target_id = ?
        AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
      `,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Follow requests list error:", err);
    res.status(500).json([]);
  }
});

router.post("/users/follow-requests/:id/respond", authenticate, async (req, res) => {
  try {
    await ensureFollowRequestSchema();
    const requestId = Number(req.params.id);
    const userId = Number(req.user.id);
    const action = String(req.body?.action || "").toLowerCase();
    if (!requestId) return res.status(400).json({ message: "Invalid request id" });
    if (!["accept", "reject"].includes(action)) {
      return res.status(400).json({ message: "Invalid action" });
    }

    const [[requestRow]] = await db.query(
      `
      SELECT id, requester_id, target_id, status
      FROM vine_follow_requests
      WHERE id = ?
      LIMIT 1
      `,
      [requestId]
    );
    if (!requestRow) return res.status(404).json({ message: "Request not found" });
    if (Number(requestRow.target_id) !== userId) {
      return res.status(403).json({ message: "Not allowed" });
    }
    if (String(requestRow.status || "").toLowerCase() !== "pending") {
      return res.status(400).json({ message: "Request already handled" });
    }

    if (action === "accept") {
      await db.query(
        "INSERT IGNORE INTO vine_follows (follower_id, following_id) VALUES (?, ?)",
        [requestRow.requester_id, userId]
      );
      await db.query(
        `
        UPDATE vine_follow_requests
        SET status = 'accepted', reviewed_at = NOW(), reviewed_by = ?
        WHERE id = ?
        `,
        [userId, requestId]
      );
      const muted = await isMutedBy(requestRow.requester_id, userId);
      if (!muted) {
        await db.query(
          `INSERT INTO vine_notifications (user_id, actor_id, type)
           VALUES (?, ?, 'follow_request_accepted')`,
          [requestRow.requester_id, userId]
        );
        io.to(`user-${requestRow.requester_id}`).emit("notification");
      }
      clearVineReadCache();
      return res.json({ success: true, status: "accepted" });
    }

    await db.query(
      `
      UPDATE vine_follow_requests
      SET status = 'rejected', reviewed_at = NOW(), reviewed_by = ?
      WHERE id = ?
      `,
      [userId, requestId]
    );
    clearVineReadCache();
    res.json({ success: true, status: "rejected" });
  } catch (err) {
    console.error("Follow request respond error:", err);
    res.status(500).json({ message: "Failed to respond to request" });
  }
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
    clearVineReadCache();
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
    clearVineReadCache();
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
    clearVineReadCache();
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
    clearVineReadCache();
    res.json({ success: true });
  } catch (err) {
    console.error("Unblock error:", err);
    res.status(500).json({ message: "Failed to unblock user" });
  }
});
// Get followers of a user
router.get("/users/:username/followers", authOptional, async (req, res) => {
  try {
    await ensureVinePerformanceSchema();
    const { username } = req.params;
    const viewerId = req.user?.id || null;
    const cacheKey = buildVineCacheKey("followers", username.toLowerCase(), viewerId || 0);

    const [[user]] = await db.query(
      "SELECT id FROM vine_users WHERE username = ?",
      [username]
    );
    if (!user) return res.status(404).json({ message: "Not found" });

    const rows = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.followers, async () => {
      const [results] = await db.query(`
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
          } AS is_following,
          ${
            viewerId
              ? `(SELECT COUNT(*) > 0 FROM vine_follow_requests fr
                  WHERE fr.requester_id = ${viewerId}
                    AND fr.target_id = u.id
                    AND fr.status = 'pending')`
              : "0"
          } AS is_follow_requested
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
      return results;
    });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load followers" });
  }
});
// Get users someone is following
router.get("/users/:username/following", authOptional, async (req, res) => {
  try {
    await ensureVinePerformanceSchema();
    const { username } = req.params;
    const viewerId = req.user?.id || null;
    const cacheKey = buildVineCacheKey("following", username.toLowerCase(), viewerId || 0);

    const [[user]] = await db.query(
      "SELECT id FROM vine_users WHERE username = ?",
      [username]
    );
    if (!user) return res.status(404).json({ message: "Not found" });

    const rows = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.following, async () => {
      const [results] = await db.query(`
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
          } AS is_following,
          ${
            viewerId
              ? `(SELECT COUNT(*) > 0 FROM vine_follow_requests fr
                  WHERE fr.requester_id = ${viewerId}
                    AND fr.target_id = u.id
                    AND fr.status = 'pending')`
              : "0"
          } AS is_follow_requested
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
      return results;
    });

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
      enabled: VINE_PERF_LOGS_ENABLED,
      console_enabled: VINE_PERF_CONSOLE_LOGS_ENABLED,
      thresholds: {
        vine_slow_route_ms: VINE_SLOW_ROUTE_MS,
        vine_slow_query_ms: VINE_SLOW_QUERY_MS,
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
  try {
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

    res.json(rows);
  } catch (err) {
    console.error("Get notifications error:", err);
    res.status(500).json([]);
  }
});
// Get unread count
router.get("/notifications/unread-count", authenticate, async (req, res) => {
  await ensureVinePerformanceSchema();
  const viewerId = Number(req.user.id);
  const [[row]] = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM vine_notifications n
    WHERE n.user_id = ?
      AND n.is_read = 0
      AND NOT EXISTS (
        SELECT 1
        FROM vine_mutes m
        WHERE m.muter_id = n.user_id AND m.muted_id = n.actor_id
      )
    `,
    [viewerId]
  );

  res.json({ count: Number(row?.total || 0) });
});

// Count notifications received since a given timestamp (ignores is_read)
router.get("/notifications/unseen-count", authenticate, async (req, res) => {
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
      AND n.created_at > ?
      AND NOT EXISTS (
        SELECT 1
        FROM vine_mutes m
        WHERE m.muter_id = n.user_id AND m.muted_id = n.actor_id
      )
    `,
    [viewerId, since]
  );

  res.json({ count: Number(row?.total || 0) });
});
// Mark all as read
router.post("/notifications/mark-read", authenticate, async (req, res) => {
  await db.query(
    "UPDATE vine_notifications SET is_read = 1 WHERE user_id = ?",
    [req.user.id]
  );

  clearVineReadCache("notifications", "notifications-unread", "notifications-unseen");
  res.json({ success: true });
});
// Mark single notification as read
router.post("/notifications/:id/read", authenticate, async (req, res) => {
  await db.query(
    "UPDATE vine_notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
    [req.params.id, req.user.id]
  );

  clearVineReadCache("notifications", "notifications-unread", "notifications-unseen");
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

  clearVineReadCache();
  res.json({ success: true });
});
// ❤️ GET liked posts by a user (Profile Likes tab)
router.get("/users/:username/likes", authOptional, async (req, res) => {
  const { username } = req.params;
  const viewerId = req.user?.id || null;

  try {
    await ensureVinePerformanceSchema();
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
    const cacheKey = buildVineCacheKey(
      "profile-likes",
      username.toLowerCase(),
      Number(viewerId || 0)
    );
    const rows = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.profileLikes, async () => {
      const [baseRows] = await db.query(
        `
        SELECT DISTINCT
          p.id,
          CONCAT('post-', p.id) AS feed_id,
          p.user_id,
          p.community_id,
          p.topic_tag,
          p.content,
          p.image_url,
          p.link_preview,
          p.created_at,
          l.created_at AS sort_time,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.hide_like_counts,
          NULL AS reviner_username,
          0 AS revined_by
        FROM vine_likes l
        JOIN vine_posts p ON l.post_id = p.id
        JOIN vine_users u ON p.user_id = u.id
        WHERE l.user_id = ?
        ORDER BY sort_time DESC, p.id DESC
        `,
        [user.id]
      );
      return enrichVinePostRows(baseRows, viewerId);
    });

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
    await ensureVinePerformanceSchema();
    await ensurePostTagSchema();
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
    const cacheKey = buildVineCacheKey(
      "profile-photos",
      username.toLowerCase(),
      Number(viewerId || 0)
    );
    const rows = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.profilePhotos, async () => {
      const [baseRows] = await db.query(
        `
        (
          SELECT
            p.id,
            CONCAT('post-', p.id) AS feed_id,
            p.user_id,
            p.community_id,
            p.topic_tag,
            p.content,
            p.image_url,
            p.link_preview,
            p.created_at,
            p.created_at AS sort_time,
            u.username,
            u.display_name,
            u.avatar_url,
            u.is_verified,
            u.badge_type,
            u.hide_like_counts,
            NULL AS reviner_username,
            0 AS revined_by
          FROM vine_posts p
          JOIN vine_users u ON p.user_id = u.id
          WHERE p.user_id = ?
            AND p.image_url IS NOT NULL
        )
        UNION ALL
        (
          SELECT
            p.id,
            CONCAT('tagged-photo-', p.id, '-', pt.tagged_user_id) AS feed_id,
            p.user_id,
            p.community_id,
            p.topic_tag,
            p.content,
            p.image_url,
            p.link_preview,
            p.created_at,
            p.created_at AS sort_time,
            u.username,
            u.display_name,
            u.avatar_url,
            u.is_verified,
            u.badge_type,
            u.hide_like_counts,
            NULL AS reviner_username,
            0 AS revined_by
          FROM vine_post_tags pt
          JOIN vine_posts p ON pt.post_id = p.id
          JOIN vine_users u ON p.user_id = u.id
          WHERE pt.tagged_user_id = ?
            AND p.user_id <> ?
            AND p.image_url IS NOT NULL
        )
        ORDER BY sort_time DESC, feed_id DESC
        `,
        [user.id, user.id, user.id]
      );
      const enrichedRows = await enrichVinePostRows(baseRows, viewerId);
      return enrichedRows.map((row) => ({
        ...row,
        like_count: Number(row.likes || 0),
        comment_count: Number(row.comments || 0),
      }));
    });

    res.status(200).json(rows);
  } catch (err) {
    console.error("Fetch photo posts error:", err);
    res.status(500).json([]);
  }
});

// 🔖 Saved posts (bookmarks) — only for self
router.get("/users/:username/bookmarks", authOptional, async (req, res) => {
  try {
    await ensureVinePerformanceSchema();
    const { username } = req.params;
    const viewerId = req.user?.id || null;

    const [[user]] = await db.query(
      "SELECT id FROM vine_users WHERE username = ?",
      [username]
    );

    if (!user || !viewerId || Number(user.id) !== Number(viewerId)) {
      return res.json([]);
    }

    const cacheKey = buildVineCacheKey("profile-bookmarks", viewerId);
    const rows = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.profileBookmarks, async () => {
      const [baseRows] = await db.query(
        `
        SELECT 
          p.id,
          CONCAT('post-', p.id) AS feed_id,
          p.user_id,
          p.community_id,
          p.topic_tag,
          p.content,
          p.image_url,
          p.link_preview,
          p.created_at,
          p.created_at AS sort_time,
          u.username,
          u.display_name,
          u.avatar_url,
          u.is_verified,
          u.badge_type,
          u.hide_like_counts,
          NULL AS reviner_username,
          0 AS revined_by
        FROM vine_bookmarks b
        JOIN vine_posts p ON b.post_id = p.id
        JOIN vine_users u ON p.user_id = u.id
        WHERE b.user_id = ?
        ORDER BY b.created_at DESC, b.post_id DESC
        `,
        [viewerId]
      );
      const enrichedRows = await enrichVinePostRows(baseRows, viewerId);
      return enrichedRows.map((row) => ({ ...row, user_bookmarked: 1 }));
    });

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
    await ensureVinePerformanceSchema();
    const cacheKey = buildVineCacheKey("muted-users", Number(userId));
    const rows = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.mutedUsers, async () => {
      const [muteRows] = await db.query(
        `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified
        FROM vine_mutes m
        JOIN vine_users u ON u.id = m.muted_id
        WHERE m.muter_id = ?
        ORDER BY m.created_at DESC
        `,
        [userId]
      );
      return muteRows;
    });
    res.json(rows);
  } catch (err) {
    console.error("Muted list error:", err);
    res.status(500).json([]);
  }
});

// ⛔ List blocked users for current user
router.get("/users/me/blocks", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    await ensureVinePerformanceSchema();
    const cacheKey = buildVineCacheKey("blocked-users", Number(userId));
    const rows = await readThroughVineCache(cacheKey, VINE_CACHE_TTLS.blockedUsers, async () => {
      const [blockRows] = await db.query(
        `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified
        FROM vine_blocks b
        JOIN vine_users u ON u.id = b.blocked_id
        WHERE b.blocker_id = ?
        ORDER BY b.created_at DESC
        `,
        [userId]
      );
      return blockRows;
    });
    res.json(rows);
  } catch (err) {
    console.error("Blocked list error:", err);
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
