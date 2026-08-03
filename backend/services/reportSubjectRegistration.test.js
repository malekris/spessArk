import test from "node:test";
import assert from "node:assert/strict";
import {
  filterRowsByCurrentSubjectRegistration,
  isReportRowForRegisteredSubject,
  normalizeRegisteredSubjectKey,
  parseStoredSubjects,
} from "./reportSubjectRegistration.js";

test("parses current learner subject registrations from JSON and legacy text", () => {
  assert.deepEqual(parseStoredSubjects('["Mathematics", "ICT"]'), ["Mathematics", "ICT"]);
  assert.deepEqual(parseStoredSubjects("Mathematics, ICT"), ["Mathematics", "ICT"]);
});

test("normalizes known registration and assignment subject aliases", () => {
  assert.equal(normalizeRegisteredSubjectKey("ICT"), "ict");
  assert.equal(
    normalizeRegisteredSubjectKey("Information and Communication Technology"),
    "ict"
  );
  assert.equal(normalizeRegisteredSubjectKey("CRE"), "christianreligiouseducation");
});

test("removed subjects cannot survive into a report because old marks still exist", () => {
  const registeredSubjects = JSON.stringify(["Mathematics", "ICT"]);
  const rows = [
    { subject: "Mathematics", registered_subjects: registeredSubjects, AOI1: 2.1 },
    { subject: "ICT", registered_subjects: registeredSubjects, AOI1: 1.8 },
    { subject: "Art", registered_subjects: registeredSubjects, AOI1: 2.6 },
    { subject: "Agriculture", registered_subjects: registeredSubjects, AOI1: 1.4 },
  ];

  assert.deepEqual(
    filterRowsByCurrentSubjectRegistration(rows).map((row) => row.subject),
    ["Mathematics", "ICT"]
  );
});

test("strict Mini Report filtering rejects marks when no subjects are registered", () => {
  const row = { subject: "Mathematics", registered_subjects: "[]", AOI1: 2.4 };

  assert.equal(isReportRowForRegisteredSubject(row), true);
  assert.equal(
    isReportRowForRegisteredSubject(row, { allowMissingRegistration: false }),
    false
  );
  assert.deepEqual(filterRowsByCurrentSubjectRegistration([row]), []);
});
