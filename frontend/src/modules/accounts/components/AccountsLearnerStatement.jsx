const money = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleDateString("en-GB", {
    timeZone: "Africa/Kampala",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

export default function AccountsLearnerStatement({ learner, history, summary, onBack }) {
  return (
    <div className="accounts-learner-statement">
      <div className="accounts-statement-actions">
        <button type="button" onClick={onBack}>Back to history</button>
        <button type="button" className="is-print" onClick={() => window.print()}>Print Statement</button>
      </div>

      <header className="accounts-statement-header">
        <span>SPESS Accounts</span>
        <h2>ST. PHILLIP&apos;S EQUATORIAL SECONDARY SCHOOL</h2>
        <p>Learner Financial Statement</p>
      </header>

      <dl className="accounts-statement-profile">
        <div><dt>Learner</dt><dd>{learner.learner_name}</dd></div>
        <div><dt>Class / Stream</dt><dd>{learner.class_level} {learner.stream}</dd></div>
        <div><dt>Learner ID</dt><dd>{learner.id}</dd></div>
        <div><dt>Total Recorded</dt><dd>{money.format(Number(summary?.total_paid || 0))}</dd></div>
      </dl>

      <div className="accounts-statement-table-wrap">
        <table>
          <thead><tr><th>Period</th><th>Section</th><th>Expected</th><th>Paid</th><th>Balance</th><th>Recorded By</th></tr></thead>
          <tbody>
            {history.length ? history.map((entry) => {
              const paid = Number(entry.amount_paid || 0);
              const expected = Number(entry.expected_amount || 0);
              const balance = Math.max(0, expected - paid);
              return (
                <tr key={entry.id}>
                  <td>{entry.term} {entry.academic_year}</td>
                  <td>{entry.section === "Boarding" ? "Hostel" : entry.section}</td>
                  <td>{money.format(expected)}</td>
                  <td>{entry.amount_paid === null ? "Not recorded" : paid === 0 ? "Not Paid" : money.format(paid)}</td>
                  <td>{balance === 0 ? "Nil" : money.format(balance)}</td>
                  <td>{entry.saved_by || "Accounts Office"}</td>
                </tr>
              );
            }) : <tr><td colSpan="6">No term payments recorded.</td></tr>}
          </tbody>
        </table>
      </div>

      <footer className="accounts-statement-footer">
        <span>Added to the school register: {formatDate(learner.added_at)}</span>
        <span>Generated: {formatDate(new Date())}</span>
      </footer>
    </div>
  );
}
