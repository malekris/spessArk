import assert from "node:assert/strict";
import test from "node:test";
import createVineNotificationRouter, {
  getVineUnseenNotificationCount,
  markOneVineNotificationRead,
  markVineNotificationsSeen,
} from "./vineNotificationRoutes.js";

test("marks only the requested notification owned by the viewer", async () => {
  const calls = [];
  const result = await markOneVineNotificationRead({
    db: {
      query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return [{ affectedRows: 1 }];
      },
    },
    notificationId: 42,
    viewerId: 7,
  });

  assert.deepEqual(result, {
    valid: true,
    id: 42,
    viewerId: 7,
    changed: true,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [42, 7]);
  assert.match(calls[0].sql, /WHERE id = \?[\s\S]*AND user_id = \?[\s\S]*AND is_read = 0/);
});

test("does not expose a bulk mark-read route", () => {
  const router = createVineNotificationRouter({
    db: { query: async () => [{ affectedRows: 0 }] },
    authenticate: (_req, _res, next) => next(),
    cleanupExpiredReadNotifications: async () => {},
    ensureVinePerformanceSchema: async () => {},
    getDbName: async () => "test",
    hasColumn: async () => true,
    io: null,
    runVinePerfRoute: async (_name, _meta, callback) => callback({}),
    timedVineQuery: async () => [[]],
    clearVineReadCache: () => {},
    readNotificationRetentionDays: 30,
  });
  const routePaths = router.stack
    .map((layer) => layer.route?.path)
    .filter(Boolean);

  assert.ok(routePaths.includes("/notifications/:id/read"));
  assert.ok(routePaths.includes("/notifications/seen"));
  assert.ok(!routePaths.includes("/notifications/mark-read"));
});

test("stores a monotonic per-user notification seen watermark", async () => {
  const calls = [];
  const result = await markVineNotificationsSeen({
    db: {
      query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return [{ affectedRows: 1 }];
      },
    },
    throughId: 84,
    viewerId: 7,
  });

  assert.deepEqual(result, { valid: true, throughId: 84, viewerId: 7 });
  assert.deepEqual(calls[0].params, [7, 84, 84]);
  assert.match(calls[0].sql, /INSERT INTO vine_notification_views/);
  assert.doesNotMatch(calls[0].sql, /UPDATE vine_notifications/);
  assert.match(calls[0].sql, /GREATEST\(last_seen_notification_id, \?\)/);
});

test("counts badge notifications separately from unread rows", async () => {
  const calls = [];
  const count = await getVineUnseenNotificationCount({
    db: {
      query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return [[{ total: 3 }]];
      },
    },
    viewerId: 7,
  });

  assert.equal(count, 3);
  assert.deepEqual(calls[0].params, [7]);
  assert.match(calls[0].sql, /v\.user_id IS NULL AND n\.is_read = 0/);
  assert.match(calls[0].sql, /n\.id > v\.last_seen_notification_id/);
});
