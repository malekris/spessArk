import express from "express";

export default function createVineCommunitySettingsRouter({
  db,
  authenticate,
  authOptional,
  uploadAvatarMemory,
  uploadBannerMemory,
  ensureCommunitySchema,
  getCommunityRole,
  isCommunityMemberUser,
  normalizeImageBuffer,
  buildCommunityAvatarBuffer,
  buildCommunityBannerBuffer,
  uploadBufferToCloudinary,
  deleteCloudinaryByUrl,
  clearVineReadCache,
}) {
  const router = express.Router();

  const collectCommunityStoredUrls = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return [];
    if (/^https?:\/\//i.test(raw)) return [raw];
    try {
      const parsed = JSON.parse(raw);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      return values
        .flatMap((item) => {
          if (!item) return [];
          if (typeof item === "string") return item;
          if (typeof item === "object") {
            return [item.url, item.secure_url, item.image_url, item.media_url].filter(Boolean);
          }
          return [];
        })
        .filter((url) => /^https?:\/\//i.test(String(url || "")));
    } catch {
      return [];
    }
  };

  const isGuardianUser = async (user) => {
    const userId = Number(user?.id || 0);
    if (!userId) return false;
    if (Number(user?.is_admin) === 1) return true;
    if (String(user?.role || "").toLowerCase() === "moderator") return true;
    if (["vine guardian", "vine_guardian"].includes(String(user?.username || "").toLowerCase())) return true;
    const [[row]] = await db.query(
      "SELECT username, role, is_admin, badge_type FROM vine_users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!row) return false;
    if (Number(row.is_admin) === 1) return true;
    if (String(row.role || "").toLowerCase() === "moderator") return true;
    if (String(row.badge_type || "").toLowerCase() === "guardian") return true;
    return ["vine guardian", "vine_guardian"].includes(String(row.username || "").toLowerCase());
  };

  router.patch("/communities/:id/settings", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = req.user.id;
      const communityId = Number(req.params.id);
      const name = String(req.body?.name || "").trim();
      const description = String(req.body?.description || "").trim();
      const joinPolicy = String(req.body?.join_policy || "").trim();
      const autoWelcomeEnabled = req.body?.auto_welcome_enabled;
      const welcomeMessage = String(req.body?.welcome_message || "").trim();
      if (!communityId) return res.status(400).json({ message: "Invalid community" });
      if (!name) {
        return res.status(400).json({ message: "Community name is required" });
      }
      if (name.length > 80) {
        return res.status(400).json({ message: "Community name is too long" });
      }
      if (description.length > 280) {
        return res.status(400).json({ message: "Community description is too long" });
      }
      if (!["open", "approval", "closed"].includes(joinPolicy)) {
        return res.status(400).json({ message: "Invalid join policy" });
      }
      const [[roleRow]] = await db.query(
        `
        SELECT role
        FROM vine_community_members
        WHERE community_id = ? AND user_id = ?
        LIMIT 1
        `,
        [communityId, userId]
      );
      if (!roleRow || String(roleRow.role || "").toLowerCase() !== "owner") {
        return res.status(403).json({ message: "Only community owner can change settings" });
      }

      await db.query(
        `
        UPDATE vine_communities
        SET name = ?,
            description = ?,
            join_policy = ?,
            post_permission = ?,
            auto_welcome_enabled = ?,
            welcome_message = ?
        WHERE id = ?
        `,
        [
          name.slice(0, 80),
          description || null,
          joinPolicy,
          "mods_only",
          autoWelcomeEnabled === undefined ? 1 : Number(Boolean(autoWelcomeEnabled)),
          welcomeMessage || null,
          communityId,
        ]
      );
      res.json({
        success: true,
        name: name.slice(0, 80),
        description: description || null,
        join_policy: joinPolicy,
        post_permission: "mods_only",
        auto_welcome_enabled: autoWelcomeEnabled === undefined ? 1 : Number(Boolean(autoWelcomeEnabled)),
        welcome_message: welcomeMessage || null,
      });
    } catch (err) {
      console.error("Update community settings error:", err);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  router.delete("/communities/:id", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      if (!communityId) return res.status(400).json({ message: "Invalid community" });

      const [[community]] = await db.query(
        "SELECT id, name, slug, avatar_url, banner_url FROM vine_communities WHERE id = ? LIMIT 1",
        [communityId]
      );
      if (!community) return res.status(404).json({ message: "Community not found" });

      const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
      const allowed = role === "owner" || await isGuardianUser(req.user);
      if (!allowed) {
        return res.status(403).json({ message: "Only community owner or guardian can delete this community" });
      }

      const [posts] = await db.query(
        "SELECT id, image_url FROM vine_posts WHERE community_id = ?",
        [communityId]
      );
      const postIds = posts.map((row) => Number(row.id)).filter(Boolean);
      const [assignments] = await db.query(
        "SELECT attachment_url FROM vine_community_assignments WHERE community_id = ?",
        [communityId]
      );
      const [submissionFiles] = await db.query(
        "SELECT file_url FROM vine_community_submission_files WHERE community_id = ?",
        [communityId]
      );
      const [submissions] = await db.query(
        "SELECT attachment_url FROM vine_community_submissions WHERE community_id = ?",
        [communityId]
      );
      const [libraryItems] = await db.query(
        "SELECT pdf_url FROM vine_community_library WHERE community_id = ?",
        [communityId]
      );
      const [libraryVideos] = await db.query(
        "SELECT video_url FROM vine_community_library_videos WHERE community_id = ?",
        [communityId]
      );
      const [scheduledPosts] = await db.query(
        "SELECT image_url FROM vine_scheduled_posts WHERE community_id = ?",
        [communityId]
      );
      const urlsToDelete = [
        community.avatar_url,
        community.banner_url,
        ...posts.flatMap((row) => collectCommunityStoredUrls(row.image_url)),
        ...scheduledPosts.flatMap((row) => collectCommunityStoredUrls(row.image_url)),
        ...assignments.map((row) => row.attachment_url),
        ...submissions.map((row) => row.attachment_url),
        ...submissionFiles.map((row) => row.file_url),
        ...libraryItems.map((row) => row.pdf_url),
        ...libraryVideos.map((row) => row.video_url),
      ].filter(Boolean);

      if (postIds.length > 0) {
        const placeholders = postIds.map(() => "?").join(", ");
        const [polls] = await db.query(
          `SELECT id FROM vine_polls WHERE post_id IN (${placeholders})`,
          postIds
        ).catch(() => [[]]);
        const pollIds = polls.map((row) => Number(row.id)).filter(Boolean);
        if (pollIds.length > 0) {
          const pollPlaceholders = pollIds.map(() => "?").join(", ");
          await db.query(`DELETE FROM vine_poll_votes WHERE poll_id IN (${pollPlaceholders})`, pollIds).catch(() => {});
          await db.query(`DELETE FROM vine_poll_options WHERE poll_id IN (${pollPlaceholders})`, pollIds).catch(() => {});
          await db.query(`DELETE FROM vine_polls WHERE id IN (${pollPlaceholders})`, pollIds).catch(() => {});
        }
        await db.query(`DELETE FROM vine_comment_likes WHERE comment_id IN (SELECT id FROM vine_comments WHERE post_id IN (${placeholders}))`, postIds).catch(() => {});
        await db.query(`DELETE FROM vine_notifications WHERE post_id IN (${placeholders})`, postIds).catch(() => {});
        await db.query(`DELETE FROM vine_bookmarks WHERE post_id IN (${placeholders})`, postIds).catch(() => {});
        await db.query(`DELETE FROM vine_revines WHERE post_id IN (${placeholders})`, postIds).catch(() => {});
        await db.query(`DELETE FROM vine_likes WHERE post_id IN (${placeholders})`, postIds).catch(() => {});
        await db.query(`DELETE FROM vine_comments WHERE post_id IN (${placeholders})`, postIds).catch(() => {});
        await db.query(`DELETE FROM vine_post_tags WHERE post_id IN (${placeholders})`, postIds).catch(() => {});
      }

      await db.query("DELETE FROM vine_community_library_video_comments WHERE community_id = ?", [communityId]).catch(() => {});
      await db.query("DELETE FROM vine_community_library_videos WHERE community_id = ?", [communityId]).catch(() => {});
      await db.query("DELETE FROM vine_community_library WHERE community_id = ?", [communityId]).catch(() => {});
      await db.query("DELETE FROM vine_community_submission_files WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_community_submission_drafts WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_community_submissions WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_community_assignments WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_community_attendance WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_community_sessions WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_community_reports WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_community_events WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_community_join_questions WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_community_rules WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_community_join_requests WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_community_members WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_scheduled_posts WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_posts WHERE community_id = ?", [communityId]);
      await db.query("DELETE FROM vine_communities WHERE id = ?", [communityId]);

      await Promise.allSettled(Array.from(new Set(urlsToDelete)).map((url) => deleteCloudinaryByUrl(url)));
      clearVineReadCache?.(
        "community-posts",
        "community-assignments",
        "community-assignment-submissions",
        "community-gradebook",
        "community-progress",
        "community-library",
        "community-library-videos",
        "community-sessions",
        "community-attendance-session",
        "community-attendance-summary",
        "community-attendance-records",
        "feed",
        "profile-header"
      );
      res.json({ success: true, deleted_id: communityId, deleted_slug: community.slug });
    } catch (err) {
      console.error("Delete community error:", err);
      res.status(500).json({ message: "Failed to delete community" });
    }
  });

  router.post(
    "/communities/:id/avatar",
    authenticate,
    uploadAvatarMemory.single("avatar"),
    async (req, res) => {
      try {
        await ensureCommunitySchema();
        const userId = req.user.id;
        const communityId = Number(req.params.id);
        if (!communityId) return res.status(400).json({ message: "Invalid community" });
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const role = await getCommunityRole(communityId, userId);
        if (String(role || "").toLowerCase() !== "owner") {
          return res.status(403).json({ message: "Only community owner can change community avatar" });
        }

        const normalized = await normalizeImageBuffer(req.file);
        const prepared = await buildCommunityAvatarBuffer(normalized.buffer);
        const [[communityRow]] = await db.query(
          "SELECT avatar_url FROM vine_communities WHERE id = ? LIMIT 1",
          [communityId]
        );
        const upload = await uploadBufferToCloudinary(prepared.buffer, {
          folder: "vine/community_avatars",
          resource_type: "image",
          format: "jpg",
          content_type: prepared.mimetype,
          transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
        });

        await db.query("UPDATE vine_communities SET avatar_url = ? WHERE id = ?", [upload.secure_url, communityId]);
        if (communityRow?.avatar_url && communityRow.avatar_url !== upload.secure_url) {
          await deleteCloudinaryByUrl(communityRow.avatar_url).catch(() => {});
        }
        res.json({ avatar_url: upload.secure_url });
      } catch (err) {
        console.error("Community avatar upload error:", err);
        res.status(500).json({ message: "Upload failed" });
      }
    }
  );

  router.post(
    "/communities/:id/banner",
    authenticate,
    uploadBannerMemory.single("banner"),
    async (req, res) => {
      try {
        await ensureCommunitySchema();
        const userId = req.user.id;
        const communityId = Number(req.params.id);
        if (!communityId) return res.status(400).json({ message: "Invalid community" });
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const role = await getCommunityRole(communityId, userId);
        if (String(role || "").toLowerCase() !== "owner") {
          return res.status(403).json({ message: "Only community owner can change community banner" });
        }

        const normalized = await normalizeImageBuffer(req.file);
        const prepared = await buildCommunityBannerBuffer(normalized.buffer);
        const [[communityRow]] = await db.query(
          "SELECT banner_url FROM vine_communities WHERE id = ? LIMIT 1",
          [communityId]
        );
        const upload = await uploadBufferToCloudinary(prepared.buffer, {
          folder: "vine/community_banners",
          resource_type: "image",
          format: "jpg",
          content_type: prepared.mimetype,
          transformation: [{ width: 1500, height: 500, crop: "fill" }],
        });

        await db.query("UPDATE vine_communities SET banner_url = ? WHERE id = ?", [upload.secure_url, communityId]);
        if (communityRow?.banner_url && communityRow.banner_url !== upload.secure_url) {
          await deleteCloudinaryByUrl(communityRow.banner_url).catch(() => {});
        }
        res.json({ banner_url: upload.secure_url });
      } catch (err) {
        console.error("Community banner upload error:", err);
        res.status(500).json({ message: "Upload failed" });
      }
    }
  );

  router.post("/communities/:id/banner-position", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = Number(req.user.id);
      const communityId = Number(req.params.id);
      const raw = Number(req.body?.offsetY);
      if (!communityId || !Number.isFinite(raw)) {
        return res.status(400).json({ message: "Invalid request" });
      }
      const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
      if (role !== "owner") {
        return res.status(403).json({ message: "Only community owner can adjust banner position" });
      }
      const offsetY = Math.max(-260, Math.min(260, Math.round(raw)));
      await db.query("UPDATE vine_communities SET banner_offset_y = ? WHERE id = ?", [offsetY, communityId]);
      res.json({ success: true, banner_offset_y: offsetY });
    } catch (err) {
      console.error("Update community banner position error:", err);
      res.status(500).json({ message: "Failed to update banner position" });
    }
  });

  router.get("/communities/:id/rules", authOptional, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const viewerId = Number(req.user?.id || 0);
      const communityId = Number(req.params.id);
      if (!communityId) return res.status(400).json([]);
      if (!viewerId) return res.status(403).json([]);
      if (!(await isCommunityMemberUser(communityId, viewerId))) return res.status(403).json([]);
      const [rows] = await db.query(
        `
        SELECT id, rule_text, sort_order, created_at
        FROM vine_community_rules
        WHERE community_id = ?
        ORDER BY sort_order ASC, id ASC
        `,
        [communityId]
      );
      res.json(rows);
    } catch (err) {
      console.error("Get community rules error:", err);
      res.status(500).json([]);
    }
  });

  router.post("/communities/:id/rules", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = req.user.id;
      const communityId = Number(req.params.id);
      const text = String(req.body?.rule_text || "").trim();
      if (!communityId || !text) return res.status(400).json({ message: "Invalid rule" });

      const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
      if (role !== "owner") return res.status(403).json({ message: "Only community owner can create assignments" });

      await db.query(
        `
        INSERT INTO vine_community_rules (community_id, rule_text, sort_order)
        VALUES (?, ?, ?)
        `,
        [communityId, text.slice(0, 240), Number(req.body?.sort_order || 0)]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Add community rule error:", err);
      res.status(500).json({ message: "Failed to add rule" });
    }
  });

  router.delete("/communities/:id/rules/:ruleId", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = req.user.id;
      const communityId = Number(req.params.id);
      const ruleId = Number(req.params.ruleId);
      const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
      if (role !== "owner") return res.status(403).json({ message: "Only community owner can delete assignments" });
      await db.query(
        "DELETE FROM vine_community_rules WHERE id = ? AND community_id = ?",
        [ruleId, communityId]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Delete community rule error:", err);
      res.status(500).json({ message: "Failed to delete rule" });
    }
  });

  router.get("/communities/:id/questions", authOptional, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const communityId = Number(req.params.id);
      if (!communityId) return res.status(400).json([]);
      const [rows] = await db.query(
        `
        SELECT id, question_text, sort_order, created_at
        FROM vine_community_join_questions
        WHERE community_id = ?
        ORDER BY sort_order ASC, id ASC
        `,
        [communityId]
      );
      res.json(rows);
    } catch (err) {
      console.error("Get community questions error:", err);
      res.status(500).json([]);
    }
  });

  router.post("/communities/:id/questions", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = req.user.id;
      const communityId = Number(req.params.id);
      const question = String(req.body?.question_text || "").trim();
      if (!communityId || !question) return res.status(400).json({ message: "Invalid question" });
      const role = await getCommunityRole(communityId, userId);
      if (String(role || "").toLowerCase() !== "owner") {
        return res.status(403).json({ message: "Only community owner can add join questions" });
      }

      await db.query(
        `
        INSERT INTO vine_community_join_questions (community_id, question_text, sort_order)
        VALUES (?, ?, ?)
        `,
        [communityId, question.slice(0, 240), Number(req.body?.sort_order || 0)]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Add community question error:", err);
      res.status(500).json({ message: "Failed to add question" });
    }
  });

  router.delete("/communities/:id/questions/:questionId", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = req.user.id;
      const communityId = Number(req.params.id);
      const questionId = Number(req.params.questionId);
      const role = await getCommunityRole(communityId, userId);
      if (String(role || "").toLowerCase() !== "owner") {
        return res.status(403).json({ message: "Only community owner can delete join questions" });
      }
      await db.query(
        "DELETE FROM vine_community_join_questions WHERE id = ? AND community_id = ?",
        [questionId, communityId]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Delete community question error:", err);
      res.status(500).json({ message: "Failed to delete question" });
    }
  });

  return router;
}
