import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useNearScreen from "../../../hooks/useNearScreen";

const ORIGIN = import.meta.env.VITE_API_BASE || "http://localhost:5001";

// ────────────────────────────────────────────────
//  IMAGE CAROUSEL COMPONENT
// ────────────────────────────────────────────────

export default function ImageCarousel({
  imageUrl,
  onLike,
  onRevine,
  onComments,
  likeCount,
  revineCount,
  commentCount,
  userLiked,
  userRevined,
  displayName,
  username,
  timeLabel,
  caption,
  layout = "carousel",
  comments = null,
  commentsLoading = false,
  composerAvatar = "",
  canComment = true,
  commentDisabledMessage = "",
  onSubmitComment,
  onCommentAuthorClick,
}) {
  const isVideoUrl = (src) => {
    const s = String(src || "");
    return /\/video\/upload\//i.test(s) || /\.(mp4|mov|webm|m4v|avi|mkv|ogv)(\?|$)/i.test(s);
  };
  const media = useMemo(() => {
    let parsedMedia = [];
    try {
      parsedMedia = JSON.parse(imageUrl);
    } catch {
      parsedMedia = [imageUrl];
    }
    if (!Array.isArray(parsedMedia)) parsedMedia = [parsedMedia];
    return parsedMedia.filter(Boolean);
  }, [imageUrl]);
  const useCollageLayout =
    layout === "collage" &&
    media.length > 0 &&
    media.every((src) => !isVideoUrl(src));
  const visibleCollageMedia = useMemo(
    () => (useCollageLayout ? media.slice(0, 4) : []),
    [media, useCollageLayout]
  );

  // ── State & Refs ─────────────────────────────────
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const videoRefs = useRef([]);
  const [viewportRef, isCarouselVisible] = useNearScreen({
    rootMargin: "240px 0px",
    once: false,
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadedVideoIndexes, setLoadedVideoIndexes] = useState({});
  const [viewerOpen, setViewerOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [viewerCommentsOpen, setViewerCommentsOpen] = useState(false);
  const [viewerCommentDraft, setViewerCommentDraft] = useState("");
  const [viewerCommentSubmitting, setViewerCommentSubmitting] = useState(false);

  // ── Handlers ─────────────────────────────────────
  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    const newIndex = Math.round(container.scrollLeft / container.offsetWidth);
    setCurrentIndex(newIndex);
  };

  const scrollTo = (targetIndex) => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTo({
      left: container.offsetWidth * targetIndex,
      behavior: "smooth",
    });
  };
  const normalize = (src) =>
    src.startsWith("http") ? src : `${ORIGIN}${src}`;
  const openViewerAt = (targetIndex) => {
    setCurrentIndex(targetIndex);
    setViewerCommentsOpen(false);
    setViewerOpen(true);
  };
  const closeViewer = () => {
    setViewerOpen(false);
    setViewerCommentsOpen(false);
    setViewerCommentDraft("");
  };
  const showPrev = (event) => {
    event.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + media.length) % media.length);
  };
  const showNext = (event) => {
    event.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % media.length);
  };

  const loadVideoSlide = (index) => {
    setLoadedVideoIndexes((prev) => (prev[index] ? prev : { ...prev, [index]: true }));
  };

  useEffect(() => {
    if (!viewerOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [viewerOpen]);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!viewerRef.current) return;
    const el = viewerRef.current;
    try {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        setPseudoFullscreen(false);
        return;
      }

      if (el.requestFullscreen) {
        await el.requestFullscreen();
        return;
      }
      if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
        return;
      }
      if (el.msRequestFullscreen) {
        el.msRequestFullscreen();
        return;
      }
    } catch {
      // ignore and fallback
    }
    setPseudoFullscreen((v) => !v);
  };

  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (!video) return;
      const keepActive = viewerOpen || (isCarouselVisible && index === currentIndex);
      if (!keepActive) {
        try {
          video.pause();
        } catch {
          // noop
        }
      }
    });
  }, [currentIndex, isCarouselVisible, viewerOpen]);
  
  // ── Render ───────────────────────────────────────
  const isSingle = media.length === 1;
  const supportsViewerComments = Array.isArray(comments) && typeof onSubmitComment === "function";
  const formatCommentTime = (value) => {
    const timestamp = new Date(String(value || "").replace(" ", "T")).getTime();
    if (!Number.isFinite(timestamp)) return "";
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (elapsedSeconds < 60) return "Just now";
    if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m`;
    if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)}h`;
    return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const renderViewerComment = (comment, depth = 0) => (
    <div
      className={`viewer-comment-thread ${depth > 0 ? "is-reply" : ""}`}
      key={comment.id}
    >
      <article className="viewer-comment-row">
        <button
          type="button"
          className="viewer-comment-avatar"
          onClick={() => onCommentAuthorClick?.(comment.username)}
          aria-label={`View ${comment.display_name || comment.username || "user"}'s profile`}
        >
          <img
            src={comment.avatar_url || "/default-avatar.png"}
            alt=""
            onError={(event) => {
              event.currentTarget.src = "/default-avatar.png";
            }}
          />
        </button>
        <div className="viewer-comment-copy">
          <button
            type="button"
            className="viewer-comment-author"
            onClick={() => onCommentAuthorClick?.(comment.username)}
          >
            {comment.display_name || comment.username || "Vine user"}
            {Number(comment.is_verified) === 1 ? <span aria-label="Verified">✓</span> : null}
          </button>
          <p>{comment.content}</p>
          <time>{formatCommentTime(comment.created_at || comment.sort_time)}</time>
        </div>
      </article>
      {Array.isArray(comment.replies) && comment.replies.length > 0 ? (
        <div className="viewer-comment-replies">
          {comment.replies.map((reply) => renderViewerComment(reply, depth + 1))}
        </div>
      ) : null}
    </div>
  );
  const submitViewerComment = async (event) => {
    event.preventDefault();
    const content = viewerCommentDraft.trim();
    if (!content || viewerCommentSubmitting || !canComment) return;
    setViewerCommentSubmitting(true);
    try {
      const posted = await onSubmitComment?.(content);
      if (posted !== false) setViewerCommentDraft("");
    } finally {
      setViewerCommentSubmitting(false);
    }
  };

  return (
    <div
      className={`carousel-wrapper ${isSingle && !useCollageLayout ? "single" : ""} ${useCollageLayout ? "collage" : ""}`}
      ref={viewportRef}
    >
      {useCollageLayout ? (
        <div
          className={`carousel-collage carousel-collage-${Math.min(visibleCollageMedia.length, 4)} ${
            media.length > visibleCollageMedia.length ? "has-overflow" : ""
          }`}
        >
          {visibleCollageMedia.map((src, i) => {
            const hiddenCount = media.length - visibleCollageMedia.length;
            const showMoreOverlay = i === visibleCollageMedia.length - 1 && hiddenCount > 0;
            return (
              <button
                key={`collage-${i}`}
                type="button"
                className={`collage-tile collage-tile-${i + 1} ${showMoreOverlay ? "has-more" : ""}`}
                onClick={() => openViewerAt(i)}
              >
                <img
                  src={normalize(src)}
                  alt=""
                  className="carousel-img collage-img"
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                  fetchPriority={i === 0 ? "high" : "low"}
                />
                {showMoreOverlay && (
                  <span className="collage-more-overlay">+{hiddenCount}</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div
            className="carousel"
            ref={containerRef}
            onScroll={handleScroll}
          >
            {media.map((src, i) => {
              const isVideo = isVideoUrl(src);
              const isNearbySlide = Math.abs(i - currentIndex) <= 1;
              const shouldRenderMedia = viewerOpen || isNearbySlide || (!isVideo && i === 0);

              return (
                <div key={i} className="carousel-slide">
                  {shouldRenderMedia ? (
                    isVideo ? (
                      loadedVideoIndexes[i] ? (
                        <video
                          ref={(node) => {
                            videoRefs.current[i] = node;
                          }}
                          src={normalize(src)}
                          className="carousel-img"
                          controls
                          controlsList="nofullscreen noremoteplayback nodownload"
                          disablePictureInPicture
                          playsInline
                          preload={isCarouselVisible && i === currentIndex ? "metadata" : "none"}
                          onClick={() => openViewerAt(i)}
                        />
                      ) : (
                        <button
                          type="button"
                          className="carousel-video-poster"
                          onClick={() => loadVideoSlide(i)}
                        >
                          <video
                            src={normalize(src)}
                            className="carousel-video-preview"
                            muted
                            playsInline
                            preload={isCarouselVisible && (i === currentIndex || isNearbySlide) ? "auto" : "metadata"}
                            aria-hidden="true"
                            onLoadedMetadata={(event) => {
                              try {
                                event.currentTarget.currentTime = 0.1;
                              } catch {
                                // ignore preview seek misses
                              }
                            }}
                          />
                          <span className="carousel-video-overlay" aria-hidden="true" />
                          <span className="carousel-video-play">▶</span>
                          <span className="carousel-video-note">Tap to load video</span>
                        </button>
                      )
                    ) : (
                      <img
                        src={normalize(src)}
                        alt=""
                        className="carousel-img"
                        loading={i === 0 ? "eager" : "lazy"}
                        decoding="async"
                        fetchPriority={i === 0 ? "high" : "low"}
                        onClick={() => openViewerAt(i)}
                      />
                    )
                  ) : (
                    <div className={`carousel-placeholder ${isVideo ? "video" : "image"}`} aria-hidden="true">
                      <span>{isVideo ? "Video" : "Image"}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {media.length > 1 && (
            <div className="carousel-counter">
              {currentIndex + 1} / {media.length}
            </div>
          )}

          {media.length > 1 && (
            <div className="carousel-dots">
              {media.map((_, i) => (
                <span
                  key={i}
                  className={`dot ${i === currentIndex ? "active" : ""}`}
                  onClick={() => scrollTo(i)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Fullscreen viewer */}
      {viewerOpen &&
        createPortal(
          <div
            className={`image-viewer-overlay ${(isFullscreen || pseudoFullscreen) ? "fullscreen" : ""} ${viewerCommentsOpen ? "viewer-comments-visible" : ""}`}
            onClick={closeViewer}
            ref={viewerRef}
          >
            <button
              className="viewer-close"
              onClick={(e) => {
                e.stopPropagation();
                closeViewer();
              }}
            >
              ✕
            </button>

            {media.length > 1 && (
              <>
                <button className="viewer-nav prev" onClick={showPrev}>
                  ‹
                </button>
                <button className="viewer-nav next" onClick={showNext}>
                  ›
                </button>
              </>
            )}

              <button
                className="viewer-fullscreen"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFullscreen();
                }}
              >
              {(isFullscreen || pseudoFullscreen) ? "⤫" : "⛶"}
              </button>

            <div
              className="image-viewer-content"
              onClick={(e) => e.stopPropagation()}
            >
              {isVideoUrl(media[currentIndex]) ? (
                <video
                  src={normalize(media[currentIndex])}
                  className="image-viewer-img"
                  controls
                  controlsList="nofullscreen noremoteplayback nodownload"
                  disablePictureInPicture
                  autoPlay
                  playsInline
                />
              ) : (
                <img
                  src={normalize(media[currentIndex])}
                  className="image-viewer-img"
                  alt=""
                />
              )}

              {(displayName || username || timeLabel || caption) && (
                <div className="viewer-meta">
                  <div className="viewer-meta-top">
                    <span className="viewer-name">
                      {displayName || username}
                    </span>
                    {username && displayName && (
                      <span className="viewer-username">@{username}</span>
                    )}
                    {timeLabel && (
                      <span className="viewer-time">{timeLabel}</span>
                    )}
                  </div>
                  {caption && (
                    <div className="viewer-caption">{caption}</div>
                  )}
                </div>
              )}

              <div className="viewer-action-bar">
                <button
                  className={`viewer-action ${userLiked ? "active-like" : ""}`}
                  onClick={() => onLike?.()}
                >
                  {userLiked ? "❤️" : "🤍"}
                  {likeCount !== null && likeCount !== undefined && ` ${likeCount}`}
                </button>
                <button
                  className={`viewer-action ${viewerCommentsOpen ? "active-comment" : ""}`}
                  aria-expanded={viewerCommentsOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!supportsViewerComments) {
                      onComments?.();
                      return;
                    }
                    const nextOpen = !viewerCommentsOpen;
                    setViewerCommentsOpen(nextOpen);
                    if (nextOpen) onComments?.();
                  }}
                >
                  💬 {commentCount ?? 0}
                </button>
                <button
                  className={`viewer-action ${userRevined ? "active-revine" : ""}`}
                  onClick={() => onRevine?.()}
                >
                  🔁 {revineCount ?? 0}
                </button>
              </div>
            </div>

            {viewerCommentsOpen && supportsViewerComments ? (
              <aside className="viewer-comments-drawer" onClick={(event) => event.stopPropagation()}>
                <header className="viewer-comments-header">
                  <div>
                    <span>Conversation</span>
                    <strong>Comments</strong>
                  </div>
                  <div className="viewer-comments-header-actions">
                    <span>{commentCount ?? 0}</span>
                    <button
                      type="button"
                      onClick={() => setViewerCommentsOpen(false)}
                      aria-label="Close comments"
                    >
                      ×
                    </button>
                  </div>
                </header>

                <div className="viewer-comments-list">
                  {commentsLoading ? (
                    <div className="viewer-comments-state">Loading comments…</div>
                  ) : comments.length > 0 ? (
                    comments.map((comment) => renderViewerComment(comment))
                  ) : (
                    <div className="viewer-comments-state">
                      <span aria-hidden="true">💬</span>
                      <strong>Start the conversation</strong>
                      <p>Be the first to comment on this post.</p>
                    </div>
                  )}
                </div>

                {commentDisabledMessage ? (
                  <div className="viewer-comments-disabled">{commentDisabledMessage}</div>
                ) : null}

                <form className="viewer-comment-composer" onSubmit={submitViewerComment}>
                  <img
                    src={composerAvatar || "/default-avatar.png"}
                    alt=""
                    onError={(event) => {
                      event.currentTarget.src = "/default-avatar.png";
                    }}
                  />
                  <textarea
                    value={viewerCommentDraft}
                    onChange={(event) => setViewerCommentDraft(event.target.value.slice(0, 5000))}
                    placeholder={canComment ? "Write a comment…" : "Comments unavailable"}
                    rows="1"
                    disabled={!canComment || viewerCommentSubmitting}
                  />
                  <button
                    type="submit"
                    disabled={!canComment || !viewerCommentDraft.trim() || viewerCommentSubmitting}
                  >
                    {viewerCommentSubmitting ? "Posting…" : "Post"}
                  </button>
                </form>
              </aside>
            ) : null}
          </div>,
          document.body
        )}
    </div>
  );
}
