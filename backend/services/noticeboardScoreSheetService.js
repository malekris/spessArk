import { normalizeRegisteredSubjectKey } from "./reportSubjectRegistration.js";

export function buildNoticeboardSubjectGroups(rows = []) {
  const groups = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const subject = String(row?.subject || "").trim();
    const assignmentId = Number(row?.assignment_id);
    if (!subject || !Number.isInteger(assignmentId) || assignmentId <= 0) continue;

    const key = normalizeRegisteredSubjectKey(subject);
    if (!groups.has(key)) {
      groups.set(key, {
        subject,
        assignmentIds: new Set(),
        teacherNames: new Set(),
      });
    }

    const group = groups.get(key);
    group.assignmentIds.add(assignmentId);
    const teacherName = String(row?.teacher_name || "").trim();
    if (teacherName) group.teacherNames.add(teacherName);
  }

  return Array.from(groups.values())
    .map((group) => {
      const assignmentIds = Array.from(group.assignmentIds);
      return {
        assignment_id: assignmentIds[0] || null,
        assignment_ids: assignmentIds,
        subject: group.subject,
        teacher_name: Array.from(group.teacherNames).join(", ") || "-",
      };
    })
    .sort((a, b) => String(a.subject).localeCompare(String(b.subject)));
}

export function collectNoticeboardAssignmentIds(subjects = []) {
  const assignmentIds = new Set();

  for (const subject of Array.isArray(subjects) ? subjects : []) {
    const candidates = Array.isArray(subject?.assignment_ids)
      ? subject.assignment_ids
      : [subject?.assignment_id];

    for (const candidate of candidates) {
      const assignmentId = Number(candidate);
      if (Number.isInteger(assignmentId) && assignmentId > 0) {
        assignmentIds.add(assignmentId);
      }
    }
  }

  return Array.from(assignmentIds);
}
