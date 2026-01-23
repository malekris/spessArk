import React, { useEffect, useState } from "react";
import { plainFetch } from "../../../lib/api";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useNavigate } from "react-router-dom";

export default function ALevelAssignSubjects() {
  const navigate = useNavigate();

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
  });

  const [printStream, setPrintStream] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
    form.stream;

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
        plainFetch("/api/alevel/admin/assignments"),
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
    setForm((p) => ({ ...p, [field]: value }));
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
      await plainFetch("/api/alevel/admin/assignments", {
        method: "POST",
        body: {
          teacherId: form.teacherId,
          subjectId: form.subject,
          stream: form.stream,
        },
      });

      setSuccess("Assignment created successfully");
      setForm({ teacherId: "", subject: "", stream: "" });
      loadAll();
    } catch {
      setError("Failed to assign subject");
    }
  }

  /* ======================================================
     6. DELETE ASSIGNMENT
  ====================================================== */
  async function deleteAssignment(id) {
    if (!window.confirm("Delete this assignment?")) return;

    try {
      await plainFetch(`/api/alevel/admin/assignments/${id}`, {
        method: "DELETE",
      });
      setAssignments((p) => p.filter((a) => a.id !== id));
    } catch {
      alert("Delete failed");
    }
  }

  /* ======================================================
     7. PDF EXPORT
  ====================================================== */
  function exportPDF() {
    if (filteredAssignments.length === 0) {
      alert("No data to export");
      return;
    }

    const doc = new jsPDF("p", "mm", "a4");

    doc.setFont("times", "bold");
    doc.setFontSize(14);
    doc.text("A-Level Teacher Assignments", 105, 14, { align: "center" });

    doc.setFontSize(10);
    doc.setFont("times", "normal");
    doc.text(
      `Stream: ${printStream || "All"}`,
      105,
      20,
      { align: "center" }
    );

    autoTable(doc, {
      startY: 26,
      head: [["Stream", "Subject", "Teacher"]],
      body: filteredAssignments.map((a) => [
        a.stream || "—",
        a.subject || "—",
        a.teacher_name || "—",
      ]),
      styles: {
        font: "times",
        fontSize: 10,
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: 255,
      },
      theme: "grid",
    });

    const url = doc.output("bloburl");
    window.open(url, "_blank");
  }

  /* ======================================================
     8. RENDER
  ====================================================== */
  return (
    <div style={{ padding: "2rem", color: "#e5e7eb" }}>
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
          onSubmit={handleAssign}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "1rem",
          }}
        >
          <div>
            <label>Teacher</label>
            <select value={form.teacherId} onChange={(e) => update("teacherId", e.target.value)}>
              <option value="">Select teacher</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Subject</label>
            <select value={form.subject} onChange={(e) => update("subject", e.target.value)}>
              <option value="">Select subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Stream</label>
            <select value={form.stream} onChange={(e) => update("stream", e.target.value)}>
              <option value="">Select stream</option>
              <option>S5 Arts</option>
              <option>S5 Sciences</option>
              <option>S6 Arts</option>
              <option>S6 Sciences</option>
            </select>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
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
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h3>Existing Assignments</h3>

          <div style={{ display: "flex", gap: "0.6rem" }}>
            <select value={printStream} onChange={(e) => setPrintStream(e.target.value)}>
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
                  <th>Teacher</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredAssignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.stream || "—"}</td>
                    <td>{a.subject}</td>
                    <td>{a.teacher_name}</td>
                    <td>
                      <button className="danger-link" onClick={() => deleteAssignment(a.id)}>
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
    </div>
  );
}
