import React, { useState, useEffect } from "react";
import jsPDF from "jspdf";

/**
 * StudentsMarksPanel handles:
 * - Add Students (+ optional subjects selection)
 * - Students list with filters
 * - Class marksheet PDF generation
 * - Marks download (marks sets) + preview + CSV/PDF
 *
 * Props:
 *   apiBase: string
 *   initialTab: string ("Add Students" or "Download Marks")
 *   onBack: () => void
 */
const COMPULSORY_SUBJECTS = [
  "English", "Mathematics", "Physics", "Biology", "Chemistry", "History", "Geography",
];
const OPTIONAL_SUBJECTS = [
  "ICT", "Agriculture", "Physical Education", "Art", "Luganda", "Literature",
  "Christian Religious Education", "Entrepreneurship", "IRE", "Kiswahili",
];

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function StudentsMarksPanel({ apiBase, initialTab, onBack }) {
  const [tab, setTab] = useState(initialTab === "Download Marks" ? "Download Marks" : "Add Students");

  // students state
  const [students, setStudents] = useState([]);
  const [studentForm, setStudentForm] = useState({ name: "", gender: "", dob: "", class_level: "", stream: "" });
  const [selectedOptionals, setSelectedOptionals] = useState([]);
  const [studentError, setStudentError] = useState("");
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [savingStudent, setSavingStudent] = useState(false);
  const [deletingStudentId, setDeletingStudentId] = useState(null);

  // filters
  const [classFilter, setClassFilter] = useState("");
  const [streamFilter, setStreamFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [searchName, setSearchName] = useState("");

  // marks sets
  const [marksSets, setMarksSets] = useState([]);
  const [marksDetail, setMarksDetail] = useState([]);
  const [selectedMarksSet, setSelectedMarksSet] = useState(null);
  const [loadingMarksSets, setLoadingMarksSets] = useState(false);
  const [loadingMarksDetail, setLoadingMarksDetail] = useState(false);
  const [marksError, setMarksError] = useState("");

  // marksheet pdf controls
  const [marksheetClass, setMarksheetClass] = useState("");
  const [marksheetStream, setMarksheetStream] = useState("");
  const [marksheetError, setMarksheetError] = useState("");

  // fetch students
  const fetchStudents = async () => {
    try {
      setLoadingStudents(true);
      setStudentError("");
      const res = await fetch(`${apiBase}/api/students`);
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      const data = await res.json();
      setStudents(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error loading students:", err);
      setStudentError("Could not load students. Please try again.");
    } finally {
      setLoadingStudents(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  // student form handlers
  const handleStudentInputChange = (e) => {
    const { name, value } = e.target;
    setStudentForm((prev) => ({ ...prev, [name]: value }));
    setStudentError("");
  };

  const handleOptionalSubjectToggle = (subject) => {
    setStudentError("");
    setSelectedOptionals((prev) => {
      if (prev.includes(subject)) return prev.filter((s) => s !== subject);
      if (prev.length >= 5) {
        setStudentError("You can only add up to 5 optional subjects (12 total).");
        return prev;
      }
      return [...prev, subject];
    });
  };

  const handleAddStudent = async (e) => {
    e.preventDefault();
    const { name, gender, dob, class_level, stream } = studentForm;
    if (!name || !gender || !dob || !class_level || !stream) {
      setStudentError("Please fill in all required fields.");
      return;
    }
    const subjects = [...COMPULSORY_SUBJECTS, ...selectedOptionals];
    try {
      setSavingStudent(true);
      setStudentError("");
      const res = await fetch(`${apiBase}/api/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, gender, dob, class_level, stream, subjects }),
      });
      if (!res.ok) {
        let message = `Request failed with status ${res.status}`;
        try {
          const errBody = await res.json();
          if (errBody && errBody.message) message = errBody.message;
        } catch (_) {}
        throw new Error(message);
      }
      const created = await res.json();
      const studentToAdd = {
        id: created.id ?? created.insertId ?? Date.now(),
        name: created.name ?? name,
        gender: created.gender ?? gender,
        dob: created.dob ?? dob,
        class_level: created.class_level ?? class_level,
        stream: created.stream ?? stream,
        subjects: Array.isArray(created.subjects) ? created.subjects : subjects,
        created_at: created.created_at ?? null,
      };
      setStudents((p) => [studentToAdd, ...p]);
      setStudentForm({ name: "", gender: "", dob: "", class_level: "", stream: "" });
      setSelectedOptionals([]);
    } catch (err) {
      console.error("Error adding student:", err);
      setStudentError(err.message || "Could not add student. Please try again.");
    } finally {
      setSavingStudent(false);
    }
  };

  const handleDeleteStudent = async (id) => {
    if (!window.confirm("Remove this learner?")) return;
    try {
      setDeletingStudentId(id);
      setStudentError("");
      const res = await fetch(`${apiBase}/api/students/${id}`, { method: "DELETE" });
      if (!res.ok) {
        let message = `Request failed with status ${res.status}`;
        try {
          const errBody = await res.json();
          if (errBody && errBody.message) message = errBody.message;
        } catch (_) {}
        throw new Error(message);
      }
      setStudents((p) => p.filter((s) => s.id !== id));
    } catch (err) {
      console.error("Error deleting student:", err);
      setStudentError(err.message || "Could not delete student. Please try again.");
    } finally {
      setDeletingStudentId(null);
    }
  };

  // filters & lists
  const allSubjectsForFilter = [...COMPULSORY_SUBJECTS, ...OPTIONAL_SUBJECTS];
  const filteredStudents = students.filter((s) => {
    if (classFilter && s.class_level !== classFilter) return false;
    if (streamFilter && s.stream !== streamFilter) return false;
    if (subjectFilter) {
      const subs = Array.isArray(s.subjects) ? s.subjects : [];
      if (!subs.includes(subjectFilter)) return false;
    }
    if (searchName) {
      const q = searchName.toLowerCase().trim();
      if (!s.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const classOptions = Array.from(new Set(students.map((s) => s.class_level))).filter(Boolean);
  const classOptionsForMarksheet = classOptions.length > 0 ? classOptions : ["S1", "S2", "S3", "S4"];

  // marks download helpers
  const fetchMarksSets = async () => {
    try {
      setLoadingMarksSets(true);
      setMarksError("");
      const res = await fetch(`${apiBase}/api/admin/marks-sets`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setMarksSets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error loading marks sets:", err);
      setMarksError("Could not load marks summary.");
    } finally {
      setLoadingMarksSets(false);
    }
  };

  const fetchMarksDetail = async (set) => {
    try {
      if (!set) return;
      setLoadingMarksDetail(true);
      setMarksError("");
      const params = new URLSearchParams({
        assignmentId: set.assignment_id,
        term: set.term,
        year: String(set.year),
        aoi: set.aoi_label,
      });
      const res = await fetch(`${apiBase}/api/admin/marks-detail?${params}`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      setMarksDetail(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error loading marks detail:", err);
      setMarksError("Could not load marks detail.");
    } finally {
      setLoadingMarksDetail(false);
    }
  };

  const handleSelectMarksSet = (set) => {
    setSelectedMarksSet(set);
    setMarksDetail([]);
    fetchMarksDetail(set);
  };

  // CSV escape
  const csvEscape = (value) => {
    if (value === null || value === undefined) return '""';
    const s = String(value).replace(/"/g, '""');
    return `"${s}"`;
  };

  const handleDownloadCsv = () => {
    if (!selectedMarksSet || marksDetail.length === 0) return;
    const header = ["Student ID", "Name", "Class", "Stream", "Term", "Year", "AOI", "Score"];
    const rows = marksDetail.map((row) => [
      csvEscape(row.student_id),
      csvEscape(row.student_name),
      csvEscape(row.class_level),
      csvEscape(row.stream),
      csvEscape(selectedMarksSet.term),
      csvEscape(selectedMarksSet.year),
      csvEscape(selectedMarksSet.aoi_label),
      csvEscape(row.score),
    ]);
    const csvLines = [header.join(","), ...rows.map((r) => r.join(","))];
    const csvContent = csvLines.join("\n");
    const slug = (str) =>
      String(str || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const filename = `marks_${slug(selectedMarksSet.class_level)}_${slug(selectedMarksSet.stream)}_${slug(selectedMarksSet.subject)}_${slug(selectedMarksSet.aoi_label)}_T${slug(selectedMarksSet.term)}_${selectedMarksSet.year}.csv`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // PDF helpers (marks & marksheet) re-used from original
  const handleDownloadPdf = () => {
    if (!selectedMarksSet || marksDetail.length === 0) return;
    const doc = new jsPDF();
    const schoolName = "St. Phillip's Equatorial Secondary School (SPESS)";
    const aoiTitle = selectedMarksSet.aoi_label || "AOI";
    const classLabel = selectedMarksSet.class_level;
    const streamLabel = selectedMarksSet.stream;
    const subjectLabel = selectedMarksSet.subject;
    const termLabel = selectedMarksSet.term;
    const yearLabel = selectedMarksSet.year;
    const teacherName = selectedMarksSet.teacher_name || "—";
    const submittedAtRaw = selectedMarksSet.submitted_at || selectedMarksSet.created_at || null;
    const submittedAt = formatDateTime(submittedAtRaw);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(schoolName, 105, 16, { align: "center" });
    doc.setFontSize(18);
    doc.text(aoiTitle, 105, 28, { align: "center" });

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(`Class: ${classLabel}   Stream: ${streamLabel}   Subject: ${subjectLabel}`, 14, 40);
    doc.text(`Term: ${termLabel}   Year: ${yearLabel}`, 14, 47);
    doc.text(`Submitted by: ${teacherName}`, 14, 54);
    doc.text(`Submitted at: ${submittedAt}`, 14, 61);

    let startY = 72;
    let y = startY;
    const rowHeight = 7;
    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomMargin = 15;

    const drawTableHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("#", 14, y);
      doc.text("Student Name", 24, y);
      doc.text("Class", 120, y);
      doc.text("Stream", 140, y);
      doc.text("Score", 165, y);
      doc.setDrawColor(200);
      doc.line(12, y + 1.5, 198, y + 1.5);
      y += rowHeight;
      doc.setFont("helvetica", "normal");
    };

    drawTableHeader();
    doc.setFontSize(10);

    marksDetail.forEach((row, index) => {
      if (y > pageHeight - bottomMargin) {
        doc.addPage();
        y = startY;
        drawTableHeader();
      }
      const studentName = row.student_name || "";
      const cls = row.class_level || "";
      const str = row.stream || "";
      const score = row.score != null ? String(row.score) : "";
      doc.text(String(index + 1), 14, y);
      doc.text(studentName, 24, y);
      doc.text(cls, 120, y);
      doc.text(str, 140, y);
      doc.text(score, 165, y);
      y += rowHeight;
    });

    const pageCount = doc.internal.getNumberOfPages();
    const generatedAt = formatDateTime(new Date().toISOString());
    const footerText = `Generated from SPESS's ARK · ${generatedAt}`;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const ph = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text(footerText, 105, ph - 8, { align: "center" });
    }

    const slug = (str) => String(str || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const filename = `marks_${slug(classLabel)}_${slug(streamLabel)}_${slug(subjectLabel)}_${slug(aoiTitle)}_T${slug(termLabel)}_${yearLabel}.pdf`;
    doc.save(filename);
  };

  const handleDownloadMarksheetPdf = () => {
    setMarksheetError("");
    if (!marksheetClass) {
      setMarksheetError("Select a class for the marksheet.");
      return;
    }
    const list = students.filter((s) => {
      if (s.class_level !== marksheetClass) return false;
      if (!marksheetStream) return true;
      return s.stream === marksheetStream;
    });
    if (list.length === 0) {
      setMarksheetError("No learners found for that class/stream selection.");
      return;
    }

    const doc = new jsPDF();
    const schoolName = "St. Phillip's Equatorial Secondary School (SPESS)";
    const classLabel = marksheetClass;
    const streamLabel = marksheetStream || "North & South";
    const headerTitle = "Class Marksheet";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(schoolName, 105, 16, { align: "center" });

    doc.setFontSize(16);
    doc.text(headerTitle, 105, 26, { align: "center" });

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(`Class: ${classLabel}`, 14, 38);
    doc.text(`Stream: ${streamLabel}`, 14, 45);

    let startY = 58;
    let y = startY;
    const rowHeight = 7;
    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomMargin = 15;

    const drawTableHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("#", 12, y);
      doc.text("Name", 20, y);
      doc.text("Gender", 95, y);
      doc.text("Class", 115, y);
      doc.text("Stream", 135, y);
      doc.text("Optional Subjects", 155, y);
      doc.setDrawColor(200);
      doc.line(10, y + 1.5, 200, y + 1.5);
      y += rowHeight;
      doc.setFont("helvetica", "normal");
    };

    drawTableHeader();
    doc.setFontSize(9);

    list.sort((a, b) => a.name.localeCompare(b.name)).forEach((s, index) => {
      if (y > pageHeight - bottomMargin) {
        doc.addPage();
        y = startY;
        drawTableHeader();
      }
      const subs = Array.isArray(s.subjects) ? s.subjects : [];
      const optionalSubs = subs.filter((sub) => OPTIONAL_SUBJECTS.includes(sub));
      const optionalText = optionalSubs.join(", ");
      doc.text(String(index + 1), 12, y);
      doc.text(s.name || "", 20, y);
      doc.text(s.gender || "", 95, y);
      doc.text(s.class_level || "", 115, y);
      doc.text(s.stream || "", 135, y);
      const split = doc.splitTextToSize(optionalText, 50);
      doc.text(split, 155, y);
      y += rowHeight * Math.max(1, split.length);
    });

    const pageCount = doc.internal.getNumberOfPages();
    const generatedAt = formatDateTime(new Date().toISOString());
    const footerText = `Generated from SPESS's ARK · ${generatedAt}`;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const ph = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text(footerText, 105, ph - 8, { align: "center" });
    }

    const slug = (str) => String(str || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const filename = `marksheet_${slug(classLabel)}_${slug(marksheetStream || "all_streams")}.pdf`;
    doc.save(filename);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{tab === "Add Students" ? "Add Students" : "Download Marks"}</h2>
          <p>{tab === "Add Students" ? "Enroll learners with class, stream and subjects." : "View submitted AOI scores and export them."}</p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button className={`ghost-btn ${tab === "Add Students" ? "active" : ""}`} onClick={() => setTab("Add Students")}>Add Students</button>
            <button className={`ghost-btn ${tab === "Download Marks" ? "active" : ""}`} onClick={() => setTab("Download Marks")}>Download Marks</button>
          </div>
          <button className="panel-close" onClick={onBack}>✕ Close</button>
        </div>
      </div>

      {studentError && <div className="panel-alert panel-alert-error">{studentError}</div>}
      {marksError && <div className="panel-alert panel-alert-error">{marksError}</div>}

      {tab === "Add Students" ? (
        <div className="panel-grid">
          <div className="panel-card">
            <h3>Add Learner</h3>
            <form className="teacher-form" onSubmit={handleAddStudent}>
              <div className="form-row"><label>Full name</label><input name="name" value={studentForm.name} onChange={handleStudentInputChange} /></div>
              <div className="form-row">
                <label>Gender</label>
                <select name="gender" value={studentForm.gender} onChange={handleStudentInputChange}>
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="form-row"><label>Date of birth</label><input name="dob" type="date" value={studentForm.dob} onChange={handleStudentInputChange} /></div>
              <div className="form-row"><label>Class</label><input name="class_level" value={studentForm.class_level} onChange={handleStudentInputChange} placeholder="e.g. S1" /></div>
              <div className="form-row">
                <label>Stream</label>
                <select name="stream" value={studentForm.stream} onChange={handleStudentInputChange}>
                  <option value="">Select stream</option>
                  <option value="North">North</option>
                  <option value="South">South</option>
                </select>
              </div>

              <div className="form-row">
                <label>Compulsory subjects (always included)</label>
                <div className="muted-text">{COMPULSORY_SUBJECTS.join(" • ")}</div>
              </div>

              <div className="form-row">
                <label>Optional subjects (pick up to 5)</label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.3rem 0.8rem", fontSize: "0.8rem" }}>
                  {OPTIONAL_SUBJECTS.map((subj) => (
                    <label key={subj} style={{ display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedOptionals.includes(subj)} onChange={() => handleOptionalSubjectToggle(subj)} />
                      <span>{subj}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button className="primary-btn" type="submit" disabled={savingStudent}>{savingStudent ? "Saving…" : "Save Learner"}</button>
            </form>
          </div>

          <div className="panel-card">
            <div className="panel-card-header">
              <h3>Learners</h3>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="ghost-btn" onClick={fetchStudents} disabled={loadingStudents}>{loadingStudents ? "Refreshing…" : "Refresh"}</button>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.7rem", fontSize: "0.8rem" }}>
              <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                <option value="">All classes</option>
                {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={streamFilter} onChange={(e) => setStreamFilter(e.target.value)}><option value="">All streams</option><option value="North">North</option><option value="South">South</option></select>
              <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}><option value="">All subjects</option>{allSubjectsForFilter.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              <button className="ghost-btn" onClick={() => { setClassFilter(""); setStreamFilter(""); setSubjectFilter(""); setSearchName(""); }}>Clear</button>
              <input type="text" value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="Search by name…" style={{ minWidth: "180px", padding: "0.35rem 0.6rem", borderRadius: "999px" }} />
            </div>

            <div style={{ marginBottom: "0.8rem", padding: "0.75rem 0.9rem", borderRadius: "0.9rem" }}>
              <div style={{ fontSize: "0.78rem", textTransform: "uppercase", color: "#9ca3af", marginBottom: "0.25rem" }}>Class marksheet PDF</div>
              <div className="muted-text">Generate a printable class list for the notice board.</div>

              <div style={{ display: "flex", gap: "0.45rem", marginTop: "0.6rem", alignItems: "center" }}>
                <select value={marksheetClass} onChange={(e) => { setMarksheetClass(e.target.value); setMarksheetError(""); }}>
                  <option value="">Select class</option>
                  {classOptionsForMarksheet.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={marksheetStream} onChange={(e) => { setMarksheetStream(e.target.value); setMarksheetError(""); }}>
                  <option value="">All streams</option>
                  <option value="North">North</option>
                  <option value="South">South</option>
                </select>
                <button className="primary-btn" onClick={handleDownloadMarksheetPdf}>Download Marksheet</button>
              </div>

              {marksheetError && <div style={{ marginTop: "0.25rem", color: "#fecaca" }}>{marksheetError}</div>}
            </div>

            {loadingStudents && students.length === 0 ? (
              <p className="muted-text">Loading learners…</p>
            ) : filteredStudents.length === 0 ? (
              <p className="muted-text">No learners match the filters. Try clearing filters or add a new learner.</p>
            ) : (
              <div className="teachers-table-wrapper">
                <table className="teachers-table">
                  <thead>
                    <tr><th>Name</th><th>Gender</th><th>Class</th><th>Stream</th><th>Subjects</th><th>Added</th><th /></tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>{s.gender}</td>
                        <td>{s.class_level}</td>
                        <td>{s.stream}</td>
                        <td>{Array.isArray(s.subjects) ? s.subjects.join(", ") : ""}</td>
                        <td>{s.created_at ? formatDateTime(s.created_at) : "—"}</td>
                        <td className="teachers-actions">
                          <button className="danger-link" onClick={() => handleDeleteStudent(s.id)} disabled={deletingStudentId === s.id}>{deletingStudentId === s.id ? "Deleting…" : "Delete"}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="panel-grid">
          <div className="panel-card">
            <div className="panel-card-header">
              <h3>Available mark sets</h3>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="ghost-btn" onClick={fetchMarksSets} disabled={loadingMarksSets}>{loadingMarksSets ? "Refreshing…" : "Refresh"}</button>
              </div>
            </div>

            {loadingMarksSets && marksSets.length === 0 ? (
              <p className="muted-text">Loading marks summary…</p>
            ) : marksSets.length === 0 ? (
              <p className="muted-text">No marks recorded yet. Once teachers submit AOI scores, they will appear here.</p>
            ) : (
              <div className="teachers-table-wrapper">
                <table className="teachers-table">
                  <thead>
                    <tr><th>Class</th><th>Stream</th><th>Subject</th><th>AOI</th><th>Term</th><th>Year</th><th>Submitted by</th><th>Submitted at</th><th>Learners</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {marksSets.map((set) => {
                      const isSelected = selectedMarksSet && selectedMarksSet.assignment_id === set.assignment_id && selectedMarksSet.term === set.term && selectedMarksSet.year === set.year && selectedMarksSet.aoi_label === set.aoi_label;
                      const submittedAt = set.submitted_at || set.created_at || null;
                      return (
                        <tr key={`${set.assignment_id}-${set.term}-${set.year}-${set.aoi_label}`} onClick={() => handleSelectMarksSet(set)} style={{ cursor: "pointer", background: isSelected ? "rgba(37,99,235,0.12)" : "transparent" }}>
                          <td>{set.class_level}</td>
                          <td>{set.stream}</td>
                          <td>{set.subject}</td>
                          <td>{set.aoi_label}</td>
                          <td>{set.term}</td>
                          <td>{set.year}</td>
                          <td>{set.teacher_name}</td>
                          <td>{formatDateTime(submittedAt)}</td>
                          <td>{set.marks_count}</td>
                          <td className="teachers-actions">
                            <button className="ghost-btn" onClick={(e) => { e.stopPropagation(); handleSelectMarksSet(set); }}>View</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel-card">
            <div className="panel-card-header">
              <h3>Marks preview</h3>
              {selectedMarksSet && marksDetail.length > 0 && (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button className="ghost-btn" onClick={handleDownloadCsv} disabled={loadingMarksDetail}>Download CSV</button>
                  <button className="primary-btn" onClick={handleDownloadPdf} disabled={loadingMarksDetail}>Download PDF</button>
                </div>
              )}
            </div>

            {!selectedMarksSet ? (
              <p className="muted-text">Select a mark set on the left to preview scores.</p>
            ) : loadingMarksDetail && marksDetail.length === 0 ? (
              <p className="muted-text">Loading marks…</p>
            ) : marksDetail.length === 0 ? (
              <p className="muted-text">No marks found for this selection.</p>
            ) : (
              <>
                <p className="muted-text" style={{ marginBottom: "0.6rem" }}>
                  {selectedMarksSet.class_level} {selectedMarksSet.stream} — {selectedMarksSet.subject}, {selectedMarksSet.aoi_label}, Term {selectedMarksSet.term} {selectedMarksSet.year}
                </p>
                <div className="teachers-table-wrapper">
                  <table className="teachers-table">
                    <thead><tr><th>Name</th><th>Class</th><th>Stream</th><th>Score</th></tr></thead>
                    <tbody>
                      {marksDetail.map((row) => (
                        <tr key={row.student_id}><td>{row.student_name}</td><td>{row.class_level}</td><td>{row.stream}</td><td>{row.score}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default StudentsMarksPanel;
