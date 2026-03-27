import badge from "../assets/badge.png";
import { loadPdfTools } from "../utils/loadPdfTools";

const calculateAge = (dob) => {
  if (!dob) return "—";
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return "—";

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
};

const formatDateOnly = (value) => {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB");
};

const formatScore = (score, status) => {
  if (String(status || "").trim().toLowerCase() === "missed") return "X";
  if (score === null || score === undefined || score === "") return "";
  const numeric = Number(score);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : String(score);
};

const COMMENT_BANKS = {
  incompleteLoad: [
    "Some AOI 1 assessments are missing. Please see the subject teachers about the missing work.",
    "This AOI 1 record is incomplete. Kindly follow up with the subject teachers for the missing assessments.",
    "Not all AOI 1 assessments are on record yet. Please contact the subject teachers about the missing assessments.",
  ],
  low: [
    "Basic performance shown. More guided practice is needed.",
    "The learner needs closer support to strengthen AOI 1 work.",
    "A fair start, but stronger daily effort is required.",
    "More revision and class focus will improve performance.",
    "The learner should work harder to raise the current level.",
  ],
  mid: [
    "Good progress shown. Greater consistency will lift performance.",
    "A promising start. The learner should maintain regular effort.",
    "Steady work is evident. More confidence will improve results.",
    "The learner is progressing well and should keep practising.",
    "Satisfactory progress recorded. Continued focus is encouraged.",
  ],
  high: [
    "Very good performance shown. The learner should sustain it.",
    "Strong academic promise observed. Keep up the high standard.",
    "Excellent start in AOI 1. Continued discipline is encouraged.",
    "The learner is performing very well and should remain focused.",
    "Outstanding progress recorded. The learner should aim even higher.",
  ],
  missed: [
    "The learner missed the available AOI 1 assessment.",
    "No score was recorded because the learner missed AOI 1.",
    "The learner did not sit the available AOI 1 assessment.",
    "AOI 1 was missed, so no performance score could be recorded.",
  ],
  missedMultiple: [
    "Several AOI 1 assessments were missed. Please follow up on the missed work.",
  ],
  pending: [
    "AOI 1 is awaiting a submitted score.",
    "The available AOI 1 score is still pending submission.",
    "This slip is awaiting an AOI 1 score from the class record.",
  ],
};

const REQUIRED_SUBJECT_LOAD = {
  S1: 12,
  S2: 12,
  S3: 9,
  S4: 9,
};

const pickCommentFromBank = (bank, seedValue) => {
  const options = COMMENT_BANKS[bank] || COMMENT_BANKS.pending;
  const raw = String(seedValue || "spess-mini");
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) % 2147483647;
  }
  return options[Math.abs(hash) % options.length];
};

const buildComment = ({
  average,
  studentId,
  studentName,
  subjectCount,
  missedCount,
  scoredCount,
  classLevel,
}) => {
  const seed = `${studentId}-${studentName}-${classLevel}-${subjectCount}-${missedCount}-${String(average ?? "na")}`;
  const expectedLoad = REQUIRED_SUBJECT_LOAD[String(classLevel || "").trim().toUpperCase()] || null;

  if (expectedLoad && subjectCount < expectedLoad) {
    return pickCommentFromBank("incompleteLoad", seed);
  }

  if (missedCount >= 2) {
    return pickCommentFromBank("missedMultiple", seed);
  }

  if (scoredCount === 0 && missedCount > 0) {
    return pickCommentFromBank("missed", seed);
  }

  if (average === null || average === undefined || Number.isNaN(Number(average))) {
    return pickCommentFromBank("pending", seed);
  }

  const numeric = Number(average);
  if (numeric >= 2.5) return pickCommentFromBank("high", seed);
  if (numeric >= 1.5) return pickCommentFromBank("mid", seed);
  if (numeric >= 0.9) return pickCommentFromBank("low", seed);
  return pickCommentFromBank("pending", seed);
};

