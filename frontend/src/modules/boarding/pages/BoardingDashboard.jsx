import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import BoardingAdminShell from "../components/BoardingAdminShell";
import { boardingFetch } from "../api";
import "../../../pages/AdminDashboard.css";

const BOARDING_CLASSES = ["S1", "S2", "S3", "S4"];
const BOARDING_TERMS = ["Term 1", "Term 2", "Term 3"];

export default function BoardingDashboard() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();
  const [trackerFilters, setTrackerFilters] = useState({
    classLevel: BOARDING_CLASSES[0],
    term: BOARDING_TERMS[0],
    year: currentYear,
  });
  const [stats, setStats] = useState({
    classes: [],
    subjectCount: 0,
    trackedSubjectCount: 0,
    enteredSubjectCount: 0,
    trackerClassLevel: BOARDING_CLASSES[0],
    trackerTerm: BOARDING_TERMS[0],
    trackerYear: currentYear,
  });
  const [error, setError] = useState("");

  useEffect(() => {
    const loadStats = async () => {
      try {
        setError("");
        const params = new URLSearchParams({
          class_level: trackerFilters.classLevel,
          term: trackerFilters.term,
          year: String(trackerFilters.year),
        });
        const data = await boardingFetch(`/api/boarding/stats?${params.toString()}`);
        setStats({
          classes: Array.isArray(data?.classes) ? data.classes : [],
          subjectCount: Number(data?.subjectCount || 0),
          trackedSubjectCount: Number(data?.trackedSubjectCount || 0),
          enteredSubjectCount: Number(data?.enteredSubjectCount || 0),
          trackerClassLevel: String(data?.trackerClassLevel || trackerFilters.classLevel),
          trackerTerm: String(data?.trackerTerm || trackerFilters.term),
          trackerYear: Number(data?.trackerYear || trackerFilters.year),
        });
      } catch (err) {
        setError(err.message || "Failed to load boarding stats");
      }
    };

    loadStats();
  }, [trackerFilters.classLevel, trackerFilters.term, trackerFilters.year]);

  const totalLearners = stats.classes.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const selectedClassSummary =
    stats.classes.find((row) => String(row.class_level) === String(stats.trackerClassLevel || trackerFilters.classLevel)) || null;
  const enteredSubjectCount = Number(stats.enteredSubjectCount || 0);
  const subjectEntryPercent =
    stats.trackedSubjectCount > 0
      ? Math.max(0, Math.min(100, Math.round((enteredSubjectCount / stats.trackedSubjectCount) * 100)))
      : 0;

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

        <div
          className="panel-card"
          style={{
            background: "linear-gradient(135deg, rgba(56,189,248,0.2), rgba(15,23,42,0.76))",
            border: "1px solid rgba(56,189,248,0.3)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div>
              <div style={{ color: "#7dd3fc", fontSize: "0.74rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Subjects Entered
              </div>
              <div style={{ marginTop: "0.4rem", color: "rgba(241,245,249,0.72)", fontWeight: 700, lineHeight: 1.45 }}>
                {stats.trackerClassLevel} · {stats.trackerTerm} · {stats.trackerYear}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(118px, 1fr))", gap: "0.55rem", minWidth: "min(100%, 270px)" }}>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span style={{ color: "#dbeafe", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  Class
                </span>
                <select
                  className="admin-ops-select"
                  value={trackerFilters.classLevel}
                  onChange={(event) =>
                    setTrackerFilters((previous) => ({ ...previous, classLevel: event.target.value }))
                  }
                >
                  {BOARDING_CLASSES.map((classLevel) => (
                    <option key={classLevel} value={classLevel}>
                      {classLevel}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span style={{ color: "#dbeafe", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  Term
                </span>
                <select
                  className="admin-ops-select"
                  value={trackerFilters.term}
                  onChange={(event) =>
                    setTrackerFilters((previous) => ({ ...previous, term: event.target.value }))
                  }
                >
                  {BOARDING_TERMS.map((term) => (
                    <option key={term} value={term}>
                      {term}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: "0.55rem", marginTop: "0.6rem" }}>
            <div style={{ fontSize: "2.5rem", fontWeight: 900, lineHeight: 1 }}>{enteredSubjectCount}</div>
            <div style={{ color: "rgba(241,245,249,0.72)", fontWeight: 700 }}>of {stats.trackedSubjectCount}</div>
          </div>
          <div
            style={{
              marginTop: "0.95rem",
              height: "12px",
              width: "100%",
              borderRadius: "999px",
              overflow: "hidden",
              background: "rgba(15, 23, 42, 0.72)",
              border: "1px solid rgba(125, 211, 252, 0.16)",
              boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.24)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${subjectEntryPercent}%`,
                borderRadius: "inherit",
                background: "linear-gradient(90deg, #38bdf8 0%, #22d3ee 52%, #4ade80 100%)",
                boxShadow: "0 0 20px rgba(34, 211, 238, 0.32)",
                transition: "width 220ms ease",
              }}
            />
          </div>
          <div style={{ marginTop: "0.72rem", color: "rgba(241,245,249,0.8)", lineHeight: 1.55 }}>
            {stats.trackedSubjectCount > 0
              ? `${subjectEntryPercent}% of registered subjects in ${stats.trackerClassLevel} already have weekend marks for ${stats.trackerTerm}.`
              : selectedClassSummary
                ? `No subjects are registered for ${stats.trackerClassLevel} yet, so there is no marks coverage to track for ${stats.trackerTerm}.`
                : `No learners are registered in ${stats.trackerClassLevel} yet, so the tracker will light up once the class is populated.`}
          </div>
          <div style={{ marginTop: "0.45rem", color: "rgba(191,219,254,0.72)", fontSize: "0.84rem" }}>
            {selectedClassSummary
              ? `${selectedClassSummary.total} learners currently tracked in ${stats.trackerClassLevel}.`
              : `No boarding learners found in ${stats.trackerClassLevel} right now.`}
          </div>
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
