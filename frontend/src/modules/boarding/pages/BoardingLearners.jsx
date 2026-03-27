import { useEffect, useMemo, useState } from "react";
import BoardingAdminShell from "../components/BoardingAdminShell";
import { boardingFetch } from "../api";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import "../../../pages/AdminDashboard.css";

const CLASSES = ["S1", "S2", "S3", "S4"];
const EMPTY_FORM = {
  name: "",
  gender: "",
  dob: "",
  class_level: "S1",
  subject_ids: [],
};

const fieldLabelStyle = {
  display: "grid",
  gap: "0.35rem",
  color: "rgba(241,245,249,0.88)",
  fontSize: "0.9rem",
  fontWeight: 700,
};

const fieldInputStyle = {
  width: "100%",
  minHeight: "46px",
  padding: "0.8rem 0.95rem",
  borderRadius: "14px",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "linear-gradient(180deg, rgba(9,14,28,0.98) 0%, rgba(15,23,42,0.92) 100%)",
  color: "#f8fafc",
  outline: "none",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 22px rgba(2,6,23,0.18)",
  fontSize: "0.95rem",
  fontWeight: 600,
};

const filterControlStyle = {
  minHeight: "44px",
  padding: "0.75rem 0.9rem",
  borderRadius: "14px",
  border: "1px solid rgba(148, 163, 184, 0.2)",
  background: "linear-gradient(180deg, rgba(9,14,28,0.96) 0%, rgba(15,23,42,0.9) 100%)",
  color: "#f8fafc",
  outline: "none",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 18px rgba(2,6,23,0.14)",
  fontSize: "0.92rem",
  fontWeight: 600,
};

const formatDateOnly = (value) => {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB");
};

const csvEscape = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const loadBadgeImage = () =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "/badge.png";
  });

const successModalBackdropStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 6, 23, 0.72)",
  backdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
  zIndex: 1200,
};

const successModalCardStyle = {
  width: "min(520px, 100%)",
  borderRadius: "24px",
  background: "linear-gradient(180deg, rgba(7, 18, 15, 0.98) 0%, rgba(15, 23, 42, 0.96) 100%)",
  border: "1px solid rgba(74, 222, 128, 0.26)",
  boxShadow: "0 28px 64px rgba(2, 6, 23, 0.45)",
  color: "#f8fafc",
  overflow: "hidden",
};

