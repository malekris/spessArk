import test from "node:test";
import assert from "node:assert/strict";

import { buildOptionalSubjectPredictions } from "./optionalSubjectPredictor.js";

const learner = {
  id: 10,
  name: "Test Learner",
  stream: "South",
  subjects: JSON.stringify([
    "English",
    "ICT",
    "Agriculture",
    "Kiswahili",
    "Christian Religious Education",
  ]),
};

test("selects the strongest offered subject from each category", () => {
  const rows = buildOptionalSubjectPredictions({
    learners: [learner],
    marks: [
      { id: 1, student_id: 10, subject: "ICT", term: "Term 1", aoi_label: "AOI1", score: 2.1, status: "Present" },
      { id: 2, student_id: 10, subject: "Agriculture", term: "Term 2", aoi_label: "AOI1", score: 1.8, status: "Present" },
      { id: 3, student_id: 10, subject: "Kiswahili", term: "Term 3", aoi_label: "AOI1", score: 1.7, status: "Present" },
      { id: 4, student_id: 10, subject: "CRE", term: "Term 3", aoi_label: "AOI1", score: 2.4, status: "Present" },
    ],
  });

  assert.deepEqual(rows[0].selectedSubjects, ["ICT", "Christian Religious Education"]);
  assert.equal(rows[0].categoryA.confidence, "recommended");
  assert.equal(rows[0].categoryB.confidence, "recommended");
});

test("averages AOI evidence across Term 1, Term 2 and Term 3", () => {
  const rows = buildOptionalSubjectPredictions({
    learners: [learner],
    marks: [
      { id: 1, student_id: 10, subject: "ICT", term: "Term 1", aoi_label: "AOI1", score: 1.2, status: "Present" },
      { id: 2, student_id: 10, subject: "ICT", term: "Term 2", aoi_label: "AOI1", score: 1.8, status: "Present" },
      { id: 3, student_id: 10, subject: "ICT", term: "Term 3", aoi_label: "AOI1", score: 2.4, status: "Present" },
      { id: 4, student_id: 10, subject: "Kiswahili", term: "Term 1", aoi_label: "AOI1", score: 1.5, status: "Present" },
    ],
  });

  assert.equal(rows[0].categoryA.subject, "ICT");
  assert.equal(rows[0].categoryA.average, 1.8);
  assert.equal(rows[0].categoryA.scoreCount, 3);
});

test("caps only the Kiswahili predictor average and allows a stronger Category B subject to win", () => {
  const rows = buildOptionalSubjectPredictions({
    learners: [learner],
    marks: [
      { id: 1, student_id: 10, subject: "Kiswahili", term: "Term 1", aoi_label: "AOI1", score: 3, status: "Present" },
      { id: 2, student_id: 10, subject: "CRE", term: "Term 1", aoi_label: "AOI1", score: 2.9, status: "Present" },
    ],
  });

  assert.equal(rows[0].categoryB.subject, "Christian Religious Education");
  const kiswahili = rows[0].categoryB.candidates.find((candidate) => candidate.subject === "Kiswahili");
  assert.equal(kiswahili.actualAverage, 3);
  assert.equal(kiswahili.average, 2.8);
  assert.equal(kiswahili.capApplied, true);
});

test("caps only the Entrepreneurship predictor average and allows a stronger Category A subject to win", () => {
  const rows = buildOptionalSubjectPredictions({
    learners: [{
      ...learner,
      subjects: JSON.stringify(["Entrepreneurship", "ICT", "Kiswahili"]),
    }],
    marks: [
      { id: 1, student_id: 10, subject: "Entrepreneurship", term: "Term 1", aoi_label: "AOI1", score: 3, status: "Present" },
      { id: 2, student_id: 10, subject: "ICT", term: "Term 1", aoi_label: "AOI1", score: 2.6, status: "Present" },
    ],
  });

  assert.equal(rows[0].categoryA.subject, "ICT");
  const entrepreneurship = rows[0].categoryA.candidates.find(
    (candidate) => candidate.subject === "Entrepreneurship"
  );
  assert.equal(entrepreneurship.actualAverage, 3);
  assert.equal(entrepreneurship.average, 2.5);
  assert.equal(entrepreneurship.predictorCap, 2.5);
  assert.equal(entrepreneurship.capApplied, true);
});

test("uses only offered subjects and ignores missed or /80 exam scores", () => {
  const rows = buildOptionalSubjectPredictions({
    learners: [learner],
    marks: [
      { id: 1, student_id: 10, subject: "Art", term: "Term 2", aoi_label: "AOI1", score: 3, status: "Present" },
      { id: 2, student_id: 10, subject: "ICT", term: "Term 3", aoi_label: "EXAM80", score: 80, status: "Present" },
      { id: 3, student_id: 10, subject: "ICT", term: "Term 2", aoi_label: "AOI1", score: 3, status: "Missed" },
      { id: 4, student_id: 10, subject: "Agriculture", term: "Term 2", aoi_label: "AOI1", score: 1.6, status: "Present" },
      { id: 5, student_id: 10, subject: "Kiswahili", term: "Term 2", aoi_label: "AOI1", score: 1.6, status: "Present" },
    ],
  });

  assert.equal(rows[0].categoryA.subject, "Agriculture");
  assert.equal(rows[0].categoryA.average, 1.6);
  assert.equal(rows[0].categoryB.subject, "Kiswahili");
});

test("flags a forced low-scoring choice as low confidence", () => {
  const rows = buildOptionalSubjectPredictions({
    learners: [learner],
    marks: [
      { id: 1, student_id: 10, subject: "ICT", term: "Term 2", aoi_label: "AOI1", score: 1.2, status: "Present" },
      { id: 2, student_id: 10, subject: "Kiswahili", term: "Term 3", aoi_label: "AOI1", score: 1.3, status: "Present" },
    ],
  });

  assert.equal(rows[0].categoryA.lowConfidence, true);
  assert.equal(rows[0].categoryB.lowConfidence, true);
  assert.equal(rows[0].lowConfidence, true);
});

test("marks a category incomplete when the learner offers no subject in it", () => {
  const rows = buildOptionalSubjectPredictions({
    learners: [{ ...learner, subjects: JSON.stringify(["English", "ICT"]) }],
    marks: [],
  });

  assert.equal(rows[0].categoryA.subject, "ICT");
  assert.equal(rows[0].categoryB.subject, null);
  assert.equal(rows[0].complete, false);
});
