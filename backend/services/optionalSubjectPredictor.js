import {
  normalizeRegisteredSubjectKey,
  parseStoredSubjects,
} from "./reportSubjectRegistration.js";

export const OPTIONAL_SUBJECT_CATEGORIES = Object.freeze({
  A: Object.freeze([
    "Physical Education",
    "ICT",
    "Art",
    "Entrepreneurship",
    "Agriculture",
  ]),
  B: Object.freeze([
    "Luganda",
    "Kiswahili",
    "Christian Religious Education",
    "IRE",
    "Literature",
  ]),
});

export const OPTIONAL_SUBJECT_RECOMMENDATION_THRESHOLD = 1.5;
export const OPTIONAL_SUBJECT_LOW_CONFIDENCE_THRESHOLD = 1.4;
export const ENTREPRENEURSHIP_PREDICTOR_AVERAGE_CAP = 2.5;
export const KISWAHILI_PREDICTOR_AVERAGE_CAP = 2.8;

const SUBJECT_PREDICTOR_AVERAGE_CAPS = new Map([
  ["Entrepreneurship", ENTREPRENEURSHIP_PREDICTOR_AVERAGE_CAP],
  ["Kiswahili", KISWAHILI_PREDICTOR_AVERAGE_CAP],
]);

const SUBJECT_ALIASES = new Map([
  ["pe", "Physical Education"],
  ["physicaleducation", "Physical Education"],
  ["ict", "ICT"],
  ["art", "Art"],
  ["entrepreneurship", "Entrepreneurship"],
  ["ent", "Entrepreneurship"],
  ["agriculture", "Agriculture"],
  ["luganda", "Luganda"],
  ["kiswahili", "Kiswahili"],
  ["christianreligiouseducation", "Christian Religious Education"],
  ["cre", "Christian Religious Education"],
  ["ire", "IRE"],
  ["islamicreligiouseducation", "IRE"],
  ["literature", "Literature"],
]);

const normalizeTerm = (value) => {
  const compact = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["1", "term1", "i", "termi"].includes(compact)) return "Term 1";
  if (["2", "term2", "ii", "termii", "term1i"].includes(compact)) return "Term 2";
  if (["3", "term3", "iii", "termiii", "term1ii"].includes(compact)) return "Term 3";
  return "";
};

const normalizeAoi = (value) => {
  const compact = String(value || "").trim().toUpperCase().replace(/[\s_-]+/g, "");
  if (["AOI1", "AOI2", "AOI3"].includes(compact)) return compact;
  return "";
};

export const normalizeOptionalSubject = (value) => {
  const normalized = normalizeRegisteredSubjectKey(value);
  return SUBJECT_ALIASES.get(normalized) || null;
};

const averageScores = (values = []) => {
  if (!values.length) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(average.toFixed(2));
};

const rankCandidates = (subjects, scoreMap) =>
  subjects
    .map((subject) => {
      const scores = scoreMap.get(subject) || [];
      const actualAverage = averageScores(scores);
      const predictorCap = SUBJECT_PREDICTOR_AVERAGE_CAPS.get(subject) ?? null;
      const capApplied = actualAverage !== null && predictorCap !== null && actualAverage > predictorCap;
      const average = capApplied ? predictorCap : actualAverage;
      return {
        subject,
        average,
        actualAverage,
        predictorCap,
        capApplied,
        scoreCount: scores.length,
        recommended: scores.length > 0 && average >= OPTIONAL_SUBJECT_RECOMMENDATION_THRESHOLD,
      };
    })
    .sort((left, right) => {
      const leftAverage = left.average ?? Number.NEGATIVE_INFINITY;
      const rightAverage = right.average ?? Number.NEGATIVE_INFINITY;
      if (rightAverage !== leftAverage) return rightAverage - leftAverage;
      if (right.scoreCount !== left.scoreCount) return right.scoreCount - left.scoreCount;
      return left.subject.localeCompare(right.subject);
    });

