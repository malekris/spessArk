CREATE TABLE IF NOT EXISTS vine_community_library_support_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  community_id INT NOT NULL,
  uploader_id INT NOT NULL,
  title VARCHAR(180) NOT NULL,
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_mime VARCHAR(120) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_library_support_community_created (community_id, created_at),
  INDEX idx_library_support_uploader (uploader_id)
);