const truncateToWidth = (doc, text, maxWidth) => {
  const value = String(text || "").trim();
  if (!value) return "";
  if (doc.getTextWidth(value) <= maxWidth) return value;

  let trimmed = value;
  while (trimmed.length > 0 && doc.getTextWidth(`${trimmed}...`) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed ? `${trimmed}...` : "";
};

const drawLabelValue = (doc, label, value, x, y) => {
  doc.setFont("helvetica", "bold");
  doc.text(`${label}:`, x, y);
  const labelWidth = doc.getTextWidth(`${label}:`);
  doc.setFont("helvetica", "normal");
  doc.text(String(value || "—"), x + labelWidth + 1.4, y);
};

const groupMiniReportRows = (rows = []) => {
  const grouped = new Map();

  rows.forEach((row) => {
    const id = String(row.student_id);
    if (!grouped.has(id)) {
      grouped.set(id, {
        student_id: row.student_id,
        student_name: row.student_name,
        dob: row.dob,
        class_level: row.class_level,
        stream: row.stream,
        registered_subjects_count: Number(row.registered_subjects_count || 0),
        class_position: row.class_position ?? null,
        class_total: Number(row.class_total || 0),
        stream_position: row.stream_position ?? null,
        stream_total: Number(row.stream_total || 0),
        position_status: row.position_status || "INELIGIBLE",
        subjects: [],
      });
    }

    grouped.get(id).subjects.push({
      subject: row.subject,
      score: row.AOI1,
      status: row.AOI1_status,
      remark: row.remark,
      teacher_name: row.teacher_name,
    });
  });

  return Array.from(grouped.values())
    .map((student) => {
      const missedCount = student.subjects.filter(
        (subject) => String(subject.status || "").trim().toLowerCase() === "missed"
      ).length;
      const scored = student.subjects
        .filter((subject) => String(subject.status || "").trim().toLowerCase() !== "missed")
        .map((subject) => Number(subject.score))
        .filter((value) => Number.isFinite(value));

      const average =
        scored.length > 0
          ? Number((scored.reduce((sum, value) => sum + value, 0) / scored.length).toFixed(2))
          : null;

      return {
        ...student,
        subjects: [...student.subjects].sort((a, b) => a.subject.localeCompare(b.subject)),
        registered_subjects_count:
          Number(student.registered_subjects_count || 0) || student.subjects.length,
        average,
        comment: buildComment({
          average,
          studentId: student.student_id,
          studentName: student.student_name,
          subjectCount: student.subjects.length,
          missedCount,
          scoredCount: scored.length,
          classLevel: student.class_level,
        }),
      };
    })
    .sort((a, b) => a.student_name.localeCompare(b.student_name));
};

const loadBadgeImage = () =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = badge;
  });

