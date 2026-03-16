import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./VineGuardianAnalytics.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const NEWS_WEEKDAY_OPTIONS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const isGuardianUser = (user) => {
  if (!user) return false;
  if (Number(user.is_admin) === 1) return true;
  if (String(user.role || "").toLowerCase() === "moderator") return true;
  return ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
    String(user.username || "").toLowerCase()
  );
};

const hasSpecialVerifiedBadge = (user) =>
  ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
    String(user?.username || "").toLowerCase()
  ) || ["guardian", "news"].includes(String(user?.badge_type || "").toLowerCase());

const getActivityIcon = (type) =>
  ({
    post: "📝",
    comment: "💬",
    reply: "↩️",
    view: "👁️",
    like: "❤️",
    revine: "🔁",
    follow: "➕",
    dm: "✉️",
    community_join: "👥",
    assignment_submit: "📚",
    login: "🔐",
  }[String(type || "").toLowerCase()] || "🌱");

const getActivityStateLabel = (row) => {
  if (row?.is_online_now) return "Online now";
  if (String(row?.session_state || "").toLowerCase() === "active") return "Active";
  if (String(row?.session_state || "").toLowerCase() === "ended") return "Ended";
  return "Expired";
};

const getInitials = (value) => {
  const text = String(value || "").trim();
  if (!text) return "V";
  const parts = text.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || text.slice(0, 2).toUpperCase();
};

