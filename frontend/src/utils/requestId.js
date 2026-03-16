export const createClientRequestId = (prefix = "req") => {
  const safePrefix = String(prefix || "req")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 24) || "req";

  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${safePrefix}-${crypto.randomUUID()}`;
  }

  return `${safePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};
