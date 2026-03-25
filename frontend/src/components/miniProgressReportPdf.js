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

const pickCommentFromBank = (bank, seedValue) => {
  const options = COMMENT_BANKS[bank] || COMMENT_BANKS.pending;
  const raw = String(seedValue || "spess-mini");
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) % 2147483647;
  }
  return options[Math.abs(hash) % options.length];
};

const buildComment = ({ average, studentId, studentName, subjectCount, missedCount, scoredCount }) => {
  const seed = `${studentId}-${studentName}-${subjectCount}-${missedCount}-${String(average ?? "na")}`;

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
  const doc = new jsPDF("p", "mm", "a4");

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 10;
  const topMargin = 10;
  const gutter = 8;
  const slotHeight = (pageHeight - topMargin * 2 - gutter) / 2;
  const slotWidth = pageWidth - marginX * 2;
  const slotXs = marginX;

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

    const slotY = topMargin + slotIndex * (slotHeight + gutter);
    const innerX = slotXs + 4;
    const innerWidth = slotWidth - 8;

    doc.setDrawColor(0);
    doc.setLineWidth(0.45);
    doc.roundedRect(slotXs, slotY, slotWidth, slotHeight, 4, 4);

    doc.setFillColor(240, 240, 240);
    doc.roundedRect(slotXs, slotY, slotWidth, 16, 4, 4, "F");
    doc.setDrawColor(0);
    doc.line(slotXs, slotY + 16, slotXs + slotWidth, slotY + 16);

    if (badgeImage) {
      doc.addImage(badgeImage, "PNG", innerX, slotY + 2.5, 10, 10);
    }

    doc.setTextColor(0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("ST PHILLIP'S EQUATORIAL SECONDARY SCHOOL", badgeImage ? innerX + 14 : innerX, slotY + 6.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.4);
    doc.text(
      "www.stphillipsequatorial.com • info@stphillipsequatorial.com",
      badgeImage ? innerX + 14 : innerX,
      slotY + 11.2
    );

    doc.setFontSize(11);
    doc.text("MINI PROGRESS REPORT • AOI 1", slotXs + slotWidth - 4, slotY + 7, {
      align: "right",
    });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const studentName = doc.splitTextToSize(student.student_name || "", innerWidth - 68);
    doc.text(studentName, innerX, slotY + 24.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    drawLabelValue(doc, "Class", classLabel, innerX, slotY + 31.5);
    drawLabelValue(doc, "Stream", streamLabel, innerX + 28, slotY + 31.5);
    drawLabelValue(
      doc,
      "Subjects Registered",
      student.registered_subjects_count || 0,
      innerX + 58,
      slotY + 31.5
    );
    drawLabelValue(doc, "Term", termLabel, innerX + 115, slotY + 31.5);
    drawLabelValue(doc, "Year", yearLabel, innerX + 145, slotY + 31.5);

    drawLabelValue(doc, "DOB", formatDateOnly(student.dob), innerX, slotY + 38.5);
    drawLabelValue(doc, "Age", calculateAge(student.dob), innerX + 48, slotY + 38.5);
    drawLabelValue(doc, "Generated", generatedAt, innerX + 72, slotY + 38.5);

    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text("AOI 1 snapshot based on submitted scores only.", innerX, slotY + 44.5);

    autoTable(doc, {
      startY: slotY + 47.5,
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
        fontSize: 7.3,
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.25,
        cellPadding: 1.0,
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
        0: { cellWidth: innerWidth * 0.34 },
        1: { cellWidth: innerWidth * 0.12, halign: "center" },
        2: { cellWidth: innerWidth * 0.20 },
        3: { cellWidth: innerWidth * 0.34 },
      },
      pageBreak: "avoid",
      rowPageBreak: "avoid",
    });

    const footerTopY = slotY + slotHeight - 31;
    const summaryY = footerTopY + 5.5;
    const commentY = footerTopY + 12;
    const signatureY = footerTopY + 18.5;
    const noteY = footerTopY + 25.5;
    const classPositionLabel =
      student.position_status === "ELIGIBLE" && student.class_position
        ? `${student.class_position} / ${student.class_total || 0}`
        : "INELIGIBLE";
    const streamPositionLabel =
      student.position_status === "ELIGIBLE" && student.stream_position
        ? `${student.stream_position} / ${student.stream_total || 0}`
        : "INELIGIBLE";

    doc.setFillColor(255, 255, 255);
    doc.rect(innerX - 0.5, footerTopY - 2, innerWidth + 1, 31, "F");
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
      summaryY
    );
    doc.text(`Class Position: ${classPositionLabel}`, innerX + 42, summaryY);
    doc.text(`Stream Position: ${streamPositionLabel}`, innerX + 104, summaryY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.9);
    doc.setFont("helvetica", "bold");
    doc.text("Comment:", innerX, commentY);
    doc.setFont("helvetica", "normal");
    const commentText = truncateToWidth(doc, student.comment, innerWidth - 18);
    doc.text(commentText, innerX + 16, commentY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Signature: ____________________", innerX, signatureY);

    if (student.position_status !== "ELIGIBLE") {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.1);
      doc.text(
        "NOTE: INELIGIBLE means the learner did not have enough completed AOI 1 scores in all required subjects to be ranked.",
        innerX,
        noteY
      );
    }
  });

  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
