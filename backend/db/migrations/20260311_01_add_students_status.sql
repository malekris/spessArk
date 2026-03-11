-- Adds learner lifecycle fields to existing students table with minimal disruption.
-- Safe for current roster queries because class_level remains the live source.

SET @db_name = DATABASE();

-- Add students.status if missing (compatible with MySQL variants that do not support ADD COLUMN IF NOT EXISTS).
SET @sql_add_status = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'students'
        AND COLUMN_NAME = 'status'
    ),
    'SELECT ''students.status already exists''',
    'ALTER TABLE students ADD COLUMN status ENUM(''active'',''graduated'',''transferred'',''inactive'') NOT NULL DEFAULT ''active'' AFTER subjects'
  )
);
PREPARE stmt_add_status FROM @sql_add_status;
EXECUTE stmt_add_status;
DEALLOCATE PREPARE stmt_add_status;

-- Add students.updated_at if missing.
SET @sql_add_updated_at = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'students'
        AND COLUMN_NAME = 'updated_at'
    ),
    'SELECT ''students.updated_at already exists''',
    'ALTER TABLE students ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'
  )
);
PREPARE stmt_add_updated_at FROM @sql_add_updated_at;
EXECUTE stmt_add_updated_at;
DEALLOCATE PREPARE stmt_add_updated_at;

-- Backfill legacy graduates (if any old data already used Graduated markers).
UPDATE students
SET status = 'graduated'
WHERE status = 'active'
  AND (class_level = 'Graduated' OR stream = 'Graduated');
