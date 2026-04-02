import { useCallback, useEffect, useRef, useState } from "react";
import {
  ADMIN_SESSION_IDLE_EXPIRES_AT_KEY,
  ADMIN_SESSION_LOGOUT_SIGNAL_KEY,
  notifyAdminSessionExpired,
  readAdminIdleExpiry,
  writeAdminIdleExpiry,
} from "../utils/adminSecurity";

const DEFAULT_IDLE_MS = 15 * 60 * 1000;
const DEFAULT_WARNING_MS = 90 * 1000;

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "input",
  "change",
  "focus",
];

export default function useIdleSessionPrompt({
  onTimeout,
  idleMs = DEFAULT_IDLE_MS,
  warningMs = DEFAULT_WARNING_MS,
  enabled = true,
  idleExpiryKey = ADMIN_SESSION_IDLE_EXPIRES_AT_KEY,
  logoutSignalKey = ADMIN_SESSION_LOGOUT_SIGNAL_KEY,
  readIdleExpiry = readAdminIdleExpiry,
  writeIdleExpiry = writeAdminIdleExpiry,
  notifySessionExpired = notifyAdminSessionExpired,
}) {
  const warningTimerRef = useRef(null);
  const logoutTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const warningOpenRef = useRef(false);
  const warningDeadlineRef = useRef(0);
  const timeoutTriggeredRef = useRef(false);

  const [promptVisible, setPromptVisible] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(Math.ceil(warningMs / 1000));

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    warningTimerRef.current = null;
    logoutTimerRef.current = null;
    countdownTimerRef.current = null;
  }, []);

  const closePrompt = useCallback(() => {
    warningOpenRef.current = false;
    setPromptVisible(false);
    setSecondsRemaining(Math.max(1, Math.ceil(warningMs / 1000)));
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, [warningMs]);

  const triggerTimeout = useCallback(() => {
    if (timeoutTriggeredRef.current) return;
    timeoutTriggeredRef.current = true;
    clearTimers();
    closePrompt();
    onTimeout?.();
  }, [clearTimers, closePrompt, onTimeout]);

  const startCountdown = useCallback((deadlineMs) => {
    warningDeadlineRef.current = deadlineMs;
    setSecondsRemaining(Math.max(1, Math.ceil((deadlineMs - Date.now()) / 1000)));

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      const remainingMs = warningDeadlineRef.current - Date.now();
      if (remainingMs <= 0) {
        setSecondsRemaining(0);
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        return;
      }
      setSecondsRemaining(Math.max(1, Math.ceil(remainingMs / 1000)));
    }, 1000);
  }, []);

  const scheduleFromDeadline = useCallback(
    (deadlineMs) => {
      clearTimers();
      timeoutTriggeredRef.current = false;

      if (!enabled) {
        closePrompt();
        return;
      }

      const normalizedDeadline = Number(deadlineMs);
      if (!Number.isFinite(normalizedDeadline) || normalizedDeadline <= 0) {
        closePrompt();
        return;
      }

      const remainingMs = normalizedDeadline - Date.now();
      if (remainingMs <= 0) {
        triggerTimeout();
        return;
      }

      logoutTimerRef.current = setTimeout(() => {
        triggerTimeout();
      }, remainingMs);

      if (warningMs > 0 && remainingMs <= warningMs) {
        warningOpenRef.current = true;
        setPromptVisible(true);
        startCountdown(normalizedDeadline);
        return;
      }

      warningOpenRef.current = false;
      closePrompt();

      if (warningMs > 0 && remainingMs > warningMs) {
        warningTimerRef.current = setTimeout(() => {
          warningOpenRef.current = true;
          setPromptVisible(true);
          startCountdown(normalizedDeadline);
        }, remainingMs - warningMs);
      }
    },
    [clearTimers, closePrompt, enabled, startCountdown, triggerTimeout, warningMs]
  );

  const renewSession = useCallback(() => {
    if (!enabled) return;
    const now = Date.now();
    const deadline = now + idleMs;
    writeIdleExpiry(deadline, now);
    scheduleFromDeadline(deadline);
  }, [enabled, idleMs, scheduleFromDeadline, writeIdleExpiry]);

  const logoutNow = useCallback(() => {
    triggerTimeout();
  }, [triggerTimeout]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      closePrompt();
      return undefined;
    }

    const storedDeadline = readIdleExpiry();
    if (storedDeadline > 0) {
      scheduleFromDeadline(storedDeadline);
    } else {
      renewSession();
    }

    const handleActivity = () => {
      if (!enabled || warningOpenRef.current) return;
      renewSession();
    };

    const handleVisibilityRefresh = () => {
      if (!enabled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const sharedDeadline = readIdleExpiry();
      if (sharedDeadline > 0) {
        scheduleFromDeadline(sharedDeadline);
      } else {
        renewSession();
      }
    };

    const handleStorage = (event) => {
      if (!enabled) return;
      if (event.key === idleExpiryKey) {
        const sharedDeadline = Number(event.newValue || 0);
        if (Number.isFinite(sharedDeadline) && sharedDeadline > 0) {
          scheduleFromDeadline(sharedDeadline);
        }
        return;
      }

      if (event.key === logoutSignalKey && event.newValue) {
        notifySessionExpired({ source: "storage-logout-signal" });
      }
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity, true);
    });

    window.addEventListener("focus", handleVisibilityRefresh, true);
    document.addEventListener("visibilitychange", handleVisibilityRefresh, true);
    window.addEventListener("storage", handleStorage);

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity, true);
      });
      window.removeEventListener("focus", handleVisibilityRefresh, true);
      document.removeEventListener("visibilitychange", handleVisibilityRefresh, true);
      window.removeEventListener("storage", handleStorage);
    };
  }, [
    clearTimers,
    closePrompt,
    enabled,
    idleExpiryKey,
    logoutSignalKey,
    notifySessionExpired,
    readIdleExpiry,
    renewSession,
    scheduleFromDeadline,
  ]);

  return {
    promptVisible,
    secondsRemaining,
    renewSession,
    logoutNow,
  };
}
