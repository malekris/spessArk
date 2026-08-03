import assert from "node:assert/strict";
import test from "node:test";
import { getDatabaseBackupPolicy, getDatabaseBackupStatus } from "./databaseBackupService.js";

test("legacy browser dumps are disabled by default", () => {
  const policy = getDatabaseBackupPolicy({});

  assert.equal(policy.dashboardDownloadEnabled, false);
  assert.equal(policy.approvedMethod, "resilient-cli");
  assert.equal(policy.state, "manual_only");
  assert.equal(policy.protectedStorageConfigured, false);
  assert.equal(policy.backgroundJobEnabled, false);
});

test("scheduled backups require dedicated private storage", () => {
  const policy = getDatabaseBackupPolicy({
    DATABASE_BACKUP_JOB_ENABLED: "true",
  });

  assert.equal(policy.state, "configuration_required");
  assert.equal(policy.backgroundJobRequested, true);
  assert.equal(policy.backgroundJobEnabled, false);
});

test("dedicated private storage enables the scheduled worker", () => {
  const policy = getDatabaseBackupPolicy({
    DATABASE_BACKUP_JOB_ENABLED: "true",
    BACKUP_R2_ACCOUNT_ID: "account-id",
    BACKUP_R2_BUCKET: "private-backups",
    BACKUP_R2_ACCESS_KEY_ID: "access-key",
    BACKUP_R2_SECRET_ACCESS_KEY: "secret-key",
  });

  assert.equal(policy.state, "scheduled");
  assert.equal(policy.protectedStorageConfigured, true);
  assert.equal(policy.backgroundJobEnabled, true);
  assert.equal(policy.privateStorage.prefix, "spess-ark/database-backups");
});

test("public backup status never exposes private storage credentials", async () => {
  const status = await getDatabaseBackupStatus({});

  assert.equal(status.state, "manual_only");
  assert.equal("privateStorage" in status, false);
  assert.equal(JSON.stringify(status).includes("secretAccessKey"), false);
});

