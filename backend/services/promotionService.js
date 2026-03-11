import { pool } from "../server.js";

const VALID_CLASSES = ["S1", "S2", "S3", "S4"];
const STATUS_ACTIVE = "active";
const STATUS_GRADUATED = "graduated";

const PROMOTION_MAP = Object.freeze({
  S1: "S2",
  S2: "S3",
  S3: "S4",
  S4: "Graduated",
});

const toPositiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const normalizeClassLevel = (value) => String(value || "").trim().toUpperCase();
const normalizeStream = (value) => String(value || "").trim();

const buildPromotionNotes = (notes, ipAddress) => {
  const cleanNotes = String(notes || "").trim();
  const cleanIp = String(ipAddress || "").trim();
  if (cleanNotes && cleanIp) return `${cleanNotes} | IP:${cleanIp}`;
  if (cleanNotes) return cleanNotes;
  if (cleanIp) return `IP:${cleanIp}`;
  return null;
};

/**
 * Returns promotion target while preserving stream (except graduation).
 */
export function getPromotionTarget(classLevel, stream) {
  const normalizedClassLevel = normalizeClassLevel(classLevel);
  const normalizedStream = normalizeStream(stream);
  const nextClassLevel = PROMOTION_MAP[normalizedClassLevel];

  if (!nextClassLevel) return null;

  if (nextClassLevel === "Graduated") {
    return {
      fromClassLevel: normalizedClassLevel,
      fromStream: normalizedStream,
      toClassLevel: "Graduated",
      toStream: "Graduated",
      promotionType: "GRADUATED",
    };
  }

  return {
    fromClassLevel: normalizedClassLevel,
    fromStream: normalizedStream,
    toClassLevel: nextClassLevel,
    toStream: normalizedStream,
    promotionType: "PROMOTED",
  };
}

const buildEligibilitySummary = (rows = [], academicYear, target) => {
  const eligible = [];
  const skipped = {
    nonActive: 0,
    invalidClassLevel: 0,
    alreadyPromoted: 0,
    alreadyGraduated: 0,
  };

  for (const row of rows) {
    const rowClass = normalizeClassLevel(row.class_level);
    const rowStatus = String(row.status || STATUS_ACTIVE).trim().toLowerCase();
    const alreadyPromoted = Number(row.already_promoted || 0) > 0;

    if (!VALID_CLASSES.includes(rowClass)) {
      skipped.invalidClassLevel += 1;
      continue;
    }
    if (rowClass === "S4" && rowStatus === STATUS_GRADUATED) {
      skipped.alreadyGraduated += 1;
      continue;
    }
    if (rowStatus !== STATUS_ACTIVE) {
      skipped.nonActive += 1;
      continue;
    }
    if (alreadyPromoted) {
      skipped.alreadyPromoted += 1;
      continue;
    }

    eligible.push({
      id: row.id,
      name: row.name,
      gender: row.gender,
      dob: row.dob,
      fromClassLevel: row.class_level,
      fromStream: row.stream,
      toClassLevel: target.toClassLevel,
      toStream: target.toStream,
      promotionType: target.promotionType,
      status: rowStatus,
      academicYear,
    });
  }

  return { eligible, skipped };
};

const fetchPromotionCandidates = async (conn, { classLevel, stream, academicYear, lock = false }) => {
  const lockClause = lock ? " FOR UPDATE" : "";
  const [rows] = await conn.query(
    `
    SELECT
      s.id,
      s.name,
      s.gender,
      s.dob,
      s.class_level,
      s.stream,
      COALESCE(s.status, 'active') AS status,
      EXISTS(
        SELECT 1
        FROM student_promotions sp
        WHERE sp.student_id = s.id
          AND sp.academic_year = ?
      ) AS already_promoted
    FROM students s
    WHERE s.class_level = ?
      AND s.stream = ?
    ORDER BY s.name ASC
    ${lockClause}
    `,
    [academicYear, classLevel, stream]
  );
  return rows;
};

