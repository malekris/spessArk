import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../server.js";
import { sendVineWelcomeEmail } from "../../utils/email.js";
import authMiddleware from "../../middleware/authMiddleware.js";
import authOptional from "../authOptional.js";
import { authenticate } from "../auth.js";
import { uploadAvatar, uploadBanner } from "../../middleware/upload.js";
import { io } from "../../server.js"; 
import { uploadPost } from "../../middleware/upload.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "vine_secret_key";

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
            p.created_at AS sort_time,
            u.username,
            u.display_name,
            u.avatar_url,
            u.is_verified,
            NULL AS revined_by,
            NULL AS reviner_username,
  
            (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
            (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
            (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,
  
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
  
          UNION ALL
  
          -- Revines
          SELECT 
            CONCAT('revine-', r.id) AS feed_id,
            p.id,
            p.user_id,
            p.content,
            p.image_url,
            r.created_at AS sort_time,
            u.username,
            u.display_name,
            u.avatar_url,
            u.is_verified,
            r.user_id AS revined_by,
            ru.username AS reviner_username,
  
            (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
            (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
            (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,
  
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
    uploadPostCloudinary.array("images", 5),
    async (req, res) => {
      try {
        const userId = req.user.id;
        const { content } = req.body;
  
        let imageUrls = [];
  
        if (req.files?.length) {
          const uploads = await Promise.all(
            req.files.map(file =>
              cloudinary.uploader.upload(
                `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
                { folder: "vine/posts" }
              )
            )
          );
  
          imageUrls = uploads.map(u => u.secure_url);
        }
  
        if ((!content || !content.trim()) && imageUrls.length === 0) {
          return res.status(400).json({ message: "Post cannot be empty" });
        }
  
        const image_url =
          imageUrls.length > 0 ? JSON.stringify(imageUrls) : null;
  
        const [result] = await db.query(
          `INSERT INTO vine_posts (user_id, content, image_url)
           VALUES (?, ?, ?)`,
          [userId, content?.trim() || null, image_url]
        );
  
        const [[post]] = await db.query(`
          SELECT 
            CONCAT('post-', p.id) AS feed_id,
            p.id,
            p.user_id,
            p.content,
            p.image_url,
            p.created_at AS sort_time,
            u.username,
            u.display_name,
            u.avatar_url,
            NULL AS revined_by,
            NULL AS reviner_username,
            0 AS likes,
            0 AS comments,
            0 AS revines,
            0 AS user_liked,
            0 AS user_revined
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
    const [rows] = await db.query(
      `
      SELECT 
        id,
        username,
        display_name,
        avatar_url,
        is_verified
      FROM vine_users
      WHERE username LIKE ?
         OR display_name LIKE ?
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
      ORDER BY u.created_at DESC
      LIMIT 10
    `, [viewerId, viewerId]);

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
          p.created_at,
          p.is_pinned,
          p.created_at AS sort_time,

          u.username,
          u.display_name,
          u.avatar_url,

          NULL AS reviner_username,
          0 AS revined_by,

          (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
          (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
          (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,

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
          p.created_at,
          p.is_pinned,
          r.created_at AS sort_time,

          u.username,
          u.display_name,
          u.avatar_url,

          ru.username AS reviner_username,
          1 AS revined_by,

          (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
          (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
          (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,

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
        COALESCE(u.avatar_url, '/uploads/avatars/default.png') AS avatar_url,
        COUNT(cl.id) AS like_count,
        MAX(cl.user_id = ?) AS user_liked
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
      ORDER BY score DESC
      LIMIT 100
    `, [viewerId, viewerId, viewerId]);

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
      await db.query(`
        INSERT INTO vine_notifications (user_id, actor_id, type, post_id)
        VALUES (?, ?, 'like', ?)
      `, [postOwnerId, userId, postId]);

      // 🔥 REAL-TIME PUSH
      io.to(`user-${postOwnerId}`).emit("notification");
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
      await db.query(
        `INSERT INTO vine_notifications 
         (user_id, actor_id, type, post_id, comment_id)
         VALUES (?, ?, 'comment', ?, ?)`,
        [postOwnerId, userId, postId, commentId]
      );

      // 🔥 REAL-TIME PUSH
      io.to(`user-${postOwnerId}`).emit("notification");
    }

    // -------- REPLY NOTIFICATION ----------
    if (parent_comment_id) {
      const [[parent]] = await db.query(
        "SELECT user_id FROM vine_comments WHERE id = ?",
        [parent_comment_id]
      );

      if (parent && parent.user_id !== userId) {
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
        await db.query(
          `INSERT INTO vine_notifications
           (user_id, actor_id, type, post_id, comment_id)
           VALUES (?, ?, 'like_comment', ?, ?)`,
          [comment.user_id, userId, comment.post_id, commentId]
        );
      }
    }

    const [[count]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_comment_likes WHERE comment_id = ?",
      [commentId]
    );

    res.json({
      likes: count.total,
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
// DELETE an original post
router.delete("/posts/:id", requireVineAuth, async (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id; // From your auth middleware

  try {
    // 1. Verify the post exists and belongs to the user
    const [post] = await db.query(
      "SELECT user_id FROM vine_posts WHERE id = ?",
      [postId]
    );

    if (post.length === 0) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (post[0].user_id !== userId) {
      return res.status(403).json({ message: "You can only delete your own posts" });
    }

    // 2. Delete the post
    // Note: If you have foreign keys for likes/comments, 
    // ensure they are set to ON DELETE CASCADE or delete them manually first.
    await db.query("DELETE FROM vine_posts WHERE id = ?", [postId]);

    res.json({ success: true, message: "Post deleted" });
  } catch (err) {
    console.error("Delete Post Error:", err);
    res.status(500).json({ message: "Server error during deletion" });
  }
});
// avatars (Cloudinary)
router.post(
  "/users/avatar",
  authenticate,
  uploadAvatar.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const avatarUrl = req.file.path; // ✅ Cloudinary URL

      await db.query(
        "UPDATE vine_users SET avatar_url = ? WHERE id = ?",
        [avatarUrl, req.user.id]
      );

      res.json({ avatar_url: avatarUrl });
    } catch (err) {
      console.error("Avatar upload error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  }
);

// banners (NEW)
router.post(
  "/users/banner",
  authenticate,
  uploadBanner.single("banner"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const bannerUrl = req.file.path; // Cloudinary HTTPS URL


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

// follow
router.post("/users/:id/follow", authenticate, async (req, res) => {
  try {
    const targetId = Number(req.params.id);   // person being followed
    const actorId = req.user.id;              // person doing the following

    if (targetId === actorId) {
      return res.status(400).json({ message: "Cannot follow yourself" });
    }

    // Insert follow (ignore duplicates)
    const [result] = await db.query(
      "INSERT IGNORE INTO vine_follows (follower_id, following_id) VALUES (?, ?)",
      [actorId, targetId]
    );

    // Only create notification if follow actually happened
    if (result.affectedRows > 0) {
      await db.query(
        `INSERT INTO vine_notifications (user_id, actor_id, type)
         VALUES (?, ?, 'follow')`,
        [targetId, actorId]
      );

      // 🔥 Real-time push
      io.to(`user-${targetId}`).emit("notification");
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
// Get followers of a user
router.get("/users/:username/followers", async (req, res) => {
  try {
    const { username } = req.params;

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
        u.avatar_url
      FROM vine_follows f
      JOIN vine_users u ON f.follower_id = u.id
      WHERE f.following_id = ?
    `, [user.id]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to load followers" });
  }
});
// Get users someone is following
router.get("/users/:username/following", async (req, res) => {
  try {
    const { username } = req.params;

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
        u.avatar_url
      FROM vine_follows f
      JOIN vine_users u ON f.following_id = u.id
      WHERE f.follower_id = ?
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
router.get("/users/:username/likes", async (req, res) => {
  const { username } = req.params;

  try {
    // 1️⃣ Resolve user ID from username
    const [[user]] = await db.query(
      "SELECT id FROM vine_users WHERE username = ?",
      [username]
    );

    if (!user) {
      return res.status(200).json([]);
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
        p.created_at,
        l.created_at AS sort_time,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified,
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
router.get("/users/:username/photos", async (req, res) => {
  const { username } = req.params;

  try {
    // 1️⃣ Resolve user
    const [[user]] = await db.query(
      "SELECT id FROM vine_users WHERE username = ?",
      [username]
    );

    if (!user) {
      return res.status(200).json([]);
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
        p.created_at AS sort_time,
        u.username,
        u.display_name,
        u.avatar_url,
        u.is_verified
      FROM vine_posts p
      JOIN vine_users u ON p.user_id = u.id
      WHERE p.user_id = ?
        AND p.image_url IS NOT NULL
      ORDER BY sort_time DESC
      `,
      [user.id]
    );

    res.status(200).json(rows);
  } catch (err) {
    console.error("Fetch photo posts error:", err);
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
