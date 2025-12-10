import React, { useState } from "react";
import "./LoginPage.css";

function LoginPage({ onLogin }) {
  const [form, setForm] = useState({
    username: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!form.username || !form.password) {
      setError("Please enter username and password.");
      return;
    }

    setLoading(true);

    // same simple frontend-only admin check as before
    setTimeout(() => {
      setLoading(false);

      if (form.username === "admin" && form.password === "admin") {
        onLogin("admin");
      } else {
        setError("Invalid admin credentials.");
      }
    }, 400);
  };

  const handleTeacherClick = () => {
    onLogin("teacher");
  };

  return (
    <div className="login-page">
      <div className="glass-container">
        <h1
          style={{
            margin: 0,
            marginBottom: "0.4rem",
            fontSize: "1.6rem",
            fontWeight: 600,
            letterSpacing: "0.08em",
          }}
        >
          SPESS’s ARK
        </h1>
        <h2>Admin / Teacher Access</h2>

        {error && (
          <div
            style={{
              marginBottom: "0.9rem",
              padding: "0.5rem 0.7rem",
              borderRadius: "10px",
              background: "rgba(248, 113, 113, 0.14)",
              border: "1px solid rgba(248, 113, 113, 0.6)",
              color: "#fecaca",
              fontSize: "0.8rem",
              textAlign: "left",
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ marginBottom: "0.8rem", textAlign: "left" }}
        >
          <input
            name="username"
            type="text"
            placeholder="Admin username (e.g. admin)"
            value={form.username}
            onChange={handleChange}
          />

          <input
            name="password"
            type="password"
            placeholder="Admin password (e.g. admin)"
            value={form.password}
            onChange={handleChange}
          />

          <button type="submit">
            {loading ? "Signing in…" : "Sign in as Admin"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleTeacherClick}
          style={{ marginTop: "0.4rem", background: "rgba(15,23,42,0.9)" }}
        >
          I’m a Teacher — go to teacher login →
        </button>
      </div>
    </div>
  );
}

export default LoginPage;
