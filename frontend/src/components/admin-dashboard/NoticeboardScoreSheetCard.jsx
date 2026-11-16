import React, { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../../lib/api";
import { loadPdfTools } from "../../utils/loadPdfTools";
import { getOLevelMarkEntryColumns } from "../../utils/oLevelYearAssessmentPolicy";
import "./NoticeboardScoreSheetCard.css";

const normalizeSubjectKey = (value) => {
  const compact = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (
    compact === "ict" ||
    compact.includes("informationandcommunicationtechnology") ||
    compact.includes("informationcommunicationtechnology")
  ) {
    return "ict";
  }
  if (compact === "cre") return "christianreligiouseducation";
  return compact;
};

const formatComponentLabel = (component) => {
  if (component === "EXAM80") return "/80 (END)";
  return String(component || "").replace(/^AOI/i, "AOI ");
};

const formatScore = (mark) => {
  if (!mark) return "";
  if (String(mark.status || "").toLowerCase() === "missed") return "X";
  if (mark.score === null || mark.score === undefined || mark.score === "") return "";
  const numericScore = Number(mark.score);
  return Number.isFinite(numericScore)
    ? String(Number(numericScore.toFixed(2)))
    : String(mark.score);
};

const formatGeneratedAt = (date) =>
  date.toLocaleString("en-UG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Kampala",
  });

