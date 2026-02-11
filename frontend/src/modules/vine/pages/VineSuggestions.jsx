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

  // Guard clause for empty state
  if (users.length === 0) return null;

  return (
    <div className="vine-suggestions">
      <div className="suggestions-content">
        
        <button className="back-btn" onClick={() => navigate("/vine/feed")}>
          ← Back to Feed
        </button>

        <h3 className="suggestions-title">🌱 New Viners</h3>
        
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
                    {(Number(u.is_verified) === 1 || ["vine guardian","vine_guardian"].includes(String(u.username || "").toLowerCase())) && (
                      <span className={`verified ${["vine guardian","vine_guardian"].includes(String(u.username || "").toLowerCase()) ? "guardian" : ""}`}>
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
        </div> {/* suggestions-list end */}

      </div> {/* suggestions-content end */}
    </div> 
  );
}
