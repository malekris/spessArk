import { memo, useState, useEffect, useRef } from "react";
import "./VinePostCard.css";
import { useNavigate } from "react-router-dom";
import ImageCarousel from "./ImageCarousel";
import MiniProfileCard from "../components/MiniProfileCard";
import GifPickerModal from "../components/GifPickerModal";
import { createPortal } from "react-dom";
import useNearScreen from "../../../hooks/useNearScreen";

// ────────────────────────────────────────────────
//  CONFIG & HELPERS
// ────────────────────────────────────────────────

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";
const ORIGIN = API.replace(/\/api$/, "");
const SHARE_PREVIEW_VERSION = "20260315";
const viewedPosts = new Set();
const POST_REACTIONS = [
  { key: "love", emoji: "❤️", label: "Love" },
  { key: "happy", emoji: "😄", label: "Happy" },
  { key: "sad", emoji: "😢", label: "Sad" },
  { key: "care", emoji: "🤗", label: "Care" },
];
const REACTION_LABEL = {
  like: "Liked",
  love: "Loved",
  happy: "Happy",
  sad: "Sad",
  care: "Care",
};
const REACTION_EMOJI = {
  like: "❤️",
  love: "❤️",
  happy: "😄",
  sad: "😢",
  care: "🤗",
};

/**
 * Formats timestamp to relative time (just now, 5m, 2h, 3d, or date)
 */
const formatPostDate = (dateString) => {
  if (!dateString) return "";
  const parsed = new Date(String(dateString).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - parsed.getTime();
  const hourMs = 60 * 60 * 1000;
  const minuteMs = 60 * 1000;
  if (diffMs >= 0 && diffMs < 24 * hourMs) {
    if (diffMs < hourMs) {
      const mins = Math.max(1, Math.floor(diffMs / minuteMs));
      return `${mins} ${mins === 1 ? "minute" : "minutes"} ago`;
    }
    const hours = Math.floor(diffMs / hourMs);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const sameYear = parsed.getFullYear() === now.getFullYear();

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
};

const formatPollExpiry = (expiresAt) => {
  if (!expiresAt) return "";
  const end = new Date(String(expiresAt).replace(" ", "T"));
  if (Number.isNaN(end.getTime())) return "";
  const diff = end.getTime() - Date.now();
  if (diff <= 0) return "Poll ended";
  const mins = Math.ceil(diff / (60 * 1000));
  if (mins < 60) return `Poll expires in ${mins} min`;
  const hours = Math.ceil(diff / (60 * 60 * 1000));
  if (hours < 24) return `Poll expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (remHours === 0) return `Poll expires in ${days} day${days === 1 ? "" : "s"}`;
  return `Poll expires in ${days}d ${remHours}h`;
};

const renderMentions = (text, navigate) => {
  if (!text) return text;
  const isGifUrl = (url) => {
    const value = String(url || "").toLowerCase();
    return (
      /\.(gif)(\?|$)/i.test(value) ||
      value.includes("giphy.com/media/") ||
      value.includes("media.tenor.com/")
    );
  };
  const parts = text.split(
    /(https?:\/\/[^\s]+|@[a-zA-Z0-9._]{1,30}|#[a-zA-Z0-9_]{1,60}|\*\*[^*\n]+\*\*|~~[^~\n]+~~|__[^_\n]+__|\*[^*\n]+\*)/g
  );
  return parts.map((part, idx) => {
    if (/^https?:\/\/[^\s]+$/i.test(part)) {
      if (isGifUrl(part)) {
        return (
          <img
            key={`gif-${idx}`}
            className="inline-gif"
            src={part}
            alt="gif"
            loading="lazy"
            onClick={(e) => e.stopPropagation()}
          />
        );
      }
      return (
        <a
          key={`url-${idx}`}
          className="post-link"
          href={part}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    if (part.startsWith("@")) {
      const username = part.slice(1);
      const isAllMention = username.toLowerCase() === "all";
      return (
        <span
          key={`mention-${idx}-${username}`}
          className="mention"
          onClick={(e) => {
            e.stopPropagation();
            if (isAllMention) return;
            navigate(`/vine/profile/${username}`);
          }}
        >
          {part}
        </span>
      );
    }
    if (part.startsWith("#")) {
      return (
        <button
          key={`tag-${idx}`}
          className="hashtag"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/vine/feed?tag=${encodeURIComponent(part.slice(1).toLowerCase())}`);
          }}
        >
          {part}
        </button>
      );
    }
    if (/^\*\*[^*\n]+\*\*$/.test(part)) {
      return <strong key={`bold-${idx}`}>{part.slice(2, -2)}</strong>;
    }
    if (/^~~[^~\n]+~~$/.test(part)) {
      return <s key={`strike-${idx}`}>{part.slice(2, -2)}</s>;
    }
    if (/^__[^_\n]+__$/.test(part)) {
      return (
        <span key={`under-${idx}`} style={{ textDecoration: "underline" }}>
          {part.slice(2, -2)}
        </span>
      );
    }
    if (/^\*[^*\n]+\*$/.test(part)) {
      return <em key={`ital-${idx}`}>{part.slice(1, -1)}</em>;
    }
    return <span key={`text-${idx}`}>{part}</span>;
  });
};

