import express from "express";
import multer from "multer";
import authAdmin from "../middleware/authAdmin.js";
import {
  buildArchiveReadiness,
  ensureReportArchiveSchemaReady,
  normalizeArchiveClassLevel,
  normalizeArchiveKind,
  normalizeArchivePeriod,
  normalizeArchiveStream,
  normalizeArchiveYear,
} from "../services/reportArchiveService.js";
import {
  deleteReportArchive,
  hashReportArchive,
  isReportArchiveStorageReady,
  readReportArchive,
  uploadReportArchive,
} from "../services/reportArchiveStorage.js";
import { extractClientIp, logAuditEvent } from "../utils/auditLogger.js";

const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ARCHIVE_BYTES, files: 1 },
});

const cleanFilename = (value = "report.pdf") =>
  String(value || "report.pdf")
    .replace(/[\r\n"\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9_. -]+/g, "")
    .trim()
    .slice(0, 200) || "report.pdf";

const isPdfUpload = (file) =>
  Boolean(
    file?.buffer?.length > 4 &&
      String(file?.mimetype || "").toLowerCase() === "application/pdf" &&
      file.buffer.subarray(0, 5).toString("utf8") === "%PDF-"
  );

const receiveArchivePdf = (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "The report PDF is larger than 30 MB." });
    }
    console.error("Forever Library PDF upload error:", error);
    return res.status(400).json({ message: "The report PDF could not be received." });
  });
};

const toArchiveDto = (row) => ({
  id: Number(row.id),
  academicYear: Number(row.academic_year),
  learnerLevel: row.learner_level,
  classLevel: row.class_level,
  stream: row.stream,
  reportPeriod: row.report_period,
  reportKind: row.report_kind,
  version: Number(row.version),
  originalFilename: row.original_filename,
  fileSize: Number(row.file_size || 0),
  checksum: row.sha256_hex,
  learnerCount: Number(row.learner_count || 0),
  status: row.status,
  generatedBy: row.generated_by === null ? null : Number(row.generated_by),
  generatedAt: row.generated_at,
  supersededAt: row.superseded_at,
});

