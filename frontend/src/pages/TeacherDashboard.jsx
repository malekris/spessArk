// src/pages/TeacherDashboard.jsx
import React, { useEffect, useState } from "react";
import "./AdminDashboard.css"; // reuse dark styling

const API_BASE = "http://localhost:5001";

function TeacherDashboard({ teacher: initialTeacher, onLogout }) {
  // Profile state
  const [teacher, setTeacher] = useState(() => {
    if (initialTeacher) return initialTeacher;
    const stored = localStorage.getItem("teacherProfile");
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  });

  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");

  // Assignments list
  const [assignments, setAssignments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [assignError, setAssignError] = useState("");

  // Marks entry state
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [students, setStudents] = useState([]);
  const [studentMarks, setStudentMarks] = useState({}); // { studentId: "2.5" }

  const [marksTerm, setMarksTerm] = useState("Term 1");
  const [marksYear, setMarksYear] = useState(new Date().getFullYear());
  const [marksAoi, setMarksAoi] = useState("AOI1");

  const [marksLoading, setMarksLoading] = useState(false);
  const [marksSaving, setMarksSaving] = useState(false);
  const [marksError, setMarksError] = useState("");
  const [marksSuccess, setMarksSuccess] = useState("");

  useEffect(() => {
    const storedToken = localStorage.getItem("teacherToken");
    if (!storedToken) return;

    const fetchProfile = async () => {
      try {
        setLoadingProfile(true);
        setProfileError("");
        const res = await fetch(`${API_BASE}/api/teacher/me`, {
          headers: {
            Authorization: `Bearer ${storedToken}`,
          },
        });

        if (!res.ok) {
          throw new Error(`Status ${res.status}`);
        }

        const data = await res.json();
        setTeacher(data);
        localStorage.setItem("teacherProfile", JSON.stringify(data));
      } catch (err) {
        console.error("Failed to refresh teacher profile:", err);
        setProfileError(
          "Could not refresh profile. You may need to log in again."
        );
      } finally {
        setLoadingProfile(false);
      }
    };

    const fetchAssignments = async () => {
      try {
        setLoadingAssignments(true);
        setAssignError("");
        const res = await fetch(`${API_BASE}/api/teacher/assignments`, {
          headers: {
            Authorization: `Bearer ${storedToken}`,
          },
        });

        if (!res.ok) {
          throw new Error(`Status ${res.status}`);
        }

        const data = await res.json();
        if (!Array.isArray(data)) {
          throw new Error("Invalid assignments response");
        }
        setAssignments(data);
      } catch (err) {
        console.error("Failed to load assignments:", err);
        setAssignError(
          "Could not load your assignments. Contact admin if this continues."
        );
      } finally {
        setLoadingAssignments(false);
      }
    };

    // run ONCE on mount
    fetchProfile();
    fetchAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // <- empty deps: no loop

  const handleLogoutClick = () => {
    localStorage.removeItem("teacherToken");
    localStorage.removeItem("teacherProfile");
    if (typeof onLogout === "function") {
      onLogout();
    }
  };

  // ---- Marks helpers ----

  const loadStudentsAndMarks = async (assignment) => {
    const storedToken = localStorage.getItem("teacherToken");
    if (!storedToken || !assignment) return;

    try {
      setMarksLoading(true);
      setMarksError("");
      // do NOT clear marksSuccess here; only on new input / save attempts

      // 1) Load students for this assignment
      const resStudents = await fetch(
        `${API_BASE}/api/teacher/assignments/${assignment.id}/students`,
        {
          headers: {
            Authorization: `Bearer ${storedToken}`,
          },
        }
      );

      if (!resStudents.ok) {
        throw new Error(
          `Failed to load students (status ${resStudents.status})`
        );
      }

      const studentsPayload = await resStudents.json();
      const studentList = Array.isArray(studentsPayload.students)
        ? studentsPayload.students
        : [];
      setStudents(studentList);

      // 2) Load existing marks for this assignment + term + year + AOI
      const params = new URLSearchParams({
        assignmentId: String(assignment.id),
        term: marksTerm,
        year: String(marksYear),
        aoi: marksAoi,
      });

      const resMarks = await fetch(
        `${API_BASE}/api/teacher/marks?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${storedToken}`,
          },
        }
      );

      let marksMap = {};
      if (resMarks.ok) {
        const marksData = await resMarks.json();
        if (Array.isArray(marksData)) {
          marksMap = marksData.reduce((acc, m) => {
            acc[m.student_id] = String(m.score);
            return acc;
          }, {});
        }
      }

      setStudentMarks(marksMap);
    } catch (err) {
      console.error("Failed to load students/marks:", err);
      setMarksError(
        "Could not load learners or marks. Try again or contact admin."
      );
      setStudents([]);
      setStudentMarks({});
    } finally {
      setMarksLoading(false);
    }
  };

  const handleSelectAssignment = (assignment) => {
    setSelectedAssignment(assignment);
    setMarksError("");
    setMarksSuccess("");
    loadStudentsAndMarks(assignment);
  };

  const handleMarksFilterChange = (field, value) => {
    if (field === "term") setMarksTerm(value);
    if (field === "year") setMarksYear(value);
    if (field === "aoi") setMarksAoi(value);

    if (selectedAssignment) {
      setMarksError("");
      setMarksSuccess("");
      loadStudentsAndMarks(selectedAssignment);
    }
  };

  const handleScoreChange = (studentId, value) => {
    setMarksError("");
    setMarksSuccess("");
    setStudentMarks((prev) => ({
      ...prev,
      [studentId]: value,
    }));
  };

  const handleSaveMarks = async () => {
    if (!selectedAssignment) {
      setMarksError("Please select a teaching assignment first.");
      return;
    }

    const storedToken = localStorage.getItem("teacherToken");
    if (!storedToken) {
      setMarksError("Missing login token. Please log in again.");
      return;
    }

    // Prepare marks payload
    const marksArray = students.map((s) => ({
      studentId: s.id,
      score: studentMarks[s.id] ?? "",
    }));

    // Validate scores client-side
    for (const m of marksArray) {
      if (m.score === "" || m.score === null || m.score === undefined) continue;
      const num = parseFloat(m.score);
      if (Number.isNaN(num) || num < 0.9 || num > 3.0) {
        setMarksError(
          "All entered scores must be between 0.9 and 3.0 (no more, no less)."
        );
        return;
      }
    }

    try {
      setMarksSaving(true);
      setMarksError("");
      setMarksSuccess("");

      const res = await fetch(`${API_BASE}/api/teacher/marks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${storedToken}`,
        },
        body: JSON.stringify({
          assignmentId: selectedAssignment.id,
          term: marksTerm,
          year: marksYear,
          aoiLabel: marksAoi,
          marks: marksArray,
        }),
      });

      if (!res.ok) {
        let msg = `Failed to save marks (status ${res.status})`;
        try {
          const body = await res.json();
          if (body && body.message) msg = body.message;
        } catch (_) {}
        throw new Error(msg);
      }

      const data = await res.json();
      const msg =
        data && data.savedCount
          ? `Marks saved for ${data.savedCount} learners.`
          : "Marks saved successfully.";

      setMarksSuccess(msg);
      // Make it very obvious for now:
      alert(msg);

      // IMPORTANT: do NOT reload here – keep current entries visible.
      // If you want to see fresh-from-DB values, re-select the assignment
      // or change AOI/term/year to trigger reload.
    } catch (err) {
      console.error("Error saving marks:", err);
      setMarksError(err.message || "Could not save marks. Try again.");
    } finally {
      setMarksSaving(false);
    }
  };

  return (
    <div className="admin-root">
      {/* Top navigation */}
      <header className="admin-nav">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-text">SPESS’s ARK</span>
          <span className="brand-tag">Teacher</span>
        </div>

        <button className="nav-logout" onClick={handleLogoutClick}>
          Logout
        </button>
      </header>

      {/* Main content */}
      <main className="admin-main">
        {/* Heading */}
        <section className="admin-heading">
          <h1>Teacher Dashboard</h1>
          <p>
            Welcome to your area. Below are your profile details, teaching
            assignments and continuous assessment marks.
          </p>

          {teacher && (
            <h2
              style={{
                marginTop: "1rem",
                fontSize: "1.3rem",
                fontWeight: 500,
                color: "#38bdf8",
                letterSpacing: "0.03em",
              }}
            >
              👋 Hello {teacher.name}
            </h2>
          )}
        </section>

        {/* Profile panel */}
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>My Profile</h2>
              <p>Basic information about your account.</p>
            </div>
          </div>

          {loadingProfile && (
            <div className="panel-alert">Refreshing your profile…</div>
          )}

          {profileError && (
            <div className="panel-alert panel-alert-error">
              {profileError}
            </div>
          )}

          <div className="panel-card">
            {teacher ? (
              <>
                <p>
                  <strong>Name:</strong> {teacher.name}
                </p>
                <p>
                  <strong>Email:</strong> {teacher.email}
                </p>
                <p>
                  <strong>Subject 1:</strong> {teacher.subject1 || "—"}
                </p>
                <p>
                  <strong>Subject 2:</strong> {teacher.subject2 || "—"}
                </p>
                <p className="muted-text" style={{ marginTop: "1rem" }}>
                  This profile is managed by the admin. Contact them if anything
                  is incorrect.
                </p>
              </>
            ) : (
              <p>No teacher data loaded. Try logging in again.</p>
            )}
          </div>
        </section>

        {/* Assignments panel */}
        <section className="panel" style={{ marginTop: "1.8rem" }}>
          <div className="panel-header">
            <div>
              <h2>My Teaching Assignments</h2>
              <p>
                Click an assignment below to load learners and enter AOI marks.
              </p>
            </div>
          </div>

          {loadingAssignments && (
            <div className="panel-alert">Loading your assignments…</div>
          )}

          {assignError && (
            <div className="panel-alert panel-alert-error">
              {assignError}
            </div>
          )}

          <div className="panel-card">
            {assignments.length === 0 && !loadingAssignments ? (
              <p className="muted-text">
                No teaching assignments found yet. Contact the admin to assign
                you to classes and subjects.
              </p>
            ) : (
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
                        onClick={() => handleSelectAssignment(a)}
                        style={{
                          cursor: "pointer",
                          backgroundColor:
                            selectedAssignment &&
                            selectedAssignment.id === a.id
                              ? "rgba(56, 189, 248, 0.08)"
                              : "transparent",
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
            )}
          </div>
        </section>

        {/* Marks entry panel */}
        {selectedAssignment && (
          <section className="panel" style={{ marginTop: "1.8rem" }}>
            <div className="panel-header">
              <div>
                <h2>Enter AOI Marks</h2>
                <p>
                  {selectedAssignment.subject} — {selectedAssignment.class_level}{" "}
                  {selectedAssignment.stream}. Scores must be between 0.9 and
                  3.0 for each learner.
                </p>
              </div>
            </div>

            <div className="panel-card">
              {/* Filters: term / year / AOI */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.8rem",
                  marginBottom: "1rem",
                  fontSize: "0.85rem",
                }}
              >
                <div>
                  <label style={{ display: "block", marginBottom: "0.2rem" }}>
                    Term
                  </label>
                  <select
                    value={marksTerm}
                    onChange={(e) =>
                      handleMarksFilterChange("term", e.target.value)
                    }
                  >
                    <option value="Term 1">Term 1</option>
                    <option value="Term 2">Term 2</option>
                    <option value="Term 3">Term 3</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "0.2rem" }}>
                    Year
                  </label>
                  <input
                    type="number"
                    value={marksYear}
                    onChange={(e) =>
                      handleMarksFilterChange("year", e.target.value)
                    }
                    style={{ width: "6rem" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "0.2rem" }}>
                    AOI
                  </label>
                  <select
                    value={marksAoi}
                    onChange={(e) =>
                      handleMarksFilterChange("aoi", e.target.value)
                    }
                  >
                    <option value="AOI1">AOI1</option>
                    <option value="AOI2">AOI2</option>
                    <option value="AOI3">AOI3</option>
                  </select>
                </div>

                <div style={{ alignSelf: "flex-end" }}>
                  {marksLoading && (
                    <span className="muted-text">
                      Loading learners & marks…
                    </span>
                  )}
                </div>
              </div>

              {/* Errors / success */}
              {marksError && (
                <div className="panel-alert panel-alert-error">
                  {marksError}
                </div>
              )}
              {marksSuccess && (
                <div className="panel-alert">{marksSuccess}</div>
              )}

              {/* Learners + scores table */}
              {students.length === 0 && !marksLoading ? (
                <p className="muted-text">
                  No learners found for this class and stream.
                </p>
              ) : (
                <div className="teachers-table-wrapper">
                  <table className="teachers-table">
                    <thead>
                      <tr>
                        <th>Learner Name</th>
                        <th>Gender</th>
                        <th>Class</th>
                        <th>Stream</th>
                        <th>Score (0.9–3.0)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s) => (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td>{s.gender}</td>
                          <td>{s.class_level}</td>
                          <td>{s.stream}</td>
                          <td>
                            <input
                              type="number"
                              step="0.1"
                              min="0.9"
                              max="3.0"
                              value={studentMarks[s.id] ?? ""}
                              onChange={(e) =>
                                handleScoreChange(s.id, e.target.value)
                              }
                              style={{
                                width: "5rem",
                                padding: "0.25rem 0.4rem",
                                borderRadius: "6px",
                                border:
                                  "1px solid rgba(148, 163, 184, 0.7)",
                                background: "rgba(15, 23, 42, 0.9)",
                                color: "#e5e7eb",
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ marginTop: "1rem", textAlign: "right" }}>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={handleSaveMarks}
                  disabled={marksSaving || marksLoading}
                >
                  {marksSaving ? "Saving marks…" : "Save AOI marks"}
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
