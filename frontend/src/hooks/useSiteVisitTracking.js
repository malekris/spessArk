import { useEffect, useRef } from "react";
import { plainFetch } from "../lib/api";

export const SITE_VISIT_STATS_EVENT = "spess:site-visit-stats";

const VISITOR_STORAGE_KEY = "SPESS_ANONYMOUS_VISITOR_ID";
let inMemoryVisitorId = "";

function getSurface(pathname) {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/ark")) return "ark";
  if (pathname.startsWith("/vine")) return "vine";
  return null;
}

function createVisitorId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function getOrCreateVisitorId() {
  if (inMemoryVisitorId) return inMemoryVisitorId;

  try {
    const saved = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (saved) {
      inMemoryVisitorId = saved;
      return saved;
    }

    inMemoryVisitorId = createVisitorId();
    window.localStorage.setItem(VISITOR_STORAGE_KEY, inMemoryVisitorId);
    return inMemoryVisitorId;
  } catch {
    inMemoryVisitorId = createVisitorId();
    return inMemoryVisitorId;
  }
}

export default function useSiteVisitTracking(pathname) {
  const lastSurfaceRef = useRef(null);

  useEffect(() => {
    const surface = getSurface(pathname);
    if (!surface || lastSurfaceRef.current === surface) return;

    lastSurfaceRef.current = surface;
    plainFetch("/api/public/visits", {
      method: "POST",
      body: { surface, visitorId: getOrCreateVisitorId() },
    })
      .then((stats) => {
        window.dispatchEvent(new CustomEvent(SITE_VISIT_STATS_EVENT, { detail: stats }));
      })
      .catch(() => {
        // Analytics must never interrupt access to the school website.
      });
  }, [pathname]);
}
