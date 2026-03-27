const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export function getBoardingToken() {
  return localStorage.getItem("boardingAdminToken") || "";
}

export function clearBoardingAuth() {
  localStorage.removeItem("boardingAdminToken");
  localStorage.removeItem("boardingAdminUser");
}

export function getBoardingUser() {
  try {
    const raw = localStorage.getItem("boardingAdminUser");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function boardingFetch(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${getBoardingToken()}`,
  };

  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body:
      options.body && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body,
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const error = new Error(body?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

export async function logBoardingAction(action, description, options = {}) {
  try {
    await boardingFetch("/api/boarding/audit-action", {
      method: "POST",
      body: {
        action,
        description,
        entityType: options.entityType || "system",
        entityId: options.entityId ?? null,
      },
    });
    return true;
  } catch (err) {
    console.warn("Boarding audit log failed:", err?.message || err);
    return false;
  }
}
