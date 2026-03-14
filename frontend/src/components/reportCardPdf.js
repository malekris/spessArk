 // src/components/ReportCardLayout.jsx
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import badge from "../assets/badge.png";
const RHYTHM = 6; // mm — base vertical unit
const getMedal = (position) => {
  if (position === 1) return " (1st)";
  if (position === 2) return " (2nd)";
  if (position === 3) return " (3rd)";
  return "";
};
const calculateAge = (dob) => {
  if (!dob) return "—";
  const birthDate = new Date(dob);
  const today = new Date();

  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();

  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
};
const COMMENT_BANK = {
  poor: {
    head: [
      "Needs to improve focus and consistency.",
      "Performance is below expectations.",
      "More effort and discipline required.",
      "Academic progress is limited.",
      "Requires closer academic supervision.",
      "Needs stronger commitment to studies.",
      "Must improve daily revision habits.",
      "Results show weak concept mastery.",
      "Requires immediate academic improvement.",
      "Should strengthen test preparation.",
      "Needs better class concentration.",
      "Must improve assignment completion.",
      "Shows low academic consistency.",
      "Should attend remedial support sessions.",
      "Needs improved academic discipline.",
      "Must reduce missed learning tasks.",
      "Requires improved exam readiness.",
      "Needs better time management.",
      "Should improve overall classroom effort.",
      "Must work harder for better outcomes.",
    ],
    class: [
      "Needs extra support in class.",
      "Struggles with core concepts.",
      "Must complete assignments consistently.",
      "Shows difficulty keeping up.",
      "Requires remedial attention.",
      "Needs regular guided revision.",
      "Should ask questions more often.",
      "Must improve note-taking habits.",
      "Needs better task submission routine.",
      "Should practice more past questions.",
      "Needs support in key topics.",
      "Must improve class participation.",
      "Should avoid incomplete classwork.",
      "Needs stronger homework discipline.",
      "Should revise after every lesson.",
      "Must improve learning consistency.",
      "Needs closer classroom monitoring.",
      "Should improve response accuracy.",
      "Needs support in foundational skills.",
      "Must build stronger study habits.",
    ],
  },

  average: {
    head: [
      "A fair performance with room for improvement.",
      "Shows steady academic progress.",
      "Can achieve better with consistency.",
      "Meets minimum academic expectations.",
      "Encouraging effort shown.",
      "Progress is moderate and improving.",
      "A reasonable term performance recorded.",
      "Can reach higher standards with focus.",
      "Shows potential for stronger grades.",
      "Needs more consistent revision.",
      "Demonstrates fair academic understanding.",
      "Should increase effort for better outcomes.",
      "A balanced but improvable performance.",
      "Results are acceptable, not yet strong.",
      "Should aim for greater consistency.",
      "Performance is improving gradually.",
      "Can perform better with planning.",
      "Shows stable but average progress.",
      "Needs extra effort in weak areas.",
      "Should target higher achievement next term.",
    ],
    class: [
      "Participates fairly in class.",
      "Understands most concepts.",
      "Needs more revision.",
      "Shows potential to improve.",
      "Good effort overall.",
      "Should improve answer precision.",
      "Can benefit from weekly practice.",
      "Needs stronger exam technique.",
      "Should increase classroom engagement.",
      "Can improve with regular assignments.",
      "Needs better consistency in tests.",
      "Should revise difficult topics more.",
      "Can move to higher grade bands.",
      "Needs improved speed and accuracy.",
      "Should strengthen independent study.",
      "Can improve through structured revision.",
      "Needs more confidence in assessments.",
      "Should maintain effort throughout term.",
      "Can improve with clear study targets.",
      "Needs stronger focus during lessons.",
    ],
  },

  excellent: {
    head: [
      "Excellent academic performance.",
      "Demonstrates outstanding effort.",
      "Highly commendable results.",
      "Shows strong academic discipline.",
      "A model learner.",
      "Consistently high academic standards.",
      "Very strong and commendable performance.",
      "Exhibits excellent learning consistency.",
      "Results reflect sustained hard work.",
      "Outstanding mastery of key concepts.",
      "Shows exceptional commitment to studies.",
      "Excellent progress across assessed areas.",
      "Performs at a very high level.",
      "A strong example of academic focus.",
      "Delivers high-quality academic outcomes.",
      "Demonstrates mature study discipline.",
      "Excellent consistency in assessments.",
      "Shows very strong exam preparedness.",
      "Maintains impressive academic momentum.",
      "A high achiever with strong potential.",
    ],
    class: [
      "Very attentive in class.",
      "Consistently strong performance.",
      "Shows deep understanding.",
      "Sets a good example.",
      "Excellent classroom engagement.",
      "Maintains high-quality class contributions.",
      "Demonstrates excellent problem-solving skills.",
      "Shows strong accuracy in assessments.",
      "Consistently submits quality classwork.",
      "Exhibits strong leadership in learning.",
      "Shows excellent preparation for lessons.",
      "Demonstrates advanced concept understanding.",
      "Maintains very high participation levels.",
      "Excellent consistency in class tasks.",
      "Shows strong independent study habits.",
      "Performs very well under assessment conditions.",
      "Demonstrates exceptional focus in class.",
      "Maintains strong academic confidence.",
      "Shows excellent revision discipline.",
      "Consistently performs above expectations.",
    ],
  },
};
const abbreviateName = (name = "") => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]; // single-name fallback

  const firstInitial = parts[0][0].toUpperCase();
  const lastName = parts[parts.length - 1];

  return `${firstInitial}. ${lastName}`;
};

