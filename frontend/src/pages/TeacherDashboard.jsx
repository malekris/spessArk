// src/pages/TeacherDashboard.jsx
import React, { useEffect, useState } from "react";
import "./AdminDashboard.css"; // reuse dark styling

const API_BASE = "http://localhost:5001";

function TeacherDashboard({ teacher: initialTeacher, onLogout }) {
  /* =====================
     ORIENTATION DETECTION
     ===================== */
  const [isPortrait, setIsPortrait] = useState(
    window.matchMedia("(orientation: portrait)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const handler = (e) => setIsPortrait(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  /* =====================
     PROFILE STATE
     ===================== */
  const [teacher, setTeacher] = useState(() => {
    if (initialTeacher) return initialTeacher;
    const stored = localStorage.getItem("teacherProfile");
    try {
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");

  /* =====================
     ASSIGNMENTS
     ===================== */
  const [assignments, setAssignments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [assignError, setAssignError] = useState("");

  /* =====================
     MARKS ENTRY
     ===================== */
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [students, setStudents] = useState([]);
  const [studentMarks, setStudentMarks] = useState({});

  const [marksTerm, setMarksTerm] = useState("Term 1");
  const [marksYear, setMarksYear] = useState(new Date().getFullYear());
  const [marksAoi, setMarksAoi] = useState("AOI1");

  const [marksLoading, setMarksLoading] = useState(false);
  const [marksSaving, setMarksSaving] = useState(false);
  const [marksError, setMarksError] = useState("");
  const [marksSuccess, setMarksSuccess] = useState("");

  /* =====================
     INITIAL LOAD
     ===================== */
  useEffect(() => {
    const token = localStorage.getItem("teacherToken");
    if (!token) return;

    const fetchProfile = async () => {
      try {
        setLoadingProfile(true);
        const res = await fetch(`${API_BASE}/api/teacher/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setTeacher(data);
        localStorage.setItem("teacherProfile", JSON.stringify(data));
      } catch {
        setProfileError("Could not refresh profile.");
      } finally {
        setLoadingProfile(false);
      }
    };

    const fetchAssignments = async () => {
      try {
        setLoadingAssignments(true);
        const res = await fetch(`${API_BASE}/api/teacher/assignments`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setAssignments(Array.isArray(data) ? data : []);
      } catch {
        setAssignError("Could not load assignments.");
      } finally {
        setLoadingAssignments(false);
      }
    };

    fetchProfile();
    fetchAssignments();
  }, []);

  /* =====================
     HELPERS
     ===================== */
  const handleLogoutClick = () => {
    localStorage.clear();
    onLogout?.();
  };

  const loadStudentsAndMarks = async (assignment) => {
    const token = localStorage.getItem("teacherToken");
    if (!token) return;

    try {
      setMarksLoading(true);
      setMarksError("");

      const resStudents = await fetch(
        `${API_BASE}/api/teacher/assignments/${assignment.id}/students`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await resStudents.json();
      const list = Array.isArray(data.students) ? data.students : [];
      setStudents(list);

      const params = new URLSearchParams({
        assignmentId: assignment.id,
        term: marksTerm,
        year: marksYear,
        aoi: marksAoi,
      });

      const resMarks = await fetch(
        `${API_BASE}/api/teacher/marks?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      let map = {};
      if (resMarks.ok) {
        const marks = await resMarks.json();
        if (Array.isArray(marks)) {
          marks.forEach((m) => (map[m.student_id] = String(m.score)));
        }
      }
      setStudentMarks(map);
    } catch {
      setMarksError("Failed to load learners or marks.");
      setStudents([]);
    } finally {
      setMarksLoading(false);
    }
  };

  const handleSaveMarks = async () => {
    if (!selectedAssignment) return;

    const token = localStorage.getItem("teacherToken");
    if (!token) return;

    const payload = students.map((s) => ({
      studentId: s.id,
      score: studentMarks[s.id] ?? "",
    }));

    try {
      setMarksSaving(true);
      setMarksError("");
      setMarksSuccess("");

      const res = await fetch(`${API_BASE}/api/teacher/marks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          assignmentId: selectedAssignment.id,
          term: marksTerm,
          year: marksYear,
          aoiLabel: marksAoi,
          marks: payload,
        }),
      });

      if (!res.ok) throw new Error();
      setMarksSuccess("Marks saved successfully.");
      alert("Marks saved successfully.");
    } catch {
      setMarksError("Failed to save marks.");
    } finally {
      setMarksSaving(false);
    }
  };

  /* =====================
     RENDER
     ===================== */
  return (
    <div className="admin-root">
      {/* ROTATE NOTICE */}
      {isPortrait && (
        <div className="panel-alert" style={{ margin: "1rem" }}>
          📱 For best experience, rotate your phone to landscape mode.
        </div>
      )}

      <header className="admin-nav">
        <div className="brand">
          <span className="brand-text">SPESS’s ARK</span>
          <span className="brand-tag">Teacher</span>
        </div>
        <button className="nav-logout" onClick={handleLogoutClick}>
          Logout
        </button>
      </header>

      <main className="admin-main">
        <section className="admin-heading">
          <h1>Teacher Dashboard</h1>
          {teacher && <h2>👋 Hello {teacher.name}</h2>}
        </section>

        {/* ASSIGNMENTS */}
        <section className="panel">
          <div className="panel-header">
            <h2>My Teaching Assignments</h2>
          </div>

          <div className="panel-card">
            <div className="teachers-table-wrapper">
              <table className="teachers-table">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Stream</th>
                    <th>Subject</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => {
                        setSelectedAssignment(a);
                        loadStudentsAndMarks(a);
                      }}
                    >
                      <td>{a.class_level}</td>
                      <td>{a.stream}</td>
                      <td>{a.subject}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* MARKS */}
        {selectedAssignment && (
          <section className="panel">
            <div className="panel-card">
              <div className="teachers-table-wrapper">
                <table className="teachers-table">
                  <thead>
                    <tr>
                      <th>Learner</th>
                      <th>Gender</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>{s.gender}</td>
                        <td>
                          <input
                            type="number"
                            min="0.9"
                            max="3.0"
                            step="0.1"
                            value={studentMarks[s.id] ?? ""}
                            onChange={(e) =>
                              setStudentMarks((p) => ({
                                ...p,
                                [s.id]: e.target.value,
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ textAlign: "right", marginTop: "1rem" }}>
                <button
                  className="primary-btn"
                  onClick={handleSaveMarks}
                  disabled={marksSaving}
                >
                  {marksSaving ? "Saving…" : "Save AOI Marks"}
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default TeacherDashboard;
