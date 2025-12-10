import React, { useEffect } from "react";
import "./SplashScreen.css";

function SplashScreen({ onFinish, onDone }) {
  // Support either prop name: onFinish (new) or onDone (old)
  const exit = onFinish || onDone || (() => {});

  useEffect(() => {
    const timer = setTimeout(() => {
      exit();
    }, 2200); // ~2.2s then go to login

    return () => clearTimeout(timer);
  }, [exit]);

  return (
    <div className="splash-root">
      <div className="splash-orbit">
        <div className="core-glow" />
        <div className="ring ring-1" />
        <div className="ring ring-2" />
        <div className="ring ring-3" />
      </div>

      <div className="splash-text">
        <span className="tagline">Loading dashboard…</span>
        <h1>SPESS’s ARK</h1>
      </div>
    </div>
  );
}

export default SplashScreen;
