import { normalizeSubject } from "./timetable.constants.js";

export function applyManualCredits(storedValidation, storedStats, plan) {
  const validation = JSON.parse(JSON.stringify(storedValidation || {}));
  const stats = { ...(storedStats || {}) };
  validation.missingLessons = Array.isArray(validation.missingLessons)
    ? validation.missingLessons
    : [];
  validation.unallocated = Array.isArray(validation.unallocated)
    ? validation.unallocated
    : [];
  let creditedLessons = 0;

  for (const credit of plan.credits || []) {
    const subjectKey = normalizeSubject(credit.subjectLabel);
    const matchesCreditContext = (item, labelValue) => {
      const label = normalizeSubject(labelValue);
      return label.includes(subjectKey) &&
        label.includes(String(credit.classLevel || "").toLowerCase()) &&
        label.includes(String(credit.stream || "").toLowerCase());
    };
    let missingIndex = validation.missingLessons.findIndex(
      (item) => Number(item.assignmentId) === Number(credit.assignmentId) &&
        Number(item.missing || 0) > 0 &&
        matchesCreditContext(item, item.label)
    );
    if (missingIndex < 0 && plan.mode === "subject") {
      missingIndex = validation.missingLessons.findIndex((item) =>
        Number(item.missing || 0) > 0 && matchesCreditContext(item, item.label)
      );
    }
    if (missingIndex < 0) continue;
    const missing = validation.missingLessons[missingIndex];
    missing.placed = Number(missing.placed || 0) + 1;
    missing.missing = Math.max(0, Number(missing.missing || 0) - 1);
    creditedLessons += 1;
    if (missing.missing === 0) validation.missingLessons.splice(missingIndex, 1);
  }

  let unallocatedIndex = -1;
  if (plan.mode === "subject") {
    const credit = plan.credits?.[0];
    const subjectKey = normalizeSubject(plan.label);
    unallocatedIndex = validation.unallocated.findIndex((item) =>
      (
        Number(item.assignmentId) === Number(credit?.assignmentId) ||
        normalizeSubject(item.subject).includes(subjectKey)
      ) &&
      String(item.classLevel || "") === String(plan.classLevel) &&
      String(item.stream || "") === String(plan.streams?.[0] || "")
    );
  } else if (plan.mode === "cluster") {
    const labelKey = normalizeSubject(plan.label);
    const clusterKey = normalizeSubject(plan.clusterCode);
    unallocatedIndex = validation.unallocated.findIndex((item) =>
      String(item.classLevel || "") === String(plan.classLevel) &&
      (
        normalizeSubject(item.subject).includes(labelKey.replace(" subjects", "")) ||
        normalizeSubject(item.subject).includes(clusterKey)
      )
    );
  }
  if (unallocatedIndex >= 0) validation.unallocated.splice(unallocatedIndex, 1);

  const blockingCollections = [
    validation.teacherClashes,
    validation.streamClashes,
    validation.invalidDays,
    validation.duplicatePeriods,
    validation.hardViolations,
  ];
  validation.valid = validation.missingLessons.length === 0 &&
    validation.unallocated.length === 0 &&
    blockingCollections.every((items) => !Array.isArray(items) || items.length === 0);

  const missingCount = validation.missingLessons.reduce(
    (sum, item) => sum + Number(item.missing || 0),
    0
  );
  stats.lessonsPlaced = Number(stats.lessonsPlaced || 0) + creditedLessons;
  stats.timetableCells = Number(stats.timetableCells || 0) + plan.events.length;
  stats.teacherSessions = Number(stats.teacherSessions || 0) + plan.sessions.length;
  stats.manualExtras = Number(stats.manualExtras || 0) +
    Math.max(0, (plan.credits || []).length - creditedLessons);
  stats.unallocatedLessons = Math.max(missingCount, validation.unallocated.length);
  stats.status = validation.valid ? "complete" : "needs_attention";
  return { validation, stats, creditedLessons };
}

