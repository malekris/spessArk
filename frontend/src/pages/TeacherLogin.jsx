// src/pages/TeacherLogin.jsx
import React, { useState } from "react";
import "./LoginPage.css"; // reuse liquid glass styles

const API_BASE = "http://localhost:5001";

function TeacherLogin({ onLoginSuccess, onBackToAdmin }) {
  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.email || !form.password) {
      setError("Please fill in both email and password.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch(`${API_BASE}/api/teachers/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        let message = `Login failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.message) message = body.message;
        } catch {}
        throw new Error(message);
      }

      const { token, teacher } = await res.json();

      localStorage.setItem("teacherToken", token);
      localStorage.setItem("teacherProfile", JSON.stringify(teacher));

      if (typeof onLoginSuccess === "function") {
        onLoginSuccess(teacher, token);
      }
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="glass-container">
        {/* Title */}
        <h1
          style={{
            margin: 0,
            marginBottom: "0.35rem",
            fontSize: "1.6rem",
            fontWeight: 700,
            letterSpacing: "0.1em",
          }}
        >
          Teacher Access
        </h1>

        <h2>Manage Student Marks</h2>

        <p
          style={{
            marginTop: "-0.3rem",
            marginBottom: "1rem",
            fontSize: "0.85rem",
            color: "rgba(148,163,184,0.85)",
          }}
        >
          Sign in to enter and update marks for your assigned classes.
        </p>

        {/* Error message */}
        {error && (
          <div
            style={{
              marginBottom: "0.9rem",
              padding: "0.55rem 0.75rem",
              borderRadius: "12px",
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.45)",
              color: "#fecaca",
              fontSize: "0.8rem",
              textAlign: "left",
            }}
          >
            {error}
          </div>
        )}

        {/* Login form */}
        <form onSubmit={handleSubmit}>
          <input
            name="email"
            type="email"
            placeholder="Teacher email"
            value={form.email}
            onChange={handleChange}
          />

          <input
            name="password"
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={handleChange}
          />

          <div className="login-action-row">
            <button
              type="submit"
              className="teacher-btn"
              disabled={loading}
            >
              {loading ? <span className="btn-spinner" /> : "Sign in as Teacher"}
            </button>

            <button
              type="button"
              onClick={onBackToAdmin}
              className="back-link-btn"
            >
              ← Back to admin login
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TeacherLogin;
