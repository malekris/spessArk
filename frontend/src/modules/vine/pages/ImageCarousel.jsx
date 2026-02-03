import { useEffect, useRef, useState } from "react";

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
  // ── Parse images (support both array and single string) ──
  let images = [];
  try {
    images = JSON.parse(imageUrl);
  } catch {
    images = [imageUrl]; // backward compatibility for old single-image posts
  }

  // ── State & Refs ─────────────────────────────────
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await viewerRef.current.requestFullscreen();
  };
  
  // ── Render ───────────────────────────────────────
  return (
    <div className="carousel-wrapper">
      {/* Horizontal scrollable track */}
      <div
        className="carousel"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {images.map((src, i) => (
          <img
            key={i}
            src={normalize(src)}
            alt=""
            className="carousel-img"
            onClick={() => setViewerOpen(true)}
          />
        ))}
      </div>

      {/* Counter – only shown when multiple images */}
      {images.length > 1 && (
        <div className="carousel-counter">
          {currentIndex + 1} / {images.length}
        </div>
      )}

      {/* Navigation dots – only shown when multiple images */}
      {images.length > 1 && (
        <div className="carousel-dots">
          {images.map((_, i) => (
            <span
              key={i}
              className={`dot ${i === currentIndex ? "active" : ""}`}
              onClick={() => scrollTo(i)}
            />
          ))}
        </div>
      )}

      {/* Fullscreen viewer */}
      {viewerOpen && (
        <div
          className="image-viewer-overlay"
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
            {isFullscreen ? "⤫" : "⛶"}
          </button>

          <div
            className="image-viewer-content"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={normalize(images[currentIndex])}
              className="image-viewer-img"
              alt=""
            />

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
        </div>
      )}
    </div>
  );
}
