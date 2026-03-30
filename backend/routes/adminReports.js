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

const hasRecordedScore = (value) => value !== null && value !== undefined && value !== "";
const isMissedStatus = (status) => String(status || "").trim().toLowerCase() === "missed";

const buildPopulationMeta = (rows, normalizeStream) => {
  const streamPopulationByKey = new Map();

  rows.forEach((row) => {
    const streamKey = normalizeStream(row.stream);
    streamPopulationByKey.set(streamKey, (streamPopulationByKey.get(streamKey) || 0) + 1);
  });

  return {
    classPopulation: rows.length,
    streamPopulationByKey,
  };
};

const normalizeTermLabel = (term) => {
  if (term === "1" || term === 1) return "Term 1";
  if (term === "2" || term === 2) return "Term 2";
  if (term === "3" || term === 3) return "Term 3";
  return String(term || "").trim();
};

const O_LEVEL_COMPONENTS_BY_TERM = {
  "Term 1": ["AOI 1", "AOI 2", "AOI 3"],
  "Term 2": ["AOI 1", "AOI 2", "AOI 3"],
  "Term 3": ["/80"],
};

const parseStoredSubjects = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // fall through
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeSubjectKey = (value) => String(value || "").trim().toLowerCase();

const normalizePaperLabel = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "paper 1" || raw === "paper1" || raw === "p1") return "Paper 1";
  if (raw === "paper 2" || raw === "paper2" || raw === "p2") return "Paper 2";
  if (raw === "single" || raw === "single paper") return "Single";
  return String(value || "").trim();
};

const formatMiniRemark = (score, status) => {
  if (isMissedStatus(status)) return "MISSED";
  if (!hasRecordedScore(score)) return "PENDING";
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return "PENDING";
  if (numeric >= 2.5) return "OUTSTANDING";
  if (numeric >= 1.5) return "MODERATE";
  if (numeric >= 0.9) return "BASIC";
  return "PENDING";
};

