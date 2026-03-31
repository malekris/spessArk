import express from "express";
import authAdmin from "../middleware/authAdmin.js";
import { pool, readMarksEntryLocks } from "../server.js";
import {
  buildLiveAdminYearSnapshot,
  getCurrentAcademicYear,
  listAdminSnapshotYears,
  readAdminYearSnapshot,
} from "../services/adminYearSnapshotService.js";

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

const toPercent = (value, total) =>
  total > 0 ? Math.max(0, Math.min(100, Math.round((Number(value || 0) / Number(total || 0)) * 100))) : 0;

const normalizeAoiKey = (value = "") => {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "AOI 1" || raw === "AOI1") return "AOI1";
  if (raw === "AOI 2" || raw === "AOI2") return "AOI2";
  if (raw === "AOI 3" || raw === "AOI3") return "AOI3";
  if (raw === "/80" || raw === "80" || raw === "EXAM80") return "EXAM80";
  if (raw === "MID" || raw === "MIDTERM") return "MID";
  if (raw === "EOT" || raw === "END OF TERM") return "EOT";
  return raw;
};

const safeAnalyticsQuery = async (executor, sql, params = []) => {
  try {
    const [rows] = await executor.query(sql, params);
    return rows || [];
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE" || err?.code === "ER_BAD_FIELD_ERROR") {
      return [];
    }
    throw err;
  }
};

const deriveALevelClass = (stream = "") => {
  const raw = String(stream || "").trim();
  if (!raw) return "A-Level";
  const [firstToken] = raw.split(/\s+/);
  return firstToken || "A-Level";
};

const sortClassLevels = (classLevels = [], preferredOrder = []) => {
  const preferred = new Map(preferredOrder.map((value, index) => [value, index]));
  return Array.from(new Set(classLevels.filter(Boolean))).sort((a, b) => {
    const aRank = preferred.has(a) ? preferred.get(a) : Number.MAX_SAFE_INTEGER;
    const bRank = preferred.has(b) ? preferred.get(b) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  });
};

const O_LEVEL_HEATMAP_OPTIONS = [
  { value: "AOI1", label: "AOI 1" },
  { value: "AOI2", label: "AOI 2" },
  { value: "AOI3", label: "AOI 3" },
  { value: "EXAM80", label: "/80" },
];

const A_LEVEL_HEATMAP_OPTIONS = [
  { value: "MID", label: "MID" },
  { value: "EOT", label: "EOT" },
];

const buildDashboardAssessmentCompliance = ({
  oLevelAssignments = [],
  aLevelAssignments = [],
  marksSets = [],
  aLevelMarksSets = [],
  term,
  year,
}) => {
  const filteredOLevelRows = marksSets.filter(
    (row) => normalizeTermLabel(row.term) === normalizeTermLabel(term) && Number(row.year) === Number(year)
  );
  const filteredALevelRows = aLevelMarksSets.filter(
    (row) => normalizeTermLabel(row.term) === normalizeTermLabel(term) && Number(row.year) === Number(year)
  );

  const oLevelSubmittedAssignments = new Set(filteredOLevelRows.map((row) => row.assignment_id));
  const oLevelTotal = oLevelAssignments.length;
  const aLevelSubmittedAssignments = new Set(filteredALevelRows.map((row) => row.assignment_id));
  const aLevelTotal = aLevelAssignments.length;
  const aLevelExpectedComponents = aLevelTotal * 2;

  const oLevelAoiCounts = Object.fromEntries(
    O_LEVEL_HEATMAP_OPTIONS.map(({ value }) => [
      value,
      new Set(
        filteredOLevelRows
          .filter((row) => normalizeAoiKey(row.aoi_label) === value)
          .map((row) => row.assignment_id)
      ).size,
    ])
  );

  const oLevelAoiRates = Object.fromEntries(
    O_LEVEL_HEATMAP_OPTIONS.map(({ value }) => [value, toPercent(oLevelAoiCounts[value], oLevelTotal)])
  );

  const aLevelSubmittedComponents = new Set(
    filteredALevelRows
      .filter((row) => ["MID", "EOT"].includes(normalizeAoiKey(row.aoi_label)))
      .map((row) => `${row.assignment_id}__${normalizeAoiKey(row.aoi_label)}`)
  );

  return {
    oLevelSubmitted: oLevelSubmittedAssignments.size,
    oLevelPending: Math.max(0, oLevelTotal - oLevelSubmittedAssignments.size),
    oLevelAoiCounts,
    oLevelAoiRates,
    aLevelSubmitted: aLevelSubmittedAssignments.size,
    aLevelPending: Math.max(0, aLevelTotal - aLevelSubmittedAssignments.size),
    aLevelMidEotRate: toPercent(aLevelSubmittedComponents.size, aLevelExpectedComponents),
    oLevelTotal,
    aLevelTotal,
    aLevelExpectedComponents,
  };
};

