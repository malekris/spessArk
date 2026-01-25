import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

const formatName = (name) => {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

function TeacherSignup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name || !form.email || !form.password || !form.confirmPassword) {
      setError("All fields are required.");
      return;
    }
    if (form.name === form.name.toUpperCase()) {
      setError("Please use proper name format e.g. 'Namale Malone', not all caps.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch(`${API_BASE}/api/teachers/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
        }),
      });

      let data;
      try { data = await res.json(); } catch { data = {}; }
      
      if (!res.ok) { throw new Error(data.message || "Registration failed"); }

      setSuccess("Account created successfully. Please check your email to verify your account.");
      setTimeout(() => {
        navigate("/ark/teacher-login", { replace: true });
      }, 2000);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-background">
        <div className="carousel-slide active" style={{ backgroundImage: `url('/slide3.jpg')` }} />
      </div>

      <div className="glass-container">
        <div className="glass-header">
          <h1>TEACHER SIGN UP</h1>
          <h2>Create ARK Account</h2>
          <p className="ark-subtitle">Join the St. Phillip's Academic Records Kit</p>
        </div>

        {error && <div className="login-error">{error}</div>}
        {success && <div className="login-success">{success}</div>}

        <form onSubmit={handleSubmit} className="login-actions">
          <div className="input-group">
            <label>Full Name</label>
            <input
              name="name"
              placeholder="e.g. Namale Malone"
              value={form.name}
              onChange={handleChange}
              onBlur={() => setForm(prev => ({ ...prev, name: formatName(prev.name) }))}
            />
          </div>

          <div className="input-group">
            <label>Email Address</label>
            <input
              name="email"
              type="email"
              placeholder="e.g yourname@gmail.com"
              value={form.email}
              onChange={handleChange}
            />
          </div>

          <div className="input-group">
            <label>Password</label>
            <input
              name="password"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
            />
          </div>

          <div className="input-group">
            <label>Confirm Password</label>
            <input
              name="confirmPassword"
              type="password"
              placeholder="••••••••"
              value={form.confirmPassword}
              onChange={handleChange}
            />
          </div>

          <button type="submit" className="teacher-btn" disabled={loading} style={{ background: '#a78bfa', color: '#0a0c10', marginTop: '1rem' }}>
            {loading ? "Creating account…" : "Create Account"}
          </button>

          <button
  type="button"
  className="auth-secondary-btn-red"
  onClick={() => navigate("/ark/teacher-login")}
>
  <span>←</span> Back to Teacher Login
</button>
        </form>
      </div>
    </div>
  );
}

export default TeacherSignup;