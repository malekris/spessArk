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
    ],
    class: [
      "Needs extra support in class.",
      "Struggles with core concepts.",
      "Must complete assignments consistently.",
      "Shows difficulty keeping up.",
      "Requires remedial attention.",
    ],
  },

  average: {
    head: [
      "A fair performance with room for improvement.",
      "Shows steady academic progress.",
      "Can achieve better with consistency.",
      "Meets minimum academic expectations.",
      "Encouraging effort shown.",
    ],
    class: [
      "Participates fairly in class.",
      "Understands most concepts.",
      "Needs more revision.",
      "Shows potential to improve.",
      "Good effort overall.",
    ],
  },

  excellent: {
    head: [
      "Excellent academic performance.",
      "Demonstrates outstanding effort.",
      "Highly commendable results.",
      "Shows strong academic discipline.",
      "A model learner.",
    ],
    class: [
      "Very attentive in class.",
      "Consistently strong performance.",
      "Shows deep understanding.",
      "Sets a good example.",
      "Excellent classroom engagement.",
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
export default function generateReportCardPDF(data, meta) {
  if (!data || data.length === 0) {
    alert("No report data available");
    return;
  }

  const doc = new jsPDF("l", "mm", "a4");
  // ===== PAGE METRICS =====
const PAGE_WIDTH = doc.internal.pageSize.getWidth();
const PAGE_HEIGHT = doc.internal.pageSize.getHeight();

// Backward compatibility
const pageWidth = PAGE_WIDTH;

// ===== COLUMN LAYOUT =====
const LEFT_COL_X = 15;
const RIGHT_COL_X = pageWidth / 2 + 5;
const COLUMN_WIDTH = pageWidth / 2 - 25;

// ✅ ADD THIS
const SAFE_TABLE_WIDTH = COLUMN_WIDTH;

// ===== VERTICAL RHYTHM =====
const RHYTHM = 6;
const CONTENT_START_Y = 64; // 🔒 single source of truth

const getColumnX = () =>
  currentColumn === "left" ? LEFT_COL_X : RIGHT_COL_X;

const ensureSpace = (requiredHeight) => {
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

  Object.values(students).forEach((student) => {
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

// Contacts
doc.setFontSize(9);
doc.text(
  "Email: stphillipsequatorial@gmail.com | Tel: 0700651402, 0772571671, 0762001883, 0787301685",
  pageWidth / 2,
  29,
  { align: "center" }
);

        // Divider
doc.setLineWidth(0.6);
doc.line(15, 34, pageWidth - 15, 34);

// Report title (ONLY ONCE)
doc.setFont("helvetica", "bold");
doc.setFontSize(12);
doc.text(
  `END OF TERM REPORT — TERM ${meta.term} ${meta.year}`,
  pageWidth / 2,
  42,
  { align: "center" }
);




            /* ===========================
   STUDENT INFO (FIXED LAYOUT)
=========================== */

const infoStartY = 52; // ⬅ pushed down to avoid collision
const leftX = 15;
const rightX = pageWidth / 2 + 10;

doc.setFontSize(11);

// Labels
doc.setFont("helvetica", "bold");
doc.text("Name:", leftX, infoStartY);
doc.text("Age:", leftX, infoStartY + 6);

doc.text("Class:", rightX, infoStartY);
doc.text("Stream:", rightX, infoStartY + 6);

// Values
doc.setFont("helvetica", "normal");
doc.text(student.info.student_name || "—", leftX + 22, infoStartY);
doc.text(
  String(calculateAge(student.info.dob)),
  leftX + 22,
  infoStartY + 6
);

doc.text(student.info.class_level || "—", rightX + 30, infoStartY);
doc.text(student.info.stream || "—", rightX + 30, infoStartY + 6);
/* ===========================
   SUBJECT TABLE DATA (REQUIRED)
=========================== */
const tableData = student.subjects.map((s) => [
  s.subject,
  s.AOI1 ?? "—",
  s.AOI2 ?? "—",
  s.AOI3 ?? "—",
  s.average ?? "MISSED",
  s.remark,
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

  tableWidth: COLUMN_WIDTH,

  head: [[
    "Subject",
    "A1",
    "A2",
    "A3",
    "AV",
    "Remark",
    "Teacher",
  ]],

  body: tableData,

  styles: {
    font: "helvetica",
    fontSize: 9,
    cellPadding: 2,
    overflow: "linebreak",
    wordBreak: "normal",
    valign: "middle",
  },

  headStyles: {
    fillColor: [227, 235, 243],
    textColor: [31, 41, 55],
    fontStyle: "bold",
    fontSize: 9,
    cellPadding: 2,
  },
  columnStyles: {
    // Subject
    0: {
      cellWidth: COLUMN_WIDTH * 0.18,
    },
  
    // AOI columns
    1: { cellWidth: COLUMN_WIDTH * 0.08, halign: "center" },
    2: { cellWidth: COLUMN_WIDTH * 0.08, halign: "center" },
    3: { cellWidth: COLUMN_WIDTH * 0.08, halign: "center" },
  
    // Average
    4: {
      cellWidth: COLUMN_WIDTH * 0.08,
      halign: "center",
    },
  
      // 🔥 REMARK — NEVER BREAK WORDS
5: {
  cellWidth: COLUMN_WIDTH * 0.24,   // ⬅️ slightly wider (this is key)
  overflow: "visible",              // ⬅️ NOT linebreak, NOT ellipsize
  wordBreak: "keep-all",             // ⬅️ DO NOT split words
  whiteSpace: "nowrap",              // ⬅️ FORCE single line
  halign: "center",
  cellPadding: { left: 2, right: 2, top: 2, bottom: 2 },
},

  
    // 🔥 TEACHER — TAKE SPACE AWAY
    // 🔥 TEACHER — SLIM BUT SAFE
6: {
  cellWidth: COLUMN_WIDTH * 0.18,   // ⬅️ slightly smaller
  overflow: "ellipsize",
  wordBreak: "keep-all",
  cellPadding: { left: 2, right: 2, top: 2, bottom: 2 },
},

  },
  
  theme: "grid",
  
});


// remember where it ended (for safety)
const subjectsTableEndY = doc.lastAutoTable.finalY;
// 🔁 FORCE SWITCH TO RIGHT COLUMN
currentColumn = "right";
currentY = CONTENT_START_Y;


// ✅ ALWAYS define afterTableY immediately after subject table
const afterTableY = doc.lastAutoTable.finalY + RHYTHM;

    /* ===========================
       OVERALL AVERAGE
    ============================ */
    const validAverages = student.subjects
      .map((s) => s.average)
      .filter((a) => a !== null);

    let overallAverage = "MISSED";
    if (validAverages.length > 0) {
      overallAverage = (
        validAverages.reduce((a, b) => a + b, 0) / validAverages.length
      ).toFixed(1);
    }

    const pickComment = (arr, id) => arr[id % arr.length];

let category = "poor";
if (overallAverage >= 2.5) category = "excellent";
else if (overallAverage >= 1.5) category = "average";

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
ensureSpace(18);

autoTable(doc, {
  startY: currentY,
  margin: { left: getColumnX() },
  tableWidth: COLUMN_WIDTH,

  head: [[
    "Overall Average",
    "Class Position",
    "Stream Position"
  ]],

  body: [[
    `${overallAverage}`,
    classPositionText,
    streamPositionText
  ]],

  styles: {
    font: "helvetica",
    fontSize: 9,
    halign: "center",
    cellPadding: 2,
    lineHeight: 1.0,
  },

  headStyles: {
    fillColor: [227, 235, 243],
    textColor: [31, 41, 55],
    fontStyle: "bold",
  },

  columnStyles: {
    0: { cellWidth: COLUMN_WIDTH / 3 },
    1: { cellWidth: COLUMN_WIDTH / 3 },
    2: { cellWidth: COLUMN_WIDTH / 3 },
  },

  theme: "grid",
});

currentY = doc.lastAutoTable.finalY + RHYTHM;

 /* ===========================
   GRADING SCALE (COMPACT)
=========================== */
ensureSpace(16);

autoTable(doc, {
  startY: currentY,
  margin: { left: getColumnX() },
  tableWidth: COLUMN_WIDTH,

  head: [["BASIC", "MODERATE", "OUTSTANDING"]],
  body: [["0.9 – 1.4", "1.5 – 2.4", "2.5 – 3.0"]],

  styles: {
    font: "helvetica",
    fontSize: 9,
    halign: "center",
    cellPadding: 2,
    lineHeight: 1.0,
  },

  headStyles: {
    fillColor: [227, 235, 243],
    textColor: [31, 41, 55],
    fontStyle: "bold",
  },

  columnStyles: {
    0: { cellWidth: COLUMN_WIDTH / 3 },
    1: { cellWidth: COLUMN_WIDTH / 3 },
    2: { cellWidth: COLUMN_WIDTH / 3 },
  },

  theme: "grid",
});

currentY = doc.lastAutoTable.finalY + RHYTHM;

/* ✅ DEFINE commentY HERE */
const commentY = doc.lastAutoTable.finalY + 10;

/* ===========================
   COMMENTS TABLE
=========================== */
ensureSpace(35);

autoTable(doc, {
  startY: currentY,
  margin: { left: getColumnX() },
  tableWidth: COLUMN_WIDTH,

  head: [["HEAD TEACHER", "CLASS TEACHER"]],

  body: [
    [headTeacherComment, classTeacherComment],
    ["Signature: ____________________", "Signature: ____________________"]
  ],

  styles: {
    font: "helvetica",
    fontSize: 11,
    lineHeight: 1.0,
    cellPadding: 2,
  },

  headStyles: {
    fillColor: [227, 235, 243],
    textColor: [31, 41, 55],
    fontStyle: "bold",
  },

  columnStyles: {
    0: { cellWidth: COLUMN_WIDTH / 2 },
    1: { cellWidth: COLUMN_WIDTH / 2 },
  },

  theme: "grid",
});

currentY = doc.lastAutoTable.finalY + RHYTHM;

/* ===========================
   REQUIREMENTS
=========================== */
ensureSpace(10);

doc.setFont("helvetica", "bold");
doc.text("Requirements for Next Term:", getColumnX(), currentY);

doc.setFont("times", "normal");
doc.text(
  "Toilet paper • Reams of paper • Brooms",
  getColumnX() + 55,
  currentY
);

currentY += RHYTHM * 2;

/* ===========================
   TERM DATES (AFTER REQUIREMENTS)
=========================== */

ensureSpace(12);

doc.setFont("helvetica", "bold");
doc.text("This Term Has Ended On:", getColumnX(), currentY);
doc.text("Next Term Begins On:", getColumnX(), currentY + RHYTHM);

doc.setFont("helvetica", "normal");
doc.text("_________________", getColumnX() + 45, currentY);
doc.text("_________________", getColumnX() + 45, currentY + RHYTHM);

currentY += RHYTHM * 3;

    /* ===========================
       FOOTER
    ============================ */
    doc.setFontSize(8);
    doc.text(
      `Generated from SPESS ARK • ${new Date().toLocaleString()} • Not valid without stamp`,
      pageWidth / 2,
      290,
      { align: "center" }
    );
  });
  // ✅ ADD FOOTER AFTER ALL CONTENT IS DONE
addFooter(doc);

// Open PDF in new tab
const blobUrl = doc.output("bloburl");
window.open(blobUrl, "_blank");

  
  
// Optional: still allow download from preview tab
// Browser PDF viewer already has a download button

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
