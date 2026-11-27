import test from "node:test";
import assert from "node:assert/strict";
import {
  buildArchiveReadiness,
  normalizeArchiveClassLevel,
  normalizeArchivePeriod,
  normalizeArchiveYear,
} from "./reportArchiveService.js";

test("normalizes supported Forever Library metadata", () => {
  assert.equal(normalizeArchiveYear("2026"), 2026);
  assert.equal(normalizeArchiveYear("not-a-year"), null);
  assert.equal(normalizeArchiveClassLevel(" s4 "), "S4");
  assert.equal(normalizeArchiveClassLevel("S5"), "");
  assert.equal(normalizeArchivePeriod("Term 1"), "TERM_1");
  assert.equal(normalizeArchivePeriod("end-of-year"), "END_OF_YEAR");
});

test("readiness requires one active archive for every report period", () => {
  const partial = buildArchiveReadiness([
    { report_period: "TERM_1", status: "ACTIVE" },
    { report_period: "TERM_2", status: "SUPERSEDED" },
    { report_period: "END_OF_YEAR", status: "ACTIVE" },
  ]);

  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missingPeriods, ["TERM_2"]);

  const complete = buildArchiveReadiness([
    { report_period: "TERM_1", status: "ACTIVE" },
    { report_period: "TERM_2", status: "ACTIVE" },
    { report_period: "END_OF_YEAR", status: "ACTIVE" },
  ]);
  assert.equal(complete.complete, true);
  assert.equal(complete.archivedCount, 3);
});
