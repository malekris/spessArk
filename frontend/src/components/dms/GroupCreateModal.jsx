import { useEffect, useMemo, useState } from "react";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

export default function GroupCreateModal({ open, onClose, onCreated }) {
  const token = localStorage.getItem("vine_token");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
        const response = await fetch(`${API}/api/dms/group-candidates${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await response.json().catch(() => []);
        if (response.ok) setPeople(Array.isArray(data) ? data : []);
      } catch (requestError) {
        if (requestError?.name !== "AbortError") setError("Could not load people");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, token]);

  useEffect(() => {
    if (open) return;
    setName("");
    setQuery("");
    setSelected([]);
    setError("");
  }, [open]);

  const selectedIds = useMemo(() => new Set(selected.map((person) => Number(person.id))), [selected]);

  const togglePerson = (person) => {
    setSelected((current) =>
      current.some((item) => Number(item.id) === Number(person.id))
        ? current.filter((item) => Number(item.id) !== Number(person.id))
        : [...current, person]
    );
    setError("");
  };

  const createGroup = async (event) => {
    event.preventDefault();
    const cleanName = name.replace(/\s+/g, " ").trim();
    if (cleanName.length < 2) return setError("Enter a group name");
    if (!selected.length) return setError("Choose at least one person");
    setCreating(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/dms/groups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: cleanName,
          member_ids: selected.map((person) => Number(person.id)),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not create group");
      onCreated?.(data);
    } catch (requestError) {
      setError(requestError?.message || "Could not create group");
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="dm-group-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="dm-group-modal" onSubmit={createGroup} onMouseDown={(event) => event.stopPropagation()}>
        <div className="dm-group-modal-head">
          <div>
            <span className="dm-group-modal-kicker">Group chat</span>
            <h2>Create a group</h2>
          </div>
          <button type="button" className="dm-group-modal-close" onClick={onClose} aria-label="Close" title="Close">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <label className="dm-group-field">
          <span>Group name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus placeholder="e.g. Literature study circle" />
        </label>

        {selected.length > 0 && (
          <div className="dm-group-selected" aria-label="Selected members">
            {selected.map((person) => (
              <button key={person.id} type="button" onClick={() => togglePerson(person)} title={`Remove ${person.display_name || person.username}`}>
                <span>{person.display_name || person.username}</span>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                  <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            ))}
          </div>
        )}

        <label className="dm-group-field dm-group-search-field">
          <span>Add people</span>
          <div>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people you follow" />
          </div>
        </label>

        <div className="dm-group-people" aria-busy={loading}>
          {loading && <div className="dm-group-people-state">Loading people...</div>}
          {!loading && people.length === 0 && <div className="dm-group-people-state">No people found</div>}
          {!loading && people.map((person) => {
            const checked = selectedIds.has(Number(person.id));
            const avatar = person.avatar_url
              ? (person.avatar_url.startsWith("http") ? person.avatar_url : `${API}${person.avatar_url}`)
              : DEFAULT_AVATAR;
            return (
              <button key={person.id} type="button" className={checked ? "selected" : ""} onClick={() => togglePerson(person)}>
                <img src={avatar} alt="" onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }} />
                <span className="dm-group-person-copy">
                  <strong>{person.display_name || person.username}</strong>
                  <small>@{person.username}</small>
                </span>
                <span className="dm-group-check" aria-label={checked ? "Selected" : "Not selected"}>
                  {checked && (
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                      <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {error && <div className="dm-group-error" role="alert">{error}</div>}
        <div className="dm-group-modal-actions">
          <span>{selected.length} selected</span>
          <button type="submit" disabled={creating || name.trim().length < 2 || !selected.length}>
            {creating ? "Creating..." : "Create group"}
          </button>
        </div>
      </form>
    </div>
  );
}
