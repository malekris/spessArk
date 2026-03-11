import React, { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../lib/api";

const CLASS_OPTIONS = ["S1", "S2", "S3", "S4"];
const STREAM_OPTIONS = ["North", "South"];

const formatDateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
};

const defaultAcademicYear = String(new Date().getFullYear());

export default function PromotionPanel() {
  const [tab, setTab] = useState("promote");

  const [form, setForm] = useState({
    classLevel: "S1",
    stream: "North",
    academicYear: defaultAcademicYear,
    notes: "",
  });

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewData, setPreviewData] = useState(null);

  const [executeLoading, setExecuteLoading] = useState(false);
  const [executeResult, setExecuteResult] = useState(null);
  const [executeError, setExecuteError] = useState("");

  const [historyYear, setHistoryYear] = useState(defaultAcademicYear);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLimit, setHistoryLimit] = useState(25);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const [graduatedSearch, setGraduatedSearch] = useState("");
  const [graduatedYear, setGraduatedYear] = useState(defaultAcademicYear);
  const [graduatedPage, setGraduatedPage] = useState(1);
  const [graduatedLimit, setGraduatedLimit] = useState(25);
  const [graduatedRows, setGraduatedRows] = useState([]);
  const [graduatedTotal, setGraduatedTotal] = useState(0);
  const [graduatedLoading, setGraduatedLoading] = useState(false);
  const [graduatedError, setGraduatedError] = useState("");

  const historyTotalPages = useMemo(
    () => Math.max(1, Math.ceil(historyTotal / Math.max(1, historyLimit))),
    [historyTotal, historyLimit]
  );
  const graduatedTotalPages = useMemo(
    () => Math.max(1, Math.ceil(graduatedTotal / Math.max(1, graduatedLimit))),
    [graduatedTotal, graduatedLimit]
  );

  const handlePreview = async () => {
    setPreviewLoading(true);
    setPreviewError("");
    setExecuteError("");
    try {
      const params = new URLSearchParams({
        classLevel: form.classLevel,
        stream: form.stream,
        academicYear: form.academicYear.trim(),
      });
      const data = await adminFetch(`/api/admin/promotions/preview?${params.toString()}`);
      setPreviewData(data);
    } catch (err) {
      console.error("Promotion preview error:", err);
      setPreviewData(null);
      setPreviewError(err.message || "Failed to load preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleExecute = async () => {
    setExecuteLoading(true);
    setExecuteError("");
    try {
      const payload = {
        classLevel: form.classLevel,
        stream: form.stream,
        academicYear: form.academicYear.trim(),
        notes: form.notes.trim(),
      };
      const data = await adminFetch("/api/admin/promotions/execute", {
        method: "POST",
        body: payload,
      });
      setExecuteResult(data);
      await handlePreview();
      if (tab === "history") {
        await fetchHistory();
      }
      if (tab === "graduated") {
        await fetchGraduated();
      }
    } catch (err) {
      console.error("Promotion execute error:", err);
      setExecuteError(err.message || "Failed to execute promotions.");
    } finally {
      setExecuteLoading(false);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const params = new URLSearchParams({
        page: String(historyPage),
        limit: String(historyLimit),
      });
      if (historyYear.trim()) params.set("academicYear", historyYear.trim());

      const data = await adminFetch(`/api/admin/promotions/history?${params.toString()}`);
      setHistoryRows(Array.isArray(data?.rows) ? data.rows : []);
      setHistoryTotal(Number(data?.total || 0));
    } catch (err) {
      console.error("Promotion history error:", err);
      setHistoryRows([]);
      setHistoryTotal(0);
      setHistoryError(err.message || "Failed to load promotion history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchGraduated = async () => {
    setGraduatedLoading(true);
    setGraduatedError("");
    try {
      const params = new URLSearchParams({
        page: String(graduatedPage),
        limit: String(graduatedLimit),
      });
      if (graduatedSearch.trim()) params.set("search", graduatedSearch.trim());
      if (graduatedYear.trim()) params.set("academicYear", graduatedYear.trim());
      const data = await adminFetch(`/api/admin/graduated?${params.toString()}`);
      setGraduatedRows(Array.isArray(data?.students) ? data.students : []);
      setGraduatedTotal(Number(data?.total || 0));
    } catch (err) {
      console.error("Graduated learners error:", err);
      setGraduatedRows([]);
      setGraduatedTotal(0);
      setGraduatedError(err.message || "Failed to load graduated learners.");
    } finally {
      setGraduatedLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "promote" && !previewData) {
      handlePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab === "history") fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, historyPage, historyLimit]);

  useEffect(() => {
    if (tab === "graduated") fetchGraduated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, graduatedPage, graduatedLimit]);

  return (
    <div className="panel-card">
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.9rem", flexWrap: "wrap" }}>
        <button type="button" className={tab === "promote" ? "primary-btn" : "ghost-btn"} onClick={() => setTab("promote")}>
          Promote
        </button>
        <button type="button" className={tab === "history" ? "primary-btn" : "ghost-btn"} onClick={() => setTab("history")}>
          History
        </button>
        <button type="button" className={tab === "graduated" ? "primary-btn" : "ghost-btn"} onClick={() => setTab("graduated")}>
          Graduated
        </button>
      </div>

      {tab === "promote" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "0.6rem", marginBottom: "0.8rem" }}>
            <select
              value={form.classLevel}
              onChange={(e) => setForm((p) => ({ ...p, classLevel: e.target.value }))}
            >
              {CLASS_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={form.stream}
              onChange={(e) => setForm((p) => ({ ...p, stream: e.target.value }))}
            >
              {STREAM_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Academic year (e.g. 2026)"
              value={form.academicYear}
              onChange={(e) => setForm((p) => ({ ...p, academicYear: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Optional notes"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </div>

          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginBottom: "0.8rem", flexWrap: "wrap" }}>
            <button type="button" className="ghost-btn" onClick={handlePreview} disabled={previewLoading || executeLoading}>
              {previewLoading ? "Loading Preview…" : "Preview"}
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                if (!window.confirm("Execute promotion for this class and stream?")) return;
                handleExecute();
              }}
              disabled={executeLoading || previewLoading}
            >
              {executeLoading ? "Executing…" : "Execute Promotion"}
            </button>
          </div>

          {previewError && <div className="panel-alert panel-alert-error">{previewError}</div>}
          {executeError && <div className="panel-alert panel-alert-error">{executeError}</div>}

          {executeResult && (
            <div style={{ marginBottom: "0.8rem", padding: "0.6rem 0.7rem", borderRadius: "0.7rem", border: "1px solid rgba(34,197,94,0.45)", background: "rgba(34,197,94,0.12)", color: "#bbf7d0", fontSize: "0.82rem" }}>
              Processed: <strong>{executeResult.processedCount || 0}</strong> | Promoted:{" "}
              <strong>{executeResult.promotedCount || 0}</strong> | Graduated:{" "}
              <strong>{executeResult.graduatedCount || 0}</strong>
            </div>
          )}

          {previewData && (
            <>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.7rem" }}>
                <div className="muted-text">Candidates: <strong>{previewData.totalCandidates || 0}</strong></div>
                <div className="muted-text">Eligible: <strong>{previewData.eligibleCount || 0}</strong></div>
                <div className="muted-text">Skipped non-active: <strong>{previewData?.skipped?.nonActive || 0}</strong></div>
                <div className="muted-text">Skipped already promoted: <strong>{previewData?.skipped?.alreadyPromoted || 0}</strong></div>
              </div>
              {Array.isArray(previewData.learners) && previewData.learners.length > 0 ? (
                <div className="teachers-table-wrapper">
                  <table className="teachers-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>From Class</th>
                        <th>From Stream</th>
                        <th>To Class</th>
                        <th>To Stream</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.learners.map((learner) => (
                        <tr key={learner.id}>
                          <td>{learner.name}</td>
                          <td>{learner.fromClassLevel}</td>
                          <td>{learner.fromStream}</td>
                          <td>{learner.toClassLevel}</td>
                          <td>{learner.toStream}</td>
                          <td>{learner.promotionType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted-text">No eligible learners for this selection.</p>
              )}
            </>
          )}
        </>
      )}

      {tab === "history" && (
        <>
          <div style={{ display: "flex", gap: "0.6rem", marginBottom: "0.8rem", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="Academic year (optional)"
              value={historyYear}
              onChange={(e) => setHistoryYear(e.target.value)}
            />
            <button type="button" className="ghost-btn" onClick={() => { setHistoryPage(1); fetchHistory(); }} disabled={historyLoading}>
              {historyLoading ? "Loading…" : "Apply"}
            </button>
          </div>
          {historyError && <div className="panel-alert panel-alert-error">{historyError}</div>}
          {historyLoading && historyRows.length === 0 ? (
            <p className="muted-text">Loading history…</p>
          ) : historyRows.length === 0 ? (
            <p className="muted-text">No promotion history found.</p>
          ) : (
            <div className="teachers-table-wrapper">
              <table className="teachers-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Learner</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Type</th>
                    <th>Year</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDateTime(r.promotedAt)}</td>
                      <td>{r.studentName}</td>
                      <td>{r.fromClassLevel} {r.fromStream}</td>
                      <td>{r.toClassLevel} {r.toStream}</td>
                      <td>{r.promotionType}</td>
                      <td>{r.academicYear}</td>
                      <td>{r.promotedBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: "0.7rem", display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
            <div className="muted-text">Page {historyPage} / {historyTotalPages}</div>
            <select value={historyLimit} onChange={(e) => { setHistoryLimit(Number(e.target.value)); setHistoryPage(1); }}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button type="button" className="ghost-btn" onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={historyPage <= 1 || historyLoading}>
              Prev
            </button>
            <button type="button" className="ghost-btn" onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))} disabled={historyPage >= historyTotalPages || historyLoading}>
              Next
            </button>
          </div>
        </>
      )}

      {tab === "graduated" && (
        <>
          <div style={{ display: "flex", gap: "0.6rem", marginBottom: "0.8rem", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="Search by name or id"
              value={graduatedSearch}
              onChange={(e) => setGraduatedSearch(e.target.value)}
            />
            <input
              type="text"
              placeholder="Academic year (optional)"
              value={graduatedYear}
              onChange={(e) => setGraduatedYear(e.target.value)}
            />
            <button type="button" className="ghost-btn" onClick={() => { setGraduatedPage(1); fetchGraduated(); }} disabled={graduatedLoading}>
              {graduatedLoading ? "Loading…" : "Apply"}
            </button>
          </div>
          {graduatedError && <div className="panel-alert panel-alert-error">{graduatedError}</div>}
          {graduatedLoading && graduatedRows.length === 0 ? (
            <p className="muted-text">Loading graduated learners…</p>
          ) : graduatedRows.length === 0 ? (
            <p className="muted-text">No graduated learners found.</p>
          ) : (
            <div className="teachers-table-wrapper">
              <table className="teachers-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Gender</th>
                    <th>Class</th>
                    <th>Stream</th>
                    <th>Status</th>
                    <th>Graduated At</th>
                    <th>Academic Year</th>
                  </tr>
                </thead>
                <tbody>
                  {graduatedRows.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.gender}</td>
                      <td>{s.class_level}</td>
                      <td>{s.stream}</td>
                      <td>{s.status}</td>
                      <td>{formatDateTime(s.graduatedAt)}</td>
                      <td>{s.graduatedAcademicYear || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: "0.7rem", display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
            <div className="muted-text">Page {graduatedPage} / {graduatedTotalPages}</div>
            <select value={graduatedLimit} onChange={(e) => { setGraduatedLimit(Number(e.target.value)); setGraduatedPage(1); }}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button type="button" className="ghost-btn" onClick={() => setGraduatedPage((p) => Math.max(1, p - 1))} disabled={graduatedPage <= 1 || graduatedLoading}>
              Prev
            </button>
            <button type="button" className="ghost-btn" onClick={() => setGraduatedPage((p) => Math.min(graduatedTotalPages, p + 1))} disabled={graduatedPage >= graduatedTotalPages || graduatedLoading}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

