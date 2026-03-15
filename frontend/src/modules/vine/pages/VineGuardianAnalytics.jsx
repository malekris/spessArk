import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./VineGuardianAnalytics.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:5001";

const isGuardianUser = (user) => {
  if (!user) return false;
  if (Number(user.is_admin) === 1) return true;
  if (String(user.role || "").toLowerCase() === "moderator") return true;
  return ["vine guardian", "vine_guardian", "vine news", "vine_news"].includes(
    String(user.username || "").toLowerCase()
  );
};

export default function VineGuardianAnalytics() {
  const navigate = useNavigate();
  const token = localStorage.getItem("vine_token");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [perfLastFetchedAt, setPerfLastFetchedAt] = useState(null);
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
        const [overviewResult, perfResult] = await Promise.allSettled([
          fetch(`${API}/api/vine/analytics/overview?${q}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API}/api/vine/analytics/performance`, {
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

        setData({
          ...overviewBody,
          performance: perfBody,
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

    const refreshPerformance = async () => {
      try {
        const res = await fetch(`${API}/api/vine/analytics/performance`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) return;
        setData((prev) => (prev ? { ...prev, performance: body } : prev));
        setPerfLastFetchedAt(new Date().toISOString());
      } catch {
        // Keep the last successful snapshot; perf auto-refresh should be quiet.
      }
    };

    const intervalId = window.setInterval(refreshPerformance, 25000);
    return () => window.clearInterval(intervalId);
  }, [token, currentUser]);

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

  if (loading) {
    return <div className="guardian-analytics-page">Loading analytics...</div>;
  }

  if (error) {
    return <div className="guardian-analytics-page">{error}</div>;
  }

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
  const perfRuntime = perf?.runtime || {};
  const perfRoutes = perf?.top_routes || [];
  const perfQueries = perf?.top_queries || [];
  const perfRecentRoutes = perf?.recent_routes || [];
  const perfRecentQueries = perf?.recent_queries || [];
  const maxVolume = Math.max(
    1,
    ...usage.map((d) => d.posts + d.comments + d.likes + d.revines + d.follows + d.dms)
  );

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
              <span>Auto-refreshing every 25s</span>
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
