import { useState } from "react";
import "./AlevelReport.css";
import ALevelAdminShell from "../components/ALevelAdminShell";
import "../../../pages/AdminDashboard.css";
import "./ALevelAdminTheme.css";

import badge from "../../../assets/badge.png";
import { loadPdfTools } from "../../../utils/loadPdfTools";
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

      await generateAlevelPDF(data, { term, year, cls, stream });
    } catch (err) {
      console.error(err);
      alert("Failed to download report");
    }
  };
   // --- Theme Constants (Matching your Amethyst/Cinematic Black theme) ---
  const amethyst = "#38bdf8";
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
    <ALevelAdminShell
      title="Report Hub"
      subtitle="Preview and generate A-Level report cards from the same shared navigation and theme shell."
    >
      {({ isDark }) => {
        const pageBg = isDark ? cinematicBlack : "#f8fafc";
        const bodyText = isDark ? platinum : "#0f172a";
        const softText = isDark ? "rgba(241, 245, 249, 0.82)" : "#475569";
        const shellCard = isDark
          ? glassBg
          : "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(241,245,249,0.94))";
        const shellBorder = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.08)";
        const themedInputStyle = {
          ...inputStyle,
          background: isDark ? "rgba(0, 0, 0, 0.3)" : "rgba(255,255,255,0.9)",
          border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.12)"}`,
          color: bodyText,
        };

        return (
          <div style={{ minHeight: "100%", color: bodyText, paddingBottom: "3rem", fontFamily: "'Inter', sans-serif" }}>
            <div
              style={{
                position: "relative",
                minHeight: "280px",
                width: "100%",
                backgroundImage: `linear-gradient(to bottom, ${
                  isDark ? `rgba(10, 12, 16, 0.1), ${cinematicBlack}` : "rgba(248, 250, 252, 0.08), rgba(248, 250, 252, 0.94)"
                }), url('/tracy.jpg')`,
                backgroundSize: "cover",
                backgroundPosition: "center 20%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                padding: "0 2rem 2rem",
                borderRadius: "0 0 28px 28px",
                overflow: "hidden",
              }}
            >
              <h1 style={{ fontSize: "3rem", fontWeight: "900", margin: 0, color: bodyText }}>
                Academic <span style={{ color: amethyst }}>Reports</span>
              </h1>
              <p style={{ fontSize: "1.08rem", color: softText, maxWidth: "640px", marginTop: "0.55rem" }}>
                Generate and analyze comprehensive student performance statements for A-Level candidates.
              </p>
            </div>

            <div style={{ maxWidth: "1200px", margin: "-40px auto 0 auto", padding: "0 0.25rem", position: "relative", zIndex: 10 }}>
              <div
                style={{
                  background: shellCard,
                  backdropFilter: "blur(16px)",
                  borderRadius: "28px",
                  padding: "2.5rem",
                  border: `1px solid ${shellBorder}`,
                  boxShadow: isDark ? "0 8px 32px 0 rgba(0, 0, 0, 0.37)" : "0 20px 40px rgba(15, 23, 42, 0.08)",
                }}
              >
                <h2 style={{ fontSize: "1.25rem", fontWeight: "800", marginBottom: "2rem", color: bodyText }}>
                  Report Generation Parameters
                </h2>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem" }}>
                  <div className="form-group">
                    <label style={labelStyle}>Term</label>
                    <select style={themedInputStyle} value={term} onChange={(e) => setTerm(e.target.value)}>
                      <option value="" style={{ background: pageBg }}>
                        Select Term
                      </option>
                      <option style={{ background: pageBg }}>Term 1</option>
                      <option style={{ background: pageBg }}>Term 2</option>
                      <option style={{ background: pageBg }}>Term 3</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label style={labelStyle}>Class</label>
                    <select style={themedInputStyle} value={cls} onChange={(e) => setCls(e.target.value)}>
                      <option value="" style={{ background: pageBg }}>
                        Select Class
                      </option>
                      <option value="S5" style={{ background: pageBg }}>
                        S5
                      </option>
                      <option value="S6" style={{ background: pageBg }}>
                        S6
                      </option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label style={labelStyle}>Stream</label>
                    <select style={themedInputStyle} value={stream} onChange={(e) => setStream(e.target.value)}>
                      <option value="" style={{ background: pageBg }}>
                        Select Stream
                      </option>
                      <option value="Arts" style={{ background: pageBg }}>
                        Arts
                      </option>
                      <option value="Sciences" style={{ background: pageBg }}>
                        Sciences
                      </option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label style={labelStyle}>Year</label>
                    <input type="number" style={themedInputStyle} value={year} onChange={(e) => setYear(e.target.value)} />
                  </div>
                </div>

                <div style={{ marginTop: "2.5rem", display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
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
                      opacity: loading ? 0.7 : 1,
                    }}
                    onClick={handlePreview}
                    disabled={loading}
                  >
                    {loading ? "PROCESSING..." : "PREVIEW REPORTS"}
                  </button>
                  {error && (
                    <p style={{ color: isDark ? "#fca5a5" : "#991b1b", fontSize: "0.85rem", fontWeight: "600", margin: 0 }}>
                      {error}
                    </p>
                  )}
                </div>
              </div>

              {previewData && (
                <div
                  style={{
                    marginTop: "1.5rem",
                    background: isDark ? "rgba(167, 139, 250, 0.05)" : "rgba(59, 130, 246, 0.06)",
                    backdropFilter: "blur(12px)",
                    borderRadius: "20px",
                    padding: "1.5rem 2.5rem",
                    border: `1px solid ${isDark ? "rgba(167, 139, 250, 0.2)" : "rgba(59, 130, 246, 0.16)"}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "1rem",
                    flexWrap: "wrap",
                    animation: "fadeIn 0.5s ease forwards",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "1rem", color: softText }}>
                    <span style={{ color: amethyst, fontWeight: "800" }}>{previewData.learners}</span> student reports available ·{" "}
                    <span style={{ color: amethyst, fontWeight: "800" }}>{previewData.subjects}</span> subjects included
                  </p>

                  <button
                    style={{
                      background: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(255,255,255,0.9)",
                      color: bodyText,
                      border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.12)"}`,
                      padding: "10px 20px",
                      borderRadius: "12px",
                      fontWeight: "700",
                      fontSize: "0.8rem",
                      cursor: "pointer",
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
      }}
    </ALevelAdminShell>
  );
}

/* =============================
   PDF GENERATOR (same file)
============================= */
async function generateAlevelPDF(data, meta) {
  const { jsPDF, autoTable } = await loadPdfTools();
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

  const filename = `ALevel_Report_${String(meta.cls || "Class")}_${String(meta.stream || "Stream")}_${String(meta.term || "Term")}_${String(meta.year || "")}.pdf`
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]/g, "");
  const title = `A-Level Report - ${meta.cls || "Class"} ${meta.stream || ""} - ${meta.term || ""} ${meta.year || ""}`.trim();
  openNamedPdfPreview(doc, filename, title);
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
