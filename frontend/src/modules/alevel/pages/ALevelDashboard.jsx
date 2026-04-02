import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AssessmentSubmissionTracker from "../../../components/AssessmentSubmissionTracker";
import ALevelAdminShell from "../components/ALevelAdminShell";
import { adminFetch, plainFetch } from "../../../lib/api";
import badge from "../../../assets/badge.png";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import "../../../pages/AdminDashboard.css";
import "./ALevelAdminTheme.css";

const ALEVEL_TERMS = ["Term 1", "Term 2", "Term 3"];
const ALEVEL_TERM_ORDER = { "Term 1": 1, "Term 2": 2, "Term 3": 3 };

const normalizeAlevelTerm = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.includes("1")) return "Term 1";
  if (raw.includes("2")) return "Term 2";
  if (raw.includes("3")) return "Term 3";
  return String(value || "").trim() || "Term 1";
};

const normalizeAlevelComponent = (value = "") => String(value || "").trim().toUpperCase();

const getLatestAlevelPeriod = (sets = []) => {
  const normalized = (Array.isArray(sets) ? sets : [])
    .map((set) => ({
      term: normalizeAlevelTerm(set.term),
      year: Number(set.year),
    }))
    .filter((set) => Number.isFinite(set.year) && set.term);

  if (normalized.length === 0) {
    return { term: "Term 1", year: new Date().getFullYear() };
  }

  return normalized.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return (ALEVEL_TERM_ORDER[b.term] || 0) - (ALEVEL_TERM_ORDER[a.term] || 0);
  })[0];
};

const getCoverageTone = (rate) => {
  if (rate >= 85) return "#22c55e";
  if (rate >= 60) return "#f59e0b";
  return "#ef4444";
};

const formatExecutiveTimestamp = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
};

const summarizeCandidateIssues = (candidate) =>
  (Array.isArray(candidate?.missingDetails) ? candidate.missingDetails : [])
    .map((detail) => `${detail.subjectDisplay}: ${detail.components.join(", ")}`)
    .join(" • ");

const openNamedPdfPreview = (doc, filename, title) => {
  const blob = doc.output("blob");
  const blobUrl = URL.createObjectURL(blob);
  const preview = window.open("", "_blank");

  if (!preview) {
    window.open(blobUrl, "_blank");
    return;
  }

  preview.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body { margin: 0; font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; }
          .bar {
            height: 48px; display: flex; align-items: center; justify-content: space-between;
            padding: 0 12px; border-bottom: 1px solid #334155; background: #111827;
          }
          .title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70vw; }
          .btn {
            text-decoration: none; background: #2563eb; color: #fff; padding: 8px 12px;
            border-radius: 8px; font-size: 12px; font-weight: 700;
          }
          iframe { width: 100vw; height: calc(100vh - 48px); border: 0; display: block; background: #fff; }
        </style>
      </head>
      <body>
        <div class="bar">
          <div class="title">${title}</div>
          <a class="btn" href="${blobUrl}" download="${filename}">Download PDF</a>
        </div>
        <iframe src="${blobUrl}" title="${title}"></iframe>
      </body>
    </html>
  `);
  preview.document.close();
};

const generateExecutiveSnapshotPdf = async (insights) => {
  const { jsPDF, autoTable } = await loadPdfTools();
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.addImage(badge, "PNG", 14, 10, 18, 18);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("ST. PHILLIPS EQUATORIAL SECONDARY SCHOOL", pageWidth / 2, 17, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("A-Level Executive Snapshot", pageWidth / 2, 24, { align: "center" });
  doc.text(`${insights.term} • ${insights.year}`, pageWidth / 2, 29, { align: "center" });
  doc.text(`Generated: ${formatExecutiveTimestamp(insights.generatedAt)}`, pageWidth / 2, 34, { align: "center" });
  doc.line(14, 39, pageWidth - 14, 39);

  autoTable(doc, {
    startY: 45,
    head: [[
      "Candidates",
      "Ready",
      "Incomplete",
      "Missing MID",
      "Missing EOT",
      "Missing Paper 1",
      "Missing Paper 2",
    ]],
    body: [[
      String(insights.summary.totalCandidates || 0),
      String(insights.summary.readyCandidates || 0),
      String(insights.summary.incompleteCandidates || 0),
      String(insights.summary.missingMidCandidates || 0),
      String(insights.summary.missingEotCandidates || 0),
      String(insights.summary.missingPaper1Candidates || 0),
      String(insights.summary.missingPaper2Candidates || 0),
    ]],
    theme: "grid",
    styles: { fontSize: 8.2, cellPadding: 1.8, textColor: 0, lineColor: [15, 23, 42], lineWidth: 0.15 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", lineColor: [15, 23, 42], lineWidth: 0.18 },
    alternateRowStyles: { fillColor: [255, 255, 255] },
  });

  doc.setFont("helvetica", "bold");
  doc.text("Candidate Eligibility Watchlist", 14, doc.lastAutoTable.finalY + 8);

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 11,
    head: [["Learner", "Stream", "Combination", "Missing Detail"]],
    body: (insights.candidates || [])
      .filter((candidate) => !candidate.isReady)
      .map((candidate) => [
        candidate.learnerName || "—",
        candidate.stream || "—",
        candidate.combination || "—",
        summarizeCandidateIssues(candidate) || "Incomplete",
      ]),
    theme: "grid",
    styles: { fontSize: 7.8, cellPadding: 1.8, textColor: 0, lineColor: [15, 23, 42], lineWidth: 0.15 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", lineColor: [15, 23, 42], lineWidth: 0.18 },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.text(
        `SPESS ARK • A-Level Executive Snapshot • ${insights.term} ${insights.year}`,
        pageWidth / 2,
        pageHeight - 8,
        { align: "center" }
      );
    },
  });

  doc.addPage();
  doc.addImage(badge, "PNG", 14, 10, 18, 18);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Paper Coverage Matrix", pageWidth / 2, 18, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${insights.term} • ${insights.year}`, pageWidth / 2, 24, { align: "center" });

  autoTable(doc, {
    startY: 32,
    head: [["Paper", "Expected", "MID", "EOT", "Teachers"]],
    body: (insights.paperCoverage || []).map((row) => [
      row.subjectDisplay || "—",
      String(row.expectedCount || 0),
      `${row.midCapturedCount || 0}/${row.expectedCount || 0} (${row.midRate || 0}%)`,
      `${row.eotCapturedCount || 0}/${row.expectedCount || 0} (${row.eotRate || 0}%)`,
      Array.isArray(row.teachers) ? row.teachers.join(", ") : "—",
    ]),
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.7, textColor: 0, lineColor: [15, 23, 42], lineWidth: 0.15 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", lineColor: [15, 23, 42], lineWidth: 0.18 },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.text(
        `SPESS ARK • A-Level Executive Snapshot • ${insights.term} ${insights.year}`,
        pageWidth / 2,
        pageHeight - 8,
        { align: "center" }
      );
    },
  });

  const filename = `ALevel_Executive_Snapshot_${String(insights.term || "Term").replace(/\s+/g, "_")}_${insights.year || ""}.pdf`;
  const title = `A-Level Executive Snapshot - ${insights.term || ""} ${insights.year || ""}`.trim();
  openNamedPdfPreview(doc, filename, title);
};

