const DEFAULT_MAINTENANCE_TITLE = "SPESS ARK is under maintenance";
const DEFAULT_MAINTENANCE_MESSAGE =
  "Teacher access is temporarily paused while the system is being updated. Please try again shortly.";

const normalizeBoolean = (value) =>
  value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";

export const publicMaintenancePayload = (settings = {}) => ({
  enabled: Boolean(settings.enabled),
  title: settings.title || DEFAULT_MAINTENANCE_TITLE,
  message: settings.message || DEFAULT_MAINTENANCE_MESSAGE,
  eta: settings.eta || "",
  updatedAt: settings.updatedAt || null,
});

const ensureMaintenanceSettingsTable = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ark_maintenance_settings (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      title VARCHAR(160) NOT NULL DEFAULT '${DEFAULT_MAINTENANCE_TITLE.replace(/'/g, "''")}',
      message TEXT NULL,
      eta VARCHAR(160) NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(
    `
    INSERT IGNORE INTO ark_maintenance_settings (id, enabled, title, message, eta)
    VALUES (1, 0, ?, ?, '')
    `,
    [DEFAULT_MAINTENANCE_TITLE, DEFAULT_MAINTENANCE_MESSAGE]
  );
};

export const readMaintenanceSettings = async (connection) => {
  await ensureMaintenanceSettingsTable(connection);
  const [[row]] = await connection.query(
    `
    SELECT enabled, title, message, eta, updated_at AS updatedAt
    FROM ark_maintenance_settings
    WHERE id = 1
    LIMIT 1
    `
  );

  return publicMaintenancePayload({
    enabled: normalizeBoolean(row?.enabled),
    title: row?.title,
    message: row?.message,
    eta: row?.eta,
    updatedAt: row?.updatedAt,
  });
};

export const updateMaintenanceSettings = async (connection, payload = {}) => {
  await ensureMaintenanceSettingsTable(connection);

  const enabled = normalizeBoolean(payload.enabled);
  const title = String(payload.title || DEFAULT_MAINTENANCE_TITLE).trim().slice(0, 160);
  const message = String(payload.message || DEFAULT_MAINTENANCE_MESSAGE).trim().slice(0, 1200);
  const eta = String(payload.eta || "").trim().slice(0, 160);

  await connection.query(
    `
    UPDATE ark_maintenance_settings
    SET enabled = ?, title = ?, message = ?, eta = ?
    WHERE id = 1
    `,
    [enabled ? 1 : 0, title || DEFAULT_MAINTENANCE_TITLE, message || DEFAULT_MAINTENANCE_MESSAGE, eta]
  );

  return readMaintenanceSettings(connection);
};
