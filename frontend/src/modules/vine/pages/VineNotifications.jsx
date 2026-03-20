import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./VineNotifications.css";
import useWindowedList from "../../../hooks/useWindowedList";
import { getVineToken, isVineTokenExpired } from "../utils/vineAuth";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineNotifications() {
  const [notifications, setNotifications] = useState([]);
  const navigate = useNavigate();
  const token = getVineToken();
  const hasLiveSession = Boolean(token) && !isVineTokenExpired(token);
  const listRef = useRef(null);
  const {
    visibleItems: visibleNotifications,
    padTop,
    padBottom,
  } = useWindowedList(notifications, {
    containerRef: listRef,
    estimatedItemHeight: 118,
    overscan: 5,
    enabled: notifications.length > 28,
  });
  useEffect(() => {
    document.title = "Vine — Notifications";
  }, []);
  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();
    const loadNotifications = async () => {
      const res = await fetch(`${API}/api/vine/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
        cache: "no-store",
      });

      const data = await res.json();
      if (controller.signal.aborted) return;
      setNotifications(Array.isArray(data) ? data : []);
    };

    loadNotifications().catch((err) => {
      if (err?.name !== "AbortError") {
        console.error("Failed to load notifications", err);
      }
    });

    return () => controller.abort();
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

  const getActorUsername = (notification) => {
    const meta = getMeta(notification);
    return String(
      notification?.username ||
        meta?.username ||
        meta?.actor_username ||
        ""
    ).trim();
  };

  const getActorDisplayName = (notification) => {
    const meta = getMeta(notification);
    return String(
      notification?.display_name ||
        meta?.display_name ||
        meta?.actor_display_name ||
        getActorUsername(notification) ||
        "Someone"
    ).trim();
  };

  const openActorProfile = (notification) => {
    const username = getActorUsername(notification);
    if (!username) return;
    navigate(`/vine/profile/${username}`);
  };

  const buildPostTarget = (notification) => {
    const meta = getMeta(notification);
    const postId = notification?.post_id || meta?.post_id || meta?.target_post_id || null;
    const commentId =
      notification?.comment_id || meta?.comment_id || meta?.target_comment_id || null;

    if (!postId) return null;
    const params = new URLSearchParams();
    if (commentId) params.set("comment", String(commentId));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return `/vine/post/${postId}${suffix}`;
  };

  const resolveNotificationPath = (notification) => {
    const meta = getMeta(notification);
    const actorUsername = getActorUsername(notification);

    if ((notification.type === "follow" || notification.type === "follow_request_accepted") && actorUsername) {
      return `/vine/profile/${actorUsername}`;
    }
    if (notification.type === "birthday" && actorUsername) {
      return `/vine/profile/${actorUsername}`;
    }
    if (notification.type === "follow_request") {
      return "/vine/settings";
    }
    if (notification.type === "report_post" || notification.type === "report_comment") {
      return "/vine/guardian/moderation?type=reports";
    }
    if (notification.type === "appeal") {
      return "/vine/guardian/moderation?type=appeals";
    }
    if (notification.type === "community_assignment_created" || notification.type === "community_assignment_graded") {
      if (meta.community_slug) return `/vine/communities/${meta.community_slug}?tab=assignments`;
      return null;
    }
    if (notification.type === "community_assignment_submission") {
      if (meta.community_slug) return `/vine/communities/${meta.community_slug}?tab=assignments`;
      return null;
    }
    if (notification.type === "community_join_request") {
      if (meta.community_slug) return `/vine/communities/${meta.community_slug}?tab=settings`;
      return null;
    }
    if (notification.type === "community_join_approved") {
      if (meta.community_slug) return `/vine/communities/${meta.community_slug}`;
      return null;
    }

    const postTarget = hasLiveSession
      ? buildFeedTarget(notification)
      : buildPostTarget(notification);
    if (postTarget) return postTarget;
    return null;
  };

  const buildFeedTarget = (notification) => {
    const meta = getMeta(notification);
    const postId = notification?.post_id || meta?.post_id || meta?.target_post_id || null;
    const commentId =
      notification?.comment_id || meta?.comment_id || meta?.target_comment_id || null;
    if (!postId) return null;

    const params = new URLSearchParams();
    params.set("post", String(postId));
    if (commentId) params.set("comment", String(commentId));
    return `/vine/feed?${params.toString()}`;
  };

  const hasPostContext = (notification) => Boolean(
    notification?.post_id ||
      notification?.comment_id ||
      getMeta(notification)?.post_id ||
      getMeta(notification)?.comment_id ||
      getMeta(notification)?.target_post_id ||
      getMeta(notification)?.target_comment_id
  );
  
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
      case "birthday":
        return "is celebrating a birthday today — send them a birthday message";
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

  const startBirthdayDm = async (notification) => {
    const userId = Number(notification?.actor_id || getMeta(notification)?.birthday_user_id || 0);
    if (!userId) return;
    try {
      const res = await fetch(`${API}/api/dms/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Cannot start conversation");
        return;
      }
      await markRead(notification.id);
      if (data.conversationId) {
        navigate(`/vine/dms/${data.conversationId}`);
        return;
      }
      const p = new URLSearchParams({
        username: getActorUsername(notification),
        displayName: getActorDisplayName(notification),
      });
      navigate(`/vine/dms/new/${userId}?${p.toString()}`);
    } catch (err) {
      console.error("Failed to start birthday DM", err);
      alert("Cannot start conversation");
    }
  };
  
  
  return (
    <div className="vine-notifications-page">

      {/* Top bar */}
      <div className="vine-profile-topbar">
        <button
          className="notif-topbar-back"
          onClick={() => navigate("/vine/feed")}
          aria-label="Back to feed"
        >
          <span className="notif-topbar-back-icon">←</span>
          <span className="notif-topbar-back-label">Feed</span>
        </button>
        <h3>Notifications</h3>
      </div>

      {/* Empty state */}
      {notifications.length === 0 && (
        <p className="empty-notifs">No notifications yet 🌱</p>
      )}

      {/* List */}
     
      <div className="notif-list-window" ref={listRef}>
      {padTop > 0 && <div style={{ height: `${padTop}px` }} aria-hidden="true" />}
      {visibleNotifications.map(n => (
  <div
    key={n.id}
    className={`notif-row ${!n.is_read ? "unread" : ""}`}
    role="button"
    tabIndex={0}
    onClick={async () => {
      await markRead(n.id);

      const target = resolveNotificationPath(n);
      if (target) {
        navigate(target);
      }
    }}
    
  
  >
    <div className="notif-avatar">
      {n.avatar_url ? (
        <img
          src={n.avatar_url}
          alt={getActorDisplayName(n)}
          onClick={(e) => {
            e.stopPropagation();
            openActorProfile(n);
          }}
        />
      ) : (
        <span
          onClick={(e) => {
            e.stopPropagation();
            openActorProfile(n);
          }}
        >
          {getActorDisplayName(n)[0]?.toUpperCase() || "U"}
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
            openActorProfile(n);
          }}
        >
          <span
            onClick={(e) => {
              e.stopPropagation();
              openActorProfile(n);
            }}
          >
            {getActorDisplayName(n)}
          </span>
          {(Number(n.is_verified) === 1 || ["vine guardian","vine_guardian","vine news","vine_news"].includes(getActorUsername(n).toLowerCase())) && (
            <span className={`verified ${["vine guardian","vine_guardian","vine news","vine_news"].includes(getActorUsername(n).toLowerCase()) ? "guardian" : ""}`}>
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
      {n.type === "birthday" && (
        <div className="notif-meta-row">
          <span className="notif-birthday-badge">🎉 Birthday today</span>
        </div>
      )}
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
      {hasPostContext(n) && (
        <div className="notif-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="notif-action feed-jump"
            onClick={async () => {
              await markRead(n.id);
              const target = buildFeedTarget(n);
              if (target) navigate(target);
            }}
          >
            View in feed
          </button>
        </div>
      )}
      {n.type === "birthday" && (
        <div className="notif-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="notif-action birthday-wish"
            onClick={() => startBirthdayDm(n)}
          >
            🎂 Send birthday wish
          </button>
        </div>
      )}

    </div>
  </div>
))}
      {padBottom > 0 && <div style={{ height: `${padBottom}px` }} aria-hidden="true" />}
      </div>

    </div>
  );
}
