import { useEffect, useState, useRef } from "react";
import "./VinePostCard.css";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const ORIGIN = API.replace(/\/api$/, "");

const formatRelativeTime = (dateString) => {
  if (!dateString) return "now";

  // Force safe parsing for MySQL timestamps
  const parsed = new Date(dateString.replace(" ", "T"));
  const now = new Date();

  const diffInSeconds = Math.floor((now.getTime() - parsed.getTime()) / 1000);

  // Guard against bad values
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


export default function VinePostCard({ post, onDeletePost }) {
  const token = localStorage.getItem("vine_token");
  const navigate = useNavigate();

  let current_user_id = null;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      current_user_id = payload.id;
    } catch (e) { console.error("Token decode error"); }
  }

  const [likes, setLikes] = useState(post.likes || 0);
  const [revines, setRevines] = useState(post.revines || 0);
  const [userLiked, setUserLiked] = useState(post.user_liked || false);
  const [userRevined, setUserRevined] = useState(post.user_revined || false);
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [commentCount, setCommentCount] = useState(post.comments || 0);

  const isPostAuthor = Number(current_user_id) === Number(post.user_id);

  const fetchComments = async () => {
    try {
      const res = await fetch(`${API}/api/vine/posts/${post.id}/comments`);
      const data = await res.json();
      setComments(buildThreads(data));
      setCommentCount(data.length);
    } catch (err) { console.error("Error fetching comments:", err); }
  };

  useEffect(() => { if (open) fetchComments(); }, [open]);

  const handleLike = async () => {
    const res = await fetch(`${API}/api/vine/posts/${post.id}/like`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setLikes(data.likes);
    setUserLiked(data.user_liked);
  };

  const handleRevine = async () => {
    const res = await fetch(`${API}/api/vine/posts/${post.id}/revine`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setRevines(data.revines);
    setUserRevined(data.user_revined);
  };

  const deleteMainPost = async () => {
    if (!window.confirm("Delete this post forever?")) return;
    const res = await fetch(`${API}/api/vine/posts/${post.id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) onDeletePost(post.id);
  };

  const sendComment = async (content, parent_comment_id = null) => {
    if (!content.trim()) return;
    const res = await fetch(`${API}/api/vine/posts/${post.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content, parent_comment_id })
    });
    if (res.ok) {
      if (!parent_comment_id) setText("");
      fetchComments();
    }
  };

  const deleteComment = async (cid) => {
    if (!window.confirm("Delete this reply?")) return;
    const res = await fetch(`${API}/api/vine/comments/${cid}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) fetchComments();
  };
  

  return (
    <div className="vine-post light-green-theme" id={`post-${post.id}`}>
      <div className="vine-post-header">
        <div className="post-avatar" onClick={() => navigate(`/vine/profile/${post.username}`)}>
          {post.avatar_url ? (
            <img src={`${API}${post.avatar_url}`} alt="avatar" />
          ) : (
            <div className="avatar-fallback">{(post.username || "?")[0].toUpperCase()}</div>
          )}
        </div>

        <div className="post-user-meta">
          {/* 🔁 Revine label (TOP) */}
          {post.revined_by && (
          <div className="revine-top">
           🔁 {post.reviner_username} revined
         </div>
           )}

<div className="meta-top">
<div className="name-row">
  <strong className="display-name">
    {post.display_name || post.username}
  </strong>

  {post.is_verified === 1 && <span className="verified">
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
}
</div>


  <span className="username">@{post.username}</span>
  <span className="time">
  • {post.created_at} | {formatRelativeTime(post.sort_time)}
</span>

</div>

          {isPostAuthor && (
            <button className="delete-post-btn" onClick={deleteMainPost}>🗑️</button>
          )}
        </div>
      </div>

      <p className="vine-post-content">{post.content}</p>
      
      {post.image_url && <ImageCarousel imageUrl={post.image_url} />}

      <div className="vine-post-footer">
        <button className={`action-btn ${userLiked ? "active-like" : ""}`} onClick={handleLike}>
          {userLiked ? "❤️" : "🤍"} {likes}
        </button>
        <button className="action-btn" onClick={() => setOpen(!open)}>💬 {commentCount}</button>
        <button className={`action-btn ${userRevined ? "active-revine" : ""}`} onClick={handleRevine}>🔁 {revines}</button>
        <button className="action-btn" onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/posts/${post.id}`);
            alert("Copied! 🌱");
        }}>📤</button>
      </div>

      {open && (
  <div className="vine-comments-area">
    {/* 1. Header with Close Button - Good for short threads */}
    <div className="thread-controls-top" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
      <button className="close-thread-btn" onClick={() => setOpen(false)}>
        ✕ Close
      </button>
    </div>

    {/* 2. Main Reply Box with Auto-Expand */}
    <div className="comment-input-row">
      <textarea 
        value={text} 
        onChange={e => {
          setText(e.target.value);
          // Simple auto-expand logic
          e.target.style.height = 'inherit';
          e.target.style.height = `${e.target.scrollHeight}px`;
        }} 
        placeholder="Post your reply" 
        rows="1"
      />
      <button onClick={() => sendComment(text)}>Reply</button>
    </div>

    {/* 3. The Threaded List */}
    <div className="vine-thread-list">
      {comments.map(c => (
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

    {/* 4. Bottom Close Button - Perfect for long threads */}
    {comments.length > 2 && (
      <button className="close-thread-btn bottom" onClick={() => setOpen(false)}>
        ↑ Close Thread
      </button>
    )}
  </div>
)}
    </div>
  );
}

function Comment({ comment, onReply, onDelete, isPostOwner, currentUserId }) {
  const token = localStorage.getItem("vine_token");
  const [likes, setLikes] = useState(comment.likes || 0);
  const [userLiked, setUserLiked] = useState(comment.user_liked || false);
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");

  const handleLike = async () => {
    const res = await fetch(`${API}/api/vine/comments/${comment.id}/like`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    setLikes(data.likes);
    setUserLiked(data.user_liked);
  };

  const canDelete = isPostOwner || Number(currentUserId) === Number(comment.user_id);

  return (
<div className="vine-comment-node" id={`comment-${comment.id}`}>

  <div className="comment-main">
        <div className="comment-meta">
          <strong>{comment.display_name || comment.username}</strong>
          <span className="time">
  • {formatRelativeTime(comment.created_at || comment.sort_time)}
</span>
   

 
        </div>
        <p className="comment-text">{comment.content}</p>
        
        <div className="comment-actions">
          <button className={`mini-btn ${userLiked ? "active-like" : ""}`} onClick={handleLike}>
            {userLiked ? "❤️" : "🤍"} {likes}
          </button>
          <button className="mini-btn" onClick={() => setReplying(!replying)}>Reply</button>
          {canDelete && (
            <button className="mini-btn del-text" onClick={() => onDelete(comment.id)}>🗑️</button>
          )}
        </div>

        {replying && (
          <div className="comment-reply-box">
            <input value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Write a reply..." />
            <button onClick={() => { onReply(replyText, comment.id); setReplyText(""); setReplying(false); }}>Send</button>
          </div>
        )}
      </div>

      {comment.replies?.length > 0 && (
        <div className="nested-replies">
          {comment.replies.map(r => (
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

function buildThreads(comments) {
  const map = {};
  const roots = [];
  comments.forEach(c => { map[c.id] = { ...c, replies: [] }; });
  comments.forEach(c => {
    if (c.parent_comment_id && map[c.parent_comment_id]) map[c.parent_comment_id].replies.push(map[c.id]);
    else roots.push(map[c.id]);
  });
  return roots;
}
function ImageCarousel({ imageUrl }) {
  let images = [];
  console.log("ORIGIN:", ORIGIN);
console.log("imageUrl:", imageUrl);

  try {
    images = JSON.parse(imageUrl);
  } catch {
    images = [imageUrl]; // backward compatibility
  }

  const containerRef = useRef(null);
  const [index, setIndex] = useState(0);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const newIndex = Math.round(
      container.scrollLeft / container.offsetWidth
    );
    setIndex(newIndex);
  };

  const scrollTo = (i) => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({
      left: container.offsetWidth * i,
      behavior: "smooth",
    });
  };
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <div className="carousel-wrapper">
      <div
        className="carousel"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {images.map((src, i) => (
          <img
            key={i}
            src={`${ORIGIN}${src}`}
            alt=""
            className="carousel-img"
            onClick={() => setViewerOpen(true)}

          />
        ))}
      </div>
      {images.length > 1 && (
  <div className="carousel-counter">
    {index + 1} / {images.length}
  </div>
)}

      <div className="carousel-dots">
        {images.map((_, i) => (
          <span
            key={i}
            className={`dot ${i === index ? "active" : ""}`}
            onClick={() => scrollTo(i)}
          />
        ))}
      </div>
      {viewerOpen && (
  <div className="image-viewer-overlay" onClick={() => setViewerOpen(false)}>
    <button
  className="viewer-close"
  onClick={() => setViewerOpen(false)}
>✕</button>

    <img
      src={`${ORIGIN}${images[index]}`}
      className="image-viewer-img"
      onClick={(e) => e.stopPropagation()}
      alt=""
    />
    
  </div>
)}

    </div>
  );
  
}