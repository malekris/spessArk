import "./ArkMaintenancePage.css";

export default function ArkMaintenancePage({ maintenance, onBack }) {
  const title = maintenance?.title || "SPESS ARK is under maintenance";
  const message =
    maintenance?.message ||
    "Teacher access is temporarily paused while the system is being updated. Please try again shortly.";
  const eta = maintenance?.eta || "";

  return (
    <div className="ark-maintenance-shell">
      <div className="ark-maintenance-orb ark-maintenance-orb-one" />
      <div className="ark-maintenance-orb ark-maintenance-orb-two" />
      <main className="ark-maintenance-card" role="status" aria-live="polite">
        <div className="ark-maintenance-kicker">
          <span className="ark-maintenance-pulse" />
          Protected Service Window
        </div>

        <h1>{title}</h1>
        <p>{message}</p>

        <div className="ark-maintenance-status-grid">
          <div>
            <span>Status</span>
            <strong>Maintenance Active</strong>
          </div>
          <div>
            <span>Teacher Portal</span>
            <strong>Temporarily Paused</strong>
          </div>
          <div>
            <span>Expected Return</span>
            <strong>{eta || "Admin will reopen shortly"}</strong>
          </div>
        </div>

        <div className="ark-maintenance-progress" aria-hidden="true">
          <span />
        </div>

        <div className="ark-maintenance-actions">
          <button type="button" onClick={() => window.location.reload()}>
            Check Again
          </button>
          {onBack && (
            <button type="button" className="ark-maintenance-ghost" onClick={onBack}>
              Back to Website
            </button>
          )}
        </div>

        <small>
          Admin access remains available so the school can reopen the portal when maintenance is complete.
        </small>
      </main>
    </div>
  );
}
