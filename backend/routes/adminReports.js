import express from "express";
import authAdmin from "../middleware/authAdmin.js";
import { pool } from "../server.js";

const router = express.Router();

const REQUIRED_SUBJECT_LOAD = {
  S1: 12,
  S2: 12,
  S3: 9,
  S4: 9,
};

const normalizeClassLevel = (value) => String(value || "").trim().toUpperCase();
const getExpectedSubjectLoad = (classLevel) =>
  REQUIRED_SUBJECT_LOAD[normalizeClassLevel(classLevel)] || null;

const buildEligibleRankMeta = (rows, valueKey, normalizeStream) => {
  const byStudent = new Map();

  rows.forEach((row) => {
    if (!byStudent.has(row.student_id)) {
      byStudent.set(row.student_id, {
        student_id: row.student_id,
        class_level: row.class_level,
        stream: normalizeStream(row.stream),
        values: [],
        subjects: new Set(),
      });
    }

    const bucket = byStudent.get(row.student_id);
    bucket.subjects.add(String(row.subject || "").trim().toLowerCase());

    if (row[valueKey] !== null && row[valueKey] !== undefined && row[valueKey] !== "") {
      bucket.values.push(Number(row[valueKey]));
    }
  });

  const eligibleSummaries = Array.from(byStudent.values())
    .map((student) => {
      const expectedLoad = getExpectedSubjectLoad(student.class_level);
      const subjectCount = student.subjects.size;
      const isEligible = expectedLoad ? subjectCount >= expectedLoad : student.values.length > 0;
      const overall =
        isEligible && student.values.length > 0
          ? Number(
              (
                student.values.reduce((acc, value) => acc + value, 0) /
                student.values.length
              ).toFixed(3)
            )
          : null;

      return {
        student_id: student.student_id,
        stream: student.stream,
        isEligible,
        overall,
      };
    })
    .filter((student) => student.isEligible && student.overall !== null);

  const classRanked = [...eligibleSummaries]
    .sort((a, b) => b.overall - a.overall)
    .map((student, index) => ({ ...student, class_position: index + 1 }));

  const classPositionById = new Map(
    classRanked.map((student) => [student.student_id, student.class_position])
  );

  const streamBuckets = new Map();
  classRanked.forEach((student) => {
    if (!streamBuckets.has(student.stream)) streamBuckets.set(student.stream, []);
    streamBuckets.get(student.stream).push(student);
  });

  const streamRankMeta = new Map();
  streamBuckets.forEach((bucket, streamKey) => {
    const ranked = [...bucket]
      .sort((a, b) => b.overall - a.overall)
      .map((student, index) => ({
        student_id: student.student_id,
        stream_position: index + 1,
      }));

    streamRankMeta.set(streamKey, {
      total: ranked.length,
      posById: new Map(ranked.map((entry) => [entry.student_id, entry.stream_position])),
    });
  });

  return {
    classTotal: classRanked.length,
    classPositionById,
    streamRankMeta,
  };
};

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
        MAX(CASE WHEN m.aoi_label = 'AOI3' THEN m.score END) AS AOI3,
        MAX(CASE WHEN m.aoi_label = 'AOI1' THEN m.status END) AS AOI1_status,
        MAX(CASE WHEN m.aoi_label = 'AOI2' THEN m.status END) AS AOI2_status,
        MAX(CASE WHEN m.aoi_label = 'AOI3' THEN m.status END) AS AOI3_status

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

    const { classTotal, classPositionById, streamRankMeta } = buildEligibleRankMeta(
      processedAll,
      "average",
      normalizeStream
    );

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

