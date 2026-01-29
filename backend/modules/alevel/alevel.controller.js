// backend/modules/alevel/alevel.controller.js
import { db } from "../../server.js";
import express from "express";

const router = express.Router();

// GET /api/alevel/learners
export async function getLearners(req, res) {
  try {
    const [rows] = await db.query(`
      SELECT 
        l.id,
        CONCAT(l.first_name, ' ', l.last_name) AS name,
        l.gender,
        l.house,
        l.stream,
        l.combination,
        GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') AS subjects
      FROM alevel_learners l
      LEFT JOIN alevel_learner_subjects ls ON ls.learner_id = l.id
      LEFT JOIN alevel_subjects s ON s.id = ls.subject_id
      GROUP BY 
        l.id,
        l.first_name,
        l.last_name,
        l.gender,
        l.house,
        l.stream,
        l.combination
      ORDER BY l.id DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("getLearners error:", err);
    res.status(500).json({ message: "Failed to fetch learners" });
  }
}

// POST /api/alevel/learners
export async function createLearner(req, res) {
  const {
    name,
    gender,
    dob,
    house,
    stream,
    combination,
    subjects,
  } = req.body;

  if (!name || !gender || !dob || !house || !stream || !Array.isArray(subjects)) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  const [first_name, ...rest] = name.trim().split(" ");
  const last_name = rest.join(" ") || null;

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Insert learner
    const [result] = await conn.query(
      `
      INSERT INTO alevel_learners
      (first_name, last_name, gender, dob, house, stream, combination)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [first_name, last_name, gender, dob, house, stream, combination || null]
    );

    const learnerId = result.insertId;

    // 2. Get subject IDs
    const [subjectRows] = await conn.query(
      `SELECT id, name FROM alevel_subjects WHERE name IN (?)`,
      [subjects]
    );

    if (subjectRows.length !== subjects.length) {
      throw new Error("Some subjects do not exist in alevel_subjects");
    }

    // 3. Insert learner-subject mappings
    const values = subjectRows.map((s) => [learnerId, s.id]);

    await conn.query(
      `INSERT INTO alevel_learner_subjects (learner_id, subject_id) VALUES ?`,
      [values]
    );

    await conn.commit();
    res.json({ success: true, id: learnerId });
  } catch (err) {
    await conn.rollback();
    console.error("createLearner error:", err);
    res.status(500).json({ message: "Failed to create learner" });
  } finally {
    conn.release();
  }
}
export async function deleteLearner(req, res) {
  const { id } = req.params;

  try {
    // 1. Delete marks first (foreign key blocker)
    await db.query(
      "DELETE FROM alevel_marks WHERE learner_id = ?",
      [id]
    );

    // 2. Delete subject registrations
    await db.query(
      "DELETE FROM alevel_learner_subjects WHERE learner_id = ?",
      [id]
    );

    // 3. Finally delete the learner
    const [result] = await db.query(
      "DELETE FROM alevel_learners WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Learner not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("deleteLearner error:", err);
    res.status(500).json({ message: "Failed to delete learner" });
  }
}

export async function updateLearner(req, res) {
  const { id } = req.params;
  const { name, gender, dob, house, stream, combination, subjects } = req.body;

  const [first_name, ...rest] = name.split(" ");
  const last_name = rest.join(" ") || null;

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE alevel_learners 
       SET first_name=?, last_name=?, gender=?, dob=?, house=?, stream=?, combination=?
       WHERE id=?`,
      [first_name, last_name, gender, dob, house, stream, combination, id]
    );

    await conn.query(
      "DELETE FROM alevel_learner_subjects WHERE learner_id = ?",
      [id]
    );

    const [subjectRows] = await conn.query(
      `SELECT id FROM alevel_subjects WHERE name IN (?)`,
      [subjects]
    );

    const values = subjectRows.map(s => [id, s.id]);

    await conn.query(
      `INSERT INTO alevel_learner_subjects (learner_id, subject_id) VALUES ?`,
      [values]
    );

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: "Update failed" });
  } finally {
    conn.release();
  }
}

export default router;
