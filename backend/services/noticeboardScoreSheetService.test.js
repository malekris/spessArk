import test from "node:test";
import assert from "node:assert/strict";
import { buildNoticeboardSubjectGroups } from "./noticeboardScoreSheetService.js";

test("collapses teacher handover assignment IDs into one subject", () => {
  const groups = buildNoticeboardSubjectGroups([
    { assignment_id: 8, subject: "Biology", teacher_name: "Teacher One" },
    { assignment_id: 14, subject: "Biology", teacher_name: "Teacher Two" },
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].assignment_ids, [8, 14]);
  assert.equal(groups[0].teacher_name, "Teacher One, Teacher Two");
});

test("normalizes CRE and ICT aliases while keeping different subjects separate", () => {
  const groups = buildNoticeboardSubjectGroups([
    { assignment_id: 1, subject: "CRE", teacher_name: "A" },
    { assignment_id: 2, subject: "Christian Religious Education", teacher_name: "A" },
    { assignment_id: 3, subject: "ICT", teacher_name: "B" },
    { assignment_id: 4, subject: "Information and Communication Technology", teacher_name: "B" },
    { assignment_id: 5, subject: "Agriculture", teacher_name: "C" },
  ]);

  assert.equal(groups.length, 3);
  assert.deepEqual(groups.find((group) => group.subject === "CRE").assignment_ids, [1, 2]);
  assert.deepEqual(groups.find((group) => group.subject === "ICT").assignment_ids, [3, 4]);
});
