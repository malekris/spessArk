import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { searchGroupCandidates, getEligibleGroupUsers } from "./groupDirectory.js";

function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec(`
    CREATE TABLE vine_users (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, avatar_url TEXT, is_verified INTEGER);
    CREATE TABLE vine_blocks (blocker_id INTEGER, blocked_id INTEGER);
  `);
  const insert = sql.prepare("INSERT INTO vine_users VALUES (?, ?, ?, NULL, 0)");
  for (let id = 1; id <= 85; id++) insert.run(id, `learner_${id}`, `Learner ${String(id).padStart(3, "0")}`);
  sql.exec("UPDATE vine_users SET display_name = 'Sarah Grace Nambi' WHERE id = 85");
  sql.exec("INSERT INTO vine_blocks VALUES (1, 2), (3, 1)");
  return { query: async (query, params) => [sql.prepare(query).all(...params)] };
}

test("finds and admits non-followers by display name and @username", async (t) => {
  const db = fixture(t);
  for (const query of ["sArAh", " Grace   Nambi ", "@learner_85"]) {
    const result = await searchGroupCandidates(db, { actorId: 1, query });
    assert.deepEqual(result.people.map((person) => person.id), [85]);
  }
  assert.deepEqual(await getEligibleGroupUsers(db, 1, [85, 85, 1, 999]), [85]);
});

test("preserves blocks in both directions in search and admission", async (t) => {
  const db = fixture(t);
  const result = await searchGroupCandidates(db, { actorId: 1 });
  assert.ok(result.people.every((person) => ![1, 2, 3].includes(person.id)));
  assert.deepEqual(await getEligibleGroupUsers(db, 1, [2, 3, 4]), [4]);
});

test("excludes existing members before pagination and reaches users past the old 60-result cap", async (t) => {
  const db = fixture(t);
  const excludeIds = Array.from({ length: 32 }, (_, index) => index + 4);
  const first = await searchGroupCandidates(db, { actorId: 1, excludeIds });
  assert.equal(first.people.length, 30);
  assert.equal(first.people[0].id, 36);
  const second = await searchGroupCandidates(db, { actorId: 1, excludeIds, offset: first.nextOffset });
  const ids = [...first.people, ...second.people].map((person) => person.id);
  assert.equal(new Set(ids).size, 50);
  assert.ok(ids.includes(85));
  assert.equal(second.hasMore, false);
});

test("treats wildcard and SQL punctuation as literal search text", async (t) => {
  const db = fixture(t);
  for (const query of ["%", "' OR 1=1 --", "!"]) {
    assert.equal((await searchGroupCandidates(db, { actorId: 1, query })).people.length, 0);
  }
  assert.equal((await searchGroupCandidates(db, { actorId: 1, query: "learner_85" })).people.length, 1);
});
