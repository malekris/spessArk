import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  accountsRequest,
  clearAccountsAuth,
  getAccountsToken,
  getAccountsUser,
  setAccountsUser,
} from "../api";
import AccountsAuditPanel from "../components/AccountsAuditPanel";
import AccountsBursarActivitySummary from "../components/AccountsBursarActivitySummary";
import AccountsCorrectionAlerts from "../components/AccountsCorrectionAlerts";
import AccountsFundsSummary from "../components/AccountsFundsSummary";
import AccountsLearnerHistoryModal from "../components/AccountsLearnerHistoryModal";
import AccountsOutstandingBalances from "../components/AccountsOutstandingBalances";
import AccountsPortalNav from "../components/AccountsPortalNav";
import AccountsProfileSettings from "../components/AccountsProfileSettings";
import AccountsRecentTransactions from "../components/AccountsRecentTransactions";
import AccountsRegisterPdfButton from "../components/AccountsRegisterPdfButton";
import AccountsTodayCollections from "../components/AccountsTodayCollections";
import AccountsTransactionSearch from "../components/AccountsTransactionSearch";
import { matchesLearnerSearch } from "../learnerSearch";
import { formatMoneyInput, normalizeMoneyInput } from "../moneyInput";
import "../AccountsPortal.css";

const currentYear = new Date().getFullYear();
const defaultTerm = new Date().getMonth() >= 8 ? "Term 3" : new Date().getMonth() >= 4 ? "Term 2" : "Term 1";
const moneyFormatter = new Intl.NumberFormat("en-UG", {
  style: "currency",
  currency: "UGX",
  maximumFractionDigits: 0,
});

