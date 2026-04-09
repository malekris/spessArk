import { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import VinePostCard from "./VinePostCard";
import GifPickerModal from "../components/GifPickerModal";
import ChatWindow from "../../../components/dms/ChatWindow";
import "./VineFeed.css";
import VineSuggestions from "./VineSuggestions";
import { socket } from "../../../socket";
import { useSearchParams } from "react-router-dom";
import { convertHeicFileToJpeg, isHeicLikeFile } from "../utils/heic";
import { createClientRequestId } from "../../../utils/requestId";
import { getVineNotificationsSeenAt, setVineNotificationsSeenAt } from "../utils/vineAuth";

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
const POST_BG_COLORS = [
  "#14532d",
  "#0f766e",
  "#1d4ed8",
  "#7c3aed",
  "#b91c1c",
  "#92400e",
  "#0f172a",
];
const POST_MAX_LENGTH = 5000;
const POST_MAX_MEDIA_FILES = 30;
const STYLED_TEXT_WORD_LIMIT = 22;
const FEED_MEDIA_UPLOADS_FROZEN = false;
const STATUS_MEDIA_UPLOADS_FROZEN = false;
const STATUS_REACTIONS = [
  { key: "like", emoji: "👍" },
  { key: "love", emoji: "❤️" },
  { key: "laugh", emoji: "😂" },
  { key: "sad", emoji: "😢" },
  { key: "fire", emoji: "🔥" },
];
const FEED_REFRESH_FALLBACK_MS = 60 * 1000;
const STATUS_RAIL_REFRESH_FALLBACK_MS = 60 * 1000;
const FEED_EVENT_DEBOUNCE_MS = 350;
const MAX_VISIBLE_BIRTHDAYS = 5;
const DESKTOP_DM_WINDOW_LIMIT = 3;
const formatBadgeCount = (count) => (Number(count || 0) > 99 ? "99+" : String(Number(count || 0)));
const formatCompactCount = (count) =>
  new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(count || 0));

// ────────────────────────────────────────────────
//  HELPERS
// ────────────────────────────────────────────────

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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