const generateMissingPapersWatchlistPdf = async (insights) => {
  const { jsPDF, autoTable } = await loadPdfTools();
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.addImage(badge, "PNG", 14, 10, 18, 18);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("ST. PHILLIPS EQUATORIAL SECONDARY SCHOOL", pageWidth / 2, 17, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Missing Papers Watchlist", pageWidth / 2, 24, { align: "center" });
  doc.text(`${insights.term} • ${insights.year}`, pageWidth / 2, 29, { align: "center" });
  doc.text(`Generated: ${formatExecutiveTimestamp(insights.generatedAt)}`, pageWidth / 2, 34, { align: "center" });
  doc.line(14, 39, pageWidth - 14, 39);

  autoTable(doc, {
    startY: 45,
    head: [["Learner", "Stream", "Combination", "Missing Detail"]],
    body: (insights.candidates || [])
      .filter((candidate) => !candidate.isReady)
      .map((candidate) => [
        candidate.learnerName || "—",
        candidate.stream || "—",
        candidate.combination || "—",
        summarizeCandidateIssues(candidate) || "Incomplete",
      ]),
    theme: "grid",
    styles: {
      fontSize: 8,
      cellPadding: 1.8,
      textColor: 0,
      lineColor: [15, 23, 42],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: 0,
      fontStyle: "bold",
      lineColor: [15, 23, 42],
      lineWidth: 0.18,
    },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.text(
        `SPESS ARK • Missing Papers Watchlist • ${insights.term} ${insights.year}`,
        pageWidth / 2,
        pageHeight - 8,
        { align: "center" }
      );
    },
  });

  const filename = `ALevel_Missing_Papers_Watchlist_${String(insights.term || "Term").replace(/\s+/g, "_")}_${insights.year || ""}.pdf`;
  const title = `A-Level Missing Papers Watchlist - ${insights.term || ""} ${insights.year || ""}`.trim();
  openNamedPdfPreview(doc, filename, title);
};

