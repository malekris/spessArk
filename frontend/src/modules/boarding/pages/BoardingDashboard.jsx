import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import BoardingAdminShell from "../components/BoardingAdminShell";
import { boardingFetch } from "../api";
import "../../../pages/AdminDashboard.css";

export default function BoardingDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ classes: [], subjectCount: 0 });
  const [error, setError] = useState("");

  useEffect(() => {
    const loadStats = async () => {
      try {
        const data = await boardingFetch("/api/boarding/stats");
        setStats({
          classes: Array.isArray(data?.classes) ? data.classes : [],
          subjectCount: Number(data?.subjectCount || 0),
        });
      } catch (err) {
        setError(err.message || "Failed to load boarding stats");
      }
    };

    loadStats();
  }, []);

  const totalLearners = stats.classes.reduce((sum, row) => sum + Number(row.total || 0), 0);

  return (
    <BoardingAdminShell
      title="Boarding Dashboard"
      subtitle="Manage boarding learners, capture weekend assessments, and process simple term reports without touching the main admin dashboard."
    >
      {error && <div className="panel-alert panel-alert-error">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
        {stats.classes.map((row) => (
          <div key={row.class_level} className="panel-card" style={{ background: "rgba(15,23,42,0.58)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ color: "#4ade80", fontSize: "0.74rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>{row.class_level}</div>
            <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "rgba(241,245,249,0.72)" }}>Male</span><strong>{row.boys}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "rgba(241,245,249,0.72)" }}>Female</span><strong>{row.girls}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "0.6rem" }}><span style={{ color: "rgba(241,245,249,0.72)" }}>Total</span><strong>{row.total}</strong></div>
            </div>
          </div>
        ))}

        <div className="panel-card" style={{ background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(15,23,42,0.72))", border: "1px solid rgba(74,222,128,0.34)" }}>
          <div style={{ color: "#4ade80", fontSize: "0.74rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Boarding Total</div>
          <div style={{ fontSize: "2.7rem", fontWeight: 900, marginTop: "0.5rem" }}>{totalLearners}</div>
          <div style={{ color: "rgba(241,245,249,0.72)", marginTop: "0.4rem" }}>{stats.subjectCount} subjects available for boarding registration</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", marginTop: "1.25rem" }}>
        {[
          {
            title: "Register Learners",
            desc: "Create and update the boarding register with optional subjects attached to each learner.",
            path: "/ark/boarding/learners",
            accent: "#4ade80",
          },
          {
            title: "Weekend Marks",
            desc: "Open a subject by class, enter the weekend assessment scores, and save them from the boarding account.",
            path: "/ark/boarding/marks",
            accent: "#38bdf8",
          },
          {
            title: "Report Hub",
            desc: "Generate simple term report cards from the weekend assessment record for each boarding class.",
            path: "/ark/boarding/reports",
            accent: "#facc15",
          },
        ].map((card) => (
          <button
            key={card.path}
            type="button"
            onClick={() => navigate(card.path)}
            className="panel-card"
            style={{
              textAlign: "left",
              color: "#f8fafc",
              background: "linear-gradient(180deg, rgba(15,23,42,0.82) 0%, rgba(7,13,26,0.94) 100%)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderTop: `3px solid ${card.accent}`,
              borderRadius: "18px",
              padding: "1.15rem 1.1rem 1.2rem",
              boxShadow: "0 18px 34px rgba(2, 6, 23, 0.26)",
              cursor: "pointer",
              appearance: "none",
            }}
          >
            <div style={{ color: card.accent, fontSize: "0.75rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Module</div>
            <h3 style={{ margin: "0.5rem 0 0", fontSize: "1.1rem", color: "#f8fafc", fontWeight: 900 }}>{card.title}</h3>
            <p style={{ margin: "0.7rem 0 0", color: "rgba(241,245,249,0.84)", lineHeight: 1.6 }}>{card.desc}</p>
          </button>
        ))}
      </div>
    </BoardingAdminShell>
  );
}
