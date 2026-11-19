const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export const getAccountsToken = () => localStorage.getItem("accountsAdminToken") || "";

export const getAccountsUser = () => {
  try {
    return JSON.parse(localStorage.getItem("accountsAdminUser") || "null");
  } catch {
    return null;
  }
};

export const setAccountsAuth = (token, user) => {
  localStorage.setItem("accountsAdminToken", token);
  localStorage.setItem("accountsAdminUser", JSON.stringify(user || {}));
};

export const clearAccountsAuth = () => {
  localStorage.removeItem("accountsAdminToken");
  localStorage.removeItem("accountsAdminUser");
};

export async function accountsRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}/api/accounts${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(getAccountsToken() ? { Authorization: `Bearer ${getAccountsToken()}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.message || "Accounts request failed");
    error.status = response.status;
    error.code = body?.code;
    throw error;
  }
  return body;
}
