import express from "express";
import authAdmin from "../middleware/authAdmin.js";
import { pool } from "../server.js";

const router = express.Router();

/*
  END OF TERM REPORT
  Term = 1 or 2
*/
router.get("/term", authAdmin, async (req, res) => {
  try {
    // ✅ EXTRACT QUERY PARAMS (THIS WAS MISSING)
    const {
      year,
      term,
      class_level,
      stream,
      student_id,
    } = req.query;

    // ✅ SAFE YEAR DEFAULT (2026 FIX)
    const yearParam = year || new Date().getFullYear();

    if (!term || !class_level || !stream) {
      return res.status(400).json({
        message: "term, class_level and stream are required",
      });
    }

    // 🔧 Normalize term (UI sends 1 / 2)
    let normalizedTerm = term;
    if (term === "1") normalizedTerm = "Term 1";
    if (term === "2") normalizedTerm = "Term 2";

    const normalizeStream = (v) => String(v || "").trim().toLowerCase();
    const wantedStream = normalizeStream(stream);

    // Pull class-wide marks first so class position is truly class-wide.
    const [rows] = await pool.query(
      `
      SELECT
        s.id AS student_id,
        s.name AS student_name,
        s.dob,
        s.class_level,
        s.stream,

        ta.subject,
        t.name AS teacher_name,

        MAX(CASE WHEN m.aoi_label = 'AOI1' THEN m.score END) AS AOI1,
        MAX(CASE WHEN m.aoi_label = 'AOI2' THEN m.score END) AS AOI2,
        MAX(CASE WHEN m.aoi_label = 'AOI3' THEN m.score END) AS AOI3

      FROM students s
      JOIN marks m ON m.student_id = s.id
      JOIN teacher_assignments ta ON ta.id = m.assignment_id
      JOIN teachers t ON t.id = m.teacher_id

      WHERE
        m.year = ?
        AND m.term = ?
        AND s.class_level = ?

      GROUP BY
        s.id,
        ta.subject,
        t.name

      ORDER BY
        s.name,
        ta.subject
      `,
      [
        yearParam,
        normalizedTerm,
        class_level,
      ]
    );

    // ✅ SINGLE processed block (average + remark)
    const processedAll = rows.map((r) => {
      const scores = [r.AOI1, r.AOI2, r.AOI3]
        .filter((v) => v !== null)
        .map(Number);

      let average = null;
      let remark = "MISSED";

      if (scores.length > 0) {
        average =
          Math.round(
            (scores.reduce((a, b) => a + b, 0) / scores.length) * 10
          ) / 10;

        if (average >= 0.9 && average <= 1.4) remark = "BASIC";
        else if (average >= 1.5 && average <= 2.4) remark = "MODERATE";
        else if (average >= 2.5) remark = "OUTSTANDING";
      }

      return {
        ...r,
        average,
        remark,
      };
    });

    // Compute per-student overall average for ranking.
    const byStudent = new Map();
    processedAll.forEach((row) => {
      if (!byStudent.has(row.student_id)) {
        byStudent.set(row.student_id, {
          student_id: row.student_id,
          stream: normalizeStream(row.stream),
          averages: [],
        });
      }
      if (row.average !== null) {
        byStudent.get(row.student_id).averages.push(Number(row.average));
      }
    });

    const studentSummary = Array.from(byStudent.values()).map((s) => {
      const overall =
        s.averages.length > 0
          ? Number(
              (
                s.averages.reduce((acc, v) => acc + v, 0) / s.averages.length
              ).toFixed(3)
            )
          : -1; // keep missing marks at the bottom
      return {
        student_id: s.student_id,
        stream: s.stream,
        overall,
      };
    });

    const classRanked = [...studentSummary]
      .sort((a, b) => b.overall - a.overall)
      .map((s, idx) => ({ ...s, class_position: idx + 1 }));

    const classTotal = classRanked.length;
    const classPositionById = new Map(
      classRanked.map((s) => [s.student_id, s.class_position])
    );

    const streamRankMeta = new Map();
    const streamBuckets = new Map();
    classRanked.forEach((s) => {
      if (!streamBuckets.has(s.stream)) streamBuckets.set(s.stream, []);
      streamBuckets.get(s.stream).push(s);
    });

    streamBuckets.forEach((bucket, streamKey) => {
      const ranked = [...bucket]
        .sort((a, b) => b.overall - a.overall)
        .map((s, idx) => ({ student_id: s.student_id, stream_position: idx + 1 }));
      const posMap = new Map(ranked.map((r) => [r.student_id, r.stream_position]));
      streamRankMeta.set(streamKey, {
        total: ranked.length,
        posById: posMap,
      });
    });

    const withPositions = processedAll.map((row) => {
      const sKey = normalizeStream(row.stream);
      const streamMeta = streamRankMeta.get(sKey);
      return {
        ...row,
        class_position: classPositionById.get(row.student_id) || null,
        class_total: classTotal,
        stream_position: streamMeta?.posById.get(row.student_id) || null,
        stream_total: streamMeta?.total || null,
      };
    });

    // Preserve existing API behavior: return selected stream,
    // or selected student if student_id is provided.
    const filtered = withPositions.filter((row) => {
      if (student_id) {
        return String(row.student_id) === String(student_id);
      }
      return normalizeStream(row.stream) === wantedStream;
    });

    res.json(filtered);
  } catch (err) {
    console.error("❌ End of term report error:", err);
    res.status(500).json({ message: "Failed to load report data" });
  }
});

export default router;
