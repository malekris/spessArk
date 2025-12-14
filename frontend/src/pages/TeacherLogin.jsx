// src/pages/TeacherLogin.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

const API_BASE = "http://localhost:5001";

function TeacherLogin() {
  const navigate = useNavigate(); // ✅ REQUIRED

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
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "Login failed");
      }

      const { token, teacher } = await res.json();

      localStorage.setItem("teacherToken", token);
      localStorage.setItem("teacherProfile", JSON.stringify(teacher));

      // ✅ GO TO TEACHER DASHBOARD
      navigate("/teacher");
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="glass-container">
        <h1>Teacher Access</h1>
        <h2>Manage Student Marks</h2>

        <p style={{ fontSize: "0.85rem", color: "#9ca3af" }}>
          Sign in to enter and update marks for your assigned classes.
        </p>

        {error && <div className="login-error">{error}</div>}

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
              {loading ? "Signing in…" : "Sign in as Teacher"}
            </button>

            {/* ✅ THIS NOW WORKS */}
            <button
              type="button"
              className="auth-secondary-btn"
              onClick={() => navigate("/")}
            >
              ← Back to Admin Login
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TeacherLogin;
