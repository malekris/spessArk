export const MOBILE_PERSISTENT_SESSION_MODE = "mobile_persistent";
export const BROWSER_SESSION_MODE = "browser_session";
export const MOBILE_SESSION_EXPIRES_IN = process.env.MOBILE_SESSION_EXPIRES_IN || "30d";
const DEFAULT_MOBILE_SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const configuredMobileIdleMs = Number(
  process.env.MOBILE_SESSION_IDLE_MS || DEFAULT_MOBILE_SESSION_IDLE_MS
);
export const MOBILE_SESSION_IDLE_MS =
  Number.isFinite(configuredMobileIdleMs) && configuredMobileIdleMs >= 24 * 60 * 60 * 1000
    ? configuredMobileIdleMs
    : DEFAULT_MOBILE_SESSION_IDLE_MS;

export const isPersistentMobileSession = (value) =>
  String(value?.session_mode || value || "").trim().toLowerCase() ===
  MOBILE_PERSISTENT_SESSION_MODE;

const isMobileRequest = (req) => {
  const clientHint = String(req.get?.("sec-ch-ua-mobile") || "").trim();
  if (clientHint === "?1" || clientHint === "1") return true;

  const userAgent = String(req.get?.("user-agent") || req.headers?.["user-agent"] || "");
  return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(userAgent);
};

export const resolveRequestedSessionMode = (req, requestedMode) => {
  if (
    String(requestedMode || "").trim().toLowerCase() === MOBILE_PERSISTENT_SESSION_MODE &&
    isMobileRequest(req)
  ) {
    return MOBILE_PERSISTENT_SESSION_MODE;
  }
  return BROWSER_SESSION_MODE;
};

export const getSessionExpiry = (sessionMode, desktopExpiry) =>
  isPersistentMobileSession(sessionMode) ? MOBILE_SESSION_EXPIRES_IN : desktopExpiry;

export const getVineSessionIdleMs = (claims, desktopIdleMs) =>
  isPersistentMobileSession(claims) ? MOBILE_SESSION_IDLE_MS : desktopIdleMs;
