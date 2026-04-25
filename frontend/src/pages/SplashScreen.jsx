import React, { useEffect } from "react";
import "./SplashScreen.css";
import badge from "../assets/badge.png";

function SplashScreen({ onFinish, onDone, durationMs = 3000 }) {
  // Support either prop name: onFinish (new) or onDone (old)
  const exit = onFinish || onDone || (() => {});
  const safeDurationMs = Number.isFinite(Number(durationMs))
    ? Math.max(0, Number(durationMs))
    : 3000;

  useEffect(() => {
    const timer = setTimeout(() => {
      exit();
    }, safeDurationMs);

    return () => clearTimeout(timer);
  }, [exit, safeDurationMs]);

  return (
    <div className="splash-root">
      <div className="splash-ambient splash-ambient-ark" />
      <div className="splash-grid-lines" />

      <div className="splash-shell">
        <section className="splash-panel splash-panel-ark">
          <div className="splash-panel-noise" />

          <div className="splash-brand-row">
            <div className="splash-badge-frame">
              <img src={badge} alt="SPESS badge" className="splash-badge-image" />
            </div>

            <div className="splash-brand-copy">
              <span className="splash-kicker">SPESS Digital Campus</span>
              <h1>ARK</h1>
              <p>
                Marks, reporting, readiness, and the school dashboard are
                coming online.
              </p>
            </div>
          </div>

          <div className="splash-chip-row">
            <span className="splash-chip splash-chip-ark">Navy Core</span>
            <span className="splash-chip splash-chip-status">Loading Dashboard</span>
          </div>

          <div className="splash-progress-wrap" aria-hidden="true">
            <div className="splash-progress-bar">
              <span />
            </div>
            <div className="splash-progress-glow" />
          </div>

          <div className="splash-loading-line">Loading dashboard...</div>

          <div className="splash-footer-row">
            <div className="splash-loader-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span className="splash-footer-copy">Preparing your workspace…</span>
          </div>
        </section>
      </div>
    </div>
  );
}

export default SplashScreen;