const buildTeacherSubmissionHeatmap = ({
  oLevelAssignments = [],
  aLevelAssignments = [],
  marksSets = [],
  aLevelMarksSets = [],
  term,
  year,
}) => {
  const buildRows = (classLevels, assignments, marksRows, componentOptions) =>
    classLevels.map((classLevel) => {
      const expectedAssignments = assignments.filter((row) => row.classLevel === classLevel);
      const totalAssignments = expectedAssignments.length;
      const cells = componentOptions.map((component) => {
        const submitted = new Set(
          marksRows
            .filter(
              (row) =>
                row.classLevel === classLevel && normalizeAoiKey(row.aoi_label) === component.value
            )
            .map((row) => row.assignment_id)
        ).size;

        return {
          ...component,
          submitted,
          total: totalAssignments,
          rate: toPercent(submitted, totalAssignments),
        };
      });

      return { classLevel, totalAssignments, cells };
    });

  const filteredOLevelMarks = marksSets
    .filter((row) => normalizeTermLabel(row.term) === normalizeTermLabel(term) && Number(row.year) === Number(year))
    .map((row) => ({ ...row, classLevel: row.class_level }));

  const filteredALevelMarks = aLevelMarksSets
    .filter((row) => normalizeTermLabel(row.term) === normalizeTermLabel(term) && Number(row.year) === Number(year))
    .map((row) => ({ ...row, classLevel: deriveALevelClass(row.stream) }));

  const oLevelAssignmentRows = oLevelAssignments.map((row) => ({ ...row, classLevel: row.class_level }));
  const aLevelAssignmentRows = aLevelAssignments.map((row) => ({ ...row, classLevel: deriveALevelClass(row.stream) }));
  const aLevelClassLevels = sortClassLevels(
    [
      "S5",
      "S6",
      ...aLevelAssignmentRows.map((row) => row.classLevel),
      ...filteredALevelMarks.map((row) => row.classLevel),
    ],
    ["S5", "S6"]
  );

  return {
    oLevelRows: buildRows(["S1", "S2", "S3", "S4"], oLevelAssignmentRows, filteredOLevelMarks, O_LEVEL_HEATMAP_OPTIONS),
    aLevelRows: buildRows(aLevelClassLevels, aLevelAssignmentRows, filteredALevelMarks, A_LEVEL_HEATMAP_OPTIONS),
  };
};

