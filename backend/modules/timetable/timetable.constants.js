export const TIMETABLE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export const O_LEVEL_STREAMS = [
  { classLevel: "S1", stream: "North" },
  { classLevel: "S1", stream: "South" },
  { classLevel: "S2", stream: "North" },
  { classLevel: "S2", stream: "South" },
  { classLevel: "S3", stream: "North" },
  { classLevel: "S3", stream: "South" },
  { classLevel: "S4", stream: "North" },
  { classLevel: "S4", stream: "South" },
];

export const A_LEVEL_STREAMS = [
  { classLevel: "S5", stream: "Arts" },
  { classLevel: "S5", stream: "Sciences" },
  { classLevel: "S6", stream: "Arts" },
  { classLevel: "S6", stream: "Sciences" },
];

export const SCHOOL_STREAMS = [...O_LEVEL_STREAMS, ...A_LEVEL_STREAMS];

export const DEFAULT_TIMETABLE_CONFIG = {
  version: 2,
  scope: "SCHOOL_S1_S6",
  days: TIMETABLE_DAYS,
  slots: [
    { code: "P1", label: "Period 1", start: "08:00", end: "09:20", durationMinutes: 80 },
    { code: "P2", label: "Period 2", start: "09:20", end: "10:40", durationMinutes: 80 },
    { code: "BREAK", label: "Break", start: "10:40", end: "11:20", schedulable: false },
    { code: "P3", label: "Quadruple", start: "11:20", end: "13:20", durationMinutes: 120 },
    { code: "LUNCH", label: "Lunch", start: "13:20", end: "14:20", schedulable: false },
    { code: "P4", label: "Period 4", start: "14:20", end: "15:40", durationMinutes: 80 },
    { code: "P5", label: "Period 5", start: "15:40", end: "17:10", durationMinutes: 90 },
  ],
  fridaySlots: [
    { code: "P1", label: "Period 1", start: "08:00", end: "09:20", durationMinutes: 80 },
    { code: "P2", label: "Period 2", start: "09:20", end: "10:40", durationMinutes: 80 },
    { code: "BREAK", label: "Break", start: "10:40", end: "11:20", schedulable: false },
    { code: "P3A", label: "Short Lesson", start: "11:20", end: "12:00", durationMinutes: 40 },
    { code: "CHURCH", label: "Church", start: "12:00", end: "13:20", schedulable: false },
    { code: "LUNCH", label: "Lunch", start: "13:20", end: "14:20", schedulable: false },
    { code: "P4", label: "Period 4", start: "14:20", end: "15:40", durationMinutes: 80 },
    { code: "P5", label: "Period 5", start: "15:40", end: "17:10", durationMinutes: 90 },
  ],
  reservedEvents: [
    { day: "Monday", slotCode: "P2", type: "assembly", label: "Assembly" },
    { day: "Friday", slotCode: "CHURCH", type: "church", label: "Church" },
  ],
  fixedProjects: [
    { classLevel: "S1", day: "Friday", slotCode: "P5" },
    { classLevel: "S2", day: "Friday", slotCode: "P4" },
  ],
  simpleFridaySubjects: [
    "English",
    "Geography",
    "History",
    "Kiswahili",
    "Luganda",
    "Literature",
    "CRE",
    "IRE",
  ],
  clusterWindows: {
    lower: [
      { day: "Monday", slotCodes: ["P3"] },
      { day: "Tuesday", slotCodes: ["P3"] },
      { day: "Wednesday", slotCodes: ["P3"] },
      { day: "Thursday", slotCodes: ["P3"] },
    ],
    upper: [
      { day: "Monday", slotCodes: ["P3"] },
      { day: "Tuesday", slotCodes: ["P3"] },
      { day: "Wednesday", slotCodes: ["P3"] },
      { day: "Thursday", slotCodes: ["P3"] },
      { day: "Tuesday", slotCodes: ["P1", "P2"] },
      { day: "Wednesday", slotCodes: ["P1", "P2"] },
      { day: "Thursday", slotCodes: ["P1", "P2"] },
      { day: "Friday", slotCodes: ["P1", "P2"] },
      { day: "Monday", slotCodes: ["P4", "P5"] },
      { day: "Tuesday", slotCodes: ["P4", "P5"] },
      { day: "Wednesday", slotCodes: ["P4", "P5"] },
      { day: "Thursday", slotCodes: ["P4", "P5"] },
      { day: "Friday", slotCodes: ["P4", "P5"] },
    ],
  },
  aLevel: {
    lessonsPerSubject: 2,
    pairedSubjects: [
      { code: "ENT_ECON", subjects: ["entrepreneurship", "economics"] },
      { code: "CRE_IRE", subjects: ["cre", "ire"] },
      { code: "LIT_LUG", subjects: ["literature", "luganda"] },
    ],
    generalPaper: {
      lessonsPerWeek: 2,
      combinedStreams: true,
      requireQuadruple: true,
    },
    subsidiaryBlocks: {
      S5: [
        { day: "Thursday", slotCode: "P1" },
        { day: "Thursday", slotCode: "P4" },
      ],
      S6: [
        { day: "Tuesday", slotCode: "P1" },
        { day: "Wednesday", slotCode: "P3" },
      ],
    },
  },
};

