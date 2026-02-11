// =========================
// src/modules/alevel/pages/ALevelLearners.jsx
// =========================

// -------------------------
// Imports
// -------------------------
import { useEffect, useState } from "react";
import { plainFetch } from "../../../lib/api";
import { useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import useIdleLogout from "../../../hooks/useIdleLogout";

// -------------------------
// Constants
// -------------------------
const API = "/api/alevel";

const HOUSES = ["Muteesa", "Ssuuna", "Mutebi", "Chwa"];
const STREAMS = ["S5 Arts", "S5 Sciences", "S6 Arts", "S6 Sciences"];

const SCIENCE_SUBJECTS = [
  "Physics",
  "Mathematics",
  "Economics",
  "Biology",
  "Chemistry",
  "Agriculture",
];

const ARTS_SUBJECTS = [
  "History",
  "Entrepreneurship",
  "Economics",
  "Geography",
  "Art",
  "Divinity",
  "Literature",
  "Luganda",
  "Kiswahili",
  "Islam",
];

const SUBSIDIARIES = ["SubMath", "Sub ICT"];

const SUBJECT_CODES = {
  Physics: "P",
  Chemistry: "C",
  Mathematics: "M",
  Biology: "B",
  Economics: "E",
  Geography: "G",
  History: "H",
  Literature: "L",
  Divinity: "D",
  Art: "A",
  Entrepreneurship: "Ent",
  Luganda: "Lu",
  Kiswahili: "Ki",
  Islam: "Is",
  Agriculture: "Ag",
};

// -------------------------
// Helpers
// -------------------------
function buildCombination(principals = [], subsidiaries = []) {
  if (principals.length !== 3) return "";

  const base = principals.map((s) => SUBJECT_CODES[s] || (s[0] || "")).join("");
  let suffix = "";
  if (subsidiaries.includes("Sub ICT")) suffix = "/ICT";
  if (subsidiaries.includes("SubMath")) suffix = "/SM";
  return base + suffix;
}

function formatDateForInput(raw) {
  if (!raw) return "";
  // handle "YYYY-MM-DDTHH:MM:SSZ" or "YYYY-MM-DD"
  const d = String(raw).trim();
  if (d.length >= 10) return d.slice(0, 10);
  return d;
}

// -------------------------
// Component
// -------------------------
export default function ALevelLearners() {
  // -----------------------
  // Navigation
  // -----------------------
  const navigate = useNavigate();
  const IDLE_20_MIN = 20 * 60 * 1000;

  // -----------------------
  // Local state
  // -----------------------
  const [learners, setLearners] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState(null);

  const emptyForm = {
    name: "",
    gender: "",
    dob: "",
    house: "",
    stream: "",
    combination: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [principals, setPrincipals] = useState([]);
  const [subsidiaries, setSubsidiaries] = useState([]);
  // PDF export selectors
  const [pdfClass, setPdfClass] = useState("");
  const [pdfStream, setPdfStream] = useState("");

  // filters & search
  const [search, setSearch] = useState("");
  const [filterStream, setFilterStream] = useState("");
  const [filterClass, setFilterClass] = useState("");

  useIdleLogout(() => {
    localStorage.removeItem("SPESS_ADMIN_KEY");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("adminToken");
    sessionStorage.removeItem("isAdmin");
    navigate("/ark", { replace: true });
  }, IDLE_20_MIN);

  // -----------------------
  // Derived values
  // -----------------------
  const subjectPool =
    form.stream.includes("Sciences")
      ? SCIENCE_SUBJECTS
      : form.stream.includes("Arts")
      ? ARTS_SUBJECTS
      : [];

      const filteredLearners = learners.filter((l) => {
        if (filterClass && !l.stream.startsWith(filterClass)) return false;
        if (filterStream && l.stream !== filterStream) return false;
        if (search && !String(l.name || "").toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      });
      const pdfLearners = learners.filter((l) => {
        if (pdfClass && !l.stream.startsWith(pdfClass)) return false;
        if (pdfStream && !l.stream.endsWith(pdfStream)) return false;
        return true;
      });
      

  // -----------------------
  // Effects
  // -----------------------
  useEffect(() => {
    fetchLearners();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto-generate combination when principals/subs change
  useEffect(() => {
    const combo = buildCombination(principals, subsidiaries);
    setForm((p) => ({ ...p, combination: combo }));
  }, [principals, subsidiaries]);

  // -----------------------
  // API / fetch functions
  // -----------------------
  async function fetchLearners() {
    setLoading(true);
    setError("");
    try {
      const data = await plainFetch(`${API}/learners`);
      setLearners(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("fetchLearners", err);
      setError("Failed to load learners");
      setLearners([]);
    } finally {
      setLoading(false);
    }
  }

  // -----------------------
  // Handlers / UI actions
  // -----------------------
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
    setError("");
  };

  // principal toggle with enforcement (max 3)
  const togglePrincipal = (subject) => {
    setError("");
    setPrincipals((prev) => {
      if (prev.includes(subject)) return prev.filter((s) => s !== subject);
      if (prev.length >= 3) {
        setError("You must select exactly 3 principal subjects.");
        return prev;
      }
      return [...prev, subject];
    });
  };

  // generic toggle for subsidiaries
  const toggleSubsidiary = (subject) => {
    setError("");
    setSubsidiaries((prev) => (prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]));
  };

  const buildPayload = () => ({ ...form, subjects: ["General Paper", ...principals, ...subsidiaries] });

  const saveLearner = async (e) => {
    e?.preventDefault();
    setError("");

    if (!form.name || !form.gender || !form.dob || !form.house || !form.stream) {
      setError("Fill all required fields");
      return;
    }

    if (principals.length !== 3) {
      setError("Learner must have exactly 3 principal subjects.");
      return;
    }

    const payload = buildPayload();

    try {
      if (editing) {
        await plainFetch(`${API}/learners/${editing.id}`, { method: "PUT", body: payload });
      } else {
        await plainFetch(`${API}/learners`, { method: "POST", body: payload });
      }

      // reset
      setForm(emptyForm);
      setPrincipals([]);
      setSubsidiaries([]);
      setEditing(null);
      fetchLearners();
    } catch (err) {
      console.error("saveLearner", err);
      setError("Save failed");
    }
  };

  const handleEdit = (l) => {
    setEditing(l);
    setForm({
      name: l.name || "",
      gender: l.gender || "",
      dob: formatDateForInput(l.dob),
      house: l.house || "",
      stream: l.stream || "",
      combination: l.combination || "",
    });

    const subs = (l.subjects || "").split(",").map((s) => s.trim());
    setPrincipals(subs.filter((s) => !SUBSIDIARIES.includes(s) && s !== "General Paper"));
    setSubsidiaries(subs.filter((s) => SUBSIDIARIES.includes(s)));
    setError("");
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete learner?")) return;
    try {
      await plainFetch(`${API}/learners/${id}`, { method: "DELETE" });
      fetchLearners();
    } catch (err) {
      console.error("delete", err);
      setError("Delete failed");
    }
  };

  // -----------------------
  // Export helpers
  // -----------------------
  const downloadCSV = () => {
    const rows = filteredLearners.map((l, i) => [i + 1, l.name, l.gender, l.house, l.stream, l.combination, l.subjects]);
    const csv = [["#", "Name", "Gender", "House", "Stream", "Combination", "Subjects"], ...rows]
      .map((r) => r.map((v) => `"${v || ""}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    window.open(URL.createObjectURL(blob));
  };

  const handleDownloadAlevelClasslistPdf = () => {
    if (!pdfClass || !pdfStream) {
      setError("Please select both class and stream for PDF export.");
      return;
    }
    
    if (pdfLearners.length === 0) {
      setError("No learners found for selected class and stream.");
      return;
    }
    
    const doc = new jsPDF("p", "mm", "a4");
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const generatedAt = new Date().toLocaleString();
    const schoolName = "St. Phillip's Equatorial Secondary School (SPESS)";
    const title = "A-Level Learners Class List";
    const classLabel = filterClass || "All";
    const streamLabel = filterStream || "All";
    const filtered = search || filterClass || filterStream ? "Yes" : "No";
    const totalCount = filteredLearners.length;

    const subtitle = `Class: ${pdfClass}   |   Stream: ${pdfStream}`;

    const topMargin = 16;
    const firstHeaderHeight = 60;
    const continuationHeaderHeight = 14;
    const tableHeaderHeight = 8;
    const bottomMargin = 18;
    const baseRowHeight = 7;
    let y;

    const drawFirstPageHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(schoolName, pageW / 2, 16, { align: "center" });
      doc.setFontSize(16);
      doc.text(title, pageW / 2, 26, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Generated: ${generatedAt}`, 14, 38);
      doc.text(`Class: ${classLabel}`, 14, 44);
      doc.text(`Stream: ${streamLabel}`, 14, 50);
      doc.text(`Filtered: ${filtered}`, 14, 56);
      doc.text(`Total learners: ${totalCount}`, 14, 62);
      doc.setFontSize(10);
      doc.text(subtitle, pageW / 2, 32, { align: "center" });

    };

    const drawContinuationHeader = () => {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text(title, 14, 12);
    };

    const drawTableHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("#", 12, y);
      doc.text("Name", 18, y);
      doc.text("Gender", 70, y);
      doc.text("Stream", 92, y);
      doc.text("Comb.", 128, y);
      doc.text("Subjects", 150, y);
      doc.setDrawColor(180);
      doc.line(10, y + 2, pageW - 10, y + 2);
      y += tableHeaderHeight;
      doc.setFont("helvetica", "normal");
    };

    const drawFooter = (pageNo, total) => {
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(`Generated from SPESS ARK · ${generatedAt} · Page ${pageNo} of ${total}`, pageW / 2, pageH - 8, { align: "center" });
    };

    drawFirstPageHeader();
    y = topMargin + firstHeaderHeight;
    drawTableHeader();

    const rows = pdfLearners;
    rows.forEach((l, idx) => {
      const subjectsText = (l.subjects || "").toString();
      const subjectLines = doc.splitTextToSize(subjectsText, pageW - 160);
      const rowHeight = Math.max(baseRowHeight, subjectLines.length * 5.5);
      if (y + rowHeight > pageH - bottomMargin) {
        doc.addPage();
        drawContinuationHeader();
        y = topMargin + continuationHeaderHeight;
        drawTableHeader();
      }
      doc.setFontSize(9);
      doc.text(String(idx + 1), 12, y);
      doc.text(l.name || "", 18, y);
      doc.text(l.gender || "", 70, y);
      doc.text(l.stream || "", 92, y);
      doc.text(l.combination || "—", 128, y);
      doc.text(subjectLines, 150, y);
      y += rowHeight;
    });

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawFooter(i, totalPages);
    }

    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  // -----------------------
  // Main render
  // -----------------------
  return (
    <div style={{ padding: "2rem", color: "#e5e7eb" }}>
      <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel")}>← Back to A-Level Dashboard</button>

      <h1>A-Level Learners</h1>

      {error && <div className="panel-alert panel-alert-error">{error}</div>}

      <div style={{ display: "flex", gap: "0.6rem", margin: "0.75rem 0 1rem 0", alignItems: "center" }}>
  
  {/* Search */}
  <input
    placeholder="Search learner by name..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    style={{ padding: "0.4rem 0.7rem", borderRadius: "999px", background: "#0f172a", border: "1px solid #334155", color: "#e5e7eb", minWidth: 220 }}
  />

  {/* Class filter */}
  <select
    value={filterClass}
    onChange={(e) => setFilterClass(e.target.value)}
    style={{ padding: "0.4rem 0.6rem", borderRadius: "0.6rem", background: "#0f172a", border: "1px solid #334155", color: "#e5e7eb" }}
  >
    <option value="">All classes</option>
    <option value="S5">S5</option>
    <option value="S6">S6</option>
  </select>

  {/* Stream filter */}
  <select
    value={filterStream}
    onChange={(e) => setFilterStream(e.target.value)}
    style={{ padding: "0.4rem 0.6rem", borderRadius: "0.6rem", background: "#0f172a", border: "1px solid #334155", color: "#e5e7eb" }}
  >
    <option value="">All streams</option>
    {STREAMS.map((s) => (
      <option key={s} value={s}>{s}</option>
    ))}
  </select>
      </div>


      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "1.5rem" }}>
        {/* FORM */}
        <div className="panel-card">
          <h3>{editing ? "Edit Learner" : "Register Learner"}</h3>

          <form onSubmit={saveLearner} className="teacher-form">
            {/* Full name */}
            <div className="form-row">
              <label>Full Name</label>
              <input name="name" value={form.name} onChange={handleChange} placeholder="e.g. Kato John" />
              <div className="muted-text">Enter first and last name</div>
            </div>

            {/* Gender */}
            <div className="form-row">
              <label>Gender</label>
              <select name="gender" value={form.gender} onChange={handleChange}>
                <option value="">Select gender</option>
                <option>Male</option>
                <option>Female</option>
              </select>
            </div>

            {/* Date of birth */}
            <div className="form-row">
              <label>Date of Birth</label>
              <input type="date" name="dob" value={form.dob} onChange={handleChange} />
              <div className="muted-text">Use official birth documents if available</div>
            </div>

            {/* House */}
            <div className="form-row">
              <label>House</label>
              <select name="house" value={form.house} onChange={handleChange}>
                <option value="">Select house</option>
                {HOUSES.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>

            {/* Stream */}
            <div className="form-row">
              <label>Stream</label>
              <select name="stream" value={form.stream} onChange={handleChange}>
                <option value="">Select stream</option>
                {STREAMS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="muted-text">Subjects update automatically based on stream</div>
            </div>

            {/* Combination (auto) */}
            <div className="form-row">
              <label>Combination</label>
              <input name="combination" value={form.combination} disabled placeholder="Auto-generated from selected principals" />
              <div className="muted-text">Generated automatically from selected principals</div>
            </div>

            {/* Subjects */}
            {subjectPool.length > 0 && (
              <>
                <div className="form-row">
                  <label>Principal Subjects (pick exactly 3)</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                    {subjectPool.map((s) => (
                      <label key={s} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                        <input type="checkbox" checked={principals.includes(s)} onChange={() => togglePrincipal(s)} />
                        <span>{s}</span>
                      </label>
                    ))}
                  </div>
                  <div className="muted-text">Exactly 3 principal subjects are required</div>
                </div>

                <div className="form-row">
                  <label>Subsidiaries (optional)</label>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    {SUBSIDIARIES.map((s) => (
                      <label key={s} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                        <input type="checkbox" checked={subsidiaries.includes(s)} onChange={() => toggleSubsidiary(s)} />
                        <span>{s}</span>
                      </label>
                    ))}
                  </div>
                  <div className="muted-text">General Paper is automatically included</div>
                </div>
              </>
            )}

            <button className="primary-btn">{editing ? "Update Learner" : "Save Learner"}</button>
          </form>
        </div>

        {/* LIST */}
       {/* LIST */}
<div className="panel-card">
  {/* Header row */}
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
    <h3>Registered Learners</h3>

    {/* PDF selector */}
    <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
      {/* PDF Class */}
      <select
        value={pdfClass}
        onChange={(e) => setPdfClass(e.target.value)}
        style={{ padding: "0.35rem", borderRadius: "0.4rem" }}
      >
        <option value="">Class</option>
        <option value="S5">S5</option>
        <option value="S6">S6</option>
      </select>

      {/* PDF Stream */}
      <select
        value={pdfStream}
        onChange={(e) => setPdfStream(e.target.value)}
        style={{ padding: "0.35rem", borderRadius: "0.4rem" }}
      >
        <option value="">Stream</option>
        <option value="Arts">Arts</option>
        <option value="Sciences">Sciences</option>
      </select>

      <button className="primary-btn" onClick={handleDownloadAlevelClasslistPdf}>
        Download PDF
      </button>
    </div>
  </div>

  {/* Table */}
  {loading ? (
    <p>Loading...</p>
  ) : (
    <div className="teachers-table-wrapper" style={{ marginTop: "0.6rem" }}>
      <table className="teachers-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Stream</th>
            <th>Subjects</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filteredLearners.length === 0 ? (
            <tr>
              <td colSpan="5" style={{ textAlign: "center", padding: "1rem" }}>
                No learners found
              </td>
            </tr>
          ) : (
            filteredLearners.map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td>{l.name}</td>
                <td>{l.stream}</td>
                <td>{l.subjects}</td>
                <td>
                  <button className="ghost-btn" onClick={() => handleEdit(l)}>Edit</button>
                  <button className="danger-link" onClick={() => handleDelete(l.id)}>Delete</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )}
</div>
     
      </div>
    </div>
  );
}
