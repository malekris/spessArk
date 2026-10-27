import express from "express";
import authAdmin from "../middleware/authAdmin.js";
import { pool } from "../server.js";
import { getCurrentAcademicYear } from "../services/adminYearSnapshotService.js";
import { ensureStudentLifecycleColumns } from "../services/studentLifecycleService.js";
import {
  buildOptionalSubjectPredictions,
  ENTREPRENEURSHIP_PREDICTOR_AVERAGE_CAP,
  KISWAHILI_PREDICTOR_AVERAGE_CAP,
  OPTIONAL_SUBJECT_CATEGORIES,
  OPTIONAL_SUBJECT_LOW_CONFIDENCE_THRESHOLD,
  OPTIONAL_SUBJECT_RECOMMENDATION_THRESHOLD,
} from "../services/optionalSubjectPredictor.js";

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
    const completeCount = predictions.filter((row) => row.complete).length;
    const lowConfidenceCount = predictions.filter((row) => row.lowConfidence).length;

    return res.json({
      classLevel: "S2",
      stream,
      academicYear,
      scoreWindow: "Term 1, Term 2 and Term 3 AOI 1-3",
      categories: OPTIONAL_SUBJECT_CATEGORIES,
      thresholds: {
        recommended: OPTIONAL_SUBJECT_RECOMMENDATION_THRESHOLD,
        lowConfidenceBelow: OPTIONAL_SUBJECT_LOW_CONFIDENCE_THRESHOLD,
        entrepreneurshipAverageCap: ENTREPRENEURSHIP_PREDICTOR_AVERAGE_CAP,
        kiswahiliAverageCap: KISWAHILI_PREDICTOR_AVERAGE_CAP,
      },
      learnerCount: predictions.length,
      completeCount,
      lowConfidenceCount,
      incompleteCount: predictions.length - completeCount,
      learners: predictions,
    });
  } catch (err) {
    console.error("Optional subject predictor error:", err);
    return res.status(500).json({ message: "Failed to build optional-subject predictions." });
  }
});

export default router;