const formatReportSubject = (subject = "") => {
  return String(subject).trim() === "Christian Religious Education"
    ? "CRE"
    : String(subject || "");
};

const originalWarn = console.warn;
console.warn = (...args) => {
  if (
    typeof args[0] === "string" &&
    args[0].includes("units width could not fit page")
  ) {
    return;
  }
  originalWarn(...args);
};
/**
 * Generate End of Term Report Card PDF
 * @param {Array} data - API response rows (processed, with average & remark)
 * @param {Object} meta - { term, year, class_level, stream }
 */
export default async function generateReportCardPDF(data, meta) {
  if (!data || data.length === 0) {
    alert("No report data available");
    return;
  }

  const isEndOfYear = meta?.reportType === "year";
  // Unified portrait layout for both term and end-of-year reports.
  const doc = new jsPDF("p", "mm", "a4");
  // ===== PAGE METRICS =====
const PAGE_WIDTH = doc.internal.pageSize.getWidth();
const PAGE_HEIGHT = doc.internal.pageSize.getHeight();

// Backward compatibility
const pageWidth = PAGE_WIDTH;

// ===== COLUMN LAYOUT =====
const LEFT_COL_X = 15;
const RIGHT_COL_X = pageWidth / 2 + 5;
// Use a single-column flow for all report types (layout-only change).
const SINGLE_COLUMN_MODE = true;
const COLUMN_WIDTH = SINGLE_COLUMN_MODE ? pageWidth - 30 : pageWidth / 2 - 25;
const TERM_MARKS_TABLE_WIDTH = COLUMN_WIDTH * 0.92;
const ACTIVE_TABLE_WIDTH = isEndOfYear ? COLUMN_WIDTH : TERM_MARKS_TABLE_WIDTH;
const TERM_SUBJECT_WIDTH = TERM_MARKS_TABLE_WIDTH * 0.2;
const TERM_AOI_WIDTH = TERM_MARKS_TABLE_WIDTH * 0.085;
const TERM_AV_WIDTH = TERM_MARKS_TABLE_WIDTH * 0.085;
const TERM_REMARK_WIDTH = TERM_MARKS_TABLE_WIDTH * 0.27;
const TERM_TEACHER_WIDTH = TERM_MARKS_TABLE_WIDTH * 0.19;

// ===== VERTICAL RHYTHM =====
const RHYTHM = 6;
const CONTENT_START_Y = 64; // 🔒 single source of truth
const TABLE_BORDER_COLOR = [0, 0, 0];
const TABLE_BORDER_WIDTH = 0.45;
const TABLE_HEADER_FILL = [245, 245, 245];
const TABLE_TEXT_COLOR = [0, 0, 0];

const buildTableStyles = (overrides = {}) => ({
  font: "helvetica",
  textColor: TABLE_TEXT_COLOR,
  lineColor: TABLE_BORDER_COLOR,
  lineWidth: TABLE_BORDER_WIDTH,
  ...overrides,
});

const buildHeadStyles = (overrides = {}) => ({
  fillColor: TABLE_HEADER_FILL,
  textColor: TABLE_TEXT_COLOR,
  fontStyle: "bold",
  lineColor: TABLE_BORDER_COLOR,
  lineWidth: TABLE_BORDER_WIDTH,
  ...overrides,
});

const getColumnX = () => {
  if (SINGLE_COLUMN_MODE) return LEFT_COL_X;
  return currentColumn === "left" ? LEFT_COL_X : RIGHT_COL_X;
};

const ensureSpace = (requiredHeight) => {
  if (SINGLE_COLUMN_MODE) {
    if (currentY + requiredHeight > PAGE_HEIGHT - 25) {
      doc.addPage();
      currentColumn = "left";
      currentY = CONTENT_START_Y + RHYTHM * 2;
    }
    return;
  }

  if (currentY + requiredHeight > PAGE_HEIGHT - 25) {
    if (currentColumn === "left") {
      currentColumn = "right";
      currentY = CONTENT_START_Y + RHYTHM * 2;

    } else {
      doc.addPage();
      currentColumn = "left";
      currentY = CONTENT_START_Y + RHYTHM * 2;

    }
  }
};

// tracking
let currentColumn = "left";
let currentY = 95; // below header + student info

  // 🔹 Group data per student
  const students = {};
  data.forEach((row) => {
    if (!students[row.student_id]) {
      students[row.student_id] = {
        info: row,
        subjects: [],
      };
    }
    students[row.student_id].subjects.push(row);
  });

  let firstPage = true;
  const studentList = Object.values(students);
  const progress = createReportProgressIndicator(studentList.length);
  progress.update(0);

  try {
    for (const [index, student] of studentList.entries()) {
    if (!firstPage) doc.addPage();
    firstPage = false;

        /* ===========================
          HEADER (CLEAN & SPACED)
         =========================== */
    
        // Badge
        doc.addImage(badge, "PNG", 15, 12, 18, 18);

        // School name
        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.text(
         "ST. PHILLIP'S EQUATORIAL SECONDARY SCHOOL",
          pageWidth / 2,
            18,
            { align: "center" }
);

// Address
doc.setFont("helvetica", "normal");
doc.setFontSize(10);
doc.text(
  "P.O. BOX 53, Kayabwe, Mpigi",
  pageWidth / 2,
  24,
  { align: "center" }
);

// Contacts (same size + equal spacing)
doc.setFontSize(10);
doc.text(
  "Email: stphillipsequatorial@gmail.com | www.stphillipsequatorial.com",
  pageWidth / 2,
  29,
  { align: "center" }
);

doc.text(
  "Tel: 0700651402, 0772571671, 0762001883, 0787301685",
  pageWidth / 2,
  34,
  { align: "center" }
);

        // Divider
doc.setLineWidth(0.6);
doc.line(15, 40, pageWidth - 15, 40);

// Report title (ONLY ONCE)
const reportTitle = isEndOfYear
  ? `END OF YEAR REPORT CARD — ${meta.year}`
  : `END OF TERM REPORT — TERM ${meta.term} ${meta.year}`;
doc.setFont("helvetica", "bold");
doc.setFontSize(12);
doc.text(
  reportTitle,
  pageWidth / 2,
  47,
  { align: "center" }
);




            /* ===========================
   STUDENT INFO (FIXED LAYOUT)
=========================== */

const infoStartY = 56; // add breathing room below report title
const infoLeftX = 15;
const infoRightX = pageWidth / 2 + 10;

doc.setFontSize(11);

// Labels
doc.setFont("helvetica", "bold");
doc.text("Name:", infoLeftX, infoStartY);
doc.text("Age:", infoLeftX, infoStartY + 6);

doc.text("Class:", infoRightX, infoStartY);
doc.text("Stream:", infoRightX, infoStartY + 6);

// Values
doc.setFont("helvetica", "normal");
doc.text(student.info.student_name || "—", infoLeftX + 22, infoStartY);
doc.text(
  String(calculateAge(student.info.dob)),
  infoLeftX + 22,
  infoStartY + 6
);

doc.text(student.info.class_level || "—", infoRightX + 30, infoStartY);
doc.text(student.info.stream || "—", infoRightX + 30, infoStartY + 6);
/* ===========================
   SUBJECT TABLE DATA (REQUIRED)
=========================== */
const formatCell = (v, digits = 2) =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v))
    ? ""
    : Number(v).toFixed(digits);
const formatAoiCell = (value, status) => {
  if (String(status || "").toLowerCase() === "missed") return "X";
  return formatCell(value, 1);
};
const displayMissedAsX = (value, fallback = "") => {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).trim().toUpperCase() === "MISSED" ? "X" : value;
};

