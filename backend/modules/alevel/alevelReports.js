import express from "express";
import { db } from "../../server.js";

const router = express.Router();

/* ------------------------------
   HELPERS
--------------------------------*/

function calcAverage(mid, eot) {
  // Strict rule: average is always (MID + EOT) / 2.
  // Missing papers are treated as 0.
  const midScore = mid == null ? 0 : Number(mid);
  const eotScore = eot == null ? 0 : Number(eot);
  return Math.round(((midScore + eotScore) / 2) * 10) / 10;
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
  if (avg <= 34) return "F9";
  if (avg <= 44) return "P8";
  if (avg <= 49) return "P7";
  if (avg <= 54) return "C6";
  if (avg <= 59) return "C5";
  if (avg <= 64) return "C4";
  if (avg <= 74) return "C3";
  if (avg <= 79) return "D2";
  return "D1";
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

function subsidiaryGrade(avg) {
  if (avg === null) return { grade: "", points: 0 };
  if (avg >= 50) return { grade: "O", points: 1 };
  return { grade: "F", points: 0 };
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
  
        const [rows] = await db.query(`
          SELECT 
            s.name AS subject,
            t.name AS teacher,
            MAX(CASE WHEN e.name = 'MID' THEN m.score END) AS mid,
            MAX(CASE WHEN e.name = 'EOT' THEN m.score END) AS eot
          FROM alevel_marks m
          JOIN alevel_subjects s ON s.id = m.subject_id
          JOIN alevel_exams e ON e.id = m.exam_id
          JOIN teachers t ON t.id = m.teacher_id
          WHERE m.learner_id = ?
            AND m.term = ?
            AND YEAR(m.created_at) = ?
          GROUP BY s.id, s.name, t.name
          ORDER BY s.name ASC
        `, [learner.id, term, year]);

        // Only generate reports for learners with at least one recorded mark.
        const hasAnyMark = rows.some(
          (r) => r.mid !== null || r.eot !== null
        );
        if (!hasAnyMark) continue;
  
        let principals = [];
        let subsidiaries = [];
  
        rows.forEach(r => {
          const avg = calcAverage(r.mid, r.eot);
          const score = scoreFromAverage(avg);
  
          if (r.subject.toLowerCase().includes("sub") || r.subject.toLowerCase().includes("general")) {
            const sg = subsidiaryGrade(avg);
            subsidiaries.push({ ...r, avg, score, grade: sg.grade, points: sg.points });
          } else {
            const grade = gradeFromScore(score);
            const points = pointsFromGrade(grade);
            principals.push({ ...r, avg, score, grade, points });
          }
        });
  
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
