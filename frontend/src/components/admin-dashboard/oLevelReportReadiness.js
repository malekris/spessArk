import { normalizeDashboardTerm } from "./dashboardCardUtils.js";

export const O_LEVEL_REPORT_STREAMS = [
  { classLevel: "S1", stream: "North" },
  { classLevel: "S1", stream: "South" },
  { classLevel: "S2", stream: "North" },
  { classLevel: "S2", stream: "South" },
  { classLevel: "S3", stream: "North" },
  { classLevel: "S3", stream: "South" },
  { classLevel: "S4", stream: "North" },
  { classLevel: "S4", stream: "South" },
];

const normalizeClassLevel = (value) => String(value || "").trim().toUpperCase();

const normalizeStream = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "north") return "North";
  if (normalized === "south") return "South";
  return String(value || "").trim();
};

const normalizeSubject = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const normalizeAoi = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
  return ["AOI1", "AOI2", "AOI3"].includes(normalized) ? normalized : "";
};

const streamKey = (classLevel, stream) =>
  `${normalizeClassLevel(classLevel)}||${normalizeStream(stream)}`;

const assignmentIsActive = (assignment) => {
  const status = String(assignment?.assignment_status || "active").trim().toLowerCase();
  return status === "active" && !assignment?.ended_at;
};

const marksSetHasScores = (row) => {
  if (row?.marks_count === null || row?.marks_count === undefined || row?.marks_count === "") {
    return true;
  }
  return Number(row.marks_count) > 0;
};

const toPercent = (value, total) =>
  total > 0 ? Math.round((Number(value || 0) / total) * 100) : 0;

/**
 * Active assignments define the subjects expected in each stream. Submissions
 * are matched by class, stream and subject so marks inherited through a teacher
 * handover still count toward the current stream's report readiness.
 */
export function buildOLevelReportReadiness({
  assignments = [],
  marksSets = [],
  term,
  academicYear,
} = {}) {
  const selectedTerm = normalizeDashboardTerm(term);
  const selectedYear = Number(academicYear);
  const groups = new Map(
    O_LEVEL_REPORT_STREAMS.map(({ classLevel, stream }) => [
      streamKey(classLevel, stream),
      {
        classLevel,
        stream,
        expectedSubjects: new Map(),
        submittedComponents: new Map(),
      },
    ])
  );

  (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
    if (!assignmentIsActive(assignment)) return;

    const classLevel = normalizeClassLevel(assignment?.class_level || assignment?.class);
    const stream = normalizeStream(assignment?.stream);
    const subject = String(assignment?.subject || "").trim();
    const subjectKey = normalizeSubject(subject);
    const group = groups.get(streamKey(classLevel, stream));
    if (!group || !subjectKey) return;

    // The assignment model permits one teacher per subject and stream. The map
    // also protects the totals if legacy data contains an accidental duplicate.
    if (!group.expectedSubjects.has(subjectKey)) {
      group.expectedSubjects.set(subjectKey, subject);
      group.submittedComponents.set(subjectKey, new Set());
    }
  });

  (Array.isArray(marksSets) ? marksSets : []).forEach((row) => {
    if (normalizeDashboardTerm(row?.term) !== selectedTerm) return;
    if (Number(row?.year) !== selectedYear) return;
    if (!marksSetHasScores(row)) return;

    const classLevel = normalizeClassLevel(row?.class_level || row?.class);
    const stream = normalizeStream(row?.stream);
    const subjectKey = normalizeSubject(row?.subject);
    const component = normalizeAoi(row?.aoi_label);
    const group = groups.get(streamKey(classLevel, stream));

    // Orphaned submissions never create expected work. This keeps the card in
    // lockstep with verified active assignments and the submission tracker.
    if (!group || !component || !group.expectedSubjects.has(subjectKey)) return;
    group.submittedComponents.get(subjectKey).add(component);
  });

  const streams = Array.from(groups.values()).map((group) => {
    const subjectEntries = Array.from(group.expectedSubjects.entries()).sort((left, right) =>
      left[1].localeCompare(right[1])
    );
    const expectedTotal = subjectEntries.length;

    const missingFor = (component) =>
      subjectEntries
        .filter(([subjectKey]) => !group.submittedComponents.get(subjectKey)?.has(component))
        .map(([, subject]) => subject);

    const missingAoi1 = missingFor("AOI1");
    const missingAoi2 = missingFor("AOI2");
    const missingAoi3 = missingFor("AOI3");
    const aoi1Submitted = expectedTotal - missingAoi1.length;
    const aoi2Submitted = expectedTotal - missingAoi2.length;
    const aoi3Submitted = expectedTotal - missingAoi3.length;
    const printReady = expectedTotal > 0 && missingAoi1.length === 0 && missingAoi2.length === 0;
    const fullyComplete = printReady && missingAoi3.length === 0;
    const status =
      expectedTotal === 0
        ? "setup"
        : fullyComplete
          ? "complete"
          : printReady
            ? "ready"
            : "blocked";

    return {
      classLevel: group.classLevel,
      stream: group.stream,
      key: streamKey(group.classLevel, group.stream),
      expectedTotal,
      aoi1Submitted,
      aoi2Submitted,
      aoi3Submitted,
      missingAoi1,
      missingAoi2,
      missingAoi3,
      printReady,
      fullyComplete,
      status,
    };
  });

  const trackedStreams = streams.filter((row) => row.expectedTotal > 0);
  const expectedSubjectSlots = trackedStreams.reduce((sum, row) => sum + row.expectedTotal, 0);
  const requiredSubmitted = trackedStreams.reduce(
    (sum, row) => sum + row.aoi1Submitted + row.aoi2Submitted,
    0
  );
  const allSubmitted = trackedStreams.reduce(
    (sum, row) => sum + row.aoi1Submitted + row.aoi2Submitted + row.aoi3Submitted,
    0
  );

  return {
    term: selectedTerm,
    academicYear: selectedYear,
    streams,
    totalStreams: streams.length,
    trackedStreams: trackedStreams.length,
    printReadyStreams: trackedStreams.filter((row) => row.printReady).length,
    fullyCompleteStreams: trackedStreams.filter((row) => row.fullyComplete).length,
    blockedStreams: trackedStreams.filter((row) => row.status === "blocked").length,
    setupStreams: streams.filter((row) => row.status === "setup").length,
    requiredCoverage: toPercent(requiredSubmitted, expectedSubjectSlots * 2),
    completeCoverage: toPercent(allSubmitted, expectedSubjectSlots * 3),
  };
}
