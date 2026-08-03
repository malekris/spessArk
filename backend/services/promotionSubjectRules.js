export const O_LEVEL_CORE_SUBJECTS = Object.freeze([
  "English",
  "Mathematics",
  "Physics",
  "Biology",
  "Chemistry",
  "History",
  "Geography",
]);

const normalizeSubjectKey = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const CORE_SUBJECT_KEYS = new Set(O_LEVEL_CORE_SUBJECTS.map(normalizeSubjectKey));

export function normalizeStudentSubjects(value) {
  let source = value;

  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      source = source.split(",");
    }
  }

  if (!Array.isArray(source)) return [];

  const seen = new Set();
  return source.reduce((subjects, item) => {
    const subject = String(item || "").trim().replace(/\s+/g, " ");
    const key = normalizeSubjectKey(subject);
    if (!key || seen.has(key)) return subjects;
    seen.add(key);
    subjects.push(subject);
    return subjects;
  }, []);
}

export function getS2TransitionProfile(currentSubjects) {
  const normalizedSubjects = normalizeStudentSubjects(currentSubjects);
  const optionalSubjects = normalizedSubjects.filter(
    (subject) => !CORE_SUBJECT_KEYS.has(normalizeSubjectKey(subject))
  );

  return {
    currentSubjects: normalizedSubjects,
    coreSubjects: [...O_LEVEL_CORE_SUBJECTS],
    optionalSubjects,
  };
}

export function validateS2SubjectSelection(currentSubjects, keptSubjects) {
  const profile = getS2TransitionProfile(currentSubjects);
  const selected = normalizeStudentSubjects(keptSubjects);
  const availableByKey = new Map(
    profile.optionalSubjects.map((subject) => [normalizeSubjectKey(subject), subject])
  );
  const invalidSubjects = selected.filter(
    (subject) => !availableByKey.has(normalizeSubjectKey(subject))
  );
  const normalizedKeptSubjects = selected
    .map((subject) => availableByKey.get(normalizeSubjectKey(subject)))
    .filter(Boolean);

  if (normalizedKeptSubjects.length !== 2 || invalidSubjects.length > 0) {
    return {
      valid: false,
      message:
        invalidSubjects.length > 0
          ? "Retained subjects must come from the learner's current optional subjects."
          : "Exactly two optional subjects must be retained for S3.",
      invalidSubjects,
      ...profile,
      keptSubjects: normalizedKeptSubjects,
      resultingSubjects: [],
    };
  }

  return {
    valid: true,
    message: "S3 subject profile is ready.",
    invalidSubjects: [],
    ...profile,
    keptSubjects: normalizedKeptSubjects,
    resultingSubjects: [...O_LEVEL_CORE_SUBJECTS, ...normalizedKeptSubjects],
  };
}
