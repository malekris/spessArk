-- Additive Vine group settings. Safe to run repeatedly on Railway/MySQL.
SET @db_name = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_conversations'
        AND COLUMN_NAME = 'group_description'
    ),
    'SELECT 1',
    'ALTER TABLE vine_conversations ADD COLUMN group_description VARCHAR(300) NULL'
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
        AND TABLE_NAME = 'vine_conversation_members'
        AND COLUMN_NAME = 'notifications_muted'
    ),
    'SELECT 1',
    'ALTER TABLE vine_conversation_members ADD COLUMN notifications_muted TINYINT(1) NOT NULL DEFAULT 0'
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
        AND TABLE_NAME = 'vine_conversation_members'
        AND COLUMN_NAME = 'theme_color'
    ),
    'SELECT 1',
    'ALTER TABLE vine_conversation_members ADD COLUMN theme_color VARCHAR(20) NOT NULL DEFAULT ''vine'''
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
