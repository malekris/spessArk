import { loadPdfTools } from "../../../utils/loadPdfTools.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const STREAMS = [
  "S1::North",
  "S1::South",
  "S2::North",
  "S2::South",
  "S3::North",
  "S3::South",
  "S4::North",
  "S4::South",
  "S5::Arts",
  "S5::Sciences",
  "S6::Arts",
  "S6::Sciences",
];

const INK = [18, 18, 18];
const GRID = [24, 24, 24];
const WHITE = [255, 255, 255];
const LABEL_FILL = [188, 186, 186];
const PAUSE_FILL = [208, 206, 206];

const HEADER_CELLS = [
  { content: "Day", styles: { fillColor: LABEL_FILL } },
  { content: "Class", styles: { fillColor: LABEL_FILL } },
  "8:00\n8:40",
  "8:40\n9:20",
  "9:20\n10:00",
  "10:00\n10:40",
  "10:40\n11:20",
  { content: "Class", styles: { fillColor: LABEL_FILL } },
  "11:20\n12:00",
  "12:00\n12:40",
  "12:40\n1:20",
  "1:20\n2:20",
  { content: "Class", styles: { fillColor: LABEL_FILL } },
  "2:20\n3:00",
  "3:00\n3:40",
  "3:40\n4:20",
  "4:20\n5:10",
].map((cell) =>
  typeof cell === "string"
    ? { content: cell, styles: { fillColor: WHITE } }
    : cell
);

const SUBJECT_CODES = new Map([
  ["english", "ENG"],
  ["english language", "ENG"],
  ["mathematics", "MATH"],
  ["math", "MATH"],
  ["physics", "PHY"],
  ["chemistry", "CHEM"],
  ["biology", "BIO"],
  ["geography", "GEOG"],
  ["history", "HIS"],
  ["divinity", "DIV"],
  ["kiswahili", "KIS"],
  ["swahili", "KIS"],
  ["physical education", "PE"],
  ["pe", "PE"],
  ["entrepreneurship", "ENT"],
  ["ent", "ENT"],
  ["economics", "ECON"],
  ["econ", "ECON"],
  ["agriculture", "AGR"],
  ["agric", "AGR"],
  ["art", "ART"],
  ["ict", "ICT"],
  ["cre", "CRE"],
  ["ire", "IRE"],
  ["luganda", "LUG"],
  ["literature", "LIT"],
  ["literature in english", "LIT"],
  ["project", "PROJECT"],
  ["general paper", "GP"],
  ["subsidiary mathematics", "SUB MATH"],
  ["sub maths", "SUB MATH"],
  ["sub math", "SUB MATH"],
  ["sub ict", "SUB ICT"],
  ["sub ict sub maths", "ICT / SUB MATH"],
  ["sub ict sub math", "ICT / SUB MATH"],
  ["ent econ", "ENT / ECON"],
  ["cre ire", "CRE / IRE"],
  ["lit lug", "LIT / LUG"],
  ["vocational cluster", "VOCATIONAL"],
  ["other subjects cluster", "OTHERS"],
]);

const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const streamCode = (streamKey) => {
  const [classLevel, stream] = String(streamKey || "").split("::");
  return `${classLevel || ""}${String(stream || "").slice(0, 1).toUpperCase()}`;
};

const classStreamKeys = (classLevel) =>
  ["S5", "S6"].includes(classLevel)
    ? [`${classLevel}::Arts`, `${classLevel}::Sciences`]
    : [`${classLevel}::North`, `${classLevel}::South`];

const teacherFirstName = (value) => String(value || "").trim().split(/\s+/)[0] || "";

const subjectCode = (value) => {
  const cleaned = normalize(String(value || "").replace(/staffing required/gi, ""));
  if (SUBJECT_CODES.has(cleaned)) return SUBJECT_CODES.get(cleaned);
  return String(value || "")
    .replace(/\s+-\s+staffing required/gi, "")
    .trim()
    .toUpperCase()
    .slice(0, 16);
};

