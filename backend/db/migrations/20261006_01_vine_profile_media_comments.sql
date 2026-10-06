CREATE TABLE IF NOT EXISTS vine_profile_media_comments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  owner_user_id INT NOT NULL,
  media_type VARCHAR(16) NOT NULL,
  media_url VARCHAR(1000) NOT NULL,
  user_id INT NOT NULL,
  parent_comment_id BIGINT NULL,
  content VARCHAR(1000) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vine_profile_media_thread (owner_user_id, media_type, media_url(180), created_at),
  INDEX idx_vine_profile_media_parent (parent_comment_id),
  INDEX idx_vine_profile_media_author (user_id, created_at)
);
