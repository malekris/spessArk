const PERF_HISTORY_LIMIT = 120;
const PERF_SAMPLE_LIMIT = 60;
const perfBootedAt = Date.now();

const routeEvents = [];
const queryEvents = [];
const routeStats = new Map();
const queryStats = new Map();

const clampNumber = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const pushEvent = (list, item) => {
  list.unshift(item);
  if (list.length > PERF_HISTORY_LIMIT) {
    list.length = PERF_HISTORY_LIMIT;
  }
};

const pushSample = (samples, value) => {
  samples.push(clampNumber(value));
  if (samples.length > PERF_SAMPLE_LIMIT) {
    samples.shift();
  }
};

const toIso = (value = Date.now()) => {
  try {
    return new Date(value).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

const computeP95 = (samples = []) => {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
  return Number(sorted[index].toFixed(1));
};

const getOrCreateRouteStat = (scope, route) => {
  const key = `${scope}:${route}`;
  if (!routeStats.has(key)) {
    routeStats.set(key, {
      key,
      scope,
      route,
      count: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      totalQueryMs: 0,
      totalQueryCount: 0,
      samples: [],
      lastSeenAt: null,
      lastMeta: {},
    });
  }
  return routeStats.get(key);
};

const getOrCreateQueryStat = (scope, route, label) => {
  const key = `${scope}:${route}:${label}`;
  if (!queryStats.has(key)) {
    queryStats.set(key, {
      key,
      scope,
      route,
      label,
      count: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      totalRows: 0,
      samples: [],
      lastSeenAt: null,
    });
  }
  return queryStats.get(key);
};

export const recordPerfRoute = (scope, payload = {}) => {
  const route = String(payload.route || "unknown");
  const ms = clampNumber(payload.ms);
  const queryCount = clampNumber(payload.query_count);
  const queryMs = clampNumber(payload.query_ms);
  const nowIso = toIso();
  const event = {
    scope,
    route,
    ms,
    query_count: queryCount,
    query_ms: queryMs,
    top_queries: Array.isArray(payload.top_queries) ? payload.top_queries : [],
    at: nowIso,
  };
  pushEvent(routeEvents, event);

  const stat = getOrCreateRouteStat(scope, route);
  stat.count += 1;
  stat.totalMs += ms;
  stat.maxMs = Math.max(stat.maxMs, ms);
  stat.lastMs = ms;
  stat.totalQueryMs += queryMs;
  stat.totalQueryCount += queryCount;
  stat.lastSeenAt = nowIso;
  stat.lastMeta = { ...payload };
  pushSample(stat.samples, ms);
};

export const recordPerfQuery = (scope, payload = {}) => {
  const route = String(payload.route || "unknown");
  const label = String(payload.label || "query");
  const ms = clampNumber(payload.ms);
  const rows = clampNumber(payload.rows);
  const nowIso = toIso();
  const event = {
    scope,
    route,
    label,
    ms,
    rows,
    at: nowIso,
  };
  pushEvent(queryEvents, event);

  const stat = getOrCreateQueryStat(scope, route, label);
  stat.count += 1;
  stat.totalMs += ms;
  stat.maxMs = Math.max(stat.maxMs, ms);
  stat.lastMs = ms;
  stat.totalRows += rows;
  stat.lastSeenAt = nowIso;
  pushSample(stat.samples, ms);
};

export const getGuardianPerfSnapshot = ({
  routeLimit = 10,
  queryLimit = 12,
  sampleLimit = 12,
} = {}) => {
  const memory = process.memoryUsage?.() || {};

  const topRoutes = [...routeStats.values()]
    .map((stat) => ({
      scope: stat.scope,
      route: stat.route,
      count: stat.count,
      avg_ms: stat.count ? Number((stat.totalMs / stat.count).toFixed(1)) : 0,
      p95_ms: computeP95(stat.samples),
      max_ms: Number(stat.maxMs.toFixed(1)),
      last_ms: Number(stat.lastMs.toFixed(1)),
      avg_query_ms: stat.count ? Number((stat.totalQueryMs / stat.count).toFixed(1)) : 0,
      avg_query_count: stat.count ? Number((stat.totalQueryCount / stat.count).toFixed(1)) : 0,
      last_seen_at: stat.lastSeenAt,
    }))
    .sort((a, b) => b.max_ms - a.max_ms || b.avg_ms - a.avg_ms || b.count - a.count)
    .slice(0, routeLimit);

  const topQueries = [...queryStats.values()]
    .map((stat) => ({
      scope: stat.scope,
      route: stat.route,
      label: stat.label,
      count: stat.count,
      avg_ms: stat.count ? Number((stat.totalMs / stat.count).toFixed(1)) : 0,
      p95_ms: computeP95(stat.samples),
      max_ms: Number(stat.maxMs.toFixed(1)),
      last_ms: Number(stat.lastMs.toFixed(1)),
      avg_rows: stat.count ? Number((stat.totalRows / stat.count).toFixed(1)) : 0,
      last_seen_at: stat.lastSeenAt,
    }))
    .sort((a, b) => b.max_ms - a.max_ms || b.avg_ms - a.avg_ms || b.count - a.count)
    .slice(0, queryLimit);

  return {
    captured_since: toIso(perfBootedAt),
    runtime: {
      uptime_seconds: Math.round(process.uptime?.() || 0),
      rss_mb: Number(((memory.rss || 0) / 1024 / 1024).toFixed(1)),
      heap_used_mb: Number(((memory.heapUsed || 0) / 1024 / 1024).toFixed(1)),
      route_event_count: routeEvents.length,
      query_event_count: queryEvents.length,
      route_groups: routeStats.size,
      query_groups: queryStats.size,
    },
    top_routes: topRoutes,
    top_queries: topQueries,
    recent_routes: routeEvents.slice(0, sampleLimit),
    recent_queries: queryEvents.slice(0, sampleLimit),
  };
};
