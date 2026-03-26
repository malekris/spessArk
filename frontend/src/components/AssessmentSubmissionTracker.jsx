import { useMemo, useState, useEffect } from "react";
import { loadPdfTools } from "../utils/loadPdfTools";

const OFFICIAL_SUBJECTS = [
  "ICT",
  "Physical Education",
  "Luganda",
  "Christian Religious Education",
  "IRE",
  "Agriculture",
  "Art",
  "Literature",
  "Entrepreneurship",
  "Kiswahili",
  "English",
  "Mathematics",
  "Physics",
  "Biology",
  "Chemistry",
  "History",
  "Geography",
];
const TERMS = [1, 2, 3];
const DEFAULT_COMPONENT_OPTIONS = [
  { value: "AOI1", label: "AOI 1" },
  { value: "AOI2", label: "AOI 2" },
  { value: "AOI3", label: "AOI 3" },
];
const keyOf = (cls, stream) => `${cls}||${stream}`;

export default function AssessmentSubmissionTracker({
  marksSets = [],
  refreshMarks,
  officialSubjects = OFFICIAL_SUBJECTS,
  assignmentsEndpoint = "/api/admin/assignments",
  seedGroups = [],
  title = "Assessment Submission Tracker",
  subtitle = "Track subject submissions per class and stream.",
  componentOptions = DEFAULT_COMPONENT_OPTIONS,
}) {
  const [selectedTerm, setSelectedTerm] = useState(1);
  const [selectedComponent, setSelectedComponent] = useState(
    componentOptions[0]?.value || DEFAULT_COMPONENT_OPTIONS[0].value
  );
  const [expectedByGroup, setExpectedByGroup] = useState({});
  const selectedComponentLabel =
    componentOptions.find((option) => option.value === selectedComponent)?.label ||
    componentOptions[0]?.label ||
    "AOI 1";

  useEffect(() => {
    const nextDefault = componentOptions[0]?.value || DEFAULT_COMPONENT_OPTIONS[0].value;
    const stillValid = componentOptions.some((option) => option.value === selectedComponent);
    if (!stillValid) {
      setSelectedComponent(nextDefault);
    }
  }, [componentOptions, selectedComponent]);

  useEffect(() => {
    const loadExpectedSubjects = async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_BASE || "http://localhost:5001"}${assignmentsEndpoint}`,
          {
            headers: {
              "x-admin-key": localStorage.getItem("SPESS_ADMIN_KEY") || "",
              Authorization: `Bearer ${localStorage.getItem("adminToken") || ""}`,
            },
          }
        );
        if (!res.ok) throw new Error("Failed to load assignments");
        const rows = await res.json();
        const map = {};
        (Array.isArray(rows) ? rows : []).forEach((r) => {
          const stream = r.stream || "";
          const classLevel = r.class_level || "A-Level";
          if (!stream || !r.subject) return;
          const k = keyOf(classLevel, stream);
          if (!map[k]) map[k] = new Set();
          map[k].add(r.subject);
        });
        setExpectedByGroup(map);
      } catch (err) {
        console.error("TRACKER expected subjects load failed:", err);
        setExpectedByGroup({});
      }
    };

    loadExpectedSubjects();
  }, []);
  // Filter marks by selected term
  const filtered = useMemo(() => {
    return marksSets.filter((m) => {
      const raw = String(m.term ?? "").toLowerCase();
  
      // Handle formats like "1", "Term 1", "T1"
      if (raw.includes("1")) return selectedTerm === 1;
      if (raw.includes("2")) return selectedTerm === 2;
      if (raw.includes("3")) return selectedTerm === 3;
  
      // fallback if it's numeric
      const n = Number(m.term);
      if (!Number.isNaN(n)) return n === selectedTerm;
  
      return false;
    });
  }, [marksSets, selectedTerm]);
  
  // Group by class + stream
  const grouped = useMemo(() => {
    const map = {};

    // Seed fixed groups (useful for A-Level streams even before marks are submitted)
    (Array.isArray(seedGroups) ? seedGroups : []).forEach((g) => {
      const classLevel = g?.class_level || "A-Level";
      const stream = g?.stream || "";
      if (!stream) return;
      const k = keyOf(classLevel, stream);
      if (!map[k]) {
        map[k] = {
          class_level: classLevel,
          stream,
          subjects: new Map(),
          expectedSubjects: new Set(officialSubjects),
        };
      }
    });

    // Seed groups from assignments so missing subjects can be listed accurately.
    Object.entries(expectedByGroup).forEach(([k, subjectSet]) => {
      const [class_level, stream] = k.split("||");
      map[k] = {
        class_level,
        stream,
        subjects: new Map(),
        expectedSubjects: new Set(subjectSet),
      };
    });

    filtered.forEach((m) => {
      const normalizedAoi = String(m.aoi_label || "").trim().toUpperCase();
      if (normalizedAoi !== selectedComponent) return;

      const key = keyOf(m.class_level, m.stream);

      if (!map[key]) {
        map[key] = {
          class_level: m.class_level,
          stream: m.stream,
          subjects: new Map(),
          expectedSubjects: new Set(expectedByGroup[key] || []),
        };
      }

      const existing = map[key].subjects.get(m.subject) || {
        teacher: m.teacher_name || "—",
        aois: new Set(),
      };
      if (m.teacher_name) existing.teacher = m.teacher_name;
      if (normalizedAoi) existing.aois.add(normalizedAoi);
      map[key].subjects.set(m.subject, existing);
    });

    return Object.values(map).map((group) => {
      const submittedSubjects = new Set(group.subjects.keys());
      const expectedSubjects = Array.from(
        group.expectedSubjects && group.expectedSubjects.size ? group.expectedSubjects : new Set(officialSubjects)
      );
      const missingSubjects = expectedSubjects.filter((subject) => !submittedSubjects.has(subject));
      return {
        ...group,
        missingSubjects,
        expectedTotal: expectedSubjects.length,
      };
    });
  }, [filtered, expectedByGroup, officialSubjects, seedGroups, selectedComponent]);
  // PDF 
  const handleDownloadTrackerPdf = async () => {
    const { jsPDF } = await loadPdfTools();
    const doc = new jsPDF("p", "mm", "a4");
  
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
  
    const generatedAt = new Date().toLocaleString();
    const schoolName = "St. Phillip's Equatorial Secondary School (SPESS)";
    const title = `Assessment Submission Tracker — Term ${selectedTerm} — ${selectedComponentLabel}`;
  
    let y = 18;
  
    // ===== HEADER =====
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(schoolName, pageW / 2, y, { align: "center" });
  
    y += 8;
    doc.setFontSize(16);
    doc.text(title, pageW / 2, y, { align: "center" });
  
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Generated: ${generatedAt}`, pageW / 2, y, { align: "center" });
  
    y += 10;
  
    // ===== BODY =====
    grouped.forEach((group, index) => {
      const submittedCount = group.subjects.size;
      const expectedTotal = Math.max(1, group.expectedTotal || officialSubjects.length);
      const percent = Math.round((submittedCount / expectedTotal) * 100);
      const missing = group.missingSubjects.length;
  
      // Page break
      if (y > pageH - 30) {
        doc.addPage();
        y = 20;
      }
  
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(`${group.class_level} ${group.stream}`, 14, y);
      y += 6;
  
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(
        `${submittedCount}/${expectedTotal} subjects submitted (${percent}%) — Missing: ${missing}`,
        14,
        y
      );
      y += 6;
  
      doc.setFontSize(9);
  
      [...group.subjects.entries()].forEach(([subject, meta]) => {
        if (y > pageH - 20) {
          doc.addPage();
          y = 20;
        }
        doc.text(`• ${subject} — ${meta?.teacher || "—"} (${selectedComponentLabel} submitted)`, 18, y);
        y += 5;
      });

      if (group.missingSubjects.length > 0) {
        y += 2;
        doc.setFont("helvetica", "bold");
        doc.text("Missing subjects:", 14, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        group.missingSubjects.forEach((subject) => {
          if (y > pageH - 20) {
            doc.addPage();
            y = 20;
          }
          doc.text(`• ${subject}`, 18, y);
          y += 5;
        });
      }
  
      y += 6;
    });
  
    // ===== FOOTER PAGE NUMBERS =====
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.text(
        `Generated from SPESS ARK · Page ${i} of ${totalPages}`,
        pageW / 2,
        pageH - 8,
        { align: "center" }
      );
    }
  
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  
  return (
    <section className="panel">
      <div className="panel-header">
          <div>
    <h2>{title}</h2>
    <p>{subtitle} Use the selector to switch between the available assessment components.</p>
  </div>

  {/* TERM TOGGLE + PDF EXPORT — ALWAYS VISIBLE */}
  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
    {TERMS.map(t => (
      <button
        key={t}
        className={t === selectedTerm ? "primary-btn" : "ghost-btn"}
        onClick={() => setSelectedTerm(t)}
      >
        Term {t}
      </button>
    ))}

    <select
      value={selectedComponent}
      onChange={(event) => setSelectedComponent(event.target.value)}
      className="admin-ops-select"
      style={{ minWidth: "112px", cursor: "pointer" }}
      aria-label="Select assessment component to visualize"
    >
      {componentOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>

    {/* PDF EXPORT BUTTON */}
    <button
      className="ghost-btn"
      onClick={handleDownloadTrackerPdf}
      style={{ marginLeft: "0.4rem" }}
      title="Export tracker as PDF"
    >
      📄 Export PDF
    </button>
  </div>
</div>


      {/* CONTENT */}
      {grouped.length === 0 ? (
        <div className="panel-card">
          <p className="muted-text">
            No submissions recorded for {selectedComponentLabel} in Term {selectedTerm} yet.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {grouped.map(group => {
            const submittedCount = group.subjects.size;
            const expectedTotal = Math.max(1, group.expectedTotal || officialSubjects.length);
            const percent = Math.round((submittedCount / expectedTotal) * 100);

            const missingCount = group.missingSubjects.length;

            return (
              <div key={`${group.class_level}-${group.stream}`} className="panel-card">
                <h3>
                  {group.class_level} {group.stream}
                </h3>

                {/* Progress */}
                <div style={{ margin: "0.6rem 0" }}>
                  <div style={{ fontSize: "0.85rem", marginBottom: "0.3rem" }}>
                    {submittedCount}/{expectedTotal} subjects submitted for {selectedComponentLabel} ({percent}%)
                  </div>

                  <div style={{
                    height: "14px",
                    borderRadius: "999px",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(148,163,184,0.08))",
                    border: "1px solid rgba(148,163,184,0.35)",
                    overflow: "hidden",
                    boxShadow: "inset 0 2px 6px rgba(2,6,23,0.6)",
                    position: "relative",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${percent}%`,
                      background:
                        percent > 70
                          ? "linear-gradient(90deg, #16a34a 0%, #22c55e 55%, #4ade80 100%)"
                          : percent > 40
                          ? "linear-gradient(90deg, #d97706 0%, #f59e0b 55%, #fbbf24 100%)"
                          : "linear-gradient(90deg, #b91c1c 0%, #ef4444 55%, #f87171 100%)",
                      transition: "width 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
                      borderRadius: "999px",
                      boxShadow: "0 0 12px rgba(34,197,94,0.25)",
                    }} />
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.02))",
                        pointerEvents: "none",
                      }}
                    />
                  </div>
                </div>

                {/* Submitted */}
                <details>
                  <summary>✅ Submitted subjects for {selectedComponentLabel}</summary>
                  <ul>
                    {[...group.subjects.entries()].map(([subject, meta]) => (
                      <li key={subject}>
                        {subject} — 👨‍🏫 {meta?.teacher || "—"} — {selectedComponentLabel} recorded
                      </li>
                    ))}
                  </ul>
                </details>

                {/* Missing */}
                <details>
                  <summary>❌ Missing subjects for {selectedComponentLabel} ({missingCount})</summary>
                  {group.missingSubjects.length === 0 ? (
                    <p className="muted-text">No missing subjects.</p>
                  ) : (
                    <ul>
                      {group.missingSubjects.map((subject) => (
                        <li key={subject}>{subject}</li>
                      ))}
                    </ul>
                  )}
                </details>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
