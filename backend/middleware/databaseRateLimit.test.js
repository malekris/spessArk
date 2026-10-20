import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseRateLimit } from "./databaseRateLimit.js";

test("database limiter rejects the fourth request for the same IP/account", async () => {
  const rows = new Map();
  const db = { async query(sql, params) {
    if (sql.startsWith("CREATE")) return [];
    if (sql.startsWith("DELETE")) return [];
    if (sql.startsWith("INSERT")) {
      const [namespace, key, window, cap = Number.MAX_SAFE_INTEGER] = params;
      const id = `${namespace}:${key}`;
      const row = rows.get(id);
      rows.set(id, !row || row.window !== window ? { window, attempts: 1 } : { window, attempts: Math.min(row.attempts + 1, cap) });
      return [];
    }
    const row = rows.get(`${params[0]}:${params[1]}`) || { attempts: 0, window: 0 };
    return [[{ attempts: row.attempts, window_start: row.window }]];
  }};
  const limit = createDatabaseRateLimit(() => db, { namespace: "test", max: 3, account: (req) => req.body.email });
  const req = { socket: { remoteAddress: "127.0.0.1" }, body: { email: "a@example.test" } };
  let nextCount = 0;
  for (let i = 0; i < 3; i++) await limit(req, { set() {}, status() { return this; }, json() {} }, () => nextCount++);
  let status;
  await limit(req, { set() {}, status(value) { status = value; return this; }, json() {} }, () => nextCount++);
  assert.equal(nextCount, 3);
  assert.equal(status, 429);
});
