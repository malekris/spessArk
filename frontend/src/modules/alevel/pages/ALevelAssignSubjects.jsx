import React, { useEffect, useMemo, useState } from "react";
import { plainFetch, adminFetch } from "../../../lib/api";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import ALevelAdminShell from "../components/ALevelAdminShell";
import {
  clearAdminReauthToken,
  storeAdminReauthToken,
} from "../../../utils/adminSecurity";
import "../../../pages/AdminDashboard.css";
import "./ALevelAdminTheme.css";

export default function ALevelAssignSubjects() {
  const normalizeFilterValue = (value) => String(value || "").trim().toLowerCase();
  const formatDateTime = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  };

  /* ======================================================
     1. STATE
  ====================================================== */
  const [loading, setLoading] = useState(false);

  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [assignments, setAssignments] = useState([]);

  const [form, setForm] = useState({
    teacherId: "",
    subject: "",
    stream: "",
    paperLabel: "",
  });

  const [printStream, setPrintStream] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [assignmentPendingDelete, setAssignmentPendingDelete] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [createdAssignmentNotice, setCreatedAssignmentNotice] = useState(null);
  const [assignmentPendingReplace, setAssignmentPendingReplace] = useState(null);
  const [replaceSaving, setReplaceSaving] = useState(false);
  const [replacePassword, setReplacePassword] = useState("");
  const [replaceReason, setReplaceReason] = useState("");
  const [replaceError, setReplaceError] = useState("");

  /* ======================================================
     2. DERIVED DATA
  ====================================================== */
  const isActiveAssignment = (assignment) =>
    String(assignment?.assignment_status || "active").toLowerCase() === "active" &&
    !assignment?.ended_at;
  const getAssignmentMarksCount = (assignment) => Number(assignment?.marks_count || 0);
  const assignmentHasMarks = (assignment) => getAssignmentMarksCount(assignment) > 0;
  const getTeacherLabel = (assignment) => assignment?.teacher_name || assignment?.teacher_id || "—";
  const getReplacementAssignment = (assignment) =>
    assignments.find((row) => String(row?.id) === String(assignment?.replaced_by_assignment_id || ""));
  const getReplacementTeacherLabel = (assignment) => {
    if (!assignment?.replaced_by_assignment_id) return "—";
    if (assignment?.replacement_teacher_name || assignment?.replacement_teacher_id) {
      return assignment.replacement_teacher_name || assignment.replacement_teacher_id;
    }
    return getTeacherLabel(getReplacementAssignment(assignment));
  };

  const activeAssignments = assignments.filter(isActiveAssignment);
  const historicalAssignments = assignments.filter((assignment) => !isActiveAssignment(assignment));

  const filteredAssignments = activeAssignments.filter((a) => {
    if (printStream && a.stream !== printStream) return false;
    return true;
  });

  const availablePrintStreams = Array.from(
    new Map(
      activeAssignments
        .map((a) => String(a?.stream || "").trim())
        .filter(Boolean)
        .map((stream) => [normalizeFilterValue(stream), stream])
    ).values()
  );

  const canAssign =
    form.teacherId &&
    form.subject &&
    form.stream &&
    form.paperLabel;

  const selectedSubject = subjects.find((s) => String(s.id) === String(form.subject));
  const paperOptions = Array.isArray(selectedSubject?.paper_options) && selectedSubject.paper_options.length > 0
    ? selectedSubject.paper_options
    : ["Single"];
  const isSinglePaperOnly = paperOptions.length === 1;
  const selectedSubjectName = String(selectedSubject?.name || "").trim();
  const resolvedFormPaperLabel = String(form.paperLabel || paperOptions[0] || "Single").trim() || "Single";

  const existingAssignmentConflict = useMemo(() => {
    if (!selectedSubjectName || !form.stream || !resolvedFormPaperLabel) return null;

    return (
      activeAssignments.find((assignment) => {
        const assignmentSubject = String(assignment.subject || "").trim().toLowerCase();
        const assignmentStream = String(assignment.stream || "").trim().toLowerCase();
        const assignmentPaper = String(assignment.paper_label || "Single").trim().toLowerCase();

        return (
          assignmentSubject === selectedSubjectName.toLowerCase() &&
          assignmentStream === String(form.stream || "").trim().toLowerCase() &&
          assignmentPaper === resolvedFormPaperLabel.toLowerCase()
        );
      }) || null
    );
  }, [activeAssignments, form.stream, resolvedFormPaperLabel, selectedSubjectName]);

  const openAssignmentRemovalModal = (assignment) => {
    const hasMarks = assignmentHasMarks(assignment);
    setAssignmentPendingDelete(assignment);
    setDeletePassword("");
    setDeleteReason(
      hasMarks
        ? `Ended ${assignment.subject || "A-Level paper"} ${assignment.paper_label || "Single"} in ${assignment.stream || ""}`
        : `Deleted mistaken empty A-Level assignment for ${assignment.subject || "paper"} in ${assignment.stream || ""}`
    );
    setDeleteError("");
  };

  /* ======================================================
     3. LOAD DATA
  ====================================================== */
  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError("");

    try {
      const [subs, tchs, assigns] = await Promise.all([
        plainFetch("/api/alevel/subjects"),
        plainFetch("/api/teachers"),
        adminFetch("/api/alevel/admin/assignments?includeInactive=1"),
      ]);

      setSubjects(subs || []);
      setTeachers(tchs || []);
      setAssignments(assigns || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load assign-subject resources");
    } finally {
      setLoading(false);
    }
  }

  /* ======================================================
     4. FORM HELPERS
  ====================================================== */
  function update(field, value) {
    setForm((p) => {
      if (field !== "subject") return { ...p, [field]: value };

      const nextSubject = subjects.find((s) => String(s.id) === String(value));
      const nextPapers =
        Array.isArray(nextSubject?.paper_options) && nextSubject.paper_options.length > 0
          ? nextSubject.paper_options
          : [""];

      return {
        ...p,
        subject: value,
        paperLabel: nextPapers[0] || "",
      };
    });
    setError("");
    setSuccess("");
  }

  /* ======================================================
     5. CREATE ASSIGNMENT
  ====================================================== */
  async function createAssignment(payload, meta, replacement = null) {
    const body = replacement
      ? {
          ...payload,
          replaceAssignmentId: replacement.assignment.id,
          replaceReason: replacement.reason || "A-Level teacher handover",
        }
      : payload;

    await adminFetch("/api/alevel/admin/assignments", {
      method: "POST",
      body,
    });

    const assigns = await adminFetch("/api/alevel/admin/assignments?includeInactive=1").catch(() => []);
    setAssignments(assigns || []);
    setSuccess("");
    setCreatedAssignmentNotice({
      ...meta,
      replacedTeacher: replacement?.assignment?.teacher_name || "",
      handover: Boolean(replacement),
      createdAt: new Date().toLocaleString(),
    });
    setForm({ teacherId: "", subject: "", stream: "", paperLabel: "" });
  }

  async function handleAssign(e) {
    e.preventDefault();

    if (!canAssign) {
      setError("Please select teacher, subject and stream");
      return;
    }

    try {
      const teacherLabel =
        teachers.find((teacher) => String(teacher.id) === String(form.teacherId))?.name || "Selected teacher";
      const subjectLabel =
        subjects.find((subject) => String(subject.id) === String(form.subject))?.name || "Selected subject";
      const payload = {
        teacherId: form.teacherId,
        subjectId: form.subject,
        stream: form.stream,
        paperLabel: resolvedFormPaperLabel,
      };
      const meta = {
        teacher: teacherLabel,
        subject: subjectLabel,
        stream: form.stream,
        paperLabel: resolvedFormPaperLabel,
      };

      if (existingAssignmentConflict) {
        if (String(existingAssignmentConflict.teacher_id) === String(form.teacherId)) {
          setError(`${teacherLabel} already owns ${subjectLabel} ${resolvedFormPaperLabel} in ${form.stream}.`);
          return;
        }

        setAssignmentPendingReplace({
          assignment: existingAssignmentConflict,
          payload,
          meta,
        });
        setReplaceReason(`A-Level teacher handover for ${subjectLabel} ${resolvedFormPaperLabel} in ${form.stream}`);
        setReplacePassword("");
        setReplaceError("");
        setError("");
        return;
      }

      await createAssignment(payload, meta);
    } catch (err) {
      setError(err?.message || "Failed to assign subject");
    }
  }

  /* ======================================================
     6. DELETE ASSIGNMENT
  ====================================================== */
  async function deleteAssignment() {
    if (!assignmentPendingDelete?.id) return;
    const hasMarks = assignmentHasMarks(assignmentPendingDelete);
    const actionLabel = hasMarks ? "end" : "delete";
    try {
      setDeleteSaving(true);
      setDeleteError("");
      clearAdminReauthToken();

      if (!deletePassword.trim()) {
        setDeleteError(`Enter your admin password before you ${actionLabel} this assignment.`);
        return;
      }

      const reauth = await adminFetch("/api/admin/reauth", {
        method: "POST",
        body: { password: deletePassword },
      });
      storeAdminReauthToken(reauth?.token, reauth?.expiresAt);

      const result = await adminFetch(`/api/alevel/admin/assignments/${assignmentPendingDelete.id}`, {
        method: "DELETE",
        body: {
          reason: deleteReason || (hasMarks
            ? "Ended by admin from A-Level Assign Subjects"
            : "Deleted empty mistaken A-Level assignment"),
        },
      });
      const assigns = await adminFetch("/api/alevel/admin/assignments?includeInactive=1").catch(() => []);
      setAssignments(assigns || []);
      setSuccess(
        result?.message ||
          (hasMarks
            ? "A-Level assignment ended safely."
            : "Empty A-Level assignment deleted successfully.")
      );
      setError("");
      setAssignmentPendingDelete(null);
      setDeletePassword("");
      setDeleteReason("");
      setDeleteError("");
      clearAdminReauthToken();
    } catch (err) {
      if (err?.code === "ADMIN_REAUTH_REQUIRED") {
        clearAdminReauthToken();
        setDeleteError(`Admin password confirmation expired. Enter your password again to ${actionLabel} this assignment.`);
      } else {
        setDeleteError(err?.message || `Failed to ${actionLabel} assignment`);
      }
    } finally {
      setDeleteSaving(false);
    }
  }

  async function confirmReplaceAssignment() {
    if (!assignmentPendingReplace?.assignment?.id) return;
    try {
      setReplaceSaving(true);
      setReplaceError("");
      setError("");
      setSuccess("");
      clearAdminReauthToken();

      if (!replacePassword.trim()) {
        setReplaceError("Enter your admin password before replacing this teacher.");
        return;
      }

      const reauth = await adminFetch("/api/admin/reauth", {
        method: "POST",
        body: { password: replacePassword },
      });
      storeAdminReauthToken(reauth?.token, reauth?.expiresAt);

      await createAssignment(
        assignmentPendingReplace.payload,
        assignmentPendingReplace.meta,
        {
          assignment: assignmentPendingReplace.assignment,
          reason: replaceReason || "A-Level teacher handover",
        }
      );

      setSuccess("A-Level teacher replaced. Previous marks were retained for reports and follow-up.");
      setAssignmentPendingReplace(null);
      setReplacePassword("");
      setReplaceReason("");
      setReplaceError("");
      clearAdminReauthToken();
    } catch (err) {
      if (err?.code === "ADMIN_REAUTH_REQUIRED") {
        clearAdminReauthToken();
        setReplaceError("Admin password confirmation expired. Enter your password again to replace this teacher.");
      } else {
        setReplaceError(err?.message || "Failed to replace teacher for this A-Level assignment.");
      }
    } finally {
      setReplaceSaving(false);
    }
  }

  /* ======================================================
     7. PDF EXPORT
  ====================================================== */
  async function exportPDF() {
    if (filteredAssignments.length === 0) return;
    const { jsPDF, autoTable } = await loadPdfTools();
  
    const doc = new jsPDF("p", "mm", "a4");
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
  
    const school = "St. Phillip's Equatorial Secondary School";
    const title = "A-Level Teaching Assignments";
    const generated = new Date().toLocaleString();
    const HEADER_BOTTOM_Y = 40;
    const TABLE_START_Y = 50;
  
    autoTable(doc, {
      startY: TABLE_START_Y,
      margin: { top: TABLE_START_Y, left: 14, right: 14, bottom: 16 },

      head: [["Stream", "Subject", "Paper", "Teacher"]],
      body: filteredAssignments.map((a) => [
        a.stream,
        a.subject,
        a.paper_label || "Single",
        a.teacher_name,
      ]),
  
      headStyles: {
        fillColor: [15, 23, 42], // dark header
        textColor: 255,
        fontStyle: "bold",
      },
  
      styles: {
        fontSize: 9,
      },
  
      didDrawPage: function () {
        // ===== HEADER =====
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text(school, W / 2, 18, { align: "center" });
  
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.text(title, W / 2, 26, { align: "center" });
  
        doc.setFontSize(9);
        doc.text(`Generated: ${generated}`, 14, 36);
  
        // Divider line
        doc.setDrawColor(200);
        doc.line(14, HEADER_BOTTOM_Y, W - 14, HEADER_BOTTOM_Y);
  
        // ===== FOOTER =====
        const pageCount = doc.internal.getNumberOfPages();
        const page = doc.internal.getCurrentPageInfo().pageNumber;
  
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(
          `Generated from SPESS ARK · Page ${page} of ${pageCount}`,
          W / 2,
          H - 10,
          { align: "center" }
        );
  
        doc.setTextColor(0);
      },
    });
  
    window.open(doc.output("bloburl"), "_blank");
  }
  
  const pendingDeleteHasMarks = assignmentHasMarks(assignmentPendingDelete);
  const pendingDeleteMarksCount = getAssignmentMarksCount(assignmentPendingDelete);
  const pendingDeleteModeLabel = pendingDeleteHasMarks ? "End" : "Delete";
  const pendingDeleteProgressLabel = pendingDeleteHasMarks ? "Ending…" : "Deleting…";

  /* ======================================================
     8. RENDER
  ====================================================== */
  return (
    <ALevelAdminShell
      title="Assign Subjects"
      subtitle="Control A-Level stream assignments, paper ownership, and teaching coverage from one shared panel."
    >
      <>
      {error && <div className="panel-alert panel-alert-error">{error}</div>}
      {success && <div className="panel-alert panel-alert-success">{success}</div>}

      {/* ===========================
          ASSIGN FORM
      ============================ */}
      <div className="panel-card" style={{ marginTop: "1rem" }}>
        <form
          className="alevel-assign-form"
          onSubmit={handleAssign}
        >
          <div className="alevel-assign-field">
            <label className="alevel-assign-label">Teacher</label>
            <select className="alevel-assign-select" value={form.teacherId} onChange={(e) => update("teacherId", e.target.value)}>
              <option value="">Select teacher</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="alevel-assign-field">
            <label className="alevel-assign-label">Subject</label>
            <select className="alevel-assign-select" value={form.subject} onChange={(e) => update("subject", e.target.value)}>
              <option value="">Select subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="alevel-assign-field">
            <label className="alevel-assign-label">Stream</label>
            <select className="alevel-assign-select" value={form.stream} onChange={(e) => update("stream", e.target.value)}>
              <option value="">Select stream</option>
              <option>S5 Arts</option>
              <option>S5 Sciences</option>
              <option>S6 Arts</option>
              <option>S6 Sciences</option>
            </select>
          </div>

          <div className="alevel-assign-field">
            <label className="alevel-assign-label">Paper</label>
            <select
              className="alevel-assign-select"
              value={form.paperLabel}
              onChange={(e) => update("paperLabel", e.target.value)}
              disabled={!form.subject || isSinglePaperOnly}
            >
              {!form.subject && <option value="">Select subject first</option>}
              {paperOptions.map((paper) => (
                <option key={paper} value={paper}>
                  {paper}
                </option>
              ))}
            </select>
            {selectedSubject && (
              <div className="muted-text alevel-assign-help">
                {isSinglePaperOnly ? "Single-paper subject" : "Most A-Level subjects have two papers."}
              </div>
            )}
          </div>

          <div className="alevel-assign-action">
            <button className="primary-btn" disabled={!canAssign}>
              {existingAssignmentConflict ? "Replace Teacher" : "Assign Subject"}
            </button>
          </div>
        </form>

        {existingAssignmentConflict && (
          <div
            className="panel-alert panel-alert-error"
            style={{ marginTop: "0.9rem", marginBottom: 0 }}
          >
            {existingAssignmentConflict.subject_display || `${selectedSubjectName} — ${resolvedFormPaperLabel}`} is already assigned to{" "}
            <strong>{existingAssignmentConflict.teacher_name || "another teacher"}</strong> in{" "}
            <strong>{existingAssignmentConflict.stream || form.stream}</strong>. Choose a different teacher and submit to hand over safely.
          </div>
        )}
      </div>

      {/* ===========================
          ASSIGNMENTS TABLE
      ============================ */}
      <div className="panel-card" style={{ marginTop: "1.5rem" }}>
        <div className="alevel-assign-toolbar">
          <h3>Active Assignments</h3>

          <div className="alevel-assign-toolbar-actions">
            <select className="alevel-assign-select alevel-assign-select-compact" value={printStream} onChange={(e) => setPrintStream(e.target.value)}>
              <option value="">All Streams</option>
              {availablePrintStreams.length > 0 ? (
                availablePrintStreams.map((stream) => (
                  <option key={stream} value={stream}>{stream}</option>
                ))
              ) : (
                <>
                  <option>S5 Arts</option>
                  <option>S5 Sciences</option>
                  <option>S6 Arts</option>
                  <option>S6 Sciences</option>
                </>
              )}
            </select>

            <button className="primary-btn" onClick={exportPDF}>
              Export PDF
            </button>
          </div>
        </div>

        {loading ? (
          <p className="muted-text">Loading…</p>
        ) : filteredAssignments.length === 0 ? (
          <p className="muted-text">No active assignments for this view.</p>
        ) : (
          <div className="teachers-table-wrapper">
            <table className="teachers-table">
              <thead>
                <tr>
                  <th>Stream</th>
                  <th>Subject</th>
                  <th>Paper</th>
                  <th>Teacher</th>
                  <th>Added</th>
                  <th>Marks</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredAssignments.map((a) => {
                  const marksCount = getAssignmentMarksCount(a);
                  const hasMarks = marksCount > 0;
                  return (
                    <tr key={a.id}>
                      <td>{a.stream || "—"}</td>
                      <td>{a.subject}</td>
                      <td>{a.paper_label || "Single"}</td>
                      <td>{getTeacherLabel(a)}</td>
                      <td>{formatDateTime(a.created_at)}</td>
                      <td>{marksCount}</td>
                      <td>
                        <button
                          type="button"
                          className="ghost-btn"
                          style={{ marginRight: "0.5rem", padding: "0.3rem 0.55rem" }}
                          onClick={() => {
                            setForm({
                              teacherId: "",
                              subject: String(a.subject_id || subjects.find(
                                (subject) => normalizeFilterValue(subject.name) === normalizeFilterValue(a.subject)
                              )?.id || ""),
                              stream: a.stream || "",
                              paperLabel: a.paper_label || "Single",
                            });
                            setError("Choose the replacement teacher, then submit to hand over this A-Level paper safely.");
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          Replace
                        </button>
                        <button
                          className="danger-link"
                          title={
                            hasMarks
                              ? "Marks exist, so this assignment will be ended and kept in history."
                              : "No marks exist, so this assignment can be deleted completely."
                          }
                          onClick={() => openAssignmentRemovalModal(a)}
                        >
                          {hasMarks ? "End" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {historicalAssignments.length > 0 && (
          <details style={{ marginTop: "1rem" }} open={activeAssignments.length === 0}>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>
              Assignment history ({historicalAssignments.length})
            </summary>
            <div className="teachers-table-wrapper" style={{ marginTop: 12 }}>
              <table className="teachers-table">
                <thead>
                  <tr>
                    <th>Stream</th>
                    <th>Subject</th>
                    <th>Paper</th>
                    <th>Removed Teacher</th>
                    <th>Added Teacher</th>
                    <th>Ended</th>
                    <th>Reason</th>
                    <th>Marks</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {historicalAssignments.map((a) => (
                    <tr key={`history-${a.id}`}>
                      <td>{a.stream || "—"}</td>
                      <td>{a.subject || "—"}</td>
                      <td>{a.paper_label || "Single"}</td>
                      <td>{getTeacherLabel(a)}</td>
                      <td>{getReplacementTeacherLabel(a)}</td>
                      <td>{formatDateTime(a.ended_at)}</td>
                      <td>{a.ended_reason || "—"}</td>
                      <td>{getAssignmentMarksCount(a)}</td>
                      <td>
                        {!assignmentHasMarks(a) ? (
                          <button type="button" className="danger-link" onClick={() => openAssignmentRemovalModal(a)}>
                            Delete
                          </button>
                        ) : (
                          <span className="muted-text">Retained</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>

      {assignmentPendingDelete && (
        <div className="modal-backdrop" onClick={() => !deleteSaving && setAssignmentPendingDelete(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "560px" }}>
            <h2>{pendingDeleteModeLabel} Assignment</h2>
            <p style={{ marginTop: "-0.15rem", marginBottom: "1rem", color: "#475569", lineHeight: 1.6 }}>
              {pendingDeleteHasMarks
                ? "This ends the teacher's active access to this A-Level paper. Existing marks stay available for reports, downloads, and handover history."
                : "This assignment has no marks, so it can be deleted completely and will cease to exist in the system."}
            </p>

            <div
              style={{
                border: "1px solid rgba(148, 163, 184, 0.22)",
                background: "rgba(248, 250, 252, 0.95)",
                borderRadius: "16px",
                padding: "1rem",
                marginBottom: "1rem",
                color: "#0f172a",
                lineHeight: 1.7,
              }}
            >
              <div><strong>Stream:</strong> {assignmentPendingDelete.stream || "—"}</div>
              <div><strong>Subject:</strong> {assignmentPendingDelete.subject || "—"}</div>
              <div><strong>Paper:</strong> {assignmentPendingDelete.paper_label || "Single"}</div>
              <div><strong>Teacher:</strong> {assignmentPendingDelete.teacher_name || "—"}</div>
              <div><strong>Marks:</strong> {pendingDeleteMarksCount}</div>
            </div>

            <div
              className="panel-alert"
              style={{
                marginBottom: "1rem",
                background: pendingDeleteHasMarks ? "rgba(14, 165, 233, 0.10)" : "rgba(239, 68, 68, 0.10)",
                border: pendingDeleteHasMarks ? "1px solid rgba(14, 165, 233, 0.28)" : "1px solid rgba(239, 68, 68, 0.28)",
                color: pendingDeleteHasMarks ? "#075985" : "#991b1b",
                lineHeight: 1.65,
              }}
            >
              {pendingDeleteHasMarks
                ? "Marks already exist, so SPESS ARK will end this assignment and retain its records."
                : "No learner marks are attached. Deleting removes only this assignment row; no marks will be deleted."}
            </div>

            <div className="form-row" style={{ marginBottom: "1rem" }}>
              <label>Reason</label>
              <input
                type="text"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder={pendingDeleteHasMarks ? "Example: Teacher left mid-term; handover completed" : "Example: Wrong teacher selected by mistake"}
              />
            </div>

            <div className="form-row" style={{ marginBottom: "1rem" }}>
              <label>Admin Password</label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Re-enter admin password"
              />
            </div>

            {deleteError && (
              <div className="panel-alert panel-alert-error" style={{ marginBottom: "1rem" }}>
                {deleteError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", flexWrap: "wrap" }}>
              <button
                className="ghost-btn"
                disabled={deleteSaving}
                onClick={() => {
                  setAssignmentPendingDelete(null);
                  setDeleteReason("");
                }}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                disabled={deleteSaving}
                onClick={deleteAssignment}
                style={{ background: "#b91c1c", borderColor: "#b91c1c" }}
              >
                {deleteSaving ? pendingDeleteProgressLabel : `${pendingDeleteModeLabel} Assignment`}
              </button>
            </div>
          </div>
        </div>
      )}

      {assignmentPendingReplace && (
        <div className="modal-backdrop" onClick={() => !replaceSaving && setAssignmentPendingReplace(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "620px" }}>
            <h2>Replace Teacher</h2>
            <p style={{ marginTop: "-0.15rem", marginBottom: "1rem", color: "#475569", lineHeight: 1.6 }}>
              This ends the current active A-Level assignment and creates a new one for the replacement teacher. Existing marks remain visible to the new teacher for follow-up.
            </p>

            <div
              style={{
                border: "1px solid rgba(148, 163, 184, 0.22)",
                background: "rgba(248, 250, 252, 0.95)",
                borderRadius: "16px",
                padding: "1rem",
                marginBottom: "1rem",
                color: "#0f172a",
                lineHeight: 1.7,
              }}
            >
              <div><strong>Stream:</strong> {assignmentPendingReplace.meta?.stream || "—"}</div>
              <div><strong>Subject:</strong> {assignmentPendingReplace.meta?.subject || "—"}</div>
              <div><strong>Paper:</strong> {assignmentPendingReplace.meta?.paperLabel || "Single"}</div>
              <div><strong>Current teacher:</strong> {assignmentPendingReplace.assignment?.teacher_name || assignmentPendingReplace.assignment?.teacher_id || "—"}</div>
              <div><strong>Replacement teacher:</strong> {assignmentPendingReplace.meta?.teacher || "—"}</div>
              <div><strong>Existing marks:</strong> {Number(assignmentPendingReplace.assignment?.marks_count || 0)}</div>
            </div>

            <div className="form-row" style={{ marginBottom: "1rem" }}>
              <label>Handover Reason</label>
              <input
                type="text"
                value={replaceReason}
                onChange={(e) => setReplaceReason(e.target.value)}
                placeholder="Example: Mid-term teacher handover"
              />
            </div>

            <div className="form-row" style={{ marginBottom: "1rem" }}>
              <label>Admin Password</label>
              <input
                type="password"
                value={replacePassword}
                onChange={(e) => setReplacePassword(e.target.value)}
                placeholder="Re-enter admin password"
              />
            </div>

            {replaceError && (
              <div className="panel-alert panel-alert-error" style={{ marginBottom: "1rem" }}>
                {replaceError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", flexWrap: "wrap" }}>
              <button
                className="ghost-btn"
                disabled={replaceSaving}
                onClick={() => {
                  setAssignmentPendingReplace(null);
                  setReplacePassword("");
                  setReplaceReason("");
                  setReplaceError("");
                }}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                disabled={replaceSaving}
                onClick={confirmReplaceAssignment}
              >
                {replaceSaving ? "Replacing…" : "Replace Teacher"}
              </button>
            </div>
          </div>
        </div>
      )}

      {createdAssignmentNotice && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: "580px" }}>
            <h2>{createdAssignmentNotice.handover ? "Teacher Replaced" : "Assignment Created"}</h2>
            <p style={{ marginTop: "-0.15rem", marginBottom: "1rem", color: "#475569", lineHeight: 1.6 }}>
              {createdAssignmentNotice.handover
                ? "The A-Level paper has been handed over. The replacement teacher can see prior marks for follow-up."
                : "The A-Level assignment has been created successfully and is now ready for teacher use."}
            </p>

            <div
              style={{
                border: "1px solid rgba(14, 116, 144, 0.18)",
                background: "linear-gradient(180deg, rgba(248, 250, 252, 0.98) 0%, rgba(241, 245, 249, 0.95) 100%)",
                borderRadius: "18px",
                padding: "1rem 1.05rem",
                marginBottom: "1rem",
                color: "#0f172a",
                boxShadow: "0 18px 36px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#0f766e", fontWeight: 800, marginBottom: "0.8rem" }}>
                SPESS ARK · A-Level Assignment
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.85rem 1rem" }}>
                <div>
                  <div style={{ fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#64748b", marginBottom: "0.25rem" }}>
                    Stream
                  </div>
                  <div style={{ fontWeight: 800 }}>{createdAssignmentNotice.stream}</div>
                </div>

                <div>
                  <div style={{ fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#64748b", marginBottom: "0.25rem" }}>
                    Teacher
                  </div>
                  <div style={{ fontWeight: 800 }}>{createdAssignmentNotice.teacher}</div>
                </div>

                <div>
                  <div style={{ fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#64748b", marginBottom: "0.25rem" }}>
                    Subject
                  </div>
                  <div style={{ fontWeight: 800 }}>{createdAssignmentNotice.subject}</div>
                </div>

                <div>
                  <div style={{ fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#64748b", marginBottom: "0.25rem" }}>
                    Paper
                  </div>
                  <div style={{ fontWeight: 800 }}>{createdAssignmentNotice.paperLabel}</div>
                </div>

                {createdAssignmentNotice.handover && (
                  <div>
                    <div style={{ fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#64748b", marginBottom: "0.25rem" }}>
                      Previous Teacher
                    </div>
                    <div style={{ fontWeight: 800 }}>{createdAssignmentNotice.replacedTeacher || "—"}</div>
                  </div>
                )}
              </div>
            </div>

            <div
              className="panel-alert"
              style={{
                marginBottom: "1rem",
                background: "rgba(16, 185, 129, 0.10)",
                border: "1px solid rgba(16, 185, 129, 0.22)",
                color: "#065f46",
                lineHeight: 1.65,
              }}
            >
              {createdAssignmentNotice.handover
                ? `Created ${createdAssignmentNotice.createdAt}. Prior marks stay retained under history and are visible through the new active paper assignment.`
                : "Teachers assigned to this paper can now see it in their dashboard and begin capturing marks."}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="primary-btn" onClick={() => setCreatedAssignmentNotice(null)}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
      </>
    </ALevelAdminShell>
  );
}
