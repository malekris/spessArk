import jwt from "jsonwebtoken";

const eclassRooms = new Map();
const eclassHostReturnTimers = new Map();
let eclassHostReaperStarted = false;

export const ECLASS_HOST_RETURN_GRACE_MS = 10 * 60 * 1000;
const ECLASS_HOST_SWEEP_MS = 60 * 1000;

export const getDefaultEClassMutedState = (userId, hostUserId) =>
  Number(userId) === Number(hostUserId) ? 0 : 1;

const roomName = (sessionId) => `eclass-${Number(sessionId)}`;

const getRoom = (sessionId) => {
  const sid = Number(sessionId);
  if (!eclassRooms.has(sid)) eclassRooms.set(sid, new Map());
  return eclassRooms.get(sid);
};

const addRoomSocket = (sessionId, userId, socketId) => {
  const room = getRoom(sessionId);
  const uid = Number(userId);
  if (!room.has(uid)) room.set(uid, new Set());
  room.get(uid).add(socketId);
};

const removeRoomSocket = (sessionId, userId, socketId) => {
  const sid = Number(sessionId);
  const uid = Number(userId);
  const room = eclassRooms.get(sid);
  if (!room?.has(uid)) return false;
  const sockets = room.get(uid);
  sockets.delete(socketId);
  if (sockets.size > 0) return false;
  room.delete(uid);
  if (room.size === 0) eclassRooms.delete(sid);
  return true;
};

const getRoomUserIds = (sessionId) => Array.from(eclassRooms.get(Number(sessionId))?.keys() || []);

const emitToRoomUser = (io, sessionId, userId, eventName, payload) => {
  const socketIds = eclassRooms.get(Number(sessionId))?.get(Number(userId));
  if (!socketIds) return;
  for (const socketId of socketIds) io.to(socketId).emit(eventName, payload);
};

const clearHostReturnTimer = (sessionId) => {
  const sid = Number(sessionId);
  const timer = eclassHostReturnTimers.get(sid);
  if (timer) clearTimeout(timer);
  eclassHostReturnTimers.delete(sid);
};

const getParticipantRows = async (db, sessionId, userIds) => {
  if (!userIds.length) return [];
  const placeholders = userIds.map(() => "?").join(", ");
  const [rows] = await db.query(
    `
    SELECT
      u.id AS user_id,
      u.username,
      u.display_name,
      u.avatar_url,
      u.is_verified,
      cm.role AS community_role,
      p.is_self_muted,
      p.is_muted_by_host,
      p.hand_raised,
      p.joined_at
    FROM vine_eclass_participants p
    JOIN vine_users u ON u.id = p.user_id
    JOIN vine_eclass_sessions s ON s.id = p.session_id
    JOIN vine_community_members cm ON cm.community_id = s.community_id AND cm.user_id = p.user_id
    WHERE p.session_id = ? AND p.user_id IN (${placeholders})
    ORDER BY
      CASE cm.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
      p.joined_at ASC
    `,
    [Number(sessionId), ...userIds]
  );
  return rows.map((row) => ({
    ...row,
    user_id: Number(row.user_id),
    is_verified: Number(row.is_verified || 0),
    is_self_muted: Number(row.is_self_muted || 0),
    is_muted_by_host: Number(row.is_muted_by_host || 0),
    hand_raised: Number(row.hand_raised || 0),
  }));
};

const getLiveMembership = async (db, sessionId, userId) => {
  const [[row]] = await db.query(
    `
    SELECT
      s.id AS session_id,
      s.community_id,
      s.host_user_id,
      s.title,
      cm.role AS community_role
    FROM vine_eclass_sessions s
    JOIN vine_community_members cm ON cm.community_id = s.community_id AND cm.user_id = ?
    WHERE s.id = ? AND s.status = 'live' AND s.active_slot = 1
    LIMIT 1
    `,
    [Number(userId), Number(sessionId)]
  );
  return row || null;
};

