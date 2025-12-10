// src/pages/TeacherLogin.jsx
import React, { useState } from "react";
import "./LoginPage.css"; // reuse the same styling as admin login

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
        body: JSON.stringify({
          email: form.email,
          password: form.password,
        }),
      });

      if (!res.ok) {
        let message = `Login failed (status ${res.status})`;
        try {
          const body = await res.json();
          if (body && body.message) message = body.message;
        } catch (_) {}
        throw new Error(message);
      }

      const data = await res.json();
      const { token, teacher } = data;

      // Store in localStorage so teacher dashboard can reuse
      localStorage.setItem("teacherToken", token);
      localStorage.setItem("teacherProfile", JSON.stringify(teacher));

      if (typeof onLoginSuccess === "function") {
        onLoginSuccess(teacher, token);
      } else {
        console.log("Teacher login success:", teacher);
        alert(`Welcome, ${teacher.name}!`);
      }
    } catch (err) {
      console.error("Teacher login error:", err);
      setError(err.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (typeof onBackToAdmin === "function") {
      onBackToAdmin();
    }
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
          Teacher Login
        </h1>
        <h2>Manage Your Marks</h2>

        <p
          style={{
            marginTop: "-0.3rem",
            marginBottom: "0.9rem",
            fontSize: "0.85rem",
            color: "#9ca3af",
          }}
        >
          Sign in to manage marks for your assigned subjects and streams.
        </p>

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
            id="email"
            name="email"
            type="email"
            placeholder="e.g. sarah@example.com"
            value={form.email}
            onChange={handleChange}
          />

          <input
            id="password"
            name="password"
            type="password"
            placeholder="Enter your password"
            value={form.password}
            onChange={handleChange}
          />

          <button type="submit">
            {loading ? "Signing in…" : "Sign in as Teacher"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleBack}
          style={{
            marginTop: "0.3rem",
            background: "rgba(15,23,42,0.9)",
          }}
        >
          ← Back to admin login
        </button>
      </div>
    </div>
  );
}

export default TeacherLogin;
