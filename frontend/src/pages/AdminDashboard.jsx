// src/pages/AdminDashboard.jsx
import React, { useState, useEffect } from "react";
import "./AdminDashboard.css";
import jsPDF from "jspdf";
import AssignSubjectsPanel from "../components/AssignSubjectsPanel";
import { plainFetch, adminFetch } from "../lib/api";
import EditStudentModal from "../components/EditStudentModal";
import EndOfTermReports from "./EndOfTermReports";
import { useNavigate } from "react-router-dom";
import useIdleLogout from "../hooks/useIdleLogout";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
// Compulsory / optional subjects (used for student form)
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

  const formatDateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
  };

  function AdminDashboard() {
    
    const navigate = useNavigate();
    useEffect(() => { const isAdmin = sessionStorage.getItem("isAdmin"); if (!isAdmin) { navigate("/", { replace: true }); } }, [navigate]);
    useIdleLogout(() => {
      // 🔐 remove only admin-related keys
      localStorage.removeItem("adminToken");
      localStorage.removeItem("isAdmin");
    
      // 🔁 redirect to login
      navigate("/", { replace: true });
    });
    
    const handleLogout = () => { sessionStorage.removeItem("isAdmin"); navigate("/", { replace: true }); };
    useEffect(() => {
      document.title = "Admin Dashboard | SPESS ARK";
    }, []);
    
  const [activeSection, setActiveSection] = useState("");
  useEffect(() => {
    if (!activeSection) {
      document.title = "Admin Dashboard | SPESS ARK";
    } else {
      document.title = `${activeSection} | SPESS ARK`;
    }
  }, [activeSection]);
  const [notices, setNotices] = useState([]);
  const [loadingNotices, setLoadingNotices] = useState(false);
  const [noticesError, setNoticesError] = useState("");
  const [noticeError, setNoticeError] = useState("");
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeBody, setNoticeBody] = useState("");

  

  /* ---------- Teachers ---------- */
  const [teachers, setTeachers] = useState([]);
  const [teacherForm, setTeacherForm] = useState({ name: "", email: "", subject1: "", subject2: "" });
  const [teacherError, setTeacherError] = useState("");
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [savingTeacher, setSavingTeacher] = useState(false);
  const [deletingTeacherId, setDeletingTeacherId] = useState(null);

  /* ---------- Students ---------- */
  const [students, setStudents] = useState([]);
  const [studentForm, setStudentForm] = useState({ name: "", gender: "", dob: "", class_level: "", stream: "" });
  const [selectedOptionals, setSelectedOptionals] = useState([]);
  const [studentError, setStudentError] = useState("");
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [savingStudent, setSavingStudent] = useState(false);
  const [deletingStudentId, setDeletingStudentId] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);

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

  /* ---------- Marksheet ---------- */
  const [marksheetClass, setMarksheetClass] = useState("");
  const [marksheetStream, setMarksheetStream] = useState("");
  const [marksheetError, setMarksheetError] = useState("");

  const cards = [
    { title: "Add Students", subtitle: "Enroll new learners", icon: "🎓" },
    { title: "Assign Subjects", subtitle: "Link teachers to classes", icon: "📘" },
    { title: "Download Marks", subtitle: "View & export assessment scores", icon: "📊" },
    { title: "Manage Teachers", subtitle: "Accounts & permissions", icon: "🧑🏽‍🏫" },
    {
      title: "End of Term Reports",
      subtitle: "Term 1 & Term 2 report cards",
      icon: "📘",
      route: "/admin/reports/term",
    },
    {
      title: "End of Year Reports",
      subtitle: "Final student performance (coming soon)",
      icon: "📕",
      route: null, // disabled for now
    },
    { title: "Notices", subtitle: "Create school notices", icon: "📢" }
   
  ];

  /* ------------------ API / fetch functions ------------------ */

  // FETCH noticenotices
  const fetchNotices = async () => {
    setLoadingNotices(true);
    setNoticeError("");
    try {
      const data = await adminFetch("/api/notices");
      if (!Array.isArray(data)) throw new Error("Invalid notices response");
      setNotices(data);
    } catch (err) {
      console.error(err);
      setNoticeError("Could not load notices");
      setNotices([]);
    } finally {
      setLoadingNotices(false);
    }
  };
  const handleCreateNotice = async () => {
    if (!noticeTitle.trim() || !noticeBody.trim()) {
      setNoticesError("Title and message are required.");
      return;
    }
  
    try {
      setLoadingNotices(true);
  
      await adminFetch("/api/admin/notices", {
        method: "POST",
        body: {
          title: noticeTitle,
          body: noticeBody,
        },
      });
  
      setNoticeTitle("");
      setNoticeBody("");
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
      await adminFetch(`/api/admin/notices/${id}`, {
        method: "DELETE",
      });
  
      setNotices((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      alert(err.message || "Failed to delete notice");
    }
  };
  
  
  // Teachers
  const fetchTeachers = async () => {
    setLoadingTeachers(true);
    setTeacherError("");
    try {
      const data = await plainFetch("/api/teachers");
      if (!Array.isArray(data)) throw new Error("Invalid response from server");
      setTeachers(data);
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
      const created = await plainFetch("/api/teachers", {
        method: "POST",
        body: { name, email, subject1, subject2 },
      });
      // add created to list
      const teacherToAdd = {
        id: created.id ?? Date.now(),
        name: created.name ?? name,
        email: created.email ?? email,
        subject1: created.subject1 ?? subject1,
        subject2: created.subject2 ?? subject2,
        created_at: created.created_at ?? null,
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
      // Use adminFetch to be safe (server may allow public delete but this is fine)
      await adminFetch(`/api/admin/teachers/${id}`, { method: "DELETE" });
      setTeachers((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error("Error deleting teacher:", err);
      setTeacherError(err.message || "Could not delete teacher.");
    } finally {
      setDeletingTeacherId(null);
    }
  };

  // Students
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
  

  const handleAddStudent = async (e) => {
    e?.preventDefault();
    const { name, gender, dob, class_level, stream } = studentForm;
    if (!name || !gender || !dob || !class_level || !stream) {
      setStudentError("Please fill in all required fields.");
      return;
    }
    const subjects = [...COMPULSORY_SUBJECTS, ...selectedOptionals];
    setSavingStudent(true);
    setStudentError("");
    try {
      const created = await plainFetch("/api/students", {
        method: "POST",
        body: { name, gender, dob, class_level, stream, subjects },
      });
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
    } catch (err) {
      console.error("Error adding student:", err);
      setStudentError(err.message || "Could not add student.");
    } finally {
      setSavingStudent(false);
    }
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

  // Admin: marks sets (protected)
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

  const fetchMarksDetail = async (set) => {
    if (!set) return;
    setLoadingMarksDetail(true);
    setMarksError("");
    setMarksDetail([]);
    try {
      const params = new URLSearchParams({
        assignmentId: set.assignment_id,
        term: set.term,
        year: String(set.year),
        aoi: set.aoi_label,
      });
      const data = await adminFetch(`/api/admin/marks-detail?${params.toString()}`);
      if (!Array.isArray(data)) throw new Error("Invalid response");
      setMarksDetail(data);
    } catch (err) {
      console.error("Error loading marks detail:", err);
      setMarksError(err.message || "Could not load marks detail.");
      setMarksDetail([]);
    } finally {
      setLoadingMarksDetail(false);
    }
  };

  /* ---------- Effects ---------- */

  useEffect(() => {
    // initial public loads
    fetchTeachers();
    fetchStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (activeSection === "Notices") {
      fetchNotices();
    }
  }, [activeSection]);
  
  
  // load relevant data when section opens
  useEffect(() => {
    if (activeSection === "Manage Teachers") {
      fetchTeachers();
    } else if (activeSection === "Add Students") {
      fetchStudents();
    } else if (activeSection === "Download Marks") {
      fetchMarksSets();
      setSelectedMarksSet(null);
      setMarksDetail([]);
    } else if (activeSection === "Assign Subjects") {
      // nothing heavy here — AssignSubjectsPanel will load its own resources independently
      console.log("[AdminDashboard] opening Assign Subjects panel");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  // when user picks a marks set, load its detail
  useEffect(() => {
    if (selectedMarksSet) fetchMarksDetail(selectedMarksSet);
    else setMarksDetail([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMarksSet]);

  /* ---------- UI helpers ---------- */

  const handleTeacherInputChange = (e) => {
    const { name, value } = e.target;
    setTeacherForm((p) => ({ ...p, [name]: value }));
  };

  const handleStudentInputChange = (e) => {
    const { name, value } = e.target;
    setStudentForm((p) => ({ ...p, [name]: value }));
    setStudentError("");
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
    if (!selectedMarksSet || marksDetail.length === 0) return;
    const header = ["Student ID", "Name", "Class", "Stream", "Term", "Year", "AOI", "Score"];
    const rows = marksDetail.map((row) => [
      csvEscape(row.student_id),
      csvEscape(row.student_name),
      csvEscape(row.class_level),
      csvEscape(row.stream),
      csvEscape(selectedMarksSet.term),
      csvEscape(selectedMarksSet.year),
      csvEscape(selectedMarksSet.aoi_label),
      csvEscape(row.score),
    ]);
    const csvLines = [header.join(","), ...rows.map((r) => r.join(","))];
    const csvContent = csvLines.join("\n");
    const slug = (str) => String(str || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const filename = `marks_${slug(selectedMarksSet.class_level)}_${slug(selectedMarksSet.stream)}_${slug(selectedMarksSet.subject)}_${slug(selectedMarksSet.aoi_label)}_T${slug(selectedMarksSet.term)}_${selectedMarksSet.year}.csv`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const handleDeleteMarkSet = async (set) => {
    const ok = window.confirm(
      `Delete this mark set?\n\n` +
      `${set.class_level} ${set.stream}\n` +
      `${set.subject} — ${set.aoi_label}\n` +
      `Term ${set.term} ${set.year}\n\n` +
      `This cannot be undone.`
    );
  
    if (!ok) return;
  
    try {
      const res = await fetch(`${API_BASE}/api/admin/marks-set`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": localStorage.getItem("SPESS_ADMIN_KEY"),
        },
        body: JSON.stringify({
          assignmentId: set.assignment_id,
          term: set.term,
          year: set.year,
          aoi: set.aoi_label,
        }),
      });
  
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete mark set");
      }
  
      // Remove from table immediately
      setMarksSets((prev) =>
        prev.filter(
          (m) =>
            !(
              m.assignment_id === set.assignment_id &&
              m.term === set.term &&
              m.year === set.year &&
              m.aoi_label === set.aoi_label
            )
        )
      );
  
      // Clear preview if this set was open
      if (
        selectedMarksSet &&
        selectedMarksSet.assignment_id === set.assignment_id &&
        selectedMarksSet.term === set.term &&
        selectedMarksSet.year === set.year &&
        selectedMarksSet.aoi_label === set.aoi_label
      ) {
        setSelectedMarksSet(null);
        setMarksDetail([]);
      }
    } catch (err) {
      alert(err.message);
    }
  };
  
  const handleDownloadPdf = () => {
    if (!selectedMarksSet || marksDetail.length === 0) return;
    const doc = new jsPDF();
    const schoolName = "St. Phillip's Equatorial Secondary School (SPESS)";
    const aoiTitle = selectedMarksSet.aoi_label || "AOI";
    const classLabel = selectedMarksSet.class_level;
    const streamLabel = selectedMarksSet.stream;
    const subjectLabel = selectedMarksSet.subject;
    const termLabel = selectedMarksSet.term;
    const yearLabel = selectedMarksSet.year;
    const teacherName = selectedMarksSet.teacher_name || "—";
    const submittedAtRaw = selectedMarksSet.submitted_at || selectedMarksSet.created_at || null;
    const submittedAt = formatDateTime(submittedAtRaw);

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(schoolName, 105, 16, { align: "center" });
    doc.setFontSize(18);
    doc.text(aoiTitle, 105, 28, { align: "center" });
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(`Class: ${classLabel}   Stream: ${streamLabel}   Subject: ${subjectLabel}`, 14, 40);
    doc.text(`Term: ${termLabel}   Year: ${yearLabel}`, 14, 47);
    doc.text(`Submitted by: ${teacherName}`, 14, 54);
    doc.text(`Submitted at: ${submittedAt}`, 14, 61);

    // table
    let startY = 72;
    let y = startY;
    const rowHeight = 7;
    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomMargin = 15;

    const drawTableHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("#", 14, y);
      doc.text("Student Name", 24, y);
      doc.text("Class", 120, y);
      doc.text("Stream", 140, y);
      doc.text("Score", 165, y);
      doc.setDrawColor(200);
      doc.line(12, y + 1.5, 198, y + 1.5);
      y += rowHeight;
      doc.setFont("helvetica", "normal");
    };

    drawTableHeader();
    doc.setFontSize(10);

    marksDetail.forEach((row, index) => {
      if (y > pageHeight - bottomMargin) {
        doc.addPage();
        y = startY;
        drawTableHeader();
      }
      const studentName = row.student_name || "";
      const cls = row.class_level || "";
      const str = row.stream || "";
      const score = row.score != null ? String(row.score) : "";
      doc.text(String(index + 1), 14, y);
      doc.text(studentName, 24, y);
      doc.text(cls, 120, y);
      doc.text(str, 140, y);
      doc.text(score, 165, y);
      y += rowHeight;
    });

    // footer
    const pageCount = doc.internal.getNumberOfPages();
    const generatedAt = formatDateTime(new Date().toISOString());
    const footerText = `Generated from SPESS's ARK · ${generatedAt}`;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const ph = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text(footerText, 105, ph - 8, { align: "center" });
    }

    const slug = (str) => String(str || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const filename = `marks_${slug(classLabel)}_${slug(streamLabel)}_${slug(subjectLabel)}_${slug(aoiTitle)}_T${slug(termLabel)}_${yearLabel}.pdf`;
    doc.save(filename);
  };

  const handleDownloadMarksheetPdf = () => {
    setMarksheetError("");
    if (!marksheetClass) {
      setMarksheetError("Select a class for the marksheet.");
      return;
    }
    const list = students.filter((s) => {
      if (s.class_level !== marksheetClass) return false;
      if (!marksheetStream) return true;
      return s.stream === marksheetStream;
    });
    if (list.length === 0) {
      setMarksheetError("No learners found for that class/stream selection.");
      return;
    }

    const doc = new jsPDF();
    const schoolName = "St. Phillip's Equatorial Secondary School (SPESS)";
    const classLabel = marksheetClass;
    const streamLabel = marksheetStream || "North & South";
    const headerTitle = "Class Marksheet";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(schoolName, 105, 16, { align: "center" });
    doc.setFontSize(16);
    doc.text(headerTitle, 105, 26, { align: "center" });
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(`Class: ${classLabel}`, 14, 38);
    doc.text(`Stream: ${streamLabel}`, 14, 45);

    let startY = 58;
    let y = startY;
    const rowHeight = 7;
    const pageHeight = doc.internal.pageSize.getHeight();
    const bottomMargin = 15;

    const drawTableHeader = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("#", 12, y);
      doc.text("Name", 20, y);
      doc.text("Gender", 95, y);
      doc.text("Class", 115, y);
      doc.text("Stream", 135, y);
      doc.text("Optional Subjects", 155, y);
      doc.setDrawColor(200);
      doc.line(10, y + 1.5, 200, y + 1.5);
      y += rowHeight;
      doc.setFont("helvetica", "normal");
    };

    drawTableHeader();
    doc.setFontSize(9);

    list.sort((a, b) => a.name.localeCompare(b.name)).forEach((s, index) => {
      if (y > pageHeight - bottomMargin) {
        doc.addPage();
        y = startY;
        drawTableHeader();
      }
      const subs = Array.isArray(s.subjects) ? s.subjects : [];
      const optionalSubs = subs.filter((sub) => OPTIONAL_SUBJECTS.includes(sub));
      const optionalText = optionalSubs.join(", ");
      doc.text(String(index + 1), 12, y);
      doc.text(s.name || "", 20, y);
      doc.text(s.gender || "", 95, y);
      doc.text(s.class_level || "", 115, y);
      doc.text(s.stream || "", 135, y);
      const split = doc.splitTextToSize(optionalText, 50);
      doc.text(split, 155, y);
      y += rowHeight * Math.max(1, split.length);
    });

    const pageCount = doc.internal.getNumberOfPages();
    const generatedAt = formatDateTime(new Date().toISOString());
    const footerText = `Generated from SPESS's ARK · ${generatedAt}`;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const ph = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text(footerText, 105, ph - 8, { align: "center" });
    }

    const slug = (str) => String(str || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const filename = `marksheet_${slug(classLabel)}_${slug(marksheetStream || "all_streams")}.pdf`;
    doc.save(filename);
  };

  /* ------------------ Card click handler ------------------ */
  const handleCardClick = (title) => {
    console.log("[AdminDashboard] card clicked:", title);
    setActiveSection((prev) => {
      const next = prev === title ? "" : title;
      console.log("[AdminDashboard] activeSection ->", next);
      return next;
    });
  };

  /* ------------------ Derived values / filters ------------------ */
  const allSubjectsForFilter = [...COMPULSORY_SUBJECTS, ...OPTIONAL_SUBJECTS];
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

  const classOptions = Array.from(new Set(students.map((s) => s.class_level))).filter(Boolean);
  const classOptionsForMarksheet = classOptions.length > 0 ? classOptions : ["S1", "S2", "S3", "S4"];

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
                <button type="button" className="ghost-btn" onClick={fetchTeachers} disabled={loadingTeachers}>{loadingTeachers ? "Refreshing…" : "Refresh"}</button>
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
                        <th>Subject 1</th>
                        <th>Subject 2</th>
                        <th>Added</th>
                        <th/>
                      </tr>
                    </thead>
                    <tbody>
                      {teachers.map((t) => (
                        <tr key={t.id}>
                          <td>{t.name}</td>
                          <td>{t.email}</td>
                          <td>{t.subject1}</td>
                          <td>{t.subject2}</td>
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

                  <button type="button" className="primary-btn" onClick={handleDownloadMarksheetPdf} style={{ whiteSpace: "nowrap" }}>Download Marksheet</button>
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
            <button
              className="panel-close"
              onClick={() => setActiveSection("")}
            >
              ✕ Close
            </button>
          </div>
    
          {noticesError && (
            <div className="panel-alert panel-alert-error">
              {noticesError}
            </div>
          )}
    
          <div className="panel-grid">
            {/* ================= CREATE NOTICE ================= */}
            <div className="panel-card">
              <h3>Create Notice</h3>
    
              <form
                className="teacher-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreateNotice();
                }}
              >
                <div className="form-row">
                  <label>Title</label>
                  <input
                    type="text"
                    value={noticeTitle}
                    onChange={(e) => setNoticeTitle(e.target.value)}
                    placeholder="e.g. End of Term Schedule"
                  />
                </div>
    
                <div className="form-row">
                  <label>Message</label>
                  <textarea
                    rows={4}
                    value={noticeBody}
                    onChange={(e) => setNoticeBody(e.target.value)}
                    placeholder="Write the notice here…"
                    style={{
                      resize: "vertical",
                      borderRadius: "0.6rem",
                      padding: "0.6rem",
                      background: "rgba(15,23,42,0.9)",
                      color: "#e5e7eb",
                      border: "1px solid rgba(55,65,81,0.9)",
                    }}
                  />
                </div>
    
                <button className="primary-btn" type="submit">
                  Publish Notice
                </button>
                
              </form>
              {notices.map((n) => (
  <div key={n.id} className="notice-item">
    <h4>{n.title}</h4>
    <p>{n.body}</p>
    <small>{formatDateTime(n.created_at)}</small>

    <button
      className="danger-link"
      onClick={() => handleDeleteNotice(n.id)}
    >
      Delete
    </button>
  </div>
))}

            </div>
                      
            {/* ================= EXISTING NOTICES ================= */}
            <div className="panel-card">
              <h3>Published Notices</h3>
    
              {loadingNotices ? (
                <p className="muted-text">Loading notices…</p>
              ) : notices.length === 0 ? (
                <p className="muted-text">No notices yet.</p>
              ) : (
                notices.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      padding: "0.8rem 0",
                      borderBottom: "1px solid rgba(148,163,184,0.15)",
                    }}
                  >
                    <h4 style={{ marginBottom: "0.3rem" }}>{n.title}</h4>
                    <p style={{ marginBottom: "0.4rem" }}>{n.body}</p>
                    <small className="muted-text">
                      {formatDateTime(n.created_at)}
                    </small>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      );
    }
    
    
    // --- Assign Subjects branch (guaranteed to render when activeSection matches) ---
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
              <p>View submitted AOI scores by class, stream and subject, and export them to Excel or PDF.</p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button className="ghost-btn" onClick={() => setActiveSection("Add Students")}>Add Students</button>
              <button className="ghost-btn" onClick={() => setActiveSection("Download Marks")}>Download Marks</button>
              <button className="panel-close" type="button" onClick={() => setActiveSection("")}>✕ Close</button>
            </div>
          </div>

          {marksError && <div className="panel-alert panel-alert-error">{marksError}</div>}

          <div className="panel-grid">
            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Available mark sets</h3>
                <button type="button" className="ghost-btn" onClick={fetchMarksSets} disabled={loadingMarksSets}>{loadingMarksSets ? "Refreshing…" : "Refresh"}</button>
              </div>

              {loadingMarksSets && marksSets.length === 0 ? (
                <p className="muted-text">Loading marks summary…</p>
              ) : marksSets.length === 0 ? (
                <p className="muted-text">No marks recorded yet or admin access required. Use Refresh after setting admin key.</p>
              ) : (
                <div className="teachers-table-wrapper">
                  <table className="teachers-table">
                    <thead>
                      <tr>
                        <th>Class</th>
                        <th>Stream</th>
                        <th>Subject</th>
                        <th>AOI</th>
                        <th>Term</th>
                        <th>Year</th>
                        <th>Submitted by</th>
                        <th>Submitted at</th>
                        <th>Learners</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marksSets.map((set) => {
                        const isSelected = selectedMarksSet && selectedMarksSet.assignment_id === set.assignment_id && selectedMarksSet.term === set.term && selectedMarksSet.year === set.year && selectedMarksSet.aoi_label === set.aoi_label;
                        const submittedAt = set.submitted_at || set.created_at || null;
                        return (
                          <tr key={`${set.assignment_id}-${set.term}-${set.year}-${set.aoi_label}`} onClick={() => setSelectedMarksSet(set)} style={{ cursor: "pointer", background: isSelected ? "rgba(37,99,235,0.25)" : "transparent" }}>
                            <td>{set.class_level}</td>
                            <td>{set.stream}</td>
                            <td>{set.subject}</td>
                            <td>{set.aoi_label}</td>
                            <td>{set.term}</td>
                            <td>{set.year}</td>
                            <td>{set.teacher_name}</td>
                            <td>{formatDateTime(submittedAt)}</td>
                            <td>{set.marks_count}</td>
                            <td className="teachers-actions">
                              <button type="button" className="ghost-btn" onClick={(e) => { e.stopPropagation(); setSelectedMarksSet(set); }}>View</button>
                              <button type="button" className="danger-link" onClick={(e)=>{e.stopPropagation();handleDeleteMarkSet(set);}} >Delete</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>      
            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Marks preview</h3>
                {selectedMarksSet && marksDetail.length > 0 && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button type="button" className="ghost-btn" onClick={handleDownloadCsv} disabled={loadingMarksDetail}>Download CSV</button>
                    <button type="button" className="primary-btn" onClick={handleDownloadPdf} disabled={loadingMarksDetail}>Download PDF</button>
                  </div>
                )}
              </div>
                  
              {!selectedMarksSet ? (
                <p className="muted-text">Select a mark set on the left to preview scores.</p>
              ) : loadingMarksDetail && marksDetail.length === 0 ? (
                <p className="muted-text">Loading marks…</p>
              ) : marksDetail.length === 0 ? (
                <p className="muted-text">No marks found for this selection.</p>
              ) : (
                <>
                  <p className="muted-text" style={{ marginBottom: "0.6rem" }}>{selectedMarksSet.class_level} {selectedMarksSet.stream} — {selectedMarksSet.subject}, {selectedMarksSet.aoi_label}, Term {selectedMarksSet.term} {selectedMarksSet.year}</p>
                  <div className="teachers-table-wrapper">
                    <table className="teachers-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Class</th>
                          <th>Stream</th>
                          <th>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {marksDetail.map((row) => (
                          <tr key={row.student_id}>
                            <td>{row.student_name}</td>
                            <td>{row.class_level}</td>
                            <td>{row.stream}</td>
                            <td>{row.score}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
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
            <button
              className="panel-close"
              type="button"
              onClick={() => setActiveSection("")}
            >
              ✕ Close
            </button>
          </div>
    
          {/* 🔽 REAL UI LIVES HERE */}
          <EndOfTermReports />
        </section>
      );
    }
    
    
    
    return <p className="admin-hint">Click a card above to open its detailed view.</p>;
  };
  {editingStudent && (
    <EditStudentModal
      student={editingStudent}
      onClose={() => setEditingStudent(null)}
      onSave={() => {
        setEditingStudent(null);
        fetchStudents();
      }}
    />
  )}
  
  /* ------------------ main render ------------------ */
  return (
    <div className="admin-root">
      <header className="admin-nav">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-text">SPESS’s ARK</span>
          <span className="brand-tag">Admin</span>
        </div>

        <button className="nav-logout" onClick={handleLogout}>
          Logout
            </button>

      </header>

      <main className="admin-main">
        <section className="admin-heading">
          <h1>Admin Dashboard</h1>
          <p>Quick actions for managing students, teachers and marks. Select a card below to open its detailed view.</p>

          <div style={{ marginTop: "1.8rem", display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            <div style={{ flex: "1 1 260px", padding: "1.4rem 1.6rem", borderRadius: "1rem", background: "linear-gradient(135deg, rgba(56,189,248,0.22), rgba(79,70,229,0.35))", border: "1px solid rgba(59,130,246,0.6)", boxShadow: "0 18px 40px rgba(15,23,42,0.8)" }}>
              <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.18em", color: "#bfdbfe", marginBottom: "0.4rem" }}>Total School Population</div>
              <div style={{ fontSize: "2.3rem", fontWeight: 700, lineHeight: 1.1 }}>{totalStudents}</div>
              <div style={{ marginTop: "0.4rem", fontSize: "0.85rem", color: "#e5e7eb" }}>Boys: <strong>{totalBoys}</strong> • Girls: <strong>{totalGirls}</strong></div>
            </div>

            <div style={{ flex: "1 1 180px", padding: "1.1rem 1.3rem", borderRadius: "1rem", background: "linear-gradient(135deg, rgba(34,197,94,0.2), rgba(22,163,74,0.35))", border: "1px solid rgba(34,197,94,0.7)" }}>
              <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#bbf7d0", marginBottom: "0.2rem" }}>Learners by Gender</div>
              <div style={{ fontSize: "0.95rem", color: "#e5e7eb" }}>Boys enrolled: <strong style={{ fontSize: "1.1rem" }}>{totalBoys}</strong><br/>Girls enrolled: <strong style={{ fontSize: "1.1rem" }}>{totalGirls}</strong></div>
            </div>

            <div style={{ flex: "1 1 220px", padding: "1.1rem 1.3rem", borderRadius: "1rem", background: "linear-gradient(135deg, rgba(14,165,233,0.22), rgba(59,130,246,0.35))", border: "1px solid rgba(56,189,248,0.8)" }}>
              <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#e0f2fe", marginBottom: "0.2rem" }}>Class Breakdown (S1–S4)</div>
              <div style={{ fontSize: "0.95rem", color: "#e5e7eb" }}>S1: <strong style={{ fontSize: "1.05rem" }}>{s1Students}</strong><br/>S2: <strong style={{ fontSize: "1.05rem" }}>{s2Students}</strong><br/>S3: <strong style={{ fontSize: "1.05rem" }}>{s3Students}</strong><br/>S4: <strong style={{ fontSize: "1.05rem" }}>{s4Students}</strong></div>
            </div>

            <div style={{ flex: "1 1 180px", padding: "1.1rem 1.3rem", borderRadius: "1rem", background: "linear-gradient(135deg, rgba(244,114,182,0.22), rgba(236,72,153,0.35))", border: "1px solid rgba(244,114,182,0.8)" }}>
              <div style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "#fce7f3", marginBottom: "0.2rem" }}>Teachers Enrolled</div>
              <div style={{ fontSize: "2rem", fontWeight: 600, lineHeight: 1.1, color: "#f9a8d4" }}>{totalTeachers}</div>
              <div style={{ marginTop: "0.4rem", fontSize: "0.85rem", color: "#fdf2f8" }}>Active teachers in the system.</div>
            </div>
          </div>
        </section>

        <section className="admin-grid">
          {cards.map((card) => (
            <article key={card.title} className="admin-card">
              <div className="card-icon">{card.icon}</div>
              <div className="card-body">
                <h2>{card.title}</h2>
                <p>{card.subtitle}</p>
              </div>
              <div className="card-footer">
                <button className="card-button" type="button" onClick={() => handleCardClick(card.title)}>Open</button>
              </div>
            </article>
          ))}
        </section>

        <section className="admin-section">{renderSectionContent()}</section>
      </main>
      {editingStudent && (
  <EditStudentModal
    student={editingStudent}
    onClose={() => setEditingStudent(null)}
    onSaved={(updatedStudent) => {
      setStudents((prev) =>
        prev.map((s) =>
          s.id === updatedStudent.id ? updatedStudent : s
              )
            );
      setEditingStudent(null);
              }}
                           />
      )}

    </div>
  );

 
}
export default AdminDashboard;