const getAuthenticatedUserId = async (db, rawToken) => {
  const token = String(rawToken || "").trim();
  if (!token) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET || "vine_secret_key");
  const userId = Number(decoded?.id || 0);
  if (!userId) return null;
  if (decoded?.jti) {
    const [[session]] = await db.query(
      "SELECT revoked_at FROM vine_user_sessions WHERE user_id = ? AND session_jti = ? LIMIT 1",
      [userId, decoded.jti]
    );
    if (!session || session.revoked_at) return null;
  }
  const [[user]] = await db.query(
    `
    SELECT id
    FROM vine_users
    WHERE id = ?
      AND (delete_requested_at IS NULL OR DATE_ADD(delete_requested_at, INTERVAL 10 DAY) > NOW())
    LIMIT 1
    `,
    [userId]
  );
  return user?.id ? userId : null;
};

export const endEClassRuntimeSession = async ({ io, sessionId, communityId, endedBy, reason = "ended" }) => {
  const sid = Number(sessionId);
  clearHostReturnTimer(sid);
  io.to(roomName(sid)).emit("eclass_ended", {
    sessionId: sid,
    communityId: Number(communityId),
    endedBy: Number(endedBy || 0),
    reason,
  });
  eclassRooms.delete(sid);
};

export const endEClassForAbsentHost = async ({ io, db, sessionId }) => {
  const sid = Number(sessionId);
  if (!sid) return { ended: false, reason: "invalid_session" };

  const [[session]] = await db.query(
    `
    SELECT s.id, s.community_id, s.host_user_id
    FROM vine_eclass_sessions s
    WHERE s.id = ? AND s.status = 'live' AND s.active_slot = 1
    LIMIT 1
    `,
    [sid]
  );
  if (!session) {
    clearHostReturnTimer(sid);
    return { ended: false, reason: "not_live" };
  }

  if (eclassRooms.get(sid)?.has(Number(session.host_user_id))) {
    clearHostReturnTimer(sid);
    return { ended: false, reason: "host_returned" };
  }

  const [result] = await db.query(
    `
    UPDATE vine_eclass_sessions s
    LEFT JOIN vine_eclass_participants hp
      ON hp.session_id = s.id AND hp.user_id = s.host_user_id
    SET
      s.status = 'ended',
      s.active_slot = NULL,
      s.ended_at = NOW(),
      s.ended_by = NULL
    WHERE s.id = ?
      AND s.status = 'live'
      AND s.active_slot = 1
      AND (
        (hp.user_id IS NULL AND s.started_at <= DATE_SUB(NOW(), INTERVAL 10 MINUTE))
        OR (hp.left_at IS NOT NULL AND hp.left_at <= DATE_SUB(NOW(), INTERVAL 10 MINUTE))
      )
    `,
    [sid]
  );
  if (!result.affectedRows) return { ended: false, reason: "grace_active" };

  await db.query(
    "UPDATE vine_eclass_participants SET left_at = COALESCE(left_at, NOW()), hand_raised = 0 WHERE session_id = ?",
    [sid]
  );
  const communityId = Number(session.community_id);
  const payload = {
    sessionId: sid,
    communityId,
    endedBy: 0,
    reason: "host_absent",
  };
  await endEClassRuntimeSession({ io, ...payload });

  const [memberRows] = await db.query(
    "SELECT user_id FROM vine_community_members WHERE community_id = ?",
    [communityId]
  );
  for (const member of memberRows) {
    io.to(`user-${Number(member.user_id)}`).emit("eclass_ended", payload);
  }
  return { ended: true, sessionId: sid, communityId };
};

const scheduleHostReturnDeadline = ({ io, db, sessionId }) => {
  const sid = Number(sessionId);
  if (!sid) return;
  clearHostReturnTimer(sid);
  const timer = setTimeout(() => {
    eclassHostReturnTimers.delete(sid);
    void endEClassForAbsentHost({ io, db, sessionId: sid }).catch((err) => {
      console.error("Auto-end absent-host Vine eClass error:", err?.message || err);
    });
  }, ECLASS_HOST_RETURN_GRACE_MS + 1_000);
  if (typeof timer.unref === "function") timer.unref();
  eclassHostReturnTimers.set(sid, timer);
};

