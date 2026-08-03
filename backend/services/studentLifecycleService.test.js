import test from "node:test";
import assert from "node:assert/strict";

import {
  isActiveStudentRecord,
  normalizeStudentLifecycleStatus,
  STUDENT_LIFECYCLE,
} from "./studentLifecycleService.js";

test("normalizes supported learner lifecycle values", () => {
  assert.equal(normalizeStudentLifecycleStatus("ACTIVE"), STUDENT_LIFECYCLE.ACTIVE);
  assert.equal(normalizeStudentLifecycleStatus("paused"), STUDENT_LIFECYCLE.PAUSED);
  assert.equal(normalizeStudentLifecycleStatus("inactive"), STUDENT_LIFECYCLE.PAUSED);
});

test("rejects statuses outside the reversible pause workflow", () => {
  assert.equal(normalizeStudentLifecycleStatus("graduated"), null);
  assert.equal(normalizeStudentLifecycleStatus("deleted"), null);
  assert.equal(normalizeStudentLifecycleStatus(""), null);
});

test("treats legacy records without a status as active", () => {
  assert.equal(isActiveStudentRecord({}), true);
  assert.equal(isActiveStudentRecord({ status: null }), true);
  assert.equal(isActiveStudentRecord({ status: "inactive" }), false);
});
