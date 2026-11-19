import crypto from "node:crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

const readEnv = (env, key) => String(env[key] || "").trim();

export function resolveAccountsAvatarStorageConfig(env = process.env) {
  const accountId = readEnv(env, "R2_ACCOUNT_ID");
  const endpoint = accountId
    ? `https://${accountId}.r2.cloudflarestorage.com`
    : readEnv(env, "R2_ENDPOINT");
  const bucket = readEnv(env, "R2_BUCKET");
  const accessKeyId = readEnv(env, "R2_ACCESS_KEY_ID");
  const secretAccessKey = readEnv(env, "R2_SECRET_ACCESS_KEY");
  const publicBaseUrl = readEnv(env, "R2_PUBLIC_BASE_URL").replace(/\/+$/, "");

  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    ready: Boolean(
      endpoint && bucket && accessKeyId && secretAccessKey && publicBaseUrl
    ),
  };
}

const storageConfig = resolveAccountsAvatarStorageConfig();
const r2Client = storageConfig.ready
  ? new S3Client({
      region: "auto",
      endpoint: storageConfig.endpoint,
      credentials: {
        accessKeyId: storageConfig.accessKeyId,
        secretAccessKey: storageConfig.secretAccessKey,
      },
    })
  : null;

export function isAccountsAvatarStorageReady() {
  return storageConfig.ready && Boolean(r2Client);
}

export function getAccountsAvatarObjectKey(rawUrl, publicBaseUrl = storageConfig.publicBaseUrl) {
  const url = String(rawUrl || "").trim();
  const base = String(publicBaseUrl || "").trim().replace(/\/+$/, "");
  if (!url || !base || !url.startsWith(`${base}/`)) return null;
  const key = url.slice(base.length + 1);
  return key.startsWith("accounts/avatars/") ? key : null;
}

export async function uploadAccountsAvatar(buffer, { userId } = {}) {
  if (!isAccountsAvatarStorageReady()) {
    const error = new Error("Cloudflare R2 profile storage is not configured.");
    error.code = "ACCOUNTS_AVATAR_STORAGE_UNAVAILABLE";
    throw error;
  }

  // Normalize every source image before it reaches public storage. This keeps
  // profile photos small, strips metadata, and gives the UI a stable square.
  const optimized = await sharp(buffer)
    .rotate()
    .resize(512, 512, { fit: "cover", position: "attention" })
    .webp({ quality: 84 })
    .toBuffer();
  const key = `accounts/avatars/${Number(userId)}/${Date.now()}-${crypto.randomUUID()}.webp`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: storageConfig.bucket,
      Key: key,
      Body: optimized,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
      Metadata: { source: "spess-accounts" },
    })
  );

  return {
    key,
    url: `${storageConfig.publicBaseUrl}/${key}`,
  };
}

export async function deleteAccountsAvatar(rawUrl) {
  const key = getAccountsAvatarObjectKey(rawUrl);
  if (!r2Client || !key) return false;
  await r2Client.send(
    new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: key })
  );
  return true;
}
