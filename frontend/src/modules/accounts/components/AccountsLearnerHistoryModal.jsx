import { useEffect, useRef, useState } from "react";
import { accountsRequest } from "../api";
import AccountsLearnerStatement from "./AccountsLearnerStatement";

const moneyFormatter = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

const formatMoney = (value) => moneyFormatter.format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString("en-GB", {
    timeZone: "Africa/Kampala",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const formatTimestamp = (value) => {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Kampala",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getInitials = (name) => String(name || "Learner")
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part.slice(0, 1).toUpperCase())
  .join("") || "L";

export default function AccountsLearnerHistoryModal({ learner, onClose }) {
  const closeButtonRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("history");

  useEffect(() => {
    let active = true;

    accountsRequest(
      `/learners/${encodeURIComponent(learner.learner_level)}/${encodeURIComponent(learner.id)}/payment-history`
    )
      .then((body) => active && setData(body))
      .catch((requestError) => active && setError(requestError.message))
      .finally(() => active && setLoading(false));

    return () => { active = false; };
  }, [learner.id, learner.learner_level]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const profile = data?.learner || learner;
  const history = data?.history || [];

  return (
    <div
      className="accounts-history-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="accounts-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounts-history-title"
      >
        <header className="accounts-history-header">
          <div className="accounts-history-identity">
            <div className="accounts-history-avatar" aria-hidden="true">
              {getInitials(profile.learner_name)}
            </div>
            <div>
              <span>Payment History</span>
              <h2 id="accounts-history-title">{profile.learner_name}</h2>
              <p>
                {profile.class_level || "Class unavailable"}
                {profile.stream ? ` · ${profile.stream}` : ""}
                {profile.id ? ` · ID ${profile.id}` : ""}
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="accounts-history-close"
            title="Close payment history"
            aria-label="Close payment history"
            onClick={onClose}
          >×</button>
        </header>

        {loading ? (
          <div className="accounts-history-state">Loading payment history...</div>
        ) : error ? (
          <div className="accounts-history-state is-error" role="alert">{error}</div>
        ) : view === "statement" ? (
          <AccountsLearnerStatement
            learner={profile}
            history={history}
            summary={data?.summary}
            onBack={() => setView("history")}
          />
        ) : (
          <div className="accounts-history-body">
            <div className="accounts-history-actions">
              <button type="button" onClick={() => setView("statement")}>Learner Statement</button>
            </div>
            <dl className="accounts-history-profile">
              <div><dt>Current stream</dt><dd>{profile.class_level} {profile.stream}</dd></div>
              <div><dt>Added to system</dt><dd>{formatDate(profile.added_at)}</dd></div>
              <div><dt>Payment records</dt><dd>{data?.summary?.records || 0}</dd></div>
              <div><dt>Total recorded</dt><dd>{formatMoney(data?.summary?.total_paid)}</dd></div>
            </dl>

            <div className="accounts-history-section-heading">
              <span>Term Ledger</span>
              <strong>{history.length} record{history.length === 1 ? "" : "s"}</strong>
            </div>

            {history.length ? (
              <div className="accounts-history-list">
                {history.map((entry) => {
                  const hasAmount = entry.amount_paid !== null && entry.amount_paid !== undefined;
                  const paid = Number(entry.amount_paid || 0);
                  const expected = Number(entry.expected_amount || 0);
                  const balance = Math.max(0, expected - paid);
                  const section = entry.section === "Boarding" ? "Hostel" : entry.section;
                  return (
                    <article key={entry.id} className="accounts-history-entry">
                      <div className="accounts-history-entry-title">
                        <div>
                          <span>{entry.term}</span>
                          <strong>{entry.academic_year}</strong>
                        </div>
                        <span className="accounts-history-section-pill">{section || "Section unavailable"}</span>
                      </div>
                      <p>{entry.class_level} {entry.stream}</p>
                      <div className="accounts-history-money-row">
                        <div><span>Paid</span><strong className={hasAmount && paid === 0 ? "is-not-paid" : ""}>{hasAmount ? (paid === 0 ? "Not Paid" : formatMoney(paid)) : "Not recorded"}</strong></div>
                        <div><span>Expected</span><strong>{formatMoney(expected)}</strong></div>
                        <div><span>Balance</span><strong>{balance === 0 ? "Nil" : formatMoney(balance)}</strong></div>
                      </div>
                      <footer>
                        <span>Saved by <strong>{entry.saved_by || "Accounts Office"}</strong></span>
                        <span>Added {formatTimestamp(entry.added_at)}</span>
                        {entry.updated_at && entry.updated_at !== entry.added_at ? (
                          <span>Updated {formatTimestamp(entry.updated_at)}</span>
                        ) : null}
                      </footer>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="accounts-history-empty">
                No term payment has been recorded for this learner yet.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
