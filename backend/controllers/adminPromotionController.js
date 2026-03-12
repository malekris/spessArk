import {
  executePromotions,
  getGraduatedStudents,
  getPromotionHistory,
  previewPromotions,
} from "../services/promotionService.js";
import { extractClientIp, logAuditEvent } from "../utils/auditLogger.js";

const resolveClassLevel = (src) =>
  String(src?.classLevel ?? src?.class_level ?? "").trim();

const resolveStream = (src) => String(src?.stream ?? "").trim();
const resolveAcademicYear = (src) =>
  String(src?.academicYear ?? src?.academic_year ?? "").trim();

export async function previewPromotionsController(req, res) {
  try {
    const classLevel = resolveClassLevel(req.query);
    const stream = resolveStream(req.query);
    const academicYear = resolveAcademicYear(req.query);

    if (!classLevel || !stream || !academicYear) {
      return res.status(400).json({
        message: "classLevel, stream and academicYear are required",
      });
    }

    const result = await previewPromotions({ classLevel, stream, academicYear });

    if (!result.ok && result.error === "INVALID_CLASS_LEVEL") {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (err) {
    console.error("Promotion preview error:", err);
    return res.status(500).json({ message: "Failed to preview promotions" });
  }
}

export async function executePromotionsController(req, res) {
  try {
    const classLevel = resolveClassLevel(req.body);
    const stream = resolveStream(req.body);
    const academicYear = resolveAcademicYear(req.body);
    const notes = String(req.body?.notes || "").trim();

    if (!classLevel || !stream || !academicYear) {
      return res.status(400).json({
        message: "classLevel, stream and academicYear are required",
      });
    }

    const adminUserId = Number(req.admin?.id || req.body?.adminUserId || 1);
    const ipAddress = extractClientIp(req);

    const result = await executePromotions({
      classLevel,
      stream,
      academicYear,
      adminUserId,
      ipAddress,
      notes,
    });

    if (!result.ok && result.error === "INVALID_CLASS_LEVEL") {
      return res.status(400).json(result);
    }

    await logAuditEvent({
      userId: adminUserId,
      userRole: "admin",
      action: "EXECUTE_PROMOTION",
      entityType: "stream",
      entityId: null,
      description:
        `Promotion batch ${classLevel} ${stream} ${academicYear}: processed=${result.processedCount}, promoted=${result.promotedCount}, graduated=${result.graduatedCount}, marks_cleared=${result.clearedMarksCount || 0}`,
      ipAddress,
    });

    return res.json(result);
  } catch (err) {
    console.error("Promotion execute error:", err);
    return res.status(500).json({ message: "Failed to execute promotions" });
  }
}

export async function getGraduatedStudentsController(req, res) {
  try {
    const search = String(req.query.search || "").trim();
    const academicYear = resolveAcademicYear(req.query);
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 25);

    const result = await getGraduatedStudents({
      search,
      academicYear,
      page,
      limit,
    });

    return res.json({
      students: result.rows,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  } catch (err) {
    console.error("Get graduated students error:", err);
    return res.status(500).json({ message: "Failed to load graduated students" });
  }
}

export async function getPromotionHistoryController(req, res) {
  try {
    const academicYear = resolveAcademicYear(req.query);
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 25);

    const result = await getPromotionHistory({
      academicYear,
      page,
      limit,
    });

    return res.json({
      rows: result.rows,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  } catch (err) {
    console.error("Get promotion history error:", err);
    return res.status(500).json({ message: "Failed to load promotion history" });
  }
}
