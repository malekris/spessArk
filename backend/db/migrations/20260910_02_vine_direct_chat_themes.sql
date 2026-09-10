-- Shared themes for one-to-one Vine conversations. Safe to run repeatedly.
SET @db_name = DATABASE();

CREATE TABLE IF NOT EXISTS vine_conversation_settings (
  conversation_id INT PRIMARY KEY,
  disappearing_enabled TINYINT(1) NOT NULL DEFAULT 0,
  disappear_mode VARCHAR(20) NOT NULL DEFAULT 'after_read',
  theme_color VARCHAR(20) NOT NULL DEFAULT 'vine',
  updated_by INT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db_name
        AND TABLE_NAME = 'vine_conversation_settings'
        AND COLUMN_NAME = 'theme_color'
    ),
    'SELECT 1',
    'ALTER TABLE vine_conversation_settings ADD COLUMN theme_color VARCHAR(20) NOT NULL DEFAULT ''vine'' AFTER disappear_mode'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
