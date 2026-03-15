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

  return (
    <div className={`carousel-wrapper ${isSingle ? "single" : ""}`} ref={viewportRef}>
      {/* Horizontal scrollable track */}
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
                      onClick={() => setViewerOpen(true)}
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
                    onClick={() => setViewerOpen(true)}
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
