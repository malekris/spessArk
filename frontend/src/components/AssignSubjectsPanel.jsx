// src/components/AssignSubjectsPanel.jsx
import React, { useEffect, useState } from "react";
import { plainFetch } from "../lib/api";
import { loadPdfTools } from "../utils/loadPdfTools";


// fallback master subjects
const FALLBACK_SUBJECTS = [
  "English","Mathematics","Physics","Biology","Chemistry","History","Geography",
  "ICT","Agriculture","Physical Education","Art","Luganda","Literature",
  "Christian Religious Education","Entrepreneurship","IRE","Kiswahili"
];

export default function AssignSubjectsPanel({ active }) {
  const formatDateTime = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  };

  // 1️⃣ ALL useState FIRST
  const [loading, setLoading] = useState(false);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [form, setForm] = useState({
    classId: "",
    subjectId: "",
    teacherId: "",
    stream: ""
  });
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // 🔹 PRINT FILTER STATE (MOVE UP)
  const [printClass, setPrintClass] = useState("");
  const [printStream, setPrintStream] = useState("");

  // 2️⃣ DERIVED DATA (NOW SAFE)
  const filteredAssignments = assignments.filter(a => {
    const classMatch = !printClass || a.class_level === printClass;
    const streamMatch = !printStream || a.stream === printStream;
    return classMatch && streamMatch;
  });

  // 3️⃣ EFFECTS
  useEffect(() => {
    if (!active) return;
    loadAll();
  }, [active]);

  // 4️⃣ FUNCTIONS
  async function loadAll() {
    setLoading(true);
    setError("");
    setSuccessMsg("");
    try {
      const [clsRes, subsRes, tchsRes, assignsRes] = await Promise.all([
        plainFetch("/api/classes").catch(() => []),
        plainFetch("/api/subjects").catch(() => []),
        plainFetch("/api/teachers").catch(() => []),
        plainFetch("/api/admin/assignments").catch(() => [])
      ]);
      


      // normalize classes
      const cls = (Array.isArray(clsRes) ? clsRes : []).map((c, i) => {
        if (!c) return null;
        if (typeof c === "string") return { id: c, name: c };
        if (c.id && c.name) return { id: c.id, name: c.name };
        if (c.class_level) return { id: c.class_level, name: c.class_level };
        if (c.name) return { id: c.name, name: c.name };
        return { id: `cls_${i}`, name: String(c) };
      }).filter(Boolean);

      let resolvedClasses = cls;
      if (resolvedClasses.length === 0 && Array.isArray(assignsRes) && assignsRes.length > 0) {
        const unique = Array.from(new Set(assignsRes.map(a => a.class_level).filter(Boolean)));
        resolvedClasses = unique.map((c) => ({ id: c, name: c }));
      }

      // normalize subjects
      const subs = (Array.isArray(subsRes) ? subsRes : []).map((s, i) => {
        if (!s) return null;
        if (typeof s === "string") return { id: s, name: s };
        if (s.id && s.name) return { id: s.id, name: s.name };
        if (s.subject) return { id: s.subject, name: s.subject };
        if (s.name) return { id: s.name, name: s.name };
        return { id: `sub_${i}`, name: String(s) };
      }).filter(Boolean);

      // merge fetched subjects with fallback, dedupe, keep fetched order
      const seen = new Set();
      const merged = [];
      subs.forEach(s => {
        const key = String(s.name).trim();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push({ id: s.id ?? key, name: key });
        }
      });
      const missingFallback = FALLBACK_SUBJECTS
        .map(s => String(s).trim())
        .filter(s => !seen.has(s))
        .sort((a, b) => a.localeCompare(b));
      missingFallback.forEach(name => {
        merged.push({ id: name, name });
        seen.add(name);
      });

      // normalize teachers
      const tchs = (Array.isArray(tchsRes) ? tchsRes : []).map((t) => {
        if (!t) return null;
        return { id: t.id, name: t.name || t.email || `Teacher ${t.id}` };
      }).filter(Boolean);
      tchs.sort((a, b) => a.name.localeCompare(b.name));

      const assigns = Array.isArray(assignsRes) ? assignsRes : [];

      setClasses(resolvedClasses);
      setSubjects(merged);
      setTeachers(tchs);
      setAssignments(assigns);
    } catch (err) {
      console.error("AssignSubjects loadAll error", err);
      setError("Failed to load resources for Assign Subjects. See console for details.");
      setClasses([]);
      setSubjects(FALLBACK_SUBJECTS.map(s => ({ id: s, name: s })));
      setTeachers([]);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }

  function onChange(field, value) {
    setForm((p) => ({ ...p, [field]: value }));
    setError("");
    setSuccessMsg("");
  }

  const canAssign = form.classId && form.subjectId && form.teacherId && form.stream;

  async function handleAssign(e) {
    e && e.preventDefault();
    if (!canAssign) {
      setError("Please select teacher, class, subject and stream.");
      return;
    }
    setError("");
    setSuccessMsg("");
    try {
      const classLabel = (classes.find(c => String(c.id) === String(form.classId)) || {}).name || String(form.classId);
      const subjectLabel = (subjects.find(s => String(s.id) === String(form.subjectId)) || {}).name || String(form.subjectId);
      const teacherId = Number(form.teacherId);
      const stream = form.stream;

      const payload = { class_level: classLabel, subject: subjectLabel, teacherId, stream };

      await plainFetch("/api/admin/assignments", { method: "POST", body: payload });

      const assigns = await plainFetch("/api/admin/assignments").catch(() => []);
      setAssignments(assigns || []);
      setSuccessMsg("Assignment created.");
      setForm({ classId: "", subjectId: "", teacherId: "", stream: "" });
    } catch (err) {
      console.error("assign error", err);
      setError(err?.message || "Failed to create assignment. Check server logs.");
    }
  }
  function handlePrintAssignments() {
    const printWindow = window.open("", "_blank", "width=900,height=650");
  
    const rows = assignments.map(a => `
      <tr>
        <td>${a.class_level || "—"}</td>
        <td>${a.stream || "—"}</td>
        <td>${a.subject || "—"}</td>
        <td>${a.teacher_name || a.teacher_id || "—"}</td>
      </tr>
    `).join("");
  
    printWindow.document.write(`
      <html>
        <head>
          <title>Teacher Assignments</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 20px;
            }
            h2 {
              text-align: center;
              margin-bottom: 20px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            th, td {
              border: 1px solid #333;
              padding: 8px;
              text-align: left;
            }
            th {
              background: #1e293b;
              color: #fff;
            }
          </style>
        </head>
        <body>
          <h2>Teacher Assignments</h2>
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th>Stream</th>
                <th>Subject</th>
                <th>Teacher</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </body>
      </html>
    `);
  
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }
  function formatPdfDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  }

  async function handleExportAssignmentsPDF() {
    if (filteredAssignments.length === 0) {
      alert("No assignments to export.");
      return;
    }
    const { jsPDF, autoTable } = await loadPdfTools();
    const doc = new jsPDF("p", "mm", "a4");
    const generatedAt = new Date().toLocaleString();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const filterLine = `Class: ${printClass || "All"}   •   Stream: ${printStream || "All"}   •   Records: ${filteredAssignments.length}`;

    const drawHeader = () => {
      // light header block for black/white printing
      doc.setFillColor(245, 245, 245);
      doc.rect(10, 8, pageWidth - 20, 22, "F");
      doc.setDrawColor(170, 170, 170);
      doc.rect(10, 8, pageWidth - 20, 22, "S");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(25, 25, 25);
      doc.text("St Phillips Equatorial Secondary School", pageWidth / 2, 16, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("SPESS ARK • Teacher Assignments Register", pageWidth / 2, 22, { align: "center" });

      doc.setTextColor(60, 60, 60);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Generated: ${generatedAt}`, 12, 36);
      doc.text(filterLine, pageWidth / 2, 42, { align: "center" });

      doc.setDrawColor(190, 190, 190);
      doc.line(10, 45, pageWidth - 10, 45);
    };

    const drawFooter = () => {
      doc.setDrawColor(190, 190, 190);
      doc.line(10, pageHeight - 12, pageWidth - 10, pageHeight - 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(80, 80, 80);
      doc.text(`Generated from SPESS ARK • ${generatedAt}`, pageWidth / 2, pageHeight - 7, { align: "center" });
    };

    drawHeader();
  
    autoTable(doc, {
      startY: 50,
      margin: { left: 10, right: 10, top: 50, bottom: 16 },
      head: [["No.", "Class", "Stream", "Subject", "Teacher", "Added"]],
      body: filteredAssignments.map((a, idx) => [
        String(idx + 1),
        a.class_level || "—",
        a.stream || "—",
        a.subject || "—",
        a.teacher_name || a.teacher_id || "—",
        formatPdfDate(a.created_at),
      ]),
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: { top: 2.6, right: 2.2, bottom: 2.6, left: 2.2 },
        textColor: [30, 30, 30],
        lineColor: [200, 200, 200],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [230, 230, 230],
        textColor: 25,
        fontStyle: "bold",
        halign: "center",
      },
      alternateRowStyles: {
        fillColor: [247, 247, 247],
      },
      columnStyles: {
        0: { cellWidth: 11, halign: "center" },
        1: { cellWidth: 24 },
        2: { cellWidth: 22 },
        3: { cellWidth: 41 },
        4: { cellWidth: 44 },
        5: { cellWidth: 42, halign: "center" },
      },
      theme: "grid",
      willDrawPage: () => {
        drawHeader();
      },
      didDrawPage: () => {
        drawFooter();
      },
    });

    // Preview in new tab (NOT auto-download)
    const blobUrl = doc.output("bloburl");
    window.open(blobUrl, "_blank");
  }

  async function deleteAssignment(id) {
    if (!window.confirm("Delete this assignment?")) return;
    setError("");
    try {
      await plainFetch(`/api/admin/assignments/${id}`, { method: "DELETE" });
      setAssignments((p) => p.filter(a => String(a.id) !== String(id)));
      setSuccessMsg("Assignment deleted.");
    } catch (err) {
      console.error("delete assignment", err);
      setError("Failed to delete assignment");
    }
  }

  return (
    <div className={`panel assign-subjects-panel ${active ? "active" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ marginTop: 0 }}>Assign Subjects</h3>
        <div>
          <button type="button" className="ghost-btn" onClick={loadAll} style={{ marginRight: 8 }}>Refresh lists</button>
        </div>
      </div>

      {error && <div className="panel-alert panel-alert-error" style={{ marginBottom: 8 }}>{error}</div>}
      {successMsg && <div className="panel-alert panel-alert-success" style={{ marginBottom: 8 }}>{successMsg}</div>}

      {loading ? (
        <div className="muted-text">Loading…</div>
      ) : (
        <>
          <form onSubmit={handleAssign} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, alignItems: "center", marginBottom: 18 }}>
            <div>
              <label htmlFor="assign-teacher" className="muted-text" style={{ display: "block", marginBottom: 6 }}>Teacher</label>
              <select id="assign-teacher" name="assign-teacher" autoComplete="off" value={form.teacherId} onChange={e => onChange("teacherId", e.target.value)}>
                <option value=''>Choose teacher</option>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {teachers.length === 0 && <div className="muted-text" style={{ marginTop: 6 }}>No teachers found. Add teachers in <strong>Manage Teachers</strong>.</div>}
            </div>

            <div>
              <label htmlFor="assign-class" className="muted-text" style={{ display: "block", marginBottom: 6 }}>Class</label>
              <select id="assign-class" name="assign-class" autoComplete="off" value={form.classId} onChange={e => onChange("classId", e.target.value)}>
                <option value=''>Choose class</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {classes.length === 0 && <div className="muted-text" style={{ marginTop: 6 }}>No classes found.</div>}
            </div>

            <div>
              <label htmlFor="assign-subject" className="muted-text" style={{ display: "block", marginBottom: 6 }}>Subject</label>
              <select id="assign-subject" name="assign-subject" autoComplete="off" value={form.subjectId} onChange={e => onChange("subjectId", e.target.value)}>
                <option value=''>Choose subject</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="assign-stream" className="muted-text" style={{ display: "block", marginBottom: 6 }}>Stream</label>
              <select id="assign-stream" name="assign-stream" autoComplete="off" value={form.stream} onChange={e => onChange("stream", e.target.value)}>
                <option value=''>Choose stream</option>
                <option value='North'>North</option>
                <option value='South'>South</option>
              </select>
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <button type="submit" className="primary-btn" disabled={!canAssign}>Assign</button>
            </div>
          </form>

          <div style={{ marginTop: 8 }}>
            <h4>Existing assignments</h4>
            {assignments.length === 0 ? (
              <div className="muted-text">No assignments yet.</div>
            ) : (
              <>
                <div className="teachers-table-wrapper" style={{ marginTop: 12 }}>
                  <table className="teachers-table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th>Class</th>
                        <th>Stream</th>
                        <th>Subject</th>
                        <th>Teacher</th>
                        <th>Added</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map(a => (
                        <tr key={a.id}>
                          <td>{a.class_level || a.class || "—"}</td>
                          <td>{a.stream || "—"}</td>
                          <td>{a.subject || "—"}</td>
                          <td>{a.teacher_name || a.teacher_id || "—"}</td>
                          <td>{formatDateTime(a.created_at)}</td>
                          <td>
                            <button type="button" onClick={() => deleteAssignment(a.id)} className="danger-link">Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div
                  style={{
                    marginTop: 16,
                    position: "sticky",
                    bottom: 0,
                    zIndex: 8,
                    paddingTop: 10,
                    paddingBottom: 6,
                    borderTop: "1px solid rgba(55, 65, 81, 0.8)",
                    background: "linear-gradient(to top, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.9))",
                  }}
                >
                  <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                    <select value={printClass} onChange={e => setPrintClass(e.target.value)}>
                      <option value="">All Classes</option>
                      {classes.map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>

                    <select value={printStream} onChange={e => setPrintStream(e.target.value)}>
                      <option value="">All Streams</option>
                      <option value="North">North</option>
                      <option value="South">South</option>
                    </select>
                  </div>

                  <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={handlePrintAssignments}
                      disabled={filteredAssignments.length === 0}
                    >
                      🖨️ Print
                    </button>

                    <button
                      type="button"
                      className="primary-btn"
                      onClick={handleExportAssignmentsPDF}
                      disabled={filteredAssignments.length === 0}
                    >
                      📄 Export PDF
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
