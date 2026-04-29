import express from "express";
import { db } from "../../server.js";

const router = express.Router();

function normalizePaperLabel(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "paper 1" || raw === "paper1" || raw === "p1") return "Paper 1";
  if (raw === "paper 2" || raw === "paper2" || raw === "p2") return "Paper 2";
  if (raw === "single" || raw === "single paper") return "Single";
  return "";
}

const SINGLE_PAPER_SUBJECTS = new Set(["general paper", "sub math", "submath"]);

function isSinglePaperSubject(subjectName = "") {
  return SINGLE_PAPER_SUBJECTS.has(String(subjectName || "").trim().toLowerCase());
}

function isSubIctSubject(subjectName = "") {
  const normalized = String(subjectName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return normalized === "subict" || normalized === "subsidiaryict";
}

function getPaperOptionsForSubject(subjectName = "") {
  return isSinglePaperSubject(subjectName) ? ["Single"] : ["Paper 1", "Paper 2"];
}

function displaySubjectWithPaper(subject, paperLabel) {
  const resolvedPaper = normalizePaperLabel(paperLabel);
  if (!subject) return "";
  if (!resolvedPaper || resolvedPaper === "Single") return subject;
  return `${subject} — ${resolvedPaper}`;
}

function paperSortValue(paperLabel = "") {
  const normalized = normalizePaperLabel(paperLabel);
  if (normalized === "Paper 1") return 1;
  if (normalized === "Paper 2") return 2;
  return 0;
}

/* ------------------------------
   HELPERS
--------------------------------*/

function calcAverage(mid, eot) {
  if (mid === null || mid === undefined || eot === null || eot === undefined) {
    return null;
  }
  const midScore = Number(mid);
  const eotScore = Number(eot);
  if (!Number.isFinite(midScore) || !Number.isFinite(eotScore)) {
    return null;
  }
  return Math.round(((midScore + eotScore) / 2) * 10) / 10;
}

function componentStatus(hasRecord, score) {
  if (!hasRecord) return "Missing";
  if (score === null || score === undefined) return "Missed";
  return "Submitted";
}

function incompleteLabelFromStatuses(statuses = []) {
  return statuses.some((status) => String(status || "").toLowerCase() === "missed")
    ? "Missed"
    : "Missing";
}

function getAge(dob) {
    if (!dob) return "";
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }
  
  function splitStream(full) {
    if (!full) return { cls: "", stream: "" };
    const [cls, ...rest] = full.split(" ");
    return { cls, stream: rest.join(" ") };
  }
function scoreFromAverage(avg) {
  if (avg === null) return "";
  if (avg <= 39) return "F9";
  if (avg <= 49) return "P8";
  if (avg <= 59) return "P7";
  if (avg <= 64) return "C6";
  if (avg <= 69) return "C5";
  if (avg <= 74) return "C4";
  if (avg <= 79) return "C3";
  if (avg <= 84) return "D2";
  return "D1";
}

function paperGradeNumber(score = "") {
  return {
    D1: 1,
    D2: 2,
    C3: 3,
    C4: 4,
    C5: 5,
    C6: 6,
    P7: 7,
    P8: 8,
    F9: 9,
  }[String(score || "").trim().toUpperCase()] ?? null;
}

function gradeFromScore(score) {
  if (["D1", "D2"].includes(score)) return "A";
  if (["C3"].includes(score)) return "B";
  if (["C4", "C5", "C6"].includes(score)) return "C";
  if (["P7"].includes(score)) return "D";
  if (["P8"].includes(score)) return "E";
  if (["F9"].includes(score)) return "F";
  return "";
}

function pointsFromGrade(grade) {
  return { A: 6, B: 5, C: 4, D: 3, E: 2, O: 1, F: 0 }[grade] ?? 0;
}

function deriveSubsidiarySubjectGrade(papers = []) {
  if (!Array.isArray(papers) || papers.length === 0) {
    return { grade: "Missing", points: 0 };
  }

  const paperGrades = papers.map((paper) => paperGradeNumber(paper.paperScore));
  if (paperGrades.some((gradeNumber) => !Number.isFinite(gradeNumber))) {
    return { grade: "Missing", points: 0 };
  }

  return paperGrades.every((gradeNumber) => gradeNumber <= 6)
    ? { grade: "O", points: 1 }
    : { grade: "F", points: 0 };
}

function deriveTwoPaperSubjectGrade(firstPaperScore, secondPaperScore) {
  const first = paperGradeNumber(firstPaperScore);
  const second = paperGradeNumber(secondPaperScore);

  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return "Missing";
  }

  const [better, weaker] = [first, second].sort((a, b) => a - b);
  const aggregate = better + weaker;
  const hasSubjectPass = better === 7 || better === 8 || weaker === 7 || weaker === 8;

  if (weaker <= 2) return "A";
  if (weaker === 3) return "B";
  if (weaker === 4) return "C";
  if (weaker === 5) return "D";
  if (weaker === 6 || (weaker <= 8 && aggregate <= 12)) return "E";
  if ((hasSubjectPass && aggregate <= 16) || (weaker === 9 && better <= 6)) return "O";
  if ((better === 8 && weaker === 9) || (better === 9 && weaker === 9)) return "F";
  return "F";
}

