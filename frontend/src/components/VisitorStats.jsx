import { useEffect, useRef, useState } from "react";
import { plainFetch } from "../lib/api";
import { SITE_VISIT_STATS_EVENT } from "../hooks/useSiteVisitTracking";
import "./VisitorStats.css";

const EMPTY_STATS = {
  total: 0,
  today: 0,
  surfaces: {
    home: { total: 0 },
    ark: { total: 0 },
    vine: { total: 0 },
  },
};

const formatCount = (value) => new Intl.NumberFormat("en-UG").format(Number(value) || 0);

export default function VisitorStats() {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [available, setAvailable] = useState(true);
  const recordedVisitRef = useRef(false);

  useEffect(() => {
    const handleRecordedVisit = (event) => {
      if (event.detail) {
        recordedVisitRef.current = true;
        setStats(event.detail);
        setAvailable(true);
      }
    };

    window.addEventListener(SITE_VISIT_STATS_EVENT, handleRecordedVisit);
    plainFetch("/api/public/visits")
      .then((payload) => {
        // Do not let an earlier GET response overwrite the fresher POST result.
        if (!recordedVisitRef.current) setStats(payload || EMPTY_STATS);
        setAvailable(true);
      })
      .catch(() => setAvailable(false));

    return () => window.removeEventListener(SITE_VISIT_STATS_EVENT, handleRecordedVisit);
  }, []);

  return (
    <section className="visitor-stats" aria-labelledby="visitor-stats-title">
      <div className="visitor-stats-heading">
        <span>Our digital reach</span>
        <h2 id="visitor-stats-title">Daily visitors</h2>
        <p>Unique daily reach across the school website and learning platforms.</p>
      </div>

      {available ? (
        <dl className="visitor-stats-grid">
          <div className="visitor-stat-primary">
            <dt>Visitors today</dt>
            <dd>{formatCount(stats.today)}</dd>
          </div>
          <div>
            <dt>Website today</dt>
            <dd>{formatCount(stats.surfaces?.home?.today)}</dd>
          </div>
          <div>
            <dt>SPESS ARK today</dt>
            <dd>{formatCount(stats.surfaces?.ark?.today)}</dd>
          </div>
          <div>
            <dt>SPESS Vine today</dt>
            <dd>{formatCount(stats.surfaces?.vine?.today)}</dd>
          </div>
        </dl>
      ) : (
        <p className="visitor-stats-unavailable">Visitor count is temporarily unavailable.</p>
      )}
    </section>
  );
}
