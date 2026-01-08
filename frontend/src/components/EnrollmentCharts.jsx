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

  if (streams.length === 0) {
    return <p className="muted-text">No enrollment data available for charts.</p>;
  }

  /* ---------- UI ---------- */

  return (
    <div style={{ marginTop: "1.4rem" }}>
      {/* STREAM SELECTOR */}
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <strong style={{ fontSize: "0.85rem", color: "#93c5fd" }}>
          View stream:
        </strong>
        <select
          value={activeStream}
          onChange={(e) => setActiveStream(e.target.value)}
        >
          {streams.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* ========== CHART 1: STACKED BY CLASS ========== */}
      <ChartCard title="Enrollment by Class (Boys vs Girls)">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={classGenderData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="class" stroke="#cbd5f5" />
            <YAxis stroke="#cbd5f5" />
            <Tooltip />
            <Legend />
            <Bar dataKey="Boys" stackId="a" fill="#60a5fa" />
            <Bar dataKey="Girls" stackId="a" fill="#f472b6" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ========== CHART 2: TOTAL PER CLASS ========== */}
      <ChartCard title="Total Learners per Class">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={classGenderData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="class" stroke="#cbd5f5" />
            <YAxis stroke="#cbd5f5" />
            <Tooltip />
            <Bar dataKey="Total" fill="#22d3ee" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ========== CHART 3: STREAM COMPARISON ========== */}
      <ChartCard title="Stream Comparison (Boys vs Girls)">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={streamTotalsData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="stream" stroke="#cbd5f5" />
            <YAxis stroke="#cbd5f5" />
            <Tooltip />
            <Legend />
            <Bar dataKey="Boys" fill="#60a5fa" />
            <Bar dataKey="Girls" fill="#f472b6" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

/* ---------- SMALL PRESENTATION WRAPPER ---------- */

function ChartCard({ title, children }) {
  return (
    <div
      style={{
        marginBottom: "1.2rem",
        padding: "1.2rem",
        borderRadius: "1rem",
        background: "rgba(15,23,42,0.9)",
        border: "1px solid rgba(148,163,184,0.3)",
      }}
    >
      <h4
        style={{
          marginBottom: "0.6rem",
          color: "#e5e7eb",
          fontSize: "0.95rem",
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}
