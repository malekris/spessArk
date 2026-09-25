import crypto from "node:crypto";
import express from "express";
import {
  applyMailboxMessageAction,
  authenticateMailbox,
  CarbonioMailError,
  endMailboxSession,
  getMailboxFolders,
  getMailboxInfo,
  getMailboxMessage,
  normalizeCarbonioBaseUrl,
  searchMailboxMessages,
  sendMailboxMessage,
} from "../services/carbonioMailService.js";

const router = express.Router();
const COOKIE_NAME = "spess_mail_session";
const SCHOOL_DOMAIN = "stphillipsequatorial.com";
const sessions = new Map();
const loginAttempts = new Map();
const ACTIONS = new Set(["read", "!read", "flag", "!flag", "archive", "trash", "spam"]);

function baseUrl() {
  return normalizeCarbonioBaseUrl(process.env.SPESS_MAIL_BASE_URL || "https://webmail.stphillipsequatorial.com");
}

function cookieMap(req) {
  return String(req.headers.cookie || "").split(";").reduce((result, pair) => {
    const index = pair.indexOf("=");
    if (index < 0) return result;
    result[decodeURIComponent(pair.slice(0, index).trim())] = decodeURIComponent(pair.slice(index + 1).trim());
    return result;
  }, {});
}

function isSecureRequest(req) {
  return req.secure || String(req.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";
}

function setSessionCookie(req, res, sessionId, maxAgeMs) {
  const secure = isSecureRequest(req);
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/api/mail",
    "HttpOnly",
    `SameSite=${secure ? "None" : "Lax"}`,
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(req, res) {
  const secure = isSecureRequest(req);
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/api/mail",
    "HttpOnly",
    `SameSite=${secure ? "None" : "Lax"}`,
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function normalizedSchoolEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || !email.endsWith(`@${SCHOOL_DOMAIN}`)) return "";
  return email;
}

function splitAddresses(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[;,]/);
  return source.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean);
}

function validRecipient(address) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && address.length <= 254;
}

function rateLimitLogin(req, res, next) {
  const key = String(req.ip || req.socket?.remoteAddress || "unknown");
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    return next();
  }
  current.count += 1;
  if (current.count > 12) {
    res.setHeader("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
    return res.status(429).json({ message: "Too many sign-in attempts. Please wait and try again.", code: "RATE_LIMITED" });
  }
  return next();
}

function requireMailSession(req, res, next) {
  const sessionId = cookieMap(req)[COOKIE_NAME];
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (sessionId) sessions.delete(sessionId);
    clearSessionCookie(req, res);
    return res.status(401).json({ message: "Your SPESS Mail session has expired.", code: "MAIL_SESSION_EXPIRED" });
  }
  req.mailSessionId = sessionId;
  req.mailSession = session;
  return next();
}

function handleError(res, error) {
  if (error instanceof CarbonioMailError) {
    return res.status(error.status || 502).json({ message: error.message, code: error.code });
  }
  console.error("SPESS Mail error:", error?.message || error);
  return res.status(500).json({ message: "SPESS Mail could not complete that request.", code: "MAIL_INTERNAL_ERROR" });
}

router.post("/session", rateLimitLogin, async (req, res) => {
  const email = normalizedSchoolEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!email || !password || password.length > 512) {
    return res.status(400).json({ message: "Enter a valid school email and password.", code: "INVALID_LOGIN" });
  }
  try {
    const serverUrl = baseUrl();
    const auth = await authenticateMailbox({ baseUrl: serverUrl, email, password });
    const account = await getMailboxInfo({ baseUrl: serverUrl, authToken: auth.authToken });
    const sessionId = crypto.randomBytes(32).toString("base64url");
    const maxAgeMs = Math.min(auth.lifetimeMs || 8 * 60 * 60_000, 8 * 60 * 60_000);
    sessions.set(sessionId, {
      authToken: auth.authToken,
      email,
      displayName: account.displayName || email.split("@")[0],
      baseUrl: serverUrl,
      expiresAt: Date.now() + maxAgeMs,
    });
    setSessionCookie(req, res, sessionId, maxAgeMs);
    return res.json({ account: { email, displayName: account.displayName || email.split("@")[0] } });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/session", requireMailSession, (req, res) => {
  const { email, displayName, expiresAt } = req.mailSession;
  return res.json({ account: { email, displayName }, expiresAt });
});

