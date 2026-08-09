import { useMemo } from "react";
import {
  formatCardDateTime,
  normalizeDashboardTerm,
  toTimeValue,
} from "./dashboardCardUtils";

export default function LatestMarksActivityCard({
  oLevelMarks = [],
  aLevelMarks = [],
  term,
  academicYear,
  onOpenMarks,
}) {
  const activity = useMemo(() => {
    const selectedTerm = normalizeDashboardTerm(term);
    const selectedYear = Number(academicYear);

    // Both mark sources are reduced to one display contract. The source arrays
    // remain untouched because they are also used by compliance and downloads.
    const oLevelRows = oLevelMarks.map((row, index) => ({
      key: `o-${row.assignment_id}-${row.aoi_label}-${index}`,
      level: "O-Level",
      subject: row.subject || "Unknown subject",
      location: `${row.class_level || "—"} ${row.stream || "—"}`.trim(),
      component: row.aoi_label || "Assessment",
      teacher: row.teacher_name || "Teacher unavailable",
      marksCount: Number(row.marks_count || 0),
      submittedAt: row.submitted_at || row.updated_at || null,
      term: row.term,
      year: row.year,
    }));
    const aLevelRows = aLevelMarks.map((row, index) => ({
      key: `a-${row.assignment_id}-${row.aoi_label}-${index}`,
      level: "A-Level",
      subject: row.subject_display || row.subject || "Unknown subject",
      location: row.stream || "A-Level",
      component: row.aoi_label || "Assessment",
      teacher: row.teacher_name || "Teacher unavailable",
      marksCount: Number(row.marks_count || 0),
      submittedAt: row.submitted_at || row.created_at || null,
      term: row.term,
      year: row.year,
    }));

    return [...oLevelRows, ...aLevelRows]
      .filter(
        (row) =>
          normalizeDashboardTerm(row.term) === selectedTerm &&
          Number(row.year) === selectedYear
      )
      .sort((a, b) => toTimeValue(b.submittedAt) - toTimeValue(a.submittedAt));
  }, [aLevelMarks, academicYear, oLevelMarks, term]);

  const latest = activity[0] || null;

  return (
    <article className="admin-pulse-card admin-pulse-card-marks">
      <header className="admin-pulse-card-header">
        <div>
          <h3>Latest Marks Activity</h3>
          <p>Newest submitted mark sets for {normalizeDashboardTerm(term)} {academicYear}.</p>
        </div>
        <span className="admin-pulse-badge">{activity.length} sets</span>
      </header>

      {latest ? (
        <>
          <div className="admin-pulse-calendar-focus">
            <strong>{latest.subject} · {latest.component}</strong>
            <span>{latest.location} · {latest.teacher}</span>
          </div>

          <div className="admin-pulse-list">
            {activity.slice(0, 3).map((row) => (
              <div className="admin-pulse-row" key={row.key}>
                <div>
                  <strong>{row.subject} · {row.component}</strong>
                  <small>{row.level} · {row.location} · {row.marksCount} scores</small>
                </div>
                <span className="admin-pulse-row-value">{formatCardDateTime(row.submittedAt)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="admin-pulse-empty">
          No submitted mark sets are available for {normalizeDashboardTerm(term)} {academicYear}.
        </div>
      )}

      <button type="button" className="admin-pulse-card-action" onClick={onOpenMarks}>
        Open marks data centre
      </button>
    </article>
  );
}
