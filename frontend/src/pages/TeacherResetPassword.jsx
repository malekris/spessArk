import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSiteVisuals } from "../utils/siteVisuals";
import "./LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "https://api.stphillipsequatorial.com";
const RESET_TOKEN_KEY = "teacherPasswordResetToken";
const RESET_PROFILE_KEY = "teacherPasswordResetProfile";

export default function TeacherResetPassword() {
  const navigate = useNavigate();
  const siteVisuals = useSiteVisuals();
  const backgroundImages = siteVisuals.ark_auth_slides || [];
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    document.title = "Teacher - Set New Password";
    if (!sessionStorage.getItem(RESET_TOKEN_KEY)) {
      navigate("/ark/teacher-forgot", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (backgroundImages.length < 2) return undefined;
    const interval = window.setInterval(() => {
      setActiveIndex((previous) => {
        setPreviousIndex(previous);
        return (previous + 1) % backgroundImages.length;
      });
    }, 9000);
    return () => window.clearInterval(interval);
  }, [backgroundImages.length]);

  const leaveResetFlow = () => {
    sessionStorage.removeItem(RESET_TOKEN_KEY);
    sessionStorage.removeItem(RESET_PROFILE_KEY);
    navigate("/ark/teacher-login", { replace: true });
  };

  const submitNewPassword = async (event) => {
    event.preventDefault();
    setStatus("");

    if (password.length < 6) {
      setStatus("New password must be at least 6 characters.");
      return;
    }
    if (password !== confirmation) {
      setStatus("Passwords do not match.");
      return;
    }

    const token = sessionStorage.getItem(RESET_TOKEN_KEY);
    if (!token) {
      setStatus("Your reset session has expired. Request another code.");
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/teachers/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword: password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.message || "Failed to reset password.");
      }

      sessionStorage.removeItem(RESET_TOKEN_KEY);
      sessionStorage.removeItem(RESET_PROFILE_KEY);
      setPassword("");
      setConfirmation("");
      setComplete(true);
    } catch (error) {
      setStatus(error.message || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ark-login-wrapper">
      <div className="ark-bg-slideshow">
        {backgroundImages.map((image, index) => (
          <div
            key={image}
            className={`ark-slide ${index === activeIndex ? "ark-active" : ""}`}
            style={
              index === activeIndex || index === previousIndex
                ? { backgroundImage: `url(${image})` }
                : undefined
            }
          />
        ))}
      </div>

      <button type="button" className="ark-back-btn" onClick={leaveResetFlow}>
        Back to Login
      </button>

      <div className="glass-container glass-teacher">
        <div className="ark-header">
          <h1>NEW PASSWORD</h1>
          <h2>Secure Your Teacher Account</h2>
          <p className="ark-subtitle">
            {complete ? "Your account is ready" : "Choose a password you will remember"}
          </p>
        </div>

        {complete ? (
          <div className="login-actions">
            <div className="login-success">
              Password updated successfully. You can now sign in with your new password.
            </div>
            <button type="button" className="teacher-btn" onClick={leaveResetFlow}>
              Continue to Login
            </button>
          </div>
        ) : (
          <form className="login-actions" onSubmit={submitNewPassword}>
            {status && <div className="login-error">{status}</div>}

            <div className="input-group">
              <label>New Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                autoComplete="new-password"
                required
              />
            </div>

            <div className="input-group">
              <label>Confirm New Password</label>
              <input
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                minLength={6}
                autoComplete="new-password"
                required
              />
            </div>

            <button type="submit" className="teacher-btn" disabled={loading}>
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

