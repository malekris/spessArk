import React, { useEffect, useMemo, useState } from "react";
import generateReportCardPDF from "../reportCardPdf";
import { adminFetch, getAdminHeaders } from "../../lib/api";
import { normalizeSchoolCalendar } from "../../utils/schoolCalendar";
import "./ForeverLibraryPanel.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5001";
const REPORT_DATES_STORAGE_KEY = "spess_report_card_dates";
const CLASS_LEVELS = ["S1", "S2", "S3", "S4"];
const STREAMS = ["North", "South"];
const PERIODS = [
  { value: "TERM_1", label: "Term 1", term: "1", reportKind: "END_OF_TERM" },
  { value: "TERM_2", label: "Term 2", term: "2", reportKind: "END_OF_TERM" },
  { value: "END_OF_YEAR", label: "End of Year", term: "3", reportKind: "END_OF_YEAR" },
];

const archiveKey = ({ academicYear, classLevel, stream, reportPeriod }) =>
  `${academicYear}|${classLevel}|${stream}|${reportPeriod}`;

const addDaysToDateKey = (dateKey, days) => {
  const parsed = new Date(`${String(dateKey || "").trim()}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setDate(parsed.getDate() + days);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const calendarDatesForPeriod = (calendar, period, year) => {
  const normalized = normalizeSchoolCalendar(calendar || {});
  if (String(normalized.academicYear || "") !== String(year || "")) {
    return { termEndedOn: "", nextTermBeginsOn: "" };
  }
  const index = period.term;
  const termEntry = normalized.entries.find((entry) => entry.key === `term${index}`);
  const nextTermEntry = normalized.entries.find(
    (entry) => entry.key === `term${Number(index) + 1}`
  );
  const holidayEntry = normalized.entries.find((entry) => entry.key === `holiday${index}`);
  return {
    termEndedOn: termEntry?.to || "",
    nextTermBeginsOn:
      nextTermEntry?.from ||
      (index === "3" && holidayEntry?.to ? addDaysToDateKey(holidayEntry.to, 1) : ""),
  };
};

const cachedDatesForPeriod = (period, year) => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REPORT_DATES_STORAGE_KEY) || "{}");
    const mode = period.value === "END_OF_YEAR" ? "year" : "term";
    return parsed?.[`${mode}_${year}_${period.term}`] || {};
  } catch {
    return {};
  }
};

const buildInitialDates = (calendar, year) =>
  Object.fromEntries(
    PERIODS.map((period) => {
      const calendarDates = calendarDatesForPeriod(calendar, period, year);
      const cached = cachedDatesForPeriod(period, year);
      const useManual = cached.source === "manual";
      return [
        period.value,
        useManual
          ? { ...calendarDates, ...cached }
          : {
              termEndedOn: calendarDates.termEndedOn || cached.termEndedOn || "",
              nextTermBeginsOn:
                calendarDates.nextTermBeginsOn || cached.nextTermBeginsOn || "",
            },
      ];
    })
  );

const periodLabel = (value) =>
  PERIODS.find((period) => period.value === value)?.label || value;

const formatBytes = (bytes) => {
  const amount = Number(bytes || 0);
  if (amount < 1024 * 1024) return `${Math.max(1, Math.round(amount / 1024))} KB`;
  return `${(amount / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

export default function ForeverLibraryPanel({ defaultYear }) {
  const [year, setYear] = useState(String(defaultYear || new Date().getFullYear()));
  const [archives, setArchives] = useState([]);
  const [availableYears, setAvailableYears] = useState([]);
  const [storageReady, setStorageReady] = useState(false);
  const [calendar, setCalendar] = useState(null);
  const [reportDates, setReportDates] = useState({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [openingId, setOpeningId] = useState(null);
  const [revisingId, setRevisingId] = useState(null);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [filters, setFilters] = useState({ classLevel: "ALL", stream: "ALL", period: "ALL" });
  const [progress, setProgress] = useState({ completed: 0, total: 0, label: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadArchives = async () => {
    const normalizedYear = Number(year);
    if (!Number.isInteger(normalizedYear) || normalizedYear < 2000 || normalizedYear > 2200) {
      setArchives([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ year, includeHistory: String(includeHistory) });
      const response = await adminFetch(`/api/admin/report-archives?${params.toString()}`);
      setArchives(Array.isArray(response?.archives) ? response.archives : []);
      setAvailableYears(Array.isArray(response?.years) ? response.years : []);
      setStorageReady(Boolean(response?.storageReady));
    } catch (loadError) {
      setArchives([]);
      setError(loadError.message || "Forever Library could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/school-calendar`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("School calendar could not be loaded.");
        return response.json();
      })
      .then((payload) => {
        if (active) setCalendar(payload);
      })
      .catch(() => {
        if (active) setCalendar(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setReportDates(buildInitialDates(calendar, year));
  }, [calendar, year]);

  useEffect(() => {
    loadArchives();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, includeHistory]);

  const activeArchives = useMemo(
    () => archives.filter((archive) => archive.status === "ACTIVE"),
    [archives]
  );
  const activeArchiveKeys = useMemo(
    () => new Set(activeArchives.map(archiveKey)),
    [activeArchives]
  );
  const filteredArchives = useMemo(
    () =>
      archives.filter((archive) => {
        if (filters.classLevel !== "ALL" && archive.classLevel !== filters.classLevel) return false;
        if (filters.stream !== "ALL" && archive.stream !== filters.stream) return false;
        if (filters.period !== "ALL" && archive.reportPeriod !== filters.period) return false;
        return true;
      }),
    [archives, filters]
  );
  const summary = useMemo(
    () => ({
      files: activeArchives.length,
      learners: activeArchives.reduce((sum, item) => sum + Number(item.learnerCount || 0), 0),
      size: activeArchives.reduce((sum, item) => sum + Number(item.fileSize || 0), 0),
      completeStreams: CLASS_LEVELS.flatMap((classLevel) =>
        STREAMS.map((stream) =>
          PERIODS.every((period) =>
            activeArchiveKeys.has(
              archiveKey({ academicYear: Number(year), classLevel, stream, reportPeriod: period.value })
            )
          )
        )
      ).filter(Boolean).length,
    }),
    [activeArchives, activeArchiveKeys, year]
  );

  const updateDate = (periodValue, field, value) => {
    setReportDates((current) => ({
      ...current,
      [periodValue]: { ...(current[periodValue] || {}), [field]: value },
    }));
  };

  const validateDates = (period) => {
    const dates = reportDates[period.value] || {};
    if (!dates.termEndedOn || !dates.nextTermBeginsOn) {
      throw new Error(`Complete both report dates for ${period.label} before archiving.`);
    }
    return dates;
  };

  const fetchPeriodRows = async (classLevel, period) => {
    const endpoint = period.value === "END_OF_YEAR"
      ? "/api/admin/reports/year"
      : "/api/admin/reports/term";
    const responses = await Promise.all(
      STREAMS.map(async (stream) => {
        const params = new URLSearchParams({
          year,
          term: period.term,
          class_level: classLevel,
          stream,
        });
        const rows = await adminFetch(`${endpoint}?${params.toString()}`);
        return { stream, rows: Array.isArray(rows) ? rows : [] };
      })
    );
    return {
      byStream: new Map(responses.map((entry) => [entry.stream, entry.rows])),
      rankingRows: responses.flatMap((entry) => entry.rows),
    };
  };

  const uploadDocument = async ({ doc, classLevel, stream, period, learnerCount, forceRevision }) => {
    const filename = `OLevel_${year}_${classLevel}_${stream}_${period.value}.pdf`;
    const blob = doc.output("blob");
    const payload = new FormData();
    payload.append("academicYear", year);
    payload.append("classLevel", classLevel);
    payload.append("stream", stream);
    payload.append("reportPeriod", period.value);
    payload.append("reportKind", period.reportKind);
    payload.append("learnerCount", String(learnerCount));
    payload.append("forceRevision", String(Boolean(forceRevision)));
    payload.append("file", new File([blob], filename, { type: "application/pdf" }));
    return adminFetch("/api/admin/report-archives", { method: "POST", body: payload });
  };

  const generateArchive = async ({ classLevel, stream, period, rows, rankingRows, forceRevision }) => {
    if (!rows.length) return { status: "no-data" };
    const dates = validateDates(period);
    const doc = await generateReportCardPDF(
      rows,
      {
        year,
        term: period.term,
        class_level: classLevel,
        stream,
        reportType: period.value === "END_OF_YEAR" ? "year" : "term",
        ...dates,
      },
      {
        rankingSourceRows: rankingRows.length ? rankingRows : rows,
        recalculatePositions: true,
        openPreview: false,
        onProgress: () => {},
      }
    );
    if (!doc) throw new Error(`${period.label} PDF generation returned no document.`);
    const learnerCount = new Set(rows.map((row) => String(row.student_id))).size;
    await uploadDocument({ doc, classLevel, stream, period, learnerCount, forceRevision });
    return { status: "archived" };
  };

  const archiveAll = async () => {
    if (running) return;
    const normalizedYear = Number(year);
    if (!Number.isInteger(normalizedYear) || normalizedYear < 2000 || normalizedYear > 2200) {
      setError("Enter a valid academic year before archiving reports.");
      return;
    }
    if (!storageReady) {
      setError("Private R2 document storage is not connected. Forever Library cannot preserve files yet.");
      return;
    }
    try {
      PERIODS.forEach(validateDates);
    } catch (dateError) {
      setError(dateError.message);
      return;
    }
    if (!window.confirm(`Archive every missing O-Level report for ${year}? Existing archives will be kept.`)) return;

    const total = CLASS_LEVELS.length * STREAMS.length * PERIODS.length;
    let completed = 0;
    let created = 0;
    let skipped = 0;
    const failures = [];
    setRunning(true);
    setError("");
    setNotice("");
    setProgress({ completed: 0, total, label: "Preparing archive queue" });

    try {
      for (const period of PERIODS) {
        for (const classLevel of CLASS_LEVELS) {
          setProgress({ completed, total, label: `Loading ${period.label} · ${classLevel}` });
          let periodRows;
          try {
            periodRows = await fetchPeriodRows(classLevel, period);
          } catch (fetchError) {
            STREAMS.forEach((stream) => {
              failures.push(`${classLevel} ${stream} ${period.label}: ${fetchError.message}`);
            });
            completed += STREAMS.length;
            setProgress({ completed, total, label: `${classLevel} ${period.label} could not load` });
            continue;
          }

          for (const stream of STREAMS) {
            const key = archiveKey({
              academicYear: Number(year),
              classLevel,
              stream,
              reportPeriod: period.value,
            });
            setProgress({ completed, total, label: `${period.label} · ${classLevel} ${stream}` });
            if (activeArchiveKeys.has(key)) {
              skipped += 1;
              completed += 1;
              setProgress({ completed, total, label: `${period.label} · ${classLevel} ${stream} already archived` });
              continue;
            }
            try {
              const result = await generateArchive({
                classLevel,
                stream,
                period,
                rows: periodRows.byStream.get(stream) || [],
                rankingRows: periodRows.rankingRows,
                forceRevision: false,
              });
              if (result.status === "archived") created += 1;
              else skipped += 1;
            } catch (archiveError) {
              failures.push(`${classLevel} ${stream} ${period.label}: ${archiveError.message}`);
            }
            completed += 1;
            setProgress({ completed, total, label: `${period.label} · ${classLevel} ${stream}` });
            await new Promise((resolve) => window.setTimeout(resolve, 0));
          }
        }
      }
      await loadArchives();
      setNotice(
        `${created} report PDF${created === 1 ? "" : "s"} archived. ${skipped} skipped because they already existed or had no report data.`
      );
      if (failures.length) {
        setError(`${failures.length} archive item${failures.length === 1 ? "" : "s"} failed. ${failures.slice(0, 3).join(" | ")}`);
      }
    } finally {
      setRunning(false);
    }
  };

  const createRevision = async (archive) => {
    if (running || revisingId) return;
    const period = PERIODS.find((item) => item.value === archive.reportPeriod);
    if (!period) return;
    if (!window.confirm(`Create version ${archive.version + 1} for ${archive.classLevel} ${archive.stream} ${period.label}?`)) return;
    setRevisingId(archive.id);
    setError("");
    setNotice("");
    try {
      const periodRows = await fetchPeriodRows(archive.classLevel, period);
      const result = await generateArchive({
        classLevel: archive.classLevel,
        stream: archive.stream,
        period,
        rows: periodRows.byStream.get(archive.stream) || [],
        rankingRows: periodRows.rankingRows,
        forceRevision: true,
      });
      if (result.status === "no-data") throw new Error("No current report data is available for this archive.");
      await loadArchives();
      setNotice(`A revised ${period.label} report was preserved for ${archive.classLevel} ${archive.stream}.`);
    } catch (revisionError) {
      setError(revisionError.message || "The revised report could not be archived.");
    } finally {
      setRevisingId(null);
    }
  };

  const openArchive = async (archive, download = false) => {
    const previewWindow = download ? null : window.open("", "_blank");
    setOpeningId(archive.id);
    setError("");
    try {
      const response = await fetch(
        `${API_BASE}/api/admin/report-archives/${archive.id}/file${download ? "?download=1" : ""}`,
        { headers: getAdminHeaders() }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Archived PDF could not be opened.");
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      if (download) {
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = archive.originalFilename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else if (previewWindow) {
        previewWindow.location.href = blobUrl;
      } else {
        window.open(blobUrl, "_blank");
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (openError) {
      previewWindow?.close();
      setError(openError.message || "Archived PDF could not be opened.");
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="forever-library">
      <section className="forever-library__hero">
        <div>
          <span className="forever-library__eyebrow">Permanent report archive</span>
          <h3>Forever Library</h3>
          <p>Preserve final O-Level report batches before learner promotion changes the live register.</p>
        </div>
        <div className={`forever-library__storage ${storageReady ? "is-ready" : "is-offline"}`}>
          <span>{storageReady ? "Private storage ready" : "Private storage unavailable"}</span>
          <strong>{year}</strong>
        </div>
      </section>

      <section className="forever-library__metrics" aria-label="Forever Library summary">
        <div><span>Active PDFs</span><strong>{summary.files}</strong></div>
        <div><span>Report pages for learners</span><strong>{summary.learners}</strong></div>
        <div><span>Complete streams</span><strong>{summary.completeStreams} / 8</strong></div>
        <div><span>Stored size</span><strong>{formatBytes(summary.size)}</strong></div>
      </section>

      <section className="forever-library__archive-control">
        <div className="forever-library__control-heading">
          <div>
            <h4>Archive year reports</h4>
            <p>Calendar dates are prefilled. Archive runs sequentially and safely resumes around existing files.</p>
          </div>
          <label>
            <span>Academic year</span>
            <input
              type="number"
              list="forever-library-years"
              min="2000"
              max="2200"
              value={year}
              disabled={running}
              onChange={(event) => setYear(event.target.value)}
            />
            <datalist id="forever-library-years">
              {availableYears.map((item) => <option key={item} value={item} />)}
            </datalist>
          </label>
        </div>

        <div className="forever-library__dates">
          {PERIODS.map((period) => (
            <div key={period.value} className="forever-library__date-row">
              <strong>{period.label}</strong>
              <label>
                <span>Term ended</span>
                <input
                  type="date"
                  value={reportDates[period.value]?.termEndedOn || ""}
                  disabled={running}
                  onChange={(event) => updateDate(period.value, "termEndedOn", event.target.value)}
                />
              </label>
              <label>
                <span>Next term begins</span>
                <input
                  type="date"
                  value={reportDates[period.value]?.nextTermBeginsOn || ""}
                  disabled={running}
                  onChange={(event) => updateDate(period.value, "nextTermBeginsOn", event.target.value)}
                />
              </label>
            </div>
          ))}
        </div>

        {running && (
          <div className="forever-library__progress">
            <div>
              <span>{progress.label}</span>
              <strong>{progress.completed} / {progress.total}</strong>
            </div>
            <progress value={progress.completed} max={Math.max(1, progress.total)} />
          </div>
        )}

        <button
          type="button"
          className="forever-library__archive-button"
          onClick={archiveAll}
          disabled={running || loading || !storageReady}
        >
          {running ? "Archiving reports…" : "Archive missing reports"}
        </button>
      </section>

      {notice && <div className="forever-library__notice is-success">{notice}</div>}
      {error && <div className="forever-library__notice is-error">{error}</div>}

      <section className="forever-library__browser">
        <div className="forever-library__browser-head">
          <div>
            <h4>Preserved reports</h4>
            <p>Open the frozen PDF or preserve a revised version after an approved marks correction.</p>
          </div>
          <label className="forever-library__history-toggle">
            <input
              type="checkbox"
              checked={includeHistory}
              onChange={(event) => setIncludeHistory(event.target.checked)}
            />
            <span>Show old versions</span>
          </label>
        </div>

        <div className="forever-library__filters">
          <select value={filters.classLevel} onChange={(event) => setFilters((value) => ({ ...value, classLevel: event.target.value }))} aria-label="Filter archive by class">
            <option value="ALL">All classes</option>
            {CLASS_LEVELS.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select value={filters.stream} onChange={(event) => setFilters((value) => ({ ...value, stream: event.target.value }))} aria-label="Filter archive by stream">
            <option value="ALL">All streams</option>
            {STREAMS.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select value={filters.period} onChange={(event) => setFilters((value) => ({ ...value, period: event.target.value }))} aria-label="Filter archive by report period">
            <option value="ALL">All periods</option>
            {PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button type="button" onClick={loadArchives} disabled={loading || running}>Refresh</button>
        </div>

        {loading ? (
          <div className="forever-library__empty">Loading preserved reports…</div>
        ) : filteredArchives.length === 0 ? (
          <div className="forever-library__empty">No report PDFs match this view yet.</div>
        ) : (
          <div className="forever-library__list">
            {filteredArchives.map((archive) => (
              <article key={archive.id} className={`forever-library__row ${archive.status !== "ACTIVE" ? "is-superseded" : ""}`}>
                <div className="forever-library__file-mark">PDF</div>
                <div className="forever-library__file-copy">
                  <div>
                    <strong>{archive.classLevel} {archive.stream}</strong>
                    <span>{periodLabel(archive.reportPeriod)}</span>
                    <span>Version {archive.version}</span>
                    {archive.status !== "ACTIVE" && <span>Superseded</span>}
                  </div>
                  <small>{archive.learnerCount} learners · {formatBytes(archive.fileSize)} · {formatDateTime(archive.generatedAt)}</small>
                </div>
                <div className="forever-library__actions">
                  <button type="button" onClick={() => openArchive(archive, false)} disabled={openingId === archive.id}>View</button>
                  <button type="button" onClick={() => openArchive(archive, true)} disabled={openingId === archive.id}>Download</button>
                  {archive.status === "ACTIVE" && (
                    <button type="button" onClick={() => createRevision(archive)} disabled={Boolean(revisingId) || running}>
                      {revisingId === archive.id ? "Revising…" : "New version"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
