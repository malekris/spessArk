// src/lib/api.js
// Minimal, robust client helper used by the admin UI.
// Keeps dev-friendly behaviour (localStorage admin key) and throws friendly errors.

export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export function getAdminHeaders() {
  try {
    const key = window?.localStorage?.getItem?.("SPESS_ADMIN_KEY") || "";
    return key ? { "x-admin-key": key } : {};
  } catch (e) {
    return {};
  }
}

async function handleJson(res) {
  const text = await res.text();
  try {
    // if response body is JSON return parsed object, otherwise return raw text
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function makeUrl(path) {
  // accept both absolute URLs and "relative" API paths
  if (!path) return API_BASE;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  // strip leading slash so double slashes don't appear
  if (path.startsWith("/")) return `${API_BASE}${path}`;
  return `${API_BASE}/${path}`;
}

export async function plainFetch(path, opts = {}) {
  const url = makeUrl(path);
  const method = (opts.method || "GET").toUpperCase();
  const headers = Object.assign({}, opts.headers || {});
  if (opts.body && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const fetchOpts = { method, headers };

  if (opts.body) {
    fetchOpts.body = opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body);
  }

  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const body = await handleJson(res).catch(() => null);
    const message = body && body.message ? body.message : `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return handleJson(res);
}

export async function adminFetch(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {}, getAdminHeaders());
  try {
    return await plainFetch(path, Object.assign({}, opts, { headers }));
  } catch (err) {
    // if 401, provide friendly message
    if (err && err.status === 401) {
      const e = new Error("Admin authorization required (401). Set admin key or disable dev auth.");
      e.status = 401;
      throw e;
    }
    throw err;
  }
}
