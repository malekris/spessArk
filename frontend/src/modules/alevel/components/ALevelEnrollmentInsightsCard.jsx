import { useEffect, useMemo, useState } from "react";
import badge from "../../../assets/badge.png";
import { adminFetch } from "../../../lib/api";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import "./ALevelEnrollmentInsightsCard.css";

const EMPTY_SUMMARY = {
  activeLearners: 0,
  registeredLearners: 0,
  unregisteredLearners: 0,
  subjectRegistrations: 0,
  paperRegistrations: 0,
  subjectsOffered: 0,
};

const formatGeneratedAt = (value) => {
  if (!value) return "Not refreshed";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("en-UG");
};

export default function ALevelEnrollmentInsightsCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [streamFilter, setStreamFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);

  const loadInsights = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await adminFetch("/api/alevel/admin/enrollment-insights");
      setData(response || null);
    } catch (err) {
      console.error("A-Level enrollment insights load error:", err);
      setError(err?.message || "Failed to load A-Level enrollment insights.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInsights();
  }, []);

  const visibleStreams = useMemo(() => {
    const streams = Array.isArray(data?.streams) ? data.streams : [];
    return streamFilter ? streams.filter((stream) => stream === streamFilter) : streams;
  }, [data?.streams, streamFilter]);

  const visiblePapers = useMemo(() => {
    const papers = Array.isArray(data?.papers) ? data.papers : [];
    return papers.filter((paper) => !subjectFilter || paper.subject === subjectFilter);
  }, [data?.papers, subjectFilter]);

  const openPdf = async () => {
    if (!data || !visiblePapers.length) return;
    try {
      setPdfLoading(true);
      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF("l", "mm", "a4");
      const width = doc.internal.pageSize.getWidth();
      const height = doc.internal.pageSize.getHeight();
      const summary = data.summary || EMPTY_SUMMARY;

      doc.addImage(badge, "PNG", 14, 9, 18, 18);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("ST. PHILLIPS EQUATORIAL SECONDARY SCHOOL", width / 2, 16, { align: "center" });
      doc.setFontSize(11);
      doc.text("A-Level Subject and Paper Registration Statistics", width / 2, 23, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(
        `Active learners: ${summary.activeLearners}  |  Subject registrations: ${summary.subjectRegistrations}  |  Paper registrations: ${summary.paperRegistrations}`,
        width / 2,
        29,
        { align: "center" }
      );

      autoTable(doc, {
        startY: 35,
        head: [["Subject", "Paper", ...visibleStreams, "Total"]],
        body: visiblePapers.map((paper) => [
          paper.subject || "—",
          paper.paperLabel || "—",
          ...visibleStreams.map((stream) => String(paper.counts?.[stream] || 0)),
          String(
            streamFilter
              ? visibleStreams.reduce((sum, stream) => sum + Number(paper.counts?.[stream] || 0), 0)
              : paper.total || 0
          ),
        ]),
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 2, textColor: 0, lineColor: [30, 41, 59], lineWidth: 0.14 },
        headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", lineWidth: 0.18 },
        alternateRowStyles: { fillColor: [246, 248, 250] },
        didDrawPage: () => {
          doc.setFontSize(7.5);
          doc.setFont("helvetica", "italic");
          doc.text(
            `SPESS ARK | Generated ${formatGeneratedAt(data.generatedAt)} | Page ${doc.internal.getNumberOfPages()}`,
            width / 2,
            height - 7,
            { align: "center" }
          );
        },
      });

      const blobUrl = URL.createObjectURL(doc.output("blob"));
      window.open(blobUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("A-Level enrollment insights PDF error:", err);
      setError(err?.message || "Failed to open the enrollment statistics PDF.");
    } finally {
      setPdfLoading(false);
    }
  };

  const summary = data?.summary || EMPTY_SUMMARY;
  const subjectOptions = Array.isArray(data?.subjects) ? data.subjects : [];
  const streamOptions = Array.isArray(data?.streams) ? data.streams : [];

  return (
    <section className="alevel-enrollment-insights" aria-labelledby="alevel-enrollment-title">
      <header className="alevel-enrollment-head">
        <div>
          <span className="alevel-enrollment-kicker">Live Candidate Register</span>
          <h2 id="alevel-enrollment-title">A-Level Enrollment Insights</h2>
          <p>Registered learners by subject, paper, and stream.</p>
        </div>
        <div className="alevel-enrollment-actions">
          <button type="button" className="alevel-enrollment-secondary" onClick={loadInsights} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            className="alevel-enrollment-primary"
            onClick={openPdf}
            disabled={loading || pdfLoading || !visiblePapers.length}
          >
            {pdfLoading ? "Preparing PDF..." : "Open PDF"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="alevel-enrollment-state is-error" role="alert">
          <strong>Enrollment statistics unavailable</strong>
          <span>{error}</span>
        </div>
      ) : loading && !data ? (
        <div className="alevel-enrollment-state">Loading the active A-Level register...</div>
      ) : (
        <>
          <div className="alevel-enrollment-metrics" aria-label="A-Level registration totals">
            <div><span>Active learners</span><strong>{summary.activeLearners}</strong></div>
            <div><span>Subjects offered</span><strong>{summary.subjectsOffered}</strong></div>
            <div><span>Subject registrations</span><strong>{summary.subjectRegistrations}</strong></div>
            <div><span>Paper registrations</span><strong>{summary.paperRegistrations}</strong></div>
            <div className={summary.unregisteredLearners > 0 ? "is-warning" : ""}>
              <span>No subjects registered</span><strong>{summary.unregisteredLearners}</strong>
            </div>
          </div>

          <div className="alevel-enrollment-filters">
            <label>
              <span>Stream</span>
              <select value={streamFilter} onChange={(event) => setStreamFilter(event.target.value)}>
                <option value="">All four streams</option>
                {streamOptions.map((stream) => <option key={stream} value={stream}>{stream}</option>)}
              </select>
            </label>
            <label>
              <span>Subject</span>
              <select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}>
                <option value="">All subjects and papers</option>
                {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="alevel-enrollment-clear"
              onClick={() => { setStreamFilter(""); setSubjectFilter(""); }}
              disabled={!streamFilter && !subjectFilter}
            >
              Clear Filters
            </button>
            <time dateTime={data?.generatedAt || undefined}>{formatGeneratedAt(data?.generatedAt)}</time>
          </div>

          <div className="alevel-enrollment-table-wrap">
            <table className="alevel-enrollment-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Paper</th>
                  {visibleStreams.map((stream) => <th key={stream}>{stream}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {visiblePapers.map((paper) => {
                  const filteredTotal = visibleStreams.reduce(
                    (sum, stream) => sum + Number(paper.counts?.[stream] || 0),
                    0
                  );
                  return (
                    <tr key={`${paper.subjectId}-${paper.paperLabel}`}>
                      <td><strong>{paper.subject}</strong></td>
                      <td><span className="alevel-paper-label">{paper.paperLabel}</span></td>
                      {visibleStreams.map((stream) => <td key={stream}>{paper.counts?.[stream] || 0}</td>)}
                      <td><strong>{streamFilter ? filteredTotal : paper.total}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!visiblePapers.length && <div className="alevel-enrollment-empty">No paper registrations match these filters.</div>}
          </div>
        </>
      )}
    </section>
  );
}
