import { useEffect, useMemo, useState } from "react";
import "./GifPickerModal.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function GifPickerModal({ open, onClose, onSelect, token }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 260);

  useEffect(() => {
    if (!open) return;
    const run = async () => {
      setLoading(true);
      try {
        const endpoint = debouncedQuery
          ? `${API}/api/vine/gifs/search?q=${encodeURIComponent(debouncedQuery)}&limit=24`
          : `${API}/api/vine/gifs/trending?limit=24`;
        const res = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        setItems(Array.isArray(data?.results) ? data.results : []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [open, debouncedQuery, token]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const title = useMemo(() => (debouncedQuery ? `Results for "${debouncedQuery}"` : "Trending GIFs"), [debouncedQuery]);

  if (!open) return null;

  return (
    <div className="gif-modal-backdrop" onClick={onClose}>
      <div className="gif-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gif-modal-top">
          <strong>{title}</strong>
          <button type="button" onClick={onClose}>✕</button>
        </div>
        <input
          className="gif-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIFs"
        />
        {loading ? (
          <div className="gif-loading">Loading GIFs...</div>
        ) : items.length === 0 ? (
          <div className="gif-loading">No GIFs found.</div>
        ) : (
          <div className="gif-grid">
            {items.map((gif) => (
              <button
                key={gif.id}
                type="button"
                className="gif-tile"
                onClick={() => {
                  onSelect?.(gif.url);
                  onClose?.();
                }}
                title={gif.title}
              >
                <img src={gif.preview_url || gif.url} alt={gif.title || "gif"} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

