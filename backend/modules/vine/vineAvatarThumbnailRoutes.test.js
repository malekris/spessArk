import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  buildVineAvatarThumbnail,
  sanitizeLegacyAvatarFileName,
  VINE_AVATAR_CACHE_CONTROL,
  VINE_AVATAR_THUMBNAIL_SIZE,
} from "./vineAvatarThumbnailRoutes.js";

test("accepts image filenames without allowing path traversal", () => {
  assert.equal(sanitizeLegacyAvatarFileName("user-2-123.png"), "user-2-123.png");
  assert.equal(sanitizeLegacyAvatarFileName("../../server.js"), "");
  assert.equal(sanitizeLegacyAvatarFileName("avatar.svg"), "");
});

test("creates a compact square WebP avatar", async () => {
  const source = await sharp({
    create: {
      width: 900,
      height: 600,
      channels: 3,
      background: { r: 12, g: 110, b: 74 },
    },
  }).png().toBuffer();
  const thumbnail = await buildVineAvatarThumbnail(source);
  const metadata = await sharp(thumbnail).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, VINE_AVATAR_THUMBNAIL_SIZE);
  assert.equal(metadata.height, VINE_AVATAR_THUMBNAIL_SIZE);
  assert.ok(thumbnail.length < source.length);
  assert.match(VINE_AVATAR_CACHE_CONTROL, /immutable/);
});
