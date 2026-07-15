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
