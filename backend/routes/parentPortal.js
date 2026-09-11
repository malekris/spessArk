import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import authAdmin from "../middleware/authAdmin.js";
import createParentAuth, { signParentSessionToken } from "../middleware/authParent.js";
import {
  ensureParentPortalSchemaReady,
  maskParentPhone,
  normalizeLearnerLevel,
  normalizeParentAudience,
  normalizeParentPhone,
  normalizeParentStatus,
} from "../services/parentPortalService.js";
import {
  deleteParentDocument,
  hashParentDocument,
  isParentDocumentStorageReady,
  readParentDocument,
  uploadParentDocument,
} from "../services/parentDocumentStorage.js";
import { extractClientIp, logAuditEvent } from "../utils/auditLogger.js";

const MAX_PARENT_DOCUMENT_BYTES = 12 * 1024 * 1024;
const INVALID_PASSWORD_HASH = bcrypt.hashSync("spess-parent-invalid-password", 10);
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const REPORT_KINDS_BY_LEVEL = {
  O_LEVEL: new Set(["END_OF_TERM", "END_OF_YEAR"]),
  A_LEVEL: new Set(["A_LEVEL_END_OF_TERM", "A_LEVEL_MID_PARENT"]),
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PARENT_DOCUMENT_BYTES, files: 1 },
});

const attemptBuckets = new Map();

function receiveParentPdf(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "PDF is larger than the 12 MB limit." });
    }
    console.error("Parent PDF upload error:", error);
    return res.status(400).json({ message: "The selected PDF could not be received." });
  });
}

function rateLimitParentAuth(req, res, next) {
  const key = `${extractClientIp(req)}:${normalizeParentPhone(req.body?.phone) || "unknown"}`;
  const now = Date.now();
  const current = attemptBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + LOGIN_WINDOW_MS }
    : current;

  bucket.count += 1;
  attemptBuckets.set(key, bucket);

  if (attemptBuckets.size > 1000) {
    for (const [bucketKey, candidate] of attemptBuckets) {
      if (candidate.resetAt <= now) attemptBuckets.delete(bucketKey);
    }
  }

  if (bucket.count > LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({
      code: "PARENT_AUTH_RATE_LIMITED",
      message: "Too many attempts. Please wait a few minutes before trying again.",
    });
  }

  return next();
}

function clearParentAuthAttempts(req) {
  const key = `${extractClientIp(req)}:${normalizeParentPhone(req.body?.phone) || "unknown"}`;
  attemptBuckets.delete(key);
}

const cleanText = (value, maxLength = 220) =>
  String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);

