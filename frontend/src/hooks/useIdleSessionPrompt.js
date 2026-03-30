import { useCallback, useEffect, useRef, useState } from "react";

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
}) {
  const warningTimerRef = useRef(null);
  const logoutTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const warningOpenRef = useRef(false);
  const warningDeadlineRef = useRef(0);

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

  const openWarning = useCallback(() => {
    warningOpenRef.current = true;
    warningDeadlineRef.current = Date.now() + warningMs;
    setPromptVisible(true);
    setSecondsRemaining(Math.max(1, Math.ceil(warningMs / 1000)));

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      const remainingMs = warningDeadlineRef.current - Date.now();
      if (remainingMs <= 0) {
        setSecondsRemaining(0);
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        return;
      }
      setSecondsRemaining(Math.max(1, Math.ceil(remainingMs / 1000)));
    }, 1000);

    logoutTimerRef.current = setTimeout(() => {
      warningOpenRef.current = false;
      clearTimers();
      setPromptVisible(false);
      onTimeout?.();
    }, warningMs);
  }, [clearTimers, onTimeout, warningMs]);

  const scheduleTimers = useCallback(() => {
    clearTimers();
    warningOpenRef.current = false;
    setPromptVisible(false);
    setSecondsRemaining(Math.max(1, Math.ceil(warningMs / 1000)));

    if (!enabled) return;

    if (warningMs > 0 && idleMs > warningMs) {
      warningTimerRef.current = setTimeout(openWarning, idleMs - warningMs);
      return;
    }

    logoutTimerRef.current = setTimeout(() => {
      onTimeout?.();
    }, idleMs);
  }, [clearTimers, enabled, idleMs, onTimeout, openWarning, warningMs]);

  const resetSessionTimer = useCallback(() => {
    if (!enabled || warningOpenRef.current) return;
    scheduleTimers();
  }, [enabled, scheduleTimers]);

  const renewSession = useCallback(() => {
    scheduleTimers();
  }, [scheduleTimers]);

  const logoutNow = useCallback(() => {
    warningOpenRef.current = false;
    clearTimers();
    setPromptVisible(false);
    onTimeout?.();
  }, [clearTimers, onTimeout]);

  useEffect(() => {
    if (!enabled) return undefined;

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, resetSessionTimer, true);
    });

    scheduleTimers();

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, resetSessionTimer, true);
      });
    };
  }, [clearTimers, enabled, resetSessionTimer, scheduleTimers]);

  return {
    promptVisible,
    secondsRemaining,
    renewSession,
    logoutNow,
  };
}
