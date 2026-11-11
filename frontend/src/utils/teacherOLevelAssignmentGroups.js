const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const OPTIONAL_SUBJECT_KEYS = new Map([
  ["ict", "ict"],
  ["informationandcommunicationtechnology", "ict"],
  ["agriculture", "agriculture"],
  ["physicaleducation", "physicaleducation"],
  ["pe", "physicaleducation"],
  ["art", "art"],
  ["luganda", "luganda"],
  ["literature", "literature"],
  ["christianreligiouseducation", "christianreligiouseducation"],
  ["cre", "christianreligiouseducation"],
  ["entrepreneurship", "entrepreneurship"],
  ["ent", "entrepreneurship"],
  ["ire", "ire"],
  ["islamicreligiouseducation", "ire"],
  ["kiswahili", "kiswahili"],
]);

const getOptionalSubjectKey = (value) => OPTIONAL_SUBJECT_KEYS.get(normalizeKey(value)) || null;

export const isS3S4OptionalTeacherAssignment = (assignment) =>
  ["S3", "S4"].includes(String(assignment?.class_level || "").trim().toUpperCase()) &&
  Boolean(getOptionalSubjectKey(assignment?.subject));

/** Combine only complete two-stream S3/S4 optional-subject pairs. */
export function groupOLevelOptionalTeacherAssignments(assignments = []) {
  const rows = Array.isArray(assignments) ? assignments : [];
  const candidates = new Map();

  rows.forEach((assignment) => {
    if (!isS3S4OptionalTeacherAssignment(assignment)) return;
    const classLevel = String(assignment.class_level).trim().toUpperCase();
    const subjectKey = getOptionalSubjectKey(assignment.subject);
    const key = `${classLevel}:${subjectKey}`;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(assignment);
  });

  const consumedIds = new Set();
  const combinedByFirstId = new Map();

  candidates.forEach((entries) => {
    const streamNames = new Set(entries.map((entry) => String(entry.stream || "").trim()));
    if (entries.length !== 2 || streamNames.size !== 2 || streamNames.has("")) return;

    const sourceAssignments = [...entries].sort((a, b) =>
      String(a.stream).localeCompare(String(b.stream))
    );
    const assignmentIds = sourceAssignments.map((assignment) => Number(assignment.id));
    if (assignmentIds.some((id) => !Number.isInteger(id) || id <= 0)) return;

    const streams = sourceAssignments.map((assignment) => assignment.stream);
    const combined = {
      ...sourceAssignments[0],
      id: `optional-${String(sourceAssignments[0].class_level).toLowerCase()}-${getOptionalSubjectKey(
        sourceAssignments[0].subject
      )}-${assignmentIds.join("-")}`,
      stream: streams.join(" + "),
      streams,
      assignmentIds,
      sourceAssignments,
      isCombinedOLevelOptional: true,
    };

    assignmentIds.forEach((id) => consumedIds.add(id));
    combinedByFirstId.set(assignmentIds[0], combined);
  });

  const grouped = [];
  rows.forEach((assignment) => {
    const id = Number(assignment?.id);
    if (!consumedIds.has(id)) {
      grouped.push(assignment);
      return;
    }
    const combined = combinedByFirstId.get(id);
    if (combined) grouped.push(combined);
  });

  return grouped;
}
