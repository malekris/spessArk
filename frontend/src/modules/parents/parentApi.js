const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const PARENT_TOKEN_KEY = "SPESS_PARENT_TOKEN";

export function getParentToken() {
  try {
    return window.localStorage.getItem(PARENT_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function storeParentToken(token) {
  window.localStorage.setItem(PARENT_TOKEN_KEY, String(token || ""));
}

export function clearParentToken() {
  try {
    window.localStorage.removeItem(PARENT_TOKEN_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
}

async function parseResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function parentRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = options.auth === false ? "" : getParentToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body:
      options.body instanceof FormData
        ? options.body
        : options.body
          ? JSON.stringify(options.body)
          : undefined,
  });
  const body = await parseResponse(res);
  if (!res.ok) {
    const error = new Error(body?.message || `Request failed (${res.status})`);
    error.status = res.status;
    error.code = body?.code;
    throw error;
  }
  return body;
}

export async function openParentDocument(documentId) {
  const token = getParentToken();
  const res = await fetch(`${API_BASE}/api/parents/documents/${documentId}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await parseResponse(res);
    const error = new Error(body?.message || "Document could not be opened.");
    error.status = res.status;
    throw error;
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 90_000);
}

