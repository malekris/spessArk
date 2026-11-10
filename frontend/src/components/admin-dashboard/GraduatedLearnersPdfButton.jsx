import React, { useState } from "react";
import { adminFetch } from "../../lib/api";
import { loadPdfTools } from "../../utils/loadPdfTools";

const SCHOOL_NAME = "ST PHILLIPS EQUATORIAL SECONDARY SCHOOL";
const EXPORT_PAGE_SIZE = 250;

const formatDate = (value, includeTime = false) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  if (includeTime) {
    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const fetchGraduatedLearners = async ({ academicYear, search }) => {
  const buildUrl = (page) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(EXPORT_PAGE_SIZE),
    });
    if (academicYear.trim()) params.set("academicYear", academicYear.trim());
    if (search.trim()) params.set("search", search.trim());
    return `/api/admin/graduated?${params.toString()}`;
  };

  const firstPage = await adminFetch(buildUrl(1));
  const rows = Array.isArray(firstPage?.students) ? [...firstPage.students] : [];
  const totalPages = Math.max(1, Number(firstPage?.totalPages || 1));

  for (let page = 2; page <= totalPages; page += 1) {
    const nextPage = await adminFetch(buildUrl(page));
    if (Array.isArray(nextPage?.students)) rows.push(...nextPage.students);
  }

  return rows;
};

export default function GraduatedLearnersPdfButton({ academicYear = "", search = "" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleOpenPdf = async () => {
    const preview = window.open("", "_blank");
    if (!preview) {
      setError("Your browser blocked the PDF preview. Allow pop-ups and try again.");
      return;
    }

    preview.document.write(
      "<!doctype html><title>Preparing graduated learners PDF</title><body style='font-family:Arial,sans-serif;padding:32px'>Preparing graduated learners PDF...</body>"
    );
    preview.document.close();

    setLoading(true);
    setError("");

    try {
      const learners = await fetchGraduatedLearners({ academicYear, search });
      if (learners.length === 0) {
        throw new Error("No graduated learners match the current filters.");
      }

      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const generatedAt = new Date();
      const yearLabel = academicYear.trim() || "All years";

      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(SCHOOL_NAME, pageWidth / 2, 13, { align: "center" });
      doc.setFontSize(17);
      doc.text("GRADUATED LEARNERS REGISTER", pageWidth / 2, 21, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Academic year: ${yearLabel}`, 12, 29);
      doc.text(`Learners: ${learners.length}`, pageWidth / 2, 29, { align: "center" });
      doc.text(`Generated: ${formatDate(generatedAt, true)}`, pageWidth - 12, 29, { align: "right" });
      doc.setLineWidth(0.35);
      doc.line(12, 33, pageWidth - 12, 33);

      const body = learners.map((learner, index) => [
        index + 1,
        learner.id,
        learner.name || "-",
        learner.gender || "-",
        formatDate(learner.dob),
        learner.graduatedFromClassLevel || learner.class_level || "S4",
        learner.graduatedFromStream || learner.stream || "-",
        learner.graduatedAcademicYear || "-",
        formatDate(learner.graduatedAt),
      ]);

      autoTable(doc, {
        startY: 38,
        margin: { top: 14, right: 12, bottom: 17, left: 12 },
        head: [[
          "#",
          "Learner ID",
          "Learner Name",
          "Gender",
          "Date of Birth",
          "Former Class",
          "Former Stream",
          "Grad. Year",
          "Graduated On",
        ]],
        body,
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 8.5,
          cellPadding: 2.3,
          lineColor: [80, 80, 80],
          lineWidth: 0.15,
          textColor: [0, 0, 0],
          fillColor: [255, 255, 255],
          valign: "middle",
        },
        headStyles: {
          fillColor: [238, 238, 238],
          textColor: [0, 0, 0],
          fontStyle: "bold",
          lineColor: [0, 0, 0],
          lineWidth: 0.2,
        },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: {
          0: { cellWidth: 10, halign: "center" },
          1: { cellWidth: 19, halign: "center" },
          2: { cellWidth: 62 },
          3: { cellWidth: 22, halign: "center" },
          4: { cellWidth: 28, halign: "center" },
          5: { cellWidth: 24, halign: "center" },
          6: { cellWidth: 28, halign: "center" },
          7: { cellWidth: 25, halign: "center" },
          8: { cellWidth: 30, halign: "center" },
        },
      });

      const pageCount = doc.internal.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        doc.setPage(page);
        doc.setDrawColor(80, 80, 80);
        doc.setLineWidth(0.18);
        doc.line(12, pageHeight - 12, pageWidth - 12, pageHeight - 12);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(7.5);
        doc.setTextColor(60, 60, 60);
        doc.text("SPESS ARK | Graduated learner archive", 12, pageHeight - 7);
        doc.text(`Page ${page} of ${pageCount}`, pageWidth - 12, pageHeight - 7, { align: "right" });
      }

      const safeYear = academicYear.trim().replace(/[^0-9A-Za-z_-]/g, "-") || "all-years";
      const filename = `graduated-learners-${safeYear}.pdf`;
      const blobUrl = URL.createObjectURL(doc.output("blob"));

      preview.document.open();
      preview.document.write(`<!doctype html>
        <html>
          <head>
            <title>Graduated Learners Register</title>
            <style>
              html, body { height: 100%; margin: 0; font-family: Arial, sans-serif; background: #ececec; }
              .bar { height: 56px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; background: #111; color: #fff; }
              .bar strong { font-size: 14px; }
              .bar a { color: #111; background: #fff; border: 1px solid #fff; padding: 9px 14px; text-decoration: none; font-size: 13px; font-weight: 700; }
              iframe { width: 100%; height: calc(100% - 56px); border: 0; }
            </style>
          </head>
          <body>
            <div class="bar"><strong>Graduated Learners Register</strong><a href="${blobUrl}" download="${filename}">Download PDF</a></div>
            <iframe src="${blobUrl}" title="Graduated Learners Register"></iframe>
          </body>
        </html>`);
      preview.document.close();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 300_000);
    } catch (err) {
      preview.close();
      setError(err?.message || "Could not prepare the graduated learners PDF.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="graduated-pdf-action">
      <button
        type="button"
        className="primary-btn graduated-export-btn"
        onClick={handleOpenPdf}
        disabled={loading}
      >
        {loading ? "Preparing PDF..." : "Open Graduated List PDF"}
      </button>
      {error && <span className="graduated-pdf-error" role="alert">{error}</span>}
    </div>
  );
}
