import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "./VineFollowers.css";
import useWindowedList from "../../../hooks/useWindowedList";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

export default function VineFollowers() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem("vine_token");
  const listRef = useRef(null);
  const {
    visibleItems,
    padTop,
    padBottom,
  } = useWindowedList(users, {
    containerRef: listRef,
    estimatedItemHeight: 170,
    overscan: 4,
    enabled: users.length > 20,
  });

  useEffect(() => {
    document.title = `Vine — ${username} Followers`;
  }, [username]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${API}/api/vine/users/${username}/followers`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(res => res.json())
      .then(data => {
        if (controller.signal.aborted) return;
        setUsers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setLoading(false);
      });
    return () => controller.abort();
  }, [username, token]);

  const toggleFollow = async (userId, isFollowing, isRequested) => {
    try {
      const res = await fetch(`${API}/api/vine/users/${userId}/follow`, {
        method: (isFollowing || isRequested) ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                is_following: Number(data?.following ? 1 : 0),
                is_follow_requested: Number(data?.pending ? 1 : 0),
              }
            : u
        )
      );
    } catch (err) {
      console.error("Follow toggle failed", err);
    }
  };

  return (
    <div className="vine-follow-container">
      {/* Sticky Header */}
      <div className="vine-follow-topbar">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <div className="topbar-text">
          <h3>{username}</h3>
          <span className="subtitle">Followers</span>
        </div>
      </div>

      <div className="follow-list">
        {loading ? (
          <div className="loading-msg">Loading followers...</div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <p>No followers yet. 🌱</p>
          </div>
        ) : (
          <div className="follow-list-window" ref={listRef}>
            {padTop > 0 && <div className="follow-list-spacer" style={{ height: `${padTop}px` }} aria-hidden="true" />}
            {visibleItems.map(u => (
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
                        {u.display_name || u.username}
                      </span>
                      {(Number(u.is_verified) === 1 || ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(u.username || "").toLowerCase())) && (
                        <span className={`verified ${["vine guardian","vine_guardian","vine news","vine_news"].includes(String(u.username || "").toLowerCase()) ? "guardian" : ""}`}>
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

              <button
                className={`row-follow-btn ${u.is_following ? "following" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFollow(
                    u.id,
                    Boolean(u.is_following),
                    Boolean(u.is_follow_requested)
                  );
                }}
              >
                {u.is_following ? "Unfollow" : u.is_follow_requested ? "Requested" : "Follow"}
              </button>
            </div>
            ))}
            {padBottom > 0 && <div className="follow-list-spacer" style={{ height: `${padBottom}px` }} aria-hidden="true" />}
          </div>
        )}
      </div>
    </div>
  );
}
