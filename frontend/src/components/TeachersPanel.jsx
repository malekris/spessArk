// src/components/TeachersPanel.jsx
import React, { useEffect, useState } from "react";

/**
 * TeachersPanel
 * Props:
 *  - apiBase (string) optional, defaults to http://localhost:5001
 *  - onClose (function) optional, called when user clicks Close
 */
export default function TeachersPanel({ apiBase = "http://localhost:5001", onClose }) {
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    email: "",
    subject1: "",
    subject2: "",
  });

  // Helper to normalize error message from fetch responses
  const extractError = async (res) => {
    try {
      const body = await res.json();
      if (body && body.message) return body.message;
    } catch (_) {}
    return `Request failed with status ${res.status}`;
  };

  // Fetch teachers from API (safe to call multiple times)
  const fetchTeachers = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/teachers`);
      if (!res.ok) {
        const message = await extractError(res);
        throw new Error(message);
      }
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("Invalid response from server");
      setTeachers(data);
    } catch (err) {
      console.error("fetchTeachers error:", err);
      setError(err.message || "Could not load teachers");
    } finally {
      setLoading(false);
    }
  };

  // Auto-load teachers when the panel mounts
  useEffect(() => {
    fetchTeachers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInput = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
    setError("");
  };

  // Add teacher
  const handleAdd = async (e) => {
    e.preventDefault();
    setError("");

    const { name, email, subject1, subject2 } = form;
    if (!name || !email || !subject1 || !subject2) {
      setError("Please fill all fields before saving.");
      return;
    }

    try {
      setSaving(true);

      const res = await fetch(`${apiBase}/api/teachers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject1, subject2 }),
      });

      if (!res.ok) {
        const message = await extractError(res);
        throw new Error(message);
      }

      const created = await res.json();

      // Build a stable record to insert into local state
      const newTeacher = {
        id: created.id ?? created.insertId ?? Date.now(),
        name: created.name ?? name,
        email: created.email ?? email,
        subject1: created.subject1 ?? subject1,
        subject2: created.subject2 ?? subject2,
        created_at: created.created_at ?? new Date().toISOString(),
      };

      // Add to top of list
      setTeachers((prev) => [newTeacher, ...prev]);
      setForm({ name: "", email: "", subject1: "", subject2: "" });
    } catch (err) {
      console.error("handleAdd error:", err);
      setError(err.message || "Could not add teacher.");
    } finally {
      setSaving(false);
    }
  };

  // Delete teacher
  const handleDelete = async (id) => {
    if (!window.confirm("Remove this teacher?")) return;
    setError("");
    setDeletingId(id);

    try {
      const res = await fetch(`${apiBase}/api/teachers/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const message = await extractError(res);
        throw new Error(message);
      }

      // Remove locally
      setTeachers((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error("handleDelete error:", err);
      setError(err.message || "Could not delete teacher.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchTeachers();
    setRefreshing(false);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Manage Teachers</h2>
          <p>Register teachers and their two teaching subjects.</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button className="ghost-btn" type="button" onClick={handleRefresh} disabled={loading || refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button className="panel-close" type="button" onClick={() => onClose && onClose()}>
            ✕ Close
          </button>
        </div>
      </div>

      {error && <div className="panel-alert panel-alert-error">{error}</div>}

      <div className="panel-grid">
        <div className="panel-card">
          <h3>Add Teacher</h3>
          <form onSubmit={handleAdd}>
            <div className="form-row">
              <label htmlFor="tname">Full name</label>
              <input id="tname" name="name" value={form.name} onChange={handleInput} disabled={saving} />
            </div>

            <div className="form-row">
              <label htmlFor="temail">Email</label>
              <input id="temail" name="email" type="email" value={form.email} onChange={handleInput} disabled={saving} />
            </div>

            <div className="form-row">
              <label htmlFor="subject1">Subject 1</label>
              <input id="subject1" name="subject1" value={form.subject1} onChange={handleInput} disabled={saving} />
            </div>

            <div className="form-row">
              <label htmlFor="subject2">Subject 2</label>
              <input id="subject2" name="subject2" value={form.subject2} onChange={handleInput} disabled={saving} />
            </div>

            <button className="primary-btn" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Teacher"}
            </button>
          </form>
        </div>

        <div className="panel-card">
          <div className="panel-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Teachers</h3>
            <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
              {loading ? "Loading…" : `${teachers.length} teacher${teachers.length !== 1 ? "s" : ""}`}
            </div>
          </div>

          {loading && teachers.length === 0 ? (
            <p className="muted-text">Loading teachers…</p>
          ) : teachers.length === 0 ? (
            <p className="muted-text">No teachers yet. Add the first teacher on the left.</p>
          ) : (
            <div className="teachers-table-wrapper">
              <table className="teachers-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Subject 1</th>
                    <th>Subject 2</th>
                    <th>Added</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>{t.email}</td>
                      <td>{t.subject1}</td>
                      <td>{t.subject2}</td>
                      <td>{t.created_at ? new Date(t.created_at).toLocaleString() : "—"}</td>
                      <td className="teachers-actions">
                        <button
                          type="button"
                          className="danger-link"
                          onClick={() => handleDelete(t.id)}
                          disabled={deletingId === t.id}
                        >
                          {deletingId === t.id ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
