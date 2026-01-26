console.log("🍃 Vine routes loaded");

import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../server.js";
import { sendVineWelcomeEmail } from "../../utils/email.js";
import authMiddleware from "../../middleware/authMiddleware.js";
import authOptional from "../authOptional.js";
import { authenticate } from "../auth.js";

import { uploadAvatar } from "../../middleware/upload.js";

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

//middleware 
  function requireVineAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ message: "No token" });
  
    try {
      const token = auth.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      next();
    } catch {
      res.status(401).json({ message: "Invalid token" });
    }
  }
// Create a new post
router.post("/posts", requireVineAuth, async (req, res) => {
  try {
    const { content } = req.body;
    const userId = req.user.id; // From your auth middleware

    if (!content || !content.trim()) {
      return res.status(400).json({ message: "Post content cannot be empty" });
    }

    const [result] = await db.query(
      "INSERT INTO vine_posts (user_id, content) VALUES (?, ?)",
      [userId, content]
    );

    // Fetch the newly created post with user details to send back to frontend
    const [[newPost]] = await db.query(`
      SELECT p.*, u.username, u.display_name 
      FROM vine_posts p
      JOIN vine_users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [result.insertId]);
    
    res.json(newPost);
  } catch (err) {
    console.error("Create Post Error:", err);
    res.status(500).json({ message: "Failed to create post" });
  }
});
// Add comment or reply
router.post("/posts/:id/comments", requireVineAuth, async (req, res) => {
  const { content, parent_comment_id } = req.body;

  if (!content?.trim()) {
    return res.status(400).json({ message: "Empty comment" });
  }

  await db.query(
    `INSERT INTO vine_comments (user_id, post_id, content, parent_comment_id)
     VALUES (?, ?, ?, ?)`,
    [req.user.id, req.params.id, content, parent_comment_id || null]
  );

  res.json({ success: true });
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

    // 2. Get posts WITH user + stats (same shape as feed)
    const [posts] = await db.query(
      `
      SELECT 
        p.*,
        u.username,
        u.display_name,
        u.avatar_url,

        (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
        (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
        (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,

        ${
          viewerId
            ? `(SELECT COUNT(*) > 0 FROM vine_likes 
                 WHERE post_id = p.id AND user_id = ${viewerId})`
            : "0"
        } AS user_liked,

        ${
          viewerId
            ? `(SELECT COUNT(*) > 0 FROM vine_revines 
                 WHERE post_id = p.id AND user_id = ${viewerId})`
            : "0"
        } AS user_revined

      FROM vine_posts p
      JOIN vine_users u ON p.user_id = u.id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
      `,
      [user.id]
    );

    res.json({ user, posts });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: "Failed to load profile" });
  }
});
// Get comments for post (threaded-ready)
router.get("/posts/:id/comments", async (req, res) => {
  const postId = req.params.id;

  const [rows] = await db.query(`
    SELECT 
      c.id,
      c.content,
      c.created_at,
      c.parent_comment_id,
      u.username,
      u.display_name
    FROM vine_comments c
    JOIN vine_users u ON u.id = c.user_id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `, [postId]);

  res.json(rows);
});
// Ranked Feed (open network)
router.get("/posts", authOptional, async (req, res) => {
  try {
    const viewerId = req.user?.id || null;

    // --------------------
    // LOGGED OUT FEED
    // --------------------
    if (!viewerId) {
      const [rows] = await db.query(`
        SELECT 
          p.*,
          u.username,
          u.display_name,
          u.avatar_url,

          (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
          (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
          (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,

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

    // --------------------
    // LOGGED IN FEED
    // --------------------
    const [rows] = await db.query(`
      SELECT 
        p.*,
        u.username,
        u.display_name,
        u.avatar_url,

        (SELECT COUNT(*) FROM vine_likes WHERE post_id = p.id) AS likes,
        (SELECT COUNT(*) FROM vine_comments WHERE post_id = p.id) AS comments,
        (SELECT COUNT(*) FROM vine_revines WHERE post_id = p.id) AS revines,

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
  const postId = req.params.id;
  const userId = req.user.id;

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
  }

  const [[count]] = await db.query(
    "SELECT COUNT(*) AS total FROM vine_revines WHERE post_id = ?",
    [postId]
  );

  res.json({
    revines: count.total,
    user_revined: !existing.length
  });
});

// ❤️ Toggle like
router.post("/posts/:id/like", requireVineAuth, async (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

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
    const postId = req.params.id;
    const userId = req.user.id;
    const { content, parent_comment_id } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: "Comment required" });
    }

    await db.query(
      `INSERT INTO vine_comments (post_id, user_id, content, parent_comment_id)
       VALUES (?, ?, ?, ?)`,
      [postId, userId, content, parent_comment_id || null]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add comment" });
  }
});
// get all coments for a post
router.get("/posts/:id/comments", async (req, res) => {
  try {
    const postId = req.params.id;

    const [rows] = await db.query(`
      SELECT 
        c.id,
        c.content,
        c.parent_comment_id,
        c.created_at,
        u.username,
        u.display_name
      FROM vine_comments c
      JOIN vine_users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `, [postId]);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch comments" });
  }
});
// ❤️ Like / Unlike a comment
router.post("/comments/:id/like", requireVineAuth, async (req, res) => {
  try {
    const commentId = req.params.id;
    const userId = req.user.id;

    const [existing] = await db.query(
      "SELECT 1 FROM vine_comment_likes WHERE user_id = ? AND comment_id = ?",
      [userId, commentId]
    );

    if (existing.length) {
      await db.query(
        "DELETE FROM vine_comment_likes WHERE user_id = ? AND comment_id = ?",
        [userId, commentId]
      );
    } else {
      await db.query(
        "INSERT INTO vine_comment_likes (user_id, comment_id) VALUES (?, ?)",
        [userId, commentId]
      );
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
    console.error(err);
    res.status(500).json({ message: "Failed to like comment" });
  }
});
// 🔁 Revine / Unrevine comment
router.post("/comments/:id/revine", requireVineAuth, async (req, res) => {
  try {
    const commentId = req.params.id;
    const userId = req.user.id;

    const [existing] = await db.query(
      "SELECT 1 FROM vine_comment_revines WHERE user_id = ? AND comment_id = ?",
      [userId, commentId]
    );

    if (existing.length) {
      await db.query(
        "DELETE FROM vine_comment_revines WHERE user_id = ? AND comment_id = ?",
        [userId, commentId]
      );
    } else {
      await db.query(
        "INSERT INTO vine_comment_revines (user_id, comment_id) VALUES (?, ?)",
        [userId, commentId]
      );
    }

    const [[count]] = await db.query(
      "SELECT COUNT(*) AS total FROM vine_comment_revines WHERE comment_id = ?",
      [commentId]
    );

    res.json({
      revines: count.total,
      user_revined: !existing.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to revine comment" });
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
// avatars 
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

      const avatarUrl = `/uploads/avatars/${req.file.filename}`;

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
  const targetId = req.params.id;
  const actorId = req.user.id;

  await db.query(
    "INSERT IGNORE INTO vine_follows (follower_id, following_id) VALUES (?, ?)",
    [actorId, targetId]
  );

  // 🔔 create notification
  await db.query(
    `INSERT INTO vine_notifications (user_id, actor_id, type)
     VALUES (?, ?, 'follow')`,
    [targetId, actorId]
  );

  res.json({ success: true });
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
// notifications
router.get("/notifications", authenticate, async (req, res) => {
  const [rows] = await db.query(`
    SELECT 
      n.*,
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


  export default router;
