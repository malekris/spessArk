import React, { useMemo, useState, useEffect } from "react";
import jsPDF from "jspdf";

/* ================== HELPERS ================== */

const parseSubjects = (s) => {
  if (!s) return [];
  if (Array.isArray(s)) return s;
  try {
    return JSON.parse(s);
  } catch {
    return String(s)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
};

const formatDateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
};

/* ================== COMPONENT ================== */

export default function EnrollmentInsightsPanel({ students = [] }) {
  /* ---------- UI state ---------- */
  const [viewMode, setViewMode] = useState("summary"); // default
  const [classLevel, setClassLevel] = useState("");
  const [stream, setStream] = useState("");
  const [subject, setSubject] = useState("");

  /* ---------- OPTIONS ---------- */

  const classOptions = useMemo(
    () => [...new Set(students.map((s) => s.class_level).filter(Boolean))],
    [students]
  );

  const streamOptions = useMemo(() => {
    const s = [...new Set(students.map((s) => s.stream).filter(Boolean))];
    return s.length ? s : ["North", "South"];
  }, [students]);

  const subjectOptions = useMemo(() => {
    const set = new Set();
    students.forEach((s) =>
      parseSubjects(s.subjects).forEach((sub) => set.add(sub))
    );
    return Array.from(set).sort();
  }, [students]);

  /* ---------- FILTERED DATA ---------- */

  const filteredBase = useMemo(
    () =>
      students.filter((s) => {
        if (classLevel && s.class_level !== classLevel) return false;
        if (stream && s.stream !== stream) return false;
        return true;
      }),
    [students, classLevel, stream]
  );

  const detailRows = subject
    ? filteredBase.filter((s) =>
        parseSubjects(s.subjects).includes(subject)
      )
    : filteredBase;

  /* ---------- SUMMARY DATA ---------- */

  const summaryRows = useMemo(() => {
    const subjects = subject ? [subject] : subjectOptions;

    return subjects.map((subj) => {
      const counts = {};
      let total = 0;

      streamOptions.forEach((st) => {
        const count = students.reduce((acc, s) => {
          if (classLevel && s.class_level !== classLevel) return acc;
          if (s.stream !== st) return acc;
          return parseSubjects(s.subjects).includes(subj) ? acc + 1 : acc;
        }, 0);

        counts[st] = count;
        total += count;
      });

      return { subject: subj, counts, total };
    });
  }, [students, classLevel, subject, subjectOptions, streamOptions]);

  /* ================== EXPORTS ================== */

  /* ---------- SUMMARY CSV ---------- */
  const downloadSummaryCsv = () => {
    if (!summaryRows.length) return;

    const header = ["Subject", ...streamOptions, "Total"];
    const rows = summaryRows.map((r) => [
      r.subject,
      ...streamOptions.map((s) => r.counts[s] ?? 0),
      r.total,
    ]);

    const csv = [
      header.join(","),
      ...rows.map((r) =>
        r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    window.open(URL.createObjectURL(blob), "_blank");
  };

  /* ---------- SUMMARY PDF ---------- */
  const downloadSummaryPdf = () => {
    if (!summaryRows.length) return;

    const doc = new jsPDF("p", "mm", "a4");
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    const generatedAt = new Date().toLocaleString();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("SPESS — Enrollment Summary Report", w / 2, 18, { align: "center" });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Class: ${classLevel || "All"}`, 14, 28);
    doc.text(`Streams: ${streamOptions.join(", ")}`, 14, 34);
    doc.text(`Subject Filter: ${subject || "All Subjects"}`, 14, 40);
    doc.text(`Generated: ${generatedAt}`, 14, 46);
    doc.text("Source: SPESS ARK (Admin)", 14, 52);

    let y = 64;
    const bottom = 18;
    const subjectW = 70;
    const colW = (w - subjectW - 28) / (streamOptions.length + 1);

    const drawHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.text("Subject", 14, y);
      let x = 14 + subjectW;
      streamOptions.forEach((s) => {
        doc.text(s, x, y);
        x += colW;
      });
      doc.text("Total", x, y);
      doc.line(12, y + 2, w - 12, y + 2);
      y += 8;
      doc.setFont("helvetica", "normal");
    };

    drawHeader();

    summaryRows.forEach((r) => {
      if (y > h - bottom) {
        doc.addPage();
        y = 20;
        drawHeader();
      }

      doc.text(r.subject, 14, y);
      let x = 14 + subjectW;
      streamOptions.forEach((s) => {
        doc.text(String(r.counts[s] ?? 0), x, y);
        x += colW;
      });
      doc.text(String(r.total), x, y);
      y += 7;
    });

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(
        `Generated from SPESS ARK • ${generatedAt} • Page ${i} of ${pages}`,
        w / 2,
        h - 8,
        { align: "center" }
      );
    }

    window.open(URL.createObjectURL(doc.output("blob")), "_blank");
  };

  /* ---------- DETAILS CSV ---------- */
  const downloadDetailsCsv = () => {
    if (!detailRows.length) return;

    const header = ["Name", "Class", "Stream", "Subjects", "Added"];
    const rows = detailRows.map((s) => [
      s.name,
      s.class_level,
      s.stream,
      parseSubjects(s.subjects).join("; "),
      s.created_at ? formatDateTime(s.created_at) : "",
    ]);

    const csv = [
      header.join(","),
      ...rows.map((r) =>
        r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    window.open(URL.createObjectURL(blob), "_blank");
  };

  /* ---------- DETAILS PDF ---------- */
  const downloadDetailsPdf = () => {
    if (!detailRows.length) return;

    const doc = new jsPDF("p", "mm", "a4");
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    const generatedAt = new Date().toLocaleString();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("SPESS — Enrollment Details Report", w / 2, 18, { align: "center" });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Class: ${classLevel || "All"}`, 14, 28);
    doc.text(`Stream: ${stream || "All"}`, 14, 34);
    doc.text(`Subject: ${subject || "All Subjects"}`, 14, 40);
    doc.text(`Generated: ${generatedAt}`, 14, 46);

    let y = 58;
    const bottom = 18;

    const drawHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.text("#", 14, y);
      doc.text("Name", 22, y);
      doc.text("Class", 90, y);
      doc.text("Stream", 110, y);
      doc.text("Subjects", 130, y);
      doc.line(12, y + 2, w - 12, y + 2);
      y += 7;
      doc.setFont("helvetica", "normal");
    };

    drawHeader();

    detailRows.forEach((s, i) => {
      const subs = parseSubjects(s.subjects).join(", ");
      const lines = doc.splitTextToSize(subs, w - 140);

      if (y + lines.length * 6 > h - bottom) {
        doc.addPage();
        y = 20;
        drawHeader();
      }

      doc.text(String(i + 1), 14, y);
      doc.text(s.name, 22, y);
      doc.text(s.class_level, 90, y);
      doc.text(s.stream, 110, y);
      doc.text(lines, 130, y);

      y += Math.max(7, lines.length * 6);
    });

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.text(
        `Generated from SPESS ARK • ${generatedAt} • Page ${i} of ${pages}`,
        w / 2,
        h - 8,
        { align: "center" }
      );
    }

    window.open(URL.createObjectURL(doc.output("blob")), "_blank");
  };

  /* ---------- RESET SUBJECT ---------- */
  useEffect(() => {
    setSubject("");
  }, [classLevel, stream]);

  /* ================== UI ================== */

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Enrollment Insights</h2>
          <p>Registration statistics by class, stream and subject.</p>
        </div>
      </div>

      {/* FILTERS */}
      <div className="panel-card" style={{ marginBottom: "0.8rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <select value={classLevel} onChange={(e) => setClassLevel(e.target.value)}>
            <option value="">All classes</option>
            {classOptions.map((c) => <option key={c}>{c}</option>)}
          </select>

          <select value={stream} onChange={(e) => setStream(e.target.value)}>
            <option value="">All streams</option>
            {streamOptions.map((s) => <option key={s}>{s}</option>)}
          </select>

          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">All subjects</option>
            {subjectOptions.map((s) => <option key={s}>{s}</option>)}
          </select>

          <button className="ghost-btn" onClick={() => {
            setClassLevel(""); setStream(""); setSubject("");
          }}>
            Clear
          </button>

          <div style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}>
            <button className="ghost-btn" onClick={() => setViewMode("summary")}>Summary</button>
            <button className="ghost-btn" onClick={() => setViewMode("details")}>Details</button>
          </div>
        </div>
      </div>

      {/* SUMMARY */}
      {viewMode === "summary" && (
        <>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.6rem" }}>
            <button className="ghost-btn" onClick={downloadSummaryCsv}>Export CSV</button>
            <button className="primary-btn" onClick={downloadSummaryPdf}>Export PDF</button>
          </div>

          <div className="teachers-table-wrapper">
            <table className="teachers-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  {streamOptions.map((s) => <th key={s}>{s}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((r) => (
                  <tr key={r.subject}>
                    <td>{r.subject}</td>
                    {streamOptions.map((s) => <td key={s}>{r.counts[s] ?? 0}</td>)}
                    <td>{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* DETAILS */}
      {viewMode === "details" && (
        <>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.6rem" }}>
            <button className="ghost-btn" onClick={downloadDetailsCsv}>Export CSV</button>
            <button className="primary-btn" onClick={downloadDetailsPdf}>Export PDF</button>
          </div>

          <div className="teachers-table-wrapper">
            <table className="teachers-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Stream</th>
                  <th>Subjects</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((s, i) => (
                  <tr key={s.id ?? i}>
                    <td>{i + 1}</td>
                    <td>{s.name}</td>
                    <td>{s.class_level}</td>
                    <td>{s.stream}</td>
                    <td>{parseSubjects(s.subjects).join(", ")}</td>
                    <td>{formatDateTime(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
