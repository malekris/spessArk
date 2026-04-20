import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ImageCarousel from "./ImageCarousel";
import { getVineToken, isVineTokenExpired } from "../utils/vineAuth";
import "./VinePublicPost.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const DEFAULT_AVATAR = "/default-avatar.png";

const buildThreads = (comments) => {
  const map = {};
  const roots = [];

  (comments || []).forEach((c) => {
    map[c.id] = { ...c, replies: [] };
  });

  (comments || []).forEach((c) => {
    if (c.parent_comment_id && map[c.parent_comment_id]) {
      map[c.parent_comment_id].replies.push(map[c.id]);
    } else {
      roots.push(map[c.id]);
    }
  });

  return roots;
};

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
      return <span key={`public-text-${index}`}>{part}</span>;
    }
    const username = part.slice(1);
    if (username.toLowerCase() === "all") {
      return <span key={`public-text-${index}`}>{part}</span>;
    }
    return (
      <Link key={`public-mention-${index}-${username}`} className="public-mention" to={`/vine/u/${username}`}>
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

function CommentTree({ comment, depth = 0, targetCommentId = null }) {
  const specialBadge = hasSpecialVerifiedBadge(comment.username);
  const isTargetComment = String(comment.id) === String(targetCommentId || "");

  return (
    <div
      id={`public-comment-${comment.id}`}
      className={`public-comment ${isTargetComment ? "highlight-comment" : ""}`}
      style={{ marginLeft: depth ? Math.min(depth * 18, 42) : 0 }}
    >
      <Link to={`/vine/u/${comment.username}`} className="public-comment-avatar-link">
        <img
          src={comment.avatar_url || DEFAULT_AVATAR}
          alt={comment.username}
          className="public-comment-avatar"
          onError={(e) => {
            e.currentTarget.src = DEFAULT_AVATAR;
          }}
        />
      </Link>
      <div className="public-comment-body">
        <div className="public-comment-top">
          <Link to={`/vine/u/${comment.username}`} className="public-comment-name">
            {comment.display_name || comment.username}
            {showsVerifiedBadge(comment) && (
              <span className={`vine-public-verified ${specialBadge ? "guardian" : ""}`}>✓</span>
            )}
          </Link>
          <span className="public-comment-date">{formatPostDate(comment.created_at)}</span>
        </div>
        <div className="public-comment-text">{renderPublicMentions(comment.content)}</div>
        {comment.replies?.length > 0 && (
          <div className="public-comment-replies">
            {comment.replies.map((reply) => (
              <CommentTree
                key={reply.id}
                comment={reply}
                depth={depth + 1}
                targetCommentId={targetCommentId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function VinePublicPost() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = getVineToken();
  const loggedIn = Boolean(token) && !isVineTokenExpired(token);
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joinPromptOpen, setJoinPromptOpen] = useState(false);
  const [joinAction, setJoinAction] = useState("comment");
  const targetCommentId = searchParams.get("comment");

  const redirectTarget = useMemo(() => {
    const params = new URLSearchParams();
    params.set("post", String(id));
    if (isVineNewsIdentity(post)) {
      params.set("tab", "news");
    }
    return `/vine/feed?${params.toString()}`;
  }, [id, post]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const postRes = await fetch(`${API}/api/vine/posts/${id}/public`, { cache: "no-store" });
        const postData = await postRes.json().catch(() => ({}));
        if (!postRes.ok) {
          setError(postData.message || "Post unavailable");
          setPost(null);
          setComments([]);
          return;
        }

        setPost(postData);

        const commentsRes = await fetch(`${API}/api/vine/posts/${id}/comments`, { cache: "no-store" });
        const commentsData = await commentsRes.json().catch(() => []);
        setComments(Array.isArray(commentsData) ? buildThreads(commentsData) : []);
      } catch {
        setError("We could not load this Vine post right now.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  useEffect(() => {
    if (post?.display_name || post?.username) {
      document.title = `${post.display_name || post.username} on SPESS Vine`;
    } else {
      document.title = "SPESS Vine";
    }
  }, [post]);

  const linkPreview = parseLinkPreview(post?.link_preview);
  const { feeling: postFeeling, postBg, content: publicPostContent } = extractPostMetaFromContent(
    post?.content || ""
  );
  const publicPostSourceLabel = String(post?.post_source_label || post?.posted_from_label || "").trim();
  const contentWordCount = publicPostContent
    ? publicPostContent.split(/\s+/).filter(Boolean).length
    : 0;
  const useStyledTextCard =
    Boolean(postBg) &&
    contentWordCount > 0 &&
    contentWordCount <= 22 &&
    !post?.image_url &&
    !post?.link_preview &&
    !post?.has_poll;
  const publicContentStyle = useStyledTextCard
    ? {
        background: postBg,
        color: getContrastTextColor(postBg),
      }
    : undefined;

  const openJoinPrompt = (action) => {
    if (loggedIn) {
      navigate(
        action === "comment" && targetCommentId
          ? `${redirectTarget}&comment=${encodeURIComponent(targetCommentId)}`
          : redirectTarget
      );
      return;
    }
    setJoinAction(action || "comment");
    setJoinPromptOpen(true);
  };

  useEffect(() => {
    if (!targetCommentId || loading) return;
    const timer = window.setTimeout(() => {
      const commentEl = document.querySelector(`#public-comment-${targetCommentId}`);
      if (!commentEl) return;
      commentEl.scrollIntoView({ behavior: "smooth", block: "center" });
      commentEl.classList.add("comment-pulse");
      window.setTimeout(() => commentEl.classList.remove("comment-pulse"), 1800);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [targetCommentId, loading, comments]);

  const specialBadge = hasSpecialVerifiedBadge(post?.username);

  return (
    <div className="vine-public-shell">
      <div className="vine-public-topbar">
        <Link to="/" className="vine-public-back">← Home</Link>
        <div className="vine-public-brand">🌱 Vine</div>
        {loggedIn ? (
          <button
            type="button"
            className="vine-public-login-top"
            onClick={() => navigate(redirectTarget)}
          >
            Open in feed
          </button>
        ) : (
          <Link to={`/vine/login?redirect=${encodeURIComponent(redirectTarget)}`} className="vine-public-login-top">
            Log in
          </Link>
        )}
      </div>

      <div className="vine-public-wrap">
        {loading ? (
          <div className="vine-public-state">Loading shared post…</div>
        ) : error ? (
          <div className="vine-public-state error">{error}</div>
        ) : post ? (
          <>
            <div className="vine-public-card">
              <div className="vine-public-header">
                <Link to={`/vine/u/${post.username}`} className="vine-public-avatar-link">
                  <img
                    src={post.avatar_url || DEFAULT_AVATAR}
                    alt={post.username}
                    className="vine-public-avatar"
                    onError={(e) => {
                      e.currentTarget.src = DEFAULT_AVATAR;
                    }}
                  />
                </Link>
                <div className="vine-public-meta">
                  <div className="vine-public-name-row">
                    <Link to={`/vine/u/${post.username}`} className="vine-public-name">
                      {post.display_name || post.username}
                      {showsVerifiedBadge(post) && (
                        <span className={`vine-public-verified ${specialBadge ? "guardian" : ""}`}>✓</span>
                      )}
                    </Link>
                    {postFeeling ? (
                      <span className="vine-public-feeling">
                        is feeling {formatFeelingLabel(postFeeling)}
                      </span>
                    ) : null}
                  </div>
                  <div className="vine-public-handle">
                    <span>@{post.username} · {formatPostDate(post.created_at)}</span>
                    {publicPostSourceLabel ? (
                      <span className="vine-public-source-badge">Posted from {publicPostSourceLabel}</span>
                    ) : null}
                  </div>
                </div>
              </div>

              {publicPostContent ? (
                <div
                  className={`vine-public-content ${useStyledTextCard ? "styled-card-text" : ""} ${
                    publicPostContent.length < 120 && !post.image_url ? "big-text" : ""
                  }`}
                  style={publicContentStyle}
                >
                  {renderPublicMentions(publicPostContent)}
                </div>
              ) : null}

              {post.image_url ? (
                <div className="vine-public-media-shell">
                  <ImageCarousel
                    imageUrl={post.image_url}
                    layout="collage"
                    onLike={() => openJoinPrompt("like")}
                    onRevine={() => openJoinPrompt("revine")}
                    onComments={() => openJoinPrompt("comment")}
                    likeCount={post.likes}
                    revineCount={post.revines}
                    commentCount={post.comments}
                    userLiked={false}
                    userRevined={false}
                    displayName={post.display_name}
                    username={post.username}
                    timeLabel={formatPostDate(post.created_at)}
                    caption={post.content}
                  />
                </div>
              ) : null}

              {!post.image_url && linkPreview?.url ? (
                <a
                  className="vine-public-link-preview"
                  href={linkPreview.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {linkPreview.image ? (
                    <img
                      src={linkPreview.image}
                      alt={linkPreview.title || "Preview"}
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                    />
                  ) : null}
                  <div>
                    <div className="vine-public-link-title">{linkPreview.title || linkPreview.url}</div>
                    {linkPreview.description ? <div className="vine-public-link-desc">{linkPreview.description}</div> : null}
                    <div className="vine-public-link-url">{linkPreview.url}</div>
                  </div>
                </a>
              ) : null}

              <div className="vine-public-actions">
                <button type="button" onClick={() => openJoinPrompt("like")}>🤍 {post.likes || 0}</button>
                <button type="button" onClick={() => openJoinPrompt("comment")}>💬 {post.comments || 0}</button>
                <button type="button" onClick={() => openJoinPrompt("revine")}>🔁 {post.revines || 0}</button>
                <button type="button" onClick={() => openJoinPrompt("bookmark")}>🔖</button>
              </div>

              <div
                className="vine-public-comment-cta"
                role="button"
                tabIndex={0}
                onClick={() => openJoinPrompt("comment")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openJoinPrompt("comment");
                  }
                }}
              >
                <div className="vine-public-comment-placeholder">Join SPESS Vine Today to add a comment</div>
                <div className="vine-public-comment-btn">Comment</div>
              </div>
            </div>

            <div className="vine-public-comments-card">
              <div className="vine-public-comments-title">Comments</div>
              {comments.length > 0 ? (
                comments.map((comment) => (
                  <CommentTree
                    key={comment.id}
                    comment={comment}
                    targetCommentId={targetCommentId}
                  />
                ))
              ) : (
                <div className="vine-public-empty">No comments yet.</div>
              )}
            </div>
          </>
        ) : null}
      </div>

      {joinPromptOpen && (
        <div className="vine-public-prompt-backdrop" onClick={() => setJoinPromptOpen(false)}>
          <div className="vine-public-prompt" onClick={(e) => e.stopPropagation()}>
            <div className="vine-public-prompt-kicker">SPESS Vine</div>
            <h2>Join SPESS Vine Today</h2>
            <p>
              {joinAction === "like" && "Create an account or log in to like this post and react with the community."}
              {joinAction === "comment" && "Create an account or log in to comment and join the conversation around this post."}
              {joinAction === "revine" && "Create an account or log in to revine this post with your followers."}
              {joinAction === "bookmark" && "Create an account or log in to save this post to your bookmarks."}
            </p>
            <div className="vine-public-prompt-actions">
              <Link to={`/vine/register?redirect=${encodeURIComponent(redirectTarget)}`} className="join-now-btn">
                Create account
              </Link>
              <Link to={`/vine/login?redirect=${encodeURIComponent(redirectTarget)}`} className="login-now-btn">
                Log in
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
