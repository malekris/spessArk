// src/pages/LoginPage.jsx
import React, { useEffect, useState } from "react";
import "./LoginPage.css";
import { useNavigate } from "react-router-dom";

function LoginPage({ onLogin }) {
  const navigate = useNavigate(); // ✅ CORRECT PLACE

  const [form, setForm] = useState({
    username: "",
    password: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  /* Background images */
  const backgroundImages = ["/slide1.jpg", "/slide2.jpg", "/slide3.jpg"];
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
        navigate("/admin"); // ✅ redirect admin
      } else {
        setError("Invalid admin credentials.");
      }
    }, 400);
  };

  return (
    <div className="login-page">
      {/* Background slideshow */}
      <div className="login-background">
        {backgroundImages.map((img, index) => (
          <div
            key={img}
            className={`carousel-slide ${index === activeIndex ? "active" : ""}`}
            style={{ backgroundImage: `url(${img})` }}
          />
        ))}
      </div>

      <div className="glass-container">
        <h1>SPESS’s ARK</h1>
        <h2>Admin / Teacher Access</h2>
        <h3>St. Phillip's Academic Records Kit</h3>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <label>Admin username</label>
          <input
            name="username"
            value={form.username}
            onChange={handleChange}
          />

          <label>Admin password</label>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
          />

          <button type="submit" className="admin-btn" disabled={loading}>
            {loading ? "Signing in…" : "Sign in as Admin"}
          </button>
        </form>

        {/* ✅ THIS NOW WORKS */}
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