export default async function generateMiniProgressReportPdf(rows, meta = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    alert("No AOI 1 mini report data available.");
    return;
  }

  const grouped = groupMiniReportRows(rows);
  if (grouped.length === 0) {
    alert("No AOI 1 mini report data available.");
    return;
  }

  const { jsPDF, autoTable } = await loadPdfTools();
  const badgeImage = await loadBadgeImage();
  const doc = new jsPDF("l", "mm", "a4");

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 8;
  const topMargin = 10;
  const gutter = 8;
  const slotHeight = pageHeight - topMargin * 2;
  const slotWidth = (pageWidth - marginX * 2 - gutter) / 2;

  const generatedAt = new Date().toLocaleString("en-GB");
  const termLabel = meta.term || "Term 1";
  const yearLabel = meta.year || new Date().getFullYear();
  const streamLabel = meta.stream || "—";
  const classLabel = meta.class_level || "—";

  grouped.forEach((student, index) => {
    const slotIndex = index % 2;
    if (index > 0 && slotIndex === 0) {
      doc.addPage();
    }

    const slotX = marginX + slotIndex * (slotWidth + gutter);
    const slotY = topMargin;
    const innerX = slotX + 4;
    const innerWidth = slotWidth - 8;

    doc.setDrawColor(0);
    doc.setLineWidth(0.45);
    doc.roundedRect(slotX, slotY, slotWidth, slotHeight, 4, 4);

    const headerHeight = 19;
    doc.setFillColor(240, 240, 240);
    doc.roundedRect(slotX, slotY, slotWidth, headerHeight, 4, 4, "F");
    doc.setDrawColor(0);
    doc.line(slotX, slotY + headerHeight, slotX + slotWidth, slotY + headerHeight);

    if (badgeImage) {
      doc.addImage(badgeImage, "PNG", innerX, slotY + 2.3, 9, 9);
    }

    doc.setTextColor(0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.8);
    doc.text("ST PHILLIP'S EQUATORIAL SECONDARY SCHOOL", badgeImage ? innerX + 12 : innerX, slotY + 6.2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(
      "www.stphillipsequatorial.com • info@stphillipsequatorial.com",
      badgeImage ? innerX + 12 : innerX,
      slotY + 10.4
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.1);
    doc.text("MINI PROGRESS REPORT • AOI 1", badgeImage ? innerX + 12 : innerX, slotY + 14.8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.3);
    const studentName = doc.splitTextToSize(student.student_name || "", innerWidth);
    doc.text(studentName, innerX, slotY + 25.5);
    const nameBlockHeight = Math.max(studentName.length, 1) * 4.2;
    const infoCol2 = innerX + innerWidth * 0.32;
    const infoCol3 = innerX + innerWidth * 0.64;
    const infoRow1Y = slotY + 27 + nameBlockHeight;
    const infoRow2Y = infoRow1Y + 6;
    const infoRow3Y = infoRow2Y + 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    drawLabelValue(doc, "Class", classLabel, innerX, infoRow1Y);
    drawLabelValue(doc, "Stream", streamLabel, infoCol2, infoRow1Y);
    drawLabelValue(
      doc,
      "Subjects Registered",
      student.registered_subjects_count || 0,
      infoCol3,
      infoRow1Y
    );
    drawLabelValue(doc, "Term", termLabel, innerX, infoRow2Y);
    drawLabelValue(doc, "Year", yearLabel, infoCol2, infoRow2Y);
    drawLabelValue(doc, "DOB", formatDateOnly(student.dob), infoCol3, infoRow2Y);
    drawLabelValue(doc, "Age", calculateAge(student.dob), innerX, infoRow3Y);
    drawLabelValue(doc, "Generated", generatedAt, infoCol2, infoRow3Y);

    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.2);
    doc.text("AOI 1 snapshot based on submitted scores only.", innerX, infoRow3Y + 6);

    const tableStartY = infoRow3Y + 9;
    autoTable(doc, {
      startY: tableStartY,
      margin: { left: innerX, right: innerX },
      tableWidth: innerWidth,
      head: [["Subject", "AOI 1", "Remark", "Teacher"]],
      body: student.subjects.map((subject) => [
        subject.subject || "",
        formatScore(subject.score, subject.status),
        subject.remark || "",
        subject.teacher_name || "",
      ]),
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 6.8,
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.25,
        cellPadding: 0.8,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [238, 238, 238],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        lineColor: [0, 0, 0],
        lineWidth: 0.35,
      },
      alternateRowStyles: {
        fillColor: [250, 250, 250],
      },
      columnStyles: {
        0: { cellWidth: innerWidth * 0.32 },
        1: { cellWidth: innerWidth * 0.11, halign: "center" },
        2: { cellWidth: innerWidth * 0.19 },
        3: { cellWidth: innerWidth * 0.38 },
      },
      pageBreak: "avoid",
      rowPageBreak: "avoid",
    });

    const finalTableY = doc.lastAutoTable?.finalY || tableStartY;
    const classPositionLabel =
      student.position_status === "ELIGIBLE" && student.class_position
        ? `${student.class_position} / ${student.class_total || 0}`
        : "INELIGIBLE";
    const streamPositionLabel =
      student.position_status === "ELIGIBLE" && student.stream_position
        ? `${student.stream_position} / ${student.stream_total || 0}`
        : "INELIGIBLE";

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.9);
    const commentLines = doc.splitTextToSize(`Comment: ${student.comment}`, innerWidth);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.1);
    const noteLines =
      student.position_status !== "ELIGIBLE"
        ? doc.splitTextToSize(
            "NOTE: INELIGIBLE means the learner did not have enough completed AOI 1 scores in all required subjects to be ranked.",
            innerWidth
          )
        : [];

    const performanceTableHeight = 10;
    const footerBlockHeight = 39 + commentLines.length * 3.8 + performanceTableHeight + noteLines.length * 3.3;
    const footerTopY = Math.min(finalTableY + 3, slotY + slotHeight - footerBlockHeight);
    const averageY = footerTopY + 5.5;
    const classPositionY = averageY + 5.3;
    const streamPositionY = classPositionY + 5.3;
    const commentY = streamPositionY + 5.3;
    const signatureY = commentY + commentLines.length * 3.8 + 5.2;
    const scaleTopY = signatureY + 3.4;
    const scaleHeaderY = scaleTopY + 3.4;
    const scaleRangeY = scaleTopY + 8.1;
    const noteY = scaleTopY + performanceTableHeight + 4.5;

    doc.setFillColor(255, 255, 255);
    doc.rect(innerX - 0.5, footerTopY - 2, innerWidth + 1, footerBlockHeight, "F");
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.line(innerX, footerTopY, innerX + innerWidth, footerTopY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.1);
    doc.text(
      `AOI 1 Average: ${
        student.average === null || student.average === undefined ? "—" : student.average.toFixed(2)
      }`,
      innerX,
      averageY
    );
    doc.text(`Class Position: ${classPositionLabel}`, innerX, classPositionY);
    doc.text(`Stream Position: ${streamPositionLabel}`, innerX, streamPositionY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.9);
    doc.text(commentLines, innerX, commentY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Signature: ____________________", innerX, signatureY);

    const scaleColWidth = innerWidth / 3;
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.rect(innerX, scaleTopY, innerWidth, performanceTableHeight);
    doc.line(innerX + scaleColWidth, scaleTopY, innerX + scaleColWidth, scaleTopY + performanceTableHeight);
    doc.line(innerX + scaleColWidth * 2, scaleTopY, innerX + scaleColWidth * 2, scaleTopY + performanceTableHeight);
    doc.line(innerX, scaleTopY + performanceTableHeight / 2, innerX + innerWidth, scaleTopY + performanceTableHeight / 2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.1);
    doc.text("BASIC", innerX + scaleColWidth / 2, scaleHeaderY, { align: "center" });
    doc.text("MODERATE", innerX + scaleColWidth * 1.5, scaleHeaderY, { align: "center" });
    doc.text("OUTSTANDING", innerX + scaleColWidth * 2.5, scaleHeaderY, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.text("0.9 - 1.4", innerX + scaleColWidth / 2, scaleRangeY, { align: "center" });
    doc.text("1.5 - 2.4", innerX + scaleColWidth * 1.5, scaleRangeY, { align: "center" });
    doc.text("2.5 - 3.0", innerX + scaleColWidth * 2.5, scaleRangeY, { align: "center" });

    if (noteLines.length > 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.1);
      doc.text(noteLines, innerX, noteY);
    }
  });

  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