const tableHead = isEndOfYear
  ? [[
      "Subject",
      "A1",
      "A2",
      "A3",
      "AVG",
      "20%",
      "80%",
      "100%",
      "GRD",
      "Remark",
      "Teacher",
    ]]
  : [[
      "Subject",
      "A1",
      "A2",
      "A3",
      "AV",
      "Remark",
      "Teacher",
    ]];

const tableData = isEndOfYear
  ? student.subjects.map((s) => [
      formatReportSubject(s.subject),
      formatAoiCell(s.AOI1, s.AOI1_status),
      formatAoiCell(s.AOI2, s.AOI2_status),
      formatAoiCell(s.AOI3, s.AOI3_status),
      formatCell(s.average, 2),
      formatCell(s.percent20, 2),
      formatCell(s.percent80, 2),
      formatCell(s.percent100, 2),
      s.grade || "",
      s.remark || "",
      abbreviateName(s.teacher_name),
    ])
  : student.subjects.map((s) => [
      formatReportSubject(s.subject),
      formatAoiCell(s.AOI1, s.AOI1_status),
      formatAoiCell(s.AOI2, s.AOI2_status),
      formatAoiCell(s.AOI3, s.AOI3_status),
      formatCell(s.average, 1),
      displayMissedAsX(s.remark, ""),
      abbreviateName(s.teacher_name),
    ]);

