// src/pages/EndOfTermReports.jsx
import React, { useState } from "react";
import generateReportCardPDF from "../components/reportCardPdf";

  const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

  function EndOfTermReports() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));  
  const [term, setTerm] = useState("1");
  const [classLevel, setClassLevel] = useState("S3");
  const [stream, setStream] = useState("North");
  const [studentId, setStudentId] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState([]);

  /* ======================
     FETCH REPORT DATA
  ====================== */
  const handlePreview = async () => {
    setLoading(true);
    setError("");
    setData([]);
  
    try {
      // 🔹 Build query params safely
      const params = new URLSearchParams({
        year,
        term,
        class_level: classLevel,
        stream,
      });
  
      // 🔹 OPTIONAL: single student report
      if (studentId) {
        params.append("student_id", studentId);
      }
  
      const res = await fetch(
        `${API_BASE}/api/admin/reports/term?${params.toString()}`,
        {
          headers: {
            "x-admin-key": localStorage.getItem("adminKey") || "",
          },
        }
      );
  
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load report");
      }
  
      const rows = await res.json();
  
      // ✅ UX FIX — empty results (South / no marks / no assignments)
      if (rows.length === 0) {
        setError(
          studentId
            ? "No report data found for the selected student."
            : "No report data found for this class and stream. " +
              "This usually means teachers are not assigned or marks have not been submitted."
        );
      }
  
      setData(rows);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };
  
  

  /* ======================
     DOWNLOAD PDF
  ====================== */
  const handleDownload = () => {
    generateReportCardPDF(data, {
      year,
      term,
      class_level: classLevel,
      stream,
    });
  };

  return (
    <div className="admin-section">
      <h2>📘 End of Term Reports</h2>

      {/* FILTERS */}
      <div className="filter-grid">
        <select value={year} onChange={(e) => setYear(e.target.value)}>
        <option value={currentYear}>{currentYear}</option>
        <option value={currentYear - 1}>{currentYear - 1}</option>

        </select>

        <select value={term} onChange={(e) => setTerm(e.target.value)}>
          <option value="1">Term 1</option>
          <option value="2">Term 2</option>
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
  <option value="">All students (class report)</option>
  {data
    .map((r) => ({ id: r.student_id, name: r.student_name }))
    .filter(
      (v, i, a) => a.findIndex(x => x.id === v.id) === i
    )
    .map((s) => (
      <option key={s.id} value={s.id}>
        {s.name}
      </option>
    ))}
</select>

      </div>

      {/* ACTIONS */}
      <div style={{ marginTop: "1rem" }}>
        <button onClick={handlePreview} disabled={loading}>
          {loading ? "Loading…" : "Preview"}
        </button>

        <button
          onClick={handleDownload}
          disabled={data.length === 0}
          style={{ marginLeft: "1rem" }}
        >
          Download PDF
        </button>
      </div>

      {/* STATUS */}
      {error && <div className="error-box">{error}</div>}

      {data.length > 0 && (
        <div className="preview-box">
          <p>
            ✅ {new Set(data.map((r) => r.student_id)).size} students found
          </p>
          <p>Subjects included: {new Set(data.map((r) => r.subject)).size}</p>
        </div>
      )}
    </div>
  );
  
}

export default EndOfTermReports;
 