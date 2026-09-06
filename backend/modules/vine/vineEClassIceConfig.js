import { createHmac } from "node:crypto";

// Shared-secret credentials expire; the signing secret never leaves the server.
export function getEClassIceConfig(userId, env = process.env, nowMs = Date.now()) {
  const urls = String(env.ECLASS_TURN_URLS || "").split(",")
    .map((url) => url.trim()).filter((url) => /^turns?:[^\s]+$/i.test(url));
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  if (urls.length) {
    let username = String(env.ECLASS_TURN_USERNAME || "").trim();
    let credential = String(env.ECLASS_TURN_CREDENTIAL || "").trim();
    const secret = String(env.ECLASS_TURN_SHARED_SECRET || "").trim();
    if (secret) {
      username = `${Math.floor(nowMs / 1000) + 86400}:${Number(userId)}`;
      credential = createHmac("sha1", secret).update(username).digest("base64");
    }
    if (username && credential) iceServers.push({ urls, username, credential });
  }
  return { iceServers, iceTransportPolicy: "all" };
}