// 🔒 FORCE LEFT COLUMN FOR SUBJECTS
currentColumn = "left";
currentY = CONTENT_START_Y;

autoTable(doc, {
  startY: currentY,

  margin: {
    left: currentColumn === "left" ? LEFT_COL_X : RIGHT_COL_X,
  },

  tableWidth: ACTIVE_TABLE_WIDTH,

  head: tableHead,

  body: tableData,

  styles: buildTableStyles({
    fontSize: 9,
    cellPadding: 2,
    overflow: "linebreak",
    wordBreak: "normal",
    valign: "middle",
  }),

  headStyles: buildHeadStyles({
    fontSize: 9,
    cellPadding: 2,
  }),
  columnStyles: isEndOfYear
    ? {
        0: { cellWidth: COLUMN_WIDTH * 0.17 },
        1: { cellWidth: COLUMN_WIDTH * 0.07, halign: "center" },
        2: { cellWidth: COLUMN_WIDTH * 0.07, halign: "center" },
        3: { cellWidth: COLUMN_WIDTH * 0.07, halign: "center" },
        4: { cellWidth: COLUMN_WIDTH * 0.08, halign: "center" },
        5: { cellWidth: COLUMN_WIDTH * 0.08, halign: "center" },
        6: { cellWidth: COLUMN_WIDTH * 0.08, halign: "center" },
        7: { cellWidth: COLUMN_WIDTH * 0.09, halign: "center" },
        8: { cellWidth: COLUMN_WIDTH * 0.07, halign: "center" },
        9: {
          cellWidth: COLUMN_WIDTH * 0.14,
          overflow: "linebreak",
          halign: "left",
          cellPadding: { left: 2, right: 2, top: 2, bottom: 2 },
        },
        10: {
          cellWidth: COLUMN_WIDTH * 0.13,
          overflow: "ellipsize",
          halign: "center",
          cellPadding: { left: 2, right: 2, top: 2, bottom: 2 },
        },
      }
    : {
        0: { cellWidth: TERM_SUBJECT_WIDTH },
        1: { cellWidth: TERM_AOI_WIDTH, halign: "center" },
        2: { cellWidth: TERM_AOI_WIDTH, halign: "center" },
        3: { cellWidth: TERM_AOI_WIDTH, halign: "center" },
        4: { cellWidth: TERM_AV_WIDTH, halign: "center" },
        5: {
          cellWidth: TERM_REMARK_WIDTH,
          overflow: "visible",
          wordBreak: "keep-all",
          whiteSpace: "nowrap",
          halign: "left",
          cellPadding: { left: 2, right: 2, top: 2, bottom: 2 },
        },
        6: {
          cellWidth: TERM_TEACHER_WIDTH,
          overflow: "ellipsize",
          wordBreak: "keep-all",
          cellPadding: { left: 2, right: 2, top: 2, bottom: 2 },
        },
      },
  
  theme: "grid",
  
});