export const sweepAbsentEClassHosts = async ({ io, db }) => {
  let rows;
  try {
    [rows] = await db.query(
      `
      SELECT s.id
      FROM vine_eclass_sessions s
      LEFT JOIN vine_eclass_participants hp
        ON hp.session_id = s.id AND hp.user_id = s.host_user_id
      WHERE s.status = 'live'
        AND s.active_slot = 1
        AND (
          (hp.user_id IS NULL AND s.started_at <= DATE_SUB(NOW(), INTERVAL 10 MINUTE))
          OR (hp.left_at IS NOT NULL AND hp.left_at <= DATE_SUB(NOW(), INTERVAL 10 MINUTE))
        )
      ORDER BY s.id ASC
      LIMIT 100
      `
    );
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE") return [];
    throw err;
  }
  const ended = [];
  for (const row of rows) {
    const result = await endEClassForAbsentHost({ io, db, sessionId: row.id });
    if (result.ended) ended.push(Number(row.id));
  }
  return ended;
};

export const startVineEClassHostReaper = ({ io, db }) => {
  if (eclassHostReaperStarted) return;
  eclassHostReaperStarted = true;
  const sweep = () => {
    void sweepAbsentEClassHosts({ io, db }).catch((err) => {
      console.error("Vine eClass absent-host sweep error:", err?.message || err);
    });
  };
  const bootSweep = setTimeout(sweep, 5_000);
  const sweepTimer = setInterval(sweep, ECLASS_HOST_SWEEP_MS);
  if (typeof bootSweep.unref === "function") bootSweep.unref();
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
};

