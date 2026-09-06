import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

import {
  ECLASS_HOST_RETURN_GRACE_MS,
  endEClassForAbsentHost,
  getDefaultEClassMutedState,
  registerVineEClassSocketHandlers,
} from "./vineEClassSocket.js";

const createIoRecorder = () => {
  const events = [];
  return {
    events,
    io: {
      to(room) {
        return {
          emit(event, payload) {
            events.push({ room, event, payload });
          },
        };
      },
    },
  };
};

test("starts the teacher live while learners still join muted", () => {
  assert.equal(getDefaultEClassMutedState(7, 7), 0);
  assert.equal(getDefaultEClassMutedState(12, 7), 1);
});

test("ICE configuration is returned only after authenticated live-community admission", async () => {
  const { io } = createIoRecorder();
  for (const allowed of [false, true]) {
    const handlers = new Map();
    const published = [];
    let credentialRequests = 0;
    let releaseLeave;
    const socket = {
      id: `ice-config-test-${allowed}`, data: {}, rooms: new Set(),
      on(event, fn) { handlers.set(event, fn); },
      join(room) { this.rooms.add(room); },
      leave(room) { this.rooms.delete(room); },
      to() { return { emit(event) { published.push(event); } }; },
    };
    const db = {
      async query(sql) {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized.startsWith("SELECT id FROM vine_users")) return [[{ id: 12 }]];
        if (normalized.startsWith("SELECT s.id AS session_id")) return [allowed ? [{ session_id: 9901, community_id: 99, host_user_id: 7, community_role: "member" }] : []];
        if (normalized.startsWith("SELECT u.id AS user_id")) return [[{ user_id: 12, is_self_muted: 1 }]];
        if (normalized.startsWith("UPDATE vine_eclass_participants SET left_at")) {
          await new Promise((resolve) => { releaseLeave = resolve; });
          return [{ affectedRows: 1 }];
        }
        if (/^(INSERT INTO|UPDATE) vine_eclass_participants/.test(normalized)) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected test query: ${normalized}`);
      },
    };
    registerVineEClassSocketHandlers({ io, socket, db, getIceConfig: async (userId) => {
      assert.equal(userId, 12);
      credentialRequests += 1;
      return { iceServers: [{ urls: "turns:relay.example:443", username: "temporary", credential: "temporary" }] };
    } });
    let response;
    await handlers.get("eclass_join")({ sessionId: 9901, token: "invalid" }, (value) => { response = value; });
    assert.equal(response.ok, false);
    assert.equal(response.rtcConfig, undefined);
    assert.equal(credentialRequests, 0);
    const token = jwt.sign({ id: 12 }, process.env.JWT_SECRET || "vine_secret_key", { expiresIn: "1m" });
    await handlers.get("eclass_join")({ sessionId: 9901, token }, (value) => { response = value; });
    assert.equal(response.ok, allowed);
    assert.equal(Boolean(response.rtcConfig), allowed);
    assert.equal(credentialRequests, allowed ? 1 : 0);
    if (allowed) {
      const leaving = handlers.get("eclass_leave")({ sessionId: 9901 });
      assert.equal(published.at(-1), "eclass_participant_left", "A leave must be published before slow storage can allow a new join");
      releaseLeave();
      await leaving;
    }
  }
});

test("relay outage or disconnect during credential exchange never admits a ghost participant", async () => {
  const { io } = createIoRecorder();
  for (const outcome of ["unavailable", "disconnected"]) {
    const handlers = new Map();
    const socket = {
      id: `relay-failure-${outcome}`, connected: true, data: {}, rooms: new Set(),
      on(event, fn) { handlers.set(event, fn); },
      join() { assert.fail("Must not join the room"); },
    };
    const db = {
      async query(sql) {
        const normalized = sql.replace(/\s+/g, " ").trim();
        if (normalized.startsWith("SELECT id FROM vine_users")) return [[{ id: 12 }]];
        if (normalized.startsWith("SELECT s.id AS session_id")) return [[{ session_id: 9902, community_id: 99, host_user_id: 7, community_role: "member" }]];
        assert.fail("No participant writes before relay credentials are ready");
      },
    };
    registerVineEClassSocketHandlers({ io, socket, db, getIceConfig: async () => {
      if (outcome === "unavailable") throw new Error("Provider body with a secret");
      socket.connected = false;
      return { iceServers: [] };
    } });
    let response;
    const token = jwt.sign({ id: 12 }, process.env.JWT_SECRET || "vine_secret_key", { expiresIn: "1m" });
    await handlers.get("eclass_join")({ sessionId: 9902, token }, (value) => { response = value; });
    if (outcome === "unavailable") {
      assert.equal(response.ok, false);
      assert.equal(response.message, "The audio relay is unavailable. Please try joining again shortly.");
      assert.equal(response.rtcConfig, undefined);
    } else assert.equal(response, undefined);
    assert.equal(socket.data.eclassSessions.size, 0);
  }
});

test("automatically ends an eClass after the host return window expires", async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      queries.push({ sql: normalized, params });
      if (normalized.startsWith("SELECT s.id, s.community_id, s.host_user_id")) {
        return [[{ id: 41, community_id: 9, host_user_id: 7 }]];
      }
      if (normalized.startsWith("UPDATE vine_eclass_sessions s")) {
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("UPDATE vine_eclass_participants")) {
        return [{ affectedRows: 3 }];
      }
      if (normalized.startsWith("SELECT user_id FROM vine_community_members")) {
        return [[{ user_id: 7 }, { user_id: 12 }]];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const { io, events } = createIoRecorder();

  const result = await endEClassForAbsentHost({ io, db, sessionId: 41 });

  assert.deepEqual(result, { ended: true, sessionId: 41, communityId: 9 });
  assert.equal(ECLASS_HOST_RETURN_GRACE_MS, 600_000);
  assert.match(queries[1].sql, /INTERVAL 10 MINUTE/);
  assert.deepEqual(
    events.map(({ room, event, payload }) => ({ room, event, reason: payload.reason })),
    [
      { room: "eclass-41", event: "eclass_ended", reason: "host_absent" },
      { room: "user-7", event: "eclass_ended", reason: "host_absent" },
      { room: "user-12", event: "eclass_ended", reason: "host_absent" },
    ]
  );
});

test("keeps an eClass live while the host return window is still active", async () => {
  const db = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized.startsWith("SELECT s.id, s.community_id, s.host_user_id")) {
        return [[{ id: 52, community_id: 4, host_user_id: 8 }]];
      }
      if (normalized.startsWith("UPDATE vine_eclass_sessions s")) {
        return [{ affectedRows: 0 }];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const { io, events } = createIoRecorder();

  const result = await endEClassForAbsentHost({ io, db, sessionId: 52 });

  assert.deepEqual(result, { ended: false, reason: "grace_active" });
  assert.deepEqual(events, []);
});
