import React, { useState, useEffect, useRef } from "react";
import "./ActivitiesSection.css";

export default function ActivitiesSection() {
  const images = Array.from({ length: 20 }, (_, i) => `/image${i + 1}.jpg`);

  const [activeIndex, setActiveIndex] = useState(null);
  const [showHint, setShowHint] = useState(false);
  const startX = useRef(0);
  const endX = useRef(0);
  const pressTimer = useRef(null);

  const closeLightbox = () => {
    setActiveIndex(null);
    setShowHint(false);
  };

  const showNext = () => setActiveIndex((prev) => (prev + 1) % images.length);
  const showPrev = () => setActiveIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));

  /* ---------------- DOWNLOAD LOGIC ---------------- */
  const handleDownload = (e) => {
    if (e) e.stopPropagation();
    const imageUrl = images[activeIndex];
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `SPESS_Activity_${activeIndex + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /* ---------------- TOUCH & LONG PRESS LOGIC ---------------- */
  const handleTouchStart = (e) => {
    startX.current = e.touches[0].clientX;
    // Trigger download after 800ms hold
    pressTimer.current = setTimeout(() => {
      handleDownload();
      if (window.navigator.vibrate) window.navigator.vibrate(50);
    }, 800);
  };

  const handleTouchMove = (e) => {
    endX.current = e.touches[0].clientX;
    const diff = Math.abs(startX.current - endX.current);
    if (diff > 10) clearTimeout(pressTimer.current); // Cancel if swiping
  };

  const handleTouchEnd = () => {
    clearTimeout(pressTimer.current);
    const diff = startX.current - endX.current;
    if (diff > 60) showNext();   
    if (diff < -60) showPrev();  
  };

  /* ---------------- KEYBOARD & EFFECTS ---------------- */
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

  useEffect(() => {
    if (activeIndex !== null) {
      setShowHint(true);
      const timer = setTimeout(() => setShowHint(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [activeIndex]);

  return (
    <section id="activities" className="activities-section">
      {/* CINEMATIC BANNER */}
      <div className="activities-banner">
        <div className="banner-content">
          <h1>Life at <span>St. Phillip's</span></h1>
          <p>Moments of excellence, sportsmanship, and student engagement.</p>
        </div>
      </div>

      {/* GALLERY GRID */}
      <div className="activities-container">
        <div className="activities-grid">
          {images.map((src, i) => (
            <div key={i} className="activity-card" onClick={() => setActiveIndex(i)}>
              <img src={src} alt={`Activity ${i + 1}`} loading="lazy" />
              <div className="card-overlay">VIEW</div>
            </div>
          ))}
        </div>
      </div>

      {/* LIGHTBOX */}
      {activeIndex !== null && (
        <div className="lightbox" onClick={closeLightbox}>
          {showHint && <div className="long-press-hint">Hold image to save</div>}

          <div className="lightbox-controls">
            <button className="download-btn" onClick={handleDownload}>
              <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
              </svg>
              <span>SAVE IMAGE</span>
            </button>
            <button className="lightbox-close" onClick={closeLightbox}>✕</button>
          </div>

          <img
            src={images[activeIndex]}
            className="lightbox-img"
            alt=""
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onContextMenu={(e) => e.preventDefault()}
          />
          
          <div className="lightbox-counter">{activeIndex + 1} / {images.length}</div>
        </div>
      )}
    </section>
  );
}