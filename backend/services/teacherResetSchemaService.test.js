import assert from "node:assert/strict";
import test from "node:test";

import { ensureTeacherResetSchemaReady } from "./teacherResetSchemaService.js";

function createConnection(columns) {
  const statements = [];
  return {
    statements,
    async query(sql) {
      statements.push(sql);
      if (sql.includes("information_schema.columns")) {
        return [columns];
      }
      return [{}];
    },
  };
}

test("widens a legacy reset token column without recreating it", async () => {
  const connection = createConnection([
    { column_name: "reset_token", data_type: "varchar", character_maximum_length: 50 },
    { column_name: "reset_expires", data_type: "datetime", character_maximum_length: null },
  ]);

  await ensureTeacherResetSchemaReady(connection);

  assert.equal(connection.statements.length, 2);
  assert.match(connection.statements[1], /MODIFY COLUMN reset_token VARCHAR\(255\)/);
});

test("does not alter an already compatible reset schema", async () => {
  const connection = createConnection([
    { column_name: "reset_token", data_type: "varchar", character_maximum_length: 255 },
    { column_name: "reset_expires", data_type: "datetime", character_maximum_length: null },
  ]);

  await ensureTeacherResetSchemaReady(connection);

  assert.equal(connection.statements.length, 1);
});

test("creates missing reset columns for an older teachers table", async () => {
  const connection = createConnection([]);

  await ensureTeacherResetSchemaReady(connection);

  assert.equal(connection.statements.length, 3);
  assert.match(connection.statements[1], /ADD COLUMN reset_token VARCHAR\(255\)/);
  assert.match(connection.statements[2], /ADD COLUMN reset_expires DATETIME/);
});

