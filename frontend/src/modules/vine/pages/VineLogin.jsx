import { useState } from "react";
import { Link } from "react-router-dom";
import "./VineLogin.css"; // 🔥 Pointing to the new file
const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineLogin() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!identifier || !password) {
      alert("Please fill in all fields");
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(`${API}/api/vine/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.message || "Login failed");
        return;
      }

      // Save token + user
      localStorage.setItem("vine_token", data.token);
      localStorage.setItem("vine_user", JSON.stringify(data.user));

      // Redirect
      window.location.href = "/vine/feed";

    } catch (err) {
      console.error(err);
      alert("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="vine-auth-bg">
      <div className="vine-auth-card">
        <h2 className="vine-title">Welcome to SPESS VINE 🌱</h2>

        <form className="vine-form" onSubmit={handleLogin}>
          <input
            type="text"
            placeholder="Username or email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="vine-btn" disabled={loading}>
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>

        <div className="vine-links">
          <Link to="/vine/forgot-password">Forgot password?</Link>
        </div>

        <div className="vine-footer">
          New to Vine? <Link to="/vine/register">Sign Up</Link>
        </div>
      </div>
    </div>
  );
}
