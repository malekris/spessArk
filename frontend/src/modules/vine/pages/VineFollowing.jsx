import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "./VineFollowing.css"; // Reuse the same CSS for consistency

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

export default function VineFollowing() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem("vine_token");

  useEffect(() => {
    document.title = `Vine — ${username} Following`;
  }, [username]);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/vine/users/${username}/following`)
      .then(res => res.json())
      .then(data => {
        setUsers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [username]);

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
          users.map(u => {
            // Defensive variables to prevent crashes
            const resolvedName = u.display_name || u.username || "User";
            const initial = (u.username || "U")[0].toUpperCase();

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
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_AVATAR;
                      }}
                    />
                  </div>

                  <div className="user-details">
                    <div className="name-container">
                      <strong>{resolvedName}</strong>
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
          })
        )}
      </div>
    </div>
  );
}
