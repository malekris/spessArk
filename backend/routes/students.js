import express from "express";
import { pool } from "../server.js";
import { ensureStudentLifecycleColumns } from "../services/studentLifecycleService.js";

const router = express.Router();

// This router is mounted behind authAdmin; never expose school records publicly.
router.get("/", async (req, res) => {
  try {
    await ensureStudentLifecycleColumns(pool);
    const [rows] = await pool.query(
      `SELECT id, name, gender, dob, class, stream, status
       FROM students
       WHERE COALESCE(NULLIF(status, ''), 'active') = 'active'
       ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error("Load students error:", err);
    res.status(500).json({ message: "Failed to load students" });
  }
});

export default router;
