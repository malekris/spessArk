import { useEffect } from "react";
import "./AccountsSplashScreen.css";

export default function AccountsSplashScreen({ durationMs, onFinish }) {
  useEffect(() => {
    if (typeof onFinish !== "function") return undefined;
    const safeDuration = Number.isFinite(Number(durationMs))
      ? Math.max(0, Number(durationMs))
      : 1200;
    const timer = window.setTimeout(onFinish, safeDuration);
    return () => window.clearTimeout(timer);
  }, [durationMs, onFinish]);

  return (
    <div className="accounts-splash" role="status" aria-live="polite" aria-label="Loading SPESS Accounts">
      <main className="accounts-splash-shell">
        <div className="accounts-splash-masthead">
          <div className="accounts-splash-mark" aria-hidden="true">SA</div>
          <div>
            <span>Finance Office</span>
            <h1>SPESS Accounts</h1>
          </div>
        </div>

        <div className="accounts-splash-rule" aria-hidden="true"><span /></div>

        <div className="accounts-splash-status">
          <div className="accounts-splash-ledger" aria-hidden="true">
            <i /><i /><i /><i />
          </div>
          <div>
            <strong>Opening accounts workspace</strong>
            <span>Preparing the finance register...</span>
          </div>
        </div>

        <footer>
          <span>St. Phillip&apos;s Equatorial Secondary School</span>
          <b>Secure finance portal</b>
        </footer>
      </main>
    </div>
  );
}
