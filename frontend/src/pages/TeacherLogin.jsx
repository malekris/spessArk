import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { writeTeacherIdleExpiry } from "../utils/teacherSecurity";
import { useSiteVisuals } from "../utils/siteVisuals";
import "./LoginPage.css"; // Make sure this matches your new isolated CSS filename

const API_BASE = import.meta.env.VITE_API_BASE || "https://spessark.onrender.com";

function TeacherLogin() {
  const navigate = useNavigate();
  const siteVisuals = useSiteVisuals();
  
  // --- 1. Form & UI State ---
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isShaking, setIsShaking] = useState(false);

  // --- 2. Background Slideshow Logic ---
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState(null);
  const [useLiteBackground, setUseLiteBackground] = useState(false);
  const backgroundImages = siteVisuals.ark_auth_slides || [];

  useEffect(() => {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const isMobile = window.matchMedia("(max-width: 900px)").matches;
    const lowMemory = typeof navigator.deviceMemory === "number" ? navigator.deviceMemory <= 4 : false;
    const saveData = Boolean(conn?.saveData);
    const slowNet = /(^|[^0-9])(2g|3g)/i.test(String(conn?.effectiveType || ""));
    setUseLiteBackground(isMobile && (lowMemory || saveData || slowNet));
  }, []);

  useEffect(() => {
    if (useLiteBackground) return undefined;
    const interval = setInterval(() => {
      setActiveIndex((prev) => {
        setPreviousIndex(prev);
        return (prev + 1) % backgroundImages.length;
      });
    }, 9000);
    return () => clearInterval(interval);
  }, [backgroundImages.length, useLiteBackground]);

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
      writeTeacherIdleExpiry(Date.now() + 60 * 60 * 1000);

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
        {useLiteBackground ? (
          <div className="ark-bg-pattern" />
        ) : (
          backgroundImages.map((img, index) => (
            <div
              key={index}
              className={`ark-slide ${index === activeIndex ? "ark-active" : ""}`}
              style={
                index === activeIndex || index === previousIndex
                  ? { backgroundImage: `url(${img})` }
                  : undefined
              }
            />
          ))
        )}
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

          <button
            type="button"
            className="link-btn"
            onClick={() => navigate("/ark/teacher-forgot")}
          >
            Forgot password?
          </button>

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