const lessonCell = (value, colSpan = 1, styles = {}) => {
  const display = value && typeof value === "object" ? value : null;
  return {
    content: display?.text || (display ? "" : value || ""),
    colSpan,
    ...(display?.parts?.length ? { pdfLessonParts: display.parts } : {}),
    styles: {
      fillColor: WHITE,
      textColor: INK,
      halign: "center",
      valign: "middle",
      ...styles,
    },
  };
};

const labelCell = (content) => ({
  content,
  styles: {
    fillColor: LABEL_FILL,
    textColor: INK,
    fontStyle: "bold",
    halign: "center",
    valign: "middle",
  },
});

const verticalCell = (text, rowSpan, colSpan = 1, fillColor = PAUSE_FILL) => ({
  content: "",
  rowSpan,
  colSpan,
  pdfVerticalText: text,
  styles: {
    fillColor,
    textColor: INK,
    fontStyle: "bold",
    halign: "center",
    valign: "middle",
  },
});

function eventSessions(version, event) {
  if (!event) return [];
  return version.sessions.filter((session) => {
    if (event.blockKey && session.blockKey === event.blockKey) return true;
    if (event.id && session.eventId && String(session.eventId) === String(event.id)) return true;
    return event.eventKey && session.eventKey && session.eventKey === event.eventKey;
  });
}

function eventDisplay(version, event, { includeClass = false } = {}) {
  if (!event) return "";
  if (["assembly", "church"].includes(event.eventType)) {
    return { text: event.subjectLabel.toUpperCase() };
  }
  const classText = includeClass ? `${event.classLevel}${String(event.stream || "").slice(0, 1)} ` : "";
  const sessions = eventSessions(version, event);
  const parts = sessions.map((session) => ({
    subject: `${classText}${subjectCode(session.subjectLabel)}`,
    teacher: teacherFirstName(session.teacherName),
  }));
  if (parts.length === 0) {
    parts.push({
      subject: `${classText}${subjectCode(event.subjectLabel)}`,
      teacher: teacherFirstName(event.teacherName) || "STAFF?",
    });
  }
  return {
    parts: Array.from(
      new Map(parts.map((part) => [`${part.subject}::${part.teacher}`, part])).values()
    ),
  };
}

function streamSlotDisplay(version, streamKey, day, slotCode) {
  const [classLevel, stream] = streamKey.split("::");
  const event = version.events.find(
    (item) =>
      item.classLevel === classLevel &&
      item.stream === stream &&
      item.day === day &&
      item.slotCode === slotCode
  );
  return eventDisplay(version, event);
}

function teacherSlotLabel(version, teacherId, day, slotCode) {
  const sessions = version.sessions.filter(
    (session) =>
      String(session.teacherId) === String(teacherId) &&
      session.day === day &&
      session.slotCode === slotCode
  );
  return sessions
    .map((session) => {
      const stream = String(session.streamsLabel || "")
        .split("&")
        .map((value) => value.trim().slice(0, 1))
        .filter(Boolean)
        .join("&");
      return `${subjectCode(session.subjectLabel)}\n${session.classLevel}${stream}`;
    })
    .join(" / ");
}

