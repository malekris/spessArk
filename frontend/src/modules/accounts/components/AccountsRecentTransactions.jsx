import { useCallback, useEffect, useState } from "react";
import { accountsRequest } from "../api";

const moneyFormatter = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

const formatMoney = (value) => moneyFormatter.format(Math.abs(Number(value || 0)));

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

const describeTransaction = (transaction) => {
  const change = Number(transaction.amount_change || 0);
  switch (transaction.transaction_type) {
    case "not_paid":
      return { label: "Not Paid recorded", tone: "neutral" };
    case "payment_cleared":
      return { label: "Payment cleared", tone: "negative" };
    case "payment_corrected":
      return { label: `${formatMoney(change)} corrected`, tone: "negative" };
    case "initial_record":
      return { label: `${formatMoney(transaction.new_amount)} recorded`, tone: "neutral" };
    default:
      return { label: `+${formatMoney(change)} added`, tone: "positive" };
  }
};

export default function AccountsRecentTransactions({ refreshKey = 0 }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadTransactions = useCallback(async () => {
    try {
      const body = await accountsRequest("/recent-transactions");
      setTransactions(Array.isArray(body?.transactions) ? body.transactions : []);
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Could not update transactions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTransactions();
    const intervalId = window.setInterval(loadTransactions, 30_000);
    window.addEventListener("focus", loadTransactions);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", loadTransactions);
    };
  }, [loadTransactions, refreshKey]);

  return (
    <section className="accounts-recent-transactions" aria-labelledby="accounts-recent-transactions-title">
      <header className="accounts-recent-transactions-header">
        <div>
          <span>Live Ledger</span>
          <h2 id="accounts-recent-transactions-title">Last five transactions</h2>
        </div>
        <strong>{transactions.length}/5</strong>
      </header>

      {loading ? (
        <div className="accounts-transactions-state">Loading recent transactions...</div>
      ) : transactions.length ? (
        <div className="accounts-transactions-list" aria-live="polite">
          {transactions.map((transaction) => {
            const description = describeTransaction(transaction);
            return (
              <article
                key={`${transaction.source}-${transaction.id}`}
                className="accounts-transaction-row"
              >
                <div className="accounts-transaction-sequence" aria-hidden="true">{String(transaction.learner_name || "L").trim().slice(0, 1).toUpperCase()}</div>
                <div className="accounts-transaction-copy">
                  <strong>{transaction.learner_name}</strong>
                  <span>
                    {transaction.class_level} {transaction.stream} · {transaction.residence_type === "Boarding" ? "Hostel" : "Day"} · {transaction.term} {transaction.academic_year}
                  </span>
                  <small>By {transaction.recorded_by_name || "Accounts Office"} · {formatTimestamp(transaction.created_at)}</small>
                </div>
                <strong className={`accounts-transaction-amount is-${description.tone}`}>
                  {description.label}
                </strong>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="accounts-transactions-state">No fee transactions have been recorded yet.</div>
      )}

      {error ? <p className="accounts-transactions-error" role="status">{error}</p> : null}
    </section>
  );
}