const toSelection = (category, candidates) => {
  const selected = candidates[0] || null;
  if (!selected) {
    return {
      category,
      subject: null,
      average: null,
      scoreCount: 0,
      confidence: "missing_registration",
      lowConfidence: true,
      reason: `No registered Category ${category} subject is available.`,
      candidates: [],
    };
  }

  const noScores = selected.average === null;
  const lowConfidence = noScores || selected.average < OPTIONAL_SUBJECT_LOW_CONFIDENCE_THRESHOLD;
  const confidence = lowConfidence
    ? "low"
    : selected.average >= OPTIONAL_SUBJECT_RECOMMENDATION_THRESHOLD
      ? "recommended"
      : "borderline";

  return {
    category,
    ...selected,
    confidence,
    lowConfidence,
    reason: noScores
      ? "No usable Term 1, Term 2 or Term 3 AOI scores were found."
      : lowConfidence
        ? `Best available average is below ${OPTIONAL_SUBJECT_LOW_CONFIDENCE_THRESHOLD.toFixed(1)}.`
        : selected.average < OPTIONAL_SUBJECT_RECOMMENDATION_THRESHOLD
          ? `Best available average is below the ${OPTIONAL_SUBJECT_RECOMMENDATION_THRESHOLD.toFixed(1)} recommendation threshold.`
          : "Meets the recommendation threshold.",
    candidates,
  };
};

export function buildOptionalSubjectPredictions({ learners = [], marks = [] } = {}) {
  // Highest mark id wins when historical teacher handovers left duplicate rows
  // for the same learner, subject, term and AOI.
  const latestMarks = new Map();
  [...marks]
    .sort((left, right) => Number(right.id || 0) - Number(left.id || 0))
    .forEach((mark) => {
      const learnerId = Number(mark.student_id);
      const subject = normalizeOptionalSubject(mark.subject);
      const term = normalizeTerm(mark.term);
      const aoi = normalizeAoi(mark.aoi_label);
      if (!learnerId || !subject || !term || !aoi) return;

      const key = `${learnerId}::${subject}::${term}::${aoi}`;
      if (!latestMarks.has(key)) latestMarks.set(key, { ...mark, subject, term, aoi });
    });

  return learners.map((learner) => {
    const learnerId = Number(learner.id);
    const offeredSubjects = Array.from(
      new Set(parseStoredSubjects(learner.subjects).map(normalizeOptionalSubject).filter(Boolean))
    );
    const offeredSet = new Set(offeredSubjects);
    const scoreMap = new Map();

    for (const mark of latestMarks.values()) {
      if (Number(mark.student_id) !== learnerId || !offeredSet.has(mark.subject)) continue;
      if (String(mark.status || "").trim().toLowerCase() === "missed") continue;
      const score = Number(mark.score);
      if (!Number.isFinite(score) || score < 0 || score > 3) continue;
      if (!scoreMap.has(mark.subject)) scoreMap.set(mark.subject, []);
      scoreMap.get(mark.subject).push(score);
    }

    const categoryACandidates = rankCandidates(
      OPTIONAL_SUBJECT_CATEGORIES.A.filter((subject) => offeredSet.has(subject)),
      scoreMap
    );
    const categoryBCandidates = rankCandidates(
      OPTIONAL_SUBJECT_CATEGORIES.B.filter((subject) => offeredSet.has(subject)),
      scoreMap
    );
    const categoryA = toSelection("A", categoryACandidates);
    const categoryB = toSelection("B", categoryBCandidates);
    const selections = [categoryA, categoryB];

    return {
      id: learnerId,
      name: String(learner.name || "").trim(),
      stream: String(learner.stream || "").trim(),
      offeredSubjects,
      categoryA,
      categoryB,
      selectedSubjects: selections.map((selection) => selection.subject).filter(Boolean),
      complete: selections.every((selection) => Boolean(selection.subject)),
      lowConfidence: selections.some((selection) => selection.lowConfidence),
      flags: selections
        .filter((selection) => selection.lowConfidence)
        .map((selection) => ({ category: selection.category, reason: selection.reason })),
    };
  });
}
