import test from "node:test";
import assert from "node:assert/strict";
import { buildOLevelReportReadiness } from "./oLevelReportReadiness.js";

const assignments = [
  { class_level: "S2", stream: "North", subject: "Mathematics", assignment_status: "active" },
];

const marks = (year, components) =>
  components.map((aoi_label) => ({
    class_level: "S2",
    stream: "North",
    subject: "Mathematics",
    term: "Term 3",
    year,
    aoi_label,
    marks_count: 1,
  }));

test("2026 Term 3 readiness requires two AOIs and the /80 exam without AOI 3", () => {
  const withoutExam = buildOLevelReportReadiness({
    assignments,
    marksSets: marks(2026, ["AOI1", "AOI2"]),
    term: "Term 3",
    academicYear: 2026,
  });
  const blockedNorth = withoutExam.streams.find(
    (row) => row.classLevel === "S2" && row.stream === "North"
  );
  assert.equal(blockedNorth.printReady, false);
  assert.deepEqual(blockedNorth.missingByComponent.EXAM80, ["Mathematics"]);

  const readiness = buildOLevelReportReadiness({
    assignments,
    marksSets: marks(2026, ["AOI1", "AOI2", "EXAM80"]),
    term: "Term 3",
    academicYear: 2026,
  });
  const north = readiness.streams.find((row) => row.classLevel === "S2" && row.stream === "North");

  assert.deepEqual(readiness.completeComponentLabels, ["AOI 1", "AOI 2", "/80"]);
  assert.equal(north.printReady, true);
  assert.equal(north.fullyComplete, true);
  assert.equal(north.missingByComponent.AOI3, undefined);
});

test("2027 Term 3 readiness automatically restores AOI 3", () => {
  const withoutAoi3 = buildOLevelReportReadiness({
    assignments,
    marksSets: marks(2027, ["AOI1", "AOI2", "EXAM80"]),
    term: "Term 3",
    academicYear: 2027,
  });
  const blockedNorth = withoutAoi3.streams.find(
    (row) => row.classLevel === "S2" && row.stream === "North"
  );

  assert.deepEqual(withoutAoi3.completeComponentLabels, ["AOI 1", "AOI 2", "AOI 3", "/80"]);
  assert.equal(blockedNorth.printReady, false);
  assert.deepEqual(blockedNorth.missingByComponent.AOI3, ["Mathematics"]);

  const withAoi3 = buildOLevelReportReadiness({
    assignments,
    marksSets: marks(2027, ["AOI1", "AOI2", "AOI3", "EXAM80"]),
    term: "Term 3",
    academicYear: 2027,
  });
  const readyNorth = withAoi3.streams.find(
    (row) => row.classLevel === "S2" && row.stream === "North"
  );
  assert.equal(readyNorth.printReady, true);
  assert.equal(readyNorth.fullyComplete, true);
});
