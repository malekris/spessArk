const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

async function request(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_BASE}/api/mail${path}`, {
    ...options,
    headers,
    credentials: "include",
    body: options.body && !(options.body instanceof FormData)
      ? JSON.stringify(options.body)
      : options.body,
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || `SPESS Mail request failed (${response.status})`);
    error.status = response.status;
    error.code = payload?.code;
    throw error;
  }
  return payload;
}

export const mailApi = {
  getSession: () => request("/session"),
  login: (credentials) => request("/session", { method: "POST", body: credentials }),
  logout: () => request("/session", { method: "DELETE" }),
  getFolders: () => request("/folders"),
  getMessages: ({ folderId = "2", query = "", limit = 50, offset = 0 } = {}) => {
    const params = new URLSearchParams({ folderId, query, limit: String(limit), offset: String(offset) });
    return request(`/messages?${params.toString()}`);
  },
  getMessage: (id) => request(`/messages/${encodeURIComponent(id)}`),
  sendMessage: (message) => request("/messages", { method: "POST", body: message }),
  action: (id, operation) => request(`/messages/${encodeURIComponent(id)}/action`, {
    method: "POST",
    body: { operation },
  }),
  getActivationStatus: () => request("/activation/status"),
  activate: (details) => request("/activation", { method: "POST", body: details }),
};
