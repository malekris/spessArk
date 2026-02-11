import { useState } from "react";
import "./AlevelReport.css";
import { useNavigate } from "react-router-dom";
import useIdleLogout from "../../../hooks/useIdleLogout";

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
  const navigate = useNavigate(); // 👈 THIS WAS MISSING
  const IDLE_20_MIN = 20 * 60 * 1000;

  useIdleLogout(() => {
    localStorage.removeItem("SPESS_ADMIN_KEY");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("adminToken");
    sessionStorage.removeItem("isAdmin");
    navigate("/ark", { replace: true });
  }, IDLE_20_MIN);

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
   // --- Theme Constants (Matching your Amethyst/Cinematic Black theme) ---
  const amethyst = "#a78bfa";
  const cinematicBlack = "#0a0c10";
  const glassBg = "rgba(30, 41, 59, 0.45)";
  const platinum = "#f1f5f9";

  const inputStyle = {
    width: "100%",
    padding: "12px",
    background: "rgba(0, 0, 0, 0.3)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "12px",
    color: "#fff",
    fontSize: "0.9rem",
    outline: "none",
    marginTop: "8px"
  };

  const labelStyle = {
    fontSize: "0.7rem",
    fontWeight: "800",
    color: amethyst,
    textTransform: "uppercase",
    letterSpacing: "0.1em"
  };
  return (
    <div style={{ minHeight: "100vh", background: cinematicBlack, color: platinum, paddingBottom: "4rem", fontFamily: "'Inter', sans-serif" }}>
      
      {/* CINEMATIC BANNER */}
      <div style={{
        position: "relative",
        height: "350px",
        width: "100%",
        backgroundImage: `linear-gradient(to bottom, rgba(10, 12, 16, 0.1), ${cinematicBlack}), url('/tracy.jpg')`,
        backgroundSize: "cover",
        backgroundPosition: "center 20%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 4rem"
      }}>
        <button 
  onClick={() => navigate("/ark/admin/alevel")} 
  style={{
    position: "absolute",
    top: "2rem",
    left: "4rem",
    background: "rgba(0,0,0,0.5)",
    border: "none",
    color: "#c084fc", // use real color instead of amethyst
    cursor: "pointer",
    padding: "8px 16px",
    borderRadius: "10px",
    fontWeight: "700",
    fontSize: "0.7rem",
    backdropFilter: "blur(5px)",
    zIndex: 50   // 👈 THIS FIXES IT
  }}
>
  ← BACK TO A LEVEL MANAGER
</button>


        <h1 style={{ fontSize: "3.5rem", fontWeight: "900", margin: 0, textShadow: "0 4px 20px rgba(0,0,0,0.6)" }}>
          Academic <span style={{ color: amethyst }}>Reports</span>
        </h1>
        <p style={{ fontSize: "1.1rem", opacity: 0.8, maxWidth: "600px", marginTop: "0.5rem" }}>
          Generate and analyze comprehensive student performance statements for A-Level candidates.
        </p>
      </div>

      <div style={{ maxWidth: "1200px", margin: "-60px auto 0 auto", padding: "0 2rem", position: "relative", zIndex: 10 }}>
        
        {/* MAIN FILTER CARD */}
        <div style={{
          background: glassBg,
          backdropFilter: "blur(16px)",
          borderRadius: "28px",
          padding: "2.5rem",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.37)"
        }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: "800", marginBottom: "2rem", color: "#fff" }}>Report Generation Parameters</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem" }}>
            
            <div className="form-group">
              <label style={labelStyle}>Term</label>
              <select style={inputStyle} value={term} onChange={(e) => setTerm(e.target.value)}>
                <option value="" style={{background: cinematicBlack}}>Select Term</option>
                <option style={{background: cinematicBlack}}>Term 1</option>
                <option style={{background: cinematicBlack}}>Term 2</option>
                <option style={{background: cinematicBlack}}>Term 3</option>
              </select>
            </div>

            <div className="form-group">
              <label style={labelStyle}>Class</label>
              <select style={inputStyle} value={cls} onChange={(e) => setCls(e.target.value)}>
                <option value="" style={{background: cinematicBlack}}>Select Class</option>
                <option value="S5" style={{background: cinematicBlack}}>S5</option>
                <option value="S6" style={{background: cinematicBlack}}>S6</option>
              </select>
            </div>

            <div className="form-group">
              <label style={labelStyle}>Stream</label>
              <select style={inputStyle} value={stream} onChange={(e) => setStream(e.target.value)}>
                <option value="" style={{background: cinematicBlack}}>Select Stream</option>
                <option value="Arts" style={{background: cinematicBlack}}>Arts</option>
                <option value="Sciences" style={{background: cinematicBlack}}>Sciences</option>
              </select>
            </div>

            <div className="form-group">
              <label style={labelStyle}>Year</label>
              <input
                type="number"
                style={inputStyle}
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginTop: "2.5rem", display: "flex", alignItems: "center", gap: "1.5rem" }}>
            <button 
              style={{
                background: amethyst,
                color: cinematicBlack,
                border: "none",
                padding: "14px 28px",
                borderRadius: "14px",
                fontWeight: "800",
                fontSize: "0.9rem",
                cursor: loading ? "not-allowed" : "pointer",
                transition: "transform 0.2s ease",
                opacity: loading ? 0.7 : 1
              }}
              onClick={handlePreview} 
              disabled={loading}
            >
              {loading ? "PROCESSING..." : "PREVIEW REPORTS"}
            </button>
            {error && <p style={{ color: "#fca5a5", fontSize: "0.85rem", fontWeight: "600", margin: 0 }}>{error}</p>}
          </div>
        </div>

        {/* PREVIEW STATUS CARD */}
        {previewData && (
          <div style={{
            marginTop: "1.5rem",
            background: "rgba(167, 139, 250, 0.05)",
            backdropFilter: "blur(12px)",
            borderRadius: "20px",
            padding: "1.5rem 2.5rem",
            border: `1px solid rgba(167, 139, 250, 0.2)`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            animation: "fadeIn 0.5s ease forwards"
          }}>
            <p style={{ margin: 0, fontSize: "1rem", opacity: 0.9 }}>
              <span style={{ color: amethyst, fontWeight: "800" }}>{previewData.learners}</span> student reports available ·{" "}
              <span style={{ color: amethyst, fontWeight: "800" }}>{previewData.subjects}</span> subjects included
            </p>

            <button 
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                color: platinum,
                border: "1px solid rgba(255, 255, 255, 0.1)",
                padding: "10px 20px",
                borderRadius: "12px",
                fontWeight: "700",
                fontSize: "0.8rem",
                cursor: "pointer"
              }}
              onClick={handleDownload}
            >
              DOWNLOAD REPORTS
            </button>
          </div>
        )}
      </div>

      <style>
        {`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          select { cursor: pointer; }
          input:focus, select:focus { border-color: ${amethyst} !important; }
        `}
      </style>
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
