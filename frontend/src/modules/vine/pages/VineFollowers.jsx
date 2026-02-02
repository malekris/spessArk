import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "./VineFollowers.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineFollowers() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/vine/users/${username}/followers`)
      .then(res => res.json())
      .then(data => {
        setUsers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [username]);

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
          users.map(u => (
            <div
              key={u.id}
              className="user-row"
              onClick={() => navigate(`/vine/profile/${u.username}`)}
            >
              <div className="user-row-left">
                <div className="follow-avatar">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} alt={u.username} />

                  ) : (
                    <div className="initial-circle">
                      {(u.username || "?")[0].toUpperCase()}
                    </div>
                  )}
                </div>

                <div className="user-details">
                  <div className="name-container">
                    <strong>{u.display_name || u.username}</strong>
                    <span className="handle">@{u.username}</span>
                  </div>
                  {u.bio && <p className="row-bio">{u.bio}</p>}
                </div>
              </div>

              <button className="row-follow-btn" onClick={(e) => e.stopPropagation()}>
                Follow
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}