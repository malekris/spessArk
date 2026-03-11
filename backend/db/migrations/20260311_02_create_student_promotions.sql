-- Promotion history table (append-only).
-- Keeps one promotion record per student per academic year.

CREATE TABLE IF NOT EXISTS student_promotions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id INT NOT NULL,
  student_name VARCHAR(100) NOT NULL,
  from_class_level VARCHAR(20) NOT NULL,
  from_stream VARCHAR(20) NOT NULL,
  to_class_level VARCHAR(20) NOT NULL,
  to_stream VARCHAR(20) NOT NULL,
  promotion_type ENUM('PROMOTED', 'GRADUATED') NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  promoted_by INT NULL,
  promoted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_promotion_year (student_id, academic_year),
  KEY idx_promotion_year (academic_year),
  KEY idx_promotion_type (promotion_type),
  KEY idx_promoted_at (promoted_at),
  CONSTRAINT fk_student_promotions_student
    FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

