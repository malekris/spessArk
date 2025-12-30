import React, { useEffect, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import "./AdminDashboard.css";
import badge from "../assets/badge.png";
import useIdleLogout from "../hooks/useIdleLogout";
import { useNavigate } from "react-router-dom";


const API_BASE =
  import.meta.env.VITE_API_BASE || "http://localhost:5001";

function TeacherDashboard({ teacher: initialTeacher, onLogout }) {
  const handleLogout = () => {
    localStorage.removeItem("teacherToken");
    localStorage.removeItem("teacherProfile");
  
    if (typeof onLogout === "function") {
      onLogout();
    } else {
      window.location.href = "/teacher-login";
    }
  };
  const navigate = useNavigate();

useIdleLogout(() => {
  localStorage.clear(); // or remove only auth token
  navigate("/", { replace: true });

});

  /* ================= ORIENTATION ================= */
  const [isPortrait, setIsPortrait] = useState(
    window.matchMedia("(orientation: portrait)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const handler = (e) => setIsPortrait(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  /* ================= PROFILE ================= */
  const [teacher, setTeacher] = useState(() => {
    try {
      return initialTeacher
        ? initialTeacher
        : JSON.parse(localStorage.getItem("teacherProfile"));
    } catch {
      return null;
    }
  });

  /* ================= ASSIGNMENTS ================= */
  const [assignments, setAssignments] = useState([]);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
/* ================= ANALYTICS ================= */
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  /* ================= MARKS ================= */
  const [students, setStudents] = useState([]);
  const [studentMarks, setStudentMarks] = useState({});
  const [studentStatus, setStudentStatus] = useState({});

  const [marksYear, setMarksYear] = useState(new Date().getFullYear());
  const [marksTerm, setMarksTerm] = useState("Term 1");
  const [marksAoi, setMarksAoi] = useState("AOI1");

  const [marksLoading, setMarksLoading] = useState(false);
  const [marksSaving, setMarksSaving] = useState(false);
  const [marksError, setMarksError] = useState("");
  const [markErrors, setMarkErrors] = useState({});

  /* ================= INITIAL LOAD ================= */
  useEffect(() => {
    const token = localStorage.getItem("teacherToken");
    if (!token) return;

    fetch(`${API_BASE}/api/teacher/assignments`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setAssignments(Array.isArray(d) ? d : []));
  }, []);
  useEffect(() => {
    document.title = "Teacher Dashboard | SPESS ARK";
  }, []);
  
  /* ================= LOAD STUDENTS ================= */
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
      setStudents(data.students || []);

      const params = new URLSearchParams({
        assignmentId: assignment.id,
        year: marksYear,
        term: marksTerm,
        aoi: marksAoi,
      });

      const resMarks = await fetch(
        `${API_BASE}/api/teacher/marks?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const marks = resMarks.ok ? await resMarks.json() : [];
      const marksMap = {};
      const statusMap = {};

      marks.forEach((m) => {
        if (m.score === "Missed") {
          statusMap[m.student_id] = "Missed";
        } else {
          marksMap[m.student_id] = m.score;
          statusMap[m.student_id] = "Present";
        }
      });

      setStudentMarks(marksMap);
      setStudentStatus(statusMap);
    } catch {
      setMarksError("Failed to load learners or marks.");
    } finally {
      setMarksLoading(false);
    }
  };
  const [notices, setNotices] = useState([]);

  const loadAnalytics = async (assignment) => {
    const token = localStorage.getItem("teacherToken");
    if (!token) return;
  
    try {
      setAnalyticsLoading(true);
  
      const params = new URLSearchParams({
        assignmentId: assignment.id,
        term: marksTerm,
        year: marksYear,
        aoi: marksAoi,
      });
  
      const res = await fetch(
        `${API_BASE}/api/teacher/analytics/class?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
  
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
    
  useEffect(() => {
    if (selectedAssignment) {
      loadStudentsAndMarks(selectedAssignment);
    }
  }, [marksTerm, marksAoi, marksYear]);
  
  useEffect(() => {
    fetch("/api/notices")
      .then(res => res.json())
      .then(setNotices)
      .catch(() => setNotices([]));
  }, []);
  
  /* ================= SAVE MARKS ================= */
  const handleSaveMarks = async () => {
    if (!selectedAssignment) return;
    const token = localStorage.getItem("teacherToken");
    if (!token) return;

    try {
      const payload = students.map((s) => {
        if (studentStatus[s.id] === "Missed") {
          return { studentId: s.id, score: "Missed" };
        }

        const val = parseFloat(studentMarks[s.id]);
        if (isNaN(val) || val < 0.9 || val > 3.0) {
          throw new Error("Scores must be between 0.9 and 3.0");
        }

        return { studentId: s.id, score: val };
      });

      setMarksSaving(true);

      await fetch(`${API_BASE}/api/teacher/marks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          assignmentId: selectedAssignment.id,
          year: marksYear,
          term: marksTerm,
          aoiLabel: marksAoi,
          marks: payload,
        }),
      });

      alert("Marks saved successfully.");
    } catch (e) {
      setMarksError(e.message);
    } finally {
      setMarksSaving(false);
    }
  };

  /* ================= PDF ================= */
  const handleDownloadPDF = async () => {
    if (!selectedAssignment || students.length === 0) {
      alert("Select a class and load learners first.");
      return;
    }
  
    const doc = new jsPDF("p", "mm", "a4");
  
    /* ===== LOAD BADGE IMAGE ===== */
    const img = new Image();
    img.src = badge;
  
    img.onload = () => {
      /* ===== HEADER (LIGHT & CLEAN) ===== */
      doc.addImage(img, "PNG", 14, 10, 20, 20); // badge (left)
  
      doc.setFontSize(16);
      doc.setTextColor(180, 0, 0); // red
      doc.setFont("helvetica", "bold");
      doc.text(
        "St. Phillips Equatorial Secondary School",
        105,
        18,
        { align: "center" }
      );
  
      doc.setFontSize(10);
      doc.setTextColor(55, 65, 81); // slate gray
      doc.setFont("helvetica", "normal");
  
      doc.text(
        `${selectedAssignment.subject} | ${selectedAssignment.class_level} ${selectedAssignment.stream}`,
        105,
        24,
        { align: "center" }
      );
  
      doc.text(
        `${marksYear} • ${marksTerm} • ${marksAoi}`,
        105,
        29,
        { align: "center" }
      );
  
      /* ===== TABLE DATA ===== */
      const tableBody = students.map((s, i) => [
        i + 1,
        s.name,
        s.gender,
        studentStatus[s.id] === "Missed"
          ? "Missed"
          : studentMarks[s.id] ?? "—",
      ]);
  
      /* ===== TABLE ===== */
      autoTable(doc, {
        startY: 38,
        head: [["#", "Learner Name", "Gender", "Score"]],
        body: tableBody,
  
        theme: "grid",
  
        styles: {
          fontSize: 9,
          cellPadding: 3,
          valign: "middle",
        },
  
        headStyles: {
          fillColor: [226, 232, 240], // light gray
          textColor: 15,
          fontStyle: "bold",
        },
  
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
  
        columnStyles: {
          0: { cellWidth: 10 },
          1: { cellWidth: 90 },
          2: { cellWidth: 30 },
          3: { cellWidth: 30 },
        },
  
        didDrawPage: () => {
          const pageHeight = doc.internal.pageSize.height;
  
          doc.setFontSize(8);
          doc.setTextColor(100);
  
          doc.text(
            `Submitted by ${teacher?.name || "Teacher"} on ${new Date().toLocaleString()}`,
            14,
            pageHeight - 10
          );
  
          doc.text(
            `Page ${doc.internal.getNumberOfPages()}`,
            180,
            pageHeight - 10
          );
        },
      });
  
      /* ===== OPEN (MOBILE SAFE) ===== */
      window.open(doc.output("bloburl"), "_blank");
    };
  };
  
  /* ================= RENDER ================= */
  return (
    <div className="admin-root teacher-root">

      {isPortrait && (
        <div className="panel-alert">
          📱 Rotate your phone for better mark entry
        </div>
      )}

      <header className="admin-nav">
        <div className="brand">
          <span className="brand-text">SPESS’s ARK</span>
          <span className="brand-tag">Teacher</span>
        </div>
            <button className="nav-logout" onClick={handleLogout}>
              Logout
            </button>

      </header>

      <main className="admin-main">
        <section className="admin-heading">
          <h1>Teacher Dashboard</h1>
          {teacher && <h2>👋 Hello {teacher.name}</h2>}
          <section className="teacher-notices">
  <h3>School Notices</h3>
  {notices.length === 0 ? (
    <p className="muted-text">No notices at the moment.</p>
  ) : (
    notices.map(n => (
      <div key={n.id} className="notice-card">
        <h4>{n.title}</h4>
        <p>{n.body}</p>
        <span className="notice-date">{formatDateTime(n.created_at)}</span>
      </div>
    ))
  )}
</section>

        </section>
        
        {/* ASSIGNMENTS */}
        <section className="panel">
          <div className="panel-card">
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
                      loadAnalytics(a); // ✅ ADD THIS
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
        </section>

        {/* MARK ENTRY */}
        {selectedAssignment && (
          <section className="panel">
            <div className="panel-card">
              {/* CONTEXT BANNER */}
              <div className="panel-alert">
                You are entering marks for{" "}
                <strong>
                  {selectedAssignment.class_level} {selectedAssignment.stream} —{" "}
                  {selectedAssignment.subject}
                </strong>{" "}
                ({marksYear}, {marksTerm}, {marksAoi})
              </div>

              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                <input
                  type="number"
                  value={marksYear}
                  onChange={(e) => setMarksYear(e.target.value)}
                />
                <select value={marksTerm} onChange={(e) => setMarksTerm(e.target.value)}>
                  <option>Term 1</option>
                  <option>Term 2</option>
                  <option>Term 3</option>
                </select>
                <select value={marksAoi} onChange={(e) => setMarksAoi(e.target.value)}>
                  <option>AOI1</option>
                  <option>AOI2</option>
                  <option>AOI3</option>
                </select>
                <button onClick={() => loadStudentsAndMarks(selectedAssignment)}>
                  Reload
                </button>
              </div>

              <table className="teachers-table">
                <thead>
                  <tr>
                    <th>Learner</th>
                    <th>Gender</th>
                    <th>Status</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.gender}</td>
                      <td>
                        <select
                          value={studentStatus[s.id] || "Present"}
                          onChange={(e) =>
                            setStudentStatus((p) => ({
                              ...p,
                              [s.id]: e.target.value,
                            }))
                          }
                        >
                          <option>Present</option>
                          <option>Missed</option>
                        </select>
                      </td>
                      <td>
                      <input
  type="number"
  min="0.9"
  max="3.0"
  step="0.1"
  disabled={studentStatus[s.id] === "Missed"}
  value={studentMarks[s.id] ?? ""}
  onChange={(e) => {
    const val = e.target.value;

    // allow temporary empty
    if (val === "") {
      setStudentMarks((p) => ({ ...p, [s.id]: "" }));
      setMarkErrors((p) => ({
        ...p,
        [s.id]: "Score required",
      }));
      return;
    }

    const num = Number(val);

    if (num < 0.9 || num > 3.0) {
      setMarkErrors((p) => ({
        ...p,
        [s.id]: "Score must be between 0.9 and 3.0",
      }));
    } else {
      setMarkErrors((p) => {
        const copy = { ...p };
        delete copy[s.id];
        return copy;
      });
    }

    setStudentMarks((p) => ({ ...p, [s.id]: val }));
  }}
  onBlur={(e) => {
    if (markErrors[s.id]) {
      e.target.focus(); // 🔒 lock cursor here
    }
  }}
  style={{
    border: markErrors[s.id] ? "2px solid #dc2626" : undefined,
    backgroundColor: markErrors[s.id] ? "#fef2f2" : undefined,
  }}
/>

                        
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ textAlign: "right", marginTop: "1rem" }}>
                <button className="secondary-btn" onClick={handleDownloadPDF}>
                  Download PDF
                </button>
                <button
                  className="primary-btn"
                  disabled={Object.keys(markErrors).length > 0}
                  onClick={handleSaveMarks}
                  >
                Save Marks
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
