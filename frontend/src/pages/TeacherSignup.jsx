// src/pages/TeacherSignup.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LoginPage.css";

const API_BASE =import.meta.env.VITE_API_BASE || "http://localhost:5001";
const toSentenceCase = (str) =>
  str
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

    const formatName = (name) => {
      return name
        .toLowerCase()
        .replace(/\s+/g, " ")       // collapse multiple spaces
        .trim()
        .split(" ")
        .map(word =>
          word.charAt(0).toUpperCase() + word.slice(1)
        )
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
      setError("Please use proper name format e.g. 'Male Lincoln', not all caps.");
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
        }),
      });

      let data = {};
      const contentType = res.headers.get("content-type");

      if (contentType && contentType.includes("application/json")) {
      data = await res.json();
      }

      if (!res.ok) {
        throw new Error(data.message || "Registration failed");
      }

      setSuccess(
        "Account created successfully. Please check your email to verify your account."
      );

      // Small delay so user sees success
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
      <div className="glass-container">
        <h1>Teacher Sign Up</h1>
        <p>Create your teacher account</p>

        {error && <div className="login-error">{error}</div>}
        {success && <div className="login-success">{success}</div>}

        <form onSubmit={handleSubmit}>
        <input
           name="name"
             placeholder="Full Name"
             value={form.name}
                 onChange={handleChange}
              onBlur={() =>
               setForm(prev => ({
      ...prev,
      name: formatName(prev.name)
    }))
  }
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

          <button type="submit" className="teacher-btn" disabled={loading}>
            {loading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <button
          className="auth-secondary-btn"
          onClick={() => navigate("/ark/teacher-login")}
        >
          ← Back to Teacher Login
        </button>
      </div>
    </div>
  );
}

export default TeacherSignup;
