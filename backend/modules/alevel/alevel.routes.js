import express from "express";
import {
  getLearners,
  createLearner,
  updateLearner,
  deleteLearner
} from "./alevel.controller.js";

import { db } from "../../server.js";

const router = express.Router();

/* Existing learners routes */
router.get("/learners", getLearners);
router.post("/learners", createLearner);
router.put("/learners/:id", updateLearner);
router.delete("/learners/:id", deleteLearner);

/* ===========================
   ADD THESE BELOW
=========================== */

// classes = derive from learners streams
router.get("/classes", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT stream AS name FROM alevel_learners WHERE stream IS NOT NULL`
    );
    res.json(rows.map(r => r.name));
  } catch {
    res.status(500).json([]);
  }
});

// subjects = from alevel_subjects
router.get("/subjects", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name 
      FROM alevel_subjects 
      ORDER BY name
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

// assignments
router.get("/admin/assignments", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        ats.id,
        ats.stream,
        s.name AS subject,
        t.name AS teacher_name
      FROM alevel_teacher_subjects ats
      LEFT JOIN teachers t ON t.id = ats.teacher_id
      LEFT JOIN alevel_subjects s ON s.id = ats.subject_id
      ORDER BY ats.id DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("GET assignments error:", err);
    res.status(500).json({ message: "Failed to fetch assignments" });
  }
});



// CREATE assignment

router.post("/admin/assignments", async (req, res) => {
  const { teacherId, subjectId, stream } = req.body;

  // validation
  if (!teacherId || !subjectId || !stream) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    await db.query(
      `INSERT INTO alevel_teacher_subjects (teacher_id, subject_id, stream)
       VALUES (?, ?, ?)`,
      [teacherId, subjectId, stream]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("POST assignment error:", err);
    res.status(500).json({ message: "Failed to save assignment" });
  }
});



// DELETE assignment
router.delete("/admin/assignments/:id", async (req, res) => {
  try {
    await db.query(
      "DELETE FROM alevel_teacher_subjects WHERE id = ?",
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete" });
  }
});


export default router;
