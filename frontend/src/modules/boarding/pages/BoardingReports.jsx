import { useState } from "react";
import BoardingAdminShell from "../components/BoardingAdminShell";
import { boardingFetch } from "../api";
import { loadPdfTools } from "../../../utils/loadPdfTools";
import badge from "../../../assets/badge.png";
import "../../../pages/AdminDashboard.css";

const CLASSES = ["S1", "S2", "S3", "S4"];
const TERMS = ["Term 1", "Term 2", "Term 3"];

const fieldLabelStyle = {
  display: "grid",
  gap: "0.35rem",
  color: "rgba(241,245,249,0.88)",
  fontSize: "0.9rem",
  fontWeight: 700,
};

const fieldInputStyle = {
  width: "100%",
  minHeight: "46px",
  padding: "0.8rem 0.95rem",
  borderRadius: "14px",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "linear-gradient(180deg, rgba(9,14,28,0.98) 0%, rgba(15,23,42,0.92) 100%)",
  color: "#f8fafc",
  outline: "none",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 22px rgba(2,6,23,0.18)",
  fontSize: "0.95rem",
  fontWeight: 600,
};

const statTileStyle = {
  padding: "1rem 1.05rem",
  borderRadius: "18px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.42) 100%)",
  border: "1px solid rgba(255,255,255,0.08)",
  boxShadow: "0 16px 30px rgba(2,6,23,0.18)",
};

const BOARDING_COMMENT_BANKS = {
  headTeacher: {
    pending: [
      "Weekend assessment records for this learner are still coming in. The learner should keep attending all sessions and follow up on pending work.",
      "This report is waiting for more weekend assessment entries. Continued attendance and timely completion of work are encouraged.",
      "More weekend assessment evidence is still needed before a fuller picture can be formed. The learner should remain consistent.",
    ],
    missed: [
      "Several weekend assessments were missed. The learner should meet the subject teachers promptly and complete the missed work.",
      "There are missed weekend assessments on record. Immediate follow-up with the teachers is strongly advised.",
      "Missed weekend assessments have affected the learner's record. The learner should clear the missed work without delay.",
      "This report shows missed weekend assessments. Serious follow-up with the teachers is needed so that the learner catches up.",
    ],
    incomplete: [
      "Some subjects are still pending weekend assessment scores. The learner should continue consulting the teachers on the outstanding subjects.",
      "A number of weekend assessment subjects are still incomplete. The learner should keep following up until the full record is in place.",
      "This progress report is based on partial weekend assessment evidence. The learner should complete the remaining subject records.",
      "Not all weekend assessment subjects are on record yet. The learner should remain committed and clear the pending areas.",
    ],
    high: [
      "Outstanding progress has been maintained in the weekend assessments. The learner should keep up the same discipline.",
      "This is a very strong performance. The learner should remain focused and continue working at this level.",
      "Excellent weekend assessment progress has been recorded. The learner is encouraged to sustain this high standard.",
      "The learner has shown commendable seriousness in the weekend programme. This level should be maintained.",
      "This is an impressive performance profile. The learner should continue revising consistently and aiming higher.",
      "Very strong progress has been observed. The learner should guard against complacency and keep the momentum.",
    ],
    mid: [
      "Good progress has been shown in the weekend assessments. More consistency can push the learner to a stronger level.",
      "The learner is progressing well. Continued effort and regular revision will strengthen the results further.",
      "A steady performance has been recorded. The learner should stay focused and work on raising the weaker areas.",
      "The learner is on a good track. Greater consistency across all subjects will improve the overall outcome.",
      "This is a promising performance. The learner should continue applying effort in every subject.",
      "Fairly solid progress has been shown. The learner should aim for more confidence and accuracy in the next assessments.",
    ],
    low: [
      "The learner needs closer academic follow-up in the weekend programme. More serious revision is required.",
      "This performance level calls for more guided support and stronger personal effort from the learner.",
      "The learner should improve revision habits and respond more seriously to the weekend assessment programme.",
      "Closer attention is needed in the weaker subjects. The learner should work harder and seek help early.",
      "The learner requires more consistent preparation and follow-up to improve the current level of performance.",
      "More effort is needed across the weekend assessments. The learner should take correction and revision seriously.",
    ],
  },
  dos: {
    pending: [
      "The academic record for this term is still incomplete. The learner should ensure that all weekend assessment entries are captured.",
      "More weekend assessment data is still pending. The learner is advised to remain regular and complete every required task.",
      "This term's weekend assessment record is not yet complete. Continued follow-up on pending subjects is necessary.",
    ],
    missed: [
      "Missed weekend assessments have affected the learner's academic profile. The learner should report to the relevant teachers for guidance.",
      "There are several missed weekend assessments in this record. The learner should prioritise clearing the missed work.",
      "The learner's performance record is incomplete because of missed weekend assessments. Immediate academic follow-up is advised.",
      "The learner has missed important weekend assessments. Prompt consultation with the teachers is required.",
    ],
    incomplete: [
      "This report reflects the subjects captured so far. The learner should ensure that all remaining weekend assessment subjects are completed.",
      "Some weekend assessment subjects are still awaiting scores. The learner should continue following up on the outstanding work.",
      "The current report is based on partial subject coverage. The learner should keep working to complete the full record.",
      "There are still pending weekend assessment subjects on this report. The learner should clear the remaining subjects.",
    ],
    high: [
      "The learner is demonstrating strong academic command in the weekend programme. This standard should be maintained.",
      "A high level of consistency is evident in this record. The learner should keep the same focus and seriousness.",
      "This is a strong academic profile. The learner should continue building depth and confidence across the subjects.",
      "The learner is performing very well in the weekend assessments. Continued discipline will preserve this standard.",
      "A commendably strong report has been recorded. The learner should keep striving for excellence in all subjects.",
      "This is a very good academic showing. The learner should maintain the same level of commitment.",
    ],
    mid: [
      "The learner is making fair progress in the weekend assessments. More consistency will help raise the overall level.",
      "A moderate performance profile has been recorded. The learner should focus on consolidating weaker areas.",
      "The learner is progressing reasonably well. More structured revision will improve the next set of assessments.",
      "This is a balanced but still improvable report. The learner should push for stronger consistency.",
      "The learner has shown workable progress. Better concentration and follow-up can move the learner higher.",
      "Moderate progress is evident. The learner should keep working steadily across all subjects.",
    ],
    low: [
      "The learner requires closer academic attention and a more deliberate approach to the weekend assessment programme.",
      "This report shows a need for stronger preparation and more serious follow-up in the weekend studies.",
      "The learner should improve consistency, revision, and response to teacher guidance in order to raise performance.",
      "Closer supervision and more deliberate academic effort are needed to improve the learner's current standing.",
      "The learner's present level calls for stronger support and more focused practice in the weekend programme.",
      "The learner should respond with more seriousness to weekend study, correction, and revision expectations.",
    ],
  },
};

