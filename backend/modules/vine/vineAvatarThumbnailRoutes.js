import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import sharp from "sharp";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const legacyAvatarDirectory = path.resolve(moduleDir, "../../uploads/avatars");
const thumbnailCache = new Map();
const MAX_CACHED_THUMBNAILS = 128;

export const VINE_AVATAR_THUMBNAIL_SIZE = 160;
export const VINE_AVATAR_CACHE_CONTROL = "public, max-age=31536000, immutable";

export const sanitizeLegacyAvatarFileName = (value) => {
  const fileName = String(value || "").trim();
  if (!fileName || fileName !== path.basename(fileName)) return "";
  return /\.(?:avif|heic|heif|jpe?g|png|webp)$/i.test(fileName) ? fileName : "";
};

export const buildVineAvatarThumbnail = async (input) => sharp(input)
  .rotate()
  .resize(VINE_AVATAR_THUMBNAIL_SIZE, VINE_AVATAR_THUMBNAIL_SIZE, {
    fit: "cover",
    position: sharp.strategy.attention,
  })
  .webp({ quality: 76, effort: 4 })
  .toBuffer();

const rememberThumbnail = (fileName, thumbnail) => {
  if (thumbnailCache.has(fileName)) thumbnailCache.delete(fileName);
  thumbnailCache.set(fileName, thumbnail);
  if (thumbnailCache.size <= MAX_CACHED_THUMBNAILS) return;
  thumbnailCache.delete(thumbnailCache.keys().next().value);
};

export default function createVineAvatarThumbnailRouter() {
  const router = express.Router();

  router.get("/media/avatars/:fileName/thumbnail.webp", async (req, res) => {
    const fileName = sanitizeLegacyAvatarFileName(req.params.fileName);
    if (!fileName) return res.status(400).json({ message: "Invalid avatar file" });

    try {
      let thumbnail = thumbnailCache.get(fileName);
      if (!thumbnail) {
        const sourcePath = path.join(legacyAvatarDirectory, fileName);
        thumbnail = await buildVineAvatarThumbnail(sourcePath);
        rememberThumbnail(fileName, thumbnail);
      }

      res.set({
        "Cache-Control": VINE_AVATAR_CACHE_CONTROL,
        "CDN-Cache-Control": VINE_AVATAR_CACHE_CONTROL,
        "Cloudflare-CDN-Cache-Control": VINE_AVATAR_CACHE_CONTROL,
        "Content-Type": "image/webp",
      });
      return res.send(thumbnail);
    } catch (err) {
      if (err?.code !== "ENOENT") {
        console.warn("Vine avatar thumbnail error:", err?.message || err);
      }
      return res.status(404).json({ message: "Avatar not found" });
    }
  });

  return router;
}
