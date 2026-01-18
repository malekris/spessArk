import { useMemo, useState, useEffect } from "react";
import jsPDF from "jspdf";

const TOTAL_SUBJECTS = 16;
const TERMS = [1, 2, 3];

export default function AssessmentSubmissionTracker({ marksSets = [], refreshMarks }) {
  useEffect(() => {
    console.log("TRACKER marksSets:", marksSets);
  }, [marksSets]);
  useEffect(() => {
    if (typeof refreshMarks === "function") {
      refreshMarks();
    }
  }, [refreshMarks]);
  
  const [selectedTerm, setSelectedTerm] = useState(1);
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

    filtered.forEach(m => {
      const key = `${m.class_level}-${m.stream}`;

      if (!map[key]) {
        map[key] = {
          class_level: m.class_level,
          stream: m.stream,
          subjects: new Map()
        };
      }

      map[key].subjects.set(m.subject, m.teacher_name || "—");
    });

    return Object.values(map);
  }, [filtered]);
  // PDF 
  const handleDownloadTrackerPdf = () => {
    const doc = new jsPDF("p", "mm", "a4");
  
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
  
    const generatedAt = new Date().toLocaleString();
    const schoolName = "St. Phillip's Equatorial Secondary School (SPESS)";
    const title = `Assessment Submission Tracker — Term ${selectedTerm}`;
  
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
      const percent = Math.round((submittedCount / TOTAL_SUBJECTS) * 100);
      const missing = TOTAL_SUBJECTS - submittedCount;
  
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
        `${submittedCount}/${TOTAL_SUBJECTS} subjects submitted (${percent}%) — Missing: ${missing}`,
        14,
        y
      );
      y += 6;
  
      doc.setFontSize(9);
  
      [...group.subjects.entries()].forEach(([subject, teacher]) => {
        if (y > pageH - 20) {
          doc.addPage();
          y = 20;
        }
        doc.text(`• ${subject} — ${teacher}`, 18, y);
        y += 5;
      });
  
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
    <h2>Assessment Submission Tracker</h2>
    <p>Track subject submissions per class and stream.</p>
  </div>

  {/* TERM TOGGLE + PDF EXPORT — ALWAYS VISIBLE */}
  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
    {TERMS.map(t => (
      <button
        key={t}
        className={t === selectedTerm ? "primary-btn" : "ghost-btn"}
        onClick={() => setSelectedTerm(t)}
      >
        Term {t}
      </button>
    ))}

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
            No submissions recorded for Term {selectedTerm} yet.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {grouped.map(group => {
            const submittedCount = group.subjects.size;
            const percent = Math.round((submittedCount / TOTAL_SUBJECTS) * 100);

            const missingCount = TOTAL_SUBJECTS - submittedCount;

            return (
              <div key={`${group.class_level}-${group.stream}`} className="panel-card">
                <h3>
                  {group.class_level} {group.stream}
                </h3>

                {/* Progress */}
                <div style={{ margin: "0.6rem 0" }}>
                  <div style={{ fontSize: "0.85rem", marginBottom: "0.3rem" }}>
                    {submittedCount}/{TOTAL_SUBJECTS} subjects submitted ({percent}%)
                  </div>

                  <div style={{
                    height: "10px",
                    borderRadius: "999px",
                    background: "rgba(255,255,255,0.08)",
                    overflow: "hidden"
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${percent}%`,
                      background: percent > 70 ? "#22c55e" : percent > 40 ? "#facc15" : "#ef4444",
                      transition: "width 0.4s ease"
                    }} />
                  </div>
                </div>

                {/* Submitted */}
                <details>
                  <summary>✅ Submitted subjects</summary>
                  <ul>
                    {[...group.subjects.entries()].map(([subject, teacher]) => (
                      <li key={subject}>
                        {subject} — 👨‍🏫 {teacher}
                      </li>
                    ))}
                  </ul>
                </details>

                {/* Missing */}
                <details>
                  <summary>❌ Missing subjects ({missingCount})</summary>
                  <p className="muted-text">
                    Remaining subjects not yet submitted.
                  </p>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
