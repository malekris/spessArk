const SCHOOL_CALENDAR_ENTRY_DEFINITIONS = [
  { key: "term1", label: "Term I", status: "In Session" },
  { key: "holiday1", label: "Holiday After Term I", status: "Holiday Break" },
  { key: "term2", label: "Term II", status: "In Session" },
  { key: "holiday2", label: "Holiday After Term II", status: "Holiday Break" },
  { key: "term3", label: "Term III", status: "In Session" },
  { key: "holiday3", label: "Holiday After Term III", status: "Holiday Break" },
];

export const DEFAULT_SCHOOL_CALENDAR = {
  academicYear: "2026",
  entries: [
    { key: "term1", label: "Term I", status: "In Session", from: "2026-02-10", to: "2026-05-01" },
    { key: "holiday1", label: "Holiday After Term I", status: "Holiday Break", from: "2026-05-02", to: "2026-05-24" },
    { key: "term2", label: "Term II", status: "In Session", from: "2026-05-25", to: "2026-08-21" },
    { key: "holiday2", label: "Holiday After Term II", status: "Holiday Break", from: "2026-08-22", to: "2026-09-13" },
    { key: "term3", label: "Term III", status: "In Session", from: "2026-09-14", to: "2026-12-04" },
    { key: "holiday3", label: "Holiday After Term III", status: "Holiday Break", from: "2026-12-05", to: "2027-01-31" },
  ],
};

const normalizeDateString = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const toLocalDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateKey = (dateKey) => {
  const [year, month, day] = String(dateKey || "")
    .split("-")
    .map((part) => Number(part));

  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const parseDateKeyEndOfDay = (dateKey) => {
  const base = parseDateKey(dateKey);
  if (!base) return null;
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    23,
    59,
    59,
    999
  );
};

const getInclusiveDaysRemaining = (fromDateKey, toDateKey) => {
  const fromDate = parseDateKey(fromDateKey);
  const toDate = parseDateKey(toDateKey);
  if (!fromDate || !toDate) return null;

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((toDate.getTime() - fromDate.getTime()) / msPerDay);
  return diffDays + 1;
};

export const getEmptySchoolCalendar = (academicYear = String(new Date().getFullYear())) => ({
  academicYear,
  entries: SCHOOL_CALENDAR_ENTRY_DEFINITIONS.map((entry) => ({
    ...entry,
    from: "",
    to: "",
  })),
  updatedAt: null,
});

export const normalizeSchoolCalendar = (raw) => {
  const fallback = getEmptySchoolCalendar(DEFAULT_SCHOOL_CALENDAR.academicYear);
  const academicYear = String(
    raw?.academicYear ?? raw?.academic_year ?? fallback.academicYear
  ).trim() || fallback.academicYear;

  const rawEntries = Array.isArray(raw?.entries)
    ? raw.entries
    : Array.isArray(raw?.terms)
    ? raw.terms
    : [];

  const entries = SCHOOL_CALENDAR_ENTRY_DEFINITIONS.map((definition, index) => {
    const matched =
      rawEntries.find((entry) => String(entry?.key || "").trim().toLowerCase() === definition.key) ||
      rawEntries.find(
        (entry) =>
          String(entry?.label || "").trim().toLowerCase() === definition.label.toLowerCase()
      ) ||
      rawEntries[index] ||
      {};

    return {
      key: definition.key,
      label: definition.label,
      status: definition.status,
      from: normalizeDateString(matched.from ?? matched.starts_on ?? matched.startDate),
      to: normalizeDateString(matched.to ?? matched.ends_on ?? matched.endDate),
    };
  });

  return {
    academicYear,
    entries,
    updatedAt: raw?.updatedAt ?? raw?.updated_at ?? null,
  };
};

export const getSchoolCalendarBadge = (calendar, date = new Date()) => {
  const normalized = normalizeSchoolCalendar(calendar || DEFAULT_SCHOOL_CALENDAR);
  const dateKey = toLocalDateKey(date);
  const activeEntry = normalized.entries.find(
    (entry) => entry.from && entry.to && dateKey >= entry.from && dateKey <= entry.to
  );

  if (!activeEntry) {
    return {
      academicYear: normalized.academicYear,
      termLabel: "Calendar Awaiting Update",
      status: "Outside Published Calendar",
      daysRemaining: null,
      countdownLabel: "",
    };
  }

  const daysRemaining = getInclusiveDaysRemaining(dateKey, activeEntry.to);
  const isHoliday = activeEntry.status === "Holiday Break";
  const countdownLabel =
    daysRemaining === null
      ? ""
      : daysRemaining === 1
      ? `1 day left ${isHoliday ? "in break" : "this term"}`
      : `${daysRemaining} days left ${isHoliday ? "in break" : "this term"}`;

  return {
    academicYear: normalized.academicYear,
    termLabel: activeEntry.label,
    status: activeEntry.status,
    daysRemaining,
    countdownLabel,
  };
};

export const getSchoolCalendarPreciseCountdown = (calendar, date = new Date()) => {
  const normalized = normalizeSchoolCalendar(calendar || DEFAULT_SCHOOL_CALENDAR);
  const dateKey = toLocalDateKey(date);
  const activeEntry = normalized.entries.find(
    (entry) => entry.from && entry.to && dateKey >= entry.from && dateKey <= entry.to
  );

  if (!activeEntry) {
    return {
      label: "",
      targetLabel: "",
      totalMs: null,
      weeks: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
  }

  const endOfPeriod = parseDateKeyEndOfDay(activeEntry.to);
  if (!endOfPeriod) {
    return {
      label: "",
      targetLabel: activeEntry.label,
      totalMs: null,
      weeks: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
  }

  const totalMs = Math.max(0, endOfPeriod.getTime() - date.getTime());
  let remainingSeconds = Math.floor(totalMs / 1000);

  const weeks = Math.floor(remainingSeconds / (7 * 24 * 60 * 60));
  remainingSeconds -= weeks * 7 * 24 * 60 * 60;

  const days = Math.floor(remainingSeconds / (24 * 60 * 60));
  remainingSeconds -= days * 24 * 60 * 60;

  const hours = Math.floor(remainingSeconds / (60 * 60));
  remainingSeconds -= hours * 60 * 60;

  const minutes = Math.floor(remainingSeconds / 60);
  remainingSeconds -= minutes * 60;

  const seconds = remainingSeconds;
  const targetLabel = activeEntry.status === "Holiday Break" ? "break" : "term";
  const label = `${weeks}w ${days}d ${hours}h ${minutes}m ${seconds}s left in this ${targetLabel}`;

  return {
    label,
    targetLabel: activeEntry.label,
    totalMs,
    weeks,
    days,
    hours,
    minutes,
    seconds,
  };
};

export { SCHOOL_CALENDAR_ENTRY_DEFINITIONS };
