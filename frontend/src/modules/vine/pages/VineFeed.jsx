import { useEffect, useState, useRef } from "react";
import heic2any from "heic2any";
import { useNavigate } from "react-router-dom";
import VinePostCard from "./VinePostCard";
import GifPickerModal from "../components/GifPickerModal";
import "./VineFeed.css";
import VineSuggestions from "./VineSuggestions";
import { socket } from "../../../socket";
import { useSearchParams } from "react-router-dom";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const STATUS_COLORS = [
  "#0f766e",
  "#0f172a",
  "#14532d",
  "#7c2d12",
  "#7f1d1d",
  "#1e3a8a",
];
const FEELING_OPTIONS = [
  { value: "", label: "No feeling" },
  { value: "happy", label: "Happy" },
  { value: "sad", label: "Sad" },
  { value: "excited", label: "Excited" },
  { value: "grateful", label: "Grateful" },
  { value: "blessed", label: "Blessed" },
  { value: "motivated", label: "Motivated" },
  { value: "tired", label: "Tired" },
];
const STATUS_REACTIONS = [
  { key: "like", emoji: "👍" },
  { key: "love", emoji: "❤️" },
  { key: "laugh", emoji: "😂" },
  { key: "sad", emoji: "😢" },
  { key: "fire", emoji: "🔥" },
];

// ────────────────────────────────────────────────
//  HELPERS
// ────────────────────────────────────────────────

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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

const extractTaggedUsernames = (text) => {
  if (!text) return [];
  const matches = String(text).match(/@([a-zA-Z0-9._]{1,30})/g) || [];
  const set = new Set();
  matches.forEach((m) => set.add(m.slice(1).toLowerCase()));
  return Array.from(set);
};

