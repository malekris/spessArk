import React, { useEffect, useState } from "react";
import { plainFetch, adminFetch } from "../../../lib/api";
import { useNavigate } from "react-router-dom";
import useIdleLogout from "../../../hooks/useIdleLogout";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import "../../../pages/AdminDashboard.css";
import "./ALevelAdminTheme.css";

export default function ALevelAssignSubjects() {
  const navigate = useNavigate();
  const IDLE_20_MIN = 20 * 60 * 1000;

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
  const [createdAssignmentNotice, setCreatedAssignmentNotice] = useState(null);

  /* ======================================================
     2. DERIVED DATA
  ====================================================== */
  const filteredAssignments = assignments.filter((a) => {
    if (printStream && a.stream !== printStream) return false;
    return true;
  });

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

  /* ======================================================
     3. LOAD DATA
  ====================================================== */
  useEffect(() => {
    loadAll();
  }, []);

  useIdleLogout(() => {
    localStorage.removeItem("SPESS_ADMIN_KEY");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("adminToken");
    sessionStorage.removeItem("isAdmin");
    navigate("/ark", { replace: true });
  }, IDLE_20_MIN);

  async function loadAll() {
    setLoading(true);
    setError("");

    try {
      const [subs, tchs, assigns] = await Promise.all([
        plainFetch("/api/alevel/subjects"),
        plainFetch("/api/teachers"),
        adminFetch("/api/alevel/admin/assignments"),
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

      await adminFetch("/api/alevel/admin/assignments", {
        method: "POST",
        body: {
          teacherId: form.teacherId,
          subjectId: form.subject,
          stream: form.stream,
          paperLabel: form.paperLabel,
        },
      });

      setSuccess("");
      setCreatedAssignmentNotice({
        teacher: teacherLabel,
        subject: subjectLabel,
        stream: form.stream,
        paperLabel: form.paperLabel || "Single",
      });
      setForm({ teacherId: "", subject: "", stream: "", paperLabel: "" });
      loadAll();
    } catch (err) {
      setError(err?.message || "Failed to assign subject");
    }
  }

  /* ======================================================
     6. DELETE ASSIGNMENT
  ====================================================== */
  async function deleteAssignment() {
    if (!assignmentPendingDelete?.id) return;
    try {
      setDeleteSaving(true);
      await adminFetch(`/api/alevel/admin/assignments/${assignmentPendingDelete.id}`, {
        method: "DELETE",
      });
      setAssignments((p) => p.filter((a) => a.id !== assignmentPendingDelete.id));
      setSuccess("Assignment deleted successfully");
      setError("");
      setAssignmentPendingDelete(null);
    } catch (err) {
      setError(err?.message || "Delete failed");
    } finally {
      setDeleteSaving(false);
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
  

  /* ======================================================
     8. RENDER
  ====================================================== */
  return (
    <div className="admin-root alevel-admin-root">
      <main className="admin-main alevel-admin-main">
      <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel")}>
        ← Back to A-Level Dashboard
      </button>

      <h1 style={{ marginTop: "1rem" }}>Assign Subjects (A-Level)</h1>

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
              Assign Subject
            </button>
          </div>
        </form>
      </div>

      {/* ===========================
          ASSIGNMENTS TABLE
      ============================ */}
      <div className="panel-card" style={{ marginTop: "1.5rem" }}>
        <div className="alevel-assign-toolbar">
          <h3>Existing Assignments</h3>

          <div className="alevel-assign-toolbar-actions">
            <select className="alevel-assign-select alevel-assign-select-compact" value={printStream} onChange={(e) => setPrintStream(e.target.value)}>
              <option value="">All Streams</option>
              <option>S5 Arts</option>
              <option>S5 Sciences</option>
              <option>S6 Arts</option>
              <option>S6 Sciences</option>
            </select>

            <button className="primary-btn" onClick={exportPDF}>
              Export PDF
            </button>
          </div>
        </div>

        {loading ? (
          <p className="muted-text">Loading…</p>
        ) : filteredAssignments.length === 0 ? (
          <p className="muted-text">No assignments yet</p>
        ) : (
          <div className="teachers-table-wrapper">
            <table className="teachers-table">
              <thead>
                <tr>
                  <th>Stream</th>
                  <th>Subject</th>
                  <th>Paper</th>
                  <th>Teacher</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredAssignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.stream || "—"}</td>
                    <td>{a.subject}</td>
                    <td>{a.paper_label || "Single"}</td>
                    <td>{a.teacher_name}</td>
                    <td>
                      <button className="danger-link" onClick={() => setAssignmentPendingDelete(a)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {assignmentPendingDelete && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: "560px" }}>
            <h2>Delete Assignment</h2>
            <p style={{ marginTop: "-0.15rem", marginBottom: "1rem", color: "#475569", lineHeight: 1.6 }}>
              You are about to remove this A-Level assignment from the system.
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
            </div>

            <div
              className="panel-alert"
              style={{
                marginBottom: "1rem",
                background: "rgba(239, 68, 68, 0.10)",
                border: "1px solid rgba(239, 68, 68, 0.28)",
                color: "#991b1b",
                lineHeight: 1.65,
              }}
            >
              Deleting this assignment will also remove the captured marks attached to it. This action should only be used when you are sure.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", flexWrap: "wrap" }}>
              <button
                className="ghost-btn"
                disabled={deleteSaving}
                onClick={() => setAssignmentPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                disabled={deleteSaving}
                onClick={deleteAssignment}
                style={{ background: "#b91c1c", borderColor: "#b91c1c" }}
              >
                {deleteSaving ? "Deleting…" : "Delete Assignment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {createdAssignmentNotice && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: "580px" }}>
            <h2>Assignment Created</h2>
            <p style={{ marginTop: "-0.15rem", marginBottom: "1rem", color: "#475569", lineHeight: 1.6 }}>
              The A-Level assignment has been created successfully and is now ready for teacher use.
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
              Teachers assigned to this paper can now see it in their dashboard and begin capturing marks.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="primary-btn" onClick={() => setCreatedAssignmentNotice(null)}>
                Great
              </button>
            </div>
          </div>
        </div>
      )}
      </main>
    </div>
  );
}
