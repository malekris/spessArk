import { useCallback, useEffect, useState } from "react";
import { accountsRequest } from "../api";

const money = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

const formatTime = (value) => {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity";
  return date.toLocaleTimeString("en-GB", {
    timeZone: "Africa/Kampala",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function AccountsBursarActivitySummary({ refreshKey = 0 }) {
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState("");

  const loadActivity = useCallback(async () => {
    try {
      const body = await accountsRequest("/insights/bursar-activity");
      setStaff(Array.isArray(body?.staff) ? body.staff : []);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(loadActivity, 0);
    const timer = window.setInterval(loadActivity, 30_000);
    window.addEventListener("focus", loadActivity);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", loadActivity);
    };
  }, [loadActivity, refreshKey]);

  return (
    <section className="accounts-insight-card">
      <header><div><span>Team Today</span><h3>Bursar Activity Summary</h3></div><strong>{staff.length}</strong></header>
      {staff.length ? (
        <div className="accounts-activity-list">
          {staff.map((member) => (
            <article key={member.recorded_by_name}>
              <div className="accounts-activity-avatar" aria-hidden="true">{String(member.recorded_by_name || "A").slice(0, 1).toUpperCase()}</div>
              <div><strong>{member.recorded_by_name}</strong><span>{member.transaction_count} transactions · Last at {formatTime(member.last_activity_at)}</span></div>
              <div><strong>{money.format(Number(member.collected || 0))}</strong><span>{member.corrections || 0} corrections</span></div>
            </article>
          ))}
        </div>
      ) : <div className="accounts-insight-state">No bursar transactions recorded today.</div>}
      {error ? <p className="accounts-insight-error">{error}</p> : null}
    </section>
  );
}
