// src/pages/AdminDashboard.jsx
import React, { useEffect, useState, useMemo, useRef } from "react";
import "./AdminDashboard.css";
import AssignSubjectsPanel from "../components/AssignSubjectsPanel";
import { plainFetch, adminFetch } from "../lib/api";
import EditStudentModal from "../components/EditStudentModal";
import EndOfTermReports from "./EndOfTermReports";
import MiniProgressReports from "./MiniProgressReports";
import { useNavigate } from "react-router-dom";
import useIdleLogout from "../hooks/useIdleLogout";
import EnrollmentInsightsPanel from "../components/EnrollmentInsightsPanel";
import EnrollmentCharts from "../components/EnrollmentCharts";
import AssessmentSubmissionTracker from "../components/AssessmentSubmissionTracker";
import AuditLogsPanel from "../components/AuditLogsPanel";
import PromotionPanel from "../components/PromotionPanel";
import { loadPdfTools } from "../utils/loadPdfTools";
import {
  DEFAULT_SCHOOL_CALENDAR,
  getSchoolCalendarBadge,
  getSchoolCalendarPreciseCountdown,
  getSchoolCalendarTimelineEntries,
  normalizeSchoolCalendar,
} from "../utils/schoolCalendar";
import {
  clearAdminReauthToken,
  clearAdminSession,
  storeAdminReauthToken,
} from "../utils/adminSecurity";

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
const MARKS_LOCK_GROUPS = {
  "O-Level": ["AOI1", "AOI2", "AOI3", "EXAM80"],
  "A-Level": ["MID", "EOT"],
};
const MARKS_LOCK_LEVELS = Object.keys(MARKS_LOCK_GROUPS);
const O_LEVEL_AOI_OPTIONS = [
  { value: "AOI1", label: "AOI 1" },
  { value: "AOI2", label: "AOI 2" },
  { value: "AOI3", label: "AOI 3" },
];

const formatMarksLockComponentLabel = (component) => {
  const raw = String(component || "").trim().toUpperCase();
  if (raw === "AOI1") return "AOI 1";
  if (raw === "AOI2") return "AOI 2";
  if (raw === "AOI3") return "AOI 3";
  if (raw === "EXAM80") return "/80";
  return raw || "—";
};

const getMarksLockRowKey = (levelName, aoiLabel) =>
  `${String(levelName || "").trim()}__${String(aoiLabel || "").trim().toUpperCase()}`;

const formatDateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
};

const formatDateOnly = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const normalizeOperationalTerm = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (/\b(term\s*3|iii|3)\b/.test(raw)) return "Term 3";
  if (/\b(term\s*2|ii|2)\b/.test(raw)) return "Term 2";
  if (/\b(term\s*1|i|1)\b/.test(raw)) return "Term 1";
  return "Term 1";
};

const toPercent = (value, total) => {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(value || 0) / Number(total || 0)) * 100)));
};

const createEmptyMarksLockForm = (term = "Term 1", year = new Date().getFullYear()) => ({
  term,
  year,
  locks: MARKS_LOCK_LEVELS.flatMap((levelName) =>
    MARKS_LOCK_GROUPS[levelName].map((aoi) => ({
      level_name: levelName,
      aoi_label: aoi,
      deadline_at: "",
      is_locked: false,
      effective_locked: false,
      lock_reason: "Open",
    }))
  ),
});

