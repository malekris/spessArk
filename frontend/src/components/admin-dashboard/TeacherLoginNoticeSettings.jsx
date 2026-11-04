import { useEffect, useState } from "react";
import { adminFetch } from "../../lib/api";
import "./TeacherLoginNoticeSettings.css";

const EMPTY_NOTICE = {
  enabled: false,
  title: "A message from Administration",
  message: "",
  version: "",
  updatedAt: null,
  acknowledgedCount: 0,
};

const formatUpdatedAt = (value) => {
  if (!value) return "Not published yet";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

export default function TeacherLoginNoticeSettings() {
  const [form, setForm] = useState(EMPTY_NOTICE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;

    adminFetch("/api/admin/teacher-login-notice")
      .then((settings) => {
        if (!active) return;
        setForm({ ...EMPTY_NOTICE, ...(settings || {}) });
      })
      .catch((err) => {
        if (active) setError(err.message || "Failed to load the teacher notice.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const saveNotice = async () => {
    if (form.enabled && !form.message.trim()) {
      setError("Enter the notice before publishing it.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const settings = await adminFetch("/api/admin/teacher-login-notice", {
        method: "PUT",
        body: {
          enabled: form.enabled,
          title: form.title,
          message: form.message,
        },
      });
      setForm({ ...EMPTY_NOTICE, ...(settings || {}) });
      setNotice(settings?.enabled ? "Teacher notice published." : "Teacher notice disabled.");
    } catch (err) {
      setError(err.message || "Failed to save the teacher notice.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="teacher-notice-admin-loading">Loading teacher notice…</div>;
  }

  return (
    <div className="teacher-notice-admin">
      <div className="teacher-notice-admin-head">
        <div>
          <span className="teacher-notice-admin-eyebrow">Teacher Login Notice</span>
          <h3>Message the staff room</h3>
        </div>
        <label className="teacher-notice-admin-switch">
          <input
            type="checkbox"
            checked={Boolean(form.enabled)}
            onChange={(event) =>
              setForm((current) => ({ ...current, enabled: event.target.checked }))
            }
          />
          <span className="teacher-notice-admin-switch-track" aria-hidden="true" />
          <span>{form.enabled ? "Publishing enabled" : "Notice disabled"}</span>
        </label>
      </div>

      <div className="teacher-notice-admin-meta">
        <span>
          <small>Status</small>
          <strong>{form.enabled ? "Live" : "Off"}</strong>
        </span>
        <span>
          <small>Acknowledged</small>
          <strong>{Number(form.acknowledgedCount || 0)} teachers</strong>
        </span>
        <span>
          <small>Last updated</small>
          <strong>{formatUpdatedAt(form.updatedAt)}</strong>
        </span>
      </div>

      {error && <div className="panel-alert panel-alert-error">{error}</div>}
      {notice && <div className="panel-alert panel-alert-success">{notice}</div>}

      <div className="teacher-notice-admin-fields">
        <label>
          <span>Heading</span>
          <input
            type="text"
            maxLength={140}
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({ ...current, title: event.target.value }))
            }
            placeholder="A message from Administration"
          />
          <small>{form.title.length}/140</small>
        </label>

        <label>
          <span>Message</span>
          <textarea
            maxLength={4000}
            rows={7}
            value={form.message}
            onChange={(event) =>
              setForm((current) => ({ ...current, message: event.target.value }))
            }
            placeholder="Write the message teachers should see after login."
          />
          <small>{form.message.length}/4000</small>
        </label>
      </div>

      <div className="teacher-notice-admin-preview" aria-label="Teacher notice preview">
        <span>Staff Notice</span>
        <h4>{form.title.trim() || "A message from Administration"}</h4>
        <p>{form.message.trim() || "Your teacher notice will appear here."}</p>
      </div>

      <div className="teacher-notice-admin-actions">
        <button type="button" className="primary-btn" onClick={saveNotice} disabled={saving}>
          {saving ? "Saving…" : form.enabled ? "Publish Notice" : "Save Disabled State"}
        </button>
      </div>
    </div>
  );
}
