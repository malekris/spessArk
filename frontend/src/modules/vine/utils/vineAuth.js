const TOKEN_KEY = "vine_token";
const USER_KEY = "vine_user";
const ACTIVITY_KEY = "vine_last_activity_at";

export const VINE_SESSION_IDLE_MS = 60 * 60 * 1000;
export const VINE_SESSION_WARNING_MS = 2 * 60 * 1000;

export const getVineToken = () => localStorage.getItem(TOKEN_KEY) || "";

export const getVineUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
};

export const clearVineAuth = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ACTIVITY_KEY);
};

export const getVineLastActivityAt = () => {
  const raw = Number(localStorage.getItem(ACTIVITY_KEY) || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
};

export const setVineLastActivityAt = (value = Date.now()) => {
  localStorage.setItem(ACTIVITY_KEY, String(value));
  return value;
};

export const touchVineActivity = () => setVineLastActivityAt(Date.now());

export const getRemainingVineSessionMs = (now = Date.now()) => {
  const lastActivityAt = getVineLastActivityAt();
  if (!lastActivityAt) return VINE_SESSION_IDLE_MS;
  return Math.max(0, VINE_SESSION_IDLE_MS - (Number(now) - lastActivityAt));
};

const decodeBase64Url = (value) => {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
};

export const getJwtPayload = (token) => {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }
};

export const isVineTokenExpired = (token) => {
  const payload = getJwtPayload(token);
  if (!payload?.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return Number(payload.exp) <= now;
};
