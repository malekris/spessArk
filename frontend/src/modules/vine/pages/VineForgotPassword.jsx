import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import "./VineLogin.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";


export default function VineForgotPassword() {
  useEffect(() => {
    document.title = "Vine — Forgot Password";
  }, []);
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const requestCode = async (e) => {
    e.preventDefault();
    setStatus("");
    if (!email) return setStatus("Please enter your email.");
    try {
      setLoading(true);
      const res = await fetch(`${API}/api/vine/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      await res.json();
      setStep(2);
      setStatus("If that email exists, a code was sent.");
    } catch {
      setStatus("Failed to send code.");
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    setStatus("");
    if (!code || !password || !confirm) return setStatus("Fill all fields.");
    if (password !== confirm) return setStatus("Passwords do not match.");
    try {
      setLoading(true);
      const res = await fetch(`${API}/api/vine/auth/reset-password-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data?.message || "Reset failed.");
        return;
      }
      setStatus("Password updated. You can log in now.");
      setStep(3);
    } catch {
      setStatus("Reset failed.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="vine-auth-bg">
      <div className="vine-auth-card">
        <h2 className="vine-title">Forgot Password</h2>
        <p className="vine-subtitle">
          {step === 1
            ? "Enter your email and we’ll send a 4‑digit code."
            : step === 2
            ? "Enter the 4‑digit code and choose a new password."
            : "Password updated. You can log in now."}
        </p>

        {step === 1 && (
          <form className="vine-form" onSubmit={requestCode}>
            <input
              type="email"
              placeholder="Your email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="vine-btn" disabled={loading}>
              {loading ? "Sending..." : "Send Code"}
            </button>
          </form>
        )}

        {step === 2 && (
          <form className="vine-form" onSubmit={resetPassword}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="4‑digit code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <input
              type="password"
              placeholder="New password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              type="password"
              placeholder="Confirm new password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button className="vine-btn" disabled={loading}>
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>
        )}

        {status && <div className="vine-subtitle">{status}</div>}

        <div className="vine-footer">
          Remembered? <Link to="/vine/login">Back to Login</Link>
        </div>
      </div>
    </div>
  );
}