const extractTaggedUsernames = (text) => {
  if (!text) return [];
  const matches = String(text).match(/@([a-zA-Z0-9._]{1,30})/g) || [];
  const seen = new Set();
  const ordered = [];
  matches.forEach((m) => {
    const user = m.slice(1).toLowerCase();
    if (!seen.has(user)) {
      seen.add(user);
      ordered.push(user);
    }
  });
  return ordered;
};

const stripMentionsFromPostText = (text) => {
  if (!text) return "";
  return String(text)
    .replace(/(^|[\s])@[a-zA-Z0-9._]{1,30}\b/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const extractPostMetaFromContent = (text) => {
  const raw = String(text || "");
  let out = raw;
  let feeling = "";
  let postBg = "";
  while (true) {
    const match = out.match(/^\s*\[\[(feeling|postbg):([^\]]+)\]\]\s*/i);
    if (!match) break;
    const key = String(match[1] || "").toLowerCase();
    const value = String(match[2] || "").trim();
    if (key === "feeling" && !feeling) {
      feeling = value.toLowerCase();
    }
    if (key === "postbg" && !postBg && /^#[0-9a-f]{6}$/i.test(value)) {
      postBg = value;
    }
    out = out.slice(match[0].length);
  }
  return {
    feeling,
    postBg,
    content: out,
  };
};

const formatFeelingLabel = (value) => {
  if (!value) return "";
  return value
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const getContrastTextColor = (hex) => {
  const clean = String(hex || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return "#ffffff";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? "#0f172a" : "#ffffff";
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

function VinePostCard({ post, onDeletePost, focusComments, isMe, communityInteractionLocked = false }) {

  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("vine_user") || "{}");
    } catch {
      return {};
    }
  })();
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
  const isModerator =
    Number(currentUser?.is_admin) === 1 ||
    String(currentUser?.role || "").toLowerCase() === "moderator" ||
    ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(currentUser?.username || "").toLowerCase());
  const isGuardianPost = ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(post.username || "").toLowerCase());
  const isCommunityInteractionLocked = Boolean(communityInteractionLocked) && Number(post.community_id) > 0;

  // ── State ───────────────────────────────────────
  const [postLikes, setPostLikes] = useState(post.likes || 0);
  const [postUserLiked, setPostUserLiked] = useState(post.user_liked || false);
  const [postUserReaction, setPostUserReaction] = useState(
    post.viewer_reaction || (post.user_liked ? "like" : null)
  );
  const [reactionCounts, setReactionCounts] = useState(
    post.reaction_counts || { like: 0, love: 0, happy: 0, sad: 0, care: 0 }
  );
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
  const [commentUserReaction, setCommentUserReaction] = useState({});
  const [isDeleted, setIsDeleted] = useState(false);
  const [bookmarked, setBookmarked] = useState(post.user_bookmarked || false);
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionAnchor, setMentionAnchor] = useState(null);
  const [gifPickerCommentOpen, setGifPickerCommentOpen] = useState(false);
  const [commentGifUrl, setCommentGifUrl] = useState("");

  const addGifToComment = () => setGifPickerCommentOpen(true);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTarget, setReportTarget] = useState({ postId: null, commentId: null });
  const [reportCategory, setReportCategory] = useState("abuse");
  const [reportDetails, setReportDetails] = useState("");
  const reportOpenedAtRef = useRef(0);
  const [showLikesModal, setShowLikesModal] = useState(false);
  const [likedUsers, setLikedUsers] = useState([]);
  const [latestLiker, setLatestLiker] = useState(null);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [reactionPickerPos, setReactionPickerPos] = useState({ left: 0, top: 0 });
  const reactionPressTimer = useRef(null);
  const reactionLongPressTriggered = useRef(false);
  const likeButtonRef = useRef(null);
  const [poll, setPoll] = useState(post.poll || null);
  const [pollLoading, setPollLoading] = useState(false);
  const [pollVotingOptionId, setPollVotingOptionId] = useState(null);

  const { feeling: postFeeling, postBg, content: postContentWithoutMeta } = extractPostMetaFromContent(post.content || "");
  const displayPostContent = stripMentionsFromPostText(postContentWithoutMeta || "");
  const CONTENT_LIMIT = 280;
  const hasLongContent = displayPostContent.length > CONTENT_LIMIT;
  const contentToShow =
    hasLongContent && !isExpanded
      ? `${displayPostContent.slice(0, CONTENT_LIMIT).trimEnd()}...`
      : displayPostContent;
  const contentWordCount = displayPostContent ? displayPostContent.split(/\s+/).filter(Boolean).length : 0;
  const useStyledTextCard =
    Boolean(postBg) &&
    contentWordCount > 0 &&
    contentWordCount <= 22 &&
    !post.image_url &&
    !post.link_preview &&
    !post.has_poll;
  const contentStyle = useStyledTextCard
    ? {
        whiteSpace: "pre-wrap",
        background: postBg,
        color: getContrastTextColor(postBg),
        borderRadius: 16,
        padding: "20px 16px",
        fontWeight: 800,
      }
    : { whiteSpace: "pre-wrap" };
  const normalizedPostText = String(displayPostContent || "").trim().toLowerCase();
  const normalizedPollQuestion = String(poll?.question || "").trim().toLowerCase();
  const showPollQuestion = Boolean(normalizedPollQuestion) && normalizedPollQuestion !== normalizedPostText;
  const taggedUsers = extractTaggedUsernames(post.content || "");
  const pollExpired = Boolean(poll?.expires_at) && new Date(String(poll.expires_at).replace(" ", "T")).getTime() <= Date.now();


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
    if (!post?.has_poll) {
      setPoll(null);
      return;
    }
    const loadPoll = async () => {
      setPollLoading(true);
      try {
        const res = await fetch(`${API}/api/vine/posts/${post.id}/poll`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setPoll(data);
      } catch {
        // no-op
      } finally {
        setPollLoading(false);
      }
    };
    loadPoll();
  }, [post?.id, post?.has_poll, token]);

  useEffect(() => {
    if (post.comments !== undefined) {
      setCommentCount(post.comments || 0);
    }
  }, [post.comments]);

  useEffect(() => {
    if (post.viewer_reaction !== undefined) {
      setPostUserReaction(post.viewer_reaction || null);
    } else if (post.user_liked !== undefined) {
      setPostUserReaction(post.user_liked ? "like" : null);
    }
  }, [post.viewer_reaction, post.user_liked]);

  useEffect(() => {
    const closePicker = () => setShowReactionPicker(false);
    document.addEventListener("pointerdown", closePicker);
    return () => {
      clearTimeout(reactionPressTimer.current);
      document.removeEventListener("pointerdown", closePicker);
    };
  }, []);

  useEffect(() => {
    if (!showReactionPicker) return;
    const updatePosition = () => {
      const btn = likeButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const pickerWidth = 340;
      const margin = 8;
      const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, window.innerWidth - pickerWidth - margin)
      );
      const top = Math.max(margin, rect.top - 64);
      setReactionPickerPos({ left, top });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showReactionPicker]);

  useEffect(() => {
    if (!canShowLikeCount || Number(postLikes || 0) <= 0) {
      setLatestLiker(null);
      return;
    }
    const loadLikesPreview = async () => {
      try {
        const res = await fetch(`${API}/api/vine/posts/${post.id}/likes?limit=1`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setLatestLiker(data.latest || null);
        if (data.viewer_reaction !== undefined) {
          setPostUserReaction(data.viewer_reaction || null);
          setPostUserLiked(Boolean(data.viewer_reaction));
        }
        if (data.reaction_counts) {
          setReactionCounts((prev) => ({ ...prev, ...data.reaction_counts }));
        }
      } catch {
        // no-op
      }
    };
    loadLikesPreview();
  }, [post.id, postLikes, canShowLikeCount, token]);

  const loadLikesPreviewNow = async () => {
    if (!canShowLikeCount || Number(postLikes || 0) <= 0) return;
    const loadLikesPreview = async () => {
      try {
        const res = await fetch(`${API}/api/vine/posts/${post.id}/likes?limit=1`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setLatestLiker(data.latest || null);
      if (data.viewer_reaction !== undefined) {
        setPostUserReaction(data.viewer_reaction || null);
        setPostUserLiked(Boolean(data.viewer_reaction));
      }
      if (data.reaction_counts) {
        setReactionCounts((prev) => ({ ...prev, ...data.reaction_counts }));
      }
      } catch {
        // no-op
      }
    };
    await loadLikesPreview();
  };

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
    const reacted = { ...commentUserReaction };
  
    const hydrate = (node) => {
      if (likes[node.id] === undefined) {
        likes[node.id] = node.like_count || 0;
      }
      if (liked[node.id] === undefined) {
        liked[node.id] = node.user_liked || false;
      }
      if (reacted[node.id] === undefined) {
        reacted[node.id] = node.user_reaction || (node.user_liked ? "like" : null);
      }
  
      if (node.replies?.length) {
        node.replies.forEach(hydrate);
      }
    };
  
    comments.forEach(hydrate);
  
    setCommentLikes(likes);
    setCommentUserLiked(liked);
    setCommentUserReaction(reacted);
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

  const votePoll = async (optionId) => {
    if (!token || !post?.id || !optionId || pollExpired) return;
    setPollVotingOptionId(optionId);
    try {
      const res = await fetch(`${API}/api/vine/posts/${post.id}/poll/vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ option_id: optionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to vote");
        return;
      }
      setPoll((prev) => ({
        ...(prev || {}),
        ...data,
        question: prev?.question || data?.question || "",
        expires_at: prev?.expires_at || data?.expires_at || null,
      }));
    } catch {
      alert("Failed to vote");
    } finally {
      setPollVotingOptionId(null);
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
  const handleLike = async (reaction = "like") => {
    const res = await fetch(`${API}/api/vine/posts/${post.id}/like`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reaction }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || "Action not allowed");
      return;
    }
    setPostLikes(data.likes);
    setPostUserLiked(data.user_liked);
    setPostUserReaction(data.viewer_reaction || null);
    if (data.reaction_counts) {
      setReactionCounts((prev) => ({ ...prev, ...data.reaction_counts }));
    }
    setShowReactionPicker(false);
    setTimeout(() => {
      loadLikesPreviewNow();
    }, 0);
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

  const openLikesModal = async () => {
    if (!canShowLikeCount || Number(postLikes || 0) <= 0) return;
    try {
      const res = await fetch(`${API}/api/vine/posts/${post.id}/likes?limit=100`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setLikedUsers(Array.isArray(data.users) ? data.users : []);
      setLatestLiker(data.latest || null);
      if (data.reaction_counts) {
        setReactionCounts((prev) => ({ ...prev, ...data.reaction_counts }));
      }
      setShowLikesModal(true);
    } catch {
      // no-op
    }
  };

  const startReactionPress = (e) => {
    e.stopPropagation();
    reactionLongPressTriggered.current = false;
    clearTimeout(reactionPressTimer.current);
    reactionPressTimer.current = setTimeout(() => {
      reactionLongPressTriggered.current = true;
      setShowReactionPicker(true);
    }, 360);
  };

  const cancelReactionPress = () => {
    clearTimeout(reactionPressTimer.current);
  };

  const handleLikeButtonClick = (e) => {
    e.stopPropagation();
    if (reactionLongPressTriggered.current) {
      reactionLongPressTriggered.current = false;
      return;
    }
    handleLike("like");
  };
  

  const handleRevine = async () => {
    if (isCommunityInteractionLocked) {
      alert("Join this community to comment or revine.");
      return;
    }
    const res = await fetch(`${API}/api/vine/posts/${post.id}/revine`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || "Action not allowed");
      return;
    }
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

  const openPostReport = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    reportOpenedAtRef.current = Date.now();
    setReportTarget({ postId: post.id, commentId: null });
    setReportCategory("abuse");
    setReportDetails("");
    setShowReportModal(true);
  };

  const openCommentReport = (commentId, commentPostId, e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    reportOpenedAtRef.current = Date.now();
    setReportTarget({ postId: commentPostId || post.id, commentId });
    setReportCategory("abuse");
    setReportDetails("");
    setShowReportModal(true);
  };

  const closeReportModal = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (Date.now() - reportOpenedAtRef.current < 260) return;
    setShowReportModal(false);
  };

  const submitReport = async () => {
    const reason = reportDetails.trim()
      ? `${reportCategory}: ${reportDetails.trim()}`
      : reportCategory;
    try {
      const res = await fetch(`${API}/api/vine/reports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          post_id: reportTarget.postId,
          comment_id: reportTarget.commentId,
          reason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to submit report");
        return;
      }
      alert("Reported to Guardian");
      setShowReportModal(false);
    } catch {
      alert("Failed to submit report");
    }
  };

  const targetComment = reportTarget.commentId
    ? comments.find((c) => Number(c.id) === Number(reportTarget.commentId))
    : null;
  const isReportingOwnTarget = reportTarget.commentId
    ? Number(targetComment?.user_id) === Number(current_user_id)
    : isPostAuthor;

  const sendComment = async (content, parent_comment_id = null, gifUrl = "") => {
    if (isCommunityInteractionLocked) {
      alert("Join this community to comment or revine.");
      return;
    }
    if (!content.trim() && !gifUrl) return;
    const finalContent = gifUrl
      ? `${content.trim()}${content.trim() ? "\n" : ""}${gifUrl}`
      : content;
    const res = await fetch(`${API}/api/vine/posts/${post.id}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: finalContent, parent_comment_id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || "Failed to post comment");
      return;
    }
    if (res.ok) {
      if (!parent_comment_id) {
        setText("");
        setCommentGifUrl("");
      }
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

  let postMedia = [];
  try {
    const parsed = JSON.parse(post.image_url || "[]");
    postMedia = Array.isArray(parsed) ? parsed : [post.image_url];
  } catch {
    postMedia = post.image_url ? [post.image_url] : [];
  }
  postMedia = postMedia.filter(Boolean);
  const pdfUrls = postMedia.filter((u) => /\.pdf(\?|$)/i.test(String(u)));
  const visualMediaUrls = postMedia.filter((u) => !/\.pdf(\?|$)/i.test(String(u)));
  const carouselMediaPayload = visualMediaUrls.length
    ? JSON.stringify(visualMediaUrls)
    : null;
  const [mediaMountRef, shouldMountCarousel] = useNearScreen({
    rootMargin: "720px 0px",
    once: true,
  });

  // ── Render ──────────────────────────────────────
  return (
    <div className="vine-post light-green-theme" id={`post-${post.id}`} ref={postRef}>
      <GifPickerModal
        open={gifPickerCommentOpen}
        token={token}
        onClose={() => setGifPickerCommentOpen(false)}
        onSelect={(gifUrl) => {
          setCommentGifUrl(gifUrl);
        }}
      />
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
          {post.community_name && (
            <button
              className="community-chip"
              onClick={() => navigate(`/vine/communities/${post.community_slug}`)}
              title={`View ${post.community_name}`}
            >
              👥 {post.community_name}
            </button>
          )}

          {/* Username, verification, time */}
          <div className="meta-top">
            <div className="name-row">
              <span className="name-main">
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
                {(post.is_verified === 1 || isGuardianPost) && (
                  <span className={`verified ${isGuardianPost ? "guardian" : ""}`}>
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
              {postFeeling && (
                <span className="inline-feeling">is feeling {formatFeelingLabel(postFeeling)}</span>
              )}
              <span className="time top-time">
                • {formatPostDate(post.sort_time || post.created_at)}
              </span>
            </div>
            <div className="post-kebab-wrap">
              <button
                className="post-kebab-btn"
                title="More"
                onPointerDown={(e) => openPostReport(e)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                ⋯
              </button>
            </div>
          </div>
          {isMe && post.revined_by === 0 && (
            <div className="meta-line">
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
            </div>
          )}
        </div>
      </div>

      {/* Post content */}
      <p
        className={`vine-post-content ${
          displayPostContent &&
          displayPostContent.length < 120 &&
          !post.image_url
            ? "big-text"
            : ""
        } ${useStyledTextCard ? "styled-card-text" : ""}`}
        style={contentStyle}
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

      {post.has_poll && (
        <div className="post-poll-box">
          {showPollQuestion && (
            <div className="post-poll-question">{poll?.question || "Poll"}</div>
          )}
          {poll?.expires_at && (
            <div className="post-poll-expiry">{formatPollExpiry(poll.expires_at)}</div>
          )}
          {pollLoading && !poll ? (
            <div className="post-poll-loading">Loading poll…</div>
          ) : (
            <div className="post-poll-options">
              {(poll?.options || []).map((opt) => {
                const total = Number(poll?.total_votes || 0);
                const votes = Number(opt.votes || 0);
                const percent = total > 0 ? Math.round((votes / total) * 100) : 0;
                const selected = Number(poll?.user_vote_option_id) === Number(opt.id);
                return (
                  <button
                    key={`poll-opt-${opt.id}`}
                    type="button"
                    className={`post-poll-option ${selected ? "selected" : ""}`}
                    onClick={() => votePoll(opt.id)}
                    disabled={Boolean(pollVotingOptionId) || pollExpired}
                  >
                    <span className="post-poll-option-label">{opt.option_text}</span>
                    <span className="post-poll-option-meta">
                      {total > 0 ? `${votes} • ${percent}%` : `${votes}`}
                    </span>
                  </button>
                );
              })}
              <div className="post-poll-total-votes">{Number(poll?.total_votes || 0)} votes</div>
            </div>
          )}
        </div>
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
              loading="lazy"
              decoding="async"
              fetchPriority="low"
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

      {pdfUrls.length > 0 && (
        <div className="post-pdf-list">
          {pdfUrls.map((url, idx) => {
            const safeUrl = String(url || "");
            const fileName = safeUrl.split("/").pop()?.split("?")[0] || `document-${idx + 1}.pdf`;
            return (
              <div key={`${post.id}-pdf-${idx}`} className="post-pdf-item">
                <span className="pdf-icon">📄</span>
                <a href={safeUrl} target="_blank" rel="noreferrer">
                  {decodeURIComponent(fileName)}
                </a>
                <a href={safeUrl} download className="pdf-download-btn">
                  Download
                </a>
              </div>
            );
          })}
        </div>
      )}

      {/* Images carousel */}
      {carouselMediaPayload && (
  <div
    ref={mediaMountRef}
    className="carousel-shell"
    onClick={() => {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        if (!postUserLiked) {
          handleLike("like");
        }
      }
      lastTapRef.current = now;
    }}
  >
    {shouldMountCarousel ? (
      <ImageCarousel
        imageUrl={carouselMediaPayload}
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
        timeLabel={formatPostDate(post.created_at)}
        caption={post.content}
      />
    ) : (
      <div className="carousel-deferred-placeholder" aria-hidden="true">
        <span>Preparing media…</span>
      </div>
    )}
  </div>
        )}
      {/* Action footer */}
      {taggedUsers.length > 0 && (
        <div className="post-tagged-users">
          <span className="post-tagged-label">Tagged:</span>
          {taggedUsers.map((u, idx) => (
            <button
              key={`post-tagged-${post.id}-${u}`}
              type="button"
              className="post-tagged-user"
              onClick={() => {
                if (String(u).toLowerCase() === "all") return;
                navigate(`/vine/profile/${u}`);
              }}
            >
              @{u}{idx < taggedUsers.length - 1 ? "," : ""}
            </button>
          ))}
        </div>
      )}
      <div className="vine-post-footer">
        <div
          className="reaction-action-wrap"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            ref={likeButtonRef}
            className={`action-btn ${postUserLiked ? "active-like" : ""}`}
            onPointerDown={startReactionPress}
            onPointerUp={cancelReactionPress}
            onPointerCancel={cancelReactionPress}
            onPointerLeave={cancelReactionPress}
            onContextMenu={(e) => e.preventDefault()}
            onClick={handleLikeButtonClick}
          >
            {postUserLiked ? (REACTION_EMOJI[postUserReaction] || "❤️") : "🤍"}
            {canShowLikeCount && ` ${postLikes}`}
          </button>
        </div>
        <button className="action-btn" onClick={() => setOpen(!open)}>
          💬 {commentCount}
        </button>

        <button
          className={`action-btn ${userRevined ? "active-revine" : ""}`}
          disabled={isCommunityInteractionLocked}
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
              `${API}/api/vine/share/${post.id}?preview=${SHARE_PREVIEW_VERSION}`
            );
            alert("Copied! 🌱");
          }}
        >
          📤
        </button>
      </div>
      {canShowLikeCount && Number(postLikes || 0) > 0 && latestLiker && (
        <button className="liked-by-line" onClick={openLikesModal}>
          {String(latestLiker.reaction || "like").toLowerCase() === "like" ? "Liked by " : "Reacted by "}
          <strong className="liked-by-latest">
            {String(latestLiker.reaction || "like").toLowerCase() !== "like" && (
              <span className="liked-by-reaction">
                {REACTION_EMOJI[String(latestLiker.reaction || "like").toLowerCase()] || "❤️"}
              </span>
            )}
            {latestLiker.display_name || latestLiker.username}
            {(Number(latestLiker.is_verified) === 1 ||
              ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
                String(latestLiker.username || "").toLowerCase()
              )) && (
              <span
                className={`verified ${
                  ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
                    String(latestLiker.username || "").toLowerCase()
                  )
                    ? "guardian"
                    : ""
                }`}
              >
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
          {Number(postLikes) > 1 ? ` and ${Number(postLikes) - 1} others` : ""}
        </button>
      )}

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
          {isCommunityInteractionLocked ? (
            <div className="community-join-note">Join this community to comment or reply.</div>
          ) : (
            <>
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
                <button className="gif-pick-btn" type="button" onClick={addGifToComment}>
                  GIF
                </button>
                <button onClick={() => sendComment(text, null, commentGifUrl)}>Reply</button>
              </div>
              {commentGifUrl && (
                <div className="comment-gif-preview">
                  <img src={commentGifUrl} alt="Selected GIF" />
                  <button type="button" onClick={() => setCommentGifUrl("")}>×</button>
                </div>
              )}
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
            </>
          )}

          {/* Threaded comments */}
          <div className="vine-thread-list">
          {comments.map((c) => (
  <Comment
    key={c.id}
    comment={c}
    commentLikes={commentLikes}
    commentUserLiked={commentUserLiked}
    commentUserReaction={commentUserReaction}
    setCommentLikes={setCommentLikes}
    setCommentUserLiked={setCommentUserLiked}
    setCommentUserReaction={setCommentUserReaction}
    onReply={sendComment}
    onDelete={deleteComment}
    canReply={!isCommunityInteractionLocked}
    isPostOwner={isPostAuthor}
    currentUserId={current_user_id}
    isModerator={isModerator}
    token={token}
    onReport={openCommentReport}
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
      {showReportModal && typeof document !== "undefined" &&
        createPortal(
          <div
            className="report-modal-backdrop"
            onPointerDown={closeReportModal}
          >
            <div
              className="report-modal"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
            >
              <div className="report-modal-title">Report to Guardian</div>
              {!isReportingOwnTarget && (
                <>
                  <div className="report-modal-subtitle">
                    Choose a complaint category
                  </div>
                  <div className="report-category-grid">
                    {["abuse", "bad content", "disinformation", "privacy violation"].map((cat) => (
                      <button
                        key={cat}
                        className={`report-chip ${reportCategory === cat ? "active" : ""}`}
                        onClick={() => setReportCategory(cat)}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="report-details"
                    placeholder="Extra details (optional)"
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    maxLength={500}
                  />
                </>
              )}
              <div className="report-modal-actions">
                {(isPostAuthor || isModerator) && !reportTarget.commentId && (
                  <button className="danger" onClick={deleteMainPost}>
                    Delete Post
                  </button>
                )}
                <button className="secondary" onClick={() => setShowReportModal(false)}>
                  Cancel
                </button>
                {!isReportingOwnTarget && (
                  <button className="primary" onClick={submitReport}>
                    Send Report
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
      {showLikesModal && typeof document !== "undefined" &&
        createPortal(
          <div className="report-modal-backdrop" onClick={() => setShowLikesModal(false)}>
            <div className="likes-modal" onClick={(e) => e.stopPropagation()}>
              <div className="likes-modal-title">Reactions</div>
              <div className="likes-reaction-summary">
                {Object.entries(reactionCounts || {})
                  .filter(([, total]) => Number(total || 0) > 0)
                  .map(([key, total]) => (
                    <span key={`summary-${post.id}-${key}`} className="likes-summary-chip">
                      {REACTION_EMOJI[key] || "❤️"} {total}
                    </span>
                  ))}
              </div>
              <div className="likes-modal-list">
                {likedUsers.map((u) => (
                  <button
                    key={`like-user-${u.id}`}
                    className="likes-user-row"
                    onClick={() => {
                      setShowLikesModal(false);
                      navigate(`/vine/profile/${u.username}`);
                    }}
                  >
                    <img
                      src={u.avatar_url || DEFAULT_AVATAR}
                      alt={u.username}
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_AVATAR;
                      }}
                    />
                    <div className="likes-user-meta">
                      <div className="likes-user-name">
                        <span className="likes-user-reaction">
                          {REACTION_EMOJI[String(u.reaction || "like").toLowerCase()] || "❤️"}
                        </span>
                        {u.display_name || u.username}
                        {Number(u.is_verified) === 1 && (
                          <span className="likes-verified" title="Verified">
                            ✓
                          </span>
                        )}
                      </div>
                      <div className="likes-user-username">
                        @{u.username} · {REACTION_LABEL[String(u.reaction || "like").toLowerCase()] || "Liked"}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <button className="close-thread-btn bottom" onClick={() => setShowLikesModal(false)}>
                Close
              </button>
            </div>
          </div>,
          document.body
        )}
      {showReactionPicker && typeof document !== "undefined" &&
        createPortal(
          <div
            className="reaction-picker-pop reaction-picker-floating"
            style={{ left: `${reactionPickerPos.left}px`, top: `${reactionPickerPos.top}px` }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {POST_REACTIONS.map((item) => (
              <button
                key={`react-${post.id}-${item.key}`}
                type="button"
                className={`reaction-pill ${postUserReaction === item.key ? "active" : ""}`}
                onClick={() => handleLike(item.key)}
                title={item.label}
              >
                <span>{item.emoji}</span>
                <small>{item.label}</small>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

const areVinePostCardPropsEqual = (prevProps, nextProps) => (
  prevProps.post === nextProps.post &&
  prevProps.focusComments === nextProps.focusComments &&
  prevProps.isMe === nextProps.isMe &&
  prevProps.communityInteractionLocked === nextProps.communityInteractionLocked
);

// ────────────────────────────────────────────────
//  NESTED COMMENT COMPONENT
// ────────────────────────────────────────────────

function Comment({
  comment,
  commentLikes,
  commentUserLiked,
  commentUserReaction,
  setCommentLikes,
  setCommentUserLiked,
  setCommentUserReaction,
  onReply,
  onDelete,
  canReply = true,
  isPostOwner,
  currentUserId,
  isModerator,
  token,
  onReport,
}) {

  const navigate = useNavigate();
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionAnchor, setMentionAnchor] = useState(null);

  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showReplies, setShowReplies] = useState(false);
  const [gifPickerReplyOpen, setGifPickerReplyOpen] = useState(false);
  const [replyGifUrl, setReplyGifUrl] = useState("");
  const [showCommentReactionPicker, setShowCommentReactionPicker] = useState(false);
  const [commentReactionPickerPos, setCommentReactionPickerPos] = useState({ left: 0, top: 0 });
  const commentLikeBtnRef = useRef(null);
  const commentReactionPressTimer = useRef(null);
  const commentReactionLongPressTriggered = useRef(false);

  const addGifToReply = () => setGifPickerReplyOpen(true);
  const currentCommentReaction =
    commentUserReaction?.[comment.id] || (commentUserLiked?.[comment.id] ? "like" : null);

  const canDelete =
    isPostOwner ||
    Number(currentUserId) === Number(comment.user_id) ||
    isModerator;
  const isGuardianComment = ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(comment.username || "").toLowerCase());

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
    const closePicker = () => setShowCommentReactionPicker(false);
    document.addEventListener("pointerdown", closePicker);
    return () => {
      clearTimeout(commentReactionPressTimer.current);
      document.removeEventListener("pointerdown", closePicker);
    };
  }, []);

  useEffect(() => {
    if (!showCommentReactionPicker) return;
    const updatePosition = () => {
      const btn = commentLikeBtnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const pickerWidth = 340;
      const margin = 8;
      const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, window.innerWidth - pickerWidth - margin)
      );
      const top = Math.max(margin, rect.top - 64);
      setCommentReactionPickerPos({ left, top });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showCommentReactionPicker]);

  const handleCommentReaction = async (reaction = "like") => {
    const res = await fetch(`${API}/api/vine/comments/${comment.id}/like`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reaction }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || "Action not allowed");
      return;
    }
    setCommentLikes((prev) => ({
      ...prev,
      [comment.id]: Number(data.like_count || 0),
    }));
    setCommentUserLiked((prev) => ({
      ...prev,
      [comment.id]: Boolean(data.user_liked),
    }));
    setCommentUserReaction((prev) => ({
      ...prev,
      [comment.id]: data.user_reaction || null,
    }));
    setShowCommentReactionPicker(false);
  };

  const startCommentReactionPress = (e) => {
    e.stopPropagation();
    commentReactionLongPressTriggered.current = false;
    clearTimeout(commentReactionPressTimer.current);
    commentReactionPressTimer.current = setTimeout(() => {
      commentReactionLongPressTriggered.current = true;
      setShowCommentReactionPicker(true);
    }, 360);
  };

  const cancelCommentReactionPress = () => {
    clearTimeout(commentReactionPressTimer.current);
  };

  const handleCommentLikeClick = (e) => {
    e.stopPropagation();
    if (commentReactionLongPressTriggered.current) {
      commentReactionLongPressTriggered.current = false;
      return;
    }
    handleCommentReaction("like");
  };

  return (
    <div className="vine-comment-node" id={`comment-${comment.id}`}>
      <GifPickerModal
        open={gifPickerReplyOpen}
        token={token}
        onClose={() => setGifPickerReplyOpen(false)}
        onSelect={(gifUrl) => {
          setReplyGifUrl(gifUrl);
        }}
      />
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

    {(comment.is_verified === 1 || isGuardianComment) && (
      <span className={`verified ${isGuardianComment ? "guardian" : ""}`}>
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
    • {formatPostDate(comment.created_at || comment.sort_time)}
  </span>
</div>

        </div>

        <p className="comment-text">{renderMentions(comment.content, navigate)}</p>

        <div className="comment-actions">
  <button
    ref={commentLikeBtnRef}
    className={`mini-btn ${commentUserLiked?.[comment.id] ? "active-like" : ""}`}
    onPointerDown={startCommentReactionPress}
    onPointerUp={cancelCommentReactionPress}
    onPointerCancel={cancelCommentReactionPress}
    onPointerLeave={cancelCommentReactionPress}
    onContextMenu={(e) => e.preventDefault()}
    onClick={handleCommentLikeClick}
  >
    {commentUserLiked?.[comment.id]
      ? (REACTION_EMOJI[currentCommentReaction] || "❤️")
      : "🤍"}{" "}
    {commentLikes?.[comment.id] ?? comment.like_count ?? 0}
  </button>

  <button className="mini-btn" onClick={() => setReplying(!replying)} disabled={!canReply}>
    Reply
  </button>

  <button
    className="mini-btn"
    onPointerDown={(e) => onReport?.(comment.id, comment.post_id, e)}
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
    }}
  >
    Report
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


        {replying && canReply && (
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
            <button className="gif-pick-btn" type="button" onClick={addGifToReply}>
              GIF
            </button>
            <button
              onClick={() => {
                onReply(replyText, comment.id, replyGifUrl);
                setReplyText("");
                setReplyGifUrl("");
                setReplying(false);
              }}
            >
              Send
            </button>
            {replyGifUrl && (
              <div className="comment-gif-preview">
                <img src={replyGifUrl} alt="Selected GIF" />
                <button type="button" onClick={() => setReplyGifUrl("")}>×</button>
              </div>
            )}
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
        <>
          <button
            className="toggle-replies-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowReplies((prev) => !prev);
            }}
          >
            {showReplies ? "Hide replies" : `View replies (${comment.replies.length})`}
          </button>
          {showReplies && (
            <div className="nested-replies">
              {comment.replies.map((r) => (
                <Comment
                  key={r.id}
                  comment={r}
                  commentLikes={commentLikes}
                  commentUserLiked={commentUserLiked}
                  commentUserReaction={commentUserReaction}
                  setCommentLikes={setCommentLikes}
                  setCommentUserLiked={setCommentUserLiked}
                  setCommentUserReaction={setCommentUserReaction}
                  onReply={onReply}
                  onDelete={onDelete}
                  canReply={canReply}
                  isPostOwner={isPostOwner}
                  currentUserId={currentUserId}
                  isModerator={isModerator}
                  token={token}
                  onReport={onReport}
                />
              ))}
            </div>
          )}
        </>
      )}
      {showCommentReactionPicker && typeof document !== "undefined" &&
        createPortal(
          <div
            className="reaction-picker-pop reaction-picker-floating"
            style={{
              left: `${commentReactionPickerPos.left}px`,
              top: `${commentReactionPickerPos.top}px`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {POST_REACTIONS.map((item) => (
              <button
                key={`comment-react-${comment.id}-${item.key}`}
                type="button"
                className={`reaction-pill ${currentCommentReaction === item.key ? "active" : ""}`}
                onClick={() => handleCommentReaction(item.key)}
                title={item.label}
              >
                <span>{item.emoji}</span>
                <small>{item.label}</small>
              </button>
            ))}
          </div>,
          document.body
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

export default memo(VinePostCard, areVinePostCardPropsEqual);
