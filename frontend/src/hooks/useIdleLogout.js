import { useEffect, useRef } from "react";

const IDLE_TIME = 2 * 60 * 1000; // ⏱ 2 minutes

export default function useIdleLogout(onLogout) {
  const timerRef = useRef(null);

  const resetTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      onLogout();
    }, IDLE_TIME);
  };

  useEffect(() => {
    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ];

    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer(); // start timer immediately

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, []);
}
