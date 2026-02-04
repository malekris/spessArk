import { useState, useEffect, useRef } from "react";
import "./VinePostCard.css";
import { useNavigate } from "react-router-dom";
import ImageCarousel from "./ImageCarousel";
import MiniProfileCard from "../components/MiniProfileCard";

// ────────────────────────────────────────────────
//  CONFIG & HELPERS
// ────────────────────────────────────────────────

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";
const ORIGIN = API.replace(/\/api$/, "");
const viewedPosts = new Set();

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

const renderMentions = (text, navigate) => {
  if (!text) return text;
  const parts = text.split(/(@[a-zA-Z0-9._]{1,30})/g);
  return parts.map((part, idx) => {
    if (part.startsWith("@")) {
      const username = part.slice(1);
      return (
        <span
          key={`mention-${idx}-${username}`}
          className="mention"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/vine/profile/${username}`);
          }}
        >
          {part}
        </span>
      );
    }
    return <span key={`text-${idx}`}>{part}</span>;
  });
};

const getMentionAnchor = (value, caret) => {
  const left = value.slice(0, caret);
  const at = left.lastIndexOf("@");
  if (at === -1) return null;
  const after = left.slice(at + 1);
  if (!after || /\s/.test(after)) return null;
  return { start: at, end: caret, query: after };
};

const applyMention = (value, anchor, username) => {
  if (!anchor) return value;
  const before = value.slice(0, anchor.start);
  const after = value.slice(anchor.end);
  return `${before}@${username} ${after}`;
};

// ────────────────────────────────────────────────
//  MAIN COMPONENT: VinePostCard
// ────────────────────────────────────────────────

export default function VinePostCard({ post, onDeletePost, focusComments, isMe }) {

  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  const lastTapRef = useRef(0);
  const postRef = useRef(null);
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
  const [postLikes, setPostLikes] = useState(post.likes || 0);
  const [postUserLiked, setPostUserLiked] = useState(post.user_liked || false);
  const [revines, setRevines] = useState(post.revines || 0);
  const [userRevined, setUserRevined] = useState(post.user_revined || false);
  const [views, setViews] = useState(post.views ?? post.view_count ?? 0);
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [commentCount, setCommentCount] = useState(post.comments || 0);
  const [showMini, setShowMini] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const avatarRef = useRef(null);
  const [commentLikes, setCommentLikes] = useState({});
  const [commentUserLiked, setCommentUserLiked] = useState({});
  const [isDeleted, setIsDeleted] = useState(false);
  const [bookmarked, setBookmarked] = useState(post.user_bookmarked || false);
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionAnchor, setMentionAnchor] = useState(null);

  const CONTENT_LIMIT = 280;
  const hasLongContent = (post.content || "").length > CONTENT_LIMIT;
  const contentToShow =
    hasLongContent && !isExpanded
      ? `${post.content.slice(0, CONTENT_LIMIT).trimEnd()}...`
      : post.content;


  const canShowLikeCount = !post.hide_like_counts || isPostAuthor;

  let linkPreview = null;
  if (post.link_preview) {
    try {
      linkPreview =
        typeof post.link_preview === "string"
          ? JSON.parse(post.link_preview)
          : post.link_preview;
    } catch {
      linkPreview = null;
    }
  }

  // ── Effects ─────────────────────────────────────
  useEffect(() => {
    if (open) fetchComments();
  }, [open]);

  useEffect(() => {
    if (post.views !== undefined || post.view_count !== undefined) {
      setViews(post.views ?? post.view_count ?? 0);
    }
  }, [post.views, post.view_count]);

  useEffect(() => {
    if (!token) return;
    if (!post?.id) return;
    if (viewedPosts.has(post.id)) return;
    const el = postRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          viewedPosts.add(post.id);
          recordView();
          observer.disconnect();
        });
      },
      { threshold: 0.6 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [post.id, token]);

  useEffect(() => {
    if (post.comments !== undefined) {
      setCommentCount(post.comments || 0);
    }
  }, [post.comments]);

  useEffect(() => {
    const q = mentionAnchor?.query;
    if (!q) {
      setMentionResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/vine/users/mention?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setMentionResults(Array.isArray(data) ? data : []);
      } catch {
        setMentionResults([]);
      }
    }, 120);
    return () => clearTimeout(timeout);
  }, [mentionAnchor?.query, token]);

  useEffect(() => {
    if (post.user_bookmarked !== undefined) {
      setBookmarked(Boolean(post.user_bookmarked));
    }
  }, [post.user_bookmarked]);

  useEffect(() => {
    if (focusComments) {
      setOpen(true);
      setTimeout(() => {
        const input = document.querySelector(`#post-${post.id} textarea`);
        input?.focus();
      }, 0);
    }
  }, [focusComments, post.id]);
  useEffect(() => {
    const likes = { ...commentLikes };
    const liked = { ...commentUserLiked };
  
    const hydrate = (node) => {
      if (likes[node.id] === undefined) {
        likes[node.id] = node.like_count || 0;
      }
      if (liked[node.id] === undefined) {
        liked[node.id] = node.user_liked || false;
      }
  
      if (node.replies?.length) {
        node.replies.forEach(hydrate);
      }
    };
  
    comments.forEach(hydrate);
  
    setCommentLikes(likes);
    setCommentUserLiked(liked);
  }, [comments]);
  
  // ── API Handlers ────────────────────────────────
  const fetchComments = async () => {
    try {
      const res = await fetch(
        `${API}/api/vine/posts/${post.id}/comments`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );
  
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
    setPostLikes(data.likes);
    setPostUserLiked(data.user_liked);
  };

  const handleBookmark = async () => {
    try {
      const res = await fetch(`${API}/api/vine/posts/${post.id}/bookmark`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setBookmarked(Boolean(data.user_bookmarked));
    } catch (err) {
      console.error("Bookmark failed", err);
    }
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

  const recordView = async () => {
    try {
      const res = await fetch(`${API}/api/vine/posts/${post.id}/view`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && typeof data.views === "number") {
        setViews(data.views);
      }
    } catch (err) {
      console.error("View record error", err);
    }
  };
 
  const deleteMainPost = async () => {
    if (!window.confirm("Delete this post forever?")) return;
    const res = await fetch(`${API}/api/vine/posts/${post.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setIsDeleted(true);
      onDeletePost?.(post.id);
    }
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

  if (isDeleted) return null;

  // ── Render ──────────────────────────────────────
  return (
    <div className="vine-post light-green-theme" id={`post-${post.id}`} ref={postRef}>
      {/* Header: Avatar + User meta */}
      <div className="vine-post-header">
      <div
  ref={avatarRef}
  className="post-avatar"
  onMouseEnter={() => setShowMini(true)}   // desktop hover
  onMouseLeave={() => setShowMini(false)}
  onClick={(e) => {                         // mobile tap
    e.stopPropagation();
    setShowMini(v => !v);
  }}
>
  <img
    src={post.avatar_url || DEFAULT_AVATAR}
    alt="avatar"
    onError={(e) => {
      e.currentTarget.src = DEFAULT_AVATAR;
    }}
  />

  {showMini && (
    <MiniProfileCard
      username={post.username}
      onClose={() => setShowMini(false)}
    />
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
            <strong
  className="display-name clickable"
  onClick={() => navigate(`/vine/profile/${post.username}`)}
>
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
              {isMe && post.revined_by === 0 && (
  <>
    <button
      className="pin-btn"
      onClick={pinPost}
      title={post.is_pinned ? "Unpin post" : "Pin post"}
    >
      📌
    </button>

    {post.is_pinned === 1 && (
      <span className="pinned-badge">📌 Pinned</span>
    )}
  </>
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
      <p
        className={`vine-post-content ${
          post.content &&
          post.content.length < 120 &&
          !post.image_url
            ? "big-text"
            : ""
        }`}
        style={{ whiteSpace: "pre-wrap" }}   // ← this one line fixes paragraphs
      >
        {renderMentions(contentToShow, navigate)}
      </p>
      {hasLongContent && (
        <button
          className="see-more-btn"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          {isExpanded ? "See less" : "See more"}
        </button>
      )}

      {linkPreview?.url && (
        <div
          className="link-preview"
          onClick={() => window.open(linkPreview.url, "_blank")}
        >
          {linkPreview.image && (
            <img
              src={linkPreview.image}
              alt={linkPreview.title || "Link preview"}
              className="link-preview-img"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          <div className="link-preview-body">
            <div className="link-preview-title">
              {linkPreview.title || linkPreview.url}
            </div>
            {linkPreview.description && (
              <div className="link-preview-desc">
                {linkPreview.description}
              </div>
            )}
            <div className="link-preview-domain">
              {linkPreview.site_name || linkPreview.domain || new URL(linkPreview.url).hostname}
            </div>
          </div>
        </div>
      )}

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
    <ImageCarousel
      imageUrl={post.image_url}
      onLike={handleLike}
      onRevine={handleRevine}
      onComments={() => setOpen(true)}
      likeCount={canShowLikeCount ? postLikes : null}
      revineCount={revines}
      commentCount={commentCount}
      userLiked={postUserLiked}
      userRevined={userRevined}
      displayName={post.display_name}
      username={post.username}
      timeLabel={formatRelativeTime(post.created_at)}
      caption={post.content}
    />
  </div>
        )}
      {/* Action footer */}
      <div className="vine-post-footer">
      <button
  className={`action-btn ${postUserLiked ? "active-like" : ""}`}
  onClick={handleLike}
>
  {postUserLiked ? "❤️" : "🤍"}
  {canShowLikeCount && ` ${postLikes}`}
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
          className={`action-btn bookmark-btn ${bookmarked ? "active-bookmark" : ""}`}
          onClick={handleBookmark}
          title={bookmarked ? "Remove bookmark" : "Save post"}
        >
          🔖
        </button>

        <span className="action-btn view-btn">👁️ {views}</span>

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
                const anchor = getMentionAnchor(e.target.value, e.target.selectionStart);
                setMentionAnchor(anchor);
              }}
              placeholder="Post your reply"
              rows={1}
            />
            <button onClick={() => sendComment(text)}>Reply</button>
          </div>
          {mentionResults.length > 0 && mentionAnchor && (
            <div className="mention-suggest-list">
              {mentionResults.map((u) => (
                <button
                  key={`mention-${u.id}`}
                  className="mention-suggest-item"
                  onClick={() => {
                    setText((prev) => applyMention(prev, mentionAnchor, u.username));
                    setMentionAnchor(null);
                    setMentionResults([]);
                  }}
                >
                  <img
                    src={u.avatar_url || DEFAULT_AVATAR}
                    alt={u.username}
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_AVATAR;
                    }}
                  />
                  <div>
                    <div className="mention-name">{u.display_name || u.username}</div>
                    <div className="mention-handle">@{u.username}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {mentionAnchor && (
            <div className="mention-preview">
              {renderMentions(text, navigate)}
            </div>
          )}

          {/* Threaded comments */}
          <div className="vine-thread-list">
          {comments.map((c) => (
  <Comment
    key={c.id}
    comment={c}
    commentLikes={commentLikes}
    commentUserLiked={commentUserLiked}
    setCommentLikes={setCommentLikes}
    setCommentUserLiked={setCommentUserLiked}
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

function Comment({ comment, commentLikes, commentUserLiked, setCommentLikes, setCommentUserLiked, onReply, onDelete, isPostOwner, currentUserId }) {

const token = localStorage.getItem("vine_token");
  const navigate = useNavigate();
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionAnchor, setMentionAnchor] = useState(null);

  const [likes, setLikes] = useState(comment.likes || 0);
  const [userLiked, setUserLiked] = useState(comment.user_liked || false);
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");

  const canDelete = isPostOwner || Number(currentUserId) === Number(comment.user_id);

  useEffect(() => {
    const q = mentionAnchor?.query;
    if (!q) {
      setMentionResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/vine/users/mention?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setMentionResults(Array.isArray(data) ? data : []);
      } catch {
        setMentionResults([]);
      }
    }, 120);
    return () => clearTimeout(timeout);
  }, [mentionAnchor?.query, token]);

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
            src={comment.avatar_url || DEFAULT_AVATAR}
            className="comment-avatar"
            alt=""
            onClick={() => navigate(`/vine/profile/${comment.username}`)}
            onError={(e) => {
              e.currentTarget.src = DEFAULT_AVATAR;
            }}
          />

<div className="comment-meta-text">
  <strong
    className="comment-username"
    onClick={() => navigate(`/vine/profile/${comment.username}`)}
  >
    {comment.display_name || comment.username}

    {comment.is_verified === 1 && (
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
  </strong>

  <span className="time">
    • {formatRelativeTime(comment.created_at || comment.sort_time)}
  </span>
</div>

        </div>

        <p className="comment-text">{renderMentions(comment.content, navigate)}</p>

        <div className="comment-actions">
  <button
className={`mini-btn ${
  commentUserLiked?.[comment.id] ? "active-like" : ""
}`}

  onClick={async () => {
      const res = await fetch(
      `${API}/api/vine/comments/${comment.id}/like`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json();

      setCommentLikes(prev => ({
        ...prev,
        [comment.id]: data.like_count,
      }));
      setCommentUserLiked(prev => ({
        ...prev,
        [comment.id]: data.user_liked,

      }));
    }}
  >
    {commentUserLiked?.[comment.id] ? "❤️" : "🤍"}{" "}

    {commentLikes?.[comment.id] ?? comment.like_count ?? 0}

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
              onChange={(e) => {
                setReplyText(e.target.value);
                const anchor = getMentionAnchor(e.target.value, e.target.selectionStart);
                setMentionAnchor(anchor);
              }}
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
            {mentionResults.length > 0 && mentionAnchor && (
              <div className="mention-suggest-list">
                {mentionResults.map((u) => (
                  <button
                    key={`mention-r-${u.id}`}
                    className="mention-suggest-item"
                    onClick={() => {
                      setReplyText((prev) => applyMention(prev, mentionAnchor, u.username));
                      setMentionAnchor(null);
                      setMentionResults([]);
                    }}
                  >
                    <img
                      src={u.avatar_url || DEFAULT_AVATAR}
                      alt={u.username}
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_AVATAR;
                      }}
                    />
                    <div>
                      <div className="mention-name">{u.display_name || u.username}</div>
                      <div className="mention-handle">@{u.username}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {mentionAnchor && (
              <div className="mention-preview">
                {renderMentions(replyText, navigate)}
              </div>
            )}
          </div>
        )}
      </div>

      {comment.replies?.length > 0 && (
            <div className="nested-replies">
              {comment.replies.map((r) => (
                <Comment
                  key={r.id}
                  comment={r}
                  commentLikes={commentLikes}
                  commentUserLiked={commentUserLiked}
                  setCommentLikes={setCommentLikes}
                  setCommentUserLiked={setCommentUserLiked}
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
