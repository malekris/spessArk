import assert from "node:assert/strict";
import test from "node:test";

import {
  ECLASS_HOST_RETURN_GRACE_MS,
  endEClassForAbsentHost,
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
