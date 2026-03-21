import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import useIdleLogout from "../../../hooks/useIdleLogout";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import ALevelAdminShell from "../components/ALevelAdminShell";
import "../../../pages/AdminDashboard.css";
import "./ALevelAdminTheme.css";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export default function ALevelDownload() {
  const navigate = useNavigate();
  const IDLE_20_MIN = 20 * 60 * 1000;

  const [sets, setSets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [contents, setContents] = useState({ columns: [], rows: [] });
  const [loadingSets, setLoadingSets] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState("");

  // --- Theme Constants ---
  const amethyst = "#38bdf8";
  const cinematicBlack = "#0a0c10";
  const glassBg = "rgba(30, 41, 59, 0.45)";
  const platinum = "#f1f5f9";

  /* ---------------- LOAD SETS ---------------- */
  useEffect(() => {
    fetchSets();
  }, []);

  useIdleLogout(() => {
    localStorage.removeItem("SPESS_ADMIN_KEY");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("adminToken");
    sessionStorage.removeItem("isAdmin");
    navigate("/ark", { replace: true });
  }, IDLE_20_MIN);

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
    const { jsPDF } = await loadPdfTools();
  
    const doc = new jsPDF("p", "mm", "a4");
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
  
    const school = "St. Phillip's Equatorial Secondary School";
    const title = `${selected.subject_display || selected.subject} — ${selected.exam} (Term ${selected.term})`;
    const teacher = selected.submitted_by || "—";
    const generated = new Date().toLocaleString();
  
    /* ---------------- HEADER ---------------- */
    function drawHeader() {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text(school, W / 2, 18, { align: "center" });
  
      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.text(title, W / 2, 26, { align: "center" });
  
      doc.setDrawColor(200);
      doc.line(14, 30, W - 14, 30);
  
      doc.setFontSize(9);
      doc.text(`Teacher: ${teacher}`, 14, 36);
      doc.text(`Generated: ${generated}`, 14, 42);
    }
  
    /* ---------------- FOOTER ---------------- */
    function drawFooter(page, total) {
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Generated from SPESS ARK · Page ${page} of ${total}`,
        W / 2,
        H - 10,
        { align: "center" }
      );
      doc.setTextColor(0);
    }
  
    /* ---------------- TABLE HEADER ---------------- */
    function drawTableHeader(y) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
  
      doc.text("#", 14, y);
      doc.text("Student Name", 28, y);
      doc.text("Exam", 125, y);
      doc.text("Score", W - 14, y, { align: "right" });
  
      doc.setDrawColor(220);
      doc.line(14, y + 2, W - 14, y + 2);
  
      doc.setFont("helvetica", "normal");
      return y + 8;
    }
  
    /* ---------------- RENDER ---------------- */
    drawHeader();
    let y = drawTableHeader(52);
  
    const rowHeight = 7;
    const bottomMargin = 18;
  
    contents.rows.forEach((r, i) => {
      if (y + rowHeight > H - bottomMargin) {
        doc.addPage();
        drawHeader();
        y = drawTableHeader(52);
      }
  
      doc.text(String(i + 1), 14, y);
      doc.text(String(r.learner ?? "—").slice(0, 45), 28, y);
      doc.text(String(r.exam ?? "—"), 125, y);
      doc.text(String(r.score ?? "—"), W - 14, y, { align: "right" });
  
      y += rowHeight;
    });
  
    /* ---------------- FOOTERS ---------------- */
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      drawFooter(i, pages);
    }
  
    /* ---------------- OPEN AS BLOB (NO DOWNLOAD) ---------------- */
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  
    setTimeout(() => URL.revokeObjectURL(url), 60000);
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

              <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: "2rem", alignItems: "start" }}>
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
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "600px", overflowY: "auto" }}>
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
                          Export CSV
                        </button>
                        <button onClick={exportPdf} style={buttonPrimary}>
                          Generate PDF
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
                                {column.replace("_", " ")}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {contents.rows.map((row, index) => (
                            <tr key={index} style={{ borderBottom: `1px solid ${rowBorder}` }}>
                              {contents.columns.map((column) => (
                                <td key={column} style={{ padding: "12px 14px", color: surfaceMuted }}>
                                  {row[column] ?? "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      }}
    </ALevelAdminShell>
  );
}
