import test from "node:test";
import assert from "node:assert/strict";
import {
  getAccountsAvatarObjectKey,
  resolveAccountsAvatarStorageConfig,
} from "./accountsAvatarStorage.js";

test("resolves the existing public Cloudflare R2 configuration", () => {
  const config = resolveAccountsAvatarStorageConfig({
    R2_ACCOUNT_ID: "account-id",
    R2_BUCKET: "school-media",
    R2_ACCESS_KEY_ID: "access-key",
    R2_SECRET_ACCESS_KEY: "secret-key",
    R2_PUBLIC_BASE_URL: "https://media.example.test/",
  });
  assert.equal(config.ready, true);
  assert.equal(config.endpoint, "https://account-id.r2.cloudflarestorage.com");
  assert.equal(config.publicBaseUrl, "https://media.example.test");
});

test("only extracts object keys belonging to Accounts avatars", () => {
  const base = "https://media.example.test";
  assert.equal(
    getAccountsAvatarObjectKey(
      `${base}/accounts/avatars/4/avatar.webp`,
      base
    ),
    "accounts/avatars/4/avatar.webp"
  );
  assert.equal(getAccountsAvatarObjectKey(`${base}/vine/posts/photo.webp`, base), null);
});
