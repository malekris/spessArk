export const O_LEVEL_YEAR_ASSESSMENT_MODE = Object.freeze({
  STANDARD: "STANDARD_THREE_TERM3_AOIS",
  EMERGENCY_TWO_AOI: "EMERGENCY_TWO_TERM3_AOIS",
});

// The 2026 public-health interruption changed Term 3 assessment coverage only.
// Keeping the policy tied to the academic year preserves correct historical reprints
// while allowing 2027 and later reports to return to the standard model automatically.
export const EMERGENCY_TWO_AOI_ACADEMIC_YEAR = 2026;

const TERM_1_SCORE_KEYS = ["T1_AOI1", "T1_AOI2", "T1_AOI3"];
const TERM_2_SCORE_KEYS = ["T2_AOI1", "T2_AOI2", "T2_AOI3"];
const TERM_1_STATUS_KEYS = ["T1_AOI1_status", "T1_AOI2_status", "T1_AOI3_status"];
const TERM_2_STATUS_KEYS = ["T2_AOI1_status", "T2_AOI2_status", "T2_AOI3_status"];

const hasRecordedScore = (value) => value !== null && value !== undefined && value !== "";
const isMissedStatus = (value) => String(value || "").trim().toLowerCase() === "missed";
const toScore = (value) => {
  if (!hasRecordedScore(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const getOLevelYearAssessmentPolicy = (academicYear) => {
  const emergency = Number(academicYear) === EMERGENCY_TWO_AOI_ACADEMIC_YEAR;
  return emergency
    ? {
        mode: O_LEVEL_YEAR_ASSESSMENT_MODE.EMERGENCY_TWO_AOI,
        term3ScoreKeys: ["AOI1", "AOI2"],
        term3StatusKeys: ["AOI1_status", "AOI2_status"],
      }
    : {
        mode: O_LEVEL_YEAR_ASSESSMENT_MODE.STANDARD,
        term3ScoreKeys: ["AOI1", "AOI2", "AOI3"],
        term3StatusKeys: ["AOI1_status", "AOI2_status", "AOI3_status"],
      };
};

export const getOLevelMarkEntryComponents = (term, academicYear) => {
  if (String(term || "").trim() !== "Term 3") {
    return ["AOI1", "AOI2", "AOI3"];
  }

  const policy = getOLevelYearAssessmentPolicy(academicYear);
  return [...policy.term3ScoreKeys, "EXAM80"];
};

const fixedTermAverage = (row, scoreKeys) =>
  scoreKeys.reduce((sum, key) => sum + (toScore(row?.[key]) ?? 0), 0) / scoreKeys.length;

const recordedTermAverage = (row, scoreKeys) => {
  const scores = scoreKeys.map((key) => toScore(row?.[key])).filter((value) => value !== null);
  if (scores.length === 0) return null;
  return Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2));
};

export const calculateOLevelYearCoursework = (row, academicYear) => {
  const policy = getOLevelYearAssessmentPolicy(academicYear);
  const allExpectedKeys = [...TERM_1_SCORE_KEYS, ...TERM_2_SCORE_KEYS, ...policy.term3ScoreKeys];
  const hasAnyCoursework = allExpectedKeys.some((key) => toScore(row?.[key]) !== null);

  if (!hasAnyCoursework) {
    return {
      assessmentMode: policy.mode,
      term3Average: null,
      coursework20: null,
    };
  }

  // Each term contributes one-third of the /20 coursework component. In 2026,
  // Term 3's average is formed from AOI 1 and AOI 2, without treating AOI 3 as zero.
  const term1Average = fixedTermAverage(row, TERM_1_SCORE_KEYS);
  const term2Average = fixedTermAverage(row, TERM_2_SCORE_KEYS);
  const term3AverageForCoursework = fixedTermAverage(row, policy.term3ScoreKeys);
  const coursework20 = Number(
    (((term1Average + term2Average + term3AverageForCoursework) / 9) * 20).toFixed(2)
  );

  return {
    assessmentMode: policy.mode,
    term3Average: recordedTermAverage(row, policy.term3ScoreKeys),
    coursework20,
  };
};

export const isOLevelYearSubjectComplete = (row, academicYear) => {
  const policy = getOLevelYearAssessmentPolicy(academicYear);
  const requiredScoreKeys = [
    ...TERM_1_SCORE_KEYS,
    ...TERM_2_SCORE_KEYS,
    ...policy.term3ScoreKeys,
    "EXAM80",
  ];
  const requiredStatusKeys = [
    ...TERM_1_STATUS_KEYS,
    ...TERM_2_STATUS_KEYS,
    ...policy.term3StatusKeys,
    "EXAM80_status",
  ];

  return (
    requiredScoreKeys.every((key) => hasRecordedScore(row?.[key])) &&
    !requiredStatusKeys.some((key) => isMissedStatus(row?.[key]))
  );
};
