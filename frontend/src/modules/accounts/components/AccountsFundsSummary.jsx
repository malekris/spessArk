import { useEffect, useState } from "react";
import { accountsRequest } from "../api";

const moneyFormatter = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

const formatMoney = (value) => moneyFormatter.format(Number(value || 0));

const formatUpdatedAt = (value) => {
  if (!value) return "No collections entered yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return `Updated ${date.toLocaleString("en-GB", {
    timeZone: "Africa/Kampala",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

export default function AccountsFundsSummary({ term, year, refreshKey = 0 }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const numericYear = Number(year);
  const validScope = Boolean(
    term && Number.isInteger(numericYear) && numericYear >= 2020 && numericYear <= 2100
  );

  useEffect(() => {
    let active = true;
    if (!validScope) return undefined;
    const params = new URLSearchParams({ term, year: String(year) });
    accountsRequest(`/funds-summary?${params.toString()}`)
      .then((body) => {
        if (active) {
          setSummary(body);
          setError("");
        }
      })
      .catch((summaryError) => {
        if (active) setError(summaryError.message || "Funds summary unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [refreshKey, term, validScope, year]);

  const visibleSummary = validScope && summary?.term === term && Number(summary?.year) === numericYear
    ? summary
    : null;
  const visibleLoading = validScope && (loading || !visibleSummary) && !error;

  return (
    <section className="accounts-funds-summary" aria-labelledby="accounts-funds-title">
      <header className="accounts-funds-header">
        <div>
          <span>School collections</span>
          <h2 id="accounts-funds-title">Funds Summary</h2>
        </div>
        <strong>{term} {year}</strong>
      </header>

      {validScope && error ? (
        <div className="accounts-funds-error" role="alert">{error}</div>
      ) : (
        <div className="accounts-funds-grid" aria-busy={visibleLoading}>
          <div className="accounts-funds-total">
            <span>Total collected</span>
            <strong>{visibleLoading ? "Loading..." : formatMoney(visibleSummary?.total_collected)}</strong>
            <small>{visibleLoading ? "Reading the accounts ledger" : formatUpdatedAt(visibleSummary?.updated_at)}</small>
          </div>
          <div className="accounts-funds-stat is-day">
            <span>Day collected</span>
            <strong>{visibleLoading ? "-" : formatMoney(visibleSummary?.day_collected)}</strong>
          </div>
          <div className="accounts-funds-stat is-hostel">
            <span>Hostel collected</span>
            <strong>{visibleLoading ? "-" : formatMoney(visibleSummary?.hostel_collected)}</strong>
          </div>
          <div className="accounts-funds-stat is-entries">
            <span>Recorded learners</span>
            <strong>{visibleLoading ? "-" : Number(visibleSummary?.recorded_entries || 0).toLocaleString("en-UG")}</strong>
          </div>
          <div className="accounts-funds-stat is-not-paid">
            <span>Marked Not Paid</span>
            <strong>{visibleLoading ? "-" : Number(visibleSummary?.not_paid_entries || 0).toLocaleString("en-UG")}</strong>
          </div>
        </div>
      )}
    </section>
  );
}
