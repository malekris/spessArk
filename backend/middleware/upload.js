import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

// ------------------------
// Post images (memory → manual Cloudinary upload)
// ------------------------
export const uploadPostCloudinary = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ------------------------
// Avatar/Banner upload (memory, convert if needed)
// ------------------------
export const uploadAvatarMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

export const uploadBannerMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
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
