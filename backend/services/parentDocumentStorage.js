import crypto from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const readEnv = (env, key) => String(env[key] || "").trim();

/**
 * Resolve private storage without ever falling back to Vine's public-media
 * bucket. A dedicated parent bucket remains preferred. Railway deployments
 * that already have the private backup bucket configured can safely reuse
 * those credentials because parent documents live under their own prefix and
 * are only read through authenticated backend routes.
 */
export function resolveParentDocumentStorageConfig(env = process.env) {
  const parent = {
    accountId: readEnv(env, "PARENT_R2_ACCOUNT_ID"),
    endpoint: readEnv(env, "PARENT_R2_ENDPOINT"),
    bucket: readEnv(env, "PARENT_R2_BUCKET"),
    accessKeyId: readEnv(env, "PARENT_R2_ACCESS_KEY_ID"),
    secretAccessKey: readEnv(env, "PARENT_R2_SECRET_ACCESS_KEY"),
    source: "parent",
  };
  const backup = {
    accountId: readEnv(env, "BACKUP_R2_ACCOUNT_ID"),
    endpoint: readEnv(env, "BACKUP_R2_ENDPOINT"),
    bucket: readEnv(env, "BACKUP_R2_BUCKET"),
    accessKeyId: readEnv(env, "BACKUP_R2_ACCESS_KEY_ID"),
    secretAccessKey: readEnv(env, "BACKUP_R2_SECRET_ACCESS_KEY"),
    source: "backup",
  };

  const isComplete = (candidate) =>
    Boolean(
      candidate.bucket &&
      candidate.accessKeyId &&
      candidate.secretAccessKey &&
      (candidate.accountId || candidate.endpoint)
    );
  const selected = isComplete(parent) ? parent : isComplete(backup) ? backup : parent;

  return {
    ...selected,
    endpoint: selected.accountId
      ? `https://${selected.accountId}.r2.cloudflarestorage.com`
      : selected.endpoint,
    ready: isComplete(selected),
  };
}

const storageConfig = resolveParentDocumentStorageConfig();
const R2_BUCKET = storageConfig.bucket;
const R2_ACCESS_KEY_ID = storageConfig.accessKeyId;
const R2_SECRET_ACCESS_KEY = storageConfig.secretAccessKey;
const R2_ENDPOINT = storageConfig.endpoint;

const r2Ready = storageConfig.ready;

const r2Client = r2Ready
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

const cleanSegment = (value, fallback = "document") =>
  String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || fallback;

export function isParentDocumentStorageReady() {
  return r2Ready && Boolean(r2Client);
}

export function hashParentDocument(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function uploadParentDocument(buffer, options = {}) {
  if (!isParentDocumentStorageReady()) {
    const error = new Error("Cloudflare R2 private document storage is not configured.");
    error.code = "PARENT_DOCUMENT_STORAGE_UNAVAILABLE";
    throw error;
  }

  const type = cleanSegment(options.documentType, "document");
  const year = cleanSegment(options.academicYear, "unassigned-year");
  const filename = cleanSegment(options.filename, "document.pdf");
  const objectKey = [
    "spess-parents",
    type,
    year,
    `${Date.now()}-${crypto.randomUUID()}-${filename}`,
  ].join("/");

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: objectKey,
      Body: buffer,
      ContentType: options.contentType || "application/pdf",
      CacheControl: "private, no-store, max-age=0",
      Metadata: {
        source: "spess-parent-portal",
        checksum: hashParentDocument(buffer),
      },
    })
  );

  return { objectKey };
}

export async function readParentDocument(objectKey) {
  if (!isParentDocumentStorageReady()) {
    const error = new Error("Cloudflare R2 private document storage is not configured.");
    error.code = "PARENT_DOCUMENT_STORAGE_UNAVAILABLE";
    throw error;
  }

  return r2Client.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: String(objectKey || ""),
    })
  );
}

/**
 * Remove a newly uploaded object when its matching database transaction fails.
 * Released documents are revoked in the database instead of being deleted here.
 */
export async function deleteParentDocument(objectKey) {
  if (!isParentDocumentStorageReady() || !objectKey) return false;

  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: String(objectKey),
    })
  );
  return true;
}
