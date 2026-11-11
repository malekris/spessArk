const normalizeText = (value) => String(value || "").trim().toLowerCase();

export const isSubIctTeacherAssignment = (assignment) =>
  normalizeText(assignment?.subject ?? assignment?.subject_name).replace(/[^a-z0-9]/g, "") ===
  "subict";

export const parseTeacherAlevelStream = (value) => {
  const match = String(value || "").trim().match(/^(S[56])\s+(Arts|Sciences)$/i);
  if (!match) return null;

  return {
    classLevel: match[1].toUpperCase(),
    streamGroup: match[2].toLowerCase() === "arts" ? "Arts" : "Sciences",
  };
};

const getPaperKey = (assignment) =>
  normalizeText(assignment?.paper_label || "Single").replace(/\s+/g, " ");

/**
 * Present matching Arts and Sciences Sub ICT assignments as one teacher workload.
 * The source assignments remain attached so marks can still be saved against the
 * correct stream-specific assignment records used by reports and audit history.
 */
export function groupSubIctTeacherAssignments(assignments = []) {
  const rows = Array.isArray(assignments) ? assignments : [];
  const candidates = new Map();

  rows.forEach((assignment) => {
    const parsedStream = parseTeacherAlevelStream(assignment?.stream);
    if (!isSubIctTeacherAssignment(assignment) || !parsedStream) return;

    const key = `${parsedStream.classLevel}:${getPaperKey(assignment)}`;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push({ assignment, parsedStream });
  });

  const consumedIds = new Set();
  const combinedByFirstId = new Map();

  candidates.forEach((entries) => {
    const arts = entries.filter(({ parsedStream }) => parsedStream.streamGroup === "Arts");
    const sciences = entries.filter(
      ({ parsedStream }) => parsedStream.streamGroup === "Sciences"
    );

    // Ambiguous or incomplete assignment sets remain unchanged for safety.
    if (arts.length !== 1 || sciences.length !== 1) return;

    const sourceAssignments = [arts[0].assignment, sciences[0].assignment].sort((a, b) =>
      String(a.stream).localeCompare(String(b.stream))
    );
    const assignmentIds = sourceAssignments.map((assignment) => Number(assignment.id));
    if (assignmentIds.some((id) => !Number.isInteger(id) || id <= 0)) return;

    const classLevel = arts[0].parsedStream.classLevel;
    const firstId = assignmentIds[0];
    const combined = {
      ...sourceAssignments[0],
      id: `sub-ict-${classLevel.toLowerCase()}-${getPaperKey(sourceAssignments[0]).replace(
        /[^a-z0-9]+/g,
        "-"
      )}-${assignmentIds.join("-")}`,
      class_level: classLevel,
      stream: "Arts + Sciences",
      streams: sourceAssignments.map((assignment) => assignment.stream),
      assignmentIds,
      sourceAssignments,
      isCombinedSubIct: true,
    };

    assignmentIds.forEach((id) => consumedIds.add(id));
    combinedByFirstId.set(firstId, combined);
  });

  const grouped = [];
  rows.forEach((assignment) => {
    const numericId = Number(assignment?.id);
    if (!consumedIds.has(numericId)) {
      grouped.push(assignment);
      return;
    }

    const combined = combinedByFirstId.get(numericId);
    if (combined) grouped.push(combined);
  });

  return grouped;
}
