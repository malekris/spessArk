-- Fix A-Level paper-era unique key so Paper 1 and Paper 2 can save independently.
-- Existing marks are preserved. This only swaps the old uniqueness rule.

SET @schema_name := DATABASE();

-- Ensure assignment_id exists before the new unique key is created.
SET @assignment_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'alevel_marks'
    AND COLUMN_NAME = 'assignment_id'
);

SET @sql := IF(
  @assignment_id_exists = 0,
  "ALTER TABLE alevel_marks ADD COLUMN assignment_id INT NULL AFTER learner_id",
  "SELECT 'alevel_marks.assignment_id already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Drop the old legacy unique key if it is still present.
SET @legacy_unique_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'alevel_marks'
    AND INDEX_NAME = 'uniq_mark'
);

SET @sql := IF(
  @legacy_unique_exists > 0,
  "ALTER TABLE alevel_marks DROP INDEX uniq_mark",
  "SELECT 'alevel_marks.uniq_mark already removed'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add the paper-safe unique key if it is not already there.
SET @paper_unique_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'alevel_marks'
    AND INDEX_NAME = 'uq_alevel_marks_assignment_term_exam'
);

SET @sql := IF(
  @paper_unique_exists = 0,
  "ALTER TABLE alevel_marks ADD UNIQUE KEY uq_alevel_marks_assignment_term_exam (learner_id, assignment_id, exam_id, term)",
  "SELECT 'uq_alevel_marks_assignment_term_exam already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

