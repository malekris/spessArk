import { useEffect, useState } from "react";
import "./HomeSection.css";
import useScrollReveal from "../hooks/useScrollReveal"; // 👈 add this

const images = ["/image1.jpg", "/image2.jpg", "/image3.jpg"];

export default function HomeSection() {
  const [index, setIndex] = useState(0);

  useScrollReveal(); // 👈 add this (doesn't affect slideshow)

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % images.length);
    }, 6000);

    return () => clearInterval(interval);
  }, []);

  return (
    <section id="home" className="home-section">
      {/* HERO */}
      <div className="hero">
        {images.map((img, i) => (
          <div
            key={img}
            className={`hero-bg ${i === index ? "active" : ""}`}
            style={{ backgroundImage: `url(${img})` }}
          />
        ))}

        <div className="hero-overlay" />

        <div className="hero-content">
          <h1>St. Phillip’s Equatorial Secondary School</h1>
          <p>Excellence in Academics, Discipline and Character</p>
        </div>
      </div>
 



      {/* CONTENT */}
      <div className="home-content reveal"> {/* 👈 only change here */}
        <h2>Welcome to Our School</h2>

        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit...
        </p>

        <p>
          Duis aute irure dolor in reprehenderit...
        </p>
      </div>
    </section>
  );
}
