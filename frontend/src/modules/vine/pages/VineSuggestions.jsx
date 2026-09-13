import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./VineSuggestions.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

export default function VineSuggestions() {
  const [users, setUsers] = useState([]);
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");

  useEffect(() => {
    document.title = "Vine — Discover";
  }, []);

  useEffect(() => {
    fetch(`${API}/api/vine/users/new`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setUsers(data);
        else setUsers([]);
      })
      .catch(() => setUsers([]));
  }, [token]);

  const toggleFollow = async (user, e) => {
    e.stopPropagation(); 

    const res = await fetch(`${API}/api/vine/users/${user.id}/follow`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.ok) {
      setUsers(prev => prev.filter(u => u.id !== user.id));
    }
  };

  return (
    <div className="vine-suggestions">
      <div className="suggestions-content">
        
        <button
          className="suggestions-back"
          onClick={() => navigate("/vine/feed")}
          aria-label="Back to feed"
          title="Back to feed"
        >
          <span className="suggestions-back-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path
                d="M14.5 6.5L9 12l5.5 5.5"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="suggestions-back-label">Feed</span>
        </button>

        <div className="suggestions-heading">
          <div>
            <span className="suggestions-kicker">Discover</span>
            <h3 className="suggestions-title">🌱 New Viners</h3>
            <p className="suggestions-subtitle">Find fresh voices and people you may want to follow.</p>
          </div>
          <span className="suggestions-count">{users.length} to explore</span>
        </div>
        
        {users.length > 0 ? (
          <div className="suggestions-list">
            {users.map((u) => (
              <div
                key={u.id}
                className="suggestion-row"
                onClick={() => navigate(`/vine/profile/${u.username}`)}
              >
                <div className="user-left">
                  <div className="avatar">
                    <img
                      src={
                        u.avatar_url
                          ? (u.avatar_url.startsWith("http") ? u.avatar_url : `${API}${u.avatar_url}`)
                          : DEFAULT_AVATAR
                      }
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

                  <div className="user-info">
                    <strong className="user-name">
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
                    <span>@{u.username}</span>
                  </div>
                </div>

                <button
                  className="follow-mini"
                  onClick={(e) => toggleFollow(u, e)}
                >
                  Follow
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="suggestions-empty" role="status">
            <span className="suggestions-empty-icon" aria-hidden="true">✦</span>
            <strong>You’re all caught up</strong>
            <span>We’ll bring fresh Viners here as they join.</span>
          </div>
        )} {/* suggestions-list end */}

        <footer className="suggestions-footer">
          <div className="suggestions-footer-copy">
            <span className="suggestions-footer-mark" aria-hidden="true">✦</span>
            <span>© {new Date().getFullYear()} Vine. All rights reserved.</span>
          </div>
          <div className="suggestions-footer-links" aria-label="Vine information">
            <button type="button" onClick={() => navigate("/vine/legal/copyright")}>Copyright</button>
            <button type="button" onClick={() => navigate("/vine/legal/terms")}>Terms</button>
            <button type="button" onClick={() => navigate("/vine/legal/privacy")}>Privacy</button>
            <button type="button" onClick={() => navigate("/vine/help")}>Help</button>
          </div>
        </footer>

      </div> {/* suggestions-content end */}
    </div> 
  );
}
