CREATE TABLE IF NOT EXISTS vine_conversation_settings (
  conversation_id INT PRIMARY KEY,
  disappearing_enabled TINYINT(1) NOT NULL DEFAULT 0,
  disappear_mode VARCHAR(20) NOT NULL DEFAULT 'after_read',
  theme_color VARCHAR(20) NOT NULL DEFAULT 'vine',
  quick_emoji VARCHAR(16) NOT NULL DEFAULT '👍',
  updated_by INT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

SET @quick_emoji_missing = (
  SELECT COUNT(*) = 0
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'vine_conversation_settings'
    AND COLUMN_NAME = 'quick_emoji'
);
SET @quick_emoji_sql = IF(
  @quick_emoji_missing,
  'ALTER TABLE vine_conversation_settings ADD COLUMN quick_emoji VARCHAR(16) NOT NULL DEFAULT ''👍'' AFTER theme_color',
  'SELECT 1'
);
PREPARE quick_emoji_stmt FROM @quick_emoji_sql;
EXECUTE quick_emoji_stmt;
DEALLOCATE PREPARE quick_emoji_stmt;

CREATE TABLE IF NOT EXISTS vine_conversation_nicknames (
  conversation_id INT NOT NULL,
  user_id INT NOT NULL,
  nickname VARCHAR(32) NOT NULL,
  updated_by INT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, user_id),
  INDEX idx_vine_conversation_nicknames_user (user_id, conversation_id)
);
