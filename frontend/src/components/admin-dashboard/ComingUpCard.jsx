import { useMemo } from "react";
import { formatCardDate } from "./dashboardCardUtils";

export default function ComingUpCard({
  timelineEntries = [],
  calendarBadge = {},
  academicYear,
  onOpenCalendar,
}) {
  const schedule = useMemo(() => {
    // Active entries are shown first because their closing date is the next
    // operational milestone; future entries then follow by start date.
    const relevant = timelineEntries
      .filter((entry) => entry.phase === "active" || entry.phase === "upcoming")
      .sort((a, b) => String(a.from || "").localeCompare(String(b.from || "")));
    const active = relevant.find((entry) => entry.phase === "active") || null;
    const upcoming = relevant.filter((entry) => entry.phase === "upcoming").slice(0, 2);
    const focus = active || upcoming[0] || null;

    return { active, upcoming, focus };
  }, [timelineEntries]);

  const focusDate = schedule.active ? schedule.active.to : schedule.focus?.from;
  const focusVerb = schedule.active ? "ends" : "begins";

  return (
    <article className="admin-pulse-card admin-pulse-card-calendar">
      <header className="admin-pulse-card-header">
        <div>
          <h3>Coming Up</h3>
          <p>The next dates already published in the school calendar.</p>
        </div>
        <span className="admin-pulse-badge">AY {academicYear}</span>
      </header>

      {schedule.focus ? (
        <>
          <div className="admin-pulse-calendar-focus">
            <strong>{schedule.focus.label} {focusVerb}</strong>
            <span>{formatCardDate(focusDate, { weekday: "short" })}</span>
          </div>

          <div className="admin-pulse-primary">
            <strong>{calendarBadge.daysRemaining ?? "—"}</strong>
            <span>{calendarBadge.daysRemaining === 1 ? "day remaining" : "days remaining"} in the current calendar window</span>
          </div>

          <div className="admin-pulse-list">
            {schedule.upcoming.map((entry) => (
              <div className="admin-pulse-row" key={entry.key}>
                <div>
                  <strong>{entry.label}</strong>
                  <small>{entry.displayStatus}</small>
                </div>
                <span className="admin-pulse-row-value">{formatCardDate(entry.from, { year: undefined })}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="admin-pulse-empty">
          No future calendar milestone is published. Update the school calendar to restore this view.
        </div>
      )}

      <button type="button" className="admin-pulse-card-action" onClick={onOpenCalendar}>
        Open school calendar
      </button>
    </article>
  );
}