const buildReportReadinessSummaryFromSources = async ({
  executor,
  term,
  year,
  students = [],
  aLevelLearners = [],
}) => {
  const activeStudents = students.filter(
    (student) =>
      ["S1", "S2", "S3", "S4"].includes(String(student.class_level || "").trim()) &&
      String(student.status || "active").trim().toLowerCase() === "active"
  );

  const oLevelReadyRows = await safeAnalyticsQuery(
    executor,
    `
      SELECT DISTINCT student_id
      FROM marks
      WHERE term = ?
        AND year = ?
    `,
    [normalizeTermLabel(term), Number(year)]
  );

  const aLevelReadyRows = await safeAnalyticsQuery(
    executor,
    `
      SELECT DISTINCT learner_id
      FROM alevel_marks
      WHERE term = ?
        AND YEAR(created_at) = ?
    `,
    [normalizeTermLabel(term), Number(year)]
  );

  const readyStudentIds = new Set((oLevelReadyRows || []).map((row) => Number(row.student_id)));
  const readyALevelIds = new Set((aLevelReadyRows || []).map((row) => Number(row.learner_id)));

  const oLevelByClass = ["S1", "S2", "S3", "S4"].map((classLevel) => {
    const classStudents = activeStudents.filter((student) => student.class_level === classLevel);
    const readyLearners = classStudents.filter((student) => readyStudentIds.has(Number(student.id))).length;
    const totalLearners = classStudents.length;
    return {
      classLevel,
      totalLearners,
      readyLearners,
      incompleteLearners: Math.max(0, totalLearners - readyLearners),
      readinessPercent: toPercent(readyLearners, totalLearners),
    };
  });

  const oLevelReady = activeStudents.filter((student) => readyStudentIds.has(Number(student.id))).length;
  const aLevelReady = aLevelLearners.filter((learner) => readyALevelIds.has(Number(learner.id))).length;
  const oLevelTotal = activeStudents.length;
  const aLevelTotal = aLevelLearners.length;

  return {
    term: normalizeTermLabel(term),
    year: Number(year),
    oLevel: {
      totalLearners: oLevelTotal,
      readyLearners: oLevelReady,
      incompleteLearners: Math.max(0, oLevelTotal - oLevelReady),
      readinessPercent: toPercent(oLevelReady, oLevelTotal),
      byClass: oLevelByClass,
    },
    aLevel: {
      totalLearners: aLevelTotal,
      readyLearners: aLevelReady,
      incompleteLearners: Math.max(0, aLevelTotal - aLevelReady),
      readinessPercent: toPercent(aLevelReady, aLevelTotal),
    },
    combined: {
      totalLearners: oLevelTotal + aLevelTotal,
      readyLearners: oLevelReady + aLevelReady,
      incompleteLearners: Math.max(0, oLevelTotal + aLevelTotal - (oLevelReady + aLevelReady)),
      readinessPercent: toPercent(oLevelReady + aLevelReady, oLevelTotal + aLevelTotal),
    },
  };
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

router.get("/dashboard-years", authAdmin, async (req, res) => {
  try {
    const currentAcademicYear = await getCurrentAcademicYear(pool);
    const years = await listAdminSnapshotYears(pool);

    res.json({
      currentAcademicYear,
      years: years.map((year) => ({
        value: year,
        label: `${year}`,
        mode: Number(year) === Number(currentAcademicYear) ? "live" : "snapshot",
      })),
    });
  } catch (err) {
    console.error("Admin dashboard years error:", err);
    res.status(500).json({ message: "Failed to load dashboard years" });
  }
});

router.get("/dashboard-snapshot", authAdmin, async (req, res) => {
  try {
    const requestedYear = Number(req.query.year);
    const currentAcademicYear = await getCurrentAcademicYear(pool);
    const targetYear =
      Number.isInteger(requestedYear) && requestedYear > 0 ? requestedYear : currentAcademicYear;

    let snapshotSource = null;
    let mode = "snapshot";

    if (Number(targetYear) === Number(currentAcademicYear)) {
      snapshotSource = await buildLiveAdminYearSnapshot(pool, currentAcademicYear);
      mode = "live";
    } else {
      snapshotSource = await readAdminYearSnapshot(pool, targetYear);
      if (!snapshotSource) {
        return res.status(404).json({
          message: `No frozen admin snapshot is available for ${targetYear}. Snapshot history starts from the years captured after this feature was introduced.`,
        });
      }
    }

    const term = normalizeTermLabel(snapshotSource.operationalTerm || "Term 1");
    const year = Number(snapshotSource.academicYear || targetYear);

    const marksSets = await safeAnalyticsQuery(
      pool,
      `
        SELECT
          m.assignment_id,
          ta.class_level,
          ta.stream,
          ta.subject,
          t.name AS teacher_name,
          m.term,
          m.year,
          m.aoi_label,
          COUNT(m.id) AS marks_count,
          MAX(m.updated_at) AS submitted_at
        FROM marks m
        JOIN teacher_assignments ta ON m.assignment_id = ta.id
        LEFT JOIN teachers t ON m.teacher_id = t.id
        WHERE m.year = ?
        GROUP BY
          m.assignment_id,
          ta.class_level,
          ta.stream,
          ta.subject,
          t.name,
          m.term,
          m.year,
          m.aoi_label
        ORDER BY m.year DESC, m.term DESC
      `,
      [year]
    );

    const aLevelMarksSets = await safeAnalyticsQuery(
      pool,
      `
        SELECT
          am.assignment_id,
          ats.stream,
          ats.paper_label,
          s.name AS subject,
          t.name AS teacher_name,
          am.term,
          YEAR(am.created_at) AS year,
          CASE
            WHEN UPPER(TRIM(et.name)) IN ('MID', 'MIDTERM') THEN 'MID'
            ELSE 'EOT'
          END AS aoi_label,
          COUNT(am.id) AS marks_count,
          MAX(am.created_at) AS submitted_at
        FROM alevel_marks am
        JOIN alevel_teacher_subjects ats ON ats.id = am.assignment_id
        JOIN alevel_subjects s ON s.id = ats.subject_id
        JOIN alevel_exam_types et ON et.id = am.exam_id
        LEFT JOIN teachers t ON t.id = ats.teacher_id
        WHERE YEAR(am.created_at) = ?
        GROUP BY
          am.assignment_id,
          ats.stream,
          ats.paper_label,
          s.name,
          t.name,
          am.term,
          YEAR(am.created_at),
          CASE
            WHEN UPPER(TRIM(et.name)) IN ('MID', 'MIDTERM') THEN 'MID'
            ELSE 'EOT'
          END
        ORDER BY YEAR(am.created_at) DESC, am.term DESC
      `,
      [year]
    );

    const overviewMarksLocks = await readMarksEntryLocks(term, year);
    const reportReadinessSummary = await buildReportReadinessSummaryFromSources({
      executor: pool,
      term,
      year,
      students: snapshotSource.students || [],
      aLevelLearners: snapshotSource.aLevelLearners || [],
    });

    const assessmentCompliance = buildDashboardAssessmentCompliance({
      oLevelAssignments: snapshotSource.oLevelAssignments || [],
      aLevelAssignments: snapshotSource.aLevelAssignments || [],
      marksSets,
      aLevelMarksSets,
      term,
      year,
    });

    const teacherSubmissionHeatmap = buildTeacherSubmissionHeatmap({
      oLevelAssignments: snapshotSource.oLevelAssignments || [],
      aLevelAssignments: snapshotSource.aLevelAssignments || [],
      marksSets,
      aLevelMarksSets,
      term,
      year,
    });

    res.json({
      academicYear: year,
      currentAcademicYear,
      mode,
      capturedAt: snapshotSource.capturedAt || null,
      operationalTerm: term,
      students: snapshotSource.students || [],
      teachers: snapshotSource.teachers || [],
      oLevelAssignments: snapshotSource.oLevelAssignments || [],
      aLevelLearners: snapshotSource.aLevelLearners || [],
      aLevelAssignments: snapshotSource.aLevelAssignments || [],
      marksSets,
      aLevelMarksSets,
      overviewMarksLocks,
      reportReadinessSummary,
      assessmentCompliance,
      teacherSubmissionHeatmap,
    });
  } catch (err) {
    console.error("Admin dashboard snapshot error:", err);
    res.status(500).json({ message: "Failed to load dashboard snapshot" });
  }
});

router.get("/readiness-summary", authAdmin, async (req, res) => {
  try {
    const term = normalizeTermLabel(req.query.term || "Term 1");
    const year = Number(req.query.year) || new Date().getFullYear();
    const currentAcademicYear = await getCurrentAcademicYear(pool);

    let students = [];
    let aLevelLearners = [];

    if (Number(year) === Number(currentAcademicYear)) {
      const liveSnapshot = await buildLiveAdminYearSnapshot(pool, currentAcademicYear);
      students = liveSnapshot.students || [];
      aLevelLearners = liveSnapshot.aLevelLearners || [];
    } else {
      const archivedSnapshot = await readAdminYearSnapshot(pool, year);
      if (!archivedSnapshot) {
        return res.status(404).json({
          message: `No frozen admin snapshot is available for ${year}.`,
        });
      }
      students = archivedSnapshot.students || [];
      aLevelLearners = archivedSnapshot.aLevelLearners || [];
    }

    const summary = await buildReportReadinessSummaryFromSources({
      executor: pool,
      term,
      year,
      students,
      aLevelLearners,
    });

    res.json(summary);
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
    const currentAcademicYear = await getCurrentAcademicYear(pool);
    let snapshotSource = null;

    if (Number(year) === Number(currentAcademicYear)) {
      snapshotSource = await buildLiveAdminYearSnapshot(pool, currentAcademicYear);
    } else {
      snapshotSource = await readAdminYearSnapshot(pool, year);
      if (!snapshotSource) {
        return res.status(404).json({ message: `No frozen admin snapshot is available for ${year}.` });
      }
    }

    if (level === "aLevel") {
      const [readyRows] = await pool.query(
        `
          SELECT DISTINCT learner_id
          FROM alevel_marks
          WHERE term = ?
            AND YEAR(created_at) = ?
        `,
        [term, year]
      );

      const readyLearnerIds = new Set((readyRows || []).map((row) => Number(row.learner_id)));
      const learners = (snapshotSource.aLevelLearners || []).filter(
        (learner) => !readyLearnerIds.has(Number(learner.id))
      );

      if (learners.length === 0) {
        return res.json({ level: "aLevel", term, year, incompleteLearners: 0, rows: [] });
      }

      const assignmentsByStreamSubject = new Map();
      (snapshotSource.aLevelAssignments || []).forEach((row) => {
        const key = `${String(row.stream || "").trim().toLowerCase()}__${normalizeSubjectKey(row.subject)}`;
        if (!assignmentsByStreamSubject.has(key)) assignmentsByStreamSubject.set(key, []);
        assignmentsByStreamSubject.get(key).push({
          paperLabel: normalizePaperLabel(row.paper_label) || "Single",
          teacherName: row.teacher_name || "Unassigned teacher",
        });
      });

      const rows = learners.map((learner) => {
        const registeredSubjects = parseStoredSubjects(learner.subjects);
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
          learnerName: learner.name || `Learner ${learner.id}`,
          gender: learner.gender || "—",
          classLevel: deriveALevelClass(learner.stream),
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

    const [readyRows] = await pool.query(
      `
        SELECT DISTINCT student_id
        FROM marks
        WHERE term = ?
          AND year = ?
      `,
      [term, year]
    );

    const readyStudentIds = new Set((readyRows || []).map((row) => Number(row.student_id)));
    const learners = (snapshotSource.students || []).filter(
      (student) =>
        ["S1", "S2", "S3", "S4"].includes(String(student.class_level || "").trim()) &&
        String(student.status || "active").trim().toLowerCase() === "active" &&
        !readyStudentIds.has(Number(student.id))
    );

    if (learners.length === 0) {
      return res.json({ level: "oLevel", term, year, incompleteLearners: 0, rows: [] });
    }

    const assignmentMap = new Map();
    (snapshotSource.oLevelAssignments || []).forEach((row) => {
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
