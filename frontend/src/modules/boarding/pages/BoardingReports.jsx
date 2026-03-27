import { useState } from "react";
import BoardingAdminShell from "../components/BoardingAdminShell";
import { boardingFetch } from "../api";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import "../../../pages/AdminDashboard.css";

const CLASSES = ["S1", "S2", "S3", "S4"];
const TERMS = ["Term 1", "Term 2", "Term 3"];

function getReportComment(report) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const missedCount = rows.reduce((sum, row) => sum + Number(row.missed_count || 0), 0);
  const average = Number(report?.overall_average);

  if (rows.length === 0 || !Number.isFinite(average)) {
    return "No weekend assessment scores have been captured yet for this term.";
  }
  if (missedCount >= 2) {
    return "Some weekend assessments were missed. Please follow up on the missed work.";
  }
  if (average >= 75) {
    return "Consistent weekend assessment performance has been recorded.";
  }
  if (average >= 50) {
    return "Steady weekend assessment progress has been noted this term.";
  }
  return "Weekend assessment performance needs closer support and follow-up.";
}

export default function BoardingReports() {
  const [filters, setFilters] = useState({ class_level: "S1", term: "Term 1", year: new Date().getFullYear() });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const generatePdf = async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        class_level: filters.class_level,
        term: filters.term,
        year: String(filters.year),
      });
      const data = await boardingFetch(`/api/boarding/reports/term?${params.toString()}`);
      const reports = Array.isArray(data?.reports) ? data.reports : [];
      if (reports.length === 0) {
        setError("No boarding learners found for that class.");
        return;
      }

      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF("p", "mm", "a4");
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const generatedAt = new Date().toLocaleString();

      reports.forEach((report, index) => {
        if (index > 0) doc.addPage();

        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text("St. Phillip's Equatorial Secondary School (SPESS)", pageW / 2, 14, { align: "center" });
        doc.text("Boarding Weekend Assessment Report", pageW / 2, 21, { align: "center" });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(`Name: ${report.name || "—"}`, 14, 31);
        doc.text(`Class: ${report.class_level || filters.class_level}`, 120, 31);
        doc.text(`Gender: ${report.gender || "—"}`, 14, 37);
        doc.text(`Term: ${filters.term}`, 120, 37);
        doc.text(`Year: ${filters.year}`, 165, 37);
        doc.text(`Subjects Registered: ${(report.subjects_registered || []).length}`, 14, 43);

        autoTable(doc, {
          startY: 50,
          margin: { left: 14, right: 14 },
          head: [["Subject", "Average", "Submitted", "Missed"]],
          body: (report.rows || []).map((row) => [
            row.subject,
            row.average_score === null || row.average_score === undefined ? "—" : Number(row.average_score).toFixed(2),
            row.submitted_count || 0,
            row.missed_count || 0,
          ]),
          theme: "grid",
          styles: {
            font: "helvetica",
            fontSize: 10,
            lineColor: [0, 0, 0],
            lineWidth: 0.15,
          },
          headStyles: {
            fillColor: [230, 236, 244],
            textColor: [15, 23, 42],
            fontStyle: "bold",
          },
        });

        const finalY = doc.lastAutoTable?.finalY || 70;
        doc.setFont("helvetica", "bold");
        doc.text(`Overall Average: ${Number.isFinite(Number(report.overall_average)) ? Number(report.overall_average).toFixed(2) : "—"}`, 14, finalY + 10);
        doc.setFont("helvetica", "normal");
        doc.text(`Comment: ${getReportComment(report)}`, 14, finalY + 18, { maxWidth: pageW - 28 });
        doc.text("Signature: __________________________", 14, Math.min(pageH - 18, finalY + 30));
      });

      const totalPages = doc.internal.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(`Generated from SPESS ARK Boarding · ${generatedAt} · Page ${page} of ${totalPages}`, pageW / 2, pageH - 8, { align: "center" });
      }

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message || "Failed to generate boarding reports");
    } finally {
      setLoading(false);
    }
  };

  return (
    <BoardingAdminShell
      title="Boarding Reports"
      subtitle="Generate simple boarding term report cards directly from the weekend assessment record for each class."
    >
      {error && <div className="panel-alert panel-alert-error">{error}</div>}

      <div className="panel-card" style={{ background: "rgba(15,23,42,0.58)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.9rem", alignItems: "end" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Class</span>
            <select value={filters.class_level} onChange={(event) => setFilters((previous) => ({ ...previous, class_level: event.target.value }))}>
              {CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Term</span>
            <select value={filters.term} onChange={(event) => setFilters((previous) => ({ ...previous, term: event.target.value }))}>
              {TERMS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Year</span>
            <input type="number" value={filters.year} onChange={(event) => setFilters((previous) => ({ ...previous, year: Number(event.target.value) || previous.year }))} />
          </label>
          <button type="button" className="primary-btn" onClick={generatePdf} disabled={loading}>{loading ? "Generating..." : "Generate Report Cards"}</button>
        </div>
      </div>
    </BoardingAdminShell>
  );
}
