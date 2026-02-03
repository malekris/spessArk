import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "./VineFollowers.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = `${API}/uploads/avatars/default.png`;

export default function VineFollowers() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem("vine_token");

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/vine/users/${username}/followers`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        setUsers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [username, token]);

  const toggleFollow = async (userId, isFollowing) => {
    try {
      await fetch(`${API}/api/vine/users/${userId}/follow`, {
        method: isFollowing ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, is_following: isFollowing ? 0 : 1 } : u
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
          users.map(u => (
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
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_AVATAR;
                    }}
                  />
                </div>

                <div className="user-details">
                  <div className="name-container">
                    <strong>{u.display_name || u.username}</strong>
                    <span className="handle">@{u.username}</span>
                  </div>
                  {u.bio && <p className="row-bio">{u.bio}</p>}
                </div>
              </div>

              <button
                className={`row-follow-btn ${u.is_following ? "following" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFollow(u.id, Boolean(u.is_following));
                }}
              >
                {u.is_following ? "Unfollow" : "Follow"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
