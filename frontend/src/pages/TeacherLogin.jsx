import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css"; // Make sure this matches your new isolated CSS filename

const API_BASE = import.meta.env.VITE_API_BASE || "https://spessark.onrender.com";

function TeacherLogin() {
  const navigate = useNavigate();
  
  // --- 1. Form & UI State ---
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isShaking, setIsShaking] = useState(false);

  // --- 2. Background Slideshow Logic ---
  const [activeIndex, setActiveIndex] = useState(0);
  const backgroundImages = [
    "/slide1.jpg", "/slide2.jpg", "/slide3.jpg", "/slide4.jpg",
    "/slide5.jpg", "/slide6.jpg", "/slide7.jpg", "/slide8.jpg",
    "/slide9.jpg", "/slide10.jpg", "/slide11.jpg"
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % backgroundImages.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [backgroundImages.length]);

  // --- 3. Handlers ---
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) {
      setError("Please fill in both email and password.");
      triggerShake();
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch(`${API_BASE}/api/teachers/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "Login failed");
      }

      const { token, teacher } = await res.json();
      localStorage.setItem("teacherToken", token);
      localStorage.setItem("teacherProfile", JSON.stringify(teacher));

      navigate("/ark/teacher");
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ark-login-wrapper">
      {/* BACKGROUND LAYER */}
      <div className="ark-bg-slideshow">
        {backgroundImages.map((img, index) => (
          <div
            key={index}
            className={`ark-slide ${index === activeIndex ? "ark-active" : ""}`}
            style={{ backgroundImage: `url(${img})` }}
          />
        ))}
      </div>

      {/* TOP NAVIGATION */}
      <button className="ark-back-btn" onClick={() => navigate("/")}>
        ← School Website
      </button>

      {/* THE GLASS CARD */}
      <div className={`glass-container glass-teacher ${isShaking ? "shake-error" : ""}`}>
        <div className="ark-header">
          <h1>TEACHER ACCESS</h1>
          <h2>Student Marks Management</h2>
          <p className="ark-subtitle">Sign in to update marks for your assigned classes.</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-actions">
          <div className="input-group">
            <label>Registered Email</label>
            <input
              name="email"
              type="email"
              placeholder="e.g. teacher@school.com"
              value={form.email}
              onChange={handleChange}
              required
              autoComplete="email"
            />
          </div>

          <div className="input-group">
            <label>Password</label>
            <input
              name="password"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
              required
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="teacher-btn" disabled={loading}>
            {loading ? "Authenticating..." : "Sign in as Teacher"}
          </button>

          <button
            type="button"
            className="auth-black-btn"
            onClick={() => navigate("/ark")}
          >
            <span>←</span> Admin Login
          </button>
        </form>

        <div className="divider"><span>OR</span></div>

        <button
          type="button"
          className="auth-gold-btn"
          onClick={() => navigate("/ark/teacher-signup")}
        >
          ✨ First time? Create Account
        </button>
      </div>
    </div>
  );
}

export default TeacherLogin;