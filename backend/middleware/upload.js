import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

// ------------------------
// Avatar upload (Cloudinary)
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
// Banner upload (Cloudinary)
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

// ------------------------
// Post image upload (Cloudinary)
// ------------------------
const postStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "vine/posts",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

export const uploadPost = multer({
  storage: postStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
});
