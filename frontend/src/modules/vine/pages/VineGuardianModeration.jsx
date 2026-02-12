import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "./VineGuardianModeration.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

const isGuardianUser = (user) => {
  if (!user) return false;
  if (Number(user.is_admin) === 1) return true;
  if (String(user.role || "").toLowerCase() === "moderator") return true;
  return ["vine guardian", "vine_guardian"].includes(
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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suspendDurationByKey, setSuspendDurationByKey] = useState({});

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
            : `${API}/api/vine/analytics/drilldown?${new URLSearchParams({ type, from, to, limit: "200" }).toString()}`;
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
  }, [token, currentUser, navigate, type, from, to]);

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
    alert("User suspended");
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
      <select
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
      <div className="guardian-mod-topbar">
        <button onClick={() => navigate("/vine/guardian/analytics")}>Back to Analytics</button>
        <h2>Guardian Moderation Drilldown</h2>
      </div>

      <div className="guardian-mod-filters">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="posts">Posts</option>
          <option value="comments">Comments</option>
          <option value="reports">Reports</option>
          <option value="appeals">Appeals</option>
          <option value="users">Users</option>
          <option value="creators">Creators</option>
        </select>
        {type !== "reports" && type !== "appeals" && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
      </div>

      {loading && <div className="guardian-mod-empty">Loading...</div>}
      {!loading && items.length === 0 && <div className="guardian-mod-empty">No rows</div>}

      <div className="guardian-mod-list">
        {!loading &&
          items.map((row) => (
            <div className="guardian-mod-row" key={`${type}-${row.id || row.user_id}-${row.created_at || ""}`}>
              <div className="guardian-mod-main">
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
  );
}
