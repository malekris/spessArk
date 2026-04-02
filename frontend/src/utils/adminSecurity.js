export const ADMIN_REAUTH_STORAGE_KEY = "SPESS_ADMIN_REAUTH_TOKEN";
export const ADMIN_REAUTH_EXPIRY_KEY = "SPESS_ADMIN_REAUTH_EXPIRES_AT";
export const ADMIN_SESSION_EXPIRED_EVENT = "spess-admin-session-expired";
export const ADMIN_SESSION_IDLE_EXPIRES_AT_KEY = "SPESS_ADMIN_IDLE_EXPIRES_AT";
export const ADMIN_SESSION_LAST_ACTIVITY_AT_KEY = "SPESS_ADMIN_LAST_ACTIVITY_AT";
export const ADMIN_SESSION_LOGOUT_SIGNAL_KEY = "SPESS_ADMIN_LOGOUT_SIGNAL";

export function clearAdminReauthToken() {
  try {
    sessionStorage.removeItem(ADMIN_REAUTH_STORAGE_KEY);
    sessionStorage.removeItem(ADMIN_REAUTH_EXPIRY_KEY);
    localStorage.removeItem(ADMIN_REAUTH_STORAGE_KEY);
    localStorage.removeItem(ADMIN_REAUTH_EXPIRY_KEY);
  } catch {
    // ignore storage issues
  }
}

export function readAdminIdleExpiry() {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_IDLE_EXPIRES_AT_KEY) || "";
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function writeAdminIdleExpiry(expiresAt, lastActivityAt = Date.now()) {
  try {
    if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) <= 0) return;
    localStorage.setItem(ADMIN_SESSION_IDLE_EXPIRES_AT_KEY, String(Number(expiresAt)));
    localStorage.setItem(ADMIN_SESSION_LAST_ACTIVITY_AT_KEY, String(Number(lastActivityAt)));
  } catch {
    // ignore storage issues
  }
}

export function clearAdminIdleExpiry() {
  try {
    localStorage.removeItem(ADMIN_SESSION_IDLE_EXPIRES_AT_KEY);
    localStorage.removeItem(ADMIN_SESSION_LAST_ACTIVITY_AT_KEY);
  } catch {
    // ignore storage issues
  }
}

export function broadcastAdminLogoutSignal(reason = "logout") {
  try {
    localStorage.setItem(
      ADMIN_SESSION_LOGOUT_SIGNAL_KEY,
      JSON.stringify({
        reason,
        at: Date.now(),
      })
    );
  } catch {
    // ignore storage issues
  }
}

export function getStoredAdminReauthToken() {
  try {
    const expiryRaw =
      sessionStorage.getItem(ADMIN_REAUTH_EXPIRY_KEY) ||
      localStorage.getItem(ADMIN_REAUTH_EXPIRY_KEY) ||
      "";
    const token =
      sessionStorage.getItem(ADMIN_REAUTH_STORAGE_KEY) ||
      localStorage.getItem(ADMIN_REAUTH_STORAGE_KEY) ||
      "";

    if (!token || !expiryRaw) return "";

    const expiry = new Date(expiryRaw).getTime();
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      clearAdminReauthToken();
      return "";
    }

    return token;
  } catch {
    return "";
  }
}

export function storeAdminReauthToken(token, expiresAt) {
  if (!token || !expiresAt) return;
  try {
    sessionStorage.setItem(ADMIN_REAUTH_STORAGE_KEY, token);
    sessionStorage.setItem(ADMIN_REAUTH_EXPIRY_KEY, expiresAt);
    localStorage.removeItem(ADMIN_REAUTH_STORAGE_KEY);
    localStorage.removeItem(ADMIN_REAUTH_EXPIRY_KEY);
  } catch {
    // ignore storage issues
  }
}

export function clearAdminSession() {
  try {
    localStorage.removeItem("SPESS_ADMIN_KEY");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUsername");
    sessionStorage.removeItem("isAdmin");
  } catch {
    // ignore storage issues
  }

  clearAdminIdleExpiry();
  clearAdminReauthToken();
}

export function notifyAdminSessionExpired(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ADMIN_SESSION_EXPIRED_EVENT, {
      detail,
    })
  );
}

export function forceAdminLogout(redirectPath = "/ark", options = {}) {
  const { broadcast = true, reason = "logout" } = options;
  if (broadcast) {
    broadcastAdminLogoutSignal(reason);
  }
  clearAdminSession();
  if (typeof window !== "undefined") {
    window.location.replace(redirectPath);
  }
}
