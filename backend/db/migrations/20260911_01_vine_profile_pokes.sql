CREATE TABLE IF NOT EXISTS vine_pokes (
  user_low_id INT NOT NULL,
  user_high_id INT NOT NULL,
  last_poker_id INT NOT NULL,
  last_poked_id INT NOT NULL,
  poked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_low_id, user_high_id),
  INDEX idx_vine_pokes_recipient (last_poked_id, poked_at),
  INDEX idx_vine_pokes_sender (last_poker_id, poked_at)
);
