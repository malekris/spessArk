import { normalizeAlevelTimetablePaperLabel } from "./timetable.alevel.generator.js";

export function assignmentNeedsWeekdayAvailability(assignment) {
  return assignment.assignment_scope !== "alevel" ||
    normalizeAlevelTimetablePaperLabel(assignment.paper_label) !== "Paper 2";
}

export function buildTeacherAvailabilityRows(assignments = []) {
  const teachers = new Map();

  assignments.forEach((assignment) => {
    const teacherId = Number(assignment.teacher_id);
    if (!teacherId) return;
    if (!teachers.has(teacherId)) {
      teachers.set(teacherId, {
        teacherId,
        teacherName: assignment.teacher_name,
        availableDays: assignment.available_days || [],
        assignmentCount: 0,
        weekdayAssignmentCount: 0,
        paperTwoAssignmentCount: 0,
      });
    }

    const teacher = teachers.get(teacherId);
    teacher.assignmentCount += 1;
    if (assignmentNeedsWeekdayAvailability(assignment)) {
      teacher.weekdayAssignmentCount += 1;
    } else {
      teacher.paperTwoAssignmentCount += 1;
    }
  });

  return Array.from(teachers.values())
    .map((teacher) => {
      const availabilityRequired =
        teacher.weekdayAssignmentCount > 0 || teacher.availableDays.length > 0;
      return {
        ...teacher,
        availabilityRequired,
        availabilityExemptReason: availabilityRequired
          ? ""
          : "Paper 2 practicals are taught outside the weekday timetable.",
      };
    })
    .sort((left, right) => left.teacherName.localeCompare(right.teacherName));
}
