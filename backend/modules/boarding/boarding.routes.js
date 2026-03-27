import express from "express";
import jwt from "jsonwebtoken";
import { pool } from "../../server.js";
import authBoardingAdmin from "../../middleware/authBoardingAdmin.js";

const router = express.Router();

const BOARDING_CLASSES = ["S1", "S2", "S3", "S4"];
const BOARDING_SCORE_MIN = 0.9;
const BOARDING_SCORE_MAX = 3.0;
const DEFAULT_BOARDING_SUBJECTS = [
  { name: "English", is_optional: 0 },
  { name: "Mathematics", is_optional: 0 },
  { name: "Biology", is_optional: 0 },
  { name: "Chemistry", is_optional: 0 },
  { name: "Physics", is_optional: 0 },
  { name: "History", is_optional: 0 },
  { name: "Geography", is_optional: 0 },
  { name: "ICT", is_optional: 1 },
  { name: "Physical Education", is_optional: 1 },
  { name: "Christian Religious Education", is_optional: 1 },
  { name: "Luganda", is_optional: 1 },
  { name: "IRE", is_optional: 1 },
  { name: "Agriculture", is_optional: 1 },
  { name: "Art", is_optional: 1 },
  { name: "Literature", is_optional: 1 },
  { name: "Entrepreneurship", is_optional: 1 },
  { name: "Kiswahili", is_optional: 1 },
];

const getBoardingSubjectRemark = (averageScore, submittedCount, missedCount) => {
  const average = Number(averageScore);
  const submitted = Number(submittedCount || 0);
  const missed = Number(missedCount || 0);

  if (!Number.isFinite(average)) {
    if (missed > 0 && submitted === 0) return "Missed";
    if (missed > 0) return "Follow Up";
    return "Pending";
  }
  if (average >= 2.5) return "Outstanding";
  if (average >= 1.5) return "Moderate";
  return "Basic";
};

const getBoardingOverallComment = (report) => {
  const average = Number(report?.overall_average);
  const missedCount = Number(report?.missed_assessment_count || 0);
  const registeredCount = Number(report?.registered_subject_count || 0);
  const scoredCount = Number(report?.scored_subject_count || 0);

  if (!Number.isFinite(average) || scoredCount === 0) {
    return "Weekend assessment scores are still being captured for this learner this term.";
  }
  if (missedCount >= 2) {
    return "Several weekend assessments were missed. Please follow up on the missed work.";
  }
  if (registeredCount > 0 && scoredCount < registeredCount) {
    return "Some subjects are still pending weekend assessment scores. Please follow up on the remaining subjects.";
  }
  if (average >= 2.5) {
    return "Outstanding weekend assessment performance has been recorded this term. The learner should maintain the same standard.";
  }
  if (average >= 1.5) {
    return "Moderate weekend assessment progress has been shown. Greater consistency can lift the learner further.";
  }
  return "Basic weekend assessment performance has been recorded. Closer support and more practice are recommended.";
};

let boardingSchemaReadyPromise = null;

const normalizeClassLevel = (value = "") => String(value || "").trim().toUpperCase();

