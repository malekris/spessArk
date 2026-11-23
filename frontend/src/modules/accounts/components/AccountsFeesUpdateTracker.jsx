import { useCallback, useEffect, useMemo, useState } from "react";
import { accountsRequest } from "../api";

const STATUS_LABELS = {
  complete: "Complete",
  in_progress: "In progress",
  untouched: "Untouched",
};

const formatUpdateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Kampala",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function AccountsFeesUpdateTracker({ filters, terms = [], refreshKey = 0, onPeriodChange, onSelectLearner }) {
  const [data, setData] = useState({ classes: [], summary: {} });
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadTracker = useCallback(async () => {
    if (!filters.term || !filters.year) return;
    try {
      setLoading(true);
      const params = new URLSearchParams({
        term: filters.term,
        year: String(filters.year),
      });
      const body = await accountsRequest(`/insights/fees-update-tracker?${params.toString()}`);
      setData({ classes: body.classes || [], summary: body.summary || {} });
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Failed to load fees updates.");
    } finally {
      setLoading(false);
    }
  }, [filters.term, filters.year]);

  useEffect(() => {
    loadTracker();
  }, [loadTracker, refreshKey]);

  const visibleClasses = useMemo(() => data.classes.map((classGroup) => ({
    ...classGroup,
    streams: classGroup.streams.map((stream) => ({
      ...stream,
      visibleLearners: stream.learners.filter((learner) => (
        statusFilter === "all" ||
        (statusFilter === "updated" && learner.updated) ||
        (statusFilter === "untouched" && !learner.updated)
      )),
    })).filter((stream) => stream.learners.some((learner) => (
      statusFilter === "all" ||
      (statusFilter === "updated" && learner.updated) ||
      (statusFilter === "untouched" && !learner.updated)
    ))),
  })).filter((classGroup) => classGroup.streams.length > 0), [data.classes, statusFilter]);

  const summary = data.summary || {};

  return (
    <section className="accounts-tracker-panel accounts-update-tracker" id="accounts-tracker-panel">
      <header>
        <div><span>Owner Oversight</span><h3>Fees Update Tracker</h3></div>
        <strong>{summary.completion_percent || 0}%</strong>
      </header>

      <div className="accounts-tracker-summary" aria-label="Fees update summary">
        <div><span>Updated learners</span><strong>{summary.updated_learners || 0}</strong><small>of {summary.total_learners || 0}</small></div>
        <div><span>Untouched learners</span><strong>{summary.untouched_learners || 0}</strong><small>Need an entry</small></div>
        <div><span>Complete classes</span><strong>{summary.complete_classes || 0}</strong><small>of {summary.total_classes || 0}</small></div>
        <div className={summary.untouched_classes ? "is-alert" : ""}><span>Untouched classes</span><strong>{summary.untouched_classes || 0}</strong><small>No learner updated</small></div>
      </div>

      <div className="accounts-tracker-controls">
        <div>
          <strong>{filters.term} {filters.year}</strong>
          <span>Open a class, then a stream, to review every learner.</span>
        </div>
        <div className="accounts-tracker-period">
          <label><span>Term</span><select value={filters.term} onChange={(event) => onPeriodChange?.("term", event.target.value)}>
            {terms.map((term) => <option key={term} value={term}>{term}</option>)}
          </select></label>
          <label><span>Year</span><input type="number" min="2020" max="2100" value={filters.year} onChange={(event) => onPeriodChange?.("year", event.target.value)} /></label>
        </div>
        <div className="accounts-tracker-filter" role="group" aria-label="Filter learner update status">
          {[
            ["all", "All"],
            ["updated", "Updated"],
            ["untouched", "Untouched"],
          ].map(([value, label]) => (
            <button key={value} type="button" className={statusFilter === value ? "is-active" : ""} onClick={() => setStatusFilter(value)}>{label}</button>
          ))}
        </div>
      </div>

      {loading ? <div className="accounts-insight-state">Loading class updates...</div> : visibleClasses.length ? (
        <div className="accounts-tracker-classes">
          {visibleClasses.map((classGroup) => (
            <details key={classGroup.class_level} className={`accounts-tracker-class is-${classGroup.status}`}>
              <summary>
                <span className="accounts-tracker-class-name">{classGroup.class_level}</span>
                <div className="accounts-tracker-progress-copy">
                  <strong>{classGroup.updated_learners} of {classGroup.total_learners} learners</strong>
                  <div className="accounts-tracker-progress" aria-label={`${classGroup.completion_percent}% complete`}><span style={{ width: `${classGroup.completion_percent}%` }} /></div>
                </div>
                <span className={`accounts-tracker-status is-${classGroup.status}`}>{STATUS_LABELS[classGroup.status]}</span>
              </summary>

              <div className="accounts-tracker-streams">
                {classGroup.streams.map((stream) => (
                  <details key={`${classGroup.class_level}-${stream.stream}`} className="accounts-tracker-stream">
                    <summary>
                      <div><strong>{stream.stream}</strong><span>{stream.updated_learners} updated · {stream.untouched_learners} untouched</span></div>
                      <span className={`accounts-tracker-status is-${stream.status}`}>{STATUS_LABELS[stream.status]}</span>
                    </summary>
                    <div className="accounts-tracker-learners">
                      {stream.visibleLearners.map((learner) => (
                        <article key={`${learner.learner_level}-${learner.learner_id}`}>
                          <button type="button" onClick={() => onSelectLearner?.({
                            ...learner,
                            id: learner.learner_id,
                            class_level: classGroup.class_level,
                            stream: stream.stream,
                          })}>{learner.learner_name}</button>
                          <span>{learner.updated ? `Updated${learner.updated_by ? ` by ${learner.updated_by}` : ""}` : "No fees entry this term"}</span>
                          <strong className={learner.updated ? "is-updated" : "is-untouched"}>{learner.updated ? "Updated" : "Untouched"}</strong>
                          {learner.updated_at ? <small>{formatUpdateTime(learner.updated_at)}</small> : null}
                        </article>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      ) : <div className="accounts-insight-state">No learners match this tracker view.</div>}

      {error ? <p className="accounts-insight-error">{error}</p> : null}
      <button type="button" className="accounts-tracker-refresh" onClick={loadTracker} disabled={loading}>Refresh tracker</button>
    </section>
  );
}