// remember where it ended (for safety)
const subjectsTableEndY = doc.lastAutoTable.finalY;
// For end-of-year portrait, keep summary/scale/comments below the marks table.
if (SINGLE_COLUMN_MODE) {
  currentColumn = "left";
  currentY = subjectsTableEndY + RHYTHM;
} else {
  // 🔁 FORCE SWITCH TO RIGHT COLUMN
  currentColumn = "right";
  currentY = CONTENT_START_Y;
}


// ✅ ALWAYS define afterTableY immediately after subject table
const afterTableY = doc.lastAutoTable.finalY + RHYTHM;

    /* ===========================
       OVERALL AVERAGE
    ============================ */
    const validAverages = student.subjects
      .map((s) => (isEndOfYear ? s.percent100 : s.average))
      .filter((a) => a !== null && a !== undefined && a !== "");

    let overallAverage = "X";
    if (validAverages.length > 0) {
      overallAverage = (
        validAverages.reduce((a, b) => a + b, 0) / validAverages.length
      ).toFixed(1);
    }

    const pickComment = (arr, id) => arr[id % arr.length];

    let category = "poor";
if (isEndOfYear) {
  if (Number(overallAverage) >= 80) category = "excellent";
  else if (Number(overallAverage) >= 60) category = "average";
} else {
  if (Number(overallAverage) >= 2.5) category = "excellent";
  else if (Number(overallAverage) >= 1.5) category = "average";
}

const headTeacherComment = pickComment(
  COMMENT_BANK[category].head,
  student.info.student_id
);

const classTeacherComment = pickComment(
  COMMENT_BANK[category].class,
  student.info.student_id
);

      /* ===========================
   SUMMARY LINE (ONE ROW)
    =========================== */
// Position values come from backend class-wide calculations.
const classPosition = Number(student.info.class_position) || 0;
const classTotal = Number(student.info.class_total) || 0;
const streamPosition = Number(student.info.stream_position) || 0;
const streamTotal = Number(student.info.stream_total) || 0;
const classPositionText =
  classPosition > 0 && classTotal > 0
    ? `${classPosition} / ${classTotal} ${getMedal(classPosition)}`
    : "—";
const streamPositionText =
  streamPosition > 0 && streamTotal > 0
    ? `${streamPosition} / ${streamTotal} ${getMedal(streamPosition)}`
    : "—";