const buildMarksLockRows = (rows = []) =>
  MARKS_LOCK_LEVELS.flatMap((levelName) =>
    MARKS_LOCK_GROUPS[levelName].map((aoi) => {
      const matched = rows.find(
        (row) => getMarksLockRowKey(row.level_name || "O-Level", row.aoi_label) === getMarksLockRowKey(levelName, aoi)
      );
      return {
        level_name: levelName,
        aoi_label: aoi,
        deadline_at: matched?.deadline_at || "",
        is_locked: Boolean(matched?.is_locked),
        effective_locked: Boolean(matched?.effective_locked),
        lock_reason: matched?.lock_reason || "Open",
      };
    })
  );

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
    const missingOptionalSubjects = OPTIONAL_SUBJECTS.filter(
      (s) => !subjectKeys.has(s.toLowerCase())
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
      missingOptionalSubjects,
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
  const ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

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
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Unauthorized");
        }
        return res.json();
      })
      .then((body) => {
        if (body?.username) {
          localStorage.setItem("adminUsername", body.username);
          setAdminIdentity({ username: body.username });
        }
      })
      .catch(() => {
        // Token is invalid or expired
        clearAdminSession();
        navigate("/", { replace: true });
      });
  }, [navigate]);
  
  useIdleLogout(() => {
    clearAdminSession();
    navigate("/", { replace: true });
  }, ADMIN_IDLE_TIMEOUT_MS);

  const handleLogout = () => {
    clearAdminSession();
    navigate("/ark", { replace: true });
  };

  const requestAdminReauth = ({ title, description, onApproved }) => {
    clearAdminReauthToken();
    reauthActionRef.current = typeof onApproved === "function" ? onApproved : null;
    setReauthPassword("");
    setReauthError("");
    setReauthPrompt({
      title: title || "Confirm Admin Password",
      description:
        description ||
        "Please confirm your admin password before continuing with this sensitive action.",
    });
    return Promise.resolve();
  };

  const closeReauthPrompt = () => {
    if (reauthLoading) return;
    reauthActionRef.current = null;
    setReauthPrompt(null);
    setReauthPassword("");
    setReauthError("");
  };

  const handleConfirmReauth = async () => {
    if (!reauthPassword.trim()) {
      setReauthError("Enter your admin password to continue.");
      return;
    }

    setReauthLoading(true);
    setReauthError("");

    try {
      const result = await adminFetch("/api/admin/reauth", {
        method: "POST",
        body: { password: reauthPassword },
      });

      storeAdminReauthToken(result?.token, result?.expiresAt);
      const pendingAction = reauthActionRef.current;
      reauthActionRef.current = null;
      setReauthPrompt(null);
      setReauthPassword("");

      if (pendingAction) {
        await pendingAction();
      }
      clearAdminReauthToken();
    } catch (err) {
      setReauthError(err.message || "Admin confirmation failed.");
    } finally {
      setReauthLoading(false);
    }
  };

  const openAdminSettings = (mode = "password") => {
    setAdminSettingsMode(mode);
    setAdminSettingsForm({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setAdminSettingsError("");
    setAdminSettingsNotice("");
    setAdminSettingsOpen(true);
  };

  const closeAdminSettings = () => {
    if (savingAdminSettings) return;
    setAdminSettingsOpen(false);
    setAdminSettingsError("");
    setAdminSettingsNotice("");
    setAdminSettingsForm({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
  };

  const handleChangeAdminPassword = async () => {
    const currentPassword = adminSettingsForm.currentPassword.trim();
    const newPassword = adminSettingsForm.newPassword.trim();
    const confirmPassword = adminSettingsForm.confirmPassword.trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      setAdminSettingsError("Fill in all password fields.");
      return;
    }

    if (newPassword.length < 8) {
      setAdminSettingsError("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setAdminSettingsError("New password and confirmation do not match.");
      return;
    }

    setSavingAdminSettings(true);
    setAdminSettingsError("");
    setAdminSettingsNotice("");

    try {
      await adminFetch("/api/admin/change-password", {
        method: "POST",
        body: {
          currentPassword,
          newPassword,
        },
      });

      sessionStorage.removeItem(ADMIN_REAUTH_STORAGE_KEY);
      sessionStorage.removeItem(ADMIN_REAUTH_EXPIRY_KEY);
      setAdminSettingsNotice("Admin password updated successfully.");
      setAdminSettingsForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (err) {
      setAdminSettingsError(err.message || "Failed to update admin password.");
    } finally {
      setSavingAdminSettings(false);
    }
  };
  

  useEffect(() => {
    document.title = "Admin Dashboard | SPESS ARK";
  }, []);

  /* -------------------- UI state -------------------- */
  const [activeSection, setActiveSection] = useState("");
  const [showEnrollmentChartsModal, setShowEnrollmentChartsModal] = useState(false);
  const [dashboardClock, setDashboardClock] = useState(() => new Date());
  const [adminSettingsOpen, setAdminSettingsOpen] = useState(false);
  const [adminSettingsMode, setAdminSettingsMode] = useState("password");
  const [adminSettingsForm, setAdminSettingsForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [adminSettingsError, setAdminSettingsError] = useState("");
  const [adminSettingsNotice, setAdminSettingsNotice] = useState("");
  const [savingAdminSettings, setSavingAdminSettings] = useState(false);
  const [adminIdentity, setAdminIdentity] = useState(() => ({
    username: localStorage.getItem("adminUsername") || "admin",
  }));
  const [reauthPrompt, setReauthPrompt] = useState(null);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthError, setReauthError] = useState("");
  const [reauthLoading, setReauthLoading] = useState(false);
  const reauthActionRef = useRef(null);
  const [schoolCalendarPreviewClock, setSchoolCalendarPreviewClock] = useState(() => new Date());
  const [schoolCalendarForm, setSchoolCalendarForm] = useState(() =>
    normalizeSchoolCalendar(DEFAULT_SCHOOL_CALENDAR)
  );
  const [schoolCalendarLoading, setSchoolCalendarLoading] = useState(false);
  const [schoolCalendarSaving, setSchoolCalendarSaving] = useState(false);
  const [schoolCalendarError, setSchoolCalendarError] = useState("");
  const [schoolCalendarNotice, setSchoolCalendarNotice] = useState("");
  const [oLevelAssignmentsOverview, setOLevelAssignmentsOverview] = useState([]);
  const [aLevelAssignmentsOverview, setALevelAssignmentsOverview] = useState([]);
  const [aLevelMarksSets, setALevelMarksSets] = useState([]);
  const [overviewMarksLocks, setOverviewMarksLocks] = useState([]);
  const [reportReadinessSummary, setReportReadinessSummary] = useState(null);
  const [reportReadinessError, setReportReadinessError] = useState("");
  const [readinessPdfLoadingLevel, setReadinessPdfLoadingLevel] = useState("");
  const [assessmentComplianceAoi, setAssessmentComplianceAoi] = useState("AOI1");
  const [marksLockForm, setMarksLockForm] = useState(() => createEmptyMarksLockForm());
  const [marksLockLoading, setMarksLockLoading] = useState(false);
  const [marksLockSaving, setMarksLockSaving] = useState(false);
  const [marksLockError, setMarksLockError] = useState("");
  const [marksLockNotice, setMarksLockNotice] = useState("");

  useEffect(() => {
    document.title = activeSection ? `${activeSection} | SPESS ARK` : "Admin Dashboard | SPESS ARK";
  }, [activeSection]);
  useEffect(() => {
    const timerId = window.setInterval(() => setDashboardClock(new Date()), 60_000);
    return () => window.clearInterval(timerId);
  }, []);
  useEffect(() => {
    if (activeSection !== "School Calendar") return undefined;

    setSchoolCalendarPreviewClock(new Date());
    const timerId = window.setInterval(() => setSchoolCalendarPreviewClock(new Date()), 1000);
    return () => window.clearInterval(timerId);
  }, [activeSection]);

  const promotionWindowOpen = useMemo(
    () => isPromotionWindowOpen(dashboardClock),
    [dashboardClock]
  );
  const schoolCalendarBadge = useMemo(
    () => getSchoolCalendarBadge(schoolCalendarForm, schoolCalendarPreviewClock),
    [schoolCalendarForm, schoolCalendarPreviewClock]
  );
  const schoolCalendarPreciseCountdown = useMemo(
    () => getSchoolCalendarPreciseCountdown(schoolCalendarForm, schoolCalendarPreviewClock),
    [schoolCalendarForm, schoolCalendarPreviewClock]
  );
  const schoolCalendarTimelineEntries = useMemo(
    () => getSchoolCalendarTimelineEntries(schoolCalendarForm, schoolCalendarPreviewClock),
    [schoolCalendarForm, schoolCalendarPreviewClock]
  );
  const dashboardOperationalTerm = useMemo(
    () => normalizeOperationalTerm(schoolCalendarBadge.termLabel || marksLockForm.term),
    [schoolCalendarBadge.termLabel, marksLockForm.term]
  );
  const dashboardOperationalYear = useMemo(() => {
    const parsed = Number(schoolCalendarForm.academicYear);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : new Date().getFullYear();
  }, [schoolCalendarForm.academicYear]);
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
  const [pendingNoticeDelete, setPendingNoticeDelete] = useState(null);
  const [deletingNoticeId, setDeletingNoticeId] = useState(null);
  const [noticeFeedback, setNoticeFeedback] = useState(null);

  /* ---------- Teachers ---------- */
  const [teachers, setTeachers] = useState([]);
  const [teacherForm, setTeacherForm] = useState({ name: "", email: "", subject1: "", subject2: "" });
  const [teacherError, setTeacherError] = useState("");
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [savingTeacher, setSavingTeacher] = useState(false);
  const [deletingTeacherId, setDeletingTeacherId] = useState(null);
  const [pendingTeacherDelete, setPendingTeacherDelete] = useState(null);

  /* ---------- Students ---------- */
  const [students, setStudents] = useState([]);
  const [aLevelLearners, setALevelLearners] = useState([]);
  const [studentForm, setStudentForm] = useState({ name: "", gender: "", dob: "", class_level: "", stream: "" });
  const [selectedOptionals, setSelectedOptionals] = useState([]);
  const [studentError, setStudentError] = useState("");
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [savingStudent, setSavingStudent] = useState(false);
  const [deletingStudentId, setDeletingStudentId] = useState(null);
  const [pendingStudentDelete, setPendingStudentDelete] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);
  const savingStudentRef = useRef(false);
  const detailSectionRef = useRef(null);
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
  const [marksArchiveSets, setMarksArchiveSets] = useState([]);
  const [loadingMarksArchive, setLoadingMarksArchive] = useState(false);
  const [marksArchiveError, setMarksArchiveError] = useState("");
  const [marksArchiveNotice, setMarksArchiveNotice] = useState("");
  const [restoringArchiveKey, setRestoringArchiveKey] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedAoi, setSelectedAoi] = useState(null);
  const [pendingAoiDelete, setPendingAoiDelete] = useState(null);
  const [deletingAoiKey, setDeletingAoiKey] = useState("");
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
    { title: "Mini Reports", subtitle: "AOI 1 parent progress slips", icon: "🧾" },
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
    { title: "School Calendar", subtitle: "Manage terms and holiday dates", icon: "🗓️" },
    { title: "Marks Entry Lock", subtitle: "Lock AOIs, /80, MID and EOT after deadline", icon: "🔒" },
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

  const fetchSchoolCalendar = async () => {
    setSchoolCalendarLoading(true);
    setSchoolCalendarError("");
    setSchoolCalendarNotice("");
    try {
      const data = await adminFetch("/api/admin/school-calendar");
      setSchoolCalendarForm(normalizeSchoolCalendar(data));
    } catch (err) {
      console.error("Error loading school calendar:", err);
      setSchoolCalendarForm(normalizeSchoolCalendar(DEFAULT_SCHOOL_CALENDAR));
      setSchoolCalendarError(err.message || "Could not load school calendar.");
    } finally {
      setSchoolCalendarLoading(false);
    }
  };

  const fetchMarksEntryLocks = async (
    term = marksLockForm.term || "Term 1",
    year = Number(marksLockForm.year) || new Date().getFullYear()
  ) => {
    setMarksLockLoading(true);
    setMarksLockError("");
    setMarksLockNotice("");
    try {
      const data = await adminFetch(
        `/api/admin/marks-entry-locks?term=${encodeURIComponent(term)}&year=${encodeURIComponent(year)}`
      );
      const rows = Array.isArray(data?.locks) ? data.locks : [];
      setMarksLockForm({
        term,
        year,
        locks: buildMarksLockRows(rows),
      });
    } catch (err) {
      console.error("Error loading marks entry locks:", err);
      setMarksLockForm(createEmptyMarksLockForm(term, year));
      setMarksLockError(err.message || "Could not load marks entry locks.");
    } finally {
      setMarksLockLoading(false);
    }
  };

  const fetchOverviewMarksEntryLocks = async (
    term = dashboardOperationalTerm,
    year = dashboardOperationalYear
  ) => {
    try {
      const data = await adminFetch(
        `/api/admin/marks-entry-locks?term=${encodeURIComponent(term)}&year=${encodeURIComponent(year)}`
      );
      setOverviewMarksLocks(buildMarksLockRows(Array.isArray(data?.locks) ? data.locks : []));
    } catch (err) {
      console.error("Error loading overview marks entry locks:", err);
      setOverviewMarksLocks(buildMarksLockRows([]));
    }
  };

  const fetchOLevelAssignmentsOverview = async () => {
    try {
      const data = await adminFetch("/api/admin/assignments");
      setOLevelAssignmentsOverview(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error loading O-Level assignments overview:", err);
      setOLevelAssignmentsOverview([]);
    }
  };

  const fetchALevelAssignmentsOverview = async () => {
    try {
      const data = await adminFetch("/api/alevel/admin/assignments");
      setALevelAssignmentsOverview(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error loading A-Level assignments overview:", err);
      setALevelAssignmentsOverview([]);
    }
  };

  const fetchALevelMarksSets = async () => {
    try {
      const data = await adminFetch("/api/alevel/admin/marks-sets");
      setALevelMarksSets(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error loading A-Level marks sets:", err);
      setALevelMarksSets([]);
    }
  };

  const fetchReportReadinessSummary = async (
    term = dashboardOperationalTerm,
    year = dashboardOperationalYear
  ) => {
    try {
      setReportReadinessError("");
      const params = new URLSearchParams({
        term,
        year: String(year),
      });
      const data = await adminFetch(`/api/admin/reports/readiness-summary?${params.toString()}`);
      setReportReadinessSummary(data || null);
    } catch (err) {
      console.error("Error loading report readiness summary:", err);
      setReportReadinessError(err.message || "Could not load report readiness.");
      setReportReadinessSummary(null);
    }
  };

  const handleDownloadReadinessDetailsPdf = async (levelName) => {
    const normalizedLevel = levelName === "aLevel" ? "aLevel" : "oLevel";
    setReadinessPdfLoadingLevel(normalizedLevel);
    setReportReadinessError("");

    try {
      const params = new URLSearchParams({
        level: normalizedLevel,
        term: reportReadinessCard.term || dashboardOperationalTerm,
        year: String(reportReadinessCard.year || dashboardOperationalYear),
      });

      const data = await adminFetch(`/api/admin/reports/readiness-incomplete-details?${params.toString()}`);
      const rows = Array.isArray(data?.rows) ? data.rows : [];

      if (rows.length === 0) {
        setReportReadinessError(`No incomplete ${normalizedLevel === "aLevel" ? "A-Level" : "O-Level"} learners found for ${reportReadinessCard.term}.`);
        return;
      }

      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF("l", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const generatedAt = new Date().toLocaleString();
      const levelLabel = normalizedLevel === "aLevel" ? "A-Level" : "O-Level";
      const flattenedRows = [];

      rows.forEach((learner) => {
        const learnerMeta = normalizedLevel === "aLevel"
          ? `${learner.classLevel || "A-Level"} • ${learner.stream || "—"}${learner.combination && learner.combination !== "—" ? ` • ${learner.combination}` : ""}`
          : `${learner.classLevel || "—"} • ${learner.stream || "—"}`;

        (learner.missingItems || []).forEach((item, index) => {
          flattenedRows.push([
            String(flattenedRows.length + 1),
            index === 0 ? learner.learnerName || "—" : "",
            index === 0 ? learnerMeta : "",
            item.itemLabel || "—",
            item.teacherName || "—",
            item.missingComponents || "—",
            item.reason || "—",
          ]);
        });
      });

      const drawHeader = () => {
        doc.setFillColor(245, 247, 250);
        doc.rect(10, 8, pageWidth - 20, 24, "F");
        doc.setDrawColor(180, 188, 200);
        doc.rect(10, 8, pageWidth - 20, 24, "S");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.setTextColor(23, 37, 84);
        doc.text("SPESS ARK • Report Readiness Gaps", pageWidth / 2, 17, { align: "center" });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(51, 65, 85);
        doc.text(
          `${levelLabel} incomplete learners • ${data.term} ${data.year} • Ready means at least one submitted score this term`,
          pageWidth / 2,
          24,
          { align: "center" }
        );

        doc.setFontSize(9);
        doc.text(`Generated: ${generatedAt}`, 12, 38);
        doc.text(`Incomplete learners: ${rows.length}`, pageWidth - 12, 38, { align: "right" });
        doc.setDrawColor(203, 213, 225);
        doc.line(10, 42, pageWidth - 10, 42);
      };

      const drawFooter = () => {
        doc.setDrawColor(203, 213, 225);
        doc.line(10, pageHeight - 12, pageWidth - 10, pageHeight - 12);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(71, 85, 105);
        doc.text(`Generated from SPESS ARK • ${generatedAt}`, pageWidth / 2, pageHeight - 7, { align: "center" });
      };

      drawHeader();

      autoTable(doc, {
        startY: 46,
        margin: { left: 10, right: 10, top: 46, bottom: 16 },
        head: [["No.", "Learner", "Class / Stream", "Subject / Paper", "Teacher", "Missing Scores", "Why Unready"]],
        body: flattenedRows,
        styles: {
          font: "helvetica",
          fontSize: 8.5,
          cellPadding: { top: 2.4, right: 2.1, bottom: 2.4, left: 2.1 },
          textColor: [30, 41, 59],
          lineColor: [203, 213, 225],
          lineWidth: 0.18,
          valign: "top",
        },
        headStyles: {
          fillColor: [226, 232, 240],
          textColor: [15, 23, 42],
          fontStyle: "bold",
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0: { cellWidth: 10, halign: "center" },
          1: { cellWidth: 34 },
          2: { cellWidth: 36 },
          3: { cellWidth: 44 },
          4: { cellWidth: 35 },
          5: { cellWidth: 30 },
          6: { cellWidth: 82 },
        },
        theme: "grid",
        willDrawPage: drawHeader,
        didDrawPage: drawFooter,
      });

      window.open(doc.output("bloburl"), "_blank");
    } catch (err) {
      console.error("Error generating readiness details PDF:", err);
      setReportReadinessError(err.message || "Failed to generate readiness details PDF.");
    } finally {
      setReadinessPdfLoadingLevel("");
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
    const payload = {
      title: noticeForm.title.trim(),
      body: noticeForm.body.trim(),
    };
    setLoadingNotices(true);
    setNoticesError("");
    try {
      await adminFetch("/api/admin/notices", { method: "POST", body: payload });
      setNoticeForm({ title: "", body: "" });
      await fetchNotices();
      setNoticeFeedback({
        mode: "published",
        title: payload.title,
        body: payload.body,
      });
    } catch (err) {
      setNoticesError(err.message || "Failed to create notice.");
    } finally {
      setLoadingNotices(false);
    }
  };

  const handleDeleteNotice = async (notice) => {
    if (!notice?.id) return;
    setDeletingNoticeId(notice.id);
    setNoticesError("");
    try {
      await adminFetch(`/api/admin/notices/${notice.id}`, { method: "DELETE" });
      setNotices((p) => p.filter((n) => n.id !== notice.id));
      setPendingNoticeDelete(null);
      setNoticeFeedback({
        mode: "deleted",
        title: notice.title,
        body: notice.body,
      });
    } catch (err) {
      setNoticesError(err.message || "Failed to delete notice.");
    } finally {
      setDeletingNoticeId(null);
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
    setDeletingTeacherId(id);
    setTeacherError("");
    try {
      await adminFetch(`/api/admin/teachers/${id}`, { method: "DELETE" });
      setTeachers((prev) => prev.filter((t) => t.id !== id));
      setPendingTeacherDelete(null);
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

  const buildEnrollmentByStreamClassGenderMap = (studentList = []) => {
    const result = {};

    studentList.forEach((s) => {
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
  };

  const handleDownloadEnrollmentSummaryPdf = async () => {
    let latestStudents = students;
    let latestALevelLearners = aLevelLearners;

    try {
      const [studentsData, aLevelData] = await Promise.all([
        plainFetch("/api/students"),
        plainFetch("/api/alevel/learners"),
      ]);

      if (Array.isArray(studentsData)) latestStudents = studentsData;
      if (Array.isArray(aLevelData)) latestALevelLearners = aLevelData;
    } catch (err) {
      console.error("Error refreshing enrollment summary snapshot:", err);
    }

    const { jsPDF, autoTable } = await loadPdfTools();
    const doc = new jsPDF("p", "mm", "a4");
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const generatedAt = new Date().toLocaleString();
    const latestEnrollmentByStreamClassGender = buildEnrollmentByStreamClassGenderMap(latestStudents);
    const marginX = 12;
    const contentWidth = pageW - marginX * 2;
    const bottomMargin = 16;

    const classOrder = ["S1", "S2", "S3", "S4"];
    const streams = Object.keys(latestEnrollmentByStreamClassGender || {});
    const sortedStreams = [...streams].sort((a, b) => {
      const aa = String(a).toLowerCase();
      const bb = String(b).toLowerCase();
      const score = (v) => (v === "north" ? 0 : v === "south" ? 1 : 2);
      const diff = score(aa) - score(bb);
      return diff !== 0 ? diff : String(a).localeCompare(String(b));
    });

    let y = 16;

    const drawDocumentHeader = () => {
      doc.setDrawColor(0);
      doc.setLineWidth(0.45);
      doc.line(marginX, y, pageW - marginX, y);
      y += 6;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("ST PHILLIPS EQUATORIAL SECONDARY SCHOOL", pageW / 2, y, { align: "center" });
      y += 5.5;

      doc.setFontSize(16);
      doc.text("SPESS ARK", pageW / 2, y, { align: "center" });
      y += 5.5;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text("Enrollment Summary by Stream and Class (S1-S6)", pageW / 2, y, { align: "center" });
      y += 4.5;

      doc.setFontSize(8.5);
      doc.text(`Generated: ${generatedAt}`, pageW / 2, y, { align: "center" });
      y += 4.5;

      doc.setLineWidth(0.25);
      doc.line(marginX, y, pageW - marginX, y);
      y += 7;
    };

    const drawContinuationHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Enrollment Summary by Stream and Class (S1-S6)", marginX, 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Generated: ${generatedAt}`, pageW - marginX, 14, { align: "right" });
      doc.setDrawColor(0);
      doc.setLineWidth(0.2);
      doc.line(marginX, 17, pageW - marginX, 17);
      y = 23;
    };

    const ensureSpace = (needed = 20) => {
      if (y + needed <= pageH - bottomMargin) return;
      doc.addPage();
      drawContinuationHeader();
    };

    const drawSectionBand = (title, subtitle = "") => {
      ensureSpace(subtitle ? 48 : 42);
      const bandHeight = subtitle ? 13 : 9;
      doc.setFillColor(244, 244, 244);
      doc.setDrawColor(0);
      doc.setLineWidth(0.25);
      doc.roundedRect(marginX, y, contentWidth, bandHeight, 1.6, 1.6, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(title, marginX + 4, y + 5.2);
      if (subtitle) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.2);
        doc.text(subtitle, marginX + 4, y + 10);
      }
      y += bandHeight + 4;
    };

    const renderSummaryTable = ({ title, subtitle, rows, totalLabel }) => {
      const totals = rows.reduce(
        (acc, row) => ({
          boys: acc.boys + Number(row.boys || 0),
          girls: acc.girls + Number(row.girls || 0),
          total: acc.total + Number(row.total || 0),
        }),
        { boys: 0, girls: 0, total: 0 }
      );

      drawSectionBand(title, subtitle);

      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        tableWidth: contentWidth,
        theme: "grid",
        head: [["Class", "Boys", "Girls", "Total"]],
        body: rows.map((row) => [row.label, String(row.boys), String(row.girls), String(row.total)]),
        foot: [[totalLabel, String(totals.boys), String(totals.girls), String(totals.total)]],
        styles: {
          font: "helvetica",
          fontSize: 9,
          textColor: [0, 0, 0],
          lineColor: [0, 0, 0],
          lineWidth: 0.22,
          cellPadding: { top: 2.2, right: 2.6, bottom: 2.2, left: 2.6 },
          valign: "middle",
        },
        headStyles: {
          fillColor: [236, 236, 236],
          textColor: [0, 0, 0],
          fontStyle: "bold",
          halign: "center",
          lineColor: [0, 0, 0],
          lineWidth: 0.25,
        },
        bodyStyles: {
          fillColor: [255, 255, 255],
        },
        alternateRowStyles: {
          fillColor: [250, 250, 250],
        },
        footStyles: {
          fillColor: [242, 242, 242],
          textColor: [0, 0, 0],
          fontStyle: "bold",
          lineColor: [0, 0, 0],
          lineWidth: 0.25,
        },
        columnStyles: {
          0: { cellWidth: 78, halign: "left" },
          1: { cellWidth: 36, halign: "center" },
          2: { cellWidth: 36, halign: "center" },
          3: { cellWidth: 36, halign: "center" },
        },
      });

      y = doc.lastAutoTable.finalY + 6;
      return totals;
    };

    drawDocumentHeader();

    let grandBoys = 0;
    let grandGirls = 0;
    let grandTotal = 0;

    if (sortedStreams.length === 0) {
      doc.setFontSize(10);
      doc.text("No enrollment data available.", marginX, y);
    } else {
      drawSectionBand("O-Level Summary", "Current enrollment by stream for S1 to S4.");
      sortedStreams.forEach((stream) => {
        const clsMap = latestEnrollmentByStreamClassGender[stream] || {};
        const rows = classOrder.map((cls) => {
          const row = clsMap[cls] || { Male: 0, Female: 0, total: 0 };
          return {
            label: cls,
            boys: Number(row.Male || 0),
            girls: Number(row.Female || 0),
            total: Number(row.total || 0),
          };
        });

        const totals = renderSummaryTable({
          title: `${stream} Stream`,
          subtitle: "Class-by-class boys, girls and total enrollment.",
          rows,
          totalLabel: "Stream Total",
        });

        grandBoys += totals.boys;
        grandGirls += totals.girls;
        grandTotal += totals.total;
      });
    }

    // A-Level summary appears in PDF only (not dashboard charts/cards)
    const alevelByStreamClass = {};
    (latestALevelLearners || []).forEach((l) => {
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
      drawSectionBand("A-Level Summary", "Senior section totals for S5 and S6.");

      alevelStreams.forEach((stream) => {
        const clsMap = alevelByStreamClass[stream] || {};
        const rows = ["S5", "S6"].map((cls) => {
          const row = clsMap[cls] || { Male: 0, Female: 0, total: 0 };
          return {
            label: cls,
            boys: Number(row.Male || 0),
            girls: Number(row.Female || 0),
            total: Number(row.total || 0),
          };
        });

        const totals = renderSummaryTable({
          title: `${stream} Stream`,
          subtitle: "Senior stream enrollment across both classes.",
          rows,
          totalLabel: "A-Level Stream Total",
        });

        grandBoys += totals.boys;
        grandGirls += totals.girls;
        grandTotal += totals.total;
      });
    }

    // Class-level gender summary (all streams combined)
    const classSummaryOrder = ["S1", "S2", "S3", "S4", "S5", "S6"];
    const classSummary = {};
    classSummaryOrder.forEach((c) => {
      classSummary[c] = { boys: 0, girls: 0, total: 0 };
    });

    (latestStudents || []).forEach((s) => {
      const cls = String(s.class_level || "").toUpperCase();
      if (!classSummary[cls]) return;
      const g = String(s.gender || "").toLowerCase();
      if (g === "male") classSummary[cls].boys += 1;
      else if (g === "female") classSummary[cls].girls += 1;
      classSummary[cls].total += 1;
    });

    (latestALevelLearners || []).forEach((l) => {
      const [clsToken] = String(l.stream || "").trim().split(" ");
      const cls = String(clsToken || "").toUpperCase();
      if (!classSummary[cls]) return;
      const g = String(l.gender || "").toLowerCase();
      if (g === "male") classSummary[cls].boys += 1;
      else if (g === "female") classSummary[cls].girls += 1;
      classSummary[cls].total += 1;
    });

    const classSummaryRows = classSummaryOrder.map((cls) => ({
      label: cls,
      boys: Number(classSummary[cls]?.boys || 0),
      girls: Number(classSummary[cls]?.girls || 0),
      total: Number(classSummary[cls]?.total || 0),
    }));

    renderSummaryTable({
      title: "Class Summary",
      subtitle: "Combined totals for each class across all streams.",
      rows: classSummaryRows,
      totalLabel: "Class Summary Total",
    });

    ensureSpace(22);
    doc.setFillColor(241, 241, 241);
    doc.setDrawColor(0);
    doc.setLineWidth(0.25);
    doc.roundedRect(marginX, y, contentWidth, 14, 1.8, 1.8, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Grand Total (All Streams)", marginX + 4, y + 5.4);
    doc.text(String(grandBoys), marginX + 114, y + 5.4, { align: "center" });
    doc.text(String(grandGirls), marginX + 150, y + 5.4, { align: "center" });
    doc.text(String(grandTotal), pageW - marginX - 18, y + 5.4, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Boys", marginX + 114, y + 10, { align: "center" });
    doc.text("Girls", marginX + 150, y + 10, { align: "center" });
    doc.text("Total", pageW - marginX - 18, y + 10, { align: "center" });

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

  const handleDeleteStudent = async (student) => {
    if (!student?.id) return;
    setDeletingStudentId(student.id);
    setStudentError("");
    try {
      await adminFetch(`/api/admin/students/${student.id}`, { method: "DELETE" });
      setStudents((prev) => prev.filter((s) => s.id !== student.id));
      setPendingStudentDelete(null);
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

  const getMarksArchiveSetKey = (row) =>
    [
      row?.level_name || "O-Level",
      row?.assignment_id || "0",
      row?.term || "",
      row?.year ?? "",
      row?.component_key || "",
      row?.deleted_at_key || "",
    ].join("__");
  const getAoiDeleteKey = (row) =>
    [
      row?.assignment_id || "0",
      row?.term || "",
      row?.year ?? "",
      row?.aoi_label || "",
    ].join("__");

  const fetchMarksArchiveSets = async () => {
    setLoadingMarksArchive(true);
    setMarksArchiveError("");
    try {
      const data = await adminFetch("/api/admin/marks-archive?limit=40");
      setMarksArchiveSets(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err) {
      console.error("Error loading deleted marks archive:", err);
      setMarksArchiveError(err.message || "Could not load deleted marks archive.");
      setMarksArchiveSets([]);
    } finally {
      setLoadingMarksArchive(false);
    }
  };

  const handleRestoreArchiveSet = async (row) => {
    if (!row) return;
    const archiveKey = getMarksArchiveSetKey(row);
    const contextLabel =
      row.level_name === "A-Level"
        ? `${row.subject || "Subject"} • ${row.stream || "Stream"}`
        : `${row.subject || "Subject"} • ${row.class_level || "Class"} ${row.stream || "Stream"}`;

    const confirmed = window.confirm(
      `Restore deleted marks?\n\n${row.level_name}\n${contextLabel}\n${row.component_label}\n${row.term}${row.year ? ` ${row.year}` : ""}\nArchived rows: ${row.archived_rows}`
    );

    if (!confirmed) return;

    setRestoringArchiveKey(archiveKey);
    setMarksArchiveError("");
    setMarksArchiveNotice("");

    try {
      const data = await adminFetch("/api/admin/marks-archive/restore", {
        method: "POST",
        body: {
          levelName: row.level_name,
          assignmentId: row.assignment_id,
          term: row.term,
          year: row.year,
          componentKey: row.component_key,
          deletedAtKey: row.deleted_at_key,
        },
      });

      setMarksArchiveNotice(data?.message || "Deleted marks restored successfully.");
      await Promise.all([
        fetchMarksArchiveSets(),
        fetchMarksSets(),
        fetchALevelMarksSets(),
      ]);
    } catch (err) {
      console.error("Error restoring deleted marks:", err);
      setMarksArchiveError(err.message || "Failed to restore deleted marks.");
    } finally {
      setRestoringArchiveKey("");
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
    fetchSchoolCalendar();
    fetchOLevelAssignmentsOverview();
    fetchALevelAssignmentsOverview();
    // prefetch marks summary so tracker / download panels are snappy
    fetchMarksSets();
    fetchALevelMarksSets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchOverviewMarksEntryLocks(dashboardOperationalTerm, dashboardOperationalYear);
    fetchReportReadinessSummary(dashboardOperationalTerm, dashboardOperationalYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardOperationalTerm, dashboardOperationalYear]);
  

  useEffect(() => {
    if (activeSection === "Notices") fetchNotices();
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === "Manage Teachers") fetchTeachers();
    else if (activeSection === "Add Students") fetchStudents();
    else if (activeSection === "Download Marks") {
      fetchMarksSets();
      fetchMarksArchiveSets();
      setSelectedMarksSet(null);
      setMarksDetail([]);
    } else if (activeSection === "Assessment Submission Tracker") {
      // load marks so tracker has data
      fetchMarksSets();
    } else if (activeSection === "School Calendar") {
      fetchSchoolCalendar();
    } else if (activeSection === "Marks Entry Lock") {
      fetchMarksEntryLocks();
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

  const handleSchoolCalendarAcademicYearChange = (value) => {
    setSchoolCalendarError("");
    setSchoolCalendarNotice("");
    setSchoolCalendarForm((prev) => ({
      ...prev,
      academicYear: value,
    }));
  };

  const handleSchoolCalendarEntryChange = (key, field, value) => {
    setSchoolCalendarError("");
    setSchoolCalendarNotice("");
    setSchoolCalendarForm((prev) => ({
      ...prev,
      entries: prev.entries.map((entry) =>
        entry.key === key ? { ...entry, [field]: value } : entry
      ),
    }));
  };

  const handleSaveSchoolCalendar = async (e) => {
    e?.preventDefault?.();
    setSchoolCalendarSaving(true);
    setSchoolCalendarError("");
    setSchoolCalendarNotice("");

    try {
      const payload = {
        academicYear: schoolCalendarForm.academicYear,
        entries: schoolCalendarForm.entries.map((entry) => ({
          key: entry.key,
          from: entry.from,
          to: entry.to,
        })),
      };

      const saved = await adminFetch("/api/admin/school-calendar", {
        method: "PUT",
        body: payload,
      });

      const normalized = normalizeSchoolCalendar(saved);
      setSchoolCalendarForm(normalized);
      setSchoolCalendarNotice(
        "School calendar updated. Teacher dashboards will now use these term and holiday dates."
      );
    } catch (err) {
      console.error("Error saving school calendar:", err);
      setSchoolCalendarError(err.message || "Could not save school calendar.");
    } finally {
      setSchoolCalendarSaving(false);
    }
  };

  const handleMarksLockMetaChange = (field, value) => {
    setMarksLockError("");
    setMarksLockNotice("");
    setMarksLockForm((prev) => ({
      ...prev,
      [field]: field === "year" ? Number(value) || new Date().getFullYear() : value,
    }));
  };

  const handleMarksLockRowChange = (levelName, aoi, field, value) => {
    setMarksLockError("");
    setMarksLockNotice("");
    setMarksLockForm((prev) => ({
      ...prev,
      locks: prev.locks.map((row) =>
        row.level_name === levelName && row.aoi_label === aoi
          ? {
              ...row,
              [field]: field === "is_locked" ? Boolean(value) : value,
            }
          : row
      ),
    }));
  };

  const handleSaveMarksEntryLocks = async (e) => {
    e?.preventDefault?.();
    setMarksLockSaving(true);
    setMarksLockError("");
    setMarksLockNotice("");

    try {
      const payload = {
        term: marksLockForm.term,
        year: Number(marksLockForm.year),
        locks: marksLockForm.locks.map((row) => ({
          level_name: row.level_name,
          aoi_label: row.aoi_label,
          deadline_at: row.deadline_at || "",
          is_locked: Boolean(row.is_locked),
        })),
      };

      const saved = await adminFetch("/api/admin/marks-entry-locks", {
        method: "PUT",
        body: payload,
      });

      const rows = Array.isArray(saved?.locks) ? saved.locks : [];
      const byKey = new Map(
        rows.map((row) => [
          getMarksLockRowKey(row.level_name || "O-Level", row.aoi_label),
          row,
        ])
      );
      setMarksLockForm({
        term: saved?.term || payload.term,
        year: Number(saved?.year || payload.year),
        locks: MARKS_LOCK_LEVELS.flatMap((levelName) =>
          MARKS_LOCK_GROUPS[levelName].map((aoi) => {
            const matched = byKey.get(getMarksLockRowKey(levelName, aoi));
            return {
              level_name: levelName,
              aoi_label: aoi,
              deadline_at: matched?.deadline_at || "",
              is_locked: Boolean(matched?.is_locked),
              effective_locked: Boolean(matched?.effective_locked),
              lock_reason: matched?.lock_reason || "Open",
            };
          })
        ),
      });
      setMarksLockNotice(
        "Marks entry lock settings saved. Teachers will be blocked immediately when AOI, /80, MID or EOT windows are locked or their deadlines pass."
      );
    } catch (err) {
      console.error("Error saving marks entry locks:", err);
      setMarksLockError(err.message || "Could not save marks entry locks.");
    } finally {
      setMarksLockSaving(false);
    }
  };

  const csvEscape = (value) => {
    if (value === null || value === undefined) return '""';
    const s = String(value).replace(/"/g, '""');
    return `"${s}"`;
  };

  const formatMarksDetailScore = (row) => {
    if (!row) return "";
    if (String(row.status || "").toLowerCase() === "missed") return "Missed";
    if (row.score === null || row.score === undefined || row.score === "") {
      return row.aoi_label ? "Missed" : "";
    }
    const numericScore = Number(row.score);
    return Number.isFinite(numericScore) ? String(row.score) : String(row.score);
  };

  /* ---------- Export helpers (CSV / PDF) ---------- */
  const handleDownloadCsv = () => {
    if (!selectedAoi || !marksPreviewMeta || marksDetail.length === 0) return;
  
    const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const isCombinedMarksReport = selectedAoi === "ALL";
  
    const header = [
      "Student ID",
      "Name",
      "Class",
      "Stream",
      ...(isCombinedMarksReport ? ["AOI"] : []),
      "Score",
      "Subject",
      "AOI",
      "Term",
      "Year",
      "Submitted By",
      "Submitted At",
    ];
  
    const submittedAt = marksPreviewMeta.submitted_at || marksPreviewMeta.created_at
      ? formatDateTime(marksPreviewMeta.submitted_at || marksPreviewMeta.created_at)
      : "Multiple submission times";
  
    const rows = marksDetail.map((row) => [
      csvEscape(row.student_id),
      csvEscape(row.student_name),
      csvEscape(row.class_level),
      csvEscape(row.stream),
      ...(isCombinedMarksReport ? [csvEscape(row.aoi_label || "")] : []),
      csvEscape(formatMarksDetailScore(row)),
      csvEscape(marksPreviewMeta.subject),
      csvEscape(isCombinedMarksReport ? row.aoi_label || "" : marksPreviewMeta.aoi_label),
      csvEscape(marksPreviewMeta.term),
      csvEscape(marksPreviewMeta.year),
      csvEscape(marksPreviewMeta.teacher_name || ""),
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
  
    const filename = `marks_${slug(marksPreviewMeta.class_level)}_${slug(
      marksPreviewMeta.stream
    )}_${slug(marksPreviewMeta.subject)}_${slug(
      marksPreviewMeta.aoi_label
    )}_T${slug(marksPreviewMeta.term)}_${marksPreviewMeta.year}.csv`;
  
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

  const handleConfirmDeleteAoi = async () => {
    if (!pendingAoiDelete?.aoi) return;

    const aoi = pendingAoiDelete.aoi;
    const deleteKey = getAoiDeleteKey(aoi);
    setDeletingAoiKey(deleteKey);
    setMarksError("");

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
      setPendingAoiDelete(null);
    } catch (err) {
      console.error("Error deleting AOI:", err);
      setMarksError(err.message || "Failed to delete AOI.");
    } finally {
      setDeletingAoiKey("");
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedAoi || !marksPreviewMeta || marksDetail.length === 0) return;
    const { jsPDF } = await loadPdfTools();
    const doc = new jsPDF("p", "mm", "a4");
  
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
  
    const schoolName = "St. Phillip's Equatorial Secondary School (SPESS)";
    const isCombinedMarksReport = selectedAoi === "ALL";
    const title = isCombinedMarksReport
      ? `${marksPreviewMeta.subject} — Combined AOI Report`
      : `${marksPreviewMeta.subject} — ${marksPreviewMeta.aoi_label}`;
    const generatedAt = formatDateTime(new Date().toISOString());
  
    const meta = {
      Class: marksPreviewMeta.class_level,
      Stream: marksPreviewMeta.stream,
      Subject: marksPreviewMeta.subject,
      Components: isCombinedMarksReport
        ? (selectedGroup?.aois || []).map((row) => row.aoi_label).join(", ") || "Combined AOIs"
        : marksPreviewMeta.aoi_label,
      Term: marksPreviewMeta.term,
      Year: marksPreviewMeta.year,
      "Submitted by": marksPreviewMeta.teacher_name || "—",
      "Submitted at":
        marksPreviewMeta.submitted_at || marksPreviewMeta.created_at
          ? formatDateTime(marksPreviewMeta.submitted_at || marksPreviewMeta.created_at)
          : "Multiple submission times",
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
      if (isCombinedMarksReport) {
        doc.text("AOI", 162, y);
        doc.text("Score", 186, y);
      } else {
        doc.text("Score", 168, y);
      }
  
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
      if (isCombinedMarksReport) {
        doc.text(String(row.aoi_label || "—"), 162, y);
        doc.text(
          formatMarksDetailScore(row),
          196,
          y,
          { align: "right" }
        );
      } else {
        doc.text(
          formatMarksDetailScore(row),
          168,
          y,
          { align: "right" }
        );
      }
  
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
      doc.setFontSize(8.5);
  
      doc.text("#", 11, y);
      doc.text("Name", 18, y);
      doc.text("Gender", 76, y);
      doc.text("DOB", 93, y);
      doc.text("Class", 118, y);
      doc.text("Stream", 133, y);
      doc.text("Optional Subjects", 152, y);
  
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
      const nameLines = doc.splitTextToSize(s.name || "", 55);
      const optionalText = optionalSubs.join(", ");
      const subjectLines = doc.splitTextToSize(optionalText, pageW - 162);
      const dobText = formatDateOnly(s.dob);
  
      const rowHeight = Math.max(
        baseRowHeight,
        nameLines.length * 5,
        subjectLines.length * 5
      );
  
      if (y + rowHeight > pageH - bottomMargin) {
        startNewPage();
      }
  
      doc.setFontSize(8.5);
      doc.text(String(index + 1), 11, y);
      doc.text(nameLines, 18, y);
      doc.text(s.gender || "", 76, y);
      doc.text(dobText, 93, y);
      doc.text(s.class_level || "", 118, y);
      doc.text(s.stream || "", 133, y);
      doc.text(subjectLines, 152, y);
  
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

  useEffect(() => {
    if (!activeSection || !detailSectionRef.current) return;
    window.requestAnimationFrame(() => {
      detailSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [activeSection]);

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
  const enrollmentByStreamClassGender = React.useMemo(
    () => buildEnrollmentByStreamClassGenderMap(students),
    [students]
  );
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
  const getMarksGroupKey = (group) =>
    group
      ? [group.class_level, group.stream, group.subject, group.term, group.year].join("|")
      : "";
  const selectedGroupKey = getMarksGroupKey(selectedGroup);
  useEffect(() => {
    if (!selectedGroupKey) return;

    const refreshedGroup = groupedMarkSets.find((group) => getMarksGroupKey(group) === selectedGroupKey);

    if (!refreshedGroup) {
      setSelectedGroup(null);
      setSelectedAoi(null);
      setMarksDetail([]);
      return;
    }

    if (selectedGroup !== refreshedGroup) {
      setSelectedGroup(refreshedGroup);
    }

    if (selectedAoi && selectedAoi !== "ALL" && typeof selectedAoi === "object") {
      const refreshedAoi = refreshedGroup.aois.find(
        (row) => String(row.aoi_label || "").trim().toUpperCase() === String(selectedAoi.aoi_label || "").trim().toUpperCase()
      );

      if (!refreshedAoi) {
        setSelectedAoi(null);
        setMarksDetail([]);
      } else if (selectedAoi !== refreshedAoi) {
        setSelectedAoi(refreshedAoi);
      }
    }
  }, [groupedMarkSets, selectedGroup, selectedGroupKey, selectedAoi]);

  const marksPreviewMeta = useMemo(() => {
    if (selectedAoi === "ALL" && selectedGroup) {
      return {
        class_level: selectedGroup.class_level,
        stream: selectedGroup.stream,
        subject: selectedGroup.subject,
        aoi_label: "Combined AOIs",
        term: selectedGroup.term,
        year: selectedGroup.year,
        teacher_name: selectedGroup.teacher_name || "—",
        submitted_at: null,
        created_at: null,
      };
    }
    return selectedAoi && typeof selectedAoi === "object" ? selectedAoi : null;
  }, [selectedAoi, selectedGroup]);
  
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
  const activeSchoolStatusLocks = overviewMarksLocks.filter((row) => row.effective_locked);

  const assessmentCompliance = useMemo(() => {
    const oLevelRows = marksSets.filter(
      (row) =>
        normalizeOperationalTerm(row.term) === dashboardOperationalTerm &&
        Number(row.year) === Number(dashboardOperationalYear)
    );
    const aLevelRows = aLevelMarksSets.filter(
      (row) =>
        normalizeOperationalTerm(row.term) === dashboardOperationalTerm &&
        Number(row.year) === Number(dashboardOperationalYear)
    );

    const oLevelSubmittedAssignments = new Set(oLevelRows.map((row) => row.assignment_id));
    const oLevelTotal = oLevelAssignmentsOverview.length;
    const aLevelTotal = aLevelAssignmentsOverview.length;
    const aLevelExpectedComponents = aLevelTotal * 2;
    const oLevelAoiCounts = Object.fromEntries(
      O_LEVEL_AOI_OPTIONS.map(({ value }) => [
        value,
        new Set(
          oLevelRows
            .filter((row) => String(row.aoi_label || "").trim().toUpperCase() === value)
            .map((row) => row.assignment_id)
        ).size,
      ])
    );
    const oLevelAoiRates = Object.fromEntries(
      O_LEVEL_AOI_OPTIONS.map(({ value }) => [value, toPercent(oLevelAoiCounts[value], oLevelTotal)])
    );

    const aLevelSubmittedAssignments = new Set(aLevelRows.map((row) => row.assignment_id));
    const aLevelSubmittedComponents = new Set(
      aLevelRows
        .filter((row) => ["MID", "EOT"].includes(String(row.aoi_label || "").trim().toUpperCase()))
        .map((row) => `${row.assignment_id}__${String(row.aoi_label || "").trim().toUpperCase()}`)
    );

    return {
      oLevelSubmitted: oLevelSubmittedAssignments.size,
      oLevelPending: Math.max(0, oLevelTotal - oLevelSubmittedAssignments.size),
      oLevelAoiCounts,
      oLevelAoiRates,
      aLevelSubmitted: aLevelSubmittedAssignments.size,
      aLevelPending: Math.max(0, aLevelTotal - aLevelSubmittedAssignments.size),
      aLevelMidEotRate: toPercent(aLevelSubmittedComponents.size, aLevelExpectedComponents),
      oLevelTotal,
      aLevelTotal,
      aLevelExpectedComponents,
    };
  }, [
    aLevelAssignmentsOverview,
    aLevelMarksSets,
    dashboardOperationalTerm,
    dashboardOperationalYear,
    marksSets,
    oLevelAssignmentsOverview,
  ]);
  const selectedAssessmentAoiLabel =
    O_LEVEL_AOI_OPTIONS.find((option) => option.value === assessmentComplianceAoi)?.label || "AOI 1";
  const selectedAssessmentAoiRate = assessmentCompliance.oLevelAoiRates?.[assessmentComplianceAoi] ?? 0;
  const selectedAssessmentAoiSubmitted = assessmentCompliance.oLevelAoiCounts?.[assessmentComplianceAoi] ?? 0;

  const teacherLoadSummary = useMemo(() => {
    const assignedTeacherIds = new Set(
      [...oLevelAssignmentsOverview, ...aLevelAssignmentsOverview]
        .map((row) => row.teacher_id)
        .filter((value) => value !== null && value !== undefined && value !== "")
        .map((value) => String(value))
    );

    return {
      assignedTeachers: assignedTeacherIds.size,
      totalTeachingSlots: oLevelAssignmentsOverview.length + aLevelAssignmentsOverview.length,
      oLevelAssignments: oLevelAssignmentsOverview.length,
      aLevelAssignments: aLevelAssignmentsOverview.length,
    };
  }, [oLevelAssignmentsOverview, aLevelAssignmentsOverview]);

  const reportReadinessCard = useMemo(() => {
    const empty = {
      term: dashboardOperationalTerm,
      year: dashboardOperationalYear,
      oLevel: {
        totalLearners: totalStudents,
        readyLearners: 0,
        incompleteLearners: totalStudents,
        readinessPercent: 0,
        byClass: CLASS_SORT_ORDER.map((classLevel) => {
          const totalLearners = students.filter((student) => student.class_level === classLevel).length;
          return {
            classLevel,
            totalLearners,
            readyLearners: 0,
            incompleteLearners: totalLearners,
            readinessPercent: 0,
          };
        }),
      },
      aLevel: {
        totalLearners: aLevelLearners.length,
        readyLearners: 0,
        incompleteLearners: aLevelLearners.length,
        readinessPercent: 0,
      },
      combined: {
        totalLearners: totalStudents + aLevelLearners.length,
        readyLearners: 0,
        incompleteLearners: totalStudents + aLevelLearners.length,
        readinessPercent: 0,
      },
    };

    return reportReadinessSummary || empty;
  }, [
    aLevelLearners.length,
    dashboardOperationalTerm,
    dashboardOperationalYear,
    reportReadinessSummary,
    totalStudents,
  ]);

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
              <div className="panel-card-header">
                <div>
                  <h3>Teacher Access Snapshot</h3>
                  <p className="muted-text" style={{ margin: "0.2rem 0 0" }}>
                    Teacher accounts are now self-registered. This panel is for quick visibility and management only.
                  </p>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "0.8rem",
                  marginTop: "0.35rem",
                }}
              >
                {[
                  { label: "Registered Teachers", value: teachers.length, tone: "#7dd3fc" },
                  { label: "Assigned Teachers", value: teacherLoadSummary.assignedTeachers, tone: "#86efac" },
                  { label: "O-Level Loads", value: teacherLoadSummary.oLevelAssignments, tone: "#fcd34d" },
                  { label: "A-Level Loads", value: teacherLoadSummary.aLevelAssignments, tone: "#fca5a5" },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      borderRadius: "18px",
                      padding: "0.95rem 1rem",
                      border: "1px solid rgba(148, 163, 184, 0.18)",
                      background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(15,23,42,0.36))",
                      boxShadow: "0 14px 28px rgba(2, 6, 23, 0.12)",
                    }}
                  >
                    <div
                      style={{
                        color: item.tone,
                        fontSize: "0.72rem",
                        fontWeight: 800,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                      }}
                    >
                      {item.label}
                    </div>
                    <div style={{ marginTop: "0.35rem", color: "#f8fafc", fontSize: "1.35rem", fontWeight: 900 }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  marginTop: "1rem",
                  padding: "0.95rem 1rem",
                  borderRadius: "16px",
                  background: "rgba(15, 23, 42, 0.52)",
                  border: "1px solid rgba(148, 163, 184, 0.14)",
                  color: "#cbd5e1",
                  lineHeight: 1.65,
                }}
              >
                <div
                  style={{
                    color: "#e2e8f0",
                    fontWeight: 800,
                    marginBottom: "0.35rem",
                  }}
                >
                  What this section is for now
                </div>
                <div>
                  Review registered teacher accounts, export the current register, and remove accounts when necessary.
                </div>
                <div style={{ marginTop: "0.35rem" }}>
                  Total teaching slots currently assigned: <strong>{teacherLoadSummary.totalTeachingSlots}</strong>
                </div>
              </div>
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
                            <button
                              type="button"
                              className="danger-link"
                              onClick={() => setPendingTeacherDelete(t)}
                              disabled={deletingTeacherId === t.id}
                            >
                              {deletingTeacherId === t.id ? "Deleting…" : "Delete"}
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

          {pendingTeacherDelete && (
            <div className="modal-backdrop" style={{ zIndex: 120 }}>
              <div
                className="modal-card"
                style={{
                  maxWidth: "520px",
                  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98))",
                  border: "1px solid rgba(248, 113, 113, 0.24)",
                  boxShadow: "0 28px 60px rgba(2, 6, 23, 0.34)",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    padding: "0.34rem 0.72rem",
                    borderRadius: "999px",
                    background: "rgba(127, 29, 29, 0.2)",
                    border: "1px solid rgba(248, 113, 113, 0.22)",
                    color: "#fecaca",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    marginBottom: "0.9rem",
                  }}
                >
                  Remove Teacher
                </div>

                <h2 style={{ color: "#f8fafc", marginBottom: "0.5rem" }}>Delete This Teacher?</h2>
                <p style={{ color: "#cbd5e1", lineHeight: 1.65, marginBottom: "1rem" }}>
                  You are about to remove <strong>{pendingTeacherDelete.name}</strong>
                  {pendingTeacherDelete.email ? <> ({pendingTeacherDelete.email})</> : null} from the teacher register.
                </p>

                <div
                  className="panel-alert panel-alert-error"
                  style={{
                    marginBottom: "1rem",
                    background: "rgba(127, 29, 29, 0.16)",
                    borderColor: "rgba(248, 113, 113, 0.24)",
                    color: "#fecaca",
                  }}
                >
                  This action removes the teacher account from the current register. Proceed only if you are sure.
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setPendingTeacherDelete(null)}
                    disabled={deletingTeacherId === pendingTeacherDelete.id}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() =>
                      requestAdminReauth({
                        title: "Confirm Teacher Deletion",
                        description: "Re-enter your admin password to delete this teacher account.",
                        onApproved: () => handleDeleteTeacher(pendingTeacherDelete.id),
                      })
                    }
                    disabled={deletingTeacherId === pendingTeacherDelete.id}
                    style={{
                      background: "linear-gradient(135deg, #991b1b, #dc2626)",
                      borderColor: "rgba(248, 113, 113, 0.4)",
                    }}
                  >
                    {deletingTeacherId === pendingTeacherDelete.id ? "Deleting…" : "Delete Teacher"}
                  </button>
                </div>
              </div>
            </div>
          )}
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
        onClick={() => setPendingStudentDelete(s)}
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
              <div className="notice-stack notice-stack-compact">
                {notices.map((n) => (
                  <div key={n.id} className="notice-item">
                    <h4>{n.title}</h4>
                    <p>{n.body}</p>
                    <div className="notice-item-meta">
                      <small>{formatDateTime(n.created_at)}</small>
                      <div className="notice-item-actions">
                        <button
                          className="danger-link"
                          onClick={() => setPendingNoticeDelete(n)}
                          disabled={deletingNoticeId === n.id}
                        >
                          {deletingNoticeId === n.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel-card">
              <h3>Published Notices</h3>
              {loadingNotices ? (
                <p className="muted-text">Loading notices…</p>
              ) : notices.length === 0 ? (
                <p className="notice-empty">No notices yet.</p>
              ) : (
                <div className="notice-stack">
                  {notices.map((n) => (
                    <div key={n.id} className="notice-item">
                      <h4>{n.title}</h4>
                      <div className="notice-item-body">{n.body}</div>
                      <div className="notice-item-meta">
                        <small>{formatDateTime(n.created_at)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {pendingNoticeDelete && (
            <div className="modal-backdrop" style={{ zIndex: 120 }}>
              <div
                className="modal-card"
                style={{
                  maxWidth: "540px",
                  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98))",
                  border: "1px solid rgba(248, 113, 113, 0.24)",
                  boxShadow: "0 28px 60px rgba(2, 6, 23, 0.34)",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    padding: "0.34rem 0.72rem",
                    borderRadius: "999px",
                    background: "rgba(127, 29, 29, 0.2)",
                    border: "1px solid rgba(248, 113, 113, 0.22)",
                    color: "#fecaca",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    marginBottom: "0.9rem",
                  }}
                >
                  Delete Notice
                </div>

                <h2 style={{ color: "#f8fafc", marginBottom: "0.5rem" }}>Remove This Notice?</h2>
                <p style={{ color: "#cbd5e1", lineHeight: 1.65, marginBottom: "0.95rem" }}>
                  This notice will be removed from the teacher dashboard immediately.
                </p>

                <div
                  style={{
                    padding: "0.9rem 1rem",
                    borderRadius: "1rem",
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    background: "rgba(15, 23, 42, 0.62)",
                    marginBottom: "1rem",
                    display: "grid",
                    gap: "0.45rem",
                  }}
                >
                  <div style={{ color: "#f8fafc", fontWeight: 800 }}>{pendingNoticeDelete.title}</div>
                  <div style={{ color: "#cbd5e1", lineHeight: 1.6 }}>{pendingNoticeDelete.body}</div>
                  <small style={{ color: "#94a3b8" }}>
                    {pendingNoticeDelete.created_at
                      ? formatDateTime(pendingNoticeDelete.created_at)
                      : "Recently published"}
                  </small>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setPendingNoticeDelete(null)}
                    disabled={deletingNoticeId === pendingNoticeDelete.id}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() =>
                      requestAdminReauth({
                        title: "Confirm Notice Deletion",
                        description: "Re-enter your admin password to remove this notice from teacher dashboards.",
                        onApproved: () => handleDeleteNotice(pendingNoticeDelete),
                      })
                    }
                    disabled={deletingNoticeId === pendingNoticeDelete.id}
                    style={{
                      background: "linear-gradient(135deg, #991b1b, #dc2626)",
                      borderColor: "rgba(248, 113, 113, 0.4)",
                    }}
                  >
                    {deletingNoticeId === pendingNoticeDelete.id ? "Deleting…" : "Delete Notice"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {noticeFeedback && (
            <div className="modal-backdrop" style={{ zIndex: 121 }}>
              <div
                className="modal-card"
                style={{
                  maxWidth: "560px",
                  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98))",
                  border: `1px solid ${
                    noticeFeedback.mode === "published"
                      ? "rgba(59, 130, 246, 0.24)"
                      : "rgba(248, 113, 113, 0.24)"
                  }`,
                  boxShadow: "0 28px 60px rgba(2, 6, 23, 0.34)",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    padding: "0.34rem 0.72rem",
                    borderRadius: "999px",
                    background:
                      noticeFeedback.mode === "published"
                        ? "rgba(30, 64, 175, 0.2)"
                        : "rgba(127, 29, 29, 0.2)",
                    border: `1px solid ${
                      noticeFeedback.mode === "published"
                        ? "rgba(96, 165, 250, 0.22)"
                        : "rgba(248, 113, 113, 0.22)"
                    }`,
                    color: noticeFeedback.mode === "published" ? "#bfdbfe" : "#fecaca",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    marginBottom: "0.9rem",
                  }}
                >
                  {noticeFeedback.mode === "published" ? "Notice Published" : "Notice Deleted"}
                </div>

                <h2 style={{ color: "#f8fafc", marginBottom: "0.55rem" }}>
                  {noticeFeedback.mode === "published"
                    ? "Notice Posted Successfully"
                    : "Notice Removed Successfully"}
                </h2>
                <p style={{ color: "#cbd5e1", lineHeight: 1.65, marginBottom: "1rem" }}>
                  {noticeFeedback.mode === "published"
                    ? "Teachers can now see this notice immediately on their dashboard."
                    : "This notice is no longer visible on the teacher dashboard."}
                </p>

                <div
                  style={{
                    padding: "0.95rem 1rem",
                    borderRadius: "1rem",
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    background: "rgba(15, 23, 42, 0.62)",
                    display: "grid",
                    gap: "0.45rem",
                    marginBottom: "1rem",
                  }}
                >
                  <div style={{ color: "#f8fafc", fontWeight: 800 }}>{noticeFeedback.title}</div>
                  <div style={{ color: "#cbd5e1", lineHeight: 1.6 }}>{noticeFeedback.body}</div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" className="primary-btn" onClick={() => setNoticeFeedback(null)}>
                    Okay
                  </button>
                </div>
              </div>
            </div>
          )}
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

          <div className="panel-card" style={{ marginBottom: "1rem" }}>
            <div className="panel-card-header">
              <div>
                <h3>Deleted Marks Recovery</h3>
                <p className="muted-text" style={{ margin: "0.2rem 0 0" }}>
                  Restore archived O-Level and A-Level marks when something was cleared by mistake.
                </p>
              </div>
              <button className="ghost-btn" onClick={fetchMarksArchiveSets} disabled={loadingMarksArchive}>
                {loadingMarksArchive ? "Refreshing…" : "Refresh Archive"}
              </button>
            </div>

            {marksArchiveNotice && (
              <div className="panel-alert" style={{ marginBottom: "0.8rem" }}>
                {marksArchiveNotice}
              </div>
            )}

            {marksArchiveError && (
              <div className="panel-alert panel-alert-error" style={{ marginBottom: "0.8rem" }}>
                {marksArchiveError}
              </div>
            )}

            {loadingMarksArchive ? (
              <p className="muted-text">Loading deleted marks archive…</p>
            ) : marksArchiveSets.length === 0 ? (
              <p className="muted-text">No archived marks sets available right now.</p>
            ) : (
              <div className="teachers-table-wrapper">
                <table className="teachers-table">
                  <thead>
                    <tr>
                      <th>Level</th>
                      <th>Subject</th>
                      <th>Context</th>
                      <th>Component</th>
                      <th>Term</th>
                      <th>Rows</th>
                      <th>Deleted</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marksArchiveSets.map((row) => {
                      const archiveKey = getMarksArchiveSetKey(row);
                      const isRestoring = restoringArchiveKey === archiveKey;
                      const isRestored = Boolean(row.restored_at);
                      const canRestore = row.assignment_exists && !isRestored;

                      return (
                        <tr key={archiveKey}>
                          <td>{row.level_name}</td>
                          <td>{row.subject || "—"}</td>
                          <td>
                            {row.level_name === "A-Level"
                              ? row.stream || "—"
                              : `${row.class_level || "—"} ${row.stream || "—"}`}
                          </td>
                          <td>{row.component_label || "—"}</td>
                          <td>{row.term}{row.year ? ` ${row.year}` : ""}</td>
                          <td>{row.archived_rows}</td>
                          <td>
                            <div>{formatDateTime(row.deleted_at)}</div>
                            <small className="muted-text">{row.delete_reason || row.source_action || "Archived delete"}</small>
                          </td>
                          <td>
                            {!row.assignment_exists ? (
                              <span className="muted-text">Assignment missing</span>
                            ) : isRestored ? (
                              <span className="muted-text">Restored</span>
                            ) : (
                              <span className="muted-text">Ready</span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="ghost-btn"
                              onClick={() => handleRestoreArchiveSet(row)}
                              disabled={!canRestore || isRestoring}
                            >
                              {isRestoring ? "Restoring…" : "Restore"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
    
          <div className="panel-grid">
    
            {/* LEFT PANEL */}
            <div className="panel-card download-marks-card">
              <div className="panel-card-header">
                <div>
                  <h3>Available Subjects</h3>
                  <p className="download-marks-subtitle">Choose a class stream subject block, then drill into the AOIs on the right.</p>
                </div>
                <div style={{ display: "flex", gap: "0.55rem", alignItems: "center", flexWrap: "wrap" }}>
                  <span className="download-marks-pill">{groupedMarkSets.length} subject blocks</span>
                  <button className="ghost-btn" onClick={fetchMarksSets} disabled={loadingMarksSets}>
                    {loadingMarksSets ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
              </div>
    
              <div className="teachers-table-wrapper download-marks-table-shell">
                <table className="teachers-table download-marks-table">
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
                        className={selectedGroupKey === getMarksGroupKey(group) ? "download-marks-row-active" : ""}
                        onClick={() => {
                          setSelectedGroup(group);
                          setSelectedAoi(null);
                          setMarksDetail([]);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <td><span className="download-marks-pill download-marks-pill-soft">{group.class_level}</span></td>
                        <td>{group.stream}</td>
                        <td>
                          <div className="download-marks-subject-name">{group.subject}</div>
                        </td>
                        <td><span className="download-marks-pill">{group.aois.length} AOIs</span></td>
                        <td>{group.term}</td>
                        <td>{group.year}</td>
                        <td>{group.teacher_name || "—"}</td>
                        <td>
                          <button
                            className="danger-link"
                            onClick={(e) => {
                              e.stopPropagation();

                              requestAdminReauth({
                                title: "Confirm Subject Marks Deletion",
                                description: `Re-enter your admin password to delete all AOIs for ${group.subject} in ${group.class_level} ${group.stream}.`,
                                onApproved: async () => {
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
                                  } catch (err) {
                                    setMarksError(err.message || "Failed to delete subject marks.");
                                  }
                                },
                              });
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
            <div className="panel-card download-marks-card">
              <div className="panel-card-header">
                <div>
                  <h3>Marks Preview</h3>
                  <p className="download-marks-subtitle">Preview the scores first, then export the current view cleanly to CSV or PDF.</p>
                </div>
    
                {selectedAoi && marksDetail.length > 0 && (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
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
                  <div className="download-marks-preview-banner">
                    <div>
                      <div className="download-marks-banner-label">Current Selection</div>
                      <div className="download-marks-banner-title">
                        {selectedGroup.class_level} {selectedGroup.stream} — <strong>{selectedGroup.subject}</strong>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <span className="download-marks-pill download-marks-pill-soft">{selectedGroup.term}</span>
                      <span className="download-marks-pill download-marks-pill-soft">{selectedGroup.year}</span>
                      <span className="download-marks-pill">{selectedGroup.aois.length} AOIs</span>
                    </div>
                  </div>

                  {/* AOI CONTROLS */}
                  <div className="download-marks-aoi-row">
    
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
                      <div key={aoi.aoi_label} className="download-marks-aoi-chip">
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
                          className="download-marks-aoi-delete"
                          disabled={deletingAoiKey === getAoiDeleteKey(aoi)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingAoiDelete({
                              aoi,
                              subject: selectedGroup.subject,
                              class_level: selectedGroup.class_level,
                              stream: selectedGroup.stream,
                            });
                          }}
                          title={`Delete ${aoi.aoi_label}`}
                          aria-label={`Delete ${aoi.aoi_label}`}
                        >
                          {deletingAoiKey === getAoiDeleteKey(aoi) ? "…" : "×"}
                        </button>
                      </div>
                    ))}
                  </div>
    
                  {loadingMarksDetail ? (
                    <p className="muted-text">Loading marks…</p>
                  ) : marksDetail.length === 0 ? (
                    <p className="muted-text">No marks loaded.</p>
                  ) : (
                    <div className="teachers-table-wrapper download-marks-table-shell">
                      <table className="teachers-table download-marks-table">
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
                              <td>
                                <div className="download-marks-subject-name">{row.student_name}</div>
                              </td>
                              <td><span className="download-marks-pill download-marks-pill-soft">{row.class_level}</span></td>
                              <td>{row.stream}</td>
                              {selectedAoi === "ALL" && (
                                <td>
                                  <span className="download-marks-pill">{row.aoi_label}</span>
                                </td>
                              )}
                              <td>
                                <span className="download-marks-score-chip">
                                  {formatMarksDetailScore(row)}
                                </span>
                              </td>
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

          {pendingAoiDelete && (
            <div className="modal-backdrop" style={{ zIndex: 120 }}>
              <div
                className="modal-card"
                style={{
                  maxWidth: "520px",
                  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98))",
                  border: "1px solid rgba(248, 113, 113, 0.24)",
                  boxShadow: "0 28px 60px rgba(2, 6, 23, 0.34)",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    padding: "0.34rem 0.72rem",
                    borderRadius: "999px",
                    background: "rgba(127, 29, 29, 0.2)",
                    border: "1px solid rgba(248, 113, 113, 0.22)",
                    color: "#fecaca",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    marginBottom: "0.9rem",
                  }}
                >
                  Delete AOI
                </div>

                <h2 style={{ color: "#f8fafc", marginBottom: "0.5rem" }}>Remove This AOI?</h2>
                <p style={{ color: "#cbd5e1", lineHeight: 1.65, marginBottom: "1rem" }}>
                  This will remove <strong>{pendingAoiDelete.aoi?.aoi_label}</strong> for{" "}
                  <strong>{pendingAoiDelete.subject}</strong> in{" "}
                  <strong>{pendingAoiDelete.class_level} {pendingAoiDelete.stream}</strong> for{" "}
                  <strong>{pendingAoiDelete.aoi?.term} {pendingAoiDelete.aoi?.year}</strong>.
                </p>

                <div
                  className="panel-alert panel-alert-error"
                  style={{
                    marginBottom: "1rem",
                    background: "rgba(127, 29, 29, 0.16)",
                    borderColor: "rgba(248, 113, 113, 0.24)",
                    color: "#fecaca",
                  }}
                >
                  The marks for this AOI will be removed from teacher and admin views. Use this only when you are sure.
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setPendingAoiDelete(null)}
                    disabled={Boolean(deletingAoiKey)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() =>
                      requestAdminReauth({
                        title: "Confirm AOI Deletion",
                        description: "Re-enter your admin password to delete this AOI mark set.",
                        onApproved: () => handleConfirmDeleteAoi(),
                      })
                    }
                    disabled={Boolean(deletingAoiKey)}
                    style={{
                      background: "linear-gradient(135deg, #991b1b, #dc2626)",
                      borderColor: "rgba(248, 113, 113, 0.4)",
                    }}
                  >
                    {deletingAoiKey ? "Deleting…" : "Delete AOI"}
                  </button>
                </div>
              </div>
            </div>
          )}
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
    if (activeSection === "Mini Reports") {
      return <MiniProgressReports onClose={() => setActiveSection("")} />;
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
    if (activeSection === "School Calendar") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>School Calendar</h2>
              <p>Update term dates once and let teacher dashboards read the same shared calendar automatically.</p>
            </div>
            <button className="panel-close" type="button" onClick={() => setActiveSection("")}>
              ✕ Close
            </button>
          </div>

          {schoolCalendarError && (
            <div className="panel-alert panel-alert-error">{schoolCalendarError}</div>
          )}
          {schoolCalendarNotice && (
            <div
              className="panel-alert"
              style={{
                background: "rgba(56, 189, 248, 0.1)",
                border: "1px solid rgba(56, 189, 248, 0.28)",
                color: "#bae6fd",
              }}
            >
              {schoolCalendarNotice}
            </div>
          )}

          <div className="panel-grid">
            <div className="panel-card">
              <div className="panel-card-header" style={{ marginBottom: "1rem" }}>
                <div>
                  <h3 style={{ marginBottom: "0.2rem" }}>Calendar Editor</h3>
                  <p className="muted-text" style={{ margin: 0 }}>
                    Terms and holidays both show in the teacher branding strip.
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={fetchSchoolCalendar}
                  disabled={schoolCalendarLoading}
                >
                  {schoolCalendarLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              <form className="teacher-form" onSubmit={handleSaveSchoolCalendar}>
                <div className="form-row">
                  <label>Academic Year</label>
                  <input
                    value={schoolCalendarForm.academicYear}
                    onChange={(e) => handleSchoolCalendarAcademicYearChange(e.target.value)}
                    placeholder="2026"
                  />
                </div>

                <div className="calendar-editor-grid">
                  {schoolCalendarForm.entries.map((entry) => (
                    <div key={entry.key} className="calendar-entry-card">
                      <div className="calendar-entry-heading">
                        <div>
                          <strong>{entry.label}</strong>
                          <small>{entry.status}</small>
                        </div>
                      </div>

                      <div className="calendar-entry-grid">
                        <div className="form-row">
                          <label>From</label>
                          <input
                            type="date"
                            value={entry.from}
                            onChange={(e) =>
                              handleSchoolCalendarEntryChange(entry.key, "from", e.target.value)
                            }
                          />
                        </div>
                        <div className="form-row">
                          <label>To</label>
                          <input
                            type="date"
                            value={entry.to}
                            onChange={(e) =>
                              handleSchoolCalendarEntryChange(entry.key, "to", e.target.value)
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button type="submit" className="primary-btn" disabled={schoolCalendarSaving}>
                  {schoolCalendarSaving ? "Saving Calendar…" : "Save Shared Calendar"}
                </button>
              </form>
            </div>

            <div className="panel-card">
              <div className="panel-card-header" style={{ marginBottom: "1rem" }}>
                <div>
                  <h3 style={{ marginBottom: "0.2rem" }}>Live Preview</h3>
                  <p className="muted-text" style={{ margin: 0 }}>
                    This is what teachers will see right now across the shared dashboard branding.
                  </p>
                </div>
              </div>

              <div className="calendar-preview-shell">
                <span className="calendar-pill calendar-pill-year">
                  Academic Year {schoolCalendarBadge.academicYear}
                </span>
                <span className="calendar-pill">{schoolCalendarBadge.termLabel}</span>
                <span
                  className={`calendar-pill ${
                    schoolCalendarBadge.status === "In Session"
                      ? "calendar-pill-success"
                      : schoolCalendarBadge.status === "Holiday Break"
                      ? "calendar-pill-warning"
                      : "calendar-pill-neutral"
                  }`}
                >
                  {schoolCalendarBadge.status}
                </span>
              </div>

              <div className="calendar-preview-meta">
                <strong>Today</strong>
                <span>{formatDateOnly(schoolCalendarPreviewClock)}</span>
              </div>

              <div className="calendar-preview-meta calendar-preview-countdown">
                <strong>Countdown</strong>
                <span>{schoolCalendarPreciseCountdown.label || "Waiting for active calendar window"}</span>
              </div>

              <div className="teachers-table-wrapper" style={{ maxHeight: "56vh" }}>
                <table className="teachers-table">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Status</th>
                      <th>From</th>
                      <th>To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schoolCalendarTimelineEntries.map((entry) => (
                      <tr key={entry.key}>
                        <td>{entry.label}</td>
                        <td>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              minHeight: "28px",
                              padding: "0.24rem 0.68rem",
                              borderRadius: "999px",
                              fontSize: "0.72rem",
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              border:
                                entry.phase === "active"
                                  ? entry.displayStatus === "Holiday Break"
                                    ? "1px solid rgba(245, 158, 11, 0.3)"
                                    : "1px solid rgba(34, 197, 94, 0.28)"
                                  : entry.phase === "upcoming"
                                  ? "1px solid rgba(56, 189, 248, 0.26)"
                                  : entry.phase === "completed"
                                  ? "1px solid rgba(148, 163, 184, 0.24)"
                                  : "1px solid rgba(148, 163, 184, 0.18)",
                              background:
                                entry.phase === "active"
                                  ? entry.displayStatus === "Holiday Break"
                                    ? "rgba(245, 158, 11, 0.12)"
                                    : "rgba(34, 197, 94, 0.12)"
                                  : entry.phase === "upcoming"
                                  ? "rgba(56, 189, 248, 0.12)"
                                  : entry.phase === "completed"
                                  ? "rgba(148, 163, 184, 0.1)"
                                  : "rgba(148, 163, 184, 0.08)",
                              color:
                                entry.phase === "active"
                                  ? entry.displayStatus === "Holiday Break"
                                    ? "#fef3c7"
                                    : "#dcfce7"
                                  : entry.phase === "upcoming"
                                  ? "#dbeafe"
                                  : entry.phase === "completed"
                                  ? "#e2e8f0"
                                  : "#cbd5e1",
                            }}
                          >
                            {entry.displayStatus}
                          </span>
                        </td>
                        <td>{formatDateOnly(entry.from)}</td>
                        <td>{formatDateOnly(entry.to)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="calendar-sync-note">
                Shared usage: the teacher dashboard will show <strong>terms</strong> and
                <strong> holidays</strong> from these dates automatically. No more hardcoding.
              </p>
            </div>
          </div>
        </section>
      );
    }
    if (activeSection === "Marks Entry Lock") {
      return (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Marks Entry Lock</h2>
              <p>Set deadlines and lock late marks entry for O-Level AOIs, Term 3 /80, and A-Level MID/EOT. Teachers will see a banner immediately and locked components stop accepting marks.</p>
            </div>
            <button className="panel-close" type="button" onClick={() => setActiveSection("")}>
              ✕ Close
            </button>
          </div>

          {marksLockError && <div className="panel-alert panel-alert-error">{marksLockError}</div>}
          {marksLockNotice && (
            <div
              className="panel-alert"
              style={{
                background: "rgba(56, 189, 248, 0.1)",
                border: "1px solid rgba(56, 189, 248, 0.28)",
                color: "#bae6fd",
              }}
            >
              {marksLockNotice}
            </div>
          )}

          <div className="panel-grid">
            <div
              className="panel-card"
              style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
            >
              <div className="panel-card-header" style={{ marginBottom: "1rem" }}>
                <div>
                  <h3 style={{ marginBottom: "0.2rem" }}>Lock Setup</h3>
                  <p className="muted-text" style={{ margin: 0 }}>
                    This applies school-wide to both O-Level and A-Level marks entry for the selected term and year.
                  </p>
                  <div
                    style={{
                      marginTop: "0.5rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      borderRadius: "999px",
                      border: "1px solid rgba(56, 189, 248, 0.26)",
                      background: "rgba(56, 189, 248, 0.1)",
                      color: "#bae6fd",
                      padding: "0.32rem 0.75rem",
                      fontSize: "0.78rem",
                      fontWeight: 800,
                      letterSpacing: "0.04em",
                    }}
                  >
                    Applies to teachers immediately
                  </div>
                </div>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => fetchMarksEntryLocks(marksLockForm.term, Number(marksLockForm.year))}
                  disabled={marksLockLoading}
                >
                  {marksLockLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              <form className="teacher-form" onSubmit={handleSaveMarksEntryLocks}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "0.8rem",
                  }}
                >
                  <div className="form-row">
                    <label>Term</label>
                    <select
                      value={marksLockForm.term}
                      onChange={(e) => handleMarksLockMetaChange("term", e.target.value)}
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
                      value={marksLockForm.year}
                      onChange={(e) => handleMarksLockMetaChange("year", e.target.value)}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "1rem",
                    marginTop: "0.9rem",
                    maxHeight: "58vh",
                    overflowX: "auto",
                    overflowY: "auto",
                    paddingRight: "0.35rem",
                    paddingBottom: "0.45rem",
                    alignContent: "start",
                  }}
                >
                  {MARKS_LOCK_LEVELS.map((levelName) => (
                    <div
                      key={levelName}
                      className="calendar-entry-card"
                      style={{ padding: "1rem", background: "rgba(15, 23, 42, 0.64)" }}
                    >
                      <div className="panel-card-header" style={{ marginBottom: "0.95rem" }}>
                        <div>
                          <h4 style={{ margin: 0, color: "#f8fafc" }}>{levelName}</h4>
                          <p className="muted-text" style={{ margin: "0.2rem 0 0" }}>
                            {levelName === "O-Level"
                              ? "AOI 1, AOI 2, AOI 3 and Term 3 /80 are controlled here."
                              : "MID and EOT entry windows follow these locks."}
                          </p>
                        </div>
                      </div>

                      <div
                        className="calendar-editor-grid"
                        style={{
                          gridTemplateColumns: `repeat(${Math.max(
                            1,
                            marksLockForm.locks.filter((row) => row.level_name === levelName).length
                          )}, minmax(220px, 220px))`,
                          minWidth: `${
                            Math.max(
                              1,
                              marksLockForm.locks.filter((row) => row.level_name === levelName).length
                            ) * 236
                          }px`,
                        }}
                      >
                        {marksLockForm.locks
                          .filter((row) => row.level_name === levelName)
                          .map((row) => (
                            <div key={getMarksLockRowKey(levelName, row.aoi_label)} className="calendar-entry-card">
                              <div className="calendar-entry-heading">
                                <div>
                                  <strong>{formatMarksLockComponentLabel(row.aoi_label)}</strong>
                                  <small>{row.effective_locked ? "Currently Locked" : "Open for Entry"}</small>
                                </div>
                              </div>

                              <div className="form-row" style={{ marginBottom: "0.75rem" }}>
                                <label>Deadline</label>
                                <input
                                  type="datetime-local"
                                  value={row.deadline_at || ""}
                                  onChange={(e) =>
                                    handleMarksLockRowChange(
                                      row.level_name,
                                      row.aoi_label,
                                      "deadline_at",
                                      e.target.value
                                    )
                                  }
                                />
                              </div>

                              <label
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.55rem",
                                  color: "#e2e8f0",
                                  fontSize: "0.85rem",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={Boolean(row.is_locked)}
                                  onChange={(e) =>
                                    handleMarksLockRowChange(
                                      row.level_name,
                                      row.aoi_label,
                                      "is_locked",
                                      e.target.checked
                                    )
                                  }
                                />
                                <span>
                                  Lock {formatMarksLockComponentLabel(row.aoi_label)} immediately
                                </span>
                              </label>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>

                <button type="submit" className="primary-btn" disabled={marksLockSaving}>
                  {marksLockSaving ? "Saving Locks…" : "Save Marks Lock Settings"}
                </button>
              </form>
            </div>

            <div className="panel-card">
              <div className="panel-card-header" style={{ marginBottom: "1rem" }}>
                <div>
                  <h3 style={{ marginBottom: "0.2rem" }}>Teacher Impact Preview</h3>
                  <p className="muted-text" style={{ margin: 0 }}>
                    This is the kind of warning teachers will see when deadlines close.
                  </p>
                </div>
              </div>

              <div
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(239, 68, 68, 0.28)",
                  background: "linear-gradient(135deg, rgba(127, 29, 29, 0.22), rgba(15, 23, 42, 0.92))",
                  padding: "1rem 1.05rem",
                  color: "#fecaca",
                  marginBottom: "1rem",
                }}
              >
                <div style={{ fontSize: "0.78rem", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 800, marginBottom: "0.45rem" }}>
                  System Lockdown Notice
                </div>
                <div style={{ color: "#f8fafc", fontWeight: 700, lineHeight: 1.6 }}>
                  System locked down: deadline for marks entry has passed for{" "}
                  <strong>
                    {marksLockForm.locks
                      .filter((row) => row.effective_locked)
                      .map(
                        (row) =>
                          `${row.level_name} ${formatMarksLockComponentLabel(row.aoi_label)}`
                      )
                      .join(", ") || "no components yet"}
                  </strong>
                  .
                </div>
              </div>

              <div className="teachers-table-wrapper" style={{ maxHeight: "56vh" }}>
                <table className="teachers-table">
                  <thead>
                    <tr>
                      <th>Level</th>
                      <th>Component</th>
                      <th>Deadline</th>
                      <th>Manual Lock</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marksLockForm.locks.map((row) => (
                      <tr key={getMarksLockRowKey(row.level_name, row.aoi_label)}>
                        <td>{row.level_name}</td>
                        <td>{formatMarksLockComponentLabel(row.aoi_label)}</td>
                        <td>{row.deadline_at ? formatDateTime(row.deadline_at) : "—"}</td>
                        <td>{row.is_locked ? "Yes" : "No"}</td>
                        <td>{row.effective_locked ? row.lock_reason || "Locked" : "Open"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
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
                    <th>Assigned Optionals ({OPTIONAL_SUBJECTS.length})</th>
                    <th>Missing Optional Subjects</th>
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
                      <td>{row.optionalCount} • {row.assignedOptionalSubjects.join(", ") || "No optional subjects assigned"}</td>
                      <td>{row.missingOptionalSubjects?.length ? row.missingOptionalSubjects.join(", ") : "All optionals assigned"}</td>
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
    onClick={() => openAdminSettings("password")}
  >
    Settings
  </button>

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

  <div className="admin-ops-grid">
    <article className="admin-ops-card">
      <div className="admin-ops-card-head">
        <div>
          <h3>Assessment Compliance</h3>
          <p>{dashboardOperationalTerm} {dashboardOperationalYear} snapshot</p>
        </div>
        <span className="admin-ops-badge admin-ops-badge-blue">Live</span>
      </div>
      <div className="admin-ops-control-row">
        <label className="admin-ops-select-label" htmlFor="assessment-compliance-aoi">
          O-Level Coverage View
        </label>
        <select
          id="assessment-compliance-aoi"
          className="admin-ops-select"
          value={assessmentComplianceAoi}
          onChange={(event) => setAssessmentComplianceAoi(event.target.value)}
        >
          {O_LEVEL_AOI_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="admin-ops-kpi-grid">
        <div className="admin-ops-kpi">
          <span>O-Level</span>
          <strong>{assessmentCompliance.oLevelSubmitted} / {assessmentCompliance.oLevelTotal}</strong>
          <small>{assessmentCompliance.oLevelPending} pending assignments</small>
        </div>
        <div className="admin-ops-kpi">
          <span>A-Level</span>
          <strong>{assessmentCompliance.aLevelSubmitted} / {assessmentCompliance.aLevelTotal}</strong>
          <small>{assessmentCompliance.aLevelPending} pending papers</small>
        </div>
      </div>
      <div className="admin-ops-meter-block">
        <div className="admin-ops-meter-label">
          <span>{selectedAssessmentAoiLabel} Coverage</span>
          <strong>{selectedAssessmentAoiRate}%</strong>
        </div>
        <div className="admin-ops-meter">
          <div style={{ width: `${selectedAssessmentAoiRate}%` }} />
        </div>
        <small className="admin-ops-subnote">
          {selectedAssessmentAoiSubmitted} of {assessmentCompliance.oLevelTotal} O-Level assignments have submitted {selectedAssessmentAoiLabel}.
        </small>
      </div>
      <div className="admin-ops-inline-meters">
        {O_LEVEL_AOI_OPTIONS.map((option) => (
          <div
            key={option.value}
            className={`admin-ops-inline-meter-card ${
              option.value === assessmentComplianceAoi ? "is-active" : ""
            }`}
          >
            <div className="admin-ops-meter-label">
              <span>{option.label}</span>
              <strong>{assessmentCompliance.oLevelAoiRates?.[option.value] ?? 0}%</strong>
            </div>
            <div className="admin-ops-meter">
              <div style={{ width: `${assessmentCompliance.oLevelAoiRates?.[option.value] ?? 0}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="admin-ops-meter-block">
        <div className="admin-ops-meter-label">
          <span>A-Level MID / EOT Coverage</span>
          <strong>{assessmentCompliance.aLevelMidEotRate}%</strong>
        </div>
        <div className="admin-ops-meter admin-ops-meter-amber">
          <div style={{ width: `${assessmentCompliance.aLevelMidEotRate}%` }} />
        </div>
      </div>
    </article>

    <article className="admin-ops-card">
      <div className="admin-ops-card-head">
        <div>
          <h3>Ready-To-Print Center</h3>
          <p>Fast PTA and office print shortcuts</p>
        </div>
        <span className="admin-ops-badge admin-ops-badge-gold">Print</span>
      </div>
      <div className="admin-ops-action-grid">
        <button type="button" className="ghost-btn" onClick={() => setActiveSection("Mini Reports")}>
          Mini Reports
        </button>
        <button type="button" className="ghost-btn" onClick={() => setActiveSection("Download Marks")}>
          Download Marks
        </button>
        <button type="button" className="ghost-btn" onClick={() => setActiveSection("End of Term Reports")}>
          Term Reports
        </button>
        <button type="button" className="ghost-btn" onClick={() => setActiveSection("End of Year Reports")}>
          Year Reports
        </button>
        <button type="button" className="ghost-btn" onClick={() => setShowEnrollmentChartsModal(true)}>
          Enrollment PDF
        </button>
      </div>
      <p className="admin-ops-note">
        Use this as the quick office desk for parent meetings, marksheets and summary exports.
      </p>
    </article>

    <article className="admin-ops-card">
      <div className="admin-ops-card-head">
        <div>
          <h3>School Status</h3>
          <p>Shared live calendar and marks control</p>
        </div>
        <span
          className={`admin-ops-badge ${
            schoolCalendarBadge.status === "In Session"
              ? "admin-ops-badge-green"
              : schoolCalendarBadge.status === "Holiday Break"
              ? "admin-ops-badge-gold"
              : "admin-ops-badge-neutral"
          }`}
        >
          {schoolCalendarBadge.status}
        </span>
      </div>
      <div className="admin-ops-pill-row">
        <span className="calendar-pill calendar-pill-year">AY {schoolCalendarBadge.academicYear}</span>
        <span className="calendar-pill">{schoolCalendarBadge.termLabel}</span>
      </div>
      <div className="admin-ops-countdown">
        {schoolCalendarPreciseCountdown.label || "Waiting for active calendar window"}
      </div>
      <div className="admin-ops-kpi-grid">
        <div className="admin-ops-kpi">
          <span>Today</span>
          <strong>{formatDateOnly(schoolCalendarPreviewClock)}</strong>
          <small>{dashboardOperationalTerm}</small>
        </div>
        <div className="admin-ops-kpi">
          <span>Locked Components</span>
          <strong>{activeSchoolStatusLocks.length}</strong>
          <small>
            {activeSchoolStatusLocks.length
              ? activeSchoolStatusLocks
                  .slice(0, 3)
                  .map((row) => formatMarksLockComponentLabel(row.aoi_label))
                  .join(", ")
              : "All entry windows open"}
          </small>
        </div>
      </div>
    </article>

    <article className="admin-ops-card">
      <div className="admin-ops-card-head">
        <div>
          <h3>Report Readiness</h3>
          <p>Ready = learner has at least one submitted score this term</p>
        </div>
        <span className="admin-ops-badge admin-ops-badge-rose">{reportReadinessCard.combined.readinessPercent}%</span>
      </div>
      <div className="admin-ops-meter-block">
        <div className="admin-ops-meter-label">
          <span>O-Level</span>
          <strong>{reportReadinessCard.oLevel.readyLearners} / {reportReadinessCard.oLevel.totalLearners}</strong>
        </div>
        <div className="admin-ops-meter">
          <div style={{ width: `${reportReadinessCard.oLevel.readinessPercent}%` }} />
        </div>
        <button
          type="button"
          className="admin-ops-subnote-button"
          disabled={reportReadinessCard.oLevel.incompleteLearners === 0 || readinessPdfLoadingLevel === "oLevel"}
          onClick={() => handleDownloadReadinessDetailsPdf("oLevel")}
        >
          {readinessPdfLoadingLevel === "oLevel"
            ? "Opening O-Level readiness PDF…"
            : `${reportReadinessCard.oLevel.incompleteLearners} learners still incomplete • Open PDF`}
        </button>
      </div>
      <div className="admin-ops-meter-block">
        <div className="admin-ops-meter-label">
          <span>A-Level</span>
          <strong>{reportReadinessCard.aLevel.readyLearners} / {reportReadinessCard.aLevel.totalLearners}</strong>
        </div>
        <div className="admin-ops-meter admin-ops-meter-cyan">
          <div style={{ width: `${reportReadinessCard.aLevel.readinessPercent}%` }} />
        </div>
        <button
          type="button"
          className="admin-ops-subnote-button"
          disabled={reportReadinessCard.aLevel.incompleteLearners === 0 || readinessPdfLoadingLevel === "aLevel"}
          onClick={() => handleDownloadReadinessDetailsPdf("aLevel")}
        >
          {readinessPdfLoadingLevel === "aLevel"
            ? "Opening A-Level readiness PDF…"
            : `${reportReadinessCard.aLevel.incompleteLearners} learners still incomplete • Open PDF`}
        </button>
      </div>
      {reportReadinessError && (
        <p className="admin-ops-note" style={{ color: "#fca5a5", marginTop: "0.15rem" }}>
          {reportReadinessError}
        </p>
      )}
    </article>

    <article className="admin-ops-card">
      <div className="admin-ops-card-head">
        <div>
          <h3>Class Readiness Snapshot</h3>
          <p>O-Level class-by-class view of report readiness for {reportReadinessCard.term}</p>
        </div>
        <span className="admin-ops-badge admin-ops-badge-blue">S1–S4</span>
      </div>

      <div className="admin-ops-class-readiness-list">
        {(reportReadinessCard.oLevel.byClass || []).map((row) => {
          const toneClass =
            row.readinessPercent >= 85
              ? "is-strong"
              : row.readinessPercent >= 60
              ? "is-watch"
              : "is-attention";
          const toneLabel =
            row.readinessPercent >= 85
              ? "Strong"
              : row.readinessPercent >= 60
              ? "Watch"
              : "Needs Attention";

          return (
            <div key={row.classLevel} className="admin-ops-class-readiness-row">
              <div className="admin-ops-class-readiness-top">
                <div>
                  <strong>{row.classLevel}</strong>
                  <span>
                    {row.readyLearners} ready • {row.incompleteLearners} incomplete • {row.totalLearners} total
                  </span>
                </div>
                <span className={`admin-ops-class-status ${toneClass}`}>{toneLabel}</span>
              </div>
              <div className="admin-ops-meter admin-ops-meter-class">
                <div style={{ width: `${row.readinessPercent}%` }} />
              </div>
              <div className="admin-ops-class-readiness-foot">
                <span>{row.readinessPercent}% ready</span>
                <span>{row.incompleteLearners} learners still need completion</span>
              </div>
            </div>
          );
        })}
      </div>
    </article>

    <article className="admin-ops-card">
      <div className="admin-ops-card-head">
        <div>
          <h3>Teacher Load Summary</h3>
          <p>Quick staffing and teaching slot picture</p>
        </div>
        <span className="admin-ops-badge admin-ops-badge-purple">Staff</span>
      </div>
      <div className="admin-ops-kpi-grid">
        <div className="admin-ops-kpi">
          <span>Total Teachers</span>
          <strong>{totalTeachers}</strong>
          <small>Registered accounts</small>
        </div>
        <div className="admin-ops-kpi">
          <span>Assigned Teachers</span>
          <strong>{teacherLoadSummary.assignedTeachers}</strong>
          <small>Currently carrying loads</small>
        </div>
        <div className="admin-ops-kpi">
          <span>O-Level Loads</span>
          <strong>{teacherLoadSummary.oLevelAssignments}</strong>
          <small>Active class assignments</small>
        </div>
        <div className="admin-ops-kpi">
          <span>A-Level Loads</span>
          <strong>{teacherLoadSummary.aLevelAssignments}</strong>
          <small>Active paper assignments</small>
        </div>
      </div>
      <p className="admin-ops-note">
        Total teaching slots in the system: <strong>{teacherLoadSummary.totalTeachingSlots}</strong>
      </p>
    </article>
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

        <section ref={detailSectionRef} className="admin-section">{renderSectionContent()}</section>
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

      {pendingStudentDelete && (
        <div className="modal-backdrop" onClick={() => !deletingStudentId && setPendingStudentDelete(null)}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "540px",
              background: "linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98))",
              border: "1px solid rgba(248, 113, 113, 0.24)",
              boxShadow: "0 28px 60px rgba(2, 6, 23, 0.34)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.45rem",
                padding: "0.34rem 0.72rem",
                borderRadius: "999px",
                background: "rgba(127, 29, 29, 0.2)",
                border: "1px solid rgba(248, 113, 113, 0.22)",
                color: "#fecaca",
                fontSize: "0.72rem",
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: "0.9rem",
              }}
            >
              Remove Learner
            </div>

            <h2 style={{ color: "#f8fafc", marginBottom: "0.5rem" }}>Delete This Learner?</h2>
            <p style={{ color: "#cbd5e1", lineHeight: 1.65, marginBottom: "1rem" }}>
              You are about to remove <strong>{pendingStudentDelete.name}</strong> from the learner register.
            </p>

            <div
              style={{
                padding: "0.95rem 1rem",
                borderRadius: "1rem",
                border: "1px solid rgba(148, 163, 184, 0.18)",
                background: "rgba(15, 23, 42, 0.62)",
                display: "grid",
                gap: "0.45rem",
                marginBottom: "1rem",
              }}
            >
              <div><strong>Name:</strong> {pendingStudentDelete.name}</div>
              <div><strong>Class:</strong> {pendingStudentDelete.class_level}</div>
              <div><strong>Stream:</strong> {pendingStudentDelete.stream}</div>
              <div><strong>Gender:</strong> {pendingStudentDelete.gender}</div>
              <div><strong>DOB:</strong> {pendingStudentDelete.dob || "—"}</div>
            </div>

            <div
              className="panel-alert panel-alert-error"
              style={{
                marginBottom: "1rem",
                background: "rgba(127, 29, 29, 0.16)",
                borderColor: "rgba(248, 113, 113, 0.24)",
                color: "#fecaca",
              }}
            >
              This will remove the learner from the current register. Proceed only if you are sure.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.65rem", flexWrap: "wrap" }}>
              <button
                className="ghost-btn"
                type="button"
                disabled={deletingStudentId === pendingStudentDelete.id}
                onClick={() => setPendingStudentDelete(null)}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                type="button"
                disabled={deletingStudentId === pendingStudentDelete.id}
                onClick={() =>
                  requestAdminReauth({
                    title: "Confirm Learner Deletion",
                    description: "Re-enter your admin password to remove this learner from the register.",
                    onApproved: () => handleDeleteStudent(pendingStudentDelete),
                  })
                }
                style={{
                  background: "linear-gradient(135deg, #991b1b, #dc2626)",
                  borderColor: "rgba(248, 113, 113, 0.4)",
                }}
              >
                {deletingStudentId === pendingStudentDelete.id ? "Deleting…" : "Delete Learner"}
              </button>
            </div>
          </div>
        </div>
      )}

      {adminSettingsOpen && (
        <div className="modal-backdrop" onClick={closeAdminSettings}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "640px",
              background: "linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98))",
              border: "1px solid rgba(96, 165, 250, 0.18)",
              boxShadow: "0 28px 60px rgba(2, 6, 23, 0.34)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.45rem",
                padding: "0.34rem 0.72rem",
                borderRadius: "999px",
                background: "rgba(30, 64, 175, 0.18)",
                border: "1px solid rgba(96, 165, 250, 0.22)",
                color: "#bfdbfe",
                fontSize: "0.72rem",
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: "0.9rem",
              }}
            >
              Admin Settings
            </div>

            <h2 style={{ color: "#f8fafc", marginBottom: "0.45rem" }}>Protect Your Admin Session</h2>
            <p style={{ color: "#cbd5e1", lineHeight: 1.65, marginBottom: "1rem" }}>
              Update the admin password here. Destructive actions now require a recent password confirmation, and idle logout is set to <strong>15 minutes</strong>.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                gap: "0.8rem",
                marginBottom: "1rem",
              }}
            >
              {[
                { label: "Admin Username", value: adminIdentity.username || "admin" },
                { label: "Idle Logout", value: "15 minutes" },
                { label: "Re-auth Window", value: "10 minutes" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    borderRadius: "16px",
                    padding: "0.85rem 0.95rem",
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    background: "rgba(15, 23, 42, 0.58)",
                  }}
                >
                  <div style={{ color: "#93c5fd", fontSize: "0.73rem", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    {item.label}
                  </div>
                  <div style={{ color: "#f8fafc", fontSize: "1rem", fontWeight: 800, marginTop: "0.35rem" }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: "inline-flex",
                gap: "0.45rem",
                padding: "0.28rem",
                borderRadius: "999px",
                background: "rgba(15, 23, 42, 0.52)",
                border: "1px solid rgba(148, 163, 184, 0.18)",
                marginBottom: "1rem",
              }}
            >
              <button
                type="button"
                className={adminSettingsMode === "password" ? "primary-btn" : "ghost-btn"}
                onClick={() => {
                  setAdminSettingsMode("password");
                  setAdminSettingsError("");
                  setAdminSettingsNotice("");
                }}
              >
                Change Password
              </button>
            </div>

            {adminSettingsError && (
              <div className="panel-alert panel-alert-error" style={{ marginBottom: "0.9rem" }}>
                {adminSettingsError}
              </div>
            )}
            {adminSettingsNotice && (
              <div className="panel-alert panel-alert-success" style={{ marginBottom: "0.9rem" }}>
                {adminSettingsNotice}
              </div>
            )}

            <div
              style={{
                padding: "1rem",
                borderRadius: "1rem",
                border: "1px solid rgba(148, 163, 184, 0.18)",
                background: "rgba(15, 23, 42, 0.62)",
                display: "grid",
                gap: "0.85rem",
              }}
            >
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span style={{ color: "#cbd5e1", fontSize: "0.82rem", fontWeight: 700 }}>Current Password</span>
                <input
                  type="password"
                  value={adminSettingsForm.currentPassword}
                  onChange={(e) =>
                    setAdminSettingsForm((prev) => ({ ...prev, currentPassword: e.target.value }))
                  }
                  style={{
                    minHeight: "46px",
                    borderRadius: "0.95rem",
                    border: "1px solid rgba(148, 163, 184, 0.3)",
                    background: "rgba(2, 6, 23, 0.92)",
                    color: "#f8fafc",
                    padding: "0.78rem 0.9rem",
                    outline: "none",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span style={{ color: "#cbd5e1", fontSize: "0.82rem", fontWeight: 700 }}>New Password</span>
                <input
                  type="password"
                  value={adminSettingsForm.newPassword}
                  onChange={(e) =>
                    setAdminSettingsForm((prev) => ({ ...prev, newPassword: e.target.value }))
                  }
                  style={{
                    minHeight: "46px",
                    borderRadius: "0.95rem",
                    border: "1px solid rgba(148, 163, 184, 0.3)",
                    background: "rgba(2, 6, 23, 0.92)",
                    color: "#f8fafc",
                    padding: "0.78rem 0.9rem",
                    outline: "none",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span style={{ color: "#cbd5e1", fontSize: "0.82rem", fontWeight: 700 }}>Confirm New Password</span>
                <input
                  type="password"
                  value={adminSettingsForm.confirmPassword}
                  onChange={(e) =>
                    setAdminSettingsForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                  }
                  style={{
                    minHeight: "46px",
                    borderRadius: "0.95rem",
                    border: "1px solid rgba(148, 163, 184, 0.3)",
                    background: "rgba(2, 6, 23, 0.92)",
                    color: "#f8fafc",
                    padding: "0.78rem 0.9rem",
                    outline: "none",
                  }}
                />
              </label>
            </div>

            <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end", gap: "0.7rem", flexWrap: "wrap" }}>
              <button type="button" className="ghost-btn" onClick={closeAdminSettings} disabled={savingAdminSettings}>
                Close
              </button>
              <button type="button" className="primary-btn" onClick={handleChangeAdminPassword} disabled={savingAdminSettings}>
                {savingAdminSettings ? "Saving…" : "Update Password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {reauthPrompt && (
        <div className="modal-backdrop" onClick={closeReauthPrompt}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "520px",
              background: "linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98))",
              border: "1px solid rgba(96, 165, 250, 0.18)",
              boxShadow: "0 28px 60px rgba(2, 6, 23, 0.34)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.45rem",
                padding: "0.34rem 0.72rem",
                borderRadius: "999px",
                background: "rgba(30, 64, 175, 0.18)",
                border: "1px solid rgba(96, 165, 250, 0.22)",
                color: "#bfdbfe",
                fontSize: "0.72rem",
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: "0.9rem",
              }}
            >
              Admin Re-authentication
            </div>

            <h2 style={{ color: "#f8fafc", marginBottom: "0.55rem" }}>
              {reauthPrompt.title || "Confirm Admin Password"}
            </h2>
            <p style={{ color: "#cbd5e1", lineHeight: 1.65, marginBottom: "1rem" }}>
              {reauthPrompt.description}
            </p>

            {reauthError && (
              <div className="panel-alert panel-alert-error" style={{ marginBottom: "0.9rem" }}>
                {reauthError}
              </div>
            )}

            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span style={{ color: "#cbd5e1", fontSize: "0.82rem", fontWeight: 700 }}>Admin Password</span>
              <input
                type="password"
                value={reauthPassword}
                onChange={(e) => setReauthPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleConfirmReauth();
                  }
                }}
                style={{
                  minHeight: "46px",
                  borderRadius: "0.95rem",
                  border: "1px solid rgba(148, 163, 184, 0.3)",
                  background: "rgba(2, 6, 23, 0.92)",
                  color: "#f8fafc",
                  padding: "0.78rem 0.9rem",
                  outline: "none",
                }}
              />
            </label>

            <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end", gap: "0.7rem", flexWrap: "wrap" }}>
              <button type="button" className="ghost-btn" onClick={closeReauthPrompt} disabled={reauthLoading}>
                Cancel
              </button>
              <button type="button" className="primary-btn" onClick={handleConfirmReauth} disabled={reauthLoading}>
                {reauthLoading ? "Confirming…" : "Confirm Password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
