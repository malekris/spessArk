import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import useIdleLogout from "../../../hooks/useIdleLogout";
import AssessmentSubmissionTracker from "../../../components/AssessmentSubmissionTracker";
import ALevelAdminShell from "../components/ALevelAdminShell";
import "../../../pages/AdminDashboard.css";
import "./ALevelAdminTheme.css";

const ALEVEL_TERMS = ["Term 1", "Term 2", "Term 3"];
const ALEVEL_TERM_ORDER = { "Term 1": 1, "Term 2": 2, "Term 3": 3 };

const normalizeAlevelTerm = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.includes("1")) return "Term 1";
  if (raw.includes("2")) return "Term 2";
  if (raw.includes("3")) return "Term 3";
  return String(value || "").trim() || "Term 1";
};

const normalizeAlevelComponent = (value = "") => String(value || "").trim().toUpperCase();

const getLatestAlevelPeriod = (sets = []) => {
  const normalized = (Array.isArray(sets) ? sets : [])
    .map((set) => ({
      term: normalizeAlevelTerm(set.term),
      year: Number(set.year),
    }))
    .filter((set) => Number.isFinite(set.year) && set.term);

  if (normalized.length === 0) {
    return { term: "Term 1", year: new Date().getFullYear() };
  }

  return normalized.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return (ALEVEL_TERM_ORDER[b.term] || 0) - (ALEVEL_TERM_ORDER[a.term] || 0);
  })[0];
};

