import express from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  buildAttachmentContentDisposition,
  isSubmissionFinalized,
  sanitizeSubmissionFilename,
} from "./vineSubmissionFiles.js";

export default function createVineCommunityAssignmentsRouter({
  db,
  authenticate,
  uploadPostCloudinary,
  ensureCommunitySchema,
  ensureVinePerformanceSchema,
  getCommunityRole,
  isCommunityModOrOwner,
  isPdfFile,
  uploadBufferToCloudinary,
  notifyUser,
  notifyUsersBulk,
  clearVineReadCache,
  deleteCloudinaryByUrl,
  runVinePerfRoute,
  buildVineCacheKey,
  readThroughVineCache,
  vineCacheTtls,
  timedVineQuery,
  isCommunityMemberUser,
  isPracticalSubmissionFile,
  isStoredSubmissionUrl,
}) {
  const router = express.Router();
  const isAssignmentImageFile = (file) => {
    const type = String(file?.mimetype || "").toLowerCase();
    const name = String(file?.originalname || "").toLowerCase();
    if (type.startsWith("image/")) return true;
    return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name);
  };
  const parseAssignmentDueDate = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const parsed = new Date(hasTimezone ? raw : `${raw}+03:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const sendStoredSubmissionFile = async (res, file) => {
    const sourceUrl = String(file?.file_url || "").trim();
    if (!sourceUrl) {
      res.status(404).json({ message: "Submitted file is no longer available" });
      return;
    }
    if (!isStoredSubmissionUrl(sourceUrl)) {
      res.status(400).json({ message: "Submitted file location is not trusted" });
      return;
    }

    const upstream = await fetch(sourceUrl);
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ message: "Submitted file could not be downloaded" });
      return;
    }

    const filename = sanitizeSubmissionFilename(file?.file_name, "submitted-file");
    res.status(200);
    res.setHeader("Content-Type", file?.file_mime || upstream.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Content-Disposition", buildAttachmentContentDisposition(filename));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    await pipeline(Readable.fromWeb(upstream.body), res);
  };

router.post("/communities/:id/assignments", authenticate, uploadPostCloudinary.single("assignment_file"), async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const title = String(req.body?.title || "").trim();
    const instructions = String(req.body?.instructions || "").trim();
    const rubric = String(req.body?.rubric || "").trim();
    const assignmentTypeRaw = String(req.body?.assignment_type || "theory").trim().toLowerCase();
    const assignmentType = ["theory", "practical"].includes(assignmentTypeRaw) ? assignmentTypeRaw : "theory";
    const dueAtRaw = String(req.body?.due_at || "").trim();
    const parsedPoints = Number(req.body?.points);
    const points = Number.isFinite(parsedPoints) && parsedPoints > 0
      ? parsedPoints
      : 100;
    if (!communityId || !title) {
      return res.status(400).json({ message: "title is required" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });
    const dueAt = dueAtRaw ? parseAssignmentDueDate(dueAtRaw) : null;
    if (dueAtRaw && !dueAt) {
      return res.status(400).json({ message: "Invalid due date" });
    }
    let attachmentUrl = null;
    let attachmentName = null;
    let attachmentMime = null;
    if (req.file) {
      const isPdfAttachment = isPdfFile(req.file);
      const isImageAttachment = isAssignmentImageFile(req.file);
      if (!isPdfAttachment && !isImageAttachment) {
        return res.status(400).json({ message: "Use a PDF or photo for assignment attachment." });
      }
      const originalName = String(req.file.originalname || "").trim();
      const ext = originalName.includes(".") ? originalName.split(".").pop().toLowerCase() : (isPdfAttachment ? "pdf" : "jpg");
      const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
        folder: isPdfAttachment ? "vine/assignment-docs" : "vine/assignment-images",
        resource_type: isPdfAttachment ? "raw" : "image",
        public_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        format: isPdfAttachment ? "pdf" : ext,
        content_type: req.file.mimetype || (isPdfAttachment ? "application/pdf" : "image/jpeg"),
      });
      attachmentUrl = uploaded.secure_url || uploaded.url || null;
      attachmentName = originalName.slice(0, 255) || (isPdfAttachment ? "assignment.pdf" : `assignment.${ext}`);
      attachmentMime = String(req.file.mimetype || "").slice(0, 120) || (isPdfAttachment ? "application/pdf" : "image/*");
    }
    const [result] = await db.query(
      `
      INSERT INTO vine_community_assignments
      (community_id, creator_id, title, instructions, assignment_type, attachment_url, attachment_name, attachment_mime, due_at, points, rubric, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [communityId, userId, title.slice(0, 160), instructions || null, assignmentType, attachmentUrl, attachmentName, attachmentMime, dueAt || null, points, rubric || null]
    );

    const [members] = await db.query(
      `
      SELECT user_id
      FROM vine_community_members
      WHERE community_id = ?
        AND user_id != ?
      `,
      [communityId, userId]
    );
    const [[community]] = await db.query(
      "SELECT slug FROM vine_communities WHERE id = ? LIMIT 1",
      [communityId]
    );
    const assignmentId = Number(result?.insertId || 0);
    for (const row of members) {
      await notifyUser({
        userId: row.user_id,
        actorId: userId,
        type: "community_assignment_created",
        meta: {
          community_id: communityId,
          community_slug: community?.slug || null,
          assignment_id: assignmentId,
          title: title.slice(0, 160),
        },
      });
    }

    clearVineReadCache("community-assignments", "community-gradebook", "community-progress");
    res.json({ success: true });
  } catch (err) {
    console.error("Create community assignment error:", err);
    res.status(500).json({ message: "Failed to create assignment" });
  }
});

router.delete("/communities/:id/assignments/:assignmentId", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!communityId || !assignmentId) {
      return res.status(400).json({ message: "Invalid request" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json({ message: "Not allowed" });

    const [[assignment]] = await db.query(
      "SELECT id, attachment_url FROM vine_community_assignments WHERE id = ? AND community_id = ? LIMIT 1",
      [assignmentId, communityId]
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });

    const [submissionFiles] = await db.query(
      "SELECT file_url FROM vine_community_submission_files WHERE assignment_id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    const urlsToDelete = [
      assignment.attachment_url,
      ...submissionFiles.map((row) => row.file_url),
    ].filter(Boolean);

    await db.query(
      "DELETE FROM vine_community_submissions WHERE assignment_id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    await db.query(
      "DELETE FROM vine_community_submission_files WHERE assignment_id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    await db.query(
      "DELETE FROM vine_community_submission_drafts WHERE assignment_id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    await db.query(
      "DELETE FROM vine_community_grade_history WHERE assignment_id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    await db.query(
      "DELETE FROM vine_community_assignment_reminders WHERE assignment_id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    await db.query(
      "DELETE FROM vine_community_assignments WHERE id = ? AND community_id = ?",
      [assignmentId, communityId]
    );
    await Promise.all(urlsToDelete.map((url) => deleteCloudinaryByUrl(url)));

    clearVineReadCache(
      "community-assignments",
      "community-assignment-submissions",
      "community-gradebook",
      "community-progress",
      "profile-header"
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Delete assignment error:", err);
    res.status(500).json({ message: "Failed to delete assignment" });
  }
});

