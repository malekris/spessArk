import { loadPdfTools } from "../../../utils/loadPdfTools.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const SLOT_CODES = ["P1", "P2", "P3", "P3A", "P4", "P5"];
const DAY_LABELS = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
};
const STREAM_ORDER = {
  North: 0,
  South: 1,
  "North & South": 2,
  Arts: 3,
  Sciences: 4,
  "Arts & Sciences": 5,
};

const cleanText = (value, fallback) => String(value || "").trim() || fallback;
const normalized = (value) => cleanText(value, "").toLowerCase();
const dayIndex = (day) => {
  const index = DAYS.indexOf(day);
  return index === -1 ? DAYS.length : index;
};
const slotIndex = (slotCode) => {
  const index = SLOT_CODES.indexOf(slotCode);
  return index === -1 ? SLOT_CODES.length : index;
};
const classIndex = (classLevel) => Number(String(classLevel || "").replace(/\D/g, "")) || 99;

const compareSlots = (left, right) =>
  dayIndex(left.day) - dayIndex(right.day) ||
  slotIndex(left.slotCode) - slotIndex(right.slotCode);

const compareRows = (left, right) =>
  classIndex(left.classLevel) - classIndex(right.classLevel) ||
  (STREAM_ORDER[left.streamsLabel] ?? 99) - (STREAM_ORDER[right.streamsLabel] ?? 99) ||
  left.streamsLabel.localeCompare(right.streamsLabel) ||
  left.subject.localeCompare(right.subject) ||
  left.teacherName.localeCompare(right.teacherName);

export function formatAllocationSlots(slots) {
  return slots
    .map(({ day, slotCode }) => `${DAY_LABELS[day] || day} ${slotCode}`)
    .join(", ");
}

export function buildLessonAllocationRows(version) {
  const allocations = new Map();

  for (const session of version?.sessions || []) {
    const classLevel = cleanText(session.classLevel, "Unspecified");
    const streamsLabel = cleanText(session.streamsLabel, "Unspecified");
    const subject = cleanText(session.subjectLabel, "Untitled subject");
    const teacherName = cleanText(session.teacherName, "Unassigned teacher");
    const teacherKey = Number(session.teacherId) || normalized(teacherName);
    const key = [
      normalized(classLevel),
      normalized(streamsLabel),
      normalized(subject),
      teacherKey,
    ].join("::");

    if (!allocations.has(key)) {
      allocations.set(key, {
        key,
        classLevel,
        streamsLabel,
        subject,
        teacherId: Number(session.teacherId) || null,
        teacherName,
        slots: new Map(),
      });
    }

    const day = cleanText(session.day, "Unscheduled");
    const slotCode = cleanText(session.slotCode, "-");
    allocations.get(key).slots.set(`${day}::${slotCode}`, { day, slotCode });
  }

  return Array.from(allocations.values())
    .map((allocation) => {
      const slots = Array.from(allocation.slots.values()).sort(compareSlots);
      return {
        ...allocation,
        slots,
        lessonCount: slots.length,
        scheduledPeriods: formatAllocationSlots(slots),
      };
    })
    .sort(compareRows);
}

export function buildLessonAllocationSummary(rows) {
  const classes = new Set();
  const subjects = new Set();
  const teachers = new Set();

  for (const row of rows || []) {
    classes.add(`${row.classLevel}::${row.streamsLabel}`);
    subjects.add(normalized(row.subject));
    teachers.add(row.teacherId || normalized(row.teacherName));
  }

  return {
    classGroups: classes.size,
    subjects: subjects.size,
    teachers: teachers.size,
    scheduledLessons: (rows || []).reduce((total, row) => total + row.lessonCount, 0),
  };
}

const formatReportDate = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value, "Not recorded");
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export function buildLessonAllocationPdfDocument({
  jsPDF,
  autoTable,
  version,
  currentTerm = "Current Term",
}) {
  const rows = buildLessonAllocationRows(version);
  if (rows.length === 0) {
    throw new Error("This draft has no scheduled teacher lessons to report.");
  }
  const summary = buildLessonAllocationSummary(rows);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setTextColor(24, 24, 27);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("St Phillips Equatorial Secondary School", 12, 13);
  doc.setFontSize(11);
  doc.text(`Lesson Allocation Report - ${cleanText(currentTerm, "Current Term")}`, 12, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(82, 82, 91);
  doc.text(
    `Draft: ${cleanText(version?.name, "Untitled draft")} | Academic year: ${cleanText(version?.academicYear, "-")} | Status: ${cleanText(version?.status, "-")} | Generated: ${formatReportDate(version?.createdAt)}`,
    12,
    26
  );
  doc.setTextColor(39, 39, 42);
  doc.setFont("helvetica", "bold");
  doc.text(
    `${summary.classGroups} class groups   ${summary.subjects} subjects   ${summary.teachers} teachers   ${summary.scheduledLessons} scheduled subject lessons`,
    12,
    33
  );

  autoTable(doc, {
    startY: 38,
    margin: { top: 12, right: 10, bottom: 12, left: 10 },
    head: [["Class", "Stream", "Subject", "Teacher", "Lessons", "Scheduled periods"]],
    body: rows.map((row) => [
      row.classLevel,
      row.streamsLabel,
      row.subject,
      row.teacherName,
      String(row.lessonCount),
      row.scheduledPeriods,
    ]),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 7.2,
      cellPadding: 2,
      lineColor: [190, 190, 190],
      lineWidth: 0.15,
      textColor: [35, 35, 39],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [54, 49, 42],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7.4,
    },
    alternateRowStyles: { fillColor: [247, 247, 246] },
    columnStyles: {
      0: { cellWidth: 15, fontStyle: "bold" },
      1: { cellWidth: 30 },
      2: { cellWidth: 47, fontStyle: "bold" },
      3: { cellWidth: 48 },
      4: { cellWidth: 18, halign: "center", fontStyle: "bold" },
      5: { cellWidth: "auto" },
    },
    didDrawPage: () => {
      const pageNumber = doc.internal.getNumberOfPages();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(100, 100, 100);
      doc.text(
        `Lesson allocation follow-up | Printed ${formatReportDate(new Date())}`,
        10,
        pageHeight - 5
      );
      doc.text(`Page ${pageNumber}`, pageWidth - 10, pageHeight - 5, { align: "right" });
    },
  });

  return doc;
}

export async function openLessonAllocationPdfPreview(options) {
  const rows = buildLessonAllocationRows(options?.version);
  if (rows.length === 0) {
    throw new Error("This draft has no scheduled teacher lessons to report.");
  }

  const previewWindow = window.open("", "_blank");
  if (!previewWindow) {
    throw new Error("Allow pop-ups for SPESS ARK to open the PDF preview.");
  }
  previewWindow.document.title = "Preparing lesson allocation report";
  previewWindow.document.body.innerHTML =
    '<div style="font-family:system-ui;padding:32px;color:#1f2937">Preparing lesson allocation report...</div>';

  try {
    const { jsPDF, autoTable } = await loadPdfTools();
    const doc = buildLessonAllocationPdfDocument({ jsPDF, autoTable, ...options });
    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    previewWindow.location.replace(blobUrl);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
    return true;
  } catch (error) {
    previewWindow.close();
    throw error;
  }
}
