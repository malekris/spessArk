const normalizeText = (value) => String(value || "").trim().toLowerCase();

export const isSubIctSubject = (value) =>
  normalizeText(value).replace(/[^a-z0-9]/g, "") === "subict";

export const parseAlevelStream = (value) => {
  const match = String(value || "").trim().match(/^(S[56])\s+(Arts|Sciences)$/i);
  if (!match) return null;
  return {
    classLevel: match[1].toUpperCase(),
    streamGroup: match[2].toLowerCase() === "arts" ? "Arts" : "Sciences",
  };
};

export function validateCombinedSubIctAssignments(rows = []) {
  const assignments = Array.isArray(rows) ? rows : [];
  if (assignments.length !== 2) {
    return { valid: false, message: "Combined Sub ICT requires exactly two assignments." };
  }

  const ids = new Set(assignments.map((row) => Number(row.id)));
  const subjectIds = new Set(assignments.map((row) => Number(row.subject_id)));
  const paperLabels = new Set(
    assignments.map((row) => normalizeText(row.paper_label || "Single"))
  );
  const teacherIds = new Set(assignments.map((row) => Number(row.teacher_id)));
  const parsedStreams = assignments.map((row) => parseAlevelStream(row.stream));

  if (ids.size !== 2 || assignments.some((row) => !isSubIctSubject(row.subject_name))) {
    return { valid: false, message: "Only distinct Sub ICT assignments can be combined." };
  }
  if (subjectIds.size !== 1 || paperLabels.size !== 1 || teacherIds.size !== 1) {
    return {
      valid: false,
      message: "Sub ICT assignments must share one subject, paper and teacher.",
    };
  }
  if (parsedStreams.some((stream) => !stream)) {
    return { valid: false, message: "Only Arts and Sciences streams can be combined." };
  }

  const classLevels = new Set(parsedStreams.map((stream) => stream.classLevel));
  const streamGroups = new Set(parsedStreams.map((stream) => stream.streamGroup));
  if (
    classLevels.size !== 1 ||
    streamGroups.size !== 2 ||
    !streamGroups.has("Arts") ||
    !streamGroups.has("Sciences")
  ) {
    return {
      valid: false,
      message: "Combined Sub ICT must contain Arts and Sciences from the same class.",
    };
  }

  const orderedAssignments = [...assignments].sort((a, b) =>
    String(a.stream).localeCompare(String(b.stream))
  );

  return {
    valid: true,
    classLevel: parsedStreams[0].classLevel,
    subjectId: Number(assignments[0].subject_id),
    teacherId: Number(assignments[0].teacher_id),
    paperLabel: assignments[0].paper_label || "Single",
    subjectName: assignments[0].subject_name,
    assignments: orderedAssignments,
    assignmentByStream: new Map(
      orderedAssignments.map((assignment) => [assignment.stream, Number(assignment.id)])
    ),
  };
}
