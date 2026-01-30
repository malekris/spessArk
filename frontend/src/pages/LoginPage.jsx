import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const backgroundImages = [
    "/slide1.jpg", "/slide2.jpg", "/slide3.jpg", "/slide4.jpg",
    "/slide5.jpg", "/slide6.jpg", "/slide7.jpg", "/slide8.jpg",
    "/slide9.jpg", "/slide10.jpg", "/slide11.jpg"
  ];

  // Slideshow Logic
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % backgroundImages.length);
    }, 10000);
    return () => clearInterval(interval);
  }, [backgroundImages.length]);

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };
 
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.username || !form.password) {
      setError("Please enter admin credentials.");
      triggerShake();
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Login failed");
        triggerShake();
        return;
      }

      localStorage.setItem("adminToken", data.token);
      navigate("/ark/admin");
    } catch (err) {
      setError("Server error. Try again.");
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ark-login-wrapper"> {/* Changed from login-page */}
      {/* 1. Background Slideshow */}
      <div className="ark-bg-slideshow"> {/* Changed from login-background */}
        {backgroundImages.map((img, index) => (
          <div
            key={index}
            className={`ark-slide ${index === activeIndex ? "ark-active" : ""}`}
            style={{ backgroundImage: `url(${img})` }}
          />
        ))}
       {/* THE SMOKE LAYER */}
  <div className="ark-smoke-wrap">
    <div className="smoke-particle s1"></div>
    <div className="smoke-particle s2"></div>
    <div className="smoke-particle s3"></div>
  </div>
      </div>

      <button className="ark-back-btn" onClick={() => navigate("/")}>
        <span style={{ marginRight: '5px' }}>←</span> Back to Website
      </button>

      {/* 2. The Glass Card */}
      <div className={`glass-container ${isShaking ? "shake-error" : ""}`}>
        <div className="ark-header">
          <h1>SPESS’S ARK</h1>
          <h2>Portal Access</h2>
          <p className="ark-subtitle">St. Phillip's Academic Records Kit</p>
        </div>

        <div className="login-actions">
          <form onSubmit={handleAdminLogin}>
            <div className="input-group">
              <label>Admin Username</label>
              <input
                type="text"
                name="username"
                autoComplete="off"
                value={form.username}
                onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              />
            </div>

            <div className="input-group">
              <label>Admin Password</label>
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>

            {error && <div className="login-error">{error}</div>}

            <button type="submit" className="admin-btn-hot" disabled={loading}>
              {loading ? "Verifying..." : "Sign in as Admin"}
            </button>
          </form>

          <div className="divider"><span>OR</span></div>

          <button
            type="button"
            className="auth-green-btn"
            onClick={() => navigate("/ark/teacher-login")}
          >
            Teacher Portal Access <span>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;