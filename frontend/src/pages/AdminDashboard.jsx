// src/pages/AdminDashboard.jsx
import React, { useEffect, useState, useMemo, useRef } from "react";
import "./AdminDashboard.css";
import AssignSubjectsPanel from "../components/AssignSubjectsPanel";
import { plainFetch, adminFetch } from "../lib/api";
import EditStudentModal from "../components/EditStudentModal";
import EndOfTermReports from "./EndOfTermReports";
import { useNavigate } from "react-router-dom";
import useIdleLogout from "../hooks/useIdleLogout";
import EnrollmentInsightsPanel from "../components/EnrollmentInsightsPanel";
import EnrollmentCharts from "../components/EnrollmentCharts";
import AssessmentSubmissionTracker from "../components/AssessmentSubmissionTracker";
import AuditLogsPanel from "../components/AuditLogsPanel";
import PromotionPanel from "../components/PromotionPanel";
import { loadPdfTools } from "../utils/loadPdfTools";

// API base (fallback for local dev)
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

// Subjects
const COMPULSORY_SUBJECTS = [
  "English",
  "Mathematics",
  "Physics",
  "Biology",
  "Chemistry",
  "History",
  "Geography",
];

const OPTIONAL_SUBJECTS = [
  "ICT",
  "Agriculture",
  "Physical Education",
  "Art",
  "Luganda",
  "Literature",
  "Christian Religious Education",
  "Entrepreneurship",
  "IRE",
  "Kiswahili",
];
const S1_S2_PRESELECT_OPTIONALS = [
  "Physical Education",
  "Kiswahili",
  "Christian Religious Education",
  "Entrepreneurship",
];
const CLASS_SORT_ORDER = ["S1", "S2", "S3", "S4"];
const STREAM_SORT_ORDER = ["North", "South"];

const formatDateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
};

// Promotion window: opens Dec 5 and locks after Jan 30 (inclusive window).
const isPromotionWindowOpen = (date = new Date()) => {
  const month = date.getMonth(); // 0-based
  const day = date.getDate();
  return (month === 11 && day >= 5) || (month === 0 && day <= 30);
};

const buildStreamReadinessFromAssignments = (assignments = []) => {
  const compulsoryKeys = new Set(COMPULSORY_SUBJECTS.map((s) => s.toLowerCase()));
  const optionalKeys = new Set(OPTIONAL_SUBJECTS.map((s) => s.toLowerCase()));
  const grouped = new Map();

  assignments.forEach((row) => {
    const classLevel = String(row?.class_level ?? row?.class ?? "").trim();
    const stream = String(row?.stream ?? "").trim();
    const subject = String(row?.subject ?? "").trim();
    if (!classLevel || !stream || !subject) return;

    const key = `${classLevel}__${stream}`;
    if (!grouped.has(key)) {
      grouped.set(key, { class: classLevel, stream, subjects: new Map() });
    }

    const subjectKey = subject.toLowerCase();
    if (!grouped.get(key).subjects.has(subjectKey)) {
      grouped.get(key).subjects.set(subjectKey, subject);
    }
  });

  const rows = Array.from(grouped.values()).map((group) => {
    const subjectKeys = new Set(group.subjects.keys());

    const assignedCompulsorySubjects = COMPULSORY_SUBJECTS.filter((s) =>
      subjectKeys.has(s.toLowerCase())
    );
    const missingCompulsorySubjects = COMPULSORY_SUBJECTS.filter(
      (s) => !subjectKeys.has(s.toLowerCase())
    );
    const assignedOptionalSubjects = OPTIONAL_SUBJECTS.filter((s) =>
      subjectKeys.has(s.toLowerCase())
    );
    const unknownSubjects = Array.from(group.subjects.entries())
      .filter(([key]) => !compulsoryKeys.has(key) && !optionalKeys.has(key))
      .map(([, label]) => label)
      .sort((a, b) => a.localeCompare(b));

    const status = missingCompulsorySubjects.length === 0 ? "READY" : "NOT_READY";

    return {
      class: group.class,
      stream: group.stream,
      status,
      uiLabel: status === "READY" ? "green" : "red",
      assignedCompulsorySubjects,
      missingCompulsorySubjects,
      assignedOptionalSubjects,
      optionalCount: assignedOptionalSubjects.length,
      unknownSubjects,
    };
  });

  rows.sort((a, b) => {
    const aClassIndex = CLASS_SORT_ORDER.indexOf(a.class);
    const bClassIndex = CLASS_SORT_ORDER.indexOf(b.class);
    const classDiff =
      (aClassIndex === -1 ? 999 : aClassIndex) -
      (bClassIndex === -1 ? 999 : bClassIndex);
    if (classDiff !== 0) return classDiff;

    const aStreamIndex = STREAM_SORT_ORDER.indexOf(a.stream);
    const bStreamIndex = STREAM_SORT_ORDER.indexOf(b.stream);
    const streamDiff =
      (aStreamIndex === -1 ? 999 : aStreamIndex) -
      (bStreamIndex === -1 ? 999 : bStreamIndex);
    if (streamDiff !== 0) return streamDiff;

    return `${a.class}${a.stream}`.localeCompare(`${b.class}${b.stream}`);
  });

  return rows;
};