router.patch("/communities/:id/assignments/:assignmentId/deadline", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const dueAtRaw = String(req.body?.due_at || "").trim();
    const resurrect = req.body?.resurrect === true;
    if (!communityId || !assignmentId || !dueAtRaw) {
      return res.status(400).json({ message: "due_at is required" });
    }

    const role = await getCommunityRole(communityId, userId);
    if (String(role || "").toLowerCase() !== "owner") {
      return res.status(403).json({ message: "Only community owner can extend deadlines" });
    }

    const [[assignment]] = await db.query(
      "SELECT id, due_at FROM vine_community_assignments WHERE id = ? AND community_id = ? LIMIT 1",
      [assignmentId, communityId]
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    if (!assignment.due_at) {
      return res.status(400).json({ message: "Assignment has no existing deadline to extend" });
    }

    const currentDue = new Date(assignment.due_at);
    const nextDue = parseAssignmentDueDate(dueAtRaw);
    if (!nextDue) {
      return res.status(400).json({ message: "Invalid due date" });
    }
    const now = Date.now();
    const deadlineElapsed = currentDue.getTime() <= now;
    if (deadlineElapsed && !resurrect) {
      return res.status(403).json({ message: "Deadline already elapsed. Extension is locked." });
    }
    if (deadlineElapsed && nextDue.getTime() <= now) {
      return res.status(400).json({ message: "Resurrected deadline must be in the future" });
    }
    if (nextDue.getTime() <= currentDue.getTime()) {
      return res.status(400).json({ message: "New deadline must be later than current deadline" });
    }

    await db.query(
      "UPDATE vine_community_assignments SET due_at = ?, updated_at = NOW() WHERE id = ? AND community_id = ?",
      [nextDue, assignmentId, communityId]
    );

    clearVineReadCache("community-assignments", "community-gradebook", "community-progress", "profile-header");
    return res.json({ success: true, due_at: nextDue.toISOString() });
  } catch (err) {
    console.error("Extend assignment deadline error:", err);
    return res.status(500).json({ message: "Failed to extend deadline" });
  }
});

router.get("/communities/:slug/assignments", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const viewerId = Number(req.user.id);
    const [[community]] = await db.query("SELECT id FROM vine_communities WHERE slug = ? LIMIT 1", [req.params.slug]);
    if (!community) return res.status(404).json([]);
    if (!(await isCommunityMemberUser(community.id, viewerId))) return res.status(403).json([]);

    const rows = await runVinePerfRoute(
      "community-assignments",
      { slug: req.params.slug, community_id: community.id, viewer_id: viewerId },
      async (perfCtx) => {
        const cacheKey = buildVineCacheKey("community-assignments", req.params.slug.toLowerCase(), viewerId);
        return readThroughVineCache(cacheKey, vineCacheTtls.communityAssignments, async () => {
          const [assignmentRows] = await timedVineQuery(
            perfCtx,
            "community-assignments.rows",
            `
            SELECT
              a.id,
              a.community_id,
              a.creator_id,
              a.title,
              a.instructions,
              a.assignment_type,
              a.attachment_url,
              a.attachment_name,
              a.attachment_mime,
              a.rubric,
              a.due_at,
              a.points,
              a.created_at,
              cu.username AS creator_username,
              cu.display_name AS creator_display_name,
              COALESCE(member_stats.eligible_learner_count, 0) AS eligible_learner_count,
              COALESCE(submission_stats.submission_count, 0) AS submission_count,
              COALESCE(submission_stats.graded_count, 0) AS graded_count,
              COALESCE(submission_stats.awaiting_grading_count, 0) AS awaiting_grading_count,
              GREATEST(
                COALESCE(member_stats.eligible_learner_count, 0) - COALESCE(submission_stats.submission_count, 0),
                0
              ) AS missing_count,
              reminder_stats.latest_reminder_at,
              vs.id AS viewer_submission_id,
              vs.status AS viewer_submission_status,
              vs.graded_at AS viewer_submission_graded_at,
              vs.attempt_count AS viewer_submission_attempts,
              vs.score AS viewer_submission_score,
              vs.submitted_at AS viewer_submitted_at,
              vs.content AS viewer_submission_content,
              vs.attachment_url AS viewer_submission_attachment_url,
              vs.attachment_name AS viewer_submission_attachment_name,
              vs.attachment_mime AS viewer_submission_attachment_mime,
              vd.content AS viewer_draft_content,
              vd.updated_at AS viewer_draft_updated_at
            FROM vine_community_assignments a
            JOIN vine_users cu ON cu.id = a.creator_id
            LEFT JOIN (
              SELECT community_id, COUNT(*) AS eligible_learner_count
              FROM vine_community_members
              WHERE LOWER(COALESCE(role, 'member')) = 'member'
              GROUP BY community_id
            ) member_stats ON member_stats.community_id = a.community_id
            LEFT JOIN (
              SELECT
                s.assignment_id,
                COUNT(*) AS submission_count,
                SUM(
                  s.graded_at IS NOT NULL
                  OR s.score IS NOT NULL
                  OR LOWER(COALESCE(s.status, '')) IN ('graded', 'needs_revision', 'missing')
                ) AS graded_count,
                SUM(
                  s.graded_at IS NULL
                  AND s.score IS NULL
                  AND LOWER(COALESCE(s.status, 'submitted')) NOT IN ('graded', 'needs_revision', 'missing')
                ) AS awaiting_grading_count
              FROM vine_community_submissions s
              JOIN vine_community_members m
                ON m.community_id = s.community_id
               AND m.user_id = s.user_id
               AND LOWER(COALESCE(m.role, 'member')) = 'member'
              GROUP BY s.assignment_id
            ) submission_stats ON submission_stats.assignment_id = a.id
            LEFT JOIN (
              SELECT assignment_id, MAX(sent_at) AS latest_reminder_at
              FROM vine_community_assignment_reminders
              GROUP BY assignment_id
            ) reminder_stats ON reminder_stats.assignment_id = a.id
            LEFT JOIN vine_community_submissions vs
              ON vs.assignment_id = a.id
             AND vs.user_id = ?
            LEFT JOIN vine_community_submission_drafts vd
              ON vd.assignment_id = a.id
             AND vd.user_id = ?
            WHERE a.community_id = ?
            ORDER BY a.created_at DESC, a.id DESC
            `,
            [viewerId, viewerId, community.id]
          );
          const submissionIds = assignmentRows
            .map((r) => Number(r.viewer_submission_id))
            .filter((id) => Number.isFinite(id) && id > 0);
          if (submissionIds.length > 0) {
            const placeholders = submissionIds.map(() => "?").join(", ");
            const [fileRows] = await timedVineQuery(
              perfCtx,
              "community-assignments.files",
              `
              SELECT id, submission_id, file_url, file_name, file_mime, created_at
              FROM vine_community_submission_files
              WHERE submission_id IN (${placeholders})
              ORDER BY created_at ASC, id ASC
              `,
              submissionIds
            );
            const bySubmission = {};
            for (const row of fileRows) {
              const sid = Number(row.submission_id);
              if (!bySubmission[sid]) bySubmission[sid] = [];
              bySubmission[sid].push({
                id: row.id,
                file_url: row.file_url,
                file_name: row.file_name,
                file_mime: row.file_mime,
                created_at: row.created_at,
              });
            }
            for (const row of assignmentRows) {
              const sid = Number(row.viewer_submission_id || 0);
              row.viewer_submission_files = sid > 0 ? (bySubmission[sid] || []) : [];
            }
          } else {
            for (const row of assignmentRows) row.viewer_submission_files = [];
          }
          return assignmentRows;
        });
      }
    );
    res.json(rows);
  } catch (err) {
    console.error("Get community assignments error:", err);
    res.status(500).json([]);
  }
});

