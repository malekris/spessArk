let marksArchiveReadyPromise = null;

export async function ensureMarksArchiveTablesReady(executor) {
  if (!executor || typeof executor.query !== "function") {
    throw new Error("A database executor with a query method is required");
  }

  if (!marksArchiveReadyPromise) {
    marksArchiveReadyPromise = (async () => {
      await executor.query(`
        CREATE TABLE IF NOT EXISTS deleted_marks_archive (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          original_mark_id INT DEFAULT NULL,
          teacher_id INT NOT NULL,
          assignment_id INT NOT NULL,
          student_id INT NOT NULL,
          score DECIMAL(5,2) DEFAULT NULL,
          status VARCHAR(20) NOT NULL,
          year INT NOT NULL,
          term VARCHAR(20) NOT NULL,
          aoi_label VARCHAR(20) NOT NULL,
          original_created_at TIMESTAMP NULL DEFAULT NULL,
          original_updated_at TIMESTAMP NULL DEFAULT NULL,
          deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          deleted_by_user_id INT DEFAULT NULL,
          deleted_by_role VARCHAR(20) NOT NULL DEFAULT 'system',
          delete_reason VARCHAR(255) DEFAULT NULL,
          source_action VARCHAR(100) DEFAULT NULL,
          restored_at TIMESTAMP NULL DEFAULT NULL,
          restored_by_user_id INT DEFAULT NULL,
          restored_by_role VARCHAR(20) DEFAULT NULL,
          PRIMARY KEY (id),
          KEY idx_deleted_marks_assignment (assignment_id),
          KEY idx_deleted_marks_student (student_id),
          KEY idx_deleted_marks_deleted_at (deleted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      await executor.query(`
        CREATE TABLE IF NOT EXISTS deleted_alevel_marks_archive (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          original_mark_id INT DEFAULT NULL,
          learner_id INT NOT NULL,
          assignment_id INT DEFAULT NULL,
          subject_id INT DEFAULT NULL,
          exam_id INT DEFAULT NULL,
          score DECIMAL(10,2) DEFAULT NULL,
          teacher_id INT DEFAULT NULL,
          term VARCHAR(50) NOT NULL,
          deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          deleted_by_user_id INT DEFAULT NULL,
          deleted_by_role VARCHAR(20) NOT NULL DEFAULT 'system',
          delete_reason VARCHAR(255) DEFAULT NULL,
          source_action VARCHAR(100) DEFAULT NULL,
          restored_at TIMESTAMP NULL DEFAULT NULL,
          restored_by_user_id INT DEFAULT NULL,
          restored_by_role VARCHAR(20) DEFAULT NULL,
          PRIMARY KEY (id),
          KEY idx_deleted_alevel_assignment (assignment_id),
          KEY idx_deleted_alevel_learner (learner_id),
          KEY idx_deleted_alevel_deleted_at (deleted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      const dbName = process.env.DB_NAME;
      if (dbName) {
        const columnsToEnsure = [
          {
            table: "deleted_marks_archive",
            column: "restored_at",
            alterSql: "ALTER TABLE deleted_marks_archive ADD COLUMN restored_at TIMESTAMP NULL DEFAULT NULL AFTER source_action",
          },
          {
            table: "deleted_marks_archive",
            column: "restored_by_user_id",
            alterSql: "ALTER TABLE deleted_marks_archive ADD COLUMN restored_by_user_id INT DEFAULT NULL AFTER restored_at",
          },
          {
            table: "deleted_marks_archive",
            column: "restored_by_role",
            alterSql: "ALTER TABLE deleted_marks_archive ADD COLUMN restored_by_role VARCHAR(20) DEFAULT NULL AFTER restored_by_user_id",
          },
          {
            table: "deleted_alevel_marks_archive",
            column: "restored_at",
            alterSql: "ALTER TABLE deleted_alevel_marks_archive ADD COLUMN restored_at TIMESTAMP NULL DEFAULT NULL AFTER source_action",
          },
          {
            table: "deleted_alevel_marks_archive",
            column: "restored_by_user_id",
            alterSql: "ALTER TABLE deleted_alevel_marks_archive ADD COLUMN restored_by_user_id INT DEFAULT NULL AFTER restored_at",
          },
          {
            table: "deleted_alevel_marks_archive",
            column: "restored_by_role",
            alterSql: "ALTER TABLE deleted_alevel_marks_archive ADD COLUMN restored_by_role VARCHAR(20) DEFAULT NULL AFTER restored_by_user_id",
          },
        ];

        for (const columnSpec of columnsToEnsure) {
          const [[meta]] = await executor.query(
            `SELECT COUNT(*) AS count
             FROM information_schema.columns
             WHERE table_schema = ?
               AND table_name = ?
               AND column_name = ?`,
            [dbName, columnSpec.table, columnSpec.column]
          );

          if (!Number(meta?.count || 0)) {
            await executor.query(columnSpec.alterSql);
          }
        }
      }
    })().catch((err) => {
      marksArchiveReadyPromise = null;
      throw err;
    });
  }

  return marksArchiveReadyPromise;
}

export async function archiveOLevelMarks(conn, {
  whereSql,
  params = [],
  deletedByUserId = null,
  deletedByRole = "system",
  deleteReason = null,
  sourceAction = null,
}) {
  if (!whereSql) throw new Error("whereSql is required to archive O-Level marks");

  const [result] = await conn.query(
    `
      INSERT INTO deleted_marks_archive (
        original_mark_id,
        teacher_id,
        assignment_id,
        student_id,
        score,
        status,
        year,
        term,
        aoi_label,
        original_created_at,
        original_updated_at,
        deleted_by_user_id,
        deleted_by_role,
        delete_reason,
        source_action
      )
      SELECT
        m.id,
        m.teacher_id,
        m.assignment_id,
        m.student_id,
        m.score,
        m.status,
        m.year,
        m.term,
        CAST(m.aoi_label AS CHAR),
        m.created_at,
        m.updated_at,
        ?,
        ?,
        ?,
        ?
      FROM marks m
      WHERE ${whereSql}
    `,
    [deletedByUserId, deletedByRole, deleteReason, sourceAction, ...params]
  );

  return Number(result?.affectedRows || 0);
}

export async function archiveALevelMarks(conn, {
  whereSql,
  params = [],
  deletedByUserId = null,
  deletedByRole = "system",
  deleteReason = null,
  sourceAction = null,
}) {
  if (!whereSql) throw new Error("whereSql is required to archive A-Level marks");

  const [result] = await conn.query(
    `
      INSERT INTO deleted_alevel_marks_archive (
        original_mark_id,
        learner_id,
        assignment_id,
        subject_id,
        exam_id,
        score,
        teacher_id,
        term,
        deleted_by_user_id,
        deleted_by_role,
        delete_reason,
        source_action
      )
      SELECT
        am.id,
        am.learner_id,
        am.assignment_id,
        am.subject_id,
        am.exam_id,
        am.score,
        am.teacher_id,
        am.term,
        ?,
        ?,
        ?,
        ?
      FROM alevel_marks am
      WHERE ${whereSql}
    `,
    [deletedByUserId, deletedByRole, deleteReason, sourceAction, ...params]
  );

  return Number(result?.affectedRows || 0);
}