router.delete("/session", requireMailSession, async (req, res) => {
  const session = req.mailSession;
  sessions.delete(req.mailSessionId);
  clearSessionCookie(req, res);
  try {
    await endMailboxSession(session);
  } catch {
    // Local session removal still signs the browser out if Carbonio logout is unavailable.
  }
  return res.status(204).end();
});

router.get("/folders", requireMailSession, async (req, res) => {
  try {
    return res.json({ folders: await getMailboxFolders(req.mailSession) });
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/messages", requireMailSession, async (req, res) => {
  try {
    const result = await searchMailboxMessages({
      ...req.mailSession,
      folderId: req.query.folderId,
      query: req.query.query,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json(result);
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/messages/:id", requireMailSession, async (req, res) => {
  if (!/^[0-9-]+$/.test(String(req.params.id || ""))) {
    return res.status(400).json({ message: "Invalid message identifier.", code: "INVALID_MESSAGE" });
  }
  try {
    return res.json({ message: await getMailboxMessage({ ...req.mailSession, id: req.params.id }) });
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/messages", requireMailSession, async (req, res) => {
  const to = splitAddresses(req.body?.to);
  const cc = splitAddresses(req.body?.cc);
  const subject = String(req.body?.subject || "").trim().slice(0, 300);
  const body = String(req.body?.body || "").trim();
  if (!to.length || to.length > 50 || cc.length > 50 || ![...to, ...cc].every(validRecipient)) {
    return res.status(400).json({ message: "Enter valid recipient addresses.", code: "INVALID_RECIPIENTS" });
  }
  if (!body || body.length > 500_000) {
    return res.status(400).json({ message: "Write a message before sending.", code: "INVALID_BODY" });
  }
  try {
    const result = await sendMailboxMessage({
      ...req.mailSession,
      to,
      cc,
      subject: subject || "(No subject)",
      body,
      originalId: req.body?.originalId,
      replyType: req.body?.replyType,
    });
    return res.status(201).json(result);
  } catch (error) {
    return handleError(res, error);
  }
});

router.post("/messages/:id/action", requireMailSession, async (req, res) => {
  if (!/^[0-9-]+$/.test(String(req.params.id || ""))) {
    return res.status(400).json({ message: "Invalid message identifier.", code: "INVALID_MESSAGE" });
  }
  const requested = String(req.body?.operation || "");
  if (!ACTIONS.has(requested)) {
    return res.status(400).json({ message: "Unsupported mailbox action.", code: "INVALID_ACTION" });
  }
  const mapping = requested === "archive"
    ? { operation: "move", folderId: "20" }
    : { operation: requested, folderId: "" };
  try {
    return res.json(await applyMailboxMessageAction({ ...req.mailSession, id: req.params.id, ...mapping }));
  } catch (error) {
    return handleError(res, error);
  }
});

router.get("/activation/status", (_req, res) => {
  const configured = Boolean(process.env.SPESS_MAIL_PROVISIONER_EMAIL && process.env.SPESS_MAIL_PROVISIONER_PASSWORD);
  return res.json({ available: configured });
});

router.post("/activation", (_req, res) => {
  return res.status(503).json({
    message: "Learner mailbox activation is awaiting the limited provisioning account.",
    code: "PROVISIONING_NOT_CONFIGURED",
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
  for (const [key, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) loginAttempts.delete(key);
  }
}, 10 * 60_000).unref();

export default router;
