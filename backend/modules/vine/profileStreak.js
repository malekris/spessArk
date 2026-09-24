const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeDayKey = (value) => {
  const candidate = value?.day ?? value;
  if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
    return candidate.toISOString().slice(0, 10);
  }
  return String(candidate ?? "").slice(0, 10);
};

const shiftDayKey = (dayKey, amount) => {
  if (!DAY_KEY_PATTERN.test(String(dayKey || ""))) return "";
  const date = new Date(`${dayKey}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

export const calculateConsecutiveDayStreak = (activityDays, todayKey) => {
  const normalizedToday = String(todayKey || "").slice(0, 10);
  if (!DAY_KEY_PATTERN.test(normalizedToday)) return 0;

  const activeDays = new Set(
    (Array.isArray(activityDays) ? activityDays : [])
      .map(normalizeDayKey)
      .filter((value) => DAY_KEY_PATTERN.test(value))
  );

  let cursor = activeDays.has(normalizedToday)
    ? normalizedToday
    : shiftDayKey(normalizedToday, -1);
  let streak = 0;

  while (cursor && activeDays.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }

  return streak;
};
