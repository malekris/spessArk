import { parseStoredSubjects } from "./reportSubjectRegistration.js";
import {
  normalizeOptionalSubject,
  OPTIONAL_SUBJECT_CATEGORIES,
} from "./optionalSubjectPredictor.js";

const schemaReadyByPool = new WeakMap();

const selectionError = (message) => {
  const error = new Error(message);
  error.code = "INVALID_OPTIONAL_SUBJECT_SELECTION";
  return error;
};

/**
 * Create the permanent S2 register on first use. A learner has one editable
 * Category A/Category B decision for each academic year.
 */
export function ensureOptionalSubjectSelectionSchemaReady(pool) {
  if (!schemaReadyByPool.has(pool)) {
    const ready = pool.query(`
      CREATE TABLE IF NOT EXISTS s2_optional_subject_selections (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        student_id INT NOT NULL,
        academic_year SMALLINT UNSIGNED NOT NULL,
        class_level VARCHAR(10) NOT NULL DEFAULT 'S2',
        stream VARCHAR(50) NOT NULL,
        category_a_subject VARCHAR(120) NULL,
        category_b_subject VARCHAR(120) NULL,
        updated_by_admin_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_s2_optional_selection_student_year (student_id, academic_year),
        KEY idx_s2_optional_selection_stream_year (class_level, stream, academic_year)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).catch((error) => {
      schemaReadyByPool.delete(pool);
      throw error;
    });
    schemaReadyByPool.set(pool, ready);
  }

  return schemaReadyByPool.get(pool);
}

export function getRegisteredOptionalSubjects(subjects) {
  return Array.from(
    new Set(parseStoredSubjects(subjects).map(normalizeOptionalSubject).filter(Boolean))
  );
}

/**
 * Resolve a submitted value to its canonical subject and enforce both the
 * category boundary and the learner's current subject registration.
 */
export function validateManualOptionalSubjectSelection({ subjects, category, value }) {
  const requested = String(value || "").trim();
  if (!requested) return null;

  const normalizedCategory = String(category || "").trim().toUpperCase();
  const categorySubjects = OPTIONAL_SUBJECT_CATEGORIES[normalizedCategory];
  if (!categorySubjects) throw selectionError("Invalid optional-subject category.");

  const subject = normalizeOptionalSubject(requested);
  if (!subject || !categorySubjects.includes(subject)) {
    throw selectionError(`${requested} is not a Category ${normalizedCategory} subject.`);
  }

  const registeredSubjects = getRegisteredOptionalSubjects(subjects);
  if (!registeredSubjects.includes(subject)) {
    throw selectionError(`${subject} is not currently registered by this learner.`);
  }

  return subject;
}

export async function readOptionalSubjectSelections(pool, { learnerIds = [], academicYear }) {
  const ids = learnerIds.map(Number).filter(Number.isInteger);
  if (ids.length === 0) return new Map();

  await ensureOptionalSubjectSelectionSchemaReady(pool);
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await pool.query(
    `SELECT
       student_id AS studentId,
       academic_year AS academicYear,
       class_level AS classLevel,
       stream,
       category_a_subject AS categoryA,
       category_b_subject AS categoryB,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM s2_optional_subject_selections
     WHERE academic_year = ?
       AND student_id IN (${placeholders})`,
    [academicYear, ...ids]
  );

  return new Map(rows.map((row) => [Number(row.studentId), row]));
}

export async function saveOptionalSubjectSelection(
  pool,
  {
    learnerId,
    academicYear,
    stream,
    categoryA = null,
    categoryB = null,
    updatedByAdminId = null,
  }
) {
  await ensureOptionalSubjectSelectionSchemaReady(pool);
  await pool.query(
    `INSERT INTO s2_optional_subject_selections
       (student_id, academic_year, class_level, stream,
        category_a_subject, category_b_subject, updated_by_admin_id)
     VALUES (?, ?, 'S2', ?, ?, ?, ?) AS incoming
     ON DUPLICATE KEY UPDATE
       class_level = 'S2',
       stream = incoming.stream,
       category_a_subject = incoming.category_a_subject,
       category_b_subject = incoming.category_b_subject,
       updated_by_admin_id = incoming.updated_by_admin_id,
       updated_at = CURRENT_TIMESTAMP`,
    [learnerId, academicYear, stream, categoryA, categoryB, updatedByAdminId]
  );

  const [[row]] = await pool.query(
    `SELECT
       student_id AS studentId,
       academic_year AS academicYear,
       class_level AS classLevel,
       stream,
       category_a_subject AS categoryA,
       category_b_subject AS categoryB,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM s2_optional_subject_selections
     WHERE student_id = ? AND academic_year = ?
     LIMIT 1`,
    [learnerId, academicYear]
  );

  return row;
}
