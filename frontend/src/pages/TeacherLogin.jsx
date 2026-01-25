import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "https://spessark.onrender.com";

function TeacherLogin() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) {
      setError("Please fill in both email and password.");
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Reusing the background slideshow logic from Admin Login is recommended 
          to keep the "ARK" look consistent across both portals */}
      <div className="login-background">
        <div className="carousel-slide active" style={{ backgroundImage: `url('/slide1.jpg')` }} />
      </div>

      <button className="back-to-site-btn" onClick={() => navigate("/")}>
        ← School Website
      </button>

      <div className="glass-container">
        <div className="glass-header">
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
              placeholder="e.g. namalemalone@gmail.com"
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

          <button type="submit" className="teacher-btn" disabled={loading} style={{ background: '#a78bfa', color: '#0a0c10' }}>
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