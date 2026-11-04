import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTeacherLoginNotice } from "./teacherLoginNoticeService.js";

test("normalizes teacher login notice content and enabled state", () => {
  const notice = normalizeTeacherLoginNotice({
    enabled: "true",
    version: " notice-42 ",
    title: "  Staff briefing  ",
    message: "  Please meet in the staff room.  ",
    updated_by: "7",
    updated_at: "2026-11-04T08:00:00.000Z",
  });

  assert.deepEqual(notice, {
    enabled: true,
    version: "notice-42",
    title: "Staff briefing",
    message: "Please meet in the staff room.",
    updatedBy: 7,
    updatedAt: "2026-11-04T08:00:00.000Z",
  });
});

test("supplies safe defaults for an unpublished notice", () => {
  const notice = normalizeTeacherLoginNotice({ enabled: false });

  assert.equal(notice.enabled, false);
  assert.equal(notice.title, "A message from Administration");
  assert.equal(notice.message.length > 0, true);
});
