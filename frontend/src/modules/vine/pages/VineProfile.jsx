import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import "./VineProfile.css";
import VinePostCard from "./VinePostCard";
import ImageCarousel from "./ImageCarousel";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const ORIGIN = API.replace(/\/api$/, "");

// ────────────────────────────────────────────────
//  HELPERS
// ────────────────────────────────────────────────

const formatRelativeTime = (date) => {
  const diff = Math.floor((Date.now() - new Date(date)) / 1000);

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};


// ────────────────────────────────────────────────
//  MAIN PROFILE COMPONENT
// ────────────────────────────────────────────────

export default function VineProfile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const token = localStorage.getItem("vine_token");

  // Current user ID from JWT
  let currentUserId = null;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      currentUserId = payload.id;
    } catch (e) {
      console.error("JWT Error");
    }
  }

  // ── State ───────────────────────────────────────
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("posts");
  const [isEditing, setIsEditing] = useState(false);
  const [tempBio, setTempBio] = useState("");
  const [tempDisplayName, setTempDisplayName] = useState("");
  const [tempLocation, setTempLocation] = useState("");
  const [tempWebsite, setTempWebsite] = useState("");
  const [isFollowing, setIsFollowing] = useState(false);

  // Media uploads & viewers
  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);
  const [bannerUrl, setBannerUrl] = useState(null);
  const [bannerViewerOpen, setBannerViewerOpen] = useState(false);
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [bannerOffset, setBannerOffset] = useState(0);
  const [isAdjustingBanner, setIsAdjustingBanner] = useState(false);
  const dragStartY = useRef(0);
  const startOffset = useRef(0);

  // Tabs content
  const [likedPosts, setLikedPosts] = useState([]);
  const [likesLoaded, setLikesLoaded] = useState(false);
  const [photoPosts, setPhotoPosts] = useState([]);
  const [photosLoaded, setPhotosLoaded] = useState(false);

  // Photo viewer + interactions
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [activeImageSet, setActiveImageSet] = useState(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [viewerPostId, setViewerPostId] = useState(null);
  const [viewerLiked, setViewerLiked] = useState(false);
  const [viewerLikeCount, setViewerLikeCount] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [viewerComments, setViewerComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [openReplies, setOpenReplies] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Derived values
  const userObj = profile?.user || profile || {};
  const resolvedUsername = userObj.username || "user";
  const displayName = userObj.display_name || resolvedUsername;
  const avatarUrl = userObj.avatar_url;
  const isMe = profile && Number(currentUserId) === Number(userObj.id);

  const viewerCommentCount = viewerComments.length;
  const topLevelComments = viewerComments.filter((c) => !c.parent_comment_id);
  const repliesByParent = viewerComments.reduce((acc, c) => {
    if (c.parent_comment_id) {
      acc[c.parent_comment_id] = acc[c.parent_comment_id] || [];
      acc[c.parent_comment_id].push(c);
    }
    return acc;
  }, {});
  const currentPost = photoPosts.find(p => p.id === viewerPostId);

  // ── Data Fetching ───────────────────────────────

  const loadProfile = async () => {
    try {
      const res = await fetch(`${API}/api/vine/users/${encodeURIComponent(username)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("User not found");
      const data = await res.json();
      setProfile(data);
      setTempBio(data?.user?.bio || data?.bio || "");
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchLikes = async () => {
    if (!username || likesLoaded) return;
    try {
      const res = await fetch(`${API}/api/vine/users/${encodeURIComponent(username)}/likes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load likes");
      const data = await res.json();
      setLikedPosts(data || []);
      setLikesLoaded(true);
    } catch (err) {
      console.error("Fetch likes error:", err);
    }
  };

  const fetchPhotos = async () => {
    if (!username || photosLoaded) return;
    try {
      const res = await fetch(`${API}/api/vine/users/${encodeURIComponent(username)}/photos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load photos");
      const data = await res.json();
      setPhotoPosts(data || []);
      setPhotosLoaded(true);
    } catch (err) {
      console.error("Fetch photos error:", err);
    }
  };

  const fetchComments = async () => {
    if (!viewerPostId) return;
    try {
      const res = await fetch(`${API}/api/vine/posts/${viewerPostId}/comments`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setViewerComments(data || []);
    } catch (err) {
      console.error("Fetch comments error:", err);
    }
  };

  // ── Effects ─────────────────────────────────────

  useEffect(() => {
    if (username) loadProfile();
  }, [username]);

  useEffect(() => {
    if (profile?.user?.is_following !== undefined) {
      setIsFollowing(Boolean(profile.user.is_following));
    }
  }, [profile]);

  useEffect(() => {
    if (userObj?.banner_url) setBannerUrl(userObj.banner_url);
  }, [userObj]);

  useEffect(() => {
    if (activeTab === "likes") fetchLikes();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "photos") fetchPhotos();
  }, [activeTab]);

  useEffect(() => {
    if (commentsOpen && viewerPostId) fetchComments();
  }, [commentsOpen, viewerPostId]);

  useEffect(() => {
    if (bannerViewerOpen || avatarViewerOpen || photoViewerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [bannerViewerOpen, avatarViewerOpen, photoViewerOpen]);

  // ── Handlers ────────────────────────────────────

  const toggleViewerLike = async () => {
    if (!viewerPostId) return;
    const nextLiked = !viewerLiked;

    // Optimistic update
    setViewerLiked(nextLiked);
    setViewerLikeCount((c) => c + (nextLiked ? 1 : -1));

    // Update source of truth (photoPosts)
    setPhotoPosts((prev) =>
      prev.map((p) =>
        p.id === viewerPostId
          ? { ...p, user_liked: nextLiked, like_count: (p.like_count || 0) + (nextLiked ? 1 : -1) }
          : p
      )
    );

    try {
      await fetch(`${API}/api/vine/posts/${viewerPostId}/like`, {
        method: nextLiked ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error("Toggle like failed", err);
      // Rollback
      setViewerLiked(!nextLiked);
      setViewerLikeCount((c) => c + (nextLiked ? -1 : 1));
      setPhotoPosts((prev) =>
        prev.map((p) =>
          p.id === viewerPostId
            ? { ...p, user_liked: !nextLiked, like_count: (p.like_count || 0) + (nextLiked ? -1 : 1) }
            : p
        )
      );
    }
  };

  const handleUpdateBio = async () => {
    await fetch(`${API}/api/vine/users/update-profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        display_name: tempDisplayName,
        bio: tempBio,
        location: tempLocation,
        website: tempWebsite,
      }),
    });
    setIsEditing(false);
    loadProfile();
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("avatar", file);

    const res = await fetch(`${API}/api/vine/users/avatar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const data = await res.json();
    if (res.ok) {
      setProfile((prev) => ({
        ...prev,
        user: prev.user ? { ...prev.user, avatar_url: data.avatar_url } : prev,
        avatar_url: !prev.user ? data.avatar_url : prev.avatar_url,
      }));
      loadProfile();
    }
  };

  const handleBannerUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("banner", file);

    try {
      const res = await fetch(`${API}/api/vine/users/banner`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setBannerUrl(data.banner_url);
      } else {
        alert(data.error || "Banner upload failed");
      }
    } catch (err) {
      console.error("Banner upload error:", err);
    }
  };

  const startDrag = (e) => {
    dragStartY.current = e.touches ? e.touches[0].clientY : e.clientY;
    startOffset.current = bannerOffset;
  };

  const onDrag = (e) => {
    if (!isAdjustingBanner) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const delta = y - dragStartY.current;
    setBannerOffset(startOffset.current + delta);
  };

  const stopDrag = async () => {
    if (!isAdjustingBanner) return;
    await fetch(`${API}/api/vine/users/banner-position`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ offsetY: bannerOffset }),
    });
    setIsAdjustingBanner(false);
  };

  const handleMessage = async () => {
    try {
      const res = await fetch(`${API}/api/dms/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: userObj.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Cannot start conversation");
        return;
      }
      navigate(`/vine/dms/${data.conversationId}`);
    } catch (err) {
      console.error("Start DM error:", err);
    }
  };

  const toggleReplies = (commentId) => {
    setOpenReplies((prev) => ({
      ...prev,
      [commentId]: !prev[commentId],
    }));
  };

  // ── Render ──────────────────────────────────────

  if (error) {
    return (
      <div className="error-screen">
        ❌ {error} <button onClick={() => navigate(-1)}>Go Back</button>
      </div>
    );
  }

  if (!profile) {
    return <div className="skeleton-wrapper">...Loading...</div>;
  }

  return (
    <div className="vine-profile-wrapper">
      {/* Top sticky bar */}
      <div className="vine-profile-topbar">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <div className="topbar-info">
          <span className="profile-title">{displayName}</span>
          <span className="post-count-mini">{profile?.posts?.length || 0} Posts</span>
        </div>
      </div>

      {/* Banner */}
      <div className="vine-profile-banner-wrapper">
        <div
          className={`vine-profile-banner ${isMe ? "uploadable" : ""}`}
          onClick={() => {
            if (bannerUrl && !isAdjustingBanner) setBannerViewerOpen(true);
          }}
        >
          {isMe && (
            <input
              ref={bannerInputRef}
              type="file"
              hidden
              accept="image/*"
              onChange={handleBannerUpload}
            />
          )}

          {isMe && (
            <div className="banner-action-buttons">
              <button
                className="banner-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  bannerInputRef.current?.click();
                }}
              >
                Change
              </button>
              {bannerUrl && (
                <button
                  className="banner-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAdjustingBanner((prev) => !prev);
                  }}
                >
                  {isAdjustingBanner ? "Save" : "Adjust"}
                </button>
              )}
            </div>
          )}

          {bannerUrl ? (
            <img src={bannerUrl}
              alt="banner"
              style={{
                objectPosition: `center calc(50% + ${bannerOffset}px)`,
                cursor: isAdjustingBanner ? "grab" : "pointer",
              }}
              onMouseDown={isAdjustingBanner ? startDrag : undefined}
              onMouseMove={onDrag}
              onMouseUp={stopDrag}
              onMouseLeave={stopDrag}
              onTouchStart={isAdjustingBanner ? startDrag : undefined}
              onTouchMove={onDrag}
              onTouchEnd={stopDrag}
            />
          ) : (
            <div className="default-banner" />
          )}

          <div className="banner-overlay" />
        </div>
      </div>

      {/* Fullscreen banner viewer */}
      {bannerViewerOpen && bannerUrl && (
        <div className="image-viewer-overlay" onClick={() => setBannerViewerOpen(false)}>
          <button className="viewer-close" onClick={() => setBannerViewerOpen(false)}>
            ✕
          </button>
          <img
            src={bannerUrl}
            className="image-viewer-img"
            alt="banner fullscreen"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Avatar fullscreen viewer */}
      {avatarViewerOpen && avatarUrl && (
        <div className="image-viewer-overlay" onClick={() => setAvatarViewerOpen(false)}>
          <button className="viewer-close" onClick={() => setAvatarViewerOpen(false)}>
            ✕
          </button>
          <img
            src={avatarUrl}
            className="image-viewer-img"
            alt="avatar fullscreen"
            onClick={(e) => e.stopPropagation()}
            style={{ borderRadius: "50%" }}
          />
        </div>
      )}

      {/* Header row – Avatar + Buttons */}
      <div className="header-top-row">
        <div className="avatar-wrapper">
          <div
            className="avatar-circle"
            onClick={() => {
              if (isMe) {
                avatarInputRef.current?.click();   // 📷 you → change avatar
              } else if (avatarUrl) {
                setAvatarViewerOpen(true);         // 👀 others → fullscreen
              }
            }}
            
          >
            {avatarUrl ? (
             <img src={avatarUrl} alt="avatar" />

            ) : (
              <div className="avatar-placeholder">{resolvedUsername[0].toUpperCase()}</div>
            )}

            {isMe && (
              <div
                className="avatar-camera-overlay"
                onClick={(e) => {
                  e.stopPropagation();
                  avatarInputRef.current?.click();
                }}
              >
                📷
              </div>
            )}
          </div>

          {isMe && (
            <input
              ref={avatarInputRef}
              type="file"
              hidden
              accept="image/*"
              onChange={handleAvatarUpload}
            />
          )}
        </div>
        <div className="profile-action-buttons">
                      {isMe ? (
                        <>
                          <button
                            className="edit-profile-btn"
                            onClick={() => (isEditing ? handleUpdateBio() : setIsEditing(true))}
                          >
                            {isEditing ? "Save Profile" : "Edit Profile"}
                          </button>

                          <button
                            className="profile-settings-btn"
                            onClick={() => setSettingsOpen(true)}
                            title="Settings"
                          >
                            ⚙️
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="follow-btn"
                            onClick={async () => {
                              await fetch(`${API}/api/vine/users/${userObj.id}/follow`, {
                                method: isFollowing ? "DELETE" : "POST",
                                headers: { Authorization: `Bearer ${token}` },
                              });
                              setIsFollowing(!isFollowing);
                              loadProfile();
                            }}
                          >
                            {isFollowing ? "Unfollow" : "Follow"}
                          </button>

                          {isFollowing && (
                            <button className="message-btn" onClick={handleMessage}>
                              📧 DM
                            </button>
                          )}
                        </>
                      )}
                              </div>

        
                        </div>

      {/* Profile info / edit form */}
      <div className="profile-meta">
        {isEditing ? (
          <div className="edit-profile-form">
            <input
              className="edit-input"
              placeholder="Display name"
              value={tempDisplayName}
              onChange={(e) => setTempDisplayName(e.target.value)}
            />

            <div className="edit-row">
              <input
                className="edit-input"
                placeholder="Location"
                value={tempLocation}
                onChange={(e) => setTempLocation(e.target.value)}
              />
              <input
                className="edit-input"
                placeholder="Website"
                value={tempWebsite}
                onChange={(e) => setTempWebsite(e.target.value)}
              />
            </div>

            <div className="edit-bio-block">
              <label className="edit-label">Bio</label>
              <textarea
                className="bio-edit-input"
                value={tempBio}
                onChange={(e) => setTempBio(e.target.value)}
                maxLength={160}
                placeholder="Tell people about yourself"
              />
              <span className="char-count">{tempBio.length}/160</span>
            </div>
          </div>
        ) : (
          <>
            <h2 className="profile-name">
              {displayName}
              {Number(userObj?.is_verified) === 1 && <span className="verified">✓</span>}
            </h2>

            <p className="handle">@{resolvedUsername}</p>

            <p className="bio">{userObj?.bio || "No bio yet 🌱"}</p>

            <div className="profile-extra">
  {userObj?.location && (
    <span className="profile-field">📍 {userObj.location}</span>
  )}

  {userObj?.created_at && (
    <span className="join-date">
      📅 Joined{" "}
      {new Date(userObj.created_at).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })}
    </span>
  )}

  {userObj?.last_active_at && (
    <span className="last-active">
      🟢 Last active {formatRelativeTime(userObj.last_active_at)}
    </span>
  )}
</div>


            <div className="profile-stats">
              <span onClick={() => navigate(`/vine/${resolvedUsername}/following`)}>
                <strong>{profile?.user?.following_count || 0}</strong> Following
              </span>
              <span onClick={() => navigate(`/vine/${resolvedUsername}/followers`)}>
                <strong>{profile?.user?.follower_count || 0}</strong> Followers
              </span>
            </div>
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="vine-profile-tabs">
        {["posts", "likes", "photos"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={activeTab === tab ? "tab active" : "tab"}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="vine-profile-tab-content">
        {activeTab === "posts" && (
          <div className="vine-profile-posts">
            {profile?.posts?.length > 0 ? (
  profile.posts.map((post) => (
    <VinePostCard
      key={post.feed_id || `post-${post.id}`}
      post={post}
      isMe={isMe}
      onTogglePin={(postId, isPinned) => {
        setProfile(prev => ({
          ...prev,
          posts: prev.posts.map(p =>
            p.id === postId
              ? { ...p, is_pinned: isPinned ? 0 : 1 }
              : p
          )
        }));
      }}
    />
  ))
) : (
  <div className="empty-state">No posts yet</div>
)}
          </div>
        )}

        {activeTab === "likes" && (
          <div className="profile-tab-content">
            {likedPosts.length === 0 ? (
              <div className="empty-state">🌱 No liked posts yet</div>
            ) : (
              likedPosts.map((post) => (
                <VinePostCard
                  key={post.feed_id || `like-${post.id}`}
                  post={post}
                  currentUserId={currentUserId}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "photos" && (
          <div className="photos-grid">
            {photoPosts.length === 0 ? (
              <div className="empty-state">📸 No photos yet</div>
            ) : (
              photoPosts.map((post) => {
                let imgs = [];
                try {
                  imgs = JSON.parse(post.image_url);
                } catch {
                  imgs = [post.image_url];
                }
                const coverImage = imgs[0];

                return (
                  <div
                    key={post.feed_id || `photo-${post.id}`}
                    className="photo-tile"
                    onClick={() => {
                      setActiveImageSet(imgs);
                      setActiveImageIndex(0);
                      setViewerPostId(post.id);
                      setViewerLiked(Boolean(post.user_liked));
                      setViewerLikeCount(post.like_count || 0);
                      setPhotoViewerOpen(true);
                    }}
                  >
                    <img src={coverImage} alt="" />
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Photo fullscreen viewer */}
      {photoViewerOpen && (
        <div className="image-viewer-overlay" onClick={() => setPhotoViewerOpen(false)}>
          <button className="viewer-close" onClick={() => setPhotoViewerOpen(false)}>
            ✕
          </button>

          <img src={activeImageSet?.[activeImageIndex]} 

            className="image-viewer-img"
            onClick={(e) => e.stopPropagation()}
            alt=""
          />

          {/* Like button in viewer */}
          <button
            className={`viewer-like-btn ${viewerLiked ? "liked" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleViewerLike();
            }}
          >
            {viewerLiked ? "❤️" : "🤍"}
            {viewerLikeCount > 0 && <span className="like-count">{viewerLikeCount}</span>}
          </button>

         {/* Comment button in viewer */}
              <button
  className="viewer-comment-btn"
  onClick={(e) => {
    e.stopPropagation();
    setCommentsOpen(true);
  }}
>
  💬
  {currentPost?.comment_count > 0 && (
    <span className="comment-count">
      {currentPost.comment_count}
    </span>
  )}
              </button>

          {/* Comments panel (inside viewer) */}
          {commentsOpen && (
            <div className="photo-comments-panel" onClick={(e) => e.stopPropagation()}>
              <div className="comments-header">
                <span>Comments</span>
                <button onClick={() => setCommentsOpen(false)}>✕</button>
              </div>

              <div className="comments-list">
                {topLevelComments.length === 0 ? (
                  <div className="empty-state">No comments yet</div>
                ) : (
                  topLevelComments.map((c) => (
                    <div key={c.id} className="comment-item">
                      <div className="comment-main">
                      <img src={c.avatar_url} className="comment-avatar" alt="" />


                        <div className="comment-body">
                          <span className="comment-username">{c.display_name || c.username}</span>
                          <p className="comment-text">{c.content}</p>

                          <div className="comment-meta">
                            <span className="comment-time">{formatRelativeTime(c.created_at)}</span>

                            <button
                              className={`comment-like ${c.user_liked ? "liked" : ""}`}
                              onClick={async () => {
                                const res = await fetch(`${API}/api/vine/comments/${c.id}/like`, {
                                  method: "POST",
                                  headers: { Authorization: `Bearer ${token}` },
                                });
                                const data = await res.json();
                                setViewerComments((prev) =>
                                  prev.map((cm) =>
                                    cm.id === c.id
                                      ? { ...cm, like_count: data.likes, user_liked: data.user_liked }
                                      : cm
                                  )
                                );
                              }}
                            >
                              ❤️ {c.like_count || 0}
                            </button>

                            <button className="reply-btn" onClick={() => setReplyTo(c.id)}>
                              Reply
                            </button>

                            {c.user_id === currentUserId && (
                              <button
                                className="comment-delete-btn"
                                onClick={async () => {
                                  await fetch(`${API}/api/vine/comments/${c.id}`, {
                                    method: "DELETE",
                                    headers: { Authorization: `Bearer ${token}` },
                                  });
                                  await fetchComments();
                                  setPhotoPosts((prev) =>
                                    prev.map((p) =>
                                      p.id === viewerPostId
                                        ? {
                                            ...p,
                                            comment_count: Math.max((p.comment_count || 1) - 1, 0),
                                          }
                                        : p
                                    )
                                  );
                                }}
                              >
                                🗑️
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {repliesByParent[c.id]?.length > 0 && (
                        <button
                          className="toggle-replies-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleReplies(c.id);
                          }}
                        >
                          {openReplies[c.id]
                            ? "Hide replies"
                            : `View replies (${repliesByParent[c.id].length})`}
                        </button>
                      )}

                      {openReplies[c.id] && (
                        <div className="comment-replies">
                          {repliesByParent[c.id].map((r) => (
                            <div key={r.id} className="comment-reply">
                              <img src={r.avatar_url}
                                className="comment-avatar small"
                                alt=""
                              />

                              <div className="comment-body">
                                <span className="comment-username">{r.display_name || r.username}</span>
                                <p className="comment-text">{r.content}</p>
                                <span className="comment-time">{formatRelativeTime(r.created_at)}</span>

                                {r.user_id === currentUserId && (
                                  <button
                                    className="comment-delete-btn"
                                    onClick={async () => {
                                      await fetch(`${API}/api/vine/comments/${r.id}`, {
                                        method: "DELETE",
                                        headers: { Authorization: `Bearer ${token}` },
                                      });
                                      await fetchComments();
                                      setPhotoPosts((prev) =>
                                        prev.map((p) =>
                                          p.id === viewerPostId
                                            ? {
                                                ...p,
                                                comment_count: Math.max((p.comment_count || 1) - 1, 0),
                                              }
                                            : p
                                        )
                                      );
                                    }}
                                  >
                                    🗑️
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {replyTo && (
                <div className="replying-to" onClick={(e) => e.stopPropagation()}>
                  Replying to @{viewerComments.find((c) => c.id === replyTo)?.username}
                  <button onClick={() => setReplyTo(null)}>✕</button>
                </div>
              )}

              <form
                className="comment-input-bar"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newComment.trim()) return;

                  try {
                    await fetch(`${API}/api/vine/posts/${viewerPostId}/comments`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                      },
                      body: JSON.stringify({
                        content: newComment,
                        parent_comment_id: replyTo || null,
                      }),
                    });

                    await fetchComments();
                    setPhotoPosts((prev) =>
                      prev.map((p) =>
                        p.id === viewerPostId
                          ? { ...p, comment_count: (p.comment_count || 0) + 1 }
                          : p
                      )
                    );

                    setNewComment("");
                    setReplyTo(null);
                  } catch (err) {
                    console.error("Post comment failed", err);
                  }
                }}
              >
                <input
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment…"
                />
                <button type="submit">Post</button>
              </form>
            </div>
          )}
        </div>
      )}
      
      {settingsOpen && (
  <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
    <div
      className="settings-panel"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="settings-header">
        <h3>Settings</h3>
        <button onClick={() => setSettingsOpen(false)}>✕</button>
      </div>

      {/* 1️⃣ DM Privacy */}
      <div className="settings-item">
        <label>Who can message me</label>
        <select>
          <option value="everyone">Everyone</option>
          <option value="followers">Followers only</option>
          <option value="no_one">No one</option>
        </select>
      </div>

      {/* 2️⃣ Private Profile */}
      <div className="settings-item">
        <label>
          <input type="checkbox" />
          Private profile
        </label>
      </div>

      {/* 3️⃣ Hide like counts */}
      <div className="settings-item">
        <label>
          <input type="checkbox" />
          Hide like counts
        </label>
      </div>

      {/* 4️⃣ Show last active */}
      <div className="settings-item">
        <label>
          <input type="checkbox" />
          Show last active status
        </label>
      </div>

      {/* 5️⃣ Clear pinned post */}
      <div className="settings-item danger">
        <button className="danger-btn">
          Remove pinned post
        </button>
      </div>
    </div>
  </div>
)}

    </div>
  );
}