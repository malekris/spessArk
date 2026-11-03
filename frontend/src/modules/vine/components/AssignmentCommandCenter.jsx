import { useState } from "react";
import "./AssignmentCommandCenter.css";

const numberOf = (value) => Math.max(0, Number(value || 0));

const reminderCooldownLabel = (value) => {
  if (!value) return "";
  const elapsed = Date.now() - new Date(value).getTime();
  const remaining = (6 * 60 * 60 * 1000) - elapsed;
  if (!Number.isFinite(remaining) || remaining <= 0) return "";
  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  return `Available in ${hours}h`;
};

export default function AssignmentCommandCenter({
  assignments = [],
  selectedAssignmentId,
  remindingAssignmentId,
  onReview,
  onRemind,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const totals = assignments.reduce(
    (summary, assignment) => ({
      graded: summary.graded + numberOf(assignment.graded_count),
      awaiting: summary.awaiting + numberOf(assignment.awaiting_grading_count),
      missing: summary.missing + numberOf(assignment.missing_count),
    }),
    { graded: 0, awaiting: 0, missing: 0 }
  );

  return (
    <section className={`assignment-command-center ${isOpen ? "is-open" : "is-collapsed"}`}>
      <button
        type="button"
        className="assignment-command-center-shelf"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-controls="assignment-command-center-body"
      >
        <span className="assignment-command-center-shelf-icon" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
        <span className="assignment-command-center-copy">
          <span className="assignment-command-center-kicker">Owner workspace</span>
          <strong id="assignment-command-center-title">Assignment Command Center</strong>
          <small>{isOpen ? "Workload queue open" : "Workload overview"}</small>
        </span>
        <span className="assignment-command-center-summary" aria-label="Assignment workload summary">
          <span><small>Assignments</small><strong>{assignments.length}</strong></span>
          <span><small>Graded</small><strong>{totals.graded}</strong></span>
          <span><small>To grade</small><strong>{totals.awaiting}</strong></span>
          <span className={totals.missing > 0 ? "has-missing" : "is-clear"}>
            <small>Missing</small><strong>{totals.missing}</strong>
          </span>
        </span>
        <span className="assignment-command-center-shelf-action">
          {isOpen ? "Close" : "Open"}
          <i aria-hidden="true" />
        </span>
      </button>

      {isOpen && (
        <div id="assignment-command-center-body" className="assignment-command-center-body">
          {assignments.length === 0 ? (
            <div className="assignment-command-center-empty">Create an assignment to start tracking the class.</div>
          ) : (
            <div className="assignment-command-center-list">
              {assignments.map((assignment) => {
                const eligible = numberOf(assignment.eligible_learner_count);
                const submitted = numberOf(assignment.submission_count);
                const graded = numberOf(assignment.graded_count);
                const awaiting = numberOf(assignment.awaiting_grading_count);
                const missing = numberOf(assignment.missing_count);
                const completion = eligible > 0 ? Math.min(100, Math.round((submitted / eligible) * 100)) : 0;
                const cooldown = reminderCooldownLabel(assignment.latest_reminder_at);
                const isReminding = Number(remindingAssignmentId) === Number(assignment.id);
                const isReviewing = Number(selectedAssignmentId) === Number(assignment.id);

                return (
                  <article key={assignment.id} className="assignment-command-row">
                    <div className="assignment-command-title">
                      <strong>{assignment.title || "Untitled assignment"}</strong>
                      <span>{submitted} of {eligible} learners submitted</span>
                    </div>
                    <div className="assignment-command-progress" aria-label={`${completion}% submitted`}>
                      <span style={{ width: `${completion}%` }} />
                    </div>
                    <div className="assignment-command-counts">
                      <span><b>{graded}</b> graded</span>
                      <span><b>{awaiting}</b> awaiting</span>
                      <span className={missing > 0 ? "is-missing" : "is-complete"}><b>{missing}</b> missing</span>
                    </div>
                    <div className="assignment-command-actions">
                      <button type="button" className="assignment-command-review" onClick={() => onReview(assignment.id)}>
                        {isReviewing ? "Close review" : "Review work"}
                      </button>
                      <button
                        type="button"
                        className="assignment-command-remind"
                        onClick={() => onRemind(assignment)}
                        disabled={missing === 0 || isReminding || Boolean(cooldown)}
                        title={cooldown || (missing === 0 ? "Every learner has submitted" : "Notify missing learners")}
                      >
                        {isReminding ? "Sending..." : cooldown || (missing === 0 ? "Everyone submitted" : `Remind ${missing} missing`)}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
