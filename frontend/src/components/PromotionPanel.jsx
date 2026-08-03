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
  const [subjectSelections, setSubjectSelections] = useState({});

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

  const isS2Transition = form.classLevel === "S2";
  const promotionLearners = Array.isArray(previewData?.learners) ? previewData.learners : [];
  const configuredS2Count = isS2Transition
    ? promotionLearners.filter(
        (learner) => (subjectSelections[String(learner.id)] || []).length === 2
      ).length
    : 0;
  const s2SelectionsReady =
    !isS2Transition ||
    (promotionLearners.length > 0 && configuredS2Count === promotionLearners.length);

  const updatePromotionForm = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    if (field === "classLevel" || field === "stream" || field === "academicYear") {
      setPreviewData(null);
      setExecuteResult(null);
      setSubjectSelections({});
      setPreviewError("");
      setExecuteError("");
    }
  };

  const toggleRetainedSubject = (learnerId, subject) => {
    const key = String(learnerId);
    const currentSelection = subjectSelections[key] || [];
    if (!currentSelection.includes(subject) && currentSelection.length >= 2) {
      setExecuteError("Each S2 learner can retain exactly two optional subjects. Deselect one first.");
      return;
    }
    setExecuteError("");
    setSubjectSelections((previous) => {
      const selected = previous[key] || [];
      if (selected.includes(subject)) {
        return { ...previous, [key]: selected.filter((item) => item !== subject) };
      }
      return { ...previous, [key]: [...selected, subject] };
    });
  };

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
      const initialSelections = {};
      if (form.classLevel === "S2") {
        (data?.learners || []).forEach((learner) => {
          const optionals = Array.isArray(learner.availableOptionalSubjects)
            ? learner.availableOptionalSubjects
            : [];
          initialSelections[String(learner.id)] = optionals.length === 2 ? optionals : [];
        });
      }
      setSubjectSelections(initialSelections);
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
        subjectSelections: isS2Transition
          ? promotionLearners.map((learner) => ({
              studentId: learner.id,
              keptSubjects: subjectSelections[String(learner.id)] || [],
            }))
          : [],
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
    <div className="panel-card promotion-panel-card">
      <div className="promotion-tabs" role="tablist" aria-label="Learner promotion views">
        <button type="button" role="tab" aria-selected={tab === "promote"} className={`promotion-tab ${tab === "promote" ? "is-active" : ""}`} onClick={() => setTab("promote")}>
          Promote
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} className={`promotion-tab ${tab === "history" ? "is-active" : ""}`} onClick={() => setTab("history")}>
          History
        </button>
        <button type="button" role="tab" aria-selected={tab === "graduated"} className={`promotion-tab ${tab === "graduated" ? "is-active" : ""}`} onClick={() => setTab("graduated")}>
          Graduated
        </button>
      </div>

      {tab === "promote" && (
        <>
          <div className="promotion-control-surface">
            <div className="promotion-filter-grid">
              <label className="promotion-field">
                <span>Current class</span>
                <select
                  className="promotion-control promotion-select"
                  value={form.classLevel}
                  onChange={(e) => updatePromotionForm("classLevel", e.target.value)}
                >
                  {CLASS_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="promotion-field">
                <span>Stream</span>
                <select
                  className="promotion-control promotion-select"
                  value={form.stream}
                  onChange={(e) => updatePromotionForm("stream", e.target.value)}
                >
                  {STREAM_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="promotion-field">
                <span>Academic year</span>
                <input
                  className="promotion-control"
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 2026"
                  value={form.academicYear}
                  onChange={(e) => updatePromotionForm("academicYear", e.target.value)}
                />
              </label>
              <label className="promotion-field promotion-notes-field">
                <span>Batch note <small>Optional</small></span>
                <input
                  className="promotion-control"
                  type="text"
                  placeholder="Add a short note for the audit trail"
                  value={form.notes}
                  onChange={(e) => updatePromotionForm("notes", e.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="promotion-action-row">
            <button type="button" className="ghost-btn promotion-preview-btn" onClick={handlePreview} disabled={previewLoading || executeLoading}>
              {previewLoading ? "Loading Preview…" : "Preview"}
            </button>
            <button
              type="button"
              className="primary-btn promotion-execute-btn"
              onClick={() => {
                const transitionMessage = isS2Transition
                  ? `Promote ${promotionLearners.length} learners to S3 with the selected nine-subject profiles?`
                  : "Execute promotion for this class and stream?";
                if (!window.confirm(transitionMessage)) return;
                handleExecute();
              }}
              disabled={
                executeLoading ||
                previewLoading ||
                !previewData ||
                promotionLearners.length === 0 ||
                !s2SelectionsReady
              }
            >
              {executeLoading ? "Executing…" : "Execute Promotion"}
            </button>
          </div>

          {previewError && <div className="panel-alert panel-alert-error">{previewError}</div>}
          {executeError && <div className="panel-alert panel-alert-error">{executeError}</div>}

          {executeResult && (
            <div className="promotion-result-banner">
              Processed: <strong>{executeResult.processedCount || 0}</strong> | Promoted:{" "}
              <strong>{executeResult.promotedCount || 0}</strong> | Graduated:{" "}
              <strong>{executeResult.graduatedCount || 0}</strong> | Marks Preserved:{" "}
              <strong>{executeResult.preservedMarksCount || 0}</strong>
              {Number(executeResult.subjectProfilesUpdated || 0) > 0 && (
                <> | S3 Profiles Updated: <strong>{executeResult.subjectProfilesUpdated}</strong></>
              )}
            </div>
          )}

          {previewData && (
            <>
              <div className="promotion-preview-metrics">
                <div><span>Candidates</span><strong>{previewData.totalCandidates || 0}</strong></div>
                <div><span>Eligible</span><strong>{previewData.eligibleCount || 0}</strong></div>
                <div><span>Non-active</span><strong>{previewData?.skipped?.nonActive || 0}</strong></div>
                <div><span>Already promoted</span><strong>{previewData?.skipped?.alreadyPromoted || 0}</strong></div>
              </div>
              {isS2Transition && promotionLearners.length > 0 && (
                <div className="promotion-transition-banner">
                  <div>
                    <span className="promotion-transition-eyebrow">S2 to S3 subject transition</span>
                    <strong>Choose exactly two optional subjects for every learner.</strong>
                    <p>The seven core subjects remain automatically, producing the required nine-subject S3 profile.</p>
                  </div>
                  <div className={s2SelectionsReady ? "is-ready" : ""}>
                    <strong>{configuredS2Count} / {promotionLearners.length}</strong>
                    <span>profiles ready</span>
                  </div>
                </div>
              )}
              {Array.isArray(previewData.learners) && previewData.learners.length > 0 ? (
                <div className="teachers-table-wrapper">
                  <table className={`teachers-table ${isS2Transition ? "promotion-transition-table" : ""}`}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>From Class</th>
                        <th>From Stream</th>
                        <th>To Class</th>
                        <th>To Stream</th>
                        {isS2Transition ? <th>Optional Subjects to Keep</th> : <th>Type</th>}
                        {isS2Transition && <th>Dropped After Promotion</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.learners.map((learner) => {
                        const selection = subjectSelections[String(learner.id)] || [];
                        const optionalSubjects = learner.availableOptionalSubjects || [];
                        const droppedSubjects = optionalSubjects.filter(
                          (subject) => !selection.includes(subject)
                        );
                        return (
                          <tr key={learner.id}>
                            <td>
                              <strong>{learner.name}</strong>
                              {isS2Transition && (
                                <span className={`promotion-selection-count ${selection.length === 2 ? "is-ready" : ""}`}>
                                  {selection.length} of 2 retained
                                </span>
                              )}
                            </td>
                            <td>{learner.fromClassLevel}</td>
                            <td>{learner.fromStream}</td>
                            <td>{learner.toClassLevel}</td>
                            <td>{learner.toStream}</td>
                            {isS2Transition ? (
                              <>
                                <td>
                                  {optionalSubjects.length > 0 ? (
                                    <div className="promotion-subject-picker">
                                      {optionalSubjects.map((subject) => (
                                        <label key={subject} className={selection.includes(subject) ? "is-selected" : ""}>
                                          <input
                                            type="checkbox"
                                            checked={selection.includes(subject)}
                                            onChange={() => toggleRetainedSubject(learner.id, subject)}
                                          />
                                          <span>{subject}</span>
                                        </label>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="promotion-selection-warning">No optional subjects registered</span>
                                  )}
                                </td>
                                <td>
                                  <span className="promotion-dropped-subjects">
                                    {droppedSubjects.length > 0 ? droppedSubjects.join(", ") : "None"}
                                  </span>
                                </td>
                              </>
                            ) : (
                              <td>{learner.promotionType}</td>
                            )}
                          </tr>
                        );
                      })}
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
          <div className="promotion-secondary-filters">
            <label className="promotion-field">
              <span>Academic year</span>
              <input
                className="promotion-control"
                type="text"
                inputMode="numeric"
                placeholder="All years"
                value={historyYear}
                onChange={(e) => setHistoryYear(e.target.value)}
              />
            </label>
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
            <select className="promotion-control promotion-select promotion-limit-select" aria-label="Promotion history rows per page" value={historyLimit} onChange={(e) => { setHistoryLimit(Number(e.target.value)); setHistoryPage(1); }}>
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
          <div className="promotion-secondary-filters">
            <label className="promotion-field">
              <span>Find learner</span>
              <input
                className="promotion-control"
                type="search"
                placeholder="Search by name or ID"
                value={graduatedSearch}
                onChange={(e) => setGraduatedSearch(e.target.value)}
              />
            </label>
            <label className="promotion-field">
              <span>Academic year</span>
              <input
                className="promotion-control"
                type="text"
                inputMode="numeric"
                placeholder="All years"
                value={graduatedYear}
                onChange={(e) => setGraduatedYear(e.target.value)}
              />
            </label>
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
            <select className="promotion-control promotion-select promotion-limit-select" aria-label="Graduated learner rows per page" value={graduatedLimit} onChange={(e) => { setGraduatedLimit(Number(e.target.value)); setGraduatedPage(1); }}>
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
