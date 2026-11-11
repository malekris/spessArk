const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const OPTIONAL_SUBJECT_ALIASES = new Map([
  ["ict", "Information and Communication Technology"],
  ["informationandcommunicationtechnology", "Information and Communication Technology"],
  ["agriculture", "Agriculture"],
  ["physicaleducation", "Physical Education"],
  ["pe", "Physical Education"],
  ["art", "Art"],
  ["luganda", "Luganda"],
  ["literature", "Literature"],
  ["christianreligiouseducation", "Christian Religious Education"],
  ["cre", "Christian Religious Education"],
  ["entrepreneurship", "Entrepreneurship"],
  ["ent", "Entrepreneurship"],
  ["ire", "IRE"],
  ["islamicreligiouseducation", "IRE"],
  ["kiswahili", "Kiswahili"],
]);

export const getCombinedOptionalSubjectKey = (value) => {
  const key = normalizeKey(value);
  const canonicalSubject = OPTIONAL_SUBJECT_ALIASES.get(key);
  return canonicalSubject ? normalizeKey(canonicalSubject) : null;
};

export const isCombinedOptionalClass = (value) => ["S3", "S4"].includes(
  String(value || "").trim().toUpperCase()
);

export function validateCombinedOLevelOptionalAssignments(rows = []) {
  const assignments = Array.isArray(rows) ? rows : [];
  if (assignments.length !== 2) {
    return { valid: false, message: "Combined optional subjects require exactly two assignments." };
  }

  const ids = new Set(assignments.map((row) => Number(row.id)));
  const teacherIds = new Set(assignments.map((row) => Number(row.teacher_id)));
  const classLevels = new Set(
    assignments.map((row) => String(row.class_level || "").trim().toUpperCase())
  );
  const subjectKeys = new Set(
    assignments.map((row) => getCombinedOptionalSubjectKey(row.subject))
  );
  const streams = new Set(assignments.map((row) => String(row.stream || "").trim()));

  if (ids.size !== 2 || teacherIds.size !== 1) {
    return { valid: false, message: "Optional assignments must be distinct and owned by one teacher." };
  }
  if (
    classLevels.size !== 1 ||
    assignments.some((row) => !isCombinedOptionalClass(row.class_level))
  ) {
    return { valid: false, message: "Only S3 or S4 optional assignments can be combined." };
  }
  if (subjectKeys.size !== 1 || subjectKeys.has(null)) {
    return { valid: false, message: "Only matching optional subjects can be combined." };
  }
  if (streams.size !== 2 || Array.from(streams).some((stream) => !stream)) {
    return { valid: false, message: "Combined optional assignments require two distinct streams." };
  }

  const orderedAssignments = [...assignments].sort((a, b) =>
    String(a.stream).localeCompare(String(b.stream))
  );

  return {
    valid: true,
    classLevel: Array.from(classLevels)[0],
    teacherId: Number(assignments[0].teacher_id),
    subject: assignments[0].subject,
    subjectKey: Array.from(subjectKeys)[0],
    assignments: orderedAssignments,
    assignmentByStream: new Map(
      orderedAssignments.map((assignment) => [assignment.stream, Number(assignment.id)])
    ),
    subjectByStream: new Map(
      orderedAssignments.map((assignment) => [assignment.stream, assignment.subject])
    ),
  };
}
