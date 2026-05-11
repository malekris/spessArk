import express from "express";

export default function createVineCommunityLibraryRouter({
  db,
  authenticate,
  uploadPostCloudinary,
  ensureCommunitySchema,
  ensureVinePerformanceSchema,
  isCommunityMemberUser,
  buildVineCacheKey,
  readThroughVineCache,
  vineCacheTtls,
  getCommunityRole,
  isCommunityModOrOwner,
  isPdfFile,
  isVideoFile,
  uploadBufferToCloudinary,
  clearVineReadCache,
  deleteCloudinaryByUrl,
}) {
  const router = express.Router();

  router.get("/communities/:slug/library", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await ensureVinePerformanceSchema();
      const viewerId = Number(req.user.id);
      const [[community]] = await db.query(
        "SELECT id FROM vine_communities WHERE slug = ? LIMIT 1",
        [req.params.slug]
      );
      if (!community) return res.status(404).json([]);
      if (!(await isCommunityMemberUser(community.id, viewerId))) return res.status(403).json([]);

      const cacheKey = buildVineCacheKey("community-library", req.params.slug.toLowerCase(), viewerId);
      const rows = await readThroughVineCache(cacheKey, vineCacheTtls.communityLibrary, async () => {
        const [libraryRows] = await db.query(
          `
          SELECT
            l.id,
            l.community_id,
            l.uploader_id,
            l.title,
            l.pdf_url,
            l.created_at,
            u.username AS uploader_username,
            u.display_name AS uploader_display_name
          FROM vine_community_library l
          JOIN vine_users u ON u.id = l.uploader_id
          WHERE l.community_id = ?
          ORDER BY l.created_at DESC, l.id DESC
          `,
          [community.id]
        );
        return libraryRows;
      });

      res.json(rows);
    } catch (err) {
      console.error("Get community library error:", err);
      res.status(500).json([]);
    }
  });

  router.get("/communities/:slug/library/videos", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      await ensureVinePerformanceSchema();
      const viewerId = Number(req.user.id);
      const [[community]] = await db.query(
        "SELECT id FROM vine_communities WHERE slug = ? LIMIT 1",
        [req.params.slug]
      );
      if (!community) return res.status(404).json([]);
      if (!(await isCommunityMemberUser(community.id, viewerId))) return res.status(403).json([]);

      const cacheKey = buildVineCacheKey("community-library-videos", req.params.slug.toLowerCase(), viewerId);
      const rows = await readThroughVineCache(cacheKey, vineCacheTtls.communityLibrary, async () => {
        const [videoRows] = await db.query(
          `
          SELECT
            v.id,
            v.community_id,
            v.uploader_id,
            v.title,
            v.video_url,
            v.created_at,
            u.username AS uploader_username,
            u.display_name AS uploader_display_name
          FROM vine_community_library_videos v
          JOIN vine_users u ON u.id = v.uploader_id
          WHERE v.community_id = ?
          ORDER BY v.created_at DESC, v.id DESC
          `,
          [community.id]
        );
        const videoIds = videoRows
          .map((row) => Number(row.id))
          .filter((id) => Number.isFinite(id) && id > 0);

        if (videoIds.length === 0) {
          return videoRows.map((row) => ({ ...row, comments: [], comment_count: 0 }));
        }

        const placeholders = videoIds.map(() => "?").join(", ");
        const [commentRows] = await db.query(
          `
          SELECT
            c.id,
            c.video_id,
            c.user_id,
            c.content,
            c.created_at,
            u.username,
            u.display_name,
            u.avatar_url
          FROM vine_community_library_video_comments c
          JOIN vine_users u ON u.id = c.user_id
          WHERE c.community_id = ?
            AND c.video_id IN (${placeholders})
          ORDER BY c.created_at ASC, c.id ASC
          `,
          [community.id, ...videoIds]
        );

        const commentsByVideo = new Map();
        for (const row of commentRows) {
          const videoId = Number(row.video_id);
          if (!commentsByVideo.has(videoId)) commentsByVideo.set(videoId, []);
          commentsByVideo.get(videoId).push(row);
        }

        return videoRows.map((row) => {
          const comments = commentsByVideo.get(Number(row.id)) || [];
          return {
            ...row,
            comments,
            comment_count: comments.length,
          };
        });
      });

      res.json(rows);
    } catch (err) {
      console.error("Get community library videos error:", err);
      res.status(500).json([]);
    }
  });

  router.post("/communities/:id/library", authenticate, uploadPostCloudinary.single("library_pdf"), async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      const title = String(req.body?.title || "").trim();
      if (!communityId || !title) {
        return res.status(400).json({ message: "title is required" });
      }
      if (!req.file || !isPdfFile(req.file)) {
        return res.status(400).json({ message: "PDF file is required" });
      }

      const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
      if (role !== "owner") {
        return res.status(403).json({ message: "Only community owner can upload library PDFs" });
      }

      const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
        folder: "vine/community-library",
        resource_type: "raw",
        public_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        format: "pdf",
        content_type: req.file.mimetype || "application/pdf",
      });
      const pdfUrl = uploaded.secure_url || uploaded.url || null;
      if (!pdfUrl) {
        return res.status(500).json({ message: "Upload failed" });
      }

      await db.query(
        `
        INSERT INTO vine_community_library (community_id, uploader_id, title, pdf_url, created_at)
        VALUES (?, ?, ?, ?, NOW())
        `,
        [communityId, userId, title.slice(0, 180), pdfUrl]
      );

      clearVineReadCache("community-library");
      res.json({ success: true });
    } catch (err) {
      console.error("Upload community library PDF error:", err);
      res.status(500).json({ message: "Failed to upload PDF" });
    }
  });

  router.post("/communities/:id/library/videos", authenticate, uploadPostCloudinary.single("library_video"), async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      const title = String(req.body?.title || "").trim();
      if (!communityId || !title) {
        return res.status(400).json({ message: "title is required" });
      }
      if (!req.file || !isVideoFile(req.file)) {
        return res.status(400).json({ message: "Video file is required" });
      }

      const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
      if (!isCommunityModOrOwner(role)) {
        return res.status(403).json({ message: "Only community owner or moderator can upload library videos" });
      }

      const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
        folder: "vine/community-library-videos",
        resource_type: "video",
      });
      const videoUrl = uploaded.secure_url || uploaded.url || null;
      if (!videoUrl) {
        return res.status(500).json({ message: "Upload failed" });
      }

      await db.query(
        `
        INSERT INTO vine_community_library_videos (community_id, uploader_id, title, video_url, created_at)
        VALUES (?, ?, ?, ?, NOW())
        `,
        [communityId, userId, title.slice(0, 180), videoUrl]
      );

      clearVineReadCache("community-library-videos");
      res.json({ success: true });
    } catch (err) {
      console.error("Upload community library video error:", err);
      res.status(500).json({ message: "Failed to upload video" });
    }
  });

  router.delete("/communities/:id/library/:itemId", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      const itemId = Number(req.params.itemId);
      if (!communityId || !itemId) return res.status(400).json({ message: "Invalid request" });

      const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
      if (role !== "owner") {
        return res.status(403).json({ message: "Only community owner can remove library PDFs" });
      }

      const [[item]] = await db.query(
        "SELECT id, pdf_url FROM vine_community_library WHERE id = ? AND community_id = ? LIMIT 1",
        [itemId, communityId]
      );
      if (!item) return res.status(404).json({ message: "Library item not found" });

      await db.query(
        "DELETE FROM vine_community_library WHERE id = ? AND community_id = ?",
        [itemId, communityId]
      );
      if (item.pdf_url) {
        await deleteCloudinaryByUrl(item.pdf_url);
      }
      clearVineReadCache("community-library");
      res.json({ success: true });
    } catch (err) {
      console.error("Delete community library PDF error:", err);
      res.status(500).json({ message: "Failed to delete PDF" });
    }
  });

  router.delete("/communities/:id/library/videos/:videoId", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      const videoId = Number(req.params.videoId);
      if (!communityId || !videoId) return res.status(400).json({ message: "Invalid request" });

      const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
      if (!isCommunityModOrOwner(role)) {
        return res.status(403).json({ message: "Only community owner or moderator can remove library videos" });
      }

      const [[item]] = await db.query(
        "SELECT id, video_url FROM vine_community_library_videos WHERE id = ? AND community_id = ? LIMIT 1",
        [videoId, communityId]
      );
      if (!item) return res.status(404).json({ message: "Video not found" });

      await db.query(
        "DELETE FROM vine_community_library_video_comments WHERE video_id = ? AND community_id = ?",
        [videoId, communityId]
      );
      await db.query(
        "DELETE FROM vine_community_library_videos WHERE id = ? AND community_id = ?",
        [videoId, communityId]
      );
      if (item.video_url) {
        await deleteCloudinaryByUrl(item.video_url);
      }

      clearVineReadCache("community-library-videos");
      res.json({ success: true });
    } catch (err) {
      console.error("Delete community library video error:", err);
      res.status(500).json({ message: "Failed to delete video" });
    }
  });

  router.post("/communities/:id/library/videos/:videoId/comments", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      const videoId = Number(req.params.videoId);
      const content = String(req.body?.content || "").trim();
      if (!communityId || !videoId || !content) {
        return res.status(400).json({ message: "content is required" });
      }
      if (content.length > 1000) {
        return res.status(400).json({ message: "Comment is too long" });
      }

      const role = await getCommunityRole(communityId, userId);
      if (!role) return res.status(403).json({ message: "Join this community first" });

      const [[video]] = await db.query(
        "SELECT id FROM vine_community_library_videos WHERE id = ? AND community_id = ? LIMIT 1",
        [videoId, communityId]
      );
      if (!video) return res.status(404).json({ message: "Video not found" });

      await db.query(
        `
        INSERT INTO vine_community_library_video_comments
        (video_id, community_id, user_id, content, created_at)
        VALUES (?, ?, ?, ?, NOW())
        `,
        [videoId, communityId, userId, content.slice(0, 1000)]
      );

      clearVineReadCache("community-library-videos");
      res.json({ success: true });
    } catch (err) {
      console.error("Create community library video comment error:", err);
      res.status(500).json({ message: "Failed to add comment" });
    }
  });

  router.delete("/communities/:id/library/videos/:videoId/comments/:commentId", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      const videoId = Number(req.params.videoId);
      const commentId = Number(req.params.commentId);
      if (!communityId || !videoId || !commentId) {
        return res.status(400).json({ message: "Invalid request" });
      }

      const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
      if (!role) return res.status(403).json({ message: "Join this community first" });

      const [[comment]] = await db.query(
        `
        SELECT id, user_id
        FROM vine_community_library_video_comments
        WHERE id = ?
          AND video_id = ?
          AND community_id = ?
        LIMIT 1
        `,
        [commentId, videoId, communityId]
      );
      if (!comment) return res.status(404).json({ message: "Comment not found" });
      if (Number(comment.user_id) !== Number(userId) && !isCommunityModOrOwner(role)) {
        return res.status(403).json({ message: "Not allowed" });
      }

      await db.query(
        "DELETE FROM vine_community_library_video_comments WHERE id = ? AND video_id = ? AND community_id = ?",
        [commentId, videoId, communityId]
      );

      clearVineReadCache("community-library-videos");
      res.json({ success: true });
    } catch (err) {
      console.error("Delete community library video comment error:", err);
      res.status(500).json({ message: "Failed to delete comment" });
    }
  });

  return router;
}