export default function NoticeboardScoreSheetCard({
  classOptions = [],
  activeStudents = [],
  marksSets = [],
}) {
  const currentYear = new Date().getFullYear();
  const [filters, setFilters] = useState({
    class_level: classOptions[0] || "S1",
    stream: "North",
    term: "Term 1",
    year: currentYear,
    subject: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const streamOptions = useMemo(() => {
    const fromStudents = activeStudents
      .filter((student) => !filters.class_level || student.class_level === filters.class_level)
      .map((student) => student.stream);
    const fromMarks = marksSets
      .filter((row) => !filters.class_level || row.class_level === filters.class_level)
      .map((row) => row.stream);
    const streams = Array.from(new Set([...fromStudents, ...fromMarks])).filter(Boolean);
    return (streams.length ? streams : ["North", "South"]).sort((a, b) => {
      const order = { North: 0, South: 1 };
      return (order[a] ?? 99) - (order[b] ?? 99) || String(a).localeCompare(String(b));
    });
  }, [activeStudents, filters.class_level, marksSets]);

  const subjectOptions = useMemo(() => {
    const subjects = marksSets
      .filter(
        (row) =>
          row.class_level === filters.class_level &&
          row.stream === filters.stream &&
          row.term === filters.term &&
          Number(row.year) === Number(filters.year)
      )
      .map((row) => String(row.subject || "").trim())
      .filter(Boolean);

    const unique = new Map();
    subjects.forEach((subject) => {
      const key = normalizeSubjectKey(subject);
      if (!unique.has(key)) unique.set(key, subject);
    });
    return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
  }, [filters.class_level, filters.stream, filters.term, filters.year, marksSets]);

  useEffect(() => {
    if (
      classOptions.length > 0 &&
      !classOptions.includes(filters.class_level)
    ) {
      setFilters((previous) => ({ ...previous, class_level: classOptions[0] }));
    }
  }, [classOptions, filters.class_level]);

  useEffect(() => {
    if (!streamOptions.includes(filters.stream)) {
      setFilters((previous) => ({ ...previous, stream: streamOptions[0] || "North" }));
    }
  }, [filters.stream, streamOptions]);

  useEffect(() => {
    if (
      filters.subject &&
      filters.subject !== "all" &&
      !subjectOptions.some(
        (subject) => normalizeSubjectKey(subject) === normalizeSubjectKey(filters.subject)
      )
    ) {
      setFilters((previous) => ({ ...previous, subject: "" }));
    }
  }, [filters.subject, subjectOptions]);

  const updateFilter = (key, value) => {
    setError("");
    setFilters((previous) => ({ ...previous, [key]: value }));
  };

  const openScoreSheetPdf = async () => {
    setError("");
    const classLevel = String(filters.class_level || "").trim();
    const stream = String(filters.stream || "").trim();
    const term = String(filters.term || "").trim();
    const year = Number(filters.year);

    if (!classLevel || !stream || !term || !year) {
      setError("Select class, stream, term and year first.");
      return;
    }
    if (!filters.subject) {
      setError("Select one subject, or deliberately choose the all-subject booklet.");
      return;
    }

    setLoading(true);
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

      const printableSubjects = filters.subject === "all"
        ? subjects
        : subjects.filter(
            (subject) =>
              normalizeSubjectKey(subject.subject) === normalizeSubjectKey(filters.subject)
          );

      if (students.length === 0) {
        throw new Error("No active learners were found in that class and stream.");
      }
      if (printableSubjects.length === 0) {
        throw new Error("No submitted marks were found for the selected subject and period.");
      }

      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const generatedAt = formatGeneratedAt(new Date());
      const expectedComponents = getOLevelMarkEntryColumns(term, year);
      let renderedSubjects = 0;

      printableSubjects.forEach((subjectRow) => {
        const assignmentIds = new Set(
          (Array.isArray(subjectRow.assignment_ids)
            ? subjectRow.assignment_ids
            : [subjectRow.assignment_id]
          )
            .map(Number)
            .filter((id) => Number.isInteger(id) && id > 0)
        );
        const subjectMarks = marks.filter((mark) =>
          assignmentIds.has(Number(mark.assignment_id))
        );
        const actualComponents = Array.from(
          new Set(subjectMarks.map((mark) => String(mark.aoi_label || "").toUpperCase()))
        ).filter((component) => ["AOI1", "AOI2", "AOI3", "EXAM80"].includes(component));
        const components = Array.from(
          new Set([...expectedComponents, ...actualComponents])
        );

        const markMap = new Map();
        subjectMarks.forEach((mark) => {
          markMap.set(
            `${Number(mark.student_id)}|${String(mark.aoi_label || "").toUpperCase()}`,
            mark
          );
        });
        const learners = students.filter((student) =>
          components.some((component) => markMap.has(`${Number(student.id)}|${component}`))
        );
        if (learners.length === 0) return;

        if (renderedSubjects > 0) doc.addPage();
        renderedSubjects += 1;
        const subjectStartPage = doc.internal.getCurrentPageInfo().pageNumber;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text("St. Phillip's Equatorial Secondary School (SPESS)", pageWidth / 2, 13, {
          align: "center",
        });
        doc.setFontSize(11);
        doc.text("NOTICEBOARD SCORE SHEET", pageWidth / 2, 20, { align: "center" });
        doc.setFontSize(12);
        doc.text(String(subjectRow.subject || "Subject"), pageWidth / 2, 28, {
          align: "center",
          maxWidth: pageWidth - 28,
        });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.text(`${classLevel} ${stream}  |  ${term} ${year}`, 12, 36);
        doc.text(`Teacher: ${subjectRow.teacher_name || "-"}`, pageWidth - 12, 36, {
          align: "right",
          maxWidth: 88,
        });
        doc.setDrawColor(45, 45, 45);
        doc.line(12, 39, pageWidth - 12, 39);

        const body = learners.map((learner, index) => [
          index + 1,
          learner.name || "",
          String(learner.gender || "").slice(0, 1).toUpperCase(),
          ...components.map((component) =>
            formatScore(markMap.get(`${Number(learner.id)}|${component}`))
          ),
        ]);
        const availableScoreWidth = 80;
        const scoreWidth = availableScoreWidth / Math.max(components.length, 1);

        autoTable(doc, {
          startY: 43,
          margin: { left: 12, right: 12, top: 20, bottom: 16 },
          head: [["#", "Learner", "G", ...components.map(formatComponentLabel)]],
          body,
          theme: "grid",
          styles: {
            font: "helvetica",
            fontSize: 9.2,
            cellPadding: 2.1,
            valign: "middle",
            textColor: [20, 20, 20],
            lineColor: [90, 90, 90],
            lineWidth: 0.15,
            halign: "center",
          },
          headStyles: {
            fillColor: [235, 235, 235],
            textColor: [0, 0, 0],
            fontStyle: "bold",
            lineColor: [60, 60, 60],
          },
          alternateRowStyles: { fillColor: [248, 248, 248] },
          columnStyles: {
            0: { cellWidth: 9 },
            1: { cellWidth: 77, halign: "left" },
            2: { cellWidth: 14 },
            ...Object.fromEntries(
              components.map((_, index) => [3 + index, { cellWidth: scoreWidth }])
            ),
          },
          didDrawPage: () => {
            const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
            if (currentPage > subjectStartPage) {
              doc.setFont("helvetica", "bold");
              doc.setFontSize(8.5);
              doc.text(
                `${subjectRow.subject} - ${classLevel} ${stream} - ${term} ${year}`,
                12,
                11
              );
              doc.setDrawColor(120, 120, 120);
              doc.line(12, 14, pageWidth - 12, 14);
            }
          },
        });
      });

      if (renderedSubjects === 0) {
        throw new Error("The selected subject has no submitted learner marks to print.");
      }

      const totalPages = doc.internal.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setDrawColor(100, 100, 100);
        doc.line(12, pageHeight - 13, pageWidth - 12, pageHeight - 13);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.text(`X = missed assessment  |  Blank = no submitted mark  |  ${generatedAt}`, 12, pageHeight - 8);
        doc.text(`Page ${page} of ${totalPages}`, pageWidth - 12, pageHeight - 8, {
          align: "right",
        });
      }

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error("Noticeboard score sheet error:", err);
      setError(err.message || "Failed to generate noticeboard score sheet.");
    } finally {
      setLoading(false);
    }
  };

  const normalizedClassOptions = classOptions.length ? classOptions : ["S1", "S2", "S3", "S4"];

  return (
    <div className="panel-card noticeboard-score-card">
      <div className="noticeboard-score-card__header">
        <div>
          <span className="noticeboard-score-card__eyebrow">Printable marks</span>
          <h3>Noticeboard Score Sheet</h3>
          <p>Print one readable subject, or build a subject-by-subject booklet.</p>
        </div>
        <span className="noticeboard-score-card__format">A4 portrait</span>
      </div>

      <div className="noticeboard-score-card__filters">
        <label>
          <span>Class</span>
          <select value={filters.class_level} onChange={(event) => updateFilter("class_level", event.target.value)}>
            {normalizedClassOptions.map((classLevel) => (
              <option key={classLevel} value={classLevel}>{classLevel}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Stream</span>
          <select value={filters.stream} onChange={(event) => updateFilter("stream", event.target.value)}>
            {streamOptions.map((stream) => (
              <option key={stream} value={stream}>{stream}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Term</span>
          <select value={filters.term} onChange={(event) => updateFilter("term", event.target.value)}>
            <option value="Term 1">Term 1</option>
            <option value="Term 2">Term 2</option>
            <option value="Term 3">Term 3</option>
          </select>
        </label>
        <label>
          <span>Year</span>
          <input
            type="number"
            min="2020"
            max="2100"
            value={filters.year}
            onChange={(event) => updateFilter("year", Number(event.target.value) || currentYear)}
          />
        </label>
        <label className="noticeboard-score-card__subject">
          <span>Subject</span>
          <select value={filters.subject} onChange={(event) => updateFilter("subject", event.target.value)}>
            <option value="">Select a subject</option>
            {subjectOptions.map((subject) => (
              <option key={normalizeSubjectKey(subject)} value={subject}>{subject}</option>
            ))}
            <option value="all">All submitted subjects - one per page</option>
          </select>
        </label>
      </div>

      <div className="noticeboard-score-card__footer">
        <div>
          <strong>{subjectOptions.length}</strong>
          <span> submitted subjects match this period</span>
        </div>
        <button type="button" className="primary-btn" onClick={openScoreSheetPdf} disabled={loading}>
          {loading ? "Preparing PDF..." : "Open Noticeboard PDF"}
        </button>
      </div>

      {error && <div className="panel-alert panel-alert-error">{error}</div>}
    </div>
  );
}
