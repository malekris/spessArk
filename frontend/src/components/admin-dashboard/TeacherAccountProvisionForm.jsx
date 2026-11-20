import React from "react";

/**
 * Admin-only teacher account provisioning.
 *
 * Teachers set their own password through the verified email-code flow, so an
 * administrator never needs to know or transport a teacher's password.
 */
export default function TeacherAccountProvisionForm({
  form,
  saving,
  onChange,
  onSubmit,
}) {
  return (
    <form className="teacher-form" onSubmit={onSubmit}>
      <div className="form-row">
        <label htmlFor="teacher-account-name">Teacher name</label>
        <input
          id="teacher-account-name"
          name="name"
          value={form.name}
          onChange={onChange}
          placeholder="e.g. Namale Sapphire"
          autoComplete="name"
          disabled={saving}
          required
        />
      </div>

      <div className="form-row">
        <label htmlFor="teacher-account-email">Teacher email</label>
        <input
          id="teacher-account-email"
          name="email"
          type="email"
          value={form.email}
          onChange={onChange}
          placeholder="teacher@school.com"
          autoComplete="email"
          disabled={saving}
          required
        />
      </div>

      <p className="muted-text" style={{ margin: "0.2rem 0 0.85rem", lineHeight: 1.55 }}>
        The teacher will receive an email and use the verified password-reset flow to create their password.
      </p>

      <button className="primary-btn" type="submit" disabled={saving}>
        {saving ? "Creating account..." : "Create Teacher Account"}
      </button>
    </form>
  );
}
