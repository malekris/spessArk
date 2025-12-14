// src/pages/LoginPage.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

function LoginPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    password: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  /* ======================
     BACKGROUND SLIDESHOW
  ====================== */
  const backgroundImages = ["/slide1.jpg", "/slide2.jpg", "/slide3.jpg"];
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % backgroundImages.length);
    }, 6000);

    return () => clearInterval(interval);
  }, []);

  /* ======================
     FORM HANDLERS
  ====================== */
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

    // 🔐 TEMP ADMIN LOGIN (DEV)
    setTimeout(() => {
      setLoading(false);

      if (form.username === "admin" && form.password === "admin") {
        // ✅ ADMIN LOGIN SUCCESS
        navigate("/admin");
      } else {
        setError("Invalid admin credentials.");
      }
    }, 400);
  };

  /* ======================
     RENDER
  ====================== */
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

      {/* Login Card */}
      <div className="glass-container">
        <h1>SPESS’s ARK</h1>
        <h2>Admin / Teacher Access</h2>
        <h3>St. Phillip's Academic Records Kit</h3>

        {error && <div className="login-error">{error}</div>}

        {/* ADMIN LOGIN */}
        <form onSubmit={handleSubmit}>
          <label>Admin username</label>
          <input
            name="username"
            type="text"
            placeholder="Admin username"
            value={form.username}
            onChange={handleChange}
          />

          <label>Admin password</label>
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
          >
            {loading ? "Signing in…" : "Sign in as Admin"}
          </button>
        </form>

        {/* TEACHER ENTRY */}
        <button
          type="button"
          className="teacher-btn"
          onClick={() => navigate("/teacher-login")}
        >
          I’m a Teacher — go to teacher login →
        </button>
      </div>
    </div>
  );
}

export default LoginPage;
