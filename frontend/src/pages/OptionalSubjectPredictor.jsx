import { useMemo, useState } from "react";
import { adminFetch } from "../lib/api";
import { loadPdfTools } from "../utils/loadPdfTools";
import "./OptionalSubjectPredictor.css";

const STREAMS = ["North", "South"];
const currentYear = new Date().getFullYear();

const averageLabel = (value) => {
  if (value === null || value === undefined || value === "") return "No score";
  return Number(value).toFixed(2);
};

const subjectWithAverage = (selection) => {
  if (!selection?.subject) return "No registered subject";
  return `${selection.subject} (${averageLabel(selection.average)})`;
};

const evidenceLabel = (selection) => {
  if (selection?.closeAlternativeApplied) {
    return `Within 0.30 of Kiswahili | based on ${selection.scoreCount} AOI score(s)`;
  }
  return `Based on ${selection?.scoreCount || 0} AOI score(s)`;
};

const confidenceLabel = (selection) => {
  if (!selection?.subject) return "Missing registration";
  if (selection.closeAlternativeApplied) return "Close alternative";
  if (selection.lowConfidence) return "Low confidence";
  if (selection.confidence === "borderline") return "Below 1.5 threshold";
  return "Recommended";
};

const predictionFlag = (learner) => {
  if (!learner.complete) return "Incomplete subject registration";
  if (learner.lowConfidence) return "Low confidence";
  return "Ready";
};

