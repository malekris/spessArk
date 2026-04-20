import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ImageCarousel from "./ImageCarousel";
import { getVineToken, isVineTokenExpired } from "../utils/vineAuth";
import "./VinePublicPost.css";
import "./VinePublicProfile.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

const parseLinkPreview = (value) => {
  if (!value) return null;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
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
    if (key === "feeling" && !feeling) feeling = value.toLowerCase();
    if (key === "postbg" && !postBg && /^#[0-9a-f]{6}$/i.test(value)) postBg = value;
    out = out.slice(match[0].length);
  }
  return { feeling, postBg, content: out };
};

const formatFeelingLabel = (value) =>
  String(value || "")
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const getContrastTextColor = (hex) => {
  const clean = String(hex || "").replace("#", "");
  if (clean.length !== 6) return "#ffffff";
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#052e16" : "#ffffff";
};

const renderPublicMentions = (text) => {
  const source = String(text || "");
  const parts = source.split(/(@[a-zA-Z0-9._]{1,30})/g);
  return parts.map((part, index) => {
    if (!/^@[a-zA-Z0-9._]{1,30}$/.test(part)) {
      return <span key={`public-profile-text-${index}`}>{part}</span>;
    }
    const username = part.slice(1);
    if (username.toLowerCase() === "all") {
      return <span key={`public-profile-text-${index}`}>{part}</span>;
    }
    return (
      <Link key={`public-profile-mention-${index}-${username}`} className="public-mention" to={`/vine/u/${username}`}>
        {part}
      </Link>
    );
  });
};

const hasSpecialVerifiedBadge = (username) =>
  ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
    String(username || "").toLowerCase()
  );

const showsVerifiedBadge = (user) =>
  Number(user?.is_verified) === 1 || hasSpecialVerifiedBadge(user?.username);

const getLearningBadgeTone = (badge) => {
  const value = String(badge || "").toLowerCase();
  if (value.includes("on-time")) return "streak";
  if (value.includes("perfect")) return "perfect";
  if (value.includes("consistent")) return "consistent";
  if (value.includes("achiever")) return "achiever";
  return "default";
};

const LEARNING_BADGE_ORDER = {
  "🎯 Perfect Score": 0,
  "🏅 High Achiever": 1,
  "🔥 On-Time Streak": 2,
  "📚 Consistent Learner": 3,
};

const sortLearningBadges = (badges) =>
  [...(Array.isArray(badges) ? badges : [])].sort((a, b) => {
    const aRank = LEARNING_BADGE_ORDER[a] ?? 99;
    const bRank = LEARNING_BADGE_ORDER[b] ?? 99;
    if (aRank !== bRank) return aRank - bRank;
    return String(a).localeCompare(String(b));
  });

const formatPostDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameYear = now.getFullYear() === date.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
};

