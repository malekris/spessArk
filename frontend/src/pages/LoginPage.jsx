// src/pages/LoginPage.jsx
import React, { useEffect, useState } from "react";
import "./LoginPage.css";

function LoginPage({ onLogin }) {
  const [form, setForm] = useState({
    username: "",
    password: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  /* Background images */
  const backgroundImages = [
    "/slide1.jpg",
    "/slide2.jpg",
    "/slide3.jpg",
  ];

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % backgroundImages.length);
    }, 6000);

    return () => clearInterval(interval);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!form.username || !form.password) {
      setError("Please enter username and password.");
      return;
    }

    setLoading(true);

    setTimeout(() => {
      setLoading(false);
      if (form.username === "admin" && form.password === "admin") {
        onLogin("admin");
      } else {
        setError("Invalid admin credentials.");
      }
    }, 400);
  };

  const handleTeacherClick = () => {
    onLogin("teacher");
  };

  return (
    <div className="login-page">
      {/* Background slideshow */}
      <div className="login-background">
        {backgroundImages.map((img, index) => (
          <div
            key={img}
            className={`carousel-slide ${
              index === activeIndex ? "active" : ""
            }`}
            style={{ backgroundImage: `url(${img})` }}
          />
        ))}
      </div>

      {/* Glass login card */}
      <div className="glass-container">
        <h1
          style={{
            margin: 0,
            marginBottom: "0.4rem",
            fontSize: "1.6rem",
            fontWeight: 600,
            letterSpacing: "0.08em",
          }}
        >
          SPESS’s ARK
        </h1>

        <h2>Admin / Teacher Access</h2>

        {error && (
          <div
            style={{
              marginBottom: "0.9rem",
              padding: "0.5rem 0.7rem",
              borderRadius: "10px",
              background: "rgba(248, 113, 113, 0.14)",
              border: "1px solid rgba(248, 113, 113, 0.6)",
              color: "#fecaca",
              fontSize: "0.8rem",
              textAlign: "left",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ textAlign: "left" }}>
          <label style={{ fontSize: 12, color: "#9ca3af" }}>
            Admin username
          </label>
          <input
            name="username"
            type="text"
            placeholder="Admin username"
            value={form.username}
            onChange={handleChange}
          />

          <label
            style={{
              fontSize: 12,
              color: "#9ca3af",
              marginTop: 8,
              display: "block",
            }}
          >
            Admin password
          </label>
          <input
            name="password"
            type="password"
            placeholder="Admin password"
            value={form.password}
            onChange={handleChange}
          />

          <button
            type="submit"
            className="admin-btn"
            disabled={loading}
            style={{ marginTop: 14 }}
          >
            {loading ? "Signing in…" : "Sign in as Admin"}
          </button>
        </form>

        <button
          type="button"
          className="teacher-btn"
          onClick={handleTeacherClick}
          style={{ marginTop: "0.9rem" }}
        >
          I’m a Teacher — go to teacher login →
        </button>
      </div>
    </div>
  );
}

export default LoginPage;
