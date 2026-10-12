import test from "node:test";
import assert from "node:assert/strict";
import { buildSuspensionResponse, getActiveVineSuspension } from "./vineSuspensions.js";

test("returns an active suspension with server-derived remaining seconds", async () => {
  const db = {
    query: async (sql, params) => {
      assert.match(sql, /TIMESTAMPDIFF\(SECOND, NOW\(\), ends_at\)/);
      assert.deepEqual(params[0], 17);
      assert.deepEqual(params[1], ["likes_comments", "likes_comments_messages", "all"]);
      return [[{ id: 4, scope: "likes_comments", remaining_seconds: 90 }]];
    },
  };

  assert.deepEqual(await getActiveVineSuspension(db, 17), {
    id: 4,
    scope: "likes_comments",
    remaining_seconds: 90,
  });
});

test("missing legacy suspension table is treated as no restriction", async () => {
  const db = {
    query: async () => {
      const error = new Error("table missing");
      error.code = "ER_NO_SUCH_TABLE";
      throw error;
    },
  };

  assert.equal(await getActiveVineSuspension(db, 22), null);
});

test("suspension response is consistent across feed and messages", () => {
  const response = buildSuspensionResponse({ id: 9 });
  assert.equal(response.code, "VINE_ACCOUNT_SUSPENDED");
  assert.equal(response.suspension.id, 9);
  assert.match(response.message, /feed/);
  assert.match(response.message, /statuses/);
  assert.match(response.message, /messaging/);
  assert.equal(response.error, response.message);
});
