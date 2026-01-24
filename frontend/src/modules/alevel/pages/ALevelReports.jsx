import { useState } from "react";
import "./AlevelReport.css";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import badge from "../../../assets/badge.png";
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function AlevelReport() {
  const [term, setTerm] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [cls, setCls] = useState("");
  const [stream, setStream] = useState("");

  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [error, setError] = useState("");

  const handlePreview = async () => {
    setError("");
    setPreviewData(null);

    if (!term || !cls || !stream || !year) {
      setError("Please select all fields before previewing.");
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(`${API_BASE}/api/alevel/reports/preview`, {

      method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, class: cls, stream, year }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to preview reports");

      setPreviewData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/alevel/reports/download`, {

      method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, class: cls, stream, year }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Download failed");

      generateAlevelPDF(data, { term, year, cls, stream });
    } catch (err) {
      console.error(err);
      alert("Failed to download report");
    }
  };

  return (
    <div className="alevel-reports">
      <div className="panel-card">
        <h2 style={{ marginBottom: "1rem" }}>A-Level Reports</h2>

        <div className="filters-grid">
          <div className="form-group">
            <label>Term</label>
            <select value={term} onChange={(e) => setTerm(e.target.value)}>
              <option value="">Select Term</option>
              <option>Term 1</option>
              <option>Term 2</option>
              <option>Term 3</option>
            </select>
          </div>

          <div className="form-group">
            <label>Class</label>
            <select value={cls} onChange={(e) => setCls(e.target.value)}>
              <option value="">Select Class</option>
              <option value="S5">S5</option>
              <option value="S6">S6</option>
            </select>
          </div>

          <div className="form-group">
            <label>Stream</label>
            <select value={stream} onChange={(e) => setStream(e.target.value)}>
              <option value="">Select Stream</option>
              <option value="Arts">Arts</option>
              <option value="Sciences">Sciences</option>
            </select>
          </div>

          <div className="form-group">
            <label>Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginTop: "1rem" }}>
          <button className="primary-btn" onClick={handlePreview} disabled={loading}>
            {loading ? "Processing..." : "Preview Reports"}
          </button>
        </div>

        {error && <p style={{ color: "tomato", marginTop: "0.8rem" }}>{error}</p>}
      </div>

      {previewData && (
        <div className="panel-card" style={{ marginTop: "1rem" }}>
          <p>
            <strong>{previewData.learners}</strong> student reports available ·{" "}
            <strong>{previewData.subjects}</strong> subjects included
          </p>

          <button className="secondary-btn" onClick={handleDownload}>
            Download Reports
          </button>
        </div>
      )}
    </div>
  );
}

/* =============================
   PDF GENERATOR (same file)
============================= */
function generateAlevelPDF(data, meta) {
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  data.forEach((student, index) => {
    if (index > 0) doc.addPage();

    const { learner, principals, subsidiaries, totals, comments } = student;

    doc.addImage(badge, "PNG", 15, 10, 20, 20);

// School name (bold only here)
doc.setFont("helvetica", "bold");
doc.setFontSize(14);
doc.text(
  "ST. PHILLIPS EQUATORIAL SECONDARY SCHOOL",
  pageWidth / 2,
  18,
  { align: "center" }
);

// Everything else normal
doc.setFont("helvetica", "normal");
doc.setFontSize(10);

doc.text(
  "P.O. BOX 53 Kayabwe Mpigi | Tel: 0776532417",
  pageWidth / 2,
  24,
  { align: "center" }
);

doc.text(
  "www.stphillipsequatorial.com",
  pageWidth / 2,
  29,
  { align: "center" }
);

doc.text(
  "Email: info@stphillipsequatorial.com",
  pageWidth / 2,
  34,
  { align: "center" }
);

// Divider line
doc.line(15, 40, pageWidth - 15, 40);

// Report title (now correctly below the line)
doc.setFont("helvetica", "bold");
doc.setFontSize(11);
doc.text(
  `END OF ${meta.term} ${meta.year} REPORT CARD`,
  pageWidth / 2,
  50,
  { align: "center" }
);

// Reset font
doc.setFont("helvetica", "normal");

// Bio starts safely below
const y = 60;
doc.setFontSize(10);

const gap = 3;

// LEFT SIDE
doc.setFont("helvetica", "bold");
doc.text("Name:", 15, y);
let w = doc.getTextWidth("Name:");
doc.setFont("helvetica", "normal");
doc.text(learner.name, 15 + w + gap, y);

doc.setFont("helvetica", "bold");
doc.text("House:", 15, y + 6);
w = doc.getTextWidth("House:");
doc.setFont("helvetica", "normal");
doc.text(learner.house, 15 + w + gap, y + 6);

doc.setFont("helvetica", "bold");
doc.text("Stream:", 15, y + 12);
w = doc.getTextWidth("Stream:");
doc.setFont("helvetica", "normal");
doc.text(learner.stream, 15 + w + gap, y + 12);


// RIGHT SIDE
doc.setFont("helvetica", "bold");
doc.text("Age:", 110, y);
w = doc.getTextWidth("Age:");
doc.setFont("helvetica", "normal");
doc.text(String(learner.age), 110 + w + gap, y);

doc.setFont("helvetica", "bold");
doc.text("Class:", 110, y + 6);
w = doc.getTextWidth("Class:");
doc.setFont("helvetica", "normal");
doc.text(learner.class, 110 + w + gap, y + 6);

doc.setFont("helvetica", "bold");
doc.text("Combination:", 110, y + 12);
w = doc.getTextWidth("Combination:");
doc.setFont("helvetica", "normal");
doc.text(learner.combination, 110 + w + gap, y + 12);


    autoTable(doc, {
      startY: y + 20,
      head: [["Subject", "MID", "EOT", "Avg", "Score", "Grade", "Points", "Teacher"]],
      body: principals.map(p => [
        p.subject, p.mid ?? "-", p.eot ?? "-", p.avg ?? "-", p.score, p.grade, p.points, p.teacher
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [230, 230, 230], textColor: 0 }

    });

    let nextY = doc.lastAutoTable.finalY + 6;
    doc.setFont("helvetica", "bold");
    doc.text(`Total Principal Subjects Points: ${totals.principal}`, 15, nextY);
    doc.setFont("helvetica", "normal"); // reset after

    autoTable(doc, {
      startY: nextY + 6,
      head: [["Subject", "MID", "EOT", "Avg", "Grade", "Points", "Teacher"]],
      body: subsidiaries.map(s => [
        s.subject, s.mid ?? "-", s.eot ?? "-", s.avg ?? "-", s.grade, s.points, s.teacher
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [230, 230, 230], textColor: 0 }

    });

    nextY = doc.lastAutoTable.finalY + 6;
    doc.setFont("helvetica", "bold");
    doc.text(`Total Subsidiary Points: ${totals.subsidiary}`, 15, nextY);
    doc.text(`TOTAL POINTS: ${totals.overall}`, 15, nextY + 6);
    let commentY = nextY + 16;
    doc.setFont("helvetica", "normal"); // reset after

    doc.setFontSize(10);

    // Class Teacher Comment
doc.setFont("helvetica", "bold");
doc.text("Class Teacher's Comment:", 15, commentY);

w = doc.getTextWidth("Class Teacher's Comment:");
doc.setFont("helvetica", "normal");
doc.text(comments.classTeacher, 15 + w + gap, commentY);

doc.text("Signature: ____________________________", 15, commentY + 6);

// Head Teacher Comment
doc.setFont("helvetica", "bold");
doc.text("Head Teacher's Comment:", 15, commentY + 16);

w = doc.getTextWidth("Head Teacher's Comment:");
doc.setFont("helvetica", "normal");
doc.text(comments.headTeacher, 15 + w + gap, commentY + 16);

doc.text("Signature: ____________________________", 15, commentY + 22);

let tableStartY = commentY + 32;

/* =========================
   MARKS → SCORES TABLE (COMPACT)
========================= */
autoTable(doc, {
  startY: tableStartY,
  head: [[
    "Mark", "00–34", "35–44", "45–49", "50–54", "55–59", "60–64", "65–74", "75–79", "80–100"
  ]],
  body: [[
    "Score", "F9", "P8", "P7", "C6", "C5", "C4", "C3", "D2", "D1"
  ]],
  styles: { fontSize: 8, halign: "center" },
  headStyles: { fillColor: [230, 230, 230], textColor: 0 },
  theme: "grid",
  margin: { left: 15 },
});

/* =========================
   GRADE → POINTS TABLE (COMPACT)
========================= */
autoTable(doc, {
  startY: doc.lastAutoTable.finalY + 4,
  head: [["Grade Points", "F", "O", "E", "D", "C", "B", "A"]],
  body: [["", "0", "1", "2", "3", "4", "5", "6"]],
  styles: { fontSize: 8, halign: "center" },
  headStyles: { fillColor: [230, 230, 230], textColor: 0 },
  theme: "grid",
  margin: { left: 15 },
});

// Final Y after both tables
let afterTablesY = doc.lastAutoTable.finalY + 8;

doc.setFontSize(9);

doc.text("This term ended on: ____________________", 15, afterTablesY);

doc.text("Next term begins on: ____________________", 110, afterTablesY);

doc.setFont("helvetica", "bold");
doc.text("Requirements:", 15, afterTablesY + 16);

doc.setFont("helvetica", "normal");
doc.text("Toilet paper, brooms, books", 45, afterTablesY + 16);

    doc.setFontSize(8);
    doc.text(
      `Generated from SPESS ARK • ${new Date().toLocaleString()} • Not valid without stamp`,
      pageWidth / 2,
      pageHeight - 10,
      { align: "center" }
    );
  });

  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}
