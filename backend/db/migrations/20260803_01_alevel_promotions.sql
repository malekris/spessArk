SET @has_alevel_status := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'alevel_learners' AND column_name = 'status'
);
SET @status_sql := IF(
  @has_alevel_status = 0,
  'ALTER TABLE alevel_learners ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT ''active''',
  'SELECT ''alevel_learners.status already exists'''
);
PREPARE status_stmt FROM @status_sql;
EXECUTE status_stmt;
DEALLOCATE PREPARE status_stmt;

SET @has_alevel_archived_at := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'alevel_learners' AND column_name = 'archived_at'
);
SET @archived_at_sql := IF(
  @has_alevel_archived_at = 0,
  'ALTER TABLE alevel_learners ADD COLUMN archived_at TIMESTAMP NULL DEFAULT NULL',
  'SELECT ''alevel_learners.archived_at already exists'''
);
PREPARE archived_at_stmt FROM @archived_at_sql;
EXECUTE archived_at_stmt;
DEALLOCATE PREPARE archived_at_stmt;

SET @has_alevel_updated_at := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'alevel_learners' AND column_name = 'updated_at'
);
SET @updated_at_sql := IF(
  @has_alevel_updated_at = 0,
  'ALTER TABLE alevel_learners ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
  'SELECT ''alevel_learners.updated_at already exists'''
);
PREPARE updated_at_stmt FROM @updated_at_sql;
EXECUTE updated_at_stmt;
DEALLOCATE PREPARE updated_at_stmt;

UPDATE alevel_learners SET status = 'active' WHERE status IS NULL OR TRIM(status) = '';

CREATE TABLE IF NOT EXISTS alevel_promotions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  learner_id INT NOT NULL,
  learner_name VARCHAR(180) NOT NULL,
  from_stream VARCHAR(40) NOT NULL,
  to_stream VARCHAR(40) NOT NULL,
  promotion_type VARCHAR(20) NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  promoted_by INT NULL,
  promoted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_alevel_promotion_year (learner_id, academic_year),
  KEY idx_alevel_promotion_year (academic_year),
  KEY idx_alevel_promotion_type (promotion_type),
  KEY idx_alevel_promoted_at (promoted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
