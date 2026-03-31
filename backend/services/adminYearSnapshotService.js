const SCHOOL_CALENDAR_ENTRY_DEFINITIONS = [
  { key: "term1", label: "Term I", status: "In Session" },
  { key: "holiday1", label: "Holiday After Term I", status: "Holiday Break" },
  { key: "term2", label: "Term II", status: "In Session" },
  { key: "holiday2", label: "Holiday After Term II", status: "Holiday Break" },
  { key: "term3", label: "Term III", status: "In Session" },
  { key: "holiday3", label: "Holiday After Term III", status: "Holiday Break" },
];

const DEFAULT_SCHOOL_CALENDAR = {
  academicYear: String(new Date().getFullYear()),
  entries: SCHOOL_CALENDAR_ENTRY_DEFINITIONS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    status: entry.status,
    from: "",
    to: "",
  })),
};

let ensureSnapshotsReadyPromise = null;
let snapshotRefreshInFlight = null;
let snapshotRefreshQueued = false;

const normalizeCalendarDate = (value) => {
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

const normalizeSchoolCalendarPayload = (raw = {}) => {
  const academicYear = String(raw?.academicYear ?? raw?.academic_year ?? DEFAULT_SCHOOL_CALENDAR.academicYear).trim() || DEFAULT_SCHOOL_CALENDAR.academicYear;
  const rawEntries = Array.isArray(raw?.entries)
    ? raw.entries
    : Array.isArray(raw?.terms)
    ? raw.terms
    : [];

  const entries = SCHOOL_CALENDAR_ENTRY_DEFINITIONS.map((definition, index) => {
    const matched =
      rawEntries.find((entry) => String(entry?.key || "").trim().toLowerCase() === definition.key) ||
      rawEntries.find((entry) => String(entry?.label || "").trim().toLowerCase() === definition.label.toLowerCase()) ||
      rawEntries[index] ||
      {};

    return {
      key: definition.key,
      label: definition.label,
      status: definition.status,
      from: normalizeCalendarDate(matched.from ?? matched.starts_on ?? matched.startDate),
      to: normalizeCalendarDate(matched.to ?? matched.ends_on ?? matched.endDate),
    };
  });

  return { academicYear, entries };
};

const parseSnapshotJson = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const safeDateOnly = (value) => {
  const raw = normalizeCalendarDate(value);
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const deriveOperationalTerm = (calendarPayload, date = new Date()) => {
  const normalized = normalizeSchoolCalendarPayload(calendarPayload || DEFAULT_SCHOOL_CALENDAR);
  const sortedEntries = normalized.entries
    .map((entry) => ({
      ...entry,
      fromDate: safeDateOnly(entry.from),
      toDate: safeDateOnly(entry.to),
    }))
    .filter((entry) => entry.fromDate && entry.toDate)
    .sort((a, b) => a.fromDate - b.fromDate);

  if (!sortedEntries.length) return "Term 1";

  let lastSeenTerm = "Term 1";

  for (const entry of sortedEntries) {
    if (entry.key.startsWith("term")) {
      lastSeenTerm = entry.label.replace("Term I", "Term 1").replace("Term II", "Term 2").replace("Term III", "Term 3");
    }

    if (date >= entry.fromDate && date <= entry.toDate) {
      if (entry.key.startsWith("term")) {
        return entry.label.replace("Term I", "Term 1").replace("Term II", "Term 2").replace("Term III", "Term 3");
      }
      return lastSeenTerm;
    }
  }

  return lastSeenTerm;
};

const safeQuery = async (executor, sql, params = []) => {
  try {
    const [rows] = await executor.query(sql, params);
    return rows || [];
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE" || err?.code === "ER_BAD_FIELD_ERROR") {
      return [];
    }
    throw err;
  }
};

export async function ensureAdminYearSnapshotsReady(executor) {
  if (!ensureSnapshotsReadyPromise) {
    ensureSnapshotsReadyPromise = (async () => {
      await executor.query(`
        CREATE TABLE IF NOT EXISTS admin_year_snapshots (
          academic_year INT NOT NULL,
          snapshot_json LONGTEXT NOT NULL,
          captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (academic_year)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);
    })().catch((err) => {
      ensureSnapshotsReadyPromise = null;
      throw err;
    });
  }

  return ensureSnapshotsReadyPromise;
}

export async function getCurrentAcademicYear(executor) {
  try {
    const [rows] = await executor.query(
      `SELECT academic_year, calendar_json
       FROM school_calendar_settings
       WHERE id = 1
       LIMIT 1`
    );
    const row = rows?.[0];
    const parsedYear = Number(row?.academic_year);
    return Number.isInteger(parsedYear) && parsedYear > 0 ? parsedYear : new Date().getFullYear();
  } catch {
    return new Date().getFullYear();
  }
}

export async function getCurrentAcademicCalendar(executor) {
  try {
    const [rows] = await executor.query(
      `SELECT academic_year, calendar_json
       FROM school_calendar_settings
       WHERE id = 1
       LIMIT 1`
    );
    const row = rows?.[0];
    const parsed = parseSnapshotJson(row?.calendar_json);
    return normalizeSchoolCalendarPayload({
      academicYear: row?.academic_year,
      ...(parsed || {}),
    });
  } catch {
    return normalizeSchoolCalendarPayload(DEFAULT_SCHOOL_CALENDAR);
  }
}

export async function buildLiveAdminYearSnapshot(executor, academicYearInput = null) {
  await ensureAdminYearSnapshotsReady(executor);

  const academicYear = Number(academicYearInput) || (await getCurrentAcademicYear(executor));
  const calendar = await getCurrentAcademicCalendar(executor);
  const operationalTerm = deriveOperationalTerm(calendar, new Date());

  const students = await safeQuery(
    executor,
    `SELECT id, name, gender, dob, class_level, stream, subjects, COALESCE(status, 'active') AS status, created_at, updated_at
     FROM students
     ORDER BY created_at DESC, id DESC`
  );

  const teachers = await safeQuery(
    executor,
    `SELECT id, name, email, subject1, subject2, created_at
     FROM teachers
     ORDER BY name ASC, id DESC`
  );

  const oLevelAssignments = await safeQuery(
    executor,
    `SELECT ta.id, ta.teacher_id, ta.class_level, ta.stream, ta.subject, ta.created_at, t.name AS teacher_name
     FROM teacher_assignments ta
     LEFT JOIN teachers t ON t.id = ta.teacher_id
     ORDER BY ta.class_level, ta.stream, ta.subject`
  );

  const aLevelLearners = await safeQuery(
    executor,
    `SELECT
       l.id,
       TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))) AS name,
       l.first_name,
       l.last_name,
       l.gender,
       l.dob,
       l.house,
       l.stream,
       l.combination,
       GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') AS subjects
     FROM alevel_learners l
     LEFT JOIN alevel_learner_subjects als ON als.learner_id = l.id
     LEFT JOIN alevel_subjects s ON s.id = als.subject_id
     GROUP BY
       l.id,
       l.first_name,
       l.last_name,
       l.gender,
       l.dob,
       l.house,
       l.stream,
       l.combination
     ORDER BY l.stream, l.first_name, l.last_name, l.id`
  );

  const aLevelAssignments = await safeQuery(
    executor,
    `SELECT
       ats.id,
       ats.teacher_id,
       ats.subject_id,
       ats.stream,
       ats.paper_label,
       s.name AS subject,
       t.name AS teacher_name,
       t.email AS teacher_email
     FROM alevel_teacher_subjects ats
     JOIN alevel_subjects s ON s.id = ats.subject_id
     LEFT JOIN teachers t ON t.id = ats.teacher_id
     ORDER BY ats.stream, s.name, ats.paper_label, ats.id`
  );

  return {
    academicYear,
    operationalTerm,
    capturedAt: new Date().toISOString(),
    students,
    teachers,
    oLevelAssignments,
    aLevelLearners,
    aLevelAssignments,
  };
}

export async function upsertAdminYearSnapshot(executor, snapshot) {
  await ensureAdminYearSnapshotsReady(executor);
  const academicYear = Number(snapshot?.academicYear);
  if (!Number.isInteger(academicYear) || academicYear <= 0) {
    throw new Error("Valid academicYear is required for admin snapshot upsert");
  }

  await executor.query(
    `INSERT INTO admin_year_snapshots (academic_year, snapshot_json, captured_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       snapshot_json = VALUES(snapshot_json),
       captured_at = NOW()`,
    [academicYear, JSON.stringify(snapshot)]
  );

  return academicYear;
}

export async function captureAdminYearSnapshot(executor, academicYearInput = null) {
  const snapshot = await buildLiveAdminYearSnapshot(executor, academicYearInput);
  await upsertAdminYearSnapshot(executor, snapshot);
  return snapshot;
}

export async function readAdminYearSnapshot(executor, academicYearInput) {
  await ensureAdminYearSnapshotsReady(executor);
  const academicYear = Number(academicYearInput);
  if (!Number.isInteger(academicYear) || academicYear <= 0) return null;

  const [rows] = await executor.query(
    `SELECT academic_year, snapshot_json, captured_at, updated_at
     FROM admin_year_snapshots
     WHERE academic_year = ?
     LIMIT 1`,
    [academicYear]
  );

  const row = rows?.[0];
  if (!row) return null;

  const parsed = parseSnapshotJson(row.snapshot_json);
  if (!parsed) return null;

  return {
    ...parsed,
    academicYear,
    capturedAt: parsed.capturedAt || row.captured_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function listAdminSnapshotYears(executor) {
  await ensureAdminYearSnapshotsReady(executor);
  const currentAcademicYear = await getCurrentAcademicYear(executor);

  const [rows] = await executor.query(
    `SELECT academic_year
     FROM admin_year_snapshots
     ORDER BY academic_year DESC`
  );

  const years = new Set([currentAcademicYear]);
  (rows || []).forEach((row) => {
    const parsed = Number(row?.academic_year);
    if (Number.isInteger(parsed) && parsed > 0) years.add(parsed);
  });

  return Array.from(years).sort((a, b) => b - a);
}

export function queueAdminYearSnapshotRefresh(executor, label = "") {
  snapshotRefreshQueued = true;

  if (snapshotRefreshInFlight) {
    return snapshotRefreshInFlight;
  }

  snapshotRefreshInFlight = (async () => {
    do {
      snapshotRefreshQueued = false;
      try {
        await captureAdminYearSnapshot(executor);
      } catch (err) {
        console.error(`Admin year snapshot refresh failed${label ? ` (${label})` : ""}:`, err);
      }
    } while (snapshotRefreshQueued);
  })().finally(() => {
    snapshotRefreshInFlight = null;
  });

  return snapshotRefreshInFlight;
}
