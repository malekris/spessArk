// src/pages/TeacherDashboard.jsx
import React, { useEffect, useState, useCallback } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import "./AdminDashboard.css";
import badge from "../assets/badge.png";
import useIdleLogout from "../hooks/useIdleLogout";
import { useNavigate } from "react-router-dom";
import { plainFetch } from "../lib/api";

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

const calculateAverage = (marksObj) => {
  const values = Object.values(marksObj || {}).filter((v) => typeof v === "number");
  if (values.length === 0) return "—";
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return avg.toFixed(2);
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

  useIdleLogout(() => {
    localStorage.clear();
    navigate("/", { replace: true });
  });

  // ----------------------------
  // Orientation hint (mobile)
  // ----------------------------
  const [isPortrait, setIsPortrait] = useState(
    typeof window !== "undefined" && window.matchMedia("(orientation: portrait)").matches
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

  // ----------------------------
  // Password modal
  // ----------------------------
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

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
  const [studentStatus, setStudentStatus] = useState({});

  const [marksYear, setMarksYear] = useState(new Date().getFullYear());
  const [marksTerm, setMarksTerm] = useState("Term 1");

  const [marksLoading, setMarksLoading] = useState(false);
  const [marksSaving, setMarksSaving] = useState(false);
  const [marksError, setMarksError] = useState("");
  const [markErrors, setMarkErrors] = useState({});

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

    // A-Level assignments
    fetch(`${API_BASE}/api/alevel/teachers/alevel-assignments`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setALevelAssignments(Array.isArray(d) ? d : []))
      .catch(() => setALevelAssignments([]));
  }, []);

  useEffect(() => {
    document.title = "Teacher Dashboard | SPESS ARK";
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
        ...(isAlevel ? { examType } : {}), // keep examType only for A-Level
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
      const columns = isAlevel ? ["MID", "EOT"] : ["AOI1", "AOI2", "AOI3"];

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
      setStudentStatus(studentStatusInit);
      setMarkErrors({});
    } catch (err) {
      console.error("Load students/marks error:", err);
      setMarksError("Failed to load learners or marks.");
      setStudents([]);
      setStudentMarks({});
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

    if (!passwordForm.current || !passwordForm.next || !passwordForm.confirm) {
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

      const res = await fetch(`${API_BASE}/api/teachers/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword: passwordForm.current, newPassword: passwordForm.next }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to change password");

      alert("Password updated successfully.");
      setShowChangePassword(false);
      setPasswordForm({ current: "", next: "", confirm: "" });
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordSaving(false);
    }
  };

  // ----------------------------
  // Helpers for mark UI
  // ----------------------------
  const setAOIStatus = (studentId, aoi, value) => {
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
    if (raw === "") {
      setStudentMarks((p) => ({ ...(p || {}), [studentId]: { ...(p?.[studentId] || {}), [aoi]: "" } }));
      setMarkErrors((p) => ({ ...(p || {}), [`${studentId}_${aoi}`]: "Score required" }));
      return;
    }

    const num = Number(raw);
    const isAlevel = selectedAssignment?.isAlevel === true;

    if (isAlevel) {
      if (Number.isNaN(num) || num < 0 || num > 100) {
        setMarkErrors((p) => ({ ...(p || {}), [`${studentId}_${aoi}`]: "Score must be between 0 and 100" }));
        return;
      }
    } else {
      if (Number.isNaN(num) || num < 0.9 || num > 3.0) {
        setMarkErrors((p) => ({ ...(p || {}), [`${studentId}_${aoi}`]: "Score must be between 0.9 and 3.0" }));
        return;
      }
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
  const handleSaveMarks = async () => {
    if (!selectedAssignment) return;
    const token = localStorage.getItem("teacherToken");
    if (!token) return;

    try {
      const payload = [];
      const errors = {};
      const isAlevel = selectedAssignment?.isAlevel === true;
      const columns = isAlevel ? ["MID", "EOT"] : ["AOI1", "AOI2", "AOI3"];

      for (const s of students) {
        const marksByAoi = studentMarks[s.id] || {};
        const statusByAoi = studentStatus[s.id] || {};

        for (const aoi of columns) {
          const score = marksByAoi[aoi];
          const status = statusByAoi[aoi];

          const scoreTouched = score !== undefined && score !== null && score !== "";
          const statusTouched = status === "Missed";

          if (!scoreTouched && !statusTouched) continue;

          if (status === "Missed") {
            payload.push({ studentId: s.id, aoi, score: "Missed" });
            continue;
          }

          if (!scoreTouched) {
            errors[`${s.id}_${aoi}`] = "Score required";
            continue;
          }

          const num = Number(score);

          if (isAlevel) {
            if (Number.isNaN(num) || num < 0 || num > 100) {
              errors[`${s.id}_${aoi}`] = "Score must be between 0 and 100";
              continue;
            }
          } else {
            if (Number.isNaN(num) || num < 0.9 || num > 3.0) {
              errors[`${s.id}_${aoi}`] = "Score must be between 0.9 and 3.0";
              continue;
            }
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
      setMarksSaving(true);

      const endpoint = isAlevel ? "/api/alevel/teachers/alevel-marks" : "/api/teachers/marks";
      const payloadBody = isAlevel
        ? { assignmentId: selectedAssignment.id, year: Number(marksYear),term:marksTerm, examType, marks: payload }
        : { assignmentId: selectedAssignment.id, year: Number(marksYear), term: marksTerm, marks: payload };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payloadBody),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save marks");
      }

      alert("Marks saved successfully.");
      loadStudentsAndMarks(selectedAssignment);
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

    const doc = new jsPDF("p", "mm", "a4");
    const img = new Image();
    img.src = badge;

    img.onload = () => {
      doc.addImage(img, "PNG", 14, 10, 20, 20);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("St. Phillips Equatorial Secondary School", 105, 18, { align: "center" });

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`${selectedAssignment.subject} | ${selectedAssignment.class_level} ${selectedAssignment.stream}`, 105, 24, { align: "center" });
      doc.text(`${marksYear} • ${selectedAssignment?.isAlevel ? examType : marksTerm}`, 105, 29, { align: "center" });

      const columns = selectedAssignment?.isAlevel ? ["MID", "EOT"] : ["AOI1", "AOI2", "AOI3"];
      const head = ["#", "Learner", "Gender", ...columns, "Avg"];

      const tableBody = students.map((s, i) => {
        const m = studentMarks[s.id] || {};
        const cells = columns.map((c) => {
          const v = m[c];
          return v === undefined ? "—" : v === "Missed" ? "Missed" : String(v);
        });
        const numeric = columns.map((c) => m[c]).filter((v) => typeof v === "number");
        const avg = numeric.length ? (numeric.reduce((a, b) => a + b, 0) / numeric.length).toFixed(2) : "—";
        return [i + 1, s.name, s.gender, ...cells, avg];
      });

      autoTable(doc, {
        startY: 38,
        head: [head],
        body: tableBody,
        theme: "grid",
        styles: { fontSize: 9, cellPadding: 3, valign: "middle" },
        headStyles: { fillColor: [226, 232, 240], textColor: 15, fontStyle: "bold" },
        columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 70 }, 2: { cellWidth: 20 } },
        didDrawPage: () => {
          const ph = doc.internal.pageSize.height;
          doc.setFontSize(8);
          doc.setTextColor(100);
          doc.text(`Submitted by ${teacher?.name || "Teacher"} on ${new Date().toLocaleString()}`, 14, ph - 10);
          doc.text(`Page ${doc.internal.getNumberOfPages()}`, 180, ph - 10);
        },
      });

      window.open(doc.output("bloburl"), "_blank");
    };
  };

  // ----------------------------
  // Compute dynamic columns for render
  // ----------------------------
  const renderColumns = selectedAssignment?.isAlevel ? ["MID", "EOT"] : ["AOI1", "AOI2", "AOI3"];

  // ============================
  // RENDER
  // ============================
  return (
    <div className="admin-root teacher-root">
      {isPortrait && <div className="panel-alert">📱 Rotate your phone for better mark entry</div>}

      <header
  style={{
    position: "relative",
    height: "220px",
    backgroundImage: "url(/weasel.jpg)",
    backgroundSize: "cover",
    backgroundPosition: "center",
    overflow: "hidden", 
  }}
>
  {/* overlay */}
  <div
    style={{
      position: "absolute",
      inset: 0,
      background:
        "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(15,23,42,0.95))",
    }}
  />

  {/* content */}
  <div
    style={{
      position: "relative",
      zIndex: 2,
      height: "100%",
      padding: "1.2rem 2.5rem",
      display: "flex",
      flexDirection: "column",
      gap: "1.4rem",
    }}
  >
    {/* Top bar */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
      }}
    >
      {/* Left brand */}
      <div className="brand">
        <span className="brand-dot" />
        <span className="brand-text">SPESS’S ARK</span>
        <span className="brand-tag">Teacher</span>
      </div>

      {/* Right buttons */}
      <div
        style={{
          display: "flex",
          gap: "0.8rem",
          marginLeft: "auto",
        }}
      >
        <button className="secondary-btn" onClick={() => setShowChangePassword(true)}>
          Change Password
        </button>

        <button className="nav-logout" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </div>

    {/* Hero text */}
    <div>
      <h1 style={{ fontSize: "1.9rem", marginBottom: "0.4rem" }}>
        Teacher Dashboard
      </h1>
      <p style={{ color: "#cbd5e1", maxWidth: "620px" }}>
        Manage marks, learners, analytics and reports with clarity and control.
      </p>
    </div>
  </div>
</header>



      <main className="admin-main">
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

        {/* ASSIGNMENTS */}
        <section className="panel" style={{ marginTop: "1rem" }}>
          <div className="panel-card">
            <table className="teachers-table">
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Class</th>
                  <th>Stream</th>
                  <th>Subject</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr
                    key={`ol-${a.id}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      const obj = { ...a, isAlevel: false };
                      setSelectedAssignment(obj);
                      loadStudentsAndMarks(obj);
                    }}
                  >
                    <td>O-Level</td>
                    <td>{a.class_level}</td>
                    <td>{a.stream}</td>
                    <td>{a.subject}</td>
                  </tr>
                ))}

                {aLevelAssignments.map((a) => (
                  <tr
                    key={`al-${a.id}`}
                    style={{ cursor: "pointer", background: "rgba(255,255,255,0.02)" }}
                    onClick={() => {
                      const obj = { ...a, isAlevel: true };
                      setSelectedAssignment(obj);
                      loadStudentsAndMarks(obj);
                    }}
                  >
                    <td style={{ fontWeight: "bold", color: "#f59e0b" }}>A-Level</td>
                    <td>{a.stream?.split(" ")[0] ?? "—"}</td>

                    <td>{a.stream}</td>
                    <td>{a.subject}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* MARK ENTRY */}
        {selectedAssignment && (
          <section className="panel" style={{ marginTop: "1rem" }}>
            <div className="panel-card">
              <div className="panel-alert">
                You are entering marks for <strong>{selectedAssignment.class_level} {selectedAssignment.stream} — {selectedAssignment.subject}</strong> ({marksYear}, {selectedAssignment?.isAlevel ? examType : marksTerm})
              </div>

              {/* Analytics (read-only) */}
              {analyticsLoading && <div className="panel-alert">Loading analytics…</div>}

              {analytics && (
                <div className="panel-card" style={{ marginBottom: "1rem" }}>
                  <h3 style={{ marginBottom: "0.6rem" }}>📊 Subject Analytics — {analytics.assignment?.subject}</h3>

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

                  <table className="teachers-table" style={{ marginTop: "0.8rem" }}>
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
                            <td>{aoi.aoi_label}</td>
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

              <table className="teachers-table">
                <thead>
                  <tr>
                    <th>Learner</th>
                    <th>Gender</th>
                    {renderColumns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                    <th>Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const marksForS = studentMarks[s.id] || {};
                    const statusForS = studentStatus[s.id] || {};

                    return (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>{s.gender}</td>

                        {renderColumns.map((aoi) => {
                          const status = statusForS[aoi] ?? "Present";
                          const value = marksForS[aoi];
                          const errorKey = `${s.id}_${aoi}`;

                          return (
                            <td key={aoi}>
                              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                                <select value={status} onChange={(e) => setAOIStatus(s.id, aoi, e.target.value)} style={{ width: "84px" }}>
                                  <option>Present</option>
                                  <option>Missed</option>
                                </select>

                                <input
                                  type="number"
                                  min={selectedAssignment?.isAlevel ? 0 : 0.9}
                                  max={selectedAssignment?.isAlevel ? 100 : 3.0}
                                  step={selectedAssignment?.isAlevel ? 1 : 0.1}
                                  disabled={status === "Missed"}
                                  value={value === undefined || value === null ? "" : (value === "Missed" ? "" : value)}
                                  onChange={(e) => setAOIScore(s.id, aoi, e.target.value)}
                                  style={{ width: "64px", border: markErrors[errorKey] ? "2px solid #dc2626" : undefined, backgroundColor: markErrors[errorKey] ? "#fff5f5" : undefined }}
                                />
                              </div>

                              {markErrors[errorKey] && (
                                <div style={{ color: "#fecaca", fontSize: "0.75rem", marginTop: "0.2rem" }}>{markErrors[errorKey]}</div>
                              )}
                            </td>
                          );
                        })}

                        <td>{calculateAverage(studentMarks[s.id])}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div style={{ textAlign: "right", marginTop: "1rem", display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
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
            <div className="modal-card">
              <h2>Change Password</h2>

              {passwordError && <div className="panel-alert panel-alert-error">{passwordError}</div>}

              <div className="form-row">
                <label>Current password</label>
                <input type="password" value={passwordForm.current} onChange={(e) => setPasswordForm((p) => ({ ...p, current: e.target.value }))} />
              </div>

              <div className="form-row">
                <label>New password</label>
                <input type="password" value={passwordForm.next} onChange={(e) => setPasswordForm((p) => ({ ...p, next: e.target.value }))} />
              </div>

              <div className="form-row">
                <label>Confirm new password</label>
                <input type="password" value={passwordForm.confirm} onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))} />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
                <button className="ghost-btn" onClick={() => { setShowChangePassword(false); setPasswordError(""); setPasswordForm({ current: "", next: "", confirm: "" }); }}>
                  Cancel
                </button>

                <button className="primary-btn" disabled={passwordSaving} onClick={handleChangePassword}>{passwordSaving ? "Saving…" : "Update Password"}</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