const formatBirthdayDate = (row) => {
  if (row?.next_birthday_at) {
    const nextBirthday = new Date(row.next_birthday_at);
    if (!Number.isNaN(nextBirthday.getTime())) {
      return nextBirthday.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
  }
  const month = Number(row?.birth_month || 0);
  const day = Number(row?.birth_day || 0);
  if (!month || !day) return "";
  const fallback = new Date(2000, month - 1, day);
  return fallback.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

const formatBirthdayCountdown = (daysUntil) => {
  const safeDays = Number(daysUntil || 0);
  if (safeDays <= 0) return "Today";
  if (safeDays === 1) return "Tomorrow";
  return `In ${safeDays} days`;
};

const hasSpecialVerifiedBadge = (username) =>
  ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
    String(username || "").toLowerCase()
  );

const showsVerifiedBadge = (user) =>
  Number(user?.is_verified) === 1 || hasSpecialVerifiedBadge(user?.username);

const isVineNewsIdentity = (row) => {
  const username = String(row?.username || "").trim().toLowerCase();
  const displayName = String(row?.display_name || "").trim().toLowerCase();
  const badgeType = String(row?.badge_type || "").trim().toLowerCase();
  return (
    username === "vine_news" ||
    username === "vine news" ||
    displayName === "vine news" ||
    badgeType === "news"
  );
};

const dedupePresenceUsers = (...groups) => {
  const seen = new Set();
  return groups
    .flat()
    .filter(Boolean)
    .filter((user) => {
      const id = Number(user?.id || 0);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
};

const matchesDesktopDmSearch = (user, rawQuery) => {
  const query = String(rawQuery || "").trim().toLowerCase();
  if (!query) return true;
  return [user?.display_name, user?.username]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(query));
};

const FEED_SKELETON_ROWS = [0, 1, 2];
const STATUS_SKELETON_ROWS = [0, 1, 2, 3];
const TRENDING_SKELETON_ROWS = [0, 1, 2];

function VineFeedPostSkeleton() {
  return (
    <div className="vine-post-skeleton-card" aria-hidden="true">
      <div className="vine-post-skeleton-header">
        <div className="vine-post-skeleton-header-main">
          <div className="vine-skeleton-avatar" />
          <div className="vine-post-skeleton-meta">
            <div className="vine-post-skeleton-name-row">
              <div className="vine-skeleton-block vine-post-skeleton-name" />
              <div className="vine-skeleton-block vine-post-skeleton-check" />
            </div>
            <div className="vine-post-skeleton-submeta">
              <div className="vine-skeleton-block vine-post-skeleton-handle" />
              <div className="vine-skeleton-block vine-post-skeleton-dot" />
              <div className="vine-skeleton-block vine-post-skeleton-time" />
            </div>
          </div>
        </div>
        <div className="vine-skeleton-block vine-post-skeleton-menu" />
      </div>
      <div className="vine-post-skeleton-context">
        <div className="vine-skeleton-pill vine-post-skeleton-context-chip" />
      </div>
      <div className="vine-post-skeleton-body">
        <div className="vine-skeleton-block vine-post-skeleton-line long" />
        <div className="vine-skeleton-block vine-post-skeleton-line medium" />
        <div className="vine-skeleton-block vine-post-skeleton-line short" />
      </div>
      <div className="vine-post-skeleton-media vine-skeleton-block" />
      <div className="vine-post-skeleton-tags">
        <div className="vine-skeleton-pill vine-post-skeleton-tag" />
        <div className="vine-skeleton-pill vine-post-skeleton-tag short" />
      </div>
      <div className="vine-post-skeleton-actions">
        <div className="vine-skeleton-pill vine-post-skeleton-action-pill" />
        <div className="vine-skeleton-pill vine-post-skeleton-action-pill" />
        <div className="vine-skeleton-pill vine-post-skeleton-action-pill" />
        <div className="vine-skeleton-pill vine-post-skeleton-action-pill" />
        <div className="vine-skeleton-pill vine-post-skeleton-action-pill" />
        <div className="vine-skeleton-pill vine-post-skeleton-action-pill" />
      </div>
    </div>
  );
}

function VineTrendingSkeleton() {
  return (
    <div className="trending-card trending-card-skeleton" aria-hidden="true">
      <div className="trending-top">
        <div className="vine-skeleton-avatar small" />
        <div className="trending-skeleton-meta">
          <div className="vine-skeleton-block trending-skeleton-name" />
          <div className="vine-skeleton-block trending-skeleton-handle" />
        </div>
      </div>
      <div className="vine-skeleton-block trending-skeleton-text long" />
      <div className="vine-skeleton-block trending-skeleton-text short" />
      <div className="vine-skeleton-block trending-skeleton-stats" />
    </div>
  );
}

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
  const viewerId = Number(me?.id || 0);

  // ── State ───────────────────────────────────────
  const [posts, setPosts] = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedNextCursor, setFeedNextCursor] = useState(null);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [content, setContent] = useState("");
  const [images, setImages] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [feeling, setFeeling] = useState("");
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [unread, setUnread] = useState(0);           // notifications
  const [unreadDMs, setUnreadDMs] = useState(0);     // DMs
  const [handledDeepLink, setHandledDeepLink] = useState(false);
  const [params, setParams] = useSearchParams();
  const targetPostId = params.get("post");
  const targetCommentId = params.get("comment");
  const targetTag = (params.get("tag") || "").trim();
  const activeFeedTab = String(params.get("tab") || "").toLowerCase() === "news" ? "news" : "for-you";
  const isNewsTab = activeFeedTab === "news";
  const [suggestedUsers, setSuggestedUsers] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestionSlots, setSuggestionSlots] = useState([]);
  const [trendingPosts, setTrendingPosts] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [creatorSpotlight, setCreatorSpotlight] = useState({ risingCreators: [], topCreatorsWeek: [] });
  const [creatorSpotlightLoading, setCreatorSpotlightLoading] = useState(true);
  const [birthdayRows, setBirthdayRows] = useState({ today: [], upcoming: [] });
  const [birthdaysLoading, setBirthdaysLoading] = useState(true);
  const [birthdaysExpanded, setBirthdaysExpanded] = useState(false);
  const [restriction, setRestriction] = useState(null);
  const [myCommunities, setMyCommunities] = useState([]);
  const [communityId, setCommunityId] = useState("");
  const [statusRail, setStatusRail] = useState([]);
  const [statusRailLoading, setStatusRailLoading] = useState(true);
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
  const [pollDurationHours, setPollDurationHours] = useState(24);
  const [postBgColor, setPostBgColor] = useState("");
  const [activeNowUsers, setActiveNowUsers] = useState([]);
  const [recentlyActiveUsers, setRecentlyActiveUsers] = useState([]);
  const [presenceModalOpen, setPresenceModalOpen] = useState(false);
  const [desktopChatWindows, setDesktopChatWindows] = useState([]);
  const [desktopDmSearch, setDesktopDmSearch] = useState("");
  const [desktopDmEnabled, setDesktopDmEnabled] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 1180 : false
  );
  const suggestionSlotsRef = useRef([]);
  const feedNextCursorRef = useRef(null);
  const createInputRef = useRef(null);
  const checkedNewsTargetRef = useRef("");
  const injectedTargetPostRef = useRef("");
  const draftPostRequestIdRef = useRef("");
  const draftPostFingerprintRef = useRef("");

  const revokePreviewUrls = (items) => {
    for (const item of items || []) {
      if (item?.revoke && typeof item.src === "string" && item.src.startsWith("blob:")) {
        URL.revokeObjectURL(item.src);
      }
    }
  };

  useEffect(() => {
    const syncDesktopDmEnabled = () => {
      const enabled = window.innerWidth >= 1180;
      setDesktopDmEnabled(enabled);
      if (!enabled) {
        setDesktopChatWindows([]);
      }
    };

    syncDesktopDmEnabled();
    window.addEventListener("resize", syncDesktopDmEnabled);
    return () => window.removeEventListener("resize", syncDesktopDmEnabled);
  }, []);

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

  const normalizeImageFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    const converted = await Promise.all(
      files.map(async (file) => {
        if (!isHeicLikeFile(file)) return file;
        const convertedFile = await convertHeicFileToJpeg(file);
        if (convertedFile) return convertedFile;
        console.warn("HEIC conversion failed; file skipped");
        alert("HEIC image could not be converted on this device. Please use JPG/PNG/WebP.");
        return null;
      })
    );
    return converted.filter(Boolean);
  };

  const renderSuggestedVinersCarousel = (heading, subtitle = "", { sortByFollowers = false } = {}) => {
    const rows = sortByFollowers
      ? [...suggestedUsers].sort((a, b) => {
          const followerDiff = Number(b?.follower_count || 0) - Number(a?.follower_count || 0);
          if (followerDiff !== 0) return followerDiff;
          return Number(b?.id || 0) - Number(a?.id || 0);
        })
      : suggestedUsers;

    return (
    <div className="vine-suggest-carousel vine-suggest-carousel-recovery">
      <div className="suggest-carousel-header">{heading}</div>
      {subtitle ? <div className="suggest-carousel-subtitle">{subtitle}</div> : null}
      <div className="suggest-carousel-track">
        {rows.map((u) => {
          const avatarSrc = u.avatar_url
            ? (u.avatar_url.startsWith("http") ? u.avatar_url : `${API}${u.avatar_url}`)
            : DEFAULT_AVATAR;
          const followerCount = Number(u.follower_count || 0);
          const followerLabel =
            followerCount === 1 ? "1 follower" : `${followerCount.toLocaleString()} followers`;
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
              <div className="suggest-meta">{followerLabel}</div>
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
    );
  };

  const composerFingerprint = [
    content.trim(),
    feeling,
    composeGifUrl,
    postBgColor,
    pollOpen ? "poll-on" : "poll-off",
    String(pollDurationHours),
    pollOptions.map((option) => String(option || "").trim()).join("|"),
    String(communityId || ""),
    images.map((file) => `${file?.name || ""}:${file?.size || 0}:${file?.lastModified || 0}`).join("|"),
  ].join("::");

  useEffect(() => {
    if (draftPostFingerprintRef.current && draftPostFingerprintRef.current !== composerFingerprint) {
      draftPostRequestIdRef.current = "";
    }
    draftPostFingerprintRef.current = composerFingerprint;
  }, [composerFingerprint]);
  useEffect(() => {
    setHandledDeepLink(false);
  }, [targetPostId, targetCommentId]);

  useEffect(() => {
    checkedNewsTargetRef.current = "";
  }, [targetPostId, targetCommentId, activeFeedTab]);

  useEffect(() => {
    injectedTargetPostRef.current = "";
  }, [targetPostId, activeFeedTab]);

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

      postEl.scrollIntoView({ behavior: "smooth", block: "start" });

      setHandledDeepLink(true);
      clearInterval(interval);
    }, 300);

    return () => clearInterval(interval);
  }, [posts, handledDeepLink]);

  useEffect(() => {
    if (!targetPostId || isNewsTab || feedLoading) return;
    if (posts.some((row) => String(row?.id) === String(targetPostId))) return;

    const targetKey = `${targetPostId}:${targetCommentId || ""}`;
    if (checkedNewsTargetRef.current === targetKey) return;
    checkedNewsTargetRef.current = targetKey;

    const controller = new AbortController();

    const resolveNewsLane = async () => {
      try {
        const res = await fetch(`${API}/api/vine/posts/${targetPostId}/public`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || controller.signal.aborted) return;
        if (!isVineNewsIdentity(data)) return;

        setParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", "news");
          next.set("post", String(targetPostId));
          if (targetCommentId) next.set("comment", String(targetCommentId));
          return next;
        }, { replace: true });
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.error("Failed to resolve Vine News lane", err);
        }
      }
    };

    resolveNewsLane();
    return () => controller.abort();
  }, [feedLoading, isNewsTab, posts, setParams, targetCommentId, targetPostId, token]);

  useEffect(() => {
    if (!targetPostId || isNewsTab || feedLoading) return;
    if (posts.some((row) => String(row?.id) === String(targetPostId))) return;

    const injectKey = `${activeFeedTab}:${targetPostId}`;
    if (injectedTargetPostRef.current === injectKey) return;
    injectedTargetPostRef.current = injectKey;

    const controller = new AbortController();

    const injectTargetPost = async () => {
      try {
        const res = await fetch(`${API}/api/vine/posts/${targetPostId}/public`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || controller.signal.aborted) return;

        setPosts((prev) => {
          if (prev.some((row) => String(row?.id) === String(targetPostId))) return prev;
          return [data, ...prev];
        });
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.error("Failed to inject target post into feed", err);
        }
      }
    };

    injectTargetPost();
    return () => controller.abort();
  }, [activeFeedTab, feedLoading, isNewsTab, posts, targetPostId, token]);

  // ── Feed Loading + Polling ──────────────────────
  const loadFeed = useCallback(async (signal, { append = false, cursorOverride = null } = {}) => {
    try {
      const query = new URLSearchParams();
      if (targetTag) query.set("tag", targetTag);
      if (activeFeedTab === "news") query.set("tab", "news");
      const nextCursorToUse = append ? (cursorOverride || feedNextCursorRef.current) : null;
      if (append && nextCursorToUse?.time && nextCursorToUse?.feedId) {
        query.set("cursor_time", nextCursorToUse.time);
        query.set("cursor_feed_id", nextCursorToUse.feedId);
      }
      const res = await fetch(
        `${API}/api/vine/posts${query.toString() ? `?${query.toString()}` : ""}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal,
        },
      );
      const data = await res.json();
      if (signal?.aborted) return;
      const rows = Array.isArray(data) ? data : [];
      const nextTime = res.headers.get("X-Vine-Next-Cursor-Time") || "";
      const nextFeedId = res.headers.get("X-Vine-Next-Cursor-Feed") || "";
      const nextCursor = nextTime && nextFeedId ? { time: nextTime, feedId: nextFeedId } : null;
      feedNextCursorRef.current = nextCursor;
      setFeedNextCursor(nextCursor);
      setFeedHasMore(Boolean(nextCursor));
      setPosts((prev) => {
        if (!append) return rows;
        const merged = [...prev];
        const seen = new Set(prev.map((row) => String(row?.feed_id || `${row?.id || ""}`)));
        for (const row of rows) {
          const key = String(row?.feed_id || `${row?.id || ""}`);
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(row);
        }
        return merged;
      });
      // Build suggestion slots only once per session to avoid jumping
      if (!append && suggestionSlotsRef.current.length === 0 && rows.length > 0) {
        const nextSlots = [];
        const first = Math.min(6, rows.length);
        let idx = first;
        while (idx < rows.length && nextSlots.length < 3) {
          nextSlots.push(idx);
          idx += 12;
        }
        suggestionSlotsRef.current = nextSlots;
        setSuggestionSlots(nextSlots);
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error("Load feed error", err);
    } finally {
      if (!signal?.aborted) {
        if (append) {
          setFeedLoadingMore(false);
        } else {
          setFeedLoading(false);
        }
      }
    }
  }, [targetTag, activeFeedTab, token]);

  const loadSuggestions = useCallback(async (signal) => {
    try {
      const res = await fetch(`${API}/api/vine/users/new`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      const data = await res.json();
      if (signal?.aborted) return;
      if (Array.isArray(data)) setSuggestedUsers(data);
      else setSuggestedUsers([]);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setSuggestedUsers([]);
    } finally {
      if (!signal?.aborted) {
        setSuggestionsLoading(false);
      }
    }
  }, [token]);

  const loadTrending = useCallback(async (signal) => {
    try {
      const res = await fetch(`${API}/api/vine/posts/trending?limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      const data = await res.json();
      if (signal?.aborted) return;
      if (Array.isArray(data)) setTrendingPosts(data);
      else setTrendingPosts([]);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setTrendingPosts([]);
    } finally {
      if (!signal?.aborted) {
        setTrendingLoading(false);
      }
    }
  }, [token]);

  const loadCreatorSpotlight = useCallback(async (signal) => {
    try {
      const res = await fetch(`${API}/api/vine/creators/spotlight?limit=5`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (signal?.aborted) return;
      setCreatorSpotlight({
        risingCreators: Array.isArray(data?.risingCreators) ? data.risingCreators : [],
        topCreatorsWeek: Array.isArray(data?.topCreatorsWeek) ? data.topCreatorsWeek : [],
      });
    } catch (err) {
      if (err?.name === "AbortError") return;
      setCreatorSpotlight({ risingCreators: [], topCreatorsWeek: [] });
    } finally {
      if (!signal?.aborted) {
        setCreatorSpotlightLoading(false);
      }
    }
  }, [token]);

  const loadBirthdays = useCallback(async (signal) => {
    try {
      const res = await fetch(`${API}/api/vine/birthdays/upcoming?days=14`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (signal?.aborted) return;
      setBirthdayRows({
        today: Array.isArray(data?.today) ? data.today : [],
        upcoming: Array.isArray(data?.upcoming) ? data.upcoming : [],
      });
    } catch (err) {
      if (err?.name === "AbortError") return;
      setBirthdayRows({ today: [], upcoming: [] });
    } finally {
      if (!signal?.aborted) {
        setBirthdaysLoading(false);
      }
    }
  }, [token]);

  const switchFeedTab = useCallback(
    (nextTab) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (nextTab === "news") next.set("tab", "news");
        else next.delete("tab");
        next.delete("post");
        next.delete("comment");
        return next;
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [setParams]
  );

  const loadRestrictions = useCallback(async (signal) => {
    try {
      const res = await fetch(`${API}/api/vine/users/me/restrictions`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (signal?.aborted) return;
      if (res.ok && data.suspended) {
        setRestriction(data.suspension || { reason: "Moderation restriction active" });
      } else {
        setRestriction(null);
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      setRestriction(null);
    }
  }, [token]);

  const loadMyCommunities = useCallback(async (signal) => {
    try {
      const res = await fetch(`${API}/api/vine/communities/mine`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      const data = await res.json();
      if (signal?.aborted) return;
      setMyCommunities(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setMyCommunities([]);
    }
  }, [token]);

  const loadStatusRail = useCallback(async (signal) => {
    try {
      const res = await fetch(`${API}/api/vine/statuses/rail`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      const data = await res.json();
      if (signal?.aborted) return;
      setStatusRail(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setStatusRail([]);
    } finally {
      if (!signal?.aborted) {
        setStatusRailLoading(false);
      }
    }
  }, [token]);
  

  useEffect(() => {
    const controller = new AbortController();
    setFeedLoading(true);
    setFeedLoadingMore(false);
    feedNextCursorRef.current = null;
    setFeedNextCursor(null);
    setFeedHasMore(false);
    setSuggestionsLoading(true);
    setTrendingLoading(!isNewsTab);
    setCreatorSpotlightLoading(true);
    setBirthdaysLoading(!isNewsTab);
    setStatusRailLoading(true);
    loadFeed(controller.signal); // initial load
    loadSuggestions(controller.signal);
    loadCreatorSpotlight(controller.signal);
    if (isNewsTab) {
      setTrendingPosts([]);
      setBirthdayRows({ today: [], upcoming: [] });
    } else {
      loadTrending(controller.signal);
      loadBirthdays(controller.signal);
    }
    loadRestrictions(controller.signal);
    loadMyCommunities(controller.signal);
    loadStatusRail(controller.signal);

    const interval = setInterval(() => {
      const refreshController = new AbortController();
      loadFeed(refreshController.signal);
      if (!isNewsTab) {
        loadTrending(refreshController.signal);
      }
    }, FEED_REFRESH_FALLBACK_MS);
    const statusInterval = setInterval(() => {
      const statusController = new AbortController();
      loadStatusRail(statusController.signal);
    }, STATUS_RAIL_REFRESH_FALLBACK_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
      clearInterval(statusInterval);
    };
  }, [isNewsTab, loadBirthdays, loadCreatorSpotlight, loadFeed, loadSuggestions, loadTrending, loadRestrictions, loadMyCommunities, loadStatusRail]);

  useEffect(() => {
    if (!token) return undefined;

    let refreshTimer = null;
    const scheduleRefresh = ({ statuses = false, full = false } = {}) => {
      if (refreshTimer) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        const controller = new AbortController();
        loadFeed(controller.signal);
        if (!isNewsTab) {
          loadTrending(controller.signal);
        }
        if (full) {
          loadSuggestions(controller.signal);
          loadCreatorSpotlight(controller.signal);
          loadRestrictions(controller.signal);
          loadMyCommunities(controller.signal);
        }
        if (statuses || full) {
          loadStatusRail(controller.signal);
        }
      }, FEED_EVENT_DEBOUNCE_MS);
    };

    const handleFeedUpdate = () => scheduleRefresh();
    const handleStatusUpdate = () => scheduleRefresh({ statuses: true });
    const handleWakeRefresh = () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh({ statuses: true, full: true });
      }
    };

    socket.on("vine_feed_updated", handleFeedUpdate);
    socket.on("vine_status_updated", handleStatusUpdate);
    window.addEventListener("focus", handleWakeRefresh);
    document.addEventListener("visibilitychange", handleWakeRefresh);

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      socket.off("vine_feed_updated", handleFeedUpdate);
      socket.off("vine_status_updated", handleStatusUpdate);
      window.removeEventListener("focus", handleWakeRefresh);
      document.removeEventListener("visibilitychange", handleWakeRefresh);
    };
  }, [token, isNewsTab, loadFeed, loadTrending, loadSuggestions, loadCreatorSpotlight, loadRestrictions, loadMyCommunities, loadStatusRail]);

  useEffect(() => {
    if (!statusViewerOpen) return;
    const current = statusItems[statusIndex];
    if (!current || Number(current.seen_by_viewer) === 1) return;
    const controller = new AbortController();

    const markSeen = async () => {
      try {
        await fetch(`${API}/api/vine/statuses/${current.id}/view`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
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
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.error("Mark status seen failed", err);
        }
      }
    };

    markSeen();
    return () => controller.abort();
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
    const controller = new AbortController();
    if (!isMine) {
      setStatusViewers([]);
      setStatusViewsOpen(false);
      setStatusViewsLoading(false);
      return () => controller.abort();
    }

    const loadViews = async () => {
      setStatusViewsLoading(true);
      try {
        const res = await fetch(`${API}/api/vine/statuses/${current.id}/views`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setStatusViewers(Array.isArray(data) ? data : []);
      } catch (err) {
        if (err?.name !== "AbortError") {
          setStatusViewers([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setStatusViewsLoading(false);
        }
      }
    };

    loadViews();
    return () => controller.abort();
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
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/vine/users/mention?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setMentionResults(Array.isArray(data) ? data : []);
      } catch (err) {
        if (err?.name !== "AbortError") {
          setMentionResults([]);
        }
      }
    }, 120);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
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
    if (!text) return;
    if (STATUS_MEDIA_UPLOADS_FROZEN && statusMediaFile) {
      alert("Status media uploads are temporarily disabled.");
      return;
    }
    try {
      const body = new FormData();
      if (text) body.append("text", text);
      body.append("bg_color", statusBgColor);
      if (!STATUS_MEDIA_UPLOADS_FROZEN && statusMediaFile) body.append("media", statusMediaFile);
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
    if (viewerId) {
      setVineNotificationsSeenAt(viewerId);
      setUnread(0);
    }
    navigate("/vine/notifications");
  };

  // ── Real-time Notifications & DMs ───────────────
  useEffect(() => {
    if (!token) return;
    const notificationController = new AbortController();
    const dmController = new AbortController();

    // Fetch bell badge count
    const fetchUnreadNotifications = async () => {
      try {
        const seenAt = viewerId ? getVineNotificationsSeenAt(viewerId) : "";
        const endpoint = seenAt
          ? `${API}/api/vine/notifications/unseen-count?since=${encodeURIComponent(seenAt)}`
          : `${API}/api/vine/notifications/unread-count`;
        const res = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
          signal: notificationController.signal,
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (notificationController.signal.aborted) return;
        setUnread(Number(data.count || 0));
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("Failed to fetch unread notifications");
      }
    };

    // Fetch unread DMs
    const fetchUnreadDMs = async () => {
      try {
        const res = await fetch(`${API}/api/dms/unread-total`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: dmController.signal,
        });
        const data = await res.json();
        if (dmController.signal.aborted) return;
        setUnreadDMs(data.total || 0);
      } catch (err) {
        if (err?.name !== "AbortError") {
          setUnreadDMs(0);
        }
      }
    };

    fetchUnreadNotifications();
    fetchUnreadDMs();

    // Socket listeners
    socket.on("notification", fetchUnreadNotifications);
    socket.on("dm_received", fetchUnreadDMs);
    socket.on("messages_seen", fetchUnreadDMs);

    return () => {
      notificationController.abort();
      dmController.abort();
      socket.off("notification", fetchUnreadNotifications);
      socket.off("dm_received", fetchUnreadDMs);
      socket.off("messages_seen", fetchUnreadDMs);
    };
  }, [token, viewerId]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const loadPresence = async () => {
      try {
        const res = await fetch(`${API}/api/dms/presence`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        setActiveNowUsers(Array.isArray(data?.active_now) ? data.active_now : []);
        setRecentlyActiveUsers(Array.isArray(data?.recently_active) ? data.recently_active : []);
      } catch (err) {
        if (err?.name === "AbortError") return;
        setActiveNowUsers([]);
        setRecentlyActiveUsers([]);
      }
    };
    loadPresence();
    const interval = setInterval(loadPresence, 30 * 1000);
    socket.on("dm_received", loadPresence);
    socket.on("messages_seen", loadPresence);
    return () => {
      controller.abort();
      clearInterval(interval);
      socket.off("dm_received", loadPresence);
      socket.off("messages_seen", loadPresence);
    };
  }, [token]);

  useEffect(() => {
    if (!desktopDmEnabled || !viewerId) return;

    const handleDesktopIncomingDm = (message) => {
      if (!message || Number(message.sender_id) === Number(viewerId)) return;
      const conversationId = Number(message.conversation_id || 0) || null;
      const senderId = Number(message.sender_id || 0) || null;
      if (!conversationId && !senderId) return;

      const windowKey = conversationId ? `conversation-${conversationId}` : `user-${senderId}`;
      const partner = {
        id: senderId,
        user_id: senderId,
        username: message.username || `user-${senderId}`,
        display_name: message.display_name || message.username || `user-${senderId}`,
        avatar_url: message.avatar_url || null,
        is_verified: Number(message.is_verified || 0),
      };

      setDesktopChatWindows((prev) => {
        const existingIndex = prev.findIndex(
          (item) =>
            item.key === windowKey ||
            Number(item?.conversationId || 0) === Number(conversationId || 0) ||
            Number(item?.receiverId || item?.partner?.id || 0) === Number(senderId || 0)
        );

        if (existingIndex >= 0) {
          return prev.map((item, index) =>
            index === existingIndex
              ? {
                  ...item,
                  conversationId: conversationId || item.conversationId || null,
                  receiverId:
                    item.receiverId || (!conversationId ? senderId : null),
                  minimized: Boolean(item.minimized),
                  incomingCount: Number(item?.incomingCount || 0) + 1,
                  partner: {
                    ...(item?.partner || {}),
                    ...partner,
                  },
                }
              : item
          );
        }

        const nextWindow = {
          key: windowKey,
          conversationId,
          receiverId: conversationId ? null : senderId,
          minimized: false,
          incomingCount: 1,
          partner,
        };

        return [...prev, nextWindow].slice(-DESKTOP_DM_WINDOW_LIMIT);
      });
    };

    socket.on("dm_received", handleDesktopIncomingDm);
    return () => {
      socket.off("dm_received", handleDesktopIncomingDm);
    };
  }, [desktopDmEnabled, viewerId]);

  const startDmConversation = useCallback(
    async (user) => {
      const res = await fetch(`${API}/api/dms/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Cannot start conversation");
      }
      return data;
    },
    [token]
  );

  const openDesktopDmWindow = useCallback(
    async (user) => {
      if (!user?.id) return;
      try {
        const data = await startDmConversation(user);
        const windowKey = data.conversationId ? `conversation-${data.conversationId}` : `user-${user.id}`;
        setDesktopChatWindows((prev) => {
          const existingWindow = prev.find(
            (item) =>
              item.key === windowKey ||
              Number(item?.receiverId || item?.partner?.id || 0) === Number(user.id) ||
              Number(item?.conversationId || 0) === Number(data.conversationId || 0)
          );
          const nextWindow = {
            key: windowKey,
            conversationId: data.conversationId || null,
            receiverId: data.conversationId ? null : Number(user.id),
            minimized: false,
            incomingCount: 0,
            partner: {
              ...user,
              user_id: Number(user.id),
            },
          };
          const deduped = prev.filter(
            (item) =>
              item.key !== windowKey &&
              Number(item?.receiverId || item?.partner?.id || 0) !== Number(user.id) &&
              Number(item?.conversationId || 0) !== Number(data.conversationId || 0)
          );
          const mergedWindow = existingWindow ? { ...existingWindow, ...nextWindow, minimized: false } : nextWindow;
          return [...deduped, mergedWindow].slice(-DESKTOP_DM_WINDOW_LIMIT);
        });
      } catch (err) {
        alert(err?.message || "Cannot start conversation");
      }
    },
    [startDmConversation]
  );

  const closeDesktopDmWindow = useCallback((windowKey) => {
    setDesktopChatWindows((prev) => prev.filter((item) => item.key !== windowKey));
  }, []);

  const focusDesktopDmWindow = useCallback((windowKey) => {
    setDesktopChatWindows((prev) => {
      const target = prev.find((item) => item.key === windowKey);
      if (!target) return prev;
      const others = prev.filter((item) => item.key !== windowKey);
      return [...others, { ...target, minimized: false, incomingCount: 0 }];
    });
  }, []);

  const toggleDesktopDmWindow = useCallback((windowKey, nextMinimized) => {
    setDesktopChatWindows((prev) =>
      prev.map((item) =>
        item.key === windowKey
          ? {
              ...item,
              minimized: typeof nextMinimized === "boolean" ? nextMinimized : !item.minimized,
              incomingCount:
                typeof nextMinimized === "boolean" && nextMinimized === false ? 0 : item.incomingCount || 0,
            }
          : item
      )
    );
  }, []);

  const clearDesktopDmPing = useCallback((windowKey) => {
    setDesktopChatWindows((prev) =>
      prev.map((item) =>
        item.key === windowKey ? { ...item, incomingCount: 0 } : item
      )
    );
  }, []);

  const openDmFromPresence = useCallback(
    async (user) => {
      try {
        const data = await startDmConversation(user);
        setPresenceModalOpen(false);
        if (data.conversationId) {
          navigate(`/vine/dms/${data.conversationId}`);
        } else {
          const p = new URLSearchParams({
            username: user.username || "",
            displayName: user.display_name || user.username || "",
          });
          navigate(`/vine/dms/new/${user.id}?${p.toString()}`);
        }
      } catch (err) {
        alert(err?.message || "Cannot start conversation");
      }
    },
    [navigate, startDmConversation]
  );

  const openBirthdayDm = useCallback(
    (person, event) => {
      event?.stopPropagation?.();
      if (!person?.id) return;
      openDmFromPresence(person);
    },
    [openDmFromPresence]
  );

  useEffect(() => {
    document.title = "Vine — Feed";
  }, []);

  // ── Post Creation ───────────────────────────────
  const submitPost = async () => {
    if (isSubmittingPost) return;
    if (FEED_MEDIA_UPLOADS_FROZEN && images.length > 0) {
      alert("Photo/video uploads are temporarily disabled on feed.");
      return;
    }
    if (!content.trim() && images.length === 0 && !feeling && !composeGifUrl) return;
    if (composeGifUrl && images.length > 0) {
      alert("You can post either a GIF or photos/videos, not both.");
      return;
    }

    try {
      setIsSubmittingPost(true);
      const formData = new FormData();
      const normalizedContent = content.trim();
      const wordCount = normalizedContent ? normalizedContent.split(/\s+/).filter(Boolean).length : 0;
      const useStyledText =
        Boolean(postBgColor) &&
        wordCount > 0 &&
        wordCount <= STYLED_TEXT_WORD_LIMIT &&
        images.length === 0 &&
        !composeGifUrl &&
        !pollOpen;
      if (pollOpen && !normalizedContent) {
        alert("Write your poll text in the main create box.");
        return;
      }
      const markers = [];
      if (feeling) markers.push(`[[feeling:${feeling}]]`);
      if (useStyledText) markers.push(`[[postbg:${postBgColor}]]`);
      const outgoingContent = `${markers.join("")}${normalizedContent ? `${markers.length ? " " : ""}${normalizedContent}` : ""}`;
      const contentWithGif = composeGifUrl
        ? `${outgoingContent}${outgoingContent ? "\n" : ""}${composeGifUrl}`
        : outgoingContent;
      if (contentWithGif) formData.append("content", contentWithGif);
      const clientRequestId = draftPostRequestIdRef.current || createClientRequestId("vine-post");
      draftPostRequestIdRef.current = clientRequestId;
      formData.append("client_request_id", clientRequestId);
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
        formData.append("poll_duration_hours", String(pollDurationHours));
      }

      const res = await fetch(`${API}/api/vine/posts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const newPost = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(newPost?.message || "Failed to create post");
        return;
      }
      setPosts((prev) => {
        const alreadyThere = prev.some((row) => Number(row?.id) === Number(newPost?.id));
        if (alreadyThere) {
          return prev.map((row) => (Number(row?.id) === Number(newPost?.id) ? { ...row, ...newPost } : row));
        }
        return [newPost, ...prev];
      });
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
      setPollDurationHours(24);
      setPostBgColor("");
      draftPostRequestIdRef.current = "";
      draftPostFingerprintRef.current = "";
    } catch (err) {
      console.error("Post creation error", err);
      alert("Failed to create post");
    } finally {
      setIsSubmittingPost(false);
    }
  };

  const addGifToComposer = () => {
    if (images.length > 0) {
      alert("Remove photos/videos first. GIF and photos/videos cannot be posted together.");
      return;
    }
    setGifPickerOpen(true);
  };

  const loadMoreFeed = () => {
    if (feedLoading || feedLoadingMore || !feedHasMore) return;
    const controller = new AbortController();
    setFeedLoadingMore(true);
    loadFeed(controller.signal, { append: true });
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

  const composerWordCount = content.trim() ? content.trim().split(/\s+/).filter(Boolean).length : 0;
  const canUseStyledText =
    composerWordCount > 0 &&
    composerWordCount <= STYLED_TEXT_WORD_LIMIT &&
    images.length === 0 &&
    !composeGifUrl &&
    !pollOpen;
  const showLiveStyledComposer = Boolean(postBgColor) && canUseStyledText;
  const composerTextColor = getContrastTextColor(postBgColor);
  const totalBirthdayCount = birthdayRows.today.length + birthdayRows.upcoming.length;
  const birthdayVisibleLimit = birthdaysExpanded ? totalBirthdayCount : MAX_VISIBLE_BIRTHDAYS;
  const visibleTodayBirthdays = birthdayRows.today.slice(0, birthdayVisibleLimit);
  const visibleUpcomingBirthdays = birthdayRows.upcoming.slice(
    0,
    Math.max(0, birthdayVisibleLimit - visibleTodayBirthdays.length)
  );
  const hasMoreBirthdays = totalBirthdayCount > MAX_VISIBLE_BIRTHDAYS;
  const desktopActiveFollowers = dedupePresenceUsers(activeNowUsers)
    .filter((user) => matchesDesktopDmSearch(user, desktopDmSearch))
    .slice(0, 10);
  const activeFollowerIds = new Set(desktopActiveFollowers.map((user) => Number(user.id)));
  const desktopRecentFollowers = dedupePresenceUsers(recentlyActiveUsers)
    .filter((user) => matchesDesktopDmSearch(user, desktopDmSearch))
    .filter((user) => !activeFollowerIds.has(Number(user.id)))
    .slice(0, 12);
  const desktopExpandedWindows = desktopChatWindows.filter((item) => !item.minimized);
  const desktopMinimizedWindows = desktopChatWindows.filter((item) => item.minimized);
  const handleCreatorFollow = useCallback(
    async (creator, event) => {
      event?.stopPropagation?.();
      if (!creator?.user_id) return;
      try {
        const method = Number(creator.viewer_is_following) === 1 ? "DELETE" : "POST";
        const res = await fetch(`${API}/api/vine/users/${creator.user_id}/follow`, {
          method,
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.message || "Could not update follow");
          return;
        }
        setCreatorSpotlight((prev) => {
          const apply = (rows) =>
            rows.map((row) =>
              Number(row.user_id) === Number(creator.user_id)
                ? {
                    ...row,
                    viewer_is_following: Number(data?.following ? 1 : 0),
                    follower_count: Math.max(
                      0,
                      Number(row.follower_count || 0) + (Number(data?.following ? 1 : 0) === 1 ? 1 : -1)
                    ),
                  }
                : row
            );
          return {
            risingCreators: apply(prev.risingCreators),
            topCreatorsWeek: apply(prev.topCreatorsWeek),
          };
        });
      } catch (err) {
        alert(err?.message || "Could not update follow");
      }
    },
    [token]
  );

  const handleRightRailSuggestionFollow = useCallback(
    async (user, event) => {
      event?.stopPropagation?.();
      if (!user?.id) return;
      try {
        const res = await fetch(`${API}/api/vine/users/${user.id}/follow`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.message || "Could not follow right now");
          return;
        }
        setSuggestedUsers((prev) => prev.filter((row) => Number(row.id) !== Number(user.id)));
      } catch (err) {
        alert(err?.message || "Could not follow right now");
      }
    },
    [token]
  );

  const renderCreatorRailCard = (title, subtitle, rows, variant) => (
    <section className={`vine-creator-rail-card ${variant}`} aria-label={title}>
      <div className="vine-creator-rail-head">
        <div>
          <div className="vine-creator-rail-kicker">{subtitle}</div>
          <h3>{title}</h3>
        </div>
      </div>
      {creatorSpotlightLoading && rows.length === 0 ? (
        <div className="vine-creator-rail-list">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={`${variant}-skeleton-${idx}`} className="vine-creator-rail-row vine-creator-rail-row-skeleton" aria-hidden="true">
              <div className="vine-skeleton-avatar small" />
              <div className="vine-creator-rail-body">
                <div className="vine-skeleton-block vine-creator-rail-line" />
                <div className="vine-skeleton-block vine-creator-rail-line short" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="vine-creator-rail-empty">No creator momentum to show just yet.</div>
      ) : (
        <div className="vine-creator-rail-list">
          {rows.map((creator, index) => {
            const avatarSrc = creator.avatar_url
              ? (creator.avatar_url.startsWith("http") ? creator.avatar_url : `${API}${creator.avatar_url}`)
              : DEFAULT_AVATAR;
            const statLabel =
              variant === "rising"
                ? `+${Number(creator.growth_pct || 0).toFixed(1)}%`
                : `${formatCompactCount(creator.score_week)} pts`;
            const metaLabel =
              variant === "rising"
                ? `${formatCompactCount(creator.score_week)} pts this week`
                : `${Number(creator.posts_week || 0)} ${Number(creator.posts_week || 0) === 1 ? "post" : "posts"} this week`;
            return (
              <div
                key={`${variant}-${creator.user_id}`}
                className="vine-creator-rail-row"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/vine/profile/${creator.username}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(`/vine/profile/${creator.username}`);
                  }
                }}
              >
                <span className="vine-creator-rank">{index + 1}</span>
                <img
                  src={avatarSrc}
                  alt={creator.username}
                  className="vine-creator-avatar"
                  onError={(e) => {
                    e.currentTarget.src = DEFAULT_AVATAR;
                  }}
                />
                <div className="vine-creator-rail-body">
                  <div className="vine-creator-rail-name">
                    <span>{creator.display_name || creator.username}</span>
                    {showsVerifiedBadge(creator) && (
                      <span className={`verified ${hasSpecialVerifiedBadge(creator.username) ? "guardian" : ""}`}>
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
                  <div className="vine-creator-rail-handle">@{creator.username}</div>
                  <div className="vine-creator-rail-meta">
                    <span>{formatCompactCount(creator.follower_count)} followers</span>
                    <span>{metaLabel}</span>
                  </div>
                </div>
                <div className="vine-creator-rail-aside">
                  <span className={`vine-creator-rail-stat ${variant}`}>{statLabel}</span>
                  <button
                    type="button"
                    className={`vine-creator-follow-btn ${Number(creator.viewer_is_following) === 1 ? "following" : ""}`}
                    onClick={(event) => handleCreatorFollow(creator, event)}
                  >
                    {Number(creator.viewer_is_following) === 1 ? "Following" : "Follow"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  const creatorSpotlightIds = new Set(
    [...creatorSpotlight.risingCreators, ...creatorSpotlight.topCreatorsWeek]
      .map((creator) => Number(creator?.user_id || 0))
      .filter(Boolean)
  );

  const rightRailSuggestions = [...suggestedUsers]
    .filter((user) => !creatorSpotlightIds.has(Number(user?.id || 0)))
    .sort((a, b) => Number(b?.follower_count || 0) - Number(a?.follower_count || 0))
    .slice(0, 4);

  const renderWhoToFollowRailCard = (rows) => (
    <section className="vine-suggestion-rail-card" aria-label="Who to follow">
      <div className="vine-creator-rail-head">
        <div className="vine-creator-rail-kicker">Suggested</div>
        <h3>Who to follow</h3>
      </div>
      {suggestionsLoading && rows.length === 0 ? (
        <div className="vine-suggestion-rail-list">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={`suggest-rail-skeleton-${idx}`} className="vine-suggestion-rail-row vine-creator-rail-row-skeleton" aria-hidden="true">
              <div className="vine-skeleton-avatar small" />
              <div className="vine-creator-rail-body">
                <div className="vine-skeleton-block vine-creator-rail-line" />
                <div className="vine-skeleton-block vine-creator-rail-line short" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="vine-creator-rail-empty">You are pretty caught up already.</div>
      ) : (
        <div className="vine-suggestion-rail-list">
          {rows.map((user) => {
            const avatarSrc = user.avatar_url
              ? (user.avatar_url.startsWith("http") ? user.avatar_url : `${API}${user.avatar_url}`)
              : DEFAULT_AVATAR;
            return (
              <div
                key={`right-rail-suggest-${user.id}`}
                className="vine-suggestion-rail-row"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/vine/profile/${user.username}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(`/vine/profile/${user.username}`);
                  }
                }}
              >
                <img
                  src={avatarSrc}
                  alt={user.username}
                  className="vine-suggestion-rail-avatar"
                  onError={(e) => {
                    e.currentTarget.src = DEFAULT_AVATAR;
                  }}
                />
                <div className="vine-creator-rail-body">
                  <div className="vine-creator-rail-name">
                    <span>{user.display_name || user.username}</span>
                    {showsVerifiedBadge(user) && (
                      <span className={`verified ${hasSpecialVerifiedBadge(user.username) ? "guardian" : ""}`}>
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
                  <div className="vine-creator-rail-handle">@{user.username}</div>
                  <div className="vine-creator-rail-meta">
                    <span>{formatCompactCount(user.follower_count || 0)} followers</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="vine-creator-follow-btn"
                  onClick={(event) => handleRightRailSuggestionFollow(user, event)}
                >
                  Follow
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  useEffect(() => {
    if (totalBirthdayCount <= MAX_VISIBLE_BIRTHDAYS && birthdaysExpanded) {
      setBirthdaysExpanded(false);
    }
  }, [birthdaysExpanded, totalBirthdayCount]);
  

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
          {unread > 0 && <span className="notif-badge">{formatBadgeCount(unread)}</span>}
        </div>

        <div className="nav-right">
          <button
            className="nav-btn help-btn mobile-only"
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
            {unreadDMs > 0 && <span className="dm-unread-badge">{formatBadgeCount(unreadDMs)}</span>}
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

      <div className="vine-feed-main-shell">
        <aside className="vine-desktop-dm-sidebar" aria-label="Followers ready to chat">
          <div className="vine-desktop-dm-panel">
            <div className="vine-desktop-dm-head">
              <div>
                <div className="vine-desktop-dm-kicker">Chat</div>
                <h3>Followers ready to chat</h3>
              </div>
              <button type="button" onClick={() => navigate("/vine/dms")}>
                Open inbox
              </button>
            </div>
            <div className="vine-desktop-dm-search-wrap">
              <input
                type="text"
                className="vine-desktop-dm-search"
                placeholder="Search followers to message"
                value={desktopDmSearch}
                onChange={(e) => setDesktopDmSearch(e.target.value)}
              />
            </div>

            <div className="vine-desktop-dm-section">
              <div className="vine-desktop-dm-section-head">
                <span>Active now</span>
                <small>{desktopActiveFollowers.length}</small>
              </div>
              {desktopActiveFollowers.length === 0 ? (
                <div className="vine-desktop-dm-empty">No followers active right now.</div>
              ) : (
                <div className="vine-desktop-dm-list">
                  {desktopActiveFollowers.map((user) => {
                    const avatarSrc = user.avatar_url
                      ? (user.avatar_url.startsWith("http") ? user.avatar_url : `${API}${user.avatar_url}`)
                      : DEFAULT_AVATAR;
                    return (
                      <button
                        key={`desktop-active-${user.id}`}
                        type="button"
                        className="vine-desktop-dm-person online"
                        onClick={() => openDesktopDmWindow(user)}
                      >
                        <img
                          src={avatarSrc}
                          alt={user.username}
                          onError={(e) => {
                            e.currentTarget.src = DEFAULT_AVATAR;
                          }}
                        />
                        <div className="vine-desktop-dm-person-meta">
                          <strong>{user.display_name || user.username}</strong>
                          <span>@{user.username}</span>
                        </div>
                        <span className="vine-desktop-dm-person-status">Online</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="vine-desktop-dm-section">
              <div className="vine-desktop-dm-section-head">
                <span>Recently active</span>
                <small>{desktopRecentFollowers.length}</small>
              </div>
              {desktopRecentFollowers.length === 0 ? (
                <div className="vine-desktop-dm-empty">No recent follower activity yet.</div>
              ) : (
                <div className="vine-desktop-dm-list compact">
                  {desktopRecentFollowers.map((user) => {
                    const avatarSrc = user.avatar_url
                      ? (user.avatar_url.startsWith("http") ? user.avatar_url : `${API}${user.avatar_url}`)
                      : DEFAULT_AVATAR;
                    return (
                      <button
                        key={`desktop-recent-${user.id}`}
                        type="button"
                        className="vine-desktop-dm-person"
                        onClick={() => openDesktopDmWindow(user)}
                      >
                        <img
                          src={avatarSrc}
                          alt={user.username}
                          onError={(e) => {
                            e.currentTarget.src = DEFAULT_AVATAR;
                          }}
                        />
                        <div className="vine-desktop-dm-person-meta">
                          <strong>{user.display_name || user.username}</strong>
                          <span>{formatPresenceAgo(user.last_active_at) || "@".concat(user.username || "")}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </aside>

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
        <div className="vine-feed-switcher" role="tablist" aria-label="Feed tabs">
          <button
            type="button"
            role="tab"
            aria-selected={!isNewsTab}
            className={`vine-feed-tab ${!isNewsTab ? "active" : ""}`}
            onClick={() => switchFeedTab("for-you")}
          >
            <span className="vine-feed-tab-label">Following</span>
            <span className="vine-feed-tab-subtitle">People you follow</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isNewsTab}
            className={`vine-feed-tab ${isNewsTab ? "active" : ""}`}
            onClick={() => switchFeedTab("news")}
          >
            <span className="vine-feed-tab-label">Vine News</span>
            <span className="vine-feed-tab-subtitle">News desk only</span>
          </button>
        </div>
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
            <div className="status-card-art status-card-art-add" aria-hidden="true">
              <span className="status-add-plus">+</span>
              <span className="status-add-kicker">Create</span>
            </div>
            <div className="status-chip-meta">
              <span className="status-chip-name">My Status</span>
              <small className="status-chip-time">Share a moment</small>
            </div>
          </button>
          {statusRailLoading && statusRail.length === 0
            ? STATUS_SKELETON_ROWS.map((idx) => (
                <div key={`status-skeleton-${idx}`} className="status-user-chip status-user-chip-skeleton" aria-hidden="true">
                  <div className="vine-skeleton-block status-chip-skeleton-art" />
                  <div className="vine-skeleton-block status-chip-skeleton-line" />
                  <div className="vine-skeleton-block status-chip-skeleton-line short" />
                </div>
              ))
            : statusRail.map((row) => {
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
                <div
                  className="status-card-art"
                  style={{
                    backgroundImage: `linear-gradient(180deg, rgba(6, 14, 23, 0.12), rgba(6, 14, 23, 0.54)), url("${avatarSrc}")`,
                  }}
                >
                  <div className="status-card-badges">
                    {Number(row.unseen_count || 0) > 0 && (
                      <span className="status-unseen-pill">NEW</span>
                    )}
                    <span className="status-count-pill">{Number(row.status_count || 0)}</span>
                  </div>
                  <img
                    src={avatarSrc}
                    alt={row.username}
                    className="status-chip-avatar"
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_AVATAR;
                    }}
                  />
                </div>
                <div className="status-chip-meta">
                  <span className="status-chip-name">{row.display_name || row.username}</span>
                  <small className="status-chip-time">{formatStatusTime(row.latest_created_at)}</small>
                </div>
              </button>
            );
          })}
        </div>

        {!isNewsTab && (
        <>
        {/* Create Post Box */}
        <div
          className={`vine-create-box ${showLiveStyledComposer ? "styled-live" : ""}`}
          style={
            showLiveStyledComposer
              ? {
                  "--composer-placeholder":
                    composerTextColor === "#0f172a" ? "rgba(15,23,42,0.65)" : "rgba(255,255,255,0.86)",
                }
              : undefined
          }
        >
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
                      style={
                        showLiveStyledComposer
                          ? {
                              background: postBgColor,
                              color: composerTextColor,
                              borderRadius: 18,
                              padding: "18px 16px",
                              fontWeight: 800,
                              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
                            }
                          : undefined
                      }
                      ref={createInputRef}
                      placeholder="What's happening?"
                      value={content}
                      maxLength={POST_MAX_LENGTH}
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
          <div className="composer-style-row">
            <span className="composer-style-label">Text style:</span>
            <button
              type="button"
              className={`composer-style-swatch ${!postBgColor ? "active" : ""}`}
              onClick={() => setPostBgColor("")}
            >
              Normal
            </button>
            {POST_BG_COLORS.map((c) => (
              <button
                key={`post-bg-${c}`}
                type="button"
                className={`composer-style-swatch color ${postBgColor === c ? "active" : ""}`}
                style={{ background: c }}
                onClick={() => setPostBgColor(c)}
                title={c}
              />
            ))}
            {!canUseStyledText && postBgColor && (
              <span className="composer-style-note">
                Long or mixed-media post: normal style will be used.
              </span>
            )}
          </div>

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
              <span className="char-count">{content.length}/{POST_MAX_LENGTH}</span>
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

              <label
                className={`image-picker media-icon-picker ${FEED_MEDIA_UPLOADS_FROZEN ? "disabled" : ""}`}
                title={
                  FEED_MEDIA_UPLOADS_FROZEN
                    ? "Photo/video uploads are temporarily disabled"
                    : "Add photo or video"
                }
                onClick={(e) => {
                  if (FEED_MEDIA_UPLOADS_FROZEN) {
                    e.preventDefault();
                    alert("Photo/video uploads are temporarily disabled on feed.");
                  }
                }}
              >
                <span className="media-icon" aria-hidden="true">📷</span>
                <span className="media-icon" aria-hidden="true">🎥</span>
                <input
                  type="file"
                  accept="image/*,video/*,.heic,.heif"
                  multiple
                  disabled={FEED_MEDIA_UPLOADS_FROZEN}
                  hidden
                  onChange={async (e) => {
                    if (FEED_MEDIA_UPLOADS_FROZEN) return;
                    if (composeGifUrl) {
                      alert("Remove GIF first. GIF and photos/videos cannot be posted together.");
                      e.target.value = "";
                      return;
                    }
                    const files = await normalizeImageFiles(e.target.files);
                    if (!files.length) return;
                    const limitedFiles = files.slice(0, POST_MAX_MEDIA_FILES);
                    if (files.length > POST_MAX_MEDIA_FILES) {
                      alert(`Only the first ${POST_MAX_MEDIA_FILES} photos/videos will be added to this post.`);
                    }
                    setImages(limitedFiles);
                    const previewItems = await buildPreviewItems(limitedFiles);
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
                        <div className="preview-video-poster" aria-hidden="true">
                          <span className="preview-video-play">▶</span>
                          <span className="preview-video-label">Video</span>
                        </div>
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

              <button className="post-submit-btn" onClick={submitPost} disabled={isSubmittingPost}>
                {isSubmittingPost ? "Posting..." : "Post"}
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
                <select
                  value={pollDurationHours}
                  onChange={(e) => setPollDurationHours(Number(e.target.value) || 24)}
                >
                  <option value={1}>1 hour</option>
                  <option value={6}>6 hours</option>
                  <option value={12}>12 hours</option>
                  <option value={24}>24 hours</option>
                  <option value={48}>2 days</option>
                  <option value={72}>3 days</option>
                  <option value={168}>7 days</option>
                </select>
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
        </>
        )}

        {!isNewsTab && (
          <section className="vine-birthdays-card" aria-labelledby="vine-birthdays-title">
            <div className="vine-birthdays-head">
              <div>
                <div className="vine-birthdays-kicker">Upcoming birthdays</div>
                <h3 id="vine-birthdays-title">🎉 🎂 People worth celebrating</h3>
              </div>
              {totalBirthdayCount > 0 && (
                <div className="vine-birthdays-crest" aria-label={`${totalBirthdayCount} birthdays in view`}>
                  <strong>{totalBirthdayCount}</strong>
                  <span>On deck</span>
                </div>
              )}
            </div>

            {birthdaysLoading && birthdayRows.today.length === 0 && birthdayRows.upcoming.length === 0 ? (
              <div className="vine-birthdays-grid birthdays-loading" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, idx) => (
                  <div key={`birthday-skeleton-${idx}`} className="vine-birthday-row vine-birthday-row-skeleton">
                    <div className="vine-skeleton-avatar" />
                    <div className="vine-birthday-row-meta">
                      <div className="vine-skeleton-block vine-birthday-skeleton-name" />
                      <div className="vine-skeleton-block vine-birthday-skeleton-date" />
                    </div>
                    <div className="vine-skeleton-pill vine-birthday-skeleton-pill" />
                  </div>
                ))}
              </div>
            ) : birthdayRows.today.length === 0 && birthdayRows.upcoming.length === 0 ? (
              <div className="vine-birthdays-empty">
                No upcoming birthdays in the next 14 days yet.
              </div>
            ) : (
              <div className="vine-birthdays-grid">
                {visibleTodayBirthdays.length > 0 && (
                  <div className="vine-birthday-section">
                    <div className="vine-birthday-section-title">Today</div>
                    {visibleTodayBirthdays.map((person) => {
                      const avatarSrc = person.avatar_url
                        ? (person.avatar_url.startsWith("http") ? person.avatar_url : `${API}${person.avatar_url}`)
                        : DEFAULT_AVATAR;
                      return (
                        <div
                          key={`birthday-today-${person.id}`}
                          className="vine-birthday-row"
                          onClick={() => navigate(`/vine/profile/${person.username}`)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              navigate(`/vine/profile/${person.username}`);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <img
                            src={avatarSrc}
                            alt={person.username}
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_AVATAR;
                            }}
                          />
                          <div className="vine-birthday-row-meta">
                            <div className="vine-birthday-row-name">
                              <span>{person.display_name || person.username}</span>
                              <span className="vine-birthday-celebrate" aria-hidden="true">🎂 🎉</span>
                              {showsVerifiedBadge(person) && (
                                <span className={`verified ${hasSpecialVerifiedBadge(person.username) ? "guardian" : ""}`}>
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
                            <div className="vine-birthday-row-subtitle">@{person.username}</div>
                          </div>
                          <div className="vine-birthday-row-date">{formatBirthdayDate(person)}</div>
                          <button
                            type="button"
                            className="vine-birthday-action"
                            onClick={(event) => openBirthdayDm(person, event)}
                          >
                            🎂 Wish happy birthday
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {visibleUpcomingBirthdays.length > 0 && (
                  <div className="vine-birthday-section">
                    <div className="vine-birthday-section-title">Next up</div>
                    {visibleUpcomingBirthdays.map((person) => {
                      const avatarSrc = person.avatar_url
                        ? (person.avatar_url.startsWith("http") ? person.avatar_url : `${API}${person.avatar_url}`)
                        : DEFAULT_AVATAR;
                      return (
                        <div
                          key={`birthday-upcoming-${person.id}`}
                          className="vine-birthday-row"
                          onClick={() => navigate(`/vine/profile/${person.username}`)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              navigate(`/vine/profile/${person.username}`);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <img
                            src={avatarSrc}
                            alt={person.username}
                            onError={(e) => {
                              e.currentTarget.src = DEFAULT_AVATAR;
                            }}
                          />
                          <div className="vine-birthday-row-meta">
                            <div className="vine-birthday-row-name">
                              <span>{person.display_name || person.username}</span>
                              <span className="vine-birthday-celebrate" aria-hidden="true">🎂 🎉</span>
                              {showsVerifiedBadge(person) && (
                                <span className={`verified ${hasSpecialVerifiedBadge(person.username) ? "guardian" : ""}`}>
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
                            <div className="vine-birthday-row-subtitle">
                              @{person.username} • {formatBirthdayDate(person)}
                            </div>
                          </div>
                          <div className="vine-birthday-chip">{formatBirthdayCountdown(person.days_until)}</div>
                          <span
                            className="vine-birthday-action vine-birthday-action-upcoming"
                            aria-label={`Upcoming birthday for ${person.display_name || person.username}`}
                          >
                            Upcoming
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {hasMoreBirthdays && (
              <button
                type="button"
                className="vine-birthdays-toggle"
                onClick={() => setBirthdaysExpanded((prev) => !prev)}
              >
                {birthdaysExpanded
                  ? "Show less"
                  : `Show all birthdays (${totalBirthdayCount})`}
              </button>
            )}
          </section>
        )}

        {!isNewsTab && (trendingLoading || trendingPosts.length > 0) && (
          <div className="vine-trending">
            <div className="trending-header">Vine latest posts</div>
            <div className="trending-subtitle">
              The latest stories across Vine that you can currently view. Scroll through the newest ten.
            </div>
            <div className="trending-track">
              {trendingLoading && trendingPosts.length === 0
                ? TRENDING_SKELETON_ROWS.map((idx) => <VineTrendingSkeleton key={`trend-skeleton-${idx}`} />)
                : trendingPosts.map((p) => {
                const avatarSrc = p.avatar_url
                  ? (p.avatar_url.startsWith("http") ? p.avatar_url : `${API}${p.avatar_url}`)
                  : DEFAULT_AVATAR;
                const snippet =
                  (p.content || "").trim().length > 0
                    ? (p.content.length > 90 ? `${p.content.slice(0, 90)}…` : p.content)
                    : "Photo post";
                const statLikes = Number(p.like_count ?? p.likes ?? 0);
                const statComments = Number(p.comment_count ?? p.comments ?? 0);
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
                      ❤️ {statLikes} · 💬 {statComments}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Feed Posts */}
        <div className="vine-posts-list">
          {feedLoading && posts.length === 0 ? (
            <>
              {suggestionsLoading && (
                <div className="vine-suggest-carousel vine-suggest-carousel-skeleton" aria-hidden="true">
                  <div className="suggest-carousel-header vine-skeleton-block vine-suggest-skeleton-heading" />
                  <div className="suggest-carousel-track">
                    {Array.from({ length: 3 }).map((_, idx) => (
                      <div key={`suggest-skeleton-${idx}`} className="suggest-card suggest-card-skeleton">
                        <div className="vine-skeleton-avatar" />
                        <div className="vine-skeleton-block suggest-skeleton-name" />
                        <div className="vine-skeleton-block suggest-skeleton-handle" />
                        <div className="vine-skeleton-pill suggest-skeleton-btn" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {FEED_SKELETON_ROWS.map((idx) => (
                <VineFeedPostSkeleton key={`feed-skeleton-${idx}`} />
              ))}
            </>
          ) : posts.map((post, index) => (
            <div key={post.feed_id || `post-${post.id}`}>
              {suggestionSlots.includes(index) && suggestedUsers.length > 0 && (
                renderSuggestedVinersCarousel("Viners you may want to follow")
              )}
              <VinePostCard
                post={post}
                mediaLayout="collage"
                focusComments={String(targetPostId || "") === String(post.id) && Boolean(targetCommentId)}
                targetCommentId={String(targetPostId || "") === String(post.id) ? targetCommentId : null}
                communityInteractionLocked={
                  Number(post.community_id) > 0 &&
                  Number(post.viewer_community_member) !== 1
                }
              />
            </div>
          ))}

          {feedHasMore && posts.length > 0 && (
            <div className="vine-feed-more-wrap">
              <button
                type="button"
                className="vine-feed-more-btn"
                onClick={loadMoreFeed}
                disabled={feedLoadingMore}
              >
                {feedLoadingMore ? "Loading more..." : isNewsTab ? "More Vine News" : "Load more posts"}
              </button>
            </div>
          )}
          {!feedHasMore && posts.length > 0 && (
            <>
              <p className="no-more-posts">
                {isNewsTab
                  ? "No more Vine News updates"
                  : "You're all caught up. Follow more people to have more stories on your feed."}
              </p>
              {!isNewsTab && suggestedUsers.length > 0 &&
                renderSuggestedVinersCarousel(
                  "Viners you may know",
                  "Popular around Vine, with the most-followed showing first.",
                  { sortByFollowers: true }
                )}
            </>
          )}
          {!feedLoading && posts.length === 0 && (
            <>
              <p className="no-posts-hint">
                {isNewsTab
                  ? "No Vine News updates yet"
                  : "Follow more people to have more stories on your feed."}
              </p>
              {!isNewsTab && suggestedUsers.length > 0 &&
                renderSuggestedVinersCarousel(
                  "Viners you may know",
                  "Start with the people already pulling the strongest crowd on Vine.",
                  { sortByFollowers: true }
                )}
            </>
          )}
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

      <aside className="vine-right-sidebar" aria-label="Creator discovery">
        <div className="vine-right-sidebar-panel">
          <div className="vine-right-sidebar-head">
            <div className="vine-right-sidebar-kicker">Discover</div>
            <h3>On the rise</h3>
            <p>The people pulling the strongest energy on Vine this week.</p>
          </div>
          <div className="vine-right-sidebar-stack">
            {renderCreatorRailCard("Rising on Vine", "Momentum", creatorSpotlight.risingCreators, "rising")}
            {renderCreatorRailCard("Top creators this week", "Prestige", creatorSpotlight.topCreatorsWeek, "top")}
            {renderWhoToFollowRailCard(rightRailSuggestions)}
          </div>
          <div className="vine-right-sidebar-footer">
            <div className="vine-right-sidebar-footer-copy">Keep exploring the forest.</div>
            <div className="vine-right-sidebar-footer-actions">
              <button type="button" onClick={() => navigate("/vine/suggestions")}>Suggestions</button>
              <button type="button" onClick={() => navigate("/vine/search")}>Search</button>
            </div>
          </div>
        </div>
      </aside>
      </div>

      {desktopDmEnabled && desktopChatWindows.length > 0 && (
        <div className="vine-desktop-chat-dock" aria-label="Desktop chat windows">
          {desktopMinimizedWindows.length > 0 && (
            <div className="vine-desktop-chat-tabs">
              {desktopMinimizedWindows.map((windowItem) => {
                const avatarSrc = windowItem?.partner?.avatar_url
                  ? (windowItem.partner.avatar_url.startsWith("http")
                      ? windowItem.partner.avatar_url
                      : `${API}${windowItem.partner.avatar_url}`)
                  : DEFAULT_AVATAR;
                return (
                  <button
                    key={`tab-${windowItem.key}`}
                    type="button"
                    className="vine-desktop-chat-tab"
                    onClick={() => focusDesktopDmWindow(windowItem.key)}
                  >
                    <img
                      src={avatarSrc}
                      alt={windowItem?.partner?.username || "chat"}
                      onError={(e) => {
                        e.currentTarget.src = DEFAULT_AVATAR;
                      }}
                    />
                    <span>{windowItem?.partner?.display_name || windowItem?.partner?.username || "Chat"}</span>
                    {Number(windowItem?.incomingCount || 0) > 0 && (
                      <span className="vine-desktop-chat-badge" aria-label={`${windowItem.incomingCount} new messages`}>
                        {windowItem.incomingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="vine-desktop-chat-windows">
            {desktopExpandedWindows.map((windowItem, index) => (
              <div
                key={windowItem.key}
                className="vine-desktop-chat-pop"
                style={{ zIndex: 2600 + index }}
                onMouseDown={() => clearDesktopDmPing(windowItem.key)}
              >
                {Number(windowItem?.incomingCount || 0) > 0 && (
                  <span className="vine-desktop-chat-badge vine-desktop-chat-badge-floating" aria-label={`${windowItem.incomingCount} new messages`}>
                    {windowItem.incomingCount}
                  </span>
                )}
                <ChatWindow
                  compact
                  onClose={() => closeDesktopDmWindow(windowItem.key)}
                  onMinimize={() => toggleDesktopDmWindow(windowItem.key, true)}
                  conversationId={windowItem.conversationId}
                  receiverId={windowItem.receiverId}
                  initialPartner={windowItem.partner}
                />
              </div>
            ))}
          </div>
        </div>
      )}

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
            <label
              className={`status-media-picker ${STATUS_MEDIA_UPLOADS_FROZEN ? "disabled" : ""}`}
              onClick={(e) => {
                if (!STATUS_MEDIA_UPLOADS_FROZEN) return;
                e.preventDefault();
                alert("Status media uploads are temporarily disabled.");
              }}
            >
              Add photo/video
              <input
                type="file"
                accept="image/*,video/*,.heic,.heif"
                disabled={STATUS_MEDIA_UPLOADS_FROZEN}
                onChange={async (e) => {
                  if (STATUS_MEDIA_UPLOADS_FROZEN) return;
                  const file = e.target.files?.[0];
                  if (!file) return;
                  let picked = file;
                  if (isHeicLikeFile(file)) {
                    const convertedFile = await convertHeicFileToJpeg(file);
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
                  <div className="status-video-poster" aria-hidden="true">
                    <span className="status-video-play">▶</span>
                    <span className="status-video-label">Video ready to post</span>
                  </div>
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
              {statusViewsLoading && (
                <div className="status-viewer-skeleton-wrap" aria-hidden="true">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={`status-viewer-skeleton-${idx}`} className="status-viewer-row status-viewer-row-skeleton">
                      <div className="vine-skeleton-avatar small" />
                      <div className="status-viewer-skeleton-meta">
                        <div className="vine-skeleton-block status-viewer-skeleton-name" />
                        <div className="vine-skeleton-block status-viewer-skeleton-time" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