function buildStreamDayRows(version, day, streamKeys) {
  const rowCount = streamKeys.length;
  return streamKeys.map((streamKey, index) => {
    const row = [];
    const firstRow = index === 0;
    if (firstRow) {
      row.push(
        rowCount === 1
          ? labelCell(day.toUpperCase())
          : verticalCell(day.toUpperCase(), rowCount, 1, LABEL_FILL)
      );
    }
    const code = streamCode(streamKey);
    row.push(labelCell(code));
    row.push(lessonCell(streamSlotDisplay(version, streamKey, day, "P1"), 2));
    if (day === "Monday") {
      if (firstRow) row.push(verticalCell("ASSEMBLY", rowCount, 2, PAUSE_FILL));
    } else {
      row.push(lessonCell(streamSlotDisplay(version, streamKey, day, "P2"), 2));
    }
    if (firstRow) row.push(verticalCell("BREAK", rowCount, 1, PAUSE_FILL));
    row.push(labelCell(code));
    if (day === "Friday") {
      row.push(lessonCell(streamSlotDisplay(version, streamKey, day, "P3A"), 1));
      if (firstRow) row.push(verticalCell("CHURCH", rowCount, 2, PAUSE_FILL));
    } else {
      row.push(lessonCell(streamSlotDisplay(version, streamKey, day, "P3"), 3));
    }
    if (firstRow) row.push(verticalCell("LUNCH", rowCount, 1, PAUSE_FILL));
    row.push(labelCell(code));
    row.push(lessonCell(streamSlotDisplay(version, streamKey, day, "P4"), 2));
    row.push(lessonCell(streamSlotDisplay(version, streamKey, day, "P5"), 2));
    return row;
  });
}

function buildTeacherRows(version, teacherId, teacherName) {
  const label = teacherFirstName(teacherName).toUpperCase().slice(0, 9);
  return DAYS.map((day) => {
    const row = [labelCell(day.slice(0, 3).toUpperCase()), labelCell(label)];
    row.push(lessonCell(teacherSlotLabel(version, teacherId, day, "P1"), 2));
    row.push(
      day === "Monday"
        ? lessonCell("ASSEMBLY", 2, { fillColor: PAUSE_FILL, fontStyle: "bold" })
        : lessonCell(teacherSlotLabel(version, teacherId, day, "P2"), 2)
    );
    row.push(lessonCell("BREAK", 1, { fillColor: PAUSE_FILL, fontStyle: "bold" }));
    row.push(labelCell(label));
    if (day === "Friday") {
      row.push(lessonCell(teacherSlotLabel(version, teacherId, day, "P3A"), 1));
      row.push(lessonCell("CHURCH", 2, { fillColor: PAUSE_FILL, fontStyle: "bold" }));
    } else {
      row.push(lessonCell(teacherSlotLabel(version, teacherId, day, "P3"), 3));
    }
    row.push(lessonCell("LUNCH", 1, { fillColor: PAUSE_FILL, fontStyle: "bold" }));
    row.push(labelCell(label));
    row.push(lessonCell(teacherSlotLabel(version, teacherId, day, "P4"), 2));
    row.push(lessonCell(teacherSlotLabel(version, teacherId, day, "P5"), 2));
    return row;
  });
}

function columnStyles(doc, format) {
  const availableWidth = doc.internal.pageSize.getWidth() - 14;
  const dayWidth = format === "a3" ? 20 : 15;
  const classWidth = format === "a3" ? 17 : 12;
  const pauseWidth = format === "a3" ? 20 : 14;
  const timeWidth = (availableWidth - dayWidth - classWidth * 3 - pauseWidth * 2) / 11;
  const styles = { 0: { cellWidth: dayWidth } };
  [1, 7, 12].forEach((index) => {
    styles[index] = { cellWidth: classWidth };
  });
  [6, 11].forEach((index) => {
    styles[index] = { cellWidth: pauseWidth };
  });
  [2, 3, 4, 5, 8, 9, 10, 13, 14, 15, 16].forEach((index) => {
    styles[index] = { cellWidth: timeWidth };
  });
  return styles;
}

function drawVerticalCellText(doc, data) {
  const raw = data.cell.raw;
  if (!raw?.pdfVerticalText) return;
  const fontSize = Math.min(15, Math.max(10, data.cell.width * 0.7));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fontSize);
  doc.setTextColor(...INK);
  const textWidth = doc.getTextWidth(raw.pdfVerticalText);
  doc.text(
    raw.pdfVerticalText,
    data.cell.x + data.cell.width / 2 + textWidth / 2 + fontSize * 0.3528 * 0.42,
    data.cell.y + data.cell.height / 2 + textWidth / 2,
    { angle: 90, align: "center" }
  );
}

