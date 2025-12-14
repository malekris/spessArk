import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

const API_BASE = "http://localhost:5001";

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
    setForm((p) => ({ ...p, [name]: value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
  
    if (!form.name || !form.email || !form.password) {
      setError("All fields are required.");
      return;
    }
  
    try {
      setLoading(true);
      setError("");
  
      const res = await fetch(`${API_BASE}/api/teachers/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
        }),
      });
  
      const data = await res.json();
  
      if (!res.ok) {
        throw new Error(data.message || "Registration failed");
      }
  
      alert(
        "Account created successfully. Please check your email to verify your account."
      );
  
      // send teacher back to login
      navigate("/teacher-login");
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };
  

  return (
    <div className="login-page">
      <div className="glass-container">
        <h1>Teacher Sign Up</h1>
        <p>Create your teacher account</p>

        {error && <div className="error-box">{error}</div>}
        {success && <div className="success-box">{success}</div>}

        <form onSubmit={handleSubmit}>
          <input
            name="name"
            placeholder="Full Name"
            value={form.name}
            onChange={handleChange}
          />

          <input
            name="email"
            type="email"
            placeholder="Email address"
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

          <input
            name="confirmPassword"
            type="password"
            placeholder="Confirm password"
            value={form.confirmPassword}
            onChange={handleChange}
          />

          <button
            type="submit"
            className="teacher-btn"
            disabled={loading}
          >
            {loading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <button
          className="auth-secondary-btn"
          onClick={() => navigate("/teacher-login")}
        >
          ← Back to Teacher Login
        </button>
      </div>
    </div>
  );
}

export default TeacherSignup;
