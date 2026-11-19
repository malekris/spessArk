import { useCallback, useEffect, useState } from "react";
import { accountsRequest } from "../api";

const money = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

export default function AccountsOutstandingBalances({ filters, refreshKey = 0, onSelectLearner }) {
  const [scope, setScope] = useState("school");
  const [query, setQuery] = useState("");
  const [data, setData] = useState({ learners: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadBalances = useCallback(async () => {
    if (!filters.term || !filters.year) return;
    const params = new URLSearchParams({ term: filters.term, year: String(filters.year) });
    if (scope === "stream") {
      params.set("class_level", filters.classLevel);
      params.set("stream", filters.stream);
    }
    if (query.trim()) params.set("search", query.trim());

    try {
      setLoading(true);
      const body = await accountsRequest(`/insights/outstanding?${params.toString()}`);
      setData({ learners: body.learners || [], summary: body.summary || {} });
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [filters.classLevel, filters.stream, filters.term, filters.year, query, scope]);

  useEffect(() => {
    const timer = window.setTimeout(loadBalances, 250);
    return () => window.clearTimeout(timer);
  }, [loadBalances, refreshKey]);

  return (
    <section className="accounts-insight-card is-wide">
      <header>
        <div><span>Follow Up</span><h3>Outstanding Balances</h3></div>
        <strong>{data.summary.learners || 0}</strong>
      </header>

      <div className="accounts-insight-toolbar">
        <div className="accounts-scope-toggle" role="group" aria-label="Outstanding balance scope">
          <button type="button" className={scope === "school" ? "is-active" : ""} onClick={() => setScope("school")}>Whole school</button>
          <button type="button" className={scope === "stream" ? "is-active" : ""} onClick={() => setScope("stream")}>This stream</button>
        </div>
        <input type="search" value={query} placeholder="Search learner" aria-label="Search outstanding balances" onChange={(event) => setQuery(event.target.value)} />
      </div>

      <div className="accounts-outstanding-total">
        <span>Outstanding for {filters.term} {filters.year}</span>
        <strong>{money.format(Number(data.summary.total_balance || 0))}</strong>
        <small>{scope === "school" ? "Across recorded school accounts" : `${filters.classLevel} ${filters.stream}`}</small>
      </div>

      {loading ? <div className="accounts-insight-state">Loading balances...</div> : data.learners.length ? (
        <div className="accounts-balance-list">
          {data.learners.map((learner) => (
            <article key={`${learner.learner_level}-${learner.learner_id}`}>
              <button type="button" onClick={() => onSelectLearner?.({ ...learner, id: learner.learner_id })}>{learner.learner_name}</button>
              <span>{learner.class_level} {learner.stream} · {learner.residence_type === "Boarding" ? "Hostel" : "Day"}</span>
              <div><small>Paid {money.format(Number(learner.amount_paid || 0))}</small><strong>{money.format(Number(learner.balance || 0))}</strong></div>
            </article>
          ))}
        </div>
      ) : <div className="accounts-insight-state is-clear">No outstanding balance matches this view.</div>}
      {error ? <p className="accounts-insight-error">{error}</p> : null}
    </section>
  );
}
