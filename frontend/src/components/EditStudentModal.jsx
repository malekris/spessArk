// src/components/EditStudentModal.jsx
import React, { useEffect, useRef, useState } from "react";
import { adminFetch } from "../lib/api";

const COMPULSORY_SUBJECTS = [
  "English",
  "Mathematics",
  "Physics",
  "Biology",
  "Chemistry",
  "History",
  "Geography",
];

const OPTIONAL_SUBJECTS = [
  "ICT",
  "Agriculture",
  "Physical Education",
  "Art",
  "Luganda",
  "Literature",
  "Christian Religious Education",
  "Entrepreneurship",
  "IRE",
  "Kiswahili",
];

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
  const [success, setSuccess] = useState("");

  // synchronous submission lock to avoid race conditions
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!student) return;
    setForm({
      name: student.name || "",
      gender: student.gender || "",
      class_level: student.class_level || "",
      stream: student.stream || "",
      subjects: Array.isArray(student.subjects) ? student.subjects : [],
    });
    setError("");
    setSuccess("");
    // reset any previous submitting lock (safe)
    submittingRef.current = false;
    setSaving(false);
  }, [student]);

  useEffect(() => {
    return () => {
      // cleanup if component unmounts
      submittingRef.current = false;
    };
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
    setError("");
  };

  const handleToggleSubject = (subject) => {
    setForm((p) => {
      if (COMPULSORY_SUBJECTS.includes(subject)) return p;

      const exists = p.subjects.includes(subject);
      if (exists) {
        return { ...p, subjects: p.subjects.filter((s) => s !== subject) };
      }

      const optionalCount = p.subjects.filter((s) =>
        OPTIONAL_SUBJECTS.includes(s)
      ).length;

      if (optionalCount >= 6) {
        setError("Maximum of 6 optional subjects allowed.");
        return p;
      }

      return { ...p, subjects: [...p.subjects, subject] };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // synchronous guard to block duplicate submissions immediately
    if (submittingRef.current) return;
    submittingRef.current = true;

    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const updated = await adminFetch(
        `/api/admin/students/${student.id}`,
        {
          method: "PUT",
          body: {
            ...form,
            // ensure compulsory subjects present
            subjects: [
              ...new Set([
                ...COMPULSORY_SUBJECTS,
                ...(Array.isArray(form.subjects) ? form.subjects : []),
              ]),
            ],
          },
        }
      );

      // update local UI first while still mounted
      setSuccess("Learner updated successfully ✔");
      setSaving(false);
      submittingRef.current = false;

      // inform parent (may update parent state and unmount modal)
      onSaved && onSaved(updated);

      // close modal after small delay so user sees success
      setTimeout(() => {
        onClose && onClose();
      }, 800);
    } catch (err) {
      console.error("Edit student error:", err);
      // surface meaningful message if backend provided one
      const msg = err?.message || err?.detail || "Failed to update learner";
      setError(msg);
      setSaving(false);
      submittingRef.current = false;
    }
  };

  if (!student) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h2>Edit Learner</h2>

        {success && <div className="panel-alert panel-alert-success">{success}</div>}
        {error && <div className="panel-alert panel-alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* Disable the entire form while saving */}
          <fieldset disabled={saving} style={{ border: "none", padding: 0 }}>
            <label>Name</label>
            <input name="name" value={form.name} onChange={handleChange} />

            <label>Gender</label>
            <select name="gender" value={form.gender} onChange={handleChange}>
              <option value="">Select</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>

            <label>Class</label>
            <select name="class_level" value={form.class_level} onChange={handleChange}>
              <option value="">Select</option>
              <option value="S1">S1</option>
              <option value="S2">S2</option>
              <option value="S3">S3</option>
              <option value="S4">S4</option>
            </select>

            <label>Stream</label>
            <select name="stream" value={form.stream} onChange={handleChange}>
              <option value="">Select</option>
              <option value="North">North</option>
              <option value="South">South</option>
            </select>

            <strong style={{ marginTop: "0.8rem", display: "block" }}>Optional Subjects</strong>
            {OPTIONAL_SUBJECTS.map((s) => (
              <label key={s} style={{ display: "flex", gap: "0.4rem" }}>
                <input
                  type="checkbox"
                  checked={form.subjects.includes(s)}
                  onChange={() => handleToggleSubject(s)}
                />
                {s}
              </label>
            ))}

            <div style={{ marginTop: "1rem", display: "flex", gap: "0.6rem" }}>
              <button type="submit" className="primary-btn" disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  // Prevent closing while saving
                  if (saving) return;
                  onClose && onClose();
                }}
              >
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}

export default EditStudentModal;
