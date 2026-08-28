import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import badge from "../../../assets/badge.png";
import {
  getParentToken,
  parentRequest,
  storeParentToken,
} from "../parentApi";
import "./ParentsPortal.css";

const EMPTY_LOGIN = { phone: "", password: "" };
const EMPTY_REGISTRATION = {
  displayName: "",
  phone: "",
  password: "",
  confirmPassword: "",
};

export default function ParentsEntry() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [loginForm, setLoginForm] = useState(EMPTY_LOGIN);
  const [registrationForm, setRegistrationForm] = useState(EMPTY_REGISTRATION);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (getParentToken()) navigate("/reports/portal", { replace: true });
  }, [navigate]);

  const submitLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await parentRequest("/api/parents/login", {
        method: "POST",
        auth: false,
        body: loginForm,
      });
      storeParentToken(data.token);
      navigate("/reports/portal", { replace: true });
    } catch (err) {
      setError(err.message || "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  };

  const submitRegistration = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (registrationForm.password !== registrationForm.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const data = await parentRequest("/api/parents/register", {
        method: "POST",
        auth: false,
        body: registrationForm,
      });
      setRegistrationForm(EMPTY_REGISTRATION);
      setNotice(data?.message || "Registration received and awaiting school approval.");
    } catch (err) {
      setError(err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="parents-entry-page">
      <header className="parents-entry-nav">
        <Link to="/" className="parents-brand-link" aria-label="Return to the school website">
          <img src={badge} alt="" />
          <span>
            <strong>SPESS Reports</strong>
            <small>Parent document portal</small>
          </span>
        </Link>
        <Link to="/" className="parents-home-link">School Website</Link>
      </header>

      <section className="parents-entry-layout">
        <div className="parents-entry-intro">
          <span className="parents-kicker">St. Phillip&apos;s Equatorial Secondary School</span>
          <h1>School reports, delivered with care.</h1>
          <p>
            Approved parents and guardians can securely view report cards and official school circulars wherever they are.
          </p>
          <dl className="parents-entry-facts">
            <div>
              <dt>Controlled</dt>
              <dd>Every account is matched by school administration.</dd>
            </div>
            <div>
              <dt>Private</dt>
              <dd>Documents are visible only after an authorised release.</dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>Released PDFs open directly on phone or computer.</dd>
            </div>
          </dl>
        </div>

        <div className="parents-auth-panel">
          <div className="parents-auth-tabs" role="tablist" aria-label="Parent account access">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "is-active" : ""}
              onClick={() => {
                setMode("login");
                setError("");
                setNotice("");
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              className={mode === "register" ? "is-active" : ""}
              onClick={() => {
                setMode("register");
                setError("");
                setNotice("");
              }}
            >
              Register
            </button>
          </div>

          <div className="parents-auth-heading">
            <span>{mode === "login" ? "Welcome back" : "Parent registration"}</span>
            <h2>{mode === "login" ? "Open your family portal" : "Request secure access"}</h2>
            <p>
              {mode === "login"
                ? "Use the phone number and password registered with SPESS."
                : "Registration remains pending until Admin matches your account to the correct learner."}
            </p>
          </div>

          {error && <div className="parents-form-message is-error" role="alert">{error}</div>}
          {notice && <div className="parents-form-message is-success" role="status">{notice}</div>}

          {mode === "login" ? (
            <form className="parents-auth-form" onSubmit={submitLogin}>
              <label>
                <span>Phone Number</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0772 123 456"
                  value={loginForm.phone}
                  onChange={(event) => setLoginForm((current) => ({ ...current, phone: event.target.value }))}
                  required
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                  required
                />
              </label>
              <button className="parents-primary-action" type="submit" disabled={loading}>
                {loading ? "Signing In..." : "Sign In to SPESS Reports"}
              </button>
              <p className="parents-auth-support">Access problems are handled privately by the school administration office.</p>
            </form>
          ) : (
            <form className="parents-auth-form" onSubmit={submitRegistration}>
              <label>
                <span>Parent or Guardian Name</span>
                <input
                  type="text"
                  autoComplete="name"
                  placeholder="Full name"
                  value={registrationForm.displayName}
                  onChange={(event) => setRegistrationForm((current) => ({ ...current, displayName: event.target.value }))}
                  required
                />
              </label>
              <label>
                <span>Phone Number</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0772 123 456"
                  value={registrationForm.phone}
                  onChange={(event) => setRegistrationForm((current) => ({ ...current, phone: event.target.value }))}
                  required
                />
              </label>
              <div className="parents-auth-form-grid">
                <label>
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    minLength={8}
                    value={registrationForm.password}
                    onChange={(event) => setRegistrationForm((current) => ({ ...current, password: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  <span>Confirm Password</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat password"
                    minLength={8}
                    value={registrationForm.confirmPassword}
                    onChange={(event) => setRegistrationForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                    required
                  />
                </label>
              </div>
              <button className="parents-primary-action" type="submit" disabled={loading}>
                {loading ? "Submitting..." : "Submit Registration"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