export const normalizeSubject = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function normalizeClassLevel(value) {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/(?:S|SENIOR\s*)?([1-4])\b/);
  return match ? `S${match[1]}` : "";
}

export function normalizeAlevelClassLevel(value) {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/(?:S|SENIOR\s*)?([56])\b/);
  return match ? `S${match[1]}` : "";
}

export function normalizeStream(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.includes("north")) return "North";
  if (raw.includes("south")) return "South";
  return "";
}

export function normalizeAlevelStream(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.includes("art")) return "Arts";
  if (raw.includes("science")) return "Sciences";
  return "";
}

const CORE_SUBJECTS = new Set([
  "english",
  "english language",
  "mathematics",
  "math",
  "physics",
  "chemistry",
  "biology",
  "geography",
  "history",
]);

const LOWER_ORDINARY_SUBJECTS = new Set([
  "kiswahili",
  "swahili",
  "physical education",
  "pe",
  "entrepreneurship",
  "ent",
  "cre",
  "christian religious education",
  "ire",
  "islamic religious education",
]);

const VOCATIONAL_SUBJECTS = new Set([
  "agriculture",
  "agric",
  "art",
  "ict",
  "information communication technology",
  "information and communication technology",
]);

const UPPER_VOCATIONAL_SUBJECTS = new Set([
  ...VOCATIONAL_SUBJECTS,
  "physical education",
  "pe",
  "entrepreneurship",
  "ent",
]);

const OTHER_CLUSTER_SUBJECTS = new Set([
  "cre",
  "christian religious education",
  "ire",
  "islamic religious education",
  "luganda",
  "kiswahili",
  "swahili",
  "literature",
  "literature in english",
]);

export function defaultRequirementForAssignment(assignment) {
  const classLevel = normalizeClassLevel(assignment?.class_level ?? assignment?.classLevel);
  const subjectKey = normalizeSubject(assignment?.subject);
  const lower = classLevel === "S1" || classLevel === "S2";

  if (CORE_SUBJECTS.has(subjectKey)) {
    return { lessonsPerWeek: 2, lessonKind: "ordinary", clusterCode: null, enabled: true };
  }

  if (subjectKey === "project" || subjectKey === "project work") {
    return { lessonsPerWeek: lower ? 1 : 0, lessonKind: "project", clusterCode: null, enabled: lower };
  }

  if (lower && LOWER_ORDINARY_SUBJECTS.has(subjectKey)) {
    return { lessonsPerWeek: 1, lessonKind: "ordinary", clusterCode: null, enabled: true };
  }

  if (lower && VOCATIONAL_SUBJECTS.has(subjectKey)) {
    return { lessonsPerWeek: 1, lessonKind: "cluster", clusterCode: "VOCATIONAL", enabled: true };
  }

  if (lower && (subjectKey === "luganda" || subjectKey.startsWith("literature"))) {
    return { lessonsPerWeek: 1, lessonKind: "cluster", clusterCode: "OTHERS", enabled: true };
  }

  if (!lower && UPPER_VOCATIONAL_SUBJECTS.has(subjectKey)) {
    return { lessonsPerWeek: 2, lessonKind: "cluster", clusterCode: "VOCATIONAL", enabled: true };
  }

  if (!lower && OTHER_CLUSTER_SUBJECTS.has(subjectKey)) {
    return { lessonsPerWeek: 2, lessonKind: "cluster", clusterCode: "OTHERS", enabled: true };
  }

  return { lessonsPerWeek: 1, lessonKind: "review", clusterCode: null, enabled: false };
}
