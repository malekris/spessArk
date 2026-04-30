import { useEffect, useMemo, useState } from "react";
import "./AlevelReport.css";
import ALevelAdminShell from "../components/ALevelAdminShell";
import "../../../pages/AdminDashboard.css";
import "./ALevelAdminTheme.css";

import badge from "../../../assets/badge.png";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import { normalizeSchoolCalendar } from "../../../utils/schoolCalendar";
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const ALEVEL_REPORT_DATES_STORAGE_KEY = "spess_alevel_report_dates";

const formatReportDateValue = (value) => {
  if (!value) return "__________";
  const raw = String(value).trim();
  if (!raw) return "__________";
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString("en-GB");
};

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
    normalizedTerm === "term 1" ? 1 : normalizedTerm === "term 2" ? 2 : normalizedTerm === "term 3" ? 3 : null;

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

const ALEVEL_MISSED_RISK_ORDER = {
  Critical: 0,
  Intermediate: 1,
  "Not so urgent": 2,
};

const hasValue = (value) => value !== null && value !== undefined && value !== "";

const toNumberOrNull = (value) => {
  if (!hasValue(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const isMissedStatus = (status) => String(status || "").trim().toLowerCase() === "missed";
const isMissingStatus = (status) => String(status || "").trim().toLowerCase() === "missing";

const getAlevelSubjectGroups = (student = {}) => [
  ...(Array.isArray(student.principals)
    ? student.principals.map((subject) => ({ ...subject, subjectType: "Principal" }))
    : []),
  ...(Array.isArray(student.subsidiaries)
    ? student.subsidiaries.map((subject) => ({ ...subject, subjectType: "Subsidiary" }))
    : []),
];

const getAlevelLearnerId = (studentOrLearner = {}) => {
  const learner = studentOrLearner.learner || studentOrLearner;
  return String(learner.id || learner.student_id || "").trim();
};

const getAlevelLearnerName = (studentOrLearner = {}) => {
  const learner = studentOrLearner.learner || studentOrLearner;
  return String(learner.name || learner.student_name || "Unknown learner").trim();
};

const splitSubjectList = (value = "") =>
  String(value || "")
    .split(",")
    .map((subject) => subject.trim())
    .filter(Boolean);

const normalizeAlevelStreamName = (value = "") => String(value || "").replace(/^S[56]\s+/i, "").trim() || "—";

const buildAlevelPaperLabel = (subjectGroup = {}, paper = {}) => {
  const subject = subjectGroup.subject || "Subject";
  const paperLabel = String(paper.paper || "").trim();
  return paperLabel && paperLabel !== "Single" ? `${subject} ${paperLabel}` : subject;
};

const collectAlevelComponentIssues = (student, { missedOnly = false } = {}) => {
  const details = [];

  getAlevelSubjectGroups(student).forEach((subjectGroup) => {
    const papers = Array.isArray(subjectGroup.papers) ? subjectGroup.papers : [];

    papers.forEach((paper) => {
      const components = [
        ["mid_status", "MID"],
        ["eot_status", "EOT"],
      ]
        .map(([statusKey, label]) => {
          const status = paper?.[statusKey];
          if (missedOnly) {
            return isMissedStatus(status) ? `${label} missed` : "";
          }
          if (isMissedStatus(status)) return `${label} missed`;
          if (isMissingStatus(status)) return `${label} missing`;
          return "";
        })
        .filter(Boolean);

      if (components.length > 0) {
        details.push(`${buildAlevelPaperLabel(subjectGroup, paper)}: ${components.join(", ")}`);
      }
    });
  });

  return details;
};

const countAlevelExplicitMissedComponents = (student) =>
  getAlevelSubjectGroups(student).reduce((sum, subjectGroup) => {
    const papers = Array.isArray(subjectGroup.papers) ? subjectGroup.papers : [];
    return (
      sum +
      papers.reduce(
        (paperSum, paper) =>
          paperSum +
          (isMissedStatus(paper?.mid_status) ? 1 : 0) +
          (isMissedStatus(paper?.eot_status) ? 1 : 0),
        0
      )
    );
  }, 0);

const classifyAlevelMissedRisk = (missedCount) => {
  const count = Number(missedCount || 0);
  if (count >= 4) return "Critical";
  if (count >= 2) return "Intermediate";
  return "Not so urgent";
};

const getAlevelMissedRiskAction = (risk) => {
  if (risk === "Critical") return "Immediate DOS + parent follow-up";
  if (risk === "Intermediate") return "Class teacher follow-up this week";
  return "Monitor and remind before next assessment";
};

const getAlevelMissedRiskTone = (risk) => {
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

const getAlevelSubjectDescriptor = (average) => {
  const value = Number(average);
  if (!Number.isFinite(value)) return "Pending";
  if (value >= 75) return "Distinction";
  if (value >= 60) return "Credit";
  if (value >= 50) return "Pass";
  if (value >= 40) return "Subsidiary";
  return "Fail";
};

const getAlevelSubjectTone = (descriptor) => {
  if (descriptor === "Distinction") {
    return {
      background: "rgba(22, 101, 52, 0.24)",
      color: "#bbf7d0",
      border: "1px solid rgba(34, 197, 94, 0.22)",
    };
  }
  if (descriptor === "Credit" || descriptor === "Pass") {
    return {
      background: "rgba(14, 116, 144, 0.22)",
      color: "#bae6fd",
      border: "1px solid rgba(34, 211, 238, 0.22)",
    };
  }
  return {
    background: "rgba(146, 64, 14, 0.22)",
    color: "#fed7aa",
    border: "1px solid rgba(251, 146, 60, 0.22)",
  };
};

const buildAlevelPerformanceRows = (reportData = [], registeredLearners = [], fallbackMeta = {}) => {
  const reportByLearner = new Map();
  (Array.isArray(reportData) ? reportData : []).forEach((student) => {
    const id = getAlevelLearnerId(student);
    if (id) reportByLearner.set(id, student);
  });

  const registeredByLearner = new Map();
  (Array.isArray(registeredLearners) ? registeredLearners : []).forEach((learner) => {
    const id = getAlevelLearnerId(learner);
    if (id) registeredByLearner.set(id, learner);
  });

  const learnerIds = new Set([...reportByLearner.keys(), ...registeredByLearner.keys()]);

  return Array.from(learnerIds)
    .map((id) => {
      const report = reportByLearner.get(id);
      const registered = registeredByLearner.get(id);
      const subjects = report ? getAlevelSubjectGroups(report) : [];
      const registeredSubjects = splitSubjectList(registered?.subjects);
      const issueDetails = report
        ? collectAlevelComponentIssues(report)
        : [
            registeredSubjects.length > 0
              ? `No submitted A-Level marks found for: ${registeredSubjects.join(", ")}`
              : "No submitted A-Level marks found",
          ];
      const totalPoints = toNumberOrNull(report?.totals?.overall);
      const principalPoints = toNumberOrNull(report?.totals?.principal);
      const subsidiaryPoints = toNumberOrNull(report?.totals?.subsidiary);
      const subjectCount = subjects.length || registeredSubjects.length;
      const eligible = report && issueDetails.length === 0 && totalPoints !== null;

      return {
        learnerId: id,
        learnerName: report ? getAlevelLearnerName(report) : getAlevelLearnerName(registered),
        classLevel: report?.learner?.class || fallbackMeta.cls || "—",
        stream: normalizeAlevelStreamName(report?.learner?.stream || registered?.stream || fallbackMeta.stream),
        combination: report?.learner?.combination || registered?.combination || "—",
        eligible,
        totalPoints,
        principalPoints,
        subsidiaryPoints,
        subjectCount,
        issueDetails,
      };
    })
    .sort((a, b) => {
      const totalDiff = (b.totalPoints ?? -1) - (a.totalPoints ?? -1);
      if (totalDiff !== 0) return totalDiff;
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (a.issueDetails.length !== b.issueDetails.length) return a.issueDetails.length - b.issueDetails.length;
      return a.learnerName.localeCompare(b.learnerName);
    });
};

const buildAlevelMissedRiskRows = (reportData = []) =>
  (Array.isArray(reportData) ? reportData : [])
    .map((student) => {
      const missedCount = countAlevelExplicitMissedComponents(student);
      if (missedCount === 0) return null;

      const subjects = new Set();
      getAlevelSubjectGroups(student).forEach((subjectGroup) => {
        const papers = Array.isArray(subjectGroup.papers) ? subjectGroup.papers : [];
        if (papers.some((paper) => isMissedStatus(paper?.mid_status) || isMissedStatus(paper?.eot_status))) {
          subjects.add(subjectGroup.subject || "Subject");
        }
      });

      const risk = classifyAlevelMissedRisk(missedCount);
      return {
        learnerId: getAlevelLearnerId(student),
        learnerName: getAlevelLearnerName(student),
        stream: normalizeAlevelStreamName(student?.learner?.stream),
        combination: student?.learner?.combination || "—",
        missedCount,
        subjectCount: subjects.size,
        details: collectAlevelComponentIssues(student, { missedOnly: true }),
        risk,
        action: getAlevelMissedRiskAction(risk),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const riskDiff = ALEVEL_MISSED_RISK_ORDER[a.risk] - ALEVEL_MISSED_RISK_ORDER[b.risk];
      if (riskDiff !== 0) return riskDiff;
      if (b.missedCount !== a.missedCount) return b.missedCount - a.missedCount;
      return a.learnerName.localeCompare(b.learnerName);
    });

const buildAlevelSubjectRankRows = (reportData = [], registeredLearners = []) => {
  const bySubject = new Map();
  const ensureSubject = (subjectName) => {
    const subject = String(subjectName || "").trim();
    if (!subject) return null;
    const key = subject.toLowerCase();
    if (!bySubject.has(key)) {
      bySubject.set(key, {
        subject,
        averages: [],
        reportLearners: new Set(),
        registeredLearners: new Set(),
        streams: new Set(),
        subjectTypes: new Set(),
        missedCount: 0,
      });
    }
    return bySubject.get(key);
  };

  (Array.isArray(registeredLearners) ? registeredLearners : []).forEach((learner) => {
    const learnerId = getAlevelLearnerId(learner);
    splitSubjectList(learner?.subjects).forEach((subject) => {
      const bucket = ensureSubject(subject);
      if (bucket && learnerId) bucket.registeredLearners.add(learnerId);
      if (bucket && learner?.stream) bucket.streams.add(normalizeAlevelStreamName(learner.stream));
    });
  });

  (Array.isArray(reportData) ? reportData : []).forEach((student) => {
    const learnerId = getAlevelLearnerId(student);
    getAlevelSubjectGroups(student).forEach((subjectGroup) => {
      const bucket = ensureSubject(subjectGroup.subject);
      if (!bucket) return;

      if (learnerId) {
        bucket.reportLearners.add(learnerId);
        bucket.registeredLearners.add(learnerId);
      }
      if (student?.learner?.stream) bucket.streams.add(normalizeAlevelStreamName(student.learner.stream));
      if (subjectGroup.subjectType) bucket.subjectTypes.add(subjectGroup.subjectType);

      const average = toNumberOrNull(subjectGroup.mergedAverage);
      if (average !== null) bucket.averages.push(average);

      const papers = Array.isArray(subjectGroup.papers) ? subjectGroup.papers : [];
      papers.forEach((paper) => {
        if (isMissedStatus(paper?.mid_status)) bucket.missedCount += 1;
        if (isMissedStatus(paper?.eot_status)) bucket.missedCount += 1;
      });
    });
  });

  return Array.from(bySubject.values())
    .filter((row) => row.averages.length > 0)
    .map((row) => {
      const average = Number((row.averages.reduce((sum, value) => sum + value, 0) / row.averages.length).toFixed(2));
      return {
        subject: row.subject,
        average,
        descriptor: getAlevelSubjectDescriptor(average),
        scoredLearners: row.averages.length,
        learnerCount: row.registeredLearners.size || row.reportLearners.size,
        missedCount: row.missedCount,
        streams: Array.from(row.streams).sort(),
        subjectTypes: Array.from(row.subjectTypes).sort(),
      };
    })
    .sort((a, b) => {
      if (b.average !== a.average) return b.average - a.average;
      if (a.missedCount !== b.missedCount) return a.missedCount - b.missedCount;
      return a.subject.localeCompare(b.subject);
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
};

export default function AlevelReport() {
  const [term, setTerm] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [cls, setCls] = useState("");
  const [stream, setStream] = useState("");

  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [reportData, setReportData] = useState([]);
  const [registeredLearners, setRegisteredLearners] = useState([]);
  const [error, setError] = useState("");
  const [schoolCalendar, setSchoolCalendar] = useState(null);
  const [reportDatesCache, setReportDatesCache] = useState(() => {
    try {
      const raw = window.localStorage.getItem(ALEVEL_REPORT_DATES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });

  const reportDatesKey = useMemo(
    () => `alevel_${year}_${term || "pending"}`,
    [year, term]
  );
  const derivedReportDates = useMemo(
    () => getCalendarDrivenReportDates(schoolCalendar, term, year),
    [schoolCalendar, term, year]
  );
  const reportDates = useMemo(
    () => ({
      ...derivedReportDates,
      ...(reportDatesCache[reportDatesKey] || {}),
    }),
    [derivedReportDates, reportDatesCache, reportDatesKey]
  );
  const performanceRows = useMemo(
    () => buildAlevelPerformanceRows(reportData, registeredLearners, { cls, stream }),
    [reportData, registeredLearners, cls, stream]
  );
  const performanceSummary = useMemo(
    () => ({
      eligible: performanceRows.filter((row) => row.eligible).length,
      ineligible: performanceRows.filter((row) => !row.eligible).length,
    }),
    [performanceRows]
  );
  const missedRiskRows = useMemo(
    () => buildAlevelMissedRiskRows(reportData),
    [reportData]
  );
  const missedRiskSummary = useMemo(
    () => ({
      critical: missedRiskRows.filter((row) => row.risk === "Critical").length,
      intermediate: missedRiskRows.filter((row) => row.risk === "Intermediate").length,
      notUrgent: missedRiskRows.filter((row) => row.risk === "Not so urgent").length,
      totalMissed: missedRiskRows.reduce((sum, row) => sum + Number(row.missedCount || 0), 0),
    }),
    [missedRiskRows]
  );
  const subjectRankRows = useMemo(
    () => buildAlevelSubjectRankRows(reportData, registeredLearners),
    [reportData, registeredLearners]
  );
  const bestSubject = subjectRankRows[0] || null;
  const weakestSubject = subjectRankRows.length > 0 ? subjectRankRows[subjectRankRows.length - 1] : null;

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/school-calendar`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load school calendar");
        return res.json();
      })
      .then((data) => {
        if (active) setSchoolCalendar(data);
      })
      .catch((err) => {
        console.error("Error loading school calendar for A-Level reports:", err);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setPreviewData(null);
    setReportData([]);
    setRegisteredLearners([]);
    setError("");
  }, [term, year, cls, stream]);

  const updateReportDate = (field, value) => {
    setReportDatesCache((prev) => {
      const next = {
        ...prev,
        [reportDatesKey]: {
          ...(prev[reportDatesKey] || {}),
          [field]: value,
        },
      };
      try {
        window.localStorage.setItem(ALEVEL_REPORT_DATES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore localStorage write issues
      }
      return next;
    });
    setError("");
  };

  const validateReportDates = (actionLabel) => {
    if (reportDates.termEndedOn && reportDates.nextTermBeginsOn) return true;
    setError(`Set both report dates before ${actionLabel} A-Level reports.`);
    return false;
  };

  const handlePreview = async () => {
    setError("");
    setPreviewData(null);
    setReportData([]);
    setRegisteredLearners([]);

    if (!term || !cls || !stream || !year) {
      setError("Please select all fields before previewing.");
      return;
    }

    if (!validateReportDates("previewing")) return;

    try {
      setLoading(true);
      const payload = { term, class: cls, stream, year };
      const fullStream = `${cls} ${stream}`;

      const [previewRes, reportRes, learnersRes] = await Promise.all([
        fetch(`${API_BASE}/api/alevel/reports/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        fetch(`${API_BASE}/api/alevel/reports/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        fetch(`${API_BASE}/api/alevel/learners`),
      ]);

      const [preview, reports, learners] = await Promise.all([
        previewRes.json(),
        reportRes.json(),
        learnersRes.json(),
      ]);

      if (!previewRes.ok) throw new Error(preview.message || "Failed to preview reports");
      if (!reportRes.ok) throw new Error(reports.message || "Failed to load A-Level report details");
      if (!learnersRes.ok) throw new Error(learners.message || "Failed to load A-Level learners");

      const filteredLearners = (Array.isArray(learners) ? learners : []).filter(
        (learner) => String(learner.stream || "").trim() === fullStream
      );

      setPreviewData(preview);
      setReportData(Array.isArray(reports) ? reports : []);
      setRegisteredLearners(filteredLearners);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      if (!validateReportDates("downloading")) return;
      setDownloading(true);

      let data = reportData;

      if (!Array.isArray(data) || data.length === 0) {
        const res = await fetch(`${API_BASE}/api/alevel/reports/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term, class: cls, stream, year }),
        });

        data = await res.json();
        if (!res.ok) throw new Error(data.message || "Download failed");
      }

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("No A-Level report cards are available for this selection yet.");
      }

      await generateAlevelPDF(data, {
        term,
        year,
        cls,
        stream,
        termEndedOn: reportDates.termEndedOn,
        nextTermBeginsOn: reportDates.nextTermBeginsOn,
      });
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to download report");
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadPerformanceIndicatorPdf = async () => {
    if (performanceRows.length === 0) {
      setError("Preview reports first. No A-Level performance indicator data is available yet.");
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
      doc.text("A-Level Performance Indicator", pageW / 2, 26, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`Class: ${cls}`, 14, 36);
      doc.text(`Stream: ${stream}`, 50, 36);
      doc.text(`${term} · ${year}`, 90, 36);
      doc.text(`Eligible: ${performanceSummary.eligible}`, 140, 36);
      doc.text(`Ineligible: ${performanceSummary.ineligible}`, 174, 36);
      doc.text(`Generated: ${generatedAt}`, 214, 36);

      const body = performanceRows.map((row, index) => [
        index + 1,
        row.learnerName,
        row.eligible ? "Eligible" : "Ineligible",
        row.totalPoints === null ? "—" : row.totalPoints,
        row.principalPoints === null ? "—" : row.principalPoints,
        row.subsidiaryPoints === null ? "—" : row.subsidiaryPoints,
        row.subjectCount || "—",
        row.issueDetails.length ? row.issueDetails.join("; ") : "Complete",
      ]);

      autoTable(doc, {
        startY: 51,
        margin: { left: 10, right: 10, bottom: 14 },
        head: [["#", "Learner", "Status", "Total Pts", "Principal", "Subsidiary", "Subjects", "MID/EOT Readiness Notes"]],
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
          2: { cellWidth: 24, halign: "center" },
          3: { cellWidth: 19, halign: "center" },
          4: { cellWidth: 20, halign: "center" },
          5: { cellWidth: 22, halign: "center" },
          6: { cellWidth: 18, halign: "center" },
          7: { cellWidth: 116 },
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

      openNamedPdfPreview(
        doc,
        `ALevel_Performance_Indicator_${cls}_${stream}_${term}_${year}.pdf`.replace(/\s+/g, "_"),
        `A-Level Performance Indicator - ${cls} ${stream} - ${term} ${year}`
      );
    } catch (err) {
      setError(err.message || "Failed to generate A-Level performance indicator PDF.");
    }
  };

  const handleDownloadMissedRiskPdf = async () => {
    if (missedRiskRows.length === 0) {
      setError("Preview reports first. No explicitly missed MID/EOT entries are available for this class.");
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
      doc.text("A-Level MID/EOT Missed-Risk Report", pageW / 2, 26, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`Class: ${cls}`, 14, 36);
      doc.text(`Stream: ${stream}`, 50, 36);
      doc.text(`${term} · ${year}`, 90, 36);
      doc.text(`Critical: ${missedRiskSummary.critical}`, 140, 36);
      doc.text(`Intermediate: ${missedRiskSummary.intermediate}`, 176, 36);
      doc.text(`Not urgent: ${missedRiskSummary.notUrgent}`, 224, 36);

      const body = missedRiskRows.map((row, index) => [
        index + 1,
        row.stream,
        row.learnerName,
        row.risk,
        row.missedCount,
        row.subjectCount,
        row.details.join("; "),
        row.action,
      ]);

      autoTable(doc, {
        startY: 51,
        margin: { left: 10, right: 10, bottom: 14 },
        head: [["#", "Stream", "Learner", "Risk", "Missed MID/EOT", "Subjects", "Where Missed", "Staff Action"]],
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
          4: { cellWidth: 24, halign: "center" },
          5: { cellWidth: 18, halign: "center" },
          6: { cellWidth: 92 },
          7: { cellWidth: 46 },
        },
        didParseCell: (hookData) => {
          if (hookData.section !== "body") return;
          const row = missedRiskRows[hookData.row.index];
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

      openNamedPdfPreview(
        doc,
        `ALevel_MID_EOT_Missed_Risk_${cls}_${stream}_${term}_${year}.pdf`.replace(/\s+/g, "_"),
        `A-Level MID/EOT Missed-Risk - ${cls} ${stream} - ${term} ${year}`
      );
    } catch (err) {
      setError(err.message || "Failed to generate A-Level missed-risk PDF.");
    }
  };

  const handleDownloadSubjectRankPdf = async () => {
    if (subjectRankRows.length === 0) {
      setError("Preview reports first. No A-Level subject rank data is available yet.");
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
      doc.text("A-Level Subject Rank", pageW / 2, 26, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`Class: ${cls}`, 14, 36);
      doc.text(`Stream: ${stream}`, 50, 36);
      doc.text(`${term} · ${year}`, 90, 36);
      doc.text(`Best: ${bestSubject?.subject || "—"}`, 140, 36);
      doc.text(`Weakest: ${weakestSubject?.subject || "—"}`, 210, 36);

      const body = subjectRankRows.map((row) => [
        row.rank,
        row.subject,
        row.average.toFixed(2),
        row.descriptor,
        row.scoredLearners,
        row.learnerCount,
        row.missedCount,
        row.streams.join(", "),
      ]);

      autoTable(doc, {
        startY: 51,
        margin: { left: 10, right: 10, bottom: 14 },
        head: [["Rank", "Subject", "Average", "Band", "Scores", "Learners", "Missed MID/EOT", "Streams"]],
        body,
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 8.2,
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
          0: { cellWidth: 14, halign: "center" },
          1: { cellWidth: 58 },
          2: { cellWidth: 24, halign: "center" },
          3: { cellWidth: 30, halign: "center" },
          4: { cellWidth: 20, halign: "center" },
          5: { cellWidth: 22, halign: "center" },
          6: { cellWidth: 28, halign: "center" },
          7: { cellWidth: 76 },
        },
        didParseCell: (hookData) => {
          if (hookData.section !== "body") return;
          const row = subjectRankRows[hookData.row.index];
          if (hookData.column.index === 3) {
            if (row.descriptor === "Distinction") hookData.cell.styles.textColor = [22, 101, 52];
            if (row.descriptor === "Credit" || row.descriptor === "Pass") hookData.cell.styles.textColor = [14, 116, 144];
            if (row.descriptor === "Subsidiary" || row.descriptor === "Fail") hookData.cell.styles.textColor = [154, 52, 18];
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

      openNamedPdfPreview(
        doc,
        `ALevel_Subject_Rank_${cls}_${stream}_${term}_${year}.pdf`.replace(/\s+/g, "_"),
        `A-Level Subject Rank - ${cls} ${stream} - ${term} ${year}`
      );
    } catch (err) {
      setError(err.message || "Failed to generate A-Level subject rank PDF.");
    }
  };

   // --- Theme Constants (Matching your Amethyst/Cinematic Black theme) ---
  const amethyst = "#38bdf8";
  const cinematicBlack = "#0a0c10";
  const glassBg = "rgba(30, 41, 59, 0.45)";
  const platinum = "#f1f5f9";

  const inputStyle = {
    width: "100%",
    padding: "12px",
    background: "rgba(0, 0, 0, 0.3)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "12px",
    color: "#fff",
    fontSize: "0.9rem",
    outline: "none",
    marginTop: "8px"
  };

  const labelStyle = {
    fontSize: "0.7rem",
    fontWeight: "800",
    color: amethyst,
    textTransform: "uppercase",
    letterSpacing: "0.1em"
  };
  return (
    <ALevelAdminShell
      title="Report Hub"
      subtitle="Preview and generate A-Level report cards from the same shared navigation and theme shell."
    >
      {({ isDark }) => {
        const pageBg = isDark ? cinematicBlack : "#f8fafc";
        const bodyText = isDark ? platinum : "#0f172a";
        const softText = isDark ? "rgba(241, 245, 249, 0.82)" : "#475569";
        const shellCard = isDark
          ? glassBg
          : "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(241,245,249,0.94))";
        const shellBorder = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.08)";
        const themedInputStyle = {
          ...inputStyle,
          background: isDark ? "rgba(0, 0, 0, 0.3)" : "rgba(255,255,255,0.9)",
          border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.12)"}`,
          color: bodyText,
        };

        return (
          <div style={{ minHeight: "100%", color: bodyText, paddingBottom: "3rem", fontFamily: "'Inter', sans-serif" }}>
            <div
              style={{
                position: "relative",
                minHeight: "280px",
                width: "100%",
                backgroundImage: `linear-gradient(to bottom, ${
                  isDark ? `rgba(10, 12, 16, 0.1), ${cinematicBlack}` : "rgba(248, 250, 252, 0.08), rgba(248, 250, 252, 0.94)"
                }), url('/tracy.jpg')`,
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
              <h1 style={{ fontSize: "3rem", fontWeight: "900", margin: 0, color: bodyText }}>
                Academic <span style={{ color: amethyst }}>Reports</span>
              </h1>
              <p style={{ fontSize: "1.08rem", color: softText, maxWidth: "640px", marginTop: "0.55rem" }}>
                Generate and analyze comprehensive student performance statements for A-Level candidates.
              </p>
            </div>

            <div style={{ maxWidth: "1200px", margin: "-40px auto 0 auto", padding: "0 0.25rem", position: "relative", zIndex: 10 }}>
              <div
                style={{
                  background: shellCard,
                  backdropFilter: "blur(16px)",
                  borderRadius: "28px",
                  padding: "2.5rem",
                  border: `1px solid ${shellBorder}`,
                  boxShadow: isDark ? "0 8px 32px 0 rgba(0, 0, 0, 0.37)" : "0 20px 40px rgba(15, 23, 42, 0.08)",
                }}
              >
                <h2 style={{ fontSize: "1.25rem", fontWeight: "800", marginBottom: "2rem", color: bodyText }}>
                  Report Generation Parameters
                </h2>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem" }}>
                  <div className="form-group">
                    <label style={labelStyle}>Term</label>
                    <select style={themedInputStyle} value={term} onChange={(e) => setTerm(e.target.value)}>
                      <option value="" style={{ background: pageBg }}>
                        Select Term
                      </option>
                      <option style={{ background: pageBg }}>Term 1</option>
                      <option style={{ background: pageBg }}>Term 2</option>
                      <option style={{ background: pageBg }}>Term 3</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label style={labelStyle}>Class</label>
                    <select style={themedInputStyle} value={cls} onChange={(e) => setCls(e.target.value)}>
                      <option value="" style={{ background: pageBg }}>
                        Select Class
                      </option>
                      <option value="S5" style={{ background: pageBg }}>
                        S5
                      </option>
                      <option value="S6" style={{ background: pageBg }}>
                        S6
                      </option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label style={labelStyle}>Stream</label>
                    <select style={themedInputStyle} value={stream} onChange={(e) => setStream(e.target.value)}>
                      <option value="" style={{ background: pageBg }}>
                        Select Stream
                      </option>
                      <option value="Arts" style={{ background: pageBg }}>
                        Arts
                      </option>
                      <option value="Sciences" style={{ background: pageBg }}>
                        Sciences
                      </option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label style={labelStyle}>Year</label>
                    <input type="number" style={themedInputStyle} value={year} onChange={(e) => setYear(e.target.value)} />
                  </div>
                </div>

                <div style={{ marginTop: "2.5rem", display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
                  <button
                    style={{
                      background: amethyst,
                      color: cinematicBlack,
                      border: "none",
                      padding: "14px 28px",
                      borderRadius: "14px",
                      fontWeight: "800",
                      fontSize: "0.9rem",
                      cursor: loading ? "not-allowed" : "pointer",
                      transition: "transform 0.2s ease",
                      opacity: loading ? 0.7 : 1,
                    }}
                    onClick={handlePreview}
                    disabled={loading}
                  >
                    {loading ? "PROCESSING..." : "PREVIEW REPORTS"}
                  </button>
                  {error && (
                    <p style={{ color: isDark ? "#fca5a5" : "#991b1b", fontSize: "0.85rem", fontWeight: "600", margin: 0 }}>
                      {error}
                    </p>
                  )}
                </div>

                <div
                  style={{
                    marginTop: "1.4rem",
                    padding: "1rem 1.1rem",
                    borderRadius: "1rem",
                    border: `1px solid ${isDark ? "rgba(148, 163, 184, 0.2)" : "rgba(15, 23, 42, 0.1)"}`,
                    background: isDark ? "rgba(2, 6, 23, 0.72)" : "rgba(248, 250, 252, 0.88)",
                    display: "grid",
                    gap: "0.9rem",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "0.74rem", fontWeight: "800", letterSpacing: "0.14em", textTransform: "uppercase", color: amethyst }}>
                      Report Dates
                    </div>
                    <div style={{ fontSize: "0.88rem", color: softText, marginTop: "0.28rem", lineHeight: 1.55 }}>
                      Auto-filled from the shared school calendar when available. You can still adjust them here before generating reports.
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: "0.85rem",
                    }}
                  >
                    <label style={{ display: "grid", gap: "0.35rem" }}>
                      <span style={{ fontSize: "0.75rem", fontWeight: "700", letterSpacing: "0.12em", textTransform: "uppercase", color: softText }}>
                        This Term Ended On
                      </span>
                      <input
                        type="date"
                        style={themedInputStyle}
                        value={reportDates.termEndedOn || ""}
                        onChange={(e) => updateReportDate("termEndedOn", e.target.value)}
                      />
                    </label>

                    <label style={{ display: "grid", gap: "0.35rem" }}>
                      <span style={{ fontSize: "0.75rem", fontWeight: "700", letterSpacing: "0.12em", textTransform: "uppercase", color: softText }}>
                        Next Term Begins On
                      </span>
                      <input
                        type="date"
                        style={themedInputStyle}
                        value={reportDates.nextTermBeginsOn || ""}
                        onChange={(e) => updateReportDate("nextTermBeginsOn", e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </div>

              {previewData && (
                <div
                    style={{
                      marginTop: "1.5rem",
                      background: isDark ? "rgba(167, 139, 250, 0.05)" : "rgba(59, 130, 246, 0.06)",
                      backdropFilter: "blur(12px)",
                      borderRadius: "20px",
                      padding: "1.5rem 2.5rem",
                      border: `1px solid ${isDark ? "rgba(167, 139, 250, 0.2)" : "rgba(59, 130, 246, 0.16)"}`,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "1rem",
                      flexWrap: "wrap",
                      animation: "fadeIn 0.5s ease forwards",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: "1rem", color: softText }}>
                      <span style={{ color: amethyst, fontWeight: "800" }}>{previewData.learners}</span> student reports available ·{" "}
                      <span style={{ color: amethyst, fontWeight: "800" }}>{previewData.subjects}</span> subjects included ·{" "}
                      <span style={{ color: amethyst, fontWeight: "800" }}>{registeredLearners.length}</span> learners on register
                    </p>

                    <button
                      style={{
                        background:
                          downloading || reportData.length === 0
                            ? "rgba(71, 85, 105, 0.65)"
                            : isDark
                            ? "rgba(255, 255, 255, 0.05)"
                            : "rgba(255,255,255,0.9)",
                        color: bodyText,
                        border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.12)"}`,
                        padding: "10px 20px",
                        borderRadius: "12px",
                        fontWeight: "700",
                        fontSize: "0.8rem",
                        cursor: downloading || reportData.length === 0 ? "not-allowed" : "pointer",
                      }}
                      onClick={handleDownload}
                      disabled={downloading || reportData.length === 0}
                    >
                      {downloading ? "PREPARING..." : "DOWNLOAD REPORTS"}
                    </button>
                </div>
              )}

              <div
                    style={{
                      marginTop: "1rem",
                      padding: "0.95rem 1rem",
                      borderRadius: "1rem",
                      border: "1px solid rgba(34, 197, 94, 0.24)",
                      background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(2, 44, 34, 0.5))",
                      display: "grid",
                      gap: "0.85rem",
                      animation: "fadeIn 0.5s ease forwards",
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
                        <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#86efac", marginBottom: "0.3rem", fontWeight: 900 }}>
                          Performance Indicator
                        </div>
                        <div style={{ fontSize: "0.88rem", color: "#cbd5e1", lineHeight: 1.6 }}>
                          Eligible A-Level learners come first by total points. Ineligible learners remain visible with the exact missing or missed MID/EOT paper details.
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
                        No performance indicator rows are available for this selection yet.
                      </div>
                    ) : (
                      <div style={{ maxHeight: "320px", overflow: "auto", borderRadius: "0.9rem" }}>
                        <table className="teachers-table" style={{ minWidth: "920px" }}>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Learner</th>
                              <th>Status</th>
                              <th>Total Pts</th>
                              <th>Principal</th>
                              <th>Subsidiary</th>
                              <th>Subjects</th>
                              <th>Readiness Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {performanceRows.map((row, index) => (
                              <tr key={row.learnerId || row.learnerName}>
                                <td>{index + 1}</td>
                                <td>{row.learnerName}</td>
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
                                <td>{row.totalPoints === null ? "—" : row.totalPoints}</td>
                                <td>{row.principalPoints === null ? "—" : row.principalPoints}</td>
                                <td>{row.subsidiaryPoints === null ? "—" : row.subsidiaryPoints}</td>
                                <td>{row.subjectCount || "—"}</td>
                                <td>{row.issueDetails.length ? row.issueDetails.join("; ") : "Complete"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      marginTop: "1rem",
                      padding: "0.95rem 1rem",
                      borderRadius: "1rem",
                      border: "1px solid rgba(248, 113, 113, 0.24)",
                      background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(69, 10, 10, 0.46))",
                      display: "grid",
                      gap: "0.85rem",
                      animation: "fadeIn 0.5s ease forwards",
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
                        <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#fca5a5", marginBottom: "0.3rem", fontWeight: 900 }}>
                          MID/EOT Missed-Risk Report
                        </div>
                        <div style={{ fontSize: "0.88rem", color: "#cbd5e1", lineHeight: 1.6 }}>
                          Counts only papers where a teacher explicitly marked the learner as missed. Missing uploads are not treated as missed here.
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
                        {[
                          { label: "Critical", value: missedRiskSummary.critical },
                          { label: "Intermediate", value: missedRiskSummary.intermediate },
                          { label: "Not so urgent", value: missedRiskSummary.notUrgent },
                        ].map((item) => {
                          const tone = getAlevelMissedRiskTone(item.label);
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
                          onClick={handleDownloadMissedRiskPdf}
                          disabled={missedRiskRows.length === 0 || loading || downloading}
                          style={{
                            border: "none",
                            borderRadius: "999px",
                            padding: "0.52rem 0.95rem",
                            background:
                              missedRiskRows.length === 0
                                ? "rgba(71, 85, 105, 0.65)"
                                : "linear-gradient(135deg, #ef4444, #f97316)",
                            color: "#fff",
                            fontWeight: 800,
                            cursor: missedRiskRows.length === 0 ? "not-allowed" : "pointer",
                            boxShadow: missedRiskRows.length === 0 ? "none" : "0 10px 22px rgba(239, 68, 68, 0.18)",
                          }}
                        >
                          Download Missed-Risk PDF
                        </button>
                      </div>
                    </div>

                    {missedRiskRows.length === 0 ? (
                      <div
                        style={{
                          border: "1px dashed rgba(248, 113, 113, 0.3)",
                          borderRadius: "0.9rem",
                          color: "#fca5a5",
                          padding: "0.85rem",
                          fontSize: "0.86rem",
                        }}
                      >
                        No learner has been explicitly marked as missed for MID/EOT in this selection.
                      </div>
                    ) : (
                      <div style={{ maxHeight: "320px", overflow: "auto", borderRadius: "0.9rem" }}>
                        <table className="teachers-table" style={{ minWidth: "920px" }}>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Stream</th>
                              <th>Learner</th>
                              <th>Risk</th>
                              <th>Missed MID/EOT</th>
                              <th>Subjects</th>
                              <th>Where missed</th>
                              <th>Staff action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {missedRiskRows.slice(0, 40).map((row, index) => {
                              const tone = getAlevelMissedRiskTone(row.risk);
                              return (
                                <tr key={`${row.learnerId}-${row.risk}`}>
                                  <td>{index + 1}</td>
                                  <td>{row.stream}</td>
                                  <td>{row.learnerName}</td>
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
                                  <td>{row.missedCount}</td>
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

                  <div
                    style={{
                      marginTop: "1rem",
                      padding: "0.95rem 1rem",
                      borderRadius: "1rem",
                      border: "1px solid rgba(56, 189, 248, 0.24)",
                      background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(8, 47, 73, 0.48))",
                      display: "grid",
                      gap: "0.85rem",
                      animation: "fadeIn 0.5s ease forwards",
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
                        <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#7dd3fc", marginBottom: "0.3rem", fontWeight: 900 }}>
                          Subject Rank
                        </div>
                        <div style={{ fontSize: "0.88rem", color: "#cbd5e1", lineHeight: 1.6 }}>
                          Shows strongest and weakest A-Level subjects using completed subject averages, with missed MID/EOT counts kept visible.
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
                        <span
                          style={{
                            padding: "0.35rem 0.65rem",
                            borderRadius: "999px",
                            background: "rgba(22, 101, 52, 0.22)",
                            color: "#bbf7d0",
                            border: "1px solid rgba(34, 197, 94, 0.22)",
                            fontSize: "0.78rem",
                            fontWeight: 800,
                          }}
                        >
                          Best {bestSubject ? `${bestSubject.subject} (${bestSubject.average.toFixed(2)})` : "—"}
                        </span>
                        <span
                          style={{
                            padding: "0.35rem 0.65rem",
                            borderRadius: "999px",
                            background: "rgba(146, 64, 14, 0.22)",
                            color: "#fed7aa",
                            border: "1px solid rgba(251, 146, 60, 0.22)",
                            fontSize: "0.78rem",
                            fontWeight: 800,
                          }}
                        >
                          Weakest {weakestSubject ? `${weakestSubject.subject} (${weakestSubject.average.toFixed(2)})` : "—"}
                        </span>
                        <button
                          type="button"
                          onClick={handleDownloadSubjectRankPdf}
                          disabled={subjectRankRows.length === 0 || loading || downloading}
                          style={{
                            border: "none",
                            borderRadius: "999px",
                            padding: "0.52rem 0.95rem",
                            background:
                              subjectRankRows.length === 0
                                ? "rgba(71, 85, 105, 0.65)"
                                : "linear-gradient(135deg, #38bdf8, #0f766e)",
                            color: "#fff",
                            fontWeight: 800,
                            cursor: subjectRankRows.length === 0 ? "not-allowed" : "pointer",
                            boxShadow: subjectRankRows.length === 0 ? "none" : "0 10px 22px rgba(56, 189, 248, 0.18)",
                          }}
                        >
                          Download Subject Rank PDF
                        </button>
                      </div>
                    </div>

                    {subjectRankRows.length === 0 ? (
                      <div
                        style={{
                          border: "1px dashed rgba(56, 189, 248, 0.3)",
                          borderRadius: "0.9rem",
                          color: "#bae6fd",
                          padding: "0.85rem",
                          fontSize: "0.86rem",
                        }}
                      >
                        No completed A-Level subject averages are available for subject rank yet.
                      </div>
                    ) : (
                      <div style={{ maxHeight: "290px", overflow: "auto", borderRadius: "0.9rem" }}>
                        <table className="teachers-table" style={{ minWidth: "860px" }}>
                          <thead>
                            <tr>
                              <th>Rank</th>
                              <th>Subject</th>
                              <th>Average</th>
                              <th>Band</th>
                              <th>Scores</th>
                              <th>Learners</th>
                              <th>Missed MID/EOT</th>
                              <th>Streams</th>
                            </tr>
                          </thead>
                          <tbody>
                            {subjectRankRows.map((row) => {
                              const tone = getAlevelSubjectTone(row.descriptor);
                              return (
                                <tr key={row.subject}>
                                  <td>{row.rank}</td>
                                  <td>{row.subject}</td>
                                  <td>{row.average.toFixed(2)}</td>
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
                                      {row.descriptor}
                                    </span>
                                  </td>
                                  <td>{row.scoredLearners}</td>
                                  <td>{row.learnerCount}</td>
                                  <td>{row.missedCount}</td>
                                  <td>{row.streams.join(", ")}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
              </div>
            </div>

            <style>
              {`
                @keyframes fadeIn {
                  from { opacity: 0; transform: translateY(10px); }
                  to { opacity: 1; transform: translateY(0); }
                }
                select { cursor: pointer; }
                input:focus, select:focus { border-color: ${amethyst} !important; }
              `}
            </style>
          </div>
        );
      }}
    </ALevelAdminShell>
  );
}

/* =============================
   PDF GENERATOR (same file)
============================= */
async function generateAlevelPDF(data, meta) {
  const { jsPDF, autoTable } = await loadPdfTools();
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const formatPaperScore = (value) => {
    if (value === null || value === undefined || value === "") return "Missing";
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(1).replace(/\.0$/, "") : String(value);
  };

  const formatComponentScore = (value, status) => {
    const normalizedStatus = String(status || "").trim().toLowerCase();
    if (normalizedStatus === "missed") return "Missed";
    if (normalizedStatus === "missing") return "Missing";
    return formatPaperScore(value);
  };

  const formatAverage = (value, status) => {
    const normalizedStatus = String(status || "").trim().toLowerCase();
    if (value === null || value === undefined || value === "") {
      return normalizedStatus === "missed" ? "Missed" : "Missing";
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(1) : String(value);
  };

  const buildSubjectRows = (subjects = [], includeScore = true) => {
    const rows = [];

    subjects.forEach((subjectGroup) => {
      const papers = Array.isArray(subjectGroup?.papers) && subjectGroup.papers.length > 0
        ? subjectGroup.papers
        : [
            {
              paper: "Single",
              mid: subjectGroup?.mid,
              eot: subjectGroup?.eot,
              avg: subjectGroup?.avg,
              teacher: subjectGroup?.teacher || "—",
            },
          ];

      papers.forEach((paperRow, index) => {
        const row = [];

        if (index === 0) {
          row.push({
            content: subjectGroup.subject || "—",
            rowSpan: papers.length,
            styles: {
              fontStyle: "bold",
              valign: "middle",
            },
          });
        }

        row.push(paperRow.paper || "Single");
        row.push(formatComponentScore(paperRow.mid, paperRow.mid_status));
        row.push(formatComponentScore(paperRow.eot, paperRow.eot_status));
        row.push(formatAverage(paperRow.avg, paperRow.resultStatus));
        row.push(paperRow.paperScore || "Missing");

        if (index === 0) {
          row.push({
            content: subjectGroup.grade || "—",
            rowSpan: papers.length,
            styles: { valign: "middle", fontStyle: "bold" },
          });
          row.push({
            content: ["Missing", "Missed"].includes(subjectGroup.grade)
              ? subjectGroup.grade
              : String(subjectGroup.points ?? "—"),
            rowSpan: papers.length,
            styles: { valign: "middle", fontStyle: "bold" },
          });
        }

        row.push(paperRow.teacher || "—");
        rows.push(row);
      });
    });

    return rows;
  };

  data.forEach((student, index) => {
    if (index > 0) doc.addPage();

    const { learner, principals, subsidiaries, totals, comments } = student;

    doc.addImage(badge, "PNG", 15, 10, 20, 20);

// School name (bold only here)
doc.setFont("helvetica", "bold");
doc.setFontSize(14);
doc.text(
  "ST. PHILLIPS EQUATORIAL SECONDARY SCHOOL",
  pageWidth / 2,
  18,
  { align: "center" }
);

// Everything else normal
doc.setFont("helvetica", "normal");
doc.setFontSize(10);

doc.text(
  "P.O. BOX 53 Kayabwe Mpigi | Tel: 0701976787",
  pageWidth / 2,
  24,
  { align: "center" }
);

doc.text(
  "www.stphillipsequatorial.com",
  pageWidth / 2,
  29,
  { align: "center" }
);

doc.text(
  "Email: info@stphillipsequatorial.com",
  pageWidth / 2,
  34,
  { align: "center" }
);

// Divider line
doc.line(15, 40, pageWidth - 15, 40);

// Report title (now correctly below the line)
doc.setFont("helvetica", "bold");
doc.setFontSize(11);
doc.text(
  `END OF ${meta.term} ${meta.year} REPORT CARD`,
  pageWidth / 2,
  50,
  { align: "center" }
);

// Reset font
doc.setFont("helvetica", "normal");

// Bio starts safely below
const y = 60;
doc.setFontSize(10);

const gap = 3;

// LEFT SIDE
doc.setFont("helvetica", "bold");
doc.text("Name:", 15, y);
let w = doc.getTextWidth("Name:");
doc.setFont("helvetica", "normal");
doc.text(learner.name, 15 + w + gap, y);

doc.setFont("helvetica", "bold");
doc.text("House:", 15, y + 6);
w = doc.getTextWidth("House:");
doc.setFont("helvetica", "normal");
doc.text(learner.house, 15 + w + gap, y + 6);

doc.setFont("helvetica", "bold");
doc.text("Stream:", 15, y + 12);
w = doc.getTextWidth("Stream:");
doc.setFont("helvetica", "normal");
doc.text(learner.stream, 15 + w + gap, y + 12);


// RIGHT SIDE
doc.setFont("helvetica", "bold");
doc.text("Age:", 110, y);
w = doc.getTextWidth("Age:");
doc.setFont("helvetica", "normal");
doc.text(String(learner.age), 110 + w + gap, y);

doc.setFont("helvetica", "bold");
doc.text("Class:", 110, y + 6);
w = doc.getTextWidth("Class:");
doc.setFont("helvetica", "normal");
doc.text(learner.class, 110 + w + gap, y + 6);

doc.setFont("helvetica", "bold");
doc.text("Combination:", 110, y + 12);
w = doc.getTextWidth("Combination:");
doc.setFont("helvetica", "normal");
doc.text(learner.combination, 110 + w + gap, y + 12);


    autoTable(doc, {
      startY: y + 20,
      head: [["Subject", "Paper", "MID", "EOT", "Paper Avg", "Score", "Grade", "Points", "Teacher"]],
      body: buildSubjectRows(principals, true),
      theme: "grid",
      styles: {
        fontSize: 8.4,
        cellPadding: 1.8,
        lineColor: [15, 23, 42],
        lineWidth: 0.15,
        textColor: 0,
        fillColor: [255, 255, 255],
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: 0,
        fontStyle: "bold",
        lineColor: [15, 23, 42],
        lineWidth: 0.18,
      },
      alternateRowStyles: { fillColor: [255, 255, 255] }

    });

    let nextY = doc.lastAutoTable.finalY + 6;
    doc.setFont("helvetica", "bold");
    doc.text(`Total Principal Subjects Points: ${totals.principal}`, 15, nextY);
    doc.setFont("helvetica", "normal"); // reset after

    autoTable(doc, {
      startY: nextY + 6,
      head: [["Subject", "Paper", "MID", "EOT", "Paper Avg", "Score", "Grade", "Points", "Teacher"]],
      body: buildSubjectRows(subsidiaries, false),
      theme: "grid",
      styles: {
        fontSize: 8.4,
        cellPadding: 1.8,
        lineColor: [15, 23, 42],
        lineWidth: 0.15,
        textColor: 0,
        fillColor: [255, 255, 255],
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: 0,
        fontStyle: "bold",
        lineColor: [15, 23, 42],
        lineWidth: 0.18,
      },
      alternateRowStyles: { fillColor: [255, 255, 255] }

    });

    nextY = doc.lastAutoTable.finalY + 6;
    doc.setFont("helvetica", "bold");
    doc.text(`Total Subsidiary Points: ${totals.subsidiary}`, 15, nextY);
    doc.text(`TOTAL POINTS: ${totals.overall}`, 110, nextY);
    let commentY = nextY + 10;
    doc.setFont("helvetica", "normal"); // reset after

    doc.setFontSize(10);

    // Class Teacher Comment
doc.setFont("helvetica", "bold");
doc.text("Class Teacher's Comment:", 15, commentY);

w = doc.getTextWidth("Class Teacher's Comment:");
doc.setFont("helvetica", "normal");
doc.text(comments.classTeacher, 15 + w + gap, commentY);

doc.text("Signature: ____________________________", 15, commentY + 6);

// Head Teacher Comment
doc.setFont("helvetica", "bold");
doc.text("Head Teacher's Comment:", 15, commentY + 16);

w = doc.getTextWidth("Head Teacher's Comment:");
doc.setFont("helvetica", "normal");
doc.text(comments.headTeacher, 15 + w + gap, commentY + 16);

doc.text("Signature: ____________________________", 15, commentY + 22);

let tableStartY = commentY + 32;

/* =========================
   PAPER GRADING TABLE
========================= */
autoTable(doc, {
  startY: tableStartY,
  head: [["Paper Grading", "D1", "D2", "C3", "C4", "C5", "C6", "P7", "P8", "F9"]],
  body: [["Score", "85-100", "80-84", "75-79", "70-74", "65-69", "60-64", "50-59", "40-49", "0-39"]],
  theme: "grid",
  styles: {
    fontSize: 8,
    halign: "center",
    lineColor: [15, 23, 42],
    lineWidth: 0.15,
    textColor: 0,
    fillColor: [255, 255, 255],
  },
  headStyles: {
    fillColor: [255, 255, 255],
    textColor: 0,
    fontStyle: "bold",
    lineColor: [15, 23, 42],
    lineWidth: 0.18,
  },
  alternateRowStyles: { fillColor: [255, 255, 255] },
  margin: { left: 15 },
});

/* =========================
   GRADE → POINTS TABLE (COMPACT)
========================= */
autoTable(doc, {
  startY: doc.lastAutoTable.finalY + 4,
  head: [["Grade Points", "F", "O", "E", "D", "C", "B", "A"]],
  body: [["", "0", "1", "2", "3", "4", "5", "6"]],
  theme: "grid",
  styles: {
    fontSize: 8,
    halign: "center",
    lineColor: [15, 23, 42],
    lineWidth: 0.15,
    textColor: 0,
    fillColor: [255, 255, 255],
  },
  headStyles: {
    fillColor: [255, 255, 255],
    textColor: 0,
    fontStyle: "bold",
    lineColor: [15, 23, 42],
    lineWidth: 0.18,
  },
  alternateRowStyles: { fillColor: [255, 255, 255] },
  margin: { left: 15 },
});

const subsidiaryNoteY = doc.lastAutoTable.finalY + 6;
doc.setFont("helvetica", "bold");
doc.text("Subsidiary subjects:", 15, subsidiaryNoteY);
doc.setFont("helvetica", "normal");
doc.text("1, 2, 3, 4, 5, 6 = Pass (O); 7, 8, 9 = Fail (F)", 51, subsidiaryNoteY);

// Final Y after all grading reference tables / notes
let afterTablesY = subsidiaryNoteY + 8;

doc.setFontSize(9);

doc.text(`This term ended on: ${formatReportDateValue(meta?.termEndedOn)}`, 15, afterTablesY);
doc.text(`Next term begins on: ${formatReportDateValue(meta?.nextTermBeginsOn)}`, 110, afterTablesY);

    doc.setFontSize(8);
    doc.text(
      `Generated from SPESS ARK • ${new Date().toLocaleString()} • Not valid without stamp`,
      pageWidth / 2,
      pageHeight - 10,
      { align: "center" }
    );
  });

  const filename = `ALevel_Report_${String(meta.cls || "Class")}_${String(meta.stream || "Stream")}_${String(meta.term || "Term")}_${String(meta.year || "")}.pdf`
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]/g, "");
  const title = `A-Level Report - ${meta.cls || "Class"} ${meta.stream || ""} - ${meta.term || ""} ${meta.year || ""}`.trim();
  openNamedPdfPreview(doc, filename, title);
}

function openNamedPdfPreview(doc, filename, title) {
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
}
