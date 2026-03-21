// src/pages/TeacherDashboard.jsx
import React, { useEffect, useState, useCallback } from "react";
import "./AdminDashboard.css";
import badge from "../assets/badge.png";
import useIdleLogout from "../hooks/useIdleLogout";
import { useNavigate } from "react-router-dom";
import { plainFetch } from "../lib/api";
import { loadPdfTools } from "../utils/loadPdfTools";

// ============================
// CONSTANTS / CONFIG
// ============================
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";

// ============================
// HELPERS
// ============================
const formatDateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
};

const getMarkColumns = (isAlevel, term) => {
  if (isAlevel) return ["MID", "EOT"];
  return term === "Term 3" ? ["AOI1", "AOI2", "AOI3", "EXAM80"] : ["AOI1", "AOI2", "AOI3"];
};

const getScoreConstraints = (isAlevel, aoi) => {
  if (isAlevel) return { min: 0, max: 100, step: 1 };
  if (aoi === "EXAM80") return { min: 0, max: 80, step: 1 };
  return { min: 0.9, max: 3.0, step: 0.1 };
};

const calculateAverage = (marksObj, averageColumns) => {
  const values = (averageColumns || [])
    .map((c) => marksObj?.[c])
    .map((v) => {
      if (v === null || v === undefined || v === "" || v === "Missed") return null;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : null;
    })
    .filter((v) => v !== null);
  if (values.length === 0) return "—";
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return avg.toFixed(2);
};

const getAssignmentDisplayLabel = (assignment) => {
  if (!assignment) return "—";
  if (assignment.subject_display) return assignment.subject_display;
  if (assignment.paper_label && assignment.paper_label !== "Single") {
    return `${assignment.subject} — ${assignment.paper_label}`;
  }
  return assignment.subject || "—";
};

const formatColumnLabel = (column) => {
  if (!column) return "—";
  return column === "EXAM80" ? "/80" : column;
};

