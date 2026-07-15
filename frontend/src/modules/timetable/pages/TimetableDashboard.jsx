import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TimetableAdminShell from "../components/TimetableAdminShell";
import { adminFetch } from "../../../lib/api";
import { openTimetablePdfPreview } from "../utils/timetablePdf";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const STREAMS = [
  "S1::North",
  "S1::South",
  "S2::North",
  "S2::South",
  "S3::North",
  "S3::South",
  "S4::North",
  "S4::South",
  "S5::Arts",
  "S5::Sciences",
  "S6::Arts",
  "S6::Sciences",
];
const CLASS_LEVELS = ["S1", "S2", "S3", "S4", "S5", "S6"];
const GRID_COLUMNS = ["P1", "P2", "MIDDAY", "P4", "P5"];
const DAY_LIST_FORMATTER = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
const SCHOOL_DAY_CAPACITY = {
  Monday: 4,
  Tuesday: 5,
  Wednesday: 5,
  Thursday: 5,
  Friday: 5,
};

const readinessBlockerItems = (readiness) => [
  ...(readiness?.teachersNeedingAvailability || []).map((teacher) => ({
    key: `teacher-${teacher.teacherId}`,
    title: teacher.teacherName,
    detail: "Select 1-3 weekday availability days.",
  })),
  ...(readiness?.reviewAssignments || []).map((assignment) => ({
    key: `assignment-${assignment.assignmentId}`,
    title: `${assignment.classLevel} ${assignment.stream}`,
    detail: `Review the ${assignment.subject} lesson rule.`,
  })),
  ...(readiness?.aLevelCoverageIssues || []).map((issue) => ({
    key: `coverage-${issue.classLevel}-${issue.stream}-${issue.subjectGroup}`,
    title: `${issue.classLevel} ${issue.stream}`,
    detail: `Assign ${issue.subjectGroup} before generating.`,
  })),
  ...(readiness?.aLevelPaperIssues || []).map((issue) => ({
    key: `paper-${issue.classLevel}-${issue.stream}-${issue.subjectGroup}`,
    title: `${issue.classLevel} ${issue.stream}`,
    detail: issue.message,
  })),
];

const streamLabel = (key) => String(key || "").replace("::", " ");
const classStreams = (classLevel) =>
  ["S5", "S6"].includes(classLevel) ? ["Arts", "Sciences"] : ["North", "South"];
const aLevelRuleLabel = (subject) => {
  const key = String(subject || "").trim().toLowerCase();
  if (key.includes("general paper") || key === "gp") return "Combined GP";
  if (key.includes("ict") || key.includes("sub math")) return "Fixed subsidiary";
  if (["entrepreneurship", "ent", "economics", "econ", "literature", "luganda"].includes(key)) {
    return "Parallel pair";
  }
  return "Flexible principal";
};
const formatDate = (value) => {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not yet" : date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const versionQuality = (item) => {
  const requested = numberValue(item?.stats?.lessonsRequested);
  const placed = numberValue(item?.stats?.lessonsPlaced);
  return {
    valid: Boolean(item?.validation?.valid),
    unallocated: numberValue(item?.stats?.unallocatedLessons),
    requested,
    placed,
    completion: requested > 0 ? placed / requested : 0,
    createdAt: new Date(item?.createdAt || 0).getTime() || 0,
  };
};

const suggestBestVersion = (versions = []) => [...versions].sort((left, right) => {
  const leftQuality = versionQuality(left);
  const rightQuality = versionQuality(right);
  return Number(rightQuality.valid) - Number(leftQuality.valid) ||
    leftQuality.unallocated - rightQuality.unallocated ||
    rightQuality.completion - leftQuality.completion ||
    rightQuality.createdAt - leftQuality.createdAt;
})[0] || null;

function buildTeacherLoadAnalysis(version, teachers = []) {
  if (!version) return [];
  const teacherMeta = new Map(teachers.map((teacher) => [Number(teacher.teacherId), teacher]));
  const buckets = new Map();

  (version.sessions || []).forEach((session) => {
    const teacherId = Number(session.teacherId);
    if (!teacherId || !DAYS.includes(session.day) || !session.slotCode) return;
    if (!buckets.has(teacherId)) {
      buckets.set(teacherId, {
        teacherId,
        teacherName: session.teacherName || `Teacher #${teacherId}`,
        slots: new Set(),
      });
    }
    buckets.get(teacherId).slots.add(`${session.day}::${session.slotCode}`);
  });

  return Array.from(buckets.values()).map((bucket) => {
    const meta = teacherMeta.get(bucket.teacherId);
    const scheduledDays = DAYS.filter((day) =>
      Array.from(bucket.slots).some((slot) => slot.startsWith(`${day}::`))
    );
    const configuredDays = (meta?.availableDays || []).filter((day) => DAYS.includes(day));
    const capacityDays = configuredDays.length > 0 ? configuredDays : scheduledDays;
    const dailyLoads = Object.fromEntries(DAYS.map((day) => [
      day,
      Array.from(bucket.slots).filter((slot) => slot.startsWith(`${day}::`)).length,
    ]));
    const total = bucket.slots.size;
    const capacity = capacityDays.reduce((sum, day) => sum + SCHOOL_DAY_CAPACITY[day], 0);
    const [peakDay, peakLoad] = Object.entries(dailyLoads)
      .sort((left, right) => right[1] - left[1])[0] || ["-", 0];
    const utilization = capacity > 0 ? total / capacity : 0;
    const overloaded = total > capacity || peakLoad >= 5 || utilization >= 0.85;

    return {
      teacherId: bucket.teacherId,
      teacherName: bucket.teacherName,
      availableDays: capacityDays,
      dailyLoads,
      total,
      capacity,
      utilization,
      peakDay,
      peakLoad,
      overloaded,
    };
  }).sort((left, right) =>
    Number(right.overloaded) - Number(left.overloaded) ||
    right.utilization - left.utilization ||
    right.total - left.total ||
    left.teacherName.localeCompare(right.teacherName)
  );
}

function buildBalanceRecommendations(version, teacherLoads) {
  if (!version) return [];
  const recommendations = [];

  teacherLoads.forEach((teacher) => {
    const availableLoads = teacher.availableDays.map((day) => ({
      day,
      load: teacher.dailyLoads[day] || 0,
    })).sort((left, right) => right.load - left.load);
    const heaviest = availableLoads[0];
    const lightest = availableLoads[availableLoads.length - 1];
    if (!heaviest || !lightest) return;

    if (teacher.availableDays.length === 1 && teacher.utilization >= 0.8) {
      recommendations.push({
        key: `teacher-day-${teacher.teacherId}`,
        title: teacher.teacherName,
        detail: `${teacher.total} of ${teacher.capacity} available teaching blocks are used on ${heaviest.day}. Add another available day or hand over one assignment before the load grows.`,
        priority: teacher.utilization + 1,
      });
      return;
    }

    const spread = heaviest.load - lightest.load;
    if (spread >= 2 && heaviest.load >= 3) {
      recommendations.push({
        key: `teacher-spread-${teacher.teacherId}`,
        title: teacher.teacherName,
        detail: `${heaviest.day} has ${heaviest.load} teaching blocks while ${lightest.day} has ${lightest.load}. Test moving one unlocked ordinary lesson to ${lightest.day}.`,
        priority: spread + teacher.utilization,
      });
    }
  });

  const streamLoads = new Map();
  (version.events || [])
    .filter((event) => ["lesson", "cluster", "project"].includes(event.eventType))
    .forEach((event) => {
      const key = `${event.classLevel}::${event.stream}`;
      if (!streamLoads.has(key)) {
        streamLoads.set(key, Object.fromEntries(DAYS.map((day) => [day, new Set()])));
      }
      streamLoads.get(key)[event.day]?.add(event.slotCode);
    });

  streamLoads.forEach((loads, streamKey) => {
    const ordered = DAYS.map((day) => ({ day, load: loads[day].size }))
      .sort((left, right) => right.load - left.load);
    const heaviest = ordered[0];
    const lightest = ordered[ordered.length - 1];
    if (heaviest.load - lightest.load < 3) return;
    recommendations.push({
      key: `stream-${streamKey}`,
      title: streamLabel(streamKey),
      detail: `${heaviest.day} carries ${heaviest.load} lessons while ${lightest.day} carries ${lightest.load}. Review an unlocked ordinary lesson for a safer day-to-day spread.`,
      priority: heaviest.load - lightest.load,
    });
  });

  return recommendations
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 10);
}

