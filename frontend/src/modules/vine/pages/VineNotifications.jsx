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
  
  const getMeta = (n) => {
    if (!n?.meta_json) return {};
    if (typeof n.meta_json === "object") return n.meta_json || {};
    try {
      return JSON.parse(n.meta_json);
    } catch {
      return {};
    }
  };
  
  const renderText = (n) => {
    const meta = getMeta(n);
    switch (n.type) {
      case "like": {
        const reaction = String(meta.reaction || "like").toLowerCase();
        if (reaction === "love") return "loved your post";
        if (reaction === "happy") return "reacted 😄 to your post";
        if (reaction === "sad") return "reacted 😢 to your post";
        if (reaction === "care") return "reacted 🤗 to your post";
        return "liked your post";
      }
      case "comment": return "commented on your post";
      case "reply": return "replied to your comment";
      case "follow": return "followed you";
      case "like_comment": {
        const reaction = String(meta.reaction || "like").toLowerCase();
        if (reaction === "love") return "loved your comment";
        if (reaction === "happy") return "reacted 😄 to your comment";
        if (reaction === "sad") return "reacted 😢 to your comment";
        if (reaction === "care") return "reacted 🤗 to your comment";
        return "liked your comment";
      }
      case "revine": return "revined your post";
      case "mention_post": return "mentioned you in a post";
      case "mention_comment": return "mentioned you in a comment";
      case "follow_request": return "requested to follow you";
      case "follow_request_accepted": return "accepted your follow request";
      case "report_post": return "reported a post to Guardian";
      case "report_comment": return "reported a comment to Guardian";
      case "appeal": return "submitted an appeal";
      case "account_suspended": return "suspended your likes/comments access";
      case "account_unsuspended": return "lifted your suspension";
      case "guardian_warning": return "sent you a warning about reported content";
      case "community_assignment_created":
        return `posted a new assignment: "${meta.title || "Untitled assignment"}"`;
      case "community_assignment_submission": {
        const isPractical = String(meta.assignment_type || "").toLowerCase() === "practical";
        if (isPractical) {
          return `Submitted a practical assignment${meta.assignment_title ? `: "${meta.assignment_title}"` : ""}`;
        }
        return `${meta.is_resubmission ? "resubmitted" : "submitted"} assignment work${meta.assignment_title ? `: "${meta.assignment_title}"` : ""}`;
      }
      case "community_join_request":
        return `requested to join ${meta.community_name ? `"${meta.community_name}"` : "your community"}`;
      case "community_join_approved":
        return `approved your join request${meta.community_name ? ` for "${meta.community_name}"` : ""}`;
      case "community_assignment_graded": {
        const score = meta.score;
        const points = meta.assignment_points;
        const base =
          score === null || score === undefined || score === ""
            ? "graded your submission."
            : points !== null && points !== undefined && points !== ""
            ? `graded your submission: ${score}/${points}.`
            : `graded your submission: ${score}.`;
        const title = meta.assignment_title ? ` (${meta.assignment_title})` : "";
        return `${base}${title}`;
      }
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

  const markRead = async (id) => {
    try {
      await fetch(`${API}/api/vine/notifications/${id}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: 1 } : n))
      );
    } catch {
      // no-op
    }
  };

  const respondFollowRequest = async (notification, action) => {
    let requestId = getMeta(notification).follow_request_id;
    if (!requestId) {
      try {
        const res = await fetch(`${API}/api/vine/users/me/follow-requests`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const list = await res.json();
        const match = Array.isArray(list)
          ? list.find((r) => String(r.username || "").toLowerCase() === String(notification.username || "").toLowerCase())
          : null;
        requestId = match?.id || null;
      } catch {
        requestId = null;
      }
    }
    if (!requestId) return;
    try {
      const res = await fetch(`${API}/api/vine/users/follow-requests/${requestId}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) return;
      await markRead(notification.id);
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    } catch (err) {
      console.error("Follow request response failed", err);
    }
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
      await markRead(n.id);
    
      if (n.type === "follow" || n.type === "follow_request_accepted") {
        navigate(`/vine/profile/${n.username}`);
        return;
      }
      if (n.type === "follow_request") {
        navigate("/vine/settings");
        return;
      }

      if (n.type === "report_post" || n.type === "report_comment") {
        navigate("/vine/guardian/moderation?type=reports");
        return;
      }
      if (n.type === "appeal") {
        navigate("/vine/guardian/moderation?type=appeals");
        return;
      }
      if (n.type === "guardian_warning") {
        if (n.comment_id) {
          navigate(`/vine/feed?post=${n.post_id}&comment=${n.comment_id}`);
          return;
        }
        if (n.post_id) {
          navigate(`/vine/feed?post=${n.post_id}`);
          return;
        }
      }

      if (n.type === "community_assignment_created" || n.type === "community_assignment_graded") {
        const meta = getMeta(n);
        if (meta.community_slug) {
          navigate(`/vine/communities/${meta.community_slug}?tab=assignments`);
          return;
        }
      }

      if (n.type === "community_assignment_submission") {
        const meta = getMeta(n);
        if (meta.community_slug) {
          navigate(`/vine/communities/${meta.community_slug}?tab=assignments`);
          return;
        }
      }

      if (n.type === "community_join_request") {
        const meta = getMeta(n);
        if (meta.community_slug) {
          navigate(`/vine/communities/${meta.community_slug}?tab=settings`);
          return;
        }
      }

      if (n.type === "community_join_approved") {
        const meta = getMeta(n);
        if (meta.community_slug) {
          navigate(`/vine/communities/${meta.community_slug}`);
          return;
        }
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
        <img
          src={n.avatar_url}
          alt={n.username}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/vine/profile/${n.username}`);
          }}
        />
      ) : (
        <span
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/vine/profile/${n.username}`);
          }}
        >
          {(n.username || "U")[0].toUpperCase()}
        </span>
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
          <span
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/vine/profile/${n.username}`);
            }}
          >
            {n.display_name || n.username}
          </span>
          {(Number(n.is_verified) === 1 || ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(n.username || "").toLowerCase())) && (
            <span className={`verified ${["vine guardian","vine_guardian","vine news","vine_news"].includes(String(n.username || "").toLowerCase()) ? "guardian" : ""}`}>
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
        </strong>{" "}
        {renderText(n)}
      </div>

      <div className="notif-time">
        {timeAgo(n.created_at)}
         </div>
      {n.type === "follow_request" && (
        <div
          className="notif-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="notif-action accept"
            onClick={() => respondFollowRequest(n, "accept")}
          >
            Accept
          </button>
          <button
            className="notif-action decline"
            onClick={() => respondFollowRequest(n, "reject")}
          >
            Rescind
          </button>
        </div>
      )}

    </div>
  </div>
))}

    </div>
  );
}
