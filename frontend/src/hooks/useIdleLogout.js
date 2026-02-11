import { useEffect, useRef } from "react";

// ⏱ 30 minutes idle timeout (default)
const DEFAULT_IDLE_TIME = 30 * 60 * 1000;

export default function useIdleLogout(onLogout, idleMs = DEFAULT_IDLE_TIME) {
  const timerRef = useRef(null);

  const resetTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      onLogout();
    }, idleMs);
  };

  useEffect(() => {
    // Any of these count as "active user"
    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "input",      // ✅ typing in textboxes / inputs
      "change",     // ✅ select boxes, dropdowns
      "focus",      // ✅ tabbing between fields
    ];

    events.forEach((e) => {
      window.addEventListener(e, resetTimer, true);
    });

    // Start timer immediately
    resetTimer();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      events.forEach((e) => {
        window.removeEventListener(e, resetTimer, true);
      });
    };
  }, [onLogout]);
}