function buildConflictForecast(setup, version, teacherLoads) {
  const risks = readinessBlockerItems(setup?.readiness).map((blocker) => ({
    key: `setup-${blocker.key}`,
    title: blocker.title,
    detail: blocker.detail,
    level: "High risk",
  }));

  (version?.validation?.unallocated || []).slice(0, 8).forEach((item, index) => {
    risks.push({
      key: `unallocated-${item.assignmentId || index}`,
      title: `${item.subject || "Scheduling block"}${item.classLevel ? ` / ${item.classLevel} ${item.stream || ""}` : ""}`,
      detail: item.reason || "This lesson could not be placed in the selected draft.",
      level: "High risk",
    });
  });

  teacherLoads.filter((teacher) => teacher.overloaded).slice(0, 6).forEach((teacher) => {
    risks.push({
      key: `capacity-${teacher.teacherId}`,
      title: teacher.teacherName,
      detail: `${teacher.total}/${teacher.capacity} available teaching blocks are occupied, peaking at ${teacher.peakLoad} on ${teacher.peakDay}. Future moves are likely to run out of space.`,
      level: teacher.total > teacher.capacity ? "High risk" : "Moderate risk",
    });
  });

  if (version) {
    const schedulableEvents = (version.events || []).filter((event) =>
      ["lesson", "cluster", "project"].includes(event.eventType)
    );
    const lockedCount = schedulableEvents.filter((event) => event.isLocked).length;
    if (schedulableEvents.length > 0 && lockedCount / schedulableEvents.length >= 0.6) {
      risks.push({
        key: "locked-density",
        title: "Limited regeneration room",
        detail: `${lockedCount} of ${schedulableEvents.length} scheduled lessons are locked. Further regeneration may have too little room to resolve new constraints.`,
        level: "Moderate risk",
      });
    }
  }

  return risks.slice(0, 14);
}

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

function StatusPill({ value }) {
  const normalized = String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return <span className={`tt-status tt-status-${normalized}`}>{String(value || "Unknown").replace(/_/g, " ")}</span>;
}