export default function OptionalSubjectPredictor() {
  const [stream, setStream] = useState("");
  const [academicYear, setAcademicYear] = useState(currentYear);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState("");

  const confidentCount = useMemo(() => {
    const rows = Array.isArray(result?.learners) ? result.learners : [];
    return rows.filter((row) => row.complete && !row.lowConfidence).length;
  }, [result]);

  const runPrediction = async () => {
    if (!stream) {
      setError("Choose one S2 stream first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await adminFetch(
        `/api/admin/optional-subject-predictor?stream=${encodeURIComponent(stream)}&year=${encodeURIComponent(academicYear)}`
      );
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err.message || "Could not build the optional-subject predictions.");
    } finally {
      setLoading(false);
    }
  };

  const createPdf = async (download = false) => {
    const learners = Array.isArray(result?.learners) ? result.learners : [];
    if (!learners.length || pdfBusy) return;
    setPdfBusy(true);
    try {
      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const generatedAt = new Date().toLocaleString();
      const title = `S2 ${result.stream} Optional Subjects Predictor`;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(15, 23, 42);
      doc.text("ST. PHILLIP'S EQUATORIAL SECONDARY SCHOOL", doc.internal.pageSize.getWidth() / 2, 13, {
        align: "center",
      });
      doc.setFontSize(13);
      doc.text(title, doc.internal.pageSize.getWidth() / 2, 20, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      doc.text(`Academic year: ${result.academicYear}  |  Evidence: Term 1, Term 2 and Term 3 AOI 1-3`, 14, 27);
      doc.text("Category A: Physical Education, ICT, Art, Entrepreneurship, Agriculture", 14, 32);
      doc.text("Category B: Luganda, Kiswahili, Christian Religious Education, IRE, Literature", 14, 37);
      doc.text(
        "Selection rule: Choose the highest AOI average from the learner's registered subjects in each category.",
        14,
        42
      );
      doc.text(
        "Eligibility: Entrepreneurship requires at least 2.50 and Kiswahili requires at least 2.80 to be recommended.",
        14,
        47
      );
      doc.text(
        "Close alternative: choose another Category B subject at 1.50+ when it is within 0.30 of eligible Kiswahili.",
        14,
        52
      );
      doc.text("General recommendation: 1.50+  |  Low confidence: below 1.40 or no usable AOI score", 14, 57);

      autoTable(doc, {
        startY: 62,
        margin: { left: 14, right: 14, bottom: 15 },
        head: [["#", "Learner", "Category A subject", "Category B subject", "Decision flag"]],
        body: learners.map((learner, index) => [
          index + 1,
          learner.name,
          subjectWithAverage(learner.categoryA),
          subjectWithAverage(learner.categoryB),
          predictionFlag(learner),
        ]),
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 8.5,
          cellPadding: 2.5,
          textColor: [15, 23, 42],
          lineColor: [148, 163, 184],
          lineWidth: 0.2,
          overflow: "linebreak",
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: "bold",
        },
        columnStyles: {
          0: { cellWidth: 10, halign: "center" },
          1: { cellWidth: 58 },
          2: { cellWidth: 74 },
          3: { cellWidth: 74 },
          4: { cellWidth: 48 },
        },
        didParseCell: (hook) => {
          if (hook.section !== "body") return;
          const row = learners[hook.row.index];
          const categoryWarning =
            (hook.column.index === 2 && row?.categoryA?.lowConfidence) ||
            (hook.column.index === 3 && row?.categoryB?.lowConfidence);
          const decisionWarning = hook.column.index === 4 && (row?.lowConfidence || !row?.complete);
          if (categoryWarning || decisionWarning) {
            hook.cell.styles.textColor = [185, 28, 28];
            hook.cell.styles.fontStyle = "bold";
          }
        },
      });

      const categorySummaryRows = ["A", "B"].flatMap((category) => {
        const subjects = Array.isArray(result?.categories?.[category]) ? result.categories[category] : [];
        return subjects.map((subject) => {
          const recommendationCount = learners.filter(
            (learner) => learner?.[`category${category}`]?.subject === subject
          ).length;
          return [`Category ${category}`, subject, recommendationCount];
        });
      });
      const pageHeight = doc.internal.pageSize.getHeight();
      let summaryStartY = (doc.lastAutoTable?.finalY || 62) + 12;

      // Keep the distribution heading and its ten subject rows together.
      if (summaryStartY + 90 > pageHeight - 15) {
        doc.addPage();
        summaryStartY = 18;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text("OPTIONAL SUBJECT RECOMMENDATION SUMMARY", 14, summaryStartY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Counts show how many of the ${learners.length} learners were recommended for each optional subject.`,
        14,
        summaryStartY + 5
      );

      autoTable(doc, {
        startY: summaryStartY + 9,
        margin: { left: 14, right: 14, bottom: 15 },
        tableWidth: 150,
        head: [["Category", "Optional subject", "Learners recommended"]],
        body: categorySummaryRows,
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 8.5,
          cellPadding: 2.3,
          textColor: [15, 23, 42],
          lineColor: [148, 163, 184],
          lineWidth: 0.2,
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: "bold",
        },
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 82 },
          2: { cellWidth: 40, halign: "center" },
        },
        didParseCell: (hook) => {
          if (hook.section === "body" && hook.column.index === 2) {
            hook.cell.styles.fontStyle = "bold";
          }
        },
      });

      const pageCount = doc.internal.getNumberOfPages();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        doc.setPage(pageNumber);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(
          `Generated ${generatedAt}  |  Page ${pageNumber} of ${pageCount}`,
          doc.internal.pageSize.getWidth() / 2,
          doc.internal.pageSize.getHeight() - 7,
          { align: "center" }
        );
      }

      const filename = `S2_${result.stream}_Optional_Subjects_${result.academicYear}.pdf`;
      if (download) {
        doc.save(filename);
      } else {
        const blobUrl = URL.createObjectURL(doc.output("blob"));
        window.open(blobUrl, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      }
    } catch (err) {
      setError(err.message || "Could not generate the predictor PDF.");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <main className="optional-predictor-page">
      <section className="optional-predictor-shell">
        <header className="optional-predictor-header">
          <div>
            <span className="optional-predictor-kicker">S2 decision support</span>
            <h1>Optional Subjects Predictor</h1>
            <p>Choose one stream and identify the strongest offered subject from Category A and Category B.</p>
          </div>
          <button type="button" className="optional-predictor-close" onClick={() => window.close()}>
            Close window
          </button>
        </header>

        <section className="optional-predictor-controls" aria-label="Prediction controls">
          <div className="optional-predictor-field">
            <span>Senior Two stream</span>
            <div className="optional-predictor-segments">
              {STREAMS.map((option) => (
                <button
                  type="button"
                  key={option}
                  className={stream === option ? "is-active" : ""}
                  onClick={() => setStream(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <label className="optional-predictor-field optional-predictor-year">
            <span>Academic year</span>
            <input
              type="number"
              min="2000"
              max="2200"
              value={academicYear}
              onChange={(event) => setAcademicYear(Number(event.target.value))}
            />
          </label>
          <button type="button" className="optional-predictor-run" onClick={runPrediction} disabled={loading}>
            {loading ? "Calculating..." : "Run predictor"}
          </button>
        </section>

        <section className="optional-predictor-rules" aria-label="Predictor rules">
          <div><strong>Category A</strong><span>PE, ICT, Art, Entrepreneurship, Agriculture</span></div>
          <div><strong>Category B</strong><span>Luganda, Kiswahili, CRE, IRE, Literature</span></div>
          <p>Only registered subjects are considered and the `/80` exam is excluded. Eligibility: Entrepreneurship 2.50+; Kiswahili 2.80+. A Category B alternative at 1.50+ wins when it is within 0.30 of Kiswahili.</p>
        </section>

        {error && <div className="optional-predictor-alert">{error}</div>}

        {result && (
          <>
            <section className="optional-predictor-summary" aria-label="Prediction summary">
              <div><span>Learners</span><strong>{result.learnerCount}</strong></div>
              <div><span>Confident pairs</span><strong>{confidentCount}</strong></div>
              <div><span>Low confidence</span><strong>{result.lowConfidenceCount}</strong></div>
              <div><span>Incomplete pairs</span><strong>{result.incompleteCount}</strong></div>
              <div className="optional-predictor-pdf-actions">
                <button type="button" onClick={() => createPdf(false)} disabled={pdfBusy || !result.learnerCount}>
                  {pdfBusy ? "Preparing PDF..." : "Open PDF"}
                </button>
                <button type="button" className="secondary" onClick={() => createPdf(true)} disabled={pdfBusy || !result.learnerCount}>
                  Download PDF
                </button>
              </div>
            </section>

            <section className="optional-predictor-results">
              <div className="optional-predictor-results-head">
                <div>
                  <span>S2 {result.stream}</span>
                  <h2>{result.academicYear} recommendations</h2>
                </div>
                <p>{result.scoreWindow}</p>
              </div>

              {result.learners.length === 0 ? (
                <div className="optional-predictor-empty">No active S2 learners were found in this stream.</div>
              ) : (
                <div className="optional-predictor-table-wrap">
                  <table className="optional-predictor-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Learner</th>
                        <th>Category A subject</th>
                        <th>Category B subject</th>
                        <th>Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.learners.map((learner, index) => (
                        <tr key={learner.id} className={learner.lowConfidence ? "has-warning" : ""}>
                          <td>{index + 1}</td>
                          <td><strong>{learner.name}</strong><small>ID {learner.id}</small></td>
                          <td>
                            <div className="optional-predictor-subject">
                              <strong>{subjectWithAverage(learner.categoryA)}</strong>
                              <span>{evidenceLabel(learner.categoryA)}</span>
                              <em className={learner.categoryA.lowConfidence ? "is-warning" : ""}>{confidenceLabel(learner.categoryA)}</em>
                            </div>
                          </td>
                          <td>
                            <div className="optional-predictor-subject">
                              <strong>{subjectWithAverage(learner.categoryB)}</strong>
                              <span>{evidenceLabel(learner.categoryB)}</span>
                              <em className={learner.categoryB.lowConfidence ? "is-warning" : ""}>{confidenceLabel(learner.categoryB)}</em>
                            </div>
                          </td>
                          <td>
                            <span className={`optional-predictor-decision ${learner.lowConfidence ? "is-warning" : "is-ready"}`}>
                              {predictionFlag(learner)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
