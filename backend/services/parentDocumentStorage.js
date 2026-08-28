import crypto from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Learner reports must never share Vine's public-media bucket. A dedicated
// private bucket also lets its access token be revoked independently.
const R2_ACCOUNT_ID = String(process.env.PARENT_R2_ACCOUNT_ID || "").trim();
const R2_BUCKET = String(process.env.PARENT_R2_BUCKET || "").trim();
const R2_ACCESS_KEY_ID = String(process.env.PARENT_R2_ACCESS_KEY_ID || "").trim();
const R2_SECRET_ACCESS_KEY = String(process.env.PARENT_R2_SECRET_ACCESS_KEY || "").trim();
const R2_ENDPOINT = R2_ACCOUNT_ID
  ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  : String(process.env.PARENT_R2_ENDPOINT || "").trim();

const r2Ready = Boolean(
  R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ENDPOINT
);

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
