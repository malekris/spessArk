import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../server.js";
import { sendVineWelcomeEmail, sendVineResetCodeEmail, sendVineVerificationEmail } from "../../utils/email.js";
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

const isHeicFile = (file) => {
  const name = file?.originalname || "";
  const type = file?.mimetype || "";
  return (
    /heic|heif/i.test(type) ||
    /\.heic$/i.test(name) ||
    /\.heif$/i.test(name)
  );
};

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
    const { username, display_name, email, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    // Check duplicate
    const [existing] = await db.query(
      "SELECT id FROM vine_users WHERE username = ? LIMIT 1",
      [username]
    );

    if (existing.length) {
      return res.status(400).json({ message: "Username already taken" });
    }

    const hash = await bcrypt.hash(password, 10);

    await db.query(
      `INSERT INTO vine_users (username, display_name, email, password_hash)
       VALUES (?, ?, ?, ?)`,
      [username, display_name || null, email || null, hash]
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
        { id: user.id, username: user.username, is_admin: user.is_admin },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
  
      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          is_admin: user.is_admin
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

  // create posts
  router.get("/posts", authOptional, async (req, res) => {
    try {
      const viewerId = req.user?.id || null;
  
      const [rows] = await db.query(`
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
  
          UNION ALL
  
          -- Revines
          SELECT 
            CONCAT('revine-', r.id) AS feed_id,
            p.id,
            p.user_id,
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
        const userId = req.user.id;
        const { content } = req.body;
  
        let imageUrls = [];
  
        if (req.files?.length) {
          const uploads = await Promise.all(
            req.files.map(async (file) => {
              const normalized = await normalizeImageBuffer(file);
              return cloudinary.uploader.upload(
                `data:${normalized.mimetype};base64,${normalized.buffer.toString("base64")}`,
                { folder: "vine/posts" }
              );
            })
          );
  
          imageUrls = uploads.map(u => u.secure_url);
        }
  
        if ((!content || !content.trim()) && imageUrls.length === 0) {
          return res.status(400).json({ message: "Post cannot be empty" });
        }
  
        const image_url =
          imageUrls.length > 0 ? JSON.stringify(imageUrls) : null;
  
        let linkPreview = null;
        const firstUrl = extractFirstUrl(content?.trim() || "");
        if (firstUrl) {
          linkPreview = await fetchLinkPreview(firstUrl);
        }

        const [result] = await db.query(
          `INSERT INTO vine_posts (user_id, content, image_url, link_preview)
           VALUES (?, ?, ?, ?)`,
          [userId, content?.trim() || null, image_url, linkPreview ? JSON.stringify(linkPreview) : null]
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

// 🔐 Request email verification link
router.post("/users/me/verify-email", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      `UPDATE vine_users
       SET email = ?, is_verified = 0, email_verify_token = ?, email_verify_expires = ?
       WHERE id = ?`,
      [email, token, expires, userId]
    );

    const baseUrl =
      process.env.CLIENT_URL ||
      process.env.FRONTEND_URL ||
      process.env.PUBLIC_URL ||
      "http://localhost:5173";
    const link = `${baseUrl}/vine/verify-email?token=${encodeURIComponent(token)}`;

    await sendVineVerificationEmail(email, link);
    res.json({ success: true });
  } catch (err) {
    console.error("Verify email request error:", err);
    res.status(500).json({ message: "Failed to send verification link" });
  }
});

// 🔐 Verify email (link)
router.get("/auth/verify-email", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send("Invalid token");

    const [[user]] = await db.query(
      "SELECT id, email_verify_token, email_verify_expires FROM vine_users WHERE email_verify_token = ?",
      [token]
    );

    if (!user || !user.email_verify_expires) {
      return res.status(400).send("Invalid token");
    }

    const expired = new Date(user.email_verify_expires).getTime() < Date.now();
    if (expired) {
      return res.status(400).send("Verification link expired");
    }

    await db.query(
      `UPDATE vine_users
       SET is_verified = 1, email_verify_token = NULL, email_verify_expires = NULL
       WHERE id = ?`,
      [user.id]
    );

    const baseUrl =
      process.env.CLIENT_URL ||
      process.env.FRONTEND_URL ||
      process.env.PUBLIC_URL ||
      "http://localhost:5173";
    res.redirect(`${baseUrl}/vine/feed?verified=1`);
  } catch (err) {
    console.error("Verify email error:", err);
    res.status(500).send("Verification failed");
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
        u.avatar_url
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
      ORDER BY u.created_at DESC
      LIMIT 10
    `, [viewerId, viewerId, viewerId]);

    res.json(rows);
  } catch (err) {
    console.error("Suggestions error:", err);
    res.status(500).json([]);
  }
});

// user profile
router.get("/users/:username", authOptional, async (req, res) => {
  try {
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
        } AS is_following

      FROM vine_users u
      WHERE u.username = ?
      `,
      [username]
    );

    if (!user) return res.status(404).json({ message: "Not found" });

    const isSelf = viewerId && Number(viewerId) === Number(user.id);
    const isFollowing =
      viewerId && Number(user.is_following) === 1;

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
      ORDER BY c.created_at ASC
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

// DELETE a comment or reply (Only the owner of the main POST can do this)
router.delete("/comments/:id", requireVineAuth, async (req, res) => {
  const commentId = req.params.id;
  const requesterId = req.user.id; // From your requireVineAuth middleware

  try {
    // 1. Find the comment and get the user_id of the person who owns the POST it belongs to
    const [rows] = await db.query(`
      SELECT p.user_id AS post_owner_id 
      FROM vine_comments c
      JOIN vine_posts p ON c.post_id = p.id 
      WHERE c.id = ?
    `, [commentId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Comment not found" });
    }

    // 2. Check if the requester is the one who created the post
    if (rows[0].post_owner_id !== requesterId) {
      return res.status(403).json({ message: "Only the post owner can delete comments" });
    }

    // 3. Delete the comment
    // Note: If you have nested replies, you should have 'ON DELETE CASCADE' 
    // in your DB schema for parent_comment_id so they get removed too.
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

    if (post.user_id !== userId) {
      return res
        .status(403)
        .json({ message: "You can only delete your own posts" });
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
        images.map((url) =>
          cloudinary.uploader.destroy(extractPublicId(url))
        )
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
    const { display_name, bio, location, website } = req.body;

    await db.query(
      `
      UPDATE vine_users
      SET 
        display_name = ?,
        bio = ?,
        location = ?,
        website = ?
      WHERE id = ?
      `,
      [
        display_name || null,
        bio || null,
        location || null,
        website || null,
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
    const {
      dm_privacy,
      is_private,
      hide_like_counts,
      show_last_active,
    } = req.body || {};

    const allowedDm = new Set(["everyone", "followers", "no_one"]);
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
      SELECT dm_privacy, is_private, hide_like_counts, show_last_active
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

// Get notifications
router.get("/notifications", authenticate, async (req, res) => {
  const [rows] = await db.query(`
    SELECT 
      n.id,
      n.type,
      n.post_id,
      n.comment_id,
      n.is_read,
      n.created_at,
      u.username,
      u.display_name,
      u.avatar_url
    FROM vine_notifications n
    JOIN vine_users u ON n.actor_id = u.id
    WHERE n.user_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM vine_mutes m
        WHERE m.muter_id = n.user_id AND m.muted_id = n.actor_id
      )
    ORDER BY n.created_at DESC
    LIMIT 50
  `, [req.user.id]);

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
        (SELECT COUNT(*) FROM vine_post_views WHERE post_id = p.id) AS views,
        1 AS user_liked
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
// 🗑️ Delete comment or reply (author only)
router.delete("/comments/:id", requireVineAuth, async (req, res) => {
  try {
    const commentId = req.params.id;
    const userId = req.user.id;

    const [[comment]] = await db.query(
      "SELECT user_id FROM vine_comments WHERE id = ?",
      [commentId]
    );

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    if (comment.user_id !== userId) {
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
