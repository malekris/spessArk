-- Posts-first read optimization for Vine.
-- Run once in production during a quiet window if possible.
-- These are secondary indexes only; no primary keys are changed.

ALTER TABLE vine_posts
  ADD INDEX idx_vine_posts_created_id (created_at, id);

ALTER TABLE vine_revines
  ADD INDEX idx_vine_revines_created_id (created_at, id),
  ADD INDEX idx_vine_revines_user_post (user_id, post_id);
