import badge from "../assets/badge.png";
import { loadPdfTools } from "../utils/loadPdfTools";

const calculateAge = (dob) => {
  if (!dob) return "-";
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return "-";

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDelta = today.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
};

const formatDateOnly = (value) => {
  if (!value) return "-";
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

const formatMiniRemarkForDisplay = (subject) => {
  if (String(subject?.status || "").trim().toLowerCase() === "missed") {
    return "MISSED";
  }
  if (
    subject?.score === null ||
    subject?.score === undefined ||
    subject?.score === "" ||
    !Number.isFinite(Number(subject.score))
  ) {
    return "NEVER SUBMITTED";
  }
  return subject?.remark || "";
};

const COMMENT_BANKS = {
  incompleteLoad: [
    "Some AOI 1 scores were never submitted. Please follow up with the responsible subject teachers.",
    "This AOI 1 record is incomplete because some subject scores were never submitted.",
    "Not all AOI 1 scores were submitted. Please contact the responsible subject teachers.",
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
    "The AOI 1 score was never submitted by the responsible subject teacher.",
    "No AOI 1 score was submitted for this subject.",
    "This report is awaiting an AOI 1 score that was never submitted.",
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

const normalizeMiniSubjectKey = (value) => {
  const compact = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const aliases = {
    cre: "christianreligiouseducation",
    christianreligiouseducation: "christianreligiouseducation",
    ict: "ict",
    informationcommunicationtechnology: "ict",
    informationandcommunicationtechnology: "ict",
    informationcommunicationsandtechnology: "ict",
    informationandcommunicationstechnology: "ict",
  };
  return aliases[compact] || compact;
};

const formatAnomalySubject = (value) => {
  const subject = String(value || "").trim();
  const aliases = {
    christianreligiouseducation: "CRE",
    physicaleducation: "PE",
    entrepreneurship: "ENT",
  };
  return aliases[normalizeMiniSubjectKey(subject)] || subject;
};

const uniqueSubjects = (subjects = []) => {
  const seen = new Set();
  return subjects.filter((subject) => {
    const key = normalizeMiniSubjectKey(subject);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const drawInlineSegments = (doc, segments, x, y, maxWidth) => {
  let fontSize = 7.1;
  const measure = () =>
    segments.reduce((width, segment) => {
      doc.setFont("helvetica", segment.bold ? "bold" : "normal");
      doc.setFontSize(fontSize);
      return width + doc.getTextWidth(segment.text);
    }, 0);

  while (fontSize > 5.6 && measure() > maxWidth) {
    fontSize = Number((fontSize - 0.2).toFixed(1));
  }

  let currentX = x;
  segments.forEach((segment) => {
    doc.setFont("helvetica", segment.bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    doc.text(segment.text, currentX, y);
    currentX += doc.getTextWidth(segment.text);
  });
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
        registered_subjects: Array.isArray(row.registered_subjects_list)
          ? row.registered_subjects_list
          : [],
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
      const presentSubjectKeys = new Set(
        student.subjects.map((subject) => normalizeMiniSubjectKey(subject.subject))
      );
      const missingSubjects = student.registered_subjects.filter(
        (subject) => !presentSubjectKeys.has(normalizeMiniSubjectKey(subject))
      );
      const missedSubjects = student.subjects
        .filter(
          (subject) => String(subject.status || "").trim().toLowerCase() === "missed"
        )
        .map((subject) => subject.subject);
      const pendingSubjects = student.subjects
        .filter((subject) => {
          if (String(subject.status || "").trim().toLowerCase() === "missed") return false;
          return (
            subject.score === null ||
            subject.score === undefined ||
            subject.score === "" ||
            !Number.isFinite(Number(subject.score))
          );
        })
        .map((subject) => subject.subject);

      return {
        ...student,
        subjects: [...student.subjects].sort((a, b) => a.subject.localeCompare(b.subject)),
        registered_subjects_count:
          Number(student.registered_subjects_count || 0) || student.subjects.length,
        average,
        anomalySubjects: {
          missed: uniqueSubjects(missedSubjects),
          neverSubmitted: uniqueSubjects([...missingSubjects, ...pendingSubjects]),
        },
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

export default async function generateMiniProgressReportPdf(rows, meta = {}, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    alert("No AOI 1 mini report data available.");
    return;
  }

  const grouped = groupMiniReportRows(rows);
  if (grouped.length === 0) {
    alert("No AOI 1 mini report data available.");
    return;
  }

  const { jsPDF, autoTable } = options.pdfTools || (await loadPdfTools());
  const badgeImage =
    options.badgeImage === undefined ? await loadBadgeImage() : options.badgeImage;
  const doc = new jsPDF("p", "mm", "a4");
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageMargin = 14;
  const contentWidth = pageWidth - pageMargin * 2;
  const colors = {
    navy: [11, 30, 48],
    emerald: [13, 126, 99],
    emeraldDark: [8, 82, 68],
    mint: [235, 248, 244],
    gold: [190, 145, 62],
    ink: [17, 24, 39],
    muted: [71, 85, 105],
    line: [30, 41, 59],
    soft: [247, 249, 251],
    reportTint: [226, 239, 235],
    white: [255, 255, 255],
  };

  const generatedAt = new Date().toLocaleString("en-GB");
  const termLabel = meta.term || "Term 1";
  const yearLabel = meta.year || new Date().getFullYear();
  const streamLabel = meta.stream || "-";
  const classLabel = meta.class_level || "-";

  if (onProgress) {
    onProgress({ completed: 0, total: grouped.length, percent: 5, stage: "Preparing mini reports..." });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  for (let index = 0; index < grouped.length; index += 1) {
    const student = grouped[index];
    if (index > 0) doc.addPage();

    doc.setDrawColor(...colors.navy);
    doc.setLineWidth(0.4);
    doc.roundedRect(9, 8, pageWidth - 18, pageHeight - 16, 2.4, 2.4);
    doc.setFillColor(...colors.gold);
    doc.roundedRect(9, 8, pageWidth - 18, 2.4, 1.2, 1.2, "F");

    if (badgeImage) {
      doc.addImage(badgeImage, "PNG", pageMargin + 2, 14, 17, 17);
    }

    doc.setTextColor(...colors.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("ST. PHILLIP'S EQUATORIAL SECONDARY SCHOOL", pageWidth / 2, 19.7, {
      align: "center",
    });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.2);
    doc.text("P.O. BOX 53, Kayabwe, Mpigi", pageWidth / 2, 25.1, { align: "center" });
    doc.setFontSize(8.8);
    doc.text(
      "stphillipsequatorial@gmail.com  |  www.stphillipsequatorial.com",
      pageWidth / 2,
      29.6,
      { align: "center" }
    );
    doc.text(
      "Tel: 0700651402, 0772571671, 0762001883, 0787301685",
      pageWidth / 2,
      34,
      { align: "center" }
    );

    doc.setDrawColor(...colors.gold);
    doc.setLineWidth(0.5);
    doc.line(pageMargin, 37.2, pageWidth - pageMargin, 37.2);

    doc.setFillColor(...colors.reportTint);
    doc.setDrawColor(...colors.emerald);
    doc.roundedRect(pageMargin, 40.5, contentWidth, 13.5, 1.8, 1.8, "FD");
    doc.setFillColor(...colors.gold);
    doc.roundedRect(pageMargin, 40.5, 3.2, 13.5, 1.6, 1.6, "F");
    doc.setTextColor(...colors.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15.2);
    doc.text("VISITATION DAY PROGRESS REPORT CARD", pageWidth / 2, 47.6, {
      align: "center",
    });
    doc.setTextColor(...colors.emeraldDark);
    doc.setFontSize(8.5);
    doc.text(`AOI 1 SNAPSHOT  |  ${termLabel.toUpperCase()}  |  ${yearLabel}`, pageWidth / 2, 51.5, {
      align: "center",
    });

    const learnerPanelY = 58;
    const learnerPanelHeight = 30;
    const learnerNameWidth = 108;
    doc.setFillColor(...colors.soft);
    doc.setDrawColor(...colors.emerald);
    doc.setLineWidth(0.35);
    doc.roundedRect(pageMargin, learnerPanelY, contentWidth, learnerPanelHeight, 1.8, 1.8, "FD");

    doc.setTextColor(...colors.emeraldDark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("LEARNER", pageMargin + 4, learnerPanelY + 5.4);

    doc.setTextColor(...colors.ink);
    doc.setFontSize(15.2);
    const learnerName = truncateToWidth(
      doc,
      String(student.student_name || "Unnamed learner").toUpperCase(),
      learnerNameWidth
    );
    doc.text(learnerName, pageMargin + 4, learnerPanelY + 13.2);

    const identityRightX = pageMargin + learnerNameWidth + 10;
    const identityMetricWidth = (contentWidth - learnerNameWidth - 14) / 2;
    [
      ["CLASS", student.class_level || classLabel],
      ["STREAM", student.stream || streamLabel],
    ].forEach(([label, value], metricIndex) => {
      const metricX = identityRightX + metricIndex * identityMetricWidth;
      doc.setTextColor(...colors.emeraldDark);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.3);
      doc.text(label, metricX, learnerPanelY + 5.4);
      doc.setTextColor(...colors.navy);
      doc.setFontSize(13);
      doc.text(String(value || "-"), metricX, learnerPanelY + 13.2);
    });

    const metaY = learnerPanelY + 18;
    const metaItems = [
      ["TERM", termLabel],
      ["YEAR", yearLabel],
      ["AGE", calculateAge(student.dob)],
      ["DATE OF BIRTH", formatDateOnly(student.dob)],
      ["SUBJECTS", student.registered_subjects_count || student.subjects.length],
    ];
    const metaItemWidth = contentWidth / metaItems.length;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.line(pageMargin, metaY, pageWidth - pageMargin, metaY);
    metaItems.forEach(([label, value], metaIndex) => {
      const itemX = pageMargin + metaIndex * metaItemWidth;
      if (metaIndex > 0) {
        doc.line(itemX, metaY + 2, itemX, learnerPanelY + learnerPanelHeight - 2);
      }
      doc.setTextColor(...colors.muted);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      doc.text(label, itemX + 3, metaY + 4.4);
      doc.setTextColor(...colors.ink);
      doc.setFontSize(9.6);
      doc.text(String(value || "-"), itemX + 3, metaY + 9.6);
    });

    doc.setTextColor(...colors.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.7);
    doc.text("AOI 1 ASSESSMENT RESULTS", pageMargin, 94);
    doc.setTextColor(...colors.muted);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.2);
    doc.text("Snapshot based on submitted scores", pageWidth - pageMargin, 94, {
      align: "right",
    });

    const subjectCount = student.subjects.length;
    const tableFontSize = subjectCount >= 11 ? 9.7 : subjectCount >= 9 ? 10.3 : 10.8;
    const rowMinHeight = subjectCount >= 11 ? 7.25 : subjectCount >= 9 ? 8.2 : 9.1;
    const tableStartY = 97;
    autoTable(doc, {
      startY: tableStartY,
      margin: { left: pageMargin, right: pageMargin },
      tableWidth: contentWidth,
      head: [["Subject", "AOI 1", "Remark", "Teacher"]],
      body: student.subjects.map((subject) => [
        subject.subject || "",
        formatScore(subject.score, subject.status),
        formatMiniRemarkForDisplay(subject),
        subject.teacher_name || "",
      ]),
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: tableFontSize,
        textColor: colors.ink,
        lineColor: colors.line,
        lineWidth: 0.3,
        cellPadding: { top: 1.6, right: 2.2, bottom: 1.6, left: 2.2 },
        minCellHeight: rowMinHeight,
        overflow: "ellipsize",
        valign: "middle",
      },
      headStyles: {
        fillColor: colors.reportTint,
        textColor: colors.navy,
        fontStyle: "bold",
        fontSize: 9.8,
        lineColor: colors.emeraldDark,
        lineWidth: 0.4,
        minCellHeight: 8.5,
      },
      alternateRowStyles: {
        fillColor: colors.soft,
      },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.3, fontStyle: "bold" },
        1: {
          cellWidth: contentWidth * 0.13,
          halign: "center",
          fontStyle: "bold",
          fontSize: tableFontSize + 0.8,
        },
        2: { cellWidth: contentWidth * 0.25 },
        3: { cellWidth: contentWidth * 0.32 },
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

    const summaryY = Math.max(finalTableY + 4, 184);
    const summaryHeight = 18;
    const summaryGap = 3.2;
    const summaryCardWidth = (contentWidth - summaryGap * 2) / 3;
    const summaryMetrics = [
      {
        label: "AOI 1 AVERAGE",
        value:
          student.average === null || student.average === undefined
            ? "-"
            : student.average.toFixed(2),
        primary: true,
      },
      { label: "CLASS POSITION", value: classPositionLabel },
      { label: "STREAM POSITION", value: streamPositionLabel },
    ];

    summaryMetrics.forEach((metric, metricIndex) => {
      const metricX = pageMargin + metricIndex * (summaryCardWidth + summaryGap);
      doc.setFillColor(...(metric.primary ? colors.reportTint : colors.mint));
      doc.setDrawColor(...colors.emerald);
      doc.setLineWidth(0.35);
      doc.roundedRect(metricX, summaryY, summaryCardWidth, summaryHeight, 1.6, 1.6, "FD");
      doc.setTextColor(...colors.emeraldDark);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.4);
      doc.text(metric.label, metricX + summaryCardWidth / 2, summaryY + 4.8, {
        align: "center",
      });
      doc.setTextColor(...colors.navy);
      doc.setFontSize(String(metric.value).length > 10 ? 11.5 : 16);
      doc.text(String(metric.value), metricX + summaryCardWidth / 2, summaryY + 13.4, {
        align: "center",
      });
    });

    const hasPositionNote = student.position_status !== "ELIGIBLE";
    const missedAnomalies = student.anomalySubjects?.missed || [];
    const neverSubmittedAnomalies = student.anomalySubjects?.neverSubmitted || [];
    const hasNamedAnomalies =
      missedAnomalies.length > 0 || neverSubmittedAnomalies.length > 0;
    const eligibilityY = summaryY + summaryHeight + 2.5;
    const eligibilityHeight = hasNamedAnomalies ? 12.5 : 8;

    if (hasPositionNote) {
      doc.setFillColor(...colors.mint);
      doc.setDrawColor(...colors.emerald);
      doc.setLineWidth(0.3);
      doc.roundedRect(
        pageMargin,
        eligibilityY,
        contentWidth,
        eligibilityHeight,
        1.5,
        1.5,
        "FD"
      );
      doc.setFillColor(...colors.gold);
      doc.roundedRect(pageMargin, eligibilityY, 2.6, eligibilityHeight, 1.3, 1.3, "F");
      doc.setTextColor(...colors.emeraldDark);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.4);
      doc.text(
        "Position is unavailable until enough required AOI 1 subject scores have been completed.",
        pageMargin + 6,
        eligibilityY + 4.3
      );

      if (hasNamedAnomalies) {
        const anomalySegments = [
          { text: "Subjects causing anomaly - ", bold: false },
        ];
        if (missedAnomalies.length > 0) {
          anomalySegments.push(
            { text: "Missed: ", bold: false },
            {
              text: missedAnomalies.map(formatAnomalySubject).join(", "),
              bold: true,
            }
          );
        }
        if (neverSubmittedAnomalies.length > 0) {
          anomalySegments.push(
            {
              text:
                missedAnomalies.length > 0
                  ? " | Never Submitted: "
                  : "Never Submitted: ",
              bold: false,
            },
            {
              text: neverSubmittedAnomalies.map(formatAnomalySubject).join(", "),
              bold: true,
            }
          );
        }
        doc.setTextColor(...colors.ink);
        drawInlineSegments(
          doc,
          anomalySegments,
          pageMargin + 6,
          eligibilityY + 9.2,
          contentWidth - 12
        );
      }
    }

    const commentY = hasPositionNote
      ? eligibilityY + eligibilityHeight + 2.5
      : summaryY + summaryHeight + 3;
    const commentHeight = 22;
    doc.setFillColor(...colors.soft);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.roundedRect(pageMargin, commentY, contentWidth, commentHeight, 1.8, 1.8, "FD");
    doc.setFillColor(...colors.emerald);
    doc.roundedRect(pageMargin, commentY, 3, commentHeight, 1.5, 1.5, "F");

    doc.setTextColor(...colors.emeraldDark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("CLASS TEACHER COMMENT", pageMargin + 7, commentY + 4.8);
    doc.setTextColor(...colors.ink);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const commentLines = doc
      .splitTextToSize(student.comment, contentWidth - 14)
      .slice(0, 2);
    doc.text(commentLines, pageMargin + 7, commentY + 9.5, { lineHeightFactor: 1.08 });

    const signatureY = commentY + commentHeight - 3.2;
    const signatureX = pageMargin + 7;
    doc.setTextColor(...colors.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.2);
    doc.text("Signature:", signatureX, signatureY);
    const signatureLabelWidth = doc.getTextWidth("Signature:");
    doc.setFont("helvetica", "normal");
    doc.text(
      "........................................",
      signatureX + signatureLabelWidth + 2,
      signatureY
    );

    const scaleTopY = commentY + commentHeight + 3.5;
    const performanceTableHeight = 8.5;
    const scaleColWidth = contentWidth / 3;
    doc.setDrawColor(...colors.navy);
    doc.setLineWidth(0.3);
    doc.roundedRect(
      pageMargin,
      scaleTopY,
      contentWidth,
      performanceTableHeight,
      1.5,
      1.5
    );
    doc.line(
      pageMargin + scaleColWidth,
      scaleTopY,
      pageMargin + scaleColWidth,
      scaleTopY + performanceTableHeight
    );
    doc.line(
      pageMargin + scaleColWidth * 2,
      scaleTopY,
      pageMargin + scaleColWidth * 2,
      scaleTopY + performanceTableHeight
    );
    [
      "BASIC  0.9 - 1.4",
      "MODERATE  1.5 - 2.4",
      "OUTSTANDING  2.5 - 3.0",
    ].forEach((label, scaleIndex) => {
      const centerX = pageMargin + scaleColWidth * scaleIndex + scaleColWidth / 2;
      doc.setTextColor(...colors.navy);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.4);
      doc.text(label, centerX, scaleTopY + 5.6, { align: "center" });
    });

    doc.setTextColor(...colors.muted);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.4);
    doc.text(
      "Report not valid without school stamp.",
      pageMargin,
      scaleTopY + performanceTableHeight + 4.2,
    );
    doc.setFont("helvetica", "normal");
    doc.text(
      `This term ends on: ${formatDateOnly(meta.termEndedOn)}`,
      pageMargin,
      scaleTopY + performanceTableHeight + 8.2
    );

    doc.setTextColor(...colors.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.text(
      `Generated ${generatedAt}  |  Confidential learner progress document  |  Page ${index + 1} of ${grouped.length}`,
      pageWidth / 2,
      pageHeight - 4.2,
      { align: "center" }
    );

    if (onProgress) {
      const completed = index + 1;
      const percent = Math.min(96, Math.round((completed / grouped.length) * 100));
      onProgress({
        completed,
        total: grouped.length,
        percent,
        stage: `Generating report ${completed} of ${grouped.length}`,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  if (options.openPdf === false) return doc;

  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  if (onProgress) {
    onProgress({ completed: grouped.length, total: grouped.length, percent: 100, stage: "Opening PDF..." });
  }
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return doc;
}
