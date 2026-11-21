import { useCallback, useEffect, useState } from "react";
import { accountsRequest } from "../api";
import AccountsStaffProvisionForm from "./AccountsStaffProvisionForm";

const formatDate = (value) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Kampala",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function AccountsStaffManager({ onChanged }) {
  const [staff, setStaff] = useState([]);
  const [summary, setSummary] = useState({ pending: 0, active: 0 });
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [error, setError] = useState("");

  const loadStaff = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const body = await accountsRequest("/staff");
      setStaff(body.staff || []);
      setSummary(body.summary || { pending: 0, active: 0 });
    } catch (staffError) {
      setError(staffError.message || "Failed to load bursar access.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const updateStatus = async (staffId, status) => {
    try {
      setUpdatingId(staffId);
      setError("");
      await accountsRequest(`/staff/${staffId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadStaff();
      onChanged?.();
    } catch (staffError) {
      setError(staffError.message || "Failed to update bursar access.");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <section className="accounts-staff-manager" aria-labelledby="accounts-staff-title">
      <div className="accounts-staff-heading">
        <div>
          <span>Owner oversight</span>
          <h3 id="accounts-staff-title">Bursar Access</h3>
        </div>
        <div className="accounts-staff-counts">
          <span>{summary.pending} pending</span>
          <span>{summary.active} active</span>
        </div>
      </div>

      <AccountsStaffProvisionForm
        onCreated={async () => {
          await loadStaff();
          onChanged?.();
        }}
      />

      {error ? <div className="accounts-audit-error" role="alert">{error}</div> : null}
      {loading && !staff.length ? (
        <div className="accounts-empty-state">Loading bursar accounts...</div>
      ) : staff.length ? (
        <div className="accounts-staff-list">
          {staff.map((member) => {
            const busy = Number(updatingId) === Number(member.id);
            return (
              <article key={member.id} className="accounts-staff-card">
                <div className="accounts-staff-identity">
                  <span className="accounts-staff-avatar" aria-hidden="true">
                    {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : String(member.name || "B").trim().slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{member.name}</strong>
                    <small>{member.email}</small>
                  </div>
                  <span className={`accounts-staff-status is-${member.status}`}>{member.status}</span>
                </div>
                <div className="accounts-staff-meta">
                  <span>Registered <strong>{formatDate(member.createdAt)}</strong></span>
                  <span>Last login <strong>{formatDate(member.lastLoginAt)}</strong></span>
                </div>
                <div className="accounts-staff-actions">
                  {member.status !== "active" ? (
                    <button type="button" className="is-approve" disabled={busy} onClick={() => updateStatus(member.id, "active")}>Approve</button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => updateStatus(member.id, "suspended")}>Suspend</button>
                  )}
                  {member.status === "pending" ? (
                    <button type="button" className="is-reject" disabled={busy} onClick={() => updateStatus(member.id, "rejected")}>Reject</button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="accounts-empty-state">No bursar accounts have been created yet.</div>
      )}
    </section>
  );
}
