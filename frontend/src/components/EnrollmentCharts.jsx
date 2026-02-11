import React, { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

/**
 * Props:
 * enrollmentData = {
 *   North: {
 *     S1: { Male: 40, Female: 35, total: 75 },
 *     S2: { Male: 38, Female: 42, total: 80 }
 *   },
 *   South: { ... }
 * }
 */

export default function EnrollmentCharts({ enrollmentData = {} }) {
  const streams = Object.keys(enrollmentData);
  const [activeStream, setActiveStream] = useState(streams[0] || "");
  const colors = {
    boys: "#38bdf8",
    girls: "#fb7185",
    total: "#22d3ee",
    text: "#e2e8f0",
    muted: "#94a3b8",
    grid: "rgba(148,163,184,0.18)",
  };

  /* ---------- DATA TRANSFORMS ---------- */

  // Per-class stacked data (boys/girls)
  const classGenderData = useMemo(() => {
    if (!activeStream || !enrollmentData[activeStream]) return [];
    return Object.entries(enrollmentData[activeStream]).map(
      ([cls, stats]) => ({
        class: cls,
        Boys: stats.Male || 0,
        Girls: stats.Female || 0,
        Total: stats.total || 0,
      })
    );
  }, [activeStream, enrollmentData]);

  // Stream totals comparison
  const streamTotalsData = useMemo(() => {
    return streams.map((stream) => {
      const classes = enrollmentData[stream] || {};
      let boys = 0;
      let girls = 0;

      Object.values(classes).forEach((c) => {
        boys += c.Male || 0;
        girls += c.Female || 0;
      });

      return {
        stream,
        Boys: boys,
        Girls: girls,
        Total: boys + girls,
      };
    });
  }, [streams, enrollmentData]);

  const activeTotals = useMemo(() => {
    return classGenderData.reduce(
      (acc, item) => {
        acc.boys += item.Boys || 0;
        acc.girls += item.Girls || 0;
        acc.total += item.Total || 0;
        return acc;
      },
      { boys: 0, girls: 0, total: 0 }
    );
  }, [classGenderData]);

  if (streams.length === 0) {
    return (
      <div
        style={{
          marginTop: "1rem",
          padding: "1rem 1.2rem",
          borderRadius: "0.9rem",
          background: "rgba(15,23,42,0.7)",
          border: "1px solid rgba(148,163,184,0.25)",
          color: colors.muted,
        }}
      >
        No enrollment data available for charts.
      </div>
    );
  }

  /* ---------- UI ---------- */

  return (
    <div style={{ marginTop: "1.4rem" }}>
      <div
        style={{
          display: "flex",
          gap: "0.8rem",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <strong style={{ fontSize: "0.82rem", color: "#bae6fd", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Stream
          </strong>
          {streams.map((s) => {
            const active = s === activeStream;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setActiveStream(s)}
                style={{
                  border: active ? "1px solid rgba(56,189,248,0.9)" : "1px solid rgba(148,163,184,0.35)",
                  background: active
                    ? "linear-gradient(135deg, rgba(14,116,144,0.45), rgba(8,47,73,0.65))"
                    : "rgba(15,23,42,0.72)",
                  color: active ? "#e0f2fe" : "#cbd5e1",
                  borderRadius: "999px",
                  padding: "0.38rem 0.85rem",
                  fontWeight: 700,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                {s}
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            gap: "0.6rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <KpiChip label="Boys" value={activeTotals.boys} tint="rgba(56,189,248,0.2)" />
          <KpiChip label="Girls" value={activeTotals.girls} tint="rgba(251,113,133,0.2)" />
          <KpiChip label="Total" value={activeTotals.total} tint="rgba(34,211,238,0.2)" />
        </div>
      </div>

      <ChartCard title="Enrollment by Class (Boys vs Girls)" subtitle={`Selected stream: ${activeStream}`}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={classGenderData}>
            <CartesianGrid strokeDasharray="4 4" stroke={colors.grid} />
            <XAxis dataKey="class" stroke={colors.muted} tick={{ fill: colors.text, fontSize: 12, fontWeight: 600 }} />
            <YAxis stroke={colors.muted} tick={{ fill: colors.text, fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ color: colors.text }} />
            <Bar dataKey="Boys" stackId="a" fill={colors.boys} radius={[6, 6, 0, 0]} />
            <Bar dataKey="Girls" stackId="a" fill={colors.girls} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Total Learners per Class">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={classGenderData}>
            <CartesianGrid strokeDasharray="4 4" stroke={colors.grid} />
            <XAxis dataKey="class" stroke={colors.muted} tick={{ fill: colors.text, fontSize: 12, fontWeight: 600 }} />
            <YAxis stroke={colors.muted} tick={{ fill: colors.text, fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="Total" fill={colors.total} radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Stream Comparison (Boys vs Girls)">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={streamTotalsData}>
            <CartesianGrid strokeDasharray="4 4" stroke={colors.grid} />
            <XAxis dataKey="stream" stroke={colors.muted} tick={{ fill: colors.text, fontSize: 12, fontWeight: 600 }} />
            <YAxis stroke={colors.muted} tick={{ fill: colors.text, fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ color: colors.text }} />
            <Bar dataKey="Boys" fill={colors.boys} radius={[8, 8, 0, 0]} />
            <Bar dataKey="Girls" fill={colors.girls} radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <div
      style={{
        marginBottom: "1.2rem",
        padding: "1.15rem 1.15rem 0.95rem 1.15rem",
        borderRadius: "1rem",
        background: "linear-gradient(145deg, rgba(15,23,42,0.95), rgba(30,41,59,0.92))",
        border: "1px solid rgba(148,163,184,0.25)",
        boxShadow: "0 16px 36px rgba(2,6,23,0.35), inset 0 1px 0 rgba(148,163,184,0.08)",
      }}
    >
      <h4
        style={{
          marginBottom: "0.35rem",
          color: "#e2e8f0",
          fontSize: "0.95rem",
          letterSpacing: "0.01em",
        }}
      >
        {title}
      </h4>
      {subtitle && (
        <div style={{ color: "#93c5fd", fontSize: "0.8rem", marginBottom: "0.55rem" }}>
          {subtitle}
        </div>
      )}
      {children}
    </div>
  );
}

function KpiChip({ label, value, tint }) {
  return (
    <div
      style={{
        padding: "0.45rem 0.75rem",
        borderRadius: "0.75rem",
        background: tint,
        border: "1px solid rgba(148,163,184,0.28)",
        color: "#e2e8f0",
        minWidth: "92px",
      }}
    >
      <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "#cbd5e1" }}>
        {label}
      </div>
      <div style={{ fontSize: "1rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      style={{
        background: "rgba(15,23,42,0.96)",
        border: "1px solid rgba(148,163,184,0.35)",
        borderRadius: "0.7rem",
        padding: "0.55rem 0.7rem",
        boxShadow: "0 14px 24px rgba(2,6,23,0.45)",
        color: "#e2e8f0",
        fontSize: "0.78rem",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: "0.3rem" }}>{label}</div>
      {payload.map((entry) => (
        <div key={`${entry.dataKey}-${entry.value}`} style={{ color: entry.color }}>
          {entry.name}: <strong>{entry.value}</strong>
        </div>
      ))}
    </div>
  );
}
