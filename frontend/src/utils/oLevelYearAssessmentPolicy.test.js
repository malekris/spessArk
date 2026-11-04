import test from "node:test";
import assert from "node:assert/strict";
import {
  getOLevelMarkEntryColumns,
  usesEmergencyTwoAoiAcademicYear,
} from "./oLevelYearAssessmentPolicy.js";

test("2026 Term 3 mark entry contains AOI 1, AOI 2 and the /80 exam", () => {
  assert.equal(usesEmergencyTwoAoiAcademicYear("2026"), true);
  assert.deepEqual(getOLevelMarkEntryColumns("Term 3", 2026), ["AOI1", "AOI2", "EXAM80"]);
});

test("2027 Term 3 automatically restores AOI 3", () => {
  assert.equal(usesEmergencyTwoAoiAcademicYear(2027), false);
  assert.deepEqual(getOLevelMarkEntryColumns("Term 3", 2027), [
    "AOI1",
    "AOI2",
    "AOI3",
    "EXAM80",
  ]);
});

test("Term 1 and Term 2 retain three AOIs in every year", () => {
  assert.deepEqual(getOLevelMarkEntryColumns("Term 1", 2026), ["AOI1", "AOI2", "AOI3"]);
  assert.deepEqual(getOLevelMarkEntryColumns("Term 2", 2027), ["AOI1", "AOI2", "AOI3"]);
});
