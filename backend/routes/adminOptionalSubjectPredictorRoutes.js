import express from "express";
import authAdmin from "../middleware/authAdmin.js";
import { pool } from "../server.js";
import { getCurrentAcademicYear } from "../services/adminYearSnapshotService.js";
import { ensureStudentLifecycleColumns } from "../services/studentLifecycleService.js";
import {
  buildOptionalSubjectPredictions,
  CATEGORY_B_CLOSE_ALTERNATIVE_MARGIN,
  ENTREPRENEURSHIP_MINIMUM_AVERAGE,
  KISWAHILI_MINIMUM_AVERAGE,
  OPTIONAL_SUBJECT_CATEGORIES,
  OPTIONAL_SUBJECT_LOW_CONFIDENCE_THRESHOLD,
  OPTIONAL_SUBJECT_RECOMMENDATION_THRESHOLD,
} from "../services/optionalSubjectPredictor.js";
import {
  readOptionalSubjectSelections,
  saveOptionalSubjectSelection,
  validateManualOptionalSubjectSelection,
} from "../services/optionalSubjectSelectionService.js";
import { extractClientIp, logAuditEvent } from "../utils/auditLogger.js";

const router = express.Router();
const STREAMS = new Map([
  ["north", "North"],
  ["south", "South"],
]);

router.get("/optional-subject-predictor", authAdmin, async (req, res) => {
  try {
    await ensureStudentLifecycleColumns(pool);
    const stream = STREAMS.get(String(req.query.stream || "").trim().toLowerCase()) || "";
    const requestedYear = Number(req.query.year);
    const currentYear = await getCurrentAcademicYear(pool);
    const academicYear = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2200
      ? requestedYear
      : currentYear;

    if (!stream) {
      return res.status(400).json({ message: "Choose either North or South stream." });
    }

    const [learners] = await pool.query(
      `
      SELECT id, name, stream, subjects
      FROM students
      WHERE UPPER(TRIM(class_level)) = 'S2'
        AND LOWER(TRIM(stream)) = LOWER(?)
        AND COALESCE(NULLIF(status, ''), 'active') = 'active'
      ORDER BY TRIM(name) ASC, id ASC
      `,
      [stream]
    );

    const learnerIds = learners.map((learner) => Number(learner.id)).filter(Boolean);
    let marks = [];
    if (learnerIds.length > 0) {
      const placeholders = learnerIds.map(() => "?").join(", ");
      [marks] = await pool.query(
        `
        SELECT
          m.id,
          m.student_id,
          m.score,
          m.status,
          m.term,
          m.aoi_label,
          ta.subject
        FROM marks m
        JOIN teacher_assignments ta ON ta.id = m.assignment_id
        WHERE m.student_id IN (${placeholders})
          AND m.year = ?
          AND UPPER(TRIM(ta.class_level)) = 'S2'
          AND LOWER(TRIM(ta.stream)) = LOWER(?)
        ORDER BY m.id DESC
        `,
        [...learnerIds, academicYear, stream]
      );
    }

    const predictions = buildOptionalSubjectPredictions({ learners, marks });
    const savedSelections = await readOptionalSubjectSelections(pool, {
      learnerIds,
      academicYear,
    });

    const predictionsWithSelections = predictions.map((prediction) => {
      const saved = savedSelections.get(prediction.id);
      const categoryAIsCurrent = prediction.categoryA.candidates.some(
        (candidate) => candidate.subject === saved?.categoryA
      );
      const categoryBIsCurrent = prediction.categoryB.candidates.some(
        (candidate) => candidate.subject === saved?.categoryB
      );

      return {
        ...prediction,
        manualSelection: {
          categoryA: categoryAIsCurrent ? saved.categoryA : "",
          categoryB: categoryBIsCurrent ? saved.categoryB : "",
          invalidCategoryA: saved?.categoryA && !categoryAIsCurrent ? saved.categoryA : null,
          invalidCategoryB: saved?.categoryB && !categoryBIsCurrent ? saved.categoryB : null,
          saved: Boolean(saved),
          updatedAt: saved?.updatedAt || null,
        },
      };
    });
    const completeCount = predictionsWithSelections.filter((row) => row.complete).length;
    const lowConfidenceCount = predictionsWithSelections.filter((row) => row.lowConfidence).length;
    const manualCompleteCount = predictionsWithSelections.filter(
      (row) => row.manualSelection.categoryA && row.manualSelection.categoryB
    ).length;

    return res.json({
      classLevel: "S2",
      stream,
      academicYear,
      scoreWindow: "Term 1, Term 2 and Term 3 AOI 1-3",
      categories: OPTIONAL_SUBJECT_CATEGORIES,
      thresholds: {
        recommended: OPTIONAL_SUBJECT_RECOMMENDATION_THRESHOLD,
        lowConfidenceBelow: OPTIONAL_SUBJECT_LOW_CONFIDENCE_THRESHOLD,
        entrepreneurshipMinimumAverage: ENTREPRENEURSHIP_MINIMUM_AVERAGE,
        kiswahiliMinimumAverage: KISWAHILI_MINIMUM_AVERAGE,
        categoryBCloseAlternativeMargin: CATEGORY_B_CLOSE_ALTERNATIVE_MARGIN,
      },
      learnerCount: predictionsWithSelections.length,
      completeCount,
      lowConfidenceCount,
      incompleteCount: predictionsWithSelections.length - completeCount,
      manualCompleteCount,
      learners: predictionsWithSelections,
    });
  } catch (err) {
    console.error("Optional subject predictor error:", err);
    return res.status(500).json({ message: "Failed to build optional-subject predictions." });
  }
});

