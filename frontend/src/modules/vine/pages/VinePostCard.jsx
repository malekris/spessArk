import { useState, useEffect, useRef } from "react";
import "./VinePostCard.css";
import { useNavigate } from "react-router-dom";
import ImageCarousel from "./ImageCarousel";

// ────────────────────────────────────────────────
//  CONFIG & HELPERS
// ────────────────────────────────────────────────

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const ORIGIN = API.replace(/\/api$/, "");

/**
 * Formats timestamp to relative time (just now, 5m, 2h, 3d, or date)
 */
const formatRelativeTime = (dateString) => {
  if (!dateString) return "now";

  const parsed = new Date(dateString.replace(" ", "T"));
  const now = new Date();

  const diffInSeconds = Math.floor((now.getTime() - parsed.getTime()) / 1000);

  if (isNaN(diffInSeconds) || diffInSeconds < 0) return "now";

  if (diffInSeconds < 60) return "just now";

  const minutes = Math.floor(diffInSeconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return parsed.toLocaleDateString();
};

// ────────────────────────────────────────────────
//  MAIN COMPONENT: VinePostCard
// ────────────────────────────────────────────────

export default function VinePostCard({ post, onDeletePost, focusComments, isMe }) {

const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  const lastTapRef = useRef(0);
  // Current user ID from JWT
  let current_user_id = null;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      current_user_id = payload.id;
    } catch (e) {
      console.error("Token decode error");
    }
  }

  const isPostAuthor = Number(current_user_id) === Number(post.user_id);

  // ── State ───────────────────────────────────────
  const [likes, setLikes] = useState(post.likes || 0);
  const [revines, setRevines] = useState(post.revines || 0);
  const [userLiked, setUserLiked] = useState(post.user_liked || false);
  const [userRevined, setUserRevined] = useState(post.user_revined || false);
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [commentCount, setCommentCount] = useState(post.comments || 0);

  // ── Effects ─────────────────────────────────────
  useEffect(() => {
    if (open) fetchComments();
  }, [open]);

  useEffect(() => {
    if (focusComments) {
      setOpen(true);
      setTimeout(() => {
        const input = document.querySelector(`#post-${post.id} textarea`);
        input?.focus();
      }, 0);
    }
  }, [focusComments, post.id]);

  // ── API Handlers ────────────────────────────────
  const fetchComments = async () => {
    try {
      const res = await fetch(`${API}/api/vine/posts/${post.id}/comments`);
      const data = await res.json();

      if (!Array.isArray(data)) {
        setComments([]);
        setCommentCount(0);
        return;
      }

      setComments(buildThreads(data));
      setCommentCount(data.length);
    } catch (err) {
      console.error("Error fetching comments:", err);
      setComments([]);
      setCommentCount(0);
    }
  };
  const pinPost = async () => {
    try {
      await fetch(`${API}/api/vine/posts/${post.id}/pin`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      window.location.reload(); // simple refresh for now
    } catch (err) {
      console.error("Pin post failed", err);
    }
  };
  const handleLike = async () => {
    const res = await fetch(`${API}/api/vine/posts/${post.id}/like`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setLikes(data.likes);
    setUserLiked(data.user_liked);
  };

  const handleRevine = async () => {
    const res = await fetch(`${API}/api/vine/posts/${post.id}/revine`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setRevines(data.revines);
    setUserRevined(data.user_revined);
  };

  const deleteMainPost = async () => {
    if (!window.confirm("Delete this post forever?")) return;
    const res = await fetch(`${API}/api/vine/posts/${post.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) onDeletePost(post.id);
  };

  const sendComment = async (content, parent_comment_id = null) => {
    if (!content.trim()) return;
    const res = await fetch(`${API}/api/vine/posts/${post.id}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content, parent_comment_id }),
    });
    if (res.ok) {
      if (!parent_comment_id) setText("");
      fetchComments();
    }
  };

  const deleteComment = async (cid) => {
    if (!window.confirm("Delete this reply?")) return;
    const res = await fetch(`${API}/api/vine/comments/${cid}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) fetchComments();
  };

  // ── Render ──────────────────────────────────────
  return (
    <div className="vine-post light-green-theme" id={`post-${post.id}`}>
      {/* Header: Avatar + User meta */}
      <div className="vine-post-header">
        <div
          className="post-avatar"
          onClick={() => navigate(`/vine/profile/${post.username}`)}
        >
          {post.avatar_url ? (
            <img src={`${API}${post.avatar_url}`} alt="avatar" />
          ) : (
            <div className="avatar-fallback">
              {(post.username || "?")[0].toUpperCase()}
            </div>
          )}
        </div>

        <div className="post-user-meta">
          {/* Revine indicator – top of meta */}
          {post.revined_by > 0 && (
            <div className="revine-top">
              🔁 {post.reviner_username} revined
            </div>
          )}

          {/* Username, verification, time */}
          <div className="meta-top">
            <div className="name-row">
              <strong className="display-name">
                {typeof post.display_name === "string"
                  ? post.display_name
                  : typeof post.username === "string"
                  ? post.username
                  : ""}
              </strong>

              {post.is_verified === 1 && (
                <span className="verified">
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
            </div>

            {/* Username + time + delete button – same line */}
            <div className="meta-line">
              <span className="username">@{post.username}</span>
              <span className="time">
                • {formatRelativeTime(post.sort_time || post.created_at)}
              </span>
              {isMe && isPostAuthor && (
              <button
               className="pin-btn"
               onClick={pinPost}
               title="Pin post"
               >
               📌
               </button>
                )}

              {isPostAuthor && (
                <button className="delete-post-btn" onClick={deleteMainPost}>
                  🗑️
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Post content */}
      <p className="vine-post-content">{post.content}</p>

      {/* Images carousel */}
      {post.image_url && (
  <div
    onClick={() => {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        if (!post.user_liked) {
          handleLike(); // ❤️ existing like handler
        }
      }
      lastTapRef.current = now;
    }}
  >
    <ImageCarousel imageUrl={post.image_url} />
  </div>
        )}
      {/* Action footer */}
      <div className="vine-post-footer">
        <button
          className={`action-btn ${userLiked ? "active-like" : ""}`}
          onClick={handleLike}
        >
          {userLiked ? "❤️" : "🤍"} {likes}
        </button>

        <button className="action-btn" onClick={() => setOpen(!open)}>
          💬 {commentCount}
        </button>

        <button
          className={`action-btn ${userRevined ? "active-revine" : ""}`}
          onClick={handleRevine}
        >
          🔁 {revines}
        </button>

        <button
          className="action-btn"
          onClick={() => {
            navigator.clipboard.writeText(
              `${window.location.origin}/posts/${post.id}`
            );
            alert("Copied! 🌱");
          }}
        >
          📤
        </button>
      </div>

      {/* Comments section (collapsible) */}
      {open && (
        <div className="vine-comments-area">
          {/* Top close */}
          <div
            className="thread-controls-top"
            style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}
          >
            <button className="close-thread-btn" onClick={() => setOpen(false)}>
              ✕ Close
            </button>
          </div>

          {/* Reply input */}
          <div className="comment-input-row">
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = "inherit";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              placeholder="Post your reply"
              rows={1}
            />
            <button onClick={() => sendComment(text)}>Reply</button>
          </div>

          {/* Threaded comments */}
          <div className="vine-thread-list">
            {comments.map((c) => (
              <Comment
                key={c.id}
                comment={c}
                onReply={sendComment}
                onDelete={deleteComment}
                isPostOwner={isPostAuthor}
                currentUserId={current_user_id}
              />
            ))}
          </div>

          {/* Bottom close for long threads */}
          {comments.length > 2 && (
            <button
              className="close-thread-btn bottom"
              onClick={() => setOpen(false)}
            >
              ↑ Close Thread
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────
//  NESTED COMMENT COMPONENT
// ────────────────────────────────────────────────

function Comment({ comment, onReply, onDelete, isPostOwner, currentUserId }) {
  const token = localStorage.getItem("vine_token");

  const [likes, setLikes] = useState(comment.likes || 0);
  const [userLiked, setUserLiked] = useState(comment.user_liked || false);
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");

  const canDelete = isPostOwner || Number(currentUserId) === Number(comment.user_id);

  const handleLike = async () => {
    const res = await fetch(`${API}/api/vine/comments/${comment.id}/like`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setLikes(data.likes);
    setUserLiked(data.user_liked);
  };

  return (
    <div className="vine-comment-node" id={`comment-${comment.id}`}>
      <div className="comment-main">
        <div className="comment-meta">
          <img
            src={`${API}${comment.avatar_url}`}
            className="comment-avatar"
            alt=""
            onError={(e) => {
              e.currentTarget.src = `${API}/uploads/avatars/default.png`;
            }}
          />

          <div className="comment-meta-text">
            <strong>{comment.display_name || comment.username}</strong>
            <span className="time">
              • {formatRelativeTime(comment.created_at || comment.sort_time)}
            </span>
          </div>
        </div>

        <p className="comment-text">{comment.content}</p>

        <div className="comment-actions">
          <button
            className={`mini-btn ${userLiked ? "active-like" : ""}`}
            onClick={handleLike}
          >
            {userLiked ? "❤️" : "🤍"} {likes}
          </button>

          <button className="mini-btn" onClick={() => setReplying(!replying)}>
            Reply
          </button>

          {canDelete && (
            <button
              className="mini-btn del-text"
              onClick={() => onDelete(comment.id)}
            >
              🗑️
            </button>
          )}
        </div>

        {replying && (
          <div className="comment-reply-box">
            <input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write a reply..."
            />
            <button
              onClick={() => {
                onReply(replyText, comment.id);
                setReplyText("");
                setReplying(false);
              }}
            >
              Send
            </button>
          </div>
        )}
      </div>

      {comment.replies?.length > 0 && (
        <div className="nested-replies">
          {comment.replies.map((r) => (
            <Comment
              key={r.id}
              comment={r}
              onReply={onReply}
              onDelete={onDelete}
              isPostOwner={isPostOwner}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────
//  UTILITY: Build threaded comments
// ────────────────────────────────────────────────

function buildThreads(comments) {
  const map = {};
  const roots = [];

  comments.forEach((c) => {
    map[c.id] = { ...c, replies: [] };
  });

  comments.forEach((c) => {
    if (c.parent_comment_id && map[c.parent_comment_id]) {
      map[c.parent_comment_id].replies.push(map[c.id]);
    } else {
      roots.push(map[c.id]);
    }
  });

  return roots;
}