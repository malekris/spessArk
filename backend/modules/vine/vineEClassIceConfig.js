import { createHash, createHmac } from "node:crypto";

const CLOUDFLARE_CREDENTIAL_TTL_SECONDS = 86400;
const RECONNECT_CACHE_MS = 5 * 60 * 1000;
const FAILURE_BACKOFF_MS = 15000;
const MAX_CACHED_USERS = 256;

const relayError = () => new Error("The audio relay is unavailable. Please try joining again shortly.");

export function createCloudflareTurnClient({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  let failedConfiguration = "";
  let retryAfter = 0;

  return async (userId, keyId, apiToken) => {
    if (!/^[a-f0-9]{32}$/i.test(keyId) || !apiToken) throw relayError();
    const configuration = createHash("sha256").update(`${keyId}:${apiToken}`).digest("hex");
    const cacheKey = `${Number(userId)}:${configuration}`;
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now()) cache.delete(key);
    }
    const cached = cache.get(cacheKey);
    if (cached) return structuredClone(cached.config);
    if (pending.has(cacheKey)) return structuredClone(await pending.get(cacheKey));
    if (configuration === failedConfiguration && now() < retryAfter) throw relayError();

    const request = (async () => {
      try {
        const response = await fetchImpl(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ttl: CLOUDFLARE_CREDENTIAL_TTL_SECONDS }),
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          }
        );
        if (!response.ok) throw relayError();
        const data = await response.json();
        if (!Array.isArray(data?.iceServers)) throw relayError();
        const iceServers = data.iceServers.flatMap((server) => {
          // Browsers block port 53; keep the normal UDP, TCP and TLS routes.
          const urls = [server?.urls].flat().filter((url) => typeof url === "string"
            && /^(stun|turn|turns):[^\s]+$/i.test(url) && !/:53(?:\?|$)/.test(url));
          if (!urls.length) return [];
          const isRelay = urls.some((url) => /^turns?:/i.test(url));
          if (isRelay && (typeof server.username !== "string" || !server.username
            || typeof server.credential !== "string" || !server.credential)) return [];
          return [{ urls, ...(isRelay ? { username: server.username, credential: server.credential } : {}) }];
        });
        if (!iceServers.some((server) => server.urls.some((url) => /^turns?:/i.test(url)))) throw relayError();
        const config = { iceServers, iceTransportPolicy: "all" };
        while (cache.size >= MAX_CACHED_USERS) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { config, expiresAt: now() + RECONNECT_CACHE_MS });
        failedConfiguration = "";
        retryAfter = 0;
        return config;
      } catch {
        // Never log upstream bodies or headers: they can contain credentials.
        failedConfiguration = configuration;
        retryAfter = now() + FAILURE_BACKOFF_MS;
        throw relayError();
      }
    })();
    pending.set(cacheKey, request);
    try {
      return structuredClone(await request);
    } finally {
      pending.delete(cacheKey);
    }
  };
}

const getCloudflareTurnConfig = createCloudflareTurnClient();

// Shared-secret credentials expire; the signing secret never leaves the server.
export async function getEClassIceConfig(userId, env = process.env, nowMs = Date.now()) {
  const keyId = String(env.ECLASS_CLOUDFLARE_TURN_KEY_ID || "").trim();
  const apiToken = String(env.ECLASS_CLOUDFLARE_TURN_API_TOKEN || "").trim();
  if (keyId || apiToken) return getCloudflareTurnConfig(userId, keyId, apiToken);
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
