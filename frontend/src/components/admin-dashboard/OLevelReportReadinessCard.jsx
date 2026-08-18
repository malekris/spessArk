import { useMemo, useState } from "react";
import { buildOLevelReportReadiness } from "./oLevelReportReadiness";
import "./OLevelReportReadinessCard.css";

const STATUS_LABELS = {
  complete: "Fully Complete",
  ready: "Print Ready",
  blocked: "Blocked",
  setup: "Assignments Needed",
};

const SubjectList = ({ label, subjects }) => {
  if (!subjects.length) return null;
  return (
    <div className="o-readiness-gap-group">
      <strong>{label}</strong>
      <span>{subjects.join(", ")}</span>
    </div>
  );
};

export default function OLevelReportReadinessCard({
  assignments = [],
  marksSets = [],
  term,
  academicYear,
  loading = false,
  error = "",
  onRefresh,
  onOpenTracker,
}) {
  const [refreshing, setRefreshing] = useState(false);
  const readiness = useMemo(
    () => buildOLevelReportReadiness({ assignments, marksSets, term, academicYear }),
    [academicYear, assignments, marksSets, term]
  );

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const allTrackedStreamsReady =
    readiness.setupStreams === 0 &&
    readiness.trackedStreams === readiness.totalStreams &&
    readiness.printReadyStreams === readiness.totalStreams;
  const actionRequiredStreams = readiness.blockedStreams + readiness.setupStreams;

  return (
    <article className="o-readiness-card">
      <header className="o-readiness-header">
        <div>
          <span className="o-readiness-eyebrow">O-Level printing checkpoint</span>
          <h2>Report Readiness</h2>
          <p>
            {readiness.term} {readiness.academicYear}: AOI 1 and AOI 2 are required before a stream is print ready. AOI 3 marks full end-of-term completion.
          </p>
        </div>
        <span className={`o-readiness-overall ${allTrackedStreamsReady ? "is-ready" : "is-attention"}`}>
          {loading ? "Refreshing" : allTrackedStreamsReady ? "Printing Ready" : "Action Required"}
        </span>
      </header>

      <div className="o-readiness-summary" aria-label="O-Level report readiness summary">
        <div>
          <span>Required coverage</span>
          <strong>{readiness.requiredCoverage}%</strong>
          <small>AOI 1 + AOI 2</small>
        </div>
        <div>
          <span>Print-ready streams</span>
          <strong>{readiness.printReadyStreams} / {readiness.totalStreams}</strong>
          <small>Minimum grading load met</small>
        </div>
        <div>
          <span>Fully complete</span>
          <strong>{readiness.fullyCompleteStreams}</strong>
          <small>AOI 1 + AOI 2 + AOI 3</small>
        </div>
        <div>
          <span>Action required</span>
          <strong>{actionRequiredStreams}</strong>
          <small>Missing AOIs or assignments</small>
        </div>
      </div>

      <div className="o-readiness-meter" aria-label={`${readiness.requiredCoverage}% required AOI coverage`}>
        <span style={{ width: `${readiness.requiredCoverage}%` }} />
      </div>

      {error && <div className="o-readiness-error">{error}</div>}

      <div className="o-readiness-stream-list" role="list" aria-label="Readiness by O-Level stream">
        {readiness.streams.map((row) => (
          <details className={`o-readiness-stream is-${row.status}`} key={row.key} role="listitem">
            <summary>
              <div className="o-readiness-stream-name">
                <strong>{row.classLevel} {row.stream}</strong>
                <small>{row.expectedTotal} assigned subjects</small>
              </div>
              <span className={`o-readiness-status is-${row.status}`}>{STATUS_LABELS[row.status]}</span>
              <div className="o-readiness-aoi">
                <span>AOI 1</span>
                <strong>{row.aoi1Submitted}/{row.expectedTotal}</strong>
              </div>
              <div className="o-readiness-aoi">
                <span>AOI 2</span>
                <strong>{row.aoi2Submitted}/{row.expectedTotal}</strong>
              </div>
              <div className="o-readiness-aoi is-final">
                <span>AOI 3</span>
                <strong>{row.aoi3Submitted}/{row.expectedTotal}</strong>
              </div>
            </summary>

            <div className="o-readiness-gaps">
              {row.status === "setup" ? (
                <p>No active subject assignments were found for this stream. Assign its teachers before relying on report readiness.</p>
              ) : row.fullyComplete ? (
                <p>Every assigned subject has AOI 1, AOI 2 and AOI 3. This stream is fully complete.</p>
              ) : (
                <>
                  <SubjectList label="Missing AOI 1 (blocks printing)" subjects={row.missingAoi1} />
                  <SubjectList label="Missing AOI 2 (blocks printing)" subjects={row.missingAoi2} />
                  <SubjectList label="AOI 3 outstanding" subjects={row.missingAoi3} />
                </>
              )}
            </div>
          </details>
        ))}
      </div>

      <footer className="o-readiness-footer">
        <div className="o-readiness-legend" aria-label="Readiness legend">
          <span><i className="is-complete" /> Fully Complete</span>
          <span><i className="is-ready" /> Print Ready</span>
          <span><i className="is-blocked" /> Blocked</span>
        </div>
        <div className="o-readiness-actions">
          <button type="button" className="ghost-btn" onClick={handleRefresh} disabled={loading || refreshing}>
            {loading || refreshing ? "Refreshing..." : "Refresh readiness"}
          </button>
          <button type="button" className="primary-btn" onClick={onOpenTracker}>
            Review submissions
          </button>
        </div>
      </footer>
    </article>
  );
}
