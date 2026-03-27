import { useEffect, useMemo, useState } from "react";
import BoardingAdminShell from "../components/BoardingAdminShell";
import { boardingFetch } from "../api";
import "../../../pages/AdminDashboard.css";

const CLASSES = ["S1", "S2", "S3", "S4"];
const EMPTY_FORM = {
  name: "",
  gender: "Male",
  dob: "",
  class_level: "S1",
  subject_ids: [],
};

export default function BoardingLearners() {
  const [subjects, setSubjects] = useState([]);
  const [students, setStudents] = useState([]);
  const [filters, setFilters] = useState({ q: "", class_level: "" });
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const loadStudents = async () => {
    setError("");
    try {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.class_level) params.set("class_level", filters.class_level);
      const data = await boardingFetch(`/api/boarding/students${params.toString() ? `?${params.toString()}` : ""}`);
      setStudents(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load boarding learners");
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [subjectRows, studentRows] = await Promise.all([
          boardingFetch("/api/boarding/subjects"),
          boardingFetch("/api/boarding/students"),
        ]);
        setSubjects(Array.isArray(subjectRows) ? subjectRows : []);
        setStudents(Array.isArray(studentRows) ? studentRows : []);
      } catch (err) {
        setError(err.message || "Failed to load boarding learners");
      }
    };
    load();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadStudents();
    }, 220);
    return () => clearTimeout(timer);
  }, [filters.q, filters.class_level]);

  const groupedSubjects = useMemo(
    () => ({
      compulsory: subjects.filter((subject) => !Number(subject.is_optional)),
      optional: subjects.filter((subject) => Number(subject.is_optional)),
    }),
    [subjects]
  );
  const compulsoryIds = useMemo(
    () => groupedSubjects.compulsory.map((subject) => Number(subject.id)).filter((value) => Number.isInteger(value) && value > 0),
    [groupedSubjects.compulsory]
  );

  useEffect(() => {
    if (compulsoryIds.length === 0) return;
    setForm((previous) => {
      const merged = Array.from(new Set([...(previous.subject_ids || []), ...compulsoryIds]));
      const sameLength = merged.length === (previous.subject_ids || []).length;
      const sameValues = sameLength && merged.every((value, index) => value === previous.subject_ids[index]);
      return sameValues ? previous : { ...previous, subject_ids: merged };
    });
  }, [compulsoryIds]);

  const toggleSubject = (subjectId) => {
    setForm((previous) => ({
      ...previous,
      subject_ids: previous.subject_ids.includes(subjectId)
        ? previous.subject_ids.filter((value) => value !== subjectId)
        : [...previous.subject_ids, subjectId],
    }));
  };

  const resetForm = () => {
    setForm({
      ...EMPTY_FORM,
      class_level: "S1",
      subject_ids: compulsoryIds,
    });
    setEditingId(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      if (editingId) {
        await boardingFetch(`/api/boarding/students/${editingId}`, { method: "PUT", body: form });
        setSuccess("Boarding learner updated.");
      } else {
        await boardingFetch("/api/boarding/students", { method: "POST", body: form });
        setSuccess("Boarding learner registered.");
      }
      resetForm();
      await loadStudents();
    } catch (err) {
      setError(err.message || "Failed to save boarding learner");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (student) => {
    setEditingId(student.id);
    setForm({
      name: student.name || "",
      gender: student.gender || "Male",
      dob: student.dob ? String(student.dob).slice(0, 10) : "",
      class_level: student.class_level || "S1",
      subject_ids: Array.from(new Set([...(Array.isArray(student.subject_ids) ? student.subject_ids : []), ...compulsoryIds])),
    });
    setSuccess("");
    setError("");
  };

  const handleDelete = async (studentId) => {
    setError("");
    setSuccess("");
    try {
      await boardingFetch(`/api/boarding/students/${studentId}`, { method: "DELETE" });
      setSuccess("Boarding learner removed.");
      if (editingId === studentId) resetForm();
      await loadStudents();
    } catch (err) {
      setError(err.message || "Failed to delete boarding learner");
    }
  };

  return (
    <BoardingAdminShell
      title="Boarding Learners"
      subtitle="Register boarding learners by class, attach optional subjects, and keep the weekend-assessment register current from one place."
    >
      {error && <div className="panel-alert panel-alert-error">{error}</div>}
      {success && <div className="panel-alert panel-alert-success">{success}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)", gap: "1rem" }}>
        <form className="panel-card" onSubmit={handleSubmit} style={{ background: "rgba(15,23,42,0.58)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ color: "#4ade80", fontSize: "0.76rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>
            {editingId ? "Update Learner" : "Register Learner"}
          </div>

          <div style={{ display: "grid", gap: "0.9rem", marginTop: "1rem" }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Name</span>
              <input value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Gender</span>
                <select value={form.gender} onChange={(event) => setForm((previous) => ({ ...previous, gender: event.target.value }))}>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Class</span>
                <select value={form.class_level} onChange={(event) => setForm((previous) => ({ ...previous, class_level: event.target.value }))}>
                  {CLASSES.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>

            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Date of Birth</span>
              <input type="date" value={form.dob} onChange={(event) => setForm((previous) => ({ ...previous, dob: event.target.value }))} />
            </label>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{ color: "#4ade80", fontSize: "0.74rem", fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>Compulsory Subjects</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.45rem" }}>
                {groupedSubjects.compulsory.map((subject) => (
                  <label key={subject.id} style={{ display: "flex", gap: "0.45rem", alignItems: "center", padding: "0.55rem 0.65rem", borderRadius: "12px", background: "rgba(2,6,23,0.22)" }}>
                    <input type="checkbox" checked={form.subject_ids.includes(subject.id)} disabled />
                    <span>{subject.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{ color: "#4ade80", fontSize: "0.74rem", fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>Optional Subjects</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.45rem" }}>
                {groupedSubjects.optional.map((subject) => (
                  <label key={subject.id} style={{ display: "flex", gap: "0.45rem", alignItems: "center", padding: "0.55rem 0.65rem", borderRadius: "12px", background: "rgba(2,6,23,0.22)" }}>
                    <input type="checkbox" checked={form.subject_ids.includes(subject.id)} onChange={() => toggleSubject(subject.id)} />
                    <span>{subject.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
              <button type="submit" className="primary-btn" disabled={loading}>{loading ? "Saving..." : editingId ? "Update Learner" : "Register Learner"}</button>
              {editingId && <button type="button" className="ghost-btn" onClick={resetForm}>Cancel Edit</button>}
            </div>
          </div>
        </form>

        <div className="panel-card" style={{ background: "rgba(15,23,42,0.58)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ color: "#4ade80", fontSize: "0.76rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Registered Learners</div>
              <h3 style={{ margin: "0.35rem 0 0" }}>Boarding Register</h3>
            </div>
            <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
              <input placeholder="Search learner" value={filters.q} onChange={(event) => setFilters((previous) => ({ ...previous, q: event.target.value }))} />
              <select value={filters.class_level} onChange={(event) => setFilters((previous) => ({ ...previous, class_level: event.target.value }))}>
                <option value="">All Classes</option>
                {CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: "1rem", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "820px" }}>
              <thead>
                <tr>
                  {['Name', 'Class', 'Gender', 'DOB', 'Subjects', 'Actions'].map((label) => (
                    <th key={label} style={{ textAlign: "left", padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.08)", color: "#4ade80", fontSize: "0.75rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{student.name}</td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{student.class_level}</td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{student.gender}</td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{student.dob ? String(student.dob).slice(0, 10) : "—"}</td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "rgba(241,245,249,0.76)" }}>{(student.subject_names || []).join(", ")}</td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: "0.55rem" }}>
                      <button type="button" className="ghost-btn" onClick={() => startEdit(student)}>Edit</button>
                      <button type="button" className="ghost-btn" onClick={() => handleDelete(student.id)} style={{ color: "#fca5a5", borderColor: "rgba(248,113,113,0.34)" }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </BoardingAdminShell>
  );
}
