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

function anomalyGuidance(reasonValue) {
  const reason = cleanText(reasonValue, "The generator could not place this lesson requirement.");
  const key = normalized(reason);

  if (key.includes("no timetable availability configured")) {
    return {
      cause: "The assigned teacher has no Monday-Friday availability saved, leaving the generator with no legal day for the lesson.",
      solution: "Save at least one weekday for the teacher, or hand the assignment to a teacher who is available during the school week, then regenerate.",
    };
  }
  if (key.includes("no shared available day")) {
    return {
      cause: "Every teacher in this combined cluster must teach at the same time, but their saved availability has no weekday in common.",
      solution: "Give all cluster teachers at least one common available day, or reassign one of the cluster subjects, then regenerate.",
    };
  }
  if (key.includes("no clash-free two-hour window")) {
    return {
      cause: "The class and every cluster teacher must all be free together, but each eligible two-hour window is occupied or falls outside a teacher's availability.",
      solution: "Free a shared P3 window, align the teachers on a common day, or move a conflicting lesson before regenerating.",
    };
  }
  if (key.includes("owns more than one parallel") || key.includes("assigned to parallel")) {
    return {
      cause: "One teacher owns two subjects that must run simultaneously, so teaching both would create an unavoidable teacher clash.",
      solution: "Hand one of the parallel subject assignments to a different teacher before generating another draft.",
    };
  }
  if (key.includes("paper assignments are incomplete or ambiguous")) {
    return {
      cause: "The A-Level subject's Paper 1 and Paper 2 ownership does not identify a valid weekday timetable teacher unambiguously.",
      solution: "Correct the paper labels and ownership. Keep weekend practical-only Paper 2 teachers exempt, and ensure the weekday paper teacher has availability.",
    };
  }
  if (
    key.includes("no active") ||
    key.includes("needs active") ||
    (key.includes("needs ") && key.includes("assignment")) ||
    key.includes("must cover both")
  ) {
    return {
      cause: "A required stream or half of a combined class has no active assignment, so the generator cannot staff the complete block.",
      solution: "Create or reactivate the missing assignment for every named stream, then generate a new draft.",
    };
  }
  if (key.includes("must use one teacher across arts and sciences")) {
    return {
      cause: "General Paper is a combined Arts and Sciences lesson, but its stream assignments point to different teachers.",
      solution: "Assign the same General Paper teacher to both streams for that class, then regenerate.",
    };
  }
  if (key.includes("fixed") && (key.includes("not available") || key.includes("cannot be staffed") || key.includes("already has a lesson"))) {
    return {
      cause: "This lesson has a compulsory day and period, but its teacher is unavailable or already occupied in that fixed slot.",
      solution: "Make the teacher available for the fixed period, move the conflicting lesson, or assign another eligible teacher.",
    };
  }
  if (key.includes("no shared quadruple") || key.includes("no shared ordinary")) {
    return {
      cause: "The combined class, its teacher, and the required period type have no remaining day where all hard constraints meet.",
      solution: "Widen the teacher's available days or move a conflicting class from an eligible ordinary or P3 period, then regenerate.",
    };
  }
  if (key.includes("no clash-free slot remains") || key.includes("no clash-free period remains")) {
    return {
      cause: "All periods on the assigned teacher's available days are blocked by a teacher clash, a class clash, or the rule against repeating the subject on one day.",
      solution: "Add another available day, move a conflicting lesson, hand over the assignment, or use Manual Override to place it in a verified free period.",
    };
  }
  if (key.includes("selected") && key.includes("became unavailable")) {
    return {
      cause: "A period that was initially eligible was consumed by another higher-priority block during the same generation attempt.",
      solution: "Regenerate after freeing a suitable period, or place and lock this lesson manually in a clash-free slot.",
    };
  }

  return {
    cause: "The current assignments, teacher availability, occupied class periods, and school rules left no legal placement for this requirement.",
    solution: "Review the named teacher and class constraints, free a suitable period or adjust the assignment, then regenerate or place it through Manual Override.",
  };
}

export function buildLessonAllocationAnomalies(version) {
  return (version?.validation?.unallocated || []).map((item, index) => {
    const guidance = anomalyGuidance(item.reason);
    return {
      key: `${item.assignmentId || item.teacherId || "general"}-${index}`,
      classLevel: cleanText(item.classLevel, "-"),
      stream: cleanText(item.stream, "-"),
      subject: cleanText(item.subject, "Scheduling block"),
      teacherName: cleanText(item.teacherName, "Not assigned"),
      reason: cleanText(item.reason, "The generator could not place this lesson requirement."),
      cause: guidance.cause,
      solution: guidance.solution,
    };
  });
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
  const anomalies = buildLessonAllocationAnomalies(version);
  if (rows.length === 0 && anomalies.length === 0) {
    throw new Error("This draft has no lesson allocation data to report.");
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

  const drawFooter = () => {
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
  };

  autoTable(doc, {
    startY: 38,
    margin: { top: 12, right: 10, bottom: 12, left: 10 },
    head: [["Class", "Stream", "Subject", "Teacher", "Lessons", "Scheduled periods"]],
    body: rows.length > 0
      ? rows.map((row) => [
          row.classLevel,
          row.streamsLabel,
          row.subject,
          row.teacherName,
          String(row.lessonCount),
          row.scheduledPeriods,
        ])
      : [["-", "-", "No scheduled teacher lessons", "-", "0", "-"]],
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
    didDrawPage: drawFooter,
  });

  let anomalyStartY = Number(doc.lastAutoTable?.finalY || 38) + 10;
  if (anomalyStartY > pageHeight - 38) {
    doc.addPage();
    anomalyStartY = 16;
  }
  doc.setTextColor(24, 24, 27);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Scheduling anomalies - lessons not placed", 10, anomalyStartY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(82, 82, 91);
  doc.text(
    anomalies.length > 0
      ? `${anomalies.length} requirement${anomalies.length === 1 ? "" : "s"} could not satisfy every hard timetable rule.`
      : "No unallocated lessons were recorded for this draft.",
    10,
    anomalyStartY + 5
  );

  if (anomalies.length > 0) {
    autoTable(doc, {
      startY: anomalyStartY + 9,
      margin: { top: 12, right: 10, bottom: 12, left: 10 },
      head: [["Class", "Stream", "Subject", "Teacher", "What happened", "Underlying cause", "Suggested fix"]],
      body: anomalies.map((item) => [
        item.classLevel,
        item.stream,
        item.subject,
        item.teacherName,
        item.reason,
        item.cause,
        item.solution,
      ]),
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 6.2,
        cellPadding: 1.7,
        lineColor: [190, 190, 190],
        lineWidth: 0.15,
        textColor: [35, 35, 39],
        overflow: "linebreak",
        valign: "top",
      },
      headStyles: {
        fillColor: [122, 74, 24],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 6.4,
      },
      columnStyles: {
        0: { cellWidth: 13, fontStyle: "bold" },
        1: { cellWidth: 22 },
        2: { cellWidth: 28, fontStyle: "bold" },
        3: { cellWidth: 29 },
        4: { cellWidth: 58 },
        5: { cellWidth: 62 },
        6: { cellWidth: "auto" },
      },
      didDrawPage: drawFooter,
    });
  } else {
    drawFooter();
  }

  return doc;
}

export async function openLessonAllocationPdfPreview(options) {
  const rows = buildLessonAllocationRows(options?.version);
  const anomalies = buildLessonAllocationAnomalies(options?.version);
  if (rows.length === 0 && anomalies.length === 0) {
    throw new Error("This draft has no lesson allocation data to report.");
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
