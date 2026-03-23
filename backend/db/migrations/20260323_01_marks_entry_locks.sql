-- Marks entry locks for O-Level and A-Level score components.
-- Supports AOI1/AOI2/AOI3, EXAM80, MID and EOT.

SET @schema_name := DATABASE();

CREATE TABLE IF NOT EXISTS marks_entry_locks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  term VARCHAR(20) NOT NULL,
  year INT NOT NULL,
  level_name VARCHAR(20) NOT NULL DEFAULT 'O-Level',
  aoi_label VARCHAR(20) NOT NULL,
  deadline_at DATETIME NULL,
  is_locked TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_marks_entry_locks_term_year_level_aoi (term, year, level_name, aoi_label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------
-- marks_entry_locks.level_name
-- -----------------------------------------------------
SET @level_name_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'marks_entry_locks'
    AND COLUMN_NAME = 'level_name'
);

SET @sql := IF(
  @level_name_exists = 0,
  "ALTER TABLE marks_entry_locks ADD COLUMN level_name VARCHAR(20) NOT NULL DEFAULT 'O-Level' AFTER year",
  "SELECT 'marks_entry_locks.level_name already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE marks_entry_locks
SET level_name = 'O-Level'
WHERE level_name IS NULL OR TRIM(level_name) = '';

-- -----------------------------------------------------
-- marks_entry_locks.aoi_label widen from old ENUM
-- -----------------------------------------------------
SET @aoi_is_varchar := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'marks_entry_locks'
    AND COLUMN_NAME = 'aoi_label'
    AND DATA_TYPE = 'varchar'
);

SET @sql := IF(
  @aoi_is_varchar = 0,
  "ALTER TABLE marks_entry_locks MODIFY COLUMN aoi_label VARCHAR(20) NOT NULL",
  "SELECT 'marks_entry_locks.aoi_label already supports varchar'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------
-- indexes
-- -----------------------------------------------------
SET @old_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'marks_entry_locks'
    AND INDEX_NAME = 'uq_marks_entry_locks_term_year_aoi'
);

SET @sql := IF(
  @old_idx_exists > 0,
  "ALTER TABLE marks_entry_locks DROP INDEX uq_marks_entry_locks_term_year_aoi",
  "SELECT 'uq_marks_entry_locks_term_year_aoi not present'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @new_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'marks_entry_locks'
    AND INDEX_NAME = 'uq_marks_entry_locks_term_year_level_aoi'
);

SET @sql := IF(
  @new_idx_exists = 0,
  "ALTER TABLE marks_entry_locks ADD UNIQUE KEY uq_marks_entry_locks_term_year_level_aoi (term, year, level_name, aoi_label)",
  "SELECT 'uq_marks_entry_locks_term_year_level_aoi already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
