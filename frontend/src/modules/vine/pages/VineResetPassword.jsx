import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import "./VineResetPassword.css"; // 🔥 Link the new fire styles

const API_BASE = import.meta.env.VITE_API_BASE;

export default function VineResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "Vine — Reset Password";
  }, []);

  const handleReset = async (e) => {
    e.preventDefault();
    setStatus("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/vine/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      setStatus("success:Password updated! Redirecting...");
      setTimeout(() => navigate("/vine/login"), 2000);
    } catch (err) {
      setStatus(`error:${err.message || "Reset failed"}`);
    } finally {
      setLoading(false);
    }
  };

  // Helper to split status for styling
  const isError = status.startsWith("error:");
  const message = status.replace(/^(error|success):/, "");

  return (
    <div className="vine-auth"> {/* 🔥 Changed to match Register/Login wrapper */}
      <div className="vine-card"> {/* 🔥 Changed to match the Mint Card */}
        <div style={{ textAlign: "center", fontSize: "2rem" }}>🌱</div>
        <h2>Reset Password</h2>
        <p style={{ textAlign: "center", color: "#4e7d52", fontSize: "0.9rem", marginBottom: "15px" }}>
          Enter a strong new password below.
        </p>

        <form onSubmit={handleReset} className="vine-form">
          <input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength="6"
          />

          <button className="vine-btn" disabled={loading}>
            {loading ? "Updating..." : "Reset password"}
          </button>
        </form>

        {status && (
          <p className={isError ? "error" : "success"}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
