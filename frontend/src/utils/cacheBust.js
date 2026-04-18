const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:/i;

export const buildAssetVersion = (value) => {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const parsed = new Date(raw).getTime();
  if (Number.isFinite(parsed) && parsed > 0) {
    return String(parsed);
  }
  return raw;
};

export const withCacheBust = (url, version) => {
  const rawUrl = String(url || "").trim();
  const token = buildAssetVersion(version);
  if (!rawUrl || !token) return rawUrl;

  try {
    const isAbsolute = ABSOLUTE_URL_RE.test(rawUrl);
    const baseOrigin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://localhost";
    const parsed = isAbsolute ? new URL(rawUrl) : new URL(rawUrl, baseOrigin);
    parsed.searchParams.set("v", token);
    return isAbsolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const joiner = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${joiner}v=${encodeURIComponent(token)}`;
  }
};