export async function previewPromotions({ classLevel, stream, academicYear }) {
  const normalizedClassLevel = normalizeClassLevel(classLevel);
  const normalizedStream = normalizeStream(stream);
  const normalizedAcademicYear = String(academicYear || "").trim();

  const target = getPromotionTarget(normalizedClassLevel, normalizedStream);
  if (!target) {
    return {
      ok: false,
      error: "INVALID_CLASS_LEVEL",
      message: `Invalid class_level '${classLevel}'. Expected one of: ${VALID_CLASSES.join(", ")}`,
      validClasses: VALID_CLASSES,
      classLevel: normalizedClassLevel,
      stream: normalizedStream,
      academicYear: normalizedAcademicYear,
    };
  }

  const rows = await fetchPromotionCandidates(pool, {
    classLevel: normalizedClassLevel,
    stream: normalizedStream,
    academicYear: normalizedAcademicYear,
    lock: false,
  });

  const { eligible, skipped } = buildEligibilitySummary(rows, normalizedAcademicYear, target);

  return {
    ok: true,
    classLevel: normalizedClassLevel,
    stream: normalizedStream,
    academicYear: normalizedAcademicYear,
    target,
    totalCandidates: rows.length,
    eligibleCount: eligible.length,
    skipped,
    learners: eligible,
  };
}