export default function VineGuardianAnalytics() {
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [perfLastFetchedAt, setPerfLastFetchedAt] = useState(null);
  const [activityLastFetchedAt, setActivityLastFetchedAt] = useState(null);
  const [activityFilter, setActivityFilter] = useState("all");
  const [warningUserIds, setWarningUserIds] = useState({});
  const [newsForm, setNewsForm] = useState({
    allowed_weekdays: [],
    daily_hour: 12,
    daily_minute: 0,
    timezone: "Africa/Kampala",
  });
  const [newsSaving, setNewsSaving] = useState(false);
  const [newsRefreshing, setNewsRefreshing] = useState(false);
  const [from, setFrom] = useState(() => {
    const d = new Date(Date.now() - 6 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("vine_user") || "{}");
    } catch {
      return {};
    }
  }, []);

  useEffect(() => {
    document.title = "Vine Guardian Analytics";
  }, []);

  useEffect(() => {
    if (!token || !isGuardianUser(currentUser)) {
      navigate("/vine/feed");
      return;
    }

    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const q = new URLSearchParams({ from, to }).toString();
        const [overviewResult, perfResult, activityResult, newsHealthResult, newsSettingsResult] = await Promise.allSettled([
          fetch(`${API}/api/vine/analytics/overview?${q}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/analytics/performance`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/analytics/activity`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/news/health`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/news/settings`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (overviewResult.status !== "fulfilled") {
          setError("Failed to load analytics");
          return;
        }

        const overviewRes = overviewResult.value;
        const overviewBody = await overviewRes.json();
        if (!overviewRes.ok) {
          setError(overviewBody?.message || "Failed to load analytics");
          return;
        }

        let perfBody = null;
        if (perfResult.status === "fulfilled") {
          const perfRes = perfResult.value;
          const parsed = await perfRes.json().catch(() => null);
          if (perfRes.ok) {
            perfBody = parsed;
            setPerfLastFetchedAt(new Date().toISOString());
          }
        }

        let activityBody = null;
        if (activityResult.status === "fulfilled") {
          const activityRes = activityResult.value;
          const parsed = await activityRes.json().catch(() => null);
          if (activityRes.ok) {
            activityBody = parsed;
            setActivityLastFetchedAt(new Date().toISOString());
          }
        }

        let newsHealthBody = null;
        if (newsHealthResult?.status === "fulfilled") {
          const newsHealthRes = newsHealthResult.value;
          const parsed = await newsHealthRes.json().catch(() => null);
          if (newsHealthRes.ok) {
            newsHealthBody = parsed;
          }
        }

        let newsSettingsBody = null;
        if (newsSettingsResult?.status === "fulfilled") {
          const newsSettingsRes = newsSettingsResult.value;
          const parsed = await newsSettingsRes.json().catch(() => null);
          if (newsSettingsRes.ok) {
            newsSettingsBody = parsed;
          }
        }

        setData({
          ...overviewBody,
          performance: perfBody,
          activity: activityBody,
          newsHealth: newsHealthBody,
          newsSettings: newsSettingsBody,
        });
      } catch (err) {
        setError("Failed to load analytics");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token, currentUser, navigate, from, to]);

  useEffect(() => {
    if (!token || !isGuardianUser(currentUser)) {
      return undefined;
    }

    let intervalId = null;

    const refreshAnalyticsPanels = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const [perfRes, activityRes, newsHealthRes] = await Promise.allSettled([
          fetch(`${API}/api/vine/analytics/performance`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/analytics/activity`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/news/health`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const nextData = {};

        if (perfRes.status === "fulfilled") {
          const parsed = await perfRes.value.json().catch(() => null);
          if (perfRes.value.ok && parsed) {
            nextData.performance = parsed;
            setPerfLastFetchedAt(new Date().toISOString());
          }
        }

        if (activityRes.status === "fulfilled") {
          const parsed = await activityRes.value.json().catch(() => null);
          if (activityRes.value.ok && parsed) {
            nextData.activity = parsed;
            setActivityLastFetchedAt(new Date().toISOString());
          }
        }

        if (newsHealthRes.status === "fulfilled") {
          const parsed = await newsHealthRes.value.json().catch(() => null);
          if (newsHealthRes.value.ok && parsed) {
            nextData.newsHealth = parsed;
          }
        }

        if (Object.keys(nextData).length) {
          setData((prev) => (prev ? { ...prev, ...nextData } : prev));
        }
      } catch {
        // Keep the last successful snapshot; auto-refresh should stay quiet.
      }
    };

    const startInterval = () => {
      if (intervalId) return;
      intervalId = window.setInterval(refreshAnalyticsPanels, 60000);
    };

    const stopInterval = () => {
      if (!intervalId) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshAnalyticsPanels();
        startInterval();
      } else {
        stopInterval();
      }
    };

    if (document.visibilityState === "visible") {
      startInterval();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [token, currentUser]);

  useEffect(() => {
    const source = data?.newsSettings || data?.newsHealth?.runtime;
    if (!source) return;
    setNewsForm({
      allowed_weekdays: Array.isArray(source.allowed_weekdays)
        ? source.allowed_weekdays.map((value) => Number(value)).filter((value) => Number.isInteger(value))
        : [],
      daily_hour: Number(source.daily_hour ?? 12),
      daily_minute: Number(source.daily_minute ?? 0),
      timezone: String(source.timezone || "Africa/Kampala"),
    });
  }, [data?.newsSettings, data?.newsHealth]);

  const exportCsv = (filename, rows) => {
    if (!rows?.length) return;
    const keys = Object.keys(rows[0]);
    const esc = (val) => {
      const s = String(val ?? "");
      if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        return `"${s.replaceAll("\"", "\"\"")}"`;
      }
      return s;
    };
    const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatMs = (value) => {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return "0 ms";
    if (numeric >= 1000) return `${(numeric / 1000).toFixed(2)} s`;
    return `${numeric.toFixed(1)} ms`;
  };

  const formatAgo = (value) => {
    if (!value) return "—";
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) return "—";
    const diffMs = Math.max(0, Date.now() - ts);
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatTimeOfDay = (hour, minute) =>
    `${String(Number(hour || 0)).padStart(2, "0")}:${String(Number(minute || 0)).padStart(2, "0")}`;

  const toggleNewsWeekday = (weekday) => {
    setNewsForm((prev) => {
      const current = new Set((prev.allowed_weekdays || []).map((value) => Number(value)));
      if (current.has(weekday)) current.delete(weekday);
      else current.add(weekday);
      return { ...prev, allowed_weekdays: Array.from(current).sort((a, b) => a - b) };
    });
  };

  const saveNewsSchedule = async () => {
    try {
      setNewsSaving(true);
      const res = await fetch(`${API}/api/vine/news/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newsForm),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.message || "Failed to save Vine News schedule");
        return;
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              newsSettings: body.settings,
              newsHealth: prev.newsHealth
                ? {
                    ...prev.newsHealth,
                    runtime: {
                      ...(prev.newsHealth.runtime || {}),
                      ...body.settings,
                    },
                  }
                : prev.newsHealth,
            }
          : prev
      );
      alert("Vine News schedule updated");
    } catch {
      alert("Failed to save Vine News schedule");
    } finally {
      setNewsSaving(false);
    }
  };

  const refreshNewsNow = async () => {
    try {
      setNewsRefreshing(true);
      const res = await fetch(`${API}/api/vine/news/refresh`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.message || "Failed to refresh Vine News");
        return;
      }
      const healthRes = await fetch(`${API}/api/vine/news/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const healthBody = await healthRes.json().catch(() => null);
      if (healthRes.ok && healthBody) {
        setData((prev) => (prev ? { ...prev, newsHealth: healthBody } : prev));
      }
      alert("Vine News refreshed");
    } catch {
      alert("Failed to refresh Vine News");
    } finally {
      setNewsRefreshing(false);
    }
  };

  const releaseNow = async (userId) => {
    if (!userId) return;
    try {
      const res = await fetch(`${API}/api/vine/moderation/unsuspend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_id: userId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.message || "Failed to release user");
        return;
      }
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          vinePrison: (prev.vinePrison || []).filter((p) => Number(p.user_id) !== Number(userId)),
        };
      });
    } catch {
      alert("Failed to release user");
    }
  };

  const warnBurstUser = async (row) => {
    const userId = Number(row?.user_id || 0);
    if (!userId) return;
    try {
      setWarningUserIds((prev) => ({ ...prev, [userId]: true }));
      const reason = `Guardian automated watch noticed unusual activity: ${
        Array.isArray(row?.reasons) && row.reasons.length
          ? row.reasons.join(", ")
          : `${row?.total_actions || 0} actions in 15 minutes`
      }`;
      const res = await fetch(`${API}/api/vine/moderation/warn`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: userId,
          reason,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body?.message || "Failed to warn user");
        return;
      }
      alert("Warning sent");
    } catch {
      alert("Failed to warn user");
    } finally {
      setWarningUserIds((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  };

  const openUserModerationView = (row) => {
    navigate(`/vine/guardian/moderation?type=users&userId=${row.user_id}&from=${from}&to=${to}`);
  };

  const k = data?.kpis || {};
  const usage = data?.usageByDay || [];
  const leaderboard = data?.topPostsLeaderboard || { today: [], week: [] };
  const funnel = data?.growthFunnel || {};
  const contentHealth = data?.contentHealth || {};
  const engagementQuality = data?.engagementQuality || {};
  const networkEffects = data?.networkEffects || {};
  const alerts = data?.guardianAlerts || [];
  const creators = data?.creatorInsights || { topCreatorsWeek: [], risingCreators: [] };
  const mostActiveUsers = data?.mostActiveUsers || [];
  const vinePrison = data?.vinePrison || [];
  const perf = data?.performance || null;
  const activity = data?.activity || null;
  const newsHealth = data?.newsHealth || null;
  const newsRuntime = newsHealth?.runtime || {};
  const recentLogins = activity?.recent_logins || [];
  const recentActions = activity?.recent_actions || [];
  const perfRuntime = perf?.runtime || {};
  const perfRoutes = perf?.top_routes || [];
  const perfQueries = perf?.top_queries || [];
  const perfRecentRoutes = perf?.recent_routes || [];
  const perfRecentQueries = perf?.recent_queries || [];
  const maxVolume = Math.max(
    1,
    ...usage.map((d) => d.posts + d.comments + d.likes + d.revines + d.follows + d.dms)
  );
  const filteredRecentActions = useMemo(() => {
    if (activityFilter === "all" || activityFilter === "logins") return recentActions;
    if (activityFilter === "posts") {
      return recentActions.filter((row) => ["post"].includes(String(row.action_type || "").toLowerCase()));
    }
    if (activityFilter === "comments") {
      return recentActions.filter((row) => ["comment", "reply"].includes(String(row.action_type || "").toLowerCase()));
    }
    if (activityFilter === "dms") {
      return recentActions.filter((row) => String(row.action_type || "").toLowerCase() === "dm");
    }
    if (activityFilter === "follows") {
      return recentActions.filter((row) => String(row.action_type || "").toLowerCase() === "follow");
    }
    if (activityFilter === "communities") {
      return recentActions.filter((row) =>
        ["community_join", "assignment_submit"].includes(String(row.action_type || "").toLowerCase())
      );
    }
    return recentActions;
  }, [recentActions, activityFilter]);

  if (loading) {
    return <div className="guardian-analytics-page">Loading analytics...</div>;
  }

  if (error) {
    return <div className="guardian-analytics-page">{error}</div>;
  }

  return (
    <div className="guardian-analytics-page">
      <div className="guardian-topbar">
        <button className="guardian-back-btn" onClick={() => navigate("/vine/feed")}>
          Back
        </button>
        <div className="guardian-title-wrap">
          <h2>Vine Guardian Analytics</h2>
          <p>Moderator-only usage metrics</p>
        </div>
        <div className="guardian-range">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="guardian-kpi-grid">
        <div className="guardian-kpi-card">
          <span>Total Users</span>
          <strong>{k.totalUsers ?? 0}</strong>
        </div>
        <div className="guardian-kpi-card">
          <span>Active Users Today</span>
          <strong>{k.activeUsersToday ?? 0}</strong>
        </div>
        <div className="guardian-kpi-card">
          <span>Logins Today</span>
          <strong>{k.loginsToday ?? 0}</strong>
        </div>
        <div className="guardian-kpi-card">
          <span>Estimated Active Hours Today</span>
          <strong>{k.estimatedActiveHoursToday ?? 0}</strong>
        </div>
        <div className="guardian-kpi-card">
          <span>Joined This Week</span>
          <strong>{k.joinedThisWeek ?? k.newUsersWeek ?? 0}</strong>
        </div>
        <div className="guardian-kpi-card">
          <span>Posts This Week</span>
          <strong>{k.postsWeek ?? 0}</strong>
        </div>
        <div className="guardian-kpi-card">
          <span>Total Interactions This Week</span>
          <strong>{k.totalInteractionsWeek ?? 0}</strong>
        </div>
      </div>
      <button className="guardian-csv-btn" onClick={() => exportCsv("kpis.csv", [k])}>
        Export KPI CSV
      </button>

      <div className="guardian-section">
        <h3>Vine News Scheduler</h3>
        <div className="guardian-news-grid">
          <div className="guardian-news-card">
            <span className="guardian-news-label">Posting Days</span>
            <div className="guardian-news-weekdays">
              {NEWS_WEEKDAY_OPTIONS.map((option) => {
                const active = (newsForm.allowed_weekdays || []).includes(option.value);
                return (
                  <button
                    key={`news-day-${option.value}`}
                    type="button"
                    className={`guardian-news-day ${active ? "active" : ""}`}
                    onClick={() => toggleNewsWeekday(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <small>
              Leave all days off only if you want Vine News paused until you choose days again.
            </small>
          </div>

          <div className="guardian-news-card">
            <span className="guardian-news-label">Posting Time</span>
            <div className="guardian-news-field-stack">
              <input
                type="time"
                className="guardian-news-time"
                value={formatTimeOfDay(newsForm.daily_hour, newsForm.daily_minute)}
                onChange={(e) => {
                  const [hour, minute] = String(e.target.value || "12:00").split(":");
                  setNewsForm((prev) => ({
                    ...prev,
                    daily_hour: Number(hour || 0),
                    daily_minute: Number(minute || 0),
                  }));
                }}
              />
              <input
                type="text"
                className="guardian-news-time guardian-news-timezone"
                value={newsForm.timezone || "Africa/Kampala"}
                onChange={(e) =>
                  setNewsForm((prev) => ({
                    ...prev,
                    timezone: e.target.value || "Africa/Kampala",
                  }))
                }
                placeholder="Timezone, e.g. Africa/Kampala"
              />
            </div>
            <small>Example timezone: Africa/Kampala</small>
          </div>

          <div className="guardian-news-card">
            <span className="guardian-news-label">Current Runtime</span>
            <div className="guardian-news-runtime">
              <span>
                Last ingest: <strong>{formatAgo(newsRuntime.last_ingest_at)}</strong>
              </span>
              <span>
                In flight: <strong>{newsRuntime.in_flight ? "Yes" : "No"}</strong>
              </span>
              <span>
                Feeds tracked: <strong>{Array.isArray(newsRuntime.feeds) ? newsRuntime.feeds.length : 0}</strong>
              </span>
              <span>
                Live schedule:{" "}
                <strong>
                  {(newsForm.allowed_weekdays || []).length
                    ? `${(newsForm.allowed_weekdays || [])
                        .map((value) => NEWS_WEEKDAY_OPTIONS.find((option) => option.value === value)?.label || value)
                        .join(", ")} at ${formatTimeOfDay(newsForm.daily_hour, newsForm.daily_minute)}`
                    : "Paused"}
                </strong>
              </span>
            </div>
            <div className="guardian-news-actions">
              <button
                type="button"
                className="guardian-csv-btn guardian-news-save"
                disabled={newsSaving}
                onClick={saveNewsSchedule}
              >
                {newsSaving ? "Saving..." : "Save schedule"}
              </button>
              <button
                type="button"
                className="guardian-csv-btn guardian-news-refresh"
                disabled={newsRefreshing}
                onClick={refreshNewsNow}
              >
                {newsRefreshing ? "Refreshing..." : "Refresh now"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="guardian-section">
        <h3>Network Activity Log</h3>
        <div className="guardian-actions">
          <button
            className="guardian-csv-btn"
            onClick={() => exportCsv("guardian_recent_logins.csv", recentLogins)}
          >
            Export Logins CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => exportCsv("guardian_recent_actions.csv", recentActions)}
          >
            Export Actions CSV
          </button>
        </div>
        <div className="guardian-perf-refresh">
          <span>Recent Vine logins and live action logs across the network. Guardian is excluded from this view.</span>
          <span>Last update: {formatAgo(activityLastFetchedAt)}</span>
        </div>
        <div className="guardian-filter-row">
          {[
            ["all", "Everything"],
            ["logins", "Logins only"],
            ["posts", "Posts only"],
            ["comments", "Comments"],
            ["dms", "DMs only"],
            ["follows", "Follows"],
            ["communities", "Communities"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`guardian-filter-chip ${activityFilter === value ? "active" : ""}`}
              onClick={() => setActivityFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="guardian-activity-split">
          {activityFilter !== "logins" && (
            <div className="guardian-subsection">
              <h4>Recent Actions</h4>
              <div className="guardian-table">
                {filteredRecentActions.length === 0 && <div className="guardian-empty">No actions captured yet.</div>}
                {filteredRecentActions.map((row) => {
                  const specialBadge = hasSpecialVerifiedBadge(row);
                  return (
                    <button
                      key={`guardian-action-${row.event_key}`}
                      className="guardian-row guardian-row-activity"
                      onClick={() => navigate(row.navigate_path || `/vine/profile/${row.username}`)}
                    >
                      <span className="guardian-activity-user">
                        {row.avatar_url ? (
                          <img
                            className="guardian-activity-avatar"
                            src={row.avatar_url}
                            alt={row.display_name || row.username}
                            loading="lazy"
                          />
                        ) : (
                          <span className="guardian-activity-avatar guardian-activity-avatar-fallback">
                            {getInitials(row.display_name || row.username)}
                          </span>
                        )}
                        <span className="guardian-activity-user-copy">
                          <strong>
                            {row.display_name || row.username}
                            {(Number(row.is_verified) === 1 || specialBadge) && (
                              <span className={`guardian-verified ${specialBadge ? "guardian" : ""}`}>✓</span>
                            )}
                          </strong>
                          <small>@{row.username}</small>
                        </span>
                      </span>
                      <span className="guardian-row-main guardian-activity-main">
                        <strong>{getActivityIcon(row.action_type)} {row.action_label}</strong>
                        <small>
                          {row.target_label || "Vine"} • {formatAgo(row.created_at)}
                          {row.is_online_now ? " • online now" : ""}
                        </small>
                        <em className="guardian-activity-note">
                          {row.detail || "Open to inspect the user or jump into the target context."}
                        </em>
                      </span>
                      <span className={`guardian-activity-pill ${row.is_online_now ? "active" : "idle"}`}>
                        {row.is_online_now ? "Live" : "Seen"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="guardian-subsection">
            <h4>Recent Logins</h4>
            <div className="guardian-table">
              {recentLogins.length === 0 && <div className="guardian-empty">No recent logins captured yet.</div>}
              {recentLogins.map((row) => {
                const specialBadge = hasSpecialVerifiedBadge(row);
                return (
                  <button
                    key={`guardian-login-${row.session_id}`}
                    className="guardian-row guardian-row-activity"
                    onClick={() => navigate(row.navigate_path || `/vine/profile/${row.username}`)}
                  >
                    <span className="guardian-activity-user">
                      {row.avatar_url ? (
                        <img
                          className="guardian-activity-avatar"
                          src={row.avatar_url}
                          alt={row.display_name || row.username}
                          loading="lazy"
                        />
                      ) : (
                        <span className="guardian-activity-avatar guardian-activity-avatar-fallback">
                          {getInitials(row.display_name || row.username)}
                        </span>
                      )}
                      <span className="guardian-activity-user-copy">
                        <strong>
                          {row.display_name || row.username}
                          {(Number(row.is_verified) === 1 || specialBadge) && (
                            <span className={`guardian-verified ${specialBadge ? "guardian" : ""}`}>✓</span>
                          )}
                        </strong>
                        <small>@{row.username} • {row.device_label}</small>
                      </span>
                    </span>
                    <span className="guardian-row-main guardian-activity-main">
                      <strong>Logged in {formatAgo(row.login_at)}</strong>
                      <small>
                        {row.is_online_now ? "Online now" : `Seen ${formatAgo(row.last_seen_at)}`} • {row.actions_since_login || 0} action
                        {Number(row.actions_since_login || 0) === 1 ? "" : "s"} since login
                      </small>
                      {Array.isArray(row.recent_actions_preview) && row.recent_actions_preview.length > 0 ? (
                        <div className="guardian-activity-preview-list">
                          {row.recent_actions_preview.map((activity) => (
                            <div
                              key={`${row.session_id}-${activity.event_key}`}
                              className="guardian-activity-preview-item"
                            >
                              <span className="guardian-activity-preview-icon">
                                {getActivityIcon(activity.action_type)}
                              </span>
                              <span className="guardian-activity-preview-copy">
                                {activity.action_label}
                                {activity.target_label ? ` • ${activity.target_label}` : ""}
                                {activity.created_at ? ` • ${formatAgo(activity.created_at)}` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <em className="guardian-activity-note">No action after login yet</em>
                      )}
                    </span>
                    <span className={`guardian-activity-pill ${String(row.session_state || "").toLowerCase()}`}>
                      {getActivityStateLabel(row)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="guardian-section">
        <h3>Performance Watch</h3>
        <div className="guardian-actions">
          <button
            className="guardian-csv-btn"
            onClick={() => exportCsv("perf_top_routes.csv", perfRoutes)}
          >
            Export Routes CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => exportCsv("perf_top_queries.csv", perfQueries)}
          >
            Export Queries CSV
          </button>
        </div>
        {!perf && <div className="guardian-empty">Performance samples have not been captured yet.</div>}
        {perf && (
          <>
            <div className="guardian-compare-grid guardian-perf-grid">
              <div className="guardian-compare-card">
                Perf Logging: {perf.enabled ? "On" : "Off"}
              </div>
              <div className="guardian-compare-card">
                Uptime: {Math.round(Number(perfRuntime.uptime_seconds || 0) / 60)} min
              </div>
              <div className="guardian-compare-card">
                RSS Memory: {perfRuntime.rss_mb ?? 0} MB
              </div>
              <div className="guardian-compare-card">
                Heap Used: {perfRuntime.heap_used_mb ?? 0} MB
              </div>
              <div className="guardian-compare-card">
                Route Samples: {perfRuntime.route_event_count ?? 0}
              </div>
              <div className="guardian-compare-card">
                Query Samples: {perfRuntime.query_event_count ?? 0}
              </div>
            </div>

            <div className="guardian-perf-thresholds">
              <span>Vine route ≥ {perf?.thresholds?.vine_slow_route_ms ?? 0} ms</span>
              <span>Vine query ≥ {perf?.thresholds?.vine_slow_query_ms ?? 0} ms</span>
              <span>DM route ≥ {perf?.thresholds?.dm_slow_route_ms ?? 0} ms</span>
              <span>DM query ≥ {perf?.thresholds?.dm_slow_query_ms ?? 0} ms</span>
            </div>
            <div className="guardian-perf-refresh">
              <span>Auto-refreshing every 60s while this tab is visible</span>
              <span>Last update: {formatAgo(perfLastFetchedAt)}</span>
            </div>

            <div className="guardian-subsection">
              <h4>Slowest Routes In Memory</h4>
              <div className="guardian-table">
                {perfRoutes.length === 0 && <div className="guardian-empty">No slow routes captured yet.</div>}
                {perfRoutes.map((row) => (
                  <div key={`${row.scope}-${row.route}`} className="guardian-row guardian-row-perf">
                    <span className="guardian-row-main guardian-perf-label">
                      <strong>{row.route}</strong>
                      <small>{row.scope.toUpperCase()}</small>
                    </span>
                    <span className="guardian-row-meta">
                      Avg {formatMs(row.avg_ms)} • P95 {formatMs(row.p95_ms)} • Max {formatMs(row.max_ms)}
                    </span>
                    <span className="guardian-perf-side">
                      {row.count} hits • last {formatAgo(row.last_seen_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="guardian-subsection">
              <h4>Slowest Queries In Memory</h4>
              <div className="guardian-table">
                {perfQueries.length === 0 && <div className="guardian-empty">No slow queries captured yet.</div>}
                {perfQueries.map((row) => (
                  <div key={`${row.scope}-${row.route}-${row.label}`} className="guardian-row guardian-row-perf">
                    <span className="guardian-row-main guardian-perf-label">
                      <strong>{row.label}</strong>
                      <small>{row.route}</small>
                    </span>
                    <span className="guardian-row-meta">
                      Avg {formatMs(row.avg_ms)} • P95 {formatMs(row.p95_ms)} • Max {formatMs(row.max_ms)}
                    </span>
                    <span className="guardian-perf-side">
                      {row.count} hits • ~{row.avg_rows} rows
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="guardian-subsection">
              <h4>Recent Hot Samples</h4>
              <div className="guardian-perf-split">
                <div>
                  <h5>Routes</h5>
                  <div className="guardian-table">
                    {perfRecentRoutes.length === 0 && <div className="guardian-empty">No recent route samples.</div>}
                    {perfRecentRoutes.map((row, idx) => (
                      <div key={`perf-route-${idx}-${row.route}-${row.at}`} className="guardian-row guardian-row-perf guardian-row-compact">
                        <span className="guardian-row-main guardian-perf-label">
                          <strong>{row.route}</strong>
                          <small>{row.scope.toUpperCase()}</small>
                        </span>
                        <span className="guardian-row-meta">{formatMs(row.ms)}</span>
                        <span className="guardian-perf-side">{formatAgo(row.at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h5>Queries</h5>
                  <div className="guardian-table">
                    {perfRecentQueries.length === 0 && <div className="guardian-empty">No recent query samples.</div>}
                    {perfRecentQueries.map((row, idx) => (
                      <div key={`perf-query-${idx}-${row.route}-${row.label}-${row.at}`} className="guardian-row guardian-row-perf guardian-row-compact">
                        <span className="guardian-row-main guardian-perf-label">
                          <strong>{row.label}</strong>
                          <small>{row.route}</small>
                        </span>
                        <span className="guardian-row-meta">{formatMs(row.ms)}</span>
                        <span className="guardian-perf-side">{formatAgo(row.at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="guardian-section">
        <h3>Most Active Users (Range)</h3>
        <div className="guardian-actions">
          <button className="guardian-csv-btn" onClick={() => exportCsv("most_active_users.csv", mostActiveUsers)}>
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=users&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-table">
          {mostActiveUsers.length === 0 && <div className="guardian-empty">No user activity in this range.</div>}
          {mostActiveUsers.map((u, idx) => (
            <button
              key={`active-user-${u.user_id}`}
              className="guardian-row"
              onClick={() => navigate(`/vine/profile/${u.username}`)}
            >
              <span className="guardian-rank">#{idx + 1}</span>
              <span className="guardian-row-main">{u.display_name || u.username}</span>
              <span className="guardian-row-meta">
                Score {u.score} • Posts {u.posts_count} • Comments {u.comments_count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="guardian-section">
        <h3>Today vs Week</h3>
        <button
          className="guardian-csv-btn"
          onClick={() =>
            exportCsv("today_vs_week.csv", [
              {
                likesToday: k.likesToday ?? 0,
                likesWeek: k.likesWeek ?? 0,
                commentsToday: k.commentsToday ?? 0,
                commentsWeek: k.commentsWeek ?? 0,
                revinesToday: k.revinesToday ?? 0,
                revinesWeek: k.revinesWeek ?? 0,
                followsToday: k.followsToday ?? 0,
                followsWeek: k.followsWeek ?? 0,
                dmsToday: k.dmsToday ?? 0,
                dmsWeek: k.dmsWeek ?? 0,
                activeUsersToday: k.activeUsersToday ?? 0,
                activeUsersWeek: k.activeUsersWeek ?? 0,
              },
            ])
          }
        >
          Export CSV
        </button>
        <div className="guardian-compare-grid">
          <div className="guardian-compare-card">Likes: {k.likesToday ?? 0} / {k.likesWeek ?? 0}</div>
          <div className="guardian-compare-card">Comments: {k.commentsToday ?? 0} / {k.commentsWeek ?? 0}</div>
          <div className="guardian-compare-card">Revines: {k.revinesToday ?? 0} / {k.revinesWeek ?? 0}</div>
          <div className="guardian-compare-card">Follows: {k.followsToday ?? 0} / {k.followsWeek ?? 0}</div>
          <div className="guardian-compare-card">DMs: {k.dmsToday ?? 0} / {k.dmsWeek ?? 0}</div>
          <div className="guardian-compare-card">Active Users: {k.activeUsersToday ?? 0} / {k.activeUsersWeek ?? 0}</div>
        </div>
      </div>

      <div className="guardian-section">
        <h3>7-Day Usage Volume</h3>
        <button
          className="guardian-csv-btn"
          onClick={() => exportCsv("usage_by_day.csv", usage)}
        >
          Export CSV
        </button>
        <div className="guardian-bars">
          {usage.map((day) => {
            const total =
              day.posts + day.comments + day.likes + day.revines + day.follows + day.dms;
            const height = Math.max(8, Math.round((total / maxVolume) * 140));
            return (
              <div className="guardian-bar-col" key={day.day}>
                <div className="guardian-bar-wrap" title={`Total: ${total}`}>
                  <div className="guardian-bar" style={{ height }} />
                </div>
                <span className="guardian-bar-value">{total}</span>
                <span className="guardian-bar-day">{day.day.slice(5)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="guardian-section">
        <h3>Top Posts Leaderboard (7d)</h3>
        <div className="guardian-actions">
          <button className="guardian-csv-btn" onClick={() => exportCsv("top_posts_week.csv", leaderboard.week)}>
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=posts&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-table">
          {leaderboard.week.length === 0 && <div className="guardian-empty">No posts in this range.</div>}
          {leaderboard.week.map((p, idx) => (
            <button
              key={`week-post-${p.id}`}
              className="guardian-row"
              onClick={() => navigate(`/vine/feed?post=${p.id}`)}
            >
              <span className="guardian-rank">#{idx + 1}</span>
              <span className="guardian-row-main">
                {p.display_name || p.username} • {String(p.content || "").slice(0, 80) || "Photo post"}
              </span>
              <span className="guardian-row-meta">Score {p.score}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="guardian-section">
        <h3>Growth Funnel (7d)</h3>
        <button
          className="guardian-csv-btn"
          onClick={() =>
            exportCsv("growth_funnel.csv", [
              {
                newUsers7d: funnel.newUsers7d ?? 0,
                postedByNewUsers7d: funnel.postedByNewUsers7d ?? 0,
                engagedByNewUsers7d: funnel.engagedByNewUsers7d ?? 0,
                eligibleRetentionUsers: funnel.eligibleRetentionUsers ?? 0,
                retainedAfter1d: funnel.retainedAfter1d ?? 0,
                retentionRatePct: funnel.retentionRatePct ?? 0,
              },
            ])
          }
        >
          Export CSV
        </button>
        <div className="guardian-funnel-grid">
          <div className="guardian-funnel-step">New Users: {funnel.newUsers7d ?? 0}</div>
          <div className="guardian-funnel-step">Posted: {funnel.postedByNewUsers7d ?? 0}</div>
          <div className="guardian-funnel-step">Got Engagement: {funnel.engagedByNewUsers7d ?? 0}</div>
          <div className="guardian-funnel-step">D1 Retention: {funnel.retentionRatePct ?? 0}%</div>
        </div>
      </div>

      <div className="guardian-section">
        <h3>Content Health</h3>
        <div className="guardian-actions">
          <button
            className="guardian-csv-btn"
            onClick={() => exportCsv("content_health.csv", [contentHealth])}
          >
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=posts&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-compare-grid">
          <div className="guardian-compare-card">Avg Post Length (7d): {contentHealth.avgPostLengthWeek ?? 0}</div>
          <div className="guardian-compare-card">Image Post Ratio (7d): {contentHealth.imagePostRatioWeek ?? 0}%</div>
          <div className="guardian-compare-card">Link Post Ratio (7d): {contentHealth.linkPostRatioWeek ?? 0}%</div>
          <div className="guardian-compare-card">Comments per Post (7d): {contentHealth.commentsPerPostWeek ?? 0}</div>
        </div>
      </div>

      <div className="guardian-section">
        <h3>Engagement Quality</h3>
        <div className="guardian-actions">
          <button
            className="guardian-csv-btn"
            onClick={() => exportCsv("engagement_quality.csv", [engagementQuality])}
          >
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=comments&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-compare-grid">
          <div className="guardian-compare-card">Interactions per Active User: {engagementQuality.interactionsPerActiveUserWeek ?? 0}</div>
          <div className="guardian-compare-card">Engagement per Post: {engagementQuality.engagementPerPostWeek ?? 0}</div>
          <div className="guardian-compare-card">Reply Share: {engagementQuality.replyShareWeek ?? 0}%</div>
        </div>
      </div>

      <div className="guardian-section">
        <h3>Network Effects</h3>
        <div className="guardian-actions">
          <button className="guardian-csv-btn" onClick={() => exportCsv("network_effects.csv", [networkEffects])}>
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=users&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-compare-grid">
          <div className="guardian-compare-card">Follows (7d): {networkEffects.followsWeek ?? 0}</div>
          <div className="guardian-compare-card">Follows per Active User: {networkEffects.followsPerActiveUserWeek ?? 0}</div>
          <div className="guardian-compare-card">Mutual Follow Pairs: {networkEffects.mutualFollowPairs ?? 0}</div>
          <div className="guardian-compare-card">New DM Threads (7d): {networkEffects.dmStartsWeek ?? 0}</div>
        </div>
      </div>

      <div className="guardian-section">
        <h3>Vine Prison (Active Suspensions)</h3>
        <button className="guardian-csv-btn" onClick={() => exportCsv("vine_prison.csv", vinePrison)}>
          Export CSV
        </button>
        <div className="guardian-table">
          {vinePrison.length === 0 && <div className="guardian-empty">No active suspensions.</div>}
          {vinePrison.map((p) => (
            <div
              key={`prison-${p.id}`}
              className="guardian-row"
            >
              <span className="guardian-row-main">
                {p.display_name || p.username} • {p.sentence_label}
              </span>
              <span className="guardian-row-meta">
                Start {new Date(p.starts_at).toLocaleString()} • Release {p.ends_at ? new Date(p.ends_at).toLocaleString() : "Indefinite"}
              </span>
              <div className="guardian-row-actions">
                <button
                  className="guardian-csv-btn"
                  onClick={() => navigate(`/vine/profile/${p.username}`)}
                >
                  Open
                </button>
                <button
                  className="guardian-release-btn"
                  onClick={() => releaseNow(p.user_id)}
                >
                  Release Now
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="guardian-section">
        <h3>Guardian Alerts</h3>
        <div className="guardian-actions">
          <button className="guardian-csv-btn" onClick={() => exportCsv("guardian_alerts.csv", alerts)}>
            Export CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=posts&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-table">
          {alerts.length === 0 && <div className="guardian-empty">No alerts above threshold.</div>}
          {alerts.map((a) => (
            <div key={a.key} className={`guardian-row ${a.severity === "high" ? "alert-high" : a.severity === "medium" ? "alert-medium" : ""}`}>
              <span className="guardian-row-main">{a.label}</span>
              <span className="guardian-row-meta">
                {a.current} vs {a.previous} ({a.changePct}%)
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="guardian-section">
        <h3>Creator Insights (Global)</h3>
        <div className="guardian-actions">
          <button className="guardian-csv-btn" onClick={() => exportCsv("top_creators_week.csv", creators.topCreatorsWeek || [])}>
            Export Top CSV
          </button>
          <button className="guardian-csv-btn" onClick={() => exportCsv("rising_creators.csv", creators.risingCreators || [])}>
            Export Rising CSV
          </button>
          <button
            className="guardian-csv-btn"
            onClick={() => navigate(`/vine/guardian/moderation?type=creators&from=${from}&to=${to}`)}
          >
            Drilldown
          </button>
        </div>
        <div className="guardian-subsection">
          <h4>Top Creators (7d)</h4>
          <div className="guardian-table">
            {creators.topCreatorsWeek?.length === 0 && <div className="guardian-empty">No creator data.</div>}
            {(creators.topCreatorsWeek || []).map((c, idx) => (
              <button
                key={`creator-top-${c.user_id}`}
                className="guardian-row"
                onClick={() => navigate(`/vine/profile/${c.username}`)}
              >
                <span className="guardian-rank">#{idx + 1}</span>
                <span className="guardian-row-main">{c.display_name || c.username}</span>
                <span className="guardian-row-meta">Score {c.score_week}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="guardian-subsection">
          <h4>Rising Creators</h4>
          <div className="guardian-table">
            {creators.risingCreators?.length === 0 && <div className="guardian-empty">No rising creator data.</div>}
            {(creators.risingCreators || []).map((c, idx) => (
              <button
                key={`creator-rise-${c.user_id}`}
                className="guardian-row"
                onClick={() => navigate(`/vine/profile/${c.username}`)}
              >
                <span className="guardian-rank">#{idx + 1}</span>
                <span className="guardian-row-main">{c.display_name || c.username}</span>
                <span className="guardian-row-meta">Growth {c.growthPct}%</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
