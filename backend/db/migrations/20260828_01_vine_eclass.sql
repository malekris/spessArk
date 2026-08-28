-- Vine eClass storage. Additive and safe to run repeatedly on Railway/MySQL.

CREATE TABLE IF NOT EXISTS vine_eclass_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  community_id INT NOT NULL,
  host_user_id INT NOT NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'live',
  active_slot TINYINT NULL DEFAULT 1,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  ended_by INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_vine_eclass_live_community (community_id, active_slot),
  INDEX idx_vine_eclass_community_started (community_id, started_at),
  INDEX idx_vine_eclass_host (host_user_id, started_at)
);

CREATE TABLE IF NOT EXISTS vine_eclass_participants (
  session_id BIGINT UNSIGNED NOT NULL,
  community_id INT NOT NULL,
  user_id INT NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at DATETIME NULL,
  is_self_muted TINYINT(1) NOT NULL DEFAULT 1,
  is_muted_by_host TINYINT(1) NOT NULL DEFAULT 0,
  hand_raised TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, user_id),
  INDEX idx_vine_eclass_participants_community (community_id, session_id),
  INDEX idx_vine_eclass_participants_user (user_id, joined_at)
);

CREATE TABLE IF NOT EXISTS vine_eclass_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id BIGINT UNSIGNED NOT NULL,
  community_id INT NOT NULL,
  user_id INT NOT NULL,
  content VARCHAR(1200) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_vine_eclass_messages_session (session_id, id),
  INDEX idx_vine_eclass_messages_community (community_id, created_at)
);