export function registerVineEClassSocketHandlers({ io, socket, db }) {
  socket.data.eclassSessions = socket.data.eclassSessions || new Map();

  const acknowledge = (callback, payload) => {
    if (typeof callback === "function") callback(payload);
  };

  const requireJoinedSession = (sessionId) => {
    const sid = Number(sessionId);
    const stored = socket.data.eclassSessions.get(sid);
    if (!stored || !socket.rooms.has(roomName(sid))) return null;
    return stored;
  };

  const leaveSession = async (sessionId, { emit = true } = {}) => {
    const sid = Number(sessionId);
    const stored = socket.data.eclassSessions.get(sid);
    if (!stored) return;
    socket.data.eclassSessions.delete(sid);
    socket.leave(roomName(sid));
    const fullyLeft = removeRoomSocket(sid, stored.userId, socket.id);
    if (!fullyLeft) return;
    await db.query(
      "UPDATE vine_eclass_participants SET left_at = NOW(), hand_raised = 0 WHERE session_id = ? AND user_id = ?",
      [sid, stored.userId]
    ).catch(() => {});
    if (emit) {
      socket.to(roomName(sid)).emit("eclass_participant_left", {
        sessionId: sid,
        userId: stored.userId,
      });
    }
    if (Number(stored.userId) === Number(stored.hostUserId)) {
      scheduleHostReturnDeadline({ io, db, sessionId: sid });
    }
  };

  socket.on("eclass_join", async (payload = {}, callback) => {
    try {
      const sessionId = Number(payload.sessionId);
      const userId = await getAuthenticatedUserId(db, payload.token).catch(() => null);
      if (!sessionId || !userId) {
        return acknowledge(callback, { ok: false, message: "Sign in to join Vine eClass" });
      }
      const membership = await getLiveMembership(db, sessionId, userId);
      if (!membership) {
        return acknowledge(callback, { ok: false, message: "This live class is for community members only" });
      }

      const existingUserIds = getRoomUserIds(sessionId).filter((id) => id !== userId);
      const defaultMuted = getDefaultEClassMutedState(userId, membership.host_user_id);
      await db.query(
        `
        INSERT INTO vine_eclass_participants
          (session_id, community_id, user_id, joined_at, left_at, is_self_muted, is_muted_by_host, hand_raised)
        VALUES (?, ?, ?, NOW(), NULL, ?, 0, 0)
        ON DUPLICATE KEY UPDATE
          joined_at = NOW(),
          left_at = NULL,
          is_self_muted = VALUES(is_self_muted),
          hand_raised = 0
        `,
        [sessionId, membership.community_id, userId, defaultMuted]
      );
      socket.join(roomName(sessionId));
      addRoomSocket(sessionId, userId, socket.id);
      if (Number(userId) === Number(membership.host_user_id)) {
        clearHostReturnTimer(sessionId);
      }
      socket.data.eclassSessions.set(sessionId, {
        userId,
        communityId: Number(membership.community_id),
        role: membership.community_role,
        hostUserId: Number(membership.host_user_id),
      });

      const [self] = await getParticipantRows(db, sessionId, [userId]);
      const participants = await getParticipantRows(db, sessionId, existingUserIds);
      socket.to(roomName(sessionId)).emit("eclass_participant_joined", {
        sessionId,
        participant: self,
      });
      return acknowledge(callback, {
        ok: true,
        session: {
          id: sessionId,
          community_id: Number(membership.community_id),
          host_user_id: Number(membership.host_user_id),
          title: membership.title,
        },
        self,
        participants,
      });
    } catch (err) {
      console.error("Join Vine eClass socket error:", err);
      return acknowledge(callback, { ok: false, message: "Could not join Vine eClass" });
    }
  });

  socket.on("eclass_leave", async (payload = {}, callback) => {
    await leaveSession(payload.sessionId);
    acknowledge(callback, { ok: true });
  });

  socket.on("eclass_signal", (payload = {}) => {
    const session = requireJoinedSession(payload.sessionId);
    const targetUserId = Number(payload.targetUserId);
    if (!session || !targetUserId || targetUserId === session.userId) return;
    if (!eclassRooms.get(Number(payload.sessionId))?.has(targetUserId)) return;
    emitToRoomUser(io, payload.sessionId, targetUserId, "eclass_signal", {
      sessionId: Number(payload.sessionId),
      fromUserId: session.userId,
      targetUserId,
      description: payload.description || null,
      candidate: payload.candidate || null,
    });
  });

  socket.on("eclass_chat", async (payload = {}, callback) => {
    try {
      const session = requireJoinedSession(payload.sessionId);
      const content = String(payload.content || "").trim().slice(0, 1200);
      if (!session || !content) return acknowledge(callback, { ok: false });
      const [inserted] = await db.query(
        "INSERT INTO vine_eclass_messages (session_id, community_id, user_id, content, created_at) VALUES (?, ?, ?, ?, NOW())",
        [Number(payload.sessionId), session.communityId, session.userId, content]
      );
      const [participant] = await getParticipantRows(db, payload.sessionId, [session.userId]);
      const message = {
        id: Number(inserted.insertId),
        session_id: Number(payload.sessionId),
        user_id: session.userId,
        content,
        created_at: new Date().toISOString(),
        username: participant?.username || "",
        display_name: participant?.display_name || participant?.username || "",
        avatar_url: participant?.avatar_url || null,
        is_verified: Number(participant?.is_verified || 0),
      };
      io.to(roomName(payload.sessionId)).emit("eclass_chat", message);
      return acknowledge(callback, { ok: true, message });
    } catch (err) {
      console.error("Vine eClass chat error:", err);
      return acknowledge(callback, { ok: false, message: "Message could not be sent" });
    }
  });

  socket.on("eclass_audio_state", async (payload = {}, callback) => {
    const session = requireJoinedSession(payload.sessionId);
    if (!session) return acknowledge(callback, { ok: false });
    const wantsMuted = payload.muted ? 1 : 0;
    const [[participant]] = await db.query(
      "SELECT is_muted_by_host FROM vine_eclass_participants WHERE session_id = ? AND user_id = ? LIMIT 1",
      [Number(payload.sessionId), session.userId]
    );
    if (!wantsMuted && Number(participant?.is_muted_by_host || 0) === 1) {
      return acknowledge(callback, { ok: false, message: "A moderator has muted your microphone" });
    }
    await db.query(
      "UPDATE vine_eclass_participants SET is_self_muted = ? WHERE session_id = ? AND user_id = ?",
      [wantsMuted, Number(payload.sessionId), session.userId]
    );
    io.to(roomName(payload.sessionId)).emit("eclass_audio_state", {
      sessionId: Number(payload.sessionId),
      userId: session.userId,
      muted: Boolean(wantsMuted),
    });
    return acknowledge(callback, { ok: true });
  });

  socket.on("eclass_raise_hand", async (payload = {}, callback) => {
    const session = requireJoinedSession(payload.sessionId);
    if (!session) return acknowledge(callback, { ok: false });
    const raised = payload.raised ? 1 : 0;
    await db.query(
      "UPDATE vine_eclass_participants SET hand_raised = ? WHERE session_id = ? AND user_id = ?",
      [raised, Number(payload.sessionId), session.userId]
    );
    io.to(roomName(payload.sessionId)).emit("eclass_raise_hand", {
      sessionId: Number(payload.sessionId),
      userId: session.userId,
      raised: Boolean(raised),
    });
    return acknowledge(callback, { ok: true });
  });

  socket.on("eclass_moderate_mute", async (payload = {}, callback) => {
    try {
      const session = requireJoinedSession(payload.sessionId);
      const targetUserId = Number(payload.targetUserId);
      if (!session || !targetUserId) return acknowledge(callback, { ok: false });
      if (!["owner", "moderator"].includes(String(session.role || "").toLowerCase())) {
        return acknowledge(callback, { ok: false, message: "Moderator access required" });
      }
      const [[target]] = await db.query(
        `
        SELECT cm.role
        FROM vine_eclass_sessions s
        JOIN vine_community_members cm ON cm.community_id = s.community_id AND cm.user_id = ?
        WHERE s.id = ? AND s.status = 'live'
        LIMIT 1
        `,
        [targetUserId, Number(payload.sessionId)]
      );
      if (!target || String(target.role || "").toLowerCase() !== "member") {
        return acknowledge(callback, { ok: false, message: "Only learners can be muted by a moderator" });
      }
      const muted = payload.muted ? 1 : 0;
      await db.query(
        "UPDATE vine_eclass_participants SET is_muted_by_host = ?, is_self_muted = CASE WHEN ? = 1 THEN 1 ELSE is_self_muted END WHERE session_id = ? AND user_id = ?",
        [muted, muted, Number(payload.sessionId), targetUserId]
      );
      const event = {
        sessionId: Number(payload.sessionId),
        userId: targetUserId,
        muted: Boolean(muted),
        moderatedBy: session.userId,
      };
      io.to(roomName(payload.sessionId)).emit("eclass_moderated_mute", event);
      return acknowledge(callback, { ok: true });
    } catch (err) {
      console.error("Moderate Vine eClass microphone error:", err);
      return acknowledge(callback, { ok: false, message: "Microphone control failed" });
    }
  });

  socket.on("eclass_screen_state", (payload = {}, callback) => {
    const session = requireJoinedSession(payload.sessionId);
    if (!session || !["owner", "moderator"].includes(String(session.role || "").toLowerCase())) {
      return acknowledge(callback, { ok: false, message: "Moderator access required" });
    }
    socket.to(roomName(payload.sessionId)).emit("eclass_screen_state", {
      sessionId: Number(payload.sessionId),
      userId: session.userId,
      sharing: Boolean(payload.sharing),
    });
    return acknowledge(callback, { ok: true });
  });

  socket.on("disconnect", () => {
    const sessions = Array.from(socket.data.eclassSessions?.keys() || []);
    for (const sessionId of sessions) void leaveSession(sessionId);
  });
}
