import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch, getAdminHeaders } from "../lib/api";
import {
  DEFAULT_SCHOOL_CALENDAR,
  getSchoolCalendarBadge,
  normalizeSchoolCalendar,
  toLocalDateKey,
} from "../utils/schoolCalendar";
import ParentBatchReportRelease from "./parent-portal/ParentBatchReportRelease";
import "./SpessParentsPanel.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const TABS = [
  { id: "accounts", label: "Parent Accounts" },
  { id: "matching", label: "Learner Matching" },
  { id: "reports", label: "Release Reports" },
  { id: "circulars", label: "Publish Circulars" },
];
const formatDateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const termNumberFromLabel = (value) => {
  const label = String(value || "").toLowerCase();
  if (/\b(term\s*3|iii|3)\b/.test(label)) return 3;
  if (/\b(term\s*2|ii|2)\b/.test(label)) return 2;
  if (/\b(term\s*1|i|1)\b/.test(label)) return 1;
  return null;
};

const getCalendarReleasePeriod = (calendar, date = new Date()) => {
  const normalized = normalizeSchoolCalendar(calendar || DEFAULT_SCHOOL_CALENDAR);
  const badge = getSchoolCalendarBadge(normalized, date);
  let termNumber = termNumberFromLabel(badge.termLabel);

  // During a holiday, release the term that just ended. Outside a configured
  // window, use the latest term that has already started.
  if (!termNumber) {
    const today = toLocalDateKey(date);
    const latestStartedTerm = normalized.entries
      .filter((entry) => /^term[123]$/.test(entry.key) && entry.from && entry.from <= today)
      .at(-1);
    termNumber = termNumberFromLabel(latestStartedTerm?.label) || 1;
  }

  return {
    academicYear: Number(normalized.academicYear) || date.getFullYear(),
    term: `Term ${termNumber}`,
  };
};

const defaultCircularForm = (period = getCalendarReleasePeriod(DEFAULT_SCHOOL_CALENDAR)) => ({
  title: "",
  description: "",
  academicYear: period.academicYear,
  term: period.term,
  audienceScope: "ALL_PARENTS",
  file: null,
});

