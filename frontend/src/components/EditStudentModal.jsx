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

const formatDateForInput = (value) => {
  if (!value) return "";
  const raw = String(value).trim();
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
};

function EditStudentModal({ student, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "",
    gender: "",
    dob: "",
    class_level: "",
    stream: "",
    subjects: [],
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savedLearner, setSavedLearner] = useState(null);

  // synchronous submission lock to avoid race conditions
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!student) return;
    setForm({
      name: student.name || "",
      gender: student.gender || "",
      dob: formatDateForInput(student.dob),
      class_level: student.class_level || "",
      stream: student.stream || "",
      subjects: Array.isArray(student.subjects) ? student.subjects : [],
    });
    setError("");
    setSuccess("");
    setSavedLearner(null);
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
      setSavedLearner(updated);
      setSaving(false);
      submittingRef.current = false;

      // close modal after small delay so user sees success
      setTimeout(() => {
        onSaved && onSaved(updated);
        onClose && onClose();
      }, 1200);
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
    <div
      className="modal-backdrop"
      onClick={() => {
        if (saving) return;
        onClose && onClose();
      }}
    >
      <div
        className="modal-card learner-edit-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="learner-edit-header">
          <div>
            <span className="learner-edit-kicker">Learner Editor</span>
            <h2>Edit Learner</h2>
            <p>Refresh learner bio details and optional subjects without leaving the register.</p>
          </div>
          <button
            type="button"
            className="ghost-btn learner-edit-close"
            onClick={() => {
              if (saving) return;
              onClose && onClose();
            }}
          >
            Close
          </button>
        </div>

        {success && (
          <div className="learner-edit-success-card">
            <div className="learner-edit-success-icon">✓</div>
            <div className="learner-edit-success-copy">
              <strong>{success}</strong>
              <span>
                {savedLearner?.name || form.name || "Learner"} • {savedLearner?.class_level || form.class_level || "—"}{" "}
                {savedLearner?.stream || form.stream || "—"}
              </span>
            </div>
          </div>
        )}
        {error && <div className="panel-alert panel-alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* Disable the entire form while saving */}
          <fieldset disabled={saving} style={{ border: "none", padding: 0, margin: 0 }}>
            <div className="learner-edit-grid">
              <label className="learner-edit-field">
                <span>Name</span>
                <input name="name" value={form.name} onChange={handleChange} />
              </label>

              <label className="learner-edit-field">
                <span>Gender</span>
                <select name="gender" value={form.gender} onChange={handleChange}>
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </label>

              <label className="learner-edit-field">
                <span>Date of Birth</span>
                <input name="dob" type="date" value={form.dob} onChange={handleChange} />
              </label>

              <label className="learner-edit-field">
                <span>Class</span>
                <select name="class_level" value={form.class_level} onChange={handleChange}>
                  <option value="">Select Class</option>
                  <option value="S1">S1</option>
                  <option value="S2">S2</option>
                  <option value="S3">S3</option>
                  <option value="S4">S4</option>
                </select>
              </label>

              <label className="learner-edit-field">
                <span>Stream</span>
                <select name="stream" value={form.stream} onChange={handleChange}>
                  <option value="">Select Stream</option>
                  <option value="North">North</option>
                  <option value="South">South</option>
                </select>
              </label>
            </div>

            <div className="learner-edit-subject-shell">
              <div className="learner-edit-subject-head">
                <strong>Optional Subjects</strong>
                <small>Compulsory subjects remain attached automatically.</small>
              </div>

              <div className="learner-edit-subject-grid">
                {OPTIONAL_SUBJECTS.map((subjectName) => (
                  <label key={subjectName} className="learner-edit-subject-chip">
                    <input
                      type="checkbox"
                      checked={form.subjects.includes(subjectName)}
                      onChange={() => handleToggleSubject(subjectName)}
                    />
                    <span>{subjectName}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="learner-edit-actions">
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
