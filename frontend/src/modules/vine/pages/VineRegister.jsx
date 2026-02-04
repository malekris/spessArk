import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./VineRegister.css";  // ← this one line adds the styles

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

  useEffect(() => {
    document.title = "Vine — Register";
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;

   // Live restrict username characters while typing
if (name === "username") {
  // allow only letters, numbers, dot, underscore
  const clean = value.replace(/[^a-zA-Z0-9._]/g, "");
  setForm({ ...form, [name]: clean });
} else {
  setForm({ ...form, [name]: value });
}

  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Final validation before sending
    if (!form.username) {
      return setError("Username is required");
    }

    if (/\s/.test(form.username)) {
      return setError("Username cannot contain spaces");
    }

    if (form.username.length < 3) {
      return setError("Username must be at least 3 characters");
    }

    if (!form.email) {
      return setError("Email is required");
    }

    // Simple email format check (can improve later)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      return setError("Please enter a valid email");
    }

    if (!form.password) {
      return setError("Password is required");
    }

    if (form.password !== form.confirm) {
      return setError("Passwords do not match");
    }

    try {
      setLoading(true);

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

      if (!res.ok) {
        return setError(data.message || "Registration failed");
      }

      // Success
      alert("Account created! Redirecting to login...");
      setTimeout(() => navigate("/vine/login"), 1500);

    } catch (err) {
      console.error(err);
      setError("Network error – please try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="vine-auths">
      <form className="vine-card" onSubmit={handleSubmit}>
        <div style={{ textAlign: "center", fontSize: "2rem" }}>🌱</div>
        <p style={{ textAlign: "center", color: "#15803d", fontWeight: 600 }}>
          SPESS VINE
        </p>

        <h2>Create your Vine account 🌱</h2>

        {/* Username – live space block + validation */}
        <input
          name="username"
          placeholder="Username (no spaces)"
          value={form.username}
          onChange={handleChange}
          minLength={3}
          required
          title="Username must be at least 3 characters and contain no spaces"
          pattern="^\S+$"               // blocks submit if spaces sneak in
        />

        <input
          name="display_name"
          placeholder="Display name "
          value={form.display_name}
          onChange={handleChange}
        />

        {/* Email – now required */}
        <input
          name="email"
          type="email"
          placeholder="Email (required)"
          value={form.email}
          onChange={handleChange}
          required
          title="A valid email is required"
        />

        <input
          name="password"
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={handleChange}
          required
        />

        <input
          name="confirm"
          type="password"
          placeholder="Confirm password"
          value={form.confirm}
          onChange={handleChange}
          required
        />

        {error && <p className="error">{error}</p>}

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
