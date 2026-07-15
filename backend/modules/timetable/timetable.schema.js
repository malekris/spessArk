import { DEFAULT_TIMETABLE_CONFIG } from "./timetable.constants.js";

const setupPromises = new WeakMap();

async function createTimetableTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS timetable_settings (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      academic_year VARCHAR(20) NOT NULL,
      config_json LONGTEXT NOT NULL,
      updated_by_admin_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timetable_teacher_availability (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      teacher_id INT NOT NULL,
      day_of_week VARCHAR(12) NOT NULL,
      preference_rank TINYINT UNSIGNED NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_timetable_teacher_day (teacher_id, day_of_week),
      KEY idx_timetable_availability_day (day_of_week)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timetable_lesson_requirements (
      assignment_id INT NOT NULL PRIMARY KEY,
      lessons_per_week TINYINT UNSIGNED NOT NULL DEFAULT 1,
      lesson_kind VARCHAR(20) NOT NULL DEFAULT 'review',
      cluster_code VARCHAR(40) NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      configured_by_admin_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_timetable_requirements_kind (lesson_kind, cluster_code),
      KEY idx_timetable_requirements_enabled (enabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timetable_versions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      academic_year VARCHAR(20) NOT NULL,
      name VARCHAR(120) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      generation_stats_json LONGTEXT NULL,
      validation_json LONGTEXT NULL,
      created_by_admin_id INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      published_at TIMESTAMP NULL,
      KEY idx_timetable_versions_year_status (academic_year, status),
      KEY idx_timetable_versions_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timetable_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      version_id BIGINT UNSIGNED NOT NULL,
      class_level VARCHAR(12) NOT NULL,
      stream VARCHAR(30) NOT NULL,
      day_of_week VARCHAR(12) NOT NULL,
      slot_code VARCHAR(20) NOT NULL,
      event_type VARCHAR(20) NOT NULL DEFAULT 'lesson',
      subject_label VARCHAR(160) NOT NULL,
      assignment_id INT NULL,
      teacher_id INT NULL,
      teacher_name VARCHAR(160) NULL,
      block_key VARCHAR(100) NULL,
      is_locked TINYINT(1) NOT NULL DEFAULT 0,
      is_manual TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_timetable_stream_slot (version_id, class_level, stream, day_of_week, slot_code),
      KEY idx_timetable_events_teacher_slot (version_id, teacher_id, day_of_week, slot_code),
      KEY idx_timetable_events_assignment (assignment_id),
      KEY idx_timetable_events_block (version_id, block_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timetable_teacher_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      version_id BIGINT UNSIGNED NOT NULL,
      event_id BIGINT UNSIGNED NULL,
      teacher_id INT NOT NULL,
      teacher_name VARCHAR(160) NOT NULL,
      assignment_id INT NOT NULL,
      subject_label VARCHAR(160) NOT NULL,
      class_level VARCHAR(12) NOT NULL,
      streams_label VARCHAR(80) NOT NULL,
      day_of_week VARCHAR(12) NOT NULL,
      slot_code VARCHAR(20) NOT NULL,
      block_key VARCHAR(100) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_timetable_teacher_slot (version_id, teacher_id, day_of_week, slot_code),
      KEY idx_timetable_sessions_assignment (assignment_id),
      KEY idx_timetable_sessions_event (event_id),
      KEY idx_timetable_sessions_block (version_id, block_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timetable_actions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      version_id BIGINT UNSIGNED NOT NULL,
      admin_id INT NULL,
      action_type VARCHAR(40) NOT NULL,
      payload_json LONGTEXT NULL,
      undo_payload_json LONGTEXT NULL,
      undone_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_timetable_actions_version (version_id, created_at),
      KEY idx_timetable_actions_undo (version_id, undone_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const academicYear = String(new Date().getFullYear());
  await pool.query(
    `INSERT INTO timetable_settings (id, academic_year, config_json)
     VALUES (1, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [academicYear, JSON.stringify(DEFAULT_TIMETABLE_CONFIG)]
  );
}

export function ensureTimetableSchemaReady(pool) {
  if (!pool || typeof pool.query !== "function") {
    return Promise.reject(new Error("A MySQL pool is required for timetable setup."));
  }

  if (!setupPromises.has(pool)) {
    const setup = createTimetableTables(pool).catch((error) => {
      setupPromises.delete(pool);
      throw error;
    });
    setupPromises.set(pool, setup);
  }

  return setupPromises.get(pool);
}

