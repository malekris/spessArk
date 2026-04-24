import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useVineAuthTheme } from "../utils/authTheme";
import "./VineEntrySplash.css";

const VINE_ENTRY_SPLASH_MS = 6000;

export default function VineEntrySplash() {
  const navigate = useNavigate();
  const authTheme = useVineAuthTheme();
  const [searchParams] = useSearchParams();
  const [timeLeftMs, setTimeLeftMs] = useState(VINE_ENTRY_SPLASH_MS);

  const nextTarget = useMemo(() => {
    const requested = String(searchParams.get("next") || "/vine/login").trim();
    return requested.startsWith("/vine/") ? requested : "/vine/login";
  }, [searchParams]);

  useEffect(() => {
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setTimeLeftMs(Math.max(0, VINE_ENTRY_SPLASH_MS - (Date.now() - startedAt)));
    }, 100);

    const timeoutId = window.setTimeout(() => {
      navigate(nextTarget, { replace: true });
    }, VINE_ENTRY_SPLASH_MS);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [navigate, nextTarget]);

  const secondsLeft = Math.max(1, Math.ceil(timeLeftMs / 1000));

  return (
    <main
      className={`vine-entry-splash vine-entry-effect-${authTheme.effect_preset}`}
      style={{
        "--vine-entry-duration": `${VINE_ENTRY_SPLASH_MS}ms`,
      }}
    >
      <div className="vine-entry-splash-glow vine-entry-splash-glow-left" aria-hidden="true" />
      <div className="vine-entry-splash-glow vine-entry-splash-glow-right" aria-hidden="true" />

      <section className="vine-entry-card">
        <span className="vine-entry-kicker">
          <span className="vine-entry-kicker-icon" aria-hidden="true">🌱</span>
          <span>St. Phillip&apos;s Vine</span>
        </span>
        <h1>Entering Vine</h1>
        <p>
          Fresh stories, bright moments, and all the Vine energy are getting ready for you.
        </p>

        <div className="vine-entry-orb" aria-hidden="true">
          <span className="vine-entry-orb-sprout">🌱</span>
          <span className="vine-entry-orb-spark vine-entry-orb-spark-one" />
          <span className="vine-entry-orb-spark vine-entry-orb-spark-two" />
        </div>

        <div className="vine-entry-progress" aria-hidden="true">
          <span />
        </div>

        <div className="vine-entry-meta" aria-live="polite">
          <strong>Launching in {secondsLeft}s</strong>
          <span>Vine is getting everything ready for you.</span>
        </div>
      </section>
    </main>
  );
}
