import { useEffect, useMemo, useState } from "react";
import badge from "../../../assets/badge.png";
import { adminFetch, plainFetch } from "../../../lib/api";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import { getSchoolCalendarBadge, normalizeSchoolCalendar } from "../../../utils/schoolCalendar";
import "./ALevelMarksheetCard.css";

const CLASS_LEVELS = ["S5", "S6"];
const STREAM_TRACKS = ["Arts", "Sciences"];

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeTermLabel(value) {
  const compact = normalizeText(value).replace(/[\s_-]+/g, "");
  if (compact.includes("term3") || compact.includes("termiii")) return "Term 3";
  if (compact.includes("term2") || compact.includes("termii")) return "Term 2";
  if (compact.includes("term1") || compact.includes("termi")) return "Term 1";
  return "";
}

function learnerSubjects(learner) {
  return String(learner?.subjects || "")
    .split(",")
    .map((subject) => subject.trim())
    .filter(Boolean);
}

function loadBadgeImage() {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = badge;
  });
}

export default function ALevelMarksheetCard({ learners = [] }) {
  const [subjects, setSubjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [schoolCalendar, setSchoolCalendar] = useState(null);
  const [classLevel, setClassLevel] = useState("");
  const [streamTrack, setStreamTrack] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [paperLabel, setPaperLabel] = useState("");
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let active = true;

    plainFetch("/api/alevel/subjects")
      .then((rows) => {
        if (active) setSubjects(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        console.error("Failed to load A-Level marksheet subjects", error);
        if (active) setSubjects([]);
      });

    // Assignments are admin-scoped because they include the current teacher owner.
    adminFetch("/api/alevel/admin/assignments")
      .then((rows) => {
        if (active) setAssignments(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        console.error("Failed to load A-Level marksheet assignments", error);
        if (active) setAssignments([]);
      });

    plainFetch("/api/school-calendar")
      .then((calendar) => {
        if (active) setSchoolCalendar(normalizeSchoolCalendar(calendar));
      })
      .catch((error) => {
        console.error("Failed to load A-Level marksheet calendar", error);
        if (active) setSchoolCalendar(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const selectedStream = classLevel && streamTrack ? `${classLevel} ${streamTrack}` : "";

  const streamLearners = useMemo(
    () => learners.filter((learner) => String(learner?.stream || "").trim() === selectedStream),
    [learners, selectedStream]
  );

  const subjectOptions = useMemo(() => {
    const registeredNames = new Map();

    streamLearners.forEach((learner) => {
      learnerSubjects(learner).forEach((subject) => {
        registeredNames.set(normalizeText(subject), subject);
      });
    });

    const subjectMetadata = new Map(
      subjects.map((subject) => [normalizeText(subject?.name), subject])
    );

    return Array.from(registeredNames.entries())
      .map(([key, registeredName]) => {
        const metadata = subjectMetadata.get(key);
        return {
          id: metadata?.id || key,
          name: metadata?.name || registeredName,
          paper_options:
            Array.isArray(metadata?.paper_options) && metadata.paper_options.length > 0
              ? metadata.paper_options
              : ["Single"],
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [streamLearners, subjects]);

  const selectedSubject = subjectOptions.find(
    (subject) => normalizeText(subject.name) === normalizeText(subjectName)
  );
  const paperOptions = selectedSubject?.paper_options || [];

  // An A-Level paper can have a different teacher from the other paper, so the
  // assignee must match the complete stream + subject + paper combination.
  const selectedAssignment = useMemo(() => {
    if (!selectedStream || !subjectName || !paperLabel) return null;

    return assignments.find((assignment) => (
      normalizeText(assignment?.stream) === normalizeText(selectedStream) &&
      normalizeText(assignment?.subject) === normalizeText(subjectName) &&
      normalizeText(assignment?.paper_label || "Single") === normalizeText(paperLabel)
    )) || null;
  }, [assignments, paperLabel, selectedStream, subjectName]);

  const assignedTeacherName = String(selectedAssignment?.teacher_name || "").trim() || "Not assigned";

  const academicPeriod = useMemo(() => {
    if (!schoolCalendar) return { term: "", year: "" };

    const badgeDetails = getSchoolCalendarBadge(schoolCalendar, new Date());
    return {
      term: normalizeTermLabel(badgeDetails.termLabel),
      year: String(schoolCalendar.academicYear || "").trim(),
    };
  }, [schoolCalendar]);

  const marksheetLearners = useMemo(() => {
    if (!selectedStream || !subjectName) return [];

    return streamLearners
      .filter((learner) =>
        learnerSubjects(learner).some(
          (subject) => normalizeText(subject) === normalizeText(subjectName)
        )
      )
      .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
  }, [selectedStream, streamLearners, subjectName]);

  const resetSubjectSelection = () => {
    setSubjectName("");
    setPaperLabel("");
    setMessage("");
  };

  const handleSubjectChange = (value) => {
    const subject = subjectOptions.find(
      (option) => normalizeText(option.name) === normalizeText(value)
    );
    const nextPapers = subject?.paper_options || [];

    setSubjectName(value);
    setPaperLabel(nextPapers[0] || "");
    setMessage("");
  };

  const handleDownloadPdf = async () => {
    setMessage("");

    if (!classLevel || !streamTrack || !subjectName || !paperLabel) {
      setMessage("Select class, stream, subject, and paper before generating the marksheet.");
      return;
    }

    if (!academicPeriod.term || !academicPeriod.year) {
      setMessage("The active academic term and year are unavailable. Update the school calendar first.");
      return;
    }

    if (marksheetLearners.length === 0) {
      setMessage("No registered learners match this stream and subject.");
      return;
    }

    setGenerating(true);

    try {
      const [{ jsPDF, autoTable }, badgeImage] = await Promise.all([
        loadPdfTools(),
        loadBadgeImage(),
      ]);
      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const generatedAt = new Date();
      const generatedLabel = generatedAt.toLocaleString();
      const paperDisplay = paperLabel === "Single" ? "Single Paper" : paperLabel;
      const assignmentDisplay = paperLabel === "Single"
        ? subjectName
        : `${subjectName} - ${paperLabel}`;

      if (badgeImage?.naturalWidth) {
        doc.addImage(badgeImage, "PNG", 14, 11, 17, 17);
      }

      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(14);
      doc.text("St. Phillip's Equatorial Secondary School", pageWidth / 2, 17, {
        align: "center",
      });
      doc.setFontSize(16);
      doc.text("A-Level Blank Marksheet", pageWidth / 2, 25, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(51, 65, 85);
      doc.text(`${assignmentDisplay}  |  ${selectedStream}`, pageWidth / 2, 31, {
        align: "center",
      });

      doc.setDrawColor(148, 163, 184);
      doc.line(14, 36, pageWidth - 14, 36);
      doc.setFontSize(9);
      doc.text(`Class: ${classLevel}`, 14, 42);
      doc.text(`Stream: ${streamTrack}`, 52, 42);
      doc.text(`Subject: ${subjectName}`, 96, 42);
      doc.text(`Paper: ${paperDisplay}`, 154, 42);
      doc.text(`Teacher: ${assignedTeacherName}`, 14, 49);
      doc.text(`Term: ${academicPeriod.term}`, 112, 49);
      doc.text(`Year: ${academicPeriod.year}`, 158, 49);
      doc.text(`Registered learners: ${marksheetLearners.length}`, 14, 56);

      const rows = marksheetLearners.map((learner, index) => [
        index + 1,
        learner?.name || "",
        learner?.gender || "",
        "",
        "",
        "",
      ]);

      autoTable(doc, {
        startY: 61,
        margin: { top: 25, left: 14, right: 14, bottom: 18 },
        head: [["#", "Learner Name", "Gender", "MID", "END", "Particulars"]],
        body: rows,
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 9,
          cellPadding: { top: 3.2, right: 2.3, bottom: 3.2, left: 2.3 },
          lineColor: [148, 163, 184],
          lineWidth: 0.2,
          textColor: [15, 23, 42],
          valign: "middle",
          fillColor: [255, 255, 255],
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: "bold",
          lineColor: [100, 116, 139],
          lineWidth: 0.25,
        },
        columnStyles: {
          0: { cellWidth: 10, halign: "center" },
          1: { cellWidth: 68 },
          2: { cellWidth: 20, halign: "center" },
          3: { cellWidth: 20, minCellHeight: 10.5, halign: "center" },
          4: { cellWidth: 20, minCellHeight: 10.5, halign: "center" },
          5: { cellWidth: 44, minCellHeight: 10.5 },
        },
      });

      const pageCount = doc.internal.getNumberOfPages();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        doc.setPage(pageNumber);

        if (pageNumber > 1) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.setTextColor(15, 23, 42);
          doc.text(`${assignmentDisplay} - ${selectedStream}`, 14, 17);
          doc.setFont("helvetica", "normal");
          doc.text("MID / END Marksheet", pageWidth - 14, 17, { align: "right" });
          doc.setDrawColor(148, 163, 184);
          doc.line(14, 20, pageWidth - 14, 20);
        }

        doc.setDrawColor(203, 213, 225);
        doc.line(14, pageHeight - 14, pageWidth - 14, pageHeight - 14);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`Generated from SPESS ARK | ${generatedLabel}`, 14, pageHeight - 8.5);
        doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - 14, pageHeight - 8.5, {
          align: "right",
        });
      }

      const blob = doc.output("blob");
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

      setMessage(
        `Opened ${subjectName} ${paperDisplay} marksheet for ${marksheetLearners.length} learners (${assignedTeacherName}).`
      );
    } catch (error) {
      console.error("A-Level marksheet PDF error", error);
      setMessage(error?.message || "Failed to generate the A-Level marksheet.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="alevel-marksheet-section" aria-labelledby="alevel-marksheet-title">
      <div className="alevel-marksheet-header">
        <div>
          <span>A-Level marksheets</span>
          <h3 id="alevel-marksheet-title">Blank MID / END score register</h3>
          <p>Print a paper-specific sheet containing only learners registered for the selected subject.</p>
        </div>
        <strong>{marksheetLearners.length} learners</strong>
      </div>

      <div className="alevel-marksheet-controls">
        <label>
          <span>Class</span>
          <select
            value={classLevel}
            onChange={(event) => {
              setClassLevel(event.target.value);
              resetSubjectSelection();
            }}
          >
            <option value="">Select class</option>
            {CLASS_LEVELS.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Stream</span>
          <select
            value={streamTrack}
            onChange={(event) => {
              setStreamTrack(event.target.value);
              resetSubjectSelection();
            }}
          >
            <option value="">Arts or Sciences</option>
            {STREAM_TRACKS.map((track) => (
              <option key={track} value={track}>{track}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Subject</span>
          <select
            value={subjectName}
            onChange={(event) => handleSubjectChange(event.target.value)}
            disabled={!selectedStream || subjectOptions.length === 0}
          >
            <option value="">Select subject</option>
            {subjectOptions.map((subject) => (
              <option key={subject.id} value={subject.name}>{subject.name}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Paper</span>
          <select
            value={paperLabel}
            onChange={(event) => {
              setPaperLabel(event.target.value);
              setMessage("");
            }}
            disabled={!subjectName}
          >
            <option value="">Select paper</option>
            {paperOptions.map((paper) => (
              <option key={paper} value={paper}>{paper === "Single" ? "Single paper" : paper}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="primary-btn alevel-marksheet-download"
          onClick={handleDownloadPdf}
          disabled={generating}
        >
          {generating ? "Preparing PDF..." : "Download PDF"}
        </button>
      </div>

      {message && <div className="alevel-marksheet-message" role="status">{message}</div>}
    </section>
  );
}
