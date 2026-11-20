const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const ACCOUNTS_TOKEN_KEY = "accountsAdminToken";
const ACCOUNTS_USER_KEY = "accountsAdminUser";
export const ACCOUNTS_IDLE_EXPIRY_KEY = "SPESS_ACCOUNTS_IDLE_EXPIRES_AT";
export const ACCOUNTS_LOGOUT_SIGNAL_KEY = "SPESS_ACCOUNTS_LOGOUT_SIGNAL";

// Finance sessions are intentionally tab-scoped. Persistent local storage made
// the Owner portal reopen without asking for its password on later visits.
export const getAccountsToken = () => sessionStorage.getItem(ACCOUNTS_TOKEN_KEY) || "";

export const getAccountsUser = () => {
  try {
    return JSON.parse(sessionStorage.getItem(ACCOUNTS_USER_KEY) || "null");
  } catch {
    return null;
  }
};

export const setAccountsAuth = (token, user) => {
  // Remove credentials created by older builds before starting the new session.
  localStorage.removeItem(ACCOUNTS_TOKEN_KEY);
  localStorage.removeItem(ACCOUNTS_USER_KEY);
  sessionStorage.setItem(ACCOUNTS_TOKEN_KEY, token);
  sessionStorage.setItem(ACCOUNTS_USER_KEY, JSON.stringify(user || {}));
};

export const setAccountsUser = (user) => {
  sessionStorage.setItem(ACCOUNTS_USER_KEY, JSON.stringify(user || {}));
};

export const clearAccountsAuth = () => {
  sessionStorage.removeItem(ACCOUNTS_TOKEN_KEY);
  sessionStorage.removeItem(ACCOUNTS_USER_KEY);
  localStorage.removeItem(ACCOUNTS_TOKEN_KEY);
  localStorage.removeItem(ACCOUNTS_USER_KEY);
  sessionStorage.removeItem(ACCOUNTS_IDLE_EXPIRY_KEY);
};

export const readAccountsIdleExpiry = () => {
  const expiry = Number(sessionStorage.getItem(ACCOUNTS_IDLE_EXPIRY_KEY) || 0);
  return Number.isFinite(expiry) && expiry > 0 ? expiry : 0;
};

export const writeAccountsIdleExpiry = (expiresAt) => {
  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= 0) return;
  sessionStorage.setItem(ACCOUNTS_IDLE_EXPIRY_KEY, String(expiry));
};

export async function accountsRequest(path, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(`${API_BASE}/api/accounts${path}`, {
    ...options,
    headers: {
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
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
