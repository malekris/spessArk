const DEFAULT_TIMEOUT_MS = 20_000;

export class CarbonioMailError extends Error {
  constructor(message, { code = "CARBONIO_ERROR", status = 502 } = {}) {
    super(message);
    this.name = "CarbonioMailError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeCarbonioBaseUrl(value) {
  if (!value) throw new CarbonioMailError("SPESS Mail is not configured", { code: "MAIL_NOT_CONFIGURED", status: 503 });
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new CarbonioMailError("SPESS Mail server URL is invalid", { code: "MAIL_NOT_CONFIGURED", status: 503 });
  }
  if (parsed.protocol !== "https:") {
    throw new CarbonioMailError("SPESS Mail server must use HTTPS", { code: "MAIL_NOT_CONFIGURED", status: 503 });
  }
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function findObjectByKey(value, key, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = findObjectByKey(child, key, seen);
    if (found !== null && found !== undefined) return found;
  }
  return null;
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function content(value) {
  if (typeof value === "string") return value;
  if (typeof value?._content === "string") return value._content;
  if (Array.isArray(value)) return content(value[0]);
  return "";
}

function findAuthToken(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  if (Object.prototype.hasOwnProperty.call(value, "authToken")) {
    const token = content(value.authToken);
    if (token) return token;
  }
  for (const child of Object.values(value)) {
    const token = findAuthToken(child, seen);
    if (token) return token;
  }
  return "";
}

function carbonioFault(payload, httpStatus) {
  const fault = first(findObjectByKey(payload, "Fault"));
  if (!fault && httpStatus >= 200 && httpStatus < 300) return null;
  const code = content(fault?.Detail?.Error?.Code) || content(fault?.Code?.Value) || "CARBONIO_ERROR";
  const rawReason = content(fault?.Reason?.Text) || content(fault?.reason) || `Mail server returned HTTP ${httpStatus}`;
  const authFailure = /AUTH_FAILED|authentication failed|invalid credentials/i.test(`${code} ${rawReason}`);
  return new CarbonioMailError(authFailure ? "Incorrect school email or password" : rawReason.slice(0, 240), {
    code: authFailure ? "INVALID_CREDENTIALS" : code,
    status: authFailure ? 401 : 502,
  });
}

export async function soapRequest({ baseUrl, body, authToken = "", timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const context = { _jsns: "urn:zimbra" };
  if (authToken) context.authToken = { _content: authToken };

  try {
    const response = await fetch(`${normalizeCarbonioBaseUrl(baseUrl)}/service/soap`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ Header: { context }, Body: body, _jsns: "urn:zimbraSoap" }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new CarbonioMailError("Mail server returned an unreadable response");
    }
    const fault = carbonioFault(payload, response.status);
    if (fault) throw fault;
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new CarbonioMailError("Mail server did not respond in time", { code: "MAIL_TIMEOUT", status: 504 });
    }
    if (error instanceof CarbonioMailError) throw error;
    throw new CarbonioMailError("Unable to reach the school mail server", { code: "MAIL_UNAVAILABLE", status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

export async function authenticateMailbox({ baseUrl, email, password }) {
  const payload = await soapRequest({
    baseUrl,
    body: {
      AuthRequest: {
        _jsns: "urn:zimbraAccount",
        account: { by: "name", _content: email },
        password,
        csrfTokenSecured: true,
        persistAuthTokenCookie: false,
        generateDeviceId: true,
      },
    },
  });
  const authToken = findAuthToken(payload);
  if (!authToken) throw new CarbonioMailError("Mail server did not return a session", { code: "INVALID_SESSION" });
  const authResponse = first(findObjectByKey(payload, "AuthResponse")) || {};
  return {
    authToken,
    lifetimeMs: Math.min(Math.max(Number(authResponse.lifetime || 0), 15 * 60_000), 8 * 60 * 60_000),
  };
}

export async function getMailboxInfo({ baseUrl, authToken }) {
  const payload = await soapRequest({
    baseUrl,
    authToken,
    body: { GetInfoRequest: { _jsns: "urn:zimbraAccount", sections: "attrs,props" } },
  });
  const info = first(findObjectByKey(payload, "GetInfoResponse")) || {};
  const attrs = info.attrs?._attrs || {};
  const displayName = String(attrs.displayName || attrs.cn || content(info.name) || "SPESS Mail user");
  return { email: content(info.name), displayName, attrs };
}

function flattenFolders(folder, output = []) {
  if (Array.isArray(folder)) {
    folder.forEach((child) => flattenFolders(child, output));
    return output;
  }
  if (!folder || typeof folder !== "object") return output;
  if (folder.id !== undefined) {
    output.push({
      id: String(folder.id),
      name: String(folder.name || folder.absFolderPath || "Folder"),
      path: String(folder.absFolderPath || ""),
      count: Number(folder.n || 0),
      unread: Number(folder.u || 0),
      system: ["2", "3", "4", "5", "6", "20"].includes(String(folder.id)),
    });
  }
  flattenFolders(folder.folder, output);
  return output;
}

export async function getMailboxFolders({ baseUrl, authToken }) {
  const payload = await soapRequest({
    baseUrl,
    authToken,
    body: { GetFolderRequest: { _jsns: "urn:zimbraMail", folder: { l: "1" } } },
  });
  const root = findObjectByKey(payload, "folder");
  return flattenFolders(root).filter((folder) => folder.id !== "1");
}

function addressList(message) {
  const addresses = Array.isArray(message?.e) ? message.e : [];
  return addresses.map((entry) => ({
    type: String(entry.t || ""),
    address: String(entry.a || ""),
    name: String(entry.p || entry.d || entry.a || ""),
  }));
}

function mapMessage(message) {
  const addresses = addressList(message);
  const from = addresses.find((entry) => entry.type === "f") || addresses[0] || {};
  return {
    id: String(message?.id || ""),
    folderId: String(message?.l || ""),
    subject: content(message?.su) || "(No subject)",
    snippet: content(message?.fr),
    date: Number(message?.d || message?.sd || 0),
    size: Number(message?.s || 0),
    flags: String(message?.f || ""),
    unread: String(message?.f || "").includes("u"),
    starred: String(message?.f || "").includes("f"),
    from,
    addresses,
  };
}

export async function searchMailboxMessages({ baseUrl, authToken, folderId = "2", query = "", limit = 50, offset = 0 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const folderQuery = folderId ? `inid:${String(folderId).replace(/[^0-9]/g, "") || "2"}` : "";
  const cleanedQuery = String(query || "").trim().slice(0, 160);
  const searchQuery = [folderQuery, cleanedQuery].filter(Boolean).join(" ");
  const payload = await soapRequest({
    baseUrl,
    authToken,
    body: {
      SearchRequest: {
        _jsns: "urn:zimbraMail",
        sortBy: "dateDesc",
        offset: safeOffset,
        limit: safeLimit,
        types: "message",
        query: { _content: searchQuery || "in:inbox" },
      },
    },
  });
  const response = first(findObjectByKey(payload, "SearchResponse")) || {};
  const messages = Array.isArray(response.m) ? response.m : response.m ? [response.m] : [];
  return {
    messages: messages.map(mapMessage).filter((message) => message.id),
    more: Boolean(Number(response.more || 0)),
    offset: safeOffset,
  };
}

function collectMimeParts(part, output = []) {
  if (Array.isArray(part)) {
    part.forEach((child) => collectMimeParts(child, output));
    return output;
  }
  if (!part || typeof part !== "object") return output;
  const value = content(part.content);
  if (value) output.push({ type: String(part.ct || "text/plain"), value });
  collectMimeParts(part.mp, output);
  return output;
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function getMailboxMessage({ baseUrl, authToken, id }) {
  const payload = await soapRequest({
    baseUrl,
    authToken,
    body: {
      GetMsgRequest: {
        _jsns: "urn:zimbraMail",
        m: { id: String(id), html: 1, neuter: 1, read: 1, max: 1_500_000, needExp: 1 },
      },
    },
  });
  const response = first(findObjectByKey(payload, "GetMsgResponse")) || {};
  const rawMessage = first(response.m);
  if (!rawMessage) throw new CarbonioMailError("Message was not found", { code: "MESSAGE_NOT_FOUND", status: 404 });
  const parts = collectMimeParts(rawMessage.mp);
  const plain = parts.find((part) => part.type.toLowerCase().startsWith("text/plain"));
  const html = parts.find((part) => part.type.toLowerCase().startsWith("text/html"));
  return { ...mapMessage(rawMessage), body: plain?.value || htmlToText(html?.value) || content(rawMessage.fr) };
}

export async function sendMailboxMessage({ baseUrl, authToken, to, cc = [], subject, body, originalId = "", replyType = "" }) {
  const recipients = [
    ...to.map((address) => ({ a: address, t: "t" })),
    ...cc.map((address) => ({ a: address, t: "c" })),
  ];
  const message = {
    e: recipients,
    su: subject,
    mp: { ct: "text/plain", content: { _content: body } },
  };
  if (originalId) message.origid = String(originalId);
  if (["r", "w"].includes(replyType)) message.rt = replyType;
  const payload = await soapRequest({
    baseUrl,
    authToken,
    body: { SendMsgRequest: { _jsns: "urn:zimbraMail", m: message } },
  });
  const response = first(findObjectByKey(payload, "SendMsgResponse")) || {};
  return { id: String(first(response.m)?.id || ""), sent: true };
}

export async function applyMailboxMessageAction({ baseUrl, authToken, id, operation, folderId = "" }) {
  const action = { id: String(id), op: operation };
  if (folderId) action.l = String(folderId);
  await soapRequest({
    baseUrl,
    authToken,
    body: { MsgActionRequest: { _jsns: "urn:zimbraMail", action } },
  });
  return { id: String(id), operation };
}

export async function endMailboxSession({ baseUrl, authToken }) {
  await soapRequest({
    baseUrl,
    authToken,
    body: { EndSessionRequest: { _jsns: "urn:zimbraAccount", logoff: true } },
  });
}