export default function VinePublicProfile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const token = getVineToken();
  const loggedIn = Boolean(token) && !isVineTokenExpired(token);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);

  const authHeaders = useMemo(
    () => (loggedIn ? { Authorization: `Bearer ${token}` } : {}),
    [loggedIn, token]
  );
  const protectedProfileTarget = `/vine/profile/${encodeURIComponent(username || "")}`;

  const loadProfile = async ({ append = false, offset = 0 } = {}) => {
    const setter = append ? setLoadingMore : setLoading;
    setter(true);
    if (!append) setError("");
    try {
      const headerRes = await fetch(`${API}/api/vine/users/${encodeURIComponent(username)}/header`, {
        headers: authHeaders,
        cache: "no-store",
      });
      const headerData = await headerRes.json().catch(() => ({}));
      if (!headerRes.ok) {
        setError(headerData.message || "Profile unavailable");
        if (!append) {
          setProfile(null);
          setPosts([]);
        }
        return;
      }
      setProfile(headerData);

      if (headerData.blocked || headerData.privateLocked) {
        setPosts([]);
        setHasMore(false);
        setNextOffset(0);
        return;
      }

      const postsRes = await fetch(
        `${API}/api/vine/users/${encodeURIComponent(username)}/posts?limit=12&offset=${offset}`,
        {
          headers: authHeaders,
          cache: "no-store",
        }
      );
      const postsData = await postsRes.json().catch(() => ({}));
      const items = Array.isArray(postsData?.items) ? postsData.items : [];
      setPosts((prev) => (append ? [...prev, ...items] : items));
      setHasMore(Boolean(postsData?.hasMore));
      setNextOffset(Number(postsData?.nextOffset ?? offset + items.length));
    } catch {
      setError("We could not load this profile right now.");
      if (!append) {
        setProfile(null);
        setPosts([]);
      }
    } finally {
      setter(false);
    }
  };

  useEffect(() => {
    if (!username) return;
    loadProfile({ append: false, offset: 0 });
  }, [username]);

  useEffect(() => {
    if (profile?.user?.display_name || profile?.user?.username) {
      document.title = `${profile.user.display_name || profile.user.username} on SPESS Vine`;
    } else {
      document.title = "SPESS Vine";
    }
  }, [profile]);

  const openProtectedProfile = () => {
    if (loggedIn) {
      navigate(protectedProfileTarget);
      return;
    }
    navigate(`/vine/login?redirect=${encodeURIComponent(protectedProfileTarget)}`);
  };

  return (
    <div className="vine-public-shell">
      <div className="vine-public-topbar">
        <Link to="/" className="vine-public-back">← Home</Link>
        <div className="vine-public-brand">🌱 Vine</div>
        <button type="button" className="vine-public-login-top" onClick={openProtectedProfile}>
          {loggedIn ? "Open in Vine" : "Log in"}
        </button>
      </div>

      <div className="vine-public-wrap vine-public-profile-wrap">
        {loading ? (
          <div className="vine-public-state">Loading profile…</div>
        ) : error ? (
          <div className="vine-public-state error">{error}</div>
        ) : profile?.user ? (
          <>
            <section className="vine-public-card vine-public-profile-card">
              <div className="vine-public-profile-head">
                <img
                  src={profile.user.avatar_url || DEFAULT_AVATAR}
                  alt={profile.user.username}
                  className="vine-public-profile-avatar"
                  onError={(e) => {
                    e.currentTarget.src = DEFAULT_AVATAR;
                  }}
                />
                <div className="vine-public-profile-meta">
                  <div className="vine-public-name-row">
                    <div className="vine-public-name">
                      {profile.user.display_name || profile.user.username}
                      {showsVerifiedBadge(profile.user) && (
                        <span className={`vine-public-verified ${hasSpecialVerifiedBadge(profile.user.username) ? "guardian" : ""}`}>✓</span>
                      )}
                    </div>
                  </div>
                  <div className="vine-public-handle">@{profile.user.username}</div>
                  {Array.isArray(profile.user.learning_badges) && profile.user.learning_badges.length > 0 ? (
                    <div className="vine-public-learning-badge-block" aria-label="Learner badges">
                      <div className="vine-public-learning-badge-label">Learner badges</div>
                      <div className="vine-public-learning-badges">
                        {sortLearningBadges(profile.user.learning_badges).map((badge) => (
                          <span
                            key={`public-profile-learning-badge-${badge}`}
                            className={`vine-public-learning-badge ${getLearningBadgeTone(badge)}`}
                          >
                            {badge}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {profile.user.bio ? <div className="vine-public-profile-bio">{profile.user.bio}</div> : null}
                  <div className="vine-public-profile-stats">
                    <span><strong>{profile.user.post_count || 0}</strong> posts</span>
                    <span><strong>{profile.user.follower_count || 0}</strong> followers</span>
                    <span><strong>{profile.user.following_count || 0}</strong> following</span>
                  </div>
                  {(profile.user.location || profile.user.website) && (
                    <div className="vine-public-profile-extras">
                      {profile.user.location ? <span>{profile.user.location}</span> : null}
                      {profile.user.website ? (
                        <a href={profile.user.website} target="_blank" rel="noreferrer">
                          {profile.user.website}
                        </a>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {profile.blocked ? (
              <div className="vine-public-state">You have been blocked.</div>
            ) : profile.privateLocked ? (
              <div className="vine-public-state">This profile is private.</div>
            ) : (
              <section className="vine-public-profile-posts">
                {posts.length === 0 ? (
                  <div className="vine-public-state">No public posts yet.</div>
                ) : (
                  posts.map((post) => {
                    const linkPreview = parseLinkPreview(post.link_preview);
                    const { feeling, postBg, content } = extractPostMetaFromContent(post.content || "");
                    const postSourceLabel = String(post.post_source_label || post.posted_from_label || "").trim();
                    const contentWordCount = content ? content.split(/\s+/).filter(Boolean).length : 0;
                    const useStyledTextCard =
                      Boolean(postBg) &&
                      contentWordCount > 0 &&
                      contentWordCount <= 22 &&
                      !post.image_url &&
                      !post.link_preview &&
                      !post.has_poll;
                    const contentStyle = useStyledTextCard
                      ? { background: postBg, color: getContrastTextColor(postBg) }
                      : undefined;

                    return (
                      <article key={post.feed_id || post.id} className="vine-public-card vine-public-post-row">
                        {Number(post.revined_by) === 1 && post.reviner_username ? (
                          <div className="vine-public-revine-pill">🔁 @{post.reviner_username} revined</div>
                        ) : null}
                        <div className="vine-public-post-meta">
                          {feeling ? (
                            <span className="vine-public-feeling">is feeling {formatFeelingLabel(feeling)}</span>
                          ) : null}
                          {(post.sort_time || post.created_at || postSourceLabel) ? (
                            <div className="vine-classic-post-meta">
                              {(post.sort_time || post.created_at) ? (
                                <span className="vine-classic-post-time">
                                  {formatPostDate(post.sort_time || post.created_at)}
                                </span>
                              ) : null}
                              {(post.sort_time || post.created_at) && postSourceLabel ? (
                                <span className="vine-classic-post-separator">·</span>
                              ) : null}
                              {postSourceLabel ? (
                                <span className="vine-classic-post-source">Posted from {postSourceLabel}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        {content ? (
                          <div
                            className={`vine-public-content ${useStyledTextCard ? "styled-card-text" : ""} ${
                              content.length < 120 && !post.image_url ? "big-text" : ""
                            }`}
                            style={contentStyle}
                          >
                            {renderPublicMentions(content)}
                          </div>
                        ) : null}

                        {post.image_url ? (
                          <ImageCarousel
                            imageUrl={post.image_url}
                            layout="collage"
                            onLike={() => navigate(`/vine/post/${post.id}`)}
                            onRevine={() => navigate(`/vine/post/${post.id}`)}
                            onComments={() => navigate(`/vine/post/${post.id}`)}
                            likeCount={post.likes}
                            revineCount={post.revines}
                            commentCount={post.comments}
                            userLiked={false}
                            userRevined={false}
                            displayName={post.display_name}
                            username={post.username}
                            timeLabel={formatPostDate(post.created_at)}
                            caption={content}
                          />
                        ) : null}

                        {!post.image_url && linkPreview?.url ? (
                          <a className="vine-public-link-preview" href={linkPreview.url} target="_blank" rel="noreferrer">
                            {linkPreview.image ? <img src={linkPreview.image} alt={linkPreview.title || "Preview"} loading="lazy" decoding="async" /> : null}
                            <div>
                              <div className="vine-public-link-title">{linkPreview.title || linkPreview.url}</div>
                              {linkPreview.description ? <div className="vine-public-link-desc">{linkPreview.description}</div> : null}
                              <div className="vine-public-link-url">{linkPreview.url}</div>
                            </div>
                          </a>
                        ) : null}

                        <div className="vine-public-profile-post-footer">
                          <span>{post.likes || 0} likes</span>
                          <span>{post.comments || 0} comments</span>
                          <span>{post.revines || 0} revines</span>
                          <Link to={`/vine/post/${post.id}`} className="vine-public-open-post">Open post</Link>
                        </div>
                      </article>
                    );
                  })
                )}
                {hasMore && (
                  <button
                    type="button"
                    className="vine-public-load-more"
                    disabled={loadingMore}
                    onClick={() => loadProfile({ append: true, offset: nextOffset })}
                  >
                    {loadingMore ? "Loading…" : "Load more posts"}
                  </button>
                )}
              </section>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