router.post("/communities/:id/assignments/:assignmentId/reminders", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!communityId || !assignmentId) {
      return res.status(400).json({ message: "Invalid request" });
    }

    const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (role !== "owner") {
      return res.status(403).json({ message: "Only the community owner can send assignment reminders" });
    }

    const [[assignment]] = await db.query(
      `
      SELECT a.id, a.title, a.due_at, c.slug AS community_slug, c.name AS community_name
      FROM vine_community_assignments a
      JOIN vine_communities c ON c.id = a.community_id
      WHERE a.id = ? AND a.community_id = ?
      LIMIT 1
      `,
      [assignmentId, communityId]
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });

    // Keep one-click reminders useful without letting an accidental double-click
    // flood learner notification feeds.
    const [[latestReminder]] = await db.query(
      `
      SELECT sent_at
      FROM vine_community_assignment_reminders
      WHERE assignment_id = ? AND community_id = ?
      ORDER BY sent_at DESC, id DESC
      LIMIT 1
      `,
      [assignmentId, communityId]
    );
    if (latestReminder?.sent_at) {
      const elapsedMs = Date.now() - new Date(latestReminder.sent_at).getTime();
      const cooldownMs = 6 * 60 * 60 * 1000;
      if (Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < cooldownMs) {
        return res.status(429).json({
          message: "Missing learners were reminded recently. You can send another reminder after the six-hour cooldown.",
          retry_after_minutes: Math.ceil((cooldownMs - elapsedMs) / 60000),
        });
      }
    }

    const [missingLearners] = await db.query(
      `
      SELECT m.user_id
      FROM vine_community_members m
      LEFT JOIN vine_community_submissions s
        ON s.community_id = m.community_id
       AND s.assignment_id = ?
       AND s.user_id = m.user_id
      WHERE m.community_id = ?
        AND LOWER(COALESCE(m.role, 'member')) = 'member'
        AND s.id IS NULL
      ORDER BY m.user_id ASC
      `,
      [assignmentId, communityId]
    );
    const recipientIds = missingLearners.map((row) => Number(row.user_id)).filter(Boolean);
    if (recipientIds.length === 0) {
      return res.json({ success: true, sent_count: 0, message: "Every learner has already submitted this assignment." });
    }

    const sentCount = await notifyUsersBulk({
      userIds: recipientIds,
      actorId: userId,
      type: "community_assignment_reminder",
      meta: {
        community_id: communityId,
        community_slug: assignment.community_slug || null,
        community_name: assignment.community_name || null,
        assignment_id: assignmentId,
        assignment_title: assignment.title || null,
        due_at: assignment.due_at || null,
      },
    });
    await db.query(
      `
      INSERT INTO vine_community_assignment_reminders
      (community_id, assignment_id, sent_by, recipient_count, sent_at)
      VALUES (?, ?, ?, ?, NOW())
      `,
      [communityId, assignmentId, userId, Number(sentCount || recipientIds.length)]
    );

    clearVineReadCache("community-assignments");
    return res.json({ success: true, sent_count: Number(sentCount || recipientIds.length) });
  } catch (err) {
    console.error("Send assignment reminders error:", err);
    return res.status(500).json({ message: "Failed to send assignment reminders" });
  }
});

