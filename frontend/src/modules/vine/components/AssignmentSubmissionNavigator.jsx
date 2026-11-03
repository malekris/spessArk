import "./AssignmentSubmissionNavigator.css";

const clampIndex = (value, total) =>
  Math.min(Math.max(Number(value) || 0, 0), Math.max(0, Number(total) - 1));

export default function AssignmentSubmissionNavigator({
  currentIndex,
  learnerName,
  onSelect,
  placement = "top",
  total,
}) {
  const safeTotal = Math.max(0, Number(total) || 0);
  if (safeTotal === 0) return null;

  const safeIndex = clampIndex(currentIndex, safeTotal);
  const atFirst = safeIndex === 0;
  const atLast = safeIndex === safeTotal - 1;
  const progressPercent = Math.round(((safeIndex + 1) / safeTotal) * 100);
  const progress = `${progressPercent}%`;
  const progressTone = progressPercent >= 100
    ? "complete"
    : progressPercent >= 75
      ? "strong"
      : progressPercent >= 50
        ? "steady"
        : progressPercent >= 25
          ? "warming"
          : "starting";
  const select = (nextIndex) => onSelect(clampIndex(nextIndex, safeTotal));

  return (
    <nav
      className={`assignment-submission-navigator is-${placement}`}
      aria-label={`${placement === "bottom" ? "Continue" : "Navigate"} learner submissions`}
    >
      <div className="assignment-submission-position">
        <span>Reviewing learner</span>
        <strong>{safeIndex + 1} of {safeTotal}</strong>
        <small>{learnerName || "Learner submission"}</small>
      </div>

      <div
        className={`assignment-submission-progress is-${progressTone}`}
        role="progressbar"
        aria-label="Submission review progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={progressPercent}
      >
        <i style={{ width: progress }} />
      </div>

      <div className="assignment-submission-navigation-actions">
        <button type="button" onClick={() => select(0)} disabled={atFirst}>
          First
        </button>
        <button type="button" onClick={() => select(safeIndex - 1)} disabled={atFirst}>
          Previous
        </button>
        <button type="button" onClick={() => select(safeIndex + 1)} disabled={atLast}>
          Next
        </button>
        <button type="button" onClick={() => select(safeTotal - 1)} disabled={atLast}>
          Last
        </button>
      </div>
    </nav>
  );
}
