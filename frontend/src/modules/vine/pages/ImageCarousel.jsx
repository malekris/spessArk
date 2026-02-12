import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
}) {
  const isVideoUrl = (src) => {
    const s = String(src || "");
    return /\/video\/upload\//i.test(s) || /\.(mp4|mov|webm|m4v|avi|mkv|ogv)(\?|$)/i.test(s);
  };
  // ── Parse images (support both array and single string) ──
  let media = [];
  try {
    media = JSON.parse(imageUrl);
  } catch {
    media = [imageUrl]; // backward compatibility for old single-image posts
  }
  if (!Array.isArray(media)) media = [media];

  // ── State & Refs ─────────────────────────────────
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);

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
  
  // ── Render ───────────────────────────────────────
  const isSingle = media.length === 1;

  return (
    <div className={`carousel-wrapper ${isSingle ? "single" : ""}`}>
      {/* Horizontal scrollable track */}
      <div
        className="carousel"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {media.map((src, i) => (
          isVideoUrl(src) ? (
            <video
              key={i}
              src={normalize(src)}
              className="carousel-img"
              controls
              controlsList="nofullscreen noremoteplayback nodownload"
              disablePictureInPicture
              playsInline
              preload="metadata"
              onClick={() => setViewerOpen(true)}
            />
          ) : (
            <img
              key={i}
              src={normalize(src)}
              alt=""
              className="carousel-img"
              onClick={() => setViewerOpen(true)}
            />
          )
        ))}
      </div>

      {/* Counter – only shown when multiple images */}
      {media.length > 1 && (
        <div className="carousel-counter">
          {currentIndex + 1} / {media.length}
        </div>
      )}

      {/* Navigation dots – only shown when multiple images */}
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

      {/* Fullscreen viewer */}
      {viewerOpen &&
        createPortal(
          <div
            className={`image-viewer-overlay ${(isFullscreen || pseudoFullscreen) ? "fullscreen" : ""}`}
            onClick={() => setViewerOpen(false)}
            ref={viewerRef}
          >
            <button
              className="viewer-close"
              onClick={(e) => {
                e.stopPropagation();
                setViewerOpen(false);
              }}
            >
              ✕
            </button>

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
                <button className="viewer-action" onClick={() => onComments?.()}>
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
          </div>,
          document.body
        )}
    </div>
  );
}
