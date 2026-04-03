import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { writeAdminIdleExpiry } from "../utils/adminSecurity";
import { useSiteVisuals } from "../utils/siteVisuals";
import "./LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const siteVisuals = useSiteVisuals();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState(null);
  const [useLiteBackground, setUseLiteBackground] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showDesktopForm, setShowDesktopForm] = useState(false);

  const backgroundImages = siteVisuals.ark_auth_slides || [];

  // Slideshow Logic
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

  useEffect(() => {
    const updateViewport = () => {
      const desktop = window.matchMedia("(min-width: 901px)").matches;
      setIsDesktop(desktop);
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (location.state?.openAdminLogin) {
      setShowDesktopForm(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

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
      localStorage.setItem("adminUsername", data.username || form.username);
      sessionStorage.removeItem("SPESS_ADMIN_REAUTH_TOKEN");
      localStorage.removeItem("SPESS_ADMIN_REAUTH_TOKEN");
      writeAdminIdleExpiry(Date.now() + 15 * 60 * 1000);
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
       {/* THE SMOKE LAYER */}
  <div className="ark-smoke-wrap">
    <div className="smoke-particle s1"></div>
    <div className="smoke-particle s2"></div>
    <div className="smoke-particle s3"></div>
  </div>
      </div>

      <button
        className="ark-back-btn"
        onClick={() => navigate("/")}
        style={{
          left: "max(16px, env(safe-area-inset-left))",
          top: "max(16px, env(safe-area-inset-top))",
        }}
      >
        <span style={{ marginRight: '5px' }}>←</span> Back to Website
      </button>

      {/* 2. The Glass Card */}
      {/*
        Desktop-only fold state for admin login:
        - folded: compact pill trigger
        - unfolded/mobile: full login form
      */}
      {(() => {
        return (
      <div
        className={`glass-container admin-login-card ${isShaking ? "shake-error" : ""}`}
      >
        <div className="ark-header">
          <h1>SPESS’S ARK</h1>
          <h2>Portal Access</h2>
          <p className="ark-subtitle">St. Phillip's Academic Records Kit</p>
        </div>

        <div className="login-actions">
          {!showDesktopForm ? (
            <>
              <button
                type="button"
                className="auth-green-btn"
                onClick={() => navigate("/ark/teacher-login")}
              >
                Teacher Portal Access <span>→</span>
              </button>

              <div className="divider"><span>ADMIN ACCESS</span></div>

              <button
                type="button"
                className="auth-black-btn"
                onClick={() => {
                  setError("");
                  setShowDesktopForm(true);
                }}
              >
                Admin Login
              </button>
            </>
          ) : (
            <div className={isDesktop ? "admin-login-scroll-unfold" : ""}>
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

              <div className="divider"><span>BOARDING ACCESS</span></div>

              <button
                type="button"
                onClick={() => navigate("/ark/boarding-login")}
                style={{
                  width: "100%",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "14px 18px",
                  borderRadius: "16px",
                  fontWeight: 800,
                  border: "1px solid rgba(255,255,255,0.22)",
                  background: "rgba(10, 16, 31, 0.48)",
                  color: "#f8fafc",
                  cursor: "pointer",
                }}
              >
                Boarding Admin Access <span style={{ marginLeft: 8 }}>→</span>
              </button>

              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setError("");
                  setShowDesktopForm(false);
                }}
                style={{ marginTop: "14px" }}
              >
                Back to Main Access
              </button>
            </div>
          )}
        </div>
      </div>
        );
      })()}
    </div>
  );
}

export default LoginPage;
