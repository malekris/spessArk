import { useEffect, useState } from "react";
import { adminFetch } from "../../lib/api";
import { normalizeSchoolCalendar } from "../../utils/schoolCalendar";
import "./ParentBatchReportRelease.css";

const LEVEL_OPTIONS = {
  O_LEVEL: {
    label: "O-Level",
    classes: ["S1", "S2", "S3", "S4"],
    streams: ["North", "South"],
    reportKind: "END_OF_TERM",
  },
  A_LEVEL: {
    label: "A-Level",
    classes: ["S5", "S6"],
    streams: ["Arts", "Sciences"],
    reportKind: "A_LEVEL_END_OF_TERM",
  },
};

const cleanFilePart = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]/g, "") || "Learner";

const addDaysToDateKey = (dateKey, days) => {
  const parsed = new Date(`${String(dateKey || "").trim()}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setDate(parsed.getDate() + days);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Report footers use the same term boundaries as the normal report-card screens.
const getBatchReportDates = (calendar, term, year) => {
  const normalized = normalizeSchoolCalendar(calendar || {});
  if (String(normalized.academicYear || "") !== String(year || "")) {
    return { termEndedOn: "", nextTermBeginsOn: "" };
  }

  const termNumber = Number(String(term || "").match(/[123]/)?.[0]);
  if (!termNumber) return { termEndedOn: "", nextTermBeginsOn: "" };

  const termEntry = normalized.entries.find((entry) => entry.key === `term${termNumber}`);
  const nextTermEntry = normalized.entries.find((entry) => entry.key === `term${termNumber + 1}`);
  const holidayEntry = normalized.entries.find((entry) => entry.key === `holiday${termNumber}`);

  return {
    termEndedOn: termEntry?.to || "",
    nextTermBeginsOn:
      nextTermEntry?.from ||
      (termNumber === 3 && holidayEntry?.to ? addDaysToDateKey(holidayEntry.to, 1) : ""),
  };
};

const learnerIdFromOLevelRow = (row) => String(row?.student_id || "").trim();
const learnerIdFromALevelReport = (report) => String(report?.learner?.id || "").trim();

const makeSelectionKey = (selection) =>
  [selection.level, selection.classLevel, selection.stream, selection.term, selection.academicYear].join("|");

export default function ParentBatchReportRelease({
  storageReady,
  releasePeriod,
  onReleaseComplete,
  setNotice,
  setError,
}) {
  const [selection, setSelection] = useState(() => ({
    level: "O_LEVEL",
    classLevel: "S1",
    stream: "North",
    term: releasePeriod.term,
    academicYear: releasePeriod.academicYear,
  }));
  const [audit, setAudit] = useState(null);
  const [checking, setChecking] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, learnerName: "" });
  const [releaseResults, setReleaseResults] = useState([]);

  useEffect(() => {
    setSelection((current) => ({
      ...current,
      term: releasePeriod.term,
      academicYear: releasePeriod.academicYear,
    }));
  }, [releasePeriod]);

  const levelConfig = LEVEL_OPTIONS[selection.level];
  const selectionKey = makeSelectionKey(selection);
  const auditIsCurrent = audit?.selectionKey === selectionKey;
  const readyCandidates = auditIsCurrent ? audit.readyCandidates : [];
  const missingCandidates = auditIsCurrent ? audit.missingCandidates : [];
  const alreadyReleasedCount = readyCandidates.filter((candidate) => candidate.already_released).length;
  const recipientCount = readyCandidates.reduce(
    (sum, candidate) => sum + Number(candidate.recipient_count || 0),
    0
  );

  const updateSelection = (field, value) => {
    setAudit(null);
    setReleaseResults([]);
    setSelection((current) => {
      if (field !== "level") return { ...current, [field]: value };
      const nextConfig = LEVEL_OPTIONS[value];
      return {
        ...current,
        level: value,
        classLevel: nextConfig.classes[0],
        stream: nextConfig.streams[0],
      };
    });
  };

  const loadOLevelReportData = async () => {
    const buildUrl = (streamName) => {
      const params = new URLSearchParams({
        year: String(selection.academicYear),
        term: selection.term,
        class_level: selection.classLevel,
        stream: streamName,
      });
      return `/api/admin/reports/term?${params.toString()}`;
    };

    // Both streams are retained for class-wide positions, while only the selected
    // stream is split into learner PDFs for release.
    const [selectedRows, otherRows] = await Promise.all([
      adminFetch(buildUrl(selection.stream)),
      adminFetch(buildUrl(selection.stream === "North" ? "South" : "North")).catch(() => []),
    ]);
    return {
      selectedRows: Array.isArray(selectedRows) ? selectedRows : [],
      rankingRows: [...(Array.isArray(selectedRows) ? selectedRows : []), ...(Array.isArray(otherRows) ? otherRows : [])],
    };
  };

  const loadALevelReportData = async () => {
    const reports = await adminFetch("/api/alevel/reports/download", {
      method: "POST",
      body: {
        term: selection.term,
        class: selection.classLevel,
        stream: selection.stream,
        year: selection.academicYear,
        assessmentMode: "FULL",
      },
    });
    return { reports: Array.isArray(reports) ? reports : [] };
  };

  const checkLinkedReports = async () => {
    setChecking(true);
    setNotice("");
    setError("");
    setReleaseResults([]);

    try {
      const params = new URLSearchParams({
        level: selection.level,
        classLevel: selection.classLevel,
        stream: selection.stream,
        academicYear: String(selection.academicYear),
        term: selection.term,
      });
      const [candidatePayload, calendar, reportPayload] = await Promise.all([
        adminFetch(`/api/admin/parents/release-candidates?${params.toString()}`),
        adminFetch("/api/admin/school-calendar").catch(() => null),
        selection.level === "O_LEVEL" ? loadOLevelReportData() : loadALevelReportData(),
      ]);

      const candidates = Array.isArray(candidatePayload?.candidates) ? candidatePayload.candidates : [];
      const reportDates = getBatchReportDates(calendar, selection.term, selection.academicYear);
      let ready;

      if (selection.level === "O_LEVEL") {
        const rowsByLearner = new Map();
        reportPayload.selectedRows.forEach((row) => {
          const id = learnerIdFromOLevelRow(row);
          if (!id) return;
          if (!rowsByLearner.has(id)) rowsByLearner.set(id, []);
          rowsByLearner.get(id).push(row);
        });
        ready = candidates
          .filter((candidate) => rowsByLearner.has(String(candidate.id)))
          .map((candidate) => ({ ...candidate, reportData: rowsByLearner.get(String(candidate.id)) }));
      } else {
        const reportsByLearner = new Map(
          reportPayload.reports.map((report) => [learnerIdFromALevelReport(report), report])
        );
        ready = candidates
          .filter((candidate) => reportsByLearner.has(String(candidate.id)))
          .map((candidate) => ({ ...candidate, reportData: reportsByLearner.get(String(candidate.id)) }));
      }

      const readyIds = new Set(ready.map((candidate) => String(candidate.id)));
      const missing = candidates.filter((candidate) => !readyIds.has(String(candidate.id)));
      setAudit({
        selectionKey,
        readyCandidates: ready,
        missingCandidates: missing,
        reportPayload,
        reportDates,
      });

      if (!candidates.length) {
        setNotice("No approved parent account is actively linked to a learner in this selection.");
      } else if (!ready.length) {
        setNotice("Linked learners were found, but no end-of-term report data is ready for release.");
      } else {
        setNotice(`${ready.length} linked learner report${ready.length === 1 ? " is" : "s are"} ready for release.`);
      }
    } catch (err) {
      setAudit(null);
      setError(err.message || "Linked report cards could not be checked.");
    } finally {
      setChecking(false);
    }
  };

  const buildLearnerPdf = async (candidate, generators) => {
    if (selection.level === "O_LEVEL") {
      return generators.generateOLevel(candidate.reportData, {
        year: selection.academicYear,
        term: selection.term,
        class_level: selection.classLevel,
        stream: selection.stream,
        reportType: "term",
        ...audit.reportDates,
      }, {
        rankingSourceRows: audit.reportPayload.rankingRows,
        recalculatePositions: true,
        openPreview: false,
        onProgress: () => {},
      });
    }

    return generators.generateALevel([candidate.reportData], {
      year: selection.academicYear,
      term: selection.term,
      cls: selection.classLevel,
      stream: selection.stream,
      assessmentMode: "FULL",
      ...audit.reportDates,
    }, { openPreview: false });
  };

  const uploadLearnerPdf = async (candidate, doc) => {
    const filename = `${cleanFilePart(candidate.learner_name)}_${selection.term.replace(/\s+/g, "_")}_${selection.academicYear}_Report.pdf`;
    const blob = doc.output("blob");
    const payload = new FormData();
    payload.append("documentType", "REPORT");
    payload.append("title", `${selection.term} ${selection.academicYear} End of Term Report Card`);
    payload.append("description", `Official ${selection.term.toLowerCase()} report card.`);
    payload.append("academicYear", String(selection.academicYear));
    payload.append("term", selection.term);
    payload.append("learnerLevel", selection.level);
    payload.append("learnerId", String(candidate.id));
    payload.append("reportKind", levelConfig.reportKind);
    payload.append("file", new File([blob], filename, { type: "application/pdf" }));
    return adminFetch("/api/admin/parents/documents", { method: "POST", body: payload });
  };

  const releaseReports = async () => {
    if (!auditIsCurrent || !readyCandidates.length || releasing) return;
    if (!storageReady) {
      setError("Private Cloudflare R2 storage is not connected. Configure PARENT_R2_* or the private BACKUP_R2_* credentials on Railway.");
      return;
    }
    const replacementNote = alreadyReleasedCount
      ? ` ${alreadyReleasedCount} existing report${alreadyReleasedCount === 1 ? "" : "s"} will be replaced.`
      : "";
    if (!window.confirm(`Release ${readyCandidates.length} report card${readyCandidates.length === 1 ? "" : "s"} now?${replacementNote}`)) {
      return;
    }

    setReleasing(true);
    setNotice("");
    setError("");
    setReleaseResults([]);
    setProgress({ completed: 0, total: readyCandidates.length, learnerName: "Preparing report engine" });

    const results = [];
    try {
      // PDF engines are loaded only when an administrator confirms a release,
      // keeping the normal dashboard bundle light.
      const generators = selection.level === "O_LEVEL"
        ? { generateOLevel: (await import("../reportCardPdf")).default }
        : { generateALevel: (await import("../../modules/alevel/pages/ALevelReports")).generateAlevelPDF };

      for (let index = 0; index < readyCandidates.length; index += 1) {
        const candidate = readyCandidates[index];
        setProgress({ completed: index, total: readyCandidates.length, learnerName: candidate.learner_name });
        try {
          const doc = await buildLearnerPdf(candidate, generators);
          if (!doc) throw new Error("The report engine returned no PDF.");
          await uploadLearnerPdf(candidate, doc);
          results.push({ id: candidate.id, learnerName: candidate.learner_name, status: "released" });
        } catch (err) {
          results.push({
            id: candidate.id,
            learnerName: candidate.learner_name,
            status: "failed",
            reason: err.message || "Release failed",
          });
        }
        setProgress({ completed: index + 1, total: readyCandidates.length, learnerName: candidate.learner_name });
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }

      const released = results.filter((result) => result.status === "released").length;
      const failed = results.length - released;
      setReleaseResults(results);
      if (failed) {
        setError(`${released} report cards released. ${failed} failed and are listed below.`);
      } else {
        setNotice(`${released} report card${released === 1 ? "" : "s"} released successfully to linked parents.`);
      }
      await onReleaseComplete?.();
      setAudit(null);
    } catch (err) {
      setError(err.message || "The report batch could not be completed.");
      setReleaseResults(results);
    } finally {
      setReleasing(false);
    }
  };

  const progressPercent = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <div className="parent-batch-release">
      <div className="parent-batch-release__header">
        <div>
          <span>Automated family delivery</span>
          <h3>Release End of Term Reports</h3>
        </div>
        <strong>{selection.term} · {selection.academicYear}</strong>
      </div>

      <div className="parent-batch-release__controls">
        <label><span>Level</span><select value={selection.level} onChange={(event) => updateSelection("level", event.target.value)} disabled={releasing}><option value="O_LEVEL">O-Level</option><option value="A_LEVEL">A-Level</option></select></label>
        <label><span>Class</span><select value={selection.classLevel} onChange={(event) => updateSelection("classLevel", event.target.value)} disabled={releasing}>{levelConfig.classes.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Stream</span><select value={selection.stream} onChange={(event) => updateSelection("stream", event.target.value)} disabled={releasing}>{levelConfig.streams.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Term</span><select value={selection.term} onChange={(event) => updateSelection("term", event.target.value)} disabled={releasing}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></label>
        <label><span>Academic Year</span><input type="number" min="2000" max="2200" value={selection.academicYear} onChange={(event) => updateSelection("academicYear", event.target.value)} disabled={releasing} /></label>
      </div>

      <button className="parent-batch-release__check" type="button" onClick={checkLinkedReports} disabled={checking || releasing}>
        {checking ? "Checking linked reports..." : "Check Linked Reports"}
      </button>

      {!storageReady && (
        <div className="parent-batch-release__storage-warning" role="alert">
          Private report storage is not connected. Configure the parent or backup R2 credentials on Railway before releasing reports.
        </div>
      )}

      {auditIsCurrent && (
        <div className="parent-batch-release__audit">
          <div className="parent-batch-release__stats">
            <article><span>Ready</span><strong>{readyCandidates.length}</strong></article>
            <article><span>Parent Recipients</span><strong>{recipientCount}</strong></article>
            <article><span>No Report Data</span><strong>{missingCandidates.length}</strong></article>
            <article><span>Replacing</span><strong>{alreadyReleasedCount}</strong></article>
          </div>

          {missingCandidates.length > 0 && (
            <details className="parent-batch-release__missing">
              <summary>{missingCandidates.length} linked learner{missingCandidates.length === 1 ? " has" : "s have"} no report data</summary>
              <div>{missingCandidates.map((candidate) => <span key={candidate.id}>{candidate.learner_name}</span>)}</div>
            </details>
          )}

          <button className="parent-batch-release__release" type="button" onClick={releaseReports} disabled={!readyCandidates.length || releasing}>
            {!storageReady
              ? "Resolve Private Storage"
              : releasing
                ? `Releasing ${progress.completed} of ${progress.total}...`
                : `Release ${readyCandidates.length} Report Card${readyCandidates.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {releasing && (
        <div className="parent-batch-release__progress" role="status" aria-live="polite">
          <div><strong>{progress.learnerName}</strong><span>{progressPercent}%</span></div>
          <progress max="100" value={progressPercent}>{progressPercent}%</progress>
        </div>
      )}

      {releaseResults.some((result) => result.status === "failed") && (
        <div className="parent-batch-release__failures">
          <strong>Reports needing attention</strong>
          {releaseResults.filter((result) => result.status === "failed").map((result) => (
            <span key={result.id}>{result.learnerName}: {result.reason}</span>
          ))}
        </div>
      )}
    </div>
  );
}