async function ensureBoardingSchemaReady() {
  if (!boardingSchemaReadyPromise) {
    boardingSchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS boarding_students (
          id INT NOT NULL AUTO_INCREMENT,
          name VARCHAR(150) NOT NULL,
          gender ENUM('Male','Female') NOT NULL,
          dob DATE DEFAULT NULL,
          class_level VARCHAR(10) NOT NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_boarding_students_class (class_level),
          KEY idx_boarding_students_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS boarding_subjects (
          id INT NOT NULL AUTO_INCREMENT,
          name VARCHAR(100) NOT NULL,
          is_optional TINYINT(1) NOT NULL DEFAULT 0,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_boarding_subject_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS boarding_student_subjects (
          student_id INT NOT NULL,
          subject_id INT NOT NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (student_id, subject_id),
          KEY idx_boarding_student_subjects_subject (subject_id),
          CONSTRAINT fk_boarding_student_subjects_student FOREIGN KEY (student_id) REFERENCES boarding_students(id) ON DELETE CASCADE,
          CONSTRAINT fk_boarding_student_subjects_subject FOREIGN KEY (subject_id) REFERENCES boarding_subjects(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS boarding_marks (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          student_id INT NOT NULL,
          subject_id INT NOT NULL,
          term VARCHAR(20) NOT NULL,
          year INT NOT NULL,
          weekend_label VARCHAR(100) NOT NULL,
          assessment_date DATE DEFAULT NULL,
          score DECIMAL(6,2) DEFAULT NULL,
          status ENUM('Submitted','Missed') NOT NULL DEFAULT 'Submitted',
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_boarding_mark_slot (student_id, subject_id, term, year, weekend_label),
          KEY idx_boarding_marks_lookup (subject_id, term, year, weekend_label),
          CONSTRAINT fk_boarding_marks_student FOREIGN KEY (student_id) REFERENCES boarding_students(id) ON DELETE CASCADE,
          CONSTRAINT fk_boarding_marks_subject FOREIGN KEY (subject_id) REFERENCES boarding_subjects(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      for (const subject of DEFAULT_BOARDING_SUBJECTS) {
        await pool.query(
          `INSERT INTO boarding_subjects (name, is_optional)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE is_optional = VALUES(is_optional)`,
          [subject.name, subject.is_optional]
        );
      }
    })().catch((err) => {
      boardingSchemaReadyPromise = null;
      throw err;
    });
  }

  return boardingSchemaReadyPromise;
}

async function buildBoardingReportPayload(classLevel, term, year) {
  const [students] = await pool.query(
    `
    SELECT
      bs.id,
      bs.name,
      bs.gender,
      bs.dob,
      bs.class_level,
      GROUP_CONCAT(bs2.name ORDER BY bs2.name SEPARATOR '||') AS subject_names
    FROM boarding_students bs
    LEFT JOIN boarding_student_subjects bss ON bss.student_id = bs.id
    LEFT JOIN boarding_subjects bs2 ON bs2.id = bss.subject_id
    WHERE bs.class_level = ?
    GROUP BY bs.id, bs.name, bs.gender, bs.dob, bs.class_level
    ORDER BY bs.name ASC
    `,
    [classLevel]
  );

  const [subjectAverages] = await pool.query(
    `
    SELECT
      bm.student_id,
      bm.subject_id,
      s.name AS subject_name,
      AVG(CASE WHEN bm.status = 'Submitted' AND bm.score IS NOT NULL THEN bm.score END) AS average_score,
      SUM(CASE WHEN bm.status = 'Missed' THEN 1 ELSE 0 END) AS missed_count,
      SUM(CASE WHEN bm.status = 'Submitted' AND bm.score IS NOT NULL THEN 1 ELSE 0 END) AS submitted_count
    FROM boarding_marks bm
    JOIN boarding_students bs ON bs.id = bm.student_id
    JOIN boarding_subjects s ON s.id = bm.subject_id
    WHERE bs.class_level = ?
      AND bm.term = ?
      AND bm.year = ?
    GROUP BY bm.student_id, bm.subject_id, s.name
    ORDER BY s.name ASC
    `,
    [classLevel, term, year]
  );

  const averagesByStudent = new Map();
  for (const row of subjectAverages || []) {
    if (!averagesByStudent.has(row.student_id)) averagesByStudent.set(row.student_id, []);
    averagesByStudent.get(row.student_id).push({
      subject: row.subject_name,
      average_score: row.average_score,
      missed_count: Number(row.missed_count || 0),
      submitted_count: Number(row.submitted_count || 0),
    });
  }

  const reports = (students || []).map((student) => {
    const subjectsRegistered = String(student.subject_names || "")
      .split("||")
      .map((value) => value.trim())
      .filter(Boolean);

    const rawRows = averagesByStudent.get(student.id) || [];
    const subjectLookup = new Map(
      rawRows.map((row) => [
        row.subject,
        {
          subject: row.subject,
          average_score: row.average_score === null || row.average_score === undefined ? null : Number(Number(row.average_score).toFixed(2)),
          missed_count: Number(row.missed_count || 0),
          submitted_count: Number(row.submitted_count || 0),
        },
      ])
    );

    const subjectRows = subjectsRegistered.map((subjectName) => {
      const row = subjectLookup.get(subjectName);
      const averageScore = row?.average_score ?? null;
      const missedCount = row?.missed_count ?? 0;
      const submittedCount = row?.submitted_count ?? 0;
      return {
        subject: subjectName,
        average_score: averageScore,
        missed_count: missedCount,
        submitted_count: submittedCount,
        remark: getBoardingSubjectRemark(averageScore, submittedCount, missedCount),
      };
    });

    for (const row of rawRows) {
      if (subjectsRegistered.includes(row.subject)) continue;
      const averageScore = row.average_score === null || row.average_score === undefined ? null : Number(Number(row.average_score).toFixed(2));
      const missedCount = Number(row.missed_count || 0);
      const submittedCount = Number(row.submitted_count || 0);
      subjectRows.push({
        subject: row.subject,
        average_score: averageScore,
        missed_count: missedCount,
        submitted_count: submittedCount,
        remark: getBoardingSubjectRemark(averageScore, submittedCount, missedCount),
      });
    }

    const numericAverages = subjectRows
      .map((row) => Number(row.average_score))
      .filter((value) => Number.isFinite(value));
    const missedAssessmentCount = subjectRows.reduce((sum, row) => sum + Number(row.missed_count || 0), 0);
    const submittedAssessmentCount = subjectRows.reduce((sum, row) => sum + Number(row.submitted_count || 0), 0);

    const overallAverage =
      numericAverages.length > 0
        ? Number((numericAverages.reduce((sum, value) => sum + value, 0) / numericAverages.length).toFixed(2))
        : null;

    return {
      id: student.id,
      name: student.name,
      gender: student.gender,
      dob: student.dob,
      class_level: student.class_level,
      subjects_registered: subjectsRegistered,
      registered_subject_count: subjectsRegistered.length,
      scored_subject_count: numericAverages.length,
      missed_assessment_count: missedAssessmentCount,
      submitted_assessment_count: submittedAssessmentCount,
      rows: subjectRows,
      overall_average: overallAverage,
      overall_comment: "",
      class_position: null,
      class_total: 0,
    };
  });

  const rankedReports = reports
    .filter((report) => Number.isFinite(Number(report.overall_average)))
    .sort((left, right) => {
      const averageGap = Number(right.overall_average) - Number(left.overall_average);
      if (Math.abs(averageGap) > 0.0001) return averageGap;
      return String(left.name || "").localeCompare(String(right.name || ""));
    });

  let rank = 0;
  let lastAverage = null;
  rankedReports.forEach((report, index) => {
    const currentAverage = Number(report.overall_average);
    if (lastAverage === null || Math.abs(currentAverage - lastAverage) > 0.0001) {
      rank = index + 1;
      lastAverage = currentAverage;
    }
    report.class_position = rank;
  });

  const classTotal = reports.length;
  for (const report of reports) {
    report.class_total = classTotal;
    report.overall_comment = getBoardingOverallComment(report);
  }

  return reports;
}

router.post("/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "").trim();
    const expectedUsername = process.env.BOARDING_ADMIN_USERNAME || "boarding";
    const expectedPassword = process.env.BOARDING_ADMIN_PASSWORD || "boarding";

    if (username !== expectedUsername || password !== expectedPassword) {
      return res.status(401).json({ message: "Invalid boarding admin credentials" });
    }

    await ensureBoardingSchemaReady();

    const token = jwt.sign(
      { id: 1, username: expectedUsername, role: "boarding_admin", name: "Boarding Admin" },
      process.env.JWT_SECRET || "dev_secret",
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: {
        id: 1,
        username: expectedUsername,
        name: "Boarding Admin",
        role: "boarding_admin",
      },
    });
  } catch (err) {
    console.error("Boarding admin login error:", err);
    return res.status(500).json({ message: "Boarding admin login failed" });
  }
});

router.get("/me", authBoardingAdmin, async (req, res) => {
  return res.json({
    id: req.boardingAdmin?.id || 1,
    username: req.boardingAdmin?.username || "boarding",
    name: req.boardingAdmin?.name || "Boarding Admin",
  });
});

router.get("/subjects", authBoardingAdmin, async (req, res) => {
  try {
    await ensureBoardingSchemaReady();
    const [rows] = await pool.query(`SELECT id, name, is_optional FROM boarding_subjects ORDER BY name ASC`);
    return res.json(rows || []);
  } catch (err) {
    console.error("Boarding subjects error:", err);
    return res.status(500).json({ message: "Failed to load boarding subjects" });
  }
});

router.get("/stats", authBoardingAdmin, async (req, res) => {
  try {
    await ensureBoardingSchemaReady();
    const [rows] = await pool.query(
      `
      SELECT
        class_level,
        SUM(gender = 'Male') AS boys,
        SUM(gender = 'Female') AS girls,
        COUNT(*) AS total
      FROM boarding_students
      GROUP BY class_level
      ORDER BY FIELD(class_level, 'S1', 'S2', 'S3', 'S4')
      `
    );

    const [[subjectMeta]] = await pool.query(`SELECT COUNT(*) AS total FROM boarding_subjects`);
    return res.json({
      classes: rows || [],
      subjectCount: Number(subjectMeta?.total || 0),
    });
  } catch (err) {
    console.error("Boarding stats error:", err);
    return res.status(500).json({ message: "Failed to load boarding stats" });
  }
});

router.get("/students", authBoardingAdmin, async (req, res) => {
  try {
    await ensureBoardingSchemaReady();
    const classLevel = normalizeClassLevel(req.query.class_level);
    const q = String(req.query.q || "").trim();

    const where = [];
    const params = [];
    if (classLevel) {
      where.push("bs.class_level = ?");
      params.push(classLevel);
    }
    if (q) {
      where.push("bs.name LIKE ?");
      params.push(`%${q}%`);
    }

    const [rows] = await pool.query(
      `
      SELECT
        bs.id,
        bs.name,
        bs.gender,
        bs.dob,
        bs.class_level,
        GROUP_CONCAT(bsub.id ORDER BY bsub.name SEPARATOR ',') AS subject_ids,
        GROUP_CONCAT(bsub.name ORDER BY bsub.name SEPARATOR '||') AS subject_names
      FROM boarding_students bs
      LEFT JOIN boarding_student_subjects bss ON bss.student_id = bs.id
      LEFT JOIN boarding_subjects bsub ON bsub.id = bss.subject_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY bs.id, bs.name, bs.gender, bs.dob, bs.class_level
      ORDER BY FIELD(bs.class_level, 'S1', 'S2', 'S3', 'S4'), bs.name ASC
      `,
      params
    );

    return res.json(
      (rows || []).map((row) => ({
        ...row,
        subject_ids: String(row.subject_ids || "")
          .split(",")
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0),
        subject_names: String(row.subject_names || "")
          .split("||")
          .map((value) => value.trim())
          .filter(Boolean),
      }))
    );
  } catch (err) {
    console.error("Boarding students error:", err);
    return res.status(500).json({ message: "Failed to load boarding students" });
  }
});

