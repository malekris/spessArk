import { useEffect, useState } from "react";
import { adminFetch } from "../../lib/api";
import { formatActionLabel, formatCardDateTime } from "./dashboardCardUtils";

export default function RecentAdminActivityCard({ academicYear, onOpenAuditLog }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadRecentActivity = async () => {
      setLoading(true);
      setError("");

      try {
        // The role filter is handled by the existing paginated audit endpoint,
        // so busy teacher submissions cannot bury recent admin decisions.
        const params = new URLSearchParams({
          page: "1",
          limit: "5",
          role: "admin",
          dateFrom: `${academicYear}-01-01 00:00:00`,
          dateTo: `${academicYear}-12-31 23:59:59`,
        });
        const data = await adminFetch(`/api/admin/audit-logs?${params.toString()}`);
        if (active) setRows(Array.isArray(data?.logs) ? data.logs : []);
      } catch (requestError) {
        if (active) {
          setRows([]);
          setError(requestError.message || "Recent admin activity could not be loaded.");
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadRecentActivity();
    return () => {
      active = false;
    };
  }, [academicYear]);

  return (
    <article className="admin-pulse-card admin-pulse-card-activity">
      <header className="admin-pulse-card-header">
        <div>
          <h3>Recent Admin Activity</h3>
          <p>The latest administrator actions recorded in the audit trail.</p>
        </div>
        <span className="admin-pulse-badge">{loading ? "Loading" : `${rows.length} recent`}</span>
      </header>

      {error ? (
        <div className="admin-pulse-error">{error}</div>
      ) : loading ? (
        <div className="admin-pulse-empty">Reading the latest administrator activity…</div>
      ) : rows.length ? (
        <div className="admin-pulse-list">
          {rows.slice(0, 4).map((row) => (
            <div className="admin-pulse-row" key={row.id} title={row.description || row.action}>
              <div>
                <strong>{row.description || formatActionLabel(row.action)}</strong>
                <small>{formatActionLabel(row.action)}</small>
              </div>
              <span className="admin-pulse-row-value">{formatCardDateTime(row.createdAt)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="admin-pulse-empty">No administrator actions were recorded for {academicYear}.</div>
      )}

      <button type="button" className="admin-pulse-card-action" onClick={onOpenAuditLog}>
        Open complete audit log
      </button>
    </article>
  );
}

