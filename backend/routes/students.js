import express from "express";
import { pool } from "../server.js";

const router = express.Router();

// GET all students (admin / public use)
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM students ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    console.error("Load students error:", err);
    res.status(500).json({ message: "Failed to load students" });
  }
});

export default router;