const formatDateOnly = (value) => {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB");
};

const formatAverage = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "—";
};

const pickComment = (options, seed) => {
  const list = Array.isArray(options) && options.length ? options : ["Progress has been recorded."];
  const rawSeed = String(seed || "boarding-report");
  let hash = 0;
  for (let index = 0; index < rawSeed.length; index += 1) {
    hash = (hash * 31 + rawSeed.charCodeAt(index)) % 2147483647;
  }
  return list[Math.abs(hash) % list.length];
};

const getSubjectRemark = (row) => {
  if (row?.remark) return row.remark;
  const average = Number(row?.average_score);
  const submittedCount = Number(row?.submitted_count || 0);
  const missedCount = Number(row?.missed_count || 0);
  if (!Number.isFinite(average)) {
    if (missedCount > 0 && submittedCount === 0) return "Missed";
    if (missedCount > 0) return "Follow Up";
    return "Pending";
  }
  if (average >= 2.5) return "Outstanding";
  if (average >= 1.5) return "Moderate";
  return "Basic";
};

const getCommentBand = (report) => {
  const average = Number(report?.overall_average);
  const missedCount = Number(report?.missed_assessment_count || 0);
  const registeredCount = Number(report?.registered_subject_count || 0);
  const scoredCount = Number(report?.scored_subject_count || 0);

  if (!Number.isFinite(average) || scoredCount === 0) {
    return "pending";
  }
  if (missedCount >= 2) {
    return "missed";
  }
  if (registeredCount > 0 && scoredCount < registeredCount) {
    return "incomplete";
  }
  if (average >= 2.5) {
    return "high";
  }
  if (average >= 1.5) {
    return "mid";
  }
  return "low";
};

