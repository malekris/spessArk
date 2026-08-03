import express from "express";
import authAdmin from "../middleware/authAdmin.js";
import { ensureAlevelPromotionSchemaReady } from "../services/alevelPromotionService.js";
import { ensureStudentLifecycleColumns } from "../services/studentLifecycleService.js";
import { pool } from "../server.js";

const router = express.Router();

const O_LEVEL_CLASSES = new Set(["S1", "S2", "S3", "S4"]);
const A_LEVEL_CLASSES = new Set(["S5", "S6"]);
const O_LEVEL_STREAMS = new Map([
  ["north", "North"],
  ["south", "South"],
]);
const A_LEVEL_STREAMS = new Map([
  ["arts", "Arts"],
  ["sciences", "Sciences"],
]);

const normalizeClassLevel = (value) => String(value || "").trim().toUpperCase();
const normalizeStream = (value, options) =>
  options.get(String(value || "").trim().toLowerCase()) || "";

// Read-only roster used to compose disposable EMIS handwriting forms in the browser.
router.get("/emis-registration/roster", authAdmin, async (req, res) => {
  try {
    const classLevel = normalizeClassLevel(req.query.classLevel);
    const isOLevel = O_LEVEL_CLASSES.has(classLevel);
    const isALevel = A_LEVEL_CLASSES.has(classLevel);

    if (!isOLevel && !isALevel) {
      return res.status(400).json({ message: "Class must be between S1 and S6." });
    }

    const stream = normalizeStream(
      req.query.stream,
      isOLevel ? O_LEVEL_STREAMS : A_LEVEL_STREAMS
    );
    if (!stream) {
      return res.status(400).json({
        message: isOLevel
          ? "O-Level stream must be North or South."
          : "A-Level stream must be Arts or Sciences.",
      });
    }

    let rows = [];
    if (isOLevel) {
      await ensureStudentLifecycleColumns(pool);
      [rows] = await pool.query(
        `SELECT id, name, gender, DATE_FORMAT(dob, '%Y-%m-%d') AS dob
         FROM students
         WHERE UPPER(TRIM(class_level)) = ?
           AND LOWER(TRIM(stream)) = LOWER(?)
           AND COALESCE(NULLIF(status, ''), 'active') = 'active'
         ORDER BY TRIM(name) ASC, id ASC`,
        [classLevel, stream]
      );
    } else {
      await ensureAlevelPromotionSchemaReady(pool);
      [rows] = await pool.query(
        `SELECT
           id,
           TRIM(CONCAT_WS(' ', first_name, last_name)) AS name,
           gender,
           DATE_FORMAT(dob, '%Y-%m-%d') AS dob
         FROM alevel_learners
         WHERE LOWER(TRIM(stream)) = LOWER(?)
           AND COALESCE(NULLIF(status, ''), 'active') = 'active'
         ORDER BY TRIM(first_name) ASC, TRIM(last_name) ASC, id ASC`,
        [`${classLevel} ${stream}`]
      );
    }

    return res.json({
      classLevel,
      stream,
      level: isOLevel ? "O-Level" : "A-Level",
      learnerCount: rows.length,
      learners: rows,
    });
  } catch (err) {
    console.error("EMIS registration roster error:", err);
    return res.status(500).json({ message: "Failed to load the EMIS learner roster." });
  }
});

export default router;
