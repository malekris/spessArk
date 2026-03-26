-- Release the old A-Level uniq_mark key without losing rows.
-- Some databases still use uniq_mark to satisfy foreign-key index requirements,
-- so we first add explicit plain indexes for the FK columns, then drop uniq_mark.

SET @schema_name := DATABASE();

-- Ensure plain indexes exist for FK-backed columns.
SET @idx_learner_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'alevel_marks'
    AND INDEX_NAME = 'idx_alevel_marks_learner_id'
);

SET @sql := IF(
  @idx_learner_exists = 0,
  "ALTER TABLE alevel_marks ADD INDEX idx_alevel_marks_learner_id (learner_id)",
  "SELECT 'idx_alevel_marks_learner_id already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_subject_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'alevel_marks'
    AND INDEX_NAME = 'idx_alevel_marks_subject_id'
);

SET @sql := IF(
  @idx_subject_exists = 0,
  "ALTER TABLE alevel_marks ADD INDEX idx_alevel_marks_subject_id (subject_id)",
  "SELECT 'idx_alevel_marks_subject_id already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exam_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'alevel_marks'
    AND INDEX_NAME = 'idx_alevel_marks_exam_id'
);

SET @sql := IF(
  @idx_exam_exists = 0,
  "ALTER TABLE alevel_marks ADD INDEX idx_alevel_marks_exam_id (exam_id)",
  "SELECT 'idx_alevel_marks_exam_id already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_teacher_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'alevel_marks'
    AND INDEX_NAME = 'idx_alevel_marks_teacher_id'
);

SET @sql := IF(
  @idx_teacher_exists = 0,
  "ALTER TABLE alevel_marks ADD INDEX idx_alevel_marks_teacher_id (teacher_id)",
  "SELECT 'idx_alevel_marks_teacher_id already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_assignment_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'alevel_marks'
    AND INDEX_NAME = 'idx_alevel_marks_assignment_id'
);

SET @sql := IF(
  @idx_assignment_exists = 0,
  "ALTER TABLE alevel_marks ADD INDEX idx_alevel_marks_assignment_id (assignment_id)",
  "SELECT 'idx_alevel_marks_assignment_id already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Now remove the old legacy unique key that blocks Paper 1 / Paper 2 coexistence.
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

-- Keep the paper-safe unique key in place.
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

