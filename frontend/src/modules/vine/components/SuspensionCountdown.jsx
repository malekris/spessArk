import { useEffect, useMemo, useRef, useState } from "react";
import { formatSuspensionTime } from "../utils/suspensionCountdown.js";

const parseDate = (value) => {
  if (!value) return null;
  const timestamp = new Date(String(value).replace(" ", "T")).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

export default function SuspensionCountdown({ suspension, onExpire, className = "" }) {
  const onExpireRef = useRef(onExpire);
  const expiryReportedRef = useRef(false);
  const [receivedAt] = useState(Date.now);
  const deadline = useMemo(() => {
    const remaining = Number(suspension?.remaining_seconds);
    if (suspension?.remaining_seconds !== null && suspension?.remaining_seconds !== undefined && Number.isFinite(remaining)) {
      return receivedAt + Math.max(0, remaining) * 1000;
    }
    return parseDate(suspension?.ends_at);
  }, [receivedAt, suspension]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    expiryReportedRef.current = false;
    if (!deadline) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const remainingSeconds = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));

  useEffect(() => {
    if (remainingSeconds !== 0 || expiryReportedRef.current) return;
    expiryReportedRef.current = true;
    onExpireRef.current?.();
  }, [remainingSeconds]);

  if (deadline === null) {
    return <span className={`suspension-countdown indefinite ${className}`.trim()}>No automatic release</span>;
  }

  return (
    <span className={`suspension-countdown ${remainingSeconds === 0 ? "expired" : ""} ${className}`.trim()}>
      {remainingSeconds === 0 ? "Restriction ending now" : formatSuspensionTime(remainingSeconds)}
    </span>
  );
}
