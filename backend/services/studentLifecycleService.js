const ACTIVE_STATUS = "active";
const PAUSED_STATUS = "inactive";

let lifecycleReadyPromise = null;

async function columnExists(connection, tableName, columnName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?`,
    [tableName, columnName]
  );

  return Number(row?.total || 0) > 0;
}

async function prepareStudentLifecycleColumns(connection) {
  if (!(await columnExists(connection, "students", "status"))) {
    await connection.query(
      `ALTER TABLE students
       ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER subjects`
    );
  }

  if (!(await columnExists(connection, "students", "updated_at"))) {
    await connection.query(
      `ALTER TABLE students
       ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
       ON UPDATE CURRENT_TIMESTAMP AFTER created_at`
    );
  }

  await connection.query(
    `UPDATE students
     SET status = 'active'
     WHERE status IS NULL OR TRIM(status) = ''`
  );
}

export async function ensureStudentLifecycleColumns(connection) {
  if (!lifecycleReadyPromise) {
    lifecycleReadyPromise = prepareStudentLifecycleColumns(connection).catch((error) => {
      lifecycleReadyPromise = null;
      throw error;
    });
  }

  return lifecycleReadyPromise;
}

export function normalizeStudentLifecycleStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === ACTIVE_STATUS) return ACTIVE_STATUS;
  if (normalized === PAUSED_STATUS || normalized === "paused") return PAUSED_STATUS;
  return null;
}

export function isActiveStudentRecord(student) {
  return String(student?.status || ACTIVE_STATUS).trim().toLowerCase() === ACTIVE_STATUS;
}

export const STUDENT_LIFECYCLE = Object.freeze({
  ACTIVE: ACTIVE_STATUS,
  PAUSED: PAUSED_STATUS,
});
