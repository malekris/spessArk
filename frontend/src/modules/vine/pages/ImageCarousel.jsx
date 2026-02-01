import { useRef, useState } from "react";

const ORIGIN = import.meta.env.VITE_API_BASE || "http://localhost:5001";

// ────────────────────────────────────────────────
//  IMAGE CAROUSEL COMPONENT
// ────────────────────────────────────────────────

export default function ImageCarousel({ imageUrl }) {
  // ── Parse images (support both array and single string) ──
  let images = [];
  try {
    images = JSON.parse(imageUrl);
  } catch {
    images = [imageUrl]; // backward compatibility for old single-image posts
  }

  // ── State & Refs ─────────────────────────────────
  const containerRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);

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
            src={src}
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
        >
          <button
            className="viewer-close"
            onClick={() => setViewerOpen(false)}
          >
            ✕
          </button>

          <img
            src={images[currentIndex]}
            className="image-viewer-img"
            onClick={(e) => e.stopPropagation()}
            alt=""
          />
        </div>
      )}
    </div>
  );
}