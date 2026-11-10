import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearTeacherSession } from "../utils/teacherSecurity";
import { useSiteVisuals } from "../utils/siteVisuals";
import "./LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "https://api.stphillipsequatorial.com";

function TeacherForgotPassword() {
  const navigate = useNavigate();
  const siteVisuals = useSiteVisuals();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState(null);
  const backgroundImages = siteVisuals.ark_auth_slides || [];

  useEffect(() => {
    document.title = "Teacher - Forgot Password";
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => {
        setPreviousIndex(prev);
        return (prev + 1) % backgroundImages.length;
      });
    }, 9000);
    return () => clearInterval(interval);
  }, [backgroundImages.length]);

  const requestCode = async (e) => {
    e.preventDefault();
    setStatus("");
    if (!email) return setStatus("Please enter your email.");
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/teachers/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data?.message || "Failed to send reset code.");
        return;
      }
      setStep(2);
      setStatus(data?.message || "If that email exists, a code was sent.");
    } catch {
      setStatus("Failed to send code.");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    setStatus("");
    if (!email || !code) return setStatus("Enter your email and code.");
    if (!/^\d{6}$/.test(code)) {
      return setStatus("Enter the complete 6-digit code.");
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/teachers/verify-reset-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data?.message || "Invalid or expired code.");
        return;
      }

      // Keep reset credentials separate from a normal signed-in teacher session.
      clearTeacherSession();
      sessionStorage.setItem("teacherPasswordResetToken", data.token);
      sessionStorage.setItem("teacherPasswordResetProfile", JSON.stringify(data.teacher));
      navigate("/ark/teacher-reset", { replace: true });
    } catch {
      setStatus("Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ark-login-wrapper">
      <div className="ark-bg-slideshow">
        {backgroundImages.map((img, index) => (
          <div
            key={index}
            className={`ark-slide ${index === activeIndex ? "ark-active" : ""}`}
            style={
              index === activeIndex || index === previousIndex
                ? { backgroundImage: `url(${img})` }
                : undefined
            }
          />
        ))}
      </div>

      <button className="ark-back-btn" onClick={() => navigate("/ark/teacher-login")}>
        ← Back to Login
      </button>

      <div className="glass-container glass-teacher">
        <div className="ark-header">
          <h1>RESET ACCESS</h1>
          <h2>Teacher Account Recovery</h2>
          <p className="ark-subtitle">
            {step === 1
              ? "Enter your email and we'll send a 6-digit code."
              : "Enter the 6-digit code to continue."}
          </p>
        </div>

        {status && <div className="login-error">{status}</div>}

        {step === 1 && (
          <form onSubmit={requestCode} className="login-actions">
            <div className="input-group">
              <label>Registered Email</label>
              <input
                type="email"
                placeholder="e.g. teacher@school.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <button type="submit" className="teacher-btn" disabled={loading}>
              {loading ? "Sending..." : "Send Code"}
            </button>

            <button
              type="button"
              className="auth-black-btn"
              onClick={() => navigate("/ark/teacher-login")}
              disabled={loading}
            >
              ← Back to Login
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={verifyCode} className="login-actions">
            <div className="input-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="input-group">
              <label>6-digit code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
            </div>

            <button type="submit" className="teacher-btn" disabled={loading}>
              {loading ? "Verifying..." : "Verify Code"}
            </button>

            <button
              type="button"
              className="link-btn"
              onClick={() => setStep(1)}
              disabled={loading}
            >
              Resend code
            </button>

            <button
              type="button"
              className="auth-black-btn"
              onClick={() => navigate("/ark/teacher-login")}
              disabled={loading}
            >
              ← Back to Login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default TeacherForgotPassword;
