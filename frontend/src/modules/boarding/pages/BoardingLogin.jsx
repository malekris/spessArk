import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../../pages/LoginPage.css";
import { useSiteVisuals } from "../../../utils/siteVisuals";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const emeraldGlow = "rgba(52, 211, 153, 0.24)";

export default function BoardingLogin() {
  const navigate = useNavigate();
  const siteVisuals = useSiteVisuals();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [splashCountdown, setSplashCountdown] = useState(10);
  const [useLiteBackground, setUseLiteBackground] = useState(false);

  const boardingCoverUrl =
    siteVisuals.boarding_login_url || "/newactivities/covercover.jpeg";

  useEffect(() => {
    document.title = "Boarding Login | SPESS ARK";
  }, []);

  useEffect(() => {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const isMobile = window.matchMedia("(max-width: 900px)").matches;
    const lowMemory = typeof navigator.deviceMemory === "number" ? navigator.deviceMemory <= 4 : false;
    const saveData = Boolean(conn?.saveData);
    const slowNet = /(^|[^0-9])(2g|3g)/i.test(String(conn?.effectiveType || ""));
    setUseLiteBackground(isMobile && (lowMemory || saveData || slowNet));
  }, []);

  useEffect(() => {
    if (!showSplash) return undefined;

    setSplashCountdown(10);
    const tickTimer = window.setInterval(() => {
      setSplashCountdown((previous) => (previous > 0 ? previous - 1 : 0));
    }, 1000);

    const navigateTimer = window.setTimeout(() => {
      navigate("/ark/boarding", { replace: true });
    }, 10000);

    return () => {
      window.clearInterval(tickTimer);
      window.clearTimeout(navigateTimer);
    };
  }, [showSplash, navigate]);

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
      setShowSplash(true);
    } catch (err) {
      setError(err.message || "Boarding login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ark-login-wrapper">
      <style>{`
        @keyframes boardingSplashPulse {
          0% { transform: scale(0.96); opacity: 0.78; }
          50% { transform: scale(1.04); opacity: 1; }
          100% { transform: scale(0.96); opacity: 0.78; }
        }
        @keyframes boardingSplashHalo {
          0% { transform: scale(0.94); opacity: 0.24; }
          50% { transform: scale(1.08); opacity: 0.5; }
          100% { transform: scale(0.94); opacity: 0.24; }
        }
        @keyframes boardingSplashFloat {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-5px); }
          100% { transform: translateY(0px); }
        }
      `}</style>

      <div className="ark-bg-slideshow">
        {useLiteBackground ? (
          <div className="ark-bg-pattern" />
        ) : (
          <div
            className="ark-slide ark-active"
            style={{ backgroundImage: `url(${boardingCoverUrl})` }}
          />
        )}
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

      {showSplash && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 3000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
            background:
              "radial-gradient(circle at center, rgba(16, 185, 129, 0.14) 0%, rgba(2, 6, 23, 0.78) 38%, rgba(2, 6, 23, 0.96) 100%)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "min(620px, 92vw)",
              padding: "2.4rem 2rem",
              borderRadius: "999px",
              border: "1px solid rgba(110, 231, 183, 0.34)",
              background:
                "linear-gradient(135deg, rgba(3, 18, 12, 0.76) 0%, rgba(6, 78, 59, 0.22) 42%, rgba(15, 23, 42, 0.72) 100%)",
              boxShadow:
                "0 24px 60px rgba(0, 0, 0, 0.56), 0 0 46px rgba(16, 185, 129, 0.16), inset 0 1px 0 rgba(167, 243, 208, 0.12)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: "12px",
                borderRadius: "999px",
                border: "1px solid rgba(110, 231, 183, 0.12)",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                width: "124px",
                height: "124px",
                borderRadius: "999px",
                left: "50%",
                top: "50%",
                marginLeft: "-62px",
                marginTop: "-62px",
                border: "1px solid rgba(110, 231, 183, 0.18)",
                boxShadow: "0 0 0 1px rgba(52, 211, 153, 0.06), 0 0 30px rgba(16, 185, 129, 0.12)",
                animation: "boardingSplashHalo 2.6s ease-in-out infinite",
                pointerEvents: "none",
              }}
            />

            <div
              style={{
                position: "relative",
                zIndex: 1,
                display: "grid",
                gap: "0.6rem",
                justifyItems: "center",
                textAlign: "center",
                animation: "boardingSplashFloat 2.8s ease-in-out infinite",
              }}
            >
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "999px",
                  display: "grid",
                  placeItems: "center",
                  background: "rgba(16, 185, 129, 0.12)",
                  border: "1px solid rgba(110, 231, 183, 0.22)",
                  color: "#a7f3d0",
                  fontSize: "1.7rem",
                  animation: "boardingSplashPulse 2.2s ease-in-out infinite",
                  boxShadow: "0 0 26px rgba(16, 185, 129, 0.14)",
                }}
              >
                ✈️🧳
              </div>

              <div
                style={{
                  color: "#ecfdf5",
                  fontSize: "clamp(1.5rem, 3vw, 2.3rem)",
                  fontWeight: 900,
                  letterSpacing: "0.06em",
                  textShadow: "0 0 18px rgba(16, 185, 129, 0.18)",
                }}
              >
                Now Boarding...
              </div>

              <div
                style={{
                  color: "rgba(220, 252, 231, 0.82)",
                  fontSize: "0.95rem",
                  maxWidth: "460px",
                  lineHeight: 1.6,
                }}
              >
                Preparing the boarding workspace for learners, weekend marks, and reports.
              </div>

              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.55rem",
                  marginTop: "0.3rem",
                  padding: "0.42rem 0.8rem",
                  borderRadius: "999px",
                  background: "rgba(16, 185, 129, 0.12)",
                  border: "1px solid rgba(110, 231, 183, 0.18)",
                  color: "#d1fae5",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                Now entering webportal · {splashCountdown}s
              </div>
            </div>
          </div>
        </div>
      )}

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
            ? "linear-gradient(165deg, rgba(4, 18, 13, 0.86) 0%, rgba(6, 78, 59, 0.28) 38%, rgba(16, 185, 129, 0.1) 68%, rgba(15, 23, 42, 0.82) 100%)"
            : "linear-gradient(135deg, rgba(4, 18, 13, 0.46) 0%, rgba(16, 185, 129, 0.12) 46%, rgba(11, 18, 32, 0.34) 100%)",
          border: isOpen
            ? "1px solid rgba(110, 231, 183, 0.24)"
            : "1px solid rgba(110, 231, 183, 0.16)",
          boxShadow: isOpen
            ? "0 24px 56px rgba(0, 0, 0, 0.58), 0 0 0 1px rgba(16, 185, 129, 0.08), 0 0 22px rgba(16, 185, 129, 0.08), inset 0 1px 0 rgba(167, 243, 208, 0.08)"
            : "0 18px 42px rgba(0, 0, 0, 0.28), 0 0 18px rgba(16, 185, 129, 0.08), inset 0 1px 0 rgba(167, 243, 208, 0.06)",
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
                  textShadow: "0 0 10px rgba(16, 185, 129, 0.18)",
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
              <button
                type="button"
                className="link-btn"
                onClick={() => navigate("/ark", { state: { openAdminLogin: true } })}
                style={{
                  marginTop: "0.2rem",
                  textAlign: "left",
                  color: "#bbf7d0",
                  textDecoration: "none",
                }}
              >
                ← Back to Admin Login
              </button>
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
                background: "linear-gradient(135deg, rgba(52,211,153,0.9) 0%, rgba(16,185,129,0.92) 52%, rgba(5,150,105,0.96) 100%)",
                color: "#022c22",
                boxShadow: "0 12px 24px rgba(5, 150, 105, 0.24), 0 0 14px rgba(16,185,129,0.14)",
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
                  background: "rgba(16, 185, 129, 0.12)",
                  border: "1px solid rgba(110, 231, 183, 0.2)",
                  color: "#bbf7d0",
                  fontSize: "0.68rem",
                  fontWeight: 900,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                Boarding Portal
              </div>
              <h1 style={{ color: "#ecfdf5", textShadow: "0 0 12px rgba(16,185,129,0.16)" }}>BOARDING</h1>
              <h2 style={{ color: "#6ee7b7", fontWeight: 700, textShadow: "0 0 8px rgba(16,185,129,0.1)" }}>Weekend Assessments</h2>
              <p className="ark-subtitle" style={{ color: "rgba(220, 252, 231, 0.72)" }}>
                Separate boarding workspace for learners, marks, and reports.
              </p>
              <button
                type="button"
                className="link-btn"
                onClick={() => navigate("/ark", { state: { openAdminLogin: true } })}
                style={{
                  marginTop: "0.2rem",
                  color: "#bbf7d0",
                  textDecoration: "none",
                }}
              >
                ← Back to Admin Login
              </button>
            </div>

            <div
              style={{
                marginTop: "0.35rem",
                padding: "0.85rem 0.9rem 0.35rem",
                borderRadius: "18px",
                border: "1px solid rgba(110, 231, 183, 0.18)",
                background: "linear-gradient(180deg, rgba(4, 20, 15, 0.8) 0%, rgba(5, 150, 105, 0.08) 100%)",
                boxShadow: "0 18px 34px rgba(2, 6, 23, 0.34), inset 0 1px 0 rgba(167,243,208,0.08), 0 0 18px rgba(16,185,129,0.08)",
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
                        border: "1px solid rgba(110, 231, 183, 0.22)",
                        background: "linear-gradient(180deg, rgba(3, 15, 11, 0.96) 0%, rgba(7, 38, 28, 0.9) 100%)",
                        color: "#f0fdf4",
                        boxShadow: "inset 0 1px 0 rgba(167,243,208,0.06), 0 0 8px rgba(16,185,129,0.05)",
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
                        border: "1px solid rgba(110, 231, 183, 0.22)",
                        background: "linear-gradient(180deg, rgba(3, 15, 11, 0.96) 0%, rgba(7, 38, 28, 0.9) 100%)",
                        color: "#f0fdf4",
                        boxShadow: "inset 0 1px 0 rgba(167,243,208,0.06), 0 0 8px rgba(16,185,129,0.05)",
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
                        boxShadow: "0 0 10px rgba(16,185,129,0.05)",
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
                        background: "linear-gradient(135deg, #6ee7b7 0%, #34d399 34%, #10b981 68%, #059669 100%)",
                        color: "#052e1b",
                        boxShadow: `0 16px 28px ${emeraldGlow}, 0 0 18px rgba(52, 211, 153, 0.16)`,
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
