-- Additive Vine group-DM schema. Safe to run repeatedly on Railway/MySQL.
SET @db_name = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_conversations'
        AND COLUMN_NAME = 'conversation_type'
    ),
    'SELECT 1',
    'ALTER TABLE vine_conversations ADD COLUMN conversation_type VARCHAR(20) NOT NULL DEFAULT ''direct'''
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_messages'
        AND INDEX_NAME = 'idx_vine_messages_conversation_id'
    ),
    'SELECT 1',
    'CREATE INDEX idx_vine_messages_conversation_id ON vine_messages (conversation_id, id)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_conversations'
        AND COLUMN_NAME = 'group_name'
    ),
    'SELECT 1',
    'ALTER TABLE vine_conversations ADD COLUMN group_name VARCHAR(100) NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_conversations'
        AND COLUMN_NAME = 'created_by'
    ),
    'SELECT 1',
    'ALTER TABLE vine_conversations ADD COLUMN created_by INT NULL'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS vine_conversation_members (
  conversation_id INT NOT NULL,
  user_id INT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at DATETIME NULL,
  removed_by INT NULL,
  last_read_message_id INT NULL,
  last_read_at DATETIME NULL,
  PRIMARY KEY (conversation_id, user_id),
  INDEX idx_vine_group_members_user_status (user_id, status, conversation_id),
  INDEX idx_vine_group_members_conversation_status_role (conversation_id, status, role)
);

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_conversations'
        AND INDEX_NAME = 'idx_vine_conversations_type'
    ),
    'SELECT 1',
    'CREATE INDEX idx_vine_conversations_type ON vine_conversations (conversation_type)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
