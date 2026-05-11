const VINE_READ_CACHE_MAX = 600;

export const VINE_CACHE_TTLS = {
  feed: 8_000,
  communityPosts: 8_000,
  profileHeader: 20_000,
  profilePosts: 12_000,
  profileLikes: 12_000,
  profilePhotos: 12_000,
  profileBookmarks: 8_000,
  publicPost: 20_000,
  comments: 8_000,
  trending: 15_000,
  followers: 20_000,
  following: 20_000,
  communityAssignments: 10_000,
  communityAssignmentSubmissions: 10_000,
  communityGradebook: 12_000,
  communityProgress: 10_000,
  communityLibrary: 20_000,
  communityAttendance: 8_000,
  mutedUsers: 20_000,
  blockedUsers: 20_000,
  birthdays: 20_000,
  notifications: 5_000,
  notificationCounts: 4_000,
  guardianActivity: 10_000,
};

const vineReadCache = new Map();

const cloneCachedValue = (value) => {
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

export const buildVineCacheKey = (...parts) =>
  parts
    .map((part) => {
      if (part === null || part === undefined) return "";
      if (typeof part === "string") return part;
      if (typeof part === "number" || typeof part === "boolean") return String(part);
      return JSON.stringify(part);
    })
    .join("::");

const pruneVineReadCache = () => {
  const now = Date.now();
  for (const [key, entry] of vineReadCache.entries()) {
    if (!entry || entry.expiresAt <= now) {
      vineReadCache.delete(key);
    }
  }
  if (vineReadCache.size <= VINE_READ_CACHE_MAX) return;
  const oldestEntries = [...vineReadCache.entries()]
    .sort((a, b) => (a[1]?.expiresAt || 0) - (b[1]?.expiresAt || 0))
    .slice(0, vineReadCache.size - VINE_READ_CACHE_MAX);
  for (const [key] of oldestEntries) {
    vineReadCache.delete(key);
  }
};

const getVineReadCache = (key) => {
  const entry = vineReadCache.get(key);
  if (!entry) return { hit: false, value: undefined };
  if (entry.expiresAt <= Date.now()) {
    vineReadCache.delete(key);
    return { hit: false, value: undefined };
  }
  return { hit: true, value: cloneCachedValue(entry.value) };
};

const setVineReadCache = (key, value, ttlMs) => {
  pruneVineReadCache();
  vineReadCache.set(key, {
    value: cloneCachedValue(value),
    expiresAt: Date.now() + ttlMs,
  });
};

export const readThroughVineCache = async (key, ttlMs, loader) => {
  const cached = getVineReadCache(key);
  if (cached.hit) return cached.value;
  const value = await loader();
  if (value !== undefined) {
    setVineReadCache(key, value, ttlMs);
  }
  return cloneCachedValue(value);
};

export const clearVineReadCache = (...prefixes) => {
  if (!prefixes.length) {
    vineReadCache.clear();
    return;
  }
  const normalizedPrefixes = prefixes
    .flat()
    .map((prefix) => String(prefix || "").trim())
    .filter(Boolean);
  if (!normalizedPrefixes.length) {
    vineReadCache.clear();
    return;
  }
  for (const key of vineReadCache.keys()) {
    if (
      normalizedPrefixes.some(
        (prefix) => key === prefix || key.startsWith(`${prefix}::`)
      )
    ) {
      vineReadCache.delete(key);
    }
  }
};
