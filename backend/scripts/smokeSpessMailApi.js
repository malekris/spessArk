import "../config/env.js";

const apiBase = String(process.env.SPESS_MAIL_API_TEST_BASE || "http://127.0.0.1:5001").replace(/\/$/, "");
const email = String(process.env.SPESS_MAIL_TEST_EMAIL || "").trim();
const password = String(process.env.SPESS_MAIL_TEST_PASSWORD || "");

if (!email || !password) {
  console.error("SPESS Mail API smoke test requires SPESS_MAIL_TEST_EMAIL and SPESS_MAIL_TEST_PASSWORD.");
  process.exit(1);
}

let cookie = "";

async function api(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
  return payload;
}

try {
  const login = await api("/api/mail/session", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  console.log(`Login: OK (${login?.account?.email ? "school account" : "account"})`);

  const session = await api("/api/mail/session");
  console.log(`Session restore: ${session?.account?.email ? "OK" : "FAILED"}`);

  const folderResult = await api("/api/mail/folders");
  console.log(`Folders: OK (${folderResult?.folders?.length || 0})`);

  const messageResult = await api("/api/mail/messages?folderId=2&limit=10");
  console.log(`Inbox listing: OK (${messageResult?.messages?.length || 0} message(s))`);

  await api("/api/mail/session", { method: "DELETE" });
  console.log("Logout: OK");
} catch (error) {
  console.error(`SPESS Mail API smoke test failed: ${error.message}`);
  process.exitCode = 1;
}
