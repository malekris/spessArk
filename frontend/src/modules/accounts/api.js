const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const ACCOUNTS_TOKEN_KEY = "accountsAdminToken";
const ACCOUNTS_USER_KEY = "accountsAdminUser";

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
