import { useCallback, useEffect, useMemo, useState } from "react";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const MEDIA_FILTERS = [
  { value: "all", label: "All" },
  { value: "image", label: "Photos" },
  { value: "video", label: "Videos" },
  { value: "voice", label: "Audio" },
];

const formatMediaDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export default function DirectSharedMedia({ conversationId, token, nicknames = {} }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setOpen(false);
    setItems([]);
    setNextBefore(null);
    setLoaded(false);
    setLoading(false);
    setError("");
    setFilter("all");
  }, [conversationId]);

  const visibleItems = useMemo(
    () => filter === "all" ? items : items.filter((item) => item.media_type === filter),
    [filter, items]
  );

  const loadMedia = useCallback(async (before = null) => {
    if (!conversationId || loading) return;
    setLoading(true);
    setError("");
    try {
      const suffix = before ? `?before=${encodeURIComponent(before)}` : "";
      const response = await fetch(`${API}/api/dms/conversations/${conversationId}/media${suffix}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load shared media");
      setItems((current) => before ? [...current, ...(data.items || [])] : (data.items || []));
      setNextBefore(data.next_before || null);
      setLoaded(true);
    } catch (requestError) {
      setError(requestError?.message || "Could not load shared media");
    } finally {
      setLoading(false);
    }
  }, [conversationId, loading, token]);

  const toggleOpen = () => {
    setOpen((current) => !current);
    if (!loaded && !loading) loadMedia();
  };

  return (
    <section className="dm-direct-media-section">
      <button
        type="button"
        className="dm-direct-section-toggle"
        onClick={toggleOpen}
        aria-expanded={open}
        disabled={!conversationId}
      >
        <span className="dm-direct-section-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="3.5" y="4" width="17" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="9" cy="9.5" r="1.7" stroke="currentColor" strokeWidth="1.8" />
            <path d="m5.5 17 4.1-4.1a1.5 1.5 0 0 1 2.12 0l1.6 1.6 1.4-1.4a1.5 1.5 0 0 1 2.12 0L20 16.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="dm-direct-section-copy">
          <strong>Shared media</strong>
          <small>{conversationId ? "Photos, videos, and voice notes" : "Send the first message to unlock media"}</small>
        </span>
        <svg className={open ? "open" : ""} viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
          <path d="m8 10 4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="dm-direct-media-content">
          <div className="dm-direct-media-filters" role="group" aria-label="Filter shared media">
            {MEDIA_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={filter === option.value ? "active" : ""}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {loading && !loaded && <div className="dm-direct-media-state">Loading shared media…</div>}
          {error && <div className="dm-direct-media-state error" role="alert">{error}</div>}
          {loaded && !error && visibleItems.length === 0 && (
            <div className="dm-direct-media-state">
              No {filter === "all" ? "shared media" : MEDIA_FILTERS.find((option) => option.value === filter)?.label.toLowerCase()} yet.
            </div>
          )}
          {visibleItems.length > 0 && (
            <div className="dm-direct-media-grid">
              {visibleItems.map((item) => (
                <article key={item.id} className={`dm-direct-media-item ${item.media_type}`}>
                  {item.media_type === "image" && (
                    <a href={item.media_url} target="_blank" rel="noreferrer">
                      <img src={item.media_url} alt={`Shared by ${nicknames[String(item.sender_id)] || item.display_name || item.username}`} loading="lazy" />
                    </a>
                  )}
                  {item.media_type === "video" && <video src={item.media_url} controls playsInline preload="metadata" />}
                  {item.media_type === "voice" && (
                    <div className="dm-direct-media-audio">
                      <span>Voice note</span>
                      <audio src={item.media_url} controls preload="none" />
                    </div>
                  )}
                  <footer>
                    <strong>{nicknames[String(item.sender_id)] || item.display_name || item.username}</strong>
                    <time dateTime={item.created_at}>{formatMediaDate(item.created_at)}</time>
                  </footer>
                </article>
              ))}
            </div>
          )}
          {nextBefore && (
            <button type="button" className="dm-direct-media-more" onClick={() => loadMedia(nextBefore)} disabled={loading}>
              {loading ? "Loading…" : "Show more"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
