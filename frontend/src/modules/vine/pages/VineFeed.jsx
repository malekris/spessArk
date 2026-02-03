import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import VinePostCard from "./VinePostCard";
import "./VineFeed.css";
import VineSuggestions from "./VineSuggestions";
import { socket } from "../../../socket";
import { useSearchParams } from "react-router-dom";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

// ────────────────────────────────────────────────
//  HELPERS
// ────────────────────────────────────────────────

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

// ────────────────────────────────────────────────
//  MAIN FEED COMPONENT
// ────────────────────────────────────────────────

export default function VineFeed() {
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");

  // User info from localStorage
  let myUsername = "";
  try {
    const storedUser = JSON.parse(localStorage.getItem("vine_user"));
    myUsername = storedUser?.username || "";
  } catch (e) {
    console.error("User parse error", e);
  }

  // ── State ───────────────────────────────────────
  const [posts, setPosts] = useState([]);
  const [content, setContent] = useState("");
  const [images, setImages] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [unread, setUnread] = useState(0);           // notifications
  const [unreadDMs, setUnreadDMs] = useState(0);     // DMs
  const [handledDeepLink, setHandledDeepLink] = useState(false);
  const [params] = useSearchParams();
  const targetPostId = params.get("post");
  // ── Deep Link Handling (post & comment highlight) ──
  useEffect(() => {
    if (handledDeepLink) return;

    const params = new URLSearchParams(window.location.search);
    const postId = params.get("post");
    const commentId = params.get("comment");

    if (!postId) return;

    let attempts = 0;

    const interval = setInterval(() => {
      const postEl = document.querySelector(`#post-${postId}`);
      if (!postEl) {
        attempts++;
        if (attempts > 10) clearInterval(interval);
        return;
      }

      // Auto-open comments
      const openBtn = postEl.querySelector(".action-btn:nth-child(2)");
      openBtn?.click();

      if (commentId) {
        setTimeout(() => {
          const commentEl = document.querySelector(`#comment-${commentId}`);
          if (commentEl) {
            commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
            commentEl.classList.add("highlight-comment");
            setTimeout(() => commentEl.classList.remove("highlight-comment"), 2000);
          }
        }, 400);
      }

      setHandledDeepLink(true);
      clearInterval(interval);
    }, 300);

    return () => clearInterval(interval);
  }, [posts, handledDeepLink]);

  // ── Feed Loading + Polling ──────────────────────
  const loadFeed = async () => {
    try {
      const res = await fetch(`${API}/api/vine/posts`);
      const data = await res.json();
      setPosts(data);
    } catch (err) {
      console.error("Load feed error", err);
    }
  };

  useEffect(() => {
    loadFeed(); // initial load

    const interval = setInterval(loadFeed, 5000); // refresh every 5s

    return () => clearInterval(interval);
  }, []);

  // ── Real-time Notifications & DMs ───────────────
  useEffect(() => {
    if (!token) return;

    // Fetch unread notifications
    const fetchUnreadNotifications = async () => {
      try {
        const res = await fetch(`${API}/api/vine/notifications/unread-count`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setUnread(data.count || 0);
      } catch (err) {
        console.error("Failed to fetch unread notifications");
      }
    };

    // Fetch unread DMs
    const fetchUnreadDMs = async () => {
      try {
        const res = await fetch(`${API}/api/dms/unread-total`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setUnreadDMs(data.total || 0);
      } catch {}
    };

    fetchUnreadNotifications();
    fetchUnreadDMs();

    // Socket listeners
    socket.connect();
    socket.on("notification", fetchUnreadNotifications);
    socket.on("dm_received", fetchUnreadDMs);
    socket.on("messages_seen", fetchUnreadDMs);

    // Register user for socket
    const user = JSON.parse(localStorage.getItem("vine_user"));
    if (user?.id) {
      socket.emit("register", user.id);
    }

    return () => {
      socket.off("notification", fetchUnreadNotifications);
      socket.off("dm_received", fetchUnreadDMs);
      socket.off("messages_seen", fetchUnreadDMs);
      socket.disconnect();
    };
  }, [token]);

  // ── Post Creation ───────────────────────────────
  const submitPost = async () => {
    if (!content.trim() && images.length === 0) return;

    try {
      const formData = new FormData();
      if (content.trim()) formData.append("content", content);
      images.forEach((img) => formData.append("images", img));

      const res = await fetch(`${API}/api/vine/posts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const newPost = await res.json();
      setPosts((prev) => [newPost, ...prev]);
      setContent("");
      setImages([]);
      setPreviews([]);
    } catch (err) {
      console.error("Post creation error", err);
    }
  };
  useEffect(() => {
    if (!targetPostId) return;
    if (!posts.length) return;
  
    const el = document.getElementById(`post-${targetPostId}`);
    if (!el) return;
  
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [posts, targetPostId]);
  
  

  // ── Render ──────────────────────────────────────
  return (
    <div className="vine-feed-container">
      {/* Top Navigation Bar */}
      <nav className="vine-nav-top">
                    <h2
                onClick={() => {
                  document.documentElement.scrollTo({
                    top: 0,
                    behavior: "smooth",
                  });
                  document.body.scrollTo({
                    top: 0,
                    behavior: "smooth",
                  });
                }}
                style={{ cursor: "pointer" }}
              >
                🌱 Vine
              </h2>


        <div className="notif-bell" onClick={() => navigate("/vine/notifications")}>
          🔔
          {unread > 0 && <span className="notif-badge">{unread}</span>}
        </div>

        <div className="nav-right">
          {myUsername && (
            <button
              className="nav-btn profile-btn"
              onClick={() => navigate(`/vine/profile/${myUsername}`)}
            >
              Profile
            </button>
          )}

          <button
            className="nav-btn logout-btn"
            onClick={() => {
              localStorage.removeItem("vine_token");
              navigate("/vine/login");
            }}
          >
            Logout
          </button>
        </div>
      </nav>

      <div className="vine-content-wrapper">
        {/* Quick Actions Bar */}
        <div className="vine-dm-bar">
          <input
            className="vine-search"
            placeholder="Search users..."
            onFocus={() => navigate("/vine/search")}
            readOnly
          />

          <button className="discover-btn" onClick={() => navigate("/vine/suggestions")}>
            👥 Discover
          </button>

          <button
            className="messages-btn"
            onClick={() => navigate("/vine/dms")}
            style={{ position: "relative" }}
          >
            💬 DM
            {unreadDMs > 0 && <span className="dm-unread-badge">{unreadDMs}</span>}
          </button>
        </div>

        {/* Create Post Box */}
        <div className="vine-create-box">
        <textarea
                      className={`create-textarea ${
                        content.length > 0 && content.length < 120 ? "big-text" : ""
                      }`}
                      placeholder="What's happening?"
                      value={content}
                      maxLength={2000}
                      onChange={(e) => setContent(e.target.value)}
                      onKeyDown={(e) => {
                        // Ctrl/Cmd + Enter to post
                        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                          handleCreatePost();
                        }
                      }}
                    />

          <div className="create-footer">
            <div className="greeting">
              {getGreeting()}, <span className="name">{myUsername}</span>
            </div>

            <div className="right-actions">
              <span className="char-count">{content.length}/2000</span>

              <label className="image-picker">
                📷 Add photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files);
                    if (!files.length) return;
                    setImages(files);
                    setPreviews(files.map((f) => URL.createObjectURL(f)));
                  }}
                />
              </label>

              {previews.length > 0 && (
                <div className="preview-strip">
                  {previews.map((src, i) => (
                    <div key={i} className="preview-tile">
                      <img src={src} alt="" />
                      <button
                        className="remove-preview"
                        onClick={() => {
                          setImages(images.filter((_, idx) => idx !== i));
                          setPreviews(previews.filter((_, idx) => idx !== i));
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button className="post-submit-btn" onClick={submitPost}>
                Post
              </button>
            </div>
          </div>
        </div>

        {/* Feed Posts */}
        <div className="vine-posts-list">
          {posts.map((post) => (
            <VinePostCard key={post.feed_id} post={post} />
          ))}

          {posts.length === 0 && <p className="no-posts-hint">No posts yet 🌱</p>}
        </div>
      </div>

      {/* Right Sidebar (currently empty – good place for VineSuggestions later) */}
      <div className="vine-right-sidebar">
        {/* You can add <VineSuggestions /> here if desired */}
      </div>
    </div>
  );
}