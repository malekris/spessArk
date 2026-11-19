import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRequestedSessionMode } from "../../../utils/deviceSession";
import { getAccountsToken, setAccountsAuth } from "../api";
import "../AccountsPortal.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function AccountsLogin() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "SPESS Accounts | Login";
    if (getAccountsToken()) navigate("/ark/accounts", { replace: true });
  }, [navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    if (!form.username.trim() || !form.password) {
      setError("Enter the bursar username and password.");
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/accounts/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, session_mode: getRequestedSessionMode() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || "Accounts login failed");
      setAccountsAuth(body.token, body.user);
      navigate("/ark/accounts", { replace: true });
    } catch (loginError) {
      setError(loginError.message || "Accounts login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="accounts-login-page">
      <button type="button" className="accounts-back-button" onClick={() => navigate("/ark")}>
        <span aria-hidden="true">←</span> SPESS ARK
      </button>

      <section className="accounts-login-panel">
        <div className="accounts-brand-mark" aria-hidden="true">SA</div>
        <div className="accounts-login-copy">
          <span>Finance Office</span>
          <h1>SPESS Accounts</h1>
          <p>St. Phillip&apos;s Equatorial Secondary School</p>
        </div>

        <form onSubmit={handleSubmit} className="accounts-login-form">
          <label>
            <span>Bursar Username</span>
            <input
              type="text"
              autoComplete="username"
              value={form.username}
              onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            />
          </label>

          {error ? <div className="accounts-form-error" role="alert">{error}</div> : null}

          <button type="submit" className="accounts-primary-button" disabled={loading}>
            {loading ? "Opening Accounts..." : "Open Accounts"}
          </button>
        </form>
      </section>
    </main>
  );
}
