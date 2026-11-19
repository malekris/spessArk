import { useCallback, useEffect, useState } from "react";
import { accountsRequest } from "../api";

const money = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

export default function AccountsTodayCollections({ refreshKey = 0 }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await accountsRequest("/insights/today"));
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(loadSummary, 0);
    const timer = window.setInterval(loadSummary, 30_000);
    window.addEventListener("focus", loadSummary);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", loadSummary);
    };
  }, [loadSummary, refreshKey]);

  return (
    <section className="accounts-insight-card is-today">
      <header><div><span>Today</span><h3>Today’s Collections</h3></div><strong>Live</strong></header>
      {summary ? (
        <div className="accounts-today-grid">
          <div className="accounts-today-total"><span>Collected</span><strong>{money.format(Number(summary.collected || 0))}</strong><small>{summary.transaction_count || 0} transactions</small></div>
          <div><span>Day</span><strong>{money.format(Number(summary.day_collected || 0))}</strong></div>
          <div><span>Hostel</span><strong>{money.format(Number(summary.hostel_collected || 0))}</strong></div>
          <div><span>Corrections</span><strong>{summary.corrections || 0}</strong></div>
        </div>
      ) : <div className="accounts-insight-state">Loading today’s collections...</div>}
      {error ? <p className="accounts-insight-error">{error}</p> : null}
    </section>
  );
}
