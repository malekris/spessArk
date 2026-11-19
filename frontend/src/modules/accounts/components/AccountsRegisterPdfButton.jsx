import { useState } from "react";
import { loadPdfTools } from "../../../utils/loadPdfTools";

const amountFormatter = new Intl.NumberFormat("en-UG", {
  maximumFractionDigits: 0,
});

const formatAmount = (value) => amountFormatter.format(Number(value || 0));

const formatGeneratedAt = (date) =>
  date.toLocaleString("en-GB", {
    timeZone: "Africa/Kampala",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const safeFilenamePart = (value) =>
  String(value || "register")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");

export default function AccountsRegisterPdfButton({
  rows,
  filters,
  feeAmounts,
  feeConfigured,
  hasUnsavedChanges,
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const generatePdf = async () => {
    if (!rows.length || !feeConfigured || hasUnsavedChanges || generating) return;

    const previewWindow = window.open("", "_blank");
    try {
      setGenerating(true);
      setError("");

      const { jsPDF, autoTable } = await loadPdfTools();
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const generatedAt = new Date();
      const generatedLabel = formatGeneratedAt(generatedAt);
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const registerTitle = [
        "SPESS_Accounts",
        filters.classLevel,
        filters.stream,
        filters.term,
        filters.year,
      ].map(safeFilenamePart).filter(Boolean).join("_");

      doc.setProperties({
        title: registerTitle,
        subject: "SPESS Accounts term payment register",
        author: "St. Phillip's Equatorial Secondary School",
        creator: "SPESS Accounts",
      });

      const registerRows = rows.map((row, index) => {
        const expected = Number(
          row.residence_type === "Boarding" ? feeAmounts.boarding : feeAmounts.day
        ) || 0;
        const hasPayment = row.amount_paid !== "" && row.amount_paid !== null && row.amount_paid !== undefined;
        const paid = hasPayment ? Number(row.amount_paid || 0) : 0;
        return {
          index: index + 1,
          name: row.learner_name || "-",
          gender: row.gender || "-",
          residence: row.residence_type || "Day",
          expected,
          paid,
          hasPayment,
          isNotPaid: hasPayment && paid === 0,
          balance: Math.max(0, expected - paid),
        };
      });

      const totals = registerRows.reduce(
        (summary, row) => ({
          expected: summary.expected + row.expected,
          paid: summary.paid + row.paid,
          balance: summary.balance + row.balance,
          recorded: summary.recorded + (row.hasPayment ? 1 : 0),
        }),
        { expected: 0, paid: 0, balance: 0, recorded: 0 }
      );

      doc.setTextColor(18, 33, 27);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("ST. PHILLIP'S EQUATORIAL SECONDARY SCHOOL", pageWidth / 2, 14, {
        align: "center",
      });
      doc.setFontSize(11);
      doc.text("SPESS ACCOUNTS - TERM PAYMENT REGISTER", pageWidth / 2, 21, {
        align: "center",
      });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(
        `Class: ${filters.classLevel}   Stream: ${filters.stream}   Period: ${filters.term}, ${filters.year}`,
        12,
        29
      );
      doc.text(
        `Learners: ${rows.length}   Payments entered: ${totals.recorded}   Amounts shown in Uganda shillings (UGX)`,
        pageWidth - 12,
        29,
        { align: "right" }
      );

      autoTable(doc, {
        startY: 34,
        margin: { left: 10, right: 10, bottom: 16 },
        head: [["#", "Learner", "Gender", "Residence", "Expected (UGX)", "Paid (UGX)", "Balance (UGX)"]],
        body: registerRows.map((row) => [
          row.index,
          row.name,
          row.gender,
          row.residence,
          formatAmount(row.expected),
          row.isNotPaid ? "Not Paid" : row.hasPayment ? formatAmount(row.paid) : "",
          formatAmount(row.balance),
        ]),
        foot: [[
          "",
          "STREAM TOTAL",
          "",
          "",
          formatAmount(totals.expected),
          formatAmount(totals.paid),
          formatAmount(totals.balance),
        ]],
        showFoot: "lastPage",
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 8.5,
          cellPadding: 2.2,
          lineColor: [194, 202, 198],
          lineWidth: 0.18,
          textColor: [31, 41, 55],
          valign: "middle",
        },
        headStyles: {
          fillColor: [26, 42, 35],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          halign: "center",
        },
        footStyles: {
          fillColor: [234, 240, 237],
          textColor: [18, 97, 73],
          fontStyle: "bold",
        },
        alternateRowStyles: { fillColor: [248, 250, 249] },
        columnStyles: {
          0: { cellWidth: 11, halign: "center" },
          1: { cellWidth: 72 },
          2: { cellWidth: 24, halign: "center" },
          3: { cellWidth: 28, halign: "center" },
          4: { cellWidth: 38, halign: "right" },
          5: { cellWidth: 38, halign: "right" },
          6: { cellWidth: 38, halign: "right" },
        },
      });

      const pageCount = doc.getNumberOfPages();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        doc.setPage(pageNumber);
        doc.setDrawColor(184, 138, 24);
        doc.line(10, pageHeight - 12, pageWidth - 10, pageHeight - 12);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(96, 108, 102);
        doc.text(`Generated by SPESS Accounts on ${generatedLabel}`, 10, pageHeight - 7);
        doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - 10, pageHeight - 7, {
          align: "right",
        });
      }

      const blobUrl = URL.createObjectURL(doc.output("blob"));
      if (previewWindow) {
        previewWindow.location.href = blobUrl;
      } else {
        window.open(blobUrl, "_blank", "noopener,noreferrer");
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (pdfError) {
      previewWindow?.close();
      setError(pdfError?.message || "Failed to generate the payment register PDF.");
    } finally {
      setGenerating(false);
    }
  };

  const disabled = !rows.length || !feeConfigured || hasUnsavedChanges || generating;
  const guidance = hasUnsavedChanges
    ? "Save the pending learner changes before printing."
    : feeConfigured
      ? "Print the current class payment register with totals and balances."
      : "Save the Day and Boarding fee setup before printing.";

  return (
    <section className="accounts-pdf-panel">
      <div>
        <span>Payment Register</span>
        <h2>Printable Accounts PDF</h2>
        <p>{guidance}</p>
        {error ? <p className="accounts-pdf-error" role="alert">{error}</p> : null}
      </div>
      <button
        type="button"
        className="accounts-pdf-button"
        onClick={generatePdf}
        disabled={disabled}
      >
        {generating ? "Preparing PDF..." : "Open Payment PDF"}
      </button>
    </section>
  );
}
