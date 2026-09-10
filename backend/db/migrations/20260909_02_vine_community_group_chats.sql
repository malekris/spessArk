-- Group conversations do not have a direct-message participant pair. Keeping these
-- columns NULL lets the legacy unique_pair index continue protecting one-to-one DMs
-- without blocking groups that happen to contain the same people.
SET @db_name = DATABASE();

SET @sql = COALESCE((
  SELECT IF(
    IS_NULLABLE = 'YES',
    'SELECT 1',
    CONCAT('ALTER TABLE vine_conversations MODIFY COLUMN user1_id ', COLUMN_TYPE, ' NULL')
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'vine_conversations'
    AND COLUMN_NAME = 'user1_id'
  LIMIT 1
), 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = COALESCE((
  SELECT IF(
    IS_NULLABLE = 'YES',
    'SELECT 1',
    CONCAT('ALTER TABLE vine_conversations MODIFY COLUMN user2_id ', COLUMN_TYPE, ' NULL')
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'vine_conversations'
    AND COLUMN_NAME = 'user2_id'
  LIMIT 1
), 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE vine_conversations
SET user1_id = NULL, user2_id = NULL
WHERE conversation_type = 'group'
  AND (user1_id IS NOT NULL OR user2_id IS NOT NULL);

-- One official group-DM link per Vine community. Safe to run repeatedly on Railway/MySQL.
CREATE TABLE IF NOT EXISTS vine_community_group_chats (
  community_id INT NOT NULL PRIMARY KEY,
  conversation_id INT NOT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_vine_community_group_conversation (conversation_id),
  INDEX idx_vine_community_group_creator (created_by)
);
