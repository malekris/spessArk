CREATE TABLE IF NOT EXISTS vine_login_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vine_login_events_created (created_at),
  INDEX idx_vine_login_events_user_created (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS vine_user_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  event_value VARCHAR(80) NULL,
  session_jti VARCHAR(64) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

SET @db_name = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_login_events'
        AND COLUMN_NAME = 'created_at'
    ),
    'SELECT 1',
    'ALTER TABLE vine_login_events ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_user_events'
        AND COLUMN_NAME = 'event_value'
    ),
    'SELECT 1',
    'ALTER TABLE vine_user_events ADD COLUMN event_value VARCHAR(80) NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_user_events'
        AND COLUMN_NAME = 'session_jti'
    ),
    'SELECT 1',
    'ALTER TABLE vine_user_events ADD COLUMN session_jti VARCHAR(64) NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_user_events'
        AND COLUMN_NAME = 'metadata'
    ),
    'SELECT 1',
    'ALTER TABLE vine_user_events ADD COLUMN metadata JSON NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_user_events'
        AND COLUMN_NAME = 'created_at'
    ),
    'SELECT 1',
    'ALTER TABLE vine_user_events ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_user_sessions'
        AND COLUMN_NAME = 'created_at'
    ),
    'SELECT 1',
    'ALTER TABLE vine_user_sessions ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_user_sessions'
        AND COLUMN_NAME = 'last_seen_at'
    ),
    'SELECT 1',
    'ALTER TABLE vine_user_sessions ADD COLUMN last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_user_sessions'
        AND COLUMN_NAME = 'revoked_at'
    ),
    'SELECT 1',
    'ALTER TABLE vine_user_sessions ADD COLUMN revoked_at DATETIME NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DELETE e1
FROM vine_user_events e1
JOIN vine_user_events e2
  ON e1.id > e2.id
 AND e1.user_id = e2.user_id
 AND COALESCE(e1.session_jti, '') = COALESCE(e2.session_jti, '')
 AND e1.event_type = e2.event_type
 AND COALESCE(e1.event_value, '') = COALESCE(e2.event_value, '');

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_login_events'
        AND INDEX_NAME = 'idx_vine_login_events_created'
    ),
    'SELECT 1',
    'CREATE INDEX idx_vine_login_events_created ON vine_login_events (created_at)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_login_events'
        AND INDEX_NAME = 'idx_vine_login_events_user_created'
    ),
    'SELECT 1',
    'CREATE INDEX idx_vine_login_events_user_created ON vine_login_events (user_id, created_at)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_user_events'
        AND INDEX_NAME = 'uniq_vine_user_events_session_scope'
    ),
    'SELECT 1',
    'CREATE UNIQUE INDEX uniq_vine_user_events_session_scope ON vine_user_events (user_id, session_jti, event_type, event_value)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_user_events'
        AND INDEX_NAME = 'idx_vine_user_events_type_created'
    ),
    'SELECT 1',
    'CREATE INDEX idx_vine_user_events_type_created ON vine_user_events (event_type, created_at)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_user_events'
        AND INDEX_NAME = 'idx_vine_user_events_user_created'
    ),
    'SELECT 1',
    'CREATE INDEX idx_vine_user_events_user_created ON vine_user_events (user_id, created_at)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_user_sessions'
        AND INDEX_NAME = 'idx_vine_user_sessions_created'
    ),
    'SELECT 1',
    'CREATE INDEX idx_vine_user_sessions_created ON vine_user_sessions (created_at)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
