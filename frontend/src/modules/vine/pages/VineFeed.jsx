import { useEffect, useState, useRef } from "react";
import heic2any from "heic2any";
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
  const DEFAULT_AVATAR = "/default-avatar.png";

  // User info from localStorage
  let me = {};
  let myUsername = "";
  try {
    const storedUser = JSON.parse(localStorage.getItem("vine_user"));
    me = storedUser || {};
    myUsername = storedUser?.username || "";
  } catch (e) {
    console.error("User parse error", e);
  }
  const isModerator =
    Number(me?.is_admin) === 1 ||
    String(me?.role || "").toLowerCase() === "moderator" ||
    ["vine guardian", "vine_guardian"].includes(
      String(me?.username || "").toLowerCase()
    );

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
  const [suggestedUsers, setSuggestedUsers] = useState([]);
  const [suggestionSlots, setSuggestionSlots] = useState([]);
  const [trendingPosts, setTrendingPosts] = useState([]);
  const [restriction, setRestriction] = useState(null);
  const suggestionSlotsRef = useRef([]);

  const normalizeImageFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    const converted = await Promise.all(
      files.map(async (file) => {
        const isHeic =
          /heic|heif/i.test(file.type) ||
          /\.heic$/i.test(file.name) ||
          /\.heif$/i.test(file.name);
        if (!isHeic) return file;
        try {
          const blob = await heic2any({
            blob: file,
            toType: "image/jpeg",
            quality: 0.9,
          });
          const outBlob = Array.isArray(blob) ? blob[0] : blob;
          return new File(
            [outBlob],
            file.name.replace(/\.(heic|heif)$/i, ".jpg"),
            { type: "image/jpeg" }
          );
        } catch (err) {
          console.warn("HEIC conversion failed, skipping file", err);
          alert("HEIC image could not be converted. Please use JPG/PNG/WebP.");
          return null;
        }
      })
    );
    return converted.filter(Boolean);
  };
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
      const res = await fetch(`${API}/api/vine/posts`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      setPosts(data);
      // Build suggestion slots only once per session to avoid jumping
      if (suggestionSlotsRef.current.length === 0 && data.length > 0) {
        const nextSlots = [];
        const first = Math.min(6, data.length);
        let idx = first;
        while (idx < data.length && nextSlots.length < 3) {
          nextSlots.push(idx);
          idx += 12;
        }
        suggestionSlotsRef.current = nextSlots;
        setSuggestionSlots(nextSlots);
      }
    } catch (err) {
      console.error("Load feed error", err);
    }
  };

  const loadSuggestions = async () => {
    try {
      const res = await fetch(`${API}/api/vine/users/new`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) setSuggestedUsers(data);
      else setSuggestedUsers([]);
    } catch {
      setSuggestedUsers([]);
    }
  };

  const loadTrending = async () => {
    try {
      const res = await fetch(`${API}/api/vine/posts/trending?limit=3`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) setTrendingPosts(data);
      else setTrendingPosts([]);
    } catch {
      setTrendingPosts([]);
    }
  };

  const loadRestrictions = async () => {
    try {
      const res = await fetch(`${API}/api/vine/users/me/restrictions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.suspended) {
        setRestriction(data.suspension || { reason: "Moderation restriction active" });
      } else {
        setRestriction(null);
      }
    } catch {
      setRestriction(null);
    }
  };
  

  useEffect(() => {
    loadFeed(); // initial load
    loadSuggestions();
    loadTrending();
    loadRestrictions();

    const interval = setInterval(loadFeed, 5000); // refresh every 5s

    return () => clearInterval(interval);
  }, []);

  const submitAppeal = async () => {
    const message = window.prompt("Appeal to Guardian: explain your case");
    if (!message || !message.trim()) return;
    const res = await fetch(`${API}/api/vine/moderation/appeals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: message.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || "Appeal failed");
      return;
    }
    alert("Appeal sent to Guardian");
  };

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

  useEffect(() => {
    document.title = "Vine — Feed";
  }, []);

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
  
    // 🔥 clear URL params after scroll
    navigate("/vine/feed", { replace: true });
  }, [posts, targetPostId]);
  

  // ── Render ──────────────────────────────────────
  return (
    <div className="vine-feed-container">
      {/* Top Navigation Bar */}
      <nav className="vine-nav-top">
        <div className="vine-nav-row">
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
          <button
            className="nav-btn help-btn desktop-only"
            onClick={() => navigate("/vine/help")}
          >
            Help
          </button>
          {isModerator && (
            <button
              className="nav-btn profile-btn desktop-only"
              onClick={() => navigate("/vine/guardian/analytics")}
            >
              Guardian
            </button>
          )}
          <input
            className="vine-search nav-search desktop-only"
            placeholder="Search users..."
            onFocus={() => navigate("/vine/search")}
            readOnly
          />

          <button
            className="nav-btn logout-btn mobile-only"
            onClick={() => {
              localStorage.removeItem("vine_token");
              navigate("/vine/login");
            }}
          >
            Logout
          </button>

          {myUsername && (
            <button
              className="nav-btn profile-btn"
              onClick={() => navigate(`/vine/profile/${myUsername}`)}
            >
              Profile
            </button>
          )}
        </div>
        </div>

        {/* Quick Actions Bar (inside nav) */}
        <div className="vine-dm-bar">
          <button
            className="messages-btn"
            onClick={() => navigate("/vine/dms")}
            style={{ position: "relative" }}
          >
            💬 DM
            {unreadDMs > 0 && <span className="dm-unread-badge">{unreadDMs}</span>}
          </button>

          <button className="discover-btn" onClick={() => navigate("/vine/suggestions")}>
            👥 Discover
          </button>

          <button className="discover-btn mobile-only" onClick={() => navigate("/vine/help")}>
            ❓ Help
          </button>

          {isModerator && (
            <button
              className="discover-btn"
              onClick={() => navigate("/vine/guardian/analytics")}
            >
              Guardian
            </button>
          )}

          <input
            className="vine-search dm-search mobile-only"
            placeholder="Search users..."
            onFocus={() => navigate("/vine/search")}
            readOnly
          />

          <button
            className="nav-btn logout-btn desktop-only"
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
        {restriction && (
          <div className="suspension-banner">
            <div>
              Account restricted from likes/comments.
              {restriction.reason ? ` Reason: ${restriction.reason}` : ""}
            </div>
            <button onClick={submitAppeal}>Appeal to Guardian</button>
          </div>
        )}

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

              <label className="image-picker media-icon-picker" title="Add photo or video">
                <span className="media-icon" aria-hidden="true">📷</span>
                <span className="media-icon" aria-hidden="true">🎥</span>
                <input
                  type="file"
                  accept="image/*,video/*,.heic,.heif"
                  multiple
                  hidden
                  onChange={async (e) => {
                    const files = await normalizeImageFiles(e.target.files);
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
                      {images[i]?.type?.startsWith("video/") ? (
                        <video src={src} muted playsInline preload="metadata" />
                      ) : (
                        <img src={src} alt="" />
                      )}
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

        {trendingPosts.length > 0 && (
          <div className="vine-trending">
            <div className="trending-header">🔥 Trending on Vine</div>
            <div className="trending-track">
              {trendingPosts.map((p) => {
                const avatarSrc = p.avatar_url
                  ? (p.avatar_url.startsWith("http") ? p.avatar_url : `${API}${p.avatar_url}`)
                  : DEFAULT_AVATAR;
                const snippet =
                  (p.content || "").trim().length > 0
                    ? (p.content.length > 90 ? `${p.content.slice(0, 90)}…` : p.content)
                    : "Photo post";
                return (
                  <div
                    key={`trend-${p.id}`}
                    className="trending-card"
                    onClick={() => navigate(`/vine/feed?post=${p.id}`)}
                  >
                    <div className="trending-top">
                          <img
                            src={avatarSrc}
                            alt={p.username}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/vine/profile/${p.username}`);
                            }}
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_AVATAR;
                            }}
                          />
                      <div>
                        <div className="trending-name">
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/vine/profile/${p.username}`);
                            }}
                          >
                            {p.display_name || p.username}
                          </span>
                          {(Number(p.is_verified) === 1 || ["vine guardian","vine_guardian"].includes(String(p.username || "").toLowerCase())) && (
                            <span className={`verified ${["vine guardian","vine_guardian"].includes(String(p.username || "").toLowerCase()) ? "guardian" : ""}`}>
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
                        <div className="trending-handle">@{p.username}</div>
                      </div>
                    </div>
                    <div className="trending-snippet">{snippet}</div>
                    <div className="trending-stats">
                      ❤️ {p.like_count || 0} · 💬 {p.comment_count || 0}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Feed Posts */}
        <div className="vine-posts-list">
          {posts.map((post, index) => (
            <div key={post.feed_id || `post-${post.id}`}>
              {suggestionSlots.includes(index) && suggestedUsers.length > 0 && (
                <div className="vine-suggest-carousel">
                  <div className="suggest-carousel-header">
                    Viners you may want to follow
                  </div>
                  <div className="suggest-carousel-track">
                    {suggestedUsers.map((u) => {
                      const avatarSrc = u.avatar_url
                        ? (u.avatar_url.startsWith("http") ? u.avatar_url : `${API}${u.avatar_url}`)
                        : DEFAULT_AVATAR;
                      return (
                        <div
                          key={u.id}
                          className="suggest-card"
                          onClick={() => navigate(`/vine/profile/${u.username}`)}
                        >
                          <img
                            src={avatarSrc}
                            alt={u.username}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/vine/profile/${u.username}`);
                            }}
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_AVATAR;
                            }}
                          />
                          <div className="suggest-name">
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/vine/profile/${u.username}`);
                              }}
                            >
                              {u.display_name || u.username}
                            </span>
                            {(Number(u.is_verified) === 1 || ["vine guardian","vine_guardian"].includes(String(u.username || "").toLowerCase())) && (
                              <span className={`verified ${["vine guardian","vine_guardian"].includes(String(u.username || "").toLowerCase()) ? "guardian" : ""}`}>
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
                          <div className="suggest-handle">@{u.username}</div>
                          <button
                            className="suggest-follow"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const res = await fetch(`${API}/api/vine/users/${u.id}/follow`, {
                                method: "POST",
                                headers: { Authorization: `Bearer ${token}` },
                              });
                              if (res.ok) {
                                setSuggestedUsers((prev) => prev.filter((p) => p.id !== u.id));
                              }
                            }}
                          >
                            Follow
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <VinePostCard post={post} />
            </div>
          ))}

          {posts.length > 0 && <p className="no-more-posts">No more posts</p>}
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
