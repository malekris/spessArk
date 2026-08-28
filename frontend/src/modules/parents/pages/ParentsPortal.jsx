import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import badge from "../../../assets/badge.png";
import {
  clearParentToken,
  getParentToken,
  openParentDocument,
  parentRequest,
} from "../parentApi";
import "./ParentsPortal.css";

const formatDate = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatLevel = (level) => level === "A_LEVEL" ? "A-Level" : "O-Level";

export default function ParentsPortal() {
  const navigate = useNavigate();
  const [portal, setPortal] = useState({ parent: null, learners: [], documents: [] });
  const [selectedLearnerKey, setSelectedLearnerKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingDocumentId, setOpeningDocumentId] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordNotice, setPasswordNotice] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const logout = useCallback(() => {
    clearParentToken();
    navigate("/reports", { replace: true });
  }, [navigate]);

  const loadPortal = useCallback(async () => {
    if (!getParentToken()) {
      navigate("/reports", { replace: true });
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await parentRequest("/api/parents/me");
      setPortal({
        parent: data?.parent || null,
        learners: Array.isArray(data?.learners) ? data.learners : [],
        documents: Array.isArray(data?.documents) ? data.documents : [],
      });
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        logout();
        return;
      }
      setError(err.message || "The parent portal could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [logout, navigate]);

  useEffect(() => {
    loadPortal();
  }, [loadPortal]);

  const learners = portal.learners;
  useEffect(() => {
    if (!learners.length) {
      setSelectedLearnerKey("");
      return;
    }
    const keyExists = learners.some(
      (learner) => `${learner.learner_level}:${learner.learner_id}` === selectedLearnerKey
    );
    if (!keyExists) {
      setSelectedLearnerKey(`${learners[0].learner_level}:${learners[0].learner_id}`);
    }
  }, [learners, selectedLearnerKey]);

  const selectedLearner = useMemo(
    () => learners.find((learner) => `${learner.learner_level}:${learner.learner_id}` === selectedLearnerKey) || null,
    [learners, selectedLearnerKey]
  );

  const reports = useMemo(
    () => portal.documents.filter((document) =>
      document.document_type === "REPORT" &&
      (!selectedLearner || (
        document.learner_level === selectedLearner.learner_level &&
        Number(document.learner_id) === Number(selectedLearner.learner_id)
      ))
    ),
    [portal.documents, selectedLearner]
  );
  const circulars = useMemo(
    () => portal.documents.filter((document) => document.document_type === "CIRCULAR"),
    [portal.documents]
  );

  const openDocument = async (documentId) => {
    setOpeningDocumentId(Number(documentId));
    setError("");
    try {
      await openParentDocument(documentId);
      await loadPortal();
    } catch (err) {
      setError(err.message || "Document could not be opened.");
    } finally {
      setOpeningDocumentId(null);
    }
  };

  const updatePassword = async (event) => {
    event.preventDefault();
    setPasswordNotice("");
    setPasswordError("");
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    try {
      const data = await parentRequest("/api/parents/change-password", {
        method: "POST",
        body: {
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        },
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordNotice(data?.message || "Password updated successfully.");
    } catch (err) {
      setPasswordError(err.message || "Password could not be updated.");
    }
  };

  if (loading) {
    return <main className="parents-loading-screen">Opening your SPESS Reports portal...</main>;
  }

  return (
    <main className="parents-portal-page">
      <header className="parents-portal-header">
        <Link to="/" className="parents-brand-link">
          <img src={badge} alt="" />
          <span>
            <strong>SPESS Reports</strong>
            <small>Secure parent portal</small>
          </span>
        </Link>
        <div className="parents-portal-account">
          <span>{portal.parent?.displayName || "Parent Account"}</span>
          <button type="button" onClick={logout}>Sign Out</button>
        </div>
      </header>

      <section className="parents-portal-content">
        <div className="parents-portal-welcome">
          <div>
            <span className="parents-kicker">Family document centre</span>
            <h1>Good to see you, {String(portal.parent?.displayName || "Parent").split(" ")[0]}.</h1>
            <p>Only documents formally released by school administration appear here.</p>
          </div>
          <button type="button" className="parents-refresh-button" onClick={loadPortal}>Refresh</button>
        </div>

        {error && <div className="parents-form-message is-error" role="alert">{error}</div>}

        <div className="parents-portal-metrics">
          <div><span>Linked Learners</span><strong>{learners.length}</strong></div>
          <div><span>Released Reports</span><strong>{portal.documents.filter((document) => document.document_type === "REPORT").length}</strong></div>
          <div><span>School Circulars</span><strong>{circulars.length}</strong></div>
        </div>

        <section className="parents-learners-section">
          <div className="parents-section-heading">
            <div>
              <span>Approved links</span>
              <h2>Your Learners</h2>
            </div>
          </div>
          {learners.length ? (
            <div className="parents-learner-tabs" role="tablist" aria-label="Linked learners">
              {learners.map((learner) => {
                const key = `${learner.learner_level}:${learner.learner_id}`;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={selectedLearnerKey === key}
                    className={selectedLearnerKey === key ? "is-active" : ""}
                    onClick={() => setSelectedLearnerKey(key)}
                  >
                    <strong>{learner.learner_name}</strong>
                    <span>{formatLevel(learner.learner_level)} · {learner.class_level} {learner.stream}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="parents-empty-state">
              <strong>No learner has been linked yet.</strong>
              <span>School administration must verify and match your account before reports can appear.</span>
            </div>
          )}
        </section>

        <div className="parents-document-grid">
          <section className="parents-document-section">
            <div className="parents-section-heading">
              <div>
                <span>{selectedLearner ? selectedLearner.learner_name : "Learner reports"}</span>
                <h2>Report Cards</h2>
              </div>
              <strong>{reports.length}</strong>
            </div>
            <div className="parents-document-list">
              {reports.length ? reports.map((document) => (
                <article key={document.id} className="parents-document-item">
                  <div className="parents-document-mark">PDF</div>
                  <div className="parents-document-copy">
                    <span>{document.term || "School Report"} · {document.academic_year || ""}</span>
                    <h3>{document.title}</h3>
                    <p>{document.description || `${document.class_snapshot || "Learner"} report released by SPESS.`}</p>
                    <small>Released {formatDate(document.released_at)}</small>
                  </div>
                  <button type="button" onClick={() => openDocument(document.id)} disabled={openingDocumentId === Number(document.id)}>
                    {openingDocumentId === Number(document.id) ? "Opening..." : "Open PDF"}
                  </button>
                </article>
              )) : (
                <div className="parents-empty-state compact">
                  <strong>No report has been released for this learner.</strong>
                  <span>Reports appear here only after the school completes its release checks.</span>
                </div>
              )}
            </div>
          </section>

          <section className="parents-document-section">
            <div className="parents-section-heading">
              <div>
                <span>Official communication</span>
                <h2>School Circulars</h2>
              </div>
              <strong>{circulars.length}</strong>
            </div>
            <div className="parents-document-list">
              {circulars.length ? circulars.map((document) => (
                <article key={document.id} className="parents-document-item is-circular">
                  <div className="parents-document-mark">PDF</div>
                  <div className="parents-document-copy">
                    <span>{document.term || "School Notice"} · {document.academic_year || ""}</span>
                    <h3>{document.title}</h3>
                    <p>{document.description || "Official school circular."}</p>
                    <small>Published {formatDate(document.released_at)}</small>
                  </div>
                  <button type="button" onClick={() => openDocument(document.id)} disabled={openingDocumentId === Number(document.id)}>
                    {openingDocumentId === Number(document.id) ? "Opening..." : "Open PDF"}
                  </button>
                </article>
              )) : (
                <div className="parents-empty-state compact">
                  <strong>No circulars have been published.</strong>
                  <span>New school communication will appear here after release.</span>
                </div>
              )}
            </div>
          </section>
        </div>

        <details className="parents-password-panel">
          <summary>Account Security</summary>
          <form onSubmit={updatePassword}>
            <div>
              <label><span>Current Password</span><input type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} required /></label>
              <label><span>New Password</span><input type="password" minLength={8} autoComplete="new-password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} required /></label>
              <label><span>Confirm New Password</span><input type="password" minLength={8} autoComplete="new-password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))} required /></label>
            </div>
            {passwordError && <div className="parents-form-message is-error">{passwordError}</div>}
            {passwordNotice && <div className="parents-form-message is-success">{passwordNotice}</div>}
            <button type="submit">Update Password</button>
          </form>
        </details>
      </section>
    </main>
  );
}