export default function ALevelDashboard() {
  const navigate = useNavigate();
  const API_BASE = import.meta.env.VITE_API_BASE;
  const IDLE_20_MIN = 20 * 60 * 1000;

  const [stats, setStats] = useState(null);
  const [hoveredStat, setHoveredStat] = useState(null);
  const [hoveredAction, setHoveredAction] = useState(null);
  const [showTracker, setShowTracker] = useState(false);
  const [trackerMarksSets, setTrackerMarksSets] = useState([]);
  const [trackerSubjects, setTrackerSubjects] = useState([]);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState("");
  const [readinessAssignments, setReadinessAssignments] = useState([]);
  const [readinessMarksSets, setReadinessMarksSets] = useState([]);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState("");
  const [selectedReadinessTerm, setSelectedReadinessTerm] = useState("Term 1");
  const [selectedReadinessYear, setSelectedReadinessYear] = useState(new Date().getFullYear());
  const [readinessSelectionSeeded, setReadinessSelectionSeeded] = useState(false);

  const adminHeaders = useMemo(
    () => ({
      "x-admin-key": localStorage.getItem("SPESS_ADMIN_KEY") || "",
      Authorization: `Bearer ${localStorage.getItem("adminToken") || ""}`,
    }),
    []
  );

  useEffect(() => {
    fetch(`${API_BASE}/api/alevel/stats`)
      .then((res) => res.json())
      .then(setStats)
      .catch(console.error);
  }, [API_BASE]);

  useEffect(() => {
    const loadReadinessData = async () => {
      setReadinessLoading(true);
      setReadinessError("");
      try {
        const [assignmentsRes, marksSetsRes] = await Promise.all([
          fetch(`${API_BASE}/api/alevel/admin/assignments`, { headers: adminHeaders }),
          fetch(`${API_BASE}/api/alevel/admin/marks-sets`, { headers: adminHeaders }),
        ]);

        if (!assignmentsRes.ok) throw new Error("Failed to load A-Level assignments");
        if (!marksSetsRes.ok) throw new Error("Failed to load A-Level submissions");

        const [assignmentsData, marksSetsData] = await Promise.all([
          assignmentsRes.json(),
          marksSetsRes.json(),
        ]);

        const assignments = Array.isArray(assignmentsData) ? assignmentsData : [];
        const marksSets = Array.isArray(marksSetsData) ? marksSetsData : [];

        setReadinessAssignments(assignments);
        setReadinessMarksSets(marksSets);

        if (!readinessSelectionSeeded) {
          const latest = getLatestAlevelPeriod(marksSets);
          setSelectedReadinessTerm(latest.term);
          setSelectedReadinessYear(latest.year);
          setReadinessSelectionSeeded(true);
        }
      } catch (err) {
        console.error("A-Level readiness load error:", err);
        setReadinessError(err.message || "Failed to load readiness summary.");
      } finally {
        setReadinessLoading(false);
      }
    };

    loadReadinessData();
  }, [API_BASE, adminHeaders, readinessSelectionSeeded]);

  useIdleLogout(() => {
    localStorage.removeItem("SPESS_ADMIN_KEY");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("adminToken");
    sessionStorage.removeItem("isAdmin");
    navigate("/ark", { replace: true });
  }, IDLE_20_MIN);

  const fetchAlevelTrackerData = async () => {
    setTrackerLoading(true);
    setTrackerError("");
    try {
      const [setsRes, subjectsRes] = await Promise.all([
        fetch(`${API_BASE}/api/alevel/admin/marks-sets`),
        fetch(`${API_BASE}/api/alevel/subjects`),
      ]);

      const [setsData, subjectsData] = await Promise.all([
        setsRes.json(),
        subjectsRes.json(),
      ]);

      if (!setsRes.ok) throw new Error("Failed to load A-Level marks sets");
      if (!subjectsRes.ok) throw new Error("Failed to load A-Level subjects");

      setTrackerMarksSets(Array.isArray(setsData) ? setsData : []);
      setTrackerSubjects(
        Array.isArray(subjectsData)
          ? subjectsData.map((s) => s.name).filter(Boolean)
          : []
      );
    } catch (err) {
      setTrackerError(err.message || "Failed to load tracker data");
    } finally {
      setTrackerLoading(false);
    }
  };

  const openTracker = async () => {
    setShowTracker(true);
    if (trackerMarksSets.length === 0 || trackerSubjects.length === 0) {
      await fetchAlevelTrackerData();
    }
  };

  const readinessYearOptions = useMemo(() => {
    const years = Array.from(
      new Set(
        readinessMarksSets
          .map((set) => Number(set.year))
          .filter((year) => Number.isFinite(year) && year > 0)
      )
    ).sort((a, b) => b - a);

    if (years.length === 0) {
      years.push(new Date().getFullYear());
    }

    return years;
  }, [readinessMarksSets]);

  const effectiveReadinessYear = readinessYearOptions.includes(Number(selectedReadinessYear))
    ? Number(selectedReadinessYear)
    : readinessYearOptions[0];

  const readinessSummary = useMemo(() => {
    const assignments = Array.isArray(readinessAssignments) ? readinessAssignments : [];
    const filteredSets = (Array.isArray(readinessMarksSets) ? readinessMarksSets : []).filter(
      (set) =>
        normalizeAlevelTerm(set.term) === selectedReadinessTerm &&
        Number(set.year) === Number(effectiveReadinessYear)
    );

    const submittedKeys = new Set(
      filteredSets.map(
        (set) =>
          `${set.assignment_id}|${selectedReadinessTerm}|${effectiveReadinessYear}|${normalizeAlevelComponent(set.aoi_label)}`
      )
    );

    const normalizeAssignmentLabel = (assignment) => ({
      ...assignment,
      subject_display:
        assignment?.subject_display ||
        (assignment?.paper_label && assignment.paper_label !== "Single"
          ? `${assignment.subject} — ${assignment.paper_label}`
          : assignment?.subject || "—"),
    });

    const componentSummary = (component) => {
      const submitted = assignments
        .filter((assignment) =>
          submittedKeys.has(
            `${assignment.id}|${selectedReadinessTerm}|${effectiveReadinessYear}|${component}`
          )
        )
        .map(normalizeAssignmentLabel);
      const pending = assignments
        .filter(
          (assignment) =>
            !submittedKeys.has(
              `${assignment.id}|${selectedReadinessTerm}|${effectiveReadinessYear}|${component}`
            )
        )
        .map(normalizeAssignmentLabel)
        .sort((a, b) => {
          const streamCompare = String(a.stream || "").localeCompare(String(b.stream || ""));
          if (streamCompare !== 0) return streamCompare;
          return String(a.subject_display || "").localeCompare(String(b.subject_display || ""));
        });

      const total = assignments.length;
      const rate = total > 0 ? Math.round((submitted.length / total) * 100) : 0;

      return {
        component,
        submitted,
        pending,
        submittedCount: submitted.length,
        pendingCount: pending.length,
        rate,
      };
    };

    const mid = componentSummary("MID");
    const eot = componentSummary("EOT");
    const fullyReadyCount = assignments.filter(
      (assignment) =>
        submittedKeys.has(
          `${assignment.id}|${selectedReadinessTerm}|${effectiveReadinessYear}|MID`
        ) &&
        submittedKeys.has(
          `${assignment.id}|${selectedReadinessTerm}|${effectiveReadinessYear}|EOT`
        )
    ).length;

    return {
      totalAssignments: assignments.length,
      mid,
      eot,
      fullyReadyCount,
      fullyReadyRate:
        assignments.length > 0
          ? Math.round((fullyReadyCount / assignments.length) * 100)
          : 0,
    };
  }, [effectiveReadinessYear, readinessAssignments, readinessMarksSets, selectedReadinessTerm]);

  return (
    <ALevelAdminShell
      title="A-Level Manager"
      subtitle="Manage learners, assignments, downloads, reports, and live submission tracking from one place."
      contentStyle={{ paddingTop: 0, paddingLeft: 0, paddingRight: 0 }}
    >
      {({ isDark }) => {
        const amethyst = "#38bdf8";
        const palette = isDark
          ? {
              rootText: "#f1f5f9",
              muted: "#94a3b8",
              mutedStrong: "#64748b",
              cardBg: "rgba(30, 41, 59, 0.45)",
              cardBorder: "rgba(255, 255, 255, 0.05)",
              actionCardBg: "rgba(30, 41, 59, 0.3)",
              actionHoverBg: "rgba(255,255,255,0.04)",
              heroOverlay: `linear-gradient(to top, rgba(10, 12, 16, 1) 0%, rgba(10, 12, 16, 0.8) 20%, rgba(10, 12, 16, 0) 60%),
                            linear-gradient(to right, rgba(10, 12, 16, 1) 0%, rgba(10, 12, 16, 0.4) 100%)`,
              heroSubtitle: "#cbd5e1",
              totalCardBg: "linear-gradient(135deg, #1e1b4b 0%, #0a0c10 100%)",
              totalNumber: "#ffffff",
              hoverShadow: "0 20px 40px rgba(0,0,0,0.4)",
            }
          : {
              rootText: "#0f172a",
              muted: "#475569",
              mutedStrong: "#334155",
              cardBg: "rgba(255, 255, 255, 0.88)",
              cardBorder: "rgba(15, 23, 42, 0.12)",
              actionCardBg: "rgba(255, 255, 255, 0.92)",
              actionHoverBg: "rgba(56, 189, 248, 0.1)",
              heroOverlay: `linear-gradient(to top, rgba(248, 250, 252, 0.96) 0%, rgba(248, 250, 252, 0.75) 20%, rgba(248, 250, 252, 0.05) 60%),
                            linear-gradient(to right, rgba(248, 250, 252, 0.9) 0%, rgba(248, 250, 252, 0.2) 100%)`,
              heroSubtitle: "#1e293b",
              totalCardBg: "linear-gradient(135deg, #dbeafe 0%, #f8fafc 100%)",
              totalNumber: "#0f172a",
              hoverShadow: "0 14px 32px rgba(15, 23, 42, 0.12)",
            };

        const cardStyle = {
          background: palette.cardBg,
          backdropFilter: "blur(12px)",
          borderRadius: "18px",
          border: `1px solid ${palette.cardBorder}`,
          transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          color: palette.rootText,
        };
        const actionCards = [
          {
            title: "Register Learners",
            desc: "Manage student biographical data and enrollment status.",
            path: "/ark/admin/alevel/learners",
            id: "act1",
          },
          {
            title: "Assign Subjects",
            desc: "Pair educators with curriculum modules and class streams.",
            path: "/ark/admin/alevel/assign",
            id: "act2",
          },
          {
            title: "Download Marks",
            desc: "Export academic spreadsheets and administrative datasets.",
            path: "/ark/admin/alevel/downloads",
            id: "act3",
          },
          {
            title: "Term Reports",
            desc: "Generate high-fidelity terminal student reports.",
            path: "/ark/admin/alevel/reports",
            id: "act4",
          },
          {
            title: "Assessment Submission Tracker",
            desc: "Track A-Level subject submission by stream and term.",
            id: "act5",
            action: openTracker,
          },
        ];

        return (
          <>
            <div
              style={{
                height: "430px",
                backgroundImage: "url(/weasel.jpg)",
                backgroundSize: "cover",
                backgroundPosition: "center 20%",
                position: "relative",
                display: "flex",
                alignItems: "flex-end",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: palette.heroOverlay,
                }}
              />

              <div style={{ position: "relative", padding: "0 3rem 3.2rem 3rem", width: "100%" }}>
                <h1
                  style={{
                    fontSize: "3.2rem",
                    fontWeight: "900",
                    margin: 0,
                    letterSpacing: "-0.04em",
                    color: palette.rootText,
                    textShadow: isDark
                      ? "0 2px 10px rgba(0,0,0,0.5)"
                      : "0 1px 4px rgba(255,255,255,0.8)",
                  }}
                >
                  A-Level <span style={{ color: amethyst }}>Manager</span>
                </h1>
                <p
                  style={{
                    color: palette.heroSubtitle,
                    fontSize: "1.12rem",
                    maxWidth: "640px",
                    marginTop: "1rem",
                    lineHeight: "1.6",
                  }}
                >
                  A-Level operations are managed from here. Keep learner records, teacher assignments,
                  downloads, reports, and submission monitoring all in one premium workspace.
                </p>
              </div>
            </div>

            <div style={{ padding: "0 3rem 3rem 3rem", marginTop: "-20px" }}>
              {stats && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "1.1rem",
                    marginBottom: "3rem",
                  }}
                >
                  {stats.streams.map((streamStat, index) => (
                    <div
                      key={streamStat.stream}
                      onMouseEnter={() => setHoveredStat(index)}
                      onMouseLeave={() => setHoveredStat(null)}
                      style={{
                        ...cardStyle,
                        padding: "1.35rem",
                        transform: hoveredStat === index ? "translateY(-8px)" : "none",
                        borderColor: hoveredStat === index ? amethyst : palette.cardBorder,
                        boxShadow: hoveredStat === index ? palette.hoverShadow : "none",
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          fontSize: "0.75rem",
                          letterSpacing: "0.15em",
                          color: amethyst,
                          textTransform: "uppercase",
                          fontWeight: "800",
                        }}
                      >
                        {streamStat.stream}
                      </h3>
                      <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem" }}>
                          <span style={{ color: palette.muted }}>Male</span>
                          <span style={{ fontWeight: "600" }}>{streamStat.boys}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem" }}>
                          <span style={{ color: palette.muted }}>Female</span>
                          <span style={{ fontWeight: "600" }}>{streamStat.girls}</span>
                        </div>
                        <div
                          style={{
                            marginTop: "0.8rem",
                            paddingTop: "1rem",
                            borderTop: `1px solid ${palette.cardBorder}`,
                            display: "flex",
                            justifyContent: "space-between",
                            color: palette.rootText,
                          }}
                        >
                          <span style={{ fontWeight: "500", fontSize: "0.85rem", opacity: 0.8 }}>Total</span>
                          <span style={{ fontWeight: "900", fontSize: "1.2rem" }}>{streamStat.total}</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div
                    onMouseEnter={() => setHoveredStat("total")}
                    onMouseLeave={() => setHoveredStat(null)}
                    style={{
                      ...cardStyle,
                      padding: "1.35rem",
                      background: palette.totalCardBg,
                      border: `1px solid ${amethyst}`,
                      transform: hoveredStat === "total" ? "translateY(-8px)" : "none",
                      boxShadow:
                        hoveredStat === "total" ? "0 15px 40px rgba(56, 189, 248, 0.18)" : "none",
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontSize: "0.75rem",
                        letterSpacing: "0.15em",
                        color: amethyst,
                        textTransform: "uppercase",
                      }}
                    >
                      Total Population
                    </h3>
                    <div
                      style={{
                        fontSize: "3.2rem",
                        fontWeight: "900",
                        margin: "0.35rem 0",
                        color: palette.totalNumber,
                        letterSpacing: "-0.05em",
                      }}
                    >
                      {stats.streams.reduce((sum, streamStat) => sum + streamStat.total, 0).toLocaleString()}
                    </div>
                    <p style={{ margin: 0, opacity: 0.5, fontSize: "0.75rem", fontWeight: "700", letterSpacing: "0.05em" }}>
                      GLOBAL A-LEVEL REGISTRY
                    </p>
                  </div>

                  <div
                    style={{
                      ...cardStyle,
                      padding: "1.35rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                    }}
                  >
                    <div style={{ fontSize: "2.9rem", fontWeight: "900", color: amethyst }}>{stats.teachers}</div>
                    <div>
                      <div
                        style={{
                          color: palette.rootText,
                          fontWeight: "700",
                          textTransform: "uppercase",
                          fontSize: "0.75rem",
                          letterSpacing: "0.1em",
                        }}
                      >
                        Teachers
                      </div>
                      <div style={{ color: palette.mutedStrong, fontSize: "0.85rem", fontWeight: "500" }}>
                        On system
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div
                style={{
                  ...cardStyle,
                  marginTop: "2rem",
                  padding: "1.5rem",
                  background: isDark ? "rgba(15, 23, 42, 0.58)" : "rgba(255,255,255,0.92)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "1rem",
                    flexWrap: "wrap",
                    marginBottom: "1.25rem",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        fontWeight: "900",
                        color: amethyst,
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        marginBottom: "0.45rem",
                      }}
                    >
                      Submission Readiness
                    </div>
                    <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: "800", color: palette.rootText }}>
                      A-Level Marks Readiness
                    </h3>
                    <p style={{ margin: "0.45rem 0 0", color: palette.muted, maxWidth: "680px", lineHeight: 1.55 }}>
                      Monitor who has submitted MID and EOT marks for the selected term and year, and quickly see which teacher-stream-subject slots are still pending.
                    </p>
                  </div>

                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      value={selectedReadinessTerm}
                      onChange={(event) => setSelectedReadinessTerm(event.target.value)}
                      style={{
                        minWidth: "120px",
                        padding: "0.7rem 0.85rem",
                        borderRadius: "12px",
                        border: `1px solid ${palette.cardBorder}`,
                        background: isDark ? "rgba(15, 23, 42, 0.85)" : "#ffffff",
                        color: palette.rootText,
                        fontWeight: "700",
                      }}
                    >
                      {ALEVEL_TERMS.map((term) => (
                        <option key={term} value={term}>
                          {term}
                        </option>
                      ))}
                    </select>

                    <select
                      value={effectiveReadinessYear}
                      onChange={(event) => setSelectedReadinessYear(Number(event.target.value))}
                      style={{
                        minWidth: "104px",
                        padding: "0.7rem 0.85rem",
                        borderRadius: "12px",
                        border: `1px solid ${palette.cardBorder}`,
                        background: isDark ? "rgba(15, 23, 42, 0.85)" : "#ffffff",
                        color: palette.rootText,
                        fontWeight: "700",
                      }}
                    >
                      {readinessYearOptions.map((yearOption) => (
                        <option key={yearOption} value={yearOption}>
                          {yearOption}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={openTracker}
                      style={{
                        background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.95)",
                        color: palette.rootText,
                        border: `1px solid ${palette.cardBorder}`,
                        borderRadius: "12px",
                        padding: "0.72rem 0.95rem",
                        fontWeight: "800",
                        cursor: "pointer",
                      }}
                    >
                      Open Tracker
                    </button>
                  </div>
                </div>

                {readinessError ? (
                  <div
                    style={{
                      background: isDark ? "rgba(127, 29, 29, 0.22)" : "rgba(254, 226, 226, 0.95)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      color: isDark ? "#fecaca" : "#991b1b",
                      borderRadius: "14px",
                      padding: "1rem",
                    }}
                  >
                    {readinessError}
                  </div>
                ) : readinessLoading ? (
                  <div
                    style={{
                      borderRadius: "14px",
                      border: `1px solid ${palette.cardBorder}`,
                      padding: "1rem",
                      color: palette.muted,
                    }}
                  >
                    Loading A-Level readiness…
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                        gap: "0.9rem",
                        marginBottom: "1rem",
                      }}
                    >
                      {[
                        { label: "Teaching Slots", value: readinessSummary.totalAssignments, accent: palette.rootText },
                        { label: "Fully Ready", value: readinessSummary.fullyReadyCount, accent: amethyst },
                        { label: "Readiness Rate", value: `${readinessSummary.fullyReadyRate}%`, accent: readinessSummary.fullyReadyRate >= 70 ? "#22c55e" : readinessSummary.fullyReadyRate >= 40 ? "#f59e0b" : "#ef4444" },
                      ].map((tile) => (
                        <div
                          key={tile.label}
                          style={{
                            borderRadius: "16px",
                            border: `1px solid ${palette.cardBorder}`,
                            background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,250,252,0.95)",
                            padding: "1rem 1.05rem",
                          }}
                        >
                          <div style={{ fontSize: "0.68rem", letterSpacing: "0.13em", textTransform: "uppercase", color: palette.muted, fontWeight: 900 }}>
                            {tile.label}
                          </div>
                          <div style={{ marginTop: "0.45rem", fontSize: "1.9rem", fontWeight: 900, color: tile.accent }}>
                            {tile.value}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                        gap: "1rem",
                      }}
                    >
                      {[readinessSummary.mid, readinessSummary.eot].map((block) => (
                        <div
                          key={block.component}
                          style={{
                            borderRadius: "18px",
                            border: `1px solid ${palette.cardBorder}`,
                            background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,250,252,0.95)",
                            padding: "1.05rem",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem" }}>
                            <div>
                              <div style={{ fontSize: "0.7rem", letterSpacing: "0.14em", textTransform: "uppercase", color: amethyst, fontWeight: 900 }}>
                                {block.component}
                              </div>
                              <div style={{ marginTop: "0.3rem", color: palette.rootText, fontSize: "1.05rem", fontWeight: 800 }}>
                                {block.submittedCount} / {readinessSummary.totalAssignments} submitted
                              </div>
                            </div>
                            <div style={{ color: block.rate >= 70 ? "#22c55e" : block.rate >= 40 ? "#f59e0b" : "#ef4444", fontWeight: 900, fontSize: "1rem" }}>
                              {block.rate}%
                            </div>
                          </div>

                          <div
                            style={{
                              marginTop: "0.8rem",
                              height: "10px",
                              borderRadius: "999px",
                              background: isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.16)",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${block.rate}%`,
                                height: "100%",
                                background: block.rate >= 70 ? "#22c55e" : block.rate >= 40 ? "#f59e0b" : "#ef4444",
                              }}
                            />
                          </div>

                          <div style={{ marginTop: "0.95rem", display: "flex", gap: "0.9rem", flexWrap: "wrap", color: palette.muted, fontSize: "0.85rem" }}>
                            <span>Submitted: <strong style={{ color: palette.rootText }}>{block.submittedCount}</strong></span>
                            <span>Pending: <strong style={{ color: palette.rootText }}>{block.pendingCount}</strong></span>
                          </div>

                          <div style={{ marginTop: "1rem" }}>
                            <div style={{ fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: palette.muted, fontWeight: 900, marginBottom: "0.55rem" }}>
                              Pending Slots
                            </div>

                            {block.pending.length === 0 ? (
                              <div
                                style={{
                                  borderRadius: "12px",
                                  padding: "0.8rem 0.9rem",
                                  background: isDark ? "rgba(34, 197, 94, 0.14)" : "rgba(220, 252, 231, 0.9)",
                                  color: isDark ? "#bbf7d0" : "#166534",
                                  fontWeight: "700",
                                }}
                              >
                                All assignments submitted for {block.component}.
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                                {block.pending.slice(0, 6).map((assignment) => (
                                  <div
                                    key={`${block.component}-${assignment.id}`}
                                    style={{
                                      borderRadius: "12px",
                                      border: `1px solid ${palette.cardBorder}`,
                                      padding: "0.75rem 0.85rem",
                                      background: isDark ? "rgba(15, 23, 42, 0.46)" : "#ffffff",
                                    }}
                                  >
                                    <div style={{ color: palette.rootText, fontWeight: 800 }}>
                                      {assignment.subject_display}
                                    </div>
                                    <div style={{ marginTop: "0.18rem", color: palette.muted, fontSize: "0.84rem" }}>
                                      {assignment.stream} • {assignment.teacher_name || "Teacher pending"}
                                    </div>
                                  </div>
                                ))}
                                {block.pending.length > 6 && (
                                  <div style={{ color: palette.muted, fontSize: "0.82rem", fontWeight: 700 }}>
                                    + {block.pending.length - 6} more pending
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {showTracker && (
                <section className="panel" style={{ marginTop: "2rem" }}>
                  <div className="panel-header">
                    <div>
                      <h2>Assessment Submission Tracker</h2>
                      <p>A-Level subject submission tracker by term and stream.</p>
                    </div>
                    <div style={{ display: "flex", gap: "0.6rem" }}>
                      <button
                        className="ghost-btn"
                        type="button"
                        onClick={fetchAlevelTrackerData}
                        disabled={trackerLoading}
                      >
                        {trackerLoading ? "Refreshing…" : "Refresh"}
                      </button>
                      <button className="panel-close" type="button" onClick={() => setShowTracker(false)}>
                        ✕ Close
                      </button>
                    </div>
                  </div>

                  {trackerError && <div className="panel-alert panel-alert-error">{trackerError}</div>}

                  {trackerLoading ? (
                    <div className="panel-card">
                      <p className="muted-text">Loading tracker…</p>
                    </div>
                  ) : (
                    <AssessmentSubmissionTracker
                      marksSets={trackerMarksSets}
                      refreshMarks={fetchAlevelTrackerData}
                      officialSubjects={trackerSubjects}
                      assignmentsEndpoint="/api/alevel/admin/assignments"
                      trackedUnitLabel="papers"
                      componentOptions={[
                        { value: "MID", label: "MID" },
                        { value: "EOT", label: "EOT" },
                      ]}
                      seedGroups={[
                        { class_level: "A-Level", stream: "S5 Arts" },
                        { class_level: "A-Level", stream: "S5 Sciences" },
                        { class_level: "A-Level", stream: "S6 Arts" },
                        { class_level: "A-Level", stream: "S6 Sciences" },
                      ]}
                      title="Assessment Submission Tracker"
                      subtitle="Track A-Level paper submissions per stream using MID and EOT."
                    />
                  )}
                </section>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "1.1rem",
                  marginTop: "2rem",
                }}
              >
                {actionCards.map((card) => (
                  <div
                    key={card.id}
                    onMouseEnter={() => setHoveredAction(card.id)}
                    onMouseLeave={() => setHoveredAction(null)}
                    onClick={() => {
                      if (typeof card.action === "function") {
                        card.action();
                        return;
                      }
                      navigate(card.path);
                    }}
                    style={{
                      ...cardStyle,
                      padding: "1.6rem 1.35rem",
                      cursor: "pointer",
                      background: hoveredAction === card.id ? palette.actionHoverBg : palette.actionCardBg,
                      borderColor: hoveredAction === card.id ? amethyst : palette.cardBorder,
                      transform: hoveredAction === card.id ? "scale(1.02)" : "none",
                    }}
                  >
                    <h3 style={{ margin: "0 0 0.65rem 0", fontSize: "1.05rem", fontWeight: "700" }}>{card.title}</h3>
                    <p style={{ color: palette.muted, fontSize: "0.9rem", lineHeight: "1.5", marginBottom: "1.6rem" }}>
                      {card.desc}
                    </p>
                    <div
                      style={{
                        color: amethyst,
                        fontSize: "0.75rem",
                        fontWeight: "800",
                        letterSpacing: "0.1em",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      ACCESS MODULE{" "}
                      <span
                        style={{
                          transition: "0.3s",
                          transform: hoveredAction === card.id ? "translateX(6px)" : "none",
                        }}
                      >
                        →
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      }}
    </ALevelAdminShell>
  );
}
