import { useEffect, useMemo, useState } from "react";
import BoardingAdminShell from "../components/BoardingAdminShell";
import { boardingFetch } from "../api";
import "../../../pages/AdminDashboard.css";

const CLASSES = ["S1", "S2", "S3", "S4"];
const TERMS = ["Term 1", "Term 2", "Term 3"];

export default function BoardingMarks() {
  const [subjects, setSubjects] = useState([]);
  const [filters, setFilters] = useState({
    class_level: "S1",
    subject_id: "",
    term: "Term 1",
    year: new Date().getFullYear(),
    weekend_label: "Weekend 1",
    assessment_date: "",
  });
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadSubjects = async () => {
      try {
        const data = await boardingFetch("/api/boarding/subjects");
        const list = Array.isArray(data) ? data : [];
        setSubjects(list);
        if (list[0]) {
          setFilters((previous) => ({ ...previous, subject_id: previous.subject_id || String(list[0].id) }));
        }
      } catch (err) {
        setError(err.message || "Failed to load boarding subjects");
      }
    };
    loadSubjects();
  }, []);

  const selectedSubject = useMemo(
    () => subjects.find((subject) => Number(subject.id) === Number(filters.subject_id)) || null,
    [filters.subject_id, subjects]
  );

  const loadContext = async () => {
    setError("");
    setSuccess("");
    if (!filters.subject_id || !filters.weekend_label) {
      setError("Select class, subject and weekend label first.");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        class_level: filters.class_level,
        subject_id: String(filters.subject_id),
        term: filters.term,
        year: String(filters.year),
        weekend_label: filters.weekend_label,
      });
      const data = await boardingFetch(`/api/boarding/marks/context?${params.toString()}`);
      const learnerRows = Array.isArray(data?.learners) ? data.learners : [];
      setRows(
        learnerRows.map((row) => ({
          student_id: row.id,
          name: row.name,
          gender: row.gender,
          score: row.score ?? "",
          status: row.status || "",
          assessment_date: row.assessment_date ? String(row.assessment_date).slice(0, 10) : filters.assessment_date,
        }))
      );
      if (!filters.assessment_date) {
        const existingDate = learnerRows.find((row) => row.assessment_date)?.assessment_date;
        if (existingDate) {
          setFilters((previous) => ({ ...previous, assessment_date: String(existingDate).slice(0, 10) }));
        }
      }
    } catch (err) {
      setError(err.message || "Failed to load weekend marks context");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (studentId, patch) => {
    setRows((previous) => previous.map((row) => (row.student_id === studentId ? { ...row, ...patch } : row)));
  };

  const handleSave = async () => {
    setError("");
    setSuccess("");
    if (!filters.subject_id || !filters.weekend_label) {
      setError("Select class, subject and weekend label first.");
      return;
    }
    setSaving(true);
    try {
      await boardingFetch("/api/boarding/marks/save", {
        method: "POST",
        body: {
          class_level: filters.class_level,
          subject_id: Number(filters.subject_id),
          term: filters.term,
          year: Number(filters.year),
          weekend_label: filters.weekend_label,
          assessment_date: filters.assessment_date || null,
          rows,
        },
      });
      setSuccess("Weekend marks saved.");
      await loadContext();
    } catch (err) {
      setError(err.message || "Failed to save weekend marks");
    } finally {
      setSaving(false);
    }
  };

  return (
    <BoardingAdminShell
      title="Weekend Marks"
      subtitle="Pick a class and subject, then capture the boarding weekend assessment from the boarding account directly — no assignment setup required."
    >
      {error && <div className="panel-alert panel-alert-error">{error}</div>}
      {success && <div className="panel-alert panel-alert-success">{success}</div>}

      <div className="panel-card" style={{ background: "rgba(15,23,42,0.58)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.9rem", alignItems: "end" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Class</span>
            <select value={filters.class_level} onChange={(event) => setFilters((previous) => ({ ...previous, class_level: event.target.value }))}>
              {CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Subject</span>
            <select value={filters.subject_id} onChange={(event) => setFilters((previous) => ({ ...previous, subject_id: event.target.value }))}>
              <option value="">Select subject</option>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Term</span>
            <select value={filters.term} onChange={(event) => setFilters((previous) => ({ ...previous, term: event.target.value }))}>
              {TERMS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Year</span>
            <input type="number" value={filters.year} onChange={(event) => setFilters((previous) => ({ ...previous, year: Number(event.target.value) || previous.year }))} />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Weekend Label</span>
            <input value={filters.weekend_label} onChange={(event) => setFilters((previous) => ({ ...previous, weekend_label: event.target.value }))} placeholder="Weekend 1" />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Assessment Date</span>
            <input type="date" value={filters.assessment_date} onChange={(event) => setFilters((previous) => ({ ...previous, assessment_date: event.target.value }))} />
          </label>
          <button type="button" className="primary-btn" onClick={loadContext}>{loading ? "Loading..." : "Load Learners"}</button>
        </div>
      </div>

      <div className="panel-card" style={{ marginTop: "1rem", background: "rgba(15,23,42,0.58)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#4ade80", fontSize: "0.76rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Capture Grid</div>
            <h3 style={{ margin: "0.35rem 0 0" }}>{selectedSubject ? `${filters.class_level} • ${selectedSubject.name}` : "Select a subject"}</h3>
          </div>
          <button type="button" className="primary-btn" onClick={handleSave} disabled={saving || rows.length === 0}>{saving ? "Saving..." : "Save Weekend Marks"}</button>
        </div>

        <div style={{ marginTop: "1rem", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
            <thead>
              <tr>
                {['Learner', 'Gender', 'Score', 'Missed', 'Status'].map((label) => (
                  <th key={label} style={{ textAlign: "left", padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.08)", color: "#4ade80", fontSize: "0.75rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isMissed = String(row.status || "").toLowerCase() === "missed";
                return (
                  <tr key={row.student_id}>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{row.name}</td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{row.gender}</td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <input
                        type="number"
                        value={row.score}
                        disabled={isMissed}
                        onChange={(event) => updateRow(row.student_id, { score: event.target.value, status: event.target.value === "" ? row.status : "Submitted" })}
                      />
                    </td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <input
                        type="checkbox"
                        checked={isMissed}
                        onChange={(event) =>
                          updateRow(row.student_id, {
                            status: event.target.checked ? "Missed" : row.score !== "" ? "Submitted" : "",
                            score: event.target.checked ? "" : row.score,
                          })
                        }
                      />
                    </td>
                    <td style={{ padding: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)", color: isMissed ? "#fca5a5" : "rgba(241,245,249,0.76)" }}>
                      {isMissed ? "Missed" : row.score !== "" ? "Submitted" : "Pending"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </BoardingAdminShell>
  );
}
