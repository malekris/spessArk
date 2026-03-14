import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import {
  clearVineAuth,
  getRemainingVineSessionMs,
  getVineLastActivityAt,
  getVineToken,
  getVineUser,
  isVineTokenExpired,
  setVineLastActivityAt,
  touchVineActivity,
  VINE_SESSION_IDLE_MS,
  VINE_SESSION_WARNING_MS,
} from "../utils/vineAuth";
import { socket } from "../../../socket";
import "./VineProtectedRoute.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "input", "change"];

const formatSessionCountdown = (totalSeconds) => {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
};

export default function VineProtectedRoute() {
  const location = useLocation();
  const [status, setStatus] = useState("checking");
  const [warningVisible, setWarningVisible] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(Math.ceil(VINE_SESSION_IDLE_MS / 1000));
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState("");
  const lastActivityRef = useRef(getVineLastActivityAt() || Date.now());
  const lastPersistRef = useRef(0);

  const forceLogout = useCallback(() => {
    clearVineAuth();
    socket.disconnect();
    setWarningVisible(false);
    setRenewError("");
    setStatus("denied");
  }, []);

  const validateSession = useCallback(async () => {
    const token = getVineToken();
    const storedUser = getVineUser();
    const remainingMs = getRemainingVineSessionMs();

    if (!token || !storedUser?.id || isVineTokenExpired(token) || remainingMs <= 0) {
      forceLogout();
      return;
    }

    try {
      const res = await fetch(`${API}/api/vine/auth/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        forceLogout();
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (data?.user) {
        localStorage.setItem("vine_user", JSON.stringify(data.user));
      }

      const rememberedActivity = getVineLastActivityAt();
      const now = Date.now();
      if (!rememberedActivity) {
        setVineLastActivityAt(now);
        lastPersistRef.current = now;
        lastActivityRef.current = now;
      } else {
        lastActivityRef.current = rememberedActivity;
        lastPersistRef.current = rememberedActivity;
      }

      setStatus("allowed");
    } catch {
      // Network hiccups should not instantly throw the user out.
      setStatus("allowed");
    }
  }, [forceLogout]);

  useEffect(() => {
    validateSession();
  }, [validateSession]);

  useEffect(() => {
    if (status !== "allowed") return undefined;

    const recordActivity = () => {
      if (warningVisible) return;
      const now = Date.now();
      lastActivityRef.current = now;
      if (now - lastPersistRef.current > 10000) {
        setVineLastActivityAt(now);
        lastPersistRef.current = now;
      }
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, recordActivity, true);
    });

    const interval = window.setInterval(() => {
      const remainingMs = Math.max(0, VINE_SESSION_IDLE_MS - (Date.now() - lastActivityRef.current));
      setSecondsRemaining(Math.ceil(remainingMs / 1000));

      if (remainingMs <= 0) {
        forceLogout();
        return;
      }

      if (remainingMs <= VINE_SESSION_WARNING_MS) {
        setWarningVisible(true);
      } else {
        setWarningVisible(false);
        setRenewError("");
      }
    }, 1000);

    return () => {
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, recordActivity, true);
      });
    };
  }, [forceLogout, status, warningVisible]);

  const handleRenewSession = useCallback(async () => {
    const token = getVineToken();
    if (!token) {
      forceLogout();
      return;
    }

    try {
      setRenewing(true);
      setRenewError("");

      const res = await fetch(`${API}/api/vine/auth/renew`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          forceLogout();
          return;
        }
        throw new Error("Failed to renew session");
      }

      const data = await res.json().catch(() => ({}));
      if (data?.token) {
        localStorage.setItem("vine_token", data.token);
      }
      if (data?.user) {
        localStorage.setItem("vine_user", JSON.stringify(data.user));
      }

      const now = touchVineActivity();
      lastActivityRef.current = now;
      lastPersistRef.current = now;
      setSecondsRemaining(Math.ceil(VINE_SESSION_IDLE_MS / 1000));
      setWarningVisible(false);
    } catch {
      setRenewError("We could not renew the session right now. Please try again.");
    } finally {
      setRenewing(false);
    }
  }, [forceLogout]);

  if (status === "checking") {
    return <div className="vine-auth-checking">Checking session...</div>;
  }

  if (status !== "allowed") {
    return (
      <Navigate
        to="/vine/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  return (
    <>
      <Outlet />
      {warningVisible && (
        <div className="vine-session-backdrop" role="presentation">
          <div className="vine-session-modal" role="dialog" aria-modal="true" aria-labelledby="vine-session-title">
            <div className="vine-session-countdown-pill" aria-live="polite">
              {formatSessionCountdown(secondsRemaining)}
            </div>
            <div className="vine-session-kicker">Security check</div>
            <h2 id="vine-session-title">Session about to expire</h2>
            <p>
              For your privacy, Vine signs you out after 1 hour of inactivity.
              Stay signed in to keep working.
            </p>
            <div className="vine-session-countdown">Time left: {formatSessionCountdown(secondsRemaining)}</div>
            {renewError ? <div className="vine-session-error">{renewError}</div> : null}
            <div className="vine-session-actions">
              <button type="button" className="vine-session-logout" onClick={forceLogout}>
                Log out now
              </button>
              <button type="button" className="vine-session-renew" onClick={handleRenewSession} disabled={renewing}>
                {renewing ? "Renewing..." : "Stay signed in"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
