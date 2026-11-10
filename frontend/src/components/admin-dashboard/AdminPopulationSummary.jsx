import "./AdminPopulationSummary.css";

const getPercent = (value, total) => {
  if (!total) return 0;
  return Math.round((Number(value || 0) / Number(total)) * 100);
};

export default function AdminPopulationSummary({
  learnerTotal = 0,
  boys = 0,
  girls = 0,
  teacherTotal = 0,
  academicYear,
  viewMode = "live",
}) {
  const boysPercent = getPercent(boys, learnerTotal);
  const girlsPercent = getPercent(girls, learnerTotal);
  const learnerTeacherRatio = teacherTotal
    ? Math.max(1, Math.round(learnerTotal / teacherTotal))
    : 0;
  const modeLabel = viewMode === "live" ? "Live register" : "Year snapshot";

  return (
    <section className="admin-population-summary" aria-label="School population summary">
      <article className="admin-population-card admin-population-card-learners">
        <header className="admin-population-card-header">
          <div className="admin-population-heading">
            <span className="admin-population-mark" aria-hidden="true">OL</span>
            <div>
              <span className="admin-population-eyebrow">Active enrolment</span>
              <h3>O-Level Learners</h3>
            </div>
          </div>
          <span className="admin-population-status">{modeLabel}</span>
        </header>

        <div className="admin-population-primary">
          <strong>{learnerTotal.toLocaleString()}</strong>
          <span>learners in the current school register</span>
        </div>

        <div className="admin-population-gender-track" aria-label={`${boysPercent}% boys and ${girlsPercent}% girls`}>
          <span className="is-boys" style={{ width: `${boysPercent}%` }} />
          <span className="is-girls" style={{ width: `${girlsPercent}%` }} />
        </div>

        <div className="admin-population-detail-grid">
          <div>
            <span>Boys</span>
            <strong>{boys.toLocaleString()}</strong>
            <small>{boysPercent}% of register</small>
          </div>
          <div>
            <span>Girls</span>
            <strong>{girls.toLocaleString()}</strong>
            <small>{girlsPercent}% of register</small>
          </div>
        </div>
      </article>

      <article className="admin-population-card admin-population-card-teachers">
        <header className="admin-population-card-header">
          <div className="admin-population-heading">
            <span className="admin-population-mark" aria-hidden="true">ST</span>
            <div>
              <span className="admin-population-eyebrow">Teaching register</span>
              <h3>Teachers</h3>
            </div>
          </div>
          <span className="admin-population-status">{academicYear}</span>
        </header>

        <div className="admin-population-primary">
          <strong>{teacherTotal.toLocaleString()}</strong>
          <span>teacher accounts currently enrolled</span>
        </div>

        <div className="admin-population-teacher-summary">
          <span>O-Level learner ratio</span>
          <strong>{learnerTeacherRatio ? `1 : ${learnerTeacherRatio}` : "-"}</strong>
          <small>One teacher for approximately {learnerTeacherRatio || 0} active O-Level learners</small>
        </div>
      </article>
    </section>
  );
}