router.post("/students", authBoardingAdmin, async (req, res) => {
  let conn;
  try {
    await ensureBoardingSchemaReady();
    const name = String(req.body?.name || "").trim();
    const gender = String(req.body?.gender || "").trim();
    const dob = req.body?.dob ? String(req.body.dob).trim() : null;
    const classLevel = normalizeClassLevel(req.body?.class_level);
    const subjectIds = Array.isArray(req.body?.subject_ids)
      ? req.body.subject_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : [];

    if (!name || !gender || !dob || !BOARDING_CLASSES.includes(classLevel)) {
      return res.status(400).json({ message: "Name, gender, date of birth, and class are required" });
    }

    if (subjectIds.length === 0) {
      return res.status(400).json({ message: "Select at least one subject" });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO boarding_students (name, gender, dob, class_level) VALUES (?, ?, ?, ?)`,
      [name, gender, dob || null, classLevel]
    );

    for (const subjectId of subjectIds) {
      await conn.query(
        `INSERT INTO boarding_student_subjects (student_id, subject_id) VALUES (?, ?)`,
        [result.insertId, subjectId]
      );
    }

    await conn.commit();
    conn.release();
    conn = null;

    return res.status(201).json({ id: result.insertId, message: "Boarding learner created" });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      conn.release();
    }
    console.error("Boarding student create error:", err);
    return res.status(500).json({ message: "Failed to create boarding student" });
  }
});

router.put("/students/:id", authBoardingAdmin, async (req, res) => {
  let conn;
  try {
    await ensureBoardingSchemaReady();
    const studentId = Number(req.params.id);
    const name = String(req.body?.name || "").trim();
    const gender = String(req.body?.gender || "").trim();
    const dob = req.body?.dob ? String(req.body.dob).trim() : null;
    const classLevel = normalizeClassLevel(req.body?.class_level);
    const subjectIds = Array.isArray(req.body?.subject_ids)
      ? req.body.subject_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : [];

    if (!studentId || !name || !gender || !dob || !BOARDING_CLASSES.includes(classLevel)) {
      return res.status(400).json({ message: "Name, gender, date of birth, and class are required" });
    }

    if (subjectIds.length === 0) {
      return res.status(400).json({ message: "Select at least one subject" });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    await conn.query(
      `UPDATE boarding_students SET name = ?, gender = ?, dob = ?, class_level = ? WHERE id = ?`,
      [name, gender, dob || null, classLevel, studentId]
    );
    await conn.query(`DELETE FROM boarding_student_subjects WHERE student_id = ?`, [studentId]);

    for (const subjectId of subjectIds) {
      await conn.query(
        `INSERT INTO boarding_student_subjects (student_id, subject_id) VALUES (?, ?)`,
        [studentId, subjectId]
      );
    }

    await conn.commit();
    conn.release();
    conn = null;

    return res.json({ message: "Boarding learner updated" });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      conn.release();
    }
    console.error("Boarding student update error:", err);
    return res.status(500).json({ message: "Failed to update boarding student" });
  }
});

router.delete("/students/:id", authBoardingAdmin, async (req, res) => {
  try {
    await ensureBoardingSchemaReady();
    const studentId = Number(req.params.id);
    if (!studentId) return res.status(400).json({ message: "Invalid learner id" });
    await pool.query(`DELETE FROM boarding_students WHERE id = ?`, [studentId]);
    return res.status(204).end();
  } catch (err) {
    console.error("Boarding student delete error:", err);
    return res.status(500).json({ message: "Failed to delete boarding student" });
  }
});

router.get("/marks/context", authBoardingAdmin, async (req, res) => {
  try {
    await ensureBoardingSchemaReady();
    const classLevel = normalizeClassLevel(req.query.class_level);
    const subjectId = Number(req.query.subject_id);
    const term = String(req.query.term || "").trim();
    const year = Number(req.query.year);
    const weekendLabel = String(req.query.weekend_label || "").trim();

    if (!BOARDING_CLASSES.includes(classLevel) || !subjectId || !term || !year || !weekendLabel) {
      return res.status(400).json({ message: "class_level, subject_id, term, year and weekend_label are required" });
    }

    const [[subject]] = await pool.query(`SELECT id, name FROM boarding_subjects WHERE id = ?`, [subjectId]);
    if (!subject) return res.status(404).json({ message: "Subject not found" });

    const [rows] = await pool.query(
      `
      SELECT
        bs.id,
        bs.name,
        bs.gender,
        bm.score,
        bm.status,
        bm.assessment_date
      FROM boarding_students bs
      JOIN boarding_student_subjects bss ON bss.student_id = bs.id AND bss.subject_id = ?
      LEFT JOIN boarding_marks bm
        ON bm.student_id = bs.id
       AND bm.subject_id = ?
       AND bm.term = ?
       AND bm.year = ?
       AND bm.weekend_label = ?
      WHERE bs.class_level = ?
      ORDER BY bs.name ASC
      `,
      [subjectId, subjectId, term, year, weekendLabel, classLevel]
    );

    return res.json({
      subject,
      learners: (rows || []).map((row) => ({
        ...row,
        score: row.score === null || row.score === undefined ? "" : row.score,
        status: row.status || "",
      })),
    });
  } catch (err) {
    console.error("Boarding marks context error:", err);
    return res.status(500).json({ message: "Failed to load boarding marks context" });
  }
});

router.post("/marks/save", authBoardingAdmin, async (req, res) => {
  let conn;
  try {
    await ensureBoardingSchemaReady();
    const classLevel = normalizeClassLevel(req.body?.class_level);
    const subjectId = Number(req.body?.subject_id);
    const term = String(req.body?.term || "").trim();
    const year = Number(req.body?.year);
    const weekendLabel = String(req.body?.weekend_label || "").trim();
    const assessmentDate = req.body?.assessment_date ? String(req.body.assessment_date).trim() : null;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (!BOARDING_CLASSES.includes(classLevel) || !subjectId || !term || !year || !weekendLabel) {
      return res.status(400).json({ message: "class_level, subject_id, term, year and weekend_label are required" });
    }

    const invalidRows = rows.filter((row) => {
      const isMissed = String(row.status || "").toLowerCase() === "missed";
      const rawScore = row.score;
      if (isMissed || rawScore === "" || rawScore === null || rawScore === undefined) return false;
      const numericScore = Number(rawScore);
      return !Number.isFinite(numericScore) || numericScore < BOARDING_SCORE_MIN || numericScore > BOARDING_SCORE_MAX;
    });

    if (invalidRows.length > 0) {
      const names = invalidRows
        .slice(0, 5)
        .map((row) => String(row.name || `Learner ${row.student_id || ""}`).trim())
        .filter(Boolean);
      const suffix = invalidRows.length > 5 ? " and others" : "";
      return res.status(400).json({
        message: `Weekend assessment scores must stay between ${BOARDING_SCORE_MIN} and ${BOARDING_SCORE_MAX}. Fix: ${names.join(", ")}${suffix}.`,
      });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    for (const row of rows) {
      const studentId = Number(row.student_id);
      if (!studentId) continue;
      const isMissed = String(row.status || "").toLowerCase() === "missed";
      const numericScore = row.score === "" || row.score === null || row.score === undefined ? null : Number(row.score);

      if (!isMissed && !Number.isFinite(numericScore)) {
        continue;
      }

      await conn.query(
        `
        INSERT INTO boarding_marks (student_id, subject_id, term, year, weekend_label, assessment_date, score, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          assessment_date = VALUES(assessment_date),
          score = VALUES(score),
          status = VALUES(status),
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          studentId,
          subjectId,
          term,
          year,
          weekendLabel,
          assessmentDate || null,
          isMissed ? null : numericScore,
          isMissed ? "Missed" : "Submitted",
        ]
      );
    }

    await conn.commit();
    conn.release();
    conn = null;
    return res.json({ message: "Weekend marks saved" });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch {}
      conn.release();
    }
    console.error("Boarding marks save error:", err);
    return res.status(500).json({ message: "Failed to save boarding marks" });
  }
});

router.get("/reports/term", authBoardingAdmin, async (req, res) => {
  try {
    await ensureBoardingSchemaReady();
    const classLevel = normalizeClassLevel(req.query.class_level);
    const term = String(req.query.term || "").trim();
    const year = Number(req.query.year);

    if (!BOARDING_CLASSES.includes(classLevel) || !term || !year) {
      return res.status(400).json({ message: "class_level, term and year are required" });
    }

    const reports = await buildBoardingReportPayload(classLevel, term, year);
    return res.json({ class_level: classLevel, term, year, reports });
  } catch (err) {
    console.error("Boarding reports error:", err);
    return res.status(500).json({ message: "Failed to load boarding reports" });
  }
});

router.get("/meta", authBoardingAdmin, async (req, res) => {
  try {
    await ensureBoardingSchemaReady();
    return res.json({ classes: BOARDING_CLASSES });
  } catch (err) {
    console.error("Boarding meta error:", err);
    return res.status(500).json({ message: "Failed to load boarding metadata" });
  }
});

export default router;
