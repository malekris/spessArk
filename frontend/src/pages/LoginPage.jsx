import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // shaky shaky 
  // ... inside your LoginPage component
const [isShaking, setIsShaking] = useState(false);

const handleAdminLogin = (e) => {
  e.preventDefault();
  setError("");

  if (!form.username || !form.password) {
    setError("Please enter admin credentials.");
    triggerShake(); // Trigger shake on empty fields too
    return;
  }

  setLoading(true);

  setTimeout(() => {
    setLoading(false);
    if (form.username === "admin" && form.password === "admin") {
      sessionStorage.setItem("isAdmin", "true");
      navigate("/ark/admin");
    } else {
      setError("Invalid admin credentials.");
      triggerShake(); // <--- TRIGGER SHAKE HERE
    }
  }, 400);
};

const triggerShake = () => {
  setIsShaking(true);
  setTimeout(() => setIsShaking(false), 500); // Reset after animation ends
};

// ... In your return, add the dynamic class to the glass-container
<div className={`glass-container ${isShaking ? "shake-error" : ""}`}></div>
  /* BACKGROUND SLIDESHOW */
  const backgroundImages = ["/slide1.jpg", "/slide2.jpg", "/slide3.jpg", "/slide4.jpg", "/slide5.jpg", "/slide6.jpg", "/slide7.jpg","/slide8.jpg","/slide9.jpg","/slide10.jpg","/slide11.jpg"];
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % backgroundImages.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [backgroundImages.length]);

  return (
    <div className="login-page">
      <button className="back-to-site-btn" onClick={() => navigate("/")}>
  <span style={{ marginRight: '5px' }}>←</span> Back to Website
</button>

<div className="login-background">
  {backgroundImages.map((img, index) => (
    <div
      key={index} // Use index if images repeat, or img path if unique
      className={`carousel-slide ${index === activeIndex ? "active" : ""}`}
      style={{ 
        backgroundImage: `url(${img})`,
        /* This ensures the image stays behind the new one as it fades in */
        visibility: index === activeIndex ? 'visible' : 'hidden',
        transitionProperty: 'opacity, filter, visibility',
        transitionDuration: '2s, 2s, 0s',
        transitionDelay: index === activeIndex ? '0s, 0s, 0s' : '0s, 0s, 2s'
      }}
    />
  ))}
</div>

      <div className="glass-container">
        <div className="glass-header">
          <h1>SPESS’S ARK</h1>
          <h2>Portal Access</h2>
          <p className="ark-subtitle">St. Phillip's Academic Records Kit</p>
        </div>

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
                  sessionStorage.setItem("isAdmin", "true");
                  navigate("/ark/admin");
                } else {
                  setError("Invalid admin credentials.");
                }
              }, 400);
            }}
          >
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