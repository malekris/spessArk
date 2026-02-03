import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatRelativeTime } from "../../../utils/time";
import "./MiniProfileCard.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = `${API}/uploads/avatars/default.png`;

export default function MiniProfileCard({ username, anchorRef, onClose }) {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUser = async () => {
      const res = await fetch(`${API}/api/vine/users/${username}`);
      const data = await res.json();
      setUser(data.user);
    };
    fetchUser();
  }, [username]);

  if (!user) return null;

  return (
    <div className="mini-profile-card">
      <img
        src={user.avatar_url || DEFAULT_AVATAR}
        alt=""
        onError={(e) => {
          e.currentTarget.src = DEFAULT_AVATAR;
        }}
      />
      <div className="mini-meta">
        <strong>{user.display_name}</strong>
        <span>@{user.username}</span>
        {user.last_active_at && user.show_last_active !== 0 && (
          <span className="last-active">
            🟢 Active {formatRelativeTime(user.last_active_at)} ago
          </span>
        )}
        <button
          onClick={() => navigate(`/vine/profile/${user.username}`)}
        >
          View profile
        </button>
      </div>
    </div>
  );
}
