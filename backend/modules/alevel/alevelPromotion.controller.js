import { pool } from "../../server.js";
import { extractClientIp, logAuditEvent } from "../../utils/auditLogger.js";
import { queueAdminYearSnapshotRefresh } from "../../services/adminYearSnapshotService.js";
import {
  executeAlevelPromotions,
  getAlevelPromotionHistory,
  getArchivedAlevelLearners,
  previewAlevelPromotions,
} from "../../services/alevelPromotionService.js";

const readAcademicYear = (source) =>
  String(source?.academicYear ?? source?.academic_year ?? "").trim();

export async function previewAlevelPromotionsController(req, res) {
  try {
    const stream = String(req.query?.stream || "").trim();
    const academicYear = readAcademicYear(req.query);
    if (!stream || !academicYear) {
      return res.status(400).json({ message: "stream and academicYear are required" });
    }

    const result = await previewAlevelPromotions(pool, { stream, academicYear });
    return result.ok ? res.json(result) : res.status(400).json(result);
  } catch (error) {
    console.error("A-Level promotion preview error:", error);
    return res.status(500).json({ message: "Failed to preview A-Level promotions" });
  }
}

export async function executeAlevelPromotionsController(req, res) {
  try {
    const stream = String(req.body?.stream || "").trim();
    const academicYear = readAcademicYear(req.body);
    const notes = String(req.body?.notes || "").trim();
    if (!stream || !academicYear) {
      return res.status(400).json({ message: "stream and academicYear are required" });
    }

    const adminUserId = Number(req.admin?.id || 1);
    const ipAddress = extractClientIp(req);
    const result = await executeAlevelPromotions(pool, {
      stream,
      academicYear,
      notes,
      adminUserId,
      ipAddress,
    });
    if (!result.ok) return res.status(400).json(result);

    await logAuditEvent({
      userId: adminUserId,
      userRole: "admin",
      action: "EXECUTE_ALEVEL_PROMOTION",
      entityType: "stream",
      description: `A-Level promotion batch ${stream} ${academicYear}: processed=${result.processedCount}, promoted=${result.promotedCount}, archived=${result.archivedCount}, marks_deleted=0`,
      ipAddress,
    });
    queueAdminYearSnapshotRefresh(pool, "alevel-promotion");
    return res.json(result);
  } catch (error) {
    console.error("A-Level promotion execute error:", error);
    return res.status(500).json({ message: "Failed to execute A-Level promotions" });
  }
}

export async function getArchivedAlevelLearnersController(req, res) {
  try {
    const result = await getArchivedAlevelLearners(pool, {
      search: req.query?.search,
      academicYear: readAcademicYear(req.query),
      page: req.query?.page,
      limit: req.query?.limit,
    });
    return res.json(result);
  } catch (error) {
    console.error("A-Level archived learners error:", error);
    return res.status(500).json({ message: "Failed to load archived A-Level learners" });
  }
}

export async function getAlevelPromotionHistoryController(req, res) {
  try {
    const result = await getAlevelPromotionHistory(pool, {
      academicYear: readAcademicYear(req.query),
      page: req.query?.page,
      limit: req.query?.limit,
    });
    return res.json(result);
  } catch (error) {
    console.error("A-Level promotion history error:", error);
    return res.status(500).json({ message: "Failed to load A-Level promotion history" });
  }
}
