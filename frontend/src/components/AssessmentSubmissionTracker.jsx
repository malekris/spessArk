import { useMemo, useState, useEffect } from "react";
import { loadPdfTools } from "../utils/loadPdfTools";
import { adminFetch } from "../lib/api";

const TERMS = [1, 2, 3];
const DEFAULT_COMPONENT_OPTIONS = [
  { value: "AOI1", label: "AOI 1" },
  { value: "AOI2", label: "AOI 2" },
  { value: "AOI3", label: "AOI 3" },
];
const keyOf = (cls, stream) => `${cls}||${stream}`;
const normalizeSlotDisplay = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeTermNumber = (value) => {
  const compact = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "3" || compact === "term3" || compact === "iii" || compact === "termiii" || compact === "term1ii") return 3;
  if (compact === "2" || compact === "term2" || compact === "ii" || compact === "termii" || compact === "term1i") return 2;
  if (compact === "1" || compact === "term1" || compact === "i" || compact === "termi") return 1;
  return 1;
};

export default function AssessmentSubmissionTracker({
  marksSets = [],
  refreshMarks,
  assignmentsEndpoint = "/api/admin/assignments",
  seedGroups = [],
  title = "Assessment Submission Tracker",
  subtitle = "Track subject submissions per class and stream.",
  componentOptions = DEFAULT_COMPONENT_OPTIONS,
  trackedUnitLabel = "subjects",
  currentTerm = null,
  currentYear = null,
  lockToCurrentTerm = false,
}) {
  const drivenTerm = currentTerm ? normalizeTermNumber(currentTerm) : null;
  const drivenYear = Number(currentYear);
  const [selectedTerm, setSelectedTerm] = useState(drivenTerm || 1);
  const [selectedComponent, setSelectedComponent] = useState(
    componentOptions[0]?.value || DEFAULT_COMPONENT_OPTIONS[0].value
  );
  const [expectedByGroup, setExpectedByGroup] = useState({});
  const [assignmentsLoading, setAssignmentsLoading] = useState(true);
  const [assignmentsError, setAssignmentsError] = useState("");
  const [assignmentRefreshKey, setAssignmentRefreshKey] = useState(0);
  const selectedComponentLabel =
    componentOptions.find((option) => option.value === selectedComponent)?.label ||
    componentOptions[0]?.label ||
    "AOI 1";

  useEffect(() => {
    if (drivenTerm) {
      setSelectedTerm(drivenTerm);
    }
  }, [drivenTerm]);

  useEffect(() => {
    const nextDefault = componentOptions[0]?.value || DEFAULT_COMPONENT_OPTIONS[0].value;
    const stillValid = componentOptions.some((option) => option.value === selectedComponent);
    if (!stillValid) {
      setSelectedComponent(nextDefault);
    }
  }, [componentOptions, selectedComponent]);

  useEffect(() => {
    const loadExpectedSubjects = async () => {
      setAssignmentsLoading(true);
      setAssignmentsError("");
      try {
        const separator = assignmentsEndpoint.includes("?") ? "&" : "?";
        const rows = await adminFetch(`${assignmentsEndpoint}${separator}includeInactive=true`);
        const map = {};
        (Array.isArray(rows) ? rows : []).forEach((r) => {
          const assignmentStatus = String(r.assignment_status || "active").trim().toLowerCase();
          const stream = r.stream || "";
          const classLevel = r.class_level || "A-Level";
          const slotDisplay =
            r.subject_display ||
            (r.paper_label && r.paper_label !== "Single"
              ? `${r.subject} — ${r.paper_label}`
              : r.subject);
          const slotId = r.assignment_id ?? r.id ?? null;
          if (!stream || !slotDisplay) return;
          const k = keyOf(classLevel, stream);
          if (!map[k]) map[k] = new Map();
          const isActive = assignmentStatus === "active" && !r.ended_at;
          const matchingSlot = Array.from(map[k].values()).find(
            (assignment) =>
              normalizeSlotDisplay(assignment.display) === normalizeSlotDisplay(slotDisplay)
          );

          if (isActive) {
            if (matchingSlot) map[k].delete(matchingSlot.key);
            const slotKey = slotId
              ? `assignment:${slotId}`
              : `${classLevel}||${stream}||${slotDisplay}`;
            map[k].set(slotKey, {
              key: slotKey,
              display: slotDisplay,
              teacher: r.teacher_name || "—",
              isActive: true,
            });
          } else if (!matchingSlot) {
            const slotKey = `unassigned:${normalizeSlotDisplay(slotDisplay)}`;
            map[k].set(slotKey, {
              key: slotKey,
              display: slotDisplay,
              teacher: "Unassigned",
              isActive: false,
            });
          }
        });
        setExpectedByGroup(map);
      } catch (err) {
        console.error("TRACKER expected subjects load failed:", err);
        setExpectedByGroup({});
        setAssignmentsError(
          "Assignments could not be loaded. Submission compliance is unavailable until ownership is verified."
        );
      } finally {
        setAssignmentsLoading(false);
      }
    };

    loadExpectedSubjects();
  }, [assignmentRefreshKey, assignmentsEndpoint]);

  const handleRefresh = async () => {
    await Promise.resolve(refreshMarks?.());
    setAssignmentRefreshKey((value) => value + 1);
  };
  // Filter marks by selected term
  const filtered = useMemo(() => {
    return marksSets.filter((m) => {
      const termMatches = normalizeTermNumber(m.term) === selectedTerm;
      if (!termMatches) return false;

      if (Number.isFinite(drivenYear) && drivenYear > 0) {
        return Number(m.year) === drivenYear;
      }

      return true;
    });
  }, [drivenYear, marksSets, selectedTerm]);
  
  // Group by class + stream
  const grouped = useMemo(() => {
    const map = {};
    const buildSlotDisplay = (row) =>
      row?.subject_display ||
      (row?.paper_label && row.paper_label !== "Single"
        ? `${row.subject} — ${row.paper_label}`
        : row?.subject || "—");
    const buildSlotKey = (row) => {
      const slotId = row?.assignment_id ?? row?.id ?? null;
      if (slotId) return `assignment:${slotId}`;
      return `${row?.class_level || "A-Level"}||${row?.stream || ""}||${buildSlotDisplay(row)}`;
    };
    const sortByDisplay = (a, b) => String(a.display || "").localeCompare(String(b.display || ""));

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
          items: new Map(),
          expectedItems: new Map(),
          orphanedItems: new Map(),
        };
      }
    });

    // Seed groups from assignments so missing subjects can be listed accurately.
    Object.entries(expectedByGroup).forEach(([k, expectedItems]) => {
      const [class_level, stream] = k.split("||");
      map[k] = {
        class_level,
        stream,
        items: new Map(),
        expectedItems: expectedItems instanceof Map ? expectedItems : new Map(),
        orphanedItems: new Map(),
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
          items: new Map(),
          expectedItems:
            expectedByGroup[key] instanceof Map
              ? expectedByGroup[key]
              : new Map(),
          orphanedItems: new Map(),
        };
      }

      const slotKey = buildSlotKey(m);
      const slotDisplay = buildSlotDisplay(m);
      const activeAssignment =
        map[key].expectedItems.get(slotKey) ||
        Array.from(map[key].expectedItems.values()).find(
          (assignment) =>
            assignment.isActive &&
            normalizeSlotDisplay(assignment.display) === normalizeSlotDisplay(slotDisplay)
        );

      if (!activeAssignment) {
        const orphaned = map[key].orphanedItems.get(slotKey) || {
          key: slotKey,
          display: slotDisplay,
          teacher: m.teacher_name || "—",
          reason: "No matching active assignment",
        };
        map[key].orphanedItems.set(slotKey, orphaned);
        return;
      }

      const verifiedSlotKey = activeAssignment.key;
      const existing = map[key].items.get(verifiedSlotKey) || {
        key: verifiedSlotKey,
        display: activeAssignment.display,
        teacher: activeAssignment.teacher,
        components: new Set(),
      };
      if (normalizedAoi) existing.components.add(normalizedAoi);
      map[key].items.set(verifiedSlotKey, existing);
    });

    return Object.values(map).map((group) => {
      const submittedKeys = new Set(group.items.keys());
      const submittedItems = Array.from(group.items.values()).sort(sortByDisplay);
      const expectedItems =
        group.expectedItems && group.expectedItems.size
          ? Array.from(group.expectedItems.values()).sort(sortByDisplay)
          : [];
      const missingItems = expectedItems
        .filter((item) => !submittedKeys.has(item.key))
        .map((item) => ({
          ...item,
          reason: item.isActive
            ? `${selectedComponentLabel} has not been submitted by ${item.teacher || "the assigned teacher"}`
            : "No active teacher assignment exists for this subject",
        }));
      return {
        ...group,
        submittedItems,
        missingItems,
        orphanedItems: Array.from(group.orphanedItems?.values?.() || []).sort(sortByDisplay),
        expectedTotal: expectedItems.length,
      };
    });
  }, [filtered, expectedByGroup, seedGroups, selectedComponent, selectedComponentLabel]);
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
    grouped.forEach((group) => {
      const submittedCount = group.submittedItems.length;
      const expectedTotal = group.expectedTotal;
      const percent = expectedTotal > 0 ? Math.round((submittedCount / expectedTotal) * 100) : 0;
      const missing = group.missingItems.length;
  
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
        `${submittedCount}/${expectedTotal} ${trackedUnitLabel} submitted (${percent}%) — Missing: ${missing}`,
        14,
        y
      );
      y += 6;
  
      doc.setFontSize(9);
  
      group.submittedItems.forEach((item) => {
        if (y > pageH - 20) {
          doc.addPage();
          y = 20;
        }
        doc.text(`• ${item.display} — ${item?.teacher || "—"} (${selectedComponentLabel} submitted)`, 18, y);
        y += 5;
      });

      if (group.missingItems.length > 0) {
        y += 2;
        doc.setFont("helvetica", "bold");
        doc.text(`Missing ${trackedUnitLabel}:`, 14, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        group.missingItems.forEach((item) => {
          if (y > pageH - 20) {
            doc.addPage();
            y = 20;
          }
          doc.text(
            `• ${item.display}${item.teacher && item.teacher !== "—" ? ` — ${item.teacher}` : ""} — ${item.reason}`,
            18,
            y
          );
          y += 5;
        });
      }

      if (group.orphanedItems.length > 0) {
        y += 2;
        doc.setFont("helvetica", "bold");
        doc.text("Data warnings (not counted as submitted):", 14, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        group.orphanedItems.forEach((item) => {
          if (y > pageH - 20) {
            doc.addPage();
            y = 20;
          }
          doc.text(
            `• ${item.display} — ${item.teacher || "Unknown teacher"} — ${item.reason}`,
            18,
            y
          );
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
    {lockToCurrentTerm ? (
      <span className="primary-btn" style={{ cursor: "default" }}>
        Term {selectedTerm}
      </span>
    ) : (
      TERMS.map(t => (
        <button
          key={t}
          className={t === selectedTerm ? "primary-btn" : "ghost-btn"}
          onClick={() => setSelectedTerm(t)}
        >
          Term {t}
        </button>
      ))
    )}

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
    <button
      type="button"
      className="ghost-btn"
      onClick={handleRefresh}
      disabled={assignmentsLoading}
    >
      {assignmentsLoading ? "Checking assignments..." : "Refresh"}
    </button>
  </div>
</div>

      {assignmentsError && (
        <div className="panel-alert panel-alert-error" role="alert">
          {assignmentsError}
        </div>
      )}

      {/* CONTENT */}
      {assignmentsLoading ? (
        <div className="panel-card">
          <p className="muted-text">Verifying active assignments before calculating submissions...</p>
        </div>
      ) : grouped.length === 0 ? (
        <div className="panel-card">
          <p className="muted-text">
            No submissions recorded for {selectedComponentLabel} in Term {selectedTerm} yet.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {grouped.map(group => {
            const submittedCount = group.submittedItems.length;
            const expectedTotal = group.expectedTotal;
            const percent =
              expectedTotal > 0 ? Math.round((submittedCount / expectedTotal) * 100) : 0;

            const missingCount = group.missingItems.length;

            return (
              <div key={`${group.class_level}-${group.stream}`} className="panel-card">
                <h3>
                  {group.class_level} {group.stream}
                </h3>

                {/* Progress */}
                <div style={{ margin: "0.6rem 0" }}>
                  <div style={{ fontSize: "0.85rem", marginBottom: "0.3rem" }}>
                    {submittedCount}/{expectedTotal} {trackedUnitLabel} submitted for {selectedComponentLabel} ({percent}%)
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
                  <summary>✅ Submitted {trackedUnitLabel} for {selectedComponentLabel}</summary>
                  {group.submittedItems.length === 0 ? (
                    <p className="muted-text">No verified submissions.</p>
                  ) : (
                    <ul>
                      {group.submittedItems.map((item) => (
                        <li key={item.key}>
                          {item.display} — 👨‍🏫 {item?.teacher || "—"} — {selectedComponentLabel} recorded
                        </li>
                      ))}
                    </ul>
                  )}
                </details>

                {/* Missing */}
                <details>
                  <summary>❌ Missing {trackedUnitLabel} for {selectedComponentLabel} ({missingCount})</summary>
                  {group.missingItems.length === 0 ? (
                    <p className="muted-text">No missing {trackedUnitLabel}.</p>
                  ) : (
                    <ul>
                      {group.missingItems.map((item) => (
                        <li key={item.key}>
                          {item.display}
                          {item.teacher && item.teacher !== "—" ? ` — 👨‍🏫 ${item.teacher}` : ""}
                          {` — ${item.reason}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>

                {group.orphanedItems.length > 0 && (
                  <details open>
                    <summary>
                      Data warnings: marks without an active assignment ({group.orphanedItems.length})
                    </summary>
                    <p className="muted-text">
                      These records are not counted as submitted. Create or restore the correct assignment, then verify the marks before using reports.
                    </p>
                    <ul>
                      {group.orphanedItems.map((item) => (
                        <li key={item.key}>
                          {item.display} — stored teacher: {item.teacher || "Unknown"} — {item.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
