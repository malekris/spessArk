import express from "express";
import authAdmin from "../middleware/authAdmin.js";
import { pool } from "../server.js";
import { buildStreamReadiness } from "../services/streamReadinessService.js";

const router = express.Router();

// GET /api/admin/stream-readiness
router.get("/", authAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        ta.class_level AS class,
        ta.stream,
        ta.subject,
        ta.teacher_id AS teacherId
      FROM teacher_assignments ta
      ORDER BY ta.class_level, ta.stream, ta.subject
      `
    );

    const allStreams = buildStreamReadiness(rows);

    const classFilter = String(req.query.class_level || "").trim();
    const streamFilter = String(req.query.stream || "").trim().toLowerCase();

    const streams = allStreams.filter((row) => {
      if (classFilter && row.class !== classFilter) return false;
      if (streamFilter && row.stream.toLowerCase() !== streamFilter) return false;
      return true;
    });

    const readyStreams = streams.filter((s) => s.status === "READY").length;
    const notReadyStreams = streams.length - readyStreams;

    res.json({
      totalStreams: streams.length,
      readyStreams,
      notReadyStreams,
      streams,
    });
  } catch (err) {
    console.error("Stream readiness error:", err);
    res.status(500).json({ message: "Failed to load stream readiness" });
  }
});

export default router;

