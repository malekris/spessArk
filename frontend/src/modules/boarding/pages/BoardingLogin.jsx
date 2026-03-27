import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import "../../../pages/LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const emeraldGlow = "rgba(52, 211, 153, 0.24)";

export default function BoardingLogin() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    document.title = "Boarding Login | SPESS ARK";
  }, []);

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
        <div className="ark-slide ark-active" style={{ backgroundImage: "url(/newactivities/covercover.jpeg)" }} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(2,6,23,0.14) 0%, rgba(2,6,23,0.24) 28%, rgba(2,6,23,0.6) 52%, rgba(2,6,23,0.88) 74%, rgba(2,6,23,0.98) 100%)",
            pointerEvents: "none",
          }}
        />
      </div>

      <button className="ark-back-btn" onClick={() => navigate("/ark")}>
        <span style={{ marginRight: 5 }}>←</span> Back to SPESS ARK
      </button>

      <div
        className="glass-container admin-login-card"
        style={{
          width: isOpen ? "min(430px, 90vw)" : "min(520px, 92vw)",
          maxWidth: isOpen ? "430px" : "520px",
          marginTop: "-84px",
          padding: isOpen ? "32px 30px" : "15px 18px",
          borderRadius: isOpen ? "28px" : "999px",
          minHeight: "unset",
          textAlign: isOpen ? "center" : "left",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          transition:
            "width 280ms ease, max-width 280ms ease, padding 280ms ease, border-radius 280ms ease, transform 280ms ease",
          transform: isOpen ? "translateY(0)" : "translateY(0)",
          background: isOpen
            ? "linear-gradient(165deg, rgba(5, 18, 13, 0.82) 0%, rgba(4, 120, 87, 0.22) 48%, rgba(15, 23, 42, 0.78) 100%)"
            : "linear-gradient(135deg, rgba(5, 18, 13, 0.42) 0%, rgba(16, 185, 129, 0.12) 50%, rgba(11, 18, 32, 0.34) 100%)",
          border: isOpen
            ? "1px solid rgba(110, 231, 183, 0.24)"
            : "1px solid rgba(110, 231, 183, 0.14)",
          boxShadow: isOpen
            ? "0 24px 56px rgba(0, 0, 0, 0.58), 0 0 0 1px rgba(16, 185, 129, 0.08), inset 0 1px 0 rgba(167, 243, 208, 0.08)"
            : "0 18px 42px rgba(0, 0, 0, 0.28), 0 0 28px rgba(16, 185, 129, 0.08), inset 0 1px 0 rgba(167, 243, 208, 0.05)",
          overflow: "hidden",
        }}
      >
        {!isOpen ? (
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.9rem",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "grid", gap: "0.22rem", minWidth: 0 }}>
              <span
                style={{
                  fontSize: "0.72rem",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontWeight: 800,
                  color: "#d1fae5",
                  textShadow: "0 0 14px rgba(16, 185, 129, 0.22)",
                }}
              >
                Boarding Access
              </span>
              <span
                style={{
                  color: "rgba(220, 252, 231, 0.82)",
                  fontSize: "0.92rem",
                  whiteSpace: "normal",
                }}
              >
                Weekend marks, learners, and reports
              </span>
            </div>

            <button
              type="button"
              className="admin-btn-hot"
              onClick={() => setIsOpen(true)}
              style={{
                width: "auto",
                minWidth: "188px",
                marginTop: 0,
                padding: "11px 18px",
                borderRadius: "999px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontSize: "0.78rem",
                border: "1px solid rgba(167, 243, 208, 0.28)",
                background: "linear-gradient(135deg, rgba(16,185,129,0.88) 0%, rgba(5,150,105,0.95) 100%)",
                color: "#022c22",
                boxShadow: "0 12px 28px rgba(5, 150, 105, 0.28), 0 0 18px rgba(16,185,129,0.16)",
              }}
            >
              Open Boarding Login
            </button>
          </div>
        ) : (
          <>
            <div className="ark-header">
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0.28rem 0.7rem",
                  borderRadius: "999px",
                  marginBottom: "0.65rem",
                  background: "rgba(16, 185, 129, 0.14)",
                  border: "1px solid rgba(110, 231, 183, 0.18)",
                  color: "#bbf7d0",
                  fontSize: "0.68rem",
                  fontWeight: 900,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                Boarding Portal
              </div>
              <h1 style={{ color: "#ecfdf5", textShadow: "0 0 18px rgba(16,185,129,0.2)" }}>BOARDING</h1>
              <h2 style={{ color: "#86efac", fontWeight: 700 }}>Weekend Assessments</h2>
              <p className="ark-subtitle" style={{ color: "rgba(220, 252, 231, 0.72)" }}>
                Separate boarding workspace for learners, marks, and reports.
              </p>
            </div>

            <div
              style={{
                marginTop: "0.35rem",
                padding: "0.85rem 0.9rem 0.35rem",
                borderRadius: "18px",
                border: "1px solid rgba(110, 231, 183, 0.16)",
                background: "linear-gradient(180deg, rgba(6, 20, 16, 0.72) 0%, rgba(8, 47, 73, 0.18) 100%)",
                boxShadow: "0 18px 34px rgba(2, 6, 23, 0.34), inset 0 1px 0 rgba(167,243,208,0.08), 0 0 24px rgba(16,185,129,0.08)",
              }}
            >
              <div className="login-actions">
                <form onSubmit={handleLogin}>
                  <div className="input-group">
                    <label style={{ color: "#d1fae5", fontWeight: 700 }}>Username</label>
                    <input
                      type="text"
                      value={form.username}
                      onChange={(event) => setForm((previous) => ({ ...previous, username: event.target.value }))}
                      style={{
                        border: "1px solid rgba(110, 231, 183, 0.2)",
                        background: "linear-gradient(180deg, rgba(4, 15, 12, 0.92) 0%, rgba(8, 28, 22, 0.86) 100%)",
                        color: "#f0fdf4",
                        boxShadow: `inset 0 1px 0 rgba(167,243,208,0.06), 0 0 0 1px transparent`,
                      }}
                    />
                  </div>

                  <div className="input-group">
                    <label style={{ color: "#d1fae5", fontWeight: 700 }}>Password</label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(event) => setForm((previous) => ({ ...previous, password: event.target.value }))}
                      style={{
                        border: "1px solid rgba(110, 231, 183, 0.2)",
                        background: "linear-gradient(180deg, rgba(4, 15, 12, 0.92) 0%, rgba(8, 28, 22, 0.86) 100%)",
                        color: "#f0fdf4",
                        boxShadow: `inset 0 1px 0 rgba(167,243,208,0.06), 0 0 0 1px transparent`,
                      }}
                    />
                  </div>

                  {error && (
                    <div
                      className="login-error"
                      style={{
                        background: "rgba(127, 29, 29, 0.32)",
                        border: "1px solid rgba(248, 113, 113, 0.36)",
                        color: "#fee2e2",
                      }}
                    >
                      {error}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="ark-back-btn"
                      onClick={() => setIsOpen(false)}
                      style={{
                        position: "static",
                        padding: "12px 18px",
                        background: "rgba(16, 185, 129, 0.1)",
                        border: "1px solid rgba(110, 231, 183, 0.22)",
                        color: "#d1fae5",
                      }}
                    >
                      Collapse
                    </button>
                    <button
                      type="submit"
                      className="admin-btn-hot"
                      disabled={loading}
                      style={{
                        flex: 1,
                        minWidth: "190px",
                        marginTop: 0,
                        background: "linear-gradient(135deg, #34d399 0%, #10b981 45%, #059669 100%)",
                        color: "#052e1b",
                        boxShadow: `0 16px 28px ${emeraldGlow}, 0 0 20px rgba(52, 211, 153, 0.16)`,
                      }}
                    >
                      {loading ? "Signing in..." : "Enter Boarding Workspace"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