const buildEligibleRankMeta = (rows, valueKey, normalizeStream, isSubjectComplete) => {
  const byStudent = new Map();

  rows.forEach((row) => {
    if (!byStudent.has(row.student_id)) {
      byStudent.set(row.student_id, {
        student_id: row.student_id,
        class_level: row.class_level,
        stream: normalizeStream(row.stream),
        values: [],
        subjects: new Map(),
      });
    }

    const bucket = byStudent.get(row.student_id);
    const subjectKey = String(row.subject || "").trim().toLowerCase();
    const previousSubject = bucket.subjects.get(subjectKey);
    const rowComplete = isSubjectComplete(row);
    bucket.subjects.set(subjectKey, {
      complete: previousSubject ? previousSubject.complete && rowComplete : rowComplete,
    });

    if (hasRecordedScore(row[valueKey])) {
      bucket.values.push(Number(row[valueKey]));
    }
  });

  const eligibleSummaries = Array.from(byStudent.values())
    .map((student) => {
      const expectedLoad = getExpectedSubjectLoad(student.class_level);
      const subjectEntries = Array.from(student.subjects.values());
      const subjectCount = subjectEntries.length;
      const completeSubjectCount = subjectEntries.filter((entry) => entry.complete).length;
      const hasFullSubjectLoad = expectedLoad ? subjectCount >= expectedLoad : subjectCount > 0;
      const hasCompleteExamSet = expectedLoad
        ? hasFullSubjectLoad && completeSubjectCount >= expectedLoad
        : completeSubjectCount > 0;
      const overall =
        student.values.length > 0
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
        isEligible: hasCompleteExamSet && overall !== null,
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
    const isTermSubjectComplete = (row) => {
      const scoredAoIs = [row.AOI1, row.AOI2, row.AOI3].filter((value) => hasRecordedScore(value));
      const hasAnyMissed =
        isMissedStatus(row.AOI1_status) ||
        isMissedStatus(row.AOI2_status) ||
        isMissedStatus(row.AOI3_status);

      return scoredAoIs.length >= 2 && !hasAnyMissed;
    };

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
    const [populationRows] = await pool.query(
      `
      SELECT id, stream
      FROM students
      WHERE class_level = ?
      `,
      [class_level]
    );
    const { classPopulation, streamPopulationByKey } = buildPopulationMeta(
      populationRows,
      normalizeStream
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

    const { classPositionById, streamRankMeta } = buildEligibleRankMeta(
      processedAll,
      "average",
      normalizeStream,
      isTermSubjectComplete
    );

    const withPositions = processedAll.map((row) => {
      const sKey = normalizeStream(row.stream);
      const streamMeta = streamRankMeta.get(sKey);
      const isEligible = classPositionById.has(row.student_id);
      return {
        ...row,
        class_position: classPositionById.get(row.student_id) || null,
        class_total: classPopulation,
        stream_position: streamMeta?.posById.get(row.student_id) || null,
        stream_total: streamPopulationByKey.get(sKey) || 0,
        position_status: isEligible ? "ELIGIBLE" : "INELIGIBLE",
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
    const isYearSubjectComplete = (row) => {
      const requiredComponents = [
        row.T1_AOI1,
        row.T1_AOI2,
        row.T1_AOI3,
        row.T2_AOI1,
        row.T2_AOI2,
        row.T2_AOI3,
        row.AOI1,
        row.AOI2,
        row.AOI3,
        row.EXAM80,
      ];
      const hasAnyMissed =
        isMissedStatus(row.T1_AOI1_status) ||
        isMissedStatus(row.T1_AOI2_status) ||
        isMissedStatus(row.T1_AOI3_status) ||
        isMissedStatus(row.T2_AOI1_status) ||
        isMissedStatus(row.T2_AOI2_status) ||
        isMissedStatus(row.T2_AOI3_status) ||
        isMissedStatus(row.AOI1_status) ||
        isMissedStatus(row.AOI2_status) ||
        isMissedStatus(row.AOI3_status) ||
        isMissedStatus(row.EXAM80_status);

      return requiredComponents.every((value) => hasRecordedScore(value)) && !hasAnyMissed;
    };

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
        MAX(CASE WHEN m.term = 'Term 1' AND m.aoi_label = 'AOI1' THEN m.status END) AS T1_AOI1_status,
        MAX(CASE WHEN m.term = 'Term 1' AND m.aoi_label = 'AOI2' THEN m.status END) AS T1_AOI2_status,
        MAX(CASE WHEN m.term = 'Term 1' AND m.aoi_label = 'AOI3' THEN m.status END) AS T1_AOI3_status,

        MAX(CASE WHEN m.term = 'Term 2' AND m.aoi_label = 'AOI1' THEN m.score END) AS T2_AOI1,
        MAX(CASE WHEN m.term = 'Term 2' AND m.aoi_label = 'AOI2' THEN m.score END) AS T2_AOI2,
        MAX(CASE WHEN m.term = 'Term 2' AND m.aoi_label = 'AOI3' THEN m.score END) AS T2_AOI3,
        MAX(CASE WHEN m.term = 'Term 2' AND m.aoi_label = 'AOI1' THEN m.status END) AS T2_AOI1_status,
        MAX(CASE WHEN m.term = 'Term 2' AND m.aoi_label = 'AOI2' THEN m.status END) AS T2_AOI2_status,
        MAX(CASE WHEN m.term = 'Term 2' AND m.aoi_label = 'AOI3' THEN m.status END) AS T2_AOI3_status,

        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI1' THEN m.score END) AS AOI1,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI2' THEN m.score END) AS AOI2,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI3' THEN m.score END) AS AOI3,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI1' THEN m.status END) AS AOI1_status,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI2' THEN m.status END) AS AOI2_status,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'AOI3' THEN m.status END) AS AOI3_status,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'EXAM80' THEN m.score END) AS EXAM80,
        MAX(CASE WHEN m.term = 'Term 3' AND m.aoi_label = 'EXAM80' THEN m.status END) AS EXAM80_status
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
    const [populationRows] = await pool.query(
      `
      SELECT id, stream
      FROM students
      WHERE class_level = ?
      `,
      [class_level]
    );
    const { classPopulation, streamPopulationByKey } = buildPopulationMeta(
      populationRows,
      normalizeStream
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

    const { classPositionById, streamRankMeta } = buildEligibleRankMeta(
      processedAll,
      "percent100",
      normalizeStream,
      isYearSubjectComplete
    );

    const withPositions = processedAll.map((row) => {
      const sKey = normalizeStream(row.stream);
      const streamMeta = streamRankMeta.get(sKey);
      const isEligible = classPositionById.has(row.student_id);
      return {
        ...row,
        class_position: classPositionById.get(row.student_id) || null,
        class_total: classPopulation,
        stream_position: streamMeta?.posById.get(row.student_id) || null,
        stream_total: streamPopulationByKey.get(sKey) || 0,
        position_status: isEligible ? "ELIGIBLE" : "INELIGIBLE",
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

/*
  MINI PROGRESS REPORT
  AOI 1 only, designed for parent updates.
*/
router.get("/mini-aoi1", authAdmin, async (req, res) => {
  try {
    const { year, term, class_level, stream, student_id } = req.query;
    const yearParam = year || new Date().getFullYear();
    const normalizedTerm = normalizeTermLabel(term);
    const normalizeStream = (value) => String(value || "").trim().toLowerCase();
    const wantedStream = normalizeStream(stream);

    if (!normalizedTerm || !class_level || !stream) {
      return res.status(400).json({
        message: "term, class_level and stream are required",
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        s.id AS student_id,
        s.name AS student_name,
        s.dob,
        s.class_level,
        s.stream,
        s.subjects AS registered_subjects,
        ta.subject,
        t.name AS teacher_name,
        MAX(CASE WHEN m.aoi_label = 'AOI1' THEN m.score END) AS AOI1,
        MAX(CASE WHEN m.aoi_label = 'AOI1' THEN m.status END) AS AOI1_status
      FROM students s
      JOIN marks m ON m.student_id = s.id
      JOIN teacher_assignments ta ON ta.id = m.assignment_id
      JOIN teachers t ON t.id = m.teacher_id
      WHERE m.year = ?
        AND m.term = ?
        AND m.aoi_label = 'AOI1'
        AND s.class_level = ?
      GROUP BY
        s.id,
        ta.subject,
        t.name
      ORDER BY
        s.name,
        ta.subject
      `,
      [yearParam, normalizedTerm, class_level]
    );

    const [populationRows] = await pool.query(
      `
      SELECT id, stream
      FROM students
      WHERE class_level = ?
      `,
      [class_level]
    );
    const { classPopulation, streamPopulationByKey } = buildPopulationMeta(
      populationRows,
      normalizeStream
    );

    const processedAll = (rows || []).map((row) => ({
      ...row,
      AOI1: hasRecordedScore(row.AOI1) ? Number(row.AOI1) : null,
      remark: formatMiniRemark(row.AOI1, row.AOI1_status),
      registered_subjects_count: (() => {
        if (Array.isArray(row.registered_subjects)) return row.registered_subjects.length;
        try {
          const parsed = JSON.parse(row.registered_subjects || "[]");
          return Array.isArray(parsed) ? parsed.length : 0;
        } catch {
          return 0;
        }
      })(),
    }));

    const isMiniSubjectComplete = (row) =>
      hasRecordedScore(row.AOI1) && !isMissedStatus(row.AOI1_status);

    const processedWithAverage = processedAll.map((row) => ({
      ...row,
      average: hasRecordedScore(row.AOI1) ? Number(Number(row.AOI1).toFixed(3)) : null,
    }));

    const { classPositionById, streamRankMeta } = buildEligibleRankMeta(
      processedWithAverage,
      "average",
      normalizeStream,
      isMiniSubjectComplete
    );

    const withPositions = processedAll.map((row) => {
      const streamKey = normalizeStream(row.stream);
      const streamMeta = streamRankMeta.get(streamKey);
      const isEligible = classPositionById.has(row.student_id);

      return {
        ...row,
        class_position: classPositionById.get(row.student_id) || null,
        class_total: classPopulation,
        stream_position: streamMeta?.posById.get(row.student_id) || null,
        stream_total: streamPopulationByKey.get(streamKey) || 0,
        position_status: isEligible ? "ELIGIBLE" : "INELIGIBLE",
      };
    });

    const processed = withPositions.filter((row) => {
      if (student_id) {
        return String(row.student_id) === String(student_id);
      }
      return normalizeStream(row.stream) === wantedStream;
    });

    res.json(processed);
  } catch (err) {
    console.error("Mini AOI1 report error:", err);
    res.status(500).json({ message: "Failed to load mini report data" });
  }
});

router.get("/readiness-summary", authAdmin, async (req, res) => {
  try {
    const term = normalizeTermLabel(req.query.term || "Term 1");
    const year = Number(req.query.year) || new Date().getFullYear();
    const classOrder = ["S1", "S2", "S3", "S4"];

    const [[oLevelTotalRow]] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM students
        WHERE class_level IN ('S1', 'S2', 'S3', 'S4')
          AND COALESCE(status, 'active') = 'active'
      `
    );

    const [[oLevelReadyRow]] = await pool.query(
      `
        SELECT COUNT(DISTINCT m.student_id) AS total
        FROM marks m
        JOIN students s ON s.id = m.student_id
        WHERE m.term = ?
          AND m.year = ?
          AND s.class_level IN ('S1', 'S2', 'S3', 'S4')
          AND COALESCE(s.status, 'active') = 'active'
      `,
      [term, year]
    );

    const [oLevelTotalsByClassRows] = await pool.query(
      `
        SELECT s.class_level, COUNT(*) AS total
        FROM students s
        WHERE s.class_level IN ('S1', 'S2', 'S3', 'S4')
          AND COALESCE(s.status, 'active') = 'active'
        GROUP BY s.class_level
      `
    );

    const [oLevelReadyByClassRows] = await pool.query(
      `
        SELECT s.class_level, COUNT(DISTINCT m.student_id) AS total
        FROM marks m
        JOIN students s ON s.id = m.student_id
        WHERE m.term = ?
          AND m.year = ?
          AND s.class_level IN ('S1', 'S2', 'S3', 'S4')
          AND COALESCE(s.status, 'active') = 'active'
        GROUP BY s.class_level
      `,
      [term, year]
    );

    const [[aLevelTotalRow]] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM alevel_learners
      `
    );

    const [[aLevelReadyRow]] = await pool.query(
      `
        SELECT COUNT(DISTINCT am.learner_id) AS total
        FROM alevel_marks am
        WHERE am.term = ?
          AND YEAR(am.created_at) = ?
      `,
      [term, year]
    );

    const oLevelTotal = Number(oLevelTotalRow?.total || 0);
    const oLevelReady = Number(oLevelReadyRow?.total || 0);
    const aLevelTotal = Number(aLevelTotalRow?.total || 0);
    const aLevelReady = Number(aLevelReadyRow?.total || 0);

    const percentOf = (value, total) =>
      total > 0 ? Math.round((Number(value || 0) / Number(total || 0)) * 100) : 0;

    const oLevelTotalByClass = new Map(
      (oLevelTotalsByClassRows || []).map((row) => [String(row.class_level || "").trim(), Number(row.total || 0)])
    );
    const oLevelReadyByClass = new Map(
      (oLevelReadyByClassRows || []).map((row) => [String(row.class_level || "").trim(), Number(row.total || 0)])
    );

    const oLevelByClass = classOrder.map((classLevel) => {
      const totalLearners = oLevelTotalByClass.get(classLevel) || 0;
      const readyLearners = oLevelReadyByClass.get(classLevel) || 0;
      const incompleteLearners = Math.max(0, totalLearners - readyLearners);
      return {
        classLevel,
        totalLearners,
        readyLearners,
        incompleteLearners,
        readinessPercent: percentOf(readyLearners, totalLearners),
      };
    });

    res.json({
      term,
      year,
      oLevel: {
        totalLearners: oLevelTotal,
        readyLearners: oLevelReady,
        incompleteLearners: Math.max(0, oLevelTotal - oLevelReady),
        readinessPercent: percentOf(oLevelReady, oLevelTotal),
        byClass: oLevelByClass,
      },
      aLevel: {
        totalLearners: aLevelTotal,
        readyLearners: aLevelReady,
        incompleteLearners: Math.max(0, aLevelTotal - aLevelReady),
        readinessPercent: percentOf(aLevelReady, aLevelTotal),
      },
      combined: {
        totalLearners: oLevelTotal + aLevelTotal,
        readyLearners: oLevelReady + aLevelReady,
        incompleteLearners: Math.max(0, oLevelTotal + aLevelTotal - (oLevelReady + aLevelReady)),
        readinessPercent: percentOf(oLevelReady + aLevelReady, oLevelTotal + aLevelTotal),
      },
    });
  } catch (err) {
    console.error("Admin readiness summary error:", err);
    res.status(500).json({ message: "Failed to load report readiness summary" });
  }
});

router.get("/readiness-incomplete-details", authAdmin, async (req, res) => {
  try {
    const term = normalizeTermLabel(req.query.term || "Term 1");
    const year = Number(req.query.year) || new Date().getFullYear();
    const level = String(req.query.level || "oLevel").trim();

    if (level === "aLevel") {
      const [learners] = await pool.query(
        `
          SELECT
            l.id,
            TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))) AS learner_name,
            l.gender,
            l.dob,
            l.stream,
            l.combination
          FROM alevel_learners l
          WHERE NOT EXISTS (
            SELECT 1
            FROM alevel_marks am
            WHERE am.learner_id = l.id
              AND am.term = ?
              AND YEAR(am.created_at) = ?
          )
          ORDER BY l.stream, learner_name
        `,
        [term, year]
      );

      if (learners.length === 0) {
        return res.json({ level: "aLevel", term, year, incompleteLearners: 0, rows: [] });
      }

      const learnerIds = learners.map((row) => row.id);
      const uniqueStreams = Array.from(new Set(learners.map((row) => String(row.stream || "").trim()).filter(Boolean)));

      const [learnerSubjects] = await pool.query(
        `
          SELECT
            als.learner_id,
            s.name AS subject
          FROM alevel_learner_subjects als
          JOIN alevel_subjects s ON s.id = als.subject_id
          WHERE als.learner_id IN (?)
          ORDER BY s.name
        `,
        [learnerIds]
      );

      const [streamAssignments] = uniqueStreams.length
        ? await pool.query(
            `
              SELECT
                ats.stream,
                s.name AS subject,
                ats.paper_label,
                t.name AS teacher_name
              FROM alevel_teacher_subjects ats
              JOIN alevel_subjects s ON s.id = ats.subject_id
              LEFT JOIN teachers t ON t.id = ats.teacher_id
              WHERE ats.stream IN (?)
              ORDER BY ats.stream, s.name, ats.paper_label
            `,
            [uniqueStreams]
          )
        : [[]];

      const subjectsByLearner = new Map();
      learnerSubjects.forEach((row) => {
        if (!subjectsByLearner.has(row.learner_id)) subjectsByLearner.set(row.learner_id, []);
        subjectsByLearner.get(row.learner_id).push(row.subject);
      });

      const assignmentsByStreamSubject = new Map();
      streamAssignments.forEach((row) => {
        const key = `${String(row.stream || "").trim().toLowerCase()}__${normalizeSubjectKey(row.subject)}`;
        if (!assignmentsByStreamSubject.has(key)) assignmentsByStreamSubject.set(key, []);
        assignmentsByStreamSubject.get(key).push({
          paperLabel: normalizePaperLabel(row.paper_label) || "Single",
          teacherName: row.teacher_name || "Unassigned teacher",
        });
      });

      const rows = learners.map((learner) => {
        const registeredSubjects = subjectsByLearner.get(learner.id) || [];
        const missingItems = [];

        if (registeredSubjects.length === 0) {
          missingItems.push({
            itemLabel: "No registered subjects",
            teacherName: "—",
            missingComponents: "MID, EOT",
            reason: "Learner has no registered A-Level subjects on file.",
          });
        } else {
          registeredSubjects.forEach((subject) => {
            const key = `${String(learner.stream || "").trim().toLowerCase()}__${normalizeSubjectKey(subject)}`;
            const assignmentPapers = assignmentsByStreamSubject.get(key) || [];

            if (assignmentPapers.length === 0) {
              missingItems.push({
                itemLabel: subject,
                teacherName: "—",
                missingComponents: "MID, EOT",
                reason: "No paper assignment exists for this subject in the learner's stream.",
              });
              return;
            }

            assignmentPapers.forEach((paper) => {
              missingItems.push({
                itemLabel:
                  paper.paperLabel && paper.paperLabel !== "Single"
                    ? `${subject} — ${paper.paperLabel}`
                    : subject,
                teacherName: paper.teacherName || "Unassigned teacher",
                missingComponents: "MID, EOT",
                reason: `No ${term} A-Level marks have been submitted for this paper.`,
              });
            });
          });
        }

        return {
          learnerId: learner.id,
          learnerName: learner.learner_name || `Learner ${learner.id}`,
          gender: learner.gender || "—",
          classLevel: String(learner.stream || "").trim().split(" ")[0] || "A-Level",
          stream: learner.stream || "—",
          combination: learner.combination || "—",
          missingItems,
        };
      });

      return res.json({
        level: "aLevel",
        term,
        year,
        incompleteLearners: rows.length,
        rows,
      });
    }

    const [learners] = await pool.query(
      `
        SELECT
          s.id,
          s.name,
          s.gender,
          s.dob,
          s.class_level,
          s.stream,
          s.subjects
        FROM students s
        WHERE s.class_level IN ('S1', 'S2', 'S3', 'S4')
          AND COALESCE(s.status, 'active') = 'active'
          AND NOT EXISTS (
            SELECT 1
            FROM marks m
            WHERE m.student_id = s.id
              AND m.term = ?
              AND m.year = ?
          )
        ORDER BY FIELD(s.class_level, 'S1', 'S2', 'S3', 'S4'), s.stream, s.name
      `,
      [term, year]
    );

    if (learners.length === 0) {
      return res.json({ level: "oLevel", term, year, incompleteLearners: 0, rows: [] });
    }

    const [assignments] = await pool.query(
      `
        SELECT
          ta.class_level,
          ta.stream,
          ta.subject,
          t.name AS teacher_name
        FROM teacher_assignments ta
        LEFT JOIN teachers t ON t.id = ta.teacher_id
        ORDER BY ta.class_level, ta.stream, ta.subject
      `
    );

    const assignmentMap = new Map();
    assignments.forEach((row) => {
      const groupKey = `${String(row.class_level || "").trim().toLowerCase()}__${String(row.stream || "").trim().toLowerCase()}`;
      if (!assignmentMap.has(groupKey)) assignmentMap.set(groupKey, new Map());
      assignmentMap.get(groupKey).set(normalizeSubjectKey(row.subject), {
        subjectLabel: row.subject,
        teacherName: row.teacher_name || "Unassigned teacher",
      });
    });

    const expectedComponents = O_LEVEL_COMPONENTS_BY_TERM[term] || ["AOI 1", "AOI 2", "AOI 3"];

    const rows = learners.map((learner) => {
      const registeredSubjects = parseStoredSubjects(learner.subjects);
      const groupKey = `${String(learner.class_level || "").trim().toLowerCase()}__${String(learner.stream || "").trim().toLowerCase()}`;
      const subjectAssignments = assignmentMap.get(groupKey) || new Map();
      const missingItems = [];

      if (registeredSubjects.length === 0) {
        missingItems.push({
          itemLabel: "No registered subjects",
          teacherName: "—",
          missingComponents: expectedComponents.join(", "),
          reason: "Learner has no registered subjects on file.",
        });
      } else {
        registeredSubjects.forEach((subject) => {
          const assignmentMeta = subjectAssignments.get(normalizeSubjectKey(subject));
          if (!assignmentMeta) {
            missingItems.push({
              itemLabel: subject,
              teacherName: "—",
              missingComponents: expectedComponents.join(", "),
              reason: `No teacher assignment exists for ${subject} in ${learner.class_level} ${learner.stream}.`,
            });
            return;
          }

          missingItems.push({
            itemLabel: assignmentMeta.subjectLabel || subject,
            teacherName: assignmentMeta.teacherName || "Unassigned teacher",
            missingComponents: expectedComponents.join(", "),
            reason: `No ${term} scores have been submitted for this learner in this subject.`,
          });
        });
      }

      return {
        learnerId: learner.id,
        learnerName: learner.name || `Learner ${learner.id}`,
        gender: learner.gender || "—",
        classLevel: learner.class_level || "—",
        stream: learner.stream || "—",
        missingItems,
      };
    });

    return res.json({
      level: "oLevel",
      term,
      year,
      incompleteLearners: rows.length,
      rows,
    });
  } catch (err) {
    console.error("Admin readiness incomplete details error:", err);
    res.status(500).json({ message: "Failed to load incomplete readiness details" });
  }
});

export default router;