/*
  END OF YEAR REPORT
  Uses Term 3 AOIs + Term 3 /80 exam and computed 20% coursework component.
*/
router.get("/year", authAdmin, async (req, res) => {
  try {
    const { year, class_level, stream, student_id } = req.query;
    const yearParam = year || new Date().getFullYear();

    if (!class_level || !stream) {
      return res.status(400).json({
        message: "class_level and stream are required",
      });
    }

    const normalizeStream = (v) => String(v || "").trim().toLowerCase();
    const wantedStream = normalizeStream(stream);

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

        MAX(CASE WHEN m.term = 'Term 1' AND m.aoi_label = 'AOI1' THEN m.score END) AS T1_AOI1,
        MAX(CASE WHEN m.term = 'Term 1' AND m.aoi_label = 'AOI2' THEN m.score END) AS T1_AOI2,
        MAX(CASE WHEN m.term = 'Term 1' AND m.aoi_label = 'AOI3' THEN m.score END) AS T1_AOI3,

        MAX(CASE WHEN m.term = 'Term 2' AND m.aoi_label = 'AOI1' THEN m.score END) AS T2_AOI1,
        MAX(CASE WHEN m.term = 'Term 2' AND m.aoi_label = 'AOI2' THEN m.score END) AS T2_AOI2,
        MAX(CASE WHEN m.term = 'Term 2' AND m.aoi_label = 'AOI3' THEN m.score END) AS T2_AOI3,

        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI1' THEN m.score END) AS AOI1,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI2' THEN m.score END) AS AOI2,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI3' THEN m.score END) AS AOI3,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI1' THEN m.status END) AS AOI1_status,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI2' THEN m.status END) AS AOI2_status,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI3' THEN m.status END) AS AOI3_status,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'EXAM80' THEN m.score END) AS EXAM80
      FROM students s
      JOIN marks m ON m.student_id = s.id
      JOIN teacher_assignments ta ON ta.id = m.assignment_id
      JOIN teachers t ON t.id = m.teacher_id
      WHERE m.year = ?
        AND s.class_level = ?
      GROUP BY s.id, ta.subject, t.name
      ORDER BY s.name, ta.subject
      `,
      [yearParam, class_level]
    );

    const toNum = (v) => (v === null || v === undefined ? null : Number(v));
    const gradeFor = (total100) => {
      if (total100 === null || Number.isNaN(total100)) return "";
      if (total100 >= 80) return "A";
      if (total100 >= 70) return "B";
      if (total100 >= 60) return "C";
      if (total100 >= 50) return "D";
      return "E";
    };
    const remarkForGrade = (grade) => {
      if (grade === "A") return "Exceptional";
      if (grade === "B") return "Outstanding";
      if (grade === "C") return "Satisfactory";
      if (grade === "D") return "Basic";
      if (grade === "E") return "Elementary";
      return "";
    };

    const processedAll = rows.map((r) => {
      const term3 = [toNum(r.AOI1), toNum(r.AOI2), toNum(r.AOI3)];
      const term3Present = term3.filter((v) => v !== null);
      const average =
        term3Present.length > 0
          ? Number((term3Present.reduce((a, b) => a + b, 0) / term3Present.length).toFixed(2))
          : null;

      const nineAois = [
        toNum(r.T1_AOI1), toNum(r.T1_AOI2), toNum(r.T1_AOI3),
        toNum(r.T2_AOI1), toNum(r.T2_AOI2), toNum(r.T2_AOI3),
        toNum(r.AOI1), toNum(r.AOI2), toNum(r.AOI3),
      ];
      const hasAnyNine = nineAois.some((v) => v !== null);
      const nineSum = nineAois.reduce((acc, v) => acc + (v ?? 0), 0);
      // 20% coursework = (Avg T1 + Avg T2 + Avg T3) / 9 * 20
      // where Avg Ti = (AOI1 + AOI2 + AOI3) / 3
      // Equivalent using all 9 AOIs directly: (sum of 9 AOIs / 27) * 20
      const course20 = hasAnyNine ? Number(((nineSum / 27) * 20).toFixed(2)) : null;

      const exam80 = toNum(r.EXAM80);
      const total100 =
        exam80 !== null || course20 !== null
          ? Number(((exam80 ?? 0) + (course20 ?? 0)).toFixed(2))
          : null;

      const grade = gradeFor(total100);
      const remark = remarkForGrade(grade);

      return {
        ...r,
        average,
        percent20: course20,
        percent80: exam80,
        percent100: total100,
        grade,
        remark,
      };
    });

    const { classTotal, classPositionById, streamRankMeta } = buildEligibleRankMeta(
      processedAll,
      "percent100",
      normalizeStream
    );

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

    const filtered = withPositions.filter((row) => {
      if (student_id) return String(row.student_id) === String(student_id);
      return normalizeStream(row.stream) === wantedStream;
    });

    res.json(filtered);
  } catch (err) {
    console.error("❌ End of year report error:", err);
    res.status(500).json({ message: "Failed to load report data" });
  }
});

export default router;
