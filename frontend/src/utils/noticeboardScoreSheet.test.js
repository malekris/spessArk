import test from "node:test";
import assert from "node:assert/strict";
import { formatNoticeboardSubmissionMark } from "./noticeboardScoreSheet.js";

test("masks every submitted learner score", () => {
  assert.equal(formatNoticeboardSubmissionMark({ score: 1.7, status: "Present" }), "S");
  assert.equal(formatNoticeboardSubmissionMark({ score: 80, status: "Present" }), "S");
  assert.equal(formatNoticeboardSubmissionMark({ score: 0, status: "Present" }), "S");
});

test("keeps missed and blank assessments distinguishable", () => {
  assert.equal(formatNoticeboardSubmissionMark({ score: null, status: "Missed" }), "X");
  assert.equal(formatNoticeboardSubmissionMark({ score: null, status: "Present" }), "");
  assert.equal(formatNoticeboardSubmissionMark(null), "");
});
