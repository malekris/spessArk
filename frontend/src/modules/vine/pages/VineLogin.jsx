import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { getRequestedSessionMode } from "../../../utils/deviceSession";
import { touchVineActivity } from "../utils/vineAuth";
import VineAuthFlorals from "../components/VineAuthFlorals";
import { buildVineAuthThemeClasses, shouldRenderVineAuthFlorals, useVineAuthTheme } from "../utils/authTheme";
import "./VineLogin.css";
const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineLogin() {
  const location = useLocation();
  const authTheme = useVineAuthTheme();
  const [searchParams] = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showDesktopForm, setShowDesktopForm] = useState(false);
  const loginErrorRef = useRef(null);
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

  useEffect(() => {
    if (loginError) loginErrorRef.current?.focus({ preventScroll: true });
  }, [loginError]);

  const clearLoginError = () => {
    if (loginError) setLoginError(null);
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    setLoginError(null);

    if (!identifier.trim() || !password) {
      setLoginError({
        kind: "validation",
        title: "Enter your login details",
        message: "Add your username and password before signing in.",
      });
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(`${API}/api/vine/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier,
          password,
          session_mode: getRequestedSessionMode(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          setLoginError({
            kind: "credentials",
            title: "We could not sign you in",
            message: "That username or password does not match. Check your details and try again.",
            showResetLink: true,
          });
        } else if (res.status === 429) {
          setLoginError({
            kind: "rate-limit",
            title: "Too many login attempts",
            message: "Please wait a moment before trying again.",
          });
        } else {
          setLoginError({
            kind: "server",
            title: "Vine could not sign you in",
            message: data.message || "Something went wrong. Please try again in a moment.",
          });
        }
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
      setLoginError({
        kind: "network",
        title: "Vine could not connect",
        message: "Check your internet connection and try signing in again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={buildVineAuthThemeClasses(authTheme)}
      style={{ "--vine-login-cover": `url(${authTheme.cover_url})` }}
    >
      {shouldRenderVineAuthFlorals(authTheme) && <VineAuthFlorals />}
      <div className="vine-auth-card vine-auth-card-login">
      <Link to="/" className="back-home-btn">
    ← Back to website
  </Link>
        <h2 className="vine-title">Welcome to SPESS VINE 🌱</h2>
        <p className="vine-login-subcopy">Forest calm and mint light before you step in.</p>

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
            <form className="vine-form" onSubmit={handleLogin} noValidate aria-busy={loading}>
              {loginError && (
                <div
                  ref={loginErrorRef}
                  className={`vine-login-alert vine-login-alert-${loginError.kind}`}
                  id="vine-login-error"
                  role="alert"
                  aria-live="assertive"
                  aria-atomic="true"
                  tabIndex={-1}
                >
                  <span className="vine-login-alert-icon" aria-hidden="true">!</span>
                  <span className="vine-login-alert-copy">
                    <strong>{loginError.title}</strong>
                    <span>{loginError.message}</span>
                    {loginError.showResetLink && (
                      <Link to="/vine/forgot-password">Reset your password</Link>
                    )}
                  </span>
                </div>
              )}

              <input
                type="text"
                placeholder="Username"
                value={identifier}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={loginError?.kind === "validation" || loginError?.kind === "credentials"}
                aria-describedby={loginError ? "vine-login-error" : undefined}
                onKeyDown={(e) => {
                  if (e.key === " ") e.preventDefault();
                }}
                onChange={(e) => {
                  setIdentifier(e.target.value.replace(/\s+/g, ""));
                  clearLoginError();
                }}
              />

              <input
                type="password"
                placeholder="Password"
                value={password}
                autoComplete="current-password"
                aria-invalid={loginError?.kind === "validation" || loginError?.kind === "credentials"}
                aria-describedby={loginError ? "vine-login-error" : undefined}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearLoginError();
                }}
              />

              <button type="submit" className="vine-btn" disabled={loading}>
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
