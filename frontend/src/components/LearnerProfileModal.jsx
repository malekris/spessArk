import { useEffect, useMemo, useRef } from "react";
import "./LearnerProfileModal.css";

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim().slice(0, 10);
  const date = new Date(`${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString("en-GB") : "Not recorded";
}

function getAge(value) {
  const dob = parseDate(value);
  if (!dob) return "Not recorded";

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const birthdayHasPassed =
    today.getMonth() > dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());

  if (!birthdayHasPassed) age -= 1;
  return age >= 0 ? `${age} years` : "Not recorded";
}

function getInitials(name) {
  const words = String(name || "Learner").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "LR";
}

function getStatus(student) {
  const active = String(student?.status || "active").trim().toLowerCase() === "active";
  return { active, label: active ? "Active learner" : "Paused learner" };
}

export default function LearnerProfileModal({ student, onClose, onEdit }) {
  const closeButtonRef = useRef(null);
  const subjects = useMemo(
    () => (Array.isArray(student?.subjects) ? student.subjects.filter(Boolean) : []),
    [student]
  );
  const status = getStatus(student);

  useEffect(() => {
    if (!student) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, student]);

  if (!student) return null;

  const details = [
    { label: "Gender", value: student.gender || "Not recorded" },
    { label: "Date of birth", value: formatDate(student.dob) },
    { label: "Age", value: getAge(student.dob) },
    { label: "Class", value: student.class_level || "Not assigned" },
    { label: "Stream", value: student.stream || "Not assigned" },
    { label: "Enrolled", value: formatDate(student.created_at) },
  ];

  return (
    <div
      className="learner-profile-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        className="learner-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="learner-profile-title"
      >
        <header className="learner-profile-topbar">
          <div>
            <span>Learner profile</span>
            <strong>School register record</strong>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="learner-profile-close"
            onClick={onClose}
            aria-label="Close learner profile"
            title="Close"
          >
            ×
          </button>
        </header>

        <div className="learner-profile-identity">
          <div className="learner-profile-avatar" aria-label="Placeholder learner avatar">
            <span>{getInitials(student.name)}</span>
            <i className={status.active ? "is-active" : "is-paused"} aria-hidden="true" />
          </div>
          <div className="learner-profile-heading">
            <div className="learner-profile-statusline">
              <span className={status.active ? "is-active" : "is-paused"}>{status.label}</span>
              <small>Record #{student.id || "—"}</small>
            </div>
            <h2 id="learner-profile-title">{student.name || "Unnamed learner"}</h2>
            <p>
              {[student.class_level, student.stream].filter(Boolean).join(" ") || "Class placement pending"}
              {` · ${subjects.length} registered ${subjects.length === 1 ? "subject" : "subjects"}`}
            </p>
          </div>
        </div>

        <dl className="learner-profile-details">
          {details.map((detail) => (
            <div key={detail.label}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>

        <div className="learner-profile-subjects">
          <div>
            <span>Registered subjects</span>
            <strong>{subjects.length}</strong>
          </div>
          {subjects.length > 0 ? (
            <ul>
              {subjects.map((subject) => <li key={subject}>{subject}</li>)}
            </ul>
          ) : (
            <p>No subjects are currently registered for this learner.</p>
          )}
        </div>

        <footer className="learner-profile-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>Close</button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              onClose?.();
              onEdit?.(student);
            }}
          >
            Edit Record
          </button>
        </footer>
      </section>
    </div>
  );
}
