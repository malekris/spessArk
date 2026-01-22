import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";



export default function ALevelDashboard() {
  const navigate = useNavigate();
    const API_BASE = import.meta.env.VITE_API_BASE;

  const [stats, setStats] = useState(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/alevel/stats`)
    .then(res => res.json())
      .then(setStats)
      .catch(console.error);
  }, []);
  
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0f172a", color: "#e5e7eb" }}>
      
      {/* Sidebar */}
      <aside
        style={{
          width: "260px",
          background: "rgba(15,23,42,0.98)",
          borderRight: "1px solid rgba(148,163,184,0.15)",
          padding: "1.4rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.6rem"
        }}
      >
        <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>
          🎓 A-Level Admin
        </h2>

        <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel")}>Dashboard</button>
        <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/learners")}>Learners</button>
        <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/assign")}>Assign Subjects</button>
        <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/downloads")}>Downloads</button>
        <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/reports")}>Reports</button>

        <div style={{ marginTop: "auto" }}>
          <button className="danger-link" onClick={() => navigate("/ark/admin")}>
            ← Back to O-Level Admin
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: "0" }}>

        {/* ===== HERO IMAGE (BANK / AIRPORT STYLE) ===== */}
        <div
          style={{
            height: "260px",
            backgroundImage: "url(/carey.jpg)",
            backgroundSize: "cover",
            backgroundPosition: "center",
            position: "relative"
          }}
        >
          {/* Dark overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(to bottom, rgba(0,0,0,0.4), #0f172a)"
            }}
          />

          {/* Text on banner */}
          <div style={{ position: "relative", padding: "2rem" }}>
            <h1 style={{ fontSize: "2.2rem", fontWeight: "bold" }}>
              A-Level Administration
            </h1>
            <p style={{ color: "#cbd5e1", maxWidth: "600px" }}>
              Manage S5/S6 learners, subject allocations, reports and downloads.
            </p>
          </div>
        </div>

        {/* Actual content padding */}
        <div style={{ padding: "2rem" }}>

          {/* ===== STATS CARDS ===== */}
          {stats && (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      gap: "1rem",
      marginBottom: "2rem"
    }}
  >
    {stats.streams.map((s) => (
      <div key={s.stream} className="panel-card">
        <h3>{s.stream}</h3>
        <p className="muted-text">
          👦 Boys: <strong>{s.boys}</strong><br />
          👧 Girls: <strong>{s.girls}</strong><br />
          📚 Total: <strong>{s.total}</strong>
        </p>
      </div>
    ))}
   <div
  className="panel-card"
  style={{
    position: "relative",
    overflow: "hidden",
    background:
      "linear-gradient(135deg, rgba(30,64,175,0.35), rgba(15,23,42,0.95))",
    border: "1px solid rgba(59,130,246,0.25)",
  }}
>
  {/* Glow orb */}
  <div
    style={{
      position: "absolute",
      top: "-60px",
      right: "-60px",
      width: "160px",
      height: "160px",
      background: "radial-gradient(circle, rgba(59,130,246,0.45), transparent 70%)",
      filter: "blur(10px)",
    }}
  />

  <h3 style={{ letterSpacing: "0.08em" }}>
    Total A-Level Population
  </h3>

  {/* Premium number */}
  <div
    style={{
      fontSize: "3.4rem",
      fontWeight: "900",
      margin: "0.5rem 0",
      background: "linear-gradient(to right, #60a5fa, #38bdf8, #22d3ee)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      letterSpacing: "0.04em",
    }}
  >
    {stats.streams.reduce((sum, s) => sum + s.total, 0)}
  </div>

  <p className="muted-text">
    Total learners across S5 & S6
  </p>
</div>

    <div className="panel-card">
      <h3>Teachers</h3>
      <p className="muted-text">
        👨‍🏫 Registered teachers: <strong>{stats.teachers}</strong>
      </p>
    </div>
  </div>
          )}


          {/* ===== YOUR ORIGINAL CARDS (UNCHANGED) ===== */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "1rem"
            }}
          >
            <div className="panel-card">
              <h3>Learners</h3>
              <p className="muted-text">Register and manage S5/S6 students.</p>
              <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/learners")}>Open</button>
            </div>

            <div className="panel-card">
              <h3>Assign Subjects</h3>
              <p className="muted-text">Assign teachers to A-Level subjects.</p>
              <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/assign")}>Open</button>
            </div>

            <div className="panel-card">
              <h3>Downloads</h3>
              <p className="muted-text">Download submitted marks.</p>
              <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/downloads")}>Open</button>
            </div>

            <div className="panel-card">
              <h3>Reports</h3>
              <p className="muted-text">Generate A-Level term reports.</p>
              <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/reports")}>Open</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