router.put("/optional-subject-selections/:studentId", authAdmin, async (req, res) => {
  try {
    await ensureStudentLifecycleColumns(pool);
    const learnerId = Number(req.params.studentId);
    const academicYear = Number(req.body?.year);

    if (!Number.isInteger(learnerId) || learnerId <= 0) {
      return res.status(400).json({ message: "Invalid learner." });
    }
    if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2200) {
      return res.status(400).json({ message: "Choose a valid academic year." });
    }

    const [[learner]] = await pool.query(
      `SELECT id, name, class_level, stream, subjects, status
       FROM students
       WHERE id = ?
       LIMIT 1`,
      [learnerId]
    );

    if (!learner) return res.status(404).json({ message: "Learner not found." });
    if (String(learner.class_level || "").trim().toUpperCase() !== "S2") {
      return res.status(400).json({ message: "Optional-subject selections are only available for S2 learners." });
    }
    if (String(learner.status || "active").trim().toLowerCase() !== "active") {
      return res.status(400).json({ message: "Selections can only be saved for active learners." });
    }

    const categoryA = validateManualOptionalSubjectSelection({
      subjects: learner.subjects,
      category: "A",
      value: req.body?.categoryA,
    });
    const categoryB = validateManualOptionalSubjectSelection({
      subjects: learner.subjects,
      category: "B",
      value: req.body?.categoryB,
    });

    const selection = await saveOptionalSubjectSelection(pool, {
      learnerId,
      academicYear,
      stream: String(learner.stream || "").trim(),
      categoryA,
      categoryB,
      updatedByAdminId: Number(req.admin?.id) || null,
    });

    await logAuditEvent({
      userId: req.admin?.id,
      userRole: "admin",
      action: "optional_subject_selection_saved",
      entityType: "subject",
      entityId: learnerId,
      description: `Saved ${academicYear} S2 optional subjects for ${learner.name}: A=${categoryA || "not selected"}, B=${categoryB || "not selected"}.`,
      ipAddress: extractClientIp(req),
    });

    return res.json({
      message: "Optional-subject selection saved.",
      selection,
    });
  } catch (err) {
    if (err?.code === "INVALID_OPTIONAL_SUBJECT_SELECTION") {
      return res.status(400).json({ message: err.message });
    }
    console.error("Optional subject selection save error:", err);
    return res.status(500).json({ message: "Failed to save the optional-subject selection." });
  }
});

export default router;