const formatStatusTime = (dateValue) => {
  const dt = new Date(dateValue);
  if (Number.isNaN(dt.getTime())) return "";
  const now = new Date();
  const diffMs = now - dt;
  const diffM = Math.floor(diffMs / (1000 * 60));
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffM < 1) return "Just now";
  if (diffM < 60) return `${diffM}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const formatPresenceAgo = (value) => {
  if (!value) return "";
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
    ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
      String(me?.username || "").toLowerCase()
    );
  const bellSeenKey = `vine_notif_seen_at_${me?.id || "anon"}`;

  // ── State ───────────────────────────────────────
  const [posts, setPosts] = useState([]);
  const [content, setContent] = useState("");
  const [images, setImages] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [feeling, setFeeling] = useState("");
  const [unread, setUnread] = useState(0);           // notifications
  const [unreadDMs, setUnreadDMs] = useState(0);     // DMs
  const [handledDeepLink, setHandledDeepLink] = useState(false);
  const [params] = useSearchParams();
  const targetPostId = params.get("post");
  const targetTag = (params.get("tag") || "").trim();
  const [suggestedUsers, setSuggestedUsers] = useState([]);
  const [suggestionSlots, setSuggestionSlots] = useState([]);
  const [trendingPosts, setTrendingPosts] = useState([]);
  const [restriction, setRestriction] = useState(null);
  const [myCommunities, setMyCommunities] = useState([]);
  const [communityId, setCommunityId] = useState("");
  const [statusRail, setStatusRail] = useState([]);
  const [statusComposerOpen, setStatusComposerOpen] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [statusBgColor, setStatusBgColor] = useState(STATUS_COLORS[0]);
  const [statusMediaFile, setStatusMediaFile] = useState(null);
  const [statusMediaPreview, setStatusMediaPreview] = useState("");
  const [statusMediaType, setStatusMediaType] = useState("");
  const [statusViewerOpen, setStatusViewerOpen] = useState(false);
  const [statusViewerUser, setStatusViewerUser] = useState(null);
  const [statusItems, setStatusItems] = useState([]);
  const [statusIndex, setStatusIndex] = useState(0);
  const [statusProgressTick, setStatusProgressTick] = useState(0);
  const [statusViewers, setStatusViewers] = useState([]);
  const [statusViewsOpen, setStatusViewsOpen] = useState(false);
  const [statusViewsLoading, setStatusViewsLoading] = useState(false);
  const [statusReplyText, setStatusReplyText] = useState("");
  const [statusReplySending, setStatusReplySending] = useState(false);
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionAnchor, setMentionAnchor] = useState(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [composeGifUrl, setComposeGifUrl] = useState("");
  const [pollOpen, setPollOpen] = useState(false);
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [activeNowUsers, setActiveNowUsers] = useState([]);
  const [recentlyActiveUsers, setRecentlyActiveUsers] = useState([]);
  const [presenceModalOpen, setPresenceModalOpen] = useState(false);
  const suggestionSlotsRef = useRef([]);
  const createInputRef = useRef(null);

  const revokePreviewUrls = (items) => {
    for (const item of items || []) {
      if (item?.revoke && typeof item.src === "string" && item.src.startsWith("blob:")) {
        URL.revokeObjectURL(item.src);
      }
    }
  };

  const buildPreviewItems = async (files) => {
    const list = Array.from(files || []);
    const items = await Promise.all(
      list.map(
        (file) =>
          new Promise((resolve) => {
            if (file?.type?.startsWith("video/")) {
              resolve({ src: URL.createObjectURL(file), isVideo: true, revoke: true });
              return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve({ src: String(reader.result || ""), isVideo: false, revoke: false });
            reader.onerror = () => resolve({ src: URL.createObjectURL(file), isVideo: false, revoke: true });
            reader.readAsDataURL(file);
          })
      )
    );
    return items.filter((p) => p?.src);
  };

  const convertHeicToJpeg = async (file) => {
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
      console.warn("heic2any conversion failed, trying canvas fallback", err);
    }

    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!jpegBlob) return null;
      return new File(
        [jpegBlob],
        file.name.replace(/\.(heic|heif)$/i, ".jpg"),
        { type: "image/jpeg" }
      );
    } catch (err) {
      console.warn("Canvas HEIC conversion fallback failed", err);
      return null;
    }
  };

  const normalizeImageFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    const converted = await Promise.all(
      files.map(async (file) => {
        const isHeic =
          /heic|heif/i.test(file.type) ||
          /\.heic$/i.test(file.name) ||
          /\.heif$/i.test(file.name);
        if (!isHeic) return file;
        const convertedFile = await convertHeicToJpeg(file);
        if (convertedFile) return convertedFile;
        console.warn("HEIC conversion failed; file skipped");
        alert("HEIC image could not be converted on this device. Please use JPG/PNG/WebP.");
        return null;
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
      const res = await fetch(
        `${API}/api/vine/posts${targetTag ? `?tag=${encodeURIComponent(targetTag)}` : ""}`,
        {
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

  const loadMyCommunities = async () => {
    try {
      const res = await fetch(`${API}/api/vine/communities/mine`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setMyCommunities(Array.isArray(data) ? data : []);
    } catch {
      setMyCommunities([]);
    }
  };

  const loadStatusRail = async () => {
    try {
      const res = await fetch(`${API}/api/vine/statuses/rail`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setStatusRail(Array.isArray(data) ? data : []);
    } catch {
      setStatusRail([]);
    }
  };
  

  useEffect(() => {
    loadFeed(); // initial load
    loadSuggestions();
    loadTrending();
    loadRestrictions();
    loadMyCommunities();
    loadStatusRail();

    const interval = setInterval(loadFeed, 5000); // refresh every 5s
    const statusInterval = setInterval(loadStatusRail, 20000);

    return () => {
      clearInterval(interval);
      clearInterval(statusInterval);
    };
  }, [targetTag]);

  useEffect(() => {
    if (!statusViewerOpen) return;
    const current = statusItems[statusIndex];
    if (!current || Number(current.seen_by_viewer) === 1) return;

    const markSeen = async () => {
      try {
        await fetch(`${API}/api/vine/statuses/${current.id}/view`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        setStatusItems((prev) =>
          prev.map((s, idx) => (idx === statusIndex ? { ...s, seen_by_viewer: 1 } : s))
        );
        setStatusRail((prev) =>
          prev.map((row) =>
            Number(row.user_id) === Number(current.user_id)
              ? { ...row, unseen_count: Math.max(0, Number(row.unseen_count || 0) - 1) }
              : row
          )
        );
      } catch {}
    };

    markSeen();
  }, [statusViewerOpen, statusItems, statusIndex, token]);

  useEffect(() => {
    if (!statusViewerOpen || !statusItems.length) return;
    if (statusViewsOpen) return;
    const current = statusItems[statusIndex];
    if (!current) return;
    const duration =
      current.media_type === "video" ? 8000 : current.media_type === "image" ? 6000 : 4500;
    const timer = setTimeout(() => {
      setStatusIndex((prev) => {
        if (prev >= statusItems.length - 1) {
          setStatusViewerOpen(false);
          return prev;
        }
        return prev + 1;
      });
    }, duration);
    setStatusProgressTick((k) => k + 1);
    return () => clearTimeout(timer);
  }, [statusViewerOpen, statusIndex, statusItems, statusViewsOpen]);

  useEffect(() => {
    setStatusReplyText("");
  }, [statusViewerOpen, statusIndex]);

  useEffect(() => {
    if (!statusViewerOpen || !statusItems[statusIndex]) return;
    const current = statusItems[statusIndex];
    const isMine = Number(current.user_id) === Number(me?.id || 0);
    if (!isMine) {
      setStatusViewers([]);
      setStatusViewsOpen(false);
      setStatusViewsLoading(false);
      return;
    }

    const loadViews = async () => {
      setStatusViewsLoading(true);
      try {
        const res = await fetch(`${API}/api/vine/statuses/${current.id}/views`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setStatusViewers(Array.isArray(data) ? data : []);
      } catch {
        setStatusViewers([]);
      } finally {
        setStatusViewsLoading(false);
      }
    };

    loadViews();
  }, [statusViewerOpen, statusIndex, statusItems, me?.id, token]);

  useEffect(() => {
    return () => {
      if (statusMediaPreview) URL.revokeObjectURL(statusMediaPreview);
    };
  }, [statusMediaPreview]);

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

  const submitStatus = async () => {
    const text = statusText.trim();
    if (!text && !statusMediaFile) return;
    try {
      const body = new FormData();
      if (text) body.append("text", text);
      body.append("bg_color", statusBgColor);
      if (statusMediaFile) body.append("media", statusMediaFile);
      const res = await fetch(`${API}/api/vine/statuses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to post status");
        return;
      }
      setStatusText("");
      setStatusMediaFile(null);
      if (statusMediaPreview) URL.revokeObjectURL(statusMediaPreview);
      setStatusMediaPreview("");
      setStatusMediaType("");
      setStatusComposerOpen(false);
      loadStatusRail();
    } catch {
      alert("Failed to post status");
    }
  };

  const openStatusViewer = async (row) => {
    try {
      const res = await fetch(`${API}/api/vine/statuses/user/${row.user_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      if (!list.length) return;
      const firstUnseen = list.findIndex((s) => Number(s.seen_by_viewer) !== 1);
      setStatusItems(list);
      setStatusViewerUser(row);
      setStatusIndex(firstUnseen >= 0 ? firstUnseen : 0);
      setStatusProgressTick((k) => k + 1);
      setStatusViewerOpen(true);
    } catch {}
  };

  const deleteCurrentStatus = async () => {
    const current = statusItems[statusIndex];
    if (!current) return;
    if (Number(current.user_id) !== Number(me?.id || 0)) return;
    const ok = window.confirm("Delete this status?");
    if (!ok) return;
    try {
      const res = await fetch(`${API}/api/vine/statuses/${current.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to delete status");
        return;
      }

      const next = statusItems.filter((_, idx) => idx !== statusIndex);
      if (!next.length) {
        setStatusViewerOpen(false);
      } else {
        setStatusItems(next);
        setStatusIndex((prev) => Math.max(0, Math.min(prev, next.length - 1)));
      }
      setStatusViewsOpen(false);
      loadStatusRail();
    } catch {
      alert("Failed to delete status");
    }
  };

  const reactToCurrentStatus = async (reaction) => {
    const current = statusItems[statusIndex];
    if (!current || !reaction) return;
    try {
      const res = await fetch(`${API}/api/vine/statuses/${current.id}/react`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reaction }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to react");
        return;
      }
      const counts = data?.counts || {};
      setStatusItems((prev) =>
        prev.map((s, idx) =>
          idx === statusIndex
            ? {
                ...s,
                viewer_reaction: data?.viewer_reaction || null,
                reaction_like_count: Number(counts.like || 0),
                reaction_love_count: Number(counts.love || 0),
                reaction_laugh_count: Number(counts.laugh || 0),
                reaction_sad_count: Number(counts.sad || 0),
                reaction_fire_count: Number(counts.fire || 0),
              }
            : s
        )
      );
    } catch {
      alert("Failed to react");
    }
  };

  const sendStatusReply = async () => {
    const current = statusItems[statusIndex];
    if (!current) return;
    const text = statusReplyText.trim();
    if (!text) return;
    setStatusReplySending(true);
    try {
      const res = await fetch(`${API}/api/vine/statuses/${current.id}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || "Failed to send reply");
        return;
      }
      setStatusReplyText("");
      alert("Reply sent to inbox.");
    } catch {
      alert("Failed to send reply");
    } finally {
      setStatusReplySending(false);
    }
  };

  const applyComposeFormat = (leftToken, rightToken = leftToken) => {
    const el = createInputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const before = content.slice(0, start);
    const selected = content.slice(start, end);
    const after = content.slice(end);
    const next = `${before}${leftToken}${selected}${rightToken}${after}`;
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      if (selected.length > 0) {
        el.setSelectionRange(start + leftToken.length, end + leftToken.length);
      } else {
        const cursor = start + leftToken.length;
        el.setSelectionRange(cursor, cursor);
      }
    });
  };

  const insertTagToken = () => {
    const el = createInputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const before = content.slice(0, start);
    const after = content.slice(end);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const next = `${before}${needsSpace ? " " : ""}@${after}`;
    const caret = start + (needsSpace ? 2 : 1);
    setContent(next);
    setMentionAnchor({ start: caret - 1, end: caret, query: "" });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const handleOpenNotifications = () => {
    localStorage.setItem(bellSeenKey, new Date().toISOString());
    setUnread(0);
    navigate("/vine/notifications");
  };

  // ── Real-time Notifications & DMs ───────────────
  useEffect(() => {
    if (!token) return;

    // Fetch bell badge count
    const fetchUnreadNotifications = async () => {
      try {
        const since = localStorage.getItem(bellSeenKey);
        if (since) {
          const res = await fetch(
            `${API}/api/vine/notifications/unseen-count?since=${encodeURIComponent(since)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const data = await res.json().catch(() => ({}));
          setUnread(Number(data.count || 0));
          return;
        }

        const res = await fetch(`${API}/api/vine/notifications/unread-count`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        setUnread(Number(data.count || 0));
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
    socket.on("notification", fetchUnreadNotifications);
    socket.on("dm_received", fetchUnreadDMs);
    socket.on("messages_seen", fetchUnreadDMs);

    return () => {
      socket.off("notification", fetchUnreadNotifications);
      socket.off("dm_received", fetchUnreadDMs);
      socket.off("messages_seen", fetchUnreadDMs);
    };
  }, [token, bellSeenKey]);

  useEffect(() => {
    if (!token) return;
    const loadPresence = async () => {
      try {
        const res = await fetch(`${API}/api/dms/presence`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        setActiveNowUsers(Array.isArray(data?.active_now) ? data.active_now : []);
        setRecentlyActiveUsers(Array.isArray(data?.recently_active) ? data.recently_active : []);
      } catch {
        setActiveNowUsers([]);
        setRecentlyActiveUsers([]);
      }
    };
    loadPresence();
    const interval = setInterval(loadPresence, 30 * 1000);
    socket.on("dm_received", loadPresence);
    socket.on("messages_seen", loadPresence);
    return () => {
      clearInterval(interval);
      socket.off("dm_received", loadPresence);
      socket.off("messages_seen", loadPresence);
    };
  }, [token]);

  const openDmFromPresence = async (u) => {
    try {
      const res = await fetch(`${API}/api/dms/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: u.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Cannot start conversation");
        return;
      }
      setPresenceModalOpen(false);
      if (data.conversationId) {
        navigate(`/vine/dms/${data.conversationId}`);
      } else {
        const p = new URLSearchParams({
          username: u.username || "",
          displayName: u.display_name || u.username || "",
        });
        navigate(`/vine/dms/new/${u.id}?${p.toString()}`);
      }
    } catch {
      alert("Cannot start conversation");
    }
  };

  useEffect(() => {
    document.title = "Vine — Feed";
  }, []);

  // ── Post Creation ───────────────────────────────
  const submitPost = async () => {
    if (!content.trim() && images.length === 0 && !feeling && !composeGifUrl) return;
    if (composeGifUrl && images.length > 0) {
      alert("You can post either a GIF or photos/videos, not both.");
      return;
    }

    try {
      const formData = new FormData();
      const normalizedContent = content.trim();
      if (pollOpen && !normalizedContent) {
        alert("Write your poll text in the main create box.");
        return;
      }
      const outgoingContent = feeling
        ? `[[feeling:${feeling}]]${normalizedContent ? ` ${normalizedContent}` : ""}`
        : normalizedContent;
      const contentWithGif = composeGifUrl
        ? `${outgoingContent}${outgoingContent ? "\n" : ""}${composeGifUrl}`
        : outgoingContent;
      if (contentWithGif) formData.append("content", contentWithGif);
      if (communityId) formData.append("community_id", String(communityId));
      images.forEach((img) => formData.append("images", img));
      const cleanedPollOptions = pollOptions.map((o) => String(o || "").trim()).filter(Boolean).slice(0, 4);
      if (pollOpen) {
        if (cleanedPollOptions.length < 2) {
          alert("Poll needs at least 2 options.");
          return;
        }
        formData.append("poll_question", normalizedContent.slice(0, 240));
        formData.append("poll_options", JSON.stringify(cleanedPollOptions));
      }

      const res = await fetch(`${API}/api/vine/posts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const newPost = await res.json();
      setPosts((prev) => [newPost, ...prev]);
      setContent("");
      setFeeling("");
      setImages([]);
      setPreviews((prev) => {
        revokePreviewUrls(prev);
        return [];
      });
      setCommunityId("");
      setComposeGifUrl("");
      setPollOpen(false);
      setPollOptions(["", ""]);
    } catch (err) {
      console.error("Post creation error", err);
    }
  };

  const addGifToComposer = () => {
    if (images.length > 0) {
      alert("Remove photos/videos first. GIF and photos/videos cannot be posted together.");
      return;
    }
    setGifPickerOpen(true);
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
      <GifPickerModal
        open={gifPickerOpen}
        token={token}
        onClose={() => setGifPickerOpen(false)}
        onSelect={(gifUrl) => {
          setComposeGifUrl(gifUrl);
        }}
      />
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


        <div className="notif-bell" onClick={handleOpenNotifications}>
          🔔
          {unread > 0 && <span className="notif-badge">{unread}</span>}
        </div>

        <div className="nav-right">
          <button
            className="nav-btn help-btn"
            onClick={() => setPresenceModalOpen(true)}
          >
            Active now ({activeNowUsers.length})
          </button>
          <input
            className="vine-search nav-search desktop-only"
            placeholder="Search"
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

          <button className="discover-btn" onClick={() => navigate("/vine/communities")}>
            👥 Communities
          </button>

          {isModerator && (
            <button
              className="discover-btn mobile-only"
              onClick={() => navigate("/vine/guardian/analytics")}
            >
              Guardian
            </button>
          )}

          <input
            className="vine-search dm-search mobile-only"
            placeholder="Search"
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
        {targetTag && (
          <div className="hashtag-filter-banner">
            Showing posts for <strong>#{targetTag}</strong>
            <button onClick={() => navigate("/vine/feed")}>Clear</button>
          </div>
        )}
        {restriction && (
          <div className="suspension-banner">
            <div className="suspension-banner-text">
              Account restricted from likes/comments.
              {restriction.reason ? ` Reason: ${restriction.reason}` : ""}
            </div>
            <button onClick={submitAppeal}>Appeal to Guardian</button>
          </div>
        )}
        <div className="vine-statuses-rail">
          <button
            className="status-add-card"
            onClick={() => {
              setStatusText("");
              setStatusBgColor(STATUS_COLORS[0]);
              setStatusMediaFile(null);
              if (statusMediaPreview) URL.revokeObjectURL(statusMediaPreview);
              setStatusMediaPreview("");
              setStatusMediaType("");
              setStatusComposerOpen(true);
            }}
          >
            <span className="status-add-plus">+</span>
            <span>My Status</span>
          </button>
          {statusRail.map((row) => {
            const avatarSrc = row.avatar_url
              ? row.avatar_url.startsWith("http")
                ? row.avatar_url
                : `${API}${row.avatar_url}`
              : DEFAULT_AVATAR;
            return (
              <button
                key={`status-user-${row.user_id}`}
                className={`status-user-chip ${Number(row.unseen_count || 0) > 0 ? "unseen" : ""}`}
                onClick={() => openStatusViewer(row)}
              >
                <img
                  src={avatarSrc}
                  alt={row.username}
                  onError={(e) => {
                    e.currentTarget.src = DEFAULT_AVATAR;
                  }}
                />
                <span>{row.display_name || row.username}</span>
              </button>
            );
          })}
        </div>

        {/* Create Post Box */}
        <div className="vine-create-box">
        <div className="create-format-toolbar">
          <button type="button" onClick={() => applyComposeFormat("**")} title="Bold">B</button>
          <button type="button" onClick={() => applyComposeFormat("*")} title="Italic"><em>I</em></button>
          <button type="button" onClick={() => applyComposeFormat("__")} title="Underline"><u>U</u></button>
          <button type="button" onClick={() => applyComposeFormat("~~")} title="Strikethrough"><s>S</s></button>
          <button type="button" onClick={insertTagToken} title="Tag user">@</button>
        </div>
        <textarea
                      className={`create-textarea ${
                        content.length > 0 && content.length < 120 ? "big-text" : ""
                      }`}
                      ref={createInputRef}
                      placeholder="What's happening?"
                      value={content}
                      maxLength={2000}
                      onChange={(e) => {
                        const value = e.target.value;
                        setContent(value);
                        setMentionAnchor(getMentionAnchor(value, e.target.selectionStart));
                      }}
                      onKeyDown={(e) => {
                        if (mentionAnchor && mentionResults.length > 0 && e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          const picked = mentionResults[0];
                          if (picked?.username) {
                            const next = applyMention(content, mentionAnchor, picked.username);
                            setContent(next);
                            setMentionAnchor(null);
                            setMentionResults([]);
                            requestAnimationFrame(() => {
                              createInputRef.current?.focus();
                            });
                          }
                          return;
                        }
                        // Ctrl/Cmd + Enter to post
                        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                          submitPost();
                        }
                      }}
                    />
          {extractTaggedUsernames(content).length > 0 && (
            <div className="tagged-users-preview">
              Tagged: {extractTaggedUsernames(content).map((u) => `@${u}`).join(", ")}
            </div>
          )}
          {mentionResults.length > 0 && mentionAnchor && (
            <div className="feed-mention-suggest-list">
              {mentionResults.map((u) => (
                <button
                  key={`feed-mention-${u.id}`}
                  className="feed-mention-suggest-item"
                  onClick={() => {
                    setContent((prev) => applyMention(prev, mentionAnchor, u.username));
                    setMentionAnchor(null);
                    setMentionResults([]);
                    requestAnimationFrame(() => {
                      createInputRef.current?.focus();
                    });
                  }}
                >
                  <img
                    src={u.avatar_url ? (u.avatar_url.startsWith("http") ? u.avatar_url : `${API}${u.avatar_url}`) : DEFAULT_AVATAR}
                    alt={u.username}
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_AVATAR;
                    }}
                  />
                  <div>
                    <div className="feed-mention-name">{u.display_name || u.username}</div>
                    <div className="feed-mention-handle">@{u.username}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {composeGifUrl && (
            <div className="gif-preview-chip">
              <img src={composeGifUrl} alt="Selected GIF" />
              <button type="button" onClick={() => setComposeGifUrl("")}>×</button>
            </div>
          )}

          <div className="create-footer">
            <div className="greeting">
              {getGreeting()}, <span className="name">{myUsername}</span>
              <div className="create-feeling-row">
                <span>Feeling:</span>
                <select
                  value={feeling}
                  onChange={(e) => setFeeling(e.target.value)}
                  className="feeling-select"
                >
                  {FEELING_OPTIONS.map((opt) => (
                    <option key={opt.value || "none"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="right-actions">
              <span className="char-count">{content.length}/2000</span>
              <button className="gif-insert-btn" type="button" onClick={addGifToComposer}>
                GIF
              </button>
              <button
                className="gif-insert-btn"
                type="button"
                onClick={() => setPollOpen((prev) => !prev)}
              >
                Poll
              </button>

              <label className="image-picker media-icon-picker" title="Add photo or video">
                <span className="media-icon" aria-hidden="true">📷</span>
                <span className="media-icon" aria-hidden="true">🎥</span>
                <input
                  type="file"
                  accept="image/*,video/*,.heic,.heif"
                  multiple
                  hidden
                  onChange={async (e) => {
                    if (composeGifUrl) {
                      alert("Remove GIF first. GIF and photos/videos cannot be posted together.");
                      e.target.value = "";
                      return;
                    }
                    const files = await normalizeImageFiles(e.target.files);
                    if (!files.length) return;
                    setImages(files);
                    const previewItems = await buildPreviewItems(files);
                    setPreviews((prev) => {
                      revokePreviewUrls(prev);
                      return previewItems;
                    });
                  }}
                />
              </label>

              {previews.length > 0 && (
                <div className="preview-strip">
                  {previews.map((preview, i) => (
                    <div key={i} className="preview-tile">
                      {preview.isVideo ? (
                        <video src={preview.src} muted playsInline preload="metadata" />
                      ) : (
                        <img src={preview.src} alt="" />
                      )}
                      <button
                        className="remove-preview"
                        onClick={() => {
                          const removed = previews[i];
                          if (removed?.revoke && removed?.src?.startsWith("blob:")) {
                            URL.revokeObjectURL(removed.src);
                          }
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
          {pollOpen && (
            <div className="composer-poll-builder">
              {pollOptions.map((opt, idx) => (
                <input
                  key={`poll-opt-${idx}`}
                  type="text"
                  placeholder={`Option ${idx + 1}`}
                  maxLength={180}
                  value={opt}
                  onChange={(e) =>
                    setPollOptions((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                  }
                />
              ))}
              <div className="composer-poll-actions">
                {pollOptions.length < 4 && (
                  <button type="button" onClick={() => setPollOptions((prev) => [...prev, ""])}>
                    + Add option
                  </button>
                )}
                {pollOptions.length > 2 && (
                  <button type="button" onClick={() => setPollOptions((prev) => prev.slice(0, -1))}>
                    − Remove option
                  </button>
                )}
              </div>
            </div>
          )}
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
                          {(Number(p.is_verified) === 1 || ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(p.username || "").toLowerCase())) && (
                            <span className={`verified ${["vine guardian","vine_guardian","vine news","vine_news"].includes(String(p.username || "").toLowerCase()) ? "guardian" : ""}`}>
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
                            {(Number(u.is_verified) === 1 || ["vine guardian","vine_guardian","vine news","vine_news"].includes(String(u.username || "").toLowerCase())) && (
                              <span className={`verified ${["vine guardian","vine_guardian","vine news","vine_news"].includes(String(u.username || "").toLowerCase()) ? "guardian" : ""}`}>
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
              <VinePostCard
                post={post}
                communityInteractionLocked={
                  Number(post.community_id) > 0 &&
                  Number(post.viewer_community_member) !== 1
                }
              />
            </div>
          ))}

          {posts.length > 0 && <p className="no-more-posts">No more posts</p>}
          {posts.length === 0 && <p className="no-posts-hint">No posts yet 🌱</p>}
        </div>
        <footer className="vine-feed-footer">
          <div>© {new Date().getFullYear()} Vine. All rights reserved.</div>
          <div className="vine-footer-links">
            <button onClick={() => navigate("/vine/help")}>Help</button>
            <button onClick={() => navigate("/vine/legal/terms")}>Terms of Service</button>
            <button onClick={() => navigate("/vine/legal/privacy")}>Privacy Policy</button>
            <button onClick={() => navigate("/vine/legal/cookies")}>Cookie Policy</button>
            <button onClick={() => navigate("/vine/legal/accessibility")}>Accessibility</button>
          </div>
        </footer>
      </div>

      {/* Right Sidebar (currently empty – good place for VineSuggestions later) */}
      <div className="vine-right-sidebar">
        {/* You can add <VineSuggestions /> here if desired */}
      </div>

      {presenceModalOpen && (
        <div className="feed-presence-backdrop" onClick={() => setPresenceModalOpen(false)}>
          <div className="feed-presence-modal" onClick={(e) => e.stopPropagation()}>
            <div className="feed-presence-head">
              <h3>Active now</h3>
              <button onClick={() => setPresenceModalOpen(false)}>✕</button>
            </div>
            <div className="feed-presence-section">
              <h4>Active now ({activeNowUsers.length})</h4>
              {activeNowUsers.length === 0 ? (
                <div className="feed-presence-empty">No one active right now.</div>
              ) : (
                <div className="feed-presence-list">
                  {activeNowUsers.map((u) => {
                    const avatar = u.avatar_url
                      ? (u.avatar_url.startsWith("http") ? u.avatar_url : `${API}${u.avatar_url}`)
                      : DEFAULT_AVATAR;
                    return (
                      <button key={`presence-active-${u.id}`} className="feed-presence-item" onClick={() => openDmFromPresence(u)}>
                        <img src={avatar} alt={u.username} onError={(e) => { e.currentTarget.src = DEFAULT_AVATAR; }} />
                        <div>
                          <div className="feed-presence-name">{u.display_name || u.username}</div>
                          <div className="feed-presence-time">online now</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="feed-presence-section">
              <h4>Recently active</h4>
              {recentlyActiveUsers.length === 0 ? (
                <div className="feed-presence-empty">No recent activity.</div>
              ) : (
                <div className="feed-presence-list">
                  {recentlyActiveUsers.map((u) => {
                    const avatar = u.avatar_url
                      ? (u.avatar_url.startsWith("http") ? u.avatar_url : `${API}${u.avatar_url}`)
                      : DEFAULT_AVATAR;
                    return (
                      <button key={`presence-recent-${u.id}`} className="feed-presence-item" onClick={() => openDmFromPresence(u)}>
                        <img src={avatar} alt={u.username} onError={(e) => { e.currentTarget.src = DEFAULT_AVATAR; }} />
                        <div>
                          <div className="feed-presence-name">{u.display_name || u.username}</div>
                          <div className="feed-presence-time">{formatPresenceAgo(u.last_active_at)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {statusComposerOpen && (
        <div className="status-modal-backdrop" onClick={() => setStatusComposerOpen(false)}>
          <div className="status-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create status</h3>
            <textarea
              value={statusText}
              maxLength={500}
              placeholder="Share a quick text status..."
              onChange={(e) => setStatusText(e.target.value)}
            />
            <label className="status-media-picker">
              Add photo/video
              <input
                type="file"
                accept="image/*,video/*,.heic,.heif"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const isHeic =
                    /heic|heif/i.test(file.type) ||
                    /\.heic$/i.test(file.name) ||
                    /\.heif$/i.test(file.name);
                  let picked = file;
                  if (isHeic) {
                    const convertedFile = await convertHeicToJpeg(file);
                    if (!convertedFile) {
                      alert("HEIC image could not be converted on this device. Please use JPG/PNG/WebP.");
                      return;
                    }
                    picked = convertedFile;
                  }
                  if (statusMediaPreview) URL.revokeObjectURL(statusMediaPreview);
                  setStatusMediaFile(picked);
                  setStatusMediaType(picked.type.startsWith("video/") ? "video" : "image");
                  setStatusMediaPreview(URL.createObjectURL(picked));
                }}
              />
            </label>
            {statusMediaPreview && (
              <div className="status-media-preview-wrap">
                {statusMediaType === "video" ? (
                  <video src={statusMediaPreview} controls />
                ) : (
                  <img src={statusMediaPreview} alt="Status preview" />
                )}
                <button
                  className="status-media-remove"
                  onClick={() => {
                    setStatusMediaFile(null);
                    if (statusMediaPreview) URL.revokeObjectURL(statusMediaPreview);
                    setStatusMediaPreview("");
                    setStatusMediaType("");
                  }}
                >
                  Remove media
                </button>
              </div>
            )}
            <div className="status-color-row">
              {STATUS_COLORS.map((c) => (
                <button
                  key={c}
                  className={`status-color-dot ${statusBgColor === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setStatusBgColor(c)}
                />
              ))}
            </div>
            <div className="status-modal-actions">
              <button
                onClick={() => {
                  setStatusComposerOpen(false);
                  setStatusMediaFile(null);
                  if (statusMediaPreview) URL.revokeObjectURL(statusMediaPreview);
                  setStatusMediaPreview("");
                  setStatusMediaType("");
                }}
              >
                Cancel
              </button>
              <button className="primary" onClick={submitStatus}>
                Post status
              </button>
            </div>
          </div>
        </div>
      )}

      {statusViewerOpen && statusItems[statusIndex] && (
        <div className="status-viewer-backdrop" onClick={() => setStatusViewerOpen(false)}>
          <div className={`status-viewer ${statusViewsOpen ? "paused" : ""}`} onClick={(e) => e.stopPropagation()}>
            <div className="status-progress-row">
              {statusItems.map((_, idx) => {
                const current = statusItems[statusIndex];
                const dur =
                  current?.media_type === "video"
                    ? 8000
                    : current?.media_type === "image"
                    ? 6000
                    : 4500;
                return (
                  <div className="status-progress-seg" key={`sp-${idx}`}>
                    <div
                      key={`spf-${idx}-${statusProgressTick}`}
                      className={`status-progress-fill ${
                        idx < statusIndex
                          ? "done"
                          : idx === statusIndex
                          ? "active"
                          : ""
                      }`}
                      style={idx === statusIndex ? { animationDuration: `${dur}ms` } : undefined}
                    />
                  </div>
                );
              })}
            </div>
            <div className="status-viewer-top">
              <div className="status-viewer-user">
                <img
                  src={
                    statusViewerUser?.avatar_url
                      ? statusViewerUser.avatar_url.startsWith("http")
                        ? statusViewerUser.avatar_url
                        : `${API}${statusViewerUser.avatar_url}`
                      : DEFAULT_AVATAR
                  }
                  alt={statusViewerUser?.username || "status"}
                  onError={(e) => {
                    e.currentTarget.src = DEFAULT_AVATAR;
                  }}
                />
                <div>
                  <div className="status-viewer-title-name">
                    {statusViewerUser?.display_name || statusViewerUser?.username || "Status"}
                    {(Number(statusViewerUser?.is_verified) === 1 ||
                      ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
                        String(statusViewerUser?.username || "").toLowerCase()
                      )) && (
                      <span
                        className={`verified ${
                          ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
                            String(statusViewerUser?.username || "").toLowerCase()
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
                  </div>
                  <small>{formatStatusTime(statusItems[statusIndex].created_at)}</small>
                </div>
              </div>
              <div className="status-viewer-top-actions">
                {Number(statusItems[statusIndex]?.user_id) === Number(me?.id || 0) && (
                  <button className="status-delete-btn" onClick={deleteCurrentStatus}>
                    Delete
                  </button>
                )}
                <button className="status-close-btn" onClick={() => setStatusViewerOpen(false)}>
                  ×
                </button>
              </div>
            </div>
            <div
              className="status-viewer-body"
              style={{ background: statusItems[statusIndex].bg_color || STATUS_COLORS[0] }}
            >
              {statusItems[statusIndex].media_url ? (
                <div className="status-viewer-media-wrap">
                  {statusItems[statusIndex].media_type === "video" ? (
                    <video
                      src={statusItems[statusIndex].media_url}
                      controls
                      autoPlay
                      playsInline
                    />
                  ) : (
                    <img src={statusItems[statusIndex].media_url} alt="Status media" />
                  )}
                  {statusItems[statusIndex].text_content ? (
                    <div className="status-viewer-caption">
                      {statusItems[statusIndex].text_content}
                    </div>
                  ) : null}
                </div>
              ) : (
                statusItems[statusIndex].text_content
              )}
            </div>
            <div className="status-interact-row">
              <div className="status-reactions">
                {STATUS_REACTIONS.map((r) => {
                  const count = Number(statusItems[statusIndex]?.[`reaction_${r.key}_count`] || 0);
                  const active = String(statusItems[statusIndex]?.viewer_reaction || "") === r.key;
                  return (
                    <button
                      key={`status-react-${r.key}`}
                      className={`status-reaction-btn ${active ? "active" : ""}`}
                      onClick={() => reactToCurrentStatus(r.key)}
                      title={`React ${r.key}`}
                    >
                      <span>{r.emoji}</span>
                      <small>{count}</small>
                    </button>
                  );
                })}
              </div>
              {Number(statusItems[statusIndex]?.user_id) !== Number(me?.id || 0) && (
                <div className="status-reply-box">
                  <input
                    value={statusReplyText}
                    onChange={(e) => setStatusReplyText(e.target.value)}
                    placeholder="Reply to this status..."
                    maxLength={1000}
                  />
                  <button onClick={sendStatusReply} disabled={statusReplySending || !statusReplyText.trim()}>
                    {statusReplySending ? "Sending..." : "Reply"}
                  </button>
                </div>
              )}
            </div>
            <div className="status-viewer-actions">
              <button
                disabled={statusIndex <= 0}
                onClick={() => setStatusIndex((i) => Math.max(0, i - 1))}
              >
                Prev
              </button>
              <div className="status-viewer-mid">
                <span>
                  {statusIndex + 1}/{statusItems.length}
                </span>
                {Number(statusItems[statusIndex]?.user_id) === Number(me?.id || 0) && (
                  <button
                    className="status-views-btn"
                    onClick={() => setStatusViewsOpen(true)}
                    title="Viewers"
                  >
                    👁 {statusViewsLoading ? "..." : statusViewers.length}
                  </button>
                )}
              </div>
              <button
                disabled={statusIndex >= statusItems.length - 1}
                onClick={() => setStatusIndex((i) => Math.min(statusItems.length - 1, i + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
      {statusViewsOpen && (
        <div className="status-modal-backdrop" onClick={() => setStatusViewsOpen(false)}>
          <div className="status-modal status-views-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Viewed by ({statusViewers.length})</h3>
            <div className="status-viewers-list">
              {statusViewsLoading && <div className="status-viewer-empty">Loading...</div>}
              {!statusViewsLoading && statusViewers.length === 0 && (
                <div className="status-viewer-empty">No views yet</div>
              )}
              {!statusViewsLoading &&
                statusViewers.map((v) => (
                  <div key={`status-viewer-${v.id}-${v.viewed_at}`} className="status-viewer-row">
                    <img
                      src={
                        v.avatar_url
                          ? v.avatar_url.startsWith("http")
                            ? v.avatar_url
                            : `${API}${v.avatar_url}`
                          : DEFAULT_AVATAR
                      }
                      alt={v.username}
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_AVATAR;
                      }}
                      onClick={() => {
                        setStatusViewsOpen(false);
                        setStatusViewerOpen(false);
                        navigate(`/vine/profile/${v.username}`);
                      }}
                    />
                    <div
                      className="status-viewer-meta-click"
                      onClick={() => {
                        setStatusViewsOpen(false);
                        setStatusViewerOpen(false);
                        navigate(`/vine/profile/${v.username}`);
                      }}
                    >
                      <div className="status-viewer-name">
                        {v.display_name || v.username}
                        {(Number(v.is_verified) === 1 ||
                          ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
                            String(v.username || "").toLowerCase()
                          )) && (
                          <span
                            className={`verified ${
                              ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
                                String(v.username || "").toLowerCase()
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
                      </div>
                      <small>@{v.username}</small>
                    </div>
                    <time>{new Date(v.viewed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                  </div>
                ))}
            </div>
            <div className="status-modal-actions">
              <button onClick={() => setStatusViewsOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