function EmptyState({ title, detail }) {
  return (
    <div className="tt-empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export default function TimetableDashboard() {
  const [activeModule, setActiveModule] = useState("overview");
  const [setup, setSetup] = useState(null);
  const [availabilityDrafts, setAvailabilityDrafts] = useState({});
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const selectedVersionRef = useRef("");
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [availabilityConfirmation, setAvailabilityConfirmation] = useState(null);
  const availabilityConfirmationTimerRef = useRef(null);
  const [generationConfirmation, setGenerationConfirmation] = useState(null);
  const generationConfirmationTimerRef = useRef(null);
  const availabilityTableRef = useRef(null);
  const availabilityRowRefs = useRef(new Map());
  const [draftName, setDraftName] = useState("");
  const [classFilter, setClassFilter] = useState("All");
  const [viewMode, setViewMode] = useState("stream");
  const [viewTarget, setViewTarget] = useState(STREAMS[0]);
  const [masterDay, setMasterDay] = useState("Monday");
  const [controlEventId, setControlEventId] = useState("");
  const [moveDay, setMoveDay] = useState("Monday");
  const [moveSlot, setMoveSlot] = useState("P1");
  const [swapFirstId, setSwapFirstId] = useState("");
  const [swapSecondId, setSwapSecondId] = useState("");
  const [adviserFocus, setAdviserFocus] = useState("best");

  const timetableAdvice = useMemo(() => {
    const bestVersion = suggestBestVersion(setup?.versions || []);
    const teacherLoads = buildTeacherLoadAnalysis(version, setup?.teachers || []);
    const overloadedTeachers = teacherLoads.filter((teacher) => teacher.overloaded);
    const balanceRecommendations = buildBalanceRecommendations(version, teacherLoads);
    const conflictRisks = buildConflictForecast(setup, version, teacherLoads);
    return {
      bestVersion,
      bestQuality: bestVersion ? versionQuality(bestVersion) : null,
      teacherLoads,
      overloadedTeachers,
      balanceRecommendations,
      conflictRisks,
      conflictLevel: conflictRisks.some((risk) => risk.level === "High risk")
        ? "High risk"
        : conflictRisks.length > 0
          ? "Moderate risk"
          : "Low risk",
    };
  }, [setup, version]);

  const loadVersion = useCallback(async (versionId) => {
    if (!versionId) {
      setVersion(null);
      return null;
    }
    const detail = await adminFetch(`/api/admin/timetable/versions/${versionId}`);
    setVersion(detail);
    return detail;
  }, []);

  const loadSetup = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const data = await adminFetch("/api/admin/timetable/setup");
      setSetup(data);
      setAvailabilityDrafts(
        Object.fromEntries(data.teachers.map((teacher) => [teacher.teacherId, teacher.availableDays]))
      );
      const preferredId = selectedVersionRef.current || String(data.versions[0]?.id || "");
      if (preferredId) {
        selectedVersionRef.current = preferredId;
        setSelectedVersionId(preferredId);
        await loadVersion(preferredId);
      } else {
        setVersion(null);
      }
    } catch (loadError) {
      setError(loadError.message || "Failed to load timetable setup.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [loadVersion]);

  useEffect(() => {
    loadSetup();
  }, [loadSetup]);

  useEffect(() => () => {
    if (availabilityConfirmationTimerRef.current) {
      window.clearTimeout(availabilityConfirmationTimerRef.current);
    }
    if (generationConfirmationTimerRef.current) {
      window.clearTimeout(generationConfirmationTimerRef.current);
    }
  }, []);

  const chooseVersion = async (value) => {
    setSelectedVersionId(value);
    selectedVersionRef.current = value;
    setError("");
    try {
      await loadVersion(value);
    } catch (loadError) {
      setError(loadError.message || "Failed to load timetable version.");
    }
  };

  const toggleAvailabilityDay = (teacherId, day) => {
    setAvailabilityDrafts((current) => {
      const existing = current[teacherId] || [];
      const next = existing.includes(day)
        ? existing.filter((value) => value !== day)
        : [...existing, day];
      return { ...current, [teacherId]: next };
    });
  };

  const saveAvailability = async (teacher) => {
    const teacherKey = String(teacher.teacherId);
    const savedDays = [...(availabilityDrafts[teacher.teacherId] || [])];
    const table = availabilityTableRef.current;
    const row = availabilityRowRefs.current.get(teacherKey);
    const position = {
      pageX: window.scrollX,
      pageY: window.scrollY,
      rowTop: row?.getBoundingClientRect().top ?? null,
      tableScrollLeft: table?.scrollLeft ?? 0,
    };

    setBusyKey(`teacher-${teacher.teacherId}`);
    setError("");
    try {
      await adminFetch(`/api/admin/timetable/teachers/${teacher.teacherId}/availability`, {
        method: "PUT",
        body: { days: savedDays },
      });
      await loadSetup({ showLoading: false });

      if (availabilityConfirmationTimerRef.current) {
        window.clearTimeout(availabilityConfirmationTimerRef.current);
      }
      setAvailabilityConfirmation({
        teacherId: teacher.teacherId,
        teacherName: teacher.teacherName,
        days: savedDays,
      });
      availabilityConfirmationTimerRef.current = window.setTimeout(() => {
        setAvailabilityConfirmation(null);
        availabilityConfirmationTimerRef.current = null;
      }, 5000);

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const refreshedTable = availabilityTableRef.current;
          const refreshedRow = availabilityRowRefs.current.get(teacherKey);
          if (refreshedTable) refreshedTable.scrollLeft = position.tableScrollLeft;
          if (refreshedRow && position.rowTop !== null) {
            window.scrollBy(0, refreshedRow.getBoundingClientRect().top - position.rowTop);
          } else {
            window.scrollTo(position.pageX, position.pageY);
          }
        });
      });
    } catch (saveError) {
      setError(saveError.message || "Failed to save availability.");
    } finally {
      setBusyKey("");
    }
  };

  const updateAssignmentDraft = (assignmentId, field, value) => {
    setSetup((current) => ({
      ...current,
      assignments: current.assignments.map((assignment) =>
        assignment.assignmentId === assignmentId ? { ...assignment, [field]: value } : assignment
      ),
    }));
  };

  const saveRequirement = async (assignment) => {
    setBusyKey(`assignment-${assignment.assignmentId}`);
    setError("");
    try {
      await adminFetch(`/api/admin/timetable/requirements/${assignment.assignmentId}`, {
        method: "PUT",
        body: {
          lessonsPerWeek: Number(assignment.lessonsPerWeek),
          lessonKind: assignment.lessonKind,
          clusterCode: assignment.clusterCode,
          enabled: assignment.enabled,
        },
      });
      setNotice(`${assignment.subject} rule saved for ${assignment.classLevel} ${assignment.stream}.`);
      await loadSetup();
    } catch (saveError) {
      setError(saveError.message || "Failed to save lesson rule.");
    } finally {
      setBusyKey("");
    }
  };

  const generateDraft = async () => {
    if (availabilityConfirmationTimerRef.current) {
      window.clearTimeout(availabilityConfirmationTimerRef.current);
      availabilityConfirmationTimerRef.current = null;
    }
    if (generationConfirmationTimerRef.current) {
      window.clearTimeout(generationConfirmationTimerRef.current);
      generationConfirmationTimerRef.current = null;
    }
    setAvailabilityConfirmation(null);
    setGenerationConfirmation(null);
    setBusyKey("generate");
    setError("");
    setNotice("");
    try {
      const detail = await adminFetch("/api/admin/timetable/generate", {
        method: "POST",
        body: { name: draftName },
      });
      const versionId = String(detail.id);
      selectedVersionRef.current = versionId;
      setSelectedVersionId(versionId);
      setVersion(detail);
      setDraftName("");
      setSetup((current) => ({
        ...current,
        versions: [detail, ...(current?.versions || []).filter((item) => String(item.id) !== versionId)],
      }));
      if (generationConfirmationTimerRef.current) {
        window.clearTimeout(generationConfirmationTimerRef.current);
      }
      setGenerationConfirmation({ name: detail.name, createdAt: detail.createdAt });
      generationConfirmationTimerRef.current = window.setTimeout(() => {
        setGenerationConfirmation(null);
        generationConfirmationTimerRef.current = null;
      }, 5000);
    } catch (generateError) {
      if (generateError?.body?.readiness) {
        setSetup((current) => current
          ? { ...current, readiness: generateError.body.readiness }
          : current
        );
      }
      setError(generateError.message || "Failed to generate timetable.");
    } finally {
      setBusyKey("");
    }
  };

  const updateVersionStatus = async (status) => {
    if (!version) return;
    setBusyKey(`status-${status}`);
    setError("");
    try {
      const updated = await adminFetch(`/api/admin/timetable/versions/${version.id}/status`, {
        method: "PATCH",
        body: { status },
      });
      setVersion(updated);
      setNotice(`${updated.name} is now ${status}.`);
      const versions = await adminFetch("/api/admin/timetable/versions");
      setSetup((current) => ({ ...current, versions }));
    } catch (statusError) {
      setError(statusError.message || "Failed to update timetable status.");
    } finally {
      setBusyKey("");
    }
  };

  const toggleEventLock = async (event) => {
    if (!version || !event) return;
    setBusyKey(`lock-${event.id}`);
    setError("");
    try {
      await adminFetch(`/api/admin/timetable/versions/${version.id}/events/${event.id}/lock`, {
        method: "PATCH",
        body: { locked: !event.isLocked },
      });
      await loadVersion(version.id);
      setNotice(`${event.subjectLabel} ${event.isLocked ? "unlocked" : "locked"}.`);
    } catch (lockError) {
      setError(lockError.message || "Failed to update lesson lock.");
    } finally {
      setBusyKey("");
    }
  };

  const moveEvent = async () => {
    if (!version || !controlEventId) return;
    setBusyKey("move");
    setError("");
    try {
      const updated = await adminFetch(
        `/api/admin/timetable/versions/${version.id}/events/${controlEventId}/move`,
        { method: "POST", body: { day: moveDay, slotCode: moveSlot } }
      );
      setVersion(updated);
      setNotice("Lesson moved and revalidated against hard constraints.");
    } catch (moveError) {
      setError(moveError.message || "Failed to move lesson.");
    } finally {
      setBusyKey("");
    }
  };

  const swapEvents = async () => {
    if (!version || !swapFirstId || !swapSecondId) return;
    setBusyKey("swap");
    setError("");
    try {
      const updated = await adminFetch(`/api/admin/timetable/versions/${version.id}/swap`, {
        method: "POST",
        body: { firstEventId: Number(swapFirstId), secondEventId: Number(swapSecondId) },
      });
      setVersion(updated);
      setNotice("Lessons swapped without creating a stream or teacher clash.");
    } catch (swapError) {
      setError(swapError.message || "Failed to swap lessons.");
    } finally {
      setBusyKey("");
    }
  };

  const pinTeacher = async (teacherId, pinned) => {
    if (!version || !teacherId) return;
    setBusyKey("pin-teacher");
    setError("");
    try {
      const updated = await adminFetch(
        `/api/admin/timetable/versions/${version.id}/teachers/${teacherId}/pin`,
        { method: "PATCH", body: { pinned } }
      );
      setVersion(updated);
      setNotice(`Teacher timetable ${pinned ? "pinned" : "unpinned"}.`);
    } catch (pinError) {
      setError(pinError.message || "Failed to update teacher pinning.");
    } finally {
      setBusyKey("");
    }
  };

  const undoLastAction = async () => {
    if (!version) return;
    setBusyKey("undo");
    setError("");
    try {
      const updated = await adminFetch(`/api/admin/timetable/versions/${version.id}/undo`, {
        method: "POST",
      });
      setVersion(updated);
      setNotice("Last timetable action undone.");
      const versions = await adminFetch("/api/admin/timetable/versions");
      setSetup((current) => ({ ...current, versions }));
    } catch (undoError) {
      setError(undoError.message || "Failed to undo the last action.");
    } finally {
      setBusyKey("");
    }
  };

  const regenerateSelectedStream = async () => {
    if (!version || viewMode !== "stream") return;
    const [classLevel, stream] = viewTarget.split("::");
    setBusyKey("regenerate-stream");
    setError("");
    try {
      const updated = await adminFetch(
        `/api/admin/timetable/versions/${version.id}/regenerate-stream`,
        { method: "POST", body: { classLevel, stream } }
      );
      const versionId = String(updated.id);
      selectedVersionRef.current = versionId;
      setSelectedVersionId(versionId);
      setVersion(updated);
      setNotice(`${classLevel} ${stream} regenerated in a new draft; the source version is unchanged.`);
      const versions = await adminFetch("/api/admin/timetable/versions");
      setSetup((current) => ({ ...current, versions }));
    } catch (regenerateError) {
      setError(regenerateError.message || "Failed to regenerate the selected stream.");
    } finally {
      setBusyKey("");
    }
  };

  const filteredAssignments = useMemo(() => {
    const aLevelGroups = new Map();
    (setup?.aLevelAssignments || []).forEach((assignment) => {
      const subjectKey = assignment.subjectKey || String(assignment.subject || "").toLowerCase();
      const key = `${assignment.classLevel}::${assignment.stream}::${subjectKey}`;
      if (!aLevelGroups.has(key)) {
        aLevelGroups.set(key, {
          ...assignment,
          assignmentId: key,
          teacherNames: new Set(),
        });
      }
      aLevelGroups.get(key).teacherNames.add(assignment.teacherName);
    });
    const aLevelRows = Array.from(aLevelGroups.values(), (assignment) => ({
      ...assignment,
      teacherName: Array.from(assignment.teacherNames).sort().join(" / "),
      teacherNames: undefined,
    }));
    const rows = [...(setup?.assignments || []), ...aLevelRows];
    return classFilter === "All" ? rows : rows.filter((row) => row.classLevel === classFilter);
  }, [classFilter, setup]);

  const teacherOptions = useMemo(() => {
    if (!version) return [];
    const map = new Map();
    version.sessions.forEach((session) => map.set(session.teacherId, session.teacherName));
    return Array.from(map, ([id, name]) => ({ id, name })).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }, [version]);

  const subjectOptions = useMemo(() => {
    if (!version) return [];
    return [...new Set(version.sessions.map((session) => session.subjectLabel))].sort((left, right) =>
      left.localeCompare(right)
    );
  }, [version]);

  useEffect(() => {
    if (viewMode === "teacher" && teacherOptions.length > 0) {
      const currentExists = teacherOptions.some((teacher) => String(teacher.id) === String(viewTarget));
      if (!currentExists) setViewTarget(String(teacherOptions[0].id));
    }
    if (viewMode === "stream" && !STREAMS.includes(viewTarget)) setViewTarget(STREAMS[0]);
    if (viewMode === "class" && !CLASS_LEVELS.includes(viewTarget)) setViewTarget("S1");
    if (viewMode === "department" && subjectOptions.length > 0 && !subjectOptions.includes(viewTarget)) {
      setViewTarget(subjectOptions[0]);
    }
  }, [subjectOptions, teacherOptions, viewMode, viewTarget]);

  const getStreamCell = (day, column, streamKeyValue = viewTarget) => {
    if (!version) return "";
    const [classLevel, stream] = streamKeyValue.split("::");
    const slots = column === "MIDDAY"
      ? day === "Friday" ? ["P3A", "CHURCH"] : ["P3"]
      : [column];
    const matches = version.events.filter(
      (event) => event.classLevel === classLevel && event.stream === stream &&
        event.day === day && slots.includes(event.slotCode)
    );
    return matches.map((event) =>
      `${event.subjectLabel}${event.teacherName ? ` (${event.teacherName})` : ""}`
    ).join(" / ");
  };

  const getTeacherCell = (day, column) => {
    if (!version) return "";
    if (day === "Monday" && column === "P2") return "Assembly";
    if (day === "Friday" && column === "MIDDAY") {
      const shortSession = version.sessions.find(
        (session) => String(session.teacherId) === String(viewTarget) &&
          session.day === day && session.slotCode === "P3A"
      );
      return shortSession
        ? `${shortSession.subjectLabel} - ${shortSession.classLevel} ${shortSession.streamsLabel} / Church`
        : "Church";
    }
    const slots = column === "MIDDAY" ? ["P3"] : [column];
    return version.sessions
      .filter((session) => String(session.teacherId) === String(viewTarget) &&
        session.day === day && slots.includes(session.slotCode))
      .map((session) => `${session.subjectLabel} - ${session.classLevel} ${session.streamsLabel}`)
      .join(" / ");
  };

  const exportMatrix = () => {
    if (!version) return { title: "Timetable", head: [], body: [], format: "a4" };
    if (viewMode === "master") {
      return {
        title: `${version.name} - School Master - ${masterDay}`,
        head: ["Period", ...STREAMS.map(streamLabel)],
        body: GRID_COLUMNS.map((column) => [
          column === "MIDDAY" ? "Midday" : column,
          ...STREAMS.map((stream) => getStreamCell(masterDay, column, stream)),
        ]),
        format: "a3",
      };
    }
    if (viewMode === "class") {
      const streams = classStreams(viewTarget);
      return {
        title: `${version.name} - ${viewTarget} Class Timetable`,
        head: ["Day", "Period", ...streams],
        body: DAYS.flatMap((day) => GRID_COLUMNS.map((column) => [
          day,
          column === "MIDDAY" ? "Midday" : column,
          ...streams.map((stream) => getStreamCell(day, column, `${viewTarget}::${stream}`)),
        ])),
        format: "a4",
      };
    }
    if (viewMode === "department") {
      const slotOrder = ["P1", "P2", "P3", "P3A", "P4", "P5"];
      const sessions = version.sessions
        .filter((session) => session.subjectLabel === viewTarget)
        .sort((left, right) =>
          DAYS.indexOf(left.day) - DAYS.indexOf(right.day) ||
          slotOrder.indexOf(left.slotCode) - slotOrder.indexOf(right.slotCode)
        );
      return {
        title: `${version.name} - ${viewTarget} Department Timetable`,
        head: ["Day", "Period", "Class", "Stream", "Teacher"],
        body: sessions.map((session) => [
          session.day,
          session.slotCode,
          session.classLevel,
          session.streamsLabel,
          session.teacherName,
        ]),
        format: "a4",
      };
    }
    const title = viewMode === "teacher"
      ? `${version.name} - ${teacherOptions.find((teacher) => String(teacher.id) === String(viewTarget))?.name || "Teacher"}`
      : `${version.name} - ${streamLabel(viewTarget)}`;
    return {
      title,
      head: ["Day", "P1", "P2", "Midday", "P4", "P5"],
      body: DAYS.map((day) => [
        day,
        ...GRID_COLUMNS.map((column) => viewMode === "teacher"
          ? getTeacherCell(day, column)
          : getStreamCell(day, column)),
      ]),
      format: "a4",
    };
  };

  const exportCsv = () => {
    const matrix = exportMatrix();
    const csv = [matrix.head, ...matrix.body].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${matrix.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    setBusyKey("pdf");
    try {
      await openTimetablePdfPreview({
        version,
        viewMode,
        viewTarget,
        teacherOptions,
        currentTerm: setup?.currentTerm,
      });
    } catch (pdfError) {
      setError(pdfError.message || "Failed to create timetable PDF.");
    } finally {
      setBusyKey("");
    }
  };

  const renderOverview = () => {
    const readiness = setup?.readiness;
    return (
      <section className="tt-page-section">
        <div className="tt-section-heading">
          <div>
            <span className="tt-kicker">Whole school S1-S6</span>
            <h2>Timetable Control Room</h2>
            <p>Academic year {setup?.academicYear || "-"}</p>
          </div>
          <StatusPill value={readiness?.ready ? "Ready to generate" : "Setup required"} />
        </div>
        <div className="tt-metric-grid">
          <article><span>Streams</span><strong>12</strong><small>O-Level and A-Level</small></article>
          <article>
            <span>Teachers ready</span>
            <strong>{readiness?.configuredTeachers || 0}/{readiness?.teachers || 0}</strong>
            <small>
              {(readiness?.availabilityExemptTeachers?.length || 0) > 0
                ? `${readiness.availabilityExemptTeachers.length} weekend Paper 2 teacher${readiness.availabilityExemptTeachers.length === 1 ? "" : "s"} outside weekday grid`
                : "1-3 available days"}
            </small>
          </article>
          <article><span>Rules ready</span><strong>{readiness?.configuredAssignments || 0}/{readiness?.assignments || 0}</strong><small>Active assignments</small></article>
          <article><span>Drafts</span><strong>{setup?.versions?.length || 0}</strong><small>Versioned safely</small></article>
        </div>
        <div className="tt-overview-columns">
          <div className="tt-panel-band">
            <div className="tt-panel-title"><h3>Setup checks</h3><span>{readiness?.ready ? "Complete" : "Attention"}</span></div>
            {(readiness?.teachersNeedingAvailability?.length || 0) === 0 &&
             (readiness?.reviewAssignments?.length || 0) === 0 &&
             (readiness?.aLevelCoverageIssues?.length || 0) === 0 &&
             (readiness?.aLevelPaperIssues?.length || 0) === 0 ? (
              <div className="tt-check-row is-good"><strong>All generation inputs are configured</strong><span>Hard constraints can be evaluated.</span></div>
            ) : (
              <>
                <div className="tt-check-row">
                  <strong>{readiness?.teachersNeedingAvailability?.length || 0} teachers need availability</strong>
                  <button type="button" onClick={() => setActiveModule("constraints")}>Open constraints</button>
                </div>
                <div className="tt-check-row">
                  <strong>{readiness?.reviewAssignments?.length || 0} assignments need review</strong>
                  <button type="button" onClick={() => setActiveModule("constraints")}>Review rules</button>
                </div>
                <div className="tt-check-row">
                  <span className="tt-check-copy">
                    <strong>{readiness?.aLevelCoverageIssues?.length || 0} A-Level subject groups are missing</strong>
                    {(readiness?.aLevelCoverageIssues?.length || 0) > 0 ? (
                      <small>{readiness.aLevelCoverageIssues.map((issue) =>
                        `${issue.classLevel} ${issue.stream}: ${issue.subjectGroup}`
                      ).join("; ")}</small>
                    ) : null}
                  </span>
                  <button type="button" onClick={() => setActiveModule("constraints")}>View coverage</button>
                </div>
                <div className="tt-check-row">
                  <strong>{readiness?.aLevelPaperIssues?.length || 0} A-Level paper assignments need attention</strong>
                  <button type="button" onClick={() => setActiveModule("constraints")}>Review papers</button>
                </div>
              </>
            )}
          </div>
          <div className="tt-panel-band">
            <div className="tt-panel-title"><h3>Recent versions</h3><span>{setup?.versions?.length || 0}</span></div>
            {(setup?.versions || []).slice(0, 4).map((item) => (
              <button className="tt-version-row" type="button" key={item.id} onClick={() => {
                chooseVersion(String(item.id));
                setActiveModule("timetables");
              }}>
                <span><strong>{item.name}</strong><small>{formatDate(item.createdAt)}</small></span>
                <StatusPill value={item.status} />
              </button>
            ))}
            {(setup?.versions?.length || 0) === 0 ? <EmptyState title="No drafts yet" detail="Setup must be complete before generation." /> : null}
          </div>
        </div>
      </section>
    );
  };

  const renderWeek = () => {
    const standardSlots = setup?.config?.slots || [];
    const fridaySlots = setup?.config?.fridaySlots || [];
    return (
      <section className="tt-page-section">
        <div className="tt-section-heading">
          <div><span className="tt-kicker">Locked school structure</span><h2>School Week</h2><p>Monday to Friday</p></div>
          <StatusPill value="Configured" />
        </div>
        <div className="tt-week-table-wrap">
          <table className="tt-data-table tt-week-table">
            <thead><tr><th>Day</th><th>08:00</th><th>09:20</th><th>10:40</th><th>11:20</th><th>12:00</th><th>13:20</th><th>14:20</th><th>15:40</th></tr></thead>
            <tbody>
              <tr><th>Monday</th><td>P1</td><td className="is-reserved">Assembly</td><td className="is-break">Break</td><td colSpan="2" className="is-block">Quadruple P3</td><td className="is-break">Lunch</td><td>P4</td><td>P5</td></tr>
              {["Tuesday", "Wednesday", "Thursday"].map((day) => <tr key={day}><th>{day}</th><td>P1</td><td>P2</td><td className="is-break">Break</td><td colSpan="2" className="is-block">Quadruple P3</td><td className="is-break">Lunch</td><td>P4</td><td>P5</td></tr>)}
              <tr><th>Friday</th><td>P1</td><td>P2</td><td className="is-break">Break</td><td>Short lesson</td><td className="is-reserved">Church</td><td className="is-break">Lunch</td><td>S2 Project / P4</td><td>S1 Project / P5</td></tr>
            </tbody>
          </table>
        </div>
        <div className="tt-rule-strip">
          <span><strong>{standardSlots.length}</strong> standard bands</span>
          <span><strong>{fridaySlots.length}</strong> Friday bands</span>
          <span><strong>120 min</strong> cluster block</span>
          <span><strong>40 min</strong> Friday short lesson</span>
        </div>
      </section>
    );
  };

  const renderConstraints = () => (
    <section className="tt-page-section">
      <div className="tt-section-heading">
        <div><span className="tt-kicker">Sacred inputs</span><h2>Scheduling Constraints</h2><p>Existing assignments remain read-only</p></div>
        <StatusPill value={setup?.readiness?.ready ? "Ready" : "Setup required"} />
      </div>
      <div className="tt-panel-band">
        <div className="tt-panel-title"><h3>Teacher availability</h3><span>Choose 1-3 days for weekday teachers</span></div>
        <div className="tt-table-scroll" ref={availabilityTableRef}>
          <table className="tt-data-table">
            <thead><tr><th>Teacher</th><th>Assignments</th><th>Available days</th><th>Action</th></tr></thead>
            <tbody>{(setup?.teachers || []).map((teacher) => {
              const availabilityExempt = teacher.availabilityRequired === false;
              return (
                <tr
                  key={teacher.teacherId}
                  ref={(node) => {
                    const key = String(teacher.teacherId);
                    if (node) availabilityRowRefs.current.set(key, node);
                    else availabilityRowRefs.current.delete(key);
                  }}
                >
                  <td>
                    <strong>{teacher.teacherName}</strong>
                    {availabilityExempt ? <small className="tt-teacher-schedule-note">Weekend practicals only</small> : null}
                  </td>
                  <td>{teacher.assignmentCount}</td>
                  <td>{availabilityExempt ? (
                    <span className="tt-availability-exempt">
                      <strong>Not required</strong>
                      <small>{teacher.availabilityExemptReason}</small>
                    </span>
                  ) : <div className="tt-day-picker">{DAYS.map((day) => (
                    <button
                      type="button"
                      key={day}
                      className={(availabilityDrafts[teacher.teacherId] || []).includes(day) ? "is-selected" : ""}
                      onClick={() => toggleAvailabilityDay(teacher.teacherId, day)}
                    >{day.slice(0, 3)}</button>
                  ))}</div>}</td>
                  <td>{availabilityExempt ? (
                    <span className="tt-status tt-status-complete">Outside weekday grid</span>
                  ) : (
                    <button type="button" className={`tt-action-button${String(availabilityConfirmation?.teacherId) === String(teacher.teacherId) ? " is-saved" : ""}`} disabled={busyKey === `teacher-${teacher.teacherId}`} onClick={() => saveAvailability(teacher)}>{busyKey === `teacher-${teacher.teacherId}` ? "Saving" : String(availabilityConfirmation?.teacherId) === String(teacher.teacherId) ? "Saved" : "Save"}</button>
                  )}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>
      {(setup?.readiness?.aLevelCoverageIssues?.length || 0) > 0 ? (
        <div className="tt-panel-band">
          <div className="tt-panel-title"><h3>A-Level assignment coverage</h3><span>{setup.readiness.aLevelCoverageIssues.length} missing</span></div>
          <div className="tt-issue-list">
            {setup.readiness.aLevelCoverageIssues.map((issue) => (
              <div key={`${issue.classLevel}-${issue.stream}-${issue.subjectGroup}`}>
                <strong>{issue.classLevel} {issue.stream}</strong>
                <span>Assign {issue.subjectGroup} before generating the school timetable.</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {(setup?.readiness?.aLevelPaperIssues?.length || 0) > 0 ? (
        <div className="tt-panel-band">
          <div className="tt-panel-title"><h3>A-Level paper staffing</h3><span>{setup.readiness.aLevelPaperIssues.length} need attention</span></div>
          <div className="tt-issue-list">
            {setup.readiness.aLevelPaperIssues.map((issue) => (
              <div key={`${issue.classLevel}-${issue.stream}-${issue.subjectGroup}`}>
                <strong>{issue.classLevel} {issue.stream}</strong>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="tt-panel-band">
        <div className="tt-panel-title tt-panel-title-actions">
          <div><h3>Lesson requirements</h3><span>Cluster counts represent weekly two-hour blocks</span></div>
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} aria-label="Filter class">
            <option>All</option>{CLASS_LEVELS.map((classLevel) => <option key={classLevel}>{classLevel}</option>)}
          </select>
        </div>
        <div className="tt-table-scroll">
          <table className="tt-data-table tt-requirements-table">
            <thead><tr><th>Class</th><th>Subject</th><th>Teacher</th><th>Type</th><th>Cluster</th><th>Weekly</th><th>Use</th><th>Action</th></tr></thead>
            <tbody>{filteredAssignments.map((assignment) => (
              <tr key={`${assignment.scope || "olevel"}-${assignment.assignmentId}`} className={assignment.lessonKind === "review" ? "needs-review" : ""}>
                <td><strong>{assignment.classLevel} {assignment.stream}</strong></td>
                <td>{assignment.subject}</td>
                <td>{assignment.teacherName}</td>
                {assignment.scope === "alevel" ? (
                  <>
                    <td><span className="tt-status tt-status-configured">A-Level</span></td>
                    <td>{aLevelRuleLabel(assignment.subject)}</td>
                    <td><strong>2</strong></td>
                    <td><input type="checkbox" checked readOnly aria-label={`Use ${assignment.subject}`} /></td>
                    <td><span className="tt-status tt-status-configured">Automatic</span></td>
                  </>
                ) : (
                  <>
                    <td><select value={assignment.lessonKind} onChange={(event) => updateAssignmentDraft(assignment.assignmentId, "lessonKind", event.target.value)}><option value="ordinary">Ordinary</option><option value="cluster">Cluster block</option><option value="project">Project</option><option value="review">Needs review</option></select></td>
                    <td><select value={assignment.clusterCode || ""} disabled={assignment.lessonKind !== "cluster"} onChange={(event) => updateAssignmentDraft(assignment.assignmentId, "clusterCode", event.target.value)}><option value="">None</option><option value="VOCATIONAL">Vocational</option><option value="OTHERS">Others</option></select></td>
                    <td><input type="number" min="0" max="5" value={assignment.lessonsPerWeek} onChange={(event) => updateAssignmentDraft(assignment.assignmentId, "lessonsPerWeek", Number(event.target.value))} /></td>
                    <td><input type="checkbox" checked={assignment.enabled} onChange={(event) => updateAssignmentDraft(assignment.assignmentId, "enabled", event.target.checked)} aria-label={`Use ${assignment.subject}`} /></td>
                    <td><button type="button" className="tt-action-button" disabled={busyKey === `assignment-${assignment.assignmentId}`} onClick={() => saveRequirement(assignment)}>{busyKey === `assignment-${assignment.assignmentId}` ? "Saving" : "Save"}</button></td>
                  </>
                )}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </section>
  );

  const renderGenerate = () => {
    const readiness = setup?.readiness;
    const exactBlockers = readinessBlockerItems(readiness);
    const latestDraft = setup?.versions?.[0] || null;
    return (
      <section className="tt-page-section">
        <div className="tt-section-heading">
          <div><span className="tt-kicker">Constraint-aware engine</span><h2>Generate Draft</h2><p>Hard conflicts are never written</p></div>
          <StatusPill value={readiness?.ready ? "Ready" : "Blocked"} />
        </div>
        <div className="tt-generator-layout">
          <div className="tt-generate-command">
            <label htmlFor="tt-draft-name">Draft name</label>
            <input id="tt-draft-name" value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder={`School timetable ${setup?.academicYear || ""}`} />
            <button type="button" className="tt-primary-command" onClick={generateDraft} disabled={!readiness?.ready || busyKey === "generate"}>{busyKey === "generate" ? "Generating draft" : "Generate conflict-free draft"}</button>
          </div>
          <div className="tt-generation-priorities">
            <h3>Priority order</h3>
            <ol><li>No clashes</li><li>Teacher availability</li><li>Required lessons</li><li>Balanced schedules</li><li>Teacher preferences</li></ol>
          </div>
        </div>
        {!readiness?.ready ? (
          <div className="tt-blocker-list">
            <div><strong>{readiness?.teachersNeedingAvailability?.length || 0}</strong><span>teachers need 1-3 available days</span></div>
            <div><strong>{readiness?.reviewAssignments?.length || 0}</strong><span>assignment rules need review</span></div>
            <div><strong>{readiness?.aLevelCoverageIssues?.length || 0}</strong><span>A-Level subject groups are missing</span></div>
            <div><strong>{readiness?.aLevelPaperIssues?.length || 0}</strong><span>A-Level paper assignments need attention</span></div>
            <button type="button" onClick={() => setActiveModule("constraints")}>Resolve constraints</button>
          </div>
        ) : null}
        {exactBlockers.length > 0 ? (
          <div className="tt-panel-band tt-generation-blocker-details">
            <div className="tt-panel-title">
              <h3>Exact blockers</h3>
              <span>{exactBlockers.length}</span>
            </div>
            <div className="tt-issue-list">
              {exactBlockers.map((blocker) => (
                <div key={blocker.key}>
                  <strong>{blocker.title}</strong>
                  <span>{blocker.detail}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="tt-panel-band tt-generation-log">
          <div className="tt-panel-title tt-panel-title-actions">
            <div>
              <h3>Latest generated draft</h3>
              <span>{latestDraft ? "Recorded" : "No drafts"}</span>
            </div>
            {latestDraft ? (
              <button type="button" className="tt-action-button" onClick={() => {
                chooseVersion(String(latestDraft.id));
                setActiveModule("timetables");
              }}>Open draft</button>
            ) : null}
          </div>
          {latestDraft ? (
            <dl className="tt-generation-log-grid">
              <div>
                <dt>Draft name</dt>
                <dd>{latestDraft.name}</dd>
              </div>
              <div>
                <dt>Generated</dt>
                <dd>{formatDate(latestDraft.createdAt)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd><StatusPill value={latestDraft.status} /></dd>
              </div>
            </dl>
          ) : (
            <div className="tt-generation-log-empty">The first generated draft will be recorded here.</div>
          )}
        </div>
      </section>
    );
  };

  const renderAdviser = () => {
    const {
      bestVersion,
      bestQuality,
      teacherLoads,
      overloadedTeachers,
      balanceRecommendations,
      conflictRisks,
      conflictLevel,
    } = timetableAdvice;
    const adviserTools = [
      {
        code: "best",
        title: "Suggest best timetable",
        detail: bestVersion
          ? `${bestVersion.name} leads the available drafts.`
          : "Generate a draft to receive a recommendation.",
        state: bestVersion ? "Ready" : "Waiting",
        command: "Show recommendation",
      },
      {
        code: "overload",
        title: "Detect overloaded teachers",
        detail: version
          ? `${overloadedTeachers.length} of ${teacherLoads.length} scheduled teachers need attention.`
          : "Select a timetable to inspect teacher capacity.",
        state: overloadedTeachers.length > 0 ? "Attention" : "Clear",
        command: "Review workload",
      },
      {
        code: "balance",
        title: "Recommend balancing",
        detail: version
          ? `${balanceRecommendations.length} practical balancing suggestion${balanceRecommendations.length === 1 ? "" : "s"}.`
          : "Select a timetable to compare daily loads.",
        state: balanceRecommendations.length > 0 ? "Review" : "Balanced",
        command: "Show recommendations",
      },
      {
        code: "conflicts",
        title: "Predict conflicts",
        detail: conflictRisks.length > 0
          ? `${conflictRisks.length} current or emerging scheduling risk${conflictRisks.length === 1 ? "" : "s"}.`
          : "No conflict pressure detected in the current data.",
        state: conflictLevel,
        command: "Run forecast",
      },
    ];
    const activeTool = adviserTools.find((tool) => tool.code === adviserFocus) || adviserTools[0];

    return (
      <section className="tt-page-section">
        <div className="tt-section-heading">
          <div>
            <span className="tt-kicker">Decision support</span>
            <h2>Timetable Adviser</h2>
            <p>Read-only analysis of generated drafts, workload pressure and likely clashes</p>
          </div>
          <StatusPill value={version ? "Analysis ready" : "Select draft"} />
        </div>

        <div className="tt-adviser-toolbar">
          <label htmlFor="tt-adviser-version">Timetable under analysis</label>
          <select
            id="tt-adviser-version"
            value={selectedVersionId}
            onChange={(event) => chooseVersion(event.target.value)}
          >
            <option value="">Select version</option>
            {(setup?.versions || []).map((item) => (
              <option key={item.id} value={item.id}>{item.name} / {item.status}</option>
            ))}
          </select>
          <span>{version ? `${version.stats?.lessonsPlaced || 0}/${version.stats?.lessonsRequested || 0} lessons placed` : "No timetable selected"}</span>
        </div>

        <div className="tt-adviser-tool-grid">
          {adviserTools.map((tool) => (
            <article key={tool.code} className={adviserFocus === tool.code ? "is-active" : ""}>
              <div className="tt-adviser-tool-head">
                <span>{tool.code === "best" ? "01" : tool.code === "overload" ? "02" : tool.code === "balance" ? "03" : "04"}</span>
                <StatusPill value={tool.state} />
              </div>
              <h3>{tool.title}</h3>
              <p>{tool.detail}</p>
              <button type="button" onClick={() => setAdviserFocus(tool.code)}>{tool.command}</button>
            </article>
          ))}
        </div>

        <div className="tt-panel-band tt-adviser-result">
          <div className="tt-panel-title">
            <h3>{activeTool.title}</h3>
            <span>{activeTool.state}</span>
          </div>

          {adviserFocus === "best" ? (
            bestVersion ? (
              <div className="tt-adviser-best">
                <div>
                  <span>Recommended draft</span>
                  <strong>{bestVersion.name}</strong>
                  <p>Chosen by hard-constraint validation first, then fewest unallocated lessons, highest completion and newest generation time.</p>
                </div>
                <dl>
                  <div><dt>Validation</dt><dd>{bestQuality.valid ? "Passed" : "Needs attention"}</dd></div>
                  <div><dt>Lessons</dt><dd>{bestQuality.placed}/{bestQuality.requested}</dd></div>
                  <div><dt>Unallocated</dt><dd>{bestQuality.unallocated}</dd></div>
                  <div><dt>Generated</dt><dd>{formatDate(bestVersion.createdAt)}</dd></div>
                </dl>
                <div className="tt-adviser-actions">
                  {String(bestVersion.id) !== String(selectedVersionId) ? (
                    <button type="button" onClick={() => chooseVersion(String(bestVersion.id))}>Use for analysis</button>
                  ) : null}
                  <button type="button" className="tt-primary-command" onClick={async () => {
                    await chooseVersion(String(bestVersion.id));
                    setActiveModule("timetables");
                  }}>Open recommended timetable</button>
                </div>
              </div>
            ) : <EmptyState title="No timetable to compare" detail="Generate at least one draft and the adviser will rank it automatically." />
          ) : null}

          {adviserFocus === "overload" ? (
            !version ? <EmptyState title="Select a timetable" detail="Teacher capacity is calculated from the chosen draft and saved available days." />
              : overloadedTeachers.length === 0
                ? <EmptyState title="No overloaded teachers detected" detail="Every scheduled teacher remains below the current capacity threshold." />
                : <div className="tt-adviser-list">{overloadedTeachers.map((teacher) => (
                    <div key={teacher.teacherId}>
                      <span>
                        <strong>{teacher.teacherName}</strong>
                        <small>{teacher.total}/{teacher.capacity || "?"} available blocks used; busiest on {teacher.peakDay} with {teacher.peakLoad}</small>
                      </span>
                      <StatusPill value={teacher.total > teacher.capacity ? "Over capacity" : `${Math.round(teacher.utilization * 100)}% used`} />
                    </div>
                  ))}</div>
          ) : null}

          {adviserFocus === "balance" ? (
            !version ? <EmptyState title="Select a timetable" detail="Balancing advice needs a generated schedule." />
              : balanceRecommendations.length === 0
                ? <EmptyState title="Daily loads look balanced" detail="No teacher or stream has a strong heavy-day to light-day imbalance." />
                : <div className="tt-adviser-list">{balanceRecommendations.map((item) => (
                    <div key={item.key}>
                      <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                      <StatusPill value="Recommendation" />
                    </div>
                  ))}</div>
          ) : null}

          {adviserFocus === "conflicts" ? (
            conflictRisks.length === 0
              ? <EmptyState title="Low conflict pressure" detail="The selected draft and current setup expose no immediate conflict risks." />
              : <div className="tt-adviser-list">{conflictRisks.map((risk) => (
                  <div key={risk.key}>
                    <span><strong>{risk.title}</strong><small>{risk.detail}</small></span>
                    <StatusPill value={risk.level} />
                  </div>
                ))}</div>
          ) : null}
        </div>
      </section>
    );
  };

  const renderTimetable = () => {
    const matrix = version ? exportMatrix() : null;
    const workloads = version
      ? Array.from(version.sessions.reduce((map, session) => {
          const current = map.get(session.teacherId) || { name: session.teacherName, periods: 0, days: new Set() };
          current.periods += 1;
          current.days.add(session.day);
          map.set(session.teacherId, current);
          return map;
        }, new Map()).values()).sort((left, right) => right.periods - left.periods)
      : [];
    const selectedTeacherId = viewMode === "teacher" ? Number(viewTarget) : 0;
    const selectedTeacherEvents = selectedTeacherId && version
      ? version.events.filter((event) =>
          !["assembly", "church", "project"].includes(event.eventType) &&
          version.sessions.some(
            (session) => session.teacherId === selectedTeacherId && session.eventId === event.id
          )
        )
      : [];
    const selectedTeacherPinned = selectedTeacherEvents.length > 0 && selectedTeacherEvents.every(
      (event) => event.isLocked
    );
    const controlEvents = !version ? [] : version.events
      .filter((event) => ["lesson", "cluster"].includes(event.eventType))
      .filter((event) => {
        if (viewMode === "stream") {
          const [classLevel, stream] = viewTarget.split("::");
          return event.classLevel === classLevel && event.stream === stream;
        }
        if (viewMode === "teacher") {
          return version.sessions.some(
            (session) => String(session.teacherId) === String(viewTarget) && session.eventId === event.id
          );
        }
        if (viewMode === "class") return event.classLevel === viewTarget;
        if (viewMode === "department") {
          return version.sessions.some(
            (session) => session.subjectLabel === viewTarget && session.eventId === event.id
          );
        }
        return event.day === masterDay;
      });
    const movableEvents = (version?.events || []).filter(
      (event) => event.eventType === "lesson" && !event.blockKey && !event.isLocked
    );
    const activeControlEvent = controlEvents.find((event) => String(event.id) === String(controlEventId));
    return (
      <section className="tt-page-section">
        <div className="tt-section-heading">
          <div><span className="tt-kicker">Versioned output</span><h2>Timetables</h2><p>{version ? `${version.academicYear} / ${formatDate(version.createdAt)}` : "No version selected"}</p></div>
          {version ? <StatusPill value={version.status} /> : null}
        </div>
        <div className="tt-output-toolbar">
          <select value={selectedVersionId} onChange={(event) => chooseVersion(event.target.value)} aria-label="Timetable version"><option value="">Select version</option>{(setup?.versions || []).map((item) => <option key={item.id} value={item.id}>{item.name} / {item.status}</option>)}</select>
          <div className="tt-segmented" aria-label="Timetable view"><button type="button" className={viewMode === "stream" ? "is-active" : ""} onClick={() => setViewMode("stream")}>Stream</button><button type="button" className={viewMode === "class" ? "is-active" : ""} onClick={() => setViewMode("class")}>Class</button><button type="button" className={viewMode === "teacher" ? "is-active" : ""} onClick={() => setViewMode("teacher")}>Teacher</button><button type="button" className={viewMode === "department" ? "is-active" : ""} onClick={() => setViewMode("department")}>Department</button><button type="button" className={viewMode === "master" ? "is-active" : ""} onClick={() => setViewMode("master")}>Master</button></div>
          {viewMode === "stream" ? <select value={viewTarget} onChange={(event) => setViewTarget(event.target.value)}>{STREAMS.map((stream) => <option key={stream} value={stream}>{streamLabel(stream)}</option>)}</select> : null}
          {viewMode === "class" ? <select value={viewTarget} onChange={(event) => setViewTarget(event.target.value)}>{CLASS_LEVELS.map((classLevel) => <option key={classLevel}>{classLevel}</option>)}</select> : null}
          {viewMode === "teacher" ? <select value={viewTarget} onChange={(event) => setViewTarget(event.target.value)}>{teacherOptions.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select> : null}
          {viewMode === "department" ? <select value={viewTarget} onChange={(event) => setViewTarget(event.target.value)}>{subjectOptions.map((subject) => <option key={subject}>{subject}</option>)}</select> : null}
          {viewMode === "master" ? <select value={masterDay} onChange={(event) => setMasterDay(event.target.value)}>{DAYS.map((day) => <option key={day}>{day}</option>)}</select> : null}
          <button type="button" onClick={exportCsv} disabled={!version}>Excel CSV</button>
          <button type="button" onClick={exportPdf} disabled={!version || busyKey === "pdf"}>{busyKey === "pdf" ? "Building preview" : `Preview PDF ${viewMode === "master" ? "A3" : "A4"}`}</button>
        </div>
        {!version ? <EmptyState title="No timetable selected" detail="Generate a draft or select an existing version." /> : (
          <>
            <div className="tt-table-scroll tt-timetable-scroll"><table className="tt-data-table tt-output-table"><thead><tr>{matrix.head.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead><tbody>{matrix.body.map((row, rowIndex) => <tr key={`${row[0]}-${row[1] || "row"}-${rowIndex}`}>{row.map((cell, index) => index === 0 ? <th key={`${rowIndex}-${index}`}>{cell}</th> : <td key={`${rowIndex}-${index}`}>{cell || <span className="tt-free-slot">Free</span>}</td>)}</tr>)}</tbody></table></div>
            {version.status === "draft" ? (
              <div className="tt-panel-band tt-operations-panel">
                <div className="tt-panel-title tt-panel-title-actions">
                  <div><h3>Draft controls</h3><span>Lock, move, swap, pin and undo</span></div>
                  <div className="tt-operation-head-actions">
                    {viewMode === "stream" && version.validation?.valid && !["S5", "S6"].includes(viewTarget.split("::")[0]) ? <button type="button" onClick={regenerateSelectedStream} disabled={busyKey === "regenerate-stream"}>{busyKey === "regenerate-stream" ? "Regenerating" : "Regenerate stream"}</button> : null}
                    {viewMode === "teacher" && selectedTeacherEvents.length > 0 ? <button type="button" onClick={() => pinTeacher(selectedTeacherId, !selectedTeacherPinned)} disabled={busyKey === "pin-teacher"}>{selectedTeacherPinned ? "Unpin teacher" : "Pin teacher"}</button> : null}
                    <button type="button" onClick={undoLastAction} disabled={busyKey === "undo"}>{busyKey === "undo" ? "Undoing" : "Undo last"}</button>
                  </div>
                </div>
                <div className="tt-operation-grid">
                  <div className="tt-operation-group">
                    <strong>Lesson control</strong>
                    <select value={controlEventId} onChange={(event) => setControlEventId(event.target.value)}><option value="">Select visible lesson</option>{controlEvents.map((event) => <option key={event.id} value={event.id}>{event.day} {event.slotCode} / {event.classLevel} {event.stream} / {event.subjectLabel}</option>)}</select>
                    <div className="tt-operation-inline"><select value={moveDay} onChange={(event) => setMoveDay(event.target.value)}>{DAYS.map((day) => <option key={day}>{day}</option>)}</select><select value={moveSlot} onChange={(event) => setMoveSlot(event.target.value)}><option>P1</option><option>P2</option><option>P3</option><option>P3A</option><option>P4</option><option>P5</option></select></div>
                    <div className="tt-operation-inline"><button type="button" onClick={moveEvent} disabled={!activeControlEvent || activeControlEvent.eventType !== "lesson" || activeControlEvent.isLocked || busyKey === "move"}>{busyKey === "move" ? "Moving" : "Move"}</button><button type="button" onClick={() => toggleEventLock(activeControlEvent)} disabled={!activeControlEvent || busyKey === `lock-${activeControlEvent?.id}`}>{activeControlEvent?.isLocked ? "Unlock" : "Lock"}</button></div>
                  </div>
                  <div className="tt-operation-group">
                    <strong>Swap ordinary lessons</strong>
                    <select value={swapFirstId} onChange={(event) => setSwapFirstId(event.target.value)}><option value="">First lesson</option>{movableEvents.map((event) => <option key={event.id} value={event.id}>{event.classLevel} {event.stream} / {event.subjectLabel} / {event.day} {event.slotCode}</option>)}</select>
                    <select value={swapSecondId} onChange={(event) => setSwapSecondId(event.target.value)}><option value="">Second lesson</option>{movableEvents.map((event) => <option key={event.id} value={event.id}>{event.classLevel} {event.stream} / {event.subjectLabel} / {event.day} {event.slotCode}</option>)}</select>
                    <button type="button" onClick={swapEvents} disabled={!swapFirstId || !swapSecondId || swapFirstId === swapSecondId || busyKey === "swap"}>{busyKey === "swap" ? "Swapping" : "Swap lessons"}</button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="tt-diagnostic-grid">
              <div className="tt-panel-band"><div className="tt-panel-title"><h3>Generation report</h3><StatusPill value={version.stats?.status} /></div><dl className="tt-stat-list"><div><dt>Streams</dt><dd>{version.stats?.streams || 0}</dd></div><div><dt>Teachers</dt><dd>{version.stats?.teachers || 0}</dd></div><div><dt>Lessons placed</dt><dd>{version.stats?.lessonsPlaced || 0}/{version.stats?.lessonsRequested || 0}</dd></div><div><dt>Unallocated</dt><dd>{version.stats?.unallocatedLessons || 0}</dd></div></dl></div>
              <div className="tt-panel-band"><div className="tt-panel-title"><h3>Validation</h3><StatusPill value={version.validation?.valid ? "Passed" : "Needs attention"} /></div><div className="tt-validation-list">{Object.entries(version.validation?.checks || {}).map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><strong>{value}</strong></div>)}</div></div>
            </div>
            {(version.validation?.unallocated || []).length > 0 ? <div className="tt-panel-band"><div className="tt-panel-title"><h3>Unallocated lessons</h3><span>{version.validation.unallocated.length}</span></div><div className="tt-issue-list">{version.validation.unallocated.map((item, index) => <div key={`${item.assignmentId || "general"}-${index}`}><strong>{item.subject || "Scheduling block"}{item.classLevel ? ` / ${item.classLevel} ${item.stream || ""}` : ""}</strong><span>{item.reason}</span></div>)}</div></div> : null}
            <div className="tt-panel-band"><div className="tt-panel-title"><h3>Teacher workload</h3><span>Scheduled periods</span></div><div className="tt-workload-grid">{workloads.map((teacher) => <div key={teacher.name}><strong>{teacher.name}</strong><span>{teacher.periods} periods / {teacher.days.size} days</span></div>)}</div></div>
            <div className="tt-publish-bar"><div><strong>{version.name}</strong><span>Only complete validated drafts can be published.</span></div><div>{version.status === "draft" ? <button type="button" onClick={() => updateVersionStatus("frozen")} disabled={busyKey === "status-frozen"}>Freeze</button> : null}{version.status === "frozen" ? <><button type="button" onClick={() => updateVersionStatus("draft")} disabled={busyKey === "status-draft"}>Return to draft</button><button type="button" className="tt-primary-command" onClick={() => updateVersionStatus("published")} disabled={!version.validation?.valid || busyKey === "status-published"}>Publish</button></> : null}{version.status === "published" ? <button type="button" onClick={() => updateVersionStatus("archived")} disabled={busyKey === "status-archived"}>Archive</button> : null}</div></div>
          </>
        )}
      </section>
    );
  };

  let content = null;
  if (loading) content = <div className="tt-loading-state"><span /><strong>Preparing timetable workspace</strong></div>;
  else if (!setup) content = <EmptyState title="Timetable unavailable" detail={error || "The setup could not be loaded."} />;
  else if (activeModule === "week") content = renderWeek();
  else if (activeModule === "constraints") content = renderConstraints();
  else if (activeModule === "generate") content = renderGenerate();
  else if (activeModule === "timetables") content = renderTimetable();
  else if (activeModule === "adviser") content = renderAdviser();
  else content = renderOverview();

  return (
    <TimetableAdminShell
      title="Timetable"
      subtitle="Prepare, generate, validate and publish the collision-free S1-S6 school timetable."
      activeModule={activeModule}
      onModuleChange={setActiveModule}
    >
      {error && setup ? <div className="tt-alert is-error"><span>{error}</span><button type="button" onClick={() => setError("")}>Close</button></div> : null}
      {notice ? <div className="tt-alert is-success"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>Close</button></div> : null}
      {content}
      {availabilityConfirmation ? (
        <div className="tt-save-confirmation" role="status" aria-live="polite" aria-atomic="true">
          <span className="tt-save-confirmation-mark" aria-hidden="true" />
          <span className="tt-save-confirmation-copy">
            <strong>Teacher availability saved</strong>
            <span>
              {availabilityConfirmation.teacherName} is available on {DAY_LIST_FORMATTER.format(availabilityConfirmation.days)}.
            </span>
          </span>
          <button type="button" onClick={() => setAvailabilityConfirmation(null)}>Dismiss</button>
        </div>
      ) : null}
      {generationConfirmation ? (
        <div className="tt-save-confirmation" role="status" aria-live="polite" aria-atomic="true">
          <span className="tt-save-confirmation-mark" aria-hidden="true" />
          <span className="tt-save-confirmation-copy">
            <strong>Draft generated</strong>
            <span>{generationConfirmation.name} was generated at {formatDate(generationConfirmation.createdAt)}.</span>
          </span>
          <button type="button" onClick={() => setGenerationConfirmation(null)}>Dismiss</button>
        </div>
      ) : null}
    </TimetableAdminShell>
  );
}
