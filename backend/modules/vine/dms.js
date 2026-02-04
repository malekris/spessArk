import express from "express";
import { db, io } from "../../server.js";
import { authenticate } from "../auth.js";

const router = express.Router();

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

  try {
    const [rows] = await db.query(`
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
        ) AS unread_count

      FROM vine_conversations c
      JOIN vine_users u 
        ON u.id = IF(c.user1_id = ?, c.user2_id, c.user1_id)

      WHERE (c.user1_id = ? OR c.user2_id = ?)
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

      ORDER BY last_message_time DESC
    `, [userId, userId, userId, userId, userId, userId, userId]);

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
    // 1. Verify user belongs to this conversation
    const [check] = await db.query(
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
      return res.status(403).json({ error: "Access denied" });
    }

    // 2. Mark messages as read
    await db.query(
      `
      UPDATE vine_messages
      SET is_read = 1
      WHERE conversation_id = ?
        AND sender_id != ?
        AND is_read = 0
      `,
      [conversationId, userId]
    );

    // 3. Fetch messages
    const [messages] = await db.query(
      `
      SELECT 
        m.id,
        m.sender_id,
        m.content,
        m.created_at,
        m.is_read,
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

    res.json(messages);
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
      "SELECT dm_privacy FROM vine_users WHERE id = ?",
      [receiverId]
    );

    if (!receiver) {
      return res.status(404).json({ error: "User not found" });
    }

    if (receiver.dm_privacy === "no_one") {
      return res.status(403).json({ error: "User does not accept messages" });
    }

    if (receiver.dm_privacy === "followers") {
      const follows = await isFollowing(senderId, receiverId);
      if (!follows) {
        return res.status(403).json({ error: "Followers only" });
      }
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
      return res.json({ conversationId: existing[0].id });
    }

    // Create new
    const [created] = await db.query(
      `
      INSERT INTO vine_conversations (user1_id, user2_id)
      VALUES (?, ?)
      `,
      [senderId, receiverId]
    );

    res.json({ conversationId: created.insertId });
  } catch (err) {
    console.error("Start conversation error:", err);
    res.status(500).json({ error: "Failed to start conversation" });
  }
});
/* =========================
   SEND MESSAGE (REALTIME FIXED)
========================= */
router.post("/send", authenticate, async (req, res) => {
  const senderId = req.user.id;
  const { conversationId, content } = req.body;

  if (!content?.trim()) {
    return res.status(400).json({ error: "Message empty" });
  }

  try {
    // Ensure user belongs to this conversation
    const [check] = await db.query(
      `
      SELECT user1_id, user2_id
      FROM vine_conversations
      WHERE id = ? AND (user1_id = ? OR user2_id = ?)
      `,
      [conversationId, senderId, senderId]
    );

    if (!check.length) {
      return res.status(403).json({ error: "Not your conversation" });
    }

    const { user1_id, user2_id } = check[0];
    const otherId = user1_id === senderId ? user2_id : user1_id;

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

    // Insert message
    const [result] = await db.query(
      `
      INSERT INTO vine_messages (conversation_id, sender_id, content)
      VALUES (?, ?, ?)
      `,
      [conversationId, senderId, content]
    );

    // Fetch full message (with username + avatar)
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
      JOIN vine_users u ON m.sender_id = u.id
      WHERE m.id = ?
      `,
      [result.insertId]
    );

    // ✅ Send to open chat window
    io.to(`conversation-${conversationId}`).emit("dm_received", fullMessage);

    // ✅ Send to both users inbox (conversation list realtime)
    io.to(`user-${user1_id}`).emit("dm_received", fullMessage);
    io.to(`user-${user2_id}`).emit("dm_received", fullMessage);

    // Respond normally
    res.json({ message: fullMessage });

  } catch (err) {
    console.error("Send DM error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});
/* =========================
   MARK MESSAGES AS READ (REALTIME FIXED)
 ========================= */
router.post("/conversations/:id/read", authenticate, async (req, res) => {
  const userId = req.user.id;
  const conversationId = req.params.id;

  try {
    // Get participants first
    const [[convo]] = await db.query(`
      SELECT user1_id, user2_id
      FROM vine_conversations
      WHERE id = ?
    `, [conversationId]);

    if (!convo) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const { user1_id, user2_id } = convo;

    // Mark messages as read
    await db.query(`
      UPDATE vine_messages
      SET is_read = 1
      WHERE conversation_id = ?
        AND sender_id != ?
        AND is_read = 0
    `, [conversationId, userId]);

    // 🔥 Notify BOTH users to refresh inbox immediately
    io.to(`user-${user1_id}`).emit("inbox_updated");
    io.to(`user-${user2_id}`).emit("inbox_updated");

    // 🔥 Optional: update open chat UI
    io.to(`conversation-${conversationId}`).emit("messages_seen", {
      conversationId,
      seenBy: userId
    });

    res.json({ success: true });

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

    res.json({ success: true });

  } catch (err) {
    console.error("Delete conversation error:", err);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

/* =========================
   GET messages in conversation (SAFE)
========================= */
router.get("/conversations/:id/messages", authenticate, async (req, res) => {
  const userId = req.user.id;
  const conversationId = req.params.id;

  try {
    // 1. Must belong to conversation
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
      return res.status(403).json({ error: "Access denied" });
    }

    // 2. Mark messages as read
    await db.query(
      `
      UPDATE vine_messages
      SET is_read = 1
      WHERE conversation_id = ?
        AND sender_id != ?
      `,
      [conversationId, userId]
    );

    // 3. Fetch messages
    const [messages] = await db.query(
      `
      SELECT 
        m.id,
        m.sender_id,
        m.content,
        m.created_at,
        m.is_read,
        u.username,
        u.avatar_url
      FROM vine_messages m
      JOIN vine_users u ON m.sender_id = u.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at ASC
      `,
      [conversationId]
    );

    res.json(messages);
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
    const [[row]] = await db.query(`
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
    `, [userId, userId, userId, userId, userId]);

    res.json({ total: row.total || 0 });
  } catch (err) {
    console.error("Unread total error:", err);
    res.status(500).json({ total: 0 });
  }
});


export default router;
