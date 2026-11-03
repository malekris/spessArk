import test from "node:test";
import assert from "node:assert/strict";

import { filterGradebookRowsByAssignment } from "./vineCommunityAssignmentsRoutes.js";

const rows = [
  { assignment_id: 41, learner_id: 1 },
  { assignment_id: 41, learner_id: 2 },
  { assignment_id: 29, learner_id: 1 },
];

test("returns only the requested assignment gradebook rows", () => {
  assert.deepEqual(filterGradebookRowsByAssignment(rows, "41"), rows.slice(0, 2));
});

test("keeps the full gradebook when no valid assignment filter is requested", () => {
  assert.deepEqual(filterGradebookRowsByAssignment(rows, null), rows);
  assert.deepEqual(filterGradebookRowsByAssignment(rows, "all"), rows);
});