const formatMoney = (value) => moneyFormatter.format(Number(value || 0));
const formatSavedAt = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Kampala",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function AccountsDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getAccountsUser());
  const isOwner = ["accounts_owner", "accounts_admin"].includes(user?.role);
  const isBursar = user?.role === "accounts_bursar";
  const firstName = String(user?.name || "Bursar").trim().split(/\s+/)[0] || "Bursar";
  const initials = String(user?.name || "Bursar")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("") || "B";
  const [meta, setMeta] = useState({ classes: [], terms: ["Term 1", "Term 2", "Term 3"] });
  const [filters, setFilters] = useState({ classLevel: "", stream: "", term: defaultTerm, year: currentYear });
  const [rows, setRows] = useState([]);
  const [feeForm, setFeeForm] = useState({ day: "", boarding: "" });
  const [feeConfigured, setFeeConfigured] = useState(false);
  const [dirtyIds, setDirtyIds] = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingRegister, setLoadingRegister] = useState(false);
  const [savingFees, setSavingFees] = useState(false);
  const [savingPayments, setSavingPayments] = useState(false);
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0);
  const [learnerQuery, setLearnerQuery] = useState("");
  const [activeView, setActiveView] = useState(null);
  const [selectedLearner, setSelectedLearner] = useState(null);
  const [notice, setNotice] = useState({ type: "", text: "" });

  useEffect(() => {
    document.title = "SPESS Accounts";
    if (!getAccountsToken()) navigate("/ark/accounts-login", { replace: true });
  }, [navigate]);

  useEffect(() => {
    let active = true;
    accountsRequest("/meta")
      .then((body) => {
        if (!active) return;
        setMeta(body);
        const firstClass = body.classes?.[0];
        setFilters((current) => ({
          ...current,
          classLevel: current.classLevel || firstClass?.class_level || "",
          stream: current.stream || firstClass?.streams?.[0] || "",
        }));
      })
      .catch((error) => {
        if (error.status === 401 || error.status === 403) {
          clearAccountsAuth();
          navigate("/ark/accounts-login", { replace: true });
          return;
        }
        setNotice({ type: "error", text: error.message });
      })
      .finally(() => active && setLoadingMeta(false));
    return () => { active = false; };
  }, [navigate]);

  const classStreams = useMemo(
    () => meta.classes.find((item) => item.class_level === filters.classLevel)?.streams || [],
    [filters.classLevel, meta.classes]
  );

  const loadRegister = useCallback(async () => {
    if (!filters.classLevel || !filters.stream || !filters.term || !filters.year) return;
    try {
      setLoadingRegister(true);
      setNotice({ type: "", text: "" });
      const params = new URLSearchParams({
        class_level: filters.classLevel,
        stream: filters.stream,
        term: filters.term,
        year: String(filters.year),
      });
      const body = await accountsRequest(`/learners?${params.toString()}`);
      setRows((body.learners || []).map((row) => ({
        ...row,
        residence_type: row.residence_type || "Day",
        amount_paid: row.amount_paid === null || row.amount_paid === undefined ? "" : String(row.amount_paid),
      })));
      setFeeConfigured(Boolean(body.fee_setting));
      setFeeForm({
        day: body.fee_setting?.day_amount == null ? "" : String(body.fee_setting.day_amount),
        boarding: body.fee_setting?.boarding_amount == null ? "" : String(body.fee_setting.boarding_amount),
      });
      setDirtyIds([]);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        clearAccountsAuth();
        navigate("/ark/accounts-login", { replace: true });
        return;
      }
      setNotice({ type: "error", text: error.message });
      setRows([]);
    } finally {
      setLoadingRegister(false);
    }
  }, [filters, navigate]);

  useEffect(() => {
    loadRegister();
  }, [loadRegister]);

  const updateFilter = (key, value) => {
    setFilters((current) => {
      if (key === "classLevel") {
        const streams = meta.classes.find((item) => item.class_level === value)?.streams || [];
        return { ...current, classLevel: value, stream: streams[0] || "" };
      }
      return { ...current, [key]: value };
    });
  };

  const markDirty = (learnerId) => {
    setDirtyIds((current) => current.includes(learnerId) ? current : [...current, learnerId]);
  };

  const updateRow = (learnerId, patch) => {
    setRows((current) => current.map((row) => Number(row.id) === Number(learnerId) ? { ...row, ...patch } : row));
    markDirty(Number(learnerId));
  };

  const saveFees = async () => {
    try {
      setSavingFees(true);
      setNotice({ type: "", text: "" });
      await accountsRequest("/fee-settings", {
        method: "PUT",
        body: JSON.stringify({
          class_level: filters.classLevel,
          stream: filters.stream,
          term: filters.term,
          year: Number(filters.year),
          day_amount: feeForm.day,
          boarding_amount: feeForm.boarding,
        }),
      });
      setFeeConfigured(true);
      setNotice({ type: "success", text: `${filters.classLevel} ${filters.stream} fee setup saved.` });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSavingFees(false);
    }
  };

  const savePayments = async () => {
    const dirtyRows = rows.filter((row) => dirtyIds.includes(Number(row.id)));
    if (!dirtyRows.length) {
      setNotice({ type: "info", text: "No learner account changes are waiting to be saved." });
      return;
    }
    try {
      setSavingPayments(true);
      setNotice({ type: "", text: "" });
      const body = await accountsRequest("/payments/batch", {
        method: "PUT",
        body: JSON.stringify({
          class_level: filters.classLevel,
          stream: filters.stream,
          term: filters.term,
          year: Number(filters.year),
          rows: dirtyRows.map((row) => ({
            learner_id: row.id,
            residence_type: row.residence_type,
            amount_paid: row.amount_paid,
          })),
        }),
      });
      setNotice({ type: "success", text: `${body.saved} learner account row${body.saved === 1 ? "" : "s"} saved.` });
      await loadRegister();
      setSummaryRefreshKey((current) => current + 1);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSavingPayments(false);
    }
  };

  const totals = useMemo(() => ({
    learners: rows.length,
    recorded: rows.filter((row) => row.amount_paid !== "").length,
    paid: rows.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0),
  }), [rows]);

  const visibleRows = useMemo(() => {
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => matchesLearnerSearch(row.learner_name, learnerQuery));
  }, [learnerQuery, rows]);

  const latestPaymentSave = useMemo(() => rows.reduce((latest, row) => {
    if (!row.payment_updated_at || !row.payment_updated_by) return latest;
    const timestamp = new Date(row.payment_updated_at).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= Number(latest?.timestamp || 0)) return latest;
    return {
      timestamp,
      savedBy: row.payment_updated_by,
      savedAt: row.payment_updated_at,
    };
  }, null), [rows]);

  const expectedFor = (row) => Number(row.residence_type === "Boarding" ? feeForm.boarding : feeForm.day) || 0;

  const changePortalView = (nextView) => {
    if (activeView === "quick-entry" && nextView !== "quick-entry" && dirtyIds.length) {
      setNotice({
        type: "info",
        text: "Save the pending learner changes before closing Quick Entry.",
      });
      return;
    }
    setActiveView(nextView);
  };

  const updateProfile = (nextUser) => {
    setUser(nextUser);
    setAccountsUser(nextUser);
  };

  return (
    <main className="accounts-app">
      <header className="accounts-app-header">
        <div className="accounts-app-brand">
          <div className="accounts-brand-mark" aria-hidden="true">SA</div>
          <div><strong>SPESS Accounts</strong><small>{user?.name || "Bursar Portal"}</small></div>
        </div>
        <div className="accounts-header-actions">
          <button type="button" className="accounts-logout-button" onClick={() => {
            clearAccountsAuth();
            navigate("/ark/accounts-login", { replace: true });
          }}>Logout</button>
        </div>
      </header>

      <div className="accounts-workspace">
        <section className="accounts-title-row">
          <div className="accounts-title-copy">
            <span>Finance Office</span>
            {isBursar ? (
              <div className="accounts-welcome-row">
                <div className="accounts-profile-avatar">
                  {user?.avatar_url ? <img src={user.avatar_url} alt="" /> : <span>{initials}</span>}
                </div>
                <p>Hello, <strong>{firstName}</strong></p>
              </div>
            ) : null}
            <h1>Accounts Workspace</h1>
          </div>
          <div className="accounts-period-chip">
            {activeView === "quick-entry"
              ? `${filters.term} - ${filters.year}`
              : activeView === "insights"
                ? "Financial intelligence"
              : activeView === "audit"
                ? "Activity log"
                : activeView === "settings"
                  ? "Profile settings"
                : "Choose section"}
          </div>
        </section>

        <AccountsFundsSummary
          term={filters.term}
          year={filters.year}
          refreshKey={summaryRefreshKey}
        />

        <AccountsRecentTransactions refreshKey={summaryRefreshKey} />

        <AccountsPortalNav
          activeView={activeView}
          canAudit={isOwner}
          canUseSettings={isBursar}
          onChange={changePortalView}
        />

        {activeView === "quick-entry" ? (
          <div className="accounts-view-panel" id="accounts-quick-entry-panel">
            <p className="accounts-register-source-note">
              Learner names come directly from the active O-Level and A-Level registers. Enrollment details are read-only in SPESS Accounts.
            </p>

            <section className="accounts-filter-band" aria-label="Register filters">
              <label><span>Class</span><select value={filters.classLevel} disabled={loadingMeta} onChange={(e) => updateFilter("classLevel", e.target.value)}>
                {meta.classes.map((item) => <option key={item.class_level} value={item.class_level}>{item.class_level}</option>)}
              </select></label>
              <label><span>Stream</span><select value={filters.stream} disabled={!classStreams.length} onChange={(e) => updateFilter("stream", e.target.value)}>
                {classStreams.map((stream) => <option key={stream} value={stream}>{stream}</option>)}
              </select></label>
              <label><span>Term</span><select value={filters.term} onChange={(e) => updateFilter("term", e.target.value)}>
                {meta.terms.map((term) => <option key={term} value={term}>{term}</option>)}
              </select></label>
              <label><span>Year</span><input type="number" min="2020" max="2100" value={filters.year} onChange={(e) => updateFilter("year", e.target.value)} /></label>
            </section>

            {notice.text ? <div className={`accounts-notice is-${notice.type}`} role="status">{notice.text}</div> : null}

            <section className={`accounts-fee-panel ${isOwner ? "" : "is-read-only"}`}>
              <div className="accounts-section-heading">
                <div><span>{isOwner ? "Stream Setup" : "Owner Fee Setup"}</span><h2>{filters.classLevel} {filters.stream}</h2></div>
                <span className={`accounts-state-pill ${feeConfigured ? "is-ready" : ""}`}>{feeConfigured ? "Configured" : "Setup required"}</span>
              </div>
              {isOwner ? (
                <div className="accounts-fee-grid">
                  <label><span>Day learner - Term amount</span><div className="accounts-money-input"><b>UGX</b><input type="number" min="0" step="1000" value={feeForm.day} onChange={(e) => setFeeForm((current) => ({ ...current, day: e.target.value }))} /></div></label>
                  <label><span>Boarding learner - Term amount</span><div className="accounts-money-input"><b>UGX</b><input type="number" min="0" step="1000" value={feeForm.boarding} onChange={(e) => setFeeForm((current) => ({ ...current, boarding: e.target.value }))} /></div></label>
                  <button type="button" className="accounts-secondary-button" onClick={saveFees} disabled={savingFees || !filters.stream}>{savingFees ? "Saving..." : "Save Fee Setup"}</button>
                </div>
              ) : (
                <div className="accounts-fee-rates" aria-label="Owner configured fee rates">
                  <div><span>Day learner</span><strong>{feeConfigured ? formatMoney(feeForm.day) : "Not configured"}</strong></div>
                  <div><span>Boarding learner</span><strong>{feeConfigured ? formatMoney(feeForm.boarding) : "Not configured"}</strong></div>
                </div>
              )}
            </section>

            <section className="accounts-metrics" aria-label="Register summary">
              <div><span>Learners</span><strong>{totals.learners}</strong></div>
              <div><span>Amounts Entered</span><strong>{totals.recorded}</strong></div>
              <div><span>Stream Total</span><strong>{formatMoney(totals.paid)}</strong></div>
              <div><span>Unsaved Rows</span><strong>{dirtyIds.length}</strong></div>
            </section>

            <AccountsRegisterPdfButton
              rows={rows}
              filters={filters}
              feeAmounts={feeForm}
              feeConfigured={feeConfigured}
              hasUnsavedChanges={dirtyIds.length > 0}
            />

            <section className="accounts-register-panel">
              <div className="accounts-section-heading">
                <div>
                  <span>Quick Entry</span>
                  <h2>{filters.classLevel} {filters.stream} Register</h2>
                  {latestPaymentSave ? (
                    <p className="accounts-register-last-save">
                      Last saved by <strong>{latestPaymentSave.savedBy}</strong> · {formatSavedAt(latestPaymentSave.savedAt)}
                    </p>
                  ) : null}
                </div>
                <span className="accounts-register-count">{visibleRows.length} of {rows.length}</span>
              </div>

              <div className="accounts-register-tools">
                <div className="accounts-learner-search">
                  <label className="accounts-visually-hidden" htmlFor="accounts-learner-search">Find a learner</label>
                  <input
                    id="accounts-learner-search"
                    type="search"
                    value={learnerQuery}
                    placeholder="Find learner by name"
                    onChange={(event) => setLearnerQuery(event.target.value)}
                  />
                  {learnerQuery ? (
                    <button type="button" title="Clear learner search" onClick={() => setLearnerQuery("")}>×</button>
                  ) : null}
                </div>
                <button type="button" className="accounts-refresh-button" onClick={loadRegister} disabled={loadingRegister}>Refresh</button>
              </div>

              {loadingRegister ? <div className="accounts-empty-state">Loading learner register...</div> : rows.length ? (
                <div className="accounts-ledger">
                  <div className="accounts-ledger-head" aria-hidden="true"><span>#</span><span>Learner</span><span>Residence</span><span>Expected</span><span>Paid This Term</span><span>Balance</span></div>
                  {visibleRows.map(({ row, index }) => {
                    const expected = expectedFor(row);
                    const paid = Number(row.amount_paid || 0);
                    const balance = Math.max(0, expected - paid);
                    const isDirty = dirtyIds.includes(Number(row.id));
                    const hasPaymentEntry = row.amount_paid !== "";
                    const isNotPaid = hasPaymentEntry && paid === 0;
                    return (
                      <article key={`${row.learner_level}-${row.id}`} className={`accounts-ledger-row ${isDirty ? "is-dirty" : ""}`}>
                        <span className="accounts-row-number">{index + 1}</span>
                        <div className="accounts-learner-cell">
                          <button
                            type="button"
                            className="accounts-learner-name-button"
                            onClick={() => setSelectedLearner(row)}
                          >
                            {row.learner_name}
                          </button>
                          <small>{row.gender || "-"} - ID {row.id}</small>
                          {row.payment_updated_by && row.payment_updated_at ? (
                            <small className="accounts-last-saved">
                              Last saved by <b>{row.payment_updated_by}</b> · {formatSavedAt(row.payment_updated_at)}
                            </small>
                          ) : null}
                        </div>
                        <div className="accounts-residence-toggle" role="group" aria-label={`${row.learner_name} residence`}>
                          {['Day', 'Boarding'].map((type) => <button key={type} type="button" className={row.residence_type === type ? "is-active" : ""} onClick={() => updateRow(row.id, { residence_type: type })}>{type}</button>)}
                        </div>
                        <span className="accounts-expected-cell">{feeConfigured ? formatMoney(expected) : "Not set"}</span>
                        <div className="accounts-payment-cell">
                          <span>Payment</span>
                          <div className="accounts-payment-mode" role="group" aria-label={`${row.learner_name} payment entry mode`}>
                            <button
                              type="button"
                              className={!isNotPaid ? "is-active" : ""}
                              onClick={() => isNotPaid && updateRow(row.id, { amount_paid: "" })}
                            >Amount</button>
                            <button
                              type="button"
                              className={isNotPaid ? "is-active is-not-paid" : ""}
                              onClick={() => updateRow(row.id, { amount_paid: "0" })}
                            >Not Paid</button>
                          </div>
                          {isNotPaid ? (
                            <div className="accounts-not-paid-value">Not Paid</div>
                          ) : (
                            <div className="accounts-money-input">
                              <b>UGX</b>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9,]*"
                                autoComplete="off"
                                aria-label={`${row.learner_name} amount paid this term`}
                                value={formatMoneyInput(row.amount_paid)}
                                onChange={(e) => updateRow(row.id, {
                                  amount_paid: normalizeMoneyInput(e.target.value),
                                })}
                              />
                            </div>
                          )}
                        </div>
                        <span className={`accounts-balance-cell ${balance === 0 && expected > 0 ? "is-cleared" : ""}`}>{feeConfigured ? formatMoney(balance) : "-"}</span>
                      </article>
                    );
                  })}
                  {!visibleRows.length ? (
                    <div className="accounts-empty-state accounts-search-empty">
                      No learner matches “{learnerQuery.trim()}”.
                    </div>
                  ) : null}
                </div>
              ) : <div className="accounts-empty-state">No active learners were found in this class and stream.</div>}
            </section>
          </div>
        ) : activeView === "insights" ? (
          <div className="accounts-insights-panel" id="accounts-insights-panel">
            <div className="accounts-insights-heading">
              <span>Accounts Intelligence</span>
              <h2>{filters.term} {filters.year}</h2>
              <p>Live collections, balances, corrections and finance-team activity in one place.</p>
            </div>
            <div className="accounts-insights-grid">
              <AccountsTodayCollections refreshKey={summaryRefreshKey} />
              <AccountsBursarActivitySummary refreshKey={summaryRefreshKey} />
              <AccountsOutstandingBalances
                filters={filters}
                refreshKey={summaryRefreshKey}
                onSelectLearner={setSelectedLearner}
              />
              <AccountsCorrectionAlerts
                refreshKey={summaryRefreshKey}
                onSelectLearner={(learner) => setSelectedLearner({ ...learner, id: learner.learner_id })}
              />
              <AccountsTransactionSearch
                filters={filters}
                refreshKey={summaryRefreshKey}
                onSelectLearner={setSelectedLearner}
              />
            </div>
          </div>
        ) : activeView === "settings" && isBursar ? (
          <div id="accounts-settings-panel">
            <AccountsProfileSettings user={user} onProfileChange={updateProfile} />
          </div>
        ) : activeView === "audit" && isOwner ? (
          <div id="accounts-audit-panel"><AccountsAuditPanel isOwner={isOwner} /></div>
        ) : null}
      </div>

      {activeView === "quick-entry" ? (
        <div className="accounts-save-dock">
          <span>{dirtyIds.length ? `${dirtyIds.length} unsaved row${dirtyIds.length === 1 ? "" : "s"}` : "Register saved"}</span>
          <button type="button" className="accounts-primary-button" onClick={savePayments} disabled={savingPayments || !feeConfigured || !dirtyIds.length}>{savingPayments ? "Saving..." : "Save Accounts"}</button>
        </div>
      ) : null}

      {selectedLearner ? (
        <AccountsLearnerHistoryModal
          learner={selectedLearner}
          onClose={() => setSelectedLearner(null)}
        />
      ) : null}
    </main>
  );
}