export function applyManualRemoval(storedValidation, storedStats, plan) {
  const validation = JSON.parse(JSON.stringify(storedValidation || {}));
  const stats = { ...(storedStats || {}) };
  validation.missingLessons = Array.isArray(validation.missingLessons)
    ? validation.missingLessons
    : [];
  validation.unallocated = Array.isArray(validation.unallocated)
    ? validation.unallocated
    : [];

  let removedRequiredLessons = 0;
  let removedExtraLessons = 0;

  for (const impact of plan.impacts || []) {
    const required = Math.max(0, Number(impact.requiredLessons || 0));
    const scheduledBefore = Math.max(0, Number(impact.scheduledBefore || 0));
    const scheduledAfter = Math.max(0, Number(impact.scheduledAfter || 0));
    const missingBefore = Math.max(0, required - scheduledBefore);
    const missingAfter = Math.max(0, required - scheduledAfter);
    const requiredDelta = Math.max(
      0,
      Math.min(required, scheduledBefore) - Math.min(required, scheduledAfter)
    );
    const extraDelta = Math.max(
      0,
      Math.max(0, scheduledBefore - required) - Math.max(0, scheduledAfter - required)
    );

    removedRequiredLessons += requiredDelta;
    removedExtraLessons += extraDelta;

    if (missingAfter <= 0) continue;

    const subjectKey = normalizeSubject(impact.subjectLabel);
    const matchesContext = (item) => {
      const label = normalizeSubject(item?.label);
      const assignmentMatches = Number(impact.assignmentId) > 0 &&
        Number(item?.assignmentId) === Number(impact.assignmentId);
      return assignmentMatches || (
        label.includes(subjectKey) &&
        label.includes(String(impact.classLevel || "").toLowerCase()) &&
        label.includes(String(impact.stream || "").toLowerCase())
      );
    };
    const missingIndex = validation.missingLessons.findIndex(matchesContext);
    const missingRow = {
      assignmentId: Number(impact.assignmentId) || null,
      label: `${impact.subjectLabel} - ${impact.classLevel} ${impact.stream}`,
      required,
      placed: scheduledAfter,
      missing: missingAfter,
    };
    if (missingIndex >= 0) validation.missingLessons[missingIndex] = missingRow;
    else validation.missingLessons.push(missingRow);

    if (missingAfter <= missingBefore) continue;
    const existingRemovalAnomaly = validation.unallocated.some((item) =>
      item?.source === "manual_removal" && matchesContext({
        ...item,
        label: `${item.subject || ""} - ${item.classLevel || ""} ${item.stream || ""}`,
      })
    );
    if (!existingRemovalAnomaly) {
      validation.unallocated.push({
        assignmentId: Number(impact.assignmentId) || null,
        teacherId: Number(impact.teacherId) || null,
        teacherName: impact.teacherName || null,
        classLevel: impact.classLevel || null,
        stream: impact.stream || null,
        subject: impact.subjectLabel || null,
        source: "manual_removal",
        reason: `Manual deletion removed a scheduled ${impact.subjectLabel} lesson; ${scheduledAfter} of ${required} required weekly lessons remain in ${impact.classLevel} ${impact.stream}.`,
      });
    }
  }

  const blockingCollections = [
    validation.teacherClashes,
    validation.streamClashes,
    validation.invalidDays,
    validation.duplicatePeriods,
    validation.hardViolations,
  ];
  validation.valid = validation.missingLessons.length === 0 &&
    validation.unallocated.length === 0 &&
    blockingCollections.every((items) => !Array.isArray(items) || items.length === 0);
  validation.checks = {
    ...(validation.checks || {}),
    requiredLessonCounts: validation.missingLessons.length === 0 ? "passed" : "needs attention",
  };

  const missingCount = validation.missingLessons.reduce(
    (sum, item) => sum + Number(item.missing || 0),
    0
  );
  stats.lessonsPlaced = Math.max(0, Number(stats.lessonsPlaced || 0) - removedRequiredLessons);
  stats.timetableCells = Math.max(0, Number(stats.timetableCells || 0) - Number(plan.eventsRemoved || 0));
  stats.teacherSessions = Math.max(0, Number(stats.teacherSessions || 0) - Number(plan.sessionsRemoved || 0));
  stats.manualExtras = Math.max(0, Number(stats.manualExtras || 0) - removedExtraLessons);
  stats.unallocatedLessons = Math.max(missingCount, validation.unallocated.length);
  stats.status = validation.valid ? "complete" : "needs_attention";

  return {
    validation,
    stats,
    removedRequiredLessons,
    removedExtraLessons,
  };
}
