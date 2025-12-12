// src/components/AssignSubjectsPanel.jsx
import React, { useEffect, useState } from "react";
import { plainFetch } from "../lib/api";

// fallback master subjects
const FALLBACK_SUBJECTS = [
  "English","Mathematics","Physics","Biology","Chemistry","History","Geography",
  "ICT","Agriculture","Physical Education","Art","Luganda","Literature",
  "Christian Religious Education","Entrepreneurship","IRE","Kiswahili"
];

export default function AssignSubjectsPanel({ active }) {
  const [loading, setLoading] = useState(false);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [form, setForm] = useState({ classId: "", subjectId: "", teacherId: "", stream: "" });
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    if (!active) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

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
                        <td>{a.created_at || "—"}</td>
                        <td>
                          <button type="button" onClick={() => deleteAssignment(a.id)} className="danger-link">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
