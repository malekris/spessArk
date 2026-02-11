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

function pickComment(total) {
  if (total <= 6) return random([
    "Performance is below expectation. Must improve effort and focus.",
    "Needs serious academic improvement.",
    "Potential exists but consistency is lacking."
  ]);
  if (total <= 12) return random([
    "Fair performance. More effort is needed.",
    "Shows ability but must work harder.",
    "Encouraging progress, improvement possible."
  ]);
  if (total <= 16) return random([
    "Good performance. Maintain the momentum.",
    "Consistent effort is yielding good results.",
    "Strong understanding in most subjects."
  ]);
  return random([
    "Excellent performance. A model of discipline.",
    "Outstanding academic achievement.",
    "Exceptional consistency and commitment."
  ]);
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
          comments: {
            classTeacher: pickComment(totalP + totalS),
            headTeacher: pickComment(totalP + totalS)
          }
        });
      }
  
      res.json(reportData);
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to generate reports" });
    }
  });
  
  
export default router;
