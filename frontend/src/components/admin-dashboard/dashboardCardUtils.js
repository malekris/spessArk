// Shared formatting helpers keep the six cards consistent without pushing
// presentation calculations back into AdminDashboard.jsx.
export const parseLearnerSubjects = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // Older A-Level records store subjects as a comma-separated string.
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const normalizeDashboardTerm = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["term 2", "term ii", "ii", "2"].includes(normalized)) return "Term 2";
  if (["term 3", "term iii", "iii", "3"].includes(normalized)) return "Term 3";
  return "Term 1";
};

export const toTimeValue = (value) => {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

export const formatCardDate = (value, options = {}) => {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);

  return parsed.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
  });
};

export const formatCardDateTime = (value) => {
  if (!value) return "Time unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";

  return parsed.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatActionLabel = (value) =>
  String(value || "Activity")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

