import { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../../../lib/api";
import ALevelAdminShell from "../components/ALevelAdminShell";

const STREAMS = ["S5 Arts", "S5 Sciences", "S6 Arts", "S6 Sciences"];
const DEFAULT_YEAR = String(new Date().getFullYear());

const formatDateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

export default function ALevelPromotions() {
  const [tab, setTab] = useState("promote");
  const [form, setForm] = useState({ stream: "S5 Arts", academicYear: DEFAULT_YEAR, notes: "" });
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [archiveRows, setArchiveRows] = useState([]);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [archivePage, setArchivePage] = useState(1);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveYear, setArchiveYear] = useState(DEFAULT_YEAR);
  const [archiveLoading, setArchiveLoading] = useState(false);

  const [historyRows, setHistoryRows] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyYear, setHistoryYear] = useState(DEFAULT_YEAR);
  const [historyLoading, setHistoryLoading] = useState(false);

  const archivePages = useMemo(() => Math.max(1, Math.ceil(archiveTotal / 25)), [archiveTotal]);
  const historyPages = useMemo(() => Math.max(1, Math.ceil(historyTotal / 25)), [historyTotal]);
  const isGraduation = form.stream.startsWith("S6 ");

  const updateForm = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    if (field !== "notes") setPreview(null);
    setMessage("");
    setError("");
  };

  const loadPreview = async () => {
    setPreviewLoading(true);
    setError("");
    setMessage("");
    try {
      const params = new URLSearchParams({
        stream: form.stream,
        academicYear: form.academicYear.trim(),
      });
      const data = await adminFetch(`/api/alevel/admin/promotions/preview?${params.toString()}`);
      setPreview(data);
    } catch (requestError) {
      setPreview(null);
      setError(requestError.message || "Failed to load the A-Level promotion preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const executePromotion = async () => {
    const action = isGraduation ? "graduate and archive" : "promote";
    const count = Number(preview?.eligibleCount || 0);
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} ${count} eligible learners from ${form.stream}?`)) {
      return;
    }

    setExecuteLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await adminFetch("/api/alevel/admin/promotions/execute", {
        method: "POST",
        body: {
          stream: form.stream,
          academicYear: form.academicYear.trim(),
          notes: form.notes.trim(),
        },
      });
      await loadPreview();
      setMessage(
        result.archivedCount > 0
          ? `${result.archivedCount} S6 learners graduated and moved to the archive. Marks and subject records were retained.`
          : `${result.promotedCount || 0} S5 learners moved to ${result.target?.toStream || "S6"}. Subject combinations were unchanged.`
      );
    } catch (requestError) {
      setError(requestError.message || "Failed to execute A-Level promotions.");
    } finally {
      setExecuteLoading(false);
    }
  };

  const loadArchive = async () => {
    setArchiveLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(archivePage), limit: "25" });
      if (archiveSearch.trim()) params.set("search", archiveSearch.trim());
      if (archiveYear.trim()) params.set("academicYear", archiveYear.trim());
      const data = await adminFetch(`/api/alevel/admin/archived-learners?${params.toString()}`);
      setArchiveRows(Array.isArray(data?.rows) ? data.rows : []);
      setArchiveTotal(Number(data?.total || 0));
    } catch (requestError) {
      setArchiveRows([]);
      setArchiveTotal(0);
      setError(requestError.message || "Failed to load archived A-Level learners.");
    } finally {
      setArchiveLoading(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(historyPage), limit: "25" });
      if (historyYear.trim()) params.set("academicYear", historyYear.trim());
      const data = await adminFetch(`/api/alevel/admin/promotions/history?${params.toString()}`);
      setHistoryRows(Array.isArray(data?.rows) ? data.rows : []);
      setHistoryTotal(Number(data?.total || 0));
    } catch (requestError) {
      setHistoryRows([]);
      setHistoryTotal(0);
      setError(requestError.message || "Failed to load A-Level promotion history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "promote") loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab === "archive") loadArchive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, archivePage]);

  useEffect(() => {
    if (tab === "history") loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, historyPage]);

  return (
    <ALevelAdminShell
      title="A-Level Promotions"
      subtitle="Advance S5 cohorts and preserve graduated S6 records in a permanent archive."
      contentClassName="alevel-promotions-page"
    >
      <section className="alevel-promotion-workspace">
        <div className="alevel-promotion-tabs" role="tablist" aria-label="A-Level promotion views">
          {[
            ["promote", "Promote"],
            ["archive", `Graduates Archive${archiveTotal ? ` (${archiveTotal})` : ""}`],
            ["history", "History"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "is-active" : ""}
              onClick={() => {
                setTab(value);
                setError("");
                setMessage("");
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <div className="panel-alert panel-alert-error">{error}</div>}
        {message && <div className="alevel-promotion-success">{message}</div>}

        {tab === "promote" && (
          <>
            <div className="alevel-promotion-command-band">
              <div className="alevel-promotion-fields">
                <label>
                  <span>Current Cohort</span>
                  <select value={form.stream} onChange={(event) => updateForm("stream", event.target.value)}>
                    {STREAMS.map((stream) => <option key={stream}>{stream}</option>)}
                  </select>
                </label>
                <label>
                  <span>Academic Year</span>
                  <input value={form.academicYear} onChange={(event) => updateForm("academicYear", event.target.value)} />
                </label>
                <label className="alevel-promotion-notes-field">
                  <span>Batch Note</span>
                  <input
                    value={form.notes}
                    placeholder="Optional administrative note"
                    onChange={(event) => updateForm("notes", event.target.value)}
                  />
                </label>
              </div>
              <div className="alevel-promotion-actions">
                <button type="button" className="ghost-btn" onClick={loadPreview} disabled={previewLoading || executeLoading}>
                  {previewLoading ? "Refreshing..." : "Refresh Preview"}
                </button>
                <button
                  type="button"
                  className={isGraduation ? "alevel-archive-command" : "primary-btn"}
                  onClick={executePromotion}
                  disabled={executeLoading || previewLoading || Number(preview?.eligibleCount || 0) === 0}
                >
                  {executeLoading ? "Processing..." : isGraduation ? "Graduate & Archive" : "Promote to S6"}
                </button>
              </div>
            </div>

            <div className={`alevel-promotion-consequence ${isGraduation ? "is-archive" : ""}`}>
              <strong>{isGraduation ? "S6 graduation" : "S5 advancement"}</strong>
              <span>
                {isGraduation
                  ? "Learners leave live class lists and become read-only archived graduates. Marks, papers, combinations, and subject registrations remain stored."
                  : `Learners move from ${form.stream} to ${preview?.target?.toStream || "the matching S6 stream"}. Their combinations and registered subjects do not change.`}
              </span>
            </div>

            <div className="alevel-promotion-metrics">
              <div><span>Candidates</span><strong>{preview?.totalCandidates || 0}</strong></div>
              <div><span>Eligible</span><strong>{preview?.eligibleCount || 0}</strong></div>
              <div><span>Already Processed</span><strong>{preview?.skipped?.alreadyPromoted || 0}</strong></div>
              <div><span>Marks Deleted</span><strong>0</strong></div>
            </div>

            <div className="teachers-table-wrapper">
              <table className="teachers-table alevel-promotion-table">
                <thead>
                  <tr>
                    <th>Learner</th>
                    <th>Current Stream</th>
                    <th>Destination</th>
                    <th>Combination</th>
                    <th>Registered Subjects</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {previewLoading && !preview ? (
                    <tr><td colSpan="6">Loading promotion preview...</td></tr>
                  ) : (preview?.learners || []).length === 0 ? (
                    <tr><td colSpan="6">No eligible learners remain in this cohort for the selected year.</td></tr>
                  ) : (
                    preview.learners.map((learner) => (
                      <tr key={learner.id}>
                        <td><strong>{learner.name}</strong></td>
                        <td>{learner.fromStream}</td>
                        <td>{isGraduation ? "Graduates Archive" : learner.toStream}</td>
                        <td>{learner.combination || "—"}</td>
                        <td>{learner.subjects || "—"}</td>
                        <td><span className={isGraduation ? "alevel-outcome-archive" : "alevel-outcome-promote"}>{learner.promotionType}</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "archive" && (
          <>
            <div className="alevel-promotion-list-tools">
              <input placeholder="Search graduate" value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} />
              <input placeholder="Academic year" value={archiveYear} onChange={(event) => setArchiveYear(event.target.value)} />
              <button type="button" className="ghost-btn" onClick={() => { setArchivePage(1); loadArchive(); }} disabled={archiveLoading}>
                {archiveLoading ? "Loading..." : "Apply"}
              </button>
            </div>
            <div className="teachers-table-wrapper">
              <table className="teachers-table alevel-promotion-table">
                <thead><tr><th>Graduate</th><th>Stream</th><th>Combination</th><th>Subjects</th><th>Graduated</th><th>Year</th><th>Status</th></tr></thead>
                <tbody>
                  {archiveRows.length === 0 ? (
                    <tr><td colSpan="7">{archiveLoading ? "Loading archive..." : "No archived graduates found."}</td></tr>
                  ) : archiveRows.map((learner) => (
                    <tr key={learner.id}>
                      <td><strong>{learner.name}</strong></td><td>{learner.stream}</td><td>{learner.combination || "—"}</td>
                      <td>{learner.subjects || "—"}</td><td>{formatDateTime(learner.graduatedAt || learner.archivedAt)}</td>
                      <td>{learner.graduatedAcademicYear || "—"}</td><td><span className="alevel-outcome-archive">ARCHIVED</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="alevel-promotion-pagination">
              <span>Page {archivePage} of {archivePages}</span>
              <button type="button" className="ghost-btn" onClick={() => setArchivePage((page) => Math.max(1, page - 1))} disabled={archivePage <= 1 || archiveLoading}>Previous</button>
              <button type="button" className="ghost-btn" onClick={() => setArchivePage((page) => Math.min(archivePages, page + 1))} disabled={archivePage >= archivePages || archiveLoading}>Next</button>
            </div>
          </>
        )}

        {tab === "history" && (
          <>
            <div className="alevel-promotion-list-tools">
              <input placeholder="Academic year" value={historyYear} onChange={(event) => setHistoryYear(event.target.value)} />
              <button type="button" className="ghost-btn" onClick={() => { setHistoryPage(1); loadHistory(); }} disabled={historyLoading}>
                {historyLoading ? "Loading..." : "Apply"}
              </button>
            </div>
            <div className="teachers-table-wrapper">
              <table className="teachers-table alevel-promotion-table">
                <thead><tr><th>Time</th><th>Learner</th><th>From</th><th>To</th><th>Action</th><th>Year</th><th>Admin</th></tr></thead>
                <tbody>
                  {historyRows.length === 0 ? (
                    <tr><td colSpan="7">{historyLoading ? "Loading history..." : "No promotion history found."}</td></tr>
                  ) : historyRows.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.promotedAt)}</td><td><strong>{row.learnerName}</strong></td><td>{row.fromStream}</td>
                      <td>{row.promotionType === "GRADUATED" ? "Graduates Archive" : row.toStream}</td><td>{row.promotionType}</td>
                      <td>{row.academicYear}</td><td>{row.promotedBy || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="alevel-promotion-pagination">
              <span>Page {historyPage} of {historyPages}</span>
              <button type="button" className="ghost-btn" onClick={() => setHistoryPage((page) => Math.max(1, page - 1))} disabled={historyPage <= 1 || historyLoading}>Previous</button>
              <button type="button" className="ghost-btn" onClick={() => setHistoryPage((page) => Math.min(historyPages, page + 1))} disabled={historyPage >= historyPages || historyLoading}>Next</button>
            </div>
          </>
        )}
      </section>
    </ALevelAdminShell>
  );
}