const getRoleComment = (report, role) => {
  const banks = BOARDING_COMMENT_BANKS[role] || BOARDING_COMMENT_BANKS.headTeacher;
  const band = getCommentBand(report);
  const options = banks[band] || banks.mid;
  const seed = `${role}-${report?.id || "0"}-${report?.name || ""}-${report?.class_level || ""}-${band}-${report?.overall_average || "na"}`;
  return pickComment(options, seed);
};

const getPositionLabel = (report) => {
  const classPosition = Number(report?.class_position);
  const classTotal = Number(report?.class_total);
  if (Number.isFinite(classPosition) && Number.isFinite(classTotal) && classTotal > 0) {
    return `${classPosition} / ${classTotal}`;
  }
  return "Pending";
};

const drawFooter = (doc, pageWidth, pageHeight, generatedAt, page, totalPages) => {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    `SPESS ARK Boarding · Weekend Progress Report · ${generatedAt} · Page ${page} of ${totalPages}`,
    pageWidth / 2,
    pageHeight - 8,
    { align: "center" }
  );
};

export default function BoardingReports() {
  const [filters, setFilters] = useState({ class_level: "S1", term: "Term 1", year: new Date().getFullYear() });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const generatePdf = async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        class_level: filters.class_level,
        term: filters.term,
        year: String(filters.year),
      });
      const data = await boardingFetch(`/api/boarding/reports/term?${params.toString()}`);
      const reports = Array.isArray(data?.reports) ? data.reports : [];
      if (reports.length === 0) {
        setError("No boarding learners found for that class.");
        return;
      }

      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const generatedAt = new Date().toLocaleString("en-GB");

      reports.forEach((report, index) => {
        if (index > 0) doc.addPage();

        doc.setDrawColor(0);
        doc.setLineWidth(0.28);
        doc.line(14, 10, pageWidth - 14, 10);
        doc.line(14, 36, pageWidth - 14, 36);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(13.8);
        doc.text("ST PHILLIP'S EQUATORIAL SECONDARY SCHOOL", pageWidth / 2, 17, { align: "center" });
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.4);
        const reportTitle = "Boarding Weekend Progress Report";
        const badgeSize = 15;
        doc.addImage(badge, "PNG", 18, 16.8, badgeSize, badgeSize);
        doc.text(reportTitle, pageWidth / 2, 24.1, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.1);
        doc.text("www.stphillipsequatorial.com • info@stphillipsequatorial.com", pageWidth / 2, 27.1, { align: "center" });
        doc.setFontSize(8.4);
        doc.text(`${filters.class_level} • ${filters.term} • ${filters.year}`, pageWidth / 2, 31.8, { align: "center" });

        doc.setFillColor(245, 247, 250);
        doc.roundedRect(14, 41, pageWidth - 28, 30, 3.2, 3.2, "F");
        doc.setDrawColor(0);
        doc.setLineWidth(0.2);
        doc.roundedRect(14, 41, pageWidth - 28, 30, 3.2, 3.2);
        doc.line(pageWidth / 2, 41, pageWidth / 2, 71);
        doc.line(14, 56, pageWidth - 14, 56);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.text("NAME", 18, 46);
        doc.text("GENDER", 18, 61);
        doc.text("CLASS", pageWidth / 2 + 4, 46);
        doc.text("DOB", pageWidth / 2 + 4, 61);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.6);
        doc.text(String(report.name || "—"), 18, 51);
        doc.text(String(report.gender || "—"), 18, 66);
        doc.text(String(report.class_level || filters.class_level), pageWidth / 2 + 4, 51);
        doc.text(formatDateOnly(report.dob), pageWidth / 2 + 4, 66);

        doc.setFillColor(247, 248, 250);
        doc.roundedRect(14, 76, pageWidth - 28, 20, 3.2, 3.2, "F");
        doc.setDrawColor(0);
        doc.roundedRect(14, 76, pageWidth - 28, 20, 3.2, 3.2);
        doc.line(60, 76, 60, 96);
        doc.line(105, 76, 105, 96);
        doc.line(146, 76, 146, 96);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.2);
        doc.text("OVERALL AVERAGE", 18, 82);
        doc.text("CLASS POSITION", 64, 82);
        doc.text("REGISTERED SUBJECTS", 109, 82);
        doc.text("SUBMITTED / MISSED", 150, 82);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10.4);
        doc.text(formatAverage(report.overall_average), 18, 90);
        doc.text(getPositionLabel(report), 64, 90);
        doc.text(String(report.registered_subject_count || report.subjects_registered?.length || 0), 109, 90);
        doc.text(`${Number(report.submitted_assessment_count || 0)} / ${Number(report.missed_assessment_count || 0)}`, 150, 90);

        autoTable(doc, {
          startY: 102,
          margin: { left: 14, right: 14 },
          head: [["Subject", "Average", "Remark", "Recorded", "Missed"]],
          body: (report.rows || []).map((row) => [
            row.subject || "",
            formatAverage(row.average_score),
            getSubjectRemark(row),
            Number(row.submitted_count || 0),
            Number(row.missed_count || 0),
          ]),
          theme: "grid",
          styles: {
            font: "helvetica",
            fontSize: 8.5,
            lineColor: [0, 0, 0],
            lineWidth: 0.18,
            textColor: [0, 0, 0],
            cellPadding: 1.7,
          },
          headStyles: {
            fillColor: [229, 231, 235],
            textColor: [0, 0, 0],
            fontStyle: "bold",
            lineColor: [0, 0, 0],
            lineWidth: 0.2,
          },
          alternateRowStyles: {
            fillColor: [249, 250, 251],
          },
          columnStyles: {
            0: { cellWidth: 76 },
            1: { cellWidth: 24, halign: "center" },
            2: { cellWidth: 42, halign: "center" },
            3: { cellWidth: 22, halign: "center" },
            4: { cellWidth: 22, halign: "center" },
          },
        });

        const headTeacherComment = getRoleComment(report, "headTeacher");
        const dosComment = getRoleComment(report, "dos");
        const commentValueWidth = pageWidth - 76;
        const headTeacherLines = doc.splitTextToSize(headTeacherComment, commentValueWidth);
        const dosLines = doc.splitTextToSize(dosComment, commentValueWidth);
        const positionNoteLines = doc.splitTextToSize(
          "Class position reflects the captured boarding weekend assessment averages for the selected term.",
          pageWidth - 28
        );
        const stampNoteLines = doc.splitTextToSize("NOTE: Not valid without a stamp.", pageWidth - 28);

        let blockY = (doc.lastAutoTable?.finalY || 112) + 8;
        const commentTableHeight =
          8 +
          Math.max(10, headTeacherLines.length * 4.5 + 4) +
          Math.max(10, dosLines.length * 4.5 + 4) +
          12 +
          18 +
          positionNoteLines.length * 3.5 +
          stampNoteLines.length * 3.5;

        if (blockY + commentTableHeight > pageHeight - 18) {
          doc.addPage();
          blockY = 18;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10.2);
          doc.text(`Continuation • ${report.name || "Boarding Learner"}`, 14, blockY);
          blockY += 8;
        }

        autoTable(doc, {
          startY: blockY,
          margin: { left: 14, right: 14 },
          body: [
            ["Head Teacher's Comment", headTeacherComment],
            ["DOS's Comment", dosComment],
            ["Signature", "______________________________"],
          ],
          theme: "grid",
          rowPageBreak: "avoid",
          styles: {
            font: "helvetica",
            fontSize: 8.6,
            lineColor: [0, 0, 0],
            lineWidth: 0.18,
            textColor: [0, 0, 0],
            cellPadding: 2.1,
            valign: "middle",
          },
          alternateRowStyles: {
            fillColor: [249, 250, 251],
          },
          columnStyles: {
            0: {
              cellWidth: 44,
              fontStyle: "bold",
              fillColor: [243, 244, 246],
            },
            1: {
              cellWidth: pageWidth - 72,
            },
          },
        });

        blockY = (doc.lastAutoTable?.finalY || blockY) + 8;
        doc.setFillColor(248, 249, 250);
        doc.roundedRect(14, blockY - 5, pageWidth - 28, 14, 2.8, 2.8, "F");
        doc.setDrawColor(0);
        doc.roundedRect(14, blockY - 5, pageWidth - 28, 14, 2.8, 2.8);
        doc.line(75, blockY - 5, 75, blockY + 9);
        doc.line(136, blockY - 5, 136, blockY + 9);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("BASIC", 44.5, blockY);
        doc.text("MODERATE", 101, blockY);
        doc.text("OUTSTANDING", 163, blockY);
        doc.setFont("helvetica", "normal");
        doc.text("0.9 - 1.4", 44.5, blockY + 5.2);
        doc.text("1.5 - 2.4", 101, blockY + 5.2);
        doc.text("2.5 - 3.0", 163, blockY + 5.2);

        blockY += 18;
        doc.setFont("helvetica", "italic");
        doc.setFontSize(7.4);
        doc.text(positionNoteLines, 14, blockY, { maxWidth: pageWidth - 28 });
        blockY += positionNoteLines.length * 3.5 + 1.5;
        doc.setFont("helvetica", "bolditalic");
        doc.text(stampNoteLines, 14, blockY, { maxWidth: pageWidth - 28 });
      });

      const totalPages = doc.internal.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        drawFooter(doc, pageWidth, pageHeight, generatedAt, page, totalPages);
      }

      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message || "Failed to generate boarding reports");
    } finally {
      setLoading(false);
    }
  };

  return (
    <BoardingAdminShell
      title="Boarding Reports"
      subtitle="Generate polished boarding weekend progress reports with averages, class position, remarks, and subject-by-subject weekend performance."
    >
      {error && <div className="panel-alert panel-alert-error">{error}</div>}

      <div className="panel-card" style={{ background: "rgba(15,23,42,0.58)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.85rem 1rem",
            borderRadius: "16px",
            background: "rgba(8, 47, 73, 0.28)",
            border: "1px solid rgba(56, 189, 248, 0.2)",
            color: "#dbeafe",
            fontSize: "0.92rem",
            lineHeight: 1.6,
          }}
        >
          The boarding progress report now reflects <strong>overall average</strong>, <strong>class position</strong>, and
          <strong> performance remarks</strong> for each learner using the captured weekend assessments for the selected term.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.9rem", alignItems: "end" }}>
          <label style={fieldLabelStyle}>
            <span>Class</span>
            <select
              style={fieldInputStyle}
              value={filters.class_level}
              onChange={(event) => setFilters((previous) => ({ ...previous, class_level: event.target.value }))}
            >
              {CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={fieldLabelStyle}>
            <span>Term</span>
            <select
              style={fieldInputStyle}
              value={filters.term}
              onChange={(event) => setFilters((previous) => ({ ...previous, term: event.target.value }))}
            >
              {TERMS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={fieldLabelStyle}>
            <span>Year</span>
            <input
              style={fieldInputStyle}
              type="number"
              value={filters.year}
              onChange={(event) => setFilters((previous) => ({ ...previous, year: Number(event.target.value) || previous.year }))}
            />
          </label>
          <button type="button" className="primary-btn" onClick={generatePdf} disabled={loading}>
            {loading ? "Generating..." : "Generate Report Cards"}
          </button>
        </div>
      </div>

      <div
        className="panel-card"
        style={{
          marginTop: "1rem",
          background: "rgba(15,23,42,0.58)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem" }}>
          <div style={statTileStyle}>
            <div style={{ color: "#86efac", fontSize: "0.75rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Overall Average
            </div>
            <div style={{ marginTop: "0.35rem", color: "#f8fafc", fontSize: "0.96rem", lineHeight: 1.6 }}>
              Shows the learner's term average across captured weekend assessment subjects.
            </div>
          </div>
          <div style={statTileStyle}>
            <div style={{ color: "#facc15", fontSize: "0.75rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Class Position
            </div>
            <div style={{ marginTop: "0.35rem", color: "#f8fafc", fontSize: "0.96rem", lineHeight: 1.6 }}>
              Indicates how the learner is ranking within the selected boarding class from captured weekend scores.
            </div>
          </div>
          <div style={statTileStyle}>
            <div style={{ color: "#93c5fd", fontSize: "0.75rem", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Remarks
            </div>
            <div style={{ marginTop: "0.35rem", color: "#f8fafc", fontSize: "0.96rem", lineHeight: 1.6 }}>
              Each report now carries subject-level remarks and one overall comment for clearer guidance.
            </div>
          </div>
        </div>
      </div>
    </BoardingAdminShell>
  );
}
