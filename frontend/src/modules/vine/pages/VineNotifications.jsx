import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./VineNotifications.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineNotifications() {
  const [notifications, setNotifications] = useState([]);
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  useEffect(() => {
    document.title = "Vine — Notifications";
  }, []);
  useEffect(() => {
    if (!token) return;
  
    const loadNotifications = async () => {
      const res = await fetch(`${API}/api/vine/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
  
      const data = await res.json();
      setNotifications(data);
  
      
    };
  
    loadNotifications();
  }, [token]);
  
  
  
  const renderText = (n) => {
    switch (n.type) {
      case "like": return "liked your post";
      case "comment": return "commented on your post";
      case "reply": return "replied to your comment";
      case "follow": return "followed you";
      case "like_comment": return "liked your comment";
      case "revine": return "revined your post";
      default: return "interacted with you";
    }
  };
  const timeAgo = (dateString) => {
    const now = new Date();
    const past = new Date(dateString);
    const seconds = Math.floor((now - past) / 1000);
  
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds} seconds ago`;
  
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
  
    return past.toLocaleDateString(); // fallback for old dates
  };
  
  const isNew = (dateString) => {
    const now = new Date();
    const past = new Date(dateString);
    return (now - past) < 60000; // less than 1 minute
  };
  
  
  return (
    <div className="vine-notifications-page">

      {/* Top bar */}
      <div className="vine-profile-topbar">
        <button onClick={() => navigate(-1)}>←</button>
        <h3>Notifications</h3>
      </div>

      {/* Empty state */}
      {notifications.length === 0 && (
        <p className="empty-notifs">No notifications yet 🌱</p>
      )}

      {/* List */}
     
      {notifications.map(n => (
  <div
    key={n.id}
    className={`notif-row ${!n.is_read ? "unread" : ""}`}
    role="button"
    tabIndex={0}
    onClick={async () => {
      await fetch(`${API}/api/vine/notifications/${n.id}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    
      if (n.type === "follow") {
        navigate(`/vine/profile/${n.username}`);
        return;
      }
    
      // comments & replies
      if (n.comment_id) {
        navigate(`/vine/feed?post=${n.post_id}&comment=${n.comment_id}`);
        return;
      }
    
      // likes, revines, etc (🔥 THIS IS THE FIX)
      if (n.post_id) {
        navigate(`/vine/feed?post=${n.post_id}`);
      }
    }}
    
  
  >
    <div className="notif-avatar">
      {n.avatar_url ? (
        <img src={n.avatar_url} alt={n.username} />
      ) : (
        <span>{(n.username || "U")[0].toUpperCase()}</span>
      )}
    </div>

    <div className="notif-body">
      <div className="notif-text">
      {isNew(n.created_at) && <span className="new-badge">NEW</span>}
        <strong
          className="notif-user"
          onClick={(e) => {
            e.stopPropagation(); // prevent row click
            navigate(`/vine/profile/${n.username}`);
          }}
        >
          {n.display_name || n.username}
        </strong>{" "}
        {renderText(n)}
      </div>

      <div className="notif-time">
        {timeAgo(n.created_at)}
         </div>

    </div>
  </div>
))}

    </div>
  );
}
