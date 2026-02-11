import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import useIdleLogout from "../../../hooks/useIdleLogout";

export default function ALevelDashboard() {
  const navigate = useNavigate();
  const API_BASE = import.meta.env.VITE_API_BASE;
  const [stats, setStats] = useState(null);
  const IDLE_20_MIN = 20 * 60 * 1000;

  const [hoveredNav, setHoveredNav] = useState(null);
  const [hoveredStat, setHoveredStat] = useState(null);
  const [hoveredAction, setHoveredAction] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/alevel/stats`)
      .then((res) => res.json())
      .then(setStats)
      .catch(console.error);
  }, [API_BASE]);

  useIdleLogout(() => {
    localStorage.removeItem("SPESS_ADMIN_KEY");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("adminToken");
    sessionStorage.removeItem("isAdmin");
    navigate("/ark", { replace: true });
  }, IDLE_20_MIN);

  // Slate & Amethyst Palette
  const slateBg = "#1e293b"; 
  const slateDark = "#0f172a";
  const amethyst = "#a78bfa"; 
  const platinum = "#f1f5f9";
  const cinematicBlack = "#0a0c10"; // Deep cinematic base

  const cardStyle = {
    background: "rgba(30, 41, 59, 0.45)", // Thinner for better cinematic layering
    backdropFilter: "blur(12px)",
    borderRadius: "18px",
    border: "1px solid rgba(255, 255, 255, 0.05)",
    transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
    color: platinum
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
    background: hoveredNav === id ? "rgba(167, 139, 250, 0.1)" : "transparent",
    color: hoveredNav === id ? amethyst : "#94a3b8",
    border: "none",
    textAlign: "left",
    width: "100%",
    marginBottom: "6px"
  });

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: cinematicBlack, color: platinum, fontFamily: "'Inter', sans-serif" }}>
      
      {/* ===== SIDEBAR ===== */}
      <aside style={{
        width: "270px",
        background: "#050608", // Darker sidebar for cinematic contrast
        borderRight: "1px solid rgba(255, 255, 255, 0.03)",
        padding: "2.5rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
        zIndex: 10
      }}>
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
          ].map((item) => (
            <button
              key={item.id}
              onMouseEnter={() => setHoveredNav(item.id)}
              onMouseLeave={() => setHoveredNav(null)}
              onClick={() => navigate(item.path)}
              style={navItemStyle(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <button
          onMouseEnter={() => setHoveredNav('back')}
          onMouseLeave={() => setHoveredNav(null)}
          onClick={() => navigate("/ark/admin")}
          style={{
            padding: "0.9rem",
            borderRadius: "10px",
            background: "transparent",
            border: `1px solid ${hoveredNav === 'back' ? amethyst : "rgba(148, 163, 184, 0.2)"}`,
            color: hoveredNav === 'back' ? amethyst : "#64748b",
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
      <main style={{ flex: 1 }}>
        
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
            background: `linear-gradient(to top, ${cinematicBlack} 0%, rgba(10, 12, 16, 0.8) 20%, rgba(10, 12, 16, 0) 60%), 
                         linear-gradient(to right, ${cinematicBlack} 0%, rgba(10, 12, 16, 0.4) 100%)`
          }} />

          <div style={{ position: "relative", padding: "0 4rem 4rem 4rem", width: "100%" }}>
            <h1 style={{ fontSize: "3.5rem", fontWeight: "900", margin: 0, letterSpacing: "-0.04em", textShadow: "0 2px 10px rgba(0,0,0,0.5)" }}>
              A-Level <span style={{ color: amethyst }}>Manager</span>
            </h1>
            <p style={{ color: "#cbd5e1", fontSize: "1.2rem", maxWidth: "600px", marginTop: "1rem", lineHeight: "1.5" }}>
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
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "1.5rem",
              marginBottom: "3rem"
            }}>
              {stats.streams.map((s, i) => (
                <div
                  key={s.stream}
                  onMouseEnter={() => setHoveredStat(i)}
                  onMouseLeave={() => setHoveredStat(null)}
                  style={{
                    ...cardStyle,
                    padding: "1.8rem",
                    transform: hoveredStat === i ? "translateY(-8px)" : "none",
                    borderColor: hoveredStat === i ? amethyst : "rgba(255, 255, 255, 0.05)",
                    boxShadow: hoveredStat === i ? "0 20px 40px rgba(0,0,0,0.4)" : "none"
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "0.75rem", letterSpacing: "0.15em", color: amethyst, textTransform: "uppercase", fontWeight: "800" }}>{s.stream}</h3>
                  <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem" }}>
                      <span style={{ color: "#94a3b8" }}>Male</span>
                      <span style={{ fontWeight: "600" }}>{s.boys}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem" }}>
                      <span style={{ color: "#94a3b8" }}>Female</span>
                      <span style={{ fontWeight: "600" }}>{s.girls}</span>
                    </div>
                    <div style={{ 
                      marginTop: "0.8rem", 
                      paddingTop: "1rem", 
                      borderTop: "1px solid rgba(255,255,255,0.05)", 
                      display: "flex", 
                      justifyContent: "space-between", 
                      color: platinum 
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
                  padding: "1.8rem",
                  background: `linear-gradient(135deg, #1e1b4b 0%, ${cinematicBlack} 100%)`,
                  border: `1px solid ${amethyst}`,
                  transform: hoveredStat === 'total' ? "translateY(-8px)" : "none",
                  boxShadow: hoveredStat === 'total' ? `0 15px 40px rgba(167, 139, 250, 0.15)` : "none"
                }}
              >
                <h3 style={{ margin: 0, fontSize: "0.75rem", letterSpacing: "0.15em", color: amethyst, textTransform: "uppercase" }}>Total Population</h3>
                <div style={{ fontSize: "4rem", fontWeight: "900", margin: "0.4rem 0", color: "#fff", letterSpacing: "-0.05em" }}>
                  {stats.streams.reduce((sum, s) => sum + s.total, 0).toLocaleString()}
                </div>
                <p style={{ margin: 0, opacity: 0.5, fontSize: "0.75rem", fontWeight: "700", letterSpacing: "0.05em" }}>GLOBAL A-LEVEL REGISTRY</p>
              </div>

              {/* STAFF CARD */}
              <div style={{ ...cardStyle, padding: "1.8rem", display: "flex", alignItems: "center", gap: "1.5rem" }}>
                <div style={{ fontSize: "3.5rem", fontWeight: "900", color: amethyst }}>{stats.teachers}</div>
                <div>
                  <div style={{ color: platinum, fontWeight: "700", textTransform: "uppercase", fontSize: "0.75rem", letterSpacing: "0.1em" }}>Teachers</div>
                  <div style={{ color: "#64748b", fontSize: "0.85rem", fontWeight: "500" }}>On system</div>
                </div>
              </div>
            </div>
          )}

          {/* ACTION CARDS */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "1.5rem"
          }}>
            {[
              { title: "Register Learners", desc: "Manage student biographical data and enrollment status.", path: "/ark/admin/alevel/learners", id: "act1" },
              { title: "Assign Subjects", desc: "Pair educators with curriculum modules and class streams.", path: "/ark/admin/alevel/assign", id: "act2" },
              { title: "Download Marks", desc: "Export academic spreadsheets and administrative datasets.", path: "/ark/admin/alevel/downloads", id: "act3" },
              { title: "Term Reports", desc: "Generate high-fidelity terminal student reports.", path: "/ark/admin/alevel/reports", id: "act4" },
            ].map((card) => (
              <div
                key={card.id}
                onMouseEnter={() => setHoveredAction(card.id)}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => navigate(card.path)}
                style={{
                  ...cardStyle,
                  padding: "2.5rem 2rem",
                  cursor: "pointer",
                  background: hoveredAction === card.id ? "rgba(255,255,255,0.04)" : "rgba(30, 41, 59, 0.3)",
                  borderColor: hoveredAction === card.id ? amethyst : "rgba(255, 255, 255, 0.05)",
                  transform: hoveredAction === card.id ? "scale(1.02)" : "none"
                }}
              >
                <h3 style={{ margin: "0 0 0.8rem 0", fontSize: "1.2rem", fontWeight: "700" }}>{card.title}</h3>
                <p style={{ color: "#94a3b8", fontSize: "0.95rem", lineHeight: "1.6", marginBottom: "2.5rem" }}>{card.desc}</p>
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

        </div>
      </main>
    </div>
  );
}
