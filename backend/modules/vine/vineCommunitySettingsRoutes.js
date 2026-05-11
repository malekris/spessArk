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
}) {
  const router = express.Router();

  router.patch("/communities/:id/settings", authenticate, async (req, res) => {
    try {
      await ensureCommunitySchema();
      const userId = req.user.id;
      const communityId = Number(req.params.id);
      const description = String(req.body?.description || "").trim();
      const joinPolicy = String(req.body?.join_policy || "").trim();
      const autoWelcomeEnabled = req.body?.auto_welcome_enabled;
      const welcomeMessage = String(req.body?.welcome_message || "").trim();
      if (!communityId) return res.status(400).json({ message: "Invalid community" });
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
        SET description = ?,
            join_policy = ?,
            post_permission = ?,
            auto_welcome_enabled = ?,
            welcome_message = ?
        WHERE id = ?
        `,
        [
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
