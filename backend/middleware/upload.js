import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

// ------------------------
// Post images (memory → manual Cloudinary upload)
// ------------------------
export const uploadPostCloudinary = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 4, fields: 30, parts: 40 },
});

// Community Library support packs stay as opaque archives. The server never
// extracts them; this limit only bounds the in-memory handoff to object storage.
export const uploadCommunitySupportFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 20, parts: 25 },
});

// ------------------------
// Avatar/Banner upload (memory, convert if needed)
// ------------------------
export const uploadAvatarMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 20, parts: 25 },
});

export const uploadBannerMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 20, parts: 25 },
});

// ------------------------
// Avatar upload (CloudinaryStorage)
// ------------------------
const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "vine/avatars",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      { width: 400, height: 400, crop: "fill", gravity: "face" },
    ],
  },
});

export const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ------------------------
// Banner upload (CloudinaryStorage)
// ------------------------
const bannerStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "vine/banners",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      { width: 1500, height: 500, crop: "fill" },
    ],
  },
});

export const uploadBanner = multer({
  storage: bannerStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
});