export default function ALevelDashboard() {
  const navigate = useNavigate();

  const [stats, setStats] = useState(null);
  const [hoveredStat, setHoveredStat] = useState(null);
  const [hoveredAction, setHoveredAction] = useState(null);
  const [showTracker, setShowTracker] = useState(false);
  const [trackerMarksSets, setTrackerMarksSets] = useState([]);
  const [trackerSubjects, setTrackerSubjects] = useState([]);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState("");
  const [readinessAssignments, setReadinessAssignments] = useState([]);
  const [readinessMarksSets, setReadinessMarksSets] = useState([]);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState("");
  const [selectedReadinessTerm, setSelectedReadinessTerm] = useState("Term 1");
  const [selectedReadinessYear, setSelectedReadinessYear] = useState(new Date().getFullYear());
  const [readinessSelectionSeeded, setReadinessSelectionSeeded] = useState(false);
  const [showMoreInsights, setShowMoreInsights] = useState(false);
  const [dashboardInsights, setDashboardInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");
  const [executivePdfLoading, setExecutivePdfLoading] = useState(false);
  const [watchlistPdfLoading, setWatchlistPdfLoading] = useState(false);

  useEffect(() => {
    plainFetch("/api/alevel/stats")
      .then(setStats)
      .catch(console.error);
  }, []);

  useEffect(() => {
    const loadReadinessData = async () => {
      setReadinessLoading(true);
      setReadinessError("");
      try {
        const [assignments, marksSets] = await Promise.all([
          adminFetch("/api/alevel/admin/assignments"),
          adminFetch("/api/alevel/admin/marks-sets"),
        ]);

        setReadinessAssignments(Array.isArray(assignments) ? assignments : []);
        setReadinessMarksSets(Array.isArray(marksSets) ? marksSets : []);

        if (!readinessSelectionSeeded) {
          const latest = getLatestAlevelPeriod(marksSets);
          setSelectedReadinessTerm(latest.term);
          setSelectedReadinessYear(latest.year);
          setReadinessSelectionSeeded(true);
        }
      } catch (err) {
        console.error("A-Level readiness load error:", err);
        setReadinessError(err.message || "Failed to load readiness summary.");
      } finally {
        setReadinessLoading(false);
      }
    };

    loadReadinessData();
  }, [readinessSelectionSeeded]);

  const fetchAlevelTrackerData = async () => {
    setTrackerLoading(true);
    setTrackerError("");
    try {
      const [setsData, subjectsData] = await Promise.all([
        adminFetch("/api/alevel/admin/marks-sets"),
        plainFetch("/api/alevel/subjects"),
      ]);

      setTrackerMarksSets(Array.isArray(setsData) ? setsData : []);
      setTrackerSubjects(
        Array.isArray(subjectsData)
          ? subjectsData.map((s) => s.name).filter(Boolean)
          : []
      );
    } catch (err) {
      setTrackerError(err.message || "Failed to load tracker data");
    } finally {
      setTrackerLoading(false);
    }
  };

  const openTracker = async () => {
    setShowTracker(true);
    if (trackerMarksSets.length === 0 || trackerSubjects.length === 0) {
      await fetchAlevelTrackerData();
    }
  };

  const handleDownloadExecutiveSnapshot = async () => {
    if (!dashboardInsights) return;
    try {
      setExecutivePdfLoading(true);
      await generateExecutiveSnapshotPdf(dashboardInsights);
    } catch (err) {
      console.error("A-Level executive snapshot PDF error:", err);
      setInsightsError(err.message || "Failed to generate executive snapshot PDF.");
    } finally {
      setExecutivePdfLoading(false);
    }
  };

  const handleDownloadMissingWatchlist = async () => {
    if (!dashboardInsights) return;
    try {
      setWatchlistPdfLoading(true);
      await generateMissingPapersWatchlistPdf(dashboardInsights);
    } catch (err) {
      console.error("A-Level missing papers watchlist PDF error:", err);
      setInsightsError(err.message || "Failed to generate missing papers watchlist PDF.");
    } finally {
      setWatchlistPdfLoading(false);
    }
  };

  const readinessYearOptions = useMemo(() => {
    const years = Array.from(
      new Set(
        readinessMarksSets
          .map((set) => Number(set.year))
          .filter((year) => Number.isFinite(year) && year > 0)
      )
    ).sort((a, b) => b - a);

    if (years.length === 0) {
      years.push(new Date().getFullYear());
    }

    return years;
  }, [readinessMarksSets]);

  const effectiveReadinessYear = readinessYearOptions.includes(Number(selectedReadinessYear))
    ? Number(selectedReadinessYear)
    : readinessYearOptions[0];

  useEffect(() => {
    if (!showMoreInsights) return;

    let active = true;
    const controller = new AbortController();

    const loadInsights = async () => {
      setInsightsLoading(true);
      setInsightsError("");
      try {
        const params = new URLSearchParams({
          term: selectedReadinessTerm,
          year: String(effectiveReadinessYear),
        });
        const data = await adminFetch(`/api/alevel/admin/dashboard-insights?${params.toString()}`, {
          signal: controller.signal,
        });
        if (active) {
          setDashboardInsights(data);
        }
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("A-Level dashboard insights error:", err);
        if (active) {
          setInsightsError(err.message || "Failed to load A-Level insights.");
        }
      } finally {
        if (active) {
          setInsightsLoading(false);
        }
      }
    };

    loadInsights();
    return () => {
      active = false;
      controller.abort();
    };
  }, [effectiveReadinessYear, selectedReadinessTerm, showMoreInsights]);

  const readinessSummary = useMemo(() => {
    const assignments = Array.isArray(readinessAssignments) ? readinessAssignments : [];
    const filteredSets = (Array.isArray(readinessMarksSets) ? readinessMarksSets : []).filter(
      (set) =>
        normalizeAlevelTerm(set.term) === selectedReadinessTerm &&
        Number(set.year) === Number(effectiveReadinessYear)
    );

    const submittedKeys = new Set(
      filteredSets.map(
        (set) =>
          `${set.assignment_id}|${selectedReadinessTerm}|${effectiveReadinessYear}|${normalizeAlevelComponent(set.aoi_label)}`
      )
    );

    const normalizeAssignmentLabel = (assignment) => ({
      ...assignment,
      subject_display:
        assignment?.subject_display ||
        (assignment?.paper_label && assignment.paper_label !== "Single"
          ? `${assignment.subject} — ${assignment.paper_label}`
          : assignment?.subject || "—"),
    });

    const componentSummary = (component) => {
      const submitted = assignments
        .filter((assignment) =>
          submittedKeys.has(
            `${assignment.id}|${selectedReadinessTerm}|${effectiveReadinessYear}|${component}`
          )
        )
        .map(normalizeAssignmentLabel);
      const pending = assignments
        .filter(
          (assignment) =>
            !submittedKeys.has(
              `${assignment.id}|${selectedReadinessTerm}|${effectiveReadinessYear}|${component}`
            )
        )
        .map(normalizeAssignmentLabel)
        .sort((a, b) => {
          const streamCompare = String(a.stream || "").localeCompare(String(b.stream || ""));
          if (streamCompare !== 0) return streamCompare;
          return String(a.subject_display || "").localeCompare(String(b.subject_display || ""));
        });

      const total = assignments.length;
      const rate = total > 0 ? Math.round((submitted.length / total) * 100) : 0;

      return {
        component,
        submitted,
        pending,
        submittedCount: submitted.length,
        pendingCount: pending.length,
        rate,
      };
    };

    const mid = componentSummary("MID");
    const eot = componentSummary("EOT");
    const fullyReadyCount = assignments.filter(
      (assignment) =>
        submittedKeys.has(
          `${assignment.id}|${selectedReadinessTerm}|${effectiveReadinessYear}|MID`
        ) &&
        submittedKeys.has(
          `${assignment.id}|${selectedReadinessTerm}|${effectiveReadinessYear}|EOT`
        )
    ).length;

    return {
      totalAssignments: assignments.length,
      mid,
      eot,
      fullyReadyCount,
      fullyReadyRate:
        assignments.length > 0
          ? Math.round((fullyReadyCount / assignments.length) * 100)
          : 0,
    };
  }, [effectiveReadinessYear, readinessAssignments, readinessMarksSets, selectedReadinessTerm]);

  const candidateEligibilitySummary = dashboardInsights?.summary || {
    totalCandidates: 0,
    readyCandidates: 0,
    incompleteCandidates: 0,
    missingMidCandidates: 0,
    missingEotCandidates: 0,
    missingPaper1Candidates: 0,
    missingPaper2Candidates: 0,
  };

  const topEligibilityWatchlist = useMemo(
    () => (Array.isArray(dashboardInsights?.candidates) ? dashboardInsights.candidates.filter((candidate) => !candidate.isReady).slice(0, 6) : []),
    [dashboardInsights]
  );

  const combinationReadinessRows = Array.isArray(dashboardInsights?.combinationReadiness)
    ? dashboardInsights.combinationReadiness
    : [];
  const streamPerformanceRows = Array.isArray(dashboardInsights?.streamPerformance)
    ? dashboardInsights.streamPerformance
    : [];
  const teacherOwnershipRows = Array.isArray(dashboardInsights?.teacherPaperOwnership)
    ? dashboardInsights.teacherPaperOwnership
    : [];
  const subjectRiskRows = Array.isArray(dashboardInsights?.subjectLoadRisks)
    ? dashboardInsights.subjectLoadRisks
    : [];

  return (
    <ALevelAdminShell
      title="A-Level Manager"
      subtitle="Manage learners, assignments, downloads, reports, and live submission tracking from one place."
      contentStyle={{ paddingTop: 0, paddingLeft: 0, paddingRight: 0 }}
    >
      {({ isDark }) => {
        const amethyst = "#38bdf8";
        const palette = isDark
          ? {
              rootText: "#f1f5f9",
              muted: "#94a3b8",
              mutedStrong: "#64748b",
              cardBg: "rgba(30, 41, 59, 0.45)",
              cardBorder: "rgba(255, 255, 255, 0.05)",
              actionCardBg: "rgba(30, 41, 59, 0.3)",
              actionHoverBg: "rgba(255,255,255,0.04)",
              heroOverlay: `linear-gradient(to top, rgba(10, 12, 16, 1) 0%, rgba(10, 12, 16, 0.8) 20%, rgba(10, 12, 16, 0) 60%),
                            linear-gradient(to right, rgba(10, 12, 16, 1) 0%, rgba(10, 12, 16, 0.4) 100%)`,
              heroSubtitle: "#cbd5e1",
              totalCardBg: "linear-gradient(135deg, #1e1b4b 0%, #0a0c10 100%)",
              totalNumber: "#ffffff",
              hoverShadow: "0 20px 40px rgba(0,0,0,0.4)",
            }
          : {
              rootText: "#0f172a",
              muted: "#475569",
              mutedStrong: "#334155",
              cardBg: "rgba(255, 255, 255, 0.88)",
              cardBorder: "rgba(15, 23, 42, 0.12)",
              actionCardBg: "rgba(255, 255, 255, 0.92)",
              actionHoverBg: "rgba(56, 189, 248, 0.1)",
              heroOverlay: `linear-gradient(to top, rgba(248, 250, 252, 0.96) 0%, rgba(248, 250, 252, 0.75) 20%, rgba(248, 250, 252, 0.05) 60%),
                            linear-gradient(to right, rgba(248, 250, 252, 0.9) 0%, rgba(248, 250, 252, 0.2) 100%)`,
              heroSubtitle: "#1e293b",
              totalCardBg: "linear-gradient(135deg, #dbeafe 0%, #f8fafc 100%)",
              totalNumber: "#0f172a",
              hoverShadow: "0 14px 32px rgba(15, 23, 42, 0.12)",
            };

        const cardStyle = {
          background: palette.cardBg,
          backdropFilter: "blur(12px)",
          borderRadius: "18px",
          border: `1px solid ${palette.cardBorder}`,
          transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          color: palette.rootText,
        };
        const actionCards = [
          {
            title: "Register Learners",
            desc: "Manage student biographical data and enrollment status.",
            path: "/ark/admin/alevel/learners",
            id: "act1",
          },
          {
            title: "Assign Subjects",
            desc: "Pair educators with curriculum modules and class streams.",
            path: "/ark/admin/alevel/assign",
            id: "act2",
          },
          {
            title: "Download Marks",
            desc: "Export academic spreadsheets and administrative datasets.",
            path: "/ark/admin/alevel/downloads",
            id: "act3",
          },
          {
            title: "Term Reports",
            desc: "Generate high-fidelity terminal student reports.",
            path: "/ark/admin/alevel/reports",
            id: "act4",
          },
          {
            title: "Assessment Submission Tracker",
            desc: "Track A-Level subject submission by stream and term.",
            id: "act5",
            action: openTracker,
          },
        ];

        return (
          <>
            <div
              style={{
                height: "430px",
                backgroundImage: "url(/weasel.jpg)",
                backgroundSize: "cover",
                backgroundPosition: "center 20%",
                position: "relative",
                display: "flex",
                alignItems: "flex-end",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: palette.heroOverlay,
                }}
              />

              <div style={{ position: "relative", padding: "0 3rem 3.2rem 3rem", width: "100%" }}>
                <h1
                  style={{
                    fontSize: "3.2rem",
                    fontWeight: "900",
                    margin: 0,
                    letterSpacing: "-0.04em",
                    color: palette.rootText,
                    textShadow: isDark
                      ? "0 2px 10px rgba(0,0,0,0.5)"
                      : "0 1px 4px rgba(255,255,255,0.8)",
                  }}
                >
                  A-Level <span style={{ color: amethyst }}>Manager</span>
                </h1>
                <p
                  style={{
                    color: palette.heroSubtitle,
                    fontSize: "1.12rem",
                    maxWidth: "640px",
                    marginTop: "1rem",
                    lineHeight: "1.6",
                  }}
                >
                  A-Level operations are managed from here. Keep learner records, teacher assignments,
                  downloads, reports, and submission monitoring all in one premium workspace.
                </p>
              </div>
            </div>

            <div style={{ padding: "0 3rem 3rem 3rem", marginTop: "-20px" }}>
              {stats && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "1.1rem",
                    marginBottom: "3rem",
                  }}
                >
                  {stats.streams.map((streamStat, index) => (
                    <div
                      key={streamStat.stream}
                      onMouseEnter={() => setHoveredStat(index)}
                      onMouseLeave={() => setHoveredStat(null)}
                      style={{
                        ...cardStyle,
                        padding: "1.35rem",
                        transform: hoveredStat === index ? "translateY(-8px)" : "none",
                        borderColor: hoveredStat === index ? amethyst : palette.cardBorder,
                        boxShadow: hoveredStat === index ? palette.hoverShadow : "none",
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          fontSize: "0.75rem",
                          letterSpacing: "0.15em",
                          color: amethyst,
                          textTransform: "uppercase",
                          fontWeight: "800",
                        }}
                      >
                        {streamStat.stream}
                      </h3>
                      <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem" }}>
                          <span style={{ color: palette.muted }}>Male</span>
                          <span style={{ fontWeight: "600" }}>{streamStat.boys}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem" }}>
                          <span style={{ color: palette.muted }}>Female</span>
                          <span style={{ fontWeight: "600" }}>{streamStat.girls}</span>
                        </div>
                        <div
                          style={{
                            marginTop: "0.8rem",
                            paddingTop: "1rem",
                            borderTop: `1px solid ${palette.cardBorder}`,
                            display: "flex",
                            justifyContent: "space-between",
                            color: palette.rootText,
                          }}
                        >
                          <span style={{ fontWeight: "500", fontSize: "0.85rem", opacity: 0.8 }}>Total</span>
                          <span style={{ fontWeight: "900", fontSize: "1.2rem" }}>{streamStat.total}</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div
                    onMouseEnter={() => setHoveredStat("total")}
                    onMouseLeave={() => setHoveredStat(null)}
                    style={{
                      ...cardStyle,
                      padding: "1.35rem",
                      background: palette.totalCardBg,
                      border: `1px solid ${amethyst}`,
                      transform: hoveredStat === "total" ? "translateY(-8px)" : "none",
                      boxShadow:
                        hoveredStat === "total" ? "0 15px 40px rgba(56, 189, 248, 0.18)" : "none",
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontSize: "0.75rem",
                        letterSpacing: "0.15em",
                        color: amethyst,
                        textTransform: "uppercase",
                      }}
                    >
                      Total Population
                    </h3>
                    <div
                      style={{
                        fontSize: "3.2rem",
                        fontWeight: "900",
                        margin: "0.35rem 0",
                        color: palette.totalNumber,
                        letterSpacing: "-0.05em",
                      }}
                    >
                      {stats.streams.reduce((sum, streamStat) => sum + streamStat.total, 0).toLocaleString()}
                    </div>
                    <p style={{ margin: 0, opacity: 0.5, fontSize: "0.75rem", fontWeight: "700", letterSpacing: "0.05em" }}>
                      GLOBAL A-LEVEL REGISTRY
                    </p>
                  </div>

                  <div
                    style={{
                      ...cardStyle,
                      padding: "1.35rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                    }}
                  >
                    <div style={{ fontSize: "2.9rem", fontWeight: "900", color: amethyst }}>{stats.teachers}</div>
                    <div>
                      <div
                        style={{
                          color: palette.rootText,
                          fontWeight: "700",
                          textTransform: "uppercase",
                          fontSize: "0.75rem",
                          letterSpacing: "0.1em",
                        }}
                      >
                        Teachers
                      </div>
                      <div style={{ color: palette.mutedStrong, fontSize: "0.85rem", fontWeight: "500" }}>
                        On system
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div
                style={{
                  ...cardStyle,
                  marginTop: "2rem",
                  padding: "1.5rem",
                  background: isDark ? "rgba(15, 23, 42, 0.58)" : "rgba(255,255,255,0.92)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "1rem",
                    flexWrap: "wrap",
                    marginBottom: "1.25rem",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        fontWeight: "900",
                        color: amethyst,
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        marginBottom: "0.45rem",
                      }}
                    >
                      Submission Readiness
                    </div>
                    <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: "800", color: palette.rootText }}>
                      A-Level Marks Readiness
                    </h3>
                    <p style={{ margin: "0.45rem 0 0", color: palette.muted, maxWidth: "680px", lineHeight: 1.55 }}>
                      Monitor who has submitted MID and EOT marks for the selected term and year, and quickly see which teacher-stream-subject slots are still pending.
                    </p>
                  </div>

                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      value={selectedReadinessTerm}
                      onChange={(event) => setSelectedReadinessTerm(event.target.value)}
                      style={{
                        minWidth: "120px",
                        padding: "0.7rem 0.85rem",
                        borderRadius: "12px",
                        border: `1px solid ${palette.cardBorder}`,
                        background: isDark ? "rgba(15, 23, 42, 0.85)" : "#ffffff",
                        color: palette.rootText,
                        fontWeight: "700",
                      }}
                    >
                      {ALEVEL_TERMS.map((term) => (
                        <option key={term} value={term}>
                          {term}
                        </option>
                      ))}
                    </select>

                    <select
                      value={effectiveReadinessYear}
                      onChange={(event) => setSelectedReadinessYear(Number(event.target.value))}
                      style={{
                        minWidth: "104px",
                        padding: "0.7rem 0.85rem",
                        borderRadius: "12px",
                        border: `1px solid ${palette.cardBorder}`,
                        background: isDark ? "rgba(15, 23, 42, 0.85)" : "#ffffff",
                        color: palette.rootText,
                        fontWeight: "700",
                      }}
                    >
                      {readinessYearOptions.map((yearOption) => (
                        <option key={yearOption} value={yearOption}>
                          {yearOption}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={openTracker}
                      style={{
                        background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.95)",
                        color: palette.rootText,
                        border: `1px solid ${palette.cardBorder}`,
                        borderRadius: "12px",
                        padding: "0.72rem 0.95rem",
                        fontWeight: "800",
                        cursor: "pointer",
                      }}
                    >
                      Open Tracker
                    </button>
                  </div>
                </div>

                {readinessError ? (
                  <div
                    style={{
                      background: isDark ? "rgba(127, 29, 29, 0.22)" : "rgba(254, 226, 226, 0.95)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      color: isDark ? "#fecaca" : "#991b1b",
                      borderRadius: "14px",
                      padding: "1rem",
                    }}
                  >
                    {readinessError}
                  </div>
                ) : readinessLoading ? (
                  <div
                    style={{
                      borderRadius: "14px",
                      border: `1px solid ${palette.cardBorder}`,
                      padding: "1rem",
                      color: palette.muted,
                    }}
                  >
                    Loading A-Level readiness…
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                        gap: "0.9rem",
                        marginBottom: "1rem",
                      }}
                    >
                      {[
                        { label: "Teaching Slots", value: readinessSummary.totalAssignments, accent: palette.rootText },
                        { label: "Fully Ready", value: readinessSummary.fullyReadyCount, accent: amethyst },
                        { label: "Readiness Rate", value: `${readinessSummary.fullyReadyRate}%`, accent: readinessSummary.fullyReadyRate >= 70 ? "#22c55e" : readinessSummary.fullyReadyRate >= 40 ? "#f59e0b" : "#ef4444" },
                      ].map((tile) => (
                        <div
                          key={tile.label}
                          style={{
                            borderRadius: "16px",
                            border: `1px solid ${palette.cardBorder}`,
                            background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,250,252,0.95)",
                            padding: "1rem 1.05rem",
                          }}
                        >
                          <div style={{ fontSize: "0.68rem", letterSpacing: "0.13em", textTransform: "uppercase", color: palette.muted, fontWeight: 900 }}>
                            {tile.label}
                          </div>
                          <div style={{ marginTop: "0.45rem", fontSize: "1.9rem", fontWeight: 900, color: tile.accent }}>
                            {tile.value}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                        gap: "1rem",
                      }}
                    >
                      {[readinessSummary.mid, readinessSummary.eot].map((block) => (
                        <div
                          key={block.component}
                          style={{
                            borderRadius: "18px",
                            border: `1px solid ${palette.cardBorder}`,
                            background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,250,252,0.95)",
                            padding: "1.05rem",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem" }}>
                            <div>
                              <div style={{ fontSize: "0.7rem", letterSpacing: "0.14em", textTransform: "uppercase", color: amethyst, fontWeight: 900 }}>
                                {block.component}
                              </div>
                              <div style={{ marginTop: "0.3rem", color: palette.rootText, fontSize: "1.05rem", fontWeight: 800 }}>
                                {block.submittedCount} / {readinessSummary.totalAssignments} submitted
                              </div>
                            </div>
                            <div style={{ color: block.rate >= 70 ? "#22c55e" : block.rate >= 40 ? "#f59e0b" : "#ef4444", fontWeight: 900, fontSize: "1rem" }}>
                              {block.rate}%
                            </div>
                          </div>

                          <div
                            style={{
                              marginTop: "0.8rem",
                              height: "10px",
                              borderRadius: "999px",
                              background: isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.16)",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${block.rate}%`,
                                height: "100%",
                                background: block.rate >= 70 ? "#22c55e" : block.rate >= 40 ? "#f59e0b" : "#ef4444",
                              }}
                            />
                          </div>

                          <div style={{ marginTop: "0.95rem", display: "flex", gap: "0.9rem", flexWrap: "wrap", color: palette.muted, fontSize: "0.85rem" }}>
                            <span>Submitted: <strong style={{ color: palette.rootText }}>{block.submittedCount}</strong></span>
                            <span>Pending: <strong style={{ color: palette.rootText }}>{block.pendingCount}</strong></span>
                          </div>

                          <div style={{ marginTop: "1rem" }}>
                            <div style={{ fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: palette.muted, fontWeight: 900, marginBottom: "0.55rem" }}>
                              Pending Slots
                            </div>

                            {block.pending.length === 0 ? (
                              <div
                                style={{
                                  borderRadius: "12px",
                                  padding: "0.8rem 0.9rem",
                                  background: isDark ? "rgba(34, 197, 94, 0.14)" : "rgba(220, 252, 231, 0.9)",
                                  color: isDark ? "#bbf7d0" : "#166534",
                                  fontWeight: "700",
                                }}
                              >
                                All assignments submitted for {block.component}.
                              </div>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                                {block.pending.slice(0, 6).map((assignment) => (
                                  <div
                                    key={`${block.component}-${assignment.id}`}
                                    style={{
                                      borderRadius: "12px",
                                      border: `1px solid ${palette.cardBorder}`,
                                      padding: "0.75rem 0.85rem",
                                      background: isDark ? "rgba(15, 23, 42, 0.46)" : "#ffffff",
                                    }}
                                  >
                                    <div style={{ color: palette.rootText, fontWeight: 800 }}>
                                      {assignment.subject_display}
                                    </div>
                                    <div style={{ marginTop: "0.18rem", color: palette.muted, fontSize: "0.84rem" }}>
                                      {assignment.stream} • {assignment.teacher_name || "Teacher pending"}
                                    </div>
                                  </div>
                                ))}
                                {block.pending.length > 6 && (
                                  <div style={{ color: palette.muted, fontSize: "0.82rem", fontWeight: 700 }}>
                                    + {block.pending.length - 6} more pending
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div
                style={{
                  ...cardStyle,
                  marginTop: "1.6rem",
                  padding: "1.4rem",
                  background: isDark ? "rgba(15, 23, 42, 0.58)" : "rgba(255,255,255,0.92)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "1rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        fontWeight: "900",
                        color: amethyst,
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        marginBottom: "0.45rem",
                      }}
                    >
                      More Insights
                    </div>
                    <h3 style={{ margin: 0, fontSize: "1.12rem", fontWeight: "800", color: palette.rootText }}>
                      A-Level Executive Desk
                    </h3>
                    <p style={{ margin: "0.45rem 0 0", color: palette.muted, maxWidth: "720px", lineHeight: 1.55 }}>
                      Open a low-risk executive drawer for candidate eligibility, paper coverage, and a one-click snapshot PDF for the selected term and year.
                    </p>
                  </div>

                  <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap", alignItems: "center" }}>
                    <span
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderRadius: "999px",
                        border: `1px solid ${palette.cardBorder}`,
                        background: isDark ? "rgba(255,255,255,0.04)" : "rgba(248,250,252,0.95)",
                        color: palette.rootText,
                        fontWeight: 800,
                        fontSize: "0.78rem",
                      }}
                    >
                      {selectedReadinessTerm}
                    </span>
                    <span
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderRadius: "999px",
                        border: `1px solid ${palette.cardBorder}`,
                        background: isDark ? "rgba(255,255,255,0.04)" : "rgba(248,250,252,0.95)",
                        color: palette.rootText,
                        fontWeight: 800,
                        fontSize: "0.78rem",
                      }}
                    >
                      {effectiveReadinessYear}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowMoreInsights((current) => !current)}
                      style={{
                        background: showMoreInsights ? amethyst : (isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.95)"),
                        color: showMoreInsights ? "#06131f" : palette.rootText,
                        border: `1px solid ${showMoreInsights ? amethyst : palette.cardBorder}`,
                        borderRadius: "12px",
                        padding: "0.72rem 0.95rem",
                        fontWeight: "800",
                        cursor: "pointer",
                      }}
                    >
                      {showMoreInsights ? "Hide Insights" : "Open Insights"}
                    </button>
                  </div>
                </div>

                {showMoreInsights && (
                  <div style={{ marginTop: "1.25rem" }}>
                    {!insightsLoading && dashboardInsights && (
                      <div
                        style={{
                          marginBottom: "1rem",
                          borderRadius: "14px",
                          border: `1px solid ${palette.cardBorder}`,
                          background: isDark ? "rgba(15, 23, 42, 0.52)" : "rgba(248,250,252,0.95)",
                          padding: "0.9rem 1rem",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "0.8rem",
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ display: "grid", gap: "0.15rem" }}>
                          <span
                            style={{
                              fontSize: "0.7rem",
                              letterSpacing: "0.14em",
                              textTransform: "uppercase",
                              color: amethyst,
                              fontWeight: 900,
                            }}
                          >
                            Last Refreshed
                          </span>
                          <strong style={{ color: palette.rootText, fontSize: "0.96rem" }}>
                            {formatExecutiveTimestamp(dashboardInsights.generatedAt)}
                          </strong>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.55rem",
                            alignItems: "center",
                          }}
                        >
                          {[
                            { label: "Strong", color: "#22c55e" },
                            { label: "Watch", color: "#f59e0b" },
                            { label: "Urgent", color: "#ef4444" },
                          ].map((item) => (
                            <span
                              key={item.label}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.4rem",
                                padding: "0.4rem 0.7rem",
                                borderRadius: "999px",
                                border: `1px solid ${palette.cardBorder}`,
                                background: isDark ? "rgba(255,255,255,0.03)" : "#ffffff",
                                color: palette.rootText,
                                fontSize: "0.78rem",
                                fontWeight: 800,
                              }}
                            >
                              <span
                                style={{
                                  width: "9px",
                                  height: "9px",
                                  borderRadius: "999px",
                                  background: item.color,
                                  boxShadow: `0 0 12px ${item.color}55`,
                                }}
                              />
                              {item.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {insightsError ? (
                      <div
                        style={{
                          background: isDark ? "rgba(127, 29, 29, 0.22)" : "rgba(254, 226, 226, 0.95)",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          color: isDark ? "#fecaca" : "#991b1b",
                          borderRadius: "14px",
                          padding: "1rem",
                        }}
                      >
                        {insightsError}
                      </div>
                    ) : insightsLoading ? (
                      <div
                        style={{
                          borderRadius: "14px",
                          border: `1px solid ${palette.cardBorder}`,
                          padding: "1rem",
                          color: palette.muted,
                        }}
                      >
                        Loading executive A-Level insights…
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: "1rem" }}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                            gap: "1rem",
                          }}
                        >
                          <div
                            style={{
                              borderRadius: "18px",
                              border: `1px solid ${palette.cardBorder}`,
                              background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,250,252,0.95)",
                              padding: "1.05rem",
                            }}
                          >
                            <div style={{ fontSize: "0.72rem", letterSpacing: "0.14em", textTransform: "uppercase", color: amethyst, fontWeight: 900 }}>
                              Candidate Eligibility
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                                gap: "0.7rem",
                                marginTop: "0.9rem",
                              }}
                            >
                              {[
                                { label: "Ready", value: candidateEligibilitySummary.readyCandidates, color: "#22c55e" },
                                { label: "Incomplete", value: candidateEligibilitySummary.incompleteCandidates, color: "#ef4444" },
                                { label: "Missing MID", value: candidateEligibilitySummary.missingMidCandidates, color: "#f59e0b" },
                                { label: "Missing EOT", value: candidateEligibilitySummary.missingEotCandidates, color: "#f59e0b" },
                                { label: "Missing Paper 1", value: candidateEligibilitySummary.missingPaper1Candidates, color: "#38bdf8" },
                                { label: "Missing Paper 2", value: candidateEligibilitySummary.missingPaper2Candidates, color: "#38bdf8" },
                              ].map((tile) => (
                                <div
                                  key={tile.label}
                                  style={{
                                    borderRadius: "14px",
                                    border: `1px solid ${palette.cardBorder}`,
                                    background: isDark ? "rgba(15,23,42,0.5)" : "#ffffff",
                                    padding: "0.8rem 0.85rem",
                                  }}
                                >
                                  <div style={{ fontSize: "0.68rem", letterSpacing: "0.12em", textTransform: "uppercase", color: palette.muted, fontWeight: 900 }}>
                                    {tile.label}
                                  </div>
                                  <div style={{ marginTop: "0.35rem", fontSize: "1.5rem", fontWeight: 900, color: tile.color }}>
                                    {tile.value}
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div style={{ marginTop: "1rem" }}>
                              <div style={{ fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: palette.muted, fontWeight: 900, marginBottom: "0.55rem" }}>
                                Watchlist
                              </div>
                              {topEligibilityWatchlist.length === 0 ? (
                                <div
                                  style={{
                                    borderRadius: "12px",
                                    padding: "0.85rem 0.95rem",
                                    background: isDark ? "rgba(34, 197, 94, 0.14)" : "rgba(220, 252, 231, 0.9)",
                                    color: isDark ? "#bbf7d0" : "#166534",
                                    fontWeight: "700",
                                  }}
                                >
                                  All candidates are complete for {selectedReadinessTerm}.
                                </div>
                              ) : (
                                <div style={{ display: "grid", gap: "0.55rem", maxHeight: "280px", overflowY: "auto", paddingRight: "0.2rem" }}>
                                  {topEligibilityWatchlist.map((candidate) => (
                                    <div
                                      key={candidate.learnerId}
                                      style={{
                                        borderRadius: "12px",
                                        border: `1px solid ${palette.cardBorder}`,
                                        padding: "0.78rem 0.85rem",
                                        background: isDark ? "rgba(15, 23, 42, 0.46)" : "#ffffff",
                                      }}
                                    >
                                      <div style={{ color: palette.rootText, fontWeight: 800 }}>
                                        {candidate.learnerName}
                                      </div>
                                      <div style={{ marginTop: "0.18rem", color: palette.muted, fontSize: "0.84rem" }}>
                                        {candidate.stream} • {candidate.combination || "—"}
                                      </div>
                                      <div style={{ marginTop: "0.35rem", color: palette.mutedStrong, fontSize: "0.82rem", lineHeight: 1.5 }}>
                                        {summarizeCandidateIssues(candidate)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          <div
                            style={{
                              borderRadius: "18px",
                              border: `1px solid ${palette.cardBorder}`,
                              background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,250,252,0.95)",
                              padding: "1.05rem",
                              display: "grid",
                              gap: "0.95rem",
                              alignContent: "start",
                            }}
                          >
                            <div>
                              <div style={{ fontSize: "0.72rem", letterSpacing: "0.14em", textTransform: "uppercase", color: amethyst, fontWeight: 900 }}>
                                Executive Snapshot PDF
                              </div>
                              <div style={{ marginTop: "0.4rem", color: palette.rootText, fontSize: "1.05rem", fontWeight: 800 }}>
                                Board-ready A-Level overview
                              </div>
                              <p style={{ margin: "0.45rem 0 0", color: palette.muted, lineHeight: 1.55 }}>
                                Generates a printable summary with candidate eligibility, incomplete watchlist, and paper coverage for {selectedReadinessTerm} {effectiveReadinessYear}.
                              </p>
                            </div>

                            <div
                              style={{
                                borderRadius: "14px",
                                border: `1px solid ${palette.cardBorder}`,
                                background: isDark ? "rgba(15,23,42,0.5)" : "#ffffff",
                                padding: "0.9rem 1rem",
                                display: "grid",
                                gap: "0.45rem",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", color: palette.muted, fontSize: "0.86rem" }}>
                                <span>Captured</span>
                                <strong style={{ color: palette.rootText }}>{formatExecutiveTimestamp(dashboardInsights?.generatedAt)}</strong>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", color: palette.muted, fontSize: "0.86rem" }}>
                                <span>Candidates</span>
                                <strong style={{ color: palette.rootText }}>{candidateEligibilitySummary.totalCandidates}</strong>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", color: palette.muted, fontSize: "0.86rem" }}>
                                <span>Coverage Rows</span>
                                <strong style={{ color: palette.rootText }}>{Array.isArray(dashboardInsights?.paperCoverage) ? dashboardInsights.paperCoverage.length : 0}</strong>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={handleDownloadExecutiveSnapshot}
                              disabled={!dashboardInsights || executivePdfLoading}
                              style={{
                                background: amethyst,
                                color: "#06131f",
                                border: "none",
                                borderRadius: "12px",
                                padding: "0.82rem 1rem",
                                fontWeight: "900",
                                cursor: executivePdfLoading ? "not-allowed" : "pointer",
                                opacity: executivePdfLoading ? 0.75 : 1,
                              }}
                            >
                              {executivePdfLoading ? "Generating Snapshot…" : "Download Executive Snapshot PDF"}
                            </button>

                            <button
                              type="button"
                              onClick={handleDownloadMissingWatchlist}
                              disabled={!dashboardInsights || watchlistPdfLoading}
                              style={{
                                background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.95)",
                                color: palette.rootText,
                                border: `1px solid ${palette.cardBorder}`,
                                borderRadius: "12px",
                                padding: "0.82rem 1rem",
                                fontWeight: "900",
                                cursor: watchlistPdfLoading ? "not-allowed" : "pointer",
                                opacity: watchlistPdfLoading ? 0.75 : 1,
                              }}
                            >
                              {watchlistPdfLoading ? "Generating Watchlist…" : "Download Missing Papers Watchlist PDF"}
                            </button>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                            gap: "1rem",
                          }}
                        >
                          <div
                            style={{
                              borderRadius: "18px",
                              border: `1px solid ${palette.cardBorder}`,
                              background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,250,252,0.95)",
                              padding: "1.05rem",
                            }}
                          >
                            <div style={{ fontSize: "0.72rem", letterSpacing: "0.14em", textTransform: "uppercase", color: amethyst, fontWeight: 900 }}>
                              Combination Readiness
                            </div>
                            <div style={{ marginTop: "0.35rem", color: palette.rootText, fontSize: "1.05rem", fontWeight: 800 }}>
                              Readiness by combination
                            </div>
                            <div style={{ marginTop: "0.95rem", display: "grid", gap: "0.55rem", maxHeight: "260px", overflowY: "auto", paddingRight: "0.2rem" }}>
                              {combinationReadinessRows.map((row) => (
                                <div
                                  key={row.combination}
                                  style={{
                                    borderRadius: "12px",
                                    border: `1px solid ${palette.cardBorder}`,
                                    padding: "0.78rem 0.85rem",
                                    background: isDark ? "rgba(15, 23, 42, 0.46)" : "#ffffff",
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", alignItems: "baseline" }}>
                                    <strong style={{ color: palette.rootText }}>{row.combination || "—"}</strong>
                                    <span style={{ color: getCoverageTone(row.readinessRate), fontWeight: 900 }}>{row.readinessRate}%</span>
                                  </div>
                                  <div style={{ marginTop: "0.28rem", color: palette.muted, fontSize: "0.84rem" }}>
                                    {row.readyCandidates}/{row.totalCandidates} ready • {row.incompleteCandidates} incomplete
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div
                            style={{
                              borderRadius: "18px",
                              border: `1px solid ${palette.cardBorder}`,
                              background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,250,252,0.95)",
                              padding: "1.05rem",
                            }}
                          >
                            <div style={{ fontSize: "0.72rem", letterSpacing: "0.14em", textTransform: "uppercase", color: amethyst, fontWeight: 900 }}>
                              Stream Performance
                            </div>
                            <div style={{ marginTop: "0.35rem", color: palette.rootText, fontSize: "1.05rem", fontWeight: 800 }}>
                              Readiness by stream
                            </div>
                            <div style={{ marginTop: "0.95rem", display: "grid", gap: "0.55rem" }}>
                              {streamPerformanceRows.map((row) => (
                                <div
                                  key={row.stream}
                                  style={{
                                    borderRadius: "12px",
                                    border: `1px solid ${palette.cardBorder}`,
                                    padding: "0.78rem 0.85rem",
                                    background: isDark ? "rgba(15, 23, 42, 0.46)" : "#ffffff",
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", alignItems: "baseline" }}>
                                    <strong style={{ color: palette.rootText }}>{row.stream || "—"}</strong>
                                    <span style={{ color: getCoverageTone(row.readinessRate), fontWeight: 900 }}>{row.readinessRate}%</span>
                                  </div>
                                  <div style={{ marginTop: "0.28rem", color: palette.muted, fontSize: "0.84rem" }}>
                                    {row.readyCandidates}/{row.totalCandidates} ready • MID gaps {row.missingMidCandidates} • EOT gaps {row.missingEotCandidates}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                            gap: "1rem",
                          }}
                        >
                          <div
                            style={{
                              borderRadius: "18px",
                              border: `1px solid ${palette.cardBorder}`,
                              background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,250,252,0.95)",
                              padding: "1.05rem",
                            }}
                          >
                            <div style={{ fontSize: "0.72rem", letterSpacing: "0.14em", textTransform: "uppercase", color: amethyst, fontWeight: 900 }}>
                              Teacher Paper Ownership
                            </div>
                            <div style={{ marginTop: "0.35rem", color: palette.rootText, fontSize: "1.05rem", fontWeight: 800 }}>
                              Coverage by teacher
                            </div>
                            <div style={{ marginTop: "0.95rem", display: "grid", gap: "0.55rem", maxHeight: "260px", overflowY: "auto", paddingRight: "0.2rem" }}>
                              {teacherOwnershipRows.map((row) => (
                                <div
                                  key={row.teacherName}
                                  style={{
                                    borderRadius: "12px",
                                    border: `1px solid ${palette.cardBorder}`,
                                    padding: "0.78rem 0.85rem",
                                    background: isDark ? "rgba(15, 23, 42, 0.46)" : "#ffffff",
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", alignItems: "baseline" }}>
                                    <strong style={{ color: palette.rootText }}>{row.teacherName || "—"}</strong>
                                    <span style={{ color: getCoverageTone(row.coverageRate), fontWeight: 900 }}>{row.coverageRate}%</span>
                                  </div>
                                  <div style={{ marginTop: "0.28rem", color: palette.muted, fontSize: "0.84rem" }}>
                                    {row.fullySubmitted}/{row.papersAssigned} fully submitted • {row.pendingPapers} pending
                                  </div>
                                  <div style={{ marginTop: "0.22rem", color: palette.mutedStrong, fontSize: "0.8rem" }}>
                                    {Array.isArray(row.streams) && row.streams.length > 0 ? row.streams.join(", ") : "—"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div
                            style={{
                              borderRadius: "18px",
                              border: `1px solid ${palette.cardBorder}`,
                              background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,250,252,0.95)",
                              padding: "1.05rem",
                            }}
                          >
                            <div style={{ fontSize: "0.72rem", letterSpacing: "0.14em", textTransform: "uppercase", color: amethyst, fontWeight: 900 }}>
                              Subject Load Risk
                            </div>
                            <div style={{ marginTop: "0.35rem", color: palette.rootText, fontSize: "1.05rem", fontWeight: 800 }}>
                              Papers needing attention
                            </div>
                            <div style={{ marginTop: "0.95rem", display: "grid", gap: "0.55rem", maxHeight: "260px", overflowY: "auto", paddingRight: "0.2rem" }}>
                              {subjectRiskRows.filter((row) => row.riskPriority > 0).slice(0, 8).map((row) => (
                                <div
                                  key={`${row.stream}-${row.subjectDisplay}`}
                                  style={{
                                    borderRadius: "12px",
                                    border: `1px solid ${palette.cardBorder}`,
                                    padding: "0.78rem 0.85rem",
                                    background: isDark ? "rgba(15, 23, 42, 0.46)" : "#ffffff",
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", alignItems: "baseline" }}>
                                    <strong style={{ color: palette.rootText }}>{row.subjectDisplay}</strong>
                                    <span
                                      style={{
                                        color:
                                          row.riskLabel === "Unassigned"
                                            ? "#ef4444"
                                            : row.riskLabel === "Critical"
                                            ? "#f97316"
                                            : "#f59e0b",
                                        fontWeight: 900,
                                      }}
                                    >
                                      {row.riskLabel}
                                    </span>
                                  </div>
                                  <div style={{ marginTop: "0.28rem", color: palette.muted, fontSize: "0.84rem" }}>
                                    {row.stream} • {row.teacherName || "Unassigned"}
                                  </div>
                                  <div style={{ marginTop: "0.22rem", color: palette.mutedStrong, fontSize: "0.8rem" }}>
                                    Pending {row.pendingTotal} • Lowest coverage {row.weakestRate}%
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            borderRadius: "18px",
                            border: `1px solid ${palette.cardBorder}`,
                            background: isDark ? "rgba(255,255,255,0.03)" : "rgba(248,250,252,0.95)",
                            padding: "1.05rem",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontSize: "0.72rem", letterSpacing: "0.14em", textTransform: "uppercase", color: amethyst, fontWeight: 900 }}>
                                Paper Coverage Matrix
                              </div>
                              <div style={{ marginTop: "0.35rem", color: palette.rootText, fontSize: "1.05rem", fontWeight: 800 }}>
                                MID / EOT capture by paper
                              </div>
                            </div>
                            <div style={{ color: palette.muted, fontSize: "0.84rem", fontWeight: 700 }}>
                              Expected candidates are based on registered subject load.
                            </div>
                          </div>

                          <div
                            style={{
                              marginTop: "0.8rem",
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "0.55rem",
                              alignItems: "center",
                            }}
                          >
                            {[
                              { label: "85%+ Strong", color: "#22c55e" },
                              { label: "60–84% Watch", color: "#f59e0b" },
                              { label: "Below 60% Urgent", color: "#ef4444" },
                            ].map((item) => (
                              <span
                                key={item.label}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.4rem",
                                  padding: "0.38rem 0.65rem",
                                  borderRadius: "999px",
                                  border: `1px solid ${palette.cardBorder}`,
                                  background: isDark ? "rgba(255,255,255,0.03)" : "#ffffff",
                                  color: palette.rootText,
                                  fontSize: "0.76rem",
                                  fontWeight: 800,
                                }}
                              >
                                <span
                                  style={{
                                    width: "9px",
                                    height: "9px",
                                    borderRadius: "999px",
                                    background: item.color,
                                    boxShadow: `0 0 12px ${item.color}55`,
                                  }}
                                />
                                {item.label}
                              </span>
                            ))}
                          </div>

                          <div style={{ marginTop: "0.95rem", overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "820px" }}>
                              <thead>
                                <tr>
                                  {["Paper", "Expected", "MID", "EOT", "Teachers"].map((heading) => (
                                    <th
                                      key={heading}
                                      style={{
                                        textAlign: "left",
                                        padding: "0.78rem 0.7rem",
                                        borderBottom: `1px solid ${palette.cardBorder}`,
                                        color: palette.muted,
                                        fontSize: "0.72rem",
                                        letterSpacing: "0.12em",
                                        textTransform: "uppercase",
                                      }}
                                    >
                                      {heading}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(dashboardInsights?.paperCoverage || []).map((row) => (
                                  <tr key={`${row.subjectDisplay}-${row.paperLabel}`}>
                                    <td style={{ padding: "0.8rem 0.7rem", borderBottom: `1px solid ${palette.cardBorder}`, color: palette.rootText, fontWeight: 800 }}>
                                      {row.subjectDisplay}
                                    </td>
                                    <td style={{ padding: "0.8rem 0.7rem", borderBottom: `1px solid ${palette.cardBorder}`, color: palette.rootText }}>
                                      {row.expectedCount}
                                    </td>
                                    <td style={{ padding: "0.8rem 0.7rem", borderBottom: `1px solid ${palette.cardBorder}` }}>
                                      <div style={{ color: getCoverageTone(row.midRate), fontWeight: 900 }}>
                                        {row.midCapturedCount}/{row.expectedCount} ({row.midRate}%)
                                      </div>
                                      <div style={{ color: palette.muted, fontSize: "0.8rem" }}>
                                        {row.midPendingCount} pending
                                      </div>
                                    </td>
                                    <td style={{ padding: "0.8rem 0.7rem", borderBottom: `1px solid ${palette.cardBorder}` }}>
                                      <div style={{ color: getCoverageTone(row.eotRate), fontWeight: 900 }}>
                                        {row.eotCapturedCount}/{row.expectedCount} ({row.eotRate}%)
                                      </div>
                                      <div style={{ color: palette.muted, fontSize: "0.8rem" }}>
                                        {row.eotPendingCount} pending
                                      </div>
                                    </td>
                                    <td style={{ padding: "0.8rem 0.7rem", borderBottom: `1px solid ${palette.cardBorder}`, color: palette.mutedStrong, fontSize: "0.84rem", lineHeight: 1.45 }}>
                                      {Array.isArray(row.teachers) && row.teachers.length > 0 ? row.teachers.join(", ") : "Unassigned"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {showTracker && (
                <section className="panel" style={{ marginTop: "2rem" }}>
                  <div className="panel-header">
                    <div>
                      <h2>Assessment Submission Tracker</h2>
                      <p>A-Level subject submission tracker by term and stream.</p>
                    </div>
                    <div style={{ display: "flex", gap: "0.6rem" }}>
                      <button
                        className="ghost-btn"
                        type="button"
                        onClick={fetchAlevelTrackerData}
                        disabled={trackerLoading}
                      >
                        {trackerLoading ? "Refreshing…" : "Refresh"}
                      </button>
                      <button className="panel-close" type="button" onClick={() => setShowTracker(false)}>
                        ✕ Close
                      </button>
                    </div>
                  </div>

                  {trackerError && <div className="panel-alert panel-alert-error">{trackerError}</div>}

                  {trackerLoading ? (
                    <div className="panel-card">
                      <p className="muted-text">Loading tracker…</p>
                    </div>
                  ) : (
                    <AssessmentSubmissionTracker
                      marksSets={trackerMarksSets}
                      refreshMarks={fetchAlevelTrackerData}
                      officialSubjects={trackerSubjects}
                      assignmentsEndpoint="/api/alevel/admin/assignments"
                      trackedUnitLabel="papers"
                      componentOptions={[
                        { value: "MID", label: "MID" },
                        { value: "EOT", label: "EOT" },
                      ]}
                      seedGroups={[
                        { class_level: "A-Level", stream: "S5 Arts" },
                        { class_level: "A-Level", stream: "S5 Sciences" },
                        { class_level: "A-Level", stream: "S6 Arts" },
                        { class_level: "A-Level", stream: "S6 Sciences" },
                      ]}
                      title="Assessment Submission Tracker"
                      subtitle="Track A-Level paper submissions per stream using MID and EOT."
                    />
                  )}
                </section>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "1.1rem",
                  marginTop: "2rem",
                }}
              >
                {actionCards.map((card) => (
                  <div
                    key={card.id}
                    onMouseEnter={() => setHoveredAction(card.id)}
                    onMouseLeave={() => setHoveredAction(null)}
                    onClick={() => {
                      if (typeof card.action === "function") {
                        card.action();
                        return;
                      }
                      navigate(card.path);
                    }}
                    style={{
                      ...cardStyle,
                      padding: "1.6rem 1.35rem",
                      cursor: "pointer",
                      background: hoveredAction === card.id ? palette.actionHoverBg : palette.actionCardBg,
                      borderColor: hoveredAction === card.id ? amethyst : palette.cardBorder,
                      transform: hoveredAction === card.id ? "scale(1.02)" : "none",
                    }}
                  >
                    <h3 style={{ margin: "0 0 0.65rem 0", fontSize: "1.05rem", fontWeight: "700" }}>{card.title}</h3>
                    <p style={{ color: palette.muted, fontSize: "0.9rem", lineHeight: "1.5", marginBottom: "1.6rem" }}>
                      {card.desc}
                    </p>
                    <div
                      style={{
                        color: amethyst,
                        fontSize: "0.75rem",
                        fontWeight: "800",
                        letterSpacing: "0.1em",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      ACCESS MODULE{" "}
                      <span
                        style={{
                          transition: "0.3s",
                          transform: hoveredAction === card.id ? "translateX(6px)" : "none",
                        }}
                      >
                        →
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      }}
    </ALevelAdminShell>
  );
}
