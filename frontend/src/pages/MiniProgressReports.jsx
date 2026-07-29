import React, { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../lib/api";
import generateMiniProgressReportPdf from "../components/miniProgressReportPdf";
import { recordAdminReportGeneration } from "../utils/adminAuditEvents";
import { normalizeSchoolCalendar } from "../utils/schoolCalendar";

const getCalendarTermEndDate = (calendar, term, year) => {
  const normalized = normalizeSchoolCalendar(calendar || {});
  if (String(normalized.academicYear || "") !== String(year || "")) return "";

  const termIndex = Number.parseInt(String(term || "").replace(/\D/g, ""), 10);
  if (![1, 2, 3].includes(termIndex)) return "";

  return normalized.entries.find((entry) => entry.key === `term${termIndex}`)?.to || "";
};

function MiniProgressReports({ onClose }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [term, setTerm] = useState("1");
  const [classLevel, setClassLevel] = useState("S1");
  const [stream, setStream] = useState("North");
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStage, setDownloadStage] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState([]);
  const [schoolCalendar, setSchoolCalendar] = useState(null);

  useEffect(() => {
    let active = true;

    adminFetch("/api/admin/school-calendar")
      .then((calendar) => {
        if (active) setSchoolCalendar(calendar);
      })
      .catch((err) => {
        console.error("Failed to load the school calendar for Mini Reports:", err);
        if (active) setSchoolCalendar(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const termEndedOn = useMemo(
    () => getCalendarTermEndDate(schoolCalendar, term, year),
    [schoolCalendar, term, year]
  );

  const updateReportContext = (setter) => (event) => {
    setter(event.target.value);
    setStudentId("");
    setData([]);
    setError("");
  };

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

  const handleDownload = async () => {
    const downloadRows = studentId
      ? data.filter((row) => String(row.student_id) === String(studentId))
      : data;

    if (!downloadRows.length) {
      setError("Preview the AOI 1 mini reports first.");
      return;
    }

    setError("");
    setDownloading(true);
    setDownloadProgress(0);
    setDownloadStage("Preparing mini reports...");

    try {
      await generateMiniProgressReportPdf(
        downloadRows,
        {
          year,
          term: term === "1" ? "Term 1" : term === "2" ? "Term 2" : "Term 3",
          class_level: classLevel,
          stream,
          termEndedOn,
        },
        {
          onProgress: ({ percent, stage }) => {
            setDownloadProgress(percent || 0);
            setDownloadStage(stage || "Generating mini reports...");
          },
        }
      );
      await recordAdminReportGeneration({
        reportKind: "OLEVEL_MINI",
        classLevel,
        stream,
        term: term === "1" ? "Term 1" : term === "2" ? "Term 2" : "Term 3",
        year,
        studentId: studentId || null,
        learnerCount: new Set(downloadRows.map((row) => row.student_id)).size,
      });
    } catch (err) {
      setError(err.message || "Failed to generate mini report PDF.");
    } finally {
      setTimeout(() => {
        setDownloading(false);
        setDownloadProgress(0);
        setDownloadStage("");
      }, 500);
    }
  };

  return (
    <section className="panel mini-report-panel">
      <div className="panel-header mini-report-header">
        <div>
          <h2>Mini Reports</h2>
          <p>Generate full-page AOI 1 progress reports for parent meetings. Each learner receives one portrait A4 page.</p>
        </div>
        <button className="panel-close" type="button" onClick={() => onClose?.()}>
          ✕ Close
        </button>
      </div>

      <div className="admin-section mini-report-workspace">
        <div className="report-filter-grid mini-report-filter-grid">
          <label className="report-filter-field">
            <span>Academic Year</span>
            <span className="report-select-shell">
              <select value={year} onChange={updateReportContext(setYear)}>
                <option value={currentYear}>{currentYear}</option>
                <option value={currentYear - 1}>{currentYear - 1}</option>
              </select>
            </span>
          </label>

          <label className="report-filter-field">
            <span>Term</span>
            <span className="report-select-shell">
              <select value={term} onChange={updateReportContext(setTerm)}>
                <option value="1">Term 1</option>
                <option value="2">Term 2</option>
                <option value="3">Term 3</option>
              </select>
            </span>
          </label>

          <label className="report-filter-field">
            <span>Class</span>
            <span className="report-select-shell">
              <select value={classLevel} onChange={updateReportContext(setClassLevel)}>
                <option value="S1">S1</option>
                <option value="S2">S2</option>
                <option value="S3">S3</option>
                <option value="S4">S4</option>
              </select>
            </span>
          </label>

          <label className="report-filter-field">
            <span>Stream</span>
            <span className="report-select-shell">
              <select value={stream} onChange={updateReportContext(setStream)}>
                <option value="North">North</option>
                <option value="South">South</option>
              </select>
            </span>
          </label>

          <label className="report-filter-field report-filter-field-learner">
            <span>Learner</span>
            <span className="report-select-shell">
              <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">All learners (bulk mini reports)</option>
                {groupedStudents.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>

        <div className="report-filter-actions mini-report-actions">
          <button
            type="button"
            className="report-action-button mini-report-preview-button"
            onClick={handlePreview}
            disabled={loading || downloading}
          >
            {loading ? "Loading…" : "Preview"}
          </button>
          <button
            type="button"
            className="report-action-button mini-report-download-button"
            onClick={handleDownload}
            disabled={!data.length || downloading}
          >
            {downloading ? "Generating PDF…" : "Download PDF"}
          </button>
        </div>

        {downloading && (
          <div className="mini-report-progress">
            <div className="mini-report-progress-head">
              <strong>Processing Mini Reports</strong>
              <span>{downloadProgress}%</span>
            </div>
            <div className="mini-report-progress-track">
              <div
                className="mini-report-progress-value"
                style={{
                  width: `${Math.max(4, downloadProgress)}%`,
                }}
              />
            </div>
            <div className="mini-report-progress-stage">
              {downloadStage || "Generating mini reports..."}
            </div>
          </div>
        )}

        <div className="mini-report-snapshot">
          <div className="mini-report-snapshot-label">Parent Meeting Snapshot</div>
          <div className="mini-report-snapshot-copy">
            This report uses <strong>AOI 1 only</strong> and gives <strong>each learner a full portrait A4 page</strong>. It remains separate from the main report card flow.
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}

        {data.length > 0 && (
          <div className="mini-report-ready">
            <div className="mini-report-ready-head">
              <strong>Preview Ready</strong>
              <span>AOI 1</span>
            </div>
            <div className="mini-report-ready-stats">
              <span><strong>{groupedStudents.length}</strong> learners</span>
              <span><strong>{new Set(data.map((row) => row.subject)).size}</strong> subjects</span>
              <span>Portrait A4</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default MiniProgressReports;
