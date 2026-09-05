const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";
const THUMBNAIL_SIZE = 160;

const getLegacyAvatarFileName = (value) => {
  try {
    const url = new URL(value, window.location.origin);
    const match = url.pathname.match(/^\/uploads\/avatars\/([^/]+)$/i);
    return match ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
};

const getCloudinaryThumbnail = (value) => {
  try {
    const url = new URL(value);
    if (url.hostname !== "res.cloudinary.com" || !url.pathname.includes("/image/upload/")) return "";
    url.pathname = url.pathname.replace(
      "/image/upload/",
      `/image/upload/c_fill,f_auto,g_auto,h_${THUMBNAIL_SIZE},q_auto:eco,w_${THUMBNAIL_SIZE}/`
    );
    return url.toString();
  } catch {
    return "";
  }
};

export const getVineAvatarThumbnailUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_AVATAR;

  const cloudinaryThumbnail = getCloudinaryThumbnail(raw);
  if (cloudinaryThumbnail) return cloudinaryThumbnail;

  const legacyFileName = getLegacyAvatarFileName(raw);
  if (legacyFileName) {
    return `${API}/api/vine/media/avatars/${encodeURIComponent(legacyFileName)}/thumbnail.webp`;
  }

  if (/^(?:https?:|blob:|data:)/i.test(raw)) return raw;
  return raw.startsWith("/") ? `${API}${raw}` : `${API}/${raw}`;
};

export const useDefaultVineAvatarOnError = (event) => {
  const image = event.currentTarget;
  image.onerror = null;
  image.src = DEFAULT_AVATAR;
};
