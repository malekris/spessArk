import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import useIdleLogout from "../../../hooks/useIdleLogout";
import AssessmentSubmissionTracker from "../../../components/AssessmentSubmissionTracker";
import "../../../pages/AdminDashboard.css";
import "./ALevelAdminTheme.css";

export default function ALevelDashboard() {
  const navigate = useNavigate();
  const API_BASE = import.meta.env.VITE_API_BASE;
  const [stats, setStats] = useState(null);
  const IDLE_20_MIN = 20 * 60 * 1000;

  const [hoveredNav, setHoveredNav] = useState(null);
  const [hoveredStat, setHoveredStat] = useState(null);
  const [hoveredAction, setHoveredAction] = useState(null);
  const [showTracker, setShowTracker] = useState(false);
  const [trackerMarksSets, setTrackerMarksSets] = useState([]);
  const [trackerSubjects, setTrackerSubjects] = useState([]);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState("");
  const [themeMode, setThemeMode] = useState(() => {
    try {
      return localStorage.getItem("alevelDashboardTheme") || "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    fetch(`${API_BASE}/api/alevel/stats`)
      .then((res) => res.json())
      .then(setStats)
      .catch(console.error);
  }, [API_BASE]);

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

  useIdleLogout(() => {
    localStorage.removeItem("SPESS_ADMIN_KEY");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("adminToken");
    sessionStorage.removeItem("isAdmin");
    navigate("/ark", { replace: true });
  }, IDLE_20_MIN);

  useEffect(() => {
    try {
      localStorage.setItem("alevelDashboardTheme", themeMode);
    } catch {
      // ignore storage issues
    }
  }, [themeMode]);

  const isDark = themeMode !== "light";
  const amethyst = "#38bdf8";
  const palette = isDark
    ? {
        rootText: "#f1f5f9",
        sidebarBg: "#050608",
        sidebarBorder: "rgba(255, 255, 255, 0.03)",
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
        sidebarBg: "#ffffff",
        sidebarBorder: "rgba(15, 23, 42, 0.08)",
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
    color: palette.rootText
  };

  const navItemStyle = (id) => ({
    padding: "0.85rem 1.2rem",
    borderRadius: "10px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    fontSize: "0.9rem",
    fontWeight: "500",
    transition: "all 0.3s ease",
    background: hoveredNav === id ? "rgba(56, 189, 248, 0.12)" : "transparent",
    color: hoveredNav === id ? amethyst : palette.muted,
    border: "none",
    textAlign: "left",
    width: "100%",
    marginBottom: "6px"
  });

  return (
    <div
      className={`admin-root alevel-admin-root alevel-dashboard-layout ${isDark ? "mode-dark" : "mode-light"}`}
      style={{ display: "flex", flexDirection: "row", minHeight: "100vh", color: palette.rootText, fontFamily: "'Inter', sans-serif" }}
    >
      
      {/* ===== SIDEBAR ===== */}
      <aside
        className="alevel-sidebar"
        style={{
        width: "270px",
        background: palette.sidebarBg,
        borderRight: `1px solid ${palette.sidebarBorder}`,
        padding: "2.5rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
        zIndex: 10
      }}
      >
        <div style={{ marginBottom: "3rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: "800", letterSpacing: "0.05em" }}>
            ARK<span style={{ color: amethyst }}>ADMIN</span>
          </h2>
          <div style={{ width: "20px", height: "3px", background: amethyst, marginTop: "6px", borderRadius: "2px" }}></div>
        </div>

        <nav style={{ flex: 1 }}>
          {[
            { label: "Overview", path: "/ark/admin/alevel", id: "dash" },
            { label: "Learners", path: "/ark/admin/alevel/learners", id: "learn" },
            { label: "Assignments", path: "/ark/admin/alevel/assign", id: "assign" },
            { label: "Data Center", path: "/ark/admin/alevel/downloads", id: "down" },
            { label: "Report Hub", path: "/ark/admin/alevel/reports", id: "rep" },
            { label: "Assessment Tracker", id: "track", action: openTracker },
          ].map((item) => (
            <button
              key={item.id}
              onMouseEnter={() => setHoveredNav(item.id)}
              onMouseLeave={() => setHoveredNav(null)}
              onClick={() => {
                if (typeof item.action === "function") {
                  item.action();
                  return;
                }
                navigate(item.path);
              }}
              style={navItemStyle(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
          style={{
            padding: "0.85rem 0.95rem",
            borderRadius: "10px",
            background: isDark ? "rgba(56, 189, 248, 0.12)" : "rgba(15, 23, 42, 0.06)",
            border: `1px solid ${isDark ? "rgba(56, 189, 248, 0.45)" : "rgba(15, 23, 42, 0.18)"}`,
            color: isDark ? "#7dd3fc" : "#0f172a",
            fontSize: "0.76rem",
            fontWeight: "700",
            cursor: "pointer",
            transition: "all 0.2s ease",
            marginTop: "0.4rem",
          }}
        >
          {isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
        </button>

        <button
          onMouseEnter={() => setHoveredNav('back')}
          onMouseLeave={() => setHoveredNav(null)}
          onClick={() => navigate("/ark/admin")}
          style={{
            padding: "0.9rem",
            borderRadius: "10px",
            background: "transparent",
            border: `1px solid ${hoveredNav === 'back' ? amethyst : palette.sidebarBorder}`,
            color: hoveredNav === 'back' ? amethyst : palette.mutedStrong,
            fontSize: "0.8rem",
            fontWeight: "700",
            cursor: "pointer",
            transition: "all 0.3s ease",
            marginTop: "2rem"
          }}
        >
          ← O-LEVEL SYSTEM
        </button>
      </aside>

      {/* ===== MAIN CONTENT ===== */}
      <main className="alevel-dashboard-main" style={{ flex: 1 }}>
        
        {/* ===== CINEMATIC HERO (NETFLIX STYLE) ===== */}
        <div style={{
          height: "450px", // Increased height for cinematic impact
          backgroundImage: "url(/weasel.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center 20%",
          position: "relative",
          display: "flex",
          alignItems: "flex-end"
        }}>
          {/* Multi-layered Cinematic Overlays */}
          <div style={{
            position: "absolute",
            inset: 0,
            background: palette.heroOverlay
          }} />

          <div style={{ position: "relative", padding: "0 4rem 4rem 4rem", width: "100%" }}>
            <h1 style={{ fontSize: "3.5rem", fontWeight: "900", margin: 0, letterSpacing: "-0.04em", textShadow: isDark ? "0 2px 10px rgba(0,0,0,0.5)" : "0 1px 4px rgba(255,255,255,0.8)" }}>
              A-Level <span style={{ color: amethyst }}>Manager</span>
            </h1>
            <p style={{ color: palette.heroSubtitle, fontSize: "1.2rem", maxWidth: "600px", marginTop: "1rem", lineHeight: "1.5" }}>
              A level students are managed from here.. <br/>
              Welcome to St Phillips.
            </p>
          </div>
        </div>

        {/* CONTENT AREA */}
        <div style={{ padding: "0 4rem 4rem 4rem", marginTop: "-20px" }}>
          
          {/* STATS SECTION */}
          {stats && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1.1rem",
              marginBottom: "3rem"
            }}>
              {stats.streams.map((s, i) => (
                <div
                  key={s.stream}
                  onMouseEnter={() => setHoveredStat(i)}
                  onMouseLeave={() => setHoveredStat(null)}
                  style={{
                    ...cardStyle,
                    padding: "1.35rem",
                    transform: hoveredStat === i ? "translateY(-8px)" : "none",
                    borderColor: hoveredStat === i ? amethyst : palette.cardBorder,
                    boxShadow: hoveredStat === i ? palette.hoverShadow : "none"
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "0.75rem", letterSpacing: "0.15em", color: amethyst, textTransform: "uppercase", fontWeight: "800" }}>{s.stream}</h3>
                  <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem" }}>
                      <span style={{ color: palette.muted }}>Male</span>
                      <span style={{ fontWeight: "600" }}>{s.boys}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem" }}>
                      <span style={{ color: palette.muted }}>Female</span>
                      <span style={{ fontWeight: "600" }}>{s.girls}</span>
                    </div>
                    <div style={{ 
                      marginTop: "0.8rem", 
                      paddingTop: "1rem", 
                      borderTop: `1px solid ${palette.cardBorder}`,
                      display: "flex", 
                      justifyContent: "space-between", 
                      color: palette.rootText 
                    }}>
                      <span style={{ fontWeight: "500", fontSize: "0.85rem", opacity: 0.8 }}>Total</span>
                      <span style={{ fontWeight: "900", fontSize: "1.2rem" }}>{s.total}</span>
                    </div>
                  </div>
                </div>
              ))}

              {/* TOTAL HERO CARD */}
              <div
                onMouseEnter={() => setHoveredStat('total')}
                onMouseLeave={() => setHoveredStat(null)}
                style={{
                  ...cardStyle,
                  padding: "1.35rem",
                  background: palette.totalCardBg,
                  border: `1px solid ${amethyst}`,
                  transform: hoveredStat === 'total' ? "translateY(-8px)" : "none",
                  boxShadow: hoveredStat === 'total' ? `0 15px 40px rgba(56, 189, 248, 0.18)` : "none"
                }}
              >
                <h3 style={{ margin: 0, fontSize: "0.75rem", letterSpacing: "0.15em", color: amethyst, textTransform: "uppercase" }}>Total Population</h3>
                <div style={{ fontSize: "3.2rem", fontWeight: "900", margin: "0.35rem 0", color: palette.totalNumber, letterSpacing: "-0.05em" }}>
                  {stats.streams.reduce((sum, s) => sum + s.total, 0).toLocaleString()}
                </div>
                <p style={{ margin: 0, opacity: 0.5, fontSize: "0.75rem", fontWeight: "700", letterSpacing: "0.05em" }}>GLOBAL A-LEVEL REGISTRY</p>
              </div>

              {/* STAFF CARD */}
              <div style={{ ...cardStyle, padding: "1.35rem", display: "flex", alignItems: "center", gap: "1rem" }}>
                <div style={{ fontSize: "2.9rem", fontWeight: "900", color: amethyst }}>{stats.teachers}</div>
                <div>
                  <div style={{ color: palette.rootText, fontWeight: "700", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.1em" }}>Teachers</div>
                  <div style={{ color: palette.mutedStrong, fontSize: "0.85rem", fontWeight: "500" }}>On system</div>
                </div>
              </div>
            </div>
          )}

          {/* ACTION CARDS */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1.1rem"
          }}>
            {[
              { title: "Register Learners", desc: "Manage student biographical data and enrollment status.", path: "/ark/admin/alevel/learners", id: "act1" },
              { title: "Assign Subjects", desc: "Pair educators with curriculum modules and class streams.", path: "/ark/admin/alevel/assign", id: "act2" },
              { title: "Download Marks", desc: "Export academic spreadsheets and administrative datasets.", path: "/ark/admin/alevel/downloads", id: "act3" },
              { title: "Term Reports", desc: "Generate high-fidelity terminal student reports.", path: "/ark/admin/alevel/reports", id: "act4" },
              { title: "Assessment Submission Tracker", desc: "Track A-Level subject submission by stream and term.", id: "act5", action: openTracker },
            ].map((card) => (
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
                  transform: hoveredAction === card.id ? "scale(1.02)" : "none"
                }}
              >
                <h3 style={{ margin: "0 0 0.65rem 0", fontSize: "1.05rem", fontWeight: "700" }}>{card.title}</h3>
                <p style={{ color: palette.muted, fontSize: "0.9rem", lineHeight: "1.5", marginBottom: "1.6rem" }}>{card.desc}</p>
                <div style={{ 
                  color: amethyst, 
                  fontSize: "0.75rem", 
                  fontWeight: "800", 
                  letterSpacing: "0.1em",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px"
                }}>
                  ACCESS MODULE <span style={{ transition: "0.3s", transform: hoveredAction === card.id ? "translateX(6px)" : "none" }}>→</span>
                </div>
              </div>
            ))}
          </div>

          {showTracker && (
            <section className="panel" style={{ marginTop: "2rem" }}>
              <div className="panel-header">
                <div>
                  <h2>Assessment Submission Tracker</h2>
                  <p>A-Level subject submission tracker by term and stream.</p>
                </div>
                <div style={{ display: "flex", gap: "0.6rem" }}>
                  <button className="ghost-btn" type="button" onClick={fetchAlevelTrackerData} disabled={trackerLoading}>
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
                  seedGroups={[
                    { class_level: "A-Level", stream: "S5 Arts" },
                    { class_level: "A-Level", stream: "S5 Sciences" },
                    { class_level: "A-Level", stream: "S6 Arts" },
                    { class_level: "A-Level", stream: "S6 Sciences" },
                  ]}
                  title="Assessment Submission Tracker"
                  subtitle="Track A-Level subject submissions per stream."
                />
              )}
            </section>
          )}

        </div>
      </main>
    </div>
  );
}
