export const ADMIN_REAUTH_STORAGE_KEY = "SPESS_ADMIN_REAUTH_TOKEN";
export const ADMIN_REAUTH_EXPIRY_KEY = "SPESS_ADMIN_REAUTH_EXPIRES_AT";
export const ADMIN_SESSION_EXPIRED_EVENT = "spess-admin-session-expired";

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

export function forceAdminLogout(redirectPath = "/ark") {
  clearAdminSession();
  if (typeof window !== "undefined") {
    window.location.replace(redirectPath);
  }
}
