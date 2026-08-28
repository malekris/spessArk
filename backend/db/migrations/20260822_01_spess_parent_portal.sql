CREATE TABLE IF NOT EXISTS spess_parent_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  display_name VARCHAR(160) NOT NULL,
  phone_e164 VARCHAR(20) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  approved_by BIGINT NULL,
  approved_at DATETIME NULL,
  suspended_at DATETIME NULL,
  rejected_at DATETIME NULL,
  last_login_at DATETIME NULL,
  password_changed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_spess_parent_accounts_phone (phone_e164),
  KEY idx_spess_parent_accounts_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS spess_parent_learner_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  parent_id BIGINT UNSIGNED NOT NULL,
  learner_level VARCHAR(20) NOT NULL,
  learner_id BIGINT UNSIGNED NOT NULL,
  relationship_label VARCHAR(60) NOT NULL DEFAULT 'Parent / Guardian',
  active TINYINT(1) NOT NULL DEFAULT 1,
  linked_by BIGINT NULL,
  linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_by BIGINT NULL,
  revoked_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_spess_parent_learner_link (parent_id, learner_level, learner_id),
  KEY idx_spess_parent_links_learner (learner_level, learner_id, active),
  CONSTRAINT fk_spess_parent_links_parent FOREIGN KEY (parent_id)
    REFERENCES spess_parent_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS spess_parent_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_type VARCHAR(20) NOT NULL,
  title VARCHAR(220) NOT NULL,
  description TEXT NULL,
  academic_year INT NULL,
  term VARCHAR(30) NULL,
  report_kind VARCHAR(60) NULL,
  learner_level VARCHAR(20) NULL,
  learner_id BIGINT UNSIGNED NULL,
  learner_name_snapshot VARCHAR(180) NULL,
  class_snapshot VARCHAR(80) NULL,
  audience_scope VARCHAR(30) NOT NULL DEFAULT 'ALL_PARENTS',
  object_key VARCHAR(700) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sha256_hex CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'released',
  released_by BIGINT NULL,
  released_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_by BIGINT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_spess_parent_docs_status_release (status, released_at),
  KEY idx_spess_parent_docs_learner (learner_level, learner_id, status),
  KEY idx_spess_parent_docs_audience (document_type, audience_scope, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS spess_parent_document_views (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id BIGINT UNSIGNED NOT NULL,
  parent_id BIGINT UNSIGNED NOT NULL,
  first_viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  view_count INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_spess_parent_document_view (document_id, parent_id),
  KEY idx_spess_parent_views_parent (parent_id, last_viewed_at),
  CONSTRAINT fk_spess_parent_views_document FOREIGN KEY (document_id)
    REFERENCES spess_parent_documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_spess_parent_views_parent FOREIGN KEY (parent_id)
    REFERENCES spess_parent_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
