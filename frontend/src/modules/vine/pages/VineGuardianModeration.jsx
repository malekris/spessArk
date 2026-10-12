import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "./VineGuardianModeration.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

const moderationViews = [
  { value: "posts", label: "Posts", mark: "P", description: "Review published posts and engagement." },
  { value: "comments", label: "Comments", mark: "C", description: "Inspect replies and conversation activity." },
  { value: "reports", label: "Reports", mark: "!", description: "Work through open community reports." },
  { value: "appeals", label: "Appeals", mark: "A", description: "Review requests from restricted accounts." },
  { value: "users", label: "Users", mark: "U", description: "Open profiles and manage restrictions." },
  { value: "creators", label: "Creators", mark: "V", description: "Review creator activity and reach." },
];

const isGuardianUser = (user) => {
  if (!user) return false;
  if (Number(user.is_admin) === 1) return true;
  if (String(user.role || "").toLowerCase() === "moderator") return true;
  return ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
    String(user.username || "").toLowerCase()
  );
};

export default function VineGuardianModeration() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = localStorage.getItem("vine_token");
  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("vine_user") || "{}");
    } catch {
      return {};
    }
  }, []);

  const [type, setType] = useState(params.get("type") || "posts");
  const [from, setFrom] = useState(params.get("from") || new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(params.get("to") || new Date().toISOString().slice(0, 10));
  const [userFilter, setUserFilter] = useState(params.get("userId") || "");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suspendDurationByKey, setSuspendDurationByKey] = useState({});
  const activeView = moderationViews.find((view) => view.value === type) || moderationViews[0];
  const isLiveQueue = type === "reports" || type === "appeals";

  const suspensionOptions = [
    { value: "day", label: "1 day" },
    { value: "week", label: "1 week" },
    { value: "month", label: "1 month" },
    { value: "three_months", label: "3 months" },
    { value: "indefinite", label: "Indefinite" },
  ];

  useEffect(() => {
    document.title = "Vine Guardian Moderation";
  }, []);

  useEffect(() => {
    if (!token || !isGuardianUser(currentUser)) {
      navigate("/vine/feed");
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const url =
          type === "reports"
            ? `${API}/api/vine/moderation/reports`
            : type === "appeals"
            ? `${API}/api/vine/moderation/appeals`
            : `${API}/api/vine/analytics/drilldown?${new URLSearchParams({
                type,
                from,
                to,
                limit: "200",
                ...(userFilter ? { userId: String(userFilter) } : {}),
              }).toString()}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (res.ok) {
          if (type === "reports" || type === "appeals") {
            setItems(Array.isArray(body) ? body : []);
          } else {
            setItems(body.items || []);
          }
        }
        else setItems([]);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, currentUser, navigate, type, from, to, userFilter]);

  const removePost = async (id) => {
    const res = await fetch(`${API}/api/vine/posts/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const removeComment = async (id) => {
    const res = await fetch(`${API}/api/vine/comments/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const resolveReport = async (id, status = "resolved") => {
    const res = await fetch(`${API}/api/vine/moderation/reports/${id}/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }
  };

  const warnUser = async ({ userId, reportId, reason, postId, commentId }) => {
    const res = await fetch(`${API}/api/vine/moderation/warn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        user_id: userId,
        report_id: reportId,
        reason: reason || "",
        post_id: postId || null,
        comment_id: commentId || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(body.message || "Warning failed");
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== reportId));
    alert("Warning sent");
  };

  const suspendUser = async ({ userId, reportId = null, duration = "week", reason = "" }) => {
    if (!userId) return;
    if (!suspensionOptions.some((x) => x.value === duration)) {
      alert("Choose a valid suspension period");
      return;
    }
    const res = await fetch(`${API}/api/vine/moderation/suspend`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        user_id: userId,
        duration,
        reason: String(reason || "Guardian moderation action").slice(0, 500),
        report_id: reportId || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(body.message || "Suspension failed");
      return;
    }
    if (reportId) {
      setItems((prev) => prev.filter((x) => x.id !== reportId));
    }
    alert("User suspended. Feed, statuses, posts, interactions, and messages are now paused.");
  };

  const getDurationForKey = (key) => suspendDurationByKey[key] || "week";
  const setDurationForKey = (key, value) => {
    setSuspendDurationByKey((prev) => ({ ...prev, [key]: value }));
  };

  const unsuspendUser = async ({ userId, appealId = null }) => {
    if (!userId) return;
    const res = await fetch(`${API}/api/vine/moderation/unsuspend`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        user_id: userId,
        appeal_id: appealId || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(body.message || "Unsuspend failed");
      return;
    }
    if (appealId) {
      setItems((prev) => prev.filter((x) => x.id !== appealId));
    }
    alert("User unsuspended");
  };

  const renderSuspendControl = ({ keyId, userId, reportId = null, reason = "" }) => (
    <div className="suspend-inline">
      <span className="suspend-scope-label" title="Pauses the feed, statuses, posts, interactions, direct messages and group messages">
        Feed · status · interactions · messages
      </span>
      <select
        aria-label="Suspension duration"
        value={getDurationForKey(keyId)}
        onChange={(e) => setDurationForKey(keyId, e.target.value)}
      >
        {suspensionOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        className="danger"
        onClick={() =>
          suspendUser({
            userId,
            reportId,
            duration: getDurationForKey(keyId),
            reason,
          })
        }
      >
        Suspend
      </button>
    </div>
  );

  return (
    <div className="guardian-mod-page">
      <div className="guardian-mod-shell">
        <header className="guardian-mod-topbar">
          <button
            type="button"
            className="guardian-mod-back"
            onClick={() => navigate("/vine/guardian/analytics")}
            aria-label="Back to Guardian Analytics"
          >
            <span aria-hidden="true">←</span>
            <span>Analytics</span>
          </button>
          <div className="guardian-mod-title-wrap">
            <span className="guardian-mod-kicker">Guardian workspace</span>
            <h1>Moderation drilldown</h1>
            <p>Review activity, resolve reports, and manage account restrictions.</p>
          </div>
          <div className="guardian-mod-access" aria-label="Guardian tools active">
            <span aria-hidden="true" />
            Guardian tools active
          </div>
        </header>

        <nav className="guardian-mod-view-tabs" aria-label="Moderation views">
          {moderationViews.map((view) => (
            <button
              type="button"
              key={view.value}
              className={type === view.value ? "is-active" : ""}
              aria-pressed={type === view.value}
              onClick={() => setType(view.value)}
            >
              <span className="guardian-mod-tab-mark" aria-hidden="true">{view.mark}</span>
              <span>{view.label}</span>
            </button>
          ))}
        </nav>

        <section className="guardian-mod-toolbar" aria-label="Drilldown filters">
          <div className="guardian-mod-current-view">
            <span className="guardian-mod-current-mark" aria-hidden="true">{activeView.mark}</span>
            <span>
              <small>Viewing</small>
              <strong>{activeView.label}</strong>
              <em>{activeView.description}</em>
            </span>
          </div>

          <div className="guardian-mod-filters">
            <label className="guardian-mod-mobile-view">
              <span>View</span>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {moderationViews.map((view) => (
                  <option key={view.value} value={view.value}>{view.label}</option>
                ))}
              </select>
            </label>
            {!isLiveQueue && (
              <div className="guardian-mod-date-range">
                <label>
                  <span>From</span>
                  <input aria-label="Drilldown start date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <span className="guardian-mod-date-arrow" aria-hidden="true">→</span>
                <label>
                  <span>To</span>
                  <input aria-label="Drilldown end date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
              </div>
            )}
            {isLiveQueue && (
              <div className="guardian-mod-live-filter">
                <span aria-hidden="true" />
                Live open queue
              </div>
            )}
            {userFilter && (
              <button type="button" className="guardian-user-filter" onClick={() => setUserFilter("")}>
                User #{userFilter} <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
        </section>

        <div className="guardian-mod-results-head">
          <div>
            <span className="guardian-mod-results-eyebrow">Case review</span>
            <h2>{activeView.label}</h2>
          </div>
          <span className="guardian-mod-result-count">
            {loading ? "Loading" : `${items.length} ${items.length === 1 ? "result" : "results"}`}
          </span>
        </div>

        {loading && (
          <div className="guardian-mod-empty guardian-mod-loading" role="status">
            <span className="guardian-mod-spinner" aria-hidden="true" />
            <strong>Loading Guardian records</strong>
            <small>Preparing the latest moderation data…</small>
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="guardian-mod-empty">
            <span className="guardian-mod-empty-mark" aria-hidden="true">✓</span>
            <strong>Nothing needs attention here</strong>
            <small>No {activeView.label.toLowerCase()} match the current view.</small>
          </div>
        )}

        <div className="guardian-mod-list">
        {!loading &&
          items.map((row) => (
            <div className="guardian-mod-row" key={`${type}-${row.id || row.user_id}-${row.created_at || ""}`}>
              <div className="guardian-mod-main">
                <div className="guardian-mod-row-label">
                  <span>{activeView.mark}</span>
                  <small>{type === "reports" || type === "appeals" ? "Open case" : activeView.label.slice(0, -1) || activeView.label}</small>
                </div>
                {type === "posts" && (
                  <>
                    <strong>{row.display_name || row.username}</strong>
                    <p>{String(row.content || "Photo post").slice(0, 140)}</p>
                    <small>#{row.id} • {new Date(row.created_at).toLocaleString()} • L{row.likes} C{row.comments} R{row.revines}</small>
                  </>
                )}
                {type === "comments" && (
                  <>
                    <strong>{row.display_name || row.username}</strong>
                    <p>{String(row.content || "").slice(0, 180)}</p>
                    <small>Comment #{row.id} • Post #{row.post_id} • {new Date(row.created_at).toLocaleString()}</small>
                  </>
                )}
                {type === "users" && (
                  <>
                    <strong>{row.display_name || row.username}</strong>
                    <small>@{row.username} • joined {new Date(row.created_at).toLocaleDateString()} • role {row.role || "user"}</small>
                  </>
                )}
                {type === "reports" && (
                  <>
                    <strong>
                      Report #{row.id} • {row.reporter_display_name || row.reporter_username}
                    </strong>
                    <p>{row.reason}</p>
                    <small>
                      Target: @{row.reported_username || "unknown"} •
                      {row.comment_id ? ` Comment #${row.comment_id}` : ` Post #${row.post_id}`} •
                      {new Date(row.created_at).toLocaleString()}
                    </small>
                  </>
                )}
                {type === "creators" && (
                  <>
                    <strong>{row.display_name || row.username}</strong>
                    <small>@{row.username} • posts {row.posts} • likes {row.likes} • comments {row.comments} • revines {row.revines}</small>
                  </>
                )}
                {type === "appeals" && (
                  <>
                    <strong>{row.display_name || row.username}</strong>
                    <p>{row.message}</p>
                    <small>
                      Appeal #{row.id} • @{row.username} • {new Date(row.created_at).toLocaleString()}
                    </small>
                  </>
                )}
              </div>
              <div className="guardian-mod-actions">
                {type === "posts" && (
                  <>
                    <button onClick={() => navigate(`/vine/feed?post=${row.id}`)}>Open</button>
                    <button className="danger" onClick={() => removePost(row.id)}>Delete</button>
                  </>
                )}
                {type === "comments" && (
                  <>
                    <button onClick={() => navigate(`/vine/feed?post=${row.post_id}&comment=${row.id}`)}>Open</button>
                    <button className="danger" onClick={() => removeComment(row.id)}>Delete</button>
                  </>
                )}
                {(type === "users" || type === "creators") && (
                  <>
                    <button onClick={() => navigate(`/vine/profile/${row.username}`)}>Open Profile</button>
                    {renderSuspendControl({
                      keyId: `${type}-${row.id || row.user_id}`,
                      userId: row.id || row.user_id,
                      reason: "Guardian moderation action",
                    })}
                    <button className="success" onClick={() => unsuspendUser({ userId: row.id || row.user_id })}>
                      Unsuspend
                    </button>
                  </>
                )}
                {type === "reports" && (
                  <>
                    <button
                      onClick={() =>
                        navigate(
                          row.comment_id
                            ? `/vine/feed?post=${row.post_id}&comment=${row.comment_id}`
                            : `/vine/feed?post=${row.post_id}`
                        )
                      }
                    >
                      Open
                    </button>
                    {renderSuspendControl({
                      keyId: `report-${row.id}`,
                      userId: row.reported_user_id,
                      reportId: row.id,
                      reason: row.reason || "Reported content policy violation",
                    })}
                    <button
                      className="warn-btn"
                      onClick={() =>
                        warnUser({
                          userId: row.reported_user_id,
                          reportId: row.id,
                          reason: row.reason,
                          postId: row.post_id,
                          commentId: row.comment_id,
                        })
                      }
                    >
                      Warn
                    </button>
                    <button onClick={() => resolveReport(row.id, "dismissed")}>Dismiss</button>
                  </>
                )}
                {type === "appeals" && (
                  <>
                    <button onClick={() => navigate(`/vine/profile/${row.username}`)}>Open Profile</button>
                    {renderSuspendControl({
                      keyId: `appeal-${row.id}`,
                      userId: row.user_id,
                      reason: row.message || "Appeal review moderation action",
                    })}
                    <button className="success" onClick={() => unsuspendUser({ userId: row.user_id, appealId: row.id })}>
                      Unsuspend
                    </button>
                    <button
                      onClick={async () => {
                        const res = await fetch(`${API}/api/vine/moderation/appeals/${row.id}/resolve`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                          },
                          body: JSON.stringify({ status: "resolved" }),
                        });
                        if (res.ok) setItems((prev) => prev.filter((x) => x.id !== row.id));
                      }}
                    >
                      Resolve
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
