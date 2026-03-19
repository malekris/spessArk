-- Budget-first Vine feed/view rollback.
-- Run this once on Railway before or alongside the backend deploy.

ALTER TABLE vine_posts
  ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0;

UPDATE vine_posts p
LEFT JOIN (
  SELECT post_id, COUNT(*) AS total
  FROM vine_post_views
  GROUP BY post_id
) pv ON pv.post_id = p.id
SET p.view_count = COALESCE(pv.total, 0);

ALTER TABLE vine_post_views
  DROP INDEX uniq_vine_post_views_post_user,
  DROP INDEX post_id,
  DROP INDEX uniq_vine_post_views_post_guest;
