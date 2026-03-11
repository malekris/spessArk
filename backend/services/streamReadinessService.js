const COMPULSORY_SUBJECTS = [
  "English",
  "Mathematics",
  "Physics",
  "Biology",
  "Chemistry",
  "History",
  "Geography",
];

const OPTIONAL_SUBJECTS = [
  "ICT",
  "Physical Education",
  "Luganda",
  "Christian Religious Education",
  "IRE",
  "Agriculture",
  "Art",
  "Literature",
  "Entrepreneurship",
  "Kiswahili",
];

const toLookup = (subjects) =>
  new Map(subjects.map((s) => [String(s).trim().toLowerCase(), s]));

const COMPULSORY_LOOKUP = toLookup(COMPULSORY_SUBJECTS);
const OPTIONAL_LOOKUP = toLookup(OPTIONAL_SUBJECTS);

const bySubjectOrder = (orderedSubjects) => {
  const order = new Map(orderedSubjects.map((s, i) => [s, i]));
  return (a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER);
};

const byClassAndStream = (a, b) =>
  a.class.localeCompare(b.class, undefined, { numeric: true }) ||
  a.stream.localeCompare(b.stream);

/**
 * Build stream readiness from raw assignment rows.
 * Input row shape can be:
 * { class, stream, subject, teacherId } or { class_level, stream, subject, teacher_id }
 */
export function buildStreamReadiness(assignments = []) {
  const grouped = new Map();

  for (const row of assignments) {
    const classLevel = String(row?.class ?? row?.class_level ?? "").trim();
    const stream = String(row?.stream ?? "").trim();
    const subjectRaw = String(row?.subject ?? "").trim();

    if (!classLevel || !stream || !subjectRaw) continue;

    const key = `${classLevel}__${stream}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        class: classLevel,
        stream,
        compulsory: new Set(),
        optional: new Set(),
        unknown: new Set(),
      });
    }

    const group = grouped.get(key);
    const normalized = subjectRaw.toLowerCase();

    if (COMPULSORY_LOOKUP.has(normalized)) {
      group.compulsory.add(COMPULSORY_LOOKUP.get(normalized));
      continue;
    }
    if (OPTIONAL_LOOKUP.has(normalized)) {
      group.optional.add(OPTIONAL_LOOKUP.get(normalized));
      continue;
    }

    // Unknown subjects are ignored for readiness but tracked for visibility.
    group.unknown.add(subjectRaw);
  }

  return Array.from(grouped.values())
    .map((group) => {
      const assignedCompulsorySubjects = COMPULSORY_SUBJECTS.filter((s) =>
        group.compulsory.has(s)
      );
      const missingCompulsorySubjects = COMPULSORY_SUBJECTS.filter(
        (s) => !group.compulsory.has(s)
      );
      const assignedOptionalSubjects = Array.from(group.optional).sort(
        bySubjectOrder(OPTIONAL_SUBJECTS)
      );
      const unknownSubjects = Array.from(group.unknown).sort((a, b) =>
        a.localeCompare(b)
      );

      const status =
        missingCompulsorySubjects.length === 0 ? "READY" : "NOT_READY";

      return {
        class: group.class,
        stream: group.stream,
        status,
        uiLabel: status === "READY" ? "green" : "red",
        assignedCompulsorySubjects,
        missingCompulsorySubjects,
        assignedOptionalSubjects,
        optionalCount: assignedOptionalSubjects.length,
        unknownSubjects,
      };
    })
    .sort(byClassAndStream);
}

export { COMPULSORY_SUBJECTS, OPTIONAL_SUBJECTS };