async function streamArchivePdf(res, row, disposition = "inline") {
  const stored = await readReportArchive(row.object_key);
  const filename = cleanFilename(row.original_filename);
  const mode = disposition === "attachment" ? "attachment" : "inline";

  res.setHeader("Content-Type", row.mime_type || stored.ContentType || "application/pdf");
  res.setHeader("Content-Disposition", `${mode}; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (stored.ContentLength) res.setHeader("Content-Length", String(stored.ContentLength));

  if (stored.Body && typeof stored.Body.pipe === "function") {
    stored.Body.on("error", (error) => {
      console.error("Forever Library PDF stream error:", error);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(error);
    });
    stored.Body.pipe(res);
    return;
  }

  const bytes = await stored.Body.transformToByteArray();
  res.end(Buffer.from(bytes));
}

export default function createAdminReportArchiveRoutes(connection) {
  const router = express.Router();

  router.use(authAdmin);
  router.use(async (_req, _res, next) => {
    try {
      await ensureReportArchiveSchemaReady(connection);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get("/report-archives", async (req, res) => {
    try {
      const filters = ["learner_level = 'O_LEVEL'"];
      const params = [];
      const academicYear = req.query.year ? normalizeArchiveYear(req.query.year) : null;
      const classLevel = req.query.classLevel
        ? normalizeArchiveClassLevel(req.query.classLevel)
        : "";
      const stream = req.query.stream ? normalizeArchiveStream(req.query.stream) : "";
      const includeHistory = String(req.query.includeHistory || "").toLowerCase() === "true";

      if (req.query.year && !academicYear) {
        return res.status(400).json({ message: "Academic year is invalid." });
      }
      if (req.query.classLevel && !classLevel) {
        return res.status(400).json({ message: "Class level is invalid." });
      }
      if (academicYear) {
        filters.push("academic_year = ?");
        params.push(academicYear);
      }
      if (classLevel) {
        filters.push("class_level = ?");
        params.push(classLevel);
      }
      if (stream) {
        filters.push("stream = ?");
        params.push(stream);
      }
      if (!includeHistory) filters.push("status = 'ACTIVE'");

      const [rows] = await connection.query(
        `SELECT *
         FROM admin_report_archives
         WHERE ${filters.join(" AND ")}
         ORDER BY academic_year DESC,
                  FIELD(class_level, 'S1', 'S2', 'S3', 'S4'),
                  stream,
                  FIELD(report_period, 'TERM_1', 'TERM_2', 'END_OF_YEAR'),
                  version DESC`,
        params
      );
      const [yearRows] = await connection.query(
        `SELECT DISTINCT academic_year
         FROM admin_report_archives
         WHERE learner_level = 'O_LEVEL'
         ORDER BY academic_year DESC`
      );

      return res.json({
        storageReady: isReportArchiveStorageReady(),
        years: yearRows.map((row) => Number(row.academic_year)),
        archives: rows.map(toArchiveDto),
      });
    } catch (error) {
      console.error("Forever Library list error:", error);
      return res.status(500).json({ message: "Forever Library could not be loaded." });
    }
  });

  router.get("/report-archives/readiness", async (req, res) => {
    try {
      const academicYear = normalizeArchiveYear(req.query.year);
      const classLevel = normalizeArchiveClassLevel(req.query.classLevel);
      const stream = normalizeArchiveStream(req.query.stream);
      if (!academicYear || !classLevel || !stream) {
        return res.status(400).json({ message: "Year, class level and stream are required." });
      }

      const [rows] = await connection.query(
        `SELECT report_period, status
         FROM admin_report_archives
         WHERE academic_year = ?
           AND learner_level = 'O_LEVEL'
           AND class_level = ?
           AND stream = ?`,
        [academicYear, classLevel, stream]
      );
      return res.json({
        academicYear,
        classLevel,
        stream,
        storageReady: isReportArchiveStorageReady(),
        ...buildArchiveReadiness(rows),
      });
    } catch (error) {
      console.error("Forever Library readiness error:", error);
      return res.status(500).json({ message: "Archive readiness could not be checked." });
    }
  });

  router.post("/report-archives", receiveArchivePdf, async (req, res) => {
    let uploadedObjectKey = "";
    try {
      if (!isReportArchiveStorageReady()) {
        return res.status(503).json({
          message: "Private Cloudflare R2 storage is not configured for Forever Library.",
        });
      }
      if (!isPdfUpload(req.file)) {
        return res.status(400).json({ message: "Choose a valid PDF file no larger than 30 MB." });
      }

      const academicYear = normalizeArchiveYear(req.body?.academicYear);
      const classLevel = normalizeArchiveClassLevel(req.body?.classLevel);
      const stream = normalizeArchiveStream(req.body?.stream);
      const reportPeriod = normalizeArchivePeriod(req.body?.reportPeriod);
      const reportKind = normalizeArchiveKind(req.body?.reportKind);
      const learnerCount = Math.max(0, Math.min(5000, Number(req.body?.learnerCount) || 0));
      const forceRevision = String(req.body?.forceRevision || "").toLowerCase() === "true";

      if (!academicYear || !classLevel || !stream || !reportPeriod || !reportKind) {
        return res.status(400).json({ message: "Complete archive metadata is required." });
      }
      if (
        (reportPeriod === "END_OF_YEAR" && reportKind !== "END_OF_YEAR") ||
        (reportPeriod !== "END_OF_YEAR" && reportKind !== "END_OF_TERM")
      ) {
        return res.status(400).json({ message: "Report period and report type do not match." });
      }

      const checksum = hashReportArchive(req.file.buffer);
      const [[latest]] = await connection.query(
        `SELECT *
         FROM admin_report_archives
         WHERE academic_year = ?
           AND learner_level = 'O_LEVEL'
           AND class_level = ?
           AND stream = ?
           AND report_period = ?
           AND status = 'ACTIVE'
         ORDER BY version DESC
         LIMIT 1`,
        [academicYear, classLevel, stream, reportPeriod]
      );

      if (latest && latest.sha256_hex === checksum) {
        return res.status(200).json({
          duplicate: true,
          message: "This exact report is already preserved in Forever Library.",
          archive: toArchiveDto(latest),
        });
      }
      if (latest && !forceRevision) {
        return res.status(409).json({
          code: "ARCHIVE_REVISION_REQUIRED",
          message: "An archive already exists for this period. Create a revised version instead.",
          archive: toArchiveDto(latest),
        });
      }

      const filename = cleanFilename(req.file.originalname);
      const uploaded = await uploadReportArchive(req.file.buffer, {
        academicYear,
        classLevel,
        stream,
        reportPeriod,
        filename,
      });
      uploadedObjectKey = uploaded.objectKey;

      const db = await connection.getConnection();
      let insertedId;
      try {
        await db.beginTransaction();
        const [[versionRow]] = await db.query(
          `SELECT version
           FROM admin_report_archives
           WHERE academic_year = ?
             AND learner_level = 'O_LEVEL'
             AND class_level = ?
             AND stream = ?
             AND report_period = ?
           ORDER BY version DESC
           LIMIT 1
           FOR UPDATE`,
          [academicYear, classLevel, stream, reportPeriod]
        );
        const version = Number(versionRow?.version || 0) + 1;

        if (latest) {
          await db.query(
            `UPDATE admin_report_archives
             SET status = 'SUPERSEDED', superseded_at = NOW()
             WHERE academic_year = ?
               AND learner_level = 'O_LEVEL'
               AND class_level = ?
               AND stream = ?
               AND report_period = ?
               AND status = 'ACTIVE'`,
            [academicYear, classLevel, stream, reportPeriod]
          );
        }

        const [insert] = await db.query(
          `INSERT INTO admin_report_archives
            (academic_year, learner_level, class_level, stream, report_period,
             report_kind, version, object_key, original_filename, mime_type,
             file_size, sha256_hex, learner_count, status, generated_by)
           VALUES (?, 'O_LEVEL', ?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, 'ACTIVE', ?)`,
          [
            academicYear,
            classLevel,
            stream,
            reportPeriod,
            reportKind,
            version,
            uploaded.objectKey,
            filename,
            req.file.size,
            checksum,
            learnerCount,
            Number(req.admin?.id) || 1,
          ]
        );
        insertedId = Number(insert.insertId);
        await db.commit();
      } catch (error) {
        await db.rollback().catch(() => {});
        throw error;
      } finally {
        db.release();
      }
      // From this point the manifest owns the object. Later response or audit
      // failures must never delete a successfully committed archive file.
      uploadedObjectKey = "";

      const [[created]] = await connection.query(
        "SELECT * FROM admin_report_archives WHERE id = ? LIMIT 1",
        [insertedId]
      );
      await logAuditEvent({
        userId: Number(req.admin?.id) || 1,
        action: latest ? "REPORT_ARCHIVE_REVISED" : "REPORT_ARCHIVE_CREATED",
        entityType: "system",
        entityId: insertedId,
        description: `${academicYear} ${classLevel} ${stream} ${reportPeriod} report archived as version ${created.version}`,
        ipAddress: extractClientIp(req),
      });

      return res.status(201).json({
        message: latest
          ? "A revised report version has been preserved."
          : "Report preserved in Forever Library.",
        archive: toArchiveDto(created),
      });
    } catch (error) {
      if (uploadedObjectKey) {
        await deleteReportArchive(uploadedObjectKey).catch((cleanupError) => {
          console.error("Forever Library orphan cleanup failed:", cleanupError);
        });
      }
      console.error("Forever Library upload error:", error);
      return res.status(500).json({ message: "The report could not be preserved." });
    }
  });

  router.get("/report-archives/:id/file", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Archive record is invalid." });
      }
      const [[row]] = await connection.query(
        "SELECT * FROM admin_report_archives WHERE id = ? LIMIT 1",
        [id]
      );
      if (!row) return res.status(404).json({ message: "Archived report not found." });
      const disposition = String(req.query.download || "") === "1" ? "attachment" : "inline";
      return streamArchivePdf(res, row, disposition);
    } catch (error) {
      console.error("Forever Library file error:", error);
      if (!res.headersSent) {
        return res.status(500).json({ message: "Archived report could not be opened." });
      }
      return undefined;
    }
  });

  return router;
}