router.post("/communities/:id/assignments/:assignmentId/submissions", authenticate, uploadPostCloudinary.array("submission_files", 10), async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const content = String(req.body?.content || "").trim();
    const files = Array.isArray(req.files) ? req.files : [];
    if (!communityId || !assignmentId) return res.status(400).json({ message: "Invalid request" });
    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ message: "Join this community first" });

    const [[assignment]] = await db.query(
      "SELECT id, community_id, due_at, assignment_type FROM vine_community_assignments WHERE id = ? AND community_id = ? LIMIT 1",
      [assignmentId, communityId]
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    const isPractical = String(assignment.assignment_type || "theory").toLowerCase() === "practical";
    if (!content && files.length === 0) {
      return res.status(400).json({ message: isPractical ? "Upload a file or add notes" : "content is required" });
    }
    if (files.length > 0 && !isPractical) {
      return res.status(400).json({ message: "File upload is only allowed for practical assignments" });
    }
    if (files.length > 0 && isPractical && files.some((file) => !isPracticalSubmissionFile(file))) {
      return res.status(400).json({ message: "Invalid practical file type. Use PPT, XLS, DOC, Access, Publisher, or PDF files." });
    }
    const normalizedRole = String(role || "").toLowerCase();
    const canBypassDueDate = normalizedRole === "owner";
    if (assignment.due_at && !canBypassDueDate) {
      const dueAt = new Date(assignment.due_at);
      if (!Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now()) {
        return res.status(403).json({ message: "Submission window closed. Due date has passed." });
      }
    }

    const [[existing]] = await db.query(
      "SELECT id, attempt_count, graded_at, score, status, attachment_url, attachment_name, attachment_mime FROM vine_community_submissions WHERE assignment_id = ? AND community_id = ? AND user_id = ? LIMIT 1",
      [assignmentId, communityId, userId]
    );
    if (existing && isSubmissionFinalized(existing)) {
      return res.status(403).json({ message: "Assignment already graded. Further uploads are closed." });
    }
    if (existing && !isPractical && Number(existing.attempt_count || 1) >= 2) {
      return res.status(403).json({ message: "Submission limit reached (2 attempts)." });
    }

    const uploadedFiles = [];
    if (files.length > 0 && isPractical) {
      for (const file of files) {
        const originalName = String(file.originalname || "").trim();
        const ext = originalName.includes(".") ? originalName.split(".").pop().toLowerCase() : "bin";
        const uploaded = await uploadBufferToCloudinary(file.buffer, {
          folder: "vine/assignment-submissions",
          resource_type: "raw",
          public_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          format: ext,
          content_type: file.mimetype || "application/octet-stream",
          content_disposition: buildAttachmentContentDisposition(originalName || `submission.${ext}`),
        });
        uploadedFiles.push({
          url: uploaded.secure_url || uploaded.url || null,
          name: originalName.slice(0, 255) || `submission.${ext}`,
          mime: String(file.mimetype || "").slice(0, 120) || null,
        });
      }
    }

    const primaryAttachment = uploadedFiles[0] || null;
    let submissionId = null;
    if (existing) {
      const [updateResult] = await db.query(
        `
        UPDATE vine_community_submissions
        SET content = ?,
            attachment_url = ?,
            attachment_name = ?,
            attachment_mime = ?,
            attempt_count = CASE WHEN ? THEN attempt_count ELSE attempt_count + 1 END,
            status = 'resubmitted',
            submitted_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
          AND graded_at IS NULL
          AND score IS NULL
          AND LOWER(COALESCE(status, '')) NOT IN ('graded', 'needs_revision', 'missing')
        `,
        [
          content || null,
          primaryAttachment?.url || existing.attachment_url || null,
          primaryAttachment?.name || existing.attachment_name || null,
          primaryAttachment?.mime || existing.attachment_mime || null,
          isPractical ? 1 : 0,
          existing.id,
        ]
      );
      if (Number(updateResult?.affectedRows || 0) === 0) {
        await Promise.all(uploadedFiles.map((file) => deleteCloudinaryByUrl(file.url)));
        return res.status(403).json({ message: "Assignment was graded while this upload was in progress. Further uploads are closed." });
      }
      submissionId = Number(existing.id);
    } else {
      const [inserted] = await db.query(
        `
        INSERT INTO vine_community_submissions
        (assignment_id, community_id, user_id, content, attachment_url, attachment_name, attachment_mime, attempt_count, status, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'submitted', NOW())
        `,
        [
          assignmentId,
          communityId,
          userId,
          content || null,
          primaryAttachment?.url || null,
          primaryAttachment?.name || null,
          primaryAttachment?.mime || null,
        ]
      );
      submissionId = Number(inserted?.insertId || 0);
    }
    if (submissionId && uploadedFiles.length > 0 && isPractical) {
      for (const file of uploadedFiles) {
        if (!file.url) continue;
        await db.query(
          `
          INSERT INTO vine_community_submission_files
          (submission_id, assignment_id, community_id, user_id, file_url, file_name, file_mime, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
          `,
          [submissionId, assignmentId, communityId, userId, file.url, file.name || null, file.mime || null]
        );
      }
    }
    await db.query(
      "DELETE FROM vine_community_submission_drafts WHERE assignment_id = ? AND community_id = ? AND user_id = ?",
      [assignmentId, communityId, userId]
    );

    const [[assignmentMeta]] = await db.query(
      `
      SELECT a.title, a.assignment_type, c.slug AS community_slug
      FROM vine_community_assignments a
      LEFT JOIN vine_communities c ON c.id = a.community_id
      WHERE a.id = ? AND a.community_id = ?
      LIMIT 1
      `,
      [assignmentId, communityId]
    );
    const [mods] = await db.query(
      `
      SELECT user_id
      FROM vine_community_members
      WHERE community_id = ?
        AND LOWER(role) IN ('owner', 'moderator')
        AND user_id != ?
      `,
      [communityId, userId]
    );
    for (const row of mods) {
      await notifyUser({
        userId: row.user_id,
        actorId: userId,
        type: "community_assignment_submission",
        meta: {
          community_id: communityId,
          community_slug: assignmentMeta?.community_slug || null,
          assignment_id: assignmentId,
          assignment_title: assignmentMeta?.title || null,
          assignment_type: assignmentMeta?.assignment_type || "theory",
          submitted_at: new Date().toISOString(),
          attempt_count: existing
            ? (isPractical ? Number(existing.attempt_count || 1) : Number(existing.attempt_count || 1) + 1)
            : 1,
          is_resubmission: Boolean(existing),
        },
      });
    }

    clearVineReadCache(
      "community-assignments",
      "community-assignment-submissions",
      "community-gradebook",
      "community-progress",
      "profile-header"
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Submit assignment error:", err);
    res.status(500).json({ message: "Failed to submit assignment" });
  }
});

router.get("/communities/:id/assignments/:assignmentId/submission-files/:fileId/download", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const fileId = Number(req.params.fileId);
    if (!communityId || !assignmentId || !fileId) {
      return res.status(400).json({ message: "Invalid download request" });
    }

    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ message: "Join this community first" });

    const [[file]] = await db.query(
      `
      SELECT f.file_url, f.file_name, f.file_mime, s.user_id
      FROM vine_community_submission_files f
      JOIN vine_community_submissions s ON s.id = f.submission_id
      WHERE f.id = ?
        AND f.assignment_id = ?
        AND f.community_id = ?
        AND s.assignment_id = ?
        AND s.community_id = ?
      LIMIT 1
      `,
      [fileId, assignmentId, communityId, assignmentId, communityId]
    );
    if (!file) return res.status(404).json({ message: "Submitted file not found" });
    if (Number(file.user_id) !== userId && !isCommunityModOrOwner(role)) {
      return res.status(403).json({ message: "You cannot download another learner's submission" });
    }

    await sendStoredSubmissionFile(res, file);
  } catch (err) {
    console.error("Download practical submission file error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ message: "Failed to download submitted file" });
    }
    res.destroy(err);
  }
});

router.get("/communities/:id/assignments/:assignmentId/submissions/:submissionId/attachment/download", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const submissionId = Number(req.params.submissionId);
    if (!communityId || !assignmentId || !submissionId) {
      return res.status(400).json({ message: "Invalid download request" });
    }

    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ message: "Join this community first" });

    const [[file]] = await db.query(
      `
      SELECT
        attachment_url AS file_url,
        attachment_name AS file_name,
        attachment_mime AS file_mime,
        user_id
      FROM vine_community_submissions
      WHERE id = ?
        AND assignment_id = ?
        AND community_id = ?
      LIMIT 1
      `,
      [submissionId, assignmentId, communityId]
    );
    if (!file?.file_url) return res.status(404).json({ message: "Submitted file not found" });
    if (Number(file.user_id) !== userId && !isCommunityModOrOwner(role)) {
      return res.status(403).json({ message: "You cannot download another learner's submission" });
    }

    await sendStoredSubmissionFile(res, file);
  } catch (err) {
    console.error("Download legacy practical submission file error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ message: "Failed to download submitted file" });
    }
    res.destroy(err);
  }
});

