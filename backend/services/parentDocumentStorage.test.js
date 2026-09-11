import assert from "node:assert/strict";
import test from "node:test";
import { resolveParentDocumentStorageConfig } from "./parentDocumentStorage.js";

test("prefers dedicated parent document storage", () => {
  const config = resolveParentDocumentStorageConfig({
    PARENT_R2_ACCOUNT_ID: "parent-account",
    PARENT_R2_BUCKET: "parent-private",
    PARENT_R2_ACCESS_KEY_ID: "parent-key",
    PARENT_R2_SECRET_ACCESS_KEY: "parent-secret",
    BACKUP_R2_ACCOUNT_ID: "backup-account",
    BACKUP_R2_BUCKET: "backup-private",
    BACKUP_R2_ACCESS_KEY_ID: "backup-key",
    BACKUP_R2_SECRET_ACCESS_KEY: "backup-secret",
  });

  assert.equal(config.ready, true);
  assert.equal(config.source, "parent");
  assert.equal(config.bucket, "parent-private");
  assert.equal(config.endpoint, "https://parent-account.r2.cloudflarestorage.com");
});

test("falls back to configured private backup storage", () => {
  const config = resolveParentDocumentStorageConfig({
    BACKUP_R2_ACCOUNT_ID: "backup-account",
    BACKUP_R2_BUCKET: "backup-private",
    BACKUP_R2_ACCESS_KEY_ID: "backup-key",
    BACKUP_R2_SECRET_ACCESS_KEY: "backup-secret",
  });

  assert.equal(config.ready, true);
  assert.equal(config.source, "backup");
  assert.equal(config.bucket, "backup-private");
});

test("never treats Vine public-media credentials as parent storage", () => {
  const config = resolveParentDocumentStorageConfig({
    R2_ACCOUNT_ID: "vine-account",
    R2_BUCKET: "vine-public",
    R2_ACCESS_KEY_ID: "vine-key",
    R2_SECRET_ACCESS_KEY: "vine-secret",
    R2_PUBLIC_BASE_URL: "https://media.example.test",
  });

  assert.equal(config.ready, false);
  assert.equal(config.bucket, "");
});