export default function AdminDashboard() {
  const navigate = useNavigate();

  // Auth / navigation
  useEffect(() => {
    const token = localStorage.getItem("adminToken");
  
    // No token at all → kick out immediately
    if (!token) {
      navigate("/", { replace: true });
      return;
    }
  
    // Verify token with backend
    fetch(`${API_BASE}/api/admin/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Unauthorized");
        }
      })
      .catch(() => {
        // Token is invalid or expired
        localStorage.removeItem("adminToken");
        localStorage.removeItem("isAdmin");
        navigate("/", { replace: true });
      });
  }, [navigate]);
  
  useIdleLogout(() => {
    // remove admin-related keys (non-destructive)
    localStorage.removeItem("SPESS_ADMIN_KEY");
    localStorage.removeItem("isAdmin");
    sessionStorage.removeItem("isAdmin");
    navigate("/", { replace: true });
  });

  const handleLogout = () => {
    sessionStorage.removeItem("isAdmin");
    navigate("/ark", { replace: true });
  };
  

  useEffect(() => {
    document.title = "Admin Dashboard | SPESS ARK";
  }, []);

  /* -------------------- UI state -------------------- */
  const [activeSection, setActiveSection] = useState("");
  const [showEnrollmentChartsModal, setShowEnrollmentChartsModal] = useState(false);
  const [dashboardClock, setDashboardClock] = useState(() => new Date());

  useEffect(() => {
    document.title = activeSection ? `${activeSection} | SPESS ARK` : "Admin Dashboard | SPESS ARK";
  }, [activeSection]);
  useEffect(() => {
    const timerId = window.setInterval(() => setDashboardClock(new Date()), 60_000);
    return () => window.clearInterval(timerId);
  }, []);

  const promotionWindowOpen = useMemo(
    () => isPromotionWindowOpen(dashboardClock),
    [dashboardClock]
  );
  useEffect(() => {
    if (!promotionWindowOpen && activeSection === "Learner Promotion") {
      setActiveSection("");
    }
  }, [promotionWindowOpen, activeSection]);

  /* ---------- Notices ---------- */
  const [notices, setNotices] = useState([]);
  const [loadingNotices, setLoadingNotices] = useState(false);
  const [noticesError, setNoticesError] = useState("");
  const [noticeForm, setNoticeForm] = useState({ title: "", body: "" });

  /* ---------- Teachers ---------- */
  const [teachers, setTeachers] = useState([]);
  const [teacherForm, setTeacherForm] = useState({ name: "", email: "", subject1: "", subject2: "" });
  const [teacherError, setTeacherError] = useState("");
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [savingTeacher, setSavingTeacher] = useState(false);
  const [deletingTeacherId, setDeletingTeacherId] = useState(null);

  /* ---------- Students ---------- */
  const [students, setStudents] = useState([]);
  const [aLevelLearners, setALevelLearners] = useState([]);
  const [studentForm, setStudentForm] = useState({ name: "", gender: "", dob: "", class_level: "", stream: "" });
  const [selectedOptionals, setSelectedOptionals] = useState([]);
  const [studentError, setStudentError] = useState("");
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [savingStudent, setSavingStudent] = useState(false);
  const [deletingStudentId, setDeletingStudentId] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);
  const savingStudentRef = useRef(false);
  const [showStudentSaveConfirm, setShowStudentSaveConfirm] = useState(false);
  const [pendingStudentSave, setPendingStudentSave] = useState(null);

  /* ---------- Filters & marks ---------- */
  const [classFilter, setClassFilter] = useState("");
  const [streamFilter, setStreamFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [searchName, setSearchName] = useState("");

  const [marksSets, setMarksSets] = useState([]);
  const [marksDetail, setMarksDetail] = useState([]);
  const [selectedMarksSet, setSelectedMarksSet] = useState(null);
  const [loadingMarksSets, setLoadingMarksSets] = useState(false);
  const [loadingMarksDetail, setLoadingMarksDetail] = useState(false);
  const [marksError, setMarksError] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedAoi, setSelectedAoi] = useState(null);
  const [scoreSheetLoading, setScoreSheetLoading] = useState(false);
  const [scoreSheetError, setScoreSheetError] = useState("");
  const [scoreSheetFilters, setScoreSheetFilters] = useState({
    class_level: "S1",
    stream: "North",
    term: "Term 1",
    year: new Date().getFullYear(),
  });

  /* ---------- Marksheet ---------- */
  const [marksheetClass, setMarksheetClass] = useState("");
  const [marksheetStream, setMarksheetStream] = useState("");
  const [marksheetSubject, setMarksheetSubject] = useState("");
  const [marksheetError, setMarksheetError] = useState("");

  /* ---------- Stream readiness ---------- */
  const [streamReadiness, setStreamReadiness] = useState([]);
  const [loadingStreamReadiness, setLoadingStreamReadiness] = useState(false);
  const [streamReadinessError, setStreamReadinessError] = useState("");

  /* ---------- Cards ---------- */
  const cards = [
    { title: "Add Students", subtitle: "Enroll new learners", icon: "🎓" },
    { title: "Assign Subjects", subtitle: "Link teachers to classes", icon: "📘" },
    { title: "Download Marks", subtitle: "View & export assessment scores", icon: "📊" },
    { title: "Manage Teachers", subtitle: "Accounts & permissions", icon: "🧑🏽‍🏫" },
    { title: "End of Term Reports", subtitle: "Term 1 & Term 2 report cards", icon: "📘", route: "/admin/reports/term" },
    { title: "End of Year Reports", subtitle: "Term 3 report cards", icon: "📕", route: "/admin/reports/year" },
    {
      title: "Learner Promotion",
      subtitle: promotionWindowOpen
        ? "Promote classes and graduate S4"
        : "Promotion window closed for now",
      icon: "⬆️",
      status: promotionWindowOpen ? "active" : "archived",
      inactiveMessage: promotionWindowOpen
        ? ""
        : "Inactive (opens Dec 5, locks Jan 30)",
    },
    { title: "Stream Readiness", subtitle: "Compulsory coverage by class and stream", icon: "🧭" },
    { title: "Audit Log", subtitle: "Track system actions and changes", icon: "🛡️" },
    { title: "Notices", subtitle: "Create school notices", icon: "📢" },
    { title: "Enrollment Insights", subtitle: "Registration statistics per class/stream/subject", icon: "📈" },
    {
      title: "Assessment Submission Tracker",
      subtitle: "Track missing and submitted subjects",
      icon: "📊",
    }
    
  ];

  /* ------------------ API / fetch functions ------------------ */
  const fetchNotices = async () => {
    setLoadingNotices(true);
    setNoticesError("");
    try {
      const data = await adminFetch("/api/notices");
      if (!Array.isArray(data)) throw new Error("Invalid notices response");
      setNotices(data);
    } catch (err) {
      console.error(err);
      setNotices([]);
      setNoticesError("Could not load notices");
    } finally {
      setLoadingNotices(false);
    }
  };

  const fetchStreamReadiness = async () => {
    setLoadingStreamReadiness(true);
    setStreamReadinessError("");
    try {
      const data = await adminFetch("/api/admin/stream-readiness");
      if (!Array.isArray(data?.streams)) {
        throw new Error("Invalid stream readiness response");
      }
      setStreamReadiness(data.streams);
    } catch (err) {
      if (err?.status === 404) {
        try {
          const assignments = await adminFetch("/api/admin/assignments");
          const streams = buildStreamReadinessFromAssignments(
            Array.isArray(assignments) ? assignments : []
          );
          setStreamReadiness(streams);
          setStreamReadinessError("");
          return;
        } catch (fallbackErr) {
          console.error("Fallback stream readiness error:", fallbackErr);
          setStreamReadiness([]);
          setStreamReadinessError(
            fallbackErr.message || "Could not load stream readiness."
          );
          return;
        }
      }

      console.error("Error loading stream readiness:", err);
      setStreamReadiness([]);
      setStreamReadinessError(err.message || "Could not load stream readiness.");
    } finally {
      setLoadingStreamReadiness(false);
    }
  };

  const handleCreateNotice = async () => {
    if (!noticeForm.title.trim() || !noticeForm.body.trim()) {
      setNoticesError("Title and message are required.");
      return;
    }
    setLoadingNotices(true);
    setNoticesError("");
    try {
      await adminFetch("/api/admin/notices", { method: "POST", body: noticeForm });
      setNoticeForm({ title: "", body: "" });
      fetchNotices();
    } catch (err) {
      setNoticesError(err.message || "Failed to create notice.");
    } finally {
      setLoadingNotices(false);
    }
  };

  const handleDeleteNotice = async (id) => {
    if (!window.confirm("Delete this notice?")) return;
    try {
      await adminFetch(`/api/admin/notices/${id}`, { method: "DELETE" });
      setNotices((p) => p.filter((n) => n.id !== id));
    } catch (err) {
      alert(err.message || "Failed to delete notice");
    }
  };
  const handleDeleteGroup = async (group) => {
    const ok = window.confirm(
      `Delete ALL marks for:\n\n` +
      `${group.class_level} ${group.stream}\n` +
      `${group.subject}\n` +
      `Term ${group.term}, ${group.year}\n\n` +
      `This will delete all AOIs under this subject.`
    );
  
    if (!ok) return;
  
    try {
      // delete every AOI in this subject group
      for (const set of group.aois) {
        await adminFetch("/api/admin/marks-set", {
          method: "DELETE",
          body: {
            assignmentId: set.assignment_id,
            term: set.term,
            year: set.year,
            aoi: set.aoi_label,
          },
        });
      }
  
      // Refresh UI
      await fetchMarksSets();
      setSelectedGroup(null);
      setSelectedAoi(null);
      setMarksDetail([]);
  
    } catch (err) {
      alert(err.message || "Failed to delete marks");
    }
  };
  
  /* ---------- Teachers ---------- */
  const fetchTeachers = async () => {
    setLoadingTeachers(true);
    setTeacherError("");
    try {
      const data = await adminFetch("/api/admin/teachers");
      if (!Array.isArray(data)) throw new Error("Invalid response from server");
      const normalized = data.map((t) => ({
        ...t,
        created_at:
          t.created_at ??
          t.createdAt ??
          t.added_at ??
          t.addedAt ??
          t.registered_at ??
          t.registeredAt ??
          null,
      }));
      setTeachers(normalized);
    } catch (err) {
      console.error("Error loading teachers:", err);
      setTeacherError(err.message || "Could not load teachers.");
      setTeachers([]);
    } finally {
      setLoadingTeachers(false);
    }
  };

  const handleAddTeacher = async (e) => {
    e?.preventDefault();
    const { name, email, subject1, subject2 } = teacherForm;
    if (!name || !email || !subject1 || !subject2) {
      setTeacherError("Please fill in all fields before saving.");
      return;
    }
    setSavingTeacher(true);
    setTeacherError("");
    try {
      const created = await plainFetch("/api/teachers", { method: "POST", body: { name, email, subject1, subject2 } });
      const teacherToAdd = {
        id: created.id ?? Date.now(),
        name: created.name ?? name,
        email: created.email ?? email,
        subject1: created.subject1 ?? subject1,
        subject2: created.subject2 ?? subject2,
        created_at:
          created.created_at ??
          created.createdAt ??
          created.added_at ??
          created.addedAt ??
          created.registered_at ??
          created.registeredAt ??
          null,
      };
      setTeachers((p) => [teacherToAdd, ...p]);
      setTeacherForm({ name: "", email: "", subject1: "", subject2: "" });
    } catch (err) {
      console.error("Error adding teacher:", err);
      setTeacherError(err.message || "Could not add teacher.");
    } finally {
      setSavingTeacher(false);
    }
  };

  const handleDeleteTeacher = async (id) => {
    if (!window.confirm("Remove this teacher?")) return;
    setDeletingTeacherId(id);
    setTeacherError("");
    try {
      await adminFetch(`/api/admin/teachers/${id}`, { method: "DELETE" });
      setTeachers((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error("Error deleting teacher:", err);
      setTeacherError(err.message || "Could not delete teacher.");
    } finally {
      setDeletingTeacherId(null);
    }
  };

  const handleDownloadTeachersPdf = async () => {
    if (!teachers.length) {
      setTeacherError("No teachers available to export.");
      return;
    }

    const { jsPDF } = await loadPdfTools();
    const doc = new jsPDF("p", "mm", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const generatedAt = new Date().toLocaleString();
    const formatDateOnly = (value) => {
      if (!value) return "—";
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
      return d.toLocaleDateString("en-GB");
    };

    const drawHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("St Phllips Equatorial Secondary School", pageWidth / 2, 12, { align: "center" });
      doc.setFontSize(16);
      doc.text("SPESS ARK", pageWidth / 2, 19, { align: "center" });
      doc.setFontSize(11);
      doc.text("Registered Teachers", pageWidth / 2, 24, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Generated: ${generatedAt}`, 10, 29);
      doc.text(`Total teachers: ${teachers.length}`, 10, 34);
    };

    const drawTableHeader = (y) => {
      const tableLeft = 10;
      const tableRight = pageWidth - 10;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("#", 10, y);
      doc.text("Name", 18, y);
      doc.text("Email", 78, y);
      doc.text("Added", 167, y);
      doc.setDrawColor(170);
      doc.line(tableLeft, y + 1.8, tableRight, y + 1.8);
      doc.setFont("helvetica", "normal");
      return y + 6;
    };

    drawHeader();
    let y = drawTableHeader(42);

    teachers.forEach((t, index) => {
      const nameLines = doc.splitTextToSize(String(t.name || "—"), 56);
      const emailLines = doc.splitTextToSize(String(t.email || "—"), 86);
      const addedText = formatDateOnly(t.created_at);
      const addedLines = doc.splitTextToSize(addedText, 30);
      const rowHeight = Math.max(6, Math.max(nameLines.length, emailLines.length, addedLines.length) * 4.8);

      if (y + rowHeight > pageHeight - 14) {
        doc.addPage();
        drawHeader();
        y = drawTableHeader(42);
      }

      doc.setFontSize(9);
      doc.text(String(index + 1), 10, y);
      doc.text(nameLines, 18, y);
      doc.text(emailLines, 78, y);
      doc.text(addedLines, 167, y);
      y += rowHeight;
    });

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text(`Generated from SPESS ARK · ${generatedAt}`, pageWidth / 2, pageHeight - 7, { align: "center" });
    }

    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    const filename = "registered_teachers.pdf";
    const title = "Registered Teachers | SPESS ARK";
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

  const handleDownloadEnrollmentSummaryPdf = async () => {
    const { jsPDF } = await loadPdfTools();
    const doc = new jsPDF("p", "mm", "a4");
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const generatedAt = new Date().toLocaleString();

    const classOrder = ["S1", "S2", "S3", "S4"];
    const streams = Object.keys(enrollmentByStreamClassGender || {});
    const sortedStreams = [...streams].sort((a, b) => {
      const aa = String(a).toLowerCase();
      const bb = String(b).toLowerCase();
      const score = (v) => (v === "north" ? 0 : v === "south" ? 1 : 2);
      const diff = score(aa) - score(bb);
      return diff !== 0 ? diff : String(a).localeCompare(String(b));
    });

    let y = 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("St Phllips Equatorial Secondary School", pageW / 2, y, { align: "center" });
    y += 6;
    doc.setFontSize(15);
    doc.text("SPESS ARK", pageW / 2, y, { align: "center" });
    y += 5;
    doc.setFontSize(10);
    doc.text("Enrollment Summary by Stream and Class (S1-S6)", pageW / 2, y, { align: "center" });
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Generated: ${generatedAt}`, pageW / 2, y, { align: "center" });
    y += 8;

    const renderHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Class", 14, y);
      doc.text("Boys", 72, y, { align: "right" });
      doc.text("Girls", 104, y, { align: "right" });
      doc.text("Total", 136, y, { align: "right" });
      doc.setDrawColor(180);
      doc.line(12, y + 1.5, 140, y + 1.5);
      y += 5;
      doc.setFont("helvetica", "normal");
    };

    let grandBoys = 0;
    let grandGirls = 0;
    let grandTotal = 0;

    if (sortedStreams.length === 0) {
      doc.setFontSize(10);
      doc.text("No enrollment data available.", 14, y);
    } else {
      sortedStreams.forEach((stream) => {
        const clsMap = enrollmentByStreamClassGender[stream] || {};
        let streamBoys = 0;
        let streamGirls = 0;
        let streamTotal = 0;

        if (y > pageH - 40) {
          doc.addPage();
          y = 18;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(`Stream: ${stream}`, 14, y);
        y += 5;
        renderHeader();

        classOrder.forEach((cls) => {
          const row = clsMap[cls] || { Male: 0, Female: 0, total: 0 };
          const boys = Number(row.Male || 0);
          const girls = Number(row.Female || 0);
          const total = Number(row.total || 0);

          streamBoys += boys;
          streamGirls += girls;
          streamTotal += total;

          doc.setFontSize(9);
          doc.text(cls, 14, y);
          doc.text(String(boys), 72, y, { align: "right" });
          doc.text(String(girls), 104, y, { align: "right" });
          doc.text(String(total), 136, y, { align: "right" });
          y += 5;
        });

        doc.setDrawColor(160);
        doc.line(12, y - 1.8, 140, y - 1.8);
        doc.setFont("helvetica", "bold");
        doc.text("Stream Total", 14, y + 2);
        doc.text(String(streamBoys), 72, y + 2, { align: "right" });
        doc.text(String(streamGirls), 104, y + 2, { align: "right" });
        doc.text(String(streamTotal), 136, y + 2, { align: "right" });
        y += 8;

        grandBoys += streamBoys;
        grandGirls += streamGirls;
        grandTotal += streamTotal;
      });
    }

    // A-Level summary appears in PDF only (not dashboard charts/cards)
    const alevelByStreamClass = {};
    (aLevelLearners || []).forEach((l) => {
      const full = String(l.stream || "").trim(); // e.g. "S5 Arts"
      const [clsToken, ...streamParts] = full.split(" ");
      const cls = /^S[56]$/i.test(clsToken || "") ? clsToken.toUpperCase() : "";
      const stream = streamParts.join(" ").trim();
      if (!cls || !stream) return;
      if (!["S5", "S6"].includes(cls)) return;
      if (!/^(arts|sciences)$/i.test(stream)) return;

      const streamKey = stream[0].toUpperCase() + stream.slice(1).toLowerCase();
      if (!alevelByStreamClass[streamKey]) alevelByStreamClass[streamKey] = {};
      if (!alevelByStreamClass[streamKey][cls]) {
        alevelByStreamClass[streamKey][cls] = { Male: 0, Female: 0, total: 0 };
      }
      const g = String(l.gender || "").toLowerCase();
      if (g === "male") alevelByStreamClass[streamKey][cls].Male += 1;
      else if (g === "female") alevelByStreamClass[streamKey][cls].Female += 1;
      alevelByStreamClass[streamKey][cls].total += 1;
    });

    const alevelStreams = ["Arts", "Sciences"].filter((s) => alevelByStreamClass[s]);
    if (alevelStreams.length) {
      if (y > pageH - 70) {
        doc.addPage();
        y = 18;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("A-Level Summary (PDF Only)", 14, y);
      y += 6;

      alevelStreams.forEach((stream) => {
        const clsMap = alevelByStreamClass[stream] || {};
        let streamBoys = 0;
        let streamGirls = 0;
        let streamTotal = 0;

        if (y > pageH - 40) {
          doc.addPage();
          y = 18;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(`Stream: ${stream}`, 14, y);
        y += 5;
        renderHeader();

        ["S5", "S6"].forEach((cls) => {
          const row = clsMap[cls] || { Male: 0, Female: 0, total: 0 };
          const boys = Number(row.Male || 0);
          const girls = Number(row.Female || 0);
          const total = Number(row.total || 0);

          streamBoys += boys;
          streamGirls += girls;
          streamTotal += total;

          doc.setFontSize(9);
          doc.text(cls, 14, y);
          doc.text(String(boys), 72, y, { align: "right" });
          doc.text(String(girls), 104, y, { align: "right" });
          doc.text(String(total), 136, y, { align: "right" });
          y += 5;
        });

        doc.setDrawColor(160);
        doc.line(12, y - 1.8, 140, y - 1.8);
        doc.setFont("helvetica", "bold");
        doc.text("A-Level Stream Total", 14, y + 2);
        doc.text(String(streamBoys), 72, y + 2, { align: "right" });
        doc.text(String(streamGirls), 104, y + 2, { align: "right" });
        doc.text(String(streamTotal), 136, y + 2, { align: "right" });
        y += 8;

        grandBoys += streamBoys;
        grandGirls += streamGirls;
        grandTotal += streamTotal;
      });
    }

    // Class-level gender summary (all streams combined)
    const classSummaryOrder = ["S1", "S2", "S3", "S4", "S5", "S6"];
    const classSummary = {};
    classSummaryOrder.forEach((c) => {
      classSummary[c] = { boys: 0, girls: 0, total: 0 };
    });

    (students || []).forEach((s) => {
      const cls = String(s.class_level || "").toUpperCase();
      if (!classSummary[cls]) return;
      const g = String(s.gender || "").toLowerCase();
      if (g === "male") classSummary[cls].boys += 1;
      else if (g === "female") classSummary[cls].girls += 1;
      classSummary[cls].total += 1;
    });

    (aLevelLearners || []).forEach((l) => {
      const [clsToken] = String(l.stream || "").trim().split(" ");
      const cls = String(clsToken || "").toUpperCase();
      if (!classSummary[cls]) return;
      const g = String(l.gender || "").toLowerCase();
      if (g === "male") classSummary[cls].boys += 1;
      else if (g === "female") classSummary[cls].girls += 1;
      classSummary[cls].total += 1;
    });

    if (y > pageH - 70) {
      doc.addPage();
      y = 18;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Class Summary (All Streams Combined)", 14, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Class", 14, y);
    doc.text("Boys", 72, y, { align: "right" });
    doc.text("Girls", 104, y, { align: "right" });
    doc.text("Total", 136, y, { align: "right" });
    doc.setDrawColor(180);
    doc.line(12, y + 1.5, 140, y + 1.5);
    y += 5;

    classSummaryOrder.forEach((cls) => {
      const row = classSummary[cls] || { boys: 0, girls: 0, total: 0 };
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(cls, 14, y);
      doc.text(String(row.boys), 72, y, { align: "right" });
      doc.text(String(row.girls), 104, y, { align: "right" });
      doc.text(String(row.total), 136, y, { align: "right" });
      y += 5;
    });

    const summaryBoys = classSummaryOrder.reduce((acc, cls) => acc + (classSummary[cls]?.boys || 0), 0);
    const summaryGirls = classSummaryOrder.reduce((acc, cls) => acc + (classSummary[cls]?.girls || 0), 0);
    const summaryTotal = classSummaryOrder.reduce((acc, cls) => acc + (classSummary[cls]?.total || 0), 0);
    doc.setDrawColor(160);
    doc.line(12, y - 1.8, 140, y - 1.8);
    doc.setFont("helvetica", "bold");
    doc.text("Class Summary Total", 14, y + 2);
    doc.text(String(summaryBoys), 72, y + 2, { align: "right" });
    doc.text(String(summaryGirls), 104, y + 2, { align: "right" });
    doc.text(String(summaryTotal), 136, y + 2, { align: "right" });
    y += 8;

    if (y > pageH - 20) {
      doc.addPage();
      y = 20;
    }
    doc.setDrawColor(120);
    doc.line(12, y, 140, y);
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Grand Total (All Streams)", 14, y);
    doc.text(String(grandBoys), 72, y, { align: "right" });
    doc.text(String(grandGirls), 104, y, { align: "right" });
    doc.text(String(grandTotal), 136, y, { align: "right" });

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text(`Generated from SPESS ARK · ${generatedAt} · Page ${i} of ${pages}`, pageW / 2, pageH - 7, { align: "center" });
    }

    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    const filename = "enrollment_summary_s1_to_s6.pdf";
    const title = "Enrollment Summary | SPESS ARK";
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

  /* ---------- Students ---------- */
  const fetchStudents = async () => {
    setLoadingStudents(true);
    setStudentError("");
    try {
      const data = await plainFetch("/api/students");
      if (!Array.isArray(data)) throw new Error("Invalid response");
      const normalized = data.map((s) => ({
        ...s,
        subjects: Array.isArray(s.subjects)
          ? s.subjects
          : (() => {
              try {
                return JSON.parse(s.subjects || "[]");
              } catch {
                return [];
              }
            })(),
      }));
      setStudents(normalized);
    } catch (err) {
      console.error("Error loading students:", err);
      setStudentError(err.message || "Could not load students.");
      setStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  };

  const fetchALevelLearners = async () => {
    try {
      const data = await plainFetch("/api/alevel/learners");
      if (!Array.isArray(data)) throw new Error("Invalid A-Level learners response");
      setALevelLearners(data);
    } catch (err) {
      console.error("Error loading A-Level learners:", err);
      setALevelLearners([]);
    }
  };

  const performAddStudent = async (payload) => {
    if (savingStudentRef.current) return;
    const { name, gender, dob, class_level, stream, subjects } = payload;
    savingStudentRef.current = true;
    setSavingStudent(true);
    setStudentError("");
    try {
      const created = await plainFetch("/api/students", { method: "POST", body: { name, gender, dob, class_level, stream, subjects } });
      const studentToAdd = {
        id: created.id ?? Date.now(),
        name: created.name ?? name,
        gender: created.gender ?? gender,
        dob: created.dob ?? dob,
        class_level: created.class_level ?? class_level,
        stream: created.stream ?? stream,
        subjects: Array.isArray(created.subjects) ? created.subjects : subjects,
        created_at: created.created_at ?? null,
      };
      setStudents((p) => [studentToAdd, ...p]);
      setStudentForm({ name: "", gender: "", dob: "", class_level: "", stream: "" });
      setSelectedOptionals([]);
      setPendingStudentSave(null);
      setShowStudentSaveConfirm(false);
    } catch (err) {
      console.error("Error adding student:", err);
      setStudentError(err.message || "Could not add student.");
    } finally {
      savingStudentRef.current = false;
      setSavingStudent(false);
    }
  };

  const handleAddStudent = async (e) => {
    e?.preventDefault();
    if (savingStudentRef.current) return;
    const { name, gender, dob, class_level, stream } = studentForm;
    if (!name || !gender || !dob || !class_level || !stream) {
      setStudentError("Please fill in all required fields.");
      return;
    }
    const subjects = [...COMPULSORY_SUBJECTS, ...selectedOptionals];
    setPendingStudentSave({ name, gender, dob, class_level, stream, subjects });
    setShowStudentSaveConfirm(true);
  };

  const handleDeleteStudent = async (id) => {
    if (!window.confirm("Remove this learner?")) return;
    setDeletingStudentId(id);
    setStudentError("");
    try {
      await adminFetch(`/api/admin/students/${id}`, { method: "DELETE" });
      setStudents((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error("Error deleting student:", err);
      setStudentError(err.message || "Could not delete student.");
    } finally {
      setDeletingStudentId(null);
    }
  };

  /* ---------- Marks sets (admin) ---------- */
  const fetchMarksSets = async () => {
    setLoadingMarksSets(true);
    setMarksError("");
    try {
      const data = await adminFetch("/api/admin/marks-sets");
      if (!Array.isArray(data)) throw new Error("Invalid response");
      setMarksSets(data);
    } catch (err) {
      console.error("Error loading marks sets:", err);
      setMarksError(err.message?.toLowerCase?.().includes("admin") ? "Admin authorization required. Set admin key." : (err.message || "Could not load marks summary."));
      setMarksSets([]);
    } finally {
      setLoadingMarksSets(false);
    }
  };

  const fetchMarksDetail = async (set, returnOnly = false) => {
    if (!set) return;
  
    // Only reset UI state if NOT used for combined
    if (!returnOnly) {
      setLoadingMarksDetail(true);
      setMarksError("");
      setMarksDetail([]);
    }
  
    try {
      const params = new URLSearchParams({
        assignmentId: set.assignment_id,
        term: set.term,
        year: String(set.year),
        aoi: set.aoi_label,
      });
  
      const data = await adminFetch(`/api/admin/marks-detail?${params.toString()}`);
  
      if (!Array.isArray(data)) throw new Error("Invalid response");
  
      // 👇 new behavior for combined mode
      if (returnOnly) return data;
  
      // 👇 existing behavior preserved
      setMarksDetail(data);
    } catch (err) {
      console.error("Error loading marks detail:", err);
  
      if (!returnOnly) {
        setMarksError(err.message || "Could not load marks detail.");
        setMarksDetail([]);
      }
    } finally {
      if (!returnOnly) {
        setLoadingMarksDetail(false);
      }
    }
  };
  

  /* ------------------ Effects (initial & section load) ------------------ */
  useEffect(() => {
    fetchTeachers();
    fetchStudents();
    fetchALevelLearners();
    // prefetch marks summary so tracker / download panels are snappy
    fetchMarksSets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  

  useEffect(() => {
    if (activeSection === "Notices") fetchNotices();
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === "Manage Teachers") fetchTeachers();
    else if (activeSection === "Add Students") fetchStudents();
    else if (activeSection === "Download Marks") {
      fetchMarksSets();
      setSelectedMarksSet(null);
      setMarksDetail([]);
    } else if (activeSection === "Assessment Submission Tracker") {
      // load marks so tracker has data
      fetchMarksSets();
    } else if (activeSection === "Stream Readiness") {
      fetchStreamReadiness();
    } else if (activeSection === "Assign Subjects") {
      console.log("[AdminDashboard] opening Assign Subjects panel");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);
  

  useEffect(() => {
    if (selectedMarksSet) fetchMarksDetail(selectedMarksSet);
    else setMarksDetail([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMarksSet]);

  /* ------------------ UI helpers ------------------ */
  const handleTeacherInputChange = (e) => {
    const { name, value } = e.target;
    setTeacherForm((p) => ({ ...p, [name]: value }));
  };

  const handleStudentInputChange = (e) => {
    const { name, value } = e.target;
    setStudentForm((p) => ({ ...p, [name]: value }));
    setStudentError("");

    if (name === "class_level" && (value === "S1" || value === "S2")) {
      setSelectedOptionals((prev) => {
        const merged = Array.from(new Set([...S1_S2_PRESELECT_OPTIONALS, ...prev]));
        return merged.slice(0, 6);
      });
    }
  };

  const handleOptionalSubjectToggle = (subject) => {
    setStudentError("");
    setSelectedOptionals((prev) => {
      if (prev.includes(subject)) return prev.filter((s) => s !== subject);
      if (prev.length >= 6) {
        setStudentError("You can only add up to 6 optional subjects (12 total).");
        return prev;
      }
      return [...prev, subject];
    });
  };

  const csvEscape = (value) => {
    if (value === null || value === undefined) return '""';
    const s = String(value).replace(/"/g, '""');
    return `"${s}"`;
  };

  /* ---------- Export helpers (CSV / PDF) ---------- */
  const handleDownloadCsv = () => {
    if (!selectedAoi || marksDetail.length === 0) return;
  
    const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  
    const header = [
      "Student ID",
      "Name",
      "Class",
      "Stream",
      "Score",
      "Subject",
      "AOI",
      "Term",
      "Year",
      "Submitted By",
      "Submitted At",
    ];
  
    const submittedAt = formatDateTime(
      selectedAoi.submitted_at || selectedAoi.created_at
    );
  
    const rows = marksDetail.map((row) => [
      csvEscape(row.student_id),
      csvEscape(row.student_name),
      csvEscape(row.class_level),
      csvEscape(row.stream),
      csvEscape(row.score),
      csvEscape(selectedAoi.subject),
      csvEscape(selectedAoi.aoi_label),
      csvEscape(selectedAoi.term),
      csvEscape(selectedAoi.year),
      csvEscape(selectedAoi.teacher_name || ""),
      csvEscape(submittedAt),
    ]);
  
    const csvContent = [
      header.map(csvEscape).join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");
  
    const slug = (str) =>
      String(str || "")
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
  
    const filename = `marks_${slug(selectedAoi.class_level)}_${slug(
      selectedAoi.stream
    )}_${slug(selectedAoi.subject)}_${slug(
      selectedAoi.aoi_label
    )}_T${slug(selectedAoi.term)}_${selectedAoi.year}.csv`;
  
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
  
    // Open in new tab (user chooses to save / download)
    window.open(url, "_blank");
  
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  

  const handleDeleteMarkSet = async (set) => {
    const ok = window.confirm(`Delete this mark set?\n\n${set.class_level} ${set.stream}\n${set.subject} — ${set.aoi_label}\nTerm ${set.term} ${set.year}\n\nThis cannot be undone.`);
    if (!ok) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/marks-set`, { method: "DELETE", headers: { "Content-Type": "application/json", "x-admin-key": localStorage.getItem("SPESS_ADMIN_KEY") }, body: JSON.stringify({ assignmentId: set.assignment_id, term: set.term, year: set.year, aoi: set.aoi_label }) });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete mark set");
      }
      setMarksSets((prev) => prev.filter((m) => !(m.assignment_id === set.assignment_id && m.term === set.term && m.year === set.year && m.aoi_label === set.aoi_label)));
      if (selectedMarksSet && selectedMarksSet.assignment_id === set.assignment_id && selectedMarksSet.term === set.term && selectedMarksSet.year === set.year && selectedMarksSet.aoi_label === set.aoi_label) {
        setSelectedMarksSet(null);
        setMarksDetail([]);
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedAoi || marksDetail.length === 0) return;
    const { jsPDF } = await loadPdfTools();
    const doc = new jsPDF("p", "mm", "a4");
  
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
  
    const schoolName = "St. Phillip's Equatorial Secondary School (SPESS)";
    const title = `${selectedAoi.subject} — ${selectedAoi.aoi_label}`;
    const generatedAt = formatDateTime(new Date().toISOString());
  
    const meta = {
      Class: selectedAoi.class_level,
      Stream: selectedAoi.stream,
      Subject: selectedAoi.subject,
      Term: selectedAoi.term,
      Year: selectedAoi.year,
      "Submitted by": selectedAoi.teacher_name || "—",
      "Submitted at": formatDateTime(
        selectedAoi.submitted_at || selectedAoi.created_at
      ),
    };
  
    /* ========== HEADER (only drawn on first page) ========== */
    const drawHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(schoolName, pageW / 2, 18, { align: "center" });
  
      doc.setFontSize(17);
      doc.text(title, pageW / 2, 28, { align: "center" });
  
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
  
      let y = 38;
      Object.entries(meta).forEach(([label, value]) => {
        doc.text(`${label}: ${value}`, 14, y);
        y += 6;
      });
  
      return y + 4;
    };
  
    /* ========== TABLE HEADER ========== */
    const drawTableHeader = (y) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
  
      doc.text("#", 14, y);
      doc.text("Student Name", 24, y);
      doc.text("Class", 122, y);
      doc.text("Stream", 142, y);
      doc.text("Score", 168, y);
  
      doc.setDrawColor(180);
      doc.line(12, y + 2, pageW - 12, y + 2);
  
      doc.setFont("helvetica", "normal");
      return y + 8;
    };
  
    /* ========== FOOTER ========== */
    const drawFooter = (pageNo, total) => {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text(
        `Generated from SPESS ARK · ${generatedAt} · Page ${pageNo} of ${total}`,
        pageW / 2,
        pageH - 8,
        { align: "center" }
      );
    };
  
    /* ========== BUILD DOCUMENT ========== */
    let y = drawHeader();
    y = drawTableHeader(y);
  
    const bottomMargin = 18;
    const rowHeight = 7;
  
    marksDetail.forEach((row, index) => {
      if (y + rowHeight > pageH - bottomMargin) {
        doc.addPage();
        y = 20;
        y = drawTableHeader(y);
      }
  
      doc.text(String(index + 1), 14, y);
      doc.text(row.student_name || "", 24, y);
      doc.text(row.class_level || "", 122, y);
      doc.text(row.stream || "", 142, y);
      doc.text(
        row.score != null ? String(row.score) : "",
        168,
        y,
        { align: "right" }
      );
  
      y += rowHeight;
    });
  
    /* ========== FOOTERS ========== */
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawFooter(i, totalPages);
    }
  
    /* ========== OPEN AS BLOB (NOT FORCED DOWNLOAD) ========== */
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const handleDownloadScoreSheetPdf = async () => {
    setScoreSheetError("");

    const classLevel = String(scoreSheetFilters.class_level || "").trim();
    const stream = String(scoreSheetFilters.stream || "").trim();
    const term = String(scoreSheetFilters.term || "").trim();
    const year = Number(scoreSheetFilters.year);

    if (!classLevel || !stream || !term || !year) {
      setScoreSheetError("Select class, stream, term and year first.");
      return;
    }

    const formatScoreCell = (mark) => {
      if (!mark) return "";
      if (String(mark.status || "").toLowerCase() === "missed") return "X";
      if (mark.score === null || mark.score === undefined || mark.score === "") return "";
      const n = Number(mark.score);
      return Number.isFinite(n) ? String(Number(n.toFixed(2))) : String(mark.score);
    };

    const chunkBy = (list, size) => {
      const out = [];
      for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
      return out;
    };

    setScoreSheetLoading(true);
    try {
      const params = new URLSearchParams({
        class_level: classLevel,
        stream,
        term,
        year: String(year),
      });
      const data = await adminFetch(`/api/admin/score-sheet?${params.toString()}`);

      const students = Array.isArray(data?.students) ? data.students : [];
      const subjects = Array.isArray(data?.subjects) ? data.subjects : [];
      const marks = Array.isArray(data?.marks) ? data.marks : [];

      if (students.length === 0) {
        setScoreSheetError("No learners found in that class and stream.");
        return;
      }
      if (subjects.length === 0) {
        setScoreSheetError("No submitted subject marks found for that class/stream/term/year.");
        return;
      }

      const markMap = new Map(
        marks.map((m) => [
          `${m.student_id}|${m.assignment_id}|${String(m.aoi_label || "").toUpperCase()}`,
          m,
        ])
      );

      const { jsPDF, autoTable } = await loadPdfTools();
      const subjectChunks = chunkBy(subjects, 4);
      const doc = new jsPDF("l", "mm", "a4");
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const generatedAt = formatDateTime(new Date().toISOString());
      const aoiColumnCount = 12; // 4 subjects × 3 AOIs
      const numberColWidth = 7;
      const learnerColWidth = 45;
      const genderColWidth = 7;
      const subjectAoiColWidth = (pageW - 16 - numberColWidth - learnerColWidth - genderColWidth) / aoiColumnCount;

      subjectChunks.forEach((subjectChunk, chunkIndex) => {
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
        doc.text(`Stream: ${stream}`, 52, 25);
        doc.text(`Term: ${term}`, 98, 25);
        doc.text(`Year: ${year}`, 140, 25);
        doc.text(`Subjects ${chunkIndex * 4 + 1}-${chunkIndex * 4 + subjectChunk.length}`, 176, 25);

        const headTop = [
          { content: "#", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
          { content: "Learner", rowSpan: 2, styles: { halign: "left", valign: "middle" } },
          { content: "G", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
          ...subjectChunk.map((subjectRow) => ({
            content: String(subjectRow.subject || "Subject"),
            colSpan: 3,
            styles: { halign: "center", valign: "middle" },
          })),
        ];
        const headBottom = [
          ...subjectChunk.flatMap(() => ["A1", "A2", "A3"]),
        ];

        const body = students.map((student, index) => {
          const row = [
            index + 1,
            student.name || "",
            String(student.gender || "").slice(0, 1).toUpperCase(),
          ];

          subjectChunk.forEach((subjectRow) => {
            ["AOI1", "AOI2", "AOI3"].forEach((aoiLabel) => {
              const mark = markMap.get(
                `${student.id}|${subjectRow.assignment_id}|${aoiLabel}`
              );
              row.push(formatScoreCell(mark));
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
              Array.from({ length: aoiColumnCount }, (_, idx) => [
                3 + idx,
                { cellWidth: subjectAoiColWidth, halign: "center" },
              ])
            ),
          },
        });
      });

      const totalPages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i += 1) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.text(
          `Generated from SPESS ARK · ${generatedAt} · Page ${i} of ${totalPages}`,
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
      console.error("Score sheet PDF error:", err);
      setScoreSheetError(err.message || "Failed to generate score sheet PDF.");
    } finally {
      setScoreSheetLoading(false);
    }
  };
  
  const handleDownloadMarksheetPdf = async () => {
    setMarksheetError("");
  
    if (!marksheetClass) {
      setMarksheetError("Select a class for the marksheet.");
      return;
    }
  
    const list = filteredMarksheetStudents;
  
    if (list.length === 0) {
      setMarksheetError("No learners found for that class/stream/subject selection.");
      return;
    }
  
    const { jsPDF } = await loadPdfTools();
    const doc = new jsPDF("p", "mm", "a4");
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
  
    const generatedAt = formatDateTime(new Date().toISOString());
    const schoolName = "St. Phillip's Equatorial Secondary School (SPESS)";
    const title = marksheetSubject ? `${marksheetSubject} Marksheet` : "Class List";
    const classLabel = marksheetClass;
    const streamLabel = marksheetStream || "North & South";
    const subjectLabel = marksheetSubject || "All subjects";
  
    const topMargin = 16;
    const firstHeaderHeight = 56;
    const continuationHeaderHeight = 16;
    const tableHeaderHeight = 10;
    const bottomMargin = 18;
    const baseRowHeight = 8;
  
    let y;
  
    /* ---------- FIRST PAGE HEADER ---------- */
    const drawFirstPageHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(schoolName, pageW / 2, 16, { align: "center" });
  
      doc.setFontSize(16);
      doc.text(title, pageW / 2, 26, { align: "center" });
  
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Class: ${classLabel}`, 14, 38);
      doc.text(`Stream: ${streamLabel}`, 14, 44);
      doc.text(`Subject: ${subjectLabel}`, 14, 50);
      doc.text(`Generated: ${generatedAt}`, 14, 56);
    };
  
    /* ---------- CONTINUATION HEADER ---------- */
    const drawContinuationHeader = () => {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text(
        `Class ${classLabel} — ${streamLabel} — ${subjectLabel}`,
        14,
        14
      );
    };
  
    /* ---------- TABLE HEADER ---------- */
    const drawTableHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
  
      doc.text("#", 12, y);
      doc.text("Name", 20, y);
      doc.text("Gender", 92, y);
      doc.text("Class", 112, y);
      doc.text("Stream", 130, y);
      doc.text("Optional Subjects", 148, y);
  
      doc.setDrawColor(180);
      doc.line(10, y + 2, pageW - 10, y + 2);
  
      y += tableHeaderHeight;
      doc.setFont("helvetica", "normal");
    };
  
    /* ---------- FOOTER ---------- */
    const drawFooter = (pageNo, totalPages) => {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text(
        `Generated from SPESS ARK · ${generatedAt} · Page ${pageNo} of ${totalPages}`,
        pageW / 2,
        pageH - 8,
        { align: "center" }
      );
    };
  
    /* ---------- PAGE 1 ---------- */
    drawFirstPageHeader();
    y = topMargin + firstHeaderHeight;
    drawTableHeader();
  
    /* ---------- NEW PAGE ---------- */
    const startNewPage = () => {
      doc.addPage();
      drawContinuationHeader();
      y = topMargin + continuationHeaderHeight;
      drawTableHeader();
    };
  
    /* ---------- ROWS ---------- */
    list.forEach((s, index) => {
      const subs = Array.isArray(s.subjects) ? s.subjects : [];
      const optionalSubs = subs.filter((sub) =>
        OPTIONAL_SUBJECTS.includes(sub)
      );
      const optionalText = optionalSubs.join(", ");
      const subjectLines = doc.splitTextToSize(optionalText, pageW - 160);
  
      const rowHeight = Math.max(
        baseRowHeight,
        subjectLines.length * 6
      );
  
      if (y + rowHeight > pageH - bottomMargin) {
        startNewPage();
      }
  
      doc.setFontSize(9);
      doc.text(String(index + 1), 12, y);
      doc.text(s.name || "", 20, y);
      doc.text(s.gender || "", 92, y);
      doc.text(s.class_level || "", 112, y);
      doc.text(s.stream || "", 130, y);
      doc.text(subjectLines, 148, y);
  
      y += rowHeight;
    });
  
    /* ---------- FOOTERS ---------- */
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      drawFooter(i, totalPages);
    }
  
    /* ---------- OPEN AS BLOB ---------- */
    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  };

  const handleDownloadMarksheetCsv = () => {
    setMarksheetError("");

    if (!marksheetClass) {
      setMarksheetError("Select a class for the marksheet.");
      return;
    }

    const list = filteredMarksheetStudents;

    if (list.length === 0) {
      setMarksheetError("No learners found for that class/stream/subject selection.");
      return;
    }

    const csvEscape = (value) => {
      if (value === null || value === undefined) return '""';
      const str = String(value).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = list.map((s, idx) => {
      const subs = Array.isArray(s.subjects) ? s.subjects : [];
      const optionalSubs = subs.filter((sub) => OPTIONAL_SUBJECTS.includes(sub));
      return [
        idx + 1,
        s.name || "",
        s.gender || "",
        s.class_level || "",
        s.stream || "",
        optionalSubs.join(", "),
      ];
    });

    const header = ["#", "Name", "Gender", "Class", "Stream", "Optional Subjects"];
    const csv = [
      header.map(csvEscape).join(","),
      ...rows.map((r) => r.map(csvEscape).join(",")),
    ].join("\n");

    const classLabel = marksheetClass;
    const streamLabel = marksheetStream || "all_streams";
    const subjectLabel = marksheetSubject || "all_subjects";
    const filename = `class_marksheet_${String(classLabel).toLowerCase()}_${String(streamLabel).toLowerCase().replace(/\s+/g, "_")}_${String(subjectLabel).toLowerCase().replace(/\s+/g, "_")}.csv`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  
  
  

  /* ------------------ Card click handler ------------------ */
  const handleCardClick = (card) => {
    if (card?.status === "archived") return;
    console.log("[AdminDashboard] card clicked:", card?.title);
    setActiveSection((prev) => (prev === card?.title ? "" : card?.title));
  };

  /* ------------------ Derived values / filters ------------------ */
  const allSubjectsForFilter = [...COMPULSORY_SUBJECTS, ...OPTIONAL_SUBJECTS];
  const filteredMarksheetStudents = useMemo(() => {
    return students
      .filter((s) => {
        if (s.class_level !== marksheetClass) return false;
        if (marksheetStream && s.stream !== marksheetStream) return false;
        if (marksheetSubject) {
          const subs = Array.isArray(s.subjects) ? s.subjects : [];
          if (!subs.includes(marksheetSubject)) return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [students, marksheetClass, marksheetStream, marksheetSubject]);

  const potentialDuplicateLearner = useMemo(() => {
    const name = String(studentForm.name || "").trim().toLowerCase();
    const cls = String(studentForm.class_level || "").trim();
    const stream = String(studentForm.stream || "").trim();
    const dob = String(studentForm.dob || "").trim();

    if (!name || !cls || !stream || !dob) return null;

    return (
      students.find((s) => {
        const sn = String(s.name || "").trim().toLowerCase();
        const sc = String(s.class_level || "").trim();
        const ss = String(s.stream || "").trim();
        const sd = String(s.dob || "").slice(0, 10);
        return sn === name && sc === cls && ss === stream && sd === dob;
      }) || null
    );
  }, [students, studentForm.name, studentForm.class_level, studentForm.stream, studentForm.dob]);

  const filteredStudents = students.filter((s) => {
    if (classFilter && s.class_level !== classFilter) return false;
    if (streamFilter && s.stream !== streamFilter) return false;
    if (subjectFilter) {
      const subs = Array.isArray(s.subjects) ? s.subjects : [];
      if (!subs.includes(subjectFilter)) return false;
    }
    if (searchName) {
      const query = searchName.toLowerCase().trim();
      if (!s.name.toLowerCase().includes(query)) return false;
    }
    return true;
  });
    /* ---------- Enrollment breakdown by stream / class / gender ---------- */
  const enrollmentByStreamClassGender = React.useMemo(() => {
  const result = {};

  students.forEach((s) => {
    const stream = s.stream || "Unknown";
    const cls = s.class_level || "Unknown";
    const gender = s.gender || "Other";

    if (!result[stream]) result[stream] = {};
    if (!result[stream][cls]) {
      result[stream][cls] = {
        Male: 0,
        Female: 0,
        Other: 0,
        total: 0,
      };
    }

    if (gender === "Male") result[stream][cls].Male += 1;
    else if (gender === "Female") result[stream][cls].Female += 1;
    else result[stream][cls].Other += 1;

    result[stream][cls].total += 1;
  });

  return result;
  }, [students]);
  const enrollmentByClassWithOrderedStreams = React.useMemo(() => {
    const byClass = {};
    Object.entries(enrollmentByStreamClassGender).forEach(([stream, classes]) => {
      Object.entries(classes || {}).forEach(([cls, stats]) => {
        if (!byClass[cls]) byClass[cls] = {};
        byClass[cls][stream] = stats;
      });
    });

    const classOrder = Object.keys(byClass).sort((a, b) => {
      const na = Number(String(a).replace(/[^\d]/g, ""));
      const nb = Number(String(b).replace(/[^\d]/g, ""));
      if (Number.isNaN(na) || Number.isNaN(nb)) return String(a).localeCompare(String(b));
      return na - nb;
    });

    return classOrder.map((cls) => ({
      cls,
      streams: byClass[cls] || {},
    }));
  }, [enrollmentByStreamClassGender]);
  // derived grouping
  const groupedMarkSets = useMemo(() => {
    const map = {};
  
    marksSets.forEach((m) => {
      const key = [
        m.class_level,
        m.stream,
        m.subject,
        m.term,
        m.year,
      ].join("|");
  
      if (!map[key]) {
        map[key] = {
          class_level: m.class_level,
          stream: m.stream,
          subject: m.subject,
          term: m.term,
          year: m.year,
          teacher_name: m.teacher_name || "—",
          aois: [],
        };
      }
  
      map[key].aois.push(m);
    });
  
    return Object.values(map);
  }, [marksSets]);
  
  const classOptions = Array.from(new Set(students.map((s) => s.class_level))).filter(Boolean);
  const classOptionsForMarksheet = classOptions.length > 0 ? classOptions : ["S1", "S2", "S3", "S4"];
  const scoreSheetClassOptions = classOptionsForMarksheet;
  const scoreSheetStreamOptions = useMemo(() => {
    const selectedClass = String(scoreSheetFilters.class_level || "").trim();
    const fromStudents = students
      .filter((s) => !selectedClass || s.class_level === selectedClass)
      .map((s) => s.stream);
    const fromMarks = marksSets
      .filter((m) => !selectedClass || m.class_level === selectedClass)
      .map((m) => m.stream);
    const combined = Array.from(new Set([...fromStudents, ...fromMarks])).filter(Boolean);
    if (combined.length === 0) return ["North", "South"];
    return combined.sort((a, b) => {
      const order = { North: 0, South: 1 };
      const av = order[a] ?? 99;
      const bv = order[b] ?? 99;
      return av !== bv ? av - bv : String(a).localeCompare(String(b));
    });
  }, [students, marksSets, scoreSheetFilters.class_level]);
  useEffect(() => {
    if (!scoreSheetStreamOptions.includes(scoreSheetFilters.stream)) {
      setScoreSheetFilters((prev) => ({
        ...prev,
        stream: scoreSheetStreamOptions[0] || "North",
      }));
    }
  }, [scoreSheetStreamOptions, scoreSheetFilters.stream]);

  const totalStudents = students.length;
  const totalBoys = students.filter((s) => s.gender === "Male").length;
  const totalGirls = students.filter((s) => s.gender === "Female").length;
  const totalTeachers = teachers.length;

  const s1Students = students.filter((s) => s.class_level === "S1").length;
  const s2Students = students.filter((s) => s.class_level === "S2").length;
  const s3Students = students.filter((s) => s.class_level === "S3").length;
  const s4Students = students.filter((s) => s.class_level === "S4").length;

  /* ------------------ renderSectionContent ------------------ */
  const renderSectionContent = () => {
    if (activeSection === "Manage Teachers") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Manage Teachers</h2>
              <p>Register teachers and their two teaching subjects.</p>
            </div>
            <button className="panel-close" type="button" onClick={() => setActiveSection("")}>✕ Close</button>
          </div>

          {teacherError && <div className="panel-alert panel-alert-error">{teacherError}</div>}

          <div className="panel-grid">
            <div className="panel-card">
              <h3>Add Teacher</h3>
              <form className="teacher-form" onSubmit={handleAddTeacher}>
                <div className="form-row">
                  <label htmlFor="tname">Full name</label>
                  <input id="tname" name="name" type="text" value={teacherForm.name} onChange={handleTeacherInputChange} placeholder="e.g. Sarah Nambogo" autoComplete="name" />
                </div>
                <div className="form-row">
                  <label htmlFor="temail">Email</label>
                  <input id="temail" name="email" type="email" value={teacherForm.email} onChange={handleTeacherInputChange} placeholder="e.g. sarah@example.com" autoComplete="email" />
                </div>
                <div className="form-row">
                  <label htmlFor="subject1">Subject 1</label>
                  <input id="subject1" name="subject1" type="text" value={teacherForm.subject1} onChange={handleTeacherInputChange} placeholder="e.g. Mathematics" autoComplete="off" />
                </div>
                <div className="form-row">
                  <label htmlFor="subject2">Subject 2</label>
                  <input id="subject2" name="subject2" type="text" value={teacherForm.subject2} onChange={handleTeacherInputChange} placeholder="e.g. Physics" autoComplete="off" />
                </div>

                <button className="primary-btn" type="submit" disabled={savingTeacher}>{savingTeacher ? "Saving…" : "Save Teacher"}</button>
              </form>
            </div>

            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Teachers</h3>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button type="button" className="primary-btn" style={{ marginTop: 0 }} onClick={handleDownloadTeachersPdf} disabled={loadingTeachers || teachers.length === 0}>
                    Download PDF
                  </button>
                  <button type="button" className="ghost-btn" onClick={fetchTeachers} disabled={loadingTeachers}>{loadingTeachers ? "Refreshing…" : "Refresh"}</button>
                </div>
              </div>

              {loadingTeachers && teachers.length === 0 ? (
                <p className="muted-text">Loading teachers…</p>
              ) : teachers.length === 0 ? (
                <p className="muted-text">No teachers yet. Add the first teacher on the left.</p>
              ) : (
                <div className="teachers-table-wrapper">
                  <table className="teachers-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Added</th>
                        <th/>
                      </tr>
                    </thead>
                    <tbody>
                      {teachers.map((t) => (
                        <tr key={t.id}>
                          <td>{t.name}</td>
                          <td>{t.email}</td>
                          <td>{t.created_at ? formatDateTime(t.created_at) : "—"}</td>
                          <td className="teachers-actions">
                            <button type="button" className="danger-link" onClick={() => handleDeleteTeacher(t.id)} disabled={deletingTeacherId === t.id}>{deletingTeacherId === t.id ? "Deleting…" : "Delete"}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      );
    }

    if (activeSection === "Add Students") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Add Students</h2>
              <p>Enrol learners with their class, stream and subjects. Seven core subjects are automatic, then choose optionals.</p>
            </div>
            <button className="panel-close" type="button" onClick={() => setActiveSection("")}>✕ Close</button>
          </div>

          {studentError && <div className="panel-alert panel-alert-error">{studentError}</div>}

          <div className="panel-grid">
            <div className="panel-card">
              <h3>Add Learner</h3>
              <form className="teacher-form" onSubmit={handleAddStudent}>
                <div className="form-row">
                  <label htmlFor="sname">Full name</label>
                  <input id="sname" name="name" type="text" value={studentForm.name} onChange={handleStudentInputChange} placeholder="e.g. Kato John" autoComplete="name" />
                </div>

                <div className="form-row">
                  <label htmlFor="gender">Gender</label>
                  <select id="gender" name="gender" value={studentForm.gender} onChange={handleStudentInputChange} autoComplete="sex">
                    <option value="">Select gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="form-row">
                  <label htmlFor="dob">Date of birth</label>
                  <input id="dob" name="dob" type="date" value={studentForm.dob} onChange={handleStudentInputChange} autoComplete="bday" />
                </div>

                <div className="form-row">
  <label htmlFor="class_level">Class</label>
  <select
    id="class_level"
    name="class_level"
    value={studentForm.class_level}
    onChange={handleStudentInputChange}
  >
    <option value="">Select class</option>
    <option value="S1">S1</option>
    <option value="S2">S2</option>
    <option value="S3">S3</option>
    <option value="S4">S4</option>
  </select>
</div>


                <div className="form-row">
                  <label htmlFor="stream">Stream</label>
                  <select id="stream" name="stream" value={studentForm.stream} onChange={handleStudentInputChange} autoComplete="off">
                    <option value="">Select stream</option>
                    <option value="North">North</option>
                    <option value="South">South</option>
                  </select>
                </div>

                <div className="form-row">
                  <label>Compulsory subjects (always included)</label>
                  <div className="muted-text">{COMPULSORY_SUBJECTS.join(" • ")}</div>
                </div>

                <div className="form-row">
                  <label>Optional subjects (pick up to 5)</label>
                  <div className="muted-text" style={{ marginBottom: "0.4rem" }}>Total subjects = 7 compulsory + your optionals.</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.3rem 0.8rem", fontSize: "0.8rem" }}>
                    {OPTIONAL_SUBJECTS.map((subj) => (
                      <label key={subj} style={{ display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
                        <input type="checkbox" checked={selectedOptionals.includes(subj)} onChange={() => handleOptionalSubjectToggle(subj)} />
                        <span>{subj}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {potentialDuplicateLearner && (
                  <div className="panel-alert" style={{ background: "rgba(245, 158, 11, 0.12)", border: "1px solid rgba(245, 158, 11, 0.45)", color: "#fcd34d" }}>
                    Potential duplicate: this learner already exists as{" "}
                    <strong>{potentialDuplicateLearner.name}</strong> ({potentialDuplicateLearner.class_level} {potentialDuplicateLearner.stream}).
                  </div>
                )}

                <button className="primary-btn" type="submit" disabled={savingStudent}>{savingStudent ? "Saving…" : "Save Learner"}</button>
              </form>
            </div>

            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Learners</h3>
                <button type="button" className="ghost-btn" onClick={fetchStudents} disabled={loadingStudents}>{loadingStudents ? "Refreshing…" : "Refresh"}</button>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.7rem", fontSize: "0.8rem" }}>
                <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                  <option value="">All classes</option>
                  {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>

                <select value={streamFilter} onChange={(e) => setStreamFilter(e.target.value)}>
                  <option value="">All streams</option>
                  <option value="North">North</option>
                  <option value="South">South</option>
                </select>

                <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
                  <option value="">All subjects</option>
                  {allSubjectsForFilter.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>

                <button type="button" className="ghost-btn" onClick={() => { setClassFilter(""); setStreamFilter(""); setSubjectFilter(""); setSearchName(""); }}>Clear</button>

                <input type="text" value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="Search by name…" style={{ minWidth: "180px", padding: "0.35rem 0.6rem", borderRadius: "999px", border: "1px solid rgba(148,163,184,0.6)", background: "rgba(15,23,42,0.9)", color: "#e5e7eb", outline: "none" }} />
              </div>

              <div style={{ marginBottom: "0.8rem", padding: "0.75rem 0.9rem", borderRadius: "0.9rem", background: "rgba(15,23,42,0.9)", border: "1px solid rgba(148,163,184,0.45)", display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center", justifyContent: "space-between", fontSize: "0.8rem" }}>
                <div style={{ minWidth: "180px" }}>
                  <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#9ca3af", marginBottom: "0.25rem" }}>Class marksheet PDF</div>
                  <div className="muted-text">Generate a printable class list for the notice board.</div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", alignItems: "center" }}>
                  <select value={marksheetClass} onChange={(e) => { setMarksheetClass(e.target.value); setMarksheetError(""); }}>
                    <option value="">Select class</option>
                    {classOptionsForMarksheet.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>

                  <select value={marksheetStream} onChange={(e) => { setMarksheetStream(e.target.value); setMarksheetError(""); }}>
                    <option value="">All streams</option>
                    <option value="North">North</option>
                    <option value="South">South</option>
                  </select>

                  <select value={marksheetSubject} onChange={(e) => { setMarksheetSubject(e.target.value); setMarksheetError(""); }}>
                    <option value="">All subjects</option>
                    {allSubjectsForFilter.map((subject) => (
                      <option key={subject} value={subject}>{subject}</option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleDownloadMarksheetCsv}
                    style={{
                      whiteSpace: "nowrap",
                      border: "none",
                      borderRadius: "999px",
                      padding: "0.5rem 0.95rem",
                      background: "linear-gradient(135deg, #ef4444, #b91c1c)",
                      color: "#fff",
                      fontWeight: 700,
                      boxShadow: "0 8px 18px rgba(185,28,28,0.35)",
                      cursor: "pointer",
                    }}
                  >
                    Download CSV
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadMarksheetPdf}
                    style={{
                      whiteSpace: "nowrap",
                      border: "none",
                      borderRadius: "999px",
                      padding: "0.5rem 0.95rem",
                      background: "linear-gradient(135deg, #d4a017, #8b5e0a)",
                      color: "#fff",
                      fontWeight: 700,
                      boxShadow: "0 8px 18px rgba(139,94,10,0.35)",
                      cursor: "pointer",
                    }}
                  >
                    Download PDF
                  </button>
                </div>

                {marksheetError && <div style={{ width: "100%", marginTop: "0.25rem", fontSize: "0.75rem", color: "#fecaca" }}>{marksheetError}</div>}
              </div>

              {loadingStudents && students.length === 0 ? (
                <p className="muted-text">Loading learners…</p>
              ) : filteredStudents.length === 0 ? (
                <p className="muted-text">No learners match the filters. Try clearing filters or add a new learner.</p>
              ) : (
                <div className="teachers-table-wrapper">
                  <table className="teachers-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Gender</th>
                        <th>Class</th>
                        <th>Stream</th>
                        <th>Subjects</th>
                        <th>Added</th>
                        <th/>
                      </tr>
                    </thead>
                    <tbody>
                    {filteredStudents.map((s) => (
  <tr key={s.id}>
    <td>{s.name}</td>
    <td>{s.gender}</td>
    <td>{s.class_level}</td>
    <td>{s.stream}</td>
    <td>{Array.isArray(s.subjects) ? s.subjects.join(", ") : ""}</td>
    <td>{s.created_at ? formatDateTime(s.created_at) : "—"}</td>
    <td className="teachers-actions">
      <button
        type="button"
        className="ghost-btn"
        onClick={() => setEditingStudent(s)}
      >
        Edit
      </button>

      <button
        type="button"
        className="danger-link"
        onClick={() => handleDeleteStudent(s.id)}
        disabled={deletingStudentId === s.id}
      >
        {deletingStudentId === s.id ? "Deleting…" : "Delete"}
      </button>
    </td>
  </tr>
))}

                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      );
    }

    if (activeSection === "Notices") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Notices</h2>
              <p>Create and manage notices visible to teachers.</p>
            </div>
            <button className="panel-close" onClick={() => setActiveSection("")}>✕ Close</button>
          </div>

          {noticesError && <div className="panel-alert panel-alert-error">{noticesError}</div>}

          <div className="panel-grid">
            {/* create notice */}
            <div className="panel-card">
              <h3>Create Notice</h3>
              <form className="teacher-form" onSubmit={(e) => { e.preventDefault(); handleCreateNotice(); }}>
                <div className="form-row">
                  <label>Title</label>
                  <input value={noticeForm.title} onChange={(e) => setNoticeForm((p) => ({ ...p, title: e.target.value }))} />
                </div>
                <div className="form-row">
                  <label>Message</label>
                  <textarea rows={4} value={noticeForm.body} onChange={(e) => setNoticeForm((p) => ({ ...p, body: e.target.value }))} />
                </div>
                <button className="primary-btn" type="submit" disabled={loadingNotices}>{loadingNotices ? "Posting…" : "Publish Notice"}</button>
              </form>

              {/* quick list below create form */}
              {notices.map((n) => (
                <div key={n.id} className="notice-item">
                  <h4>{n.title}</h4>
                  <p>{n.body}</p>
                  <small>{formatDateTime(n.created_at)}</small>
                  <button className="danger-link" onClick={() => handleDeleteNotice(n.id)}>Delete</button>
                </div>
              ))}
            </div>

            <div className="panel-card">
              <h3>Published Notices</h3>
              {loadingNotices ? (
                <p className="muted-text">Loading notices…</p>
              ) : notices.length === 0 ? (
                <p className="muted-text">No notices yet.</p>
              ) : (
                notices.map((n) => (
                  <div key={n.id} style={{ padding: "0.8rem 0", borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
                    <h4 style={{ marginBottom: "0.3rem" }}>{n.title}</h4>
                    <p style={{ marginBottom: "0.4rem" }}>{n.body}</p>
                    <small className="muted-text">{formatDateTime(n.created_at)}</small>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      );
    }

    if (activeSection === "Assign Subjects") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Assign Subjects</h2>
              <p>Choose Teacher, Class, Subject and Stream from the dropdowns.</p>
            </div>
            <button className="panel-close" type="button" onClick={() => setActiveSection("")}>✕ Close</button>
          </div>
          <div style={{ padding: "0.6rem 0" }}>
            <AssignSubjectsPanel active={true} />
          </div>
        </section>
      );
    }

    if (activeSection === "Download Marks") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Download Marks</h2>
              <p>
                Browse marks by subject. Select a subject to view available AOIs,
                then choose an AOI to preview and export.
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button className="ghost-btn" onClick={() => setActiveSection("Add Students")}>Add Students</button>
              <button className="ghost-btn" onClick={() => setActiveSection("Download Marks")}>Download Marks</button>
              <button className="panel-close" type="button" onClick={() => setActiveSection("")}>✕ Close</button>
            </div>
          </div>
    
          {marksError && <div className="panel-alert panel-alert-error">{marksError}</div>}

          <div className="panel-card" style={{ marginBottom: "1rem" }}>
            <div className="panel-card-header">
              <h3>Noticeboard Score Sheet (PDF)</h3>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
                gap: "0.7rem",
              }}
            >
              <div className="form-row">
                <label>Class</label>
                <select
                  value={scoreSheetFilters.class_level}
                  onChange={(e) =>
                    setScoreSheetFilters((prev) => ({ ...prev, class_level: e.target.value }))
                  }
                >
                  {scoreSheetClassOptions.map((cls) => (
                    <option key={cls} value={cls}>
                      {cls}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <label>Stream</label>
                <select
                  value={scoreSheetFilters.stream}
                  onChange={(e) =>
                    setScoreSheetFilters((prev) => ({ ...prev, stream: e.target.value }))
                  }
                >
                  {scoreSheetStreamOptions.map((stream) => (
                    <option key={stream} value={stream}>
                      {stream}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <label>Term</label>
                <select
                  value={scoreSheetFilters.term}
                  onChange={(e) =>
                    setScoreSheetFilters((prev) => ({ ...prev, term: e.target.value }))
                  }
                >
                  <option value="Term 1">Term 1</option>
                  <option value="Term 2">Term 2</option>
                  <option value="Term 3">Term 3</option>
                </select>
              </div>

              <div className="form-row">
                <label>Year</label>
                <input
                  type="number"
                  min="2020"
                  max="2100"
                  value={scoreSheetFilters.year}
                  onChange={(e) =>
                    setScoreSheetFilters((prev) => ({
                      ...prev,
                      year: Number(e.target.value) || new Date().getFullYear(),
                    }))
                  }
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.7rem", alignItems: "center", marginTop: "0.8rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="primary-btn"
                onClick={handleDownloadScoreSheetPdf}
                disabled={scoreSheetLoading}
              >
                {scoreSheetLoading ? "Generating PDF…" : "Generate Score Sheet PDF"}
              </button>
              <span className="muted-text">
                Landscape A4 · 4 subjects per page · Helvetica 12
              </span>
            </div>

            {scoreSheetError && (
              <div className="panel-alert panel-alert-error" style={{ marginTop: "0.8rem" }}>
                {scoreSheetError}
              </div>
            )}
          </div>
    
          <div className="panel-grid">
    
            {/* LEFT PANEL */}
            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Available Subjects</h3>
                <button className="ghost-btn" onClick={fetchMarksSets} disabled={loadingMarksSets}>
                  {loadingMarksSets ? "Refreshing…" : "Refresh"}
                </button>
              </div>
    
              <div className="teachers-table-wrapper">
                <table className="teachers-table">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Stream</th>
                      <th>Subject</th>
                      <th>AOIs</th>
                      <th>Term</th>
                      <th>Year</th>
                      <th>Submitted by</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedMarkSets.map((group) => (
                      <tr
                        key={`${group.class_level}-${group.stream}-${group.subject}-${group.term}-${group.year}`}
                        onClick={() => {
                          setSelectedGroup(group);
                          setSelectedAoi(null);
                          setMarksDetail([]);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{group.class_level}</td>
                        <td>{group.stream}</td>
                        <td>{group.subject}</td>
                        <td>{group.aois.length}</td>
                        <td>{group.term}</td>
                        <td>{group.year}</td>
                        <td>{group.teacher_name || "—"}</td>
                        <td>
                          <button
                            className="danger-link"
                            onClick={async (e) => {
                              e.stopPropagation();
    
                              const ok = window.confirm(
                                `Delete ALL marks for:\n\n${group.subject}\n${group.class_level} ${group.stream}\nTerm ${group.term}, ${group.year}`
                              );
    
                              if (!ok) return;
    
                              try {
                                for (const aoi of group.aois) {
                                  await adminFetch("/api/admin/marks-set", {
                                    method: "DELETE",
                                    body: {
                                      assignmentId: aoi.assignment_id,
                                      term: aoi.term,
                                      year: aoi.year,
                                      aoi: aoi.aoi_label,
                                    },
                                  });
                                }
    
                                await fetchMarksSets();
                                setSelectedGroup(null);
                                setSelectedAoi(null);
                                setMarksDetail([]);
                              } catch {
                                alert("Failed to delete subject");
                              }
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
    
            {/* RIGHT PANEL */}
            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Marks Preview</h3>
    
                {selectedAoi && marksDetail.length > 0 && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button className="ghost-btn" onClick={handleDownloadCsv}>Download CSV</button>
                    <button className="primary-btn" onClick={handleDownloadPdf}>Download PDF</button>
    
                    {selectedAoi === "ALL" && (
                      <button className="ghost-btn" onClick={handleDownloadPdf}>
                        📦 Download Combined Report
                      </button>
                    )}
                  </div>
                )}
              </div>
    
              {!selectedGroup ? (
                <p className="muted-text">Select a subject on the left.</p>
              ) : (
                <>
                  <p className="muted-text">
                    {selectedGroup.class_level} {selectedGroup.stream} —{" "}
                    <strong>{selectedGroup.subject}</strong> (Term {selectedGroup.term}, {selectedGroup.year})
                  </p>
    
                  {/* AOI CONTROLS */}
                  <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.8rem" }}>
    
                    {/* ALL AOIs */}
                    <button
                      className={`ghost-btn ${selectedAoi === "ALL" ? "active" : ""}`}
                      onClick={async () => {
                        setSelectedAoi("ALL");
                        setLoadingMarksDetail(true);
                        setMarksDetail([]);
    
                        try {
                          const combined = [];
    
                          for (const aoi of selectedGroup.aois) {
                            const data = await fetchMarksDetail(aoi, true);
                            combined.push(...data.map(r => ({
                              ...r,
                              aoi_label: aoi.aoi_label,
                            })));
                          }
    
                          setMarksDetail(combined);
                        } catch {
                          alert("Failed to load combined AOIs");
                        } finally {
                          setLoadingMarksDetail(false);
                        }
                      }}
                    >
                      📦 All AOIs
                    </button>
    
                    {/* INDIVIDUAL AOIs */}
                    {selectedGroup.aois.map((aoi) => (
                      <div key={aoi.aoi_label} style={{ display: "flex", gap: "0.2rem" }}>
                        <button
                          className="ghost-btn"
                          onClick={() => {
                            setSelectedAoi(aoi);
                            fetchMarksDetail(aoi);
                          }}
                        >
                          {aoi.aoi_label}
                        </button>
    
                        <button
                          className="danger-link"
                          onClick={async (e) => {
                            e.stopPropagation();
    
                            const ok = window.confirm(
                              `Delete AOI?\n\n${aoi.aoi_label}\n${selectedGroup.subject}`
                            );
                            if (!ok) return;
    
                            try {
                              await adminFetch("/api/admin/marks-set", {
                                method: "DELETE",
                                body: {
                                  assignmentId: aoi.assignment_id,
                                  term: aoi.term,
                                  year: aoi.year,
                                  aoi: aoi.aoi_label,
                                },
                              });
    
                              await fetchMarksSets();
                              setSelectedAoi(null);
                              setMarksDetail([]);
                            } catch {
                              alert("Failed to delete AOI");
                            }
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
    
                  {loadingMarksDetail ? (
                    <p className="muted-text">Loading marks…</p>
                  ) : marksDetail.length === 0 ? (
                    <p className="muted-text">No marks loaded.</p>
                  ) : (
                    <div className="teachers-table-wrapper">
                      <table className="teachers-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Class</th>
                            <th>Stream</th>
                            {selectedAoi === "ALL" && <th>AOI</th>}
                            <th>Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {marksDetail.map((row, i) => (
                            <tr key={i}>
                              <td>{row.student_name}</td>
                              <td>{row.class_level}</td>
                              <td>{row.stream}</td>
                              {selectedAoi === "ALL" && <td>{row.aoi_label}</td>}
                              <td>{row.score}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      );
    }
    
    if (activeSection === "Enrollment Insights") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Enrollment Insights</h2>
              <p>See how learners are distributed by class, stream and subject.</p>
            </div>
            <button
              className="panel-close"
              type="button"
              onClick={() => setActiveSection("")}
            >
              ✕ Close
            </button>
          </div>
    
          <EnrollmentInsightsPanel students={students} />
        </section>
      );
    }
    if (activeSection === "End of Term Reports") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>End of Term Reports</h2>
              <p>Generate printable report cards (Term 1 & Term 2).</p>
            </div>
            <button className="panel-close" type="button" onClick={() => setActiveSection("")}>✕ Close</button>
          </div>
          <EndOfTermReports />
        </section>
      );
    }
    if (activeSection === "End of Year Reports") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>End of Year Reports</h2>
              <p>Generate printable report cards (Term 3).</p>
            </div>
            <button className="panel-close" type="button" onClick={() => setActiveSection("")}>✕ Close</button>
          </div>
          <EndOfTermReports mode="year" />
        </section>
      );
    }
    if (activeSection === "Stream Readiness") {
      const readyCount = streamReadiness.filter((s) => s.status === "READY").length;
      const notReadyCount = streamReadiness.length - readyCount;

      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Stream Readiness Indicator</h2>
              <p>A stream is ready only when all compulsory subjects are assigned.</p>
            </div>
            <button className="panel-close" type="button" onClick={() => setActiveSection("")}>
              ✕ Close
            </button>
          </div>

          {streamReadinessError && <div className="panel-alert panel-alert-error">{streamReadinessError}</div>}

          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
            <div style={{ padding: "0.45rem 0.75rem", borderRadius: "999px", background: "rgba(34,197,94,0.18)", border: "1px solid rgba(34,197,94,0.45)", color: "#bbf7d0", fontSize: "0.78rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Ready: <strong>{readyCount}</strong>
            </div>
            <div style={{ padding: "0.45rem 0.75rem", borderRadius: "999px", background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.45)", color: "#fecaca", fontSize: "0.78rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Not Ready: <strong>{notReadyCount}</strong>
            </div>
            <button type="button" className="ghost-btn" onClick={fetchStreamReadiness} disabled={loadingStreamReadiness}>
              {loadingStreamReadiness ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {loadingStreamReadiness && streamReadiness.length === 0 ? (
            <p className="muted-text">Loading stream readiness…</p>
          ) : streamReadiness.length === 0 ? (
            <p className="muted-text">No stream assignments found.</p>
          ) : (
            <div className="teachers-table-wrapper">
              <table className="teachers-table">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Stream</th>
                    <th>Status</th>
                    <th>Missing Compulsory</th>
                    <th>Optionals ({OPTIONAL_SUBJECTS.length})</th>
                    <th>Unknown Subjects</th>
                  </tr>
                </thead>
                <tbody>
                  {streamReadiness.map((row) => (
                    <tr key={`${row.class}-${row.stream}`}>
                      <td>{row.class}</td>
                      <td>{row.stream}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "0.2rem 0.6rem",
                            borderRadius: "999px",
                            fontSize: "0.72rem",
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            border: row.uiLabel === "green"
                              ? "1px solid rgba(34,197,94,0.5)"
                              : "1px solid rgba(239,68,68,0.5)",
                            background: row.uiLabel === "green"
                              ? "rgba(34,197,94,0.18)"
                              : "rgba(239,68,68,0.18)",
                            color: row.uiLabel === "green" ? "#bbf7d0" : "#fecaca",
                          }}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td>{row.missingCompulsorySubjects.length ? row.missingCompulsorySubjects.join(", ") : "—"}</td>
                      <td>{row.optionalCount} • {row.assignedOptionalSubjects.join(", ") || "—"}</td>
                      <td>{row.unknownSubjects.length ? row.unknownSubjects.join(", ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      );
    }
    if (activeSection === "Audit Log") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Audit Log</h2>
              <p>Most recent activities first. Filter by user, action, entity type and date range.</p>
            </div>
            <button className="panel-close" onClick={() => setActiveSection("")}>
              ✕ Close
            </button>
          </div>

          <AuditLogsPanel />
        </section>
      );
    }
    if (activeSection === "Learner Promotion") {
      if (promotionWindowOpen) {
        return (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Learner Promotion</h2>
                <p>Preview and execute class promotions with full history tracking.</p>
              </div>
              <button className="panel-close" onClick={() => setActiveSection("")}>
                ✕ Close
              </button>
            </div>

            <PromotionPanel />
          </section>
        );
      }

      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Learner Promotion</h2>
              <p>Module is currently archived and inactive for this period.</p>
            </div>
            <button className="panel-close" onClick={() => setActiveSection("")}>
              ✕ Close
            </button>
          </div>
          <div
            className="panel-alert"
            style={{
              background: "rgba(245, 158, 11, 0.12)",
              border: "1px solid rgba(245, 158, 11, 0.45)",
              color: "#fcd34d",
            }}
          >
            Learner Promotion is inactive. It auto-opens on December 5 and auto-locks on January 30.
          </div>
        </section>
      );
    }
    if (activeSection === "Assessment Submission Tracker") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Assessment Submission Tracker</h2>
              <p>Track subject submissions per class and stream for the current term.</p>
            </div>
            <button className="panel-close" onClick={() => setActiveSection("")}>
              ✕ Close
            </button>
          </div>
    
          <AssessmentSubmissionTracker
            marksSets={marksSets}
            refreshMarks={fetchMarksSets}
          />
        </section>
      );
    }
    
    
    

    return <p className="admin-hint">Click a card above to open its detailed view.</p>;
  };

  /* ------------------ main render ------------------ */
  return (
    <div className="admin-root">
      <header className="admin-nav">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-text">SPESS’s ARK</span>
          <span className="brand-tag">Admin</span>
        </div>

        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
  <button
    type="button"
    className="ghost-btn"
    onClick={() => navigate("/ark/admin/alevel")}
  >
    A-Level
  </button>

  <button type="button" className="nav-logout" onClick={handleLogout}>
    Logout
  </button>
</div>

      </header>

      <main className="admin-main">
      <section className="admin-heading">
  <h1>Admin Dashboard</h1>
  <p>
    Quick actions for managing students, teachers and marks. Select a card below
    to open its detailed view.
  </p>

  {/* ================= OVERVIEW CARDS ================= */}
  <div
    style={{
      marginTop: "1.8rem",
      display: "flex",
      flexWrap: "wrap",
      gap: "1rem",
    }}
  >
    {/* TOTAL POPULATION */}
    <div
      style={{
        flex: "1 1 260px",
        padding: "1.4rem 1.6rem",
        borderRadius: "1rem",
        background:
          "linear-gradient(135deg, rgba(56,189,248,0.22), rgba(79,70,229,0.35))",
        border: "1px solid rgba(59,130,246,0.6)",
        boxShadow: "0 18px 40px rgba(15,23,42,0.8)",
      }}
    >
      <div
        style={{
          fontSize: "0.78rem",
          textTransform: "uppercase",
          letterSpacing: "0.18em",
          color: "#bfdbfe",
          marginBottom: "0.4rem",
        }}
      >
        Total O level Population
      </div>
      <div style={{ fontSize: "2.3rem", fontWeight: 700 }}>
        {totalStudents}
      </div>
      <div style={{ marginTop: "0.4rem", fontSize: "0.85rem" }}>
        Boys: <strong>{totalBoys}</strong> • Girls:{" "}
        <strong>{totalGirls}</strong>
      </div>
    </div>

    {/* TEACHERS */}
    <div
      style={{
        flex: "1 1 200px",
        padding: "1.1rem 1.3rem",
        borderRadius: "1rem",
        background:
          "linear-gradient(135deg, rgba(244,114,182,0.22), rgba(236,72,153,0.35))",
        border: "1px solid rgba(244,114,182,0.8)",
      }}
    >
      <div
        style={{
          fontSize: "0.8rem",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "#fce7f3",
          marginBottom: "0.2rem",
        }}
      >
        Teachers Enrolled
      </div>
      <div style={{ fontSize: "2rem", fontWeight: 600 }}>
        {totalTeachers}
      </div>
    </div>
  </div>

  {/* ================= BIGASS BREAKDOWN CARD ================= */}
  <div
    style={{
      marginTop: "1.6rem",
      padding: "1.1rem",
      borderRadius: "1.2rem",
      background:
        "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.95))",
      border: "1px solid rgba(148,163,184,0.35)",
      boxShadow: "0 22px 60px rgba(0,0,0,0.6)",
    }}
  >
    <div
      style={{
        fontSize: "0.85rem",
        textTransform: "uppercase",
        letterSpacing: "0.18em",
        color: "#93c5fd",
        marginBottom: "0.6rem",
      }}
    >
      Enrollment Breakdown by Stream • Class • Gender
    </div>

    {Object.keys(enrollmentByStreamClassGender).length === 0 ? (
      <p className="muted-text">No enrollment data available.</p>
    ) : (
      enrollmentByClassWithOrderedStreams.map(({ cls, streams }) => {
        const north = streams.North || streams.NORTH || { Male: 0, Female: 0, total: 0 };
        const south = streams.South || streams.SOUTH || { Male: 0, Female: 0, total: 0 };
        const classCombinedTotal = (north.total || 0) + (south.total || 0);
        const ordered = [
          { label: "North", stats: north, isSouth: false },
          { label: "South", stats: south, isSouth: true },
        ];

        return (
          <div key={cls} style={{ marginBottom: "0.85rem" }}>
            <h3
              style={{
                marginBottom: "0.4rem",
                color: "#e5e7eb",
                fontSize: "0.98rem",
              }}
            >
              Class {cls}
            </h3>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "0.5rem",
              }}
            >
              {ordered.map(({ label, stats, isSouth }) => (
                <div
                  key={`${cls}-${label}`}
                  style={{
                    padding: "0.7rem 0.8rem",
                    borderRadius: "0.75rem",
                    background: "rgba(15,23,42,0.9)",
                    border: "1px solid rgba(148,163,184,0.25)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                      color: "#9ca3af",
                      marginBottom: "0.18rem",
                    }}
                  >
                    Stream {label}
                  </div>

                  <div style={{ fontSize: "0.82rem", lineHeight: 1.35 }}>
                    👦 Boys: <strong>{stats.Male || 0}</strong>
                    <br />
                    👧 Girls: <strong>{stats.Female || 0}</strong>
                  </div>
                  <div
                    style={{
                      marginTop: "0.25rem",
                      fontSize: "0.8rem",
                      color: "#93c5fd",
                    }}
                  >
                    Total: <strong>{stats.total || 0}</strong>
                  </div>
                  {isSouth && (
                    <div
                      style={{
                        marginTop: "0.2rem",
                        fontSize: "0.8rem",
                        color: "#fcd34d",
                      }}
                    >
                      Total = <strong>{classCombinedTotal}</strong>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })
    )}
  </div>
  <div
    style={{
      marginTop: "1.2rem",
      padding: "1.2rem",
      borderRadius: "1rem",
      background: "rgba(15,23,42,0.88)",
      border: "1px solid rgba(148,163,184,0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "1rem",
    }}
  >
    <div>
      <div
        style={{
          fontSize: "0.85rem",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "#93c5fd",
          marginBottom: "0.25rem",
        }}
      >
        Enrollment Breakdown by Stream • Class • Gender
      </div>
      <div style={{ fontSize: "0.88rem", color: "#cbd5e1" }}>
        Charts are now available in a focused modal view.
      </div>
    </div>
    <button
      type="button"
      className="primary-btn"
      onClick={() => setShowEnrollmentChartsModal(true)}
    >
      View Charts
    </button>
  </div>
</section>


        <section className="admin-grid">
          {cards.map((card) => (
            <article
              key={card.title}
              className={`admin-card ${card.status === "archived" ? "admin-card-archived" : ""}`}
            >
              <div className="card-icon">{card.icon}</div>
              <div className="card-body">
                <h2>{card.title}</h2>
                <p>{card.subtitle}</p>
                {card.status === "archived" && (
                  <p className="card-status-tag">{card.inactiveMessage || "Archived"}</p>
                )}
              </div>
              <div className="card-footer">
                <button
                  className="card-button"
                  type="button"
                  onClick={() => handleCardClick(card)}
                  disabled={card.status === "archived"}
                >
                  {card.status === "archived" ? "Inactive" : "Open"}
                </button>
              </div>
            </article>
          ))}
        </section>

        <section className="admin-section">{renderSectionContent()}</section>
      </main>

      {/* single modal instance */}
      {editingStudent && (
        <EditStudentModal
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSaved={(updatedStudent) => {
            setStudents((prev) => prev.map((s) => (s.id === updatedStudent.id ? updatedStudent : s)));
            setEditingStudent(null);
          }}
        />
      )}

      {showEnrollmentChartsModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,0.72)",
            backdropFilter: "blur(3px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.2rem",
          }}
          onClick={() => setShowEnrollmentChartsModal(false)}
        >
          <div
            style={{
              width: "min(1200px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              borderRadius: "1rem",
              background: "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.98))",
              border: "1px solid rgba(148,163,184,0.35)",
              boxShadow: "0 28px 70px rgba(2,6,23,0.75)",
              padding: "1.2rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.8rem",
              }}
            >
              <h3 style={{ margin: 0, color: "#e5e7eb" }}>
                Enrollment Breakdown by Stream • Class • Gender
              </h3>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" className="ghost-btn" onClick={handleDownloadEnrollmentSummaryPdf}>
                  PDF
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setShowEnrollmentChartsModal(false)}
                >
                  Close
                </button>
              </div>
            </div>

            <EnrollmentCharts enrollmentData={enrollmentByStreamClassGender} />
          </div>
        </div>
      )}

      {showStudentSaveConfirm && pendingStudentSave && (
        <div className="modal-backdrop" onClick={() => !savingStudent && setShowStudentSaveConfirm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Confirm Learner Save</h2>
            <div style={{ display: "grid", gap: "0.45rem", marginTop: "0.6rem" }}>
              <div><strong>Name:</strong> {pendingStudentSave.name}</div>
              <div><strong>Date of Birth:</strong> {pendingStudentSave.dob}</div>
              <div><strong>Class:</strong> {pendingStudentSave.class_level}</div>
              <div><strong>Stream:</strong> {pendingStudentSave.stream}</div>
              <div>
                <strong>Subjects:</strong>{" "}
                {Array.isArray(pendingStudentSave.subjects) ? pendingStudentSave.subjects.join(", ") : "—"}
              </div>
            </div>
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.6rem" }}>
              <button
                className="primary-btn"
                type="button"
                disabled={savingStudent}
                onClick={() => performAddStudent(pendingStudentSave)}
              >
                {savingStudent ? "Saving…" : "Confirm Save"}
              </button>
              <button
                className="ghost-btn"
                type="button"
                disabled={savingStudent}
                onClick={() => setShowStudentSaveConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
