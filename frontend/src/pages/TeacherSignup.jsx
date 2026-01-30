import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css"; // Ensure spelling matches your src/pages/ folder

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

const formatName = (name) => {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

function TeacherSignup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isShaking, setIsShaking] = useState(false);

  // --- Background Slideshow Logic ---
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

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name || !form.email || !form.password || !form.confirmPassword) {
      setError("All fields are required.");
      triggerShake();
      return;
    }
    if (form.name === form.name.toUpperCase()) {
      setError("Please use proper name format (e.g. 'Namale Malone').");
      triggerShake();
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      triggerShake();
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch(`${API_BASE}/api/teachers/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
        }),
      });

      let data;
      try { data = await res.json(); } catch { data = {}; }
      
      if (!res.ok) { throw new Error(data.message || "Registration failed"); }

      setSuccess("Account created! Redirecting to login...");
      setTimeout(() => {
        navigate("/ark/teacher-login", { replace: true });
      }, 2000);
    } catch (err) {
      setError(err.message || "Something went wrong");
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ark-login-wrapper">
      {/* 1. Background Slideshow */}
      <div className="ark-bg-slideshow">
        {backgroundImages.map((img, index) => (
          <div
            key={index}
            className={`ark-slide ${index === activeIndex ? "ark-active" : ""}`}
            style={{ backgroundImage: `url(${img})` }}
          />
        ))}
      </div>

      {/* 2. The Glass Card */}
      <div className={`glass-container glass-teacher ${isShaking ? "shake-error" : ""}`}>
        <div className="ark-header">
          <h1>TEACHER SIGN UP</h1>
          <h2>Create ARK Account</h2>
          <p className="ark-subtitle">Join the St. Phillip's Academic Records Kit</p>
        </div>

        {error && <div className="login-error">{error}</div>}
        {success && <div className="login-success" style={{color: '#81c784', marginBottom: '10px'}}>{success}</div>}

        <form onSubmit={handleSubmit} className="login-actions">
          <div className="input-group">
            <label>Full Name</label>
            <input
              name="name"
              placeholder="e.g. Namale Sapphire"
              value={form.name}
              onChange={handleChange}
              onBlur={() => setForm(prev => ({ ...prev, name: formatName(prev.name) }))}
              required
            />
          </div>

          <div className="input-group">
            <label>Email Address</label>
            <input
              name="email"
              type="email"
              placeholder="e.g. teacher@school.com"
              value={form.email}
              onChange={handleChange}
              required
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
            />
          </div>

          <div className="input-group">
            <label>Confirm Password</label>
            <input
              name="confirmPassword"
              type="password"
              placeholder="••••••••"
              value={form.confirmPassword}
              onChange={handleChange}
              required
            />
          </div>

          <button type="submit" className="teacher-btn" disabled={loading}>
            {loading ? "Creating account…" : "Create Account"}
          </button>

          <button
            type="button"
            className="auth-black-btn"
            onClick={() => navigate("/ark/teacher-login")}
            style={{ marginTop: '1rem' }}
          >
            <span>←</span> Back to Teacher Login
          </button>
        </form>
      </div>
    </div>
  );
}

export default TeacherSignup;