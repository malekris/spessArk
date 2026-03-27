import { useEffect, useMemo, useState } from "react";
import BoardingAdminShell from "../components/BoardingAdminShell";
import { boardingFetch, logBoardingAction } from "../api";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import "../../../pages/AdminDashboard.css";

const CLASSES = ["S1", "S2", "S3", "S4"];
const TERMS = ["Term 1", "Term 2", "Term 3"];
const SCORE_MIN = 0.9;
const SCORE_MAX = 3.0;

const fieldLabelStyle = {
  display: "grid",
  gap: "0.35rem",
  color: "rgba(241,245,249,0.88)",
  fontSize: "0.9rem",
  fontWeight: 700,
};

const fieldInputStyle = {
  width: "100%",
  minHeight: "46px",
  padding: "0.8rem 0.95rem",
  borderRadius: "14px",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "linear-gradient(180deg, rgba(9,14,28,0.98) 0%, rgba(15,23,42,0.92) 100%)",
  color: "#f8fafc",
  outline: "none",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 22px rgba(2,6,23,0.18)",
  fontSize: "0.95rem",
  fontWeight: 600,
};

const successModalBackdropStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 6, 23, 0.72)",
  backdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
  zIndex: 1200,
};

const successModalCardStyle = {
  width: "min(520px, 100%)",
  borderRadius: "24px",
  background: "linear-gradient(180deg, rgba(7, 18, 15, 0.98) 0%, rgba(15, 23, 42, 0.96) 100%)",
  border: "1px solid rgba(74, 222, 128, 0.26)",
  boxShadow: "0 28px 64px rgba(2, 6, 23, 0.45)",
  color: "#f8fafc",
  overflow: "hidden",
};

const isOutOfRangeScore = (value) => {
  if (value === "" || value === null || value === undefined) return false;
  const numeric = Number(value);
  return !Number.isFinite(numeric) || numeric < SCORE_MIN || numeric > SCORE_MAX;
};

const formatDateOnly = (value) => {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB");
};

const formatScoreForPdf = (score, status) => {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (normalizedStatus === "missed") return "Missed";
  if (score === "" || score === null || score === undefined) return "";
  const numeric = Number(score);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : String(score);
};

const loadBadgeImage = () =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "/badge.png";
  });

