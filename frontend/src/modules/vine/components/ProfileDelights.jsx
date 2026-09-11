import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./ProfileDelights.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

const hasSpecialVerifiedBadge = (username) =>
  ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
    String(username || "").trim().toLowerCase()
  );

const GuestbookVerifiedMark = ({ special = false }) => (
  <span
    className={`profile-guestbook-verified${special ? " guardian" : ""}`}
    aria-label="Verified"
    title="Verified"
  >
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

const asAvatarUrl = (url) => {
  const value = String(url || "").trim();
  if (!value) return DEFAULT_AVATAR;
  return value.startsWith("http") ? value : `${API}${value}`;
};

const formatWeekRange = (startsAt, endsAt) => {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Your last seven days";
  return `${start.toLocaleDateString([], { month: "short", day: "numeric" })} – ${end.toLocaleDateString([], { month: "short", day: "numeric" })}`;
};

const formatGuestbookDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
};

export default function ProfileDelights({ username, isMe = false, hidden = false }) {
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  const [rewind, setRewind] = useState(null);
  const [monthlyRewind, setMonthlyRewind] = useState(null);
  const [yearlyRewind, setYearlyRewind] = useState(null);
  const [anniversary, setAnniversary] = useState(null);
  const [charms, setCharms] = useState([]);
  const [guestbook, setGuestbook] = useState({ entries: [], can_sign: false, is_owner: false });
  const [guestbookText, setGuestbookText] = useState("");
  const [guestbookBusy, setGuestbookBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [sharingType, setSharingType] = useState("");

  const authHeaders = useMemo(() => token ? { Authorization: `Bearer ${token}` } : {}, [token]);

  const loadGuestbook = useCallback(async (signal) => {
    if (!username || hidden) return;
    const response = await fetch(`${API}/api/vine/users/${encodeURIComponent(username)}/guestbook`, {
      headers: authHeaders,
      signal,
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Could not load guestbook");
    setGuestbook({
      entries: Array.isArray(data.entries) ? data.entries : [],
      can_sign: Boolean(data.can_sign),
      is_owner: Boolean(data.is_owner),
    });
  }, [authHeaders, hidden, username]);

  useEffect(() => {
    if (!username || hidden) return undefined;
    const controller = new AbortController();
    setNotice("");
    setRewind(null);
    setMonthlyRewind(null);
    setYearlyRewind(null);
    setAnniversary(null);
    setCharms([]);
    setGuestbook({ entries: [], can_sign: false, is_owner: false });
    loadGuestbook(controller.signal).catch((error) => {
      if (error?.name !== "AbortError") setNotice(error.message);
    });

    fetch(`${API}/api/vine/users/${encodeURIComponent(username)}/anniversary-rewind`, {
      headers: authHeaders,
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Could not load anniversary celebration");
        setAnniversary(data.available ? data : null);
      })
      .catch((error) => {
        if (error?.name !== "AbortError") console.warn("Could not load anniversary celebration", error);
      });

    if (token && isMe) {
      const rewindSetters = {
        weekly: setRewind,
        monthly: setMonthlyRewind,
        yearly: setYearlyRewind,
      };
      ["weekly", "monthly", "yearly"].forEach((rewindType) => {
        fetch(`${API}/api/vine/users/${encodeURIComponent(username)}/${rewindType}-rewind`, {
          headers: authHeaders,
          signal: controller.signal,
          cache: "no-store",
        })
          .then(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || `Could not load ${rewindType} rewind`);
            rewindSetters[rewindType](data.available === false ? null : data);
          })
          .catch((error) => {
            if (error?.name !== "AbortError" && rewindType === "weekly") setNotice(error.message);
          });
      });
    } else {
      setRewind(null);
      setMonthlyRewind(null);
      setYearlyRewind(null);
    }

    if (token && !isMe) {
      fetch(`${API}/api/vine/users/${encodeURIComponent(username)}/friendship-charms`, {
        headers: authHeaders,
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.message || "Could not load charms");
          setCharms(Array.isArray(data.charms) ? data.charms : []);
        })
        .catch((error) => {
          if (error?.name !== "AbortError") setNotice(error.message);
        });
    } else {
      setCharms([]);
    }

    return () => controller.abort();
  }, [authHeaders, hidden, isMe, loadGuestbook, token, username]);

  const shareRewind = async (currentRewind) => {
    if (!currentRewind?.stats || sharingType) return;
    const rewindType = currentRewind.rewind_type || "weekly";
    if (currentRewind.shared_post_id) {
      navigate(`/vine/feed?post=${encodeURIComponent(currentRewind.shared_post_id)}`);
      return;
    }
    setSharingType(rewindType);
    setNotice("");
    try {
      const response = await fetch(`${API}/api/vine/users/${encodeURIComponent(username)}/${rewindType}-rewind/share`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `Could not share your ${currentRewind.title || "Vine Rewind"}`);
      const postId = Number(data.post_id || 0);
      if (!postId) throw new Error("Your Rewind was created, but its post could not be opened");
      const setters = {
        weekly: setRewind,
        monthly: setMonthlyRewind,
        yearly: setYearlyRewind,
        anniversary: setAnniversary,
      };
      setters[rewindType]((current) => ({
        ...current,
        shared_post_id: postId,
        shared_image_url: data.image_url || current?.shared_image_url || null,
      }));
      navigate(`/vine/feed?post=${encodeURIComponent(postId)}`);
    } catch (error) {
      setNotice(error.message || `Could not share your ${currentRewind.title || "Vine Rewind"}`);
    } finally {
      setSharingType("");
    }
  };

  const signGuestbook = async (event) => {
    event.preventDefault();
    const message = guestbookText.trim();
    if (!message || !token || guestbookBusy) return;
    setGuestbookBusy(true);
    setNotice("");
    try {
      const response = await fetch(`${API}/api/vine/users/${encodeURIComponent(username)}/guestbook`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not leave your note");
      setGuestbookText("");
      setGuestbook((current) => ({ ...current, can_sign: false }));
      setNotice(data.message || "Your note is waiting for approval.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setGuestbookBusy(false);
    }
  };

  const updateGuestbookEntry = async (entryId, action) => {
    if (!token || guestbookBusy) return;
    setGuestbookBusy(true);
    setNotice("");
    try {
      const response = await fetch(`${API}/api/vine/guestbook/${entryId}${action === "approve" ? "/approve" : ""}`, {
        method: action === "approve" ? "PATCH" : "DELETE",
        headers: authHeaders,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not update that note");
      setGuestbook((current) => ({
        ...current,
        entries: action === "approve"
          ? current.entries.map((entry) => Number(entry.id) === Number(entryId) ? { ...entry, status: "approved" } : entry)
          : current.entries.filter((entry) => Number(entry.id) !== Number(entryId)),
      }));
    } catch (error) {
      setNotice(error.message);
    } finally {
      setGuestbookBusy(false);
    }
  };

  if (hidden) return null;

  const visibleRewinds = [rewind, monthlyRewind, yearlyRewind, anniversary].filter((currentRewind) => currentRewind?.stats);

  return (
    <div className="profile-delights">
      {visibleRewinds.map((currentRewind) => {
        const rewindType = currentRewind.rewind_type || "weekly";
        const titleId = `profile-${rewindType}-rewind-title`;
        const canShare = rewindType !== "anniversary" || isMe;
        const statRows = Array.isArray(currentRewind.stat_rows) && currentRewind.stat_rows.length === 6
          ? currentRewind.stat_rows.map(([value, label, number]) => ({ value, label, number }))
          : [
            ["active_days", "Active days"],
            ["posts", "Posts"],
            ["comments", "Comments"],
            ["likes_received", "Likes"],
            ["messages", "Messages"],
            ["assignments", "Assignments"],
          ].map(([key, label], index) => ({ value: currentRewind.stats[key] || 0, label, number: index + 1 }));
        return (
          <section key={rewindType} className="profile-rewind" aria-labelledby={titleId}>
            <div className="profile-rewind-topline">
              <div>
                <span className="profile-delight-eyebrow">{currentRewind.eyebrow || "Ready to publish on Vine"}</span>
                <h3 id={titleId}>Vine {currentRewind.title} <span aria-hidden="true">{currentRewind.emoji}</span></h3>
                <p>{currentRewind.range_label || formatWeekRange(currentRewind.starts_at, currentRewind.ends_at)}</p>
              </div>
              {canShare && (
                <button type="button" onClick={() => shareRewind(currentRewind)} disabled={Boolean(sharingType)}>
                  {sharingType === rewindType
                    ? "Creating artwork…"
                    : currentRewind.shared_post_id
                    ? "View in feed"
                    : rewindType === "anniversary" ? "Share Anniversary" : "Share Rewind"}
                </button>
              )}
            </div>
            <div className="profile-rewind-stats">
              {statRows.map(({ value, label, number }) => (
                <div key={`${rewindType}-${number}-${label}`}><strong>{value || 0}</strong><span>{label}</span></div>
              ))}
            </div>
          </section>
        );
      })}

      {charms.length > 0 && (
        <section className="profile-charms" aria-labelledby="profile-charms-title">
          <div className="profile-delight-heading">
            <div>
              <span className="profile-delight-eyebrow">Made together</span>
              <h3 id="profile-charms-title">Friendship Charms</h3>
            </div>
            <span className="profile-delight-count">{charms.length}</span>
          </div>
          <div className="profile-charm-list">
            {charms.map((charm) => (
              <article key={charm.key} className="profile-charm">
                <span className="profile-charm-icon" aria-hidden="true">{charm.emoji}</span>
                <div><strong>{charm.name}</strong><small>{charm.description}</small></div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="profile-guestbook" aria-labelledby="profile-guestbook-title">
        <div className="profile-delight-heading">
          <div>
            <span className="profile-delight-eyebrow">Leave a little leaf</span>
            <h3 id="profile-guestbook-title">Profile Guestbook <span aria-hidden="true">🌿</span></h3>
          </div>
          <span className="profile-delight-count">{guestbook.entries.filter((entry) => entry.status === "approved").length}</span>
        </div>

        {guestbook.can_sign && (
          <form className="profile-guestbook-form" onSubmit={signGuestbook}>
            <textarea
              value={guestbookText}
              onChange={(event) => setGuestbookText(event.target.value.slice(0, 180))}
              placeholder="Write something kind…"
              maxLength={180}
              rows={2}
            />
            <div><small>{guestbookText.length}/180 · visible after approval</small><button type="submit" disabled={!guestbookText.trim() || guestbookBusy}>Sign guestbook</button></div>
          </form>
        )}

        {guestbook.entries.length > 0 ? (
          <div className="profile-guestbook-list">
            {guestbook.entries.map((entry) => (
              <article key={entry.id} className={`profile-guestbook-entry ${entry.status === "pending" ? "pending" : ""}`}>
                <button type="button" className="profile-guestbook-author" onClick={() => navigate(`/vine/profile/${entry.username}`)}>
                  <img src={asAvatarUrl(entry.avatar_url)} alt="" onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }} />
                  <span>
                    <strong>
                      <span className="profile-guestbook-name">{entry.display_name || entry.username}</span>
                      {(Number(entry.is_verified) === 1 || hasSpecialVerifiedBadge(entry.username)) && (
                        <GuestbookVerifiedMark special={hasSpecialVerifiedBadge(entry.username)} />
                      )}
                    </strong>
                    <small>@{entry.username} · {formatGuestbookDate(entry.created_at)}</small>
                  </span>
                </button>
                <p>{entry.message}</p>
                {entry.status === "pending" && guestbook.is_owner && (
                  <div className="profile-guestbook-actions"><span>Waiting for your approval</span><button type="button" onClick={() => updateGuestbookEntry(entry.id, "approve")} disabled={guestbookBusy}>Approve</button><button type="button" className="danger" onClick={() => updateGuestbookEntry(entry.id, "delete")} disabled={guestbookBusy}>Delete</button></div>
                )}
                {entry.status === "approved" && guestbook.is_owner && (
                  <div className="profile-guestbook-actions approved"><span>Published</span><button type="button" className="danger" onClick={() => updateGuestbookEntry(entry.id, "delete")} disabled={guestbookBusy}>Remove</button></div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="profile-guestbook-empty">No leaves yet. The first kind note gets the best spot.</p>
        )}
      </section>

      {notice && <div className="profile-delight-notice" role="status">{notice}</div>}
    </div>
  );
}
