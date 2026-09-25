import "../config/env.js";

const email = String(process.env.SPESS_MAIL_TEST_EMAIL || "").trim();
const password = String(process.env.SPESS_MAIL_TEST_PASSWORD || "");
const configuredBaseUrl = String(process.env.SPESS_MAIL_BASE_URL || "").trim();

function fail(message) {
  console.error(`SPESS Mail diagnostic failed: ${message}`);
  process.exitCode = 1;
}

function normalizeBaseUrl(value) {
  if (!value) return "";

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SPESS_MAIL_BASE_URL must be a valid HTTPS URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("SPESS_MAIL_BASE_URL must use HTTPS");
  }

  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function findAuthToken(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);

  if (Object.prototype.hasOwnProperty.call(value, "authToken")) {
    const token = value.authToken;
    if (typeof token === "string") return token;
    if (token && typeof token._content === "string") return token._content;
    if (Array.isArray(token)) {
      for (const item of token) {
        if (typeof item === "string") return item;
        if (item && typeof item._content === "string") return item._content;
      }
    }
  }

  for (const child of Object.values(value)) {
    const token = findAuthToken(child, seen);
    if (token) return token;
  }

  return "";
}

function findObjectByKey(value, key, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];

  for (const child of Object.values(value)) {
    const found = findObjectByKey(child, key, seen);
    if (found) return found;
  }

  return null;
}

function countFolders(folder) {
  if (Array.isArray(folder)) {
    return folder.reduce((total, child) => total + countFolders(child), 0);
  }
  if (!folder || typeof folder !== "object") return 0;
  const children = Array.isArray(folder.folder) ? folder.folder : [];
  return 1 + children.reduce((total, child) => total + countFolders(child), 0);
}

function findFolderById(folder, id) {
  if (Array.isArray(folder)) {
    for (const child of folder) {
      const match = findFolderById(child, id);
      if (match) return match;
    }
    return null;
  }
  if (!folder || typeof folder !== "object") return null;
  if (String(folder.id || "") === String(id)) return folder;

  const children = Array.isArray(folder.folder) ? folder.folder : [];
  for (const child of children) {
    const match = findFolderById(child, id);
    if (match) return match;
  }

  return null;
}

async function postSoap(baseUrl, body, authToken = "") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  const context = { _jsns: "urn:zimbra" };
  if (authToken) context.authToken = { _content: authToken };

  try {
    const response = await fetch(`${baseUrl}/service/soap`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Header: { context },
        Body: body,
        _jsns: "urn:zimbraSoap",
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let payload;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      throw new Error(`server returned non-JSON data (HTTP ${response.status})`);
    }

    if (!response.ok || findObjectByKey(payload, "Fault")) {
      const fault = findObjectByKey(payload, "Fault");
      const reason =
        fault?.Reason?.Text ||
        fault?.reason ||
        fault?.Detail?.Error?.Code ||
        `HTTP ${response.status}`;
      throw new Error(String(reason).slice(0, 240));
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  if (!email || !password || !configuredBaseUrl) {
    fail(
      "SPESS_MAIL_TEST_EMAIL, SPESS_MAIL_TEST_PASSWORD, and SPESS_MAIL_BASE_URL are required",
    );
    return;
  }

  const baseUrl = normalizeBaseUrl(configuredBaseUrl);
  console.log(`Testing Carbonio at ${new URL(baseUrl).hostname}...`);

  const authPayload = await postSoap(baseUrl, {
    AuthRequest: {
      _jsns: "urn:zimbraAccount",
      account: { by: "name", _content: email },
      password,
      csrfTokenSecured: true,
      persistAuthTokenCookie: false,
      generateDeviceId: true,
    },
  });

  const authToken = findAuthToken(authPayload);
  if (!authToken) throw new Error("authentication succeeded without returning a usable token");
  console.log("Authentication: OK");

  try {
    await postSoap(
      baseUrl,
      {
        GetInfoRequest: {
          _jsns: "urn:zimbraAccount",
          sections: "attrs,props",
        },
      },
      authToken,
    );
    console.log("Account API: OK");

    const folderPayload = await postSoap(
      baseUrl,
      {
        GetFolderRequest: {
          _jsns: "urn:zimbraMail",
          folder: { l: "1" },
        },
      },
      authToken,
    );

    const rootFolder = findObjectByKey(folderPayload, "folder");
    if (!rootFolder || typeof rootFolder !== "object") {
      throw new Error("mail API did not return a folder tree");
    }

    const inbox = findFolderById(rootFolder, 2);
    console.log("Mail API: OK");
    console.log(`Folders visible: ${countFolders(rootFolder)}`);
    if (inbox) {
      console.log(
        `Inbox totals: ${Number(inbox.n || 0)} message(s), ${Number(inbox.u || 0)} unread`,
      );
    }

    const searchPayload = await postSoap(
      baseUrl,
      {
        SearchRequest: {
          _jsns: "urn:zimbraMail",
          sortBy: "dateDesc",
          offset: 0,
          limit: 1,
          types: "message",
          query: { _content: "in:inbox" },
        },
      },
      authToken,
    );
    const searchResponse = findObjectByKey(searchPayload, "SearchResponse");
    if (!searchResponse) throw new Error("mail search API did not return a response");
    console.log("Message search API: OK");

    console.log("SPESS Mail can use Carbonio's HTTPS APIs without RENU server access.");
  } finally {
    try {
      await postSoap(
        baseUrl,
        {
          EndSessionRequest: {
            _jsns: "urn:zimbraAccount",
            logoff: true,
          },
        },
        authToken,
      );
    } catch {
      // A short-lived test token is safe to expire naturally if explicit logout is unsupported.
    }
  }
}

main().catch((error) => {
  if (error?.name === "AbortError") {
    fail("the Carbonio API did not respond within 20 seconds");
    return;
  }
  fail(error?.message || "unknown error");
});
