import React, { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../lib/api";
import { loadPdfTools } from "../utils/loadPdfTools";

const CLASS_OPTIONS = ["S1", "S2", "S3", "S4", "S5", "S6"];
const O_LEVEL_STREAMS = ["North", "South"];
const A_LEVEL_STREAMS = ["Arts", "Sciences"];

const formatDob = (value) => {
  if (!value) return "";
  const raw = String(value).trim().slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const normalizeGender = (value) => {
  const gender = String(value || "").trim();
  if (!gender) return "";
  return gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase();
};

export default function EmisRegistrationPanel() {
  const [classLevel, setClassLevel] = useState("S1");
  const [stream, setStream] = useState("North");
  const [roster, setRoster] = useState([]);
  const [rosterMeta, setRosterMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const streamOptions = useMemo(
    () => (["S5", "S6"].includes(classLevel) ? A_LEVEL_STREAMS : O_LEVEL_STREAMS),
    [classLevel]
  );

  const handleClassChange = (nextClassLevel) => {
    const nextStreams = ["S5", "S6"].includes(nextClassLevel)
      ? A_LEVEL_STREAMS
      : O_LEVEL_STREAMS;
    setClassLevel(nextClassLevel);
    setStream(nextStreams[0]);
  };

  const loadRoster = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ classLevel, stream });
      const data = await adminFetch(`/api/admin/emis-registration/roster?${params.toString()}`);
      const learners = Array.isArray(data?.learners) ? data.learners : [];
      setRoster(learners);
      setRosterMeta(data);
      return { data, learners };
    } catch (err) {
      setRoster([]);
      setRosterMeta(null);
      setError(err.message || "Could not load the selected learner roster.");
      throw err;
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    loadRoster().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classLevel, stream]);

  const generatePdf = async () => {
    const preview = window.open("", "_blank");
    if (!preview) {
      setError("Your browser blocked the PDF preview. Allow pop-ups for SPESS ARK and try again.");
      return;
    }

    setGenerating(true);
    setError("");
    try {
      preview.document.title = "Preparing EMIS registration form";
      preview.document.body.innerHTML =
        '<p style="font:16px system-ui;padding:24px;color:#111827">Preparing the EMIS registration form...</p>';

      const { data, learners } = await loadRoster({ quiet: true });
      if (learners.length === 0) {
        throw new Error(`No active learners found in ${classLevel} ${stream}.`);
      }

      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF("l", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const generatedAt = new Date();
      const generatedLabel = generatedAt.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const body = learners.map((learner, index) => [
        index + 1,
        String(learner?.name || "").trim(),
        formatDob(learner?.dob),
        normalizeGender(learner?.gender),
        "",
        "",
        "",
        "",
      ]);

      autoTable(doc, {
        startY: 34,
        margin: { top: 34, right: 8, bottom: 15, left: 8 },
        head: [[
          "#",
          "LEARNER NAME",
          "DATE OF BIRTH",
          "GENDER",
          "PARENT NIN (14 CHARACTERS)",
          "PARENT CONTACT",
          "PLE INDEX NUMBER",
          "PLE YEAR",
        ]],
        body,
        theme: "grid",
        showHead: "everyPage",
        styles: {
          font: "helvetica",
          fontSize: 7.2,
          textColor: [24, 24, 24],
          lineColor: [82, 82, 82],
          lineWidth: 0.2,
          cellPadding: { top: 1.6, right: 1.2, bottom: 1.6, left: 1.2 },
          minCellHeight: 10.5,
          valign: "middle",
          overflow: "linebreak",
        },
        headStyles: {
          fillColor: [224, 224, 224],
          textColor: [20, 20, 20],
          fontStyle: "bold",
          fontSize: 7,
          halign: "center",
          valign: "middle",
          minCellHeight: 10,
        },
        bodyStyles: {
          fillColor: [255, 255, 255],
        },
        alternateRowStyles: {
          fillColor: [250, 250, 250],
        },
        columnStyles: {
          0: { cellWidth: 8, halign: "center", fontStyle: "bold", fillColor: [244, 244, 244] },
          1: { cellWidth: 48, fontSize: 7.6, fontStyle: "bold", fillColor: [244, 244, 244] },
          2: { cellWidth: 24, halign: "center", fillColor: [244, 244, 244] },
          3: { cellWidth: 17, halign: "center", fillColor: [244, 244, 244] },
          4: { cellWidth: 84, cellPadding: 0 },
          5: { cellWidth: 34 },
          6: { cellWidth: 45 },
          7: { cellWidth: 21, halign: "center" },
        },
        didDrawCell: (hookData) => {
          if (hookData.section !== "body" || hookData.column.index !== 4) return;
          const { cell } = hookData;
          const boxWidth = cell.width / 14;
          doc.setDrawColor(105, 105, 105);
          doc.setLineWidth(0.16);
          for (let box = 1; box < 14; box += 1) {
            const x = cell.x + boxWidth * box;
            doc.line(x, cell.y, x, cell.y + cell.height);
          }
        },
      });

      const pageCount = doc.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        doc.setPage(page);
        doc.setTextColor(18, 18, 18);
        doc.setDrawColor(95, 95, 95);

        doc.setFillColor(244, 244, 244);
        doc.roundedRect(8, 4, pageWidth - 16, 14, 1.4, 1.4, "F");
        doc.setLineWidth(0.25);
        doc.roundedRect(8, 4, pageWidth - 16, 14, 1.4, 1.4, "S");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(11.8);
        doc.text("ST PHILLIPS EQUATORIAL SECONDARY SCHOOL", pageWidth / 2, 9.8, {
          align: "center",
        });
        doc.setFontSize(9.6);
        doc.text("EMIS LEARNER REGISTRATION FORM", pageWidth / 2, 15, {
          align: "center",
        });

        doc.setFillColor(250, 250, 250);
        doc.rect(8, 21, pageWidth - 16, 8, "F");
        doc.setDrawColor(150, 150, 150);
        doc.setLineWidth(0.2);
        doc.rect(8, 21, pageWidth - 16, 8, "S");
        doc.setTextColor(30, 30, 30);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.2);
        doc.text(`CLASS: ${data.classLevel}`, 11, 26.2);
        doc.text(`STREAM: ${String(data.stream || "").toUpperCase()}`, 61, 26.2);
        doc.text(`ACTIVE LEARNERS: ${learners.length}`, 127, 26.2);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.2);
        doc.setTextColor(70, 70, 70);
        doc.text("Write one Parent NIN character in each box.", pageWidth - 11, 26.2, {
          align: "right",
        });

        doc.setFillColor(247, 247, 247);
        doc.rect(8, pageHeight - 11.5, pageWidth - 16, 7, "F");
        doc.setDrawColor(145, 145, 145);
        doc.setLineWidth(0.2);
        doc.line(8, pageHeight - 11.5, pageWidth - 8, pageHeight - 11.5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.8);
        doc.setTextColor(65, 65, 65);
        doc.text(`Generated ${generatedLabel}`, 10, pageHeight - 7);
        doc.text(`Page ${page} of ${pageCount}`, pageWidth - 10, pageHeight - 7, {
          align: "right",
        });
      }

      const blobUrl = URL.createObjectURL(doc.output("blob"));
      preview.location.replace(blobUrl);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 300_000);
    } catch (err) {
      preview.close();
      setError(err.message || "Could not generate the EMIS registration form.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="panel-card emis-registration-panel">
      <div className="emis-form-toolbar">
        <div className="emis-form-controls">
          <label className="emis-form-field">
            <span>Class</span>
            <select value={classLevel} onChange={(event) => handleClassChange(event.target.value)}>
              {CLASS_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          <label className="emis-form-field">
            <span>Stream</span>
            <select value={stream} onChange={(event) => setStream(event.target.value)}>
              {streamOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="emis-form-actions">
          <button type="button" className="ghost-btn" onClick={() => loadRoster()} disabled={loading || generating}>
            {loading ? "Refreshing..." : "Refresh List"}
          </button>
          <button type="button" className="primary-btn" onClick={generatePdf} disabled={loading || generating || roster.length === 0}>
            {generating ? "Preparing PDF..." : "Open PDF Form"}
          </button>
        </div>
      </div>

      <div className="emis-roster-status">
        <div>
          <span>Selected register</span>
          <strong>{classLevel} {stream}</strong>
        </div>
        <div>
          <span>Active learners</span>
          <strong>{loading ? "..." : roster.length}</strong>
        </div>
        <div>
          <span>Paper format</span>
          <strong>A4 Landscape</strong>
        </div>
        <div>
          <span>Data storage</span>
          <strong>Print only</strong>
        </div>
      </div>

      {error && <div className="panel-alert panel-alert-error">{error}</div>}

      {!loading && !error && roster.length === 0 ? (
        <div className="emis-empty-state">No active learners are registered in this stream.</div>
      ) : (
        <div className="teachers-table-wrapper emis-roster-preview">
          <table className="teachers-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Learner Name</th>
                <th>Date of Birth</th>
                <th>Gender</th>
                <th>Form Fields</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((learner, index) => (
                <tr key={`${rosterMeta?.level || "learner"}-${learner.id}`}>
                  <td>{index + 1}</td>
                  <td><strong>{learner.name}</strong></td>
                  <td>{formatDob(learner.dob) || "Not recorded"}</td>
                  <td>{normalizeGender(learner.gender) || "Not recorded"}</td>
                  <td>Parent NIN, contact, PLE index and year</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
