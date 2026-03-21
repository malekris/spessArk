// src/pages/EndOfTermReports.jsx
import React, { useMemo, useState } from "react";
import generateReportCardPDF from "../components/reportCardPdf";

  const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
  const REPORT_DATES_STORAGE_KEY = "spess_report_card_dates";

  function EndOfTermReports({ mode = "term" }) {
  const isEndOfYearMode = mode === "year";
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));  
  const [term, setTerm] = useState(isEndOfYearMode ? "3" : "1");
  const [classLevel, setClassLevel] = useState("S3");
  const [stream, setStream] = useState("North");
  const [studentId, setStudentId] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState([]);
  const [reportDatesCache, setReportDatesCache] = useState(() => {
    try {
      const raw = window.localStorage.getItem(REPORT_DATES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const termOptions = useMemo(
    () => (isEndOfYearMode ? [{ value: "3", label: "Term 3" }] : [
      { value: "1", label: "Term 1" },
      { value: "2", label: "Term 2" },
    ]),
    [isEndOfYearMode]
  );
  const reportDatesKey = useMemo(
    () => `${mode}_${year}_${term}`,
    [mode, year, term]
  );
  const reportDates = reportDatesCache[reportDatesKey] || {
    termEndedOn: "",
    nextTermBeginsOn: "",
  };

  const updateReportDate = (field, value) => {
    setReportDatesCache((prev) => {
      const next = {
        ...prev,
        [reportDatesKey]: {
          ...(prev[reportDatesKey] || {}),
          [field]: value,
        },
      };
      try {
        window.localStorage.setItem(REPORT_DATES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write issues
      }
      return next;
    });
    setError("");
  };

  const validateReportDates = (actionLabel) => {
    if (reportDates.termEndedOn && reportDates.nextTermBeginsOn) return true;
    setError(
      `Enter both "Term Ended On" and "Next Term Begins On" before ${actionLabel} ${isEndOfYearMode ? "end-of-year" : "end-of-term"} report cards.`
    );
    return false;
  };

  /* ======================
     FETCH REPORT DATA
  ====================== */
  const handlePreview = async () => {
    if (!validateReportDates("previewing")) {
      setData([]);
      return;
    }

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
  
      const reportEndpoint = isEndOfYearMode
        ? "/api/admin/reports/year"
        : "/api/admin/reports/term";

      const res = await fetch(
        `${API_BASE}${reportEndpoint}?${params.toString()}`,
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
    if (!validateReportDates("downloading")) return;

    generateReportCardPDF(data, {
      year,
      term,
      class_level: classLevel,
      stream,
      reportType: isEndOfYearMode ? "year" : "term",
      termEndedOn: reportDates.termEndedOn,
      nextTermBeginsOn: reportDates.nextTermBeginsOn,
    });
  };

  return (
    <div className="admin-section">
      <h2>{isEndOfYearMode ? "📕 End of Year Reports" : "📘 End of Term Reports"}</h2>

      {/* FILTERS */}
      <div className="filter-grid">
        <select value={year} onChange={(e) => setYear(e.target.value)}>
        <option value={currentYear}>{currentYear}</option>
        <option value={currentYear - 1}>{currentYear - 1}</option>

        </select>

        <select value={term} onChange={(e) => setTerm(e.target.value)}>
          {termOptions.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
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

      <div
        style={{
          marginTop: "1rem",
          padding: "0.95rem 1rem",
          borderRadius: "1rem",
          border: "1px solid rgba(148, 163, 184, 0.28)",
          background: "rgba(15, 23, 42, 0.72)",
          display: "grid",
          gap: "0.8rem",
        }}
      >
        <div>
          <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#93c5fd", marginBottom: "0.3rem" }}>
            Report Dates
          </div>
          <div style={{ fontSize: "0.88rem", color: "#cbd5e1", lineHeight: 1.6 }}>
            Set these once here and they go straight onto the report card. Preview and download stay blocked until both dates are filled.
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.8rem",
          }}
        >
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#cbd5e1" }}>
              Term Ended On
            </span>
            <input
              type="date"
              value={reportDates.termEndedOn || ""}
              onChange={(e) => updateReportDate("termEndedOn", e.target.value)}
              style={{
                minHeight: "44px",
                borderRadius: "0.9rem",
                border: "1px solid rgba(148, 163, 184, 0.35)",
                background: "rgba(2, 6, 23, 0.9)",
                color: "#e2e8f0",
                padding: "0.72rem 0.85rem",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#cbd5e1" }}>
              Next Term Begins On
            </span>
            <input
              type="date"
              value={reportDates.nextTermBeginsOn || ""}
              onChange={(e) => updateReportDate("nextTermBeginsOn", e.target.value)}
              style={{
                minHeight: "44px",
                borderRadius: "0.9rem",
                border: "1px solid rgba(148, 163, 184, 0.35)",
                background: "rgba(2, 6, 23, 0.9)",
                color: "#e2e8f0",
                padding: "0.72rem 0.85rem",
                outline: "none",
              }}
            />
          </label>
        </div>
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
 