export async function executePromotions({
  classLevel,
  stream,
  academicYear,
  adminUserId,
  ipAddress,
  notes = "",
}) {
  const normalizedClassLevel = normalizeClassLevel(classLevel);
  const normalizedStream = normalizeStream(stream);
  const normalizedAcademicYear = String(academicYear || "").trim();
  const normalizedAdminUserId = toPositiveInt(adminUserId, 1);

  const target = getPromotionTarget(normalizedClassLevel, normalizedStream);
  if (!target) {
    return {
      ok: false,
      error: "INVALID_CLASS_LEVEL",
      message: `Invalid class_level '${classLevel}'. Expected one of: ${VALID_CLASSES.join(", ")}`,
      validClasses: VALID_CLASSES,
    };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const rows = await fetchPromotionCandidates(conn, {
      classLevel: normalizedClassLevel,
      stream: normalizedStream,
      academicYear: normalizedAcademicYear,
      lock: true,
    });

    const { eligible, skipped } = buildEligibilitySummary(rows, normalizedAcademicYear, target);

    const notesWithIp = buildPromotionNotes(notes, ipAddress);
    const historyIds = [];
    let promotedCount = 0;
    let graduatedCount = 0;

    for (const learner of eligible) {
      try {
        const [insertResult] = await conn.query(
          `
          INSERT INTO student_promotions
            (student_id, student_name, from_class_level, from_stream, to_class_level, to_stream, promotion_type, academic_year, promoted_by, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            learner.id,
            learner.name,
            learner.fromClassLevel,
            learner.fromStream,
            learner.toClassLevel,
            learner.toStream,
            learner.promotionType,
            normalizedAcademicYear,
            normalizedAdminUserId,
            notesWithIp,
          ]
        );

        historyIds.push(insertResult.insertId);
      } catch (err) {
        // Duplicate promotion attempt in same year: skip safely.
        if (err?.code === "ER_DUP_ENTRY") {
          skipped.alreadyPromoted += 1;
          continue;
        }
        throw err;
      }

      const nextStatus =
        learner.promotionType === "GRADUATED" ? STATUS_GRADUATED : STATUS_ACTIVE;

      await conn.query(
        `
        UPDATE students
        SET
          class_level = ?,
          stream = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [learner.toClassLevel, learner.toStream, nextStatus, learner.id]
      );

      if (learner.promotionType === "GRADUATED") graduatedCount += 1;
      else promotedCount += 1;
    }

    await conn.commit();

    return {
      ok: true,
      classLevel: normalizedClassLevel,
      stream: normalizedStream,
      academicYear: normalizedAcademicYear,
      target,
      totalCandidates: rows.length,
      processedCount: promotedCount + graduatedCount,
      promotedCount,
      graduatedCount,
      skipped,
      historyIds,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getGraduatedStudents({
  search = "",
  academicYear = "",
  page = 1,
  limit = 25,
}) {
  const safePage = toPositiveInt(page, 1);
  const safeLimit = toPositiveInt(limit, 25);
  const offset = (safePage - 1) * safeLimit;

  const where = ["s.status = 'graduated'"];
  const params = [];

  const normalizedSearch = String(search || "").trim();
  if (normalizedSearch) {
    where.push("(s.name LIKE ? OR s.id = ?)");
    params.push(`%${normalizedSearch}%`, toPositiveInt(normalizedSearch, -1));
  }

  const normalizedAcademicYear = String(academicYear || "").trim();
  if (normalizedAcademicYear) {
    where.push("g.academic_year = ?");
    params.push(normalizedAcademicYear);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [countRows] = await pool.query(
    `
    SELECT COUNT(*) AS total
    FROM students s
    LEFT JOIN (
      SELECT sp1.student_id, sp1.academic_year, sp1.promoted_at
      FROM student_promotions sp1
      JOIN (
        SELECT student_id, MAX(id) AS max_id
        FROM student_promotions
        WHERE promotion_type = 'GRADUATED'
        GROUP BY student_id
      ) latest ON latest.max_id = sp1.id
    ) g ON g.student_id = s.id
    ${whereSql}
    `,
    params
  );
  const total = Number(countRows?.[0]?.total || 0);

  const [rows] = await pool.query(
    `
    SELECT
      s.id,
      s.name,
      s.gender,
      s.dob,
      s.class_level,
      s.stream,
      s.status,
      s.created_at,
      s.updated_at,
      g.academic_year AS graduatedAcademicYear,
      g.promoted_at AS graduatedAt
    FROM students s
    LEFT JOIN (
      SELECT sp1.student_id, sp1.academic_year, sp1.promoted_at
      FROM student_promotions sp1
      JOIN (
        SELECT student_id, MAX(id) AS max_id
        FROM student_promotions
        WHERE promotion_type = 'GRADUATED'
        GROUP BY student_id
      ) latest ON latest.max_id = sp1.id
    ) g ON g.student_id = s.id
    ${whereSql}
    ORDER BY g.promoted_at DESC, s.updated_at DESC, s.id DESC
    LIMIT ? OFFSET ?
    `,
    [...params, safeLimit, offset]
  );

  return {
    rows,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

export async function getPromotionHistory({
  academicYear = "",
  page = 1,
  limit = 25,
}) {
  const safePage = toPositiveInt(page, 1);
  const safeLimit = toPositiveInt(limit, 25);
  const offset = (safePage - 1) * safeLimit;

  const where = [];
  const params = [];
  const normalizedAcademicYear = String(academicYear || "").trim();
  if (normalizedAcademicYear) {
    where.push("sp.academic_year = ?");
    params.push(normalizedAcademicYear);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM student_promotions sp ${whereSql}`,
    params
  );
  const total = Number(countRows?.[0]?.total || 0);

  const [rows] = await pool.query(
    `
    SELECT
      sp.id,
      sp.student_id AS studentId,
      sp.student_name AS studentName,
      sp.from_class_level AS fromClassLevel,
      sp.from_stream AS fromStream,
      sp.to_class_level AS toClassLevel,
      sp.to_stream AS toStream,
      sp.promotion_type AS promotionType,
      sp.academic_year AS academicYear,
      sp.promoted_by AS promotedBy,
      sp.promoted_at AS promotedAt,
      sp.notes
    FROM student_promotions sp
    ${whereSql}
    ORDER BY sp.promoted_at DESC, sp.id DESC
    LIMIT ? OFFSET ?
    `,
    [...params, safeLimit, offset]
  );

  return {
    rows,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