router.delete("/communities/:id/assignments/:assignmentId/submission-files/:fileId", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const fileId = Number(req.params.fileId);
    if (!communityId || !assignmentId || !fileId) {
      return res.status(400).json({ message: "Invalid request" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ message: "Join this community first" });
    const isOwner = String(role || "").toLowerCase() === "owner";

    const [[assignment]] = await db.query(
      "SELECT id, due_at, assignment_type FROM vine_community_assignments WHERE id = ? AND community_id = ? LIMIT 1",
      [assignmentId, communityId]
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    if (String(assignment.assignment_type || "").toLowerCase() !== "practical") {
      return res.status(400).json({ message: "File deletion is only available for practical assignments" });
    }
    if (!isOwner && assignment.due_at) {
      const dueAt = new Date(assignment.due_at);
      if (!Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now()) {
        return res.status(403).json({ message: "Submission window closed. Due date has passed." });
      }
    }

    const [[row]] = await db.query(
      `
      SELECT
        f.id,
        f.submission_id,
        f.file_url,
        s.user_id,
        s.graded_at,
        s.score,
        s.status
      FROM vine_community_submission_files f
      JOIN vine_community_submissions s ON s.id = f.submission_id
      WHERE f.id = ?
        AND f.assignment_id = ?
        AND f.community_id = ?
      LIMIT 1
      `,
      [fileId, assignmentId, communityId]
    );
    if (!row) return res.status(404).json({ message: "File not found" });
    if (!isOwner && Number(row.user_id) !== Number(userId)) {
      return res.status(403).json({ message: "You can only delete your own uploaded files" });
    }
    if (!isOwner && isSubmissionFinalized(row)) {
      return res.status(403).json({ message: "Assignment already graded. Uploaded files are locked." });
    }

    const [deleteResult] = isOwner
      ? await db.query(
          `
          DELETE FROM vine_community_submission_files
          WHERE id = ? AND assignment_id = ? AND community_id = ?
          `,
          [fileId, assignmentId, communityId]
        )
      : await db.query(
          `
          DELETE f
          FROM vine_community_submission_files f
          JOIN vine_community_submissions s ON s.id = f.submission_id
          WHERE f.id = ?
            AND s.graded_at IS NULL
            AND s.score IS NULL
            AND LOWER(COALESCE(s.status, '')) NOT IN ('graded', 'needs_revision', 'missing')
          `,
          [fileId]
        );
    if (Number(deleteResult?.affectedRows || 0) === 0) {
      return res.status(isOwner ? 404 : 403).json({
        message: isOwner
          ? "Submitted file was already removed"
          : "Assignment was graded while this file was being removed. Uploaded files are locked.",
      });
    }
    await deleteCloudinaryByUrl(row.file_url);

    const [remaining] = await db.query(
      `
      SELECT file_url, file_name, file_mime
      FROM vine_community_submission_files
      WHERE submission_id = ?
      ORDER BY created_at ASC, id ASC
      `,
      [row.submission_id]
    );
    const latest = remaining.length ? remaining[remaining.length - 1] : null;
    await db.query(
      `
      UPDATE vine_community_submissions
      SET attachment_url = ?, attachment_name = ?, attachment_mime = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [latest?.file_url || null, latest?.file_name || null, latest?.file_mime || null, row.submission_id]
    );

    clearVineReadCache(
      "community-assignments",
      "community-assignment-submissions",
      "community-gradebook",
      "community-progress",
      "profile-header"
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Delete practical submission file error:", err);
    res.status(500).json({ message: "Failed to delete file" });
  }
});

router.delete("/communities/:id/assignments/:assignmentId/submissions/:submissionId/attachment", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const submissionId = Number(req.params.submissionId);
    if (!communityId || !assignmentId || !submissionId) {
      return res.status(400).json({ message: "Invalid request" });
    }

    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ message: "Join this community first" });
    const isOwner = String(role || "").toLowerCase() === "owner";

    const [[row]] = await db.query(
      `
      SELECT
        s.id,
        s.user_id,
        s.attachment_url,
        s.graded_at,
        s.score,
        s.status,
        a.due_at,
        a.assignment_type
      FROM vine_community_submissions s
      JOIN vine_community_assignments a ON a.id = s.assignment_id
      WHERE s.id = ?
        AND s.assignment_id = ?
        AND s.community_id = ?
        AND a.community_id = ?
      LIMIT 1
      `,
      [submissionId, assignmentId, communityId, communityId]
    );
    if (!row?.attachment_url) return res.status(404).json({ message: "Submitted file not found" });
    if (String(row.assignment_type || "").toLowerCase() !== "practical") {
      return res.status(400).json({ message: "File deletion is only available for practical assignments" });
    }
    if (!isOwner && Number(row.user_id) !== userId) {
      return res.status(403).json({ message: "You can only delete your own uploaded files" });
    }
    if (!isOwner && row.due_at) {
      const dueAt = new Date(row.due_at);
      if (!Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now()) {
        return res.status(403).json({ message: "Submission window closed. Due date has passed." });
      }
    }
    if (!isOwner && isSubmissionFinalized(row)) {
      return res.status(403).json({ message: "Assignment already graded. Uploaded files are locked." });
    }

    const [updateResult] = isOwner
      ? await db.query(
          `
          UPDATE vine_community_submissions
          SET attachment_url = NULL, attachment_name = NULL, attachment_mime = NULL, updated_at = NOW()
          WHERE id = ? AND assignment_id = ? AND community_id = ?
          `,
          [submissionId, assignmentId, communityId]
        )
      : await db.query(
          `
          UPDATE vine_community_submissions
          SET attachment_url = NULL, attachment_name = NULL, attachment_mime = NULL, updated_at = NOW()
          WHERE id = ?
            AND assignment_id = ?
            AND community_id = ?
            AND graded_at IS NULL
            AND score IS NULL
            AND LOWER(COALESCE(status, '')) NOT IN ('graded', 'needs_revision', 'missing')
          `,
          [submissionId, assignmentId, communityId]
        );
    if (Number(updateResult?.affectedRows || 0) === 0) {
      return res.status(isOwner ? 404 : 403).json({
        message: isOwner
          ? "Submitted file was already removed"
          : "Assignment was graded while this file was being removed. Uploaded files are locked.",
      });
    }

    await deleteCloudinaryByUrl(row.attachment_url);
    clearVineReadCache(
      "community-assignments",
      "community-assignment-submissions",
      "community-gradebook",
      "community-progress",
      "profile-header"
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Delete legacy practical submission file error:", err);
    res.status(500).json({ message: "Failed to delete file" });
  }
});

router.post("/communities/:id/assignments/:assignmentId/draft", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const content = String(req.body?.content || "").trim();
    if (!communityId || !assignmentId || !content) {
      return res.status(400).json({ message: "content is required" });
    }
    const role = await getCommunityRole(communityId, userId);
    if (!role) return res.status(403).json({ message: "Join this community first" });

    const [[assignment]] = await db.query(
      "SELECT id FROM vine_community_assignments WHERE id = ? AND community_id = ? LIMIT 1",
      [assignmentId, communityId]
    );
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });

    const [[existingSubmission]] = await db.query(
      `
      SELECT graded_at, score, status
      FROM vine_community_submissions
      WHERE assignment_id = ? AND community_id = ? AND user_id = ?
      LIMIT 1
      `,
      [assignmentId, communityId, userId]
    );
    if (existingSubmission && isSubmissionFinalized(existingSubmission)) {
      return res.status(403).json({ message: "Assignment already graded. Draft changes are closed." });
    }

    await db.query(
      `
      INSERT INTO vine_community_submission_drafts (assignment_id, community_id, user_id, content, updated_at)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = NOW()
      `,
      [assignmentId, communityId, userId, content]
    );
    clearVineReadCache("community-assignments");
    res.json({ success: true });
  } catch (err) {
    console.error("Save assignment draft error:", err);
    res.status(500).json({ message: "Failed to save draft" });
  }
});

router.get("/communities/:id/assignments/:assignmentId/submissions", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!communityId || !assignmentId) return res.status(400).json([]);
    const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (role !== "owner") return res.status(403).json([]);

    const rows = await runVinePerfRoute(
      "community-assignment-submissions",
      { community_id: communityId, assignment_id: assignmentId, viewer_id: userId },
      async (perfCtx) => {
        const cacheKey = buildVineCacheKey("community-assignment-submissions", communityId, assignmentId, userId);
        return readThroughVineCache(cacheKey, vineCacheTtls.communityAssignmentSubmissions, async () => {
          const [submissionRows] = await timedVineQuery(
            perfCtx,
            "community-assignment-submissions.rows",
            `
            SELECT
              s.id,
              s.assignment_id,
              s.user_id,
              s.content,
              s.status,
              s.score,
              s.feedback,
              s.attachment_url,
              s.attachment_name,
              s.attachment_mime,
              s.submitted_at,
              s.graded_at,
              u.username,
              u.display_name,
              u.avatar_url,
              u.is_verified
            FROM vine_community_submissions s
            JOIN vine_users u ON u.id = s.user_id
            WHERE s.community_id = ?
              AND s.assignment_id = ?
            ORDER BY s.submitted_at DESC
            `,
            [communityId, assignmentId]
          );
          const submissionIds = submissionRows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
          if (submissionIds.length > 0) {
            const placeholders = submissionIds.map(() => "?").join(", ");
            const [fileRows] = await timedVineQuery(
              perfCtx,
              "community-assignment-submissions.files",
              `
              SELECT id, submission_id, file_url, file_name, file_mime, created_at
              FROM vine_community_submission_files
              WHERE submission_id IN (${placeholders})
              ORDER BY created_at ASC, id ASC
              `,
              submissionIds
            );
            const bySubmission = {};
            for (const row of fileRows) {
              const sid = Number(row.submission_id);
              if (!bySubmission[sid]) bySubmission[sid] = [];
              bySubmission[sid].push({
                id: row.id,
                file_url: row.file_url,
                file_name: row.file_name,
                file_mime: row.file_mime,
                created_at: row.created_at,
              });
            }
            for (const row of submissionRows) {
              const sid = Number(row.id || 0);
              row.submission_files = sid > 0 ? (bySubmission[sid] || []) : [];
            }

            const [historyRows] = await timedVineQuery(
              perfCtx,
              "community-assignment-submissions.grade-history",
              `
              SELECT
                h.id,
                h.submission_id,
                h.previous_score,
                h.previous_status,
                h.previous_feedback,
                h.new_score,
                h.new_status,
                h.new_feedback,
                h.changed_at,
                grader.username AS grader_username,
                grader.display_name AS grader_display_name
              FROM vine_community_grade_history h
              LEFT JOIN vine_users grader ON grader.id = h.graded_by
              WHERE h.submission_id IN (${placeholders})
              ORDER BY h.changed_at DESC, h.id DESC
              `,
              submissionIds
            );
            const historyBySubmission = {};
            for (const row of historyRows) {
              const sid = Number(row.submission_id);
              if (!historyBySubmission[sid]) historyBySubmission[sid] = [];
              historyBySubmission[sid].push(row);
            }
            for (const row of submissionRows) {
              row.grade_history = historyBySubmission[Number(row.id)] || [];
            }
          } else {
            for (const row of submissionRows) {
              row.submission_files = [];
              row.grade_history = [];
            }
          }
          return submissionRows;
        });
      }
    );
    res.json(rows);
  } catch (err) {
    console.error("Get assignment submissions error:", err);
    res.status(500).json([]);
  }
});

router.delete("/communities/:id/assignments/:assignmentId/submissions/:submissionId", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    const submissionId = Number(req.params.submissionId);
    if (!communityId || !assignmentId || !submissionId) {
      return res.status(400).json({ message: "Invalid request" });
    }

    const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (role !== "owner") {
      return res.status(403).json({ message: "Only community owner can delete submissions" });
    }

    const [[submission]] = await db.query(
      `
      SELECT
        s.id,
        s.user_id,
        s.attachment_url,
        a.id AS assignment_id
      FROM vine_community_submissions s
      JOIN vine_community_assignments a ON a.id = s.assignment_id
      WHERE s.id = ?
        AND s.assignment_id = ?
        AND s.community_id = ?
        AND a.community_id = ?
      LIMIT 1
      `,
      [submissionId, assignmentId, communityId, communityId]
    );
    if (!submission) return res.status(404).json({ message: "Submission not found" });

    const [submissionFiles] = await db.query(
      `
      SELECT file_url
      FROM vine_community_submission_files
      WHERE submission_id = ?
        AND assignment_id = ?
        AND community_id = ?
      `,
      [submissionId, assignmentId, communityId]
    );
    const urlsToDelete = [...new Set([
      submission.attachment_url,
      ...submissionFiles.map((row) => row.file_url),
    ].filter(Boolean))];

    await db.query(
      "DELETE FROM vine_community_submission_files WHERE submission_id = ? AND assignment_id = ? AND community_id = ?",
      [submissionId, assignmentId, communityId]
    );
    await db.query(
      "DELETE FROM vine_community_submission_drafts WHERE assignment_id = ? AND community_id = ? AND user_id = ?",
      [assignmentId, communityId, submission.user_id]
    );
    await db.query(
      "DELETE FROM vine_community_submissions WHERE id = ? AND assignment_id = ? AND community_id = ?",
      [submissionId, assignmentId, communityId]
    );
    await Promise.all(urlsToDelete.map((url) => deleteCloudinaryByUrl(url)));

    clearVineReadCache(
      "community-assignments",
      "community-assignment-submissions",
      "community-gradebook",
      "community-progress",
      "profile-header"
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Delete assignment submission error:", err);
    res.status(500).json({ message: "Failed to delete submission" });
  }
});

router.patch("/communities/:id/submissions/:submissionId/grade", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    const submissionId = Number(req.params.submissionId);
    const scoreRaw = req.body?.score;
    const feedback = String(req.body?.feedback || "").trim();
    const requestedStatus = String(req.body?.status || "graded").trim().toLowerCase();
    const status = ["graded", "needs_revision", "missing"].includes(requestedStatus)
      ? requestedStatus
      : "graded";
    const score = scoreRaw === "" || scoreRaw === null || scoreRaw === undefined ? null : Number(scoreRaw);
    if (!communityId || !submissionId) return res.status(400).json({ message: "Invalid request" });
    const role = String(await getCommunityRole(communityId, userId) || "").toLowerCase();
    if (role !== "owner") return res.status(403).json({ message: "Only community owner can grade assignments" });
    if (score !== null && !Number.isFinite(score)) return res.status(400).json({ message: "Invalid score" });

    let submission = null;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      [[submission]] = await connection.query(
        `
        SELECT
          s.id,
          s.user_id,
          s.assignment_id,
          s.graded_at,
          s.score,
          s.status,
          s.feedback,
          a.title AS assignment_title,
          a.points AS assignment_points,
          c.slug AS community_slug
        FROM vine_community_submissions s
        JOIN vine_community_assignments a ON a.id = s.assignment_id
        LEFT JOIN vine_communities c ON c.id = s.community_id
        WHERE s.id = ? AND s.community_id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [submissionId, communityId]
      );
      if (!submission) {
        await connection.rollback();
        return res.status(404).json({ message: "Submission not found" });
      }

      await connection.query(
        `
        UPDATE vine_community_submissions
        SET score = ?, feedback = ?, status = ?, graded_at = NOW(), graded_by = ?, updated_at = NOW()
        WHERE id = ? AND community_id = ?
        `,
        [score, feedback || null, status || "graded", userId, submissionId, communityId]
      );
      await connection.query(
        `
        INSERT INTO vine_community_grade_history
        (
          community_id, assignment_id, submission_id, learner_id, graded_by,
          previous_score, previous_status, previous_feedback,
          new_score, new_status, new_feedback, changed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          communityId,
          Number(submission.assignment_id),
          submissionId,
          Number(submission.user_id),
          userId,
          submission.score ?? null,
          submission.status || null,
          submission.feedback || null,
          score,
          status || "graded",
          feedback || null,
        ]
      );
      await connection.commit();
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    } finally {
      connection.release();
    }

    if (Number(submission.user_id) !== userId) {
      await notifyUser({
        userId: submission.user_id,
        actorId: userId,
        type: "community_assignment_graded",
        meta: {
          community_id: communityId,
          community_slug: submission.community_slug || null,
          assignment_id: Number(submission.assignment_id || 0),
          assignment_title: submission.assignment_title || null,
          assignment_points: submission.assignment_points ?? null,
          submission_id: submissionId,
          score: score,
          status: status || "graded",
        },
      });
    }
    clearVineReadCache(
      "community-assignments",
      "community-assignment-submissions",
      "community-gradebook",
      "community-progress",
      "profile-header"
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Grade submission error:", err);
    res.status(500).json({ message: "Failed to grade submission" });
  }
});

router.get("/communities/:id/gradebook", authenticate, async (req, res) => {
  try {
    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const userId = Number(req.user.id);
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json([]);
    const role = await getCommunityRole(communityId, userId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json([]);

    const cacheKey = buildVineCacheKey("community-gradebook", communityId, userId);
    const rows = await readThroughVineCache(cacheKey, vineCacheTtls.communityGradebook, async () => {
      const [gradebookRows] = await db.query(
        `
        SELECT
          a.id AS assignment_id,
          a.title AS assignment_title,
          a.points AS assignment_points,
          a.due_at AS assignment_due_at,
          u.id AS learner_id,
          u.username AS learner_username,
          u.display_name AS learner_display_name,
          s.id AS submission_id,
          s.status AS submission_status,
          s.score AS submission_score,
          s.submitted_at AS submitted_at,
          s.graded_at AS graded_at
        FROM vine_community_assignments a
        JOIN vine_community_members m ON m.community_id = a.community_id
        JOIN vine_users u ON u.id = m.user_id
        LEFT JOIN vine_community_submissions s
          ON s.assignment_id = a.id
         AND s.user_id = u.id
        WHERE a.community_id = ?
          AND LOWER(COALESCE(m.role, 'member')) != 'owner'
        ORDER BY a.created_at DESC, u.username ASC
        `,
        [communityId]
      );
      return gradebookRows;
    });

    if (String(req.query.format || "").toLowerCase() === "csv") {
      const csvHeader = [
        "assignment_id",
        "assignment_title",
        "assignment_points",
        "assignment_due_at",
        "learner_id",
        "learner_username",
        "learner_display_name",
        "submission_id",
        "submission_status",
        "submission_score",
        "submitted_at",
        "graded_at",
      ];
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [csvHeader.join(",")];
      for (const row of rows) {
        lines.push(
          [
            row.assignment_id,
            row.assignment_title,
            row.assignment_points,
            row.assignment_due_at ? new Date(row.assignment_due_at).toISOString() : "",
            row.learner_id,
            row.learner_username,
            row.learner_display_name,
            row.submission_id,
            row.submission_status,
            row.submission_score,
            row.submitted_at ? new Date(row.submitted_at).toISOString() : "",
            row.graded_at ? new Date(row.graded_at).toISOString() : "",
          ]
            .map(esc)
            .join(",")
        );
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="community-${communityId}-gradebook.csv"`);
      return res.status(200).send(lines.join("\n"));
    }

    res.json(rows);
  } catch (err) {
    console.error("Get gradebook error:", err);
    res.status(500).json([]);
  }
});