// Draw line
/* ===========================
   SUMMARY TABLE (ONE ROW)
=========================== */
if (isEndOfYear) {
  ensureSpace(14);
  autoTable(doc, {
    startY: currentY,
    margin: { left: getColumnX() },
    tableWidth: COLUMN_WIDTH,
    body: [[
      `Overall Average: ${overallAverage}`,
      `Class Position: ${classPositionText}`,
      `Stream Position: ${streamPositionText}`,
    ]],
    styles: buildTableStyles({
      fontSize: 8.8,
      fontStyle: "bold",
      halign: "center",
      cellPadding: 1.8,
      lineHeight: 1.0,
    }),
    columnStyles: {
      0: { cellWidth: COLUMN_WIDTH / 3 },
      1: { cellWidth: COLUMN_WIDTH / 3 },
      2: { cellWidth: COLUMN_WIDTH / 3 },
    },
    theme: "grid",
  });
  currentY = doc.lastAutoTable.finalY + RHYTHM;
} else {
  ensureSpace(18);

  autoTable(doc, {
    startY: currentY,
    margin: { left: getColumnX() },
    tableWidth: TERM_MARKS_TABLE_WIDTH,

    head: [[
      "Overall Average",
      "Class Position",
      "Stream Position",
    ]],

    body: [[
      `${overallAverage}`,
      classPositionText,
      streamPositionText,
    ]],

    styles: buildTableStyles({
      fontSize: 9,
      halign: "center",
      cellPadding: 2,
      lineHeight: 1.0,
    }),

    headStyles: buildHeadStyles(),

    columnStyles: {
      0: { cellWidth: TERM_MARKS_TABLE_WIDTH / 3 },
      1: { cellWidth: TERM_MARKS_TABLE_WIDTH / 3 },
      2: { cellWidth: TERM_MARKS_TABLE_WIDTH / 3 },
    },

    theme: "grid",
  });

  currentY = doc.lastAutoTable.finalY + RHYTHM;
}

 /* ===========================
   GRADING SCALE (COMPACT)
=========================== */
ensureSpace(10);
autoTable(doc, {
  startY: currentY,
  margin: { left: getColumnX() },
  tableWidth: isEndOfYear ? COLUMN_WIDTH : TERM_MARKS_TABLE_WIDTH,
  body: [[
    "BASIC: 0.9 - 1.4",
    "MODERATE: 1.5 - 2.4",
    "OUTSTANDING: 2.5 - 3.0",
  ]],
  styles: buildTableStyles({
    fontSize: 8.6,
    fontStyle: "bold",
    halign: "center",
    cellPadding: 1.8,
    lineHeight: 1.0,
  }),
  columnStyles: {
    0: { cellWidth: (isEndOfYear ? COLUMN_WIDTH : TERM_MARKS_TABLE_WIDTH) / 3 },
    1: { cellWidth: (isEndOfYear ? COLUMN_WIDTH : TERM_MARKS_TABLE_WIDTH) / 3 },
    2: { cellWidth: (isEndOfYear ? COLUMN_WIDTH : TERM_MARKS_TABLE_WIDTH) / 3 },
  },
  theme: "grid",
});
currentY = doc.lastAutoTable.finalY + RHYTHM * 0.75;

/* ===========================
   END OF YEAR GRADE BANDS
=========================== */
if (isEndOfYear) {
  ensureSpace(8);
  autoTable(doc, {
    startY: currentY,
    margin: { left: getColumnX() },
    tableWidth: COLUMN_WIDTH,
    body: [[
      "A: 80 - 100",
      "B: 70 - 79",
      "C: 60 - 69",
      "D: 50 - 59",
      "E: 00 - 49",
    ]],
    styles: buildTableStyles({
      fontSize: 8.6,
      fontStyle: "bold",
      halign: "center",
      cellPadding: 1.8,
      lineHeight: 1.0,
    }),
    columnStyles: {
      0: { cellWidth: COLUMN_WIDTH / 5 },
      1: { cellWidth: COLUMN_WIDTH / 5 },
      2: { cellWidth: COLUMN_WIDTH / 5 },
      3: { cellWidth: COLUMN_WIDTH / 5 },
      4: { cellWidth: COLUMN_WIDTH / 5 },
    },
    theme: "grid",
  });
  currentY = doc.lastAutoTable.finalY + RHYTHM * 0.75;
}

/* ===========================
   COMMENTS TABLE
=========================== */
ensureSpace(35);

autoTable(doc, {
  startY: currentY,
  margin: { left: getColumnX() },
  tableWidth: isEndOfYear ? COLUMN_WIDTH : TERM_MARKS_TABLE_WIDTH,

  head: [["HEAD TEACHER", "CLASS TEACHER"]],

  body: [
    [headTeacherComment, classTeacherComment],
    ["Signature: ____________________", "Signature: ____________________"]
  ],

  styles: buildTableStyles({
    fontSize: 11,
    lineHeight: 1.0,
    cellPadding: 2,
  }),

  headStyles: buildHeadStyles(),

  columnStyles: {
    0: { cellWidth: (isEndOfYear ? COLUMN_WIDTH : TERM_MARKS_TABLE_WIDTH) / 2 },
    1: { cellWidth: (isEndOfYear ? COLUMN_WIDTH : TERM_MARKS_TABLE_WIDTH) / 2 },
  },

  theme: "grid",
});

currentY = doc.lastAutoTable.finalY + RHYTHM;

/* ===========================
   REQUIREMENTS
=========================== */
ensureSpace(22);

doc.setFont("helvetica", "bold");
doc.setFontSize(10);
doc.text("Requirements for Next Term:", getColumnX(), currentY);

