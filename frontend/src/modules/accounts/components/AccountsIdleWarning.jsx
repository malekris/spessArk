const WARNING_SECONDS = 60;

export default function AccountsIdleWarning({ secondsRemaining, onLogout, onRenew }) {
  const progress = Math.max(0, Math.min(100, (Number(secondsRemaining || 0) / WARNING_SECONDS) * 100));

  return (
    <div className="accounts-idle-overlay" role="presentation">
      <section className="accounts-idle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="accounts-idle-title" aria-describedby="accounts-idle-copy">
        <div className="accounts-idle-badge"><span aria-hidden="true" /> Secure Finance Session</div>
        <h2 id="accounts-idle-title">Still working in SPESS Accounts?</h2>
        <p id="accounts-idle-copy">
          This workspace has been inactive. It will sign out automatically in <strong>{secondsRemaining} seconds</strong> to protect learner financial records.
        </p>
        <div className="accounts-idle-countdown"><strong>{secondsRemaining}s</strong><span>Automatic logout armed</span></div>
        <div className="accounts-idle-meter" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        <div className="accounts-idle-actions">
          <button type="button" className="is-logout" onClick={onLogout}>Log Out</button>
          <button type="button" className="is-renew" onClick={onRenew}>Stay Signed In</button>
        </div>
      </section>
    </div>
  );
}