const matchesAssignmentSearch = (assignment, rawQuery) => {
  const query = String(rawQuery || "").trim().toLowerCase();
  if (!query) return true;

  const haystack = [
    assignment?.class_level,
    assignment?.stream,
    assignment?.subject,
    assignment?.subject_display,
    assignment?.paper_label,
    assignment?.isAlevel ? "a level" : "o level",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
};

// ============================
// MAIN COMPONENT
// ============================
export default function TeacherDashboard({ teacher: initialTeacher, onLogout }) {
  const navigate = useNavigate();

  // ----------------------------
  // Session / Idle logout
  // ----------------------------
  const handleLogout = useCallback(() => {
    localStorage.removeItem("teacherToken");
    localStorage.removeItem("teacherProfile");

    if (typeof onLogout === "function") {
      onLogout();
    } else {
      window.location.href = "/ark/teacher-login";
    }
  }, [onLogout]);

  const resetIdleTimer = useIdleLogout(() => {
    localStorage.clear();
    navigate("/", { replace: true });
  }, 60 * 60 * 1000);

  // ----------------------------
  // Orientation hint (mobile)
  // ----------------------------
  const [isPortrait, setIsPortrait] = useState(
    typeof window !== "undefined" && window.matchMedia("(orientation: portrait)").matches
  );
  const [isMobileTable, setIsMobileTable] = useState(
    typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const handler = (e) => setIsPortrait(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else if (mq.addListener) mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else if (mq.removeListener) mq.removeListener(handler);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const handler = (e) => setIsMobileTable(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else if (mq.addListener) mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else if (mq.removeListener) mq.removeListener(handler);
    };
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflowY: html.style.overflowY,
      bodyOverflowY: body.style.overflowY,
      htmlOverflowX: html.style.overflowX,
      bodyOverflowX: body.style.overflowX,
      htmlTouchAction: html.style.touchAction,
      bodyTouchAction: body.style.touchAction,
      htmlOverscroll: html.style.overscrollBehaviorY,
      bodyOverscroll: body.style.overscrollBehaviorY,
    };

    html.style.overflowY = "auto";
    body.style.overflowY = "auto";
    html.style.overflowX = "hidden";
    body.style.overflowX = "hidden";
    html.style.touchAction = "pan-y";
    body.style.touchAction = "pan-y";
    html.style.overscrollBehaviorY = "auto";
    body.style.overscrollBehaviorY = "auto";

    return () => {
      html.style.overflowY = previous.htmlOverflowY;
      body.style.overflowY = previous.bodyOverflowY;
      html.style.overflowX = previous.htmlOverflowX;
      body.style.overflowX = previous.bodyOverflowX;
      html.style.touchAction = previous.htmlTouchAction;
      body.style.touchAction = previous.bodyTouchAction;
      html.style.overscrollBehaviorY = previous.htmlOverscroll;
      body.style.overscrollBehaviorY = previous.bodyOverscroll;
    };
  }, []);

  // ----------------------------
  // Password modal
  // ----------------------------
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordResetMode, setPasswordResetMode] = useState(false);
  const [settingsTab, setSettingsTab] = useState("password");
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [emailForm, setEmailForm] = useState({ next: "", confirm: "", password: "" });
  const [emailError, setEmailError] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [showHelpModal, setShowHelpModal] = useState(false);

  // ----------------------------
  // Profile
  // ----------------------------
  const [teacher, setTeacher] = useState(() => {
    try {
      return initialTeacher ? initialTeacher : JSON.parse(localStorage.getItem("teacherProfile"));
    } catch {
      return null;
    }
  });

  // ----------------------------
  // Assignments / Notices / Analytics state
  // ----------------------------
  const [assignments, setAssignments] = useState([]);
  const [aLevelAssignments, setALevelAssignments] = useState([]);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [focusedColumn, setFocusedColumn] = useState(null);
  const [recentActivity, setRecentActivity] = useState({
    assignment: null,
    save: null,
    pdf: null,
  });

  const [examType, setExamType] = useState("MID"); // For A-Level
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [notices, setNotices] = useState([]);
  const [loadingNotices, setLoadingNotices] = useState(false);

  // ----------------------------
  // Marks (AOI / A-Level) state
  // ----------------------------
  const [students, setStudents] = useState([]);
  const [studentMarks, setStudentMarks] = useState({});
  const [initialStudentMarks, setInitialStudentMarks] = useState({});
  const [studentStatus, setStudentStatus] = useState({});

  const [marksYear, setMarksYear] = useState(new Date().getFullYear());
  const [marksTerm, setMarksTerm] = useState("Term 1");

  const [marksLoading, setMarksLoading] = useState(false);
  const [marksSaving, setMarksSaving] = useState(false);
  const [marksError, setMarksError] = useState("");
  const [markErrors, setMarkErrors] = useState({});
  const [pendingMissedConfirmation, setPendingMissedConfirmation] = useState(null);
  const [showMarksSavedModal, setShowMarksSavedModal] = useState(false);
  const [marksSavedSummary, setMarksSavedSummary] = useState(null);

  useEffect(() => {
    if (!teacher) return;
    const storageKey = `teacherDashboardRecentActivity:${teacher.id || teacher.email || "default"}`;

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      setRecentActivity({
        assignment: saved?.assignment || null,
        save: saved?.save || null,
        pdf: saved?.pdf || null,
      });
    } catch {
      setRecentActivity({ assignment: null, save: null, pdf: null });
    }
  }, [teacher?.id, teacher?.email]);

  useEffect(() => {
    if (!teacher) return;
    const storageKey = `teacherDashboardRecentActivity:${teacher.id || teacher.email || "default"}`;
    localStorage.setItem(storageKey, JSON.stringify(recentActivity));
  }, [recentActivity, teacher?.id, teacher?.email]);

  // ----------------------------
  // Initial data fetches
  // ----------------------------
  useEffect(() => {
    const token = localStorage.getItem("teacherToken");
    if (!token) return;

    // O-Level assignments
    fetch(`${API_BASE}/api/teachers/assignments`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setAssignments(Array.isArray(d) ? d : []))
      .catch(() => setAssignments([]));

    // A-Level assignments (robust multi-route fetch for mixed deployments)
    (async () => {
      try {
        const endpoints = [
          "/api/alevel/teachers/alevel-assignments-by-email",
          "/api/teachers/alevel-assignments",
          "/api/teachers/teachers/alevel-assignments",
          "/api/alevel/teachers/alevel-assignments",
        ];

        const collected = [];
        for (const ep of endpoints) {
          try {
            const res = await fetch(`${API_BASE}${ep}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) continue;
            const body = await res.json().catch(() => null);
            const rows = Array.isArray(body)
              ? body
              : Array.isArray(body?.assignments)
              ? body.assignments
              : Array.isArray(body?.data)
              ? body.data
              : [];
            collected.push(...rows);
          } catch {
            // try next endpoint
          }
        }

        const deduped = Array.from(
          new Map(
            collected
              .filter((r) => r && r.id != null)
              .map((r) => [
                `al-${r.id}`,
                {
                  ...r,
                  subject: r.subject ?? r.subject_name ?? "—",
                  paper_label: r.paper_label ?? "Single",
                  subject_display:
                    r.subject_display ??
                    [r.subject ?? r.subject_name ?? "—", r.paper_label && r.paper_label !== "Single" ? r.paper_label : ""]
                      .filter(Boolean)
                      .join(" — "),
                  stream: r.stream ?? "—",
                },
              ])
          ).values()
        );

        // Never merge unscoped admin assignments into teacher view.
        // Only keep rows from scoped teacher endpoints above.
        const merged = deduped;
        const finalRows = Array.from(
          new Map(
            merged
              .filter((r) => r && r.id != null)
              .map((r) => [
                `al-${r.id}`,
                {
                  ...r,
                  subject: r.subject ?? r.subject_name ?? "—",
                  paper_label: r.paper_label ?? "Single",
                  subject_display:
                    r.subject_display ??
                    [r.subject ?? r.subject_name ?? "—", r.paper_label && r.paper_label !== "Single" ? r.paper_label : ""]
                      .filter(Boolean)
                      .join(" — "),
                  stream: r.stream ?? "—",
                },
              ])
          ).values()
        );
        setALevelAssignments(finalRows);
      } catch {
        setALevelAssignments([]);
      }
    })();
  }, [teacher?.id, teacher?.name, teacher?.email]);

  useEffect(() => {
    document.title = "Teacher Dashboard | SPESS ARK";
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shouldReset = params.get("reset") === "1" || sessionStorage.getItem("teacherResetMode") === "1";
    if (shouldReset) {
      setPasswordResetMode(true);
      setSettingsTab("password");
      setShowChangePassword(true);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        setLoadingNotices(true);
        const data = await plainFetch("/api/notices");
        setNotices(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load notices:", err);
        setNotices([]);
      } finally {
        setLoadingNotices(false);
      }
    };
    load();
  }, []);

  // Reload marks when class, term or year changes
useEffect(() => {
  if (selectedAssignment) loadStudentsAndMarks(selectedAssignment);
}, [selectedAssignment, marksTerm, marksYear]);

// Reload analytics when class, term or year changes
useEffect(() => {
  if (selectedAssignment) loadAnalytics(selectedAssignment);
}, [selectedAssignment, marksYear, marksTerm]);

  const closeSettingsModal = useCallback(() => {
    setShowChangePassword(false);
    setSettingsNotice("");
    setPasswordError("");
    setEmailError("");
    setPasswordForm({ current: "", next: "", confirm: "" });
    setEmailForm({ next: "", confirm: "", password: "" });
    setSettingsTab("password");

    if (passwordResetMode) {
      sessionStorage.removeItem("teacherResetMode");
      setPasswordResetMode(false);
      navigate("/ark/teacher", { replace: true });
    }
  }, [navigate, passwordResetMode]);

  // ============================
  // API: load analytics
  // ============================
  const loadAnalytics = async (assignment) => {
    if (!assignment) return;

    try {
      setAnalyticsLoading(true);
      const token = localStorage.getItem("teacherToken");
      const isAlevel = assignment.isAlevel === true;

      const params = new URLSearchParams({
        assignmentId: assignment.id,
        year: marksYear,
        term: marksTerm,      // ✅ ALWAYS include term
      });
      

      const endpoint = isAlevel
        ? "/api/alevel/alevel-analytics/subject"
        : "/api/teachers/analytics/subject";

      const res = await fetch(`${API_BASE}${endpoint}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Failed to load analytics");
      const data = await res.json();
      setAnalytics(data);
    } catch (err) {
      console.error("Analytics load error:", err);
      setAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  // ============================
  // API: load students & marks (handles O-Level AOIs and A-Level MID/EOT)
  // ============================
  const loadStudentsAndMarks = async (assignment) => {
    const isAlevel = assignment.isAlevel === true;
    const token = localStorage.getItem("teacherToken");
    if (!token || !assignment) return;

    try {
      setMarksLoading(true);
      setMarksError("");

      // 1) fetch students
      const studentsRes = await fetch(
        `${API_BASE}${isAlevel ? 
          `/api/alevel/teachers/alevel-assignments/${assignment.id}/students` :
          `/api/teachers/assignments/${assignment.id}/students`
        }`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      

      if (!studentsRes.ok) {
        const text = await studentsRes.text();
        throw new Error(text || `Failed to load students (${studentsRes.status})`);
      }

      const dataStudents = await studentsRes.json();
      const studentsList = Array.isArray(dataStudents)
        ? dataStudents
        : Array.isArray(dataStudents.students)
        ? dataStudents.students
        : [];

      // 2) fetch marks
      let marks = [];
      if (isAlevel) {
        const params = new URLSearchParams({ assignmentId: assignment.id, year: marksYear,term:marksTerm });
        const resMarks = await fetch(`${API_BASE}/api/alevel/teachers/alevel-marks?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        if (resMarks.ok) marks = await resMarks.json();
        else console.warn("A-Level marks warning:", await resMarks.text());
      } else {
        const params = new URLSearchParams({ assignmentId: assignment.id, year: marksYear, term: marksTerm });
        const resMarks = await fetch(`${API_BASE}/api/teachers/marks?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        if (resMarks.ok) marks = await resMarks.json();
        else console.warn("O-Level marks warning:", await resMarks.text());
      }

      // 3) normalize marks into maps: marksMap[studentId][aoiLabel] = value/status
      const marksMap = {};
      const statusMap = {};

      (marks || []).forEach((m) => {
        if (!marksMap[m.student_id]) marksMap[m.student_id] = {};
        if (!statusMap[m.student_id]) statusMap[m.student_id] = {};

        const aoi = (m.aoi_label || "").toUpperCase();
        if (!aoi) return;

        if (m.status === "Missed") {
          marksMap[m.student_id][aoi] = "Missed";
          statusMap[m.student_id][aoi] = "Missed";
        } else {
          marksMap[m.student_id][aoi] = m.score;
          statusMap[m.student_id][aoi] = "Present";
        }
      });

      // 4) initialize student marks/status using the appropriate columns
      const columns = getMarkColumns(isAlevel, marksTerm);

      const studentMarksInit = {};
      const studentStatusInit = {};

      studentsList.forEach((s) => {
        studentMarksInit[s.id] = {};
        studentStatusInit[s.id] = {};
        columns.forEach((col) => {
          // support lower-case keys from older servers as well
          studentMarksInit[s.id][col] =
            marksMap[s.id]?.[col] ?? marksMap[s.id]?.[col.toLowerCase()] ?? undefined;

          studentStatusInit[s.id][col] = statusMap[s.id]?.[col] ?? "Present";
        });
      });

      setStudents(studentsList);
      setStudentMarks(studentMarksInit);
      setInitialStudentMarks(studentMarksInit);
      setStudentStatus(studentStatusInit);
      setMarkErrors({});
    } catch (err) {
      console.error("Load students/marks error:", err);
      setMarksError("Failed to load learners or marks.");
      setStudents([]);
      setStudentMarks({});
      setInitialStudentMarks({});
      setStudentStatus({});
    } finally {
      setMarksLoading(false);
    }
  };

  // ----------------------------
  // Change password handler
  // ----------------------------
  const handleChangePassword = async () => {
    setPasswordError("");
    setSettingsNotice("");

    if (!passwordResetMode && !passwordForm.current) {
      setPasswordError("All fields are required.");
      return;
    }

    if (!passwordForm.next || !passwordForm.confirm) {
      setPasswordError("All fields are required.");
      return;
    }

    if (passwordForm.next.length < 6) {
      setPasswordError("New password must be at least 6 characters.");
      return;
    }

    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError("Passwords do not match.");
      return;
    }

    try {
      setPasswordSaving(true);
      const token = localStorage.getItem("teacherToken");

      const endpoint = passwordResetMode
        ? "/api/teachers/reset-password"
        : "/api/teachers/change-password";

      const payload = passwordResetMode
        ? { newPassword: passwordForm.next }
        : { currentPassword: passwordForm.current, newPassword: passwordForm.next };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to change password");

      setSettingsNotice("Password updated successfully.");
      if (passwordResetMode) {
        sessionStorage.removeItem("teacherResetMode");
        setShowChangePassword(false);
        setPasswordResetMode(false);
        navigate("/ark/teacher", { replace: true });
      }
      setPasswordForm({ current: "", next: "", confirm: "" });
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleChangeEmail = async () => {
    setEmailError("");
    setSettingsNotice("");

    if (!emailForm.next || !emailForm.confirm || !emailForm.password) {
      setEmailError("All fields are required.");
      return;
    }

    const normalizedNext = String(emailForm.next || "").trim().toLowerCase();
    const normalizedConfirm = String(emailForm.confirm || "").trim().toLowerCase();

    if (normalizedNext !== normalizedConfirm) {
      setEmailError("Email addresses do not match.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedNext)) {
      setEmailError("Enter a valid email address.");
      return;
    }

    try {
      setEmailSaving(true);
      const token = localStorage.getItem("teacherToken");

      const res = await fetch(`${API_BASE}/api/teachers/change-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword: emailForm.password,
          newEmail: normalizedNext,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to change email");

      if (data?.token) {
        localStorage.setItem("teacherToken", data.token);
      }
      if (data?.teacher) {
        localStorage.setItem("teacherProfile", JSON.stringify(data.teacher));
        setTeacher(data.teacher);
      }

      setEmailForm({ next: "", confirm: "", password: "" });
      setSettingsNotice("Email updated successfully.");
    } catch (err) {
      setEmailError(err.message);
    } finally {
      setEmailSaving(false);
    }
  };

  // ----------------------------
  // Helpers for mark UI
  // ----------------------------
  const setAOIStatus = (studentId, aoi, value) => {
    resetIdleTimer();
    setStudentStatus((p) => {
      const copy = { ...(p || {}) };
      copy[studentId] = { ...(copy[studentId] || {}), [aoi]: value };
      return copy;
    });

    if (value === "Missed") {
      setStudentMarks((p) => ({ ...(p || {}), [studentId]: { ...(p?.[studentId] || {}), [aoi]: "Missed" } }));
      setMarkErrors((prev) => {
        const copy = { ...prev };
        delete copy[`${studentId}_${aoi}`];
        return copy;
      });
    } else {
      setStudentMarks((p) => {
        const copy = { ...(p || {}) };
        copy[studentId] = { ...(copy[studentId] || {}), [aoi]: copy[studentId]?.[aoi] === "Missed" ? "" : copy[studentId]?.[aoi] };
        return copy;
      });
    }
  };

  const setAOIScore = (studentId, aoi, raw) => {
    resetIdleTimer();
    if (raw === "") {
      setStudentMarks((p) => ({ ...(p || {}), [studentId]: { ...(p?.[studentId] || {}), [aoi]: "" } }));
      setMarkErrors((p) => {
        const copy = { ...(p || {}) };
        delete copy[`${studentId}_${aoi}`];
        return copy;
      });
      return;
    }

    const num = Number(raw);
    const isAlevel = selectedAssignment?.isAlevel === true;
    const limits = getScoreConstraints(isAlevel, aoi);

    if (Number.isNaN(num) || num < limits.min || num > limits.max) {
      const msg = aoi === "EXAM80"
        ? "Score must be between 0 and 80"
        : isAlevel
        ? "Score must be between 0 and 100"
        : "Score must be between 0.9 and 3.0";
      setMarkErrors((p) => ({ ...(p || {}), [`${studentId}_${aoi}`]: msg }));
      return;
    }

    setMarkErrors((p) => {
      const copy = { ...(p || {}) };
      delete copy[`${studentId}_${aoi}`];
      return copy;
    });

    setStudentMarks((p) => ({ ...(p || {}), [studentId]: { ...(p?.[studentId] || {}), [aoi]: num } }));
  };

  // ----------------------------
  // Save marks (respects AOI columns or A-Level MID/EOT)
  // ----------------------------
  const handleSaveMarks = async ({ confirmedMissing = false } = {}) => {
    resetIdleTimer();
    if (!selectedAssignment) return;
    const token = localStorage.getItem("teacherToken");
    if (!token) return;

    try {
      setShowMarksSavedModal(false);
      const payload = [];
      const clearMarks = [];
      const errors = {};
      const isAlevel = selectedAssignment?.isAlevel === true;
      const columns = getMarkColumns(isAlevel, marksTerm);
      const autoMissedCells = new Set();

      if (!isAlevel) {
        const aoiColumns = columns.filter((aoi) => aoi === "AOI1" || aoi === "AOI2" || aoi === "AOI3");
        const activeAoiColumns = aoiColumns.filter((aoi) =>
          students.some((s) => {
            const currentScore = studentMarks[s.id]?.[aoi];
            const currentStatus = studentStatus[s.id]?.[aoi];
            const hadSavedValue = initialStudentMarks[s.id]?.[aoi] !== undefined;
            const hasScore = currentScore !== undefined && currentScore !== null && currentScore !== "" && currentScore !== "Missed";
            return hasScore || currentStatus === "Missed" || hadSavedValue;
          })
        );

        const missingByAoi = activeAoiColumns
          .map((aoi) => ({
            aoi,
            learners: students.filter((s) => {
              const score = studentMarks[s.id]?.[aoi];
              const status = studentStatus[s.id]?.[aoi];
              const isEmptyScore = score === undefined || score === null || score === "" || score === "Missed";
              return status !== "Missed" && isEmptyScore;
            }),
          }))
          .filter((entry) => entry.learners.length > 0);

        if (missingByAoi.length > 0 && !confirmedMissing) {
          setPendingMissedConfirmation(missingByAoi);
          setMarksError("");
          return;
        }

        if (missingByAoi.length > 0) {
          setPendingMissedConfirmation(null);
          setMarksError("");
          missingByAoi.forEach(({ aoi, learners }) => {
            learners.forEach((learner) => {
              autoMissedCells.add(`${learner.id}_${aoi}`);
            });
          });
        } else if (confirmedMissing) {
          setPendingMissedConfirmation(null);
        }
      }

      for (const s of students) {
        const marksByAoi = studentMarks[s.id] || {};
        const statusByAoi = studentStatus[s.id] || {};

        for (const aoi of columns) {
          const autoMissed = autoMissedCells.has(`${s.id}_${aoi}`);
          const score = autoMissed ? "Missed" : marksByAoi[aoi];
          const status = autoMissed ? "Missed" : statusByAoi[aoi];
          const hadSavedValue = initialStudentMarks[s.id]?.[aoi] !== undefined;

          const scoreTouched = score !== undefined && score !== null && score !== "" && score !== "Missed";
          const statusTouched = status === "Missed";

          if (!scoreTouched && !statusTouched) {
            if (hadSavedValue) {
              clearMarks.push({ studentId: s.id, aoi });
            }
            continue;
          }

          if (status === "Missed") {
            payload.push({ studentId: s.id, aoi, score: "Missed" });
            continue;
          }

          if (!scoreTouched) {
            if (hadSavedValue) {
              clearMarks.push({ studentId: s.id, aoi });
            }
            continue;
          }

          const num = Number(score);
          const limits = getScoreConstraints(isAlevel, aoi);

          if (Number.isNaN(num) || num < limits.min || num > limits.max) {
            errors[`${s.id}_${aoi}`] =
              aoi === "EXAM80"
                ? "Score must be between 0 and 80"
                : isAlevel
                ? "Score must be between 0 and 100"
                : "Score must be between 0.9 and 3.0";
            continue;
          }

          payload.push({ studentId: s.id, aoi, score: num });
        }
      }

      if (Object.keys(errors).length > 0) {
        setMarkErrors(errors);
        setMarksError("Please fix highlighted AOI scores.");
        return;
      }

      setMarkErrors({});
      const saveSummary = {
        assignmentLabel: getAssignmentDisplayLabel(selectedAssignment),
        term: marksTerm,
        year: marksYear,
        savedColumns: Array.from(new Set([...payload.map((item) => item.aoi), ...clearMarks.map((item) => item.aoi)])).map(formatColumnLabel),
        updatedLearners: new Set([
          ...payload.map((item) => item.studentId),
          ...clearMarks.map((item) => item.studentId),
        ]).size,
        missedRecorded: payload.filter((item) => item.score === "Missed").length,
        savedEntries: payload.length,
        clearedEntries: clearMarks.length,
        savedAt: new Date().toISOString(),
      };

      setMarksSaving(true);

      const endpoint = isAlevel ? "/api/alevel/teachers/alevel-marks" : "/api/teachers/marks";
      const payloadBody = isAlevel
        ? { assignmentId: selectedAssignment.id, year: Number(marksYear),term:marksTerm, examType, marks: payload, clearMarks }
        : { assignmentId: selectedAssignment.id, year: Number(marksYear), term: marksTerm, marks: payload, clearMarks };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payloadBody),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save marks");
      }

      await loadStudentsAndMarks(selectedAssignment);
      await loadAnalytics(selectedAssignment);
      setMarksSavedSummary(saveSummary);
      setRecentActivity((previous) => ({
        ...previous,
        save: saveSummary,
      }));
      setShowMarksSavedModal(true);
    } catch (err) {
      console.error("Save marks error:", err);
      setMarksError(err.message);
    } finally {
      setMarksSaving(false);
    }
  };

  // ----------------------------
  // PDF export (dynamic columns)
  // ----------------------------
  const handleDownloadPDF = async () => {
    if (!selectedAssignment || students.length === 0) {
      alert("Select a class and load learners first.");
      return;
    }

    const { jsPDF, autoTable } = await loadPdfTools();
    const doc = new jsPDF("p", "mm", "a4");
    const img = new Image();
    img.src = badge;

    const renderPdf = () => {
      const generatedAt = new Date();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const assignmentLabel = getAssignmentDisplayLabel(selectedAssignment);
      const columns = getMarkColumns(selectedAssignment?.isAlevel === true, marksTerm);
      const hasExam80 = !selectedAssignment?.isAlevel && marksTerm === "Term 3";
      const pdfAoiColumns = hasExam80 ? columns.filter((c) => c !== "EXAM80") : columns;
      const pdfAverageColumns = selectedAssignment?.isAlevel ? ["MID", "EOT"] : ["AOI1", "AOI2", "AOI3"];
      const scoreColumns = [...pdfAoiColumns, ...(hasExam80 ? ["EXAM80"] : [])];
      const head = ["#", "Learner", "Gender", ...pdfAoiColumns.map(formatColumnLabel), "Avg", ...(hasExam80 ? ["/80"] : [])];
      const metadataCards = [
        {
          label: "Assignment",
          value: assignmentLabel,
        },
        {
          label: "Class / Stream",
          value: `${selectedAssignment.class_level} • ${selectedAssignment.stream}`,
        },
        {
          label: "Session",
          value: `${marksTerm} • ${marksYear}`,
        },
        {
          label: "Teacher / Learners",
          value: `${teacher?.name || "Teacher"} • ${students.length}`,
        },
      ];

      const missedCount = students.reduce((count, learner) => {
        return count + scoreColumns.filter((column) => studentMarks[learner.id]?.[column] === "Missed").length;
      }, 0);

      const tableBody = students.map((s, i) => {
        const m = studentMarks[s.id] || {};
        const cells = pdfAoiColumns.map((c) => {
          const v = m[c];
          return v === undefined || v === null || v === "" ? "" : v === "Missed" ? "Missed" : String(v);
        });
        const exam80 = hasExam80 ? m.EXAM80 : undefined;
        const exam80Cell = exam80 === undefined || exam80 === null || exam80 === "" ? "" : exam80 === "Missed" ? "Missed" : String(exam80);
        const numeric = pdfAverageColumns
          .map((c) => {
            const v = m[c];
            if (v === null || v === undefined || v === "" || v === "Missed") return null;
            if (typeof v === "number") return Number.isFinite(v) ? v : null;
            const parsed = Number(v);
            return Number.isFinite(parsed) ? parsed : null;
          })
          .filter((v) => v !== null);
        const avg = numeric.length ? (numeric.reduce((a, b) => a + b, 0) / numeric.length).toFixed(2) : "";
        return [i + 1, s.name, s.gender, ...cells, avg, ...(hasExam80 ? [exam80Cell] : [])];
      });

      doc.setDrawColor(31, 41, 55);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(12, 10, pageWidth - 24, 28, 4, 4, "FD");

      if (img.complete && img.naturalWidth > 0) {
        doc.addImage(img, "PNG", 16, 13, 16, 16);
      }

      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(15);
      doc.text("St. Phillips Equatorial Secondary School", pageWidth / 2, 18, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(9.5);
      doc.text("Score Marksheet", pageWidth / 2, 23.5, { align: "center" });
      doc.text(`${assignmentLabel} • ${selectedAssignment.class_level} ${selectedAssignment.stream}`, pageWidth / 2, 28.5, { align: "center" });
      doc.text(`${marksTerm} ${marksYear}`, pageWidth / 2, 33, { align: "center" });

      const cardGap = 4;
      const cardWidth = (pageWidth - 28 - cardGap) / 2;
      const cardHeight = 16;
      metadataCards.forEach((card, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = 14 + column * (cardWidth + cardGap);
        const y = 42 + row * (cardHeight + 4);

        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(x, y, cardWidth, cardHeight, 3, 3, "FD");

        doc.setFont("helvetica", "bold");
        doc.setTextColor(2, 132, 199);
        doc.setFontSize(8);
        doc.text(card.label.toUpperCase(), x + 3, y + 5);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(9.2);
        doc.text(String(card.value || "—"), x + 3, y + 11.2, {
          maxWidth: cardWidth - 6,
        });
      });

      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(14, 82, pageWidth - 28, 10, 3, 3, "FD");
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(8.8);
      doc.text(`MARKS CAPTURED: ${scoreColumns.map(formatColumnLabel).join(" • ") || "—"}`, 18, 88.2);
      doc.text(`MISSED ENTRIES: ${missedCount}`, pageWidth - 18, 88.2, { align: "right" });

      autoTable(doc, {
        startY: 96,
        head: [head],
        body: tableBody,
        theme: "grid",
        margin: { left: 14, right: 14, top: 24, bottom: 18 },
        styles: {
          font: "helvetica",
          fontSize: 8.8,
          cellPadding: 3.1,
          valign: "middle",
          textColor: [15, 23, 42],
          lineColor: [203, 213, 225],
          lineWidth: 0.2,
        },
        headStyles: {
          fillColor: [226, 232, 240],
          textColor: [15, 23, 42],
          fontStyle: "bold",
          lineColor: [203, 213, 225],
          lineWidth: 0.25,
        },
        bodyStyles: {
          fillColor: [255, 255, 255],
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0: { cellWidth: 12, halign: "center" },
          1: { cellWidth: 66 },
          2: { cellWidth: 20, halign: "center" },
        },
        didParseCell: (data) => {
          const value = String(data.cell.raw ?? "").trim();
          if (data.section === "body" && value === "Missed") {
            data.cell.styles.fillColor = [254, 242, 242];
            data.cell.styles.textColor = [153, 27, 27];
            data.cell.styles.fontStyle = "bold";
          }
        },
        didDrawPage: (data) => {
          const pageNumber = data.pageNumber;
          if (pageNumber > 1) {
            doc.setDrawColor(203, 213, 225);
            doc.line(14, 12, pageWidth - 14, 12);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.setTextColor(15, 23, 42);
            doc.text(assignmentLabel, 14, 18);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(71, 85, 105);
            doc.text(`${marksTerm} ${marksYear}`, pageWidth - 14, 18, { align: "right" });
          }

          doc.setDrawColor(203, 213, 225);
          doc.line(14, pageHeight - 14, pageWidth - 14, pageHeight - 14);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(100);
          doc.text(`Generated from SPESS ARK • Submitted by ${teacher?.name || "Teacher"} • ${formatDateTime(generatedAt)}`, 14, pageHeight - 8.5);
          doc.text(`Page ${doc.internal.getNumberOfPages()}`, pageWidth - 14, pageHeight - 8.5, { align: "right" });
        },
      });

      setRecentActivity((previous) => ({
        ...previous,
        pdf: {
          assignmentLabel,
          term: marksTerm,
          year: marksYear,
          generatedAt: generatedAt.toISOString(),
        },
      }));
      window.open(doc.output("bloburl"), "_blank");
    };

    img.onload = renderPdf;
    img.onerror = renderPdf;
  };

  // ----------------------------
  // Compute dynamic columns for render
  // ----------------------------
  const renderColumns = getMarkColumns(selectedAssignment?.isAlevel === true, marksTerm);
  const hasExam80Column = !selectedAssignment?.isAlevel && marksTerm === "Term 3";
  const renderAoiColumns = hasExam80Column ? renderColumns.filter((c) => c !== "EXAM80") : renderColumns;
  const averageColumns = selectedAssignment?.isAlevel ? ["MID", "EOT"] : ["AOI1", "AOI2", "AOI3"];
  // Keep O-Level table spacing stable across Term 1/2/3 (including Term 3 /80 mode).
  const effectiveColumnCount = selectedAssignment?.isAlevel ? 2 : 4;
  const learnersTableMinWidth = Math.max(1100, 320 + effectiveColumnCount * 190);
  const learnerColWidth = 170;
  const genderColWidth = 72;
  const currentCalendarYear = new Date().getFullYear();
  const allAssignableColumns = [...renderAoiColumns, ...(hasExam80Column ? ["EXAM80"] : [])];
  const activeFocusColumn = allAssignableColumns.includes(focusedColumn) ? focusedColumn : allAssignableColumns[0] || null;
  const filteredAssignments = assignments.filter((assignment) => matchesAssignmentSearch(assignment, assignmentSearch));
  const filteredALevelAssignments = aLevelAssignments.filter((assignment) => matchesAssignmentSearch(assignment, assignmentSearch));
  const totalAssignmentsCount = assignments.length + aLevelAssignments.length;
  const visibleAssignmentsCount = filteredAssignments.length + filteredALevelAssignments.length;
  const focusSummary = activeFocusColumn
    ? students.reduce(
        (summary, learner) => {
          const status = studentStatus[learner.id]?.[activeFocusColumn] ?? "Present";
          const score = studentMarks[learner.id]?.[activeFocusColumn];
          const hasScore = score !== undefined && score !== null && score !== "" && score !== "Missed";

          if (status === "Missed") {
            summary.missed += 1;
          } else if (hasScore) {
            summary.filled += 1;
          } else {
            summary.blank += 1;
          }

          return summary;
        },
        { filled: 0, missed: 0, blank: 0 }
      )
    : { filled: 0, missed: 0, blank: 0 };
  const settingsLabelStyle = {
    color: "#334155",
    fontWeight: 800,
  };
  const settingsInputStyle = {
    background: "#ffffff",
    border: "1px solid rgba(148, 163, 184, 0.5)",
    color: "#0f172a",
    boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.05)",
    padding: "0.62rem 0.8rem",
  };
  const settingsDisabledInputStyle = {
    ...settingsInputStyle,
    background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)",
    color: "#475569",
  };
  const settingsCancelButtonStyle = {
    borderRadius: "999px",
    border: "1px solid rgba(148, 163, 184, 0.45)",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 800,
    padding: "0.65rem 1rem",
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(15, 23, 42, 0.06)",
  };
  const topPillButtonBase = {
    borderRadius: "999px",
    padding: "0.72rem 1.05rem",
    fontWeight: 800,
    fontSize: "0.76rem",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    cursor: "pointer",
    boxShadow: "0 14px 30px rgba(2, 6, 23, 0.22)",
    backdropFilter: "blur(10px)",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.55rem",
    flexShrink: 0,
    whiteSpace: "nowrap",
  };
  const topPillBadgeBase = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "28px",
    height: "28px",
    borderRadius: "999px",
    fontSize: "0.64rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
  };

  useEffect(() => {
    if (!selectedAssignment) {
      setFocusedColumn(null);
      return;
    }

    if (!allAssignableColumns.length) {
      setFocusedColumn(null);
      return;
    }

    if (!focusedColumn || !allAssignableColumns.includes(focusedColumn)) {
      setFocusedColumn(allAssignableColumns[0]);
    }
  }, [selectedAssignment?.id, focusedColumn, marksTerm, allAssignableColumns]);

  // ============================
  // RENDER
  // ============================
  return (
    <div className="admin-root teacher-root">
      {isPortrait && <div className="panel-alert">📱 Rotate your phone for better mark entry</div>}
      <header
  style={{
    position: "relative",
    height: "auto", // Changed to auto to accommodate wrapping on mobile
    minHeight: "220px",
    backgroundImage: "url(/weasel.jpg)",
    backgroundSize: "cover",
    backgroundPosition: "center",
    overflow: "hidden",
  }}
>
  {/* Overlay */}
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: "linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(15,23,42,1))",
    }}
  />

  {/* Content */}
  <div
    style={{
      position: "relative",
      zIndex: 2,
      padding: "1.5rem 1.5rem", // Slightly tighter for mobile
      display: "flex",
      flexDirection: "column",
      gap: "2rem",
    }}
  >
    {/* Top Bar */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap", // Allows buttons to drop down on tiny screens
        gap: "1rem"
      }}
    >
      {/* Left Brand */}
      <div className="brand">
        <span className="brand-dot" />
        <span className="brand-text">SPESS’S ARK</span>
        <span className="brand-tag">Teacher</span>
      </div>

      {/* Right Buttons (The Pill Container) */}
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: isMobileTable ? "flex-start" : "flex-end",
          width: isMobileTable ? "100%" : "auto",
          maxWidth: "100%",
        }}
      >
        <button
          onClick={() => {
            setSettingsNotice("");
            setPasswordError("");
            setEmailError("");
            setSettingsTab("password");
            setShowChangePassword(true);
          }}
          style={{
            ...topPillButtonBase,
            border: "1px solid rgba(125, 211, 252, 0.34)",
            background: "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(56,189,248,0.14))",
            color: "#e0f2fe",
          }}
        >
          <span
            style={{
              ...topPillBadgeBase,
              background: "rgba(15, 23, 42, 0.38)",
              color: "#7dd3fc",
            }}
          >
            ACC
          </span>
          <span>Settings</span>
        </button>

        <button
          type="button"
          onClick={() => setShowHelpModal(true)}
          style={{
            ...topPillButtonBase,
            border: "1px solid rgba(245, 158, 11, 0.34)",
            background: "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(245,158,11,0.14))",
            color: "#fef3c7",
          }}
        >
          <span
            style={{
              ...topPillBadgeBase,
              background: "rgba(15, 23, 42, 0.38)",
              color: "#fbbf24",
            }}
          >
            HLP
          </span>
          <span>Help</span>
        </button>

        <button className="nav-logout" onClick={handleLogout} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
          Logout
        </button>
      </div>
    </div>

    {/* Hero Text */}
    <div style={{ marginTop: "auto" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: "900", marginBottom: "0.4rem", color: "#fff" }}>
        Teacher Dashboard
      </h1>
      <p style={{ color: "#94a3b8", maxWidth: "500px", fontSize: "0.9rem", lineHeight: "1.5" }}>
        Manage marks, learners, and analytics with precision.
      </p>
    </div>
  </div>
</header>

      <main className="admin-main" style={{ paddingBottom: selectedAssignment && isMobileTable ? "7.5rem" : undefined }}>
        <section className="admin-heading">
          
          {teacher && <h2>👋 Hello Teacher {teacher.name}</h2>}

          <section className="teacher-notices" style={{ marginTop: "0.6rem" }}>
            <h2 className="section-title">School Notices</h2>
            {loadingNotices ? (
              <p className="muted-text">Loading notices…</p>
            ) : notices.length === 0 ? (
              <p className="muted-text">No notices at the moment.</p>
            ) : (
              <div className="notices-grid">
                {notices.map((n) => {
                  const isNew = Date.now() - new Date(n.created_at).getTime() < 24 * 60 * 60 * 1000;
                  return (
                    <div key={n.id} className="notice-card">
                      <div className="notice-header">
                        <h3>
                          {n.title} {isNew && <span className="notice-badge">NEW</span>}
                        </h3>
                      </div>
                      <div className="notice-body">
                        <p>{n.body}</p>
                      </div>
                      <div className="notice-footer">
                        <span>{formatDateTime(n.created_at)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </section>

        <section
          style={{
            marginTop: "1rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "1rem",
          }}
        >
          <div className="panel-card" style={{ background: "linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.92))" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.45rem",
                padding: "0.34rem 0.78rem",
                borderRadius: "999px",
                border: "1px solid rgba(125, 211, 252, 0.22)",
                background: "rgba(56, 189, 248, 0.08)",
                color: "#7dd3fc",
                fontSize: "0.7rem",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontWeight: 800,
                marginBottom: "0.9rem",
              }}
            >
              Teacher Profile
            </div>

            <div style={{ display: "grid", gap: "0.85rem" }}>
              <div>
                <div style={{ fontSize: "1.08rem", fontWeight: 900, color: "#f8fafc" }}>{teacher?.name || "Teacher"}</div>
                <div style={{ marginTop: "0.25rem", color: "#94a3b8", wordBreak: "break-word" }}>{teacher?.email || "—"}</div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                  gap: "0.7rem",
                }}
              >
                {[
                  { label: "O-Level", value: assignments.length, tone: "#7dd3fc" },
                  { label: "A-Level", value: aLevelAssignments.length, tone: "#fbbf24" },
                  { label: "Total", value: totalAssignmentsCount, tone: "#86efac" },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      borderRadius: "16px",
                      border: "1px solid rgba(148, 163, 184, 0.16)",
                      background: "rgba(255,255,255,0.04)",
                      padding: "0.9rem 0.95rem",
                    }}
                  >
                    <div style={{ color: item.tone, fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 800 }}>
                      {item.label}
                    </div>
                    <div style={{ marginTop: "0.35rem", fontSize: "1.25rem", fontWeight: 900, color: "#f8fafc" }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="panel-card" style={{ background: "linear-gradient(180deg, rgba(17, 24, 39, 0.94), rgba(15, 23, 42, 0.92))" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.45rem",
                padding: "0.34rem 0.78rem",
                borderRadius: "999px",
                border: "1px solid rgba(245, 158, 11, 0.22)",
                background: "rgba(245, 158, 11, 0.08)",
                color: "#fbbf24",
                fontSize: "0.7rem",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontWeight: 800,
                marginBottom: "0.9rem",
              }}
            >
              Recent Activity
            </div>

            <div style={{ display: "grid", gap: "0.8rem" }}>
              {[
                {
                  label: "Last Assignment Opened",
                  primary: recentActivity.assignment?.assignmentLabel || "No assignment opened yet",
                  secondary: recentActivity.assignment?.openedAt
                    ? `${recentActivity.assignment.level} • ${recentActivity.assignment.classLevel} • ${formatDateTime(recentActivity.assignment.openedAt)}`
                    : "Select an assignment to start working.",
                },
                {
                  label: "Last Save",
                  primary: recentActivity.save?.assignmentLabel || "No marks saved yet",
                  secondary: recentActivity.save?.savedAt
                    ? `${recentActivity.save.savedColumns?.join(", ") || "No columns"} • ${formatDateTime(recentActivity.save.savedAt)}`
                    : "Your next successful save will show here.",
                },
                {
                  label: "Last PDF",
                  primary: recentActivity.pdf?.assignmentLabel || "No PDF generated yet",
                  secondary: recentActivity.pdf?.generatedAt
                    ? `${recentActivity.pdf.term}, ${recentActivity.pdf.year} • ${formatDateTime(recentActivity.pdf.generatedAt)}`
                    : "Generate a marks PDF to track it here.",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    borderRadius: "16px",
                    border: "1px solid rgba(148, 163, 184, 0.16)",
                    background: "rgba(255,255,255,0.04)",
                    padding: "0.9rem 0.95rem",
                  }}
                >
                  <div style={{ color: "#94a3b8", fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 800 }}>
                    {item.label}
                  </div>
                  <div style={{ marginTop: "0.3rem", color: "#f8fafc", fontWeight: 800 }}>{item.primary}</div>
                  <div style={{ marginTop: "0.2rem", color: "#cbd5e1", lineHeight: 1.55, fontSize: "0.88rem" }}>{item.secondary}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ASSIGNMENTS */}
        <section className="panel" style={{ marginTop: "1rem" }}>
          <div className="panel-card">
            <div
              style={{
                display: "flex",
                gap: "0.8rem",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                marginBottom: "0.9rem",
              }}
            >
              <div>
                <h3 style={{ marginBottom: "0.3rem" }}>Assignments</h3>
                <div className="muted-text">
                  {assignmentSearch.trim()
                    ? `Showing ${visibleAssignmentsCount} of ${totalAssignmentsCount} assignments`
                    : `${totalAssignmentsCount} assignments ready for marks entry`}
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="text"
                  value={assignmentSearch}
                  onChange={(e) => setAssignmentSearch(e.target.value)}
                  placeholder="Search class, stream, subject or paper"
                  style={{
                    minWidth: isMobileTable ? "100%" : "280px",
                    padding: "0.72rem 0.95rem",
                    borderRadius: "999px",
                    border: "1px solid rgba(148, 163, 184, 0.24)",
                    background: "rgba(15, 23, 42, 0.82)",
                    color: "#f8fafc",
                  }}
                />
                {assignmentSearch.trim() && (
                  <button className="ghost-btn" onClick={() => setAssignmentSearch("")}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div
              className="teachers-table-wrapper"
              style={{
                maxWidth: "100%",
                maxHeight: "42vh",
                overflowX: "auto",
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
              }}
            >
              <table className="teachers-table" style={{ minWidth: "680px" }}>
                <thead>
                  <tr>
                    <th>Level</th>
                    <th>Class</th>
                    <th>Stream</th>
                    <th>Subject</th>
                    <th>Paper</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssignments.map((a) => (
                    <tr
                      key={`ol-${a.id}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        const obj = { ...a, isAlevel: false };
                        setSelectedAssignment(obj);
                        setMarksSavedSummary(null);
                        setRecentActivity((previous) => ({
                          ...previous,
                          assignment: {
                            assignmentLabel: getAssignmentDisplayLabel(obj),
                            stream: obj.stream,
                            classLevel: obj.class_level,
                            level: "O-Level",
                            openedAt: new Date().toISOString(),
                          },
                        }));
                        loadStudentsAndMarks(obj);
                      }}
                    >
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "0.28rem 0.7rem",
                            borderRadius: "999px",
                            fontSize: "0.72rem",
                            fontWeight: 800,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            background: "rgba(56, 189, 248, 0.14)",
                            color: "#7dd3fc",
                            border: "1px solid rgba(56, 189, 248, 0.22)",
                          }}
                        >
                          O-Level
                        </span>
                      </td>
                      <td>{a.class_level}</td>
                      <td>{a.stream}</td>
                      <td>{a.subject}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "0.24rem 0.62rem",
                            borderRadius: "999px",
                            fontSize: "0.72rem",
                            fontWeight: 800,
                            color: "#cbd5e1",
                            border: "1px solid rgba(148, 163, 184, 0.2)",
                            background: "rgba(148, 163, 184, 0.08)",
                          }}
                        >
                          Single
                        </span>
                      </td>
                    </tr>
                  ))}

                {filteredALevelAssignments.map((a) => (
                  <tr
                    key={`al-${a.id}`}
                    style={{ cursor: "pointer", background: "rgba(255,255,255,0.02)" }}
                    onClick={() => {
                      const derivedClass = a.stream?.split(" ")[0] ?? "A-Level";
                      const obj = { ...a, class_level: derivedClass, isAlevel: true };
                      setSelectedAssignment(obj);
                      setMarksSavedSummary(null);
                      setRecentActivity((previous) => ({
                        ...previous,
                        assignment: {
                          assignmentLabel: getAssignmentDisplayLabel(obj),
                          stream: obj.stream,
                          classLevel: obj.class_level,
                          level: "A-Level",
                          openedAt: new Date().toISOString(),
                        },
                      }));
                      loadStudentsAndMarks(obj);
                    }}
                  >
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "0.28rem 0.7rem",
                            borderRadius: "999px",
                            fontSize: "0.72rem",
                            fontWeight: 800,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            background: "rgba(245, 158, 11, 0.14)",
                            color: "#fbbf24",
                            border: "1px solid rgba(245, 158, 11, 0.22)",
                          }}
                        >
                          A-Level
                        </span>
                      </td>
                      <td>{a.stream?.split(" ")[0] ?? "—"}</td>
                      <td>{a.stream}</td>
                      <td>{a.subject_display || a.subject}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "0.24rem 0.62rem",
                            borderRadius: "999px",
                            fontSize: "0.72rem",
                            fontWeight: 800,
                            color: a.paper_label === "Paper 2" ? "#fef3c7" : a.paper_label === "Paper 1" ? "#d1fae5" : "#e0f2fe",
                            border: a.paper_label === "Paper 2"
                              ? "1px solid rgba(245, 158, 11, 0.24)"
                              : a.paper_label === "Paper 1"
                              ? "1px solid rgba(16, 185, 129, 0.24)"
                              : "1px solid rgba(56, 189, 248, 0.24)",
                            background: a.paper_label === "Paper 2"
                              ? "rgba(245, 158, 11, 0.12)"
                              : a.paper_label === "Paper 1"
                              ? "rgba(16, 185, 129, 0.12)"
                              : "rgba(56, 189, 248, 0.1)",
                          }}
                        >
                          {a.paper_label || "Single"}
                        </span>
                      </td>
                    </tr>
                  ))}

                  {visibleAssignmentsCount === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: "1rem", textAlign: "center", color: "#94a3b8" }}>
                        No assignments match your search yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* MARK ENTRY */}
        {selectedAssignment && (
          <section className="panel" style={{ marginTop: "1rem" }}>
            <div className="panel-card">
              <div className="panel-alert">
                You are entering marks for <strong>{selectedAssignment.class_level} {selectedAssignment.stream} — {selectedAssignment.subject_display || selectedAssignment.subject}</strong> ({marksYear}, {marksTerm})
              </div>

              {/* Analytics (read-only) */}
              {analyticsLoading && <div className="panel-alert">Loading analytics…</div>}

              {analytics && (
                <div className="panel-card" style={{ marginBottom: "1rem" }}>
                  <h3 style={{ marginBottom: "0.6rem" }}>📊 Subject Analytics — {analytics.subject_display || analytics.assignment?.subject || selectedAssignment.subject_display || selectedAssignment.subject}</h3>

                  <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap" }}>
                    <div>
                      <strong>Registered Learners</strong>
                      <div>{analytics.meta?.registered_learners ?? "—"}</div>
                    </div>

                    <div>
                      <strong>Overall Average</strong>
                      <div>{analytics.overall_average ?? "—"}</div>
                    </div>

                    <div>
                      <strong>Term</strong>
                      <div>{analytics.meta?.term ?? marksTerm}</div>
                    </div>

                    <div>
                      <strong>Year</strong>
                      <div>{analytics.meta?.year ?? marksYear}</div>
                    </div>
                  </div>

                  <div
                    className="teachers-table-wrapper"
                    style={{ marginTop: "0.8rem", maxWidth: "100%", overflowX: "auto", overflowY: "hidden", WebkitOverflowScrolling: "touch" }}
                  >
                    <table className="teachers-table" style={{ minWidth: "460px" }}>
                      <thead>
                        <tr>
                          <th>AOI</th>
                          <th>Attempts</th>
                          <th>Average</th>
                          <th>Missed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.isArray(analytics.aois) && analytics.aois.length > 0 ? (
                          analytics.aois.map((aoi) => (
                            <tr key={aoi.aoi_label}>
                              <td>{aoi.aoi_label === "EXAM80" ? "/80" : aoi.aoi_label}</td>
                              <td>{aoi.attempts}</td>
                              <td>{aoi.average_score ?? "—"}</td>
                              <td>{aoi.missed_count}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} className="muted-text">No AOI data yet</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
                <input type="number" value={marksYear} onChange={(e) => setMarksYear(e.target.value)} style={{ width: "6rem" }} />
                <select value={marksTerm} onChange={(e) => setMarksTerm(e.target.value)}>
                  <option>Term 1</option>
                  <option>Term 2</option>
                   <option>Term 3</option>
                </select>


                <button className="ghost-btn" onClick={() => loadStudentsAndMarks(selectedAssignment)} disabled={marksLoading}>
                  {marksLoading ? "Reloading…" : "Reload"}
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
                  gap: "0.75rem",
                  marginBottom: "0.9rem",
                }}
              >
                {[
                  { label: "Learners", value: students.length, tone: "#e2e8f0" },
                  { label: activeFocusColumn ? `${formatColumnLabel(activeFocusColumn)} Filled` : "Filled", value: focusSummary.filled, tone: "#86efac" },
                  { label: activeFocusColumn ? `${formatColumnLabel(activeFocusColumn)} Missed` : "Missed", value: focusSummary.missed, tone: "#fca5a5" },
                  { label: activeFocusColumn ? `${formatColumnLabel(activeFocusColumn)} Blank` : "Blank", value: focusSummary.blank, tone: "#fcd34d" },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      borderRadius: "16px",
                      padding: "0.85rem 0.95rem",
                      border: "1px solid rgba(148, 163, 184, 0.18)",
                      background: activeFocusColumn && item.label.startsWith(formatColumnLabel(activeFocusColumn))
                        ? "linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(14, 165, 233, 0.06))"
                        : "rgba(255,255,255,0.04)",
                    }}
                  >
                    <div style={{ color: item.tone, fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 800 }}>
                      {item.label}
                    </div>
                    <div style={{ marginTop: "0.3rem", color: "#f8fafc", fontSize: "1.15rem", fontWeight: 900 }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="teachers-table-wrapper"
                style={{ maxWidth: "100%", maxHeight: "62vh", overflowX: "auto", overflowY: "auto", WebkitOverflowScrolling: "touch" }}
              >
                <table className="teachers-table" style={{ minWidth: `${learnersTableMinWidth}px` }}>
                  <thead>
                    <tr>
                      <th
                        style={{
                          ...(isMobileTable
                            ? {
                                minWidth: "140px",
                                maxWidth: "140px",
                              }
                            : {
                                position: "sticky",
                                left: 0,
                                zIndex: 8,
                                minWidth: `${learnerColWidth}px`,
                                maxWidth: `${learnerColWidth}px`,
                                background: "#0f172a",
                                borderRight: "1px solid rgba(148, 163, 184, 0.24)",
                              }),
                        }}
                      >
                        Learner
                      </th>
                      <th
                        style={{
                          ...(isMobileTable
                            ? {
                                minWidth: "78px",
                                maxWidth: "78px",
                              }
                            : {
                                minWidth: `${genderColWidth}px`,
                                maxWidth: `${genderColWidth}px`,
                              }),
                        }}
                      >
                        Gender
                      </th>
                      {renderAoiColumns.map((c) => (
                        <th
                          key={c}
                          onClick={() => setFocusedColumn(c)}
                          style={{
                            cursor: "pointer",
                            background: activeFocusColumn === c ? "linear-gradient(180deg, rgba(14, 165, 233, 0.26), rgba(56, 189, 248, 0.14))" : undefined,
                            color: activeFocusColumn === c ? "#e0f2fe" : undefined,
                            boxShadow: activeFocusColumn === c ? "inset 0 0 0 1px rgba(125, 211, 252, 0.3)" : undefined,
                            borderBottom: activeFocusColumn === c ? "2px solid rgba(125, 211, 252, 0.8)" : undefined,
                          }}
                        >
                          {formatColumnLabel(c)}
                        </th>
                      ))}
                      <th>Avg</th>
                      {hasExam80Column && (
                        <th
                          onClick={() => setFocusedColumn("EXAM80")}
                          style={{
                            cursor: "pointer",
                            background: activeFocusColumn === "EXAM80" ? "linear-gradient(180deg, rgba(14, 165, 233, 0.26), rgba(56, 189, 248, 0.14))" : undefined,
                            color: activeFocusColumn === "EXAM80" ? "#e0f2fe" : undefined,
                            boxShadow: activeFocusColumn === "EXAM80" ? "inset 0 0 0 1px rgba(125, 211, 252, 0.3)" : undefined,
                            borderBottom: activeFocusColumn === "EXAM80" ? "2px solid rgba(125, 211, 252, 0.8)" : undefined,
                          }}
                        >
                          /80
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, rowIndex) => {
                      const marksForS = studentMarks[s.id] || {};
                      const statusForS = studentStatus[s.id] || {};
                      const stickyRowBg = "#0f172a";

                      return (
                        <tr key={s.id}>
                          <td
                            style={{
                              ...(isMobileTable
                                ? {
                                    minWidth: "140px",
                                    maxWidth: "140px",
                                  }
                                : {
                                    position: "sticky",
                                    left: 0,
                                    zIndex: 4,
                                    minWidth: `${learnerColWidth}px`,
                                    maxWidth: `${learnerColWidth}px`,
                                    background: stickyRowBg,
                                    borderRight: "1px solid rgba(148, 163, 184, 0.22)",
                                  }),
                            }}
                          >
                            {s.name}
                          </td>
                          <td
                            style={{
                              ...(isMobileTable
                                ? {
                                    minWidth: "78px",
                                    maxWidth: "78px",
                                  }
                                : {
                                    minWidth: `${genderColWidth}px`,
                                    maxWidth: `${genderColWidth}px`,
                                  }),
                            }}
                          >
                            {s.gender}
                          </td>

                          {renderAoiColumns.map((aoi) => {
                            const status = statusForS[aoi] ?? "Present";
                            const value = marksForS[aoi];
                            const errorKey = `${s.id}_${aoi}`;
                            const limits = getScoreConstraints(selectedAssignment?.isAlevel === true, aoi);

                            return (
                              <td
                                key={aoi}
                                style={{
                                  background: activeFocusColumn === aoi ? "linear-gradient(180deg, rgba(56, 189, 248, 0.12), rgba(14, 165, 233, 0.04))" : undefined,
                                  boxShadow: activeFocusColumn === aoi ? "inset 0 0 0 1px rgba(125, 211, 252, 0.2)" : undefined,
                                }}
                              >
                                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", whiteSpace: "nowrap" }}>
                                  <select
                                    value={status}
                                    onFocus={() => setFocusedColumn(aoi)}
                                    onChange={(e) => setAOIStatus(s.id, aoi, e.target.value)}
                                    style={{ width: "70px" }}
                                  >
                                    <option>Present</option>
                                    <option>Missed</option>
                                  </select>

                                  <input
                                    type="number"
                                    min={limits.min}
                                    max={limits.max}
                                    step={limits.step}
                                    disabled={status === "Missed"}
                                    value={value === undefined || value === null ? "" : (value === "Missed" ? "" : value)}
                                    onFocus={() => setFocusedColumn(aoi)}
                                    onChange={(e) => setAOIScore(s.id, aoi, e.target.value)}
                                    style={{ width: "46px", border: markErrors[errorKey] ? "2px solid #dc2626" : undefined, backgroundColor: markErrors[errorKey] ? "#fff5f5" : undefined }}
                                  />
                                </div>

                                {markErrors[errorKey] && (
                                  <div style={{ color: "#fecaca", fontSize: "0.75rem", marginTop: "0.2rem" }}>{markErrors[errorKey]}</div>
                                )}
                              </td>
                            );
                          })}

                          <td>{calculateAverage(studentMarks[s.id], averageColumns)}</td>
                          {hasExam80Column && (() => {
                            const aoi = "EXAM80";
                            const status = statusForS[aoi] ?? "Present";
                            const value = marksForS[aoi];
                            const errorKey = `${s.id}_${aoi}`;
                            const limits = getScoreConstraints(false, aoi);
                            return (
                              <td
                                style={{
                                  background: activeFocusColumn === "EXAM80" ? "linear-gradient(180deg, rgba(56, 189, 248, 0.12), rgba(14, 165, 233, 0.04))" : undefined,
                                  boxShadow: activeFocusColumn === "EXAM80" ? "inset 0 0 0 1px rgba(125, 211, 252, 0.2)" : undefined,
                                }}
                              >
                                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", whiteSpace: "nowrap" }}>
                                  <select
                                    value={status}
                                    onFocus={() => setFocusedColumn("EXAM80")}
                                    onChange={(e) => setAOIStatus(s.id, aoi, e.target.value)}
                                    style={{ width: "70px" }}
                                  >
                                    <option>Present</option>
                                    <option>Missed</option>
                                  </select>

                                  <input
                                    type="number"
                                    min={limits.min}
                                    max={limits.max}
                                    step={limits.step}
                                    disabled={status === "Missed"}
                                    value={value === undefined || value === null ? "" : (value === "Missed" ? "" : value)}
                                    onFocus={() => setFocusedColumn("EXAM80")}
                                    onChange={(e) => setAOIScore(s.id, aoi, e.target.value)}
                                    style={{ width: "46px", border: markErrors[errorKey] ? "2px solid #dc2626" : undefined, backgroundColor: markErrors[errorKey] ? "#fff5f5" : undefined }}
                                  />
                                </div>

                                {markErrors[errorKey] && (
                                  <div style={{ color: "#fecaca", fontSize: "0.75rem", marginTop: "0.2rem" }}>{markErrors[errorKey]}</div>
                                )}
                              </td>
                            );
                          })()}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  textAlign: "right",
                  marginTop: "1rem",
                  display: isMobileTable ? "none" : "flex",
                  gap: "0.6rem",
                  justifyContent: "flex-end",
                }}
              >
                <button className="secondary-btn" onClick={handleDownloadPDF}>Download PDF</button>
                <button className="primary-btn" disabled={Object.keys(markErrors).length > 0 || marksSaving} onClick={handleSaveMarks}>
                  {marksSaving ? "Saving…" : "Save Marks"}
                </button>
              </div>

              {marksError && <div className="panel-alert panel-alert-error" style={{ marginTop: "0.8rem" }}>{marksError}</div>}
            </div>
          </section>
        )}

        {showChangePassword && (
          <div className="modal-backdrop">
            <div
              className="modal-card"
              style={{
                maxWidth: "720px",
                padding: "0",
                overflow: "hidden",
                border: "1px solid rgba(14, 165, 233, 0.18)",
                boxShadow: "0 28px 70px rgba(15, 23, 42, 0.3)",
              }}
            >
              <div
                style={{
                  padding: "1.35rem 1.5rem 1.25rem",
                  background: "linear-gradient(135deg, #0f172a 0%, #1e293b 52%, #0c4a6e 100%)",
                  color: "#f8fafc",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    padding: "0.32rem 0.75rem",
                    borderRadius: "999px",
                    background: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    marginBottom: "0.9rem",
                  }}
                >
                  <span>Teacher</span>
                  <span style={{ color: "#7dd3fc" }}>Settings</span>
                </div>

                <h2 style={{ margin: 0, color: "#ffffff" }}>{passwordResetMode ? "Complete Password Reset" : "Account Settings"}</h2>
                <p style={{ margin: "0.55rem 0 0", color: "rgba(226, 232, 240, 0.92)", lineHeight: 1.6 }}>
                  {passwordResetMode
                    ? "Finish updating your password so you can return to the dashboard safely."
                    : "Manage your teacher account details here. You can update your email and password without leaving the dashboard."}
                </p>

                {!passwordResetMode && (
                  <div
                    style={{
                      marginTop: "1rem",
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: "0.75rem",
                    }}
                  >
                    <div
                      style={{
                        padding: "0.9rem 1rem",
                        borderRadius: "18px",
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                    >
                      <div style={{ fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7dd3fc", fontWeight: 800 }}>
                        Teacher
                      </div>
                      <div style={{ marginTop: "0.32rem", fontSize: "1rem", fontWeight: 800 }}>{teacher?.name || "Teacher"}</div>
                    </div>

                    <div
                      style={{
                        padding: "0.9rem 1rem",
                        borderRadius: "18px",
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.12)",
                      }}
                    >
                      <div style={{ fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7dd3fc", fontWeight: 800 }}>
                        Current Email
                      </div>
                      <div style={{ marginTop: "0.32rem", fontSize: "0.95rem", fontWeight: 700, wordBreak: "break-word" }}>
                        {teacher?.email || "—"}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ padding: "1.4rem 1.5rem 1.5rem", background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)" }}>
                {settingsNotice && <div className="panel-alert panel-alert-success">{settingsNotice}</div>}

                {passwordResetMode ? (
                  <div className="panel-alert">Enter a new password to complete the reset.</div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      gap: "0.75rem",
                      marginBottom: "1rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsTab("password");
                        setSettingsNotice("");
                        setPasswordError("");
                      }}
                      style={{
                        padding: "0.78rem 1rem",
                        borderRadius: "16px",
                        border: settingsTab === "password" ? "1px solid rgba(14, 165, 233, 0.35)" : "1px solid rgba(148, 163, 184, 0.22)",
                        background: settingsTab === "password"
                          ? "linear-gradient(135deg, rgba(14,165,233,0.14), rgba(2,132,199,0.08))"
                          : "#ffffff",
                        color: "#0f172a",
                        fontWeight: 800,
                        cursor: "pointer",
                        minWidth: "170px",
                        textAlign: "left",
                        boxShadow: settingsTab === "password" ? "0 12px 24px rgba(14, 165, 233, 0.12)" : "none",
                      }}
                    >
                      <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#0284c7", marginBottom: "0.2rem" }}>
                        Security
                      </div>
                      <div>Change Password</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsTab("email");
                        setSettingsNotice("");
                        setEmailError("");
                      }}
                      style={{
                        padding: "0.78rem 1rem",
                        borderRadius: "16px",
                        border: settingsTab === "email" ? "1px solid rgba(14, 165, 233, 0.35)" : "1px solid rgba(148, 163, 184, 0.22)",
                        background: settingsTab === "email"
                          ? "linear-gradient(135deg, rgba(14,165,233,0.14), rgba(2,132,199,0.08))"
                          : "#ffffff",
                        color: "#0f172a",
                        fontWeight: 800,
                        cursor: "pointer",
                        minWidth: "170px",
                        textAlign: "left",
                        boxShadow: settingsTab === "email" ? "0 12px 24px rgba(14, 165, 233, 0.12)" : "none",
                      }}
                    >
                      <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#0284c7", marginBottom: "0.2rem" }}>
                        Identity
                      </div>
                      <div>Change Email</div>
                    </button>
                  </div>
                )}

                {(passwordResetMode || settingsTab === "password") && (
                  <div
                    style={{
                      border: "1px solid rgba(148, 163, 184, 0.18)",
                      borderRadius: "20px",
                      padding: "1rem 1rem 1.1rem",
                      background: "#ffffff",
                      boxShadow: "0 16px 28px rgba(15, 23, 42, 0.06)",
                    }}
                  >
                    <div style={{ marginBottom: "0.9rem" }}>
                      <div style={{ fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#0284c7", fontWeight: 800 }}>
                        Password
                      </div>
                      <div style={{ marginTop: "0.2rem", color: "#334155", lineHeight: 1.55 }}>
                        Use a strong password that only you know.
                      </div>
                    </div>

                    {passwordError && <div className="panel-alert panel-alert-error">{passwordError}</div>}

                    {!passwordResetMode && (
                      <div className="form-row">
                        <label style={settingsLabelStyle}>Current password</label>
                        <input
                          type="password"
                          style={settingsInputStyle}
                          value={passwordForm.current}
                          onChange={(e) => setPasswordForm((p) => ({ ...p, current: e.target.value }))}
                        />
                      </div>
                    )}

                    <div className="form-row">
                      <label style={settingsLabelStyle}>New password</label>
                      <input
                        type="password"
                        style={settingsInputStyle}
                        value={passwordForm.next}
                        onChange={(e) => setPasswordForm((p) => ({ ...p, next: e.target.value }))}
                      />
                    </div>

                    <div className="form-row">
                      <label style={settingsLabelStyle}>Confirm new password</label>
                      <input
                        type="password"
                        style={settingsInputStyle}
                        value={passwordForm.confirm}
                        onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))}
                      />
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "0.2rem" }}>
                      <button className="ghost-btn" style={settingsCancelButtonStyle} onClick={closeSettingsModal}>
                        Cancel
                      </button>

                      <button className="primary-btn" disabled={passwordSaving} onClick={handleChangePassword}>
                        {passwordSaving ? "Saving…" : "Update Password"}
                      </button>
                    </div>
                  </div>
                )}

                {!passwordResetMode && settingsTab === "email" && (
                  <div
                    style={{
                      border: "1px solid rgba(148, 163, 184, 0.18)",
                      borderRadius: "20px",
                      padding: "1rem 1rem 1.1rem",
                      background: "#ffffff",
                      boxShadow: "0 16px 28px rgba(15, 23, 42, 0.06)",
                    }}
                  >
                    <div style={{ marginBottom: "0.9rem" }}>
                      <div style={{ fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#0284c7", fontWeight: 800 }}>
                        Email
                      </div>
                      <div style={{ marginTop: "0.2rem", color: "#334155", lineHeight: 1.55 }}>
                        Update the teacher email address used for login and account communication.
                      </div>
                    </div>

                    {emailError && <div className="panel-alert panel-alert-error">{emailError}</div>}

                    <div className="form-row">
                      <label style={settingsLabelStyle}>Current email</label>
                      <input type="text" style={settingsDisabledInputStyle} value={teacher?.email || ""} disabled />
                    </div>

                    <div className="form-row">
                      <label style={settingsLabelStyle}>New email</label>
                      <input
                        type="email"
                        style={settingsInputStyle}
                        value={emailForm.next}
                        onChange={(e) => setEmailForm((p) => ({ ...p, next: e.target.value }))}
                      />
                    </div>

                    <div className="form-row">
                      <label style={settingsLabelStyle}>Confirm new email</label>
                      <input
                        type="email"
                        style={settingsInputStyle}
                        value={emailForm.confirm}
                        onChange={(e) => setEmailForm((p) => ({ ...p, confirm: e.target.value }))}
                      />
                    </div>

                    <div className="form-row">
                      <label style={settingsLabelStyle}>Current password</label>
                      <input
                        type="password"
                        style={settingsInputStyle}
                        value={emailForm.password}
                        onChange={(e) => setEmailForm((p) => ({ ...p, password: e.target.value }))}
                      />
                      <div className="muted-text">Required to protect teacher accounts when updating email.</div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "0.2rem" }}>
                      <button className="ghost-btn" style={settingsCancelButtonStyle} onClick={closeSettingsModal}>
                        Cancel
                      </button>

                      <button className="primary-btn" disabled={emailSaving} onClick={handleChangeEmail}>
                        {emailSaving ? "Saving…" : "Update Email"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showHelpModal && (
          <div
            className="modal-backdrop"
            onClick={() => setShowHelpModal(false)}
            style={{
              padding: "1rem 1rem 2.5rem",
              overflowY: "auto",
              alignItems: "flex-start",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div
              className="modal-card"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: "760px",
                width: "min(760px, 100%)",
                maxHeight: "none",
                overflow: "visible",
                padding: 0,
                border: "1px solid rgba(245, 158, 11, 0.18)",
                boxShadow: "0 28px 70px rgba(15, 23, 42, 0.3)",
                position: "relative",
                margin: "0 auto",
              }}
            >
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                style={{
                  position: "absolute",
                  top: "1rem",
                  right: "1rem",
                  width: "38px",
                  height: "38px",
                  borderRadius: "999px",
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(15, 23, 42, 0.42)",
                  color: "#ffffff",
                  fontSize: "1rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  zIndex: 3,
                }}
                aria-label="Close help"
                title="Close help"
              >
                ×
              </button>

              <div
                style={{
                  padding: "1.35rem 1.5rem 1.2rem",
                  background: "linear-gradient(135deg, #111827 0%, #1f2937 52%, #92400e 100%)",
                  color: "#f8fafc",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    padding: "0.32rem 0.75rem",
                    borderRadius: "999px",
                    background: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    marginBottom: "0.9rem",
                  }}
                >
                  <span>Teacher</span>
                  <span style={{ color: "#fbbf24" }}>Help</span>
                </div>

                <h2 style={{ margin: 0, color: "#ffffff" }}>How To Use The Dashboard</h2>
                <p style={{ margin: "0.55rem 0 0", color: "rgba(226, 232, 240, 0.92)", lineHeight: 1.6 }}>
                  A quick guide for marks entry, saving, PDF generation, account settings, and password recovery.
                </p>
              </div>

              <div style={{ padding: "1.35rem 1.5rem 1.5rem", background: "linear-gradient(180deg, #fffbeb 0%, #f8fafc 100%)" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "0.9rem",
                    marginBottom: "1rem",
                  }}
                >
                  {[
                    {
                      title: "1. Select Assignment",
                      body: "Click the correct class, stream, subject, and paper from the assignments table before entering any marks.",
                    },
                    {
                      title: "2. Enter Scores",
                      body: "Fill learner scores using the allowed score ranges shown in the table. Use Present or Missed correctly for each learner.",
                    },
                    {
                      title: "3. Save & Review",
                      body: "Click Save Marks after checking the rows. The system stores the marks and updates analytics for that assignment.",
                    },
                    {
                      title: "4. Generate PDF",
                      body: "Use Download PDF to open a printable marks sheet for the currently selected assignment and term.",
                    },
                  ].map((item) => (
                    <div
                      key={item.title}
                      style={{
                        borderRadius: "18px",
                        border: "1px solid rgba(245, 158, 11, 0.16)",
                        background: "#ffffff",
                        padding: "1rem 1.05rem",
                        boxShadow: "0 14px 28px rgba(15, 23, 42, 0.05)",
                      }}
                    >
                      <div style={{ color: "#92400e", fontWeight: 900, marginBottom: "0.45rem" }}>{item.title}</div>
                      <div style={{ color: "#334155", lineHeight: 1.65 }}>{item.body}</div>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    borderRadius: "20px",
                    padding: "1rem 1.05rem",
                    background: "#ffffff",
                    boxShadow: "0 16px 28px rgba(15, 23, 42, 0.05)",
                    display: "grid",
                    gap: "0.95rem",
                  }}
                >
                  <div>
                    <div style={{ color: "#0284c7", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em", fontSize: "0.72rem" }}>
                      Marks Guidelines
                    </div>
                    <div style={{ color: "#334155", lineHeight: 1.7, marginTop: "0.35rem" }}>
                      Select the right assignment first. Enter scores carefully based on the score limits for that column. If a learner did not do the assessment,
                      mark them as <strong>Missed</strong> instead of leaving the cell empty.
                    </div>
                  </div>

                  <div>
                    <div style={{ color: "#0284c7", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em", fontSize: "0.72rem" }}>
                      Settings
                    </div>
                    <div style={{ color: "#334155", lineHeight: 1.7, marginTop: "0.35rem" }}>
                      Use the <strong>Settings</strong> button to change your password or update your teacher email whenever needed. Changes are saved directly on your account.
                    </div>
                  </div>

                  <div>
                    <div style={{ color: "#0284c7", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em", fontSize: "0.72rem" }}>
                      Forgot Password
                    </div>
                    <div style={{ color: "#334155", lineHeight: 1.7, marginTop: "0.35rem" }}>
                      If you lose your password, use <strong>Forgot Password</strong> on the teacher login page. A reset code is sent to your email, and you can use it to
                      open the password reset flow safely.
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
                  <button className="primary-btn" type="button" onClick={() => setShowHelpModal(false)}>
                    Close Help
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {pendingMissedConfirmation && (
          <div className="modal-backdrop">
            <div className="modal-card" style={{ maxWidth: "680px" }}>
              <h2>Confirm Missed AOIs</h2>
              <p style={{ marginTop: "-0.15rem", marginBottom: "1rem", color: "#475569", lineHeight: 1.6 }}>
                Some learners do not have scores in the AOI columns you are saving. If you continue, they will be marked as missed for those AOIs.
              </p>

              <div style={{ display: "grid", gap: "0.85rem", marginBottom: "1rem" }}>
                {pendingMissedConfirmation.map(({ aoi, learners }) => (
                  <div key={aoi} style={{ border: "1px solid rgba(148, 163, 184, 0.25)", borderRadius: "16px", padding: "0.9rem 1rem", background: "rgba(248, 250, 252, 0.92)" }}>
                    <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: "0.45rem" }}>{aoi}</div>
                    <div style={{ color: "#334155", lineHeight: 1.6 }}>
                      {learners.map((learner) => learner.name).join(", ")}
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="panel-alert"
                style={{
                  marginBottom: "1rem",
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                  color: "#92400e",
                  lineHeight: 1.65,
                }}
              >
                If you mark these learners as missed, those missed AOIs will count as incomplete in end-of-term reports. Learners with missed AOIs will not qualify for class or stream position ranking.
              </div>

              <div className="panel-alert" style={{ marginBottom: "1rem" }}>
                Choose <strong>Mark Missed And Save</strong> to complete the save, or <strong>Go Back</strong> to return to the table and fill the missing scores before saving.
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", flexWrap: "wrap" }}>
                <button
                  className="ghost-btn"
                  onClick={() => {
                    setPendingMissedConfirmation(null);
                    setMarksError("Save cancelled. Fill the empty AOI cells or confirm them as missed.");
                  }}
                >
                  Go Back
                </button>

                <button
                  className="primary-btn"
                  disabled={marksSaving}
                  onClick={() => handleSaveMarks({ confirmedMissing: true })}
                >
                  {marksSaving ? "Saving…" : "Mark Missed And Save"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showMarksSavedModal && (
          <div className="modal-backdrop">
            <div className="modal-card" style={{ maxWidth: "520px" }}>
              <h2>Marks Saved</h2>
              <div
                style={{
                  border: "1px solid rgba(34, 197, 94, 0.28)",
                  background: "rgba(240, 253, 244, 0.95)",
                  color: "#14532d",
                  borderRadius: "16px",
                  padding: "0.95rem 1rem",
                  lineHeight: 1.6,
                  marginBottom: "1rem",
                }}
              >
                Marks have been saved successfully for <strong>{marksSavedSummary?.assignmentLabel || getAssignmentDisplayLabel(selectedAssignment)}</strong> in{" "}
                <strong>{marksSavedSummary?.term || marksTerm}</strong>, <strong>{marksSavedSummary?.year || marksYear}</strong>.
              </div>

              {marksSavedSummary && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                    gap: "0.75rem",
                    marginBottom: "1rem",
                  }}
                >
                  {[
                    { label: "Learners Updated", value: marksSavedSummary.updatedLearners },
                    { label: "Missed Recorded", value: marksSavedSummary.missedRecorded },
                    { label: "Columns Saved", value: marksSavedSummary.savedColumns?.join(", ") || "—" },
                    { label: "Saved At", value: formatDateTime(marksSavedSummary.savedAt) },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        border: "1px solid rgba(148, 163, 184, 0.18)",
                        background: "rgba(248, 250, 252, 0.94)",
                        borderRadius: "14px",
                        padding: "0.8rem 0.9rem",
                      }}
                    >
                      <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.12em", color: "#0284c7", fontWeight: 800 }}>
                        {item.label}
                      </div>
                      <div style={{ marginTop: "0.35rem", color: "#0f172a", fontWeight: 800, lineHeight: 1.5 }}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="primary-btn" onClick={() => setShowMarksSavedModal(false)}>
                  Okay
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedAssignment && isMobileTable && (
          <div
            style={{
              position: "fixed",
              left: "0.8rem",
              right: "0.8rem",
              bottom: "0.8rem",
              zIndex: 80,
              borderRadius: "22px",
              padding: "0.8rem",
              background: "linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(2, 6, 23, 0.96))",
              border: "1px solid rgba(56, 189, 248, 0.22)",
              boxShadow: "0 24px 50px rgba(2, 6, 23, 0.42)",
              backdropFilter: "blur(14px)",
            }}
          >
            <div style={{ color: "#cbd5e1", fontSize: "0.78rem", marginBottom: "0.65rem", textAlign: "center" }}>
              {getAssignmentDisplayLabel(selectedAssignment)} • {marksTerm} {marksYear}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
              <button className="secondary-btn" onClick={handleDownloadPDF} style={{ width: "100%" }}>
                Download PDF
              </button>
              <button
                className="primary-btn"
                style={{ width: "100%" }}
                disabled={Object.keys(markErrors).length > 0 || marksSaving}
                onClick={handleSaveMarks}
              >
                {marksSaving ? "Saving…" : "Save Marks"}
              </button>
            </div>
          </div>
        )}

        <footer
          style={{
            marginTop: "2rem",
            paddingTop: "1rem",
            paddingBottom: "0.4rem",
            borderTop: "1px solid rgba(148, 163, 184, 0.16)",
            textAlign: "center",
            fontSize: "0.78rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "rgba(148, 163, 184, 0.88)",
          }}
        >
          &copy; SPESS ARK {currentCalendarYear}
        </footer>
      </main>
    </div>
  );
}