export default function BoardingMarks() {
  const [subjects, setSubjects] = useState([]);
  const [filters, setFilters] = useState({
    class_level: "S1",
    subject_id: "",
    term: "Term 1",
    year: new Date().getFullYear(),
    weekend_label: "Weekend 1",
    assessment_date: "",
  });
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => {
    const loadSubjects = async () => {
      try {
        const data = await boardingFetch("/api/boarding/subjects");
        const list = Array.isArray(data) ? data : [];
        setSubjects(list);
        if (list[0]) {
          setFilters((previous) => ({ ...previous, subject_id: previous.subject_id || String(list[0].id) }));
        }
      } catch (err) {
        setError(err.message || "Failed to load boarding subjects");
      }
    };
    loadSubjects();
  }, []);

  const selectedSubject = useMemo(
    () => subjects.find((subject) => Number(subject.id) === Number(filters.subject_id)) || null,
    [filters.subject_id, subjects]
  );

  const loadContext = async () => {
    setError("");
    setSuccess("");
    if (!filters.subject_id || !filters.weekend_label) {
      setError("Select class, subject and weekend label first.");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        class_level: filters.class_level,
        subject_id: String(filters.subject_id),
        term: filters.term,
        year: String(filters.year),
        weekend_label: filters.weekend_label,
      });
      const data = await boardingFetch(`/api/boarding/marks/context?${params.toString()}`);
      const learnerRows = Array.isArray(data?.learners) ? data.learners : [];
      setRows(
        learnerRows.map((row) => ({
          student_id: row.id,
          name: row.name,
          gender: row.gender,
          score: row.score ?? "",
          status: row.status || "",
          assessment_date: row.assessment_date ? String(row.assessment_date).slice(0, 10) : filters.assessment_date,
        }))
      );
      if (!filters.assessment_date) {
        const existingDate = learnerRows.find((row) => row.assessment_date)?.assessment_date;
        if (existingDate) {
          setFilters((previous) => ({ ...previous, assessment_date: String(existingDate).slice(0, 10) }));
        }
      }
    } catch (err) {
      setError(err.message || "Failed to load weekend marks context");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (studentId, patch) => {
    setRows((previous) => previous.map((row) => (row.student_id === studentId ? { ...row, ...patch } : row)));
  };

  const handleSave = async () => {
    setError("");
    setSuccess("");
    if (!filters.subject_id || !filters.weekend_label) {
      setError("Select class, subject and weekend label first.");
      return;
    }

    const invalidRows = rows.filter((row) => {
      const isMissed = String(row.status || "").toLowerCase() === "missed";
      return !isMissed && isOutOfRangeScore(row.score);
    });

    if (invalidRows.length > 0) {
      const names = invalidRows
        .slice(0, 5)
        .map((row) => row.name)
        .filter(Boolean)
        .join(", ");
      setError(
        `Weekend assessment scores must stay between ${SCORE_MIN} and ${SCORE_MAX}. Fix: ${names}${invalidRows.length > 5 ? " and others" : ""}.`
      );
      return;
    }

    setSaving(true);
    try {
      await boardingFetch("/api/boarding/marks/save", {
        method: "POST",
        body: {
          class_level: filters.class_level,
          subject_id: Number(filters.subject_id),
          term: filters.term,
          year: Number(filters.year),
          weekend_label: filters.weekend_label,
          assessment_date: filters.assessment_date || null,
          rows,
        },
      });
      setSuccess("Weekend marks saved.");
      await loadContext();
      const missedCount = rows.filter((row) => String(row.status || "").toLowerCase() === "missed").length;
      const submittedCount = rows.filter((row) => {
        const isMissed = String(row.status || "").toLowerCase() === "missed";
        return !isMissed && row.score !== "" && row.score !== null && row.score !== undefined;
      }).length;
      setConfirmation({
        subject: selectedSubject?.name || "Selected Subject",
        classLevel: filters.class_level,
        term: filters.term,
        year: filters.year,
        weekendLabel: filters.weekend_label,
        submittedCount,
        missedCount,
      });
    } catch (err) {
      setError(err.message || "Failed to save weekend marks");
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async () => {
    setError("");
    if (!rows.length) {
      setError("Load learners first before generating the weekend marks PDF.");
      return;
    }

    try {
      setExportingPdf(true);
      const { jsPDF, autoTable } = await loadPdfTools();
      const badgeImage = await loadBadgeImage();
      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const generatedAt = new Date().toLocaleString("en-GB");
      const submittedCount = rows.filter((row) => {
        const isMissed = String(row.status || "").toLowerCase() === "missed";
        return !isMissed && row.score !== "" && row.score !== null && row.score !== undefined;
      }).length;
      const missedCount = rows.filter((row) => String(row.status || "").toLowerCase() === "missed").length;

      doc.setDrawColor(0);
      doc.setLineWidth(0.28);
      doc.line(14, 10, pageWidth - 14, 10);
      doc.line(14, 34, pageWidth - 14, 34);

      if (badgeImage) {
        doc.addImage(badgeImage, "PNG", 16, 12.5, 14, 14);
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13.5);
      doc.text("ST PHILLIP'S EQUATORIAL SECONDARY SCHOOL", pageWidth / 2, 16.5, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.2);
      doc.text("Boarding Weekend Assessment Marksheet", pageWidth / 2, 21.8, { align: "center" });
      doc.text("www.stphillipsequatorial.com • info@stphillipsequatorial.com", pageWidth / 2, 26.6, { align: "center" });

      doc.setFillColor(239, 239, 239);
      doc.rect(14, 39, pageWidth - 28, 20, "F");
      doc.setDrawColor(0);
      doc.setLineWidth(0.2);
      doc.rect(14, 39, pageWidth - 28, 20);
      doc.line(14 + (pageWidth - 28) / 2, 39, 14 + (pageWidth - 28) / 2, 59);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("CLASS / SUBJECT", 18, 44);
      doc.text("TERM / WEEKEND", 18, 53);
      doc.text("YEAR / DATE", 18 + (pageWidth - 28) / 2, 44);
      doc.text("SUBMITTED / MISSED", 18 + (pageWidth - 28) / 2, 53);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.2);
      doc.text(`${filters.class_level} • ${selectedSubject?.name || "—"}`, 18, 48.7);
      doc.text(`${filters.term} • ${filters.weekend_label || "—"}`, 18, 57.2);
      doc.text(`${filters.year} • ${formatDateOnly(filters.assessment_date)}`, 18 + (pageWidth - 28) / 2, 48.7);
      doc.text(`${submittedCount} submitted • ${missedCount} missed`, 18 + (pageWidth - 28) / 2, 57.2);

      autoTable(doc, {
        startY: 66,
        margin: { left: 14, right: 14 },
        head: [["Learner", "Gender", "Score", "Status"]],
        body: rows.map((row) => [
          row.name || "",
          row.gender || "",
          formatScoreForPdf(row.score, row.status),
          String(row.status || "").toLowerCase() === "missed"
            ? "Missed"
            : row.score !== "" && row.score !== null && row.score !== undefined
              ? "Submitted"
              : "Pending",
        ]),
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 8.4,
          lineColor: [0, 0, 0],
          lineWidth: 0.2,
          cellPadding: 1.8,
          textColor: [0, 0, 0],
        },
        headStyles: {
          fillColor: [230, 230, 230],
          textColor: [0, 0, 0],
          fontStyle: "bold",
          lineColor: [0, 0, 0],
          lineWidth: 0.24,
        },
        alternateRowStyles: {
          fillColor: [249, 249, 249],
        },
        columnStyles: {
          0: { cellWidth: 78 },
          1: { cellWidth: 24, halign: "center" },
          2: { cellWidth: 28, halign: "center" },
          3: { cellWidth: 36, halign: "center" },
        },
      });

      const totalPages = doc.internal.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(
          `SPESS ARK Boarding · Weekend Marksheet · Page ${page} of ${totalPages} · ${generatedAt}`,
          pageWidth / 2,
          pageHeight - 8,
          { align: "center" }
        );
      }

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      await logBoardingAction(
        "EXPORT_MARKS_PDF",
        `Exported boarding weekend marks PDF for ${filters.class_level} ${selectedSubject?.name || "subject"} (${filters.weekend_label}, ${filters.term} ${filters.year})`,
        { entityType: "marks", entityId: Number(filters.subject_id) || null }
      );
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message || "Failed to generate weekend marks PDF");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <BoardingAdminShell
      title="Weekend Marks"
      subtitle="Pick a class and subject, then capture the boarding weekend assessment from the boarding account directly — no assignment setup required."
    >
      {confirmation && (
        <div style={successModalBackdropStyle} onClick={() => setConfirmation(null)}>
          <div style={successModalCardStyle} onClick={(event) => event.stopPropagation()}>
            <div
              style={{
                padding: "1rem 1.15rem",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                background: "linear-gradient(90deg, rgba(34,197,94,0.26), rgba(15,23,42,0.18))",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <div>
                <div style={{ color: "#86efac", fontSize: "0.78rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                  Boarding Confirmation
                </div>
                <h3 style={{ margin: "0.35rem 0 0", fontSize: "1.15rem" }}>Weekend Marks Saved</h3>
              </div>
              <button type="button" className="ghost-btn" onClick={() => setConfirmation(null)}>
                Close
              </button>
            </div>

            <div style={{ padding: "1.15rem", display: "grid", gap: "0.8rem" }}>
              <p style={{ margin: 0, color: "rgba(241,245,249,0.82)", lineHeight: 1.65 }}>
                The weekend assessment scores have been saved successfully for the selected boarding class and subject.
              </p>
              <div style={{ display: "grid", gap: "0.55rem", padding: "0.95rem 1rem", borderRadius: "16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div><strong style={{ color: "#86efac" }}>Subject:</strong> {confirmation.subject}</div>
                <div><strong style={{ color: "#86efac" }}>Class:</strong> {confirmation.classLevel}</div>
                <div><strong style={{ color: "#86efac" }}>Weekend:</strong> {confirmation.weekendLabel}</div>
                <div><strong style={{ color: "#86efac" }}>Term / Year:</strong> {confirmation.term} • {confirmation.year}</div>
                <div><strong style={{ color: "#86efac" }}>Submitted:</strong> {confirmation.submittedCount}</div>
                <div><strong style={{ color: "#86efac" }}>Missed:</strong> {confirmation.missedCount}</div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="primary-btn" onClick={() => setConfirmation(null)}>
                  Okay
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <div className="panel-alert panel-alert-error">{error}</div>}
      {success && <div className="panel-alert panel-alert-success">{success}</div>}

      <div className="panel-card" style={{ background: "rgba(15,23,42,0.58)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.8rem 0.95rem",
            borderRadius: "14px",
            background: "rgba(8, 47, 73, 0.28)",
            border: "1px solid rgba(56, 189, 248, 0.22)",
            color: "#dbeafe",
            fontSize: "0.92rem",
          }}
        >
          Weekend assessment score range: <strong>{SCORE_MIN}</strong> to <strong>{SCORE_MAX}</strong>. Entries outside that range are blocked.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.9rem", alignItems: "end" }}>
          <label style={fieldLabelStyle}>
            <span>Class</span>
            <select
              style={fieldInputStyle}
              value={filters.class_level}
              onChange={(event) => setFilters((previous) => ({ ...previous, class_level: event.target.value }))}
            >
              {CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={fieldLabelStyle}>
            <span>Subject</span>
            <select
              style={fieldInputStyle}
              value={filters.subject_id}
              onChange={(event) => setFilters((previous) => ({ ...previous, subject_id: event.target.value }))}
            >
              <option value="">Select subject</option>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </label>
          <label style={fieldLabelStyle}>
            <span>Term</span>
            <select
              style={fieldInputStyle}
              value={filters.term}
              onChange={(event) => setFilters((previous) => ({ ...previous, term: event.target.value }))}
            >
              {TERMS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={fieldLabelStyle}>
            <span>Year</span>
            <input
              style={fieldInputStyle}
              type="number"
              value={filters.year}
              onChange={(event) => setFilters((previous) => ({ ...previous, year: Number(event.target.value) || previous.year }))}
            />
          </label>
          <label style={fieldLabelStyle}>
            <span>Weekend Label</span>
            <input
              style={fieldInputStyle}
              value={filters.weekend_label}
              onChange={(event) => setFilters((previous) => ({ ...previous, weekend_label: event.target.value }))}
              placeholder="Weekend 1"
            />
          </label>
          <label style={fieldLabelStyle}>
            <span>Assessment Date</span>
            <input
              style={fieldInputStyle}
              type="date"
              value={filters.assessment_date}
              onChange={(event) => setFilters((previous) => ({ ...previous, assessment_date: event.target.value }))}
            />
          </label>
          <button type="button" className="primary-btn" onClick={loadContext}>{loading ? "Loading..." : "Load Learners"}</button>
        </div>
      </div>

      <div className="panel-card" style={{ marginTop: "1rem", background: "rgba(15,23,42,0.58)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#4ade80", fontSize: "0.76rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Capture Grid</div>
            <h3 style={{ margin: "0.35rem 0 0" }}>{selectedSubject ? `${filters.class_level} • ${selectedSubject.name}` : "Select a subject"}</h3>
          </div>
          <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
            <button type="button" className="ghost-btn" onClick={handleDownloadPdf} disabled={exportingPdf || saving || rows.length === 0}>
              {exportingPdf ? "Preparing PDF..." : "Download PDF"}
            </button>
            <button type="button" className="primary-btn" onClick={handleSave} disabled={saving || exportingPdf || rows.length === 0}>
              {saving ? "Saving..." : "Save Weekend Marks"}
            </button>
          </div>
        </div>

        <div style={{ marginTop: "1rem", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
            <thead>
              <tr>
                {['Learner', 'Gender', 'Score', 'Missed', 'Status'].map((label) => (
                  <th key={label} style={{ textAlign: "left", padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.08)", color: "#4ade80", fontSize: "0.75rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isMissed = String(row.status || "").toLowerCase() === "missed";
                const isOutOfRange = !isMissed && isOutOfRangeScore(row.score);
                return (
                  <tr key={row.student_id}>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{row.name}</td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{row.gender}</td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <input
                        type="number"
                        min={SCORE_MIN}
                        max={SCORE_MAX}
                        step="0.1"
                        value={row.score}
                        disabled={isMissed}
                        style={
                          isOutOfRange
                            ? {
                                borderColor: "rgba(248,113,113,0.7)",
                                boxShadow: "0 0 0 1px rgba(248,113,113,0.25)",
                              }
                            : undefined
                        }
                        onChange={(event) => updateRow(row.student_id, { score: event.target.value, status: event.target.value === "" ? row.status : "Submitted" })}
                      />
                    </td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <input
                        type="checkbox"
                        checked={isMissed}
                        onChange={(event) =>
                          updateRow(row.student_id, {
                            status: event.target.checked ? "Missed" : row.score !== "" ? "Submitted" : "",
                            score: event.target.checked ? "" : row.score,
                          })
                        }
                      />
                    </td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)", color: isMissed ? "#fca5a5" : isOutOfRange ? "#fca5a5" : "rgba(241,245,249,0.76)" }}>
                      {isMissed ? "Missed" : isOutOfRange ? "Out of range" : row.score !== "" ? "Submitted" : "Pending"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </BoardingAdminShell>
  );
}
