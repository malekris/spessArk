import test from "node:test";
import assert from "node:assert/strict";
import {
  O_LEVEL_YEAR_ASSESSMENT_MODE,
  calculateOLevelYearCoursework,
  getOLevelMarkEntryComponents,
  getOLevelYearAssessmentPolicy,
  isOLevelYearSubjectComplete,
} from "./oLevelYearAssessmentPolicy.js";

const completeRow = {
  T1_AOI1: 2.4,
  T1_AOI2: 2.4,
  T1_AOI3: 2.4,
  T2_AOI1: 2.1,
  T2_AOI2: 2.1,
  T2_AOI3: 2.1,
  AOI1: 2.7,
  AOI2: 2.1,
  AOI3: 3,
  EXAM80: 60,
};

test("2026 uses the emergency two-AOI policy and later years restore the standard policy", () => {
  assert.equal(
    getOLevelYearAssessmentPolicy(2026).mode,
    O_LEVEL_YEAR_ASSESSMENT_MODE.EMERGENCY_TWO_AOI
  );
  assert.equal(
    getOLevelYearAssessmentPolicy(2027).mode,
    O_LEVEL_YEAR_ASSESSMENT_MODE.STANDARD
  );
});

test("teacher mark entry removes Term 3 AOI 3 only for the 2026 academic year", () => {
  assert.deepEqual(getOLevelMarkEntryComponents("Term 3", 2026), ["AOI1", "AOI2", "EXAM80"]);
  assert.deepEqual(getOLevelMarkEntryComponents("Term 3", 2027), [
    "AOI1",
    "AOI2",
    "AOI3",
    "EXAM80",
  ]);
  assert.deepEqual(getOLevelMarkEntryComponents("Term 2", 2026), ["AOI1", "AOI2", "AOI3"]);
});

test("2026 coursework gives each term equal weight and ignores Term 3 AOI 3", () => {
  const result = calculateOLevelYearCoursework(completeRow, 2026);

  assert.equal(result.term3Average, 2.4);
  assert.equal(result.coursework20, 15.33);

  const changedAoi3 = calculateOLevelYearCoursework({ ...completeRow, AOI3: 0 }, 2026);
  assert.equal(changedAoi3.coursework20, result.coursework20);
});

test("standard years continue to use all three Term 3 AOIs", () => {
  const perfect = {
    T1_AOI1: 3,
    T1_AOI2: 3,
    T1_AOI3: 3,
    T2_AOI1: 3,
    T2_AOI2: 3,
    T2_AOI3: 3,
    AOI1: 3,
    AOI2: 3,
    AOI3: 3,
  };

  assert.equal(calculateOLevelYearCoursework(perfect, 2027).coursework20, 20);
});

test("2026 eligibility ignores AOI 3 but still requires the first eight AOIs and the /80 exam", () => {
  const emergencyRow = {
    ...completeRow,
    AOI3: null,
    AOI3_status: "Missed",
  };

  assert.equal(isOLevelYearSubjectComplete(emergencyRow, 2026), true);
  assert.equal(isOLevelYearSubjectComplete({ ...emergencyRow, AOI2: null }, 2026), false);
  assert.equal(isOLevelYearSubjectComplete(emergencyRow, 2027), false);
});
