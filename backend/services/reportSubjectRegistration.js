export const parseStoredSubjects = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Fall back to legacy comma-separated registrations.
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const normalizeRegisteredSubjectKey = (value) => {
  const compact = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (
    compact === "ict" ||
    compact.includes("informationcommunicationtechnology") ||
    compact.includes("informationandcommunicationtechnology") ||
    compact.includes("informationcommunicationsandtechnology") ||
    compact.includes("informationandcommunicationstechnology")
  ) {
    return "ict";
  }

  const aliases = {
    cre: "christianreligiouseducation",
    christianreligiouseducation: "christianreligiouseducation",
  };
  return aliases[compact] || compact;
};

export const isReportRowForRegisteredSubject = (
  row,
  { allowMissingRegistration = true } = {}
) => {
  const registeredSubjects = parseStoredSubjects(row?.registered_subjects);
  if (registeredSubjects.length === 0) return allowMissingRegistration;

  const reportSubjectKey = normalizeRegisteredSubjectKey(row?.subject);
  return registeredSubjects.some(
    (subject) => normalizeRegisteredSubjectKey(subject) === reportSubjectKey
  );
};

export const filterRowsByCurrentSubjectRegistration = (rows = []) =>
  (Array.isArray(rows) ? rows : []).filter((row) =>
    isReportRowForRegisteredSubject(row, { allowMissingRegistration: false })
  );
