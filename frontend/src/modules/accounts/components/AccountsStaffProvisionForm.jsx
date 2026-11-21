import { useState } from "react";
import { accountsRequest } from "../api";

export default function AccountsStaffProvisionForm({ onCreated }) {
  const [form, setForm] = useState({ name: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const submit = async (event) => {
    event.preventDefault();
    setMessage({ type: "", text: "" });
    try {
      setSaving(true);
      const body = await accountsRequest("/staff", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ name: "", email: "" });
      setMessage({ type: "success", text: body.message });
      await onCreated?.();
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Failed to create bursar account." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="accounts-staff-provision" onSubmit={submit}>
      <div className="accounts-staff-provision-copy">
        <span>Owner-controlled access</span>
        <strong>Create Bursar Account</strong>
        <p>The bursar will verify their email and create their own password.</p>
      </div>
      <label>
        <span>Full Name</span>
        <input
          type="text"
          autoComplete="name"
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          disabled={saving}
          required
        />
      </label>
      <label>
        <span>Email Address</span>
        <input
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          disabled={saving}
          required
        />
      </label>
      {message.text ? (
        <div className={`accounts-staff-provision-message is-${message.type}`} role="status">
          {message.text}
        </div>
      ) : null}
      <button type="submit" disabled={saving}>
        {saving ? "Creating Account..." : "Create Bursar Account"}
      </button>
    </form>
  );
}