function drawLessonCellText(doc, data, dense) {
  const parts = data.cell.raw?.pdfLessonParts;
  if (!Array.isArray(parts) || parts.length === 0) return;

  const availableWidth = Math.max(1, data.cell.width - (dense ? 0.8 : 1.5));
  const separator = " / ";
  let subjectSize = dense ? 6.6 : 8;
  let teacherSize = dense ? 4.4 : 5.2;

  const measure = () => {
    let width = 0;
    parts.forEach((part, index) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(subjectSize);
      width += doc.getTextWidth(part.subject);
      if (part.teacher) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(teacherSize);
        width += doc.getTextWidth(part.teacher) + (dense ? 0.35 : 0.55);
      }
      if (index < parts.length - 1) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(subjectSize);
        width += doc.getTextWidth(separator);
      }
    });
    return width;
  };

  let contentWidth = measure();
  while (contentWidth > availableWidth && subjectSize > (dense ? 4.6 : 5)) {
    subjectSize -= 0.25;
    teacherSize = subjectSize * 0.66;
    contentWidth = measure();
  }

  let cursorX = data.cell.x + (data.cell.width - contentWidth) / 2;
  const subjectBaseline = data.cell.y + data.cell.height / 2 + subjectSize / 8;
  const teacherBaseline = subjectBaseline - subjectSize / (dense ? 4.7 : 4.2);
  doc.setTextColor(...INK);

  parts.forEach((part, index) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(subjectSize);
    doc.text(part.subject, cursorX, subjectBaseline);
    cursorX += doc.getTextWidth(part.subject);

    if (part.teacher) {
      cursorX += dense ? 0.35 : 0.55;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(teacherSize);
      doc.text(part.teacher, cursorX, teacherBaseline);
      cursorX += doc.getTextWidth(part.teacher);
    }

    if (index < parts.length - 1) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(subjectSize);
      doc.text(separator, cursorX, subjectBaseline);
      cursorX += doc.getTextWidth(separator);
    }
  });
}

function drawTitle(doc, title, subtitle, format) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(format === "a3" ? 20 : 12);
  doc.text(title, pageWidth / 2, 9, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(format === "a3" ? 8.5 : 6.5);
  doc.text(subtitle, pageWidth / 2, 14, { align: "center" });
}

function renderTimeGrid(doc, autoTable, { body, format, startY = 18, dense = false }) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const headerHeight = dense ? 12.5 : format === "a3" ? 17 : 14;
  const bottomMargin = dense ? 5 : 10;
  const footerAllowance = dense ? 1 : 12;
  const availableBodyHeight = pageHeight - startY - bottomMargin - headerHeight - footerAllowance;
  const rowHeight = dense
    ? availableBodyHeight / Math.max(body.length, 1)
    : Math.max(
        format === "a3" ? 14 : 11,
        Math.min(format === "a3" ? 31 : 32, availableBodyHeight / Math.max(body.length, 1))
      );

  autoTable(doc, {
    startY,
    margin: { left: 7, right: 7, bottom: bottomMargin },
    head: [HEADER_CELLS],
    body,
    theme: "grid",
    pageBreak: dense ? "avoid" : "auto",
    rowPageBreak: dense ? "avoid" : "auto",
    tableLineColor: GRID,
    tableLineWidth: 0.35,
    styles: {
      font: "helvetica",
      fontSize: dense ? 6.2 : format === "a3" ? 9.5 : 5.8,
      textColor: INK,
      fillColor: WHITE,
      lineColor: GRID,
      lineWidth: 0.28,
      cellPadding: dense ? 0.2 : format === "a3" ? 1.25 : 0.8,
      minCellHeight: rowHeight,
      overflow: "linebreak",
      halign: "center",
      valign: "middle",
    },
    headStyles: {
      fillColor: WHITE,
      textColor: INK,
      fontStyle: "bold",
      fontSize: dense ? 7 : format === "a3" ? 9 : 6.3,
      minCellHeight: headerHeight,
      cellPadding: dense ? 0.7 : undefined,
      lineWidth: 0.35,
      halign: "center",
      valign: "middle",
    },
    columnStyles: columnStyles(doc, format),
    didDrawCell: (data) => {
      drawVerticalCellText(doc, data);
      drawLessonCellText(doc, data, dense);
    },
  });
}

