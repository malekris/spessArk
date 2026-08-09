import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_SCHOOL_CALENDAR,
  getSchoolCalendarTimelineEntries,
  normalizeSchoolCalendar,
} from "../utils/schoolCalendar";
import { useSiteVisuals } from "../utils/siteVisuals";
import "./SchoolUpdatesSection.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

const formatDate = (value) => {
  if (!value) return "Date awaiting update";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "Date awaiting update";
  return new Intl.DateTimeFormat("en-UG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
};

const ordinalDay = (day) => {
  const remainder100 = day % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
};

const formatStoryDate = (value, fallbackValue) => {
  const raw = value || fallbackValue;
  const match = String(raw || "").match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (!match) return "Date awaiting update";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (Number.isNaN(date.getTime())) return "Date awaiting update";

  const parts = new Intl.DateTimeFormat("en-UG", {
    timeZone: "Africa/Kampala",
    weekday: "long",
    month: "long",
    year: "numeric",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.weekday} ${ordinalDay(day)} ${byType.month} ${byType.year}`;
};

export default function SchoolUpdatesSection() {
  const siteVisuals = useSiteVisuals();
  const [calendar, setCalendar] = useState(() => normalizeSchoolCalendar(DEFAULT_SCHOOL_CALENDAR));

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/school-calendar`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load school calendar");
        return response.json();
      })
      .then((payload) => {
        if (active) setCalendar(normalizeSchoolCalendar(payload));
      })
      .catch(() => {
        // The published fallback keeps the homepage useful during a brief API outage.
      });
    return () => {
      active = false;
    };
  }, []);

  const importantDates = useMemo(() => {
    const timeline = getSchoolCalendarTimelineEntries(calendar);
    const activeEntry = timeline.find((entry) => entry.phase === "active") || null;
    const upcomingEntries = timeline.filter((entry) => entry.phase === "upcoming").slice(0, 3);
    return [activeEntry, ...upcomingEntries].filter(Boolean).slice(0, 4);
  }, [calendar]);

  const hasPublishedNews = Boolean(
    siteVisuals.spess_news_published &&
    siteVisuals.spess_news_heading &&
    siteVisuals.spess_news_body
  );

  return (
    <section id="updates" className="school-updates-section">
      <div className="school-updates-inner">
        <header className="school-updates-heading">
          <span>From St. Phillip&apos;s</span>
          <h2>School updates</h2>
          <p>What is happening now, and the dates our community is preparing for next.</p>
        </header>

        <div className="school-updates-grid">
          <article className={`spess-news-story ${siteVisuals.spess_news_image_url ? "with-image" : ""}`}>
            {hasPublishedNews ? (
              <>
                {siteVisuals.spess_news_image_url && (
                  <figure className="spess-news-image">
                    <img src={siteVisuals.spess_news_image_url} alt={siteVisuals.spess_news_heading} loading="lazy" />
                  </figure>
                )}
                <div className="spess-news-copy">
                  <div className="school-update-label-row">
                    <span className="school-update-label">SPESS News</span>
                    <time dateTime={siteVisuals.spess_news_posted_on || siteVisuals.updated_at || undefined}>
                      {formatStoryDate(siteVisuals.spess_news_posted_on, siteVisuals.updated_at)}
                    </time>
                  </div>
                  <h3>{siteVisuals.spess_news_heading}</h3>
                  <p>{siteVisuals.spess_news_body}</p>
                </div>
              </>
            ) : (
              <div className="spess-news-copy spess-news-empty">
                <span className="school-update-label">SPESS News</span>
                <h3>Stories from our school community</h3>
                <p>The next school story will appear here once it is published by the Guardian.</p>
              </div>
            )}
          </article>

          <aside className="important-dates" aria-labelledby="important-dates-title">
            <div className="important-dates-head">
              <div>
                <span className="school-update-label">Calendar</span>
                <h3 id="important-dates-title">Important dates</h3>
              </div>
              <span className="important-dates-year">AY {calendar.academicYear}</span>
            </div>

            <div className="important-dates-list">
              {importantDates.map((entry) => {
                const active = entry.phase === "active";
                const date = active ? entry.to : entry.from;
                return (
                  <div className={`important-date-row ${active ? "active" : ""}`} key={entry.key}>
                    <div>
                      <strong>{entry.label}</strong>
                      <span>{active ? "Current period ends" : entry.displayStatus}</span>
                    </div>
                    <time dateTime={date}>{formatDate(date)}</time>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