doc.setFont("helvetica", "normal");
const requirementItems = ["Toilet paper", "Reams of paper", "Brooms"];
doc.text(`• ${requirementItems.join("  •  ")}`, getColumnX() + 2, currentY + RHYTHM);

currentY += RHYTHM * 2;

/* ===========================
   TERM DATES (AFTER REQUIREMENTS)
=========================== */

ensureSpace(12);

doc.setFont("helvetica", "bold");
doc.setFontSize(10);
const datesY = currentY;
const termDatesLeftX = getColumnX();
const termDatesRightX = termDatesLeftX + COLUMN_WIDTH * 0.52;

doc.text("Term Ended:", termDatesLeftX, datesY);
doc.text("Next Term Begins:", termDatesRightX, datesY);

doc.setFont("helvetica", "normal");
doc.text("__________", termDatesLeftX + 24, datesY);
doc.text("__________", termDatesRightX + 35, datesY);

currentY += RHYTHM * 2;

    progress.update(index + 1);
    await nextPaint();
  }
  // ✅ ADD FOOTER AFTER ALL CONTENT IS DONE
addFooter(doc);

const filename = `ReportCard_Term${meta.term}_${meta.year}_${String(meta.class_level || "Class")}_${String(meta.stream || "Stream")}.pdf`
  .replace(/\s+/g, "_")
  .replace(/[^a-zA-Z0-9_.-]/g, "");
const title = `Report Card - Term ${meta.term} ${meta.year} - ${meta.class_level || "Class"} ${meta.stream || ""}`.trim();
openNamedPdfPreview(doc, filename, title);
progress.complete();
setTimeout(() => progress.destroy(), 1200);
  } catch (err) {
    progress.destroy();
    throw err;
  }

  
  
// Optional: still allow download from preview tab
// Browser PDF viewer already has a download button

}

function nextPaint() {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function createReportProgressIndicator(total) {
  if (typeof document === "undefined") {
    return {
      update: () => {},
      complete: () => {},
      destroy: () => {},
    };
  }

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(2, 6, 23, 0.45)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "99999";

  const card = document.createElement("div");
  card.style.background = "#0f172a";
  card.style.border = "1px solid rgba(148,163,184,0.35)";
  card.style.borderRadius = "10px";
  card.style.padding = "12px 16px";
  card.style.color = "#e2e8f0";
  card.style.fontFamily = "Arial, sans-serif";
  card.style.fontSize = "14px";
  card.style.boxShadow = "0 16px 40px rgba(2,6,23,0.45)";

  const text = document.createElement("div");
  text.textContent = `Processing 0 / ${total} learners...`;
  card.appendChild(text);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  const startedAt = Date.now();
  const MIN_VISIBLE_MS = 1800;

  return {
    update(current) {
      text.textContent = `Processing ${current} / ${total} learners...`;
    },
    complete() {
      text.textContent = `Completed ${total} / ${total} learners.`;
    },
    destroy() {
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
      setTimeout(() => {
        overlay.remove();
      }, wait);
    },
  };
}

function openNamedPdfPreview(doc, filename, title) {
  const blob = doc.output("blob");
  const blobUrl = URL.createObjectURL(blob);
  const preview = window.open("", "_blank");

  if (!preview) {
    window.open(blobUrl, "_blank");
    return;
  }

  preview.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body { margin: 0; font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; }
          .bar {
            height: 48px; display: flex; align-items: center; justify-content: space-between;
            padding: 0 12px; border-bottom: 1px solid #334155; background: #111827;
          }
          .title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70vw; }
          .btn {
            text-decoration: none; background: #2563eb; color: #fff; padding: 8px 12px;
            border-radius: 8px; font-size: 12px; font-weight: 700;
          }
          iframe { width: 100vw; height: calc(100vh - 48px); border: 0; display: block; background: #fff; }
        </style>
      </head>
      <body>
        <div class="bar">
          <div class="title">${title}</div>
          <a class="btn" href="${blobUrl}" download="${filename}">Download PDF</a>
        </div>
        <iframe src="${blobUrl}" title="${title}"></iframe>
      </body>
    </html>
  `);
  preview.document.close();
}

function addFooter(doc) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    doc.text(
      `Generated from SPESS ARK • Generated on ${new Date().toLocaleString()} • Not valid without School Stamp`,
      pageWidth / 2,
      pageHeight - 10,
      { align: "center" }
    );
  }
}
