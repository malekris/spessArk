const DEFAULT_TITLE = "A message from Administration";
const DEFAULT_MESSAGE = "Please review this staff notice before continuing to your dashboard.";

const normalizeBoolean = (value) =>
  value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";

export const normalizeTeacherLoginNotice = (value = {}) => ({
  enabled: normalizeBoolean(value.enabled),
  version: String(value.version || "").trim().slice(0, 80),
  title: String(value.title || DEFAULT_TITLE).trim().slice(0, 140) || DEFAULT_TITLE,
  message: String(value.message || DEFAULT_MESSAGE).trim().slice(0, 4000) || DEFAULT_MESSAGE,
  updatedBy: value.updated_by ? Number(value.updated_by) : null,
  updatedAt: value.updated_at || null,
});

const buildNoticeVersion = () => `teacher-notice-${Date.now()}`;

export const ensureTeacherLoginNoticeSchema = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ark_teacher_login_notice_settings (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      version VARCHAR(80) NOT NULL,
      title VARCHAR(140) NOT NULL,
      message TEXT NOT NULL,
      updated_by INT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS ark_teacher_login_notice_acknowledgments (
      teacher_id INT NOT NULL,
      notice_version VARCHAR(80) NOT NULL,
      acknowledged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (teacher_id, notice_version),
      INDEX idx_teacher_notice_ack_version (notice_version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(
    `
    INSERT IGNORE INTO ark_teacher_login_notice_settings
      (id, enabled, version, title, message)
    VALUES (1, 0, ?, ?, ?)
    `,
    [buildNoticeVersion(), DEFAULT_TITLE, DEFAULT_MESSAGE]
  );
};

export const readTeacherLoginNoticeSettings = async (connection) => {
  await ensureTeacherLoginNoticeSchema(connection);
  const [[row]] = await connection.query(
    `
    SELECT enabled, version, title, message, updated_by, updated_at
    FROM ark_teacher_login_notice_settings
    WHERE id = 1
    LIMIT 1
    `
  );

  const settings = normalizeTeacherLoginNotice(row || {});
  const [[delivery]] = await connection.query(
    `
    SELECT COUNT(*) AS acknowledged_count
    FROM ark_teacher_login_notice_acknowledgments
    WHERE notice_version = ?
    `,
    [settings.version]
  );

  return {
    ...settings,
    acknowledgedCount: Number(delivery?.acknowledged_count || 0),
  };
};

export const updateTeacherLoginNoticeSettings = async (connection, payload = {}, updatedBy = null) => {
  const current = await readTeacherLoginNoticeSettings(connection);
  const next = normalizeTeacherLoginNotice({
    enabled: payload.enabled,
    title: payload.title,
    message: payload.message,
  });

  if (next.enabled && !String(payload.message || "").trim()) {
    const error = new Error("Enter the teacher notice before publishing it.");
    error.statusCode = 400;
    throw error;
  }

  const changed =
    Boolean(current.enabled) !== Boolean(next.enabled) ||
    current.title !== next.title ||
    current.message !== next.message;
  const version = changed ? buildNoticeVersion() : current.version || buildNoticeVersion();

  await connection.query(
    `
    UPDATE ark_teacher_login_notice_settings
    SET enabled = ?, version = ?, title = ?, message = ?, updated_by = ?
    WHERE id = 1
    `,
    [next.enabled ? 1 : 0, version, next.title, next.message, updatedBy ? Number(updatedBy) : null]
  );

  return readTeacherLoginNoticeSettings(connection);
};

export const readPendingTeacherLoginNotice = async (connection, teacherId) => {
  const settings = await readTeacherLoginNoticeSettings(connection);
  if (!settings.enabled || !settings.version) return null;

  const [[acknowledgment]] = await connection.query(
    `
    SELECT acknowledged_at
    FROM ark_teacher_login_notice_acknowledgments
    WHERE teacher_id = ? AND notice_version = ?
    LIMIT 1
    `,
    [Number(teacherId), settings.version]
  );

  if (acknowledgment) return null;
  return {
    version: settings.version,
    title: settings.title,
    message: settings.message,
    updatedAt: settings.updatedAt,
  };
};

export const acknowledgeTeacherLoginNotice = async (connection, teacherId, version) => {
  const safeVersion = String(version || "").trim().slice(0, 80);
  if (!safeVersion) {
    const error = new Error("Notice version is required.");
    error.statusCode = 400;
    throw error;
  }

  const current = await readTeacherLoginNoticeSettings(connection);
  if (!current.enabled || safeVersion !== current.version) {
    const error = new Error("This notice has changed. Load the latest notice before continuing.");
    error.statusCode = 409;
    throw error;
  }

  await connection.query(
    `
    INSERT INTO ark_teacher_login_notice_acknowledgments
      (teacher_id, notice_version, acknowledged_at)
    VALUES (?, ?, NOW())
    ON DUPLICATE KEY UPDATE acknowledged_at = acknowledged_at
    `,
    [Number(teacherId), safeVersion]
  );

  return { success: true, version: safeVersion };
};
