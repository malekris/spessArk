import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const isEnabled = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const normalizePrefix = (value) =>
  String(value || "spess-ark/database-backups")
    .trim()
    .replace(/^\/+|\/+$/g, "") || "spess-ark/database-backups";

export function getDatabaseBackupPolicy(env = process.env) {
  const accountId = String(env.BACKUP_R2_ACCOUNT_ID || "").trim();
  const endpoint = accountId
    ? `https://${accountId}.r2.cloudflarestorage.com`
    : String(env.BACKUP_R2_ENDPOINT || "").trim();
  const bucket = String(env.BACKUP_R2_BUCKET || "").trim();
  const accessKeyId = String(env.BACKUP_R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(env.BACKUP_R2_SECRET_ACCESS_KEY || "").trim();
  const protectedStorageConfigured = Boolean(
    endpoint && bucket && accessKeyId && secretAccessKey
  );
  const backgroundJobRequested = isEnabled(env.DATABASE_BACKUP_JOB_ENABLED);
  const backgroundJobEnabled = backgroundJobRequested && protectedStorageConfigured;
  const dashboardDownloadEnabled = isEnabled(env.ENABLE_LEGACY_DATABASE_DUMP);

  let state = "manual_only";
  let message =
    "Browser-generated database dumps are disabled. Resilient CLI backups are the approved manual method.";

  if (backgroundJobRequested && !protectedStorageConfigured) {
    state = "configuration_required";
    message =
      "The scheduled backup worker is waiting for dedicated private backup storage credentials.";
  } else if (backgroundJobEnabled) {
    state = "scheduled";
    message =
      "Protected storage and the scheduled backup worker are configured.";
  } else if (protectedStorageConfigured) {
    state = "storage_ready";
    message =
      "Protected storage is ready. Manual resilient backups can upload private archives.";
  }

  if (dashboardDownloadEnabled) {
    state = "legacy_enabled";
    message =
      "Warning: the legacy browser database dump endpoint is enabled by configuration.";
  }

  return {
    state,
    message,
    dashboardDownloadEnabled,
    approvedMethod: "resilient-cli",
    protectedStorageConfigured,
    backgroundJobRequested,
    backgroundJobEnabled,
    privateStorage: protectedStorageConfigured
      ? {
          endpoint,
          bucket,
          accessKeyId,
          secretAccessKey,
          prefix: normalizePrefix(env.BACKUP_R2_PREFIX),
        }
      : null,
  };
}

const publicPolicy = (policy) => ({
  state: policy.state,
  message: policy.message,
  dashboardDownloadEnabled: policy.dashboardDownloadEnabled,
  approvedMethod: policy.approvedMethod,
  protectedStorageConfigured: policy.protectedStorageConfigured,
  backgroundJobRequested: policy.backgroundJobRequested,
  backgroundJobEnabled: policy.backgroundJobEnabled,
});

const normalizeLastBackup = (value = {}) => ({
  generatedAt: value.generated_at || value.generatedAt || null,
  archiveKey: value.archive_key || value.archiveKey || null,
  archiveBytes: Number(value.archive_bytes || value.archiveBytes) || 0,
  archiveSha256: value.archive_sha256 || value.archiveSha256 || null,
  parts: Number(value.parts) || 0,
  database: value.database || null,
  mysqlVersion: value.mysql_version || value.mysqlVersion || null,
});

const isMissingObjectError = (error) =>
  error?.name === "NoSuchKey" ||
  error?.Code === "NoSuchKey" ||
  error?.$metadata?.httpStatusCode === 404;

export async function getDatabaseBackupStatus(env = process.env) {
  const policy = getDatabaseBackupPolicy(env);
  const status = {
    ...publicPolicy(policy),
    lastBackup: null,
    statusError: "",
  };

  if (!policy.privateStorage) return status;

  const client = new S3Client({
    region: "auto",
    endpoint: policy.privateStorage.endpoint,
    credentials: {
      accessKeyId: policy.privateStorage.accessKeyId,
      secretAccessKey: policy.privateStorage.secretAccessKey,
    },
  });
  const latestKey = `${policy.privateStorage.prefix}/latest.json`;

  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: policy.privateStorage.bucket,
        Key: latestKey,
      })
    );
    const raw = await result.Body?.transformToString();
    if (raw) status.lastBackup = normalizeLastBackup(JSON.parse(raw));
  } catch (error) {
    if (!isMissingObjectError(error)) {
      status.statusError =
        "Protected backup storage is configured, but its latest status could not be read.";
    }
  }

  return status;
}

