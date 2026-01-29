import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "./VineFollowing.css"; // Reuse the same CSS for consistency

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineFollowing() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

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
                    {u.avatar_url ? (
                      <img src={`${API}${u.avatar_url}`} alt={u.username} />
                    ) : (
                      <div className="initial-circle">{initial}</div>
                    )}
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
                  onClick={(e) => e.stopPropagation()}
                >
                  Following
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}