import { useCallback, useEffect, useState } from "react";
import { accountsRequest } from "../api";
import AccountsStaffManager from "./AccountsStaffManager";

const ACTION_LABELS = {
  ACCOUNTS_LOGIN: "Signed in",
  ACCOUNTS_REGISTRATION: "Requested bursar access",
  ACCOUNTS_STAFF_STATUS: "Changed bursar access",
  ACCOUNTS_PASSWORD_RESET: "Reset bursar password",
  ACCOUNTS_PASSWORD_CHANGE: "Changed bursar password",
  ACCOUNTS_PROFILE_PHOTO: "Updated profile photo",
  ACCOUNTS_UPDATE_FEE_SETTING: "Updated fee setup",
  ACCOUNTS_SAVE_PAYMENTS: "Saved learner payments",
};

const formatAction = (action) =>
  ACTION_LABELS[action] || String(action || "Accounts activity")
    .replace(/^ACCOUNTS_/, "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());

const formatAuditDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Kampala",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function AccountsAuditPanel({ isOwner = false }) {
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [lastLoginAt, setLastLoginAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAudit = useCallback(async (nextPage = 1) => {
    try {
      setLoading(true);
      setError("");
      const body = await accountsRequest(`/audit?page=${nextPage}&limit=30`);
      setLogs(body.logs || []);
      setPage(body.page || nextPage);
      setTotal(Number(body.total || 0));
      setTotalPages(Number(body.totalPages || 1));
      setLastLoginAt(body.lastLoginAt || null);
    } catch (auditError) {
      setError(auditError.message || "Failed to load Accounts activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudit(1);
  }, [loadAudit]);

  return (
    <section className="accounts-audit-panel" aria-labelledby="accounts-audit-title">
      {isOwner ? <AccountsStaffManager onChanged={() => loadAudit(1)} /> : null}
      <div className="accounts-audit-header">
        <div>
          <span>Protected history</span>
          <h2 id="accounts-audit-title">Accounts Audit</h2>
          <p>Every bursar sign-in and financial save is recorded here.</p>
        </div>
        <button type="button" onClick={() => loadAudit(page)} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="accounts-audit-summary" aria-label="Audit summary">
        <div><span>Recorded actions</span><strong>{total}</strong></div>
        <div><span>Latest sign-in</span><strong>{lastLoginAt ? formatAuditDate(lastLoginAt) : "No sign-in recorded"}</strong></div>
      </div>

      {error ? <div className="accounts-audit-error" role="alert">{error}</div> : null}

      {loading && !logs.length ? (
        <div className="accounts-empty-state">Loading Accounts activity...</div>
      ) : logs.length ? (
        <div className="accounts-audit-list">
          {logs.map((log) => (
            <article key={log.id} className="accounts-audit-entry">
              <div className={`accounts-audit-mark is-${String(log.action || "").replace("ACCOUNTS_", "").toLowerCase()}`} aria-hidden="true" />
              <div className="accounts-audit-entry-copy">
                <div>
                  <strong>{formatAction(log.action)}</strong>
                  <time dateTime={log.createdAt}>{formatAuditDate(log.createdAt)}</time>
                </div>
                <p>{log.description || "Accounts activity recorded."}</p>
                <small className="accounts-audit-actor"><strong>{log.actor || "Bursar"}</strong>{log.ipAddress ? ` · ${log.ipAddress}` : ""}</small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="accounts-empty-state">No SPESS Accounts activity has been recorded yet.</div>
      )}

      {totalPages > 1 ? (
        <div className="accounts-audit-pagination" aria-label="Audit pages">
          <button type="button" onClick={() => loadAudit(page - 1)} disabled={loading || page <= 1}>Previous</button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" onClick={() => loadAudit(page + 1)} disabled={loading || page >= totalPages}>Next</button>
        </div>
      ) : null}
    </section>
  );
}
