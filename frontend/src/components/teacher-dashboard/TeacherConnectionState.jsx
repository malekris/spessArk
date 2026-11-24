import badge from "../../assets/badge.png";
import "./TeacherConnectionState.css";

const formatDetectedTime = (value) => {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export default function TeacherConnectionState({ issue, retrying, onRetry }) {
  if (!issue) return null;

  const isOffline = issue.kind === "offline";
  const title = isOffline
    ? "Your connection dropped"
    : "SPESS ARK may be temporarily unavailable";
  const description = isOffline
    ? "This device is offline. Your entered marks are still preserved on this screen, but they cannot be sent until the connection returns."
    : "The server is not responding normally. This may be a short service interruption; your current mark entry has not been cleared.";

  return (
    <div className="teacher-connection-state" role="alertdialog" aria-modal="true" aria-labelledby="teacher-connection-title">
      <div className="teacher-connection-state__rail" aria-hidden="true" />

      <main className="teacher-connection-state__content">
        <header className="teacher-connection-state__brand">
          <img src={badge} alt="St. Phillip's Equatorial Secondary School" />
          <div>
            <strong>SPESS ARK</strong>
            <span>Teacher workspace</span>
          </div>
        </header>

        <section className="teacher-connection-state__message">
          <div className={`teacher-connection-state__signal ${isOffline ? "is-offline" : "is-outage"}`} aria-hidden="true">
            <span />
            <span />
            <span />
            <i />
          </div>

          <p className="teacher-connection-state__eyebrow">
            {isOffline ? "Device offline" : "Possible service interruption"}
          </p>
          <h1 id="teacher-connection-title">{title}</h1>
          <p className="teacher-connection-state__description">{description}</p>

          <div className="teacher-connection-state__status" aria-label="Connection details">
            <div>
              <span>Connection</span>
              <strong>{isOffline ? "Offline" : "Server unavailable"}</strong>
            </div>
            <div>
              <span>Entered marks</span>
              <strong>Preserved on this screen</strong>
            </div>
            <div>
              <span>Detected</span>
              <strong>{formatDetectedTime(issue.detectedAt)}</strong>
            </div>
          </div>

          <div className="teacher-connection-state__warning">
            <span aria-hidden="true">!</span>
            <p><strong>Do not refresh or close this tab.</strong> Unsaved marks could be lost if the page is closed.</p>
          </div>

          <button type="button" className="teacher-connection-state__retry" onClick={onRetry} disabled={retrying}>
            {retrying ? "Checking connection..." : "Retry connection"}
          </button>

          <p className="teacher-connection-state__footnote">
            The dashboard will reopen automatically as soon as the connection is confirmed.
          </p>
        </section>
      </main>
    </div>
  );
}