export default function BoardingLearners() {
  const [subjects, setSubjects] = useState([]);
  const [students, setStudents] = useState([]);
  const [filters, setFilters] = useState({ q: "", class_level: "" });
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

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
      const isEditing = Boolean(editingId);
      const learnerName = String(form.name || "").trim();
      const learnerClass = form.class_level || "S1";
      const selectedOptionalSubjects = groupedSubjects.optional
        .filter((subject) => form.subject_ids.includes(subject.id))
        .map((subject) => subject.name);

      if (editingId) {
        await boardingFetch(`/api/boarding/students/${editingId}`, { method: "PUT", body: form });
        setSuccess("Boarding learner updated.");
      } else {
        await boardingFetch("/api/boarding/students", { method: "POST", body: form });
        setSuccess("Boarding learner registered.");
      }
      resetForm();
      await loadStudents();
      setConfirmation({
        title: isEditing ? "Learner Updated" : "Learner Registered",
        learnerName,
        classLevel: learnerClass,
        subjectCount: form.subject_ids.length,
        optionalSubjects: selectedOptionalSubjects,
        message: isEditing
          ? "The boarding learner record has been updated successfully."
          : "The boarding learner has been added to the boarding register successfully.",
      });
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
      gender: student.gender || "",
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

  const exportRows = students.map((student) => ({
    name: student.name || "",
    class_level: student.class_level || "",
    gender: student.gender || "",
    dob: formatDateOnly(student.dob),
    subjects: Array.isArray(student.subject_names) ? student.subject_names.join(", ") : "",
  }));

  const exportLabel = filters.class_level || "All Classes";

  const handleDownloadCsv = async () => {
    if (!exportRows.length) {
      setError("No boarding learners available to export.");
      return;
    }

    setError("");
    setExportingCsv(true);
    try {
      const header = ["Name", "Class", "Gender", "DOB", "Subjects"];
      const lines = [
        header.join(","),
        ...exportRows.map((row) =>
          [
            csvEscape(row.name),
            csvEscape(row.class_level),
            csvEscape(row.gender),
            csvEscape(row.dob),
            csvEscape(row.subjects),
          ].join(",")
        ),
      ];

      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `boarding_learners_${exportLabel.replace(/\s+/g, "_").toLowerCase()}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      setError(err.message || "Failed to export boarding learners CSV");
    } finally {
      setExportingCsv(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!exportRows.length) {
      setError("No boarding learners available to export.");
      return;
    }

    setError("");
    setExportingPdf(true);
    try {
      const { jsPDF, autoTable } = await loadPdfTools();
      const badgeImage = await loadBadgeImage();
      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const generatedAt = new Date().toLocaleString("en-GB");
      const contentWidth = pageWidth - 28;
      const metaBoxY = 38;
      const metaBoxHeight = 14;

      doc.setDrawColor(0);
      doc.setLineWidth(0.3);
      doc.line(14, 10, pageWidth - 14, 10);
      doc.line(14, 34, pageWidth - 14, 34);

      if (badgeImage) {
        doc.addImage(badgeImage, "PNG", 16, 12.5, 14, 14);
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13.5);
      doc.text("ST PHILLIP'S EQUATORIAL SECONDARY SCHOOL", pageWidth / 2, 16.5, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.2);
      doc.text("Boarding Weekend Assessment Register", pageWidth / 2, 21.8, { align: "center" });
      doc.text("www.stphillipsequatorial.com • info@stphillipsequatorial.com", pageWidth / 2, 26.6, { align: "center" });

      doc.setFillColor(239, 239, 239);
      doc.rect(14, metaBoxY, contentWidth, metaBoxHeight, "F");
      doc.setDrawColor(0);
      doc.setLineWidth(0.22);
      doc.rect(14, metaBoxY, contentWidth, metaBoxHeight);
      doc.line(14 + contentWidth / 3, metaBoxY, 14 + contentWidth / 3, metaBoxY + metaBoxHeight);
      doc.line(14 + (contentWidth / 3) * 2, metaBoxY, 14 + (contentWidth / 3) * 2, metaBoxY + metaBoxHeight);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.1);
      doc.text("CLASS", 18, metaBoxY + 4.7);
      doc.text("LEARNERS", 18 + contentWidth / 3, metaBoxY + 4.7);
      doc.text("GENERATED", 18 + (contentWidth / 3) * 2, metaBoxY + 4.7);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.3);
      doc.text(String(exportLabel), 18, metaBoxY + 10.1);
      doc.text(String(exportRows.length), 18 + contentWidth / 3, metaBoxY + 10.1);
      doc.text(generatedAt, 18 + (contentWidth / 3) * 2, metaBoxY + 10.1);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11.4);
      doc.text("BOARDING LEARNERS REGISTER", pageWidth / 2, 60, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text("Class register prepared for printing and filing.", pageWidth / 2, 64.8, { align: "center" });

      autoTable(doc, {
        startY: 70,
        margin: { left: 14, right: 14 },
        head: [["Name", "Class", "Gender", "DOB", "Subjects"]],
        body: exportRows.map((row) => [row.name, row.class_level, row.gender, row.dob, row.subjects]),
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 8.2,
          lineColor: [0, 0, 0],
          lineWidth: 0.2,
          cellPadding: 1.75,
          textColor: [0, 0, 0],
        },
        headStyles: {
          fillColor: [230, 230, 230],
          textColor: [0, 0, 0],
          fontStyle: "bold",
          lineColor: [0, 0, 0],
          lineWidth: 0.26,
        },
        alternateRowStyles: {
          fillColor: [249, 249, 249],
        },
        columnStyles: {
          0: { cellWidth: 44 },
          1: { cellWidth: 18, halign: "center" },
          2: { cellWidth: 22, halign: "center" },
          3: { cellWidth: 24, halign: "center" },
          4: { cellWidth: "auto" },
        },
      });

      const totalPages = doc.internal.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(
          `SPESS ARK Boarding · Learners Register · Page ${page} of ${totalPages}`,
          pageWidth / 2,
          pageHeight - 8,
          { align: "center" }
        );
      }

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message || "Failed to export boarding learners PDF");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <BoardingAdminShell
      title="Boarding Learners"
      subtitle="Register boarding learners by class, attach optional subjects, and keep the weekend-assessment register current from one place."
    >
      {confirmation && (
        <div style={successModalBackdropStyle} onClick={() => setConfirmation(null)}>
          <div style={successModalCardStyle} onClick={(event) => event.stopPropagation()}>
            <div
              style={{
                padding: "1rem 1.15rem",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                background: "linear-gradient(90deg, rgba(34,197,94,0.26), rgba(15,23,42,0.18))",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <div>
                <div style={{ color: "#86efac", fontSize: "0.78rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                  Boarding Confirmation
                </div>
                <h3 style={{ margin: "0.35rem 0 0", fontSize: "1.15rem" }}>{confirmation.title}</h3>
              </div>
              <button type="button" className="ghost-btn" onClick={() => setConfirmation(null)}>
                Close
              </button>
            </div>

            <div style={{ padding: "1.15rem", display: "grid", gap: "0.8rem" }}>
              <p style={{ margin: 0, color: "rgba(241,245,249,0.82)", lineHeight: 1.65 }}>{confirmation.message}</p>
              <div style={{ display: "grid", gap: "0.55rem", padding: "0.95rem 1rem", borderRadius: "16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div><strong style={{ color: "#86efac" }}>Learner:</strong> {confirmation.learnerName || "—"}</div>
                <div><strong style={{ color: "#86efac" }}>Class:</strong> {confirmation.classLevel || "—"}</div>
                <div><strong style={{ color: "#86efac" }}>Subjects attached:</strong> {confirmation.subjectCount || 0}</div>
                {confirmation.optionalSubjects?.length > 0 && (
                  <div><strong style={{ color: "#86efac" }}>Optional subjects:</strong> {confirmation.optionalSubjects.join(", ")}</div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="primary-btn" onClick={() => setConfirmation(null)}>
                  Okay
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <div className="panel-alert panel-alert-error">{error}</div>}
      {success && <div className="panel-alert panel-alert-success">{success}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)", gap: "1rem" }}>
        <form className="panel-card" onSubmit={handleSubmit} style={{ background: "rgba(15,23,42,0.58)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ color: "#4ade80", fontSize: "0.76rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>
            {editingId ? "Update Learner" : "Register Learner"}
          </div>

          <div style={{ display: "grid", gap: "0.9rem", marginTop: "1rem" }}>
            <label style={fieldLabelStyle}>
              <span>Name</span>
              <input
                style={fieldInputStyle}
                value={form.name}
                onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
              <label style={fieldLabelStyle}>
                <span>Gender</span>
                <select
                  style={fieldInputStyle}
                  value={form.gender}
                  onChange={(event) => setForm((previous) => ({ ...previous, gender: event.target.value }))}
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </label>
              <label style={fieldLabelStyle}>
                <span>Class</span>
                <select
                  style={fieldInputStyle}
                  value={form.class_level}
                  onChange={(event) => setForm((previous) => ({ ...previous, class_level: event.target.value }))}
                >
                  {CLASSES.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>

            <label style={fieldLabelStyle}>
              <span>Date of Birth</span>
              <input
                style={fieldInputStyle}
                type="date"
                value={form.dob}
                onChange={(event) => setForm((previous) => ({ ...previous, dob: event.target.value }))}
              />
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
            <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap", alignItems: "center" }}>
              <input
                style={{ ...filterControlStyle, minWidth: "210px" }}
                placeholder="Search learner"
                value={filters.q}
                onChange={(event) => setFilters((previous) => ({ ...previous, q: event.target.value }))}
              />
              <select
                style={{ ...filterControlStyle, minWidth: "150px" }}
                value={filters.class_level}
                onChange={(event) => setFilters((previous) => ({ ...previous, class_level: event.target.value }))}
              >
                <option value="">All Classes</option>
                {CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <button type="button" className="ghost-btn" onClick={handleDownloadCsv} disabled={exportingCsv || exportingPdf}>
                {exportingCsv ? "Preparing CSV..." : "Download CSV"}
              </button>
              <button type="button" className="ghost-btn" onClick={handleDownloadPdf} disabled={exportingPdf || exportingCsv}>
                {exportingPdf ? "Preparing PDF..." : "Download PDF"}
              </button>
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
