const REPORT_PERIODS = Object.freeze(["TERM_1", "TERM_2", "END_OF_YEAR"]);
const REPORT_KINDS = Object.freeze(["END_OF_TERM", "END_OF_YEAR"]);
const CLASS_LEVELS = new Set(["S1", "S2", "S3", "S4"]);

let ensureArchiveSchemaPromise = null;

export const normalizeArchiveYear = (value) => {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : null;
};

export const normalizeArchiveClassLevel = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  return CLASS_LEVELS.has(normalized) ? normalized : "";
};

export const normalizeArchiveStream = (value) =>
  String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);

export const normalizeArchivePeriod = (value) => {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return REPORT_PERIODS.includes(normalized) ? normalized : "";
};

export const normalizeArchiveKind = (value) => {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return REPORT_KINDS.includes(normalized) ? normalized : "";
};

export const expectedArchivePeriods = () => [...REPORT_PERIODS];

export async function ensureReportArchiveSchemaReady(executor) {
  if (!ensureArchiveSchemaPromise) {
    ensureArchiveSchemaPromise = executor
      .query(
        `CREATE TABLE IF NOT EXISTS admin_report_archives (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          academic_year INT NOT NULL,
          learner_level VARCHAR(20) NOT NULL DEFAULT 'O_LEVEL',
          class_level VARCHAR(20) NOT NULL,
          stream VARCHAR(80) NOT NULL,
          report_period VARCHAR(30) NOT NULL,
          report_kind VARCHAR(40) NOT NULL,
          version INT NOT NULL DEFAULT 1,
          object_key VARCHAR(700) NOT NULL,
          original_filename VARCHAR(220) NOT NULL,
          mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
          file_size BIGINT UNSIGNED NOT NULL,
          sha256_hex CHAR(64) NOT NULL,
          learner_count INT UNSIGNED NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
          generated_by INT NULL,
          generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          superseded_at TIMESTAMP NULL DEFAULT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_report_archive_version
            (academic_year, learner_level, class_level, stream, report_period, version),
          KEY idx_report_archive_library
            (academic_year, learner_level, status, class_level, stream, report_period),
          KEY idx_report_archive_checksum (sha256_hex)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
      )
      .catch((error) => {
        ensureArchiveSchemaPromise = null;
        throw error;
      });
  }

  return ensureArchiveSchemaPromise;
}

export function buildArchiveReadiness(rows = []) {
  const activePeriods = new Set(
    rows
      .filter((row) => String(row?.status || "").toUpperCase() === "ACTIVE")
      .map((row) => normalizeArchivePeriod(row.report_period || row.reportPeriod))
      .filter(Boolean)
  );
  const expectedPeriods = expectedArchivePeriods();
  const missingPeriods = expectedPeriods.filter((period) => !activePeriods.has(period));

  return {
    complete: missingPeriods.length === 0,
    archivedCount: expectedPeriods.length - missingPeriods.length,
    expectedCount: expectedPeriods.length,
    missingPeriods,
  };
}
