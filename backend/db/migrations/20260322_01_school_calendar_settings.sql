CREATE TABLE IF NOT EXISTS school_calendar_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  academic_year VARCHAR(20) NOT NULL,
  calendar_json LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO school_calendar_settings (id, academic_year, calendar_json)
VALUES (
  1,
  '2026',
  '[{"key":"term1","label":"Term I","status":"In Session","from":"2026-02-10","to":"2026-05-01"},{"key":"holiday1","label":"Holiday After Term I","status":"Holiday Break","from":"2026-05-02","to":"2026-05-24"},{"key":"term2","label":"Term II","status":"In Session","from":"2026-05-25","to":"2026-08-21"},{"key":"holiday2","label":"Holiday After Term II","status":"Holiday Break","from":"2026-08-22","to":"2026-09-13"},{"key":"term3","label":"Term III","status":"In Session","from":"2026-09-14","to":"2026-12-04"},{"key":"holiday3","label":"Holiday After Term III","status":"Holiday Break","from":"2026-12-05","to":"2027-01-31"}]'
)
ON DUPLICATE KEY UPDATE
  academic_year = VALUES(academic_year),
  calendar_json = VALUES(calendar_json);