export default function SpessParentsPanel({ onClose }) {
  const [activeTab, setActiveTab] = useState("accounts");
  const [overview, setOverview] = useState({ counts: {}, accounts: [], storageReady: false });
  const [learners, setLearners] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [selectedParentId, setSelectedParentId] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [learnerQuery, setLearnerQuery] = useState("");
  const [learnerLevel, setLearnerLevel] = useState("all");
  const [relationship, setRelationship] = useState("Parent / Guardian");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [releasePeriod, setReleasePeriod] = useState(() => getCalendarReleasePeriod(DEFAULT_SCHOOL_CALENDAR));
  const [circularForm, setCircularForm] = useState(defaultCircularForm);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadPanel = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [overviewData, learnerRows, documentRows] = await Promise.all([
        adminFetch("/api/admin/parents/overview"),
        adminFetch("/api/admin/parents/learners"),
        adminFetch("/api/admin/parents/documents"),
      ]);
      setOverview(overviewData || { counts: {}, accounts: [], storageReady: false });
      setLearners(Array.isArray(learnerRows) ? learnerRows : []);
      setDocuments(Array.isArray(documentRows) ? documentRows : []);
    } catch (err) {
      setError(err.message || "SPESS Parents information could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPanel();
  }, [loadPanel]);

  useEffect(() => {
    let active = true;
    adminFetch("/api/admin/school-calendar")
      .then((calendar) => {
        if (!active) return;
        const period = getCalendarReleasePeriod(calendar);
        setReleasePeriod(period);
        setCircularForm((current) => ({ ...current, ...period }));
      })
      .catch((err) => {
        console.error("SPESS Parents calendar defaults could not be loaded:", err);
      });

    return () => {
      active = false;
    };
  }, []);

  const accounts = useMemo(
    () => (Array.isArray(overview.accounts) ? overview.accounts : []),
    [overview.accounts]
  );
  useEffect(() => {
    if (!accounts.length) {
      setSelectedParentId("");
      return;
    }
    if (!accounts.some((account) => String(account.id) === String(selectedParentId))) {
      setSelectedParentId(String(accounts[0].id));
    }
  }, [accounts, selectedParentId]);

  const selectedParent = useMemo(
    () => accounts.find((account) => String(account.id) === String(selectedParentId)) || null,
    [accounts, selectedParentId]
  );
  const filteredAccounts = useMemo(
    () => accounts.filter((account) => accountFilter === "all" || account.status === accountFilter),
    [accountFilter, accounts]
  );
  const filteredLearners = useMemo(() => {
    const query = learnerQuery.trim().toLowerCase();
    return learners
      .filter((learner) => learnerLevel === "all" || learner.learner_level === learnerLevel)
      .filter((learner) => !query || `${learner.learner_name} ${learner.class_level} ${learner.stream}`.toLowerCase().includes(query))
      .slice(0, 80);
  }, [learnerLevel, learnerQuery, learners]);
  const runAction = async (key, action) => {
    setBusyKey(key);
    setNotice("");
    setError("");
    try {
      const result = await action();
      setNotice(result?.message || "Action completed successfully.");
      await loadPanel();
    } catch (err) {
      setError(err.message || "The action could not be completed.");
    } finally {
      setBusyKey("");
    }
  };

  const updateAccountStatus = (parentId, status) =>
    runAction(`status-${parentId}-${status}`, () =>
      adminFetch(`/api/admin/parents/accounts/${parentId}/status`, {
        method: "PATCH",
        body: { status },
      })
    );

  const resetParentPassword = () => {
    if (!selectedParent || temporaryPassword.length < 8) {
      setError("Choose a parent and enter a temporary password of at least 8 characters.");
      return;
    }
    runAction(`password-${selectedParent.id}`, async () => {
      const result = await adminFetch(`/api/admin/parents/accounts/${selectedParent.id}/reset-password`, {
        method: "POST",
        body: { temporaryPassword },
      });
      setTemporaryPassword("");
      return result;
    });
  };

  const linkLearner = (learner) => {
    if (!selectedParent) {
      setError("Choose a parent account before matching a learner.");
      return;
    }
    runAction(`link-${learner.learner_level}-${learner.id}`, () =>
      adminFetch(`/api/admin/parents/accounts/${selectedParent.id}/links`, {
        method: "POST",
        body: {
          learnerLevel: learner.learner_level,
          learnerId: learner.id,
          relationship,
        },
      })
    );
  };

  const unlinkLearner = (linkId) =>
    runAction(`unlink-${linkId}`, () =>
      adminFetch(`/api/admin/parents/links/${linkId}`, { method: "DELETE" })
    );

  const submitCircularDocument = async (event) => {
    event.preventDefault();
    const form = circularForm;
    if (!form.file) {
      setError("Choose the approved PDF before releasing it.");
      return;
    }

    const payload = new FormData();
    payload.append("documentType", "CIRCULAR");
    payload.append("title", form.title);
    payload.append("description", form.description);
    payload.append("academicYear", String(form.academicYear));
    payload.append("term", form.term);
    payload.append("file", form.file);

    payload.append("audienceScope", form.audienceScope);

    await runAction("upload-CIRCULAR", async () => {
      const result = await adminFetch("/api/admin/parents/documents", {
        method: "POST",
        body: payload,
      });
      setCircularForm(defaultCircularForm(releasePeriod));
      return result;
    });
  };

  const revokeDocument = (documentId) =>
    runAction(`revoke-${documentId}`, () =>
      adminFetch(`/api/admin/parents/documents/${documentId}/revoke`, { method: "PATCH" })
    );

  const openAdminDocument = async (documentId) => {
    setBusyKey(`open-${documentId}`);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/parents/documents/${documentId}/file`, {
        headers: getAdminHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Document could not be opened.");
      }
      const blobUrl = URL.createObjectURL(await res.blob());
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 90_000);
    } catch (err) {
      setError(err.message || "Document could not be opened.");
    } finally {
      setBusyKey("");
    }
  };

  const recentDocuments = documents.slice(0, 100);

  return (
    <section className="spess-parents-admin-panel">
      <header className="spess-parents-admin-header">
        <div>
          <span>Secure family delivery</span>
          <h2>SPESS Parents</h2>
          <p>Approve parent accounts, match learners, and control every report or circular release.</p>
        </div>
        <button className="panel-close" type="button" onClick={onClose}>Close</button>
      </header>

      <div className="spess-parents-admin-kpis">
        <div><span>Pending</span><strong>{overview.counts?.pending || 0}</strong></div>
        <div><span>Active Parents</span><strong>{overview.counts?.active || 0}</strong></div>
        <div><span>Released Reports</span><strong>{overview.counts?.releasedReports || 0}</strong></div>
        <div><span>Circulars</span><strong>{overview.counts?.releasedCirculars || 0}</strong></div>
        <div className={overview.storageReady ? "is-ready" : "is-warning"}>
          <span>Private Storage</span><strong>{overview.storageReady ? "Ready" : "Check R2"}</strong>
        </div>
      </div>

      <nav className="spess-parents-admin-tabs" aria-label="SPESS Parents management">
        {TABS.map((tab) => (
          <button key={tab.id} type="button" className={activeTab === tab.id ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {notice && <div className="spess-parents-admin-message is-success" role="status">{notice}</div>}
      {error && <div className="spess-parents-admin-message is-error" role="alert">{error}</div>}
      {loading && <div className="spess-parents-admin-loading">Loading SPESS Parents records...</div>}

      {!loading && activeTab === "accounts" && (
        <div className="spess-parents-admin-section">
          <div className="spess-parents-toolbar">
            <div>
              <h3>Parent Accounts</h3>
              <p>New registrations remain blocked until you approve them.</p>
            </div>
            <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="all">All accounts</option>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div className="spess-parents-account-list">
            {filteredAccounts.map((account) => (
              <article key={account.id} className="spess-parents-account-row">
                <div className={`spess-parents-status-dot is-${account.status}`} aria-hidden="true" />
                <div className="spess-parents-account-copy">
                  <h4>{account.display_name}</h4>
                  <span>{account.phone_e164} · Registered {formatDateTime(account.created_at)}</span>
                  <small>{account.links?.filter((link) => Number(link.active) === 1).length || 0} linked learners</small>
                </div>
                <span className={`spess-parents-status-label is-${account.status}`}>{account.status}</span>
                <div className="spess-parents-row-actions">
                  {account.status !== "active" && <button type="button" onClick={() => updateAccountStatus(account.id, "active")} disabled={Boolean(busyKey)}>Approve</button>}
                  {account.status === "active" && <button type="button" className="is-danger" onClick={() => updateAccountStatus(account.id, "suspended")} disabled={Boolean(busyKey)}>Suspend</button>}
                  {account.status === "pending" && <button type="button" className="is-danger" onClick={() => updateAccountStatus(account.id, "rejected")} disabled={Boolean(busyKey)}>Reject</button>}
                </div>
              </article>
            ))}
            {!filteredAccounts.length && <div className="spess-parents-empty">No parent accounts match this filter.</div>}
          </div>

          <div className="spess-parents-recovery-box">
            <div>
              <span>Access Recovery</span>
              <strong>Issue a temporary parent password</strong>
            </div>
            <select value={selectedParentId} onChange={(event) => setSelectedParentId(event.target.value)}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.display_name} · {account.phone_e164}</option>)}
            </select>
            <input type="password" placeholder="Temporary password" minLength={8} value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} />
            <button type="button" onClick={resetParentPassword} disabled={Boolean(busyKey)}>Save Temporary Password</button>
          </div>
        </div>
      )}

      {!loading && activeTab === "matching" && (
        <div className="spess-parents-admin-section">
          <div className="spess-parents-match-controls">
            <label><span>Parent Account</span><select value={selectedParentId} onChange={(event) => setSelectedParentId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.display_name} · {account.status}</option>)}</select></label>
            <label><span>Relationship</span><select value={relationship} onChange={(event) => setRelationship(event.target.value)}><option>Parent / Guardian</option><option>Mother</option><option>Father</option><option>Guardian</option><option>Sponsor</option></select></label>
            <label><span>Level</span><select value={learnerLevel} onChange={(event) => setLearnerLevel(event.target.value)}><option value="all">O-Level and A-Level</option><option value="O_LEVEL">O-Level</option><option value="A_LEVEL">A-Level</option></select></label>
            <label className="is-wide"><span>Find Learner</span><input type="search" placeholder="Search name, class or stream" value={learnerQuery} onChange={(event) => setLearnerQuery(event.target.value)} /></label>
          </div>

          {selectedParent && (
            <div className="spess-parents-linked-list">
              <div className="spess-parents-subheading"><strong>Linked to {selectedParent.display_name}</strong><span>{selectedParent.links?.filter((link) => Number(link.active) === 1).length || 0} active</span></div>
              <div>
                {(selectedParent.links || []).filter((link) => Number(link.active) === 1).map((link) => (
                  <span key={link.id} className="spess-parents-linked-chip">
                    {link.learner_name} · {link.class_level} {link.stream}
                    <button type="button" aria-label={`Remove ${link.learner_name}`} onClick={() => unlinkLearner(link.id)} disabled={Boolean(busyKey)}>×</button>
                  </span>
                ))}
                {!selectedParent.links?.some((link) => Number(link.active) === 1) && <span className="spess-parents-empty-inline">No learner is linked yet.</span>}
              </div>
            </div>
          )}

          <div className="spess-parents-learner-results">
            {filteredLearners.map((learner) => {
              const alreadyLinked = selectedParent?.links?.some((link) => Number(link.active) === 1 && link.learner_level === learner.learner_level && Number(link.learner_id) === Number(learner.id));
              return (
                <article key={`${learner.learner_level}:${learner.id}`}>
                  <div><span>{learner.learner_level === "A_LEVEL" ? "A-Level" : "O-Level"}</span><h4>{learner.learner_name}</h4><p>{learner.class_level} {learner.stream} · {learner.learner_status}</p></div>
                  <button type="button" onClick={() => linkLearner(learner)} disabled={alreadyLinked || Boolean(busyKey)}>{alreadyLinked ? "Linked" : "Link Learner"}</button>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {!loading && activeTab === "reports" && (
        <div className="spess-parents-admin-section spess-parents-release-layout spess-parents-release-layout--batch">
          <ParentBatchReportRelease
            storageReady={overview.storageReady}
            releasePeriod={releasePeriod}
            onReleaseComplete={loadPanel}
            setNotice={setNotice}
            setError={setError}
          />
          <DocumentRegister documents={recentDocuments.filter((document) => document.document_type === "REPORT")} busyKey={busyKey} onOpen={openAdminDocument} onRevoke={revokeDocument} />
        </div>
      )}

      {!loading && activeTab === "circulars" && (
        <div className="spess-parents-admin-section spess-parents-release-layout">
          <form className="spess-parents-release-form" onSubmit={submitCircularDocument}>
            <div className="spess-parents-subheading"><strong>Publish a school circular</strong><span>Private PDF delivery</span></div>
            <label><span>Circular Title</span><input value={circularForm.title} onChange={(event) => setCircularForm((current) => ({ ...current, title: event.target.value }))} required /></label>
            <label><span>Summary</span><textarea rows={4} value={circularForm.description} onChange={(event) => setCircularForm((current) => ({ ...current, description: event.target.value }))} required /></label>
            <div className="spess-parents-form-grid"><label><span>Academic Year</span><input type="number" value={circularForm.academicYear} onChange={(event) => setCircularForm((current) => ({ ...current, academicYear: event.target.value }))} required /></label><label><span>Term</span><select value={circularForm.term} onChange={(event) => setCircularForm((current) => ({ ...current, term: event.target.value }))}><option>Term 1</option><option>Term 2</option><option>Term 3</option><option>General</option></select></label></div>
            <label><span>Audience</span><select value={circularForm.audienceScope} onChange={(event) => setCircularForm((current) => ({ ...current, audienceScope: event.target.value }))}><option value="ALL_PARENTS">All Approved Parents</option><option value="O_LEVEL">O-Level Parents</option><option value="A_LEVEL">A-Level Parents</option></select></label>
            <label className="spess-parents-file-field"><span>Circular PDF</span><input type="file" accept="application/pdf,.pdf" onChange={(event) => setCircularForm((current) => ({ ...current, file: event.target.files?.[0] || null }))} required /><strong>{circularForm.file?.name || "No PDF selected"}</strong></label>
            <button type="submit" disabled={Boolean(busyKey) || !overview.storageReady}>{busyKey === "upload-CIRCULAR" ? "Publishing..." : "Publish Circular"}</button>
          </form>
          <DocumentRegister documents={recentDocuments.filter((document) => document.document_type === "CIRCULAR")} busyKey={busyKey} onOpen={openAdminDocument} onRevoke={revokeDocument} />
        </div>
      )}
    </section>
  );
}

function DocumentRegister({ documents, busyKey, onOpen, onRevoke }) {
  return (
    <div className="spess-parents-document-register">
      <div className="spess-parents-subheading"><strong>Release Register</strong><span>{documents.length} documents</span></div>
      <div>
        {documents.map((document) => (
          <article key={document.id}>
            <div className="spess-parents-document-register-copy">
              <span>{document.document_type} · {document.term || "General"} {document.academic_year || ""}</span>
              <h4>{document.title}</h4>
              <p>{document.learner_name_snapshot || document.audience_scope?.replaceAll("_", " ")} · {formatBytes(document.file_size)}</p>
              <small>{document.status} · {formatDateTime(document.released_at)}</small>
            </div>
            <div className="spess-parents-row-actions">
              <button type="button" onClick={() => onOpen(document.id)} disabled={Boolean(busyKey)}>{busyKey === `open-${document.id}` ? "Opening..." : "Preview"}</button>
              {document.status === "released" && <button type="button" className="is-danger" onClick={() => onRevoke(document.id)} disabled={Boolean(busyKey)}>Revoke</button>}
            </div>
          </article>
        ))}
        {!documents.length && <div className="spess-parents-empty">No documents have been released in this section.</div>}
      </div>
    </div>
  );
}
