import { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../../lib/api";

const responseTotal = (result) =>
  result?.status === "fulfilled" ? Number(result.value?.total || 0) : 0;

export default function LearnerMovementCard({
  oLevelLearners = [],
  aLevelLearners = [],
  academicYear,
  onOpenPromotions,
}) {
  const [history, setHistory] = useState({ promoted: 0, graduated: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const registerCounts = useMemo(() => {
    // O-Level keeps paused learners in the admin register. A-Level's standard
    // learner feed contains active learners, while archived S6 totals come from
    // the dedicated promotion endpoint below.
    const activeOLevel = oLevelLearners.filter(
      (learner) => String(learner.status || "active").trim().toLowerCase() === "active"
    ).length;
    const pausedOLevel = Math.max(0, oLevelLearners.length - activeOLevel);

    return {
      activeOLevel,
      pausedOLevel,
      activeALevel: aLevelLearners.length,
      activeTotal: activeOLevel + aLevelLearners.length,
    };
  }, [aLevelLearners, oLevelLearners]);

  useEffect(() => {
    let active = true;

    const loadMovementHistory = async () => {
      setLoading(true);
      setError("");
      const shared = { page: "1", limit: "1", academicYear: String(academicYear) };

      // Promise.allSettled keeps the card useful when one school-level history
      // endpoint is temporarily unavailable.
      const requests = [
        adminFetch(`/api/admin/promotions/history?${new URLSearchParams(shared)}`),
        adminFetch(`/api/admin/graduated?${new URLSearchParams(shared)}`),
        adminFetch(`/api/alevel/admin/promotions/history?${new URLSearchParams(shared)}`),
        adminFetch(`/api/alevel/admin/archived-learners?${new URLSearchParams(shared)}`),
      ];
      const results = await Promise.allSettled(requests);

      if (!active) return;
      const promoted = responseTotal(results[0]) + responseTotal(results[2]);
      const graduated = responseTotal(results[1]) + responseTotal(results[3]);
      setHistory({ promoted, graduated });

      const failedRequests = results.filter((result) => result.status === "rejected").length;
      if (failedRequests > 0) {
        setError(
          failedRequests === results.length
            ? "Promotion history is temporarily unavailable; live register counts are still shown."
            : "Some promotion history could not be loaded; displayed movement totals may be incomplete."
        );
      }
      setLoading(false);
    };

    loadMovementHistory();
    return () => {
      active = false;
    };
  }, [academicYear]);

  return (
    <article className="admin-pulse-card admin-pulse-card-movement">
      <header className="admin-pulse-card-header">
        <div>
          <h3>Learner Movement</h3>
          <p>Active, paused, promoted and archived learner movement for {academicYear}.</p>
        </div>
        <span className="admin-pulse-badge">{loading ? "Loading" : "Year view"}</span>
      </header>

      <div className="admin-pulse-primary">
        <strong>{registerCounts.activeTotal}</strong>
        <span>active learners across both school levels</span>
      </div>

      <div className="admin-pulse-kpis">
        <div className="admin-pulse-kpi">
          <span>O-Level Active</span>
          <strong>{registerCounts.activeOLevel}</strong>
          <small>Current register</small>
        </div>
        <div className="admin-pulse-kpi">
          <span>A-Level Active</span>
          <strong>{registerCounts.activeALevel}</strong>
          <small>Current register</small>
        </div>
        <div className="admin-pulse-kpi">
          <span>Paused</span>
          <strong>{registerCounts.pausedOLevel}</strong>
          <small>Records retained</small>
        </div>
        <div className="admin-pulse-kpi">
          <span>Promoted / Archived</span>
          <strong>{history.promoted} / {history.graduated}</strong>
          <small>{academicYear} history</small>
        </div>
      </div>

      {error && <div className="admin-pulse-error">{error}</div>}

      <button type="button" className="admin-pulse-card-action" onClick={onOpenPromotions}>
        Open learner promotion
      </button>
    </article>
  );
}
