import { useState, useEffect, useRef } from "react";
import "./ActivitiesSection.css";

export default function ActivitiesSection() {
  const images = Array.from({ length: 20 }, (_, i) => `/image${i + 1}.jpg`);

  const [activeIndex, setActiveIndex] = useState(null);
  const startX = useRef(0);
  const endX = useRef(0);

  const closeLightbox = () => setActiveIndex(null);

  const showNext = () => {
    setActiveIndex((prev) => (prev + 1) % images.length);
  };

  const showPrev = () => {
    setActiveIndex((prev) =>
      prev === 0 ? images.length - 1 : prev - 1
    );
  };

  // Keyboard arrows (desktop)
  useEffect(() => {
    const handleKey = (e) => {
      if (activeIndex === null) return;
      if (e.key === "ArrowRight") showNext();
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "Escape") closeLightbox();
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeIndex]);

  // Swipe handlers
  const handleTouchStart = (e) => {
    startX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e) => {
    endX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = startX.current - endX.current;

    if (diff > 60) showNext();   // swipe left
    if (diff < -60) showPrev();  // swipe right
  };

  return (
    <section id="activities" className="activities-section">
      <h2>School Activities</h2>

      {/* GRID */}
      <div className="activities-grid">
        {images.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            className="activities-img"
            onClick={() => setActiveIndex(i)}
          />
        ))}
      </div>

      {/* LIGHTBOX */}
      {activeIndex !== null && (
        <div className="lightbox" onClick={closeLightbox}>
          <img
            src={images[activeIndex]}
            className="lightbox-img"
            alt=""
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />

          <button className="lightbox-close" onClick={closeLightbox}>
            ✕
          </button>
        </div>
      )}
    </section>
  );
}
