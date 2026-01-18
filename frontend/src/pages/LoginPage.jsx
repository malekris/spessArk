// src/pages/LoginPage.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

// middlware 
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
  const backgroundImages = ["/slide1.jpg", "/slide2.jpg", "/slide3.jpg", "/slide4.jpg", "/slide5.jpg", "/slide6.jpg", "/slide7.jpg","/slide8.jpg","/slide9.jpg","/slide10.jpg","/slide11.jpg"];
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % backgroundImages.length);
    }, 6000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="login-page">
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

        <div className="login-actions">
        <form
  onSubmit={(e) => {
    e.preventDefault();
    setError("");

    if (!form.username || !form.password) {
      setError("Please enter admin credentials.");
      return;
    }

    setLoading(true);

    setTimeout(() => {
      setLoading(false);

      if (form.username === "admin" && form.password === "admin") {
        // TEMP admin auth
        sessionStorage.setItem("isAdmin", "true");
        navigate("/admin");
      } else {
        setError("Invalid admin credentials.");
      }
    }, 400);
  }}
>
  <label>Admin username</label>
  <input
    type="text"
    name="username"
    value={form.username}
    onChange={(e) =>
      setForm((prev) => ({ ...prev, username: e.target.value }))
    }
  />

  <label>Admin password</label>
  <input
    type="password"
    name="password"
    value={form.password}
    onChange={(e) =>
      setForm((prev) => ({ ...prev, password: e.target.value }))
    }
  />

  {error && <div className="login-error">{error}</div>}

  <button type="submit" className="admin-btn" disabled={loading}>
    {loading ? "Signing in…" : "Sign in as Admin"}
  </button>
</form>


          <button
            type="button"
            className="teacher-btn"
            onClick={() => navigate("/teacher-login")}
          >
            I’m a Teacher — go to teacher login →
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
