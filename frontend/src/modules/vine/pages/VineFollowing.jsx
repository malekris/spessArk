import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "./VineFollowing.css"; // Reuse the same CSS for consistency
import useWindowedList from "../../../hooks/useWindowedList";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";
const FOLLOW_FILTERS = [
  { key: "all", label: "All" },
  { key: "verified", label: "Verified" },
  { key: "bio", label: "With bio" },
];
const hasSpecialVerifiedBadge = (username) =>
  ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
    String(username || "").toLowerCase()
  );

export default function VineFollowing() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const token = localStorage.getItem("vine_token");
  const listRef = useRef(null);
  const filteredUsers = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !query ||
        String(user.display_name || "").toLowerCase().includes(query) ||
        String(user.username || "").toLowerCase().includes(query) ||
        String(user.bio || "").toLowerCase().includes(query);
      if (!matchesSearch) return false;
      if (filterMode === "verified") {
        return Number(user.is_verified) === 1 || hasSpecialVerifiedBadge(user.username);
      }
      if (filterMode === "bio") {
        return Boolean(String(user.bio || "").trim());
      }
      return true;
    });
  }, [filterMode, searchText, users]);
  const {
    visibleItems,
    padTop,
    padBottom,
  } = useWindowedList(filteredUsers, {
    containerRef: listRef,
    estimatedItemHeight: 170,
    overscan: 4,
    enabled: filteredUsers.length > 20,
  });

  useEffect(() => {
    document.title = `Vine — ${username} Following`;
  }, [username]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${API}/api/vine/users/${username}/following`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
      .then(res => res.json())
      .then(data => {
        if (controller.signal.aborted) return;
        setUsers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        if (err?.name === "AbortError") return;
        console.error(err);
        setLoading(false);
      });
    return () => controller.abort();
  }, [username, token]);

  const handleUnfollow = async (userId) => {
    try {
      await fetch(`${API}/api/vine/users/${userId}/follow`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      console.error("Unfollow failed", err);
    }
  };

  return (
    <div className="vine-follow-container">
      {/* ───── Sticky Header */}
      <div className="vine-follow-topbar">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <div className="topbar-text">
          <h3>{username}</h3>
          <span className="subtitle">Following</span>
        </div>
      </div>

      {/* ───── List Content */}
      <div className="follow-list">
        {loading ? (
          <div className="loading-msg">Fetching users...</div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <p>Not following anyone yet. 🌱</p>
          </div>
        ) : (
          <>
            <div className="follow-toolbar">
              <label className="follow-search" htmlFor="following-search">
                <span className="follow-search-icon">⌕</span>
                <input
                  id="following-search"
                  type="search"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search following"
                />
              </label>
              <div className="follow-filter-pills" role="tablist" aria-label="Following filters">
                {FOLLOW_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={`follow-filter-pill ${filterMode === filter.key ? "active" : ""}`}
                    onClick={() => setFilterMode(filter.key)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <div className="follow-toolbar-meta">
                {filteredUsers.length} {filteredUsers.length === 1 ? "person" : "people"}
              </div>
            </div>

            {filteredUsers.length === 0 ? (
              <div className="empty-state">
                <p>No following matches that search yet.</p>
              </div>
            ) : (
              <div className="follow-list-window" ref={listRef}>
                {padTop > 0 && <div className="follow-list-spacer" style={{ height: `${padTop}px` }} aria-hidden="true" />}
          {visibleItems.map(u => {
            const resolvedName = u.display_name || u.username || "User";

            return (
              <div
                key={u.id}
                className="user-row"
                onClick={() => navigate(`/vine/profile/${u.username}`)}
              >
                <div className="user-row-left">
                  <div className="follow-avatar">
                    <img
                      src={u.avatar_url || DEFAULT_AVATAR}
                      alt={u.username}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/vine/profile/${u.username}`);
                      }}
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_AVATAR;
                      }}
                    />
                  </div>

                  <div className="user-details">
                    <div className="name-container">
                      <strong className="follow-name">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/vine/profile/${u.username}`);
                          }}
                      >
                        {resolvedName}
                      </span>
                        {(Number(u.is_verified) === 1 || hasSpecialVerifiedBadge(u.username)) && (
                          <span className={`verified ${hasSpecialVerifiedBadge(u.username) ? "guardian" : ""}`}>
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none">
                              <path
                                d="M20 6L9 17l-5-5"
                                stroke="white"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        )}
                      </strong>
                      <span className="handle">@{u.username}</span>
                    </div>
                    {u.bio && <p className="row-bio">{u.bio}</p>}
                  </div>
                </div>

                {/* Optional: Unfollow button logic could go here */}
                <button
                  className="row-follow-btn following"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUnfollow(u.id);
                  }}
                >
                  Unfollow
                </button>
              </div>
            );
          })}
                {padBottom > 0 && <div className="follow-list-spacer" style={{ height: `${padBottom}px` }} aria-hidden="true" />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
