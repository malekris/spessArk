export const TEACHER_SESSION_EXPIRED_EVENT = "spess-teacher-session-expired";
export const TEACHER_SESSION_IDLE_EXPIRES_AT_KEY = "SPESS_TEACHER_IDLE_EXPIRES_AT";
export const TEACHER_SESSION_LAST_ACTIVITY_AT_KEY = "SPESS_TEACHER_LAST_ACTIVITY_AT";
export const TEACHER_SESSION_LOGOUT_SIGNAL_KEY = "SPESS_TEACHER_LOGOUT_SIGNAL";

export function readTeacherIdleExpiry() {
  try {
    const raw = localStorage.getItem(TEACHER_SESSION_IDLE_EXPIRES_AT_KEY) || "";
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function writeTeacherIdleExpiry(expiresAt, lastActivityAt = Date.now()) {
  try {
    if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) <= 0) return;
    localStorage.setItem(TEACHER_SESSION_IDLE_EXPIRES_AT_KEY, String(Number(expiresAt)));
    localStorage.setItem(TEACHER_SESSION_LAST_ACTIVITY_AT_KEY, String(Number(lastActivityAt)));
  } catch {
    // ignore storage issues
  }
}

export function clearTeacherIdleExpiry() {
  try {
    localStorage.removeItem(TEACHER_SESSION_IDLE_EXPIRES_AT_KEY);
    localStorage.removeItem(TEACHER_SESSION_LAST_ACTIVITY_AT_KEY);
  } catch {
    // ignore storage issues
  }
}

export function clearTeacherSession() {
  try {
    localStorage.removeItem("teacherToken");
    localStorage.removeItem("teacherProfile");
    sessionStorage.removeItem("teacherResetMode");
  } catch {
    // ignore storage issues
  }

  clearTeacherIdleExpiry();
}

export function broadcastTeacherLogoutSignal(reason = "logout") {
  try {
    localStorage.setItem(
      TEACHER_SESSION_LOGOUT_SIGNAL_KEY,
      JSON.stringify({
        reason,
        at: Date.now(),
      })
    );
  } catch {
    // ignore storage issues
  }
}

export function notifyTeacherSessionExpired(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TEACHER_SESSION_EXPIRED_EVENT, {
      detail,
    })
  );
}

export function forceTeacherLogout(redirectPath = "/ark/teacher-login", options = {}) {
  const { broadcast = true, reason = "logout" } = options;
  if (broadcast) {
    broadcastTeacherLogoutSignal(reason);
  }
  clearTeacherSession();
  if (typeof window !== "undefined") {
    window.location.replace(redirectPath);
  }
}
