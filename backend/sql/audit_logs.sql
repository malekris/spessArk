-- Audit log table for SPESS ARK
-- Run once on each environment (local + Railway).

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NULL,
  user_role ENUM('admin', 'teacher') NOT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type ENUM('marks', 'subject', 'stream', 'teacher', 'login', 'system') NOT NULL,
  entity_id BIGINT NULL,
  description VARCHAR(1000) NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created_at (created_at),
  KEY idx_audit_user (user_id, user_role),
  KEY idx_audit_action (action),
  KEY idx_audit_entity_type (entity_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

