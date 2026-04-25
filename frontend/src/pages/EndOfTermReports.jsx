// src/pages/EndOfTermReports.jsx
import React, { useEffect, useMemo, useState } from "react";
import generateReportCardPDF from "../components/reportCardPdf";
import { normalizeSchoolCalendar } from "../utils/schoolCalendar";
import { loadPdfTools } from "../utils/loadPdfTools";
import { adminFetch } from "../lib/api";

  const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
  const REPORT_DATES_STORAGE_KEY = "spess_report_card_dates";

  const addDaysToDateKey = (dateKey, days) => {
    const parsed = new Date(`${String(dateKey || "").trim()}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return "";
    parsed.setDate(parsed.getDate() + days);
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getCalendarDrivenReportDates = (calendar, term, year) => {
    const normalized = normalizeSchoolCalendar(calendar || {});
    if (String(normalized.academicYear || "").trim() !== String(year || "").trim()) {
      return { termEndedOn: "", nextTermBeginsOn: "" };
    }

    const normalizedTerm = String(term || "").trim().toLowerCase();
    const termIndex =
      normalizedTerm === "1" || normalizedTerm === "term 1"
        ? 1
        : normalizedTerm === "2" || normalizedTerm === "term 2"
        ? 2
        : normalizedTerm === "3" || normalizedTerm === "term 3"
        ? 3
        : null;

    if (!termIndex) {
      return { termEndedOn: "", nextTermBeginsOn: "" };
    }

    const termEntry = normalized.entries.find((entry) => entry.key === `term${termIndex}`);
    const nextTermEntry = normalized.entries.find((entry) => entry.key === `term${termIndex + 1}`);
    const holidayAfterEntry = normalized.entries.find((entry) => entry.key === `holiday${termIndex}`);

    const termEndedOn = termEntry?.to || "";
    const nextTermBeginsOn =
      nextTermEntry?.from || (termIndex === 3 && holidayAfterEntry?.to ? addDaysToDateKey(holidayAfterEntry.to, 1) : "");

    return { termEndedOn, nextTermBeginsOn };
  };

  const EXPECTED_SUBJECT_LOAD = {
    S1: 12,
    S2: 12,
    S3: 9,
    S4: 9,
  };
  const O_LEVEL_STREAMS = ["North", "South"];
  const TERM_MISSED_AOI_COMPONENTS = [
    ["AOI1_status", "AOI 1"],
    ["AOI2_status", "AOI 2"],
    ["AOI3_status", "AOI 3"],
  ];
  const MISSED_AOI_RISK_ORDER = {
    Critical: 0,
    Intermediate: 1,
    "Not so urgent": 2,
  };

  const hasScore = (value) => value !== null && value !== undefined && value !== "";
  const isMissedStatus = (status) => String(status || "").trim().toLowerCase() === "missed";
  const toNumberOrNull = (value) => {
    if (!hasScore(value)) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const summarizeMissingComponents = (row, isEndOfYearMode) => {
    const components = isEndOfYearMode
      ? [
          ["T1_AOI1", "T1_AOI1_status", "T1 AOI 1"],
          ["T1_AOI2", "T1_AOI2_status", "T1 AOI 2"],
          ["T1_AOI3", "T1_AOI3_status", "T1 AOI 3"],
          ["T2_AOI1", "T2_AOI1_status", "T2 AOI 1"],
          ["T2_AOI2", "T2_AOI2_status", "T2 AOI 2"],
          ["T2_AOI3", "T2_AOI3_status", "T2 AOI 3"],
          ["AOI1", "AOI1_status", "T3 AOI 1"],
          ["AOI2", "AOI2_status", "T3 AOI 2"],
          ["AOI3", "AOI3_status", "T3 AOI 3"],
          ["EXAM80", "EXAM80_status", "/80"],
        ]
      : [
          ["AOI1", "AOI1_status", "AOI 1"],
          ["AOI2", "AOI2_status", "AOI 2"],
          ["AOI3", "AOI3_status", "AOI 3"],
        ];

    return components
      .filter(([scoreKey, statusKey]) => !hasScore(row[scoreKey]) || isMissedStatus(row[statusKey]))
      .map(([scoreKey, statusKey, label]) => {
        const statusLabel = isMissedStatus(row[statusKey]) ? "missed" : "missing";
        return `${label} ${statusLabel}`;
      });
  };

  const classifyMissedAoiRisk = (missedAoiCount) => {
    const count = Number(missedAoiCount || 0);
    if (count >= 6) return "Critical";
    if (count >= 3) return "Intermediate";
    return "Not so urgent";
  };

  const getMissedAoiStaffAction = (risk) => {
    if (risk === "Critical") return "Immediate learner + parent follow-up";
    if (risk === "Intermediate") return "Class teacher follow-up this week";
    return "Monitor and remind before next AOI";
  };

  const getMissedAoiRiskTone = (risk) => {
    if (risk === "Critical") {
      return {
        background: "rgba(127, 29, 29, 0.32)",
        color: "#fecaca",
        border: "1px solid rgba(248, 113, 113, 0.32)",
      };
    }
    if (risk === "Intermediate") {
      return {
        background: "rgba(146, 64, 14, 0.28)",
        color: "#fed7aa",
        border: "1px solid rgba(251, 146, 60, 0.28)",
      };
    }
    return {
      background: "rgba(14, 116, 144, 0.24)",
      color: "#bae6fd",
      border: "1px solid rgba(34, 211, 238, 0.24)",
    };
  };

  const buildMissedAoiRiskRows = (reportRows) => {
    const byStudent = new Map();

    (Array.isArray(reportRows) ? reportRows : []).forEach((row) => {
      const missedComponents = TERM_MISSED_AOI_COMPONENTS
        .filter(([statusKey]) => isMissedStatus(row[statusKey]))
        .map(([, label]) => label);

      if (missedComponents.length === 0) return;

      const studentId = String(row.student_id || "").trim();
      if (!studentId) return;

      if (!byStudent.has(studentId)) {
        byStudent.set(studentId, {
          student_id: studentId,
          student_name: row.student_name || "Unknown learner",
          class_level: row.class_level || "—",
          stream: row.stream || "—",
          missedAoiCount: 0,
          subjects: new Set(),
          details: [],
        });
      }

      const bucket = byStudent.get(studentId);
      bucket.missedAoiCount += missedComponents.length;
      if (row.subject) bucket.subjects.add(String(row.subject));
      bucket.details.push(`${row.subject || "Subject"}: ${missedComponents.join(", ")}`);
    });

    return Array.from(byStudent.values())
      .map((row) => {
        const risk = classifyMissedAoiRisk(row.missedAoiCount);
        return {
          ...row,
          risk,
          action: getMissedAoiStaffAction(risk),
          subjectCount: row.subjects.size,
        };
      })
      .sort((a, b) => {
        const riskDiff = MISSED_AOI_RISK_ORDER[a.risk] - MISSED_AOI_RISK_ORDER[b.risk];
        if (riskDiff !== 0) return riskDiff;
        if (b.missedAoiCount !== a.missedAoiCount) return b.missedAoiCount - a.missedAoiCount;
        const streamDiff = String(a.stream).localeCompare(String(b.stream));
        if (streamDiff !== 0) return streamDiff;
        return String(a.student_name).localeCompare(String(b.student_name));
      });
  };

  const buildPerformanceIndicatorRows = (reportRows, registeredLearners, isEndOfYearMode, fallbackMeta = {}) => {
    const reportByStudent = new Map();
    reportRows.forEach((row) => {
      const id = String(row.student_id || "").trim();
      if (!id) return;
      if (!reportByStudent.has(id)) {
        reportByStudent.set(id, {
          student_id: row.student_id,
          student_name: row.student_name,
          class_level: row.class_level,
          stream: row.stream,
          class_position: row.class_position,
          stream_position: row.stream_position,
          position_status: row.position_status,
          rows: [],
        });
      }
      reportByStudent.get(id).rows.push(row);
    });

    const registeredById = new Map();
    registeredLearners.forEach((learner) => {
      const id = String(learner.id || learner.student_id || "").trim();
      if (id) registeredById.set(id, learner);
    });

    const mergedIds = new Set([...reportByStudent.keys(), ...registeredById.keys()]);

    return Array.from(mergedIds)
      .map((id) => {
        const report = reportByStudent.get(id);
        const registered = registeredById.get(id);
        const rows = report?.rows || [];
        const values = rows
          .map((row) => toNumberOrNull(isEndOfYearMode ? row.percent100 : row.average))
          .filter((value) => value !== null);
        const overall =
          values.length > 0
            ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
            : null;
        const expectedLoad = EXPECTED_SUBJECT_LOAD[String(report?.class_level || registered?.class_level || "").toUpperCase()] || null;
        const subjectCount = new Set(rows.map((row) => String(row.subject || "").trim()).filter(Boolean)).size;
        const missingDetails = [];

        rows.forEach((row) => {
          const missing = summarizeMissingComponents(row, isEndOfYearMode);
          if (missing.length > 0) {
            missingDetails.push(`${row.subject || "Subject"}: ${missing.join(", ")}`);
          }
        });

        if (rows.length === 0) {
          missingDetails.push("No submitted report marks found");
        }

        if (expectedLoad && subjectCount > 0 && subjectCount < expectedLoad) {
          missingDetails.push(`Subject load incomplete: ${subjectCount}/${expectedLoad} subjects found`);
        }

        const eligible = String(report?.position_status || "").trim().toUpperCase() === "ELIGIBLE";

        return {
          student_id: id,
          student_name: report?.student_name || registered?.name || "Unknown learner",
          class_level: report?.class_level || registered?.class_level || fallbackMeta.classLevel || "—",
          stream: report?.stream || registered?.stream || fallbackMeta.stream || "—",
          overall,
          eligible,
          class_position: report?.class_position || null,
          stream_position: report?.stream_position || null,
          subjectCount,
          expectedLoad,
          missingDetails,
        };
      })
      .sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        if (a.eligible && b.eligible) return (b.overall ?? -1) - (a.overall ?? -1);
        const missingDiff = a.missingDetails.length - b.missingDetails.length;
        if (missingDiff !== 0) return missingDiff;
        return String(a.student_name).localeCompare(String(b.student_name));
      });
  };

  function EndOfTermReports({ mode = "term" }) {
  const isEndOfYearMode = mode === "year";
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));  
  const [term, setTerm] = useState(isEndOfYearMode ? "3" : "1");
  const [classLevel, setClassLevel] = useState("S3");
  const [stream, setStream] = useState("North");
  const [studentId, setStudentId] = useState("");

  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStage, setDownloadStage] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState([]);
  const [registeredLearners, setRegisteredLearners] = useState([]);
  const [missedAoiRiskSourceRows, setMissedAoiRiskSourceRows] = useState([]);
  const [schoolCalendar, setSchoolCalendar] = useState(null);
  const [reportDatesCache, setReportDatesCache] = useState(() => {
    try {
      const raw = window.localStorage.getItem(REPORT_DATES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const termOptions = useMemo(
    () => (isEndOfYearMode ? [{ value: "3", label: "Term 3" }] : [
      { value: "1", label: "Term 1" },
      { value: "2", label: "Term 2" },
    ]),
    [isEndOfYearMode]
  );
  const reportDatesKey = useMemo(
    () => `${mode}_${year}_${term}`,
    [mode, year, term]
  );
  const derivedReportDates = useMemo(
    () => getCalendarDrivenReportDates(schoolCalendar, term, year),
    [schoolCalendar, term, year]
  );
  const cachedReportDates = useMemo(
    () => reportDatesCache[reportDatesKey] || {},
    [reportDatesCache, reportDatesKey]
  );
  const hasCalendarReportDates = Boolean(
    derivedReportDates.termEndedOn || derivedReportDates.nextTermBeginsOn
  );
  const hasManualReportDateOverride = cachedReportDates.source === "manual";
  const reportDates = useMemo(
    () => {
      if (hasManualReportDateOverride) {
        return {
          ...derivedReportDates,
          ...cachedReportDates,
        };
      }

      return {
        termEndedOn: derivedReportDates.termEndedOn || cachedReportDates.termEndedOn || "",
        nextTermBeginsOn: derivedReportDates.nextTermBeginsOn || cachedReportDates.nextTermBeginsOn || "",
      };
    },
    [cachedReportDates, derivedReportDates, hasManualReportDateOverride]
  );
  const performanceRows = useMemo(
    () =>
      buildPerformanceIndicatorRows(data, registeredLearners, isEndOfYearMode, {
        classLevel,
        stream,
      }),
    [data, registeredLearners, isEndOfYearMode, classLevel, stream]
  );
  const performanceSummary = useMemo(
    () => ({
      eligible: performanceRows.filter((row) => row.eligible).length,
      ineligible: performanceRows.filter((row) => !row.eligible).length,
    }),
    [performanceRows]
  );
  const missedAoiRiskRows = useMemo(
    () => buildMissedAoiRiskRows(missedAoiRiskSourceRows),
    [missedAoiRiskSourceRows]
  );
  const missedAoiRiskSummary = useMemo(
    () => ({
      critical: missedAoiRiskRows.filter((row) => row.risk === "Critical").length,
      intermediate: missedAoiRiskRows.filter((row) => row.risk === "Intermediate").length,
      notUrgent: missedAoiRiskRows.filter((row) => row.risk === "Not so urgent").length,
      totalMissedAois: missedAoiRiskRows.reduce((sum, row) => sum + Number(row.missedAoiCount || 0), 0),
    }),
    [missedAoiRiskRows]
  );

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/school-calendar`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load school calendar");
        return res.json();
      })
      .then((calendar) => {
        if (active) setSchoolCalendar(calendar);
      })
      .catch((err) => {
        console.error("Error loading shared school calendar for report dates:", err);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setData([]);
    setRegisteredLearners([]);
    setMissedAoiRiskSourceRows([]);
    setStudentId("");
    setError("");
  }, [year, term, classLevel, stream, isEndOfYearMode]);

  const updateReportDate = (field, value) => {
    setReportDatesCache((prev) => {
      const next = {
        ...prev,
        [reportDatesKey]: {
          termEndedOn: reportDates.termEndedOn || "",
          nextTermBeginsOn: reportDates.nextTermBeginsOn || "",
          source: "manual",
          [field]: value,
        },
      };
      try {
        window.localStorage.setItem(REPORT_DATES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write issues
      }
      return next;
    });
    setError("");
  };

  const resetReportDatesToCalendar = () => {
    setReportDatesCache((prev) => {
      const next = { ...prev };
      delete next[reportDatesKey];
      try {
        window.localStorage.setItem(REPORT_DATES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write issues
      }
      return next;
    });
    setError("");
  };

  const validateReportDates = (actionLabel) => {
    if (reportDates.termEndedOn && reportDates.nextTermBeginsOn) return true;
    setError(
      `Enter both "Term Ended On" and "Next Term Begins On" before ${actionLabel} ${isEndOfYearMode ? "end-of-year" : "end-of-term"} report cards.`
    );
    return false;
  };

  /* ======================
     FETCH REPORT DATA
  ====================== */
  const handlePreview = async () => {
    if (!validateReportDates("previewing")) {
      setData([]);
      return;
    }

    setLoading(true);
    setError("");
    setData([]);
  
    try {
      // 🔹 Build query params safely
      const params = new URLSearchParams({
        year,
        term,
        class_level: classLevel,
        stream,
      });
  
      // 🔹 OPTIONAL: single student report
      if (studentId) {
        params.append("student_id", studentId);
      }
  
      const reportEndpoint = isEndOfYearMode
        ? "/api/admin/reports/year"
        : "/api/admin/reports/term";

      const rows = await adminFetch(`${reportEndpoint}?${params.toString()}`);
      const learners = await adminFetch("/api/students").catch(() => []);
      let missedRiskRows = [];
      if (!isEndOfYearMode) {
        const riskResponses = await Promise.all(
          O_LEVEL_STREAMS.map((streamName) => {
            const riskParams = new URLSearchParams({
              year,
              term,
              class_level: classLevel,
              stream: streamName,
            });
            return adminFetch(`${reportEndpoint}?${riskParams.toString()}`).catch((riskErr) => {
              console.error(`Failed to load missed AOI risk rows for ${streamName}:`, riskErr);
              return [];
            });
          })
        );
        missedRiskRows = riskResponses.flat().filter(Boolean);
      }
      const relevantLearners = Array.isArray(learners)
        ? learners.filter((learner) => {
            if (studentId) return String(learner.id) === String(studentId);
            return learner.class_level === classLevel && learner.stream === stream;
          })
        : [];
  
      // ✅ UX FIX — empty results (South / no marks / no assignments)
      if (rows.length === 0) {
        setError(
          studentId
            ? "No report data found for the selected student."
            : "No report data found for this class and stream. " +
              "This usually means teachers are not assigned or marks have not been submitted."
        );
      }
  
      setData(rows);
      setRegisteredLearners(relevantLearners);
      setMissedAoiRiskSourceRows(missedRiskRows);
    } catch (err) {
      setError(err.message || "Something went wrong");
      setRegisteredLearners([]);
      setMissedAoiRiskSourceRows([]);
    } finally {
      setLoading(false);
    }
  };
  
  

  /* ======================
     DOWNLOAD PDF
  ====================== */
  const handleDownload = async () => {
    if (!validateReportDates("downloading")) return;

    setError("");
    setDownloading(true);
    setDownloadProgress(0);
    setDownloadStage(
      `Preparing ${isEndOfYearMode ? "end-of-year" : "end-of-term"} reports...`
    );

    try {
      await generateReportCardPDF(
        data,
        {
          year,
          term,
          class_level: classLevel,
          stream,
          reportType: isEndOfYearMode ? "year" : "term",
          termEndedOn: reportDates.termEndedOn,
          nextTermBeginsOn: reportDates.nextTermBeginsOn,
        },
        {
          onProgress: ({ percent, stage }) => {
            setDownloadProgress(percent || 0);
            setDownloadStage(
              stage ||
                `Generating ${isEndOfYearMode ? "end-of-year" : "end-of-term"} reports...`
            );
          },
        }
      );
    } catch (err) {
      setError(err.message || "Failed to generate report card PDF.");
    } finally {
      setTimeout(() => {
        setDownloading(false);
        setDownloadProgress(0);
        setDownloadStage("");
      }, 500);
    }
  };

  const handleDownloadPerformanceIndicatorPdf = async () => {
    if (performanceRows.length === 0) {
      setError("Preview reports first, then download the performance indicator.");
      return;
    }

    setError("");

    try {
      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF("l", "mm", "a4");
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const generatedAt = new Date().toLocaleString();
      const termLabel = isEndOfYearMode ? "End of Year" : `Term ${term}`;

      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(10, 8, pageW - 20, 34, 3, 3, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(15, 23, 42);
      doc.text("ST PHILLIP'S EQUATORIAL SECONDARY SCHOOL", pageW / 2, 17, { align: "center" });

      doc.setFontSize(14);
      doc.text("Performance Indicator", pageW / 2, 26, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`Class: ${classLevel}`, 14, 35);
      doc.text(`Stream: ${stream}`, 50, 35);
      doc.text(`${termLabel} · ${year}`, 90, 35);
      doc.text(`Eligible: ${performanceSummary.eligible}`, 140, 35);
      doc.text(`Ineligible: ${performanceSummary.ineligible}`, 174, 35);
      doc.text(`Generated: ${generatedAt}`, 214, 35);

      const body = performanceRows.map((row, index) => [
        index + 1,
        row.student_name,
        row.eligible ? "Eligible" : "Ineligible",
        row.overall === null ? "—" : row.overall,
        row.class_position || "—",
        row.stream_position || "—",
        row.expectedLoad ? `${row.subjectCount}/${row.expectedLoad}` : row.subjectCount || "—",
        row.missingDetails.length ? row.missingDetails.join("; ") : "Complete",
      ]);

      autoTable(doc, {
        startY: 48,
        margin: { left: 10, right: 10, bottom: 14 },
        head: [["#", "Learner", "Status", "Indicator", "Class Pos.", "Stream Pos.", "Subjects", "Missing / Notes"]],
        body,
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 8,
          cellPadding: { top: 2.4, right: 1.8, bottom: 2.4, left: 1.8 },
          lineColor: [203, 213, 225],
          lineWidth: 0.16,
          textColor: [15, 23, 42],
          valign: "middle",
        },
        headStyles: {
          fillColor: [255, 255, 255],
          textColor: [15, 23, 42],
          lineColor: [148, 163, 184],
          fontStyle: "bold",
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 10, halign: "center" },
          1: { cellWidth: 48 },
          2: { cellWidth: 22, halign: "center" },
          3: { cellWidth: 20, halign: "center" },
          4: { cellWidth: 20, halign: "center" },
          5: { cellWidth: 22, halign: "center" },
          6: { cellWidth: 20, halign: "center" },
          7: { cellWidth: 126 },
        },
        didParseCell: (hookData) => {
          if (hookData.section !== "body") return;
          const row = performanceRows[hookData.row.index];
          if (hookData.column.index === 2) {
            hookData.cell.styles.textColor = row.eligible ? [22, 101, 52] : [153, 27, 27];
            hookData.cell.styles.fontStyle = "bold";
          }
        },
        didDrawPage: () => {
          const pageNumber = doc.internal.getCurrentPageInfo().pageNumber;
          const pageCount = doc.internal.getNumberOfPages();
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text(
            `Generated from SPESS ARK · ${generatedAt} · Page ${pageNumber} of ${pageCount}`,
            pageW / 2,
            pageH - 7,
            { align: "center" }
          );
        },
      });

      const blob = doc.output("blob");
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err) {
      setError(err.message || "Failed to generate performance indicator PDF.");
    }
  };

  const handleDownloadMissedAoiRiskPdf = async () => {
    if (missedAoiRiskRows.length === 0) {
      setError("Preview reports first. No missed AOI learners are currently available for this class.");
      return;
    }

    setError("");

    try {
      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF("l", "mm", "a4");
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const generatedAt = new Date().toLocaleString();

      doc.setDrawColor(203, 213, 225);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(10, 8, pageW - 20, 36, 3, 3, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(15, 23, 42);
      doc.text("ST PHILLIP'S EQUATORIAL SECONDARY SCHOOL", pageW / 2, 17, { align: "center" });

      doc.setFontSize(14);
      doc.text("AOI Missed-Risk Report", pageW / 2, 26, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`Class: ${classLevel}`, 14, 36);
      doc.text(`Streams: ${O_LEVEL_STREAMS.join(", ")}`, 50, 36);
      doc.text(`Term ${term} · ${year}`, 100, 36);
      doc.text(`Critical: ${missedAoiRiskSummary.critical}`, 140, 36);
      doc.text(`Intermediate: ${missedAoiRiskSummary.intermediate}`, 176, 36);
      doc.text(`Not urgent: ${missedAoiRiskSummary.notUrgent}`, 222, 36);

      const body = missedAoiRiskRows.map((row, index) => [
        index + 1,
        row.stream,
        row.student_name,
        row.risk,
        row.missedAoiCount,
        row.subjectCount,
        row.details.join("; "),
        row.action,
      ]);

      autoTable(doc, {
        startY: 51,
        margin: { left: 10, right: 10, bottom: 14 },
        head: [["#", "Stream", "Learner", "Risk", "Missed AOIs", "Subjects", "Where AOIs Were Missed", "Staff Meeting Action"]],
        body,
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 7.8,
          cellPadding: { top: 2.4, right: 1.7, bottom: 2.4, left: 1.7 },
          lineColor: [203, 213, 225],
          lineWidth: 0.16,
          textColor: [15, 23, 42],
          valign: "middle",
        },
        headStyles: {
          fillColor: [255, 255, 255],
          textColor: [15, 23, 42],
          lineColor: [148, 163, 184],
          fontStyle: "bold",
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 9, halign: "center" },
          1: { cellWidth: 18, halign: "center" },
          2: { cellWidth: 42 },
          3: { cellWidth: 28, halign: "center" },
          4: { cellWidth: 22, halign: "center" },
          5: { cellWidth: 18, halign: "center" },
          6: { cellWidth: 92 },
          7: { cellWidth: 48 },
        },
        didParseCell: (hookData) => {
          if (hookData.section !== "body") return;
          const row = missedAoiRiskRows[hookData.row.index];
          if (hookData.column.index === 3) {
            if (row.risk === "Critical") hookData.cell.styles.textColor = [153, 27, 27];
            if (row.risk === "Intermediate") hookData.cell.styles.textColor = [154, 52, 18];
            if (row.risk === "Not so urgent") hookData.cell.styles.textColor = [14, 116, 144];
            hookData.cell.styles.fontStyle = "bold";
          }
        },
        didDrawPage: () => {
          const pageNumber = doc.internal.getCurrentPageInfo().pageNumber;
          const pageCount = doc.internal.getNumberOfPages();
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text(
            `Generated from SPESS ARK · ${generatedAt} · Page ${pageNumber} of ${pageCount}`,
            pageW / 2,
            pageH - 7,
            { align: "center" }
          );
        },
      });

      const blob = doc.output("blob");
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err) {
      setError(err.message || "Failed to generate missed AOI risk PDF.");
    }
  };

  return (
    <div className="admin-section">
      <h2>{isEndOfYearMode ? "📕 End of Year Reports" : "📘 End of Term Reports"}</h2>

      {/* FILTERS */}
      <div className="filter-grid">
        <select value={year} onChange={(e) => setYear(e.target.value)}>
        <option value={currentYear}>{currentYear}</option>
        <option value={currentYear - 1}>{currentYear - 1}</option>

        </select>

        <select value={term} onChange={(e) => setTerm(e.target.value)}>
          {termOptions.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <select value={classLevel} onChange={(e) => setClassLevel(e.target.value)}>
          <option value="S1">S1</option>
          <option value="S2">S2</option>
          <option value="S3">S3</option>
          <option value="S4">S4</option>
        </select>

        <select value={stream} onChange={(e) => setStream(e.target.value)}>
          <option value="North">North</option>
          <option value="South">South</option>
        </select>
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
  <option value="">All students (class report)</option>
  {data
    .map((r) => ({ id: r.student_id, name: r.student_name }))
    .filter(
      (v, i, a) => a.findIndex(x => x.id === v.id) === i
    )
    .map((s) => (
      <option key={s.id} value={s.id}>
        {s.name}
      </option>
    ))}
</select>

      </div>

      {/* ACTIONS */}
      <div style={{ marginTop: "1rem" }}>
        <button onClick={handlePreview} disabled={loading || downloading}>
          {loading ? "Loading…" : "Preview"}
        </button>

        <button
          onClick={handleDownload}
          disabled={data.length === 0 || downloading}
          style={{ marginLeft: "1rem" }}
        >
          {downloading ? "Generating PDF…" : "Download PDF"}
        </button>
      </div>

      {downloading && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.95rem 1rem",
            borderRadius: "1rem",
            border: "1px solid rgba(59, 130, 246, 0.28)",
            background: "rgba(15, 23, 42, 0.82)",
            display: "grid",
            gap: "0.7rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "1rem",
              color: "#dbeafe",
              fontSize: "0.92rem",
            }}
          >
            <strong style={{ color: "#93c5fd" }}>
              Processing {isEndOfYearMode ? "End-of-Year" : "End-of-Term"} Reports
            </strong>
            <span>{downloadProgress}%</span>
          </div>
          <div
            style={{
              width: "100%",
              height: "12px",
              borderRadius: "999px",
              background: "rgba(30, 41, 59, 0.92)",
              overflow: "hidden",
              border: "1px solid rgba(148, 163, 184, 0.2)",
            }}
          >
            <div
              style={{
                width: `${Math.max(4, downloadProgress)}%`,
                height: "100%",
                borderRadius: "999px",
                background: "linear-gradient(90deg, #38bdf8 0%, #22c55e 100%)",
                transition: "width 160ms ease",
              }}
            />
          </div>
          <div style={{ color: "#cbd5e1", fontSize: "0.88rem" }}>
            {downloadStage ||
              `Generating ${isEndOfYearMode ? "end-of-year" : "end-of-term"} reports...`}
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: "1rem",
          padding: "0.95rem 1rem",
          borderRadius: "1rem",
          border: "1px solid rgba(148, 163, 184, 0.28)",
          background: "rgba(15, 23, 42, 0.72)",
          display: "grid",
          gap: "0.8rem",
        }}
      >
        <div>
          <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#93c5fd", marginBottom: "0.3rem" }}>
            Report Dates
          </div>
          <div style={{ fontSize: "0.88rem", color: "#cbd5e1", lineHeight: 1.6 }}>
            {hasCalendarReportDates && !hasManualReportDateOverride
              ? "Synced from the School Calendar. Edit the calendar if these dates need to change."
              : "Set these once here and they go straight onto the report card. Preview and download stay blocked until both dates are filled."}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: "999px",
              padding: "0.35rem 0.68rem",
              border: hasManualReportDateOverride
                ? "1px solid rgba(251, 146, 60, 0.28)"
                : "1px solid rgba(34, 197, 94, 0.24)",
              background: hasManualReportDateOverride
                ? "rgba(146, 64, 14, 0.2)"
                : "rgba(22, 101, 52, 0.2)",
              color: hasManualReportDateOverride ? "#fed7aa" : "#bbf7d0",
              fontSize: "0.78rem",
              fontWeight: 800,
            }}
          >
            {hasManualReportDateOverride
              ? "Manual report dates active"
              : hasCalendarReportDates
              ? "Calendar synced"
              : "Calendar dates unavailable"}
          </span>

          {hasManualReportDateOverride && (
            <button
              type="button"
              onClick={resetReportDatesToCalendar}
              style={{
                border: "1px solid rgba(148, 163, 184, 0.28)",
                borderRadius: "999px",
                padding: "0.42rem 0.78rem",
                background: "rgba(15, 23, 42, 0.88)",
                color: "#e2e8f0",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Reset to Calendar
            </button>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.8rem",
          }}
        >
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#cbd5e1" }}>
              Term Ended On
            </span>
            <input
              type="date"
              value={reportDates.termEndedOn || ""}
              onChange={(e) => updateReportDate("termEndedOn", e.target.value)}
              style={{
                minHeight: "44px",
                borderRadius: "0.9rem",
                border: "1px solid rgba(148, 163, 184, 0.35)",
                background: "rgba(2, 6, 23, 0.9)",
                color: "#e2e8f0",
                padding: "0.72rem 0.85rem",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#cbd5e1" }}>
              Next Term Begins On
            </span>
            <input
              type="date"
              value={reportDates.nextTermBeginsOn || ""}
              onChange={(e) => updateReportDate("nextTermBeginsOn", e.target.value)}
              style={{
                minHeight: "44px",
                borderRadius: "0.9rem",
                border: "1px solid rgba(148, 163, 184, 0.35)",
                background: "rgba(2, 6, 23, 0.9)",
                color: "#e2e8f0",
                padding: "0.72rem 0.85rem",
                outline: "none",
              }}
            />
          </label>
        </div>
      </div>

      <div
        style={{
          marginTop: "1rem",
          padding: "0.95rem 1rem",
          borderRadius: "1rem",
          border: "1px solid rgba(34, 197, 94, 0.24)",
          background:
            "linear-gradient(135deg, rgba(15, 23, 42, 0.88), rgba(2, 6, 23, 0.94))",
          display: "grid",
          gap: "0.85rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#86efac", marginBottom: "0.3rem" }}>
              Performance Indicator
            </div>
            <div style={{ fontSize: "0.88rem", color: "#cbd5e1", lineHeight: 1.6 }}>
              Ranks eligible learners first by performance, then places ineligible learners below with missing marks and readiness notes.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
            <span
              style={{
                padding: "0.35rem 0.65rem",
                borderRadius: "999px",
                background: "rgba(22, 101, 52, 0.28)",
                color: "#bbf7d0",
                fontSize: "0.78rem",
                fontWeight: 800,
              }}
            >
              Eligible {performanceSummary.eligible}
            </span>
            <span
              style={{
                padding: "0.35rem 0.65rem",
                borderRadius: "999px",
                background: "rgba(127, 29, 29, 0.28)",
                color: "#fecaca",
                fontSize: "0.78rem",
                fontWeight: 800,
              }}
            >
              Ineligible {performanceSummary.ineligible}
            </span>
            <button
              type="button"
              onClick={handleDownloadPerformanceIndicatorPdf}
              disabled={performanceRows.length === 0 || loading || downloading}
              style={{
                border: "none",
                borderRadius: "999px",
                padding: "0.52rem 0.95rem",
                background:
                  performanceRows.length === 0
                    ? "rgba(71, 85, 105, 0.65)"
                    : "linear-gradient(135deg, #22c55e, #0f766e)",
                color: "#fff",
                fontWeight: 800,
                cursor: performanceRows.length === 0 ? "not-allowed" : "pointer",
                boxShadow: performanceRows.length === 0 ? "none" : "0 10px 22px rgba(34, 197, 94, 0.18)",
              }}
            >
              Download Indicator PDF
            </button>
          </div>
        </div>

        {performanceRows.length === 0 ? (
          <div
            style={{
              border: "1px dashed rgba(148, 163, 184, 0.3)",
              borderRadius: "0.9rem",
              color: "#94a3b8",
              padding: "0.85rem",
              fontSize: "0.86rem",
            }}
          >
            Click Preview first to build the performance indicator for this class and stream.
          </div>
        ) : (
          <div style={{ maxHeight: "320px", overflow: "auto", borderRadius: "0.9rem" }}>
            <table className="teachers-table" style={{ minWidth: "760px" }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Learner</th>
                  <th>Status</th>
                  <th>Indicator</th>
                  <th>Class Pos.</th>
                  <th>Stream Pos.</th>
                  <th>Missing / Notes</th>
                </tr>
              </thead>
              <tbody>
                {performanceRows.map((row, index) => (
                  <tr key={row.student_id}>
                    <td>{index + 1}</td>
                    <td>{row.student_name}</td>
                    <td>
                      <span
                        style={{
                          display: "inline-flex",
                          borderRadius: "999px",
                          padding: "0.22rem 0.55rem",
                          fontSize: "0.72rem",
                          fontWeight: 800,
                          background: row.eligible ? "rgba(22, 101, 52, 0.28)" : "rgba(127, 29, 29, 0.28)",
                          color: row.eligible ? "#bbf7d0" : "#fecaca",
                        }}
                      >
                        {row.eligible ? "Eligible" : "Ineligible"}
                      </span>
                    </td>
                    <td>{row.overall === null ? "—" : row.overall}</td>
                    <td>{row.class_position || "—"}</td>
                    <td>{row.stream_position || "—"}</td>
                    <td>{row.missingDetails.length ? row.missingDetails.join("; ") : "Complete"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!isEndOfYearMode && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.95rem 1rem",
            borderRadius: "1rem",
            border: "1px solid rgba(248, 113, 113, 0.24)",
            background:
              "linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(69, 10, 10, 0.42))",
            display: "grid",
            gap: "0.85rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#fca5a5", marginBottom: "0.3rem" }}>
                AOI Missed-Risk Report
              </div>
              <div style={{ fontSize: "0.88rem", color: "#cbd5e1", lineHeight: 1.6 }}>
                Staff-meeting list for learners who missed AOIs, grouped across North and South. Critical means 6+ missed AOIs; Intermediate means 3-5; Not so urgent means 1-2.
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
              {[
                { label: "Critical", value: missedAoiRiskSummary.critical },
                { label: "Intermediate", value: missedAoiRiskSummary.intermediate },
                { label: "Not so urgent", value: missedAoiRiskSummary.notUrgent },
              ].map((item) => {
                const tone = getMissedAoiRiskTone(item.label);
                return (
                  <span
                    key={item.label}
                    style={{
                      padding: "0.35rem 0.65rem",
                      borderRadius: "999px",
                      background: tone.background,
                      color: tone.color,
                      border: tone.border,
                      fontSize: "0.78rem",
                      fontWeight: 800,
                    }}
                  >
                    {item.label} {item.value}
                  </span>
                );
              })}
              <button
                type="button"
                onClick={handleDownloadMissedAoiRiskPdf}
                disabled={missedAoiRiskRows.length === 0 || loading || downloading}
                style={{
                  border: "none",
                  borderRadius: "999px",
                  padding: "0.52rem 0.95rem",
                  background:
                    missedAoiRiskRows.length === 0
                      ? "rgba(71, 85, 105, 0.65)"
                      : "linear-gradient(135deg, #ef4444, #f97316)",
                  color: "#fff",
                  fontWeight: 800,
                  cursor: missedAoiRiskRows.length === 0 ? "not-allowed" : "pointer",
                  boxShadow: missedAoiRiskRows.length === 0 ? "none" : "0 10px 22px rgba(239, 68, 68, 0.18)",
                }}
              >
                Download Missed AOI PDF
              </button>
            </div>
          </div>

          {missedAoiRiskRows.length === 0 ? (
            <div
              style={{
                border: "1px dashed rgba(248, 113, 113, 0.3)",
                borderRadius: "0.9rem",
                color: "#fca5a5",
                padding: "0.85rem",
                fontSize: "0.86rem",
              }}
            >
              Click Preview first. If this stays empty, no learner has been explicitly marked as missed for an AOI in this class and term.
            </div>
          ) : (
            <div style={{ maxHeight: "320px", overflow: "auto", borderRadius: "0.9rem" }}>
              <table className="teachers-table" style={{ minWidth: "900px" }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Stream</th>
                    <th>Learner</th>
                    <th>Risk</th>
                    <th>Missed AOIs</th>
                    <th>Subjects</th>
                    <th>Where missed</th>
                    <th>Staff action</th>
                  </tr>
                </thead>
                <tbody>
                  {missedAoiRiskRows.slice(0, 30).map((row, index) => {
                    const tone = getMissedAoiRiskTone(row.risk);
                    return (
                      <tr key={`${row.student_id}-${row.stream}`}>
                        <td>{index + 1}</td>
                        <td>{row.stream}</td>
                        <td>{row.student_name}</td>
                        <td>
                          <span
                            style={{
                              display: "inline-flex",
                              borderRadius: "999px",
                              padding: "0.22rem 0.55rem",
                              fontSize: "0.72rem",
                              fontWeight: 800,
                              background: tone.background,
                              color: tone.color,
                              border: tone.border,
                            }}
                          >
                            {row.risk}
                          </span>
                        </td>
                        <td>{row.missedAoiCount}</td>
                        <td>{row.subjectCount}</td>
                        <td>{row.details.join("; ")}</td>
                        <td>{row.action}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* STATUS */}
      {error && <div className="error-box">{error}</div>}

      {data.length > 0 && (
        <div className="preview-box">
          <p>
            ✅ {new Set(data.map((r) => r.student_id)).size} students found
          </p>
          <p>Subjects included: {new Set(data.map((r) => r.subject)).size}</p>
        </div>
      )}
    </div>
  );
  
}

export default EndOfTermReports;
 
