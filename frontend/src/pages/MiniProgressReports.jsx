import React, { useMemo, useState } from "react";
import { adminFetch } from "../lib/api";
import generateMiniProgressReportPdf from "../components/miniProgressReportPdf";

function MiniProgressReports({ onClose }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [term, setTerm] = useState("1");
  const [classLevel, setClassLevel] = useState("S1");
  const [stream, setStream] = useState("North");
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState([]);

  const groupedStudents = useMemo(() => {
    const seen = new Map();
    data.forEach((row) => {
      if (!seen.has(row.student_id)) {
        seen.set(row.student_id, row.student_name);
      }
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);

  const handlePreview = async () => {
    setLoading(true);
    setError("");
    setData([]);

    try {
      const params = new URLSearchParams({
        year,
        term,
        class_level: classLevel,
        stream,
      });

      if (studentId) params.append("student_id", studentId);

      const rows = await adminFetch(`/api/admin/reports/mini-aoi1?${params.toString()}`);

      if (!Array.isArray(rows) || rows.length === 0) {
        setError(
          studentId
            ? "No AOI 1 mini report data found for the selected learner."
            : "No AOI 1 mini report data found for this class and stream."
        );
      }

      setData(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err.message || "Failed to load mini report data.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!data.length) {
      setError("Preview the AOI 1 mini reports first.");
      return;
    }

    generateMiniProgressReportPdf(data, {
      year,
      term: term === "1" ? "Term 1" : term === "2" ? "Term 2" : "Term 3",
      class_level: classLevel,
      stream,
    });
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Mini Reports</h2>
          <p>Generate AOI 1 mini progress slips for parents. Two slips fit on one A4 page.</p>
        </div>
        <button className="panel-close" type="button" onClick={() => onClose?.()}>
          ✕ Close
        </button>
      </div>

      <div className="admin-section">
        <div className="filter-grid">
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value={currentYear}>{currentYear}</option>
            <option value={currentYear - 1}>{currentYear - 1}</option>
          </select>

          <select value={term} onChange={(e) => setTerm(e.target.value)}>
            <option value="1">Term 1</option>
            <option value="2">Term 2</option>
            <option value="3">Term 3</option>
          </select>

          <select value={classLevel} onChange={(e) => setClassLevel(e.target.value)}>
            <option value="S1">S1</option>
            <option value="S2">S2</option>
            <option value="S3">S3</option>
            <option value="S4">S4</option>
          </select>

          <select value={stream} onChange={(e) => setStream(e.target.value)}>
            <option value="North">North</option>
            <option value="South">South</option>
          </select>

          <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">All learners (bulk mini reports)</option>
            {groupedStudents.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: "1rem", display: "flex", gap: "0.85rem", flexWrap: "wrap" }}>
          <button onClick={handlePreview} disabled={loading}>
            {loading ? "Loading…" : "Preview"}
          </button>
          <button onClick={handleDownload} disabled={!data.length}>
            Download PDF
          </button>
        </div>

        <div
          style={{
            marginTop: "1rem",
            padding: "0.95rem 1rem",
            borderRadius: "1rem",
            border: "1px solid rgba(148, 163, 184, 0.28)",
            background: "rgba(15, 23, 42, 0.72)",
            display: "grid",
            gap: "0.6rem",
          }}
        >
          <div
            style={{
              fontSize: "0.78rem",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              color: "#93c5fd",
            }}
          >
            Parent Meeting Snapshot
          </div>
          <div style={{ fontSize: "0.9rem", color: "#cbd5e1", lineHeight: 1.6 }}>
            This mini report uses <strong>AOI 1 only</strong> and prints <strong>2 learners per A4 page</strong>. It is separate from the main report card flow.
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}

        {data.length > 0 && (
          <div className="preview-box">
            <p>✅ {groupedStudents.length} learners ready for mini reports</p>
            <p>Subjects included: {new Set(data.map((row) => row.subject)).size}</p>
            <p>Mode: AOI 1 snapshot only</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default MiniProgressReports;
