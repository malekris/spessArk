// src/components/EditStudentModal.jsx
import React, { useState, useEffect } from "react";
import { adminFetch } from "../lib/api";

function EditStudentModal({ student, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "",
    gender: "",
    class_level: "",
    stream: "",
    subjects: [],
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (student) {
      setForm({
        name: student.name || "",
        gender: student.gender || "",
        class_level: student.class_level || "",
        stream: student.stream || "",
        subjects: Array.isArray(student.subjects) ? student.subjects : [],
      });
    }
  }, [student]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      setSaving(true);
      setError("");

      const updated = await adminFetch(`/api/students/${student.id}`, {
        method: "PATCH",
        body: form,
      });

      // 🔥 THIS updates AdminDashboard state
      onSaved(updated);
    } catch (err) {
      console.error("Edit student error:", err);
      setError(err.message || "Failed to update learner");
    } finally {
      setSaving(false);
    }
  };

  if (!student) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h2>Edit Learner</h2>

        {error && (
          <div className="panel-alert panel-alert-error">{error}</div>
        )}

        <form onSubmit={handleSubmit}>
          <label>Name</label>
          <input
            name="name"
            value={form.name}
            onChange={handleChange}
          />

          <label>Gender</label>
          <select
            name="gender"
            value={form.gender}
            onChange={handleChange}
          >
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>

          <label>Class</label>
          <input
            name="class_level"
            value={form.class_level}
            onChange={handleChange}
          />

          <label>Stream</label>
          <select
            name="stream"
            value={form.stream}
            onChange={handleChange}
          >
            <option value="North">North</option>
            <option value="South">South</option>
          </select>

          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
            <button type="submit" className="primary-btn" disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <button type="button" className="ghost-btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditStudentModal;
