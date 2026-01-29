import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./VineSuggestions.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineSuggestions() {
  const [users, setUsers] = useState([]);
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");

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
                  {u.avatar_url ? (
                    <img src={`${API}${u.avatar_url}`} alt={u.username} />
                  ) : (
                    <div className="avatar-initial">
                      {(u.username || "U")[0].toUpperCase()}
                    </div>
                  )}
                </div>

                <div className="user-info">
                  <strong>{u.display_name || u.username}</strong>
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