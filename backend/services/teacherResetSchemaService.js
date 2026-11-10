const REQUIRED_RESET_TOKEN_LENGTH = 255;

export async function ensureTeacherResetSchemaReady(connection) {
  const [rows] = await connection.query(
    `SELECT column_name, data_type, character_maximum_length
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'teachers'
       AND column_name IN ('reset_token', 'reset_expires')`
  );

  const columns = new Map(
    rows.map((row) => [String(row.column_name || "").toLowerCase(), row])
  );
  const resetToken = columns.get("reset_token");

  if (!resetToken) {
    await connection.query(
      `ALTER TABLE teachers
       ADD COLUMN reset_token VARCHAR(255) NULL DEFAULT NULL`
    );
  } else {
    const dataType = String(resetToken.data_type || "").toLowerCase();
    const maxLength = Number(resetToken.character_maximum_length || 0);
    if (dataType !== "varchar" || maxLength < REQUIRED_RESET_TOKEN_LENGTH) {
      // Legacy databases used a short column that cannot hold a SHA-256 hash.
      await connection.query(
        `ALTER TABLE teachers
         MODIFY COLUMN reset_token VARCHAR(255) NULL DEFAULT NULL`
      );
    }
  }

  if (!columns.has("reset_expires")) {
    await connection.query(
      `ALTER TABLE teachers
       ADD COLUMN reset_expires DATETIME NULL DEFAULT NULL`
    );
  }
}

