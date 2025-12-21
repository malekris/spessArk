 // src/components/ReportCardLayout.jsx
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import badge from "../assets/badge.png";
const RHYTHM = 6; // mm — base vertical unit

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

  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();

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
doc.setFont("times", "bold");
doc.setFontSize(15);
doc.text(
  "ST. PHILLIP'S EQUATORIAL SECONDARY SCHOOL",
  pageWidth / 2,
  18,
  { align: "center" }
);

// Address
doc.setFont("times", "normal");
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
doc.setFont("times", "bold");
doc.setFontSize(12);
doc.text(
  `END OF TERM REPORT — TERM ${meta.term}`,
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
doc.setFont("times", "bold");
doc.text("Name:", leftX, infoStartY);
doc.text("Age:", leftX, infoStartY + 6);

doc.text("Class:", rightX, infoStartY);
doc.text("Stream:", rightX, infoStartY + 6);

// Values
doc.setFont("times", "normal");
doc.text(student.info.student_name || "—", leftX + 22, infoStartY);
doc.text(
  String(calculateAge(student.info.dob)),
  leftX + 22,
  infoStartY + 6
);

doc.text(student.info.class_level || "—", rightX + 30, infoStartY);
doc.text(student.info.stream || "—", rightX + 30, infoStartY + 6);

    /* ===========================
       SUBJECT TABLE
    ============================ */
    const tableData = student.subjects.map((s) => [
      s.subject,
      s.AOI1 ?? "—",
      s.AOI2 ?? "—",
      s.AOI3 ?? "—",
      s.average ?? "MISSED",
      s.remark,
      s.teacher_name,
    ]);

    autoTable(doc, {
      startY: infoStartY + RHYTHM * 2,

      head: [
        [
          "Subject",
          "AOI 1",
          "AOI 2",
          "AOI 3",
          "Average",
          "Remark",
          "Teacher",
        ],
      ],
      body: tableData,
      styles: {
        font: "times",
        fontSize: 10,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [39, 55, 78],
        textColor: 255,
      },
    });

    const afterTableY = doc.lastAutoTable.finalY + 6;
    const studentAverages = Object.values(students).map((s) => {
      const valid = s.subjects.map(x => x.average).filter(a => a !== null);
      const avg =
        valid.length > 0
          ? valid.reduce((a, b) => a + b, 0) / valid.length
          : 0;
    
          return {
            id: s.info.student_id,
            stream: (s.info.stream || "").trim().toLowerCase(),
            average: Number(avg.toFixed(2)),
          };
          
    });
    
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
   // ---------- POSITION CALCULATION (SAFE) ----------

const classRanked = [...studentAverages].sort(
  (a, b) => b.average - a.average
);

const classPosition =
  classRanked.findIndex(
    (s) => s.id === student.info.student_id
  ) + 1;

const currentStream = (student.info.stream || "")
  .trim()
  .toLowerCase();

const streamRanked = studentAverages
  .filter((s) => s.stream === currentStream)
  .sort((a, b) => b.average - a.average);

const streamPosition =
  streamRanked.findIndex(
    (s) => s.id === student.info.student_id
  ) + 1;

  const summaryY = doc.lastAutoTable.finalY + RHYTHM;


// Draw line
doc.setFont("times", "bold");
doc.text(`Overall Average: ${overallAverage}`, 15, summaryY);
doc.text(`Class Position: ${classPosition}`, pageWidth / 2 - 20, summaryY);
doc.text(`Stream Position: ${streamPosition}`, pageWidth - 65, summaryY);

/* ===========================
   GRADING SCALE (COMPACT)
=========================== */

autoTable(doc, {
  startY: summaryY + RHYTHM * 1.5,
  head: [["BASIC", "MODERATE", "OUTSTANDING"]],
  body: [["0.9 – 1.4", "1.5 – 2.4", "2.5 – 3.0"]],
  styles: {
    font: "times",
    halign: "center",
    cellPadding: 3,
  },
  headStyles: {
    fillColor: [39, 55, 78],
    textColor: 255,
    fontStyle: "bold",
  },
  theme: "striped",
  tableWidth: pageWidth - 30,
});

/* ✅ DEFINE commentY HERE */
const commentY = doc.lastAutoTable.finalY + 10;

/* ===========================
   COMMENTS TABLE
=========================== */
autoTable(doc, {
  startY: doc.lastAutoTable.finalY + RHYTHM,

  head: [[
    "HEAD TEACHER",
    "CLASS TEACHER"
  ]],

  body: [
    [
      headTeacherComment,
      classTeacherComment
    ],
    [
      "Signature: ____________________",
      "Signature: ____________________"
    ]
  ],

  styles: {
    font: "times",
    fontSize: 12,              // 👈 keep your 12
    lineHeight: 1.0,           // 👈 CRITICAL
    minCellHeight: 0,          // 👈 CRITICAL
    cellPadding: {
      top: 2,
      bottom: 2,
      left: 4,
      right: 4,
    },
    valign: "middle",
  },

  headStyles: {
    fillColor: [39, 55, 78],
    textColor: 255,
    fontStyle: "bold",
    fontSize: 12,
  
    // 🔥 CRITICAL COMPACT SETTINGS
    lineHeight: 1.0,
    minCellHeight: 0,
    cellPadding: {
      top: 3,
      bottom: 3,
      left: 4,
      right: 4,
    },
  
    halign: "center",
    valign: "middle",
  },
  

  bodyStyles: {
    textColor: 40,
  },

  columnStyles: {
    0: { cellWidth: (pageWidth - 30) / 2 },
    1: { cellWidth: (pageWidth - 30) / 2 },
  },

  theme: "striped",
});


/* ===========================
   REQUIREMENTS
=========================== */


const reqY = doc.lastAutoTable.finalY + RHYTHM;

doc.setFont("times", "bold");
doc.text("Requirements for Next Term:", 15, reqY);

doc.setFont("times", "normal");
doc.text("• Toilet paper", 20, reqY + 6);
doc.text("• Reams of paper", 20, reqY + 12);
doc.text("• Brooms", 20, reqY + 18);


/* ===========================
   TERM DATES (AFTER REQUIREMENTS)
=========================== */

const termDatesY = reqY + RHYTHM * 4;

doc.setFont("times", "bold");
doc.text("This Term Has Ended On:", 15, termDatesY);
doc.text("Next Term Begins On:", pageWidth / 2 + 5, termDatesY);

doc.setFont("times", "normal");
doc.text("_________________", 65, termDatesY);
doc.text("_________________", pageWidth / 2 + 55, termDatesY);

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

  /* ===========================
   OPEN PDF IN NEW TAB (PREVIEW)
=========================== */

const fileName = `End_of_Term_Report_Term_${meta.term}_${meta.class_level}_${meta.stream}.pdf`;

// Open in new tab instead of auto-download
const blobUrl = doc.output("bloburl");
window.open(blobUrl, "_blank");

// Optional: still allow download from preview tab
// Browser PDF viewer already has a download button

}
