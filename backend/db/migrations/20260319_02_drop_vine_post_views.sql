-- Final post-view cleanup for Vine.
-- Deploy the backend code that no longer references post views first,
-- then run this SQL once on Railway.

DROP TABLE IF EXISTS vine_post_views;

ALTER TABLE vine_posts
  DROP COLUMN view_count;
