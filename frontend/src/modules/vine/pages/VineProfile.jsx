import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "./VineProfile.css";
import VinePostCard from "./VinePostCard";
import { useRef } from "react";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineProfile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");

  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("posts");
  
  const [isEditing, setIsEditing] = useState(false);
  const [tempBio, setTempBio] = useState("");
  const [tempDisplayName, setTempDisplayName] = useState("");
  const [tempLocation, setTempLocation] = useState("");
  const [tempWebsite, setTempWebsite] = useState("");
  const [isFollowing, setIsFollowing] = useState(false);
  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);
  const [bannerUrl, setBannerUrl] = useState(null);
  const userObj = profile?.user || profile; 

  // Decode User ID
  let currentUserId = null;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      currentUserId = payload.id;
    } catch (e) { console.error("JWT Error"); }
  }

  const loadProfile = async () => {
    try {
      const res = await fetch(`${API}/api/vine/users/${encodeURIComponent(username)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("User not found");
      const data = await res.json();
      
      setProfile(data);
      // Fallback bio handling
      setTempBio(data?.user?.bio || data?.bio || "");
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => {
    if (userObj?.banner_url) {
      setBannerUrl(userObj.banner_url);
    }
  }, [userObj]);
  useEffect(() => {
    if (username) loadProfile();
  }, [username]);
  useEffect(() => {
    if (profile?.user?.is_following !== undefined) {
      setIsFollowing(Boolean(profile.user.is_following));
    }
  }, [profile]);

  // Defensive check for "isMe"
  const isMe = profile && Number(currentUserId) === Number(profile?.user?.id || profile?.id);

  const handleUpdateBio = async () => {
    await fetch(`${API}/api/vine/users/update-profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        display_name: tempDisplayName,
        bio: tempBio,
        location: tempLocation,
        website: tempWebsite
      })
    });
  
    setIsEditing(false);
    loadProfile();
  };
  
  const handlePostDeleted = (postId) => {
    setProfile(prev => ({
      ...prev,
      posts: prev.posts.filter(p => p.id !== postId)
    }));
  };
  const handleMessage = async () => {
    try {
      const res = await fetch(`${API}/api/dms/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          userId: userObj.id
        })
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
  
  
  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("avatar", file);

    const res = await fetch(`${API}/api/vine/users/avatar`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: formData
    });

    const data = await res.json();
    if (res.ok) {
      setProfile(prev => ({
        ...prev,
        user: prev.user ? { ...prev.user, avatar_url: data.avatar_url } : prev,
        avatar_url: !prev.user ? data.avatar_url : prev.avatar_url
      }));
      loadProfile(); // Sync everything
    }
  };

  if (error) return <div className="error-screen">❌ {error} <button onClick={() => navigate(-1)}>Go Back</button></div>;
  if (!profile) return <div className="skeleton-wrapper">...Loading...</div>;
  const handleBannerUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
  
    const formData = new FormData();
    formData.append("banner", file);
  
    try {
      const res = await fetch(`${API}/api/vine/users/banner`, {

        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
  
      const data = await res.json();
  
      if (!res.ok) {
        alert(data.error || "Banner upload failed");
        return;
      }
  
      // Update UI instantly
      setBannerUrl(data.banner_url);
 
    } catch (err) {
      console.error("Banner upload error:", err);
    }
  };
  
  // REBUST DATA ACCESS - Checks both nested and flat structures
  const resolvedUsername = userObj?.username || "user";
  const displayName = userObj?.display_name || resolvedUsername;
  const avatarUrl = userObj?.avatar_url;
 
  return (
    <div className="vine-profile-wrapper">
      {/* Top Bar */}
      <div className="vine-profile-topbar">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <div className="topbar-info">
          <span className="profile-title">{displayName}</span>
          <span className="post-count-mini">{profile?.posts?.length || 0} Posts</span>
        </div>
      </div>

      {/* Banner */}
      <div
  className={`vine-profile-banner ${isMe ? "uploadable" : ""}`}
  onClick={() => isMe && bannerInputRef.current?.click()}
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

  {bannerUrl ? (
    <img src={`${API}${bannerUrl}`} alt="banner" />
  ) : (
    <div className="default-banner" />
  )}

  <div className="banner-overlay" />
</div>



      {/* Header */}
      <div className="vine-profile-header">

{/* Top row: Avatar + Action button */}
<div className="header-top-row">
<div
  className={`avatar-circle ${isMe ? "uploadable" : ""}`}
  onClick={() => isMe && avatarInputRef.current?.click()}
>
  {isMe && (
    <input
      ref={avatarInputRef}
      type="file"
      hidden
      accept="image/*"
      onChange={handleAvatarUpload}
    />
  )}

  {avatarUrl ? (
    <img src={`${API}${avatarUrl}`} alt="avatar" />
  ) : (
    <div className="avatar-placeholder">
      {resolvedUsername[0].toUpperCase()}
    </div>
  )}
</div>


  {isMe ? (
  <button
    className="edit-profile-btn"
    onClick={() => (isEditing ? handleUpdateBio() : setIsEditing(true))}
  >
    {isEditing ? "Save Profile" : "Edit Profile"}
  </button>
) : (
  <div style={{ display: "flex", gap: "10px" }}>
    <button
      className="follow-btn"
      onClick={async () => {
        await fetch(`${API}/api/vine/users/${userObj.id}/follow`, {
          method: isFollowing ? "DELETE" : "POST",
          headers: { Authorization: `Bearer ${token}` }
        });

        setIsFollowing(!isFollowing);
        loadProfile();
      }}
    >
      {isFollowing ? "Unfollow" : "Follow"}
    </button>

    {isFollowing && (
      <button
        className="message-btn"
        onClick={handleMessage}
      >
        📧 DM
      </button>
    )}
  </div>
)}

</div>

{/* Meta */}
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
  {userObj?.is_verified === 1 && <span className="verified">✓</span>}
</h2>

    <p className="handle">@{resolvedUsername}</p>
    <p className="bio">{userObj?.bio || "No bio yet 🌱"}</p>
  </>
)}

  {/* Bio */}
  

  {/* Extra fields */}
  <div className="profile-extra">
    {userObj?.location && (
      <span className="profile-field">📍 {userObj.location}</span>
    )}

    {userObj?.website && (
      <a
        className="profile-link"
        href={userObj.website}
        target="_blank"
        rel="noreferrer"
      >
        🔗 {userObj.website}
      </a>
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
  </div>

  {/* Stats */}
  <div className="profile-stats">
  <span onClick={() => navigate(`/vine/${resolvedUsername}/following`)}>
    <strong>{profile.user.following_count}</strong> Following
  </span>

  <span onClick={() => navigate(`/vine/${resolvedUsername}/followers`)}>
    <strong>{profile.user.follower_count}</strong> Followers
  </span>
</div>


</div>
</div>

      {/* Tabs */}
      <div className="vine-profile-tabs">
        {["posts", "replies", "likes"].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={activeTab === tab ? "tab active" : "tab"}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="vine-profile-posts">
        {activeTab === "posts" ? (
          profile?.posts?.length > 0 ? (
            profile.posts.map(post => (
              <VinePostCard key={post.feed_id} post={post} />
            ))
          ) : (
            <p className="empty-msg">No posts yet.</p>
          )
        ) : (
          <p className="empty-msg">Coming soon...</p>
        )}
      </div>
    </div>
  );
}