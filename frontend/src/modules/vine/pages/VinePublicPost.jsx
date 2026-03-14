import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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

function CommentTree({ comment, depth = 0 }) {
  return (
    <div className="public-comment" style={{ marginLeft: depth ? Math.min(depth * 18, 42) : 0 }}>
      <img
        src={comment.avatar_url || DEFAULT_AVATAR}
        alt={comment.username}
        className="public-comment-avatar"
        onError={(e) => {
          e.currentTarget.src = DEFAULT_AVATAR;
        }}
      />
      <div className="public-comment-body">
        <div className="public-comment-top">
          <span className="public-comment-name">{comment.display_name || comment.username}</span>
          <span className="public-comment-date">{formatPostDate(comment.created_at)}</span>
        </div>
        <div className="public-comment-text">{comment.content}</div>
        {comment.replies?.length > 0 && (
          <div className="public-comment-replies">
            {comment.replies.map((reply) => (
              <CommentTree key={reply.id} comment={reply} depth={depth + 1} />
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
  const token = getVineToken();
  const loggedIn = Boolean(token) && !isVineTokenExpired(token);
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joinPromptOpen, setJoinPromptOpen] = useState(false);
  const [joinAction, setJoinAction] = useState("comment");

  const redirectTarget = useMemo(() => `/vine/feed?post=${id}`, [id]);

  useEffect(() => {
    if (loggedIn && id) {
      navigate(redirectTarget, { replace: true });
    }
  }, [loggedIn, id, navigate, redirectTarget]);

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

  const openJoinPrompt = (action) => {
    setJoinAction(action || "comment");
    setJoinPromptOpen(true);
  };

  return (
    <div className="vine-public-shell">
      <div className="vine-public-topbar">
        <Link to="/" className="vine-public-back">← Home</Link>
        <div className="vine-public-brand">🌱 Vine</div>
        <Link to={`/vine/login?redirect=${encodeURIComponent(redirectTarget)}`} className="vine-public-login-top">
          Log in
        </Link>
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
                <img
                  src={post.avatar_url || DEFAULT_AVATAR}
                  alt={post.username}
                  className="vine-public-avatar"
                  onError={(e) => {
                    e.currentTarget.src = DEFAULT_AVATAR;
                  }}
                />
                <div className="vine-public-meta">
                  <div className="vine-public-name">{post.display_name || post.username}</div>
                  <div className="vine-public-handle">@{post.username} · {formatPostDate(post.created_at)}</div>
                </div>
              </div>

              {post.content ? <div className="vine-public-content">{post.content}</div> : null}

              {post.image_url ? (
                <ImageCarousel
                  imageUrl={post.image_url}
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
              ) : null}

              {!post.image_url && linkPreview?.url ? (
                <a
                  className="vine-public-link-preview"
                  href={linkPreview.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {linkPreview.image ? <img src={linkPreview.image} alt={linkPreview.title || "Preview"} /> : null}
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
                  <CommentTree key={comment.id} comment={comment} />
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
