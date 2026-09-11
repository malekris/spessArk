-- Additive Vine delight storage. Safe to run repeatedly on Railway/MySQL.
CREATE TABLE IF NOT EXISTS vine_profile_guestbook (
  id INT AUTO_INCREMENT PRIMARY KEY,
  profile_user_id INT NOT NULL,
  author_id INT NOT NULL,
  message VARCHAR(180) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME NULL,
  INDEX idx_vine_guestbook_profile_status_time (profile_user_id, status, created_at),
  INDEX idx_vine_guestbook_author_profile_time (author_id, profile_user_id, created_at)
);

CREATE TABLE IF NOT EXISTS vine_community_quests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  community_id INT NOT NULL,
  created_by INT NOT NULL,
  title VARCHAR(120) NOT NULL,
  emoji VARCHAR(16) NOT NULL DEFAULT '🏆',
  target_count INT NOT NULL DEFAULT 10,
  ends_at DATETIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vine_quests_community_status_end (community_id, status, ends_at)
);

CREATE TABLE IF NOT EXISTS vine_community_quest_checkins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quest_id INT NOT NULL,
  user_id INT NOT NULL,
  checkin_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_vine_quest_user_day (quest_id, user_id, checkin_date),
  INDEX idx_vine_quest_checkins_quest_time (quest_id, created_at)
);

CREATE TABLE IF NOT EXISTS vine_conversation_pets (
  conversation_id INT PRIMARY KEY,
  pet_name VARCHAR(20) NOT NULL DEFAULT 'Sprout',
  adopted_by INT NOT NULL,
  updated_by INT NOT NULL,
  adopted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vine_conversation_pets_updated (updated_at)
);

CREATE TABLE IF NOT EXISTS vine_weekly_rewind_shares (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  week_key DATE NOT NULL,
  post_id INT NOT NULL,
  image_url TEXT NOT NULL,
  stats_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_vine_weekly_rewind_user_week (user_id, week_key),
  INDEX idx_vine_weekly_rewind_post (post_id)
);

CREATE TABLE IF NOT EXISTS vine_monthly_rewind_shares (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  period_key VARCHAR(16) NOT NULL,
  post_id INT NOT NULL,
  image_url TEXT NOT NULL,
  stats_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_vine_monthly_rewind_user_period (user_id, period_key),
  INDEX idx_vine_monthly_rewind_post (post_id)
);

CREATE TABLE IF NOT EXISTS vine_yearly_rewind_shares (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  period_key VARCHAR(16) NOT NULL,
  post_id INT NOT NULL,
  image_url TEXT NOT NULL,
  stats_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_vine_yearly_rewind_user_period (user_id, period_key),
  INDEX idx_vine_yearly_rewind_post (post_id)
);

CREATE TABLE IF NOT EXISTS vine_anniversary_shares (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  anniversary_year VARCHAR(8) NOT NULL,
  post_id INT NOT NULL,
  image_url TEXT NOT NULL,
  stats_json LONGTEXT NULL,
  years_on_vine INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_vine_anniversary_user_year (user_id, anniversary_year),
  INDEX idx_vine_anniversary_post (post_id)
);

-- Older local/prod boots may have created this table before stats_json was added.
SET @db_name = DATABASE();
SET @anniversary_stats_json_missing = (
  SELECT COUNT(*) = 0
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'vine_anniversary_shares'
    AND COLUMN_NAME = 'stats_json'
);
SET @anniversary_stats_json_sql = IF(
  @anniversary_stats_json_missing,
  'ALTER TABLE vine_anniversary_shares ADD COLUMN stats_json LONGTEXT NULL AFTER image_url',
  'SELECT 1'
);
PREPARE anniversary_stats_json_stmt FROM @anniversary_stats_json_sql;
EXECUTE anniversary_stats_json_stmt;
DEALLOCATE PREPARE anniversary_stats_json_stmt;
