import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./vine.css";
const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

export default function VineRegister() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    display_name: "",
    email: "",
    password: "",
    confirm: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!form.username || !form.password) {
      return setError("Username and password are required");
    }

    if (form.password !== form.confirm) {
      return setError("Passwords do not match");
    }

    try {
      setLoading(true);

      console.log("📤 Sending register payload:", form);

      const res = await fetch(`${API}/api/vine/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          display_name: form.display_name,
          email: form.email,
          password: form.password,
        }),
      });

      const data = await res.json();
      console.log("📥 Register response:", data);

      if (!res.ok) {
        return setError(data.message || "Registration failed");
      }

      setSuccess("Account created successfully! Redirecting...");
      setTimeout(() => navigate("/vine/login"), 1500);

    } catch (err) {
      console.error(err);
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="vine-auth">
      <form className="vine-card" onSubmit={handleSubmit}>
      <div style={{ textAlign: "center", fontSize: "2rem" }}>🌱</div>
      <p style={{ textAlign: "center", color: "#15803d", fontWeight: 600 }}>
  SPESS VINE
</p>

        <h2>Create your Vine account 🌱</h2>

        <input
  name="username"
  placeholder="Username"
  value={form.username}
  onChange={handleChange}
  pattern="^\S+$"    /* 👈 Blocks spaces */
  minLength="3"      /* 👈 Min 3 characters */
  required           /* 👈 Cannot be empty */
  title="Username must be at least 3 characters and contain no spaces"
/>
        <input
          name="display_name"
          placeholder="Display name (optional)"
          value={form.display_name}
          onChange={handleChange}
        />

        <input
          name="email"
          placeholder="Email (optional)"
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
          name="confirm"
          type="password"
          placeholder="Confirm password"
          value={form.confirm}
          onChange={handleChange}
        />

        {error && <p className="error">{error}</p>}
        {success && <p className="success">{success}</p>}

        <button disabled={loading}>
          {loading ? "Creating account..." : "Sign Up"}
        </button>

        <p className="switch-auth">
          Already have an account? <Link to="/vine/login">Login</Link>
        </p>
      </form>
    </div>
  );
}
