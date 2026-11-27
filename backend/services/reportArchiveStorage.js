import crypto from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { resolveParentDocumentStorageConfig } from "./parentDocumentStorage.js";

const storageConfig = resolveParentDocumentStorageConfig();

const archiveClient = storageConfig.ready
  ? new S3Client({
      region: "auto",
      endpoint: storageConfig.endpoint,
      credentials: {
        accessKeyId: storageConfig.accessKeyId,
        secretAccessKey: storageConfig.secretAccessKey,
      },
    })
  : null;

const cleanSegment = (value, fallback = "archive") =>
  String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || fallback;

export const hashReportArchive = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

export const isReportArchiveStorageReady = () =>
  storageConfig.ready && Boolean(archiveClient);

export async function uploadReportArchive(buffer, options = {}) {
  if (!isReportArchiveStorageReady()) {
    const error = new Error("Private Cloudflare R2 storage is not configured.");
    error.code = "REPORT_ARCHIVE_STORAGE_UNAVAILABLE";
    throw error;
  }

  const academicYear = cleanSegment(options.academicYear, "unassigned-year");
  const classLevel = cleanSegment(options.classLevel, "class");
  const stream = cleanSegment(options.stream, "stream");
  const period = cleanSegment(options.reportPeriod, "period");
  const filename = cleanSegment(options.filename, "report.pdf");
  const objectKey = [
    "forever-library",
    academicYear,
    classLevel,
    stream,
    period,
    `${Date.now()}-${crypto.randomUUID()}-${filename}`,
  ].join("/");
  const checksum = hashReportArchive(buffer);

  await archiveClient.send(
    new PutObjectCommand({
      Bucket: storageConfig.bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: "application/pdf",
      CacheControl: "private, no-store, max-age=0",
      Metadata: {
        source: "spess-forever-library",
        checksum,
      },
    })
  );

  return { objectKey, checksum };
}

export async function readReportArchive(objectKey) {
  if (!isReportArchiveStorageReady()) {
    const error = new Error("Private Cloudflare R2 storage is not configured.");
    error.code = "REPORT_ARCHIVE_STORAGE_UNAVAILABLE";
    throw error;
  }

  return archiveClient.send(
    new GetObjectCommand({
      Bucket: storageConfig.bucket,
      Key: String(objectKey || ""),
    })
  );
}

export async function deleteReportArchive(objectKey) {
  if (!isReportArchiveStorageReady() || !objectKey) return false;
  await archiveClient.send(
    new DeleteObjectCommand({
      Bucket: storageConfig.bucket,
      Key: String(objectKey),
    })
  );
  return true;
}
