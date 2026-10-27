import { useMemo, useRef, useState } from "react";
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

const candidateOptionLabel = (candidate) => {
  const average = candidate?.average === null ? "no score" : `average ${averageLabel(candidate?.average)}`;
  const scoreCount = Number(candidate?.scoreCount) || 0;
  const rule = candidate?.eligible === false ? " - below predictor rule" : "";
  return `${candidate?.subject || "Unknown subject"} - ${average}, ${scoreCount} AOI score${scoreCount === 1 ? "" : "s"}${rule}`;
};

const savedTimeLabel = (value) => {
  if (!value) return "Saved";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved";
  return `Saved ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

const selectedCandidate = (learner, category, subject) => {
  if (!subject) return { subject: null, average: null };
  return (
    learner?.[`category${category}`]?.candidates?.find(
      (candidate) => candidate.subject === subject
    ) || { subject, average: null }
  );
};

export default function OptionalSubjectPredictor() {
  const [stream, setStream] = useState("");
  const [academicYear, setAcademicYear] = useState(currentYear);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState("predictor");
  const [manualSelections, setManualSelections] = useState({});
  const [saveStates, setSaveStates] = useState({});
  const manualSelectionsRef = useRef({});
  const saveQueuesRef = useRef(new Map());
  const saveVersionsRef = useRef(new Map());

  const confidentCount = useMemo(() => {
    const rows = Array.isArray(result?.learners) ? result.learners : [];
    return rows.filter((row) => row.complete && !row.lowConfidence).length;
  }, [result]);

  const manualCompleteCount = useMemo(() => {
    const rows = Array.isArray(result?.learners) ? result.learners : [];
    return rows.filter((learner) => {
      const selection = manualSelections[learner.id] || {};
      return selection.categoryA && selection.categoryB;
    }).length;
  }, [manualSelections, result]);

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
      const loadedSelections = Object.fromEntries(
        (data.learners || []).map((learner) => [
          learner.id,
          {
            categoryA: learner.manualSelection?.categoryA || "",
            categoryB: learner.manualSelection?.categoryB || "",
          },
        ])
      );
      const loadedSaveStates = Object.fromEntries(
        (data.learners || []).map((learner) => [
          learner.id,
          learner.manualSelection?.saved
            ? { status: "saved", updatedAt: learner.manualSelection.updatedAt }
            : { status: "idle", updatedAt: null },
        ])
      );
      manualSelectionsRef.current = loadedSelections;
      setManualSelections(loadedSelections);
      setSaveStates(loadedSaveStates);
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err.message || "Could not build the optional-subject predictions.");
    } finally {
      setLoading(false);
    }
  };

  const updateManualSelection = (learnerId, categoryKey, value) => {
    if (!result) return;

    const nextSelection = {
      categoryA: manualSelectionsRef.current[learnerId]?.categoryA || "",
      categoryB: manualSelectionsRef.current[learnerId]?.categoryB || "",
      [categoryKey]: value,
    };
    manualSelectionsRef.current = {
      ...manualSelectionsRef.current,
      [learnerId]: nextSelection,
    };
    setManualSelections(manualSelectionsRef.current);

    const queueKey = `${result.academicYear}:${learnerId}`;
    const nextVersion = (saveVersionsRef.current.get(queueKey) || 0) + 1;
    saveVersionsRef.current.set(queueKey, nextVersion);
    setSaveStates((current) => ({
      ...current,
      [learnerId]: { status: "saving", updatedAt: current[learnerId]?.updatedAt || null },
    }));

    // Queue saves per learner. This prevents a quick A-then-B choice from
    // arriving out of order and overwriting the newer pair in the database.
    const previousSave = saveQueuesRef.current.get(queueKey) || Promise.resolve();
    const queuedSave = previousSave
      .catch(() => undefined)
      .then(() =>
        adminFetch(`/api/admin/optional-subject-selections/${learnerId}`, {
          method: "PUT",
          body: {
            year: result.academicYear,
            categoryA: nextSelection.categoryA,
            categoryB: nextSelection.categoryB,
          },
        })
      );
    saveQueuesRef.current.set(queueKey, queuedSave);

    queuedSave
      .then((response) => {
        if (saveVersionsRef.current.get(queueKey) !== nextVersion) return;
        setSaveStates((current) => ({
          ...current,
          [learnerId]: {
            status: "saved",
            updatedAt: response?.selection?.updatedAt || new Date().toISOString(),
          },
        }));
      })
      .catch((saveError) => {
        if (saveVersionsRef.current.get(queueKey) !== nextVersion) return;
        setSaveStates((current) => ({
          ...current,
          [learnerId]: {
            status: "error",
            updatedAt: current[learnerId]?.updatedAt || null,
            message: saveError.message || "Save failed",
          },
        }));
      });
  };

  const createPdf = async (download = false) => {
    const learners = Array.isArray(result?.learners) ? result.learners : [];
    if (!learners.length || pdfBusy) return;
    setPdfBusy(true);
    try {
      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const generatedAt = new Date().toLocaleString();
      const isManualRegister = workspace === "manual";
      const title = isManualRegister
        ? `S2 ${result.stream} Optional Subject Selection Register`
        : `S2 ${result.stream} Optional Subjects Predictor`;
      const pdfRows = learners.map((learner) => {
        if (!isManualRegister) {
          return {
            categoryA: learner.categoryA,
            categoryB: learner.categoryB,
            flag: predictionFlag(learner),
          };
        }

        const selection = manualSelections[learner.id] || {};
        const categoryA = selectedCandidate(learner, "A", selection.categoryA);
        const categoryB = selectedCandidate(learner, "B", selection.categoryB);
        return {
          categoryA,
          categoryB,
          flag: categoryA.subject && categoryB.subject ? "Complete" : "Incomplete",
        };
      });

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
        isManualRegister
          ? "Selection record: Admin-reviewed choices from each learner's currently registered optional subjects."
          : "Selection rule: Choose the highest AOI average from the learner's registered subjects in each category.",
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
          subjectWithAverage(pdfRows[index].categoryA),
          subjectWithAverage(pdfRows[index].categoryB),
          pdfRows[index].flag,
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
          const pdfRow = pdfRows[hook.row.index];
          const categoryWarning =
            !isManualRegister &&
            ((hook.column.index === 2 && row?.categoryA?.lowConfidence) ||
              (hook.column.index === 3 && row?.categoryB?.lowConfidence));
          const decisionWarning =
            hook.column.index === 4 &&
            (isManualRegister ? pdfRow?.flag === "Incomplete" : row?.lowConfidence || !row?.complete);
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
            (learner, index) => pdfRows[index]?.[`category${category}`]?.subject === subject
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
      doc.text(
        isManualRegister
          ? "OPTIONAL SUBJECT SELECTION SUMMARY"
          : "OPTIONAL SUBJECT RECOMMENDATION SUMMARY",
        14,
        summaryStartY
      );
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Counts show how many of the ${learners.length} learners were ${
          isManualRegister ? "selected" : "recommended"
        } for each optional subject.`,
        14,
        summaryStartY + 5
      );

      autoTable(doc, {
        startY: summaryStartY + 9,
        margin: { left: 14, right: 14, bottom: 15 },
        tableWidth: 150,
        head: [["Category", "Optional subject", isManualRegister ? "Learners selected" : "Learners recommended"]],
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

      const filename = `S2_${result.stream}_Optional_Subjects_${
        isManualRegister ? "Register" : "Predictor"
      }_${result.academicYear}.pdf`;
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
            {loading ? "Loading stream..." : "Load stream"}
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
                  {pdfBusy ? "Preparing PDF..." : workspace === "manual" ? "Open register PDF" : "Open PDF"}
                </button>
                <button type="button" className="secondary" onClick={() => createPdf(true)} disabled={pdfBusy || !result.learnerCount}>
                  {workspace === "manual" ? "Download register PDF" : "Download PDF"}
                </button>
              </div>
            </section>

            <nav className="optional-predictor-workspaces" aria-label="Optional subject workspaces">
              <div>
                <button
                  type="button"
                  className={workspace === "predictor" ? "is-active" : ""}
                  onClick={() => setWorkspace("predictor")}
                >
                  Predictor recommendations
                </button>
                <button
                  type="button"
                  className={workspace === "manual" ? "is-active" : ""}
                  onClick={() => setWorkspace("manual")}
                >
                  Manual selection register
                </button>
              </div>
              <span>{manualCompleteCount} of {result.learnerCount} manual pairs complete</span>
            </nav>

            {workspace === "predictor" ? (
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
            ) : (
              <section className="optional-predictor-results optional-predictor-manual">
                <div className="optional-predictor-results-head">
                  <div>
                    <span>Saved S2 register</span>
                    <h2>{result.stream} manual subject selections</h2>
                  </div>
                  <p>Every change saves automatically for {result.academicYear}.</p>
                </div>

                {result.learners.length === 0 ? (
                  <div className="optional-predictor-empty">No active S2 learners were found in this stream.</div>
                ) : (
                  <div className="optional-predictor-table-wrap">
                    <table className="optional-predictor-table optional-predictor-manual-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Learner</th>
                          <th>Category A decision</th>
                          <th>Category B decision</th>
                          <th>Save status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.learners.map((learner, index) => {
                          const selection = manualSelections[learner.id] || {};
                          const saveState = saveStates[learner.id] || { status: "idle" };
                          const invalidSelections = [
                            !selection.categoryA && learner.manualSelection?.invalidCategoryA,
                            !selection.categoryB && learner.manualSelection?.invalidCategoryB,
                          ].filter(Boolean);
                          const chosenCategoryA = selectedCandidate(
                            learner,
                            "A",
                            selection.categoryA
                          );
                          const chosenCategoryB = selectedCandidate(
                            learner,
                            "B",
                            selection.categoryB
                          );

                          return (
                            <tr key={learner.id}>
                              <td>{index + 1}</td>
                              <td>
                                <strong>{learner.name}</strong>
                                <small>ID {learner.id}</small>
                                {invalidSelections.length > 0 && (
                                  <small className="optional-predictor-stale">
                                    No longer registered: {invalidSelections.join(", ")}
                                  </small>
                                )}
                              </td>
                              <td>
                                <label className="optional-predictor-choice">
                                  <span>Choose from offered Category A subjects</span>
                                  <select
                                    value={selection.categoryA || ""}
                                    onChange={(event) =>
                                      updateManualSelection(learner.id, "categoryA", event.target.value)
                                    }
                                    disabled={learner.categoryA.candidates.length === 0}
                                  >
                                    <option value="">Not selected</option>
                                    {learner.categoryA.candidates.map((candidate) => (
                                      <option key={candidate.subject} value={candidate.subject}>
                                        {candidateOptionLabel(candidate)}
                                      </option>
                                    ))}
                                  </select>
                                  {selection.categoryA && (
                                    <small>
                                      Average {averageLabel(chosenCategoryA.average)} from {chosenCategoryA.scoreCount || 0} AOI score(s)
                                    </small>
                                  )}
                                </label>
                              </td>
                              <td>
                                <label className="optional-predictor-choice">
                                  <span>Choose from offered Category B subjects</span>
                                  <select
                                    value={selection.categoryB || ""}
                                    onChange={(event) =>
                                      updateManualSelection(learner.id, "categoryB", event.target.value)
                                    }
                                    disabled={learner.categoryB.candidates.length === 0}
                                  >
                                    <option value="">Not selected</option>
                                    {learner.categoryB.candidates.map((candidate) => (
                                      <option key={candidate.subject} value={candidate.subject}>
                                        {candidateOptionLabel(candidate)}
                                      </option>
                                    ))}
                                  </select>
                                  {selection.categoryB && (
                                    <small>
                                      Average {averageLabel(chosenCategoryB.average)} from {chosenCategoryB.scoreCount || 0} AOI score(s)
                                    </small>
                                  )}
                                </label>
                              </td>
                              <td>
                                <div className="optional-predictor-save-cell">
                                  <span className={`optional-predictor-save-state is-${saveState.status}`}>
                                    {saveState.status === "saving" && "Saving..."}
                                    {saveState.status === "saved" && savedTimeLabel(saveState.updatedAt)}
                                    {saveState.status === "error" && (saveState.message || "Save failed")}
                                    {saveState.status === "idle" && "Awaiting selection"}
                                  </span>
                                  {saveState.status === "error" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateManualSelection(
                                          learner.id,
                                          "categoryA",
                                          selection.categoryA || ""
                                        )
                                      }
                                    >
                                      Retry save
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