function departmentVersion(version, subject) {
  const target = normalize(subject);
  const sessions = version.sessions.filter(
    (session) => normalize(session.subjectLabel) === target
  );
  const matchingBlocks = new Set(sessions.map((session) => session.blockKey).filter(Boolean));
  const events = version.events.filter(
    (event) =>
      normalize(event.subjectLabel) === target ||
      (event.blockKey && matchingBlocks.has(event.blockKey))
  );
  return { ...version, events, sessions };
}

export function buildTimetablePdfDocument({
  jsPDF,
  autoTable,
  version,
  viewMode,
  viewTarget,
  teacherOptions = [],
  currentTerm = "Current Term",
}) {
  const format = viewMode === "master" ? "a3" : "a4";
  const doc = new jsPDF("l", "mm", format);

  if (viewMode === "master") {
    drawTitle(
      doc,
      `St Phillips Equatorial Secondary School Teaching and Learning Time Table - ${currentTerm}`,
      `${version.name} | MONDAY - FRIDAY | ${String(version.status).toUpperCase()}`,
      "a3"
    );
    renderTimeGrid(doc, autoTable, {
      body: DAYS.flatMap((day) => buildStreamDayRows(version, day, STREAMS)),
      format: "a3",
      dense: true,
    });
    return doc;
  }

  if (viewMode === "class") {
    drawTitle(doc, `${viewTarget} Class Timetable`, `${version.name} | ${version.academicYear}`, "a4");
    renderTimeGrid(doc, autoTable, {
      body: DAYS.flatMap((day) =>
        buildStreamDayRows(version, day, classStreamKeys(viewTarget))
      ),
      format: "a4",
    });
    return doc;
  }

  if (viewMode === "teacher") {
    const teacher = teacherOptions.find((item) => String(item.id) === String(viewTarget));
    const teacherName = teacher?.name || "Teacher";
    drawTitle(doc, `${teacherName} - Teacher Timetable`, `${version.name} | ${version.academicYear}`, "a4");
    renderTimeGrid(doc, autoTable, {
      body: buildTeacherRows(version, viewTarget, teacherName),
      format: "a4",
    });
    return doc;
  }

  if (viewMode === "department") {
    const filteredVersion = departmentVersion(version, viewTarget);
    DAYS.forEach((day, index) => {
      if (index > 0) doc.addPage("a4", "landscape");
      drawTitle(
        doc,
        `${viewTarget} Department Timetable`,
        `${version.name} | ${day.toUpperCase()} | ${version.academicYear}`,
        "a4"
      );
      renderTimeGrid(doc, autoTable, {
        body: buildStreamDayRows(filteredVersion, day, STREAMS),
        format: "a4",
      });
    });
    return doc;
  }

  drawTitle(doc, `${streamCode(viewTarget)} Stream Timetable`, `${version.name} | ${version.academicYear}`, "a4");
  renderTimeGrid(doc, autoTable, {
    body: DAYS.flatMap((day) => buildStreamDayRows(version, day, [viewTarget])),
    format: "a4",
  });
  return doc;
}

export async function openTimetablePdfPreview(options) {
  const previewWindow = window.open("", "_blank");
  if (!previewWindow) {
    throw new Error("Allow pop-ups for SPESS ARK to open the PDF preview.");
  }
  previewWindow.document.title = "Preparing timetable PDF";
  previewWindow.document.body.innerHTML =
    '<div style="font-family:system-ui;padding:32px;color:#1f2937">Preparing timetable preview...</div>';

  try {
    const { jsPDF, autoTable } = await loadPdfTools();
    const doc = buildTimetablePdfDocument({ jsPDF, autoTable, ...options });
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
