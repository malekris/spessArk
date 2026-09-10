-- Exact per-message read timestamps for Vine group chats.
CREATE TABLE IF NOT EXISTS vine_message_read_receipts (
  message_id INT NOT NULL,
  user_id INT NOT NULL,
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id),
  INDEX idx_vine_message_receipts_user_time (user_id, read_at)
);
