import { useNavigate } from "react-router-dom";

export default function ALevelDashboard() {
  const navigate = useNavigate();

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

        <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel")}>
          Dashboard
        </button>

        <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/learners")}>
          Learners
        </button>

        <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/assign")}>
          Assign Subjects
        </button>

        <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/downloads")}>
          Downloads
        </button>

        <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/reports")}>
          Reports
        </button>

        <div style={{ marginTop: "auto" }}>
          <button className="danger-link" onClick={() => navigate("/ark/admin")}>
            ← Back to O-Level Admin
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: "2rem" }}>
        <h1 style={{ fontSize: "1.8rem", marginBottom: "0.6rem" }}>
          A-Level Administration
        </h1>

        <p style={{ color: "#94a3b8", marginBottom: "2rem" }}>
          Manage S5/S6 learners, subject allocations, reports and downloads.
        </p>

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
            <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/learners")}>
              Open
            </button>
          </div>

          <div className="panel-card">
            <h3>Assign Subjects</h3>
            <p className="muted-text">Assign teachers to A-Level subjects.</p>
            <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/assign")}>
              Open
            </button>
          </div>

          <div className="panel-card">
            <h3>Downloads</h3>
            <p className="muted-text">Download submitted marks.</p>
            <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/downloads")}>
              Open
            </button>
          </div>

          <div className="panel-card">
            <h3>Reports</h3>
            <p className="muted-text">Generate A-Level term reports.</p>
            <button className="ghost-btn" onClick={() => navigate("/ark/admin/alevel/reports")}>
              Open
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
