import { useState, useEffect } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { touchVineActivity } from "../utils/vineAuth";
import "./VineLogin.css"; // 🔥 Pointing to the new file
const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineLogin() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showDesktopForm, setShowDesktopForm] = useState(false);
  const redirectParam = searchParams.get("redirect") || location.state?.from || "";
  const safeRedirect = typeof redirectParam === "string" && redirectParam.startsWith("/")
    ? redirectParam
    : "";

  useEffect(() => {
    document.title = "Vine — Login";
  }, []);

  useEffect(() => {
    const updateViewport = () => {
      const desktop = window.matchMedia("(min-width: 769px)").matches;
      setIsDesktop(desktop);
      if (!desktop) setShowDesktopForm(true);
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

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
      touchVineActivity();

      // Redirect
      if (data?.user?.delete_requested_at) {
        window.location.href = "/vine/settings";
      } else if (safeRedirect) {
        window.location.href = safeRedirect;
      } else {
        window.location.href = "/vine/feed";
      }

    } catch (err) {
      console.error(err);
      alert("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="vine-auth-bg vine-auth-bg-login">
      <div className="vine-login-florals" aria-hidden="true">
        <span className="vine-flower vine-flower-top" />
        <span className="vine-flower vine-flower-bottom" />
        <span className="vine-leaf-arc vine-leaf-arc-left" />
        <span className="vine-leaf-arc vine-leaf-arc-right" />
      </div>
      <div className="vine-auth-card vine-auth-card-login">
      <Link to="/" className="back-home-btn">
    ← Back to website
  </Link>
        <div className="vine-login-kicker">
          <span className="vine-login-kicker-line" />
          <span className="vine-login-kicker-bloom">Bloom into Vine</span>
          <span className="vine-login-kicker-line" />
        </div>
        <h2 className="vine-title">Welcome to SPESS VINE 🌱</h2>
        <p className="vine-login-subcopy">Forest calm, mint light, and a little floral grace before you step in.</p>

        {isDesktop && !showDesktopForm ? (
          <button
            type="button"
            className="login-scroll-trigger"
            onClick={() => setShowDesktopForm(true)}
          >
            Click To Login
          </button>
        ) : (
          <div className={isDesktop ? "login-scroll-unfold" : ""}>
            <form className="vine-form" onSubmit={handleLogin}>
              <input
                type="text"
                placeholder="Username"
                value={identifier}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === " ") e.preventDefault();
                }}
                onChange={(e) => setIdentifier(e.target.value.replace(/\s+/g, ""))}
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
        )}
      
      </div>
    </div>
  );
}
