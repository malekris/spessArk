import { useEffect, useState, useRef } from "react";
import heic2any from "heic2any";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import "./VineProfile.css";
import VinePostCard from "./VinePostCard";
import ImageCarousel from "./ImageCarousel";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";
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
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [activeTab, setActiveTab] = useState("posts");
  const [isEditing, setIsEditing] = useState(false);
  const [tempBio, setTempBio] = useState("");
  const [tempDisplayName, setTempDisplayName] = useState("");
  const [tempLocation, setTempLocation] = useState("");
  const [tempWebsite, setTempWebsite] = useState("");
  const [isFollowing, setIsFollowing] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  const updatedTimerRef = useRef(null);

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
  const [savedPosts, setSavedPosts] = useState([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMode, setMoreMode] = useState("me");
  const [isMuting, setIsMuting] = useState(false);
  const [mutedUsers, setMutedUsers] = useState([]);
  const [mutedLoaded, setMutedLoaded] = useState(false);

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
  const [dmPrivacy, setDmPrivacy] = useState("everyone");
  const [privateProfile, setPrivateProfile] = useState(false);
  const [hideLikeCounts, setHideLikeCounts] = useState(false);
  const [showLastActive, setShowLastActive] = useState(true);
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionAnchor, setMentionAnchor] = useState(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [avatarActionOpen, setAvatarActionOpen] = useState(false);
  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [avatarCropSrc, setAvatarCropSrc] = useState(null);
  const [avatarCropScale, setAvatarCropScale] = useState(1);
  const [avatarCropX, setAvatarCropX] = useState(0);
  const [avatarCropY, setAvatarCropY] = useState(0);
  const [avatarCropDragging, setAvatarCropDragging] = useState(false);
  const [avatarCropStart, setAvatarCropStart] = useState({ x: 0, y: 0 });
  const [avatarCropFile, setAvatarCropFile] = useState(null);
  const [avatarCropReady, setAvatarCropReady] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem("vine_theme") === "dark";
    } catch {
      return false;
    }
  });
  const avatarCropRef = useRef(null);
  const avatarCropImgRef = useRef(null);

  // Derived values
  const userObj = profile?.user || profile || {};
  const resolvedUsername = userObj.username || "user";
  const displayName = userObj.display_name || resolvedUsername;
  const avatarUrl = userObj.avatar_url;
  const isMe = profile && Number(currentUserId) === Number(userObj.id);
  const isBlocked = Boolean(profile?.blocked) && !isMe;
  const isBlocking = Boolean(userObj?.is_blocking) && !isMe;
  const isMutingUser = Boolean(userObj?.is_muting) && !isMe;
  const isPrivateLocked = Boolean(profile?.privateLocked) && !isMe;
  const canShowLastActive = userObj.show_last_active !== 0 || isMe;
  const canMessage = !isMe && (
    userObj.dm_privacy === "everyone" ||
    (userObj.dm_privacy === "followers" && isFollowing)
  );

  const viewerCommentCount = viewerComments.length;
  const commentsByParent = viewerComments.reduce((acc, c) => {
    const key = c.parent_comment_id || 0;
    acc[key] = acc[key] || [];
    acc[key].push(c);
    return acc;
  }, {});
  const currentPost = photoPosts.find(p => p.id === viewerPostId);
  const canShowViewerLikes =
    !currentPost?.hide_like_counts ||
    isMe ||
    Number(currentUserId) === Number(currentPost?.user_id);

  // ── Data Fetching ───────────────────────────────

  const loadProfile = async () => {
    try {
      setIsLoadingProfile(true);
      const res = await fetch(`${API}/api/vine/users/${encodeURIComponent(username)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("User not found");
      const data = await res.json();
      setProfile(data);
      setJustUpdated(true);
      if (updatedTimerRef.current) {
        clearTimeout(updatedTimerRef.current);
      }
      updatedTimerRef.current = setTimeout(() => {
        setJustUpdated(false);
      }, 2500);
      try {
        localStorage.setItem(`vine_profile_cache_${username}`, JSON.stringify(data));
      } catch {}
      const userData = data?.user || data || {};
      setTempBio(userData?.bio || "");
      setTempDisplayName(userData?.display_name || "");
      setTempLocation(userData?.location || "");
      setTempWebsite(userData?.website || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoadingProfile(false);
    }
  };

  useEffect(() => {
    if (!userObj?.id) return;
    setDmPrivacy(userObj.dm_privacy || "everyone");
    setPrivateProfile(Boolean(userObj.is_private));
    setHideLikeCounts(Boolean(userObj.hide_like_counts));
    setShowLastActive(userObj.show_last_active !== 0);
  }, [userObj?.id]);

  const saveSettings = async (next) => {
    try {
      const res = await fetch(`${API}/api/vine/users/me/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Settings update failed:", data?.message);
        return;
      }
      if (data?.user) {
        setProfile((prev) =>
          prev
            ? { ...prev, user: { ...prev.user, ...data.user } }
            : prev
        );
      }
    } catch (err) {
      console.error("Settings update error:", err);
    }
  };

  const changePassword = async () => {
    setPasswordMsg("");
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMsg("Please fill in all password fields.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg("New passwords do not match.");
      return;
    }
    try {
      const res = await fetch(`${API}/api/vine/users/me/change-password`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordMsg(data?.message || "Password update failed.");
        return;
      }
      setPasswordMsg("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordMsg("Password update failed.");
    }
  };

  const requestVerification = async () => {
    setVerifyMsg("");
    if (!verifyEmail) {
      setVerifyMsg("Please enter your email.");
      return;
    }
    try {
      const res = await fetch(`${API}/api/vine/users/me/verify-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: verifyEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyMsg(data?.message || "Failed to send verification code.");
        return;
      }
      setVerifyMsg("Verification code sent. Check your email.");
    } catch (err) {
      setVerifyMsg("Failed to send verification code.");
    }
  };

  const confirmVerification = async () => {
    setVerifyMsg("");
    if (!verifyCode) {
      setVerifyMsg("Please enter the code.");
      return;
    }
    try {
      const res = await fetch(`${API}/api/vine/users/me/verify-email-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: verifyCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyMsg(data?.message || "Verification failed.");
        return;
      }
      setVerifyMsg("Email verified. Checkmark unlocked.");
      setVerifyCode("");
      setProfile((prev) =>
        prev ? { ...prev, user: { ...prev.user, is_verified: 1 } } : prev
      );
    } catch (err) {
      setVerifyMsg("Verification failed.");
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

  const fetchSaved = async () => {
    if (!username || savedLoaded) return;
    try {
      const res = await fetch(`${API}/api/vine/users/${encodeURIComponent(username)}/bookmarks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load bookmarks");
      const data = await res.json();
      setSavedPosts(data || []);
      setSavedLoaded(true);
    } catch (err) {
      console.error("Fetch bookmarks error:", err);
    }
  };

  const fetchMutedUsers = async () => {
    if (mutedLoaded) return;
    try {
      const res = await fetch(`${API}/api/vine/users/me/mutes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setMutedUsers(Array.isArray(data) ? data : []);
      setMutedLoaded(true);
    } catch (err) {
      console.error("Fetch mutes error:", err);
    }
  };

  const handleDeletePost = (postId) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const nextPosts = (prev.posts || []).filter((p) => p.id !== postId);
      return { ...prev, posts: nextPosts };
    });
    setLikedPosts((prev) => prev.filter((p) => p.id !== postId));
    setPhotoPosts((prev) => prev.filter((p) => p.id !== postId));
    if (viewerPostId === postId) {
      setPhotoViewerOpen(false);
      setViewerPostId(null);
    }
  };

  const clearPinnedPost = async () => {
    try {
      const pinned = (profile?.posts || []).find((p) => Number(p.is_pinned) === 1);
      if (!pinned) {
        alert("No pinned post found.");
        return;
      }
      const res = await fetch(`${API}/api/vine/posts/${pinned.id}/pin`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.message || "Failed to remove pinned post");
        return;
      }
      setProfile((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          posts: (prev.posts || []).map((p) =>
            p.id === pinned.id ? { ...p, is_pinned: 0 } : p
          ),
        };
      });
    } catch (err) {
      console.error("Remove pinned post failed", err);
      alert("Failed to remove pinned post");
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
    if (!username) return;
    try {
      const cached = localStorage.getItem(`vine_profile_cache_${username}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        setProfile(parsed);
      }
    } catch {}
    loadProfile();
    return () => {
      if (updatedTimerRef.current) {
        clearTimeout(updatedTimerRef.current);
      }
    };
  }, [username]);

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
    const name = displayName || username || "Profile";
    document.title = `Vine — ${name}`;
  }, [displayName, username]);

  useEffect(() => {
    document.documentElement.classList.toggle("theme-dark", darkMode);
    try {
      localStorage.setItem("vine_theme", darkMode ? "dark" : "light");
    } catch {}
  }, [darkMode]);

  useEffect(() => {
    if (profile?.user?.is_following !== undefined) {
      setIsFollowing(Boolean(profile.user.is_following));
    }
  }, [profile]);

  useEffect(() => {
    setIsMuting(isMutingUser);
  }, [isMutingUser]);

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
    if (moreOpen) {
      fetchSaved();
      fetchMutedUsers();
    }
  }, [moreOpen]);

  useEffect(() => {
    if (commentsOpen && viewerPostId) fetchComments();
  }, [commentsOpen, viewerPostId]);

  useEffect(() => {
    if (bannerViewerOpen || avatarViewerOpen || photoViewerOpen || avatarCropOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [bannerViewerOpen, avatarViewerOpen, photoViewerOpen, avatarCropOpen]);

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

  const toggleCommentLike = async (commentId) => {
    try {
      const res = await fetch(`${API}/api/vine/comments/${commentId}/like`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setViewerComments((prev) =>
        prev.map((cm) =>
          cm.id === commentId
            ? {
                ...cm,
                like_count: Number(data.likes ?? cm.like_count ?? 0),
                user_liked: Boolean(data.user_liked),
              }
            : cm
        )
      );
    } catch (err) {
      console.error("Comment like failed", err);
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
    let normalized = file;
    const isHeic =
      /heic|heif/i.test(file.type) ||
      /\.heic$/i.test(file.name) ||
      /\.heif$/i.test(file.name);
    if (isHeic) {
      try {
        const blob = await heic2any({
          blob: file,
          toType: "image/jpeg",
          quality: 0.9,
        });
        const outBlob = Array.isArray(blob) ? blob[0] : blob;
        normalized = new File(
          [outBlob],
          file.name.replace(/\.(heic|heif)$/i, ".jpg"),
          { type: "image/jpeg" }
        );
      } catch (err) {
        console.warn("HEIC conversion failed", err);
        alert("HEIC image could not be converted. Please use JPG/PNG/WebP.");
        return;
      }
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAvatarCropSrc(reader.result);
      setAvatarCropFile(normalized);
      setAvatarCropScale(1);
      setAvatarCropX(0);
      setAvatarCropY(0);
      setAvatarCropReady(false);
      setAvatarCropOpen(true);
      setAvatarActionOpen(false);
    };
    reader.readAsDataURL(normalized);

    // allow re-selecting the same file
    e.target.value = "";
  };

  const clampAvatarCrop = (x, y, scale = avatarCropScale) => {
    const cropEl = avatarCropRef.current;
    const imgEl = avatarCropImgRef.current;
    if (!cropEl || !imgEl) return { x, y };
    const cropSize = cropEl.clientWidth;
    const baseScale = Math.max(
      cropSize / imgEl.naturalWidth,
      cropSize / imgEl.naturalHeight
    );
    const totalScale = baseScale * scale;
    const drawW = imgEl.naturalWidth * totalScale;
    const drawH = imgEl.naturalHeight * totalScale;
    const maxX = Math.max(0, (drawW - cropSize) / 2);
    const maxY = Math.max(0, (drawH - cropSize) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  const handleAvatarCropScale = (value) => {
    const nextScale = Number(value);
    const clamped = clampAvatarCrop(avatarCropX, avatarCropY, nextScale);
    setAvatarCropScale(nextScale);
    setAvatarCropX(clamped.x);
    setAvatarCropY(clamped.y);
  };

  const handleAvatarCropStart = (e) => {
    e.preventDefault();
    setAvatarCropDragging(true);
    setAvatarCropStart({
      x: e.clientX - avatarCropX,
      y: e.clientY - avatarCropY,
    });
  };

  const handleAvatarCropMove = (e) => {
    if (!avatarCropDragging) return;
    const nextX = e.clientX - avatarCropStart.x;
    const nextY = e.clientY - avatarCropStart.y;
    const clamped = clampAvatarCrop(nextX, nextY);
    setAvatarCropX(clamped.x);
    setAvatarCropY(clamped.y);
  };

  const handleAvatarCropEnd = () => {
    setAvatarCropDragging(false);
  };

  const saveAvatarCrop = async () => {
    if (!avatarCropReady) return;
    if (!avatarCropFile || !avatarCropImgRef.current || !avatarCropRef.current) return;

    const imgEl = avatarCropImgRef.current;
    const cropEl = avatarCropRef.current;
    const cropSize = cropEl.clientWidth;

    const baseScale = Math.max(
      cropSize / imgEl.naturalWidth,
      cropSize / imgEl.naturalHeight
    );
    const totalScale = baseScale * avatarCropScale;
    const drawW = imgEl.naturalWidth * totalScale;
    const drawH = imgEl.naturalHeight * totalScale;
    const drawX = cropSize / 2 + avatarCropX - drawW / 2;
    const drawY = cropSize / 2 + avatarCropY - drawH / 2;

    const exportSize = 512;
    const scaleToCanvas = exportSize / cropSize;

    const canvas = document.createElement("canvas");
    canvas.width = exportSize;
    canvas.height = exportSize;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, exportSize, exportSize);
    ctx.drawImage(
      imgEl,
      drawX * scaleToCanvas,
      drawY * scaleToCanvas,
      drawW * scaleToCanvas,
      drawH * scaleToCanvas
    );

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9)
    );
    if (!blob) {
      alert("Avatar export failed. Please try again.");
      return;
    }

    const uploadAvatarFile = async (file) => {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch(`${API}/api/vine/users/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      let data = null;
      let raw = "";
      try {
        data = await res.json();
      } catch {
        raw = await res.text();
      }
      return { ok: res.ok, data, raw };
    };

    const avatarFile = new File([blob], "avatar.jpg", { type: "image/jpeg" });
    let result = await uploadAvatarFile(avatarFile);

    // Fallback: try original file if cropped upload fails
    if (!result.ok && avatarCropFile) {
      result = await uploadAvatarFile(avatarCropFile);
    }

    if (result.ok) {
      setProfile((prev) => ({
        ...prev,
        user: prev.user ? { ...prev.user, avatar_url: result.data.avatar_url } : prev,
        avatar_url: !prev.user ? result.data.avatar_url : prev.avatar_url,
      }));
      setAvatarCropOpen(false);
      setAvatarCropSrc(null);
      setAvatarCropFile(null);
      loadProfile();
    } else {
      alert(result.data?.message || result.raw || "Avatar upload failed");
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

  const toggleBlockUser = async () => {
    try {
      if (!isBlocking) {
        const ok = window.confirm("Block this user? They won't be able to contact you.");
        if (!ok) return;
      }
      const method = isBlocking ? "DELETE" : "POST";
      const res = await fetch(`${API}/api/vine/users/${userObj.id}/block`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setProfile((prev) => {
        if (!prev) return prev;
        const nextUser = prev.user ? prev.user : prev;
        const updated = { ...nextUser, is_blocking: isBlocking ? 0 : 1 };
        return prev.user ? { ...prev, user: updated } : { ...prev, ...updated };
      });
      if (!isBlocking) {
        setIsFollowing(false);
      }
    } catch (err) {
      console.error("Block toggle failed", err);
    }
  };

  const toggleReplies = (commentId) => {
    setOpenReplies((prev) => ({
      ...prev,
      [commentId]: !prev[commentId],
    }));
  };

  // ── Render ──────────────────────────────────────

  if (error && !profile) {
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
          {justUpdated && (
            <span className="profile-updated-badge">Updated</span>
          )}
        </div>
        {(isMe || !isBlocked) && (
          <button
            className="topbar-more-btn"
            onClick={() => {
              setMoreMode(isMe ? "me" : "other");
              setMoreOpen(true);
            }}
            title="More"
          >
            ⋯ More
          </button>
        )}
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
            src={avatarUrl || DEFAULT_AVATAR}
            className="image-viewer-img"
            alt="avatar fullscreen"
            onClick={(e) => e.stopPropagation()}
            style={{ borderRadius: "50%" }}
          />
        </div>
      )}

      {/* Avatar action sheet */}
      {avatarActionOpen && isMe && (
        <div className="avatar-action-overlay" onClick={() => setAvatarActionOpen(false)}>
          <div className="avatar-action-sheet" onClick={(e) => e.stopPropagation()}>
            <button
              className="avatar-action-btn"
              onClick={() => {
                setAvatarActionOpen(false);
                if (avatarUrl) setAvatarViewerOpen(true);
              }}
              disabled={!avatarUrl}
            >
              View profile photo
            </button>
            <button
              className="avatar-action-btn"
              onClick={() => {
                setAvatarActionOpen(false);
                avatarInputRef.current?.click();
              }}
            >
              Change photo
            </button>
            <button
              className="avatar-action-btn cancel"
              onClick={() => setAvatarActionOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Avatar cropper */}
      {avatarCropOpen && avatarCropSrc && (
        <div className="avatar-crop-overlay" onClick={() => setAvatarCropOpen(false)}>
          <div className="avatar-crop-panel" onClick={(e) => e.stopPropagation()}>
            <div className="avatar-crop-header">
              <h3>Adjust profile photo</h3>
              <button onClick={() => setAvatarCropOpen(false)}>✕</button>
            </div>
            <div
              className="avatar-crop-area"
              ref={avatarCropRef}
              onPointerDown={handleAvatarCropStart}
              onPointerMove={handleAvatarCropMove}
              onPointerUp={handleAvatarCropEnd}
              onPointerLeave={handleAvatarCropEnd}
            >
              <img
                ref={avatarCropImgRef}
                src={avatarCropSrc}
                alt="Crop preview"
                className="avatar-crop-img"
                style={{
                  transform: `translate(-50%, -50%) translate(${avatarCropX}px, ${avatarCropY}px) scale(${avatarCropScale})`,
                }}
                onLoad={() => setAvatarCropReady(true)}
              />
            </div>
            <div className="avatar-crop-controls">
              <label>
                Zoom
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  value={avatarCropScale}
                  onChange={(e) => handleAvatarCropScale(e.target.value)}
                />
              </label>
            </div>
            <div className="avatar-crop-actions">
              <button className="ghost-btn" onClick={() => setAvatarCropOpen(false)}>
                Cancel
              </button>
              <button className="primary-btn" onClick={saveAvatarCrop}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header row – Avatar + Buttons */}
      <div className="header-top-row">
        <div className="avatar-wrapper">
          <div
            className="avatar-circle"
            onClick={() => {
              if (isMe) {
                if (avatarUrl) {
                  setAvatarActionOpen(true);
                } else {
                  avatarInputRef.current?.click();
                }
              } else if (avatarUrl) {
                setAvatarViewerOpen(true);         // 👀 others → fullscreen
              }
            }}
            
          >
            <img
              src={avatarUrl || DEFAULT_AVATAR}
              alt="avatar"
              onError={(e) => {
                e.currentTarget.src = DEFAULT_AVATAR;
              }}
            />

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
                            ⚙️ Settings
                          </button>

                          <button
                            className="profile-settings-btn more-btn"
                            onClick={() => {
                              setMoreMode("me");
                              setMoreOpen(true);
                            }}
                            title="More"
                            style={{ display: "none" }}
                          >
                            ⋯ More
                          </button>
                        </>
                      ) : isBlocked ? (
                        <div className="blocked-banner">You have been blocked.</div>
                      ) : (
                        <>
                          {!isBlocking && (
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

                              {canMessage && (
                                <button className="message-btn" onClick={handleMessage}>
                                  📧 DM
                                </button>
                              )}
                            </>
                          )}

                          <button
                            className="profile-settings-btn more-btn"
                            onClick={() => {
                              setMoreMode("other");
                              setMoreOpen(true);
                            }}
                            title="More"
                            style={{ display: "none" }}
                          >
                            ⋯ More
                          </button>
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

  {userObj?.last_active_at && canShowLastActive && (
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
      {!isBlocked && (
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
      )}

      {/* Tab content */}
      <div className="vine-profile-tab-content">
        {isBlocked ? (
          <div className="empty-state">You have been blocked.</div>
        ) : null}
        {activeTab === "posts" && (
          <div className="vine-profile-posts">
            {isPrivateLocked ? (
              <div className="empty-state">This profile is private.</div>
            ) : profile?.posts?.length > 0 ? (
  profile.posts.map((post) => (
    <VinePostCard
      key={post.feed_id || `post-${post.id}`}
      post={post}
      isMe={isMe}
      onDeletePost={handleDeletePost}
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
            {isPrivateLocked ? (
              <div className="empty-state">This profile is private.</div>
            ) : likedPosts.length === 0 ? (
              <div className="empty-state">🌱 No liked posts yet</div>
            ) : (
              likedPosts.map((post) => (
                <VinePostCard
                  key={post.feed_id || `like-${post.id}`}
                  post={post}
                  currentUserId={currentUserId}
                  onDeletePost={handleDeletePost}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "photos" && (
          <div className="photos-grid">
            {isPrivateLocked ? (
              <div className="empty-state">This profile is private.</div>
            ) : photoPosts.length === 0 ? (
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

        {moreOpen && (
          <div className="more-overlay" onClick={() => setMoreOpen(false)}>
            <div className="more-panel" onClick={(e) => e.stopPropagation()}>
              <div className="more-header">
                <h3>More</h3>
                <button onClick={() => setMoreOpen(false)}>✕</button>
              </div>
              {moreMode === "me" ? (
                <>
                  <div className="more-section-title">🔖 Saved posts</div>
                  <div className="more-content">
                    {savedPosts.length === 0 ? (
                      <div className="empty-state">No saved posts yet</div>
                    ) : (
                      savedPosts.map((post) => (
                        <VinePostCard
                          key={post.feed_id || `saved-${post.id}`}
                          post={post}
                          currentUserId={currentUserId}
                          onDeletePost={handleDeletePost}
                        />
                      ))
                    )}
                    <div className="more-section-title">🔇 Muted users</div>
                    {mutedUsers.length === 0 ? (
                      <div className="empty-state">No muted users</div>
                    ) : (
                      <div className="muted-list">
                        {mutedUsers.map((u) => (
                          <div key={u.id} className="muted-row">
                            <img
                              src={u.avatar_url || DEFAULT_AVATAR}
                              alt={u.username}
                              onError={(e) => {
                                e.currentTarget.src = DEFAULT_AVATAR;
                              }}
                            />
                            <div className="muted-info">
                              <div className="muted-name">{u.display_name || u.username}</div>
                              <div className="muted-handle">@{u.username}</div>
                            </div>
                            <button
                              className="block-btn unblock"
                              onClick={async () => {
                                const res = await fetch(`${API}/api/vine/users/${u.id}/mute`, {
                                  method: "DELETE",
                                  headers: { Authorization: `Bearer ${token}` },
                                });
                                if (res.ok) {
                                  setMutedUsers((prev) => prev.filter((m) => m.id !== u.id));
                                }
                              }}
                            >
                              Unmute
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="more-content">
                  <div className="more-section-title">Safety</div>
                  <button
                    className={`block-btn ${isBlocking ? "unblock" : ""}`}
                    onClick={toggleBlockUser}
                  >
                    {isBlocking ? "Unblock" : "Block"}
                  </button>
                  <button
                    className={`block-btn ${isMuting ? "unblock" : ""}`}
                    onClick={async () => {
                      try {
                        const res = await fetch(`${API}/api/vine/users/${userObj.id}/mute`, {
                          method: isMuting ? "DELETE" : "POST",
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        if (res.ok) {
                          setIsMuting(!isMuting);
                        }
                      } catch (err) {
                        console.error("Mute toggle failed", err);
                      }
                    }}
                  >
                    {isMuting ? "Unmute" : "Mute"}
                  </button>
                </div>
              )}
            </div>
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
            {canShowViewerLikes && viewerLikeCount > 0 && (
              <span className="like-count">{viewerLikeCount}</span>
            )}
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
                {(commentsByParent[0] || []).length === 0 ? (
                  <div className="empty-state">No comments yet</div>
                ) : (
                  (commentsByParent[0] || []).map((c) => {
                    const renderThread = (comment, depth = 0) => {
                      const children = commentsByParent[comment.id] || [];
                      const isOpen = openReplies[comment.id] !== false;
                      return (
                        <div key={comment.id} className="comment-thread" style={{ marginLeft: depth * 24 }}>
                          <div className="comment-item">
                            <div className="comment-main">
                              <img
                                src={comment.avatar_url || DEFAULT_AVATAR}
                                className={`comment-avatar ${depth > 0 ? "small" : ""}`}
                                alt=""
                                onError={(e) => {
                                  e.currentTarget.src = DEFAULT_AVATAR;
                                }}
                              />

                              <div className="comment-body">
                                <span className="comment-username">
                                  <span>{comment.display_name || comment.username}</span>
                                  {Number(comment.is_verified) === 1 && (
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
                                </span>
                                <p className="comment-text">{comment.content}</p>

                                <div className="comment-meta">
                                  <span className="comment-time">{formatRelativeTime(comment.created_at)}</span>

                                  <button
                                    className={`comment-like ${comment.user_liked ? "liked" : ""}`}
                                    onClick={async () => {
                                      await toggleCommentLike(comment.id);
                                    }}
                                  >
                                    ❤️ {comment.like_count || 0}
                                  </button>

                                  <button className="reply-btn" onClick={() => setReplyTo(comment.id)}>
                                    Reply
                                  </button>

                                  {comment.user_id === currentUserId && (
                                    <button
                                      className="comment-delete-btn"
                                      onClick={async () => {
                                        await fetch(`${API}/api/vine/comments/${comment.id}`, {
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

                            {children.length > 0 && (
                              <button
                                className="toggle-replies-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleReplies(comment.id);
                                }}
                              >
                                {isOpen ? "Hide replies" : `View replies (${children.length})`}
                              </button>
                            )}
                          </div>

                          {children.length > 0 && isOpen && (
                            <div className="comment-replies">
                              {children.map((child) => renderThread(child, depth + 1))}
                            </div>
                          )}
                        </div>
                      );
                    };

                    return renderThread(c, 0);
                  })
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
                  onChange={(e) => {
                    setNewComment(e.target.value);
                    const anchor = getMentionAnchor(e.target.value, e.target.selectionStart);
                    setMentionAnchor(anchor);
                  }}
                  placeholder="Add a comment…"
                />
                <button type="submit">Post</button>
              </form>
              {mentionResults.length > 0 && mentionAnchor && (
                <div className="mention-suggest-list">
                  {mentionResults.map((u) => (
                    <button
                      key={`mention-v-${u.id}`}
                      className="mention-suggest-item"
                      onClick={() => {
                        setNewComment((prev) => applyMention(prev, mentionAnchor, u.username));
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
                  {renderMentions(newComment, navigate)}
                </div>
              )}
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
        <select
          value={dmPrivacy}
          onChange={(e) => {
            const value = e.target.value;
            setDmPrivacy(value);
            saveSettings({ dm_privacy: value });
          }}
        >
          <option value="everyone">Everyone</option>
          <option value="followers">Followers only</option>
          <option value="no_one">No one</option>
        </select>
      </div>

      {/* 2️⃣ Private Profile */}
      <div className="settings-item">
        <label>
          <input
            type="checkbox"
            checked={privateProfile}
            onChange={(e) => {
              const value = e.target.checked;
              setPrivateProfile(value);
              saveSettings({ is_private: value });
            }}
          />
          Private profile
        </label>
      </div>

      {/* 3️⃣ Hide like counts */}
      <div className="settings-item">
        <label>
          <input
            type="checkbox"
            checked={hideLikeCounts}
            onChange={(e) => {
              const value = e.target.checked;
              setHideLikeCounts(value);
              saveSettings({ hide_like_counts: value });
            }}
          />
          Hide like counts
        </label>
      </div>

      {/* 4️⃣ Show last active */}
      <div className="settings-item">
        <label>
          <input
            type="checkbox"
            checked={showLastActive}
            onChange={(e) => {
              const value = e.target.checked;
              setShowLastActive(value);
              saveSettings({ show_last_active: value });
            }}
          />
          Show last active status
        </label>
      </div>

      {/* 5️⃣ Dark mode */}
      <div className="settings-item">
        <label>
          <input
            type="checkbox"
            checked={darkMode}
            onChange={(e) => setDarkMode(e.target.checked)}
          />
          Dark mode
        </label>
      </div>

      {/* 6️⃣ Change password */}
      <div className="settings-item stack">
        <label>Change password</label>
        <input
          className="settings-input"
          type="password"
          placeholder="Current password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <input
          className="settings-input"
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <input
          className="settings-input"
          type="password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        <button className="settings-primary-btn" onClick={changePassword}>
          Update password
        </button>
        {passwordMsg && <div className="settings-hint">{passwordMsg}</div>}
      </div>

      {/* 7️⃣ Verify email */}
      <div className="settings-item stack">
        <label>Verify email</label>
        <input
          className="settings-input"
          type="email"
          placeholder="Enter your email"
          value={verifyEmail}
          onChange={(e) => setVerifyEmail(e.target.value)}
        />
        <button className="settings-primary-btn" onClick={requestVerification}>
          Send verification code
        </button>
        <input
          className="settings-input"
          type="text"
          placeholder="Enter 4-digit code"
          value={verifyCode}
          onChange={(e) => setVerifyCode(e.target.value)}
        />
        <button className="settings-primary-btn" onClick={confirmVerification}>
          Verify code
        </button>
        {userObj?.is_verified === 1 && (
          <div className="settings-hint">✅ Verified</div>
        )}
        {verifyMsg && <div className="settings-hint">{verifyMsg}</div>}
      </div>

      {/* 5️⃣ Clear pinned post */}
      <div className="settings-item danger">
        <button className="danger-btn" onClick={clearPinnedPost}>
          Remove pinned post
        </button>
      </div>
    </div>
  </div>
)}

    </div>
  );
}
