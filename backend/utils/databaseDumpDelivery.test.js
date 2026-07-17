import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { sendDatabaseDumpFile } from "./databaseDumpDelivery.js";

class MemoryResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = new Map();
    this.headersSent = false;
    this.chunks = [];
  }

  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), String(value));
  }

  getHeader(name) {
    return this.headers.get(String(name).toLowerCase());
  }

  _write(chunk, encoding, callback) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  get body() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

test("streams a database dump with download headers and removes the temporary file", async () => {
  const tempDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "spess-dump-test-")
  );
  const dumpPath = path.join(tempDirectory, "backup.sql");
  const dumpSql = "CREATE TABLE example (id INT);\n";
  await fs.promises.writeFile(dumpPath, dumpSql, "utf8");

  try {
    const response = new MemoryResponse();
    await sendDatabaseDumpFile(response, dumpPath, 'spess_"backup.sql');

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, dumpSql);
    assert.equal(
      response.getHeader("content-disposition"),
      'attachment; filename="spess__backup.sql"'
    );
    assert.equal(response.getHeader("content-length"), String(Buffer.byteLength(dumpSql)));
    await assert.rejects(fs.promises.access(dumpPath));
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  }
});

test("rejects and removes an empty database dump", async () => {
  const tempDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "spess-empty-dump-test-")
  );
  const dumpPath = path.join(tempDirectory, "empty.sql");
  await fs.promises.writeFile(dumpPath, "", "utf8");

  try {
    await assert.rejects(
      sendDatabaseDumpFile({}, dumpPath, "empty.sql"),
      /generated database dump is empty/i
    );
    await assert.rejects(fs.promises.access(dumpPath));
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  }
});
