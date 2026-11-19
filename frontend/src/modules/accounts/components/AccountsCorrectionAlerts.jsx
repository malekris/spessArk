import { useCallback, useEffect, useState } from "react";
import { accountsRequest } from "../api";

const money = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

const formatTimestamp = (value) => {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Kampala",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function AccountsCorrectionAlerts({ refreshKey = 0, onSelectLearner }) {
  const [corrections, setCorrections] = useState([]);
  const [error, setError] = useState("");

  const loadCorrections = useCallback(async () => {
    try {
      const body = await accountsRequest("/insights/corrections");
      setCorrections(Array.isArray(body?.corrections) ? body.corrections : []);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(loadCorrections, 0);
    const timer = window.setInterval(loadCorrections, 30_000);
    window.addEventListener("focus", loadCorrections);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", loadCorrections);
    };
  }, [loadCorrections, refreshKey]);

  return (
    <section className="accounts-insight-card is-alerts">
      <header><div><span>Review</span><h3>Correction Alerts</h3></div><strong>{corrections.length}</strong></header>
      {corrections.length ? (
        <div className="accounts-correction-list">
          {corrections.map((entry) => (
            <article key={entry.id}>
              <button type="button" onClick={() => onSelectLearner?.(entry)}>{entry.learner_name}</button>
              <span>{entry.class_level} {entry.stream} · {entry.term} {entry.academic_year}</span>
              <strong>{entry.transaction_type === "payment_cleared" ? "Payment cleared" : `${money.format(Math.abs(Number(entry.amount_change || 0)))} reduced`}</strong>
              <small>By {entry.recorded_by_name} · {formatTimestamp(entry.created_at)}</small>
            </article>
          ))}
        </div>
      ) : <div className="accounts-insight-state is-clear">No payment corrections need attention.</div>}
      {error ? <p className="accounts-insight-error">{error}</p> : null}
    </section>
  );
}
