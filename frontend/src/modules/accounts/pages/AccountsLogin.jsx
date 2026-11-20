import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRequestedSessionMode } from "../../../utils/deviceSession";
import { clearAccountsAuth, setAccountsAuth } from "../api";
import schoolBadge from "../../../assets/badge.png";
import "../AccountsPortal.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

async function publicAccountsRequest(path, body) {
  const response = await fetch(`${API_BASE}/api/accounts${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || "Accounts request failed");
  return payload;
}

export default function AccountsLogin() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [resetForm, setResetForm] = useState({ email: "", code: "", password: "", confirmPassword: "" });
  const [resetCodeSent, setResetCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(() => (
    new URLSearchParams(window.location.search).get("reason") === "idle-timeout"
      ? { type: "success", text: "You were signed out after 15 minutes of inactivity." }
      : { type: "", text: "" }
  ));

  useEffect(() => {
    document.title = "SPESS Accounts | Login";
    // Entering the finance login is a fresh security boundary every time.
    clearAccountsAuth();
  }, []);

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setMessage({ type: "", text: "" });
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setMessage({ type: "", text: "" });
    if (!loginForm.username.trim() || !loginForm.password) {
      setMessage({ type: "error", text: "Enter the Owner username or bursar email and password." });
      return;
    }
    try {
      setLoading(true);
      const body = await publicAccountsRequest("/login", { ...loginForm, session_mode: getRequestedSessionMode() });
      setAccountsAuth(body.token, body.user);
      navigate("/ark/accounts", { replace: true });
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Accounts login failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setMessage({ type: "", text: "" });
    if (registerForm.password !== registerForm.confirmPassword) {
      setMessage({ type: "error", text: "The bursar passwords do not match." });
      return;
    }
    try {
      setLoading(true);
      const body = await publicAccountsRequest("/register", {
        name: registerForm.name,
        email: registerForm.email,
        password: registerForm.password,
      });
      setRegisterForm({ name: "", email: "", password: "", confirmPassword: "" });
      setMessage({ type: "success", text: body.message });
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Registration failed" });
    } finally {
      setLoading(false);
    }
  };

  const requestResetCode = async (event) => {
    event.preventDefault();
    setMessage({ type: "", text: "" });
    try {
      setLoading(true);
      const body = await publicAccountsRequest("/forgot-password", { email: resetForm.email });
      setResetCodeSent(true);
      setMessage({ type: "success", text: body.message });
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Failed to send reset code" });
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    setMessage({ type: "", text: "" });
    if (resetForm.password !== resetForm.confirmPassword) {
      setMessage({ type: "error", text: "The new passwords do not match." });
      return;
    }
    try {
      setLoading(true);
      const body = await publicAccountsRequest("/reset-password", {
        email: resetForm.email,
        code: resetForm.code,
        password: resetForm.password,
      });
      setResetForm({ email: "", code: "", password: "", confirmPassword: "" });
      setResetCodeSent(false);
      setMode("login");
      setMessage({ type: "success", text: body.message });
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Failed to reset password" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="accounts-login-page">
      <button type="button" className="accounts-back-button" onClick={() => navigate("/ark")}><span aria-hidden="true">←</span> SPESS ARK</button>
      <section className="accounts-login-panel">
        <div className="accounts-login-badge">
          <img src={schoolBadge} alt="St. Phillip's Equatorial Secondary School badge" />
        </div>
        <div className="accounts-login-copy"><span>Finance Office</span><h1>SPESS Accounts</h1><p>St. Phillip&apos;s Equatorial Secondary School</p></div>
        <div className="accounts-auth-modes" role="tablist" aria-label="Accounts access">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-active" : ""} onClick={() => changeMode("login")}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "is-active" : ""} onClick={() => changeMode("register")}>Register</button>
          <button type="button" role="tab" aria-selected={mode === "reset"} className={mode === "reset" ? "is-active" : ""} onClick={() => changeMode("reset")}>Reset</button>
        </div>

        {mode === "login" ? <form onSubmit={handleLogin} className="accounts-login-form">
          <label><span>Owner Username or Bursar Email</span><input type="text" autoComplete="username" value={loginForm.username} onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))} /></label>
          <label><span>Password</span><input type="password" autoComplete="current-password" value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} /></label>
          {message.text ? <div className={`accounts-auth-message is-${message.type}`} role="status">{message.text}</div> : null}
          <button type="submit" className="accounts-primary-button" disabled={loading}>{loading ? "Opening Accounts..." : "Open Accounts"}</button>
        </form> : null}

        {mode === "register" ? <form onSubmit={handleRegister} className="accounts-login-form">
          <label><span>Full Name</span><input type="text" autoComplete="name" value={registerForm.name} onChange={(event) => setRegisterForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label><span>Email</span><input type="email" autoComplete="email" value={registerForm.email} onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))} /></label>
          <label><span>Password</span><input type="password" minLength="12" autoComplete="new-password" value={registerForm.password} onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))} /></label>
          <label><span>Confirm Password</span><input type="password" minLength="12" autoComplete="new-password" value={registerForm.confirmPassword} onChange={(event) => setRegisterForm((current) => ({ ...current, confirmPassword: event.target.value }))} /></label>
          {message.text ? <div className={`accounts-auth-message is-${message.type}`} role="status">{message.text}</div> : null}
          <button type="submit" className="accounts-primary-button" disabled={loading}>{loading ? "Submitting..." : "Request Bursar Access"}</button>
        </form> : null}

        {mode === "reset" ? <form onSubmit={resetCodeSent ? resetPassword : requestResetCode} className="accounts-login-form">
          <label><span>Email</span><input type="email" autoComplete="email" readOnly={resetCodeSent} value={resetForm.email} onChange={(event) => setResetForm((current) => ({ ...current, email: event.target.value }))} /></label>
          {resetCodeSent ? <>
            <label><span>Six-Digit Code</span><input type="text" inputMode="numeric" pattern="[0-9]*" maxLength="6" autoComplete="one-time-code" value={resetForm.code} onChange={(event) => setResetForm((current) => ({ ...current, code: event.target.value.replace(/\D/g, "").slice(0, 6) }))} /></label>
            <label><span>New Password</span><input type="password" minLength="12" autoComplete="new-password" value={resetForm.password} onChange={(event) => setResetForm((current) => ({ ...current, password: event.target.value }))} /></label>
            <label><span>Confirm New Password</span><input type="password" minLength="12" autoComplete="new-password" value={resetForm.confirmPassword} onChange={(event) => setResetForm((current) => ({ ...current, confirmPassword: event.target.value }))} /></label>
          </> : null}
          {message.text ? <div className={`accounts-auth-message is-${message.type}`} role="status">{message.text}</div> : null}
          <button type="submit" className="accounts-primary-button" disabled={loading}>{loading ? "Please wait..." : resetCodeSent ? "Set New Password" : "Send Reset Code"}</button>
          {resetCodeSent ? <button type="button" className="accounts-auth-secondary" onClick={() => { setResetCodeSent(false); setMessage({ type: "", text: "" }); }}>Use another email</button> : null}
        </form> : null}
      </section>
    </main>
  );
}