const cleanFilename = (value = "document.pdf") =>
  String(value || "document.pdf")
    .replace(/[\r\n"\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9_. -]+/g, "")
    .trim()
    .slice(0, 180) || "document.pdf";

const isPdfUpload = (file) =>
  Boolean(
    file?.buffer?.length > 4 &&
    String(file?.mimetype || "").toLowerCase() === "application/pdf" &&
    file.buffer.subarray(0, 5).toString("utf8") === "%PDF-"
  );

async function findLearner(connection, learnerLevel, learnerId) {
  const level = normalizeLearnerLevel(learnerLevel);
  const id = Number(learnerId);
  if (!level || !Number.isInteger(id) || id <= 0) return null;

  if (level === "O_LEVEL") {
    const [[row]] = await connection.query(
      `SELECT id, name AS learner_name, class_level, stream,
              COALESCE(NULLIF(status, ''), 'active') AS learner_status
       FROM students
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return row ? { ...row, learner_level: level } : null;
  }

  const [[row]] = await connection.query(
    `SELECT id,
            TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS learner_name,
            SUBSTRING_INDEX(stream, ' ', 1) AS class_level,
            TRIM(SUBSTRING(stream, LENGTH(SUBSTRING_INDEX(stream, ' ', 1)) + 1)) AS stream,
            COALESCE(NULLIF(status, ''), 'active') AS learner_status
     FROM alevel_learners
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  return row ? { ...row, learner_level: level } : null;
}

async function loadParentLinks(connection, parentIds) {
  if (!parentIds.length) return [];

  const [rows] = await connection.query(
    `SELECT l.id, l.parent_id, l.learner_level, l.learner_id,
            l.relationship_label, l.active, l.linked_at, l.revoked_at,
            CASE
              WHEN l.learner_level = 'O_LEVEL' THEN o.name
              ELSE TRIM(CONCAT(COALESCE(a.first_name, ''), ' ', COALESCE(a.last_name, '')))
            END AS learner_name,
            CASE
              WHEN l.learner_level = 'O_LEVEL' THEN o.class_level
              ELSE SUBSTRING_INDEX(a.stream, ' ', 1)
            END AS class_level,
            CASE
              WHEN l.learner_level = 'O_LEVEL' THEN o.stream
              ELSE TRIM(SUBSTRING(a.stream, LENGTH(SUBSTRING_INDEX(a.stream, ' ', 1)) + 1))
            END AS stream
     FROM spess_parent_learner_links l
     LEFT JOIN students o
       ON l.learner_level = 'O_LEVEL' AND o.id = l.learner_id
     LEFT JOIN alevel_learners a
       ON l.learner_level = 'A_LEVEL' AND a.id = l.learner_id
     WHERE l.parent_id IN (?)
     ORDER BY l.active DESC, learner_name ASC`,
    [parentIds]
  );

  return rows;
}

async function loadAccessibleDocuments(connection, parentId) {
  const [rows] = await connection.query(
    `SELECT d.id, d.document_type, d.title, d.description, d.academic_year,
            d.term, d.report_kind, d.learner_level, d.learner_id,
            d.learner_name_snapshot, d.class_snapshot, d.audience_scope,
            d.original_filename, d.mime_type, d.file_size, d.released_at,
            COALESCE(v.view_count, 0) AS view_count,
            v.last_viewed_at
     FROM spess_parent_documents d
     LEFT JOIN spess_parent_document_views v
       ON v.document_id = d.id AND v.parent_id = ?
     WHERE d.status = 'released'
       AND (
         (
           d.document_type = 'REPORT'
           AND EXISTS (
             SELECT 1
             FROM spess_parent_learner_links l
             WHERE l.parent_id = ?
               AND l.active = 1
               AND l.learner_level = d.learner_level
               AND l.learner_id = d.learner_id
           )
         )
         OR
         (
           d.document_type = 'CIRCULAR'
           AND (
             d.audience_scope = 'ALL_PARENTS'
             OR EXISTS (
               SELECT 1
               FROM spess_parent_learner_links l
               WHERE l.parent_id = ?
                 AND l.active = 1
                 AND l.learner_level = d.audience_scope
             )
           )
         )
       )
     ORDER BY d.released_at DESC, d.id DESC`,
    [parentId, parentId, parentId]
  );
  return rows;
}

async function canParentAccessDocument(connection, parentId, documentId) {
  const documents = await loadAccessibleDocuments(connection, parentId);
  return documents.find((document) => Number(document.id) === Number(documentId)) || null;
}

async function streamStoredPdf(res, document) {
  const stored = await readParentDocument(document.object_key);
  const filename = cleanFilename(document.original_filename);

  res.setHeader("Content-Type", document.mime_type || stored.ContentType || "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (stored.ContentLength) res.setHeader("Content-Length", String(stored.ContentLength));

  if (stored.Body && typeof stored.Body.pipe === "function") {
    stored.Body.on("error", (error) => {
      console.error("Parent PDF stream error:", error);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(error);
    });
    stored.Body.pipe(res);
    return;
  }

  const bytes = await stored.Body.transformToByteArray();
  res.end(Buffer.from(bytes));
}

export default function createParentPortalRoutes(connection) {
  const router = express.Router();
  const authParent = createParentAuth(connection);

  router.use(async (_req, _res, next) => {
    try {
      await ensureParentPortalSchemaReady(connection);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.post("/parents/register", rateLimitParentAuth, async (req, res) => {
    try {
      const displayName = cleanText(req.body?.displayName, 160);
      const phone = normalizeParentPhone(req.body?.phone);
      const password = String(req.body?.password || "");

      if (displayName.length < 3) {
        return res.status(400).json({ message: "Enter the parent or guardian's full name." });
      }
      if (!phone) {
        return res.status(400).json({ message: "Enter a valid Ugandan mobile number." });
      }
      if (password.length < 8 || password.length > 72) {
        return res.status(400).json({ message: "Password must contain between 8 and 72 characters." });
      }

      const [[existing]] = await connection.query(
        "SELECT id, status FROM spess_parent_accounts WHERE phone_e164 = ? LIMIT 1",
        [phone]
      );
      if (existing) {
        clearParentAuthAttempts(req);
        return res.status(202).json({
          status: "pending",
          message: "Registration received. School administration must approve and link the account before reports become available.",
        });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      await connection.query(
        `INSERT INTO spess_parent_accounts
          (display_name, phone_e164, password_hash, status)
         VALUES (?, ?, ?, 'pending')`,
        [displayName, phone, passwordHash]
      );

      clearParentAuthAttempts(req);
      await logAuditEvent({
        userRole: "admin",
        action: "PARENT_REGISTRATION_REQUESTED",
        entityType: "system",
        description: `SPESS Parents registration requested for ${maskParentPhone(phone)}`,
        ipAddress: extractClientIp(req),
      });

      return res.status(201).json({
        status: "pending",
        message: "Registration received. School administration must approve and link the account before reports become available.",
      });
    } catch (error) {
      console.error("Parent registration error:", error);
      return res.status(500).json({ message: "Parent registration could not be completed." });
    }
  });

  router.post("/parents/login", rateLimitParentAuth, async (req, res) => {
    try {
      const phone = normalizeParentPhone(req.body?.phone);
      const password = String(req.body?.password || "");
      if (!phone || !password) {
        return res.status(400).json({ message: "Phone number and password are required." });
      }

      const [[parent]] = await connection.query(
        `SELECT id, display_name, phone_e164, password_hash, status
         FROM spess_parent_accounts
         WHERE phone_e164 = ?
         LIMIT 1`,
        [phone]
      );
      const passwordMatches = await bcrypt.compare(password, parent?.password_hash || INVALID_PASSWORD_HASH);

      if (!parent || !passwordMatches) {
        return res.status(401).json({ message: "Invalid phone number or password." });
      }
      if (parent.status === "pending") {
        return res.status(403).json({
          code: "PARENT_APPROVAL_PENDING",
          message: "Registration is awaiting school approval and learner matching.",
        });
      }
      if (parent.status !== "active") {
        return res.status(403).json({
          code: "PARENT_ACCOUNT_INACTIVE",
          message: "This parent account is not currently active. Please contact the school office.",
        });
      }

      clearParentAuthAttempts(req);
      await connection.query("UPDATE spess_parent_accounts SET last_login_at = NOW() WHERE id = ?", [parent.id]);
      return res.json({
        token: signParentSessionToken(parent),
        parent: {
          id: parent.id,
          displayName: parent.display_name,
          phone: parent.phone_e164,
        },
      });
    } catch (error) {
      console.error("Parent login error:", error);
      return res.status(500).json({ message: "Parent sign-in failed." });
    }
  });

  router.get("/parents/me", authParent, async (req, res) => {
    try {
      const links = await loadParentLinks(connection, [Number(req.parent.id)]);
      const documents = await loadAccessibleDocuments(connection, Number(req.parent.id));
      return res.json({
        parent: {
          id: req.parent.id,
          displayName: req.parent.display_name,
          phone: req.parent.phone_e164,
          status: req.parent.status,
        },
        learners: links.filter((link) => Number(link.active) === 1),
        documents,
      });
    } catch (error) {
      console.error("Parent portal load error:", error);
      return res.status(500).json({ message: "Parent portal information could not be loaded." });
    }
  });

  router.post("/parents/change-password", authParent, async (req, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword || "");
      const nextPassword = String(req.body?.newPassword || "");
      if (nextPassword.length < 8 || nextPassword.length > 72) {
        return res.status(400).json({ message: "New password must contain between 8 and 72 characters." });
      }

      const [[account]] = await connection.query(
        "SELECT password_hash FROM spess_parent_accounts WHERE id = ? LIMIT 1",
        [req.parent.id]
      );
      if (!account || !(await bcrypt.compare(currentPassword, account.password_hash))) {
        return res.status(401).json({ message: "Current password is incorrect." });
      }

      const passwordHash = await bcrypt.hash(nextPassword, 12);
      await connection.query(
        "UPDATE spess_parent_accounts SET password_hash = ?, password_changed_at = NOW() WHERE id = ?",
        [passwordHash, req.parent.id]
      );
      return res.json({ message: "Password updated successfully." });
    } catch (error) {
      console.error("Parent password update error:", error);
      return res.status(500).json({ message: "Password could not be updated." });
    }
  });

  router.get("/parents/documents/:documentId/file", authParent, async (req, res) => {
    try {
      const document = await canParentAccessDocument(connection, req.parent.id, req.params.documentId);
      if (!document) return res.status(404).json({ message: "Document not found or not released to this account." });

      const [[stored]] = await connection.query(
        "SELECT object_key, original_filename, mime_type FROM spess_parent_documents WHERE id = ? LIMIT 1",
        [document.id]
      );
      await connection.query(
        `INSERT INTO spess_parent_document_views
          (document_id, parent_id, first_viewed_at, last_viewed_at, view_count)
         VALUES (?, ?, NOW(), NOW(), 1)
         ON DUPLICATE KEY UPDATE last_viewed_at = NOW(), view_count = view_count + 1`,
        [document.id, req.parent.id]
      );
      return streamStoredPdf(res, stored);
    } catch (error) {
      console.error("Parent document open error:", error);
      if (!res.headersSent) return res.status(500).json({ message: "Document could not be opened." });
    }
  });

  router.get("/admin/parents/overview", authAdmin, async (_req, res) => {
    try {
      const [accounts] = await connection.query(
        `SELECT id, display_name, phone_e164, status, approved_at, last_login_at, created_at, updated_at
         FROM spess_parent_accounts
         ORDER BY FIELD(status, 'pending', 'active', 'suspended', 'rejected'), created_at DESC`
      );
      const links = await loadParentLinks(connection, accounts.map((account) => Number(account.id)));
      const linksByParent = new Map();
      links.forEach((link) => {
        const key = Number(link.parent_id);
        if (!linksByParent.has(key)) linksByParent.set(key, []);
        linksByParent.get(key).push(link);
      });

      const [[documentCounts]] = await connection.query(
        `SELECT
           SUM(status = 'released' AND document_type = 'REPORT') AS released_reports,
           SUM(status = 'released' AND document_type = 'CIRCULAR') AS released_circulars,
           SUM(status = 'revoked') AS revoked_documents
         FROM spess_parent_documents`
      );

      return res.json({
        storageReady: isParentDocumentStorageReady(),
        counts: {
          total: accounts.length,
          pending: accounts.filter((account) => account.status === "pending").length,
          active: accounts.filter((account) => account.status === "active").length,
          suspended: accounts.filter((account) => account.status === "suspended").length,
          releasedReports: Number(documentCounts?.released_reports || 0),
          releasedCirculars: Number(documentCounts?.released_circulars || 0),
          revokedDocuments: Number(documentCounts?.revoked_documents || 0),
        },
        accounts: accounts.map((account) => ({
          ...account,
          links: linksByParent.get(Number(account.id)) || [],
        })),
      });
    } catch (error) {
      console.error("Admin parent overview error:", error);
      return res.status(500).json({ message: "SPESS Parents overview could not be loaded." });
    }
  });

  router.patch("/admin/parents/accounts/:parentId/status", authAdmin, async (req, res) => {
    try {
      const parentId = Number(req.params.parentId);
      const status = normalizeParentStatus(req.body?.status);
      if (!Number.isInteger(parentId) || parentId <= 0) return res.status(400).json({ message: "Invalid parent account." });

      const statusFields = {
        pending: "approved_by = NULL, approved_at = NULL, suspended_at = NULL, rejected_at = NULL",
        active: "approved_by = ?, approved_at = NOW(), suspended_at = NULL, rejected_at = NULL",
        suspended: "suspended_at = NOW()",
        rejected: "rejected_at = NOW()",
      };
      const params = status === "active" ? [status, Number(req.admin?.id) || 1, parentId] : [status, parentId];
      const [result] = await connection.query(
        `UPDATE spess_parent_accounts
         SET status = ?, ${statusFields[status]}
         WHERE id = ?`,
        params
      );
      if (!result.affectedRows) return res.status(404).json({ message: "Parent account not found." });

      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        userRole: "admin",
        action: `PARENT_ACCOUNT_${status.toUpperCase()}`,
        entityType: "system",
        entityId: parentId,
        description: `SPESS Parents account ${parentId} changed to ${status}`,
        ipAddress: extractClientIp(req),
      });
      return res.json({ message: `Parent account is now ${status}.` });
    } catch (error) {
      console.error("Admin parent status error:", error);
      return res.status(500).json({ message: "Parent account status could not be updated." });
    }
  });

  router.post("/admin/parents/accounts/:parentId/reset-password", authAdmin, async (req, res) => {
    try {
      const parentId = Number(req.params.parentId);
      const temporaryPassword = String(req.body?.temporaryPassword || "");
      if (temporaryPassword.length < 8 || temporaryPassword.length > 72) {
        return res.status(400).json({ message: "Temporary password must contain between 8 and 72 characters." });
      }
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);
      const [result] = await connection.query(
        "UPDATE spess_parent_accounts SET password_hash = ?, password_changed_at = NULL WHERE id = ?",
        [passwordHash, parentId]
      );
      if (!result.affectedRows) return res.status(404).json({ message: "Parent account not found." });

      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "PARENT_PASSWORD_RESET",
        entityType: "system",
        entityId: parentId,
        description: `Admin issued a temporary SPESS Parents password for account ${parentId}`,
        ipAddress: extractClientIp(req),
      });
      return res.json({ message: "Temporary password saved. Share it privately with the parent." });
    } catch (error) {
      console.error("Admin parent password reset error:", error);
      return res.status(500).json({ message: "Temporary password could not be saved." });
    }
  });

  router.get("/admin/parents/learners", authAdmin, async (req, res) => {
    try {
      const query = cleanText(req.query?.query, 100).toLowerCase();
      const requestedLevel = normalizeLearnerLevel(req.query?.level);
      const classLevel = cleanText(req.query?.classLevel, 20).toUpperCase();
      const stream = cleanText(req.query?.stream, 40);
      const like = `%${query}%`;
      const rows = [];

      if (!requestedLevel || requestedLevel === "O_LEVEL") {
        const [oLevel] = await connection.query(
          `SELECT id, 'O_LEVEL' AS learner_level, name AS learner_name, class_level, stream,
                  COALESCE(NULLIF(status, ''), 'active') AS learner_status
           FROM students
           WHERE (? = '' OR LOWER(CONCAT(name, ' ', class_level, ' ', stream)) LIKE ?)
             AND COALESCE(NULLIF(status, ''), 'active') = 'active'
             AND (? = '' OR UPPER(class_level) = ?)
             AND (? = '' OR LOWER(TRIM(stream)) = LOWER(TRIM(?)))
           ORDER BY class_level, stream, name
           LIMIT 300`,
          [query, like, classLevel, classLevel, stream, stream]
        );
        rows.push(...oLevel);
      }

      if (!requestedLevel || requestedLevel === "A_LEVEL") {
        const [aLevel] = await connection.query(
          `SELECT id, 'A_LEVEL' AS learner_level,
                  TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS learner_name,
                  SUBSTRING_INDEX(stream, ' ', 1) AS class_level,
                  TRIM(SUBSTRING(stream, LENGTH(SUBSTRING_INDEX(stream, ' ', 1)) + 1)) AS stream,
                  COALESCE(NULLIF(status, ''), 'active') AS learner_status
           FROM alevel_learners
           WHERE (? = '' OR LOWER(CONCAT(first_name, ' ', last_name, ' ', stream)) LIKE ?)
             AND COALESCE(NULLIF(status, ''), 'active') = 'active'
             AND (? = '' OR UPPER(SUBSTRING_INDEX(stream, ' ', 1)) = ?)
             AND (
               ? = ''
               OR LOWER(TRIM(SUBSTRING(stream, LENGTH(SUBSTRING_INDEX(stream, ' ', 1)) + 1))) = LOWER(TRIM(?))
             )
           ORDER BY stream, first_name, last_name
           LIMIT 300`,
          [query, like, classLevel, classLevel, stream, stream]
        );
        rows.push(...aLevel);
      }

      return res.json(rows);
    } catch (error) {
      console.error("Admin parent learner search error:", error);
      return res.status(500).json({ message: "Learners could not be loaded for parent matching." });
    }
  });

  router.get("/admin/parents/release-candidates", authAdmin, async (req, res) => {
    try {
      const learnerLevel = normalizeLearnerLevel(req.query?.level);
      const classLevel = cleanText(req.query?.classLevel, 20).toUpperCase();
      const stream = cleanText(req.query?.stream, 40);
      const academicYear = Number(req.query?.academicYear);
      const term = cleanText(req.query?.term, 30);

      if (!learnerLevel || !classLevel || !stream) {
        return res.status(400).json({
          message: "Level, class and stream are required before checking linked reports.",
        });
      }
      if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2200) {
        return res.status(400).json({ message: "Academic year is invalid." });
      }
      if (!/^Term [123]$/.test(term)) {
        return res.status(400).json({ message: "Choose a valid school term." });
      }

      const reportKind = learnerLevel === "A_LEVEL" ? "A_LEVEL_END_OF_TERM" : "END_OF_TERM";
      let rows;

      // Candidate selection is deliberately anchored to active parent accounts,
      // active links and active learners. One learner is returned once even when
      // two approved parents are linked to the same child.
      if (learnerLevel === "O_LEVEL") {
        [rows] = await connection.query(
          `SELECT
             s.id,
             'O_LEVEL' AS learner_level,
             s.name AS learner_name,
             s.class_level,
             s.stream,
             COUNT(DISTINCT p.id) AS recipient_count,
             MAX(d.id) AS released_document_id,
             MAX(d.released_at) AS released_at
           FROM spess_parent_learner_links l
           JOIN spess_parent_accounts p
             ON p.id = l.parent_id AND p.status = 'active'
           JOIN students s
             ON s.id = l.learner_id
            AND COALESCE(NULLIF(s.status, ''), 'active') = 'active'
           LEFT JOIN spess_parent_documents d
             ON d.document_type = 'REPORT'
            AND d.learner_level = 'O_LEVEL'
            AND d.learner_id = s.id
            AND d.academic_year = ?
            AND d.term = ?
            AND d.report_kind = ?
            AND d.status = 'released'
           WHERE l.learner_level = 'O_LEVEL'
             AND l.active = 1
             AND UPPER(s.class_level) = ?
             AND LOWER(TRIM(s.stream)) = LOWER(TRIM(?))
           GROUP BY s.id, s.name, s.class_level, s.stream
           ORDER BY s.name ASC`,
          [academicYear, term, reportKind, classLevel, stream]
        );
      } else {
        const fullStream = `${classLevel} ${stream}`.trim();
        [rows] = await connection.query(
          `SELECT
             a.id,
             'A_LEVEL' AS learner_level,
             TRIM(CONCAT(COALESCE(a.first_name, ''), ' ', COALESCE(a.last_name, ''))) AS learner_name,
             SUBSTRING_INDEX(a.stream, ' ', 1) AS class_level,
             TRIM(SUBSTRING(a.stream, LENGTH(SUBSTRING_INDEX(a.stream, ' ', 1)) + 1)) AS stream,
             COUNT(DISTINCT p.id) AS recipient_count,
             MAX(d.id) AS released_document_id,
             MAX(d.released_at) AS released_at
           FROM spess_parent_learner_links l
           JOIN spess_parent_accounts p
             ON p.id = l.parent_id AND p.status = 'active'
           JOIN alevel_learners a
             ON a.id = l.learner_id
            AND COALESCE(NULLIF(a.status, ''), 'active') = 'active'
           LEFT JOIN spess_parent_documents d
             ON d.document_type = 'REPORT'
            AND d.learner_level = 'A_LEVEL'
            AND d.learner_id = a.id
            AND d.academic_year = ?
            AND d.term = ?
            AND d.report_kind = ?
            AND d.status = 'released'
           WHERE l.learner_level = 'A_LEVEL'
             AND l.active = 1
             AND LOWER(TRIM(a.stream)) = LOWER(TRIM(?))
           GROUP BY a.id, a.first_name, a.last_name, a.stream
           ORDER BY a.first_name ASC, a.last_name ASC`,
          [academicYear, term, reportKind, fullStream]
        );
      }

      return res.json({
        selection: {
          learnerLevel,
          classLevel,
          stream,
          academicYear,
          term,
          reportKind,
        },
        candidates: (rows || []).map((row) => ({
          ...row,
          recipient_count: Number(row.recipient_count || 0),
          already_released: Boolean(row.released_document_id),
        })),
      });
    } catch (error) {
      console.error("Admin parent release candidate error:", error);
      return res.status(500).json({
        message: "Linked learners could not be checked for report release.",
      });
    }
  });

  router.post("/admin/parents/accounts/:parentId/links", authAdmin, async (req, res) => {
    try {
      const parentId = Number(req.params.parentId);
      const learnerLevel = normalizeLearnerLevel(req.body?.learnerLevel);
      const learnerId = Number(req.body?.learnerId);
      const relationship = cleanText(req.body?.relationship || "Parent / Guardian", 60);
      const learner = await findLearner(connection, learnerLevel, learnerId);
      if (!learner) return res.status(404).json({ message: "Learner not found." });

      const [[parent]] = await connection.query("SELECT id FROM spess_parent_accounts WHERE id = ? LIMIT 1", [parentId]);
      if (!parent) return res.status(404).json({ message: "Parent account not found." });

      await connection.query(
        `INSERT INTO spess_parent_learner_links
          (parent_id, learner_level, learner_id, relationship_label, active, linked_by, linked_at, revoked_by, revoked_at)
         VALUES (?, ?, ?, ?, 1, ?, NOW(), NULL, NULL)
         ON DUPLICATE KEY UPDATE
           relationship_label = VALUES(relationship_label), active = 1,
           linked_by = VALUES(linked_by), linked_at = NOW(), revoked_by = NULL, revoked_at = NULL`,
        [parentId, learnerLevel, learnerId, relationship, Number(req.admin?.id) || 1]
      );

      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "PARENT_LEARNER_LINKED",
        entityType: "system",
        entityId: parentId,
        description: `${learner.learner_name} (${learnerLevel}) linked to SPESS Parents account ${parentId}`,
        ipAddress: extractClientIp(req),
      });
      return res.status(201).json({ message: `${learner.learner_name} has been linked to this parent account.` });
    } catch (error) {
      console.error("Admin parent link error:", error);
      return res.status(500).json({ message: "Learner could not be linked to the parent account." });
    }
  });

  router.delete("/admin/parents/links/:linkId", authAdmin, async (req, res) => {
    try {
      const linkId = Number(req.params.linkId);
      const [result] = await connection.query(
        `UPDATE spess_parent_learner_links
         SET active = 0, revoked_by = ?, revoked_at = NOW()
         WHERE id = ? AND active = 1`,
        [Number(req.admin?.id) || 1, linkId]
      );
      if (!result.affectedRows) return res.status(404).json({ message: "Active learner link not found." });
      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "PARENT_LEARNER_UNLINKED",
        entityType: "system",
        entityId: linkId,
        description: `SPESS Parents learner link ${linkId} was revoked`,
        ipAddress: extractClientIp(req),
      });
      return res.json({ message: "Learner access has been removed from the parent account." });
    } catch (error) {
      console.error("Admin parent unlink error:", error);
      return res.status(500).json({ message: "Learner link could not be removed." });
    }
  });

  router.get("/admin/parents/documents", authAdmin, async (_req, res) => {
    try {
      const [documents] = await connection.query(
        `SELECT id, document_type, title, description, academic_year, term, report_kind,
                learner_level, learner_id, learner_name_snapshot, class_snapshot,
                audience_scope, original_filename, mime_type, file_size, status,
                released_at, revoked_at
         FROM spess_parent_documents
         ORDER BY released_at DESC, id DESC
         LIMIT 500`
      );
      return res.json(documents);
    } catch (error) {
      console.error("Admin parent documents error:", error);
      return res.status(500).json({ message: "Released parent documents could not be loaded." });
    }
  });

  router.post("/admin/parents/documents", authAdmin, receiveParentPdf, async (req, res) => {
    try {
      if (!isParentDocumentStorageReady()) {
        return res.status(503).json({ message: "Private Cloudflare R2 document storage is not configured." });
      }
      if (!isPdfUpload(req.file)) {
        return res.status(400).json({ message: "Choose a valid PDF file no larger than 12 MB." });
      }

      const documentType = String(req.body?.documentType || "").trim().toUpperCase();
      const title = cleanText(req.body?.title, 220);
      const description = cleanText(req.body?.description, 1600);
      const academicYear = Number(req.body?.academicYear);
      const term = cleanText(req.body?.term, 30);
      const reportKind = cleanText(req.body?.reportKind, 60).toUpperCase();
      const audienceScope = normalizeParentAudience(req.body?.audienceScope);
      let learner = null;

      if (!["REPORT", "CIRCULAR"].includes(documentType)) {
        return res.status(400).json({ message: "Document type must be Report or Circular." });
      }
      if (!title) return res.status(400).json({ message: "Document title is required." });
      if (academicYear && (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2200)) {
        return res.status(400).json({ message: "Academic year is invalid." });
      }

      if (documentType === "REPORT") {
        learner = await findLearner(connection, req.body?.learnerLevel, req.body?.learnerId);
        if (!learner) return res.status(404).json({ message: "Choose the learner whose report is being released." });
        if (String(learner.learner_status || "active").toLowerCase() !== "active") {
          return res.status(409).json({
            message: `${learner.learner_name} is not active and cannot receive a new report release.`,
          });
        }
        const [[activeRecipient]] = await connection.query(
          `SELECT l.id
           FROM spess_parent_learner_links l
           JOIN spess_parent_accounts p
             ON p.id = l.parent_id AND p.status = 'active'
           WHERE l.learner_level = ?
             AND l.learner_id = ?
             AND l.active = 1
           LIMIT 1`,
          [learner.learner_level, learner.id]
        );
        if (!activeRecipient) {
          return res.status(409).json({
            message: `${learner.learner_name} is no longer linked to an approved parent account.`,
          });
        }
        if (!academicYear || !/^Term [123]$/.test(term)) {
          return res.status(400).json({ message: "A valid academic year and term are required for a report release." });
        }
        if (!REPORT_KINDS_BY_LEVEL[learner.learner_level]?.has(reportKind)) {
          return res.status(400).json({ message: "The selected report type does not match this learner's level." });
        }
      }

      const originalFilename = cleanFilename(req.file.originalname);
      const uploadResult = await uploadParentDocument(req.file.buffer, {
        documentType,
        academicYear: academicYear || "general",
        filename: originalFilename,
        contentType: "application/pdf",
      });
      const sha256Hex = hashParentDocument(req.file.buffer);

      let dbConnection;
      try {
        dbConnection = await connection.getConnection();
        await dbConnection.beginTransaction();

        if (documentType === "REPORT") {
          await dbConnection.query(
            `UPDATE spess_parent_documents
             SET status = 'revoked', revoked_by = ?, revoked_at = NOW()
             WHERE document_type = 'REPORT'
               AND learner_level = ? AND learner_id = ?
               AND academic_year <=> ? AND term = ? AND report_kind = ?
               AND status = 'released'`,
            [
              Number(req.admin?.id) || 1,
              learner.learner_level,
              learner.id,
              academicYear || null,
              term,
              reportKind,
            ]
          );
        }

        const [insert] = await dbConnection.query(
          `INSERT INTO spess_parent_documents
            (document_type, title, description, academic_year, term, report_kind,
             learner_level, learner_id, learner_name_snapshot, class_snapshot,
             audience_scope, object_key, original_filename, mime_type, file_size,
             sha256_hex, status, released_by, released_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, 'released', ?, NOW())`,
          [
            documentType,
            title,
            description || null,
            academicYear || null,
            term || null,
            reportKind || null,
            learner?.learner_level || null,
            learner?.id || null,
            learner?.learner_name || null,
            learner ? `${learner.class_level} ${learner.stream}`.trim() : null,
            documentType === "REPORT" ? learner.learner_level : audienceScope,
            uploadResult.objectKey,
            originalFilename,
            req.file.size,
            sha256Hex,
            Number(req.admin?.id) || 1,
          ]
        );
        await dbConnection.commit();

        await logAuditEvent({
          userId: Number(req.admin?.id) || 1,
          action: documentType === "REPORT" ? "PARENT_REPORT_RELEASED" : "PARENT_CIRCULAR_RELEASED",
          entityType: "system",
          entityId: Number(insert.insertId),
          description: `${title} released through SPESS Parents${learner ? ` for ${learner.learner_name}` : ""}`,
          ipAddress: extractClientIp(req),
        });
        return res.status(201).json({ id: insert.insertId, message: `${title} has been released.` });
      } catch (error) {
        if (dbConnection) await dbConnection.rollback().catch(() => {});
        await deleteParentDocument(uploadResult.objectKey).catch((cleanupError) => {
          console.error("Parent document orphan cleanup failed:", cleanupError);
        });
        throw error;
      } finally {
        dbConnection?.release();
      }
    } catch (error) {
      console.error("Admin parent document release error:", error);
      const status = error?.code === "LIMIT_FILE_SIZE" ? 413 : 500;
      return res.status(status).json({
        message: status === 413 ? "PDF is larger than the 12 MB limit." : "Document could not be released.",
      });
    }
  });

  router.patch("/admin/parents/documents/:documentId/revoke", authAdmin, async (req, res) => {
    try {
      const documentId = Number(req.params.documentId);
      const [result] = await connection.query(
        `UPDATE spess_parent_documents
         SET status = 'revoked', revoked_by = ?, revoked_at = NOW()
         WHERE id = ? AND status = 'released'`,
        [Number(req.admin?.id) || 1, documentId]
      );
      if (!result.affectedRows) return res.status(404).json({ message: "Released document not found." });
      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: "PARENT_DOCUMENT_REVOKED",
        entityType: "system",
        entityId: documentId,
        description: `SPESS Parents document ${documentId} was revoked`,
        ipAddress: extractClientIp(req),
      });
      return res.json({ message: "Document access has been revoked." });
    } catch (error) {
      console.error("Admin parent document revoke error:", error);
      return res.status(500).json({ message: "Document could not be revoked." });
    }
  });

  router.get("/admin/parents/documents/:documentId/file", authAdmin, async (req, res) => {
    try {
      const [[document]] = await connection.query(
        "SELECT object_key, original_filename, mime_type FROM spess_parent_documents WHERE id = ? LIMIT 1",
        [req.params.documentId]
      );
      if (!document) return res.status(404).json({ message: "Document not found." });
      return streamStoredPdf(res, document);
    } catch (error) {
      console.error("Admin parent document open error:", error);
      if (!res.headersSent) return res.status(500).json({ message: "Document could not be opened." });
    }
  });

  return router;
}