const COMMENT_BANK = {
  low: {
    head: [
      "Performance is below expectation. More structured revision is required.",
      "Academic progress is limited and needs immediate improvement.",
      "Results indicate the need for stronger effort and consistency.",
      "The learner should improve focus and complete all assigned work.",
      "Current performance is weak and requires closer academic support.",
      "More discipline in class and private study is needed.",
      "The learner must improve examination readiness and time management.",
      "There is potential, but effort remains below expected standards.",
      "The learner should attend extra support sessions regularly.",
      "Progress is not yet satisfactory and requires urgent attention.",
      "The learner needs to strengthen understanding of key concepts.",
      "Continuous monitoring and remedial support are recommended.",
    ],
    class: [
      "Needs daily revision and timely completion of class assignments.",
      "Should seek help early when topics are not understood.",
      "Must improve classroom participation and concentration.",
      "More practice questions are required in weak subjects.",
      "Should follow a weekly study timetable to improve consistency.",
      "Requires better lesson attendance and homework follow-up.",
      "Must reduce missed tasks and improve submission discipline.",
      "Should work on foundational concepts before advanced topics.",
      "Needs stronger commitment to classwork and assessments.",
      "Should revise with peers and consult subject teachers regularly.",
      "Needs improved reading culture and note organization.",
      "Must show more seriousness toward test preparation.",
    ],
  },
  mid: {
    head: [
      "Fair performance with clear room for improvement.",
      "Steady progress is visible; stronger consistency is needed.",
      "The learner is improving but should aim higher.",
      "Performance is moderate and can rise with extra effort.",
      "A reasonable attempt has been shown across most subjects.",
      "Progress is acceptable, though more discipline is required.",
      "The learner should convert potential into stronger results.",
      "This is an encouraging trend that must be sustained.",
      "A balanced effort is noted, but consistency should improve.",
      "Results show promise and should be strengthened next term.",
      "Good foundation established; more revision will improve outcomes.",
      "The learner is on track but should target higher grades.",
    ],
    class: [
      "Should revise consistently and focus on weak topics.",
      "Needs more practice in exam-style questions.",
      "Class engagement is fair; participation should increase.",
      "Should improve accuracy and reduce avoidable mistakes.",
      "Can perform better with stronger homework discipline.",
      "Needs better pacing when handling timed assessments.",
      "Should maintain effort across all subjects, not selected ones.",
      "Can improve significantly with weekly revision targets.",
      "Must keep class notes updated and revise them regularly.",
      "Should seek clarification promptly in difficult areas.",
      "Needs improved confidence during tests and presentations.",
      "Can move to higher bands with consistent preparation.",
    ],
  },
  very_good: {
    head: [
      "Very good performance. Keep up the strong academic discipline.",
      "Commendable results across subjects. Continue aiming higher.",
      "The learner has demonstrated strong understanding and effort.",
      "A very solid performance has been maintained this term.",
      "Excellent progress observed. Sustain this momentum.",
      "The learner is performing very well and should remain focused.",
      "Strong results reflect commitment and consistency.",
      "This is a highly encouraging academic record.",
      "Very good achievement with clear mastery in key areas.",
      "The learner has shown maturity and excellent work habits.",
      "Performance is impressive and should be sustained.",
      "A high standard has been set and should be maintained.",
    ],
    class: [
      "Shows strong class participation and reliable preparation.",
      "Should continue mentoring peers while maintaining personal standards.",
      "Needs to sustain revision habits for even better distinctions.",
      "Demonstrates excellent organization and task completion.",
      "Should maintain consistency in all assessments next term.",
      "Shows confidence and strong grasp of subject content.",
      "Class attitude is positive and supports strong results.",
      "Should keep challenging self with advanced practice questions.",
      "Maintains a strong work ethic and disciplined study routine.",
      "Should preserve this focus and avoid complacency.",
      "Demonstrates very good exam technique and preparation.",
      "A dependable performer who should aim for top distinction.",
    ],
  },
};

