import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAttachmentContentDisposition,
  isSubmissionFinalized,
  sanitizeSubmissionFilename,
} from "./vineSubmissionFiles.js";

test("recognizes every finalized submission shape", () => {
  assert.equal(isSubmissionFinalized({ graded_at: "2026-10-27T10:00:00Z" }), true);
  assert.equal(isSubmissionFinalized({ score: 0 }), true);
  assert.equal(isSubmissionFinalized({ status: "needs_revision" }), true);
  assert.equal(isSubmissionFinalized({ status: "submitted", score: null, graded_at: null }), false);
});

test("keeps the learner filename while removing paths and control characters", () => {
  assert.equal(sanitizeSubmissionFilename("C:\\fakepath\\ICT Practical.xlsx"), "ICT Practical.xlsx");
  assert.equal(sanitizeSubmissionFilename("../../Chemistry\nWork.pdf"), "ChemistryWork.pdf");
});

test("builds a download header with ASCII and UTF-8 filename support", () => {
  const header = buildAttachmentContentDisposition("Mugisha's Résumé.pdf");
  assert.match(header, /^attachment; filename="/);
  assert.match(header, /filename\*=UTF-8''Mugisha%27s%20R%C3%A9sum%C3%A9\.pdf$/);
});

