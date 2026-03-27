import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../../pages/LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function BoardingLogin() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (event) => {
    event.preventDefault();
    setError("");

    if (!form.username || !form.password) {
      setError("Enter boarding admin credentials first.");
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/boarding/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.message || "Boarding login failed");
      }

      localStorage.setItem("boardingAdminToken", body.token);
      localStorage.setItem("boardingAdminUser", JSON.stringify(body.user || {}));
      navigate("/ark/boarding", { replace: true });
    } catch (err) {
      setError(err.message || "Boarding login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ark-login-wrapper">
      <div className="ark-bg-slideshow">
        <div className="ark-slide ark-active" style={{ backgroundImage: "url(/cov.jpg)" }} />
      </div>

      <button className="ark-back-btn" onClick={() => navigate("/ark")}>
        <span style={{ marginRight: 5 }}>←</span> Back to SPESS ARK
      </button>

      <div className="glass-container admin-login-card">
        <div className="ark-header">
          <h1>BOARDING</h1>
          <h2>Weekend Assessments</h2>
          <p className="ark-subtitle">Separate boarding workspace for learners, marks, and reports.</p>
        </div>

        <div className="login-actions">
          <form onSubmit={handleLogin}>
            <div className="input-group">
              <label>Boarding Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(event) => setForm((previous) => ({ ...previous, username: event.target.value }))}
              />
            </div>

            <div className="input-group">
              <label>Boarding Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((previous) => ({ ...previous, password: event.target.value }))}
              />
            </div>

            {error && <div className="login-error">{error}</div>}

            <button type="submit" className="admin-btn-hot" disabled={loading}>
              {loading ? "Signing in..." : "Enter Boarding Workspace"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