function commentCategory(total) {
  if (total <= 6) return "low";
  if (total <= 12) return "mid";
  return "very_good";
}

function pickComments(total) {
  const category = commentCategory(total);
  const bank = COMMENT_BANK[category] || COMMENT_BANK.mid;

  const headTeacher = random(bank.head);
  const classPool = bank.class.filter((c) => c !== headTeacher);
  const classTeacher = random(classPool.length > 0 ? classPool : bank.class);

  return { headTeacher, classTeacher };
}

function groupRowsBySubject(rows = []) {
  const grouped = new Map();

  rows.forEach((row) => {
    const subjectName = String(row.subject || "").trim();
    const key = subjectName.toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, {
        subject: subjectName,
        isSubsidiary:
          subjectName.toLowerCase().includes("sub") ||
          subjectName.toLowerCase().includes("general"),
        papers: [],
      });
    }

    const group = grouped.get(key);
    const paperAverage = calcAverage(row.mid, row.eot);
    const midStatus = row.mid_status || (row.mid === null || row.mid === undefined ? "Missing" : "Submitted");
    const eotStatus = row.eot_status || (row.eot === null || row.eot === undefined ? "Missing" : "Submitted");
    const paperResultStatus =
      paperAverage === null ? incompleteLabelFromStatuses([midStatus, eotStatus]) : "Submitted";
    const paperScore = paperAverage === null ? paperResultStatus : scoreFromAverage(paperAverage);
    group.papers.push({
      paper: normalizePaperLabel(row.paper_label) || "Single",
      teacher: row.teacher || "—",
      mid: row.mid,
      eot: row.eot,
      mid_status: midStatus,
      eot_status: eotStatus,
      avg: paperAverage,
      resultStatus: paperResultStatus,
      paperScore,
    });
  });

  return Array.from(grouped.values())
    .map((group) => {
      const papers = group.papers.sort((a, b) => {
        const paperDiff = paperSortValue(a.paper) - paperSortValue(b.paper);
        if (paperDiff !== 0) return paperDiff;
        return String(a.paper || "").localeCompare(String(b.paper || ""));
      });

      const hasIncompletePaper = papers.some((paper) => paper.avg === null || paper.avg === undefined);
      const incompleteLabel = incompleteLabelFromStatuses(
        papers.flatMap((paper) => [paper.mid_status, paper.eot_status, paper.resultStatus])
      );
      const availablePaperAverages = papers
        .map((paper) => Number(paper.avg))
        .filter((value) => Number.isFinite(value));
      const mergedAverage = !hasIncompletePaper && availablePaperAverages.length
        ? Math.round(
            (availablePaperAverages.reduce((sum, value) => sum + value, 0) /
              availablePaperAverages.length) *
              10
          ) / 10
        : null;

      const isTwoPaperSubject = papers.length >= 2 && papers.some((paper) => paper.paper !== "Single");
      const score = scoreFromAverage(mergedAverage);

      if (group.isSubsidiary) {
        const subsidiary = hasIncompletePaper
          ? { grade: incompleteLabel, points: 0 }
          : isSubIctSubject(group.subject)
          ? { grade: mergedAverage >= 50 ? "O" : "F", points: mergedAverage >= 50 ? 1 : 0 }
          : deriveSubsidiarySubjectGrade(papers);
        return {
          subject: group.subject,
          isSubsidiary: true,
          papers,
          mergedAverage,
          score,
          grade: subsidiary.grade,
          points: subsidiary.points,
        };
      }

      const grade = isTwoPaperSubject
        ? hasIncompletePaper
          ? incompleteLabel
          : deriveTwoPaperSubjectGrade(papers[0]?.paperScore, papers[1]?.paperScore)
        : mergedAverage === null
        ? incompleteLabel
        : gradeFromScore(score);
      const points = pointsFromGrade(grade);
      return {
        subject: group.subject,
        isSubsidiary: false,
        papers,
        mergedAverage,
        score: isTwoPaperSubject ? "—" : mergedAverage === null ? incompleteLabel : score,
        grade,
        points,
      };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ------------------------------
   PREVIEW
--------------------------------*/
router.post("/preview", async (req, res) => {
  try {
    const { term, class: cls, stream, year } = req.body;
    const fullStream = `${cls} ${stream}`;

    const [[l]] = await db.query(`
      SELECT COUNT(DISTINCT l.id) AS total
      FROM alevel_marks m
      JOIN alevel_learners l ON l.id = m.learner_id
      WHERE l.stream = ?
      AND m.term = ?
      AND YEAR(m.created_at) = ?
    `, [fullStream, term, year]);

    const [[s]] = await db.query(`
      SELECT COUNT(DISTINCT m.subject_id) AS total
      FROM alevel_marks m
      JOIN alevel_learners l ON l.id = m.learner_id
      WHERE l.stream = ?
      AND m.term = ?
      AND YEAR(m.created_at) = ?
    `, [fullStream, term, year]);

    res.json({ learners: l.total || 0, subjects: s.total || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Preview failed" });
  }
});

/* ------------------------------
   DOWNLOAD FULL REPORT
--------------------------------*/
router.post("/download", async (req, res) => {
    try {
      const { term, class: cls, stream, year } = req.body;
      const fullStream = `${cls} ${stream}`;
  
      const [learners] = await db.query(
        "SELECT * FROM alevel_learners WHERE stream = ? ORDER BY first_name",
        [fullStream]
      );
  
      const reportData = [];
  
      for (const learner of learners) {
        const age = getAge(learner.dob);
        const { cls, stream: streamName } = splitStream(learner.stream);
        const [registeredSubjects] = await db.query(
          `
          SELECT
            s.id AS subject_id,
            s.name AS subject
          FROM alevel_learner_subjects als
          JOIN alevel_subjects s ON s.id = als.subject_id
          WHERE als.learner_id = ?
          ORDER BY s.name ASC
          `,
          [learner.id]
        );

        const subjectIds = registeredSubjects.map((row) => Number(row.subject_id)).filter(Number.isFinite);

        const [assignmentRows] = subjectIds.length
          ? await db.query(
              `
              SELECT
                ats.subject_id,
                ats.paper_label,
                COALESCE(t.name, '—') AS teacher
              FROM alevel_teacher_subjects ats
              LEFT JOIN teachers t ON t.id = ats.teacher_id
              WHERE ats.stream = ?
                AND ats.subject_id IN (?)
              ORDER BY ats.subject_id ASC, ats.paper_label ASC
              `,
              [learner.stream, subjectIds]
            )
          : [[]];

        const [markRows] = subjectIds.length
          ? await db.query(
              `
              SELECT
                m.subject_id,
                ats.paper_label,
                COALESCE(t.name, '—') AS teacher,
                MAX(CASE WHEN e.name = 'MID' THEN m.score END) AS mid,
                MAX(CASE WHEN e.name = 'EOT' THEN m.score END) AS eot,
                MAX(CASE WHEN e.name = 'MID' THEN 1 ELSE 0 END) AS mid_recorded,
                MAX(CASE WHEN e.name = 'EOT' THEN 1 ELSE 0 END) AS eot_recorded
              FROM alevel_marks m
              JOIN alevel_exams e ON e.id = m.exam_id
              LEFT JOIN alevel_teacher_subjects ats ON ats.id = m.assignment_id
              LEFT JOIN teachers t ON t.id = COALESCE(ats.teacher_id, m.teacher_id)
              WHERE m.learner_id = ?
                AND m.term = ?
                AND YEAR(m.created_at) = ?
                AND m.subject_id IN (?)
              GROUP BY m.subject_id, ats.paper_label, t.name
              ORDER BY m.subject_id ASC, ats.paper_label ASC
              `,
              [learner.id, term, year, subjectIds]
            )
          : [[]];

        const expectedRows = [];

        registeredSubjects.forEach((subjectRow) => {
          const paperOptions = getPaperOptionsForSubject(subjectRow.subject);

          paperOptions.forEach((paperLabel) => {
            const normalizedPaper = normalizePaperLabel(paperLabel) || paperLabel;
            const assignment = (assignmentRows || []).find(
              (row) =>
                Number(row.subject_id) === Number(subjectRow.subject_id) &&
                (normalizePaperLabel(row.paper_label) || "Single") === normalizedPaper
            );
            const mark = (markRows || []).find(
              (row) =>
                Number(row.subject_id) === Number(subjectRow.subject_id) &&
                (normalizePaperLabel(row.paper_label) || "Single") === normalizedPaper
            );

            expectedRows.push({
              subject_id: Number(subjectRow.subject_id),
              subject: subjectRow.subject,
              paper_label: normalizedPaper,
              teacher: mark?.teacher || assignment?.teacher || "—",
              mid: mark?.mid ?? null,
              eot: mark?.eot ?? null,
              mid_status: componentStatus(Number(mark?.mid_recorded || 0) > 0, mark?.mid),
              eot_status: componentStatus(Number(mark?.eot_recorded || 0) > 0, mark?.eot),
            });
          });
        });

        // Only generate reports for learners with at least one uploaded mark row.
        // A NULL score row is an explicit teacher-marked MISSED exam; no row is MISSING.
        const hasAnyMark = expectedRows.some(
          (r) => r.mid_status !== "Missing" || r.eot_status !== "Missing"
        );
        if (!hasAnyMark) continue;
  
        const groupedSubjects = groupRowsBySubject(expectedRows);
        const principals = groupedSubjects.filter((row) => !row.isSubsidiary);
        const subsidiaries = groupedSubjects.filter((row) => row.isSubsidiary);
  
        const totalP = principals.reduce((s, x) => s + x.points, 0);
        const totalS = subsidiaries.reduce((s, x) => s + x.points, 0);
  
        reportData.push({
          learner: {
            id: learner.id,
            name: `${learner.first_name} ${learner.last_name}`,
            age,
            house: learner.house,
            class: cls,
            stream: streamName,
            combination: learner.combination
          },
          principals,
          subsidiaries,
          totals: {
            principal: totalP,
            subsidiary: totalS,
            overall: totalP + totalS
          },
          comments: pickComments(totalP + totalS)
        });
      }
  
      res.json(reportData);
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to generate reports" });
    }
  });
  
  
export default router;
