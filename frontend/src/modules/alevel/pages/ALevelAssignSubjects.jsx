import React, { useEffect, useState } from "react";
import { plainFetch } from "../../../lib/api";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useNavigate } from "react-router-dom";

export default function ALevelAssignSubjects() {
  const navigate = useNavigate();

  // Theme Constants
  const amethyst = "#a78bfa";
  const cinematicBlack = "#0a0c10";
  const glassBg = "rgba(30, 41, 59, 0.45)";
  const platinum = "#f1f5f9";

  const [loading, setLoading] = useState(false);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [assignments, setAssignments] = useState([]);

  const [form, setForm] = useState({ teacherId: "", subject: "", stream: "" });
  const [printStream, setPrintStream] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const filteredAssignments = assignments.filter((a) => !printStream || a.stream === printStream);
  const canAssign = form.teacherId && form.subject && form.stream;

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [subs, tchs, assigns] = await Promise.all([
        plainFetch("/api/alevel/subjects"),
        plainFetch("/api/teachers"),
        plainFetch("/api/alevel/admin/assignments"),
      ]);
      setSubjects(subs || []);
      setTeachers(tchs || []);
      setAssignments(assigns || []);
    } catch (err) { setError("Failed to load assign-subject resources"); }
    finally { setLoading(false); }
  }

  function update(field, value) {
    setForm((p) => ({ ...p, [field]: value }));
    setError("");
    setSuccess("");
  }

  async function handleAssign(e) {
    e.preventDefault();
    try {
      await plainFetch("/api/alevel/admin/assignments", {
        method: "POST",
        body: { teacherId: form.teacherId, subjectId: form.subject, stream: form.stream },
      });
      setSuccess("Assignment created successfully");
      setForm({ teacherId: "", subject: "", stream: "" });
      loadAll();
    } catch { setError("Failed to assign subject"); }
  }

  async function deleteAssignment(id) {
    if (!window.confirm("Delete this assignment?")) return;
    try {
      await plainFetch(`/api/alevel/admin/assignments/${id}`, { method: "DELETE" });
      setAssignments((p) => p.filter((a) => a.id !== id));
    } catch { alert("Delete failed"); }
  }

  function exportPDF() {
    if (filteredAssignments.length === 0) return;
  
    const doc = new jsPDF("p", "mm", "a4");
    const W = doc.internal.pageSize.getWidth();
  
    const school = "St. Phillip's Equatorial Secondary School";
    const title = "A-Level Teaching Assignments";
    const generated = new Date().toLocaleString();
  
    autoTable(doc, {
      startY: 50, // push table down to make space for header
  
      head: [["Stream", "Subject", "Teacher"]],
      body: filteredAssignments.map((a) => [
        a.stream,
        a.subject,
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
        doc.line(14, 40, W - 14, 40);
  
        // ===== FOOTER =====
        const pageCount = doc.internal.getNumberOfPages();
        const page = doc.internal.getCurrentPageInfo().pageNumber;
  
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(
          `Generated from SPESS ARK · Page ${page} of ${pageCount}`,
          W / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: "center" }
        );
  
        doc.setTextColor(0);
      },
    });
  
    window.open(doc.output("bloburl"), "_blank");
  }
  

  // Common Styles
  const inputStyle = {
    width: "100%",
    padding: "0.8rem",
    borderRadius: "10px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#fff",
    outline: "none",
    marginTop: "0.5rem"
  };

  const glassCard = {
    background: glassBg,
    backdropFilter: "blur(12px)",
    borderRadius: "20px",
    border: "1px solid rgba(255, 255, 255, 0.05)",
    padding: "2rem",
    marginBottom: "2rem"
  };

  return (
    <div style={{ minHeight: "100vh", background: cinematicBlack, color: platinum, padding: "2rem", fontFamily: "'Inter', sans-serif" }}>
      
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <button onClick={() => navigate("/ark/admin/alevel")} style={{ background: "none", border: "none", color: amethyst, cursor: "pointer", fontWeight: "700", fontSize: "0.8rem", letterSpacing: "0.1em" }}>
            ← BACK TO DASHBOARD
          </button>
          <h1 style={{ fontSize: "2.2rem", fontWeight: "900", margin: "0.5rem 0 0 0", letterSpacing: "-0.03em" }}>Subject Assignment</h1>
        </div>
        
        {success && <div style={{ background: "rgba(34, 197, 94, 0.1)", color: "#22c55e", padding: "0.8rem 1.5rem", borderRadius: "12px", border: "1px solid rgba(34, 197, 94, 0.2)", fontSize: "0.9rem" }}>{success}</div>}
        {error && <div style={{ background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", padding: "0.8rem 1.5rem", borderRadius: "12px", border: "1px solid rgba(239, 68, 68, 0.2)", fontSize: "0.9rem" }}>{error}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "2rem" }}>
        
        {/* ASSIGNMENT FORM */}
        <div style={glassCard}>
          <h2 style={{ fontSize: "0.8rem", color: amethyst, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "1.5rem" }}>Create Assignment</h2>
          <form onSubmit={handleAssign} style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: "700", opacity: 0.6 }}>TEACHER</label>
              <select style={inputStyle} value={form.teacherId} onChange={(e) => update("teacherId", e.target.value)}>
                <option value="">Select Personnel</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: "700", opacity: 0.6 }}>CURRICULUM SUBJECT</label>
              <select style={inputStyle} value={form.subject} onChange={(e) => update("subject", e.target.value)}>
                <option value="">Select Subject</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: "0.75rem", fontWeight: "700", opacity: 0.6 }}>CLASS STREAM</label>
              <select style={inputStyle} value={form.stream} onChange={(e) => update("stream", e.target.value)}>
                <option value="">Select Stream</option>
                <option>S5 Arts</option>
                <option>S5 Sciences</option>
                <option>S6 Arts</option>
                <option>S6 Sciences</option>
              </select>
            </div>

            <button 
              disabled={!canAssign}
              style={{
                marginTop: "1rem",
                padding: "1rem",
                borderRadius: "12px",
                background: canAssign ? amethyst : "rgba(255,255,255,0.05)",
                color: canAssign ? cinematicBlack : "#64748b",
                border: "none",
                fontWeight: "800",
                cursor: canAssign ? "pointer" : "not-allowed",
                transition: "0.3s"
              }}
            >
              CONFIRM ASSIGNMENT
            </button>
          </form>
        </div>

        {/* LIST SECTION */}
        <div style={glassCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "0.8rem", color: amethyst, letterSpacing: "0.15em", textTransform: "uppercase" }}>Current Registry</h2>
            
            <div style={{ display: "flex", gap: "10px" }}>
              <select 
                style={{ ...inputStyle, marginTop: 0, padding: "0.5rem", fontSize: "0.8rem", width: "auto" }}
                value={printStream} 
                onChange={(e) => setPrintStream(e.target.value)}
              >
                <option value="">All Streams</option>
                <option>S5 Arts</option><option>S5 Sciences</option>
                <option>S6 Arts</option><option>S6 Sciences</option>
              </select>
              <button 
                onClick={exportPDF}
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", padding: "0 1rem", borderRadius: "10px", fontSize: "0.8rem", cursor: "pointer" }}
              >
                EXPORT PDF
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", textAlign: "left" }}>
                  <th style={{ padding: "12px", fontSize: "0.7rem", color: amethyst }}>STREAM</th>
                  <th style={{ padding: "12px", fontSize: "0.7rem", color: amethyst }}>SUBJECT</th>
                  <th style={{ padding: "12px", fontSize: "0.7rem", color: amethyst }}>TEACHER</th>
                  <th style={{ padding: "12px" }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredAssignments.map((a) => (
                  <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)", transition: "0.2s" }} onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.02)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "15px 12px", fontSize: "0.9rem", fontWeight: "600" }}>{a.stream}</td>
                    <td style={{ padding: "15px 12px", fontSize: "0.9rem", opacity: 0.8 }}>{a.subject}</td>
                    <td style={{ padding: "15px 12px", fontSize: "0.9rem", opacity: 0.8 }}>{a.teacher_name}</td>
                    <td style={{ padding: "15px 12px", textAlign: "right" }}>
                      <button onClick={() => deleteAssignment(a.id)} style={{ background: "none", border: "none", color: "#ef4444", fontSize: "0.75rem", fontWeight: "700", cursor: "pointer" }}>
                        REVOKE
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredAssignments.length === 0 && (
              <div style={{ padding: "4rem", textAlign: "center", opacity: 0.3 }}>No allocations found for this filter.</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}