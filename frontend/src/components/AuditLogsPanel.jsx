import React, { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../lib/api";
import { loadPdfTools } from "../utils/loadPdfTools";

const DEFAULT_ENTITY_TYPES = ["login", "marks", "subject", "stream", "teacher", "system"];

const formatTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
};

export default function AuditLogsPanel() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionOptions, setActionOptions] = useState([]);
  const [entityTypeOptions, setEntityTypeOptions] = useState(DEFAULT_ENTITY_TYPES);

  const [filters, setFilters] = useState({
    userId: "",
    action: "",
    entityType: "",
    dateFrom: "",
    dateTo: "",
  });

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / Math.max(1, limit))),
    [total, limit]
  );

  const fetchLogs = async ({
    requestedPage = page,
    requestedLimit = limit,
    requestedFilters = filters,
  } = {}) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(requestedPage),
        limit: String(requestedLimit),
      });

      if (requestedFilters.userId.trim()) params.set("userId", requestedFilters.userId.trim());
      if (requestedFilters.action) params.set("action", requestedFilters.action);
      if (requestedFilters.entityType) params.set("entityType", requestedFilters.entityType);
      if (requestedFilters.dateFrom) params.set("dateFrom", `${requestedFilters.dateFrom} 00:00:00`);
      if (requestedFilters.dateTo) params.set("dateTo", `${requestedFilters.dateTo} 23:59:59`);

      const data = await adminFetch(`/api/admin/audit-logs?${params.toString()}`);
      setLogs(Array.isArray(data?.logs) ? data.logs : []);
      setTotal(Number(data?.total || 0));
      setActionOptions(
        Array.from(new Set((Array.isArray(data?.actions) ? data.actions : []).filter(Boolean))).sort()
      );
      setEntityTypeOptions(
        Array.from(
          new Set([
            ...DEFAULT_ENTITY_TYPES,
            ...(Array.isArray(data?.entityTypes) ? data.entityTypes : []),
          ].filter(Boolean))
        ).sort()
      );
    } catch (err) {
      console.error("Audit logs load error:", err);
      setError(err.message || "Failed to load audit logs.");
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit]);

  const applyFilters = () => {
    if (page === 1) {
      fetchLogs({ requestedPage: 1, requestedFilters: filters });
      return;
    }
    setPage(1);
  };

  const clearFilters = () => {
    const emptyFilters = {
      userId: "",
      action: "",
      entityType: "",
      dateFrom: "",
      dateTo: "",
    };
    setFilters(emptyFilters);

    if (page === 1) {
      fetchLogs({ requestedPage: 1, requestedFilters: emptyFilters });
      return;
    }
    setPage(1);
  };

  const handleExportPdf = async () => {
    if (!logs.length) return;

    const { jsPDF, autoTable } = await loadPdfTools();
    const doc = new jsPDF("l", "mm", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const generatedAt = new Date().toLocaleString();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("SPESS ARK — Audit Logs", pageWidth / 2, 14, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Generated: ${generatedAt}`, 14, 20);
    doc.text(`Page ${page} of ${totalPages} • Showing ${logs.length} rows`, pageWidth - 14, 20, {
      align: "right",
    });

    autoTable(doc, {
      startY: 26,
      margin: { left: 10, right: 10, bottom: 14 },
      head: [["Time", "User", "Role", "Action", "Description"]],
      body: logs.map((log) => [
        formatTime(log.createdAt),
        log.user || "—",
        String(log.role || "—").toUpperCase(),
        log.action || "—",
        log.description || "—",
      ]),
      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: 2.2,
        lineColor: [215, 221, 228],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [228, 236, 244],
        textColor: [31, 41, 55],
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 42 },
        1: { cellWidth: 42 },
        2: { cellWidth: 25, halign: "center" },
        3: { cellWidth: 38 },
        4: { cellWidth: "auto" },
      },
      didDrawPage: () => {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(`Generated from SPESS ARK • ${generatedAt}`, pageWidth / 2, pageHeight - 6, {
          align: "center",
        });
        doc.setTextColor(0);
      },
      theme: "grid",
    });

    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  };

  return (
    <div className="panel-card audit-log-panel">
      <div className="panel-card-header">
        <h3>Audit Logs</h3>
        <button type="button" className="ghost-btn" onClick={() => fetchLogs()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <div className="panel-alert panel-alert-error">{error}</div>}

      <div className="audit-log-filters">
        <input
          type="number"
          placeholder="Filter userId"
          className="audit-log-control"
          value={filters.userId}
          onChange={(e) => setFilters((p) => ({ ...p, userId: e.target.value }))}
        />
        <select
          className="audit-log-control audit-log-select"
          value={filters.action}
          onChange={(e) => setFilters((p) => ({ ...p, action: e.target.value }))}
        >
          <option value="">All actions</option>
          {actionOptions.map((action) => (
            <option key={action} value={action}>{action}</option>
          ))}
        </select>
        <select
          className="audit-log-control audit-log-select"
          value={filters.entityType}
          onChange={(e) => setFilters((p) => ({ ...p, entityType: e.target.value }))}
        >
          <option value="">All entity types</option>
          {entityTypeOptions.map((entityType) => (
            <option key={entityType} value={entityType}>{entityType}</option>
          ))}
        </select>
        <input
          type="date"
          className="audit-log-control"
          value={filters.dateFrom}
          onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))}
        />
        <input
          type="date"
          className="audit-log-control"
          value={filters.dateTo}
          onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))}
        />
      </div>

      <div className="audit-log-actions">
        <button type="button" className="primary-btn" onClick={applyFilters} disabled={loading}>
          Apply Filters
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={handleExportPdf}
          disabled={loading || logs.length === 0}
        >
          Export PDF
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={clearFilters}
          disabled={loading}
        >
          Clear
        </button>
        <div className="muted-text">Total records: {total}</div>
      </div>

      {loading && logs.length === 0 ? (
        <p className="muted-text">Loading logs…</p>
      ) : logs.length === 0 ? (
        <p className="muted-text">No logs found for selected filters.</p>
      ) : (
        <div className="teachers-table-wrapper">
          <table className="teachers-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatTime(log.createdAt)}</td>
                  <td>{log.user || "—"}</td>
                  <td>{String(log.role || "—").toUpperCase()}</td>
                  <td>{log.action || "—"}</td>
                  <td>{log.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="audit-log-footer">
        <div className="muted-text">Page {page} of {totalPages}</div>
        <div className="audit-log-pagination">
          <select
            className="audit-log-control audit-log-select audit-log-page-size"
            value={limit}
            onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <button type="button" className="ghost-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={loading || page <= 1}>
            Prev
          </button>
          <button type="button" className="ghost-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={loading || page >= totalPages}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