router.get("/communities/:id/progress", authenticate, async (req, res) => {
  try {
    const viewerId = Number(req.user.id);
    const communityId = Number(req.params.id);
    if (!communityId) return res.status(400).json([]);

    await ensureCommunitySchema();
    await ensureVinePerformanceSchema();
    const role = await getCommunityRole(communityId, viewerId);
    if (!isCommunityModOrOwner(role)) return res.status(403).json([]);

    const payload = await runVinePerfRoute(
      "community-progress",
      { community_id: communityId, viewer_id: viewerId },
      async (perfCtx) => {
        const cacheKey = buildVineCacheKey("community-progress", communityId, viewerId);
        return readThroughVineCache(cacheKey, vineCacheTtls.communityProgress, async () => {
          const [[assignmentTotals]] = await timedVineQuery(
            perfCtx,
            "community-progress.assignment-totals",
            `SELECT
               COUNT(*) AS total_assignments,
               SUM(CASE WHEN due_at IS NULL OR due_at <= NOW() THEN 1 ELSE 0 END) AS due_assignments
             FROM vine_community_assignments
             WHERE community_id = ?`,
            [communityId]
          );
          const totalAssignments = Number(assignmentTotals?.total_assignments || 0);
          const dueAssignments = Number(assignmentTotals?.due_assignments || 0);

          const [[sessionTotals]] = await timedVineQuery(
            perfCtx,
            "community-progress.session-totals",
            `SELECT COUNT(*) AS total_sessions
             FROM vine_community_sessions
             WHERE community_id = ?
               AND starts_at <= NOW()`,
            [communityId]
          );
          const totalSessions = Number(sessionTotals?.total_sessions || 0);

          const [rows] = await timedVineQuery(
            perfCtx,
            "community-progress.rows",
            `
            SELECT
              u.id AS learner_id,
              u.username AS learner_username,
              u.display_name AS learner_display_name,
              u.avatar_url AS learner_avatar_url,
              u.is_verified AS learner_is_verified,
              m.role AS community_role,
              COALESCE(subq.submission_count, 0) AS submission_count,
              COALESCE(subq.due_submission_count, 0) AS due_submission_count,
              COALESCE(subq.graded_count, 0) AS graded_count,
              COALESCE(subq.avg_score, NULL) AS avg_score,
              COALESCE(subq.avg_percent, NULL) AS avg_percent,
              subq.last_submitted_at,
              COALESCE(attq.present_count, 0) AS present_count
            FROM vine_community_members m
            JOIN vine_users u ON u.id = m.user_id
            LEFT JOIN (
              SELECT
                s.user_id,
                COUNT(DISTINCT s.assignment_id) AS submission_count,
                COUNT(DISTINCT CASE WHEN a.due_at IS NULL OR a.due_at <= NOW() THEN s.assignment_id END) AS due_submission_count,
                COUNT(CASE WHEN s.score IS NOT NULL THEN 1 END) AS graded_count,
                AVG(s.score) AS avg_score,
                AVG(
                  CASE
                    WHEN s.score IS NULL THEN NULL
                    WHEN a.points IS NOT NULL AND a.points > 0 AND a.points <= 10 THEN (s.score / a.points) * 100
                    WHEN s.score <= 3 THEN (s.score / 3) * 100
                    WHEN a.points IS NOT NULL AND a.points > 0 THEN (s.score / a.points) * 100
                    ELSE s.score
                  END
                ) AS avg_percent,
                MAX(s.submitted_at) AS last_submitted_at
              FROM vine_community_submissions s
              JOIN vine_community_assignments a ON a.id = s.assignment_id
              WHERE s.community_id = ?
              GROUP BY s.user_id
            ) subq ON subq.user_id = m.user_id
            LEFT JOIN (
              SELECT
                a.user_id,
                COUNT(*) AS present_count
              FROM vine_community_attendance a
              JOIN vine_community_sessions sess ON sess.id = a.session_id
              WHERE a.community_id = ?
                AND sess.starts_at <= NOW()
                AND a.status IN ('present', 'late')
              GROUP BY a.user_id
            ) attq ON attq.user_id = m.user_id
            WHERE m.community_id = ?
              AND LOWER(COALESCE(m.role, 'member')) != 'owner'
            ORDER BY m.role = 'owner' DESC, m.role = 'moderator' DESC, u.username ASC
            `,
            [communityId, communityId, communityId]
          );

          return rows.map((r) => {
            const submissionBase = dueAssignments;
            const submissionCount = Number(r.due_submission_count || 0);
            const submissionRate = submissionBase > 0
              ? Math.round((submissionCount / submissionBase) * 100)
              : 0;
            const attendanceRate = totalSessions > 0
              ? Math.round((Number(r.present_count || 0) / totalSessions) * 100)
              : 0;
            const avgScoreNum = r.avg_score === null || r.avg_score === undefined ? null : Number(r.avg_score);
            const avgPercentNum = r.avg_percent === null || r.avg_percent === undefined ? null : Math.max(0, Math.min(100, Number(r.avg_percent)));
            const hasAttendanceSignal = totalSessions > 0;
            const hasSubmissionSignal = submissionBase > 0;
            const hasGradeSignal = Number(r.graded_count || 0) > 0 && avgPercentNum !== null;
            const signalScores = [
              hasAttendanceSignal ? attendanceRate : null,
              hasSubmissionSignal ? submissionRate : null,
              hasGradeSignal ? avgPercentNum : null,
            ].filter((value) => value !== null);
            const progressScore = signalScores.length
              ? Math.round(signalScores.reduce((sum, value) => sum + value, 0) / signalScores.length)
              : null;
            const urgentSignals = [
              hasAttendanceSignal && attendanceRate < 50,
              hasSubmissionSignal && submissionRate < 50,
              hasGradeSignal && avgPercentNum < 50,
            ].filter(Boolean).length;
            const watchSignals = [
              hasAttendanceSignal && attendanceRate < 75,
              hasSubmissionSignal && submissionRate < 80,
              hasGradeSignal && avgPercentNum < 70,
            ].filter(Boolean).length;
            let riskFlag = "getting_started";
            if (!hasAttendanceSignal && !hasSubmissionSignal && !hasGradeSignal) {
              riskFlag = "getting_started";
            } else if (urgentSignals >= 2 || (progressScore !== null && progressScore < 50)) {
              riskFlag = "at_risk";
            } else if (urgentSignals >= 1 || watchSignals >= 1 || (progressScore !== null && progressScore < 76)) {
              riskFlag = "watch";
            } else {
              riskFlag = "on_track";
            }

            return {
              ...r,
              total_assignments: totalAssignments,
              due_assignments: dueAssignments,
              total_sessions: totalSessions,
              submission_rate: submissionRate,
              attendance_rate: attendanceRate,
              avg_score: avgScoreNum,
              avg_percent: avgPercentNum,
              progress_score: progressScore,
              risk_flag: riskFlag,
            };
          });
        });
      }
    );

    res.json(payload);
  } catch (err) {
    console.error("Get community progress error:", err);
    res.status(500).json([]);
  }
});

  return router;
}
