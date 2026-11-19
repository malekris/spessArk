import { useCallback, useEffect, useState } from "react";
import { accountsRequest } from "../api";

const money = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

const formatTimestamp = (value) => {
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

const describeAmount = (entry) => {
  const change = Number(entry.amount_change || 0);
  if (entry.transaction_type === "not_paid") return "Marked Not Paid";
  if (entry.transaction_type === "payment_cleared") return "Payment cleared";
  if (change < 0) return `${money.format(Math.abs(change))} corrected`;
  return `${money.format(change)} added`;
};

export default function AccountsTransactionSearch({ filters, refreshKey = 0, onSelectLearner }) {
  const [scope, setScope] = useState("school");
  const [query, setQuery] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadTransactions = useCallback(async () => {
    if (!filters.term || !filters.year) return;
    const params = new URLSearchParams({ term: filters.term, year: String(filters.year) });
    if (scope === "stream") {
      params.set("class_level", filters.classLevel);
      params.set("stream", filters.stream);
    }
    if (query.trim()) params.set("search", query.trim());

    try {
      setLoading(true);
      const body = await accountsRequest(`/transactions?${params.toString()}`);
      setTransactions(body.transactions || []);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [filters.classLevel, filters.stream, filters.term, filters.year, query, scope]);

  useEffect(() => {
    const timer = window.setTimeout(loadTransactions, 250);
    return () => window.clearTimeout(timer);
  }, [loadTransactions, refreshKey]);

  return (
    <section className="accounts-insight-card is-wide">
      <header><div><span>Ledger Finder</span><h3>Transaction Search</h3></div><strong>{transactions.length}</strong></header>
      <div className="accounts-insight-toolbar">
        <div className="accounts-scope-toggle" role="group" aria-label="Transaction search scope">
          <button type="button" className={scope === "school" ? "is-active" : ""} onClick={() => setScope("school")}>Whole school</button>
          <button type="button" className={scope === "stream" ? "is-active" : ""} onClick={() => setScope("stream")}>This stream</button>
        </div>
        <input type="search" value={query} placeholder="Learner or bursar" aria-label="Search transactions" onChange={(event) => setQuery(event.target.value)} />
      </div>
      {loading ? <div className="accounts-insight-state">Searching transactions...</div> : transactions.length ? (
        <div className="accounts-search-transaction-list">
          {transactions.map((entry) => (
            <article key={`${entry.source}-${entry.id}`}>
              <button type="button" onClick={() => onSelectLearner?.({ ...entry, id: entry.learner_id })}>{entry.learner_name}</button>
              <span>{entry.class_level} {entry.stream} · {entry.term} {entry.academic_year}</span>
              <strong className={Number(entry.amount_change || 0) < 0 ? "is-negative" : ""}>{describeAmount(entry)}</strong>
              <small>By {entry.recorded_by_name} · {formatTimestamp(entry.created_at)}</small>
            </article>
          ))}
        </div>
      ) : <div className="accounts-insight-state">No transactions match this search.</div>}
      {error ? <p className="accounts-insight-error">{error}</p> : null}
    </section>
  );
}
