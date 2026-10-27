import "./AssignmentGradeHistory.css";

const displayValue = (value, fallback = "Not set") => {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).replace(/_/g, " ");
};

const isInitialGrade = (row) => {
  const priorStatus = String(row?.previous_status || "").toLowerCase();
  return row?.previous_score === null
    && !["graded", "needs_revision", "missing"].includes(priorStatus);
};

export default function AssignmentGradeHistory({ history = [] }) {
  if (!Array.isArray(history) || history.length === 0) return null;

  return (
    <details className="assignment-grade-history">
      <summary>
        <span>Grade history</span>
        <b>{history.length} {history.length === 1 ? "entry" : "entries"}</b>
      </summary>
      <div className="assignment-grade-history-list">
        {history.map((row) => {
          const initial = isInitialGrade(row);
          const grader = row.grader_display_name || row.grader_username || "Community owner";
          return (
            <article key={row.id} className="assignment-grade-history-entry">
              <div className="assignment-grade-history-entry-head">
                <strong>{initial ? "Initial grade" : "Grade revised"}</strong>
                <time>{row.changed_at ? new Date(row.changed_at).toLocaleString() : "Time unavailable"}</time>
              </div>
              <div className="assignment-grade-history-change">
                {!initial && (
                  <span className="assignment-grade-history-before">
                    {displayValue(row.previous_score)} · {displayValue(row.previous_status)}
                  </span>
                )}
                {!initial && <i aria-hidden="true">to</i>}
                <span className="assignment-grade-history-after">
                  {displayValue(row.new_score)} · {displayValue(row.new_status)}
                </span>
              </div>
              <small>Changed by {grader}</small>
              {row.new_feedback && <p>{row.new_feedback}</p>}
            </article>
          );
        })}
      </div>
    </details>
  );
}
