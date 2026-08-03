import {
  ALEVEL_ACTIVE_STATUS,
  ALEVEL_ARCHIVED_STATUS,
  ALEVEL_PROMOTION_STREAMS,
  getAlevelPromotionTarget,
  normalizeAlevelStream,
} from "./alevelPromotionRules.js";

let schemaReadyPromise = null;

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const buildPromotionNotes = (notes, ipAddress) => {
  const cleanNotes = String(notes || "").trim();
  const cleanIp = String(ipAddress || "").trim();
  if (cleanNotes && cleanIp) return `${cleanNotes} | IP:${cleanIp}`;
  if (cleanNotes) return cleanNotes;
  if (cleanIp) return `IP:${cleanIp}`;
  return null;
};

async function columnExists(executor, tableName, columnName) {
  const [[row]] = await executor.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?`,
    [tableName, columnName]
  );
  return Number(row?.total || 0) > 0;
}

async function prepareAlevelPromotionSchema(executor) {
  if (!(await columnExists(executor, "alevel_learners", "status"))) {
    await executor.query(
      `ALTER TABLE alevel_learners
       ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'`
    );
  }

  if (!(await columnExists(executor, "alevel_learners", "archived_at"))) {
    await executor.query(
      `ALTER TABLE alevel_learners
       ADD COLUMN archived_at TIMESTAMP NULL DEFAULT NULL`
    );
  }

  if (!(await columnExists(executor, "alevel_learners", "updated_at"))) {
    await executor.query(
      `ALTER TABLE alevel_learners
       ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
    );
  }

  await executor.query(
    `UPDATE alevel_learners
     SET status = 'active'
     WHERE status IS NULL OR TRIM(status) = ''`
  );

  await executor.query(
    `CREATE TABLE IF NOT EXISTS alevel_promotions (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       learner_id INT NOT NULL,
       learner_name VARCHAR(180) NOT NULL,
       from_stream VARCHAR(40) NOT NULL,
       to_stream VARCHAR(40) NOT NULL,
       promotion_type VARCHAR(20) NOT NULL,
       academic_year VARCHAR(20) NOT NULL,
       promoted_by INT NULL,
       promoted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       notes VARCHAR(500) NULL,
       PRIMARY KEY (id),
       UNIQUE KEY uq_alevel_promotion_year (learner_id, academic_year),
       KEY idx_alevel_promotion_year (academic_year),
       KEY idx_alevel_promotion_type (promotion_type),
       KEY idx_alevel_promoted_at (promoted_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

export async function ensureAlevelPromotionSchemaReady(executor) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = prepareAlevelPromotionSchema(executor).catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}

async function fetchCandidates(
  executor,
  { stream, academicYear, lock = false }
) {
  const [rows] = await executor.query(
    `SELECT
       l.id,
       TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))) AS name,
       l.gender,
       l.dob,
       l.house,
       l.stream,
       l.combination,
       COALESCE(NULLIF(l.status, ''), 'active') AS status,
       EXISTS(
         SELECT 1
         FROM alevel_promotions ap
         WHERE ap.learner_id = l.id
           AND ap.academic_year = ?
       ) AS already_promoted,
       (
         SELECT GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ')
         FROM alevel_learner_subjects als
         JOIN alevel_subjects s ON s.id = als.subject_id
         WHERE als.learner_id = l.id
       ) AS subjects
     FROM alevel_learners l
     WHERE l.stream = ?
       AND COALESCE(NULLIF(l.status, ''), 'active') = 'active'
     ORDER BY l.first_name, l.last_name, l.id
     ${lock ? "FOR UPDATE" : ""}`,
    [academicYear, stream]
  );
  return rows || [];
}

const summarizeCandidates = (rows, target, academicYear) => {
  const skipped = { nonActive: 0, alreadyPromoted: 0 };
  const learners = [];

  for (const row of rows) {
    if (String(row.status || ALEVEL_ACTIVE_STATUS).toLowerCase() !== ALEVEL_ACTIVE_STATUS) {
      skipped.nonActive += 1;
      continue;
    }
    if (Number(row.already_promoted || 0) > 0) {
      skipped.alreadyPromoted += 1;
      continue;
    }
    learners.push({
      id: row.id,
      name: row.name,
      gender: row.gender,
      dob: row.dob,
      house: row.house,
      combination: row.combination,
      subjects: row.subjects || "",
      fromStream: row.stream,
      toStream: target.toStream,
      promotionType: target.promotionType,
      academicYear,
    });
  }

  return { learners, skipped };
};

export async function previewAlevelPromotions(
  executor,
  { stream, academicYear }
) {
  await ensureAlevelPromotionSchemaReady(executor);
  const normalizedStream = normalizeAlevelStream(stream);
  const normalizedAcademicYear = String(academicYear || "").trim();
  const target = getAlevelPromotionTarget(normalizedStream);

  if (!target) {
    return {
      ok: false,
      error: "INVALID_ALEVEL_STREAM",
      message: `Choose one of: ${ALEVEL_PROMOTION_STREAMS.join(", ")}`,
    };
  }

  const rows = await fetchCandidates(executor, {
    stream: normalizedStream,
    academicYear: normalizedAcademicYear,
  });
  const { learners, skipped } = summarizeCandidates(
    rows,
    target,
    normalizedAcademicYear
  );

  return {
    ok: true,
    stream: normalizedStream,
    academicYear: normalizedAcademicYear,
    target,
    totalCandidates: rows.length,
    eligibleCount: learners.length,
    skipped,
    learners,
  };
}

export async function executeAlevelPromotions(
  connectionPool,
  { stream, academicYear, adminUserId, ipAddress, notes = "" }
) {
  await ensureAlevelPromotionSchemaReady(connectionPool);
  const normalizedStream = normalizeAlevelStream(stream);
  const normalizedAcademicYear = String(academicYear || "").trim();
  const target = getAlevelPromotionTarget(normalizedStream);

  if (!target) {
    return {
      ok: false,
      error: "INVALID_ALEVEL_STREAM",
      message: `Choose one of: ${ALEVEL_PROMOTION_STREAMS.join(", ")}`,
    };
  }

  const conn = await connectionPool.getConnection();
  try {
    await conn.beginTransaction();
    const rows = await fetchCandidates(conn, {
      stream: normalizedStream,
      academicYear: normalizedAcademicYear,
      lock: true,
    });
    const { learners, skipped } = summarizeCandidates(
      rows,
      target,
      normalizedAcademicYear
    );
    const historyIds = [];
    let promotedCount = 0;
    let archivedCount = 0;

    for (const learner of learners) {
      try {
        const [historyResult] = await conn.query(
          `INSERT INTO alevel_promotions
             (learner_id, learner_name, from_stream, to_stream, promotion_type, academic_year, promoted_by, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            learner.id,
            learner.name,
            learner.fromStream,
            learner.toStream,
            learner.promotionType,
            normalizedAcademicYear,
            toPositiveInt(adminUserId, 1),
            buildPromotionNotes(notes, ipAddress),
          ]
        );
        historyIds.push(historyResult.insertId);
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") {
          skipped.alreadyPromoted += 1;
          continue;
        }
        throw error;
      }

      if (target.nextStatus === ALEVEL_ARCHIVED_STATUS) {
        await conn.query(
          `UPDATE alevel_learners
           SET status = 'archived', archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [learner.id]
        );
        archivedCount += 1;
      } else {
        await conn.query(
          `UPDATE alevel_learners
           SET stream = ?, status = 'active', archived_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [target.toStream, learner.id]
        );
        promotedCount += 1;
      }
    }

    await conn.commit();
    return {
      ok: true,
      stream: normalizedStream,
      academicYear: normalizedAcademicYear,
      target,
      totalCandidates: rows.length,
      processedCount: promotedCount + archivedCount,
      promotedCount,
      archivedCount,
      skipped,
      historyIds,
      marksDeleted: 0,
      subjectRegistrationsChanged: 0,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function getArchivedAlevelLearners(
  executor,
  { search = "", academicYear = "", page = 1, limit = 25 }
) {
  await ensureAlevelPromotionSchemaReady(executor);
  const safePage = toPositiveInt(page, 1);
  const safeLimit = Math.min(100, toPositiveInt(limit, 25));
  const offset = (safePage - 1) * safeLimit;
  const conditions = ["l.status = 'archived'"];
  const params = [];
  const cleanSearch = String(search || "").trim();
  const cleanYear = String(academicYear || "").trim();

  if (cleanSearch) {
    conditions.push(
      "(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, '')) LIKE ? OR l.id = ?)"
    );
    params.push(`%${cleanSearch}%`, toPositiveInt(cleanSearch, -1));
  }
  if (cleanYear) {
    conditions.push("latest.academic_year = ?");
    params.push(cleanYear);
  }

  const latestPromotionJoin = `
    LEFT JOIN (
      SELECT ap1.learner_id, ap1.academic_year, ap1.promoted_at
      FROM alevel_promotions ap1
      JOIN (
        SELECT learner_id, MAX(id) AS max_id
        FROM alevel_promotions
        WHERE promotion_type = 'GRADUATED'
        GROUP BY learner_id
      ) newest ON newest.max_id = ap1.id
    ) latest ON latest.learner_id = l.id`;
  const whereSql = `WHERE ${conditions.join(" AND ")}`;

  const [[countRow]] = await executor.query(
    `SELECT COUNT(*) AS total
     FROM alevel_learners l
     ${latestPromotionJoin}
     ${whereSql}`,
    params
  );
  const total = Number(countRow?.total || 0);

  const [rows] = await executor.query(
    `SELECT
       l.id,
       TRIM(CONCAT(COALESCE(l.first_name, ''), ' ', COALESCE(l.last_name, ''))) AS name,
       l.gender,
       l.dob,
       l.house,
       l.stream,
       l.combination,
       l.status,
       l.archived_at AS archivedAt,
       latest.academic_year AS graduatedAcademicYear,
       latest.promoted_at AS graduatedAt,
       (
         SELECT GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ')
         FROM alevel_learner_subjects als
         JOIN alevel_subjects s ON s.id = als.subject_id
         WHERE als.learner_id = l.id
       ) AS subjects
     FROM alevel_learners l
     ${latestPromotionJoin}
     ${whereSql}
     ORDER BY COALESCE(latest.promoted_at, l.archived_at) DESC, l.id DESC
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, offset]
  );

  return {
    rows: rows || [],
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

export async function getAlevelPromotionHistory(
  executor,
  { academicYear = "", page = 1, limit = 25 }
) {
  await ensureAlevelPromotionSchemaReady(executor);
  const safePage = toPositiveInt(page, 1);
  const safeLimit = Math.min(100, toPositiveInt(limit, 25));
  const offset = (safePage - 1) * safeLimit;
  const cleanYear = String(academicYear || "").trim();
  const whereSql = cleanYear ? "WHERE academic_year = ?" : "";
  const params = cleanYear ? [cleanYear] : [];

  const [[countRow]] = await executor.query(
    `SELECT COUNT(*) AS total FROM alevel_promotions ${whereSql}`,
    params
  );
  const total = Number(countRow?.total || 0);
  const [rows] = await executor.query(
    `SELECT
       id,
       learner_id AS learnerId,
       learner_name AS learnerName,
       from_stream AS fromStream,
       to_stream AS toStream,
       promotion_type AS promotionType,
       academic_year AS academicYear,
       promoted_by AS promotedBy,
       promoted_at AS promotedAt,
       notes
     FROM alevel_promotions
     ${whereSql}
     ORDER BY promoted_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, offset]
  );

  return {
    rows: rows || [],
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}
