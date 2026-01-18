import { useEffect, useState } from "react";
import "./HomeSection.css";

const images = ["/image1.jpg", "/image2.jpg", "/image3.jpg"];

export default function HomeSection() {
  const [index, setIndex] = useState(0);

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
      <div className="home-content">
        <h2>Welcome to Our School</h2>

        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. 
          Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
        </p>

        <p>
          Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. 
          Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
        </p>
      </div>
    </section>
  );
}
