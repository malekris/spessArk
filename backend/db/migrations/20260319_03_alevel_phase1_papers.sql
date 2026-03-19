-- Phase 1 A-Level papers support
-- Adds paper labels to teaching assignments and anchors marks to exact assignments.

SET @schema_name := DATABASE();

-- -----------------------------------------------------
-- alevel_teacher_subjects.paper_label
-- -----------------------------------------------------
SET @paper_label_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'alevel_teacher_subjects'
    AND COLUMN_NAME = 'paper_label'
);

SET @sql := IF(
  @paper_label_exists = 0,
  "ALTER TABLE alevel_teacher_subjects ADD COLUMN paper_label ENUM('Single','Paper 1','Paper 2') NULL AFTER stream",
  "SELECT 'alevel_teacher_subjects.paper_label already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE alevel_teacher_subjects ats
JOIN alevel_subjects s ON s.id = ats.subject_id
SET ats.paper_label = CASE
  WHEN LOWER(TRIM(s.name)) IN ('general paper', 'sub math', 'submath') THEN 'Single'
  WHEN ats.paper_label IN ('Paper 1', 'Paper 2', 'Single') THEN ats.paper_label
  ELSE 'Paper 1'
END;

SET @paper_label_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'alevel_teacher_subjects'
    AND COLUMN_NAME = 'paper_label'
);

SET @sql := IF(
  @paper_label_exists = 1,
  "ALTER TABLE alevel_teacher_subjects MODIFY COLUMN paper_label ENUM('Single','Paper 1','Paper 2') NOT NULL DEFAULT 'Single'",
  "SELECT 'alevel_teacher_subjects.paper_label missing'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------
-- alevel_marks.assignment_id
-- -----------------------------------------------------
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

-- Best-effort backfill: first prefer Paper 1 / Single matches by learner stream.
UPDATE alevel_marks am
JOIN alevel_learners l ON l.id = am.learner_id
JOIN alevel_subjects s ON s.id = am.subject_id
SET am.assignment_id = (
  SELECT MIN(ats.id)
  FROM alevel_teacher_subjects ats
  WHERE ats.subject_id = am.subject_id
    AND ats.teacher_id = am.teacher_id
    AND ats.stream = l.stream
    AND ats.paper_label = CASE
      WHEN LOWER(TRIM(s.name)) IN ('general paper', 'sub math', 'submath') THEN 'Single'
      ELSE 'Paper 1'
    END
)
WHERE am.assignment_id IS NULL;

-- Fallback for any legacy rows that still did not match a paper-specific assignment.
UPDATE alevel_marks am
JOIN alevel_learners l ON l.id = am.learner_id
SET am.assignment_id = (
  SELECT MIN(ats.id)
  FROM alevel_teacher_subjects ats
  WHERE ats.subject_id = am.subject_id
    AND ats.teacher_id = am.teacher_id
    AND ats.stream = l.stream
)
WHERE am.assignment_id IS NULL;

-- Create any missing legacy assignments so unresolved marks can still be anchored.
INSERT INTO alevel_teacher_subjects (teacher_id, subject_id, stream, paper_label)
SELECT DISTINCT
  am.teacher_id,
  am.subject_id,
  l.stream,
  CASE
    WHEN LOWER(TRIM(s.name)) IN ('general paper', 'sub math', 'submath') THEN 'Single'
    ELSE 'Paper 1'
  END AS paper_label
FROM alevel_marks am
JOIN alevel_learners l ON l.id = am.learner_id
JOIN alevel_subjects s ON s.id = am.subject_id
LEFT JOIN alevel_teacher_subjects ats
  ON ats.teacher_id = am.teacher_id
 AND ats.subject_id = am.subject_id
 AND ats.stream = l.stream
 AND ats.paper_label = CASE
   WHEN LOWER(TRIM(s.name)) IN ('general paper', 'sub math', 'submath') THEN 'Single'
   ELSE 'Paper 1'
 END
WHERE am.assignment_id IS NULL
  AND ats.id IS NULL;

-- Backfill again after creating legacy assignments.
UPDATE alevel_marks am
JOIN alevel_learners l ON l.id = am.learner_id
JOIN alevel_subjects s ON s.id = am.subject_id
SET am.assignment_id = (
  SELECT MIN(ats.id)
  FROM alevel_teacher_subjects ats
  WHERE ats.teacher_id = am.teacher_id
    AND ats.subject_id = am.subject_id
    AND ats.stream = l.stream
    AND ats.paper_label = CASE
      WHEN LOWER(TRIM(s.name)) IN ('general paper', 'sub math', 'submath') THEN 'Single'
      ELSE 'Paper 1'
    END
)
WHERE am.assignment_id IS NULL;

SET @assignment_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'alevel_marks'
    AND INDEX_NAME = 'idx_alevel_marks_assignment_term_exam'
);

SET @sql := IF(
  @assignment_idx_exists = 0,
  "ALTER TABLE alevel_marks ADD INDEX idx_alevel_marks_assignment_term_exam (assignment_id, term, exam_id)",
  "SELECT 'idx_alevel_marks_assignment_term_exam already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
