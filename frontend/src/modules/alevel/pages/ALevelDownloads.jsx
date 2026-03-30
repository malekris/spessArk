import React, { useEffect, useMemo, useState } from "react";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import ALevelAdminShell from "../components/ALevelAdminShell";
import "../../../pages/AdminDashboard.css";
import "./ALevelAdminTheme.css";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const ALEVEL_TERMS = ["Term 1", "Term 2", "Term 3"];

const parseStreamContext = (rawStream = "") => {
  const value = String(rawStream || "").trim();
  if (!value) return { classLevel: "A-Level", streamName: "—" };

  const match = value.match(/^(S[56])\s+(.+)$/i);
  if (!match) {
    return { classLevel: "A-Level", streamName: value };
  }

  return {
    classLevel: match[1].toUpperCase(),
    streamName: match[2].trim(),
  };
};

const formatScoreCell = (row = {}) => {
  if (String(row?.status || "").toLowerCase() === "missed") return "Missed";
  if (row?.score === null || row?.score === undefined || row?.score === "") return "—";
  return String(row.score);
};

export default function ALevelDownload() {
  const [sets, setSets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [contents, setContents] = useState({ columns: [], rows: [] });
  const [loadingSets, setLoadingSets] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState("");
  const [scoreSheetFilters, setScoreSheetFilters] = useState({
    stream: "",
    term: "Term 1",
    year: new Date().getFullYear(),
  });
  const [scoreSheetLoading, setScoreSheetLoading] = useState(false);
  const [scoreSheetError, setScoreSheetError] = useState("");

  // --- Theme Constants ---
  const amethyst = "#38bdf8";
  const cinematicBlack = "#0a0c10";
  const glassBg = "rgba(30, 41, 59, 0.45)";
  const platinum = "#f1f5f9";
  const adminHeaders = useMemo(
    () => ({
      "x-admin-key": localStorage.getItem("SPESS_ADMIN_KEY") || "",
      Authorization: `Bearer ${localStorage.getItem("adminToken") || ""}`,
    }),
    []
  );

  /* ---------------- LOAD SETS ---------------- */
  useEffect(() => {
    fetchSets();
  }, []);

  useEffect(() => {
    if (!Array.isArray(sets) || sets.length === 0) return;
    const latest = sets[0];
    setScoreSheetFilters((previous) => ({
      stream: previous.stream || latest.stream || "",
      term: previous.term || latest.term || "Term 1",
      year: previous.year || Number(latest.year) || new Date().getFullYear(),
    }));
  }, [sets]);

  async function fetchSets() {
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/alevel/download/sets`);
      if (!res.ok) throw new Error("Failed to fetch sets");
      const data = await res.json();
      setSets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setError("Failed to load uploaded mark sets.");
    } finally {
      setLoadingSets(false);
    }
  }

  /* ---------------- VIEW SET ---------------- */
  async function viewSet(set) {
    setSelected(set);
    setLoadingPreview(true);
    setError("");

    try {
      const res = await fetch(
        `${API_BASE}/api/alevel/download/sets/${set.setId}`
      );

      if (!res.ok) throw new Error("Failed to load preview");

      const data = await res.json();

      if (!data?.rows || !data?.columns) {
        throw new Error("Invalid preview response");
      }

      setContents(data);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to preview marks");
      setContents({ columns: [], rows: [] });
    } finally {
      setLoadingPreview(false);
    }
  }

  /* ---------------- DELETE SET ---------------- */
  async function deleteSet(e, set) {
    e.stopPropagation();

    if (!confirm(`Delete ${set.subject_display || set.subject} (${set.exam}) Term ${set.term}?`)) return;

    try {
      const res = await fetch(
        `${API_BASE}/api/alevel/download/sets/${set.setId}`,
        { method: "DELETE" }
      );

      if (!res.ok) throw new Error("Delete failed");

      setSets(prev => prev.filter(s => s.setId !== set.setId));

      if (selected?.setId === set.setId) {
        setSelected(null);
        setContents({ columns: [], rows: [] });
      }

    } catch (err) {
      console.error(err);
      setError("Delete failed.");
    }
  }

  const scoreSheetStreams = useMemo(
    () => Array.from(new Set((sets || []).map((set) => String(set.stream || "").trim()).filter(Boolean))).sort(),
    [sets]
  );

  const scoreSheetYears = useMemo(() => {
    const years = Array.from(
      new Set(
        (sets || [])
          .map((set) => Number(set.year))
          .filter((year) => Number.isFinite(year) && year > 0)
      )
    ).sort((a, b) => b - a);
    return years.length > 0 ? years : [new Date().getFullYear()];
  }, [sets]);

  /* ---------------- CSV EXPORT ---------------- */
  function exportCsv() {
    if (!selected || contents.rows.length === 0) return;

    const cols = contents.columns;
    const rows = contents.rows;

    const csv = [
      cols.join(","),
      ...rows.map(r => cols.map(c => `"${r[c] ?? ""}"`).join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `Marks_${(selected.subject_display || selected.subject).replace(/\s+/g, "_")}_Term${selected.term}_${selected.exam}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  }

  /* ---------------- PDF EXPORT ---------------- */
  async function exportPdf() {
    if (!selected || contents.rows.length === 0) return;
    const { jsPDF, autoTable } = await loadPdfTools();

    const doc = new jsPDF("p", "mm", "a4");
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const { classLevel, streamName } = parseStreamContext(selected.stream);

    const school = "St. Phillip's Equatorial Secondary School";
    const title = "A-Level Score Marksheet";
    const subjectLine = selected.subject_display || selected.subject || "—";
    const paperLine =
      selected.paper_label && selected.paper_label !== "Single" ? selected.paper_label : "Single";
    const examLine = selected.exam || "—";
    const termLine = selected.term || "—";
    const yearLine = selected.year || "—";
    const teacher = selected.submitted_by || "—";
    const generated = new Date().toLocaleString();

    const numericScores = contents.rows
      .map((row) => Number(row.score))
      .filter((value) => Number.isFinite(value));

    const totalLearners = contents.rows.length;
    const missedCount = contents.rows.filter(
      (row) => String(row?.status || "").toLowerCase() === "missed"
    ).length;
    const submittedCount = totalLearners - missedCount;
    const averageScore =
      numericScores.length > 0
        ? (numericScores.reduce((sum, value) => sum + value, 0) / numericScores.length).toFixed(2)
        : "—";

    const drawHeader = () => {
      doc.setDrawColor(0);
      doc.setLineWidth(0.35);
      doc.rect(14, 12, W - 28, 34);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(school, W / 2, 19, { align: "center" });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(title, W / 2, 27, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(subjectLine, W / 2, 34, { align: "center" });

      doc.setFontSize(8.8);
      doc.text(`Paper: ${paperLine}`, 18, 41);
      doc.text(`Exam: ${examLine}`, 56, 41);
      doc.text(`Term: ${termLine}`, 92, 41);
      doc.text(`Year: ${yearLine}`, 123, 41);
      doc.text(`Class: ${classLevel}`, 148, 41);
      doc.text(`Stream: ${streamName}`, W - 18, 41, { align: "right" });
    };

    const drawMetaBand = () => {
      doc.setFillColor(245, 245, 245);
      doc.roundedRect(14, 51, W - 28, 18, 2, 2, "F");
      doc.setDrawColor(0);
      doc.setLineWidth(0.2);
      doc.roundedRect(14, 51, W - 28, 18, 2, 2, "S");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.text("Submitted By:", 18, 58);
      doc.text("Generated:", 18, 64);
      doc.text("Learners:", 108, 58);
      doc.text("Submitted:", 108, 64);
      doc.text("Missed:", 150, 58);
      doc.text("Average:", 150, 64);

      doc.setFont("helvetica", "normal");
      doc.text(String(teacher), 42, 58);
      doc.text(String(generated), 35, 64);
      doc.text(String(totalLearners), 126, 58);
      doc.text(String(submittedCount), 126, 64);
      doc.text(String(missedCount), 166, 58);
      doc.text(String(averageScore), 168, 64);
    };

    drawHeader();
    drawMetaBand();

    autoTable(doc, {
      startY: 76,
      head: [["#", "Learner", "Exam", "Status", "Score"]],
      body: contents.rows.map((row, index) => [
        index + 1,
        row.learner || "—",
        row.exam || "—",
        row.status || "—",
        formatScoreCell(row),
      ]),
      theme: "grid",
      margin: { left: 14, right: 14, bottom: 18 },
      headStyles: {
        fillColor: [238, 238, 238],
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.2,
        font: "helvetica",
        fontStyle: "bold",
        halign: "left",
      },
      bodyStyles: {
        font: "helvetica",
        fontSize: 9,
        textColor: [20, 20, 20],
        lineColor: [0, 0, 0],
        lineWidth: 0.15,
      },
      alternateRowStyles: {
        fillColor: [250, 250, 250],
      },
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        1: { cellWidth: 78 },
        2: { cellWidth: 24, halign: "center" },
        3: { cellWidth: 28, halign: "center" },
        4: { cellWidth: 22, halign: "right" },
      },
      didParseCell: (hook) => {
        if (hook.section === "body" && hook.column.index === 3) {
          const statusValue = String(hook.cell.raw || "").toLowerCase();
          if (statusValue === "missed") {
            hook.cell.styles.textColor = [153, 27, 27];
            hook.cell.styles.fontStyle = "bold";
          }
        }
      },
      didDrawPage: () => {
        const pageNumber = doc.internal.getNumberOfPages();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(90);
        doc.text(
          `Generated from SPESS ARK · Submitted by ${teacher} · Page ${pageNumber}`,
          W / 2,
          H - 8,
          { align: "center" }
        );
        doc.setTextColor(0);
      },
    });

    /* ---------------- OPEN AS BLOB (NO DOWNLOAD) ---------------- */
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function handleDownloadScoreSheetPdf() {
    setScoreSheetError("");

    const stream = String(scoreSheetFilters.stream || "").trim();
    const term = String(scoreSheetFilters.term || "").trim();
    const year = Number(scoreSheetFilters.year);

    if (!stream || !term || !year) {
      setScoreSheetError("Select stream, term and year first.");
      return;
    }

    const chunkBy = (list, size) => {
      const out = [];
      for (let index = 0; index < list.length; index += size) {
        out.push(list.slice(index, index + size));
      }
      return out;
    };

    const formatSheetCell = (mark) => {
      if (!mark) return "";
      if (String(mark.status || "").toLowerCase() === "missed") return "Missed";
      if (mark.score === null || mark.score === undefined || mark.score === "") return "";
      const value = Number(mark.score);
      return Number.isFinite(value) ? String(Number(value.toFixed(2))) : String(mark.score);
    };

    setScoreSheetLoading(true);
    try {
      const params = new URLSearchParams({
        stream,
        term,
        year: String(year),
      });
      const res = await fetch(`${API_BASE}/api/alevel/download/score-sheet?${params.toString()}`, {
        headers: adminHeaders,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.message || "Failed to load A-Level score sheet data.");
      }

      const learners = Array.isArray(data?.learners) ? data.learners : [];
      const papers = Array.isArray(data?.papers) ? data.papers : [];
      const marks = Array.isArray(data?.marks) ? data.marks : [];

      if (learners.length === 0) {
        setScoreSheetError("No learners found in that A-Level stream.");
        return;
      }

      if (papers.length === 0) {
        setScoreSheetError("No submitted A-Level paper marks found for that stream, term and year.");
        return;
      }

      const markMap = new Map(
        marks.map((mark) => [
          `${mark.learner_id}|${mark.assignment_id}|${String(mark.exam_name || "").toUpperCase()}`,
          mark,
        ])
      );

      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF("l", "mm", "a4");
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const generatedAt = new Date().toLocaleString();
      const { classLevel, streamName } = parseStreamContext(stream);
      const paperChunks = chunkBy(papers, 4);
      const componentColumnCount = 8; // 4 papers × 2 columns
      const numberColWidth = 7;
      const learnerColWidth = 55;
      const genderColWidth = 7;
      const paperScoreWidth =
        (pageW - 16 - numberColWidth - learnerColWidth - genderColWidth) / componentColumnCount;

      paperChunks.forEach((paperChunk, chunkIndex) => {
        if (chunkIndex > 0) doc.addPage();

        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("St. Phillip's Equatorial Secondary School (SPESS)", pageW / 2, 12, {
          align: "center",
        });
        doc.text("Noticeboard Score Sheet", pageW / 2, 18, { align: "center" });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.text(`Class: ${classLevel}`, 8, 25);
        doc.text(`Stream: ${streamName}`, 48, 25);
        doc.text(`Term: ${term}`, 98, 25);
        doc.text(`Year: ${year}`, 140, 25);
        doc.text(`Papers ${chunkIndex * 4 + 1}-${chunkIndex * 4 + paperChunk.length}`, 178, 25);

        const headTop = [
          { content: "#", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
          { content: "Learner", rowSpan: 2, styles: { halign: "left", valign: "middle" } },
          { content: "G", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
          ...paperChunk.map((paper) => ({
            content: String(paper.subject_display || paper.subject || "Paper"),
            colSpan: 2,
            styles: { halign: "center", valign: "middle" },
          })),
        ];

        const headBottom = [
          ...paperChunk.flatMap(() => ["MID", "EOT"]),
        ];

        const body = learners.map((learner, index) => {
          const row = [
            index + 1,
            learner.name || "",
            String(learner.gender || "").slice(0, 1).toUpperCase(),
          ];

          paperChunk.forEach((paper) => {
            ["MID", "EOT"].forEach((examName) => {
              const mark = markMap.get(`${learner.id}|${paper.assignment_id}|${examName}`);
              row.push(formatSheetCell(mark));
            });
          });

          return row;
        });

        autoTable(doc, {
          startY: 32,
          margin: { left: 8, right: 8, bottom: 12 },
          head: [headTop, headBottom],
          body,
          theme: "grid",
          styles: {
            font: "helvetica",
            fontSize: 12,
            cellPadding: 1.2,
            lineColor: [170, 177, 184],
            lineWidth: 0.15,
            textColor: [15, 23, 42],
            halign: "center",
          },
          headStyles: {
            fillColor: [230, 236, 244],
            textColor: [15, 23, 42],
            fontStyle: "bold",
            fontSize: 12,
          },
          bodyStyles: {
            fillColor: [255, 255, 255],
          },
          columnStyles: {
            0: { cellWidth: numberColWidth, halign: "center" },
            1: { cellWidth: learnerColWidth, halign: "left" },
            2: { cellWidth: genderColWidth, halign: "center" },
            ...Object.fromEntries(
              Array.from({ length: componentColumnCount }, (_, idx) => [
                3 + idx,
                { cellWidth: paperScoreWidth, halign: "center" },
              ])
            ),
          },
        });
      });

      const totalPages = doc.internal.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.text(
          `Generated from SPESS ARK · ${generatedAt} · Page ${page} of ${totalPages}`,
          pageW / 2,
          pageH - 8,
          { align: "center" }
        );
      }

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error("A-Level score sheet PDF error:", err);
      setScoreSheetError(err.message || "Failed to generate A-Level score sheet PDF.");
    } finally {
      setScoreSheetLoading(false);
    }
  }

  // Helper for Close button
  const closePreview = () => {
    setSelected(null);
    setContents({ columns: [], rows: [] });
  };

  /* ---------------- UI ---------------- */
  return (
    <ALevelAdminShell
      title="Data Center"
      subtitle="Review archived A-Level submissions, preview mark sets, and export clean teacher records from one place."
    >
      {({ isDark }) => {
        const surfaceText = isDark ? platinum : "#0f172a";
        const surfaceMuted = isDark ? "rgba(241, 245, 249, 0.72)" : "#475569";
        const surfacePanel = isDark
          ? glassBg
          : "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(241,245,249,0.94))";
        const borderColor = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.08)";
        const previewShell = isDark ? "rgba(0,0,0,0.2)" : "rgba(248,250,252,0.92)";
        const tableHead = isDark ? "rgba(0,0,0,0.4)" : "rgba(226, 232, 240, 0.94)";
        const rowBorder = isDark ? "rgba(255,255,255,0.03)" : "rgba(148, 163, 184, 0.18)";
        const buttonSecondary = {
          background: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(255,255,255,0.88)",
          color: surfaceText,
          border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.12)"}`,
          padding: "8px 16px",
          borderRadius: "10px",
          cursor: "pointer",
          fontSize: "0.75rem",
          fontWeight: "700",
          transition: "all 0.2s",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "148px",
          minHeight: "42px",
          boxShadow: isDark ? "0 10px 24px rgba(2, 6, 23, 0.32)" : "0 10px 24px rgba(15, 23, 42, 0.10)",
        };
        const buttonPrimary = {
          ...buttonSecondary,
          background: amethyst,
          color: cinematicBlack,
          border: "none",
        };

        return (
          <>
            <style>
              {`
                @keyframes cinematicFadeIn {
                  from { opacity: 0; transform: translateY(10px); }
                  to { opacity: 1; transform: translateY(0); }
                }
                .animate-fade {
                  animation: cinematicFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
                .alevel-download-grid {
                  display: grid;
                  grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
                  gap: 2rem;
                  align-items: start;
                }
                .alevel-download-registry {
                  display: flex;
                  flex-direction: column;
                  gap: 0.75rem;
                  max-height: min(72vh, 920px);
                  overflow-y: auto;
                  padding-right: 0.35rem;
                  scrollbar-width: thin;
                  scrollbar-color: rgba(56, 189, 248, 0.6) rgba(148, 163, 184, 0.12);
                }
                .alevel-download-registry::-webkit-scrollbar {
                  width: 10px;
                }
                .alevel-download-registry::-webkit-scrollbar-track {
                  background: rgba(148, 163, 184, 0.12);
                  border-radius: 999px;
                }
                .alevel-download-registry::-webkit-scrollbar-thumb {
                  background: linear-gradient(180deg, rgba(56, 189, 248, 0.78), rgba(14, 165, 233, 0.62));
                  border-radius: 999px;
                  border: 2px solid transparent;
                  background-clip: padding-box;
                }
                @media (max-width: 1180px) {
                  .alevel-download-grid {
                    grid-template-columns: 1fr;
                  }
                  .alevel-download-registry {
                    max-height: 55vh;
                  }
                }
              `}
            </style>

            <div
              style={{
                position: "relative",
                minHeight: "280px",
                width: "100%",
                backgroundImage: `linear-gradient(to bottom, ${
                  isDark ? "rgba(10, 12, 16, 0.1), #0a0c10" : "rgba(248, 250, 252, 0.05), rgba(248, 250, 252, 0.94)"
                }), url('/celine.jpg')`,
                backgroundSize: "cover",
                backgroundPosition: "center 20%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                padding: "0 2rem 2rem",
                borderRadius: "0 0 28px 28px",
                overflow: "hidden",
              }}
            >
              <h1
                style={{
                  fontSize: "3rem",
                  fontWeight: "900",
                  margin: 0,
                  color: surfaceText,
                  textShadow: isDark ? "0 4px 20px rgba(0,0,0,0.6)" : "0 1px 4px rgba(255,255,255,0.7)",
                }}
              >
                Archives <span style={{ color: amethyst }}>Download</span>
              </h1>
              <p style={{ fontSize: "1.05rem", color: surfaceMuted, maxWidth: "620px", marginTop: "0.55rem" }}>
                Encrypted access to academic performance records with a cleaner shared A-Level navigation shell.
              </p>
            </div>

            <div style={{ maxWidth: "1400px", margin: "-40px auto 0 auto", padding: "0 0.25rem", position: "relative", zIndex: 10 }}>
              {error && (
                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.2)",
                    color: isDark ? "#fca5a5" : "#991b1b",
                    padding: "1rem",
                    borderRadius: "12px",
                    marginBottom: "1.5rem",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  {error}
                </div>
              )}

              <div className="alevel-download-grid">
                <div
                  style={{
                    background: surfacePanel,
                    backdropFilter: "blur(12px)",
                    borderRadius: "24px",
                    padding: "1.5rem",
                    border: `1px solid ${borderColor}`,
                    boxShadow: isDark
                      ? "0 8px 32px 0 rgba(0, 0, 0, 0.37)"
                      : "0 18px 38px rgba(15, 23, 42, 0.09)",
                  }}
                >
                  <h3
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: "900",
                      color: amethyst,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      marginBottom: "1.5rem",
                    }}
                  >
                    Registry
                  </h3>

                  {loadingSets ? (
                    <p style={{ color: surfaceMuted, fontSize: "0.9rem" }}>Syncing Database...</p>
                  ) : (
                    <div className="alevel-download-registry">
                      {sets.length === 0 ? (
                        <p style={{ color: surfaceMuted, textAlign: "center", padding: "2rem 0" }}>Empty Registry</p>
                      ) : (
                        sets.map((set) => (
                          <div
                            key={set.setId}
                            onClick={() => viewSet(set)}
                            style={{
                              padding: "1rem",
                              borderRadius: "16px",
                              background:
                                selected?.setId === set.setId
                                  ? "rgba(56, 189, 248, 0.12)"
                                  : isDark
                                  ? "rgba(255, 255, 255, 0.03)"
                                  : "rgba(255, 255, 255, 0.78)",
                              border: `1px solid ${
                                selected?.setId === set.setId ? amethyst : isDark ? "rgba(255,255,255,0.05)" : "rgba(15,23,42,0.08)"
                              }`,
                              cursor: "pointer",
                              transition: "all 0.2s ease",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                              <div style={{ flex: 1 }}>
                                <div
                                  style={{
                                    fontWeight: "800",
                                    fontSize: "1rem",
                                    color: selected?.setId === set.setId ? amethyst : surfaceText,
                                  }}
                                >
                                  {set.subject_display || set.subject}
                                </div>
                                <div style={{ fontSize: "0.75rem", color: surfaceMuted }}>
                                  {(set.paper_label && set.paper_label !== "Single" ? `${set.paper_label} • ` : "")}
                                  {set.exam} • Term {set.term}
                                </div>
                                <div style={{ fontSize: "0.7rem", color: surfaceMuted, fontStyle: "italic", marginTop: "2px" }}>
                                  {set.submitted_by}
                                </div>
                              </div>

                              <button
                                onClick={(e) => deleteSet(e, set)}
                                style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", opacity: 0.7 }}
                              >
                                <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                                  <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                                  <path
                                    fillRule="evenodd"
                                    d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
                                  />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: surfacePanel,
                    backdropFilter: "blur(12px)",
                    borderRadius: "24px",
                    padding: "1.5rem",
                    border: `1px solid ${borderColor}`,
                    boxShadow: isDark
                      ? "0 8px 32px 0 rgba(0, 0, 0, 0.37)"
                      : "0 18px 38px rgba(15, 23, 42, 0.09)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", gap: "1rem", flexWrap: "wrap" }}>
                    <h3
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: "900",
                        color: amethyst,
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                      }}
                    >
                      Data Matrix Preview
                    </h3>

                    {selected && !loadingPreview && (
                      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                        <button onClick={exportCsv} style={buttonSecondary}>
                          Download CSV
                        </button>
                        <button onClick={exportPdf} style={buttonPrimary}>
                          Download PDF
                        </button>
                        <button
                          onClick={closePreview}
                          style={{
                            background: "#ef4444",
                            color: "#fff",
                            border: "none",
                            padding: "8px 14px",
                            borderRadius: "10px",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            fontWeight: "800",
                          }}
                        >
                          Close
                        </button>
                      </div>
                    )}
                  </div>

                  {!selected ? (
                    <div style={{ textAlign: "center", padding: "8rem 0", color: surfaceMuted }}>
                      <p>Awaiting record selection...</p>
                    </div>
                  ) : loadingPreview ? (
                    <div style={{ textAlign: "center", padding: "8rem 0" }}>
                      <div style={{ color: amethyst, fontWeight: "600" }}>Parsing Recordset...</div>
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                          gap: "0.85rem",
                          marginBottom: "1rem",
                        }}
                      >
                        {[
                          { label: "Subject", value: selected.subject_display || selected.subject || "—" },
                          { label: "Class", value: parseStreamContext(selected.stream).classLevel },
                          { label: "Stream", value: parseStreamContext(selected.stream).streamName },
                          { label: "Submitted By", value: selected.submitted_by || "—" },
                          { label: "Exam", value: selected.exam || "—" },
                          { label: "Term / Year", value: `${selected.term || "—"} / ${selected.year || "—"}` },
                        ].map((item) => (
                          <div
                            key={item.label}
                            style={{
                              borderRadius: "14px",
                              border: `1px solid ${borderColor}`,
                              background: previewShell,
                              padding: "0.9rem 1rem",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "0.65rem",
                                textTransform: "uppercase",
                                letterSpacing: "0.14em",
                                color: amethyst,
                                fontWeight: 900,
                                marginBottom: "0.25rem",
                              }}
                            >
                              {item.label}
                            </div>
                            <div style={{ color: surfaceText, fontWeight: 700 }}>{item.value}</div>
                          </div>
                        ))}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "stretch",
                          gap: "0.9rem",
                          borderRadius: "14px",
                          border: `1px solid ${borderColor}`,
                          background: previewShell,
                          padding: "0.9rem 1rem",
                          marginBottom: "1rem",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: "0.68rem",
                              textTransform: "uppercase",
                              letterSpacing: "0.14em",
                              color: amethyst,
                              fontWeight: 900,
                              marginBottom: "0.22rem",
                            }}
                          >
                            Export Actions
                          </div>
                          <div style={{ color: surfaceMuted, fontSize: "0.82rem" }}>
                            Download this A-Level marks set as PDF or CSV.
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            gap: "0.75rem",
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <button onClick={exportCsv} style={buttonSecondary}>
                            Download CSV
                          </button>
                          <button onClick={exportPdf} style={buttonPrimary}>
                            Download PDF
                          </button>
                        </div>
                      </div>

                      <div
                        key={selected.setId}
                        className="animate-fade"
                        style={{
                          overflowX: "auto",
                          borderRadius: "16px",
                          background: previewShell,
                          border: `1px solid ${borderColor}`,
                        }}
                      >
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", color: surfaceText }}>
                          <thead>
                            <tr style={{ background: tableHead, borderBottom: `1px solid ${borderColor}` }}>
                              {contents.columns.map((column) => (
                                <th
                                  key={column}
                                  style={{
                                    padding: "14px",
                                    textAlign: "left",
                                    color: amethyst,
                                    fontSize: "0.65rem",
                                    textTransform: "uppercase",
                                    fontWeight: "900",
                                  }}
                                >
                                  {column.replaceAll("_", " ")}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {contents.rows.map((row, index) => (
                              <tr key={index} style={{ borderBottom: `1px solid ${rowBorder}` }}>
                                {contents.columns.map((column) => (
                                  <td key={column} style={{ padding: "12px 14px", color: surfaceMuted }}>
                                    {column === "score" ? formatScoreCell(row) : row[column] ?? "—"}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div
                style={{
                  marginTop: "1.5rem",
                  background: surfacePanel,
                  backdropFilter: "blur(12px)",
                  borderRadius: "24px",
                  padding: "1.5rem",
                  border: `1px solid ${borderColor}`,
                  boxShadow: isDark
                    ? "0 8px 32px 0 rgba(0, 0, 0, 0.37)"
                    : "0 18px 38px rgba(15, 23, 42, 0.09)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "1rem",
                    flexWrap: "wrap",
                    marginBottom: "1rem",
                  }}
                >
                  <div>
                    <h3
                      style={{
                        fontSize: "1rem",
                        fontWeight: "900",
                        color: surfaceText,
                        marginBottom: "0.35rem",
                      }}
                    >
                      Noticeboard Score Sheet (PDF)
                    </h3>
                    <div style={{ color: surfaceMuted, fontSize: "0.9rem" }}>
                      Generate a noticeboard-ready A-Level score sheet by stream for MID and EOT.
                    </div>
                  </div>
                  <div style={{ color: surfaceMuted, fontSize: "0.82rem", fontWeight: 700 }}>
                    Landscape A4 · 4 papers per page · Helvetica 12
                  </div>
                </div>

                {scoreSheetError && (
                  <div
                    style={{
                      marginBottom: "1rem",
                      padding: "0.85rem 1rem",
                      borderRadius: "14px",
                      background: isDark ? "rgba(127, 29, 29, 0.22)" : "rgba(254, 226, 226, 0.95)",
                      border: "1px solid rgba(239, 68, 68, 0.24)",
                      color: isDark ? "#fecaca" : "#991b1b",
                    }}
                  >
                    {scoreSheetError}
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                    gap: "0.9rem",
                    alignItems: "end",
                  }}
                >
                  <label style={{ display: "grid", gap: "0.38rem" }}>
                    <span style={{ color: amethyst, fontSize: "0.72rem", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      Stream
                    </span>
                    <select
                      className="admin-ops-select"
                      value={scoreSheetFilters.stream}
                      onChange={(event) =>
                        setScoreSheetFilters((previous) => ({ ...previous, stream: event.target.value }))
                      }
                    >
                      <option value="">Select stream</option>
                      {scoreSheetStreams.map((streamValue) => (
                        <option key={streamValue} value={streamValue}>
                          {streamValue}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: "0.38rem" }}>
                    <span style={{ color: amethyst, fontSize: "0.72rem", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      Term
                    </span>
                    <select
                      className="admin-ops-select"
                      value={scoreSheetFilters.term}
                      onChange={(event) =>
                        setScoreSheetFilters((previous) => ({ ...previous, term: event.target.value }))
                      }
                    >
                      {ALEVEL_TERMS.map((termValue) => (
                        <option key={termValue} value={termValue}>
                          {termValue}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: "0.38rem" }}>
                    <span style={{ color: amethyst, fontSize: "0.72rem", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      Year
                    </span>
                    <select
                      className="admin-ops-select"
                      value={scoreSheetFilters.year}
                      onChange={(event) =>
                        setScoreSheetFilters((previous) => ({
                          ...previous,
                          year: Number(event.target.value) || previous.year,
                        }))
                      }
                    >
                      {scoreSheetYears.map((yearValue) => (
                        <option key={yearValue} value={yearValue}>
                          {yearValue}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    onClick={handleDownloadScoreSheetPdf}
                    style={{
                      ...buttonPrimary,
                      width: "100%",
                      minHeight: "46px",
                    }}
                    disabled={scoreSheetLoading}
                  >
                    {scoreSheetLoading ? "Generating PDF…" : "Generate Score Sheet PDF"}
                  </button>
                </div>
              </div>
            </div>
          </>
        );
      }}
    </ALevelAdminShell>
  );
}
