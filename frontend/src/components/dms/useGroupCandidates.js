import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function useGroupCandidates({ enabled, query, token, conversationId, revision = "" }) {
  const [result, setResult] = useState({ key: "", people: [], nextOffset: null });
  const [request, setRequest] = useState({ key: "", offset: 0 });
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState({ key: "", message: "" });
  const key = JSON.stringify([query.trim(), conversationId || null, token, revision]);
  const offset = request.key === key ? request.offset : 0;

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPending(true);
      setFailure({ key, message: "" });
      try {
        const params = new URLSearchParams({ q: query.trim(), paged: "1", offset: String(offset) });
        if (conversationId) params.set("conversationId", conversationId);
        const response = await fetch(`${API}/api/dms/group-candidates?${params}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not search people");
        if (controller.signal.aborted) return;
        // Support an older API during rolling deployments.
        const people = Array.isArray(data) ? data : data.people || [];
        setResult((previous) => ({
          key,
          people: [...new Map([
            ...(offset && previous.key === key ? previous.people : []), ...people,
          ].map((person) => [Number(person.id), person])).values()],
          nextOffset: data.nextOffset ?? null,
        }));
      } catch (error) {
        if (!controller.signal.aborted) setFailure({ key, message: error.message || "Could not search people" });
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [enabled, query, token, conversationId, key, offset]);

  const error = failure.key === key ? failure.message : "";
  return {
    people: result.key === key ? result.people : [],
    loading: enabled && (pending || (result.key !== key && !error)),
    error,
    hasMore: result.key === key && result.nextOffset !== null,
    loadMore: () => setRequest({ key, offset: result.nextOffset || 0 }),
  };
}
