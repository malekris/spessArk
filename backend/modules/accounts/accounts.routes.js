import express from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import multer from "multer";
import { pool } from "../../server.js";
import authAccountsAdmin from "../../middleware/authAccountsAdmin.js";
import { createDatabaseRateLimit } from "../../middleware/databaseRateLimit.js";
import { getJwtSecret, requireSecret } from "../../config/security.js";
import { getSessionExpiry, resolveRequestedSessionMode } from "../../utils/deviceSession.js";
import { extractClientIp, logAuditEvent } from "../../utils/auditLogger.js";
import { sendAccountsResetCodeEmail } from "../../utils/email.js";
import {
  deleteAccountsAvatar,
  isAccountsAvatarStorageReady,
  uploadAccountsAvatar,
} from "../../services/accountsAvatarStorage.js";
import {
  ACCOUNTS_CLASSES,
  ACCOUNTS_TERMS,
  buildPaymentTransaction,
  getLearnerLevelForClass,
  isValidAccountsEmail,
  isValidAccountsPassword,
  normalizeAccountsClass,
  normalizeAccountsEmail,
  normalizeAccountsTerm,
  normalizeResidenceType,
  parseMoneyAmount,
  safeCredentialEquals,
} from "./accounts.service.js";

const router = express.Router();
const limitAccountsLogin = createDatabaseRateLimit(() => pool, {
  namespace: "accounts-login",
  max: 5,
  account: (req) => req.body?.username,
});
const limitAccountsRegistration = createDatabaseRateLimit(() => pool, {
  namespace: "accounts-registration",
  max: 5,
  account: (req) => req.body?.email,
});
const limitAccountsReset = createDatabaseRateLimit(() => pool, {
  namespace: "accounts-password-reset",
  max: 5,
  account: (req) => req.body?.email,
});
const limitAccountsPasswordChange = createDatabaseRateLimit(() => pool, {
  namespace: "accounts-password-change",
  max: 8,
  account: (req) => req.accountsAdmin?.id,
});
const receiveAccountsAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4, parts: 6 },
}).single("avatar");
const parseAccountsAvatar = (req, res, next) => {
  receiveAccountsAvatar(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "Profile photo must be 5 MB or smaller." });
    }
    return res.status(400).json({ message: "Could not read that profile photo." });
  });
};
const INVALID_ACCOUNTS_PASSWORD_HASH = bcrypt.hashSync("spess-accounts-invalid-password", 12);
// Accounts staff use a dedicated audit ID range so their activity can never be
// confused with older Owner logs that used the main administrator ID.
const ACCOUNTS_AUDIT_STAFF_OFFSET = 1_000_000;

let accountsSchemaReadyPromise = null;

async function ensureAccountsSchemaReady() {
  if (!accountsSchemaReadyPromise) {
    accountsSchemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS accounts_fee_settings (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          academic_year INT NOT NULL,
          term VARCHAR(20) NOT NULL,
          class_level VARCHAR(10) NOT NULL,
          stream VARCHAR(100) NOT NULL,
          day_amount DECIMAL(12,2) NOT NULL,
          boarding_amount DECIMAL(12,2) NOT NULL,
          updated_by VARCHAR(100) DEFAULT NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_accounts_fee_scope (academic_year, term, class_level, stream),
          KEY idx_accounts_fee_stream (class_level, stream, academic_year, term)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS accounts_learner_payments (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          learner_level ENUM('O_LEVEL','A_LEVEL') NOT NULL,
          learner_id INT NOT NULL,
          learner_name_snapshot VARCHAR(180) NOT NULL,
          class_level_snapshot VARCHAR(10) NOT NULL,
          stream_snapshot VARCHAR(100) NOT NULL,
          academic_year INT NOT NULL,
          term VARCHAR(20) NOT NULL,
          residence_type ENUM('Day','Boarding') NOT NULL,
          expected_amount_snapshot DECIMAL(12,2) NOT NULL,
          amount_paid DECIMAL(12,2) DEFAULT NULL,
          updated_by VARCHAR(100) DEFAULT NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_accounts_learner_term (learner_level, learner_id, academic_year, term),
          KEY idx_accounts_payment_scope (academic_year, term, class_level_snapshot, stream_snapshot),
          KEY idx_accounts_payment_learner (learner_level, learner_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      // Unlike accounts_learner_payments, this table is append-only. It keeps
      // each fee change available for the live transaction feed and audit.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS accounts_payment_transactions (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          learner_level ENUM('O_LEVEL','A_LEVEL') NOT NULL,
          learner_id INT NOT NULL,
          learner_name_snapshot VARCHAR(180) NOT NULL,
          class_level_snapshot VARCHAR(10) NOT NULL,
          stream_snapshot VARCHAR(100) NOT NULL,
          academic_year INT NOT NULL,
          term VARCHAR(20) NOT NULL,
          residence_type ENUM('Day','Boarding') NOT NULL,
          previous_amount DECIMAL(12,2) DEFAULT NULL,
          new_amount DECIMAL(12,2) DEFAULT NULL,
          amount_change DECIMAL(12,2) NOT NULL DEFAULT 0,
          transaction_type VARCHAR(30) NOT NULL,
          recorded_by_user_id BIGINT UNSIGNED DEFAULT NULL,
          recorded_by_role VARCHAR(40) NOT NULL,
          recorded_by_name VARCHAR(160) NOT NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_accounts_transaction_recent (created_at, id),
          KEY idx_accounts_transaction_learner (learner_level, learner_id, academic_year, term)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS accounts_users (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          name VARCHAR(160) NOT NULL,
          email VARCHAR(190) NOT NULL,
          avatar_url VARCHAR(1000) DEFAULT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role ENUM('bursar') NOT NULL DEFAULT 'bursar',
          status ENUM('pending','active','suspended','rejected') NOT NULL DEFAULT 'pending',
          reset_token VARCHAR(255) DEFAULT NULL,
          reset_expires DATETIME DEFAULT NULL,
          approved_by VARCHAR(100) DEFAULT NULL,
          approved_at DATETIME DEFAULT NULL,
          last_login_at DATETIME DEFAULT NULL,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_accounts_user_email (email),
          KEY idx_accounts_user_status (status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      // Existing deployments already have accounts_users. Add profile support
      // in place without requiring a manual Railway migration.
      const [[avatarColumn]] = await pool.query(`
        SELECT COUNT(*) AS count
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'accounts_users'
          AND COLUMN_NAME = 'avatar_url'
      `);
      if (!Number(avatarColumn?.count || 0)) {
        await pool.query("ALTER TABLE accounts_users ADD COLUMN avatar_url VARCHAR(1000) DEFAULT NULL AFTER email");
      }
    })().catch((error) => {
      accountsSchemaReadyPromise = null;
      throw error;
    });
  }
  return accountsSchemaReadyPromise;
}

// A single read model keeps the live feed and search screens consistent. Rows
// saved before the append-only ledger existed remain visible as legacy entries.
const PAYMENT_ACTIVITY_SOURCE_SQL = `
  SELECT
    apt.id,
    'ledger' AS source,
    apt.learner_level,
    apt.learner_id,
    apt.learner_name_snapshot AS learner_name,
    apt.class_level_snapshot AS class_level,
    apt.stream_snapshot AS stream,
    apt.academic_year,
    apt.term,
    apt.residence_type,
    apt.previous_amount,
    apt.new_amount,
    apt.amount_change,
    apt.transaction_type,
    apt.recorded_by_name,
    apt.created_at
  FROM accounts_payment_transactions apt

  UNION ALL

  SELECT
    alp.id,
    'legacy' AS source,
    alp.learner_level,
    alp.learner_id,
    alp.learner_name_snapshot AS learner_name,
    alp.class_level_snapshot AS class_level,
    alp.stream_snapshot AS stream,
    alp.academic_year,
    alp.term,
    alp.residence_type,
    NULL AS previous_amount,
    alp.amount_paid AS new_amount,
    COALESCE(alp.amount_paid, 0) AS amount_change,
    CASE WHEN alp.amount_paid = 0 THEN 'not_paid' ELSE 'initial_record' END AS transaction_type,
    COALESCE(staff.name, NULLIF(alp.updated_by, ''), 'Accounts Office') AS recorded_by_name,
    alp.updated_at AS created_at
  FROM accounts_learner_payments alp
  LEFT JOIN accounts_users staff
    ON LOWER(staff.email) = LOWER(alp.updated_by)
  WHERE alp.amount_paid IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM accounts_payment_transactions existing_tx
      WHERE existing_tx.learner_level = alp.learner_level
        AND existing_tx.learner_id = alp.learner_id
        AND existing_tx.academic_year = alp.academic_year
        AND existing_tx.term = alp.term
    )
`;

async function logAccountsAudit(req, action, description, entityId = null) {
  const actorId = Number(req?.accountsAdmin?.id ?? 0);
  const auditUserId = req?.accountsAdmin?.role === "accounts_bursar"
    ? ACCOUNTS_AUDIT_STAFF_OFFSET + actorId
    : 0;
  await logAuditEvent({
    userId: auditUserId,
    userRole: "admin",
    action: action.startsWith("ACCOUNTS_") ? action : `ACCOUNTS_${action}`,
    entityType: "system",
    entityId,
    description,
    ipAddress: extractClientIp(req),
  });
}

const requireAccountsOwner = (req, res, next) => {
  if (!["accounts_admin", "accounts_owner"].includes(req.accountsAdmin?.role)) {
    return res.status(403).json({ message: "Accounts Owner authorization required" });
  }
  return next();
};

const requireAccountsBursar = (req, res, next) => {
  if (req.accountsAdmin?.role !== "accounts_bursar") {
    return res.status(403).json({ message: "Bursar account authorization required" });
  }
  return next();
};

const requireActiveAccountsAccess = async (req, res, next) => {
  if (req.accountsAdmin?.role !== "accounts_bursar") return next();
  try {
    await ensureAccountsSchemaReady();
    const [[user]] = await pool.query(
      "SELECT name, email, avatar_url, status FROM accounts_users WHERE id = ? LIMIT 1",
      [req.accountsAdmin.id]
    );
    if (!user || user.status !== "active") {
      return res.status(403).json({ message: "This bursar account is not active" });
    }
    req.accountsAdmin.name = user.name;
    req.accountsAdmin.username = user.email;
    req.accountsAdmin.avatar_url = user.avatar_url || null;
    return next();
  } catch (error) {
    console.error("Accounts access verification error:", error);
    return res.status(500).json({ message: "Failed to verify Accounts access" });
  }
};

function parseScope(query = {}) {
  const classLevel = normalizeAccountsClass(query.class_level);
  const stream = String(query.stream || "").trim();
  const term = normalizeAccountsTerm(query.term);
  const year = Number(query.year);

  if (
    !ACCOUNTS_CLASSES.includes(classLevel) ||
    !stream ||
    !term ||
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2100
  ) {
    return null;
  }
  return { classLevel, stream, term, year };
}

function parseInsightPeriod(query = {}) {
  const term = normalizeAccountsTerm(query.term);
  const year = Number(query.year);
  if (!term || !Number.isInteger(year) || year < 2020 || year > 2100) return null;
  return { term, year };
}

function getKampalaDayEpochRange(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Kampala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  const startMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - 3 * 60 * 60 * 1000;
  return {
    startEpoch: Math.floor(startMs / 1000),
    endEpoch: Math.floor((startMs + 24 * 60 * 60 * 1000) / 1000),
  };
}

async function loadScopedLearners(connection, classLevel, stream) {
  // SPESS Accounts reads identity data from the academic registers. It never
  // creates or edits learner records, and it does not query boarding_students.
  if (getLearnerLevelForClass(classLevel) === "A_LEVEL") {
    const [rows] = await connection.query(
      `
      SELECT
        id,
        'A_LEVEL' AS learner_level,
        TRIM(CONCAT_WS(' ', first_name, NULLIF(last_name, ''))) AS learner_name,
        gender,
        ? AS class_level,
        ? AS stream
      FROM alevel_learners
      WHERE COALESCE(NULLIF(status, ''), 'active') = 'active'
        AND UPPER(SUBSTRING_INDEX(TRIM(stream), ' ', 1)) = ?
        AND LOWER(TRIM(SUBSTRING(TRIM(stream), LENGTH(SUBSTRING_INDEX(TRIM(stream), ' ', 1)) + 1))) = LOWER(?)
      ORDER BY first_name, last_name, id
      `,
      [classLevel, stream, classLevel, stream]
    );
    return rows || [];
  }

  const [rows] = await connection.query(
    `
    SELECT
      id,
      'O_LEVEL' AS learner_level,
      name AS learner_name,
      gender,
      class_level,
      stream
    FROM students
    WHERE COALESCE(NULLIF(status, ''), 'active') = 'active'
      AND UPPER(TRIM(class_level)) = ?
      AND LOWER(TRIM(stream)) = LOWER(?)
    ORDER BY name, id
    `,
    [classLevel, stream]
  );
  return rows || [];
}

router.post("/login", limitAccountsLogin, async (req, res) => {
  let expectedUsername;
  let expectedPassword;
  try {
    expectedUsername = requireSecret("ACCOUNTS_ADMIN_USERNAME", { minLength: 3 });
    expectedPassword = requireSecret("ACCOUNTS_ADMIN_PASSWORD", { minLength: 12 });
  } catch (error) {
    console.error("Accounts configuration error:", error.message);
    return res.status(503).json({
      code: "ACCOUNTS_ADMIN_NOT_CONFIGURED",
      message: "SPESS Accounts is not configured. Add the Accounts credentials to the backend service and redeploy.",
    });
  }

  const username = String(req.body?.username || req.body?.email || "").trim();
  const password = String(req.body?.password || "");

  try {
    await ensureAccountsSchemaReady();
    const sessionMode = resolveRequestedSessionMode(req, req.body?.session_mode);
    const ownerLogin =
      safeCredentialEquals(username, expectedUsername) &&
      safeCredentialEquals(password, expectedPassword);

    if (ownerLogin) {
      const token = jwt.sign(
        {
          id: 0,
          username: expectedUsername,
          name: "Accounts Owner",
          role: "accounts_owner",
          session_mode: sessionMode,
        },
        getJwtSecret(),
        { expiresIn: getSessionExpiry(sessionMode, "12h") }
      );

      req.accountsAdmin = { id: 0, username: expectedUsername, name: "Accounts Owner", role: "accounts_owner" };
      await logAccountsAudit(req, "LOGIN", `Accounts Owner login successful (${expectedUsername})`);
      return res.json({
        token,
        session_mode: sessionMode,
        user: { id: 0, username: expectedUsername, name: "Accounts Owner", role: "accounts_owner" },
      });
    }

    const email = normalizeAccountsEmail(username);
    const [rows] = await pool.query(
      `SELECT id, name, email, avatar_url, password_hash, status
       FROM accounts_users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );
    const bursar = rows?.[0];
    const passwordMatches = await bcrypt.compare(
      password,
      bursar?.password_hash || INVALID_ACCOUNTS_PASSWORD_HASH
    );
    if (!bursar || !passwordMatches) {
      return res.status(401).json({ message: "Invalid Accounts credentials" });
    }
    if (bursar.status !== "active") {
      const messages = {
        pending: "Your Accounts registration is waiting for Owner approval.",
        suspended: "Your Accounts access has been suspended.",
        rejected: "Your Accounts registration was not approved.",
      };
      return res.status(403).json({
        code: `ACCOUNTS_${String(bursar.status || "pending").toUpperCase()}`,
        message: messages[bursar.status] || "Accounts access is unavailable.",
      });
    }

    const token = jwt.sign(
      {
        id: Number(bursar.id),
        username: bursar.email,
        name: bursar.name,
        role: "accounts_bursar",
        session_mode: sessionMode,
      },
      getJwtSecret(),
      { expiresIn: getSessionExpiry(sessionMode, "12h") }
    );

    await pool.query("UPDATE accounts_users SET last_login_at = NOW() WHERE id = ?", [bursar.id]);
    req.accountsAdmin = {
      id: Number(bursar.id),
      username: bursar.email,
      name: bursar.name,
      role: "accounts_bursar",
    };
    await logAccountsAudit(req, "LOGIN", `${bursar.name} signed in to SPESS Accounts`, bursar.id);
    return res.json({
      token,
      session_mode: sessionMode,
      user: {
        id: Number(bursar.id),
        username: bursar.email,
        email: bursar.email,
        avatar_url: bursar.avatar_url || null,
        name: bursar.name,
        role: "accounts_bursar",
      },
    });
  } catch (error) {
    console.error("Accounts login error:", error);
    return res.status(500).json({ message: "Accounts login failed" });
  }
});

router.post("/register", limitAccountsRegistration, async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 160);
  const email = normalizeAccountsEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (name.length < 2 || !isValidAccountsEmail(email) || !isValidAccountsPassword(password)) {
    return res.status(400).json({
      message: "Enter a valid name, email, and password of at least 12 characters.",
    });
  }

  try {
    await ensureAccountsSchemaReady();
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      `INSERT INTO accounts_users (name, email, password_hash, status)
       VALUES (?, ?, ?, 'pending')`,
      [name, email, passwordHash]
    );
    await logAuditEvent({
      userId: ACCOUNTS_AUDIT_STAFF_OFFSET + Number(result.insertId),
      userRole: "admin",
      action: "ACCOUNTS_REGISTRATION",
      entityType: "system",
      entityId: Number(result.insertId),
      description: `${name} submitted an Accounts access request (${email})`,
      ipAddress: extractClientIp(req),
    });
    return res.status(201).json({
      status: "pending",
      message: "Registration received. The Accounts Owner must approve your access.",
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "An Accounts registration already exists for this email." });
    }
    console.error("Accounts registration error:", error);
    return res.status(500).json({ message: "Failed to create Accounts registration" });
  }
});

router.post("/forgot-password", limitAccountsReset, async (req, res) => {
  const email = normalizeAccountsEmail(req.body?.email);
  if (!isValidAccountsEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }

  try {
    await ensureAccountsSchemaReady();
    const [[user]] = await pool.query(
      `SELECT id FROM accounts_users WHERE email = ? AND status = 'active' LIMIT 1`,
      [email]
    );
    if (!user) return res.json({ message: "If that active account exists, a reset code was sent." });

    const code = crypto.randomInt(100000, 1000000).toString();
    const tokenHash = crypto.createHash("sha256").update(`${email}:${code}`).digest("hex");
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      "UPDATE accounts_users SET reset_token = ?, reset_expires = ? WHERE id = ?",
      [tokenHash, expires, user.id]
    );
    try {
      await sendAccountsResetCodeEmail(email, code);
    } catch (error) {
      await pool.query(
        "UPDATE accounts_users SET reset_token = NULL, reset_expires = NULL WHERE id = ?",
        [user.id]
      );
      throw error;
    }
    return res.json({ message: "If that active account exists, a reset code was sent." });
  } catch (error) {
    console.error("Accounts forgot password error:", error);
    return res.status(500).json({ message: "Failed to send Accounts reset code" });
  }
});

router.post("/reset-password", limitAccountsReset, async (req, res) => {
  const email = normalizeAccountsEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();
  const password = String(req.body?.password || "");
  if (!isValidAccountsEmail(email) || !/^\d{6}$/.test(code) || !isValidAccountsPassword(password)) {
    return res.status(400).json({ message: "Enter the email, six-digit code, and a password of at least 12 characters." });
  }

  try {
    await ensureAccountsSchemaReady();
    const [[user]] = await pool.query(
      `SELECT id, reset_token, reset_expires
       FROM accounts_users
       WHERE email = ? AND status = 'active'
       LIMIT 1`,
      [email]
    );
    const submittedHash = crypto.createHash("sha256").update(`${email}:${code}`).digest("hex");
    const storedHash = Buffer.from(String(user?.reset_token || ""));
    const candidateHash = Buffer.from(submittedHash);
    const expired = !user?.reset_expires || new Date(user.reset_expires).getTime() < Date.now();
    if (
      !user ||
      expired ||
      storedHash.length !== candidateHash.length ||
      !crypto.timingSafeEqual(storedHash, candidateHash)
    ) {
      return res.status(400).json({ message: "Invalid or expired reset code." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `UPDATE accounts_users
       SET password_hash = ?, reset_token = NULL, reset_expires = NULL
       WHERE id = ?`,
      [passwordHash, user.id]
    );
    await logAuditEvent({
      userId: ACCOUNTS_AUDIT_STAFF_OFFSET + Number(user.id),
      userRole: "admin",
      action: "ACCOUNTS_PASSWORD_RESET",
      entityType: "system",
      entityId: Number(user.id),
      description: `Bursar password reset completed (${email})`,
      ipAddress: extractClientIp(req),
    });
    return res.json({ message: "Password updated. You can now sign in." });
  } catch (error) {
    console.error("Accounts reset password error:", error);
    return res.status(500).json({ message: "Failed to reset Accounts password" });
  }
});

// Every route below this line is private. Active-status verification makes an
// Owner suspension effective immediately, even for an already-open bursar tab.
router.use(authAccountsAdmin, requireActiveAccountsAccess);

router.get("/me", async (req, res) => {
  if (req.accountsAdmin?.role !== "accounts_bursar") {
    return res.json({
      id: 0,
      username: req.accountsAdmin?.username || "accounts",
      name: req.accountsAdmin?.name || "Accounts Owner",
      role: req.accountsAdmin?.role || "accounts_owner",
      avatar_url: null,
    });
  }

  try {
    await ensureAccountsSchemaReady();
    const [[user]] = await pool.query(
      `SELECT id, name, email, avatar_url, status
       FROM accounts_users
       WHERE id = ?
       LIMIT 1`,
      [req.accountsAdmin.id]
    );
    if (!user || user.status !== "active") {
      return res.status(403).json({ message: "This bursar account is not active" });
    }
    return res.json({
      id: Number(user.id),
      username: user.email,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url || null,
      role: "accounts_bursar",
    });
  } catch (error) {
    console.error("Accounts profile fetch error:", error);
    return res.status(500).json({ message: "Failed to load Accounts profile" });
  }
});

router.put(
  "/profile/avatar",
  requireAccountsBursar,
  parseAccountsAvatar,
  async (req, res) => {
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!req.file || !allowedTypes.has(String(req.file.mimetype || "").toLowerCase())) {
      return res.status(400).json({ message: "Choose a JPG, PNG, or WebP profile photo." });
    }
    if (!isAccountsAvatarStorageReady()) {
      return res.status(503).json({ message: "Cloudflare R2 profile storage is not configured." });
    }

    let uploaded = null;
    try {
      await ensureAccountsSchemaReady();
      const [[user]] = await pool.query(
        "SELECT id, name, avatar_url FROM accounts_users WHERE id = ? AND status = 'active' LIMIT 1",
        [req.accountsAdmin.id]
      );
      if (!user) return res.status(403).json({ message: "This bursar account is not active" });

      uploaded = await uploadAccountsAvatar(req.file.buffer, { userId: user.id });
      await pool.query("UPDATE accounts_users SET avatar_url = ? WHERE id = ?", [uploaded.url, user.id]);
      await logAccountsAudit(req, "PROFILE_PHOTO", `${user.name} updated their profile photo`, user.id);
      if (user.avatar_url && user.avatar_url !== uploaded.url) {
        deleteAccountsAvatar(user.avatar_url).catch((error) => {
          console.error("Old Accounts avatar cleanup failed:", error?.message || error);
        });
      }
      return res.json({ avatar_url: uploaded.url });
    } catch (error) {
      if (uploaded?.url) await deleteAccountsAvatar(uploaded.url).catch(() => {});
      console.error("Accounts avatar update error:", error);
      return res.status(500).json({ message: "Failed to update profile photo" });
    }
  }
);

router.put(
  "/profile/password",
  requireAccountsBursar,
  limitAccountsPasswordChange,
  async (req, res) => {
    const currentPassword = String(req.body?.current_password || "");
    const newPassword = String(req.body?.new_password || "");
    if (!currentPassword || !isValidAccountsPassword(newPassword)) {
      return res.status(400).json({ message: "Enter the current password and a new password of at least 12 characters." });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ message: "Choose a new password that is different from the current one." });
    }

    try {
      await ensureAccountsSchemaReady();
      const [[user]] = await pool.query(
        `SELECT id, name, password_hash
         FROM accounts_users
         WHERE id = ? AND status = 'active'
         LIMIT 1`,
        [req.accountsAdmin.id]
      );
      const matches = await bcrypt.compare(
        currentPassword,
        user?.password_hash || INVALID_ACCOUNTS_PASSWORD_HASH
      );
      if (!user || !matches) {
        return res.status(400).json({ message: "The current password is incorrect." });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await pool.query(
        `UPDATE accounts_users
         SET password_hash = ?, reset_token = NULL, reset_expires = NULL
         WHERE id = ?`,
        [passwordHash, user.id]
      );
      await logAccountsAudit(req, "PASSWORD_CHANGE", `${user.name} changed their Accounts password`, user.id);
      return res.json({ message: "Password changed successfully." });
    } catch (error) {
      console.error("Accounts password change error:", error);
      return res.status(500).json({ message: "Failed to change Accounts password" });
    }
  }
);

router.get("/staff", requireAccountsOwner, async (_req, res) => {
  try {
    await ensureAccountsSchemaReady();
    const [rows] = await pool.query(
      `SELECT id, name, email, avatar_url AS avatarUrl, status, approved_at AS approvedAt,
              last_login_at AS lastLoginAt, created_at AS createdAt
       FROM accounts_users
       ORDER BY FIELD(status, 'pending','active','suspended','rejected'), created_at DESC`
    );
    return res.json({
      staff: rows || [],
      summary: {
        pending: (rows || []).filter((row) => row.status === "pending").length,
        active: (rows || []).filter((row) => row.status === "active").length,
      },
    });
  } catch (error) {
    console.error("Accounts staff fetch error:", error);
    return res.status(500).json({ message: "Failed to load bursar access requests" });
  }
});

router.patch("/staff/:staffId/status", requireAccountsOwner, async (req, res) => {
  const staffId = Number(req.params.staffId);
  const status = String(req.body?.status || "").trim().toLowerCase();
  if (!Number.isInteger(staffId) || staffId <= 0 || !["pending", "active", "suspended", "rejected"].includes(status)) {
    return res.status(400).json({ message: "Choose a valid bursar account and status" });
  }

  try {
    await ensureAccountsSchemaReady();
    const [[staff]] = await pool.query(
      "SELECT id, name, email, status FROM accounts_users WHERE id = ? LIMIT 1",
      [staffId]
    );
    if (!staff) return res.status(404).json({ message: "Bursar account not found" });
    const [result] = await pool.query(
      `UPDATE accounts_users
       SET status = ?,
           approved_by = CASE WHEN ? = 'active' THEN ? ELSE approved_by END,
           approved_at = CASE WHEN ? = 'active' THEN NOW() ELSE approved_at END,
           reset_token = CASE WHEN ? = 'active' THEN reset_token ELSE NULL END,
           reset_expires = CASE WHEN ? = 'active' THEN reset_expires ELSE NULL END
       WHERE id = ?`,
      [
        status,
        status,
        req.accountsAdmin?.username || "owner",
        status,
        status,
        status,
        staffId,
      ]
    );
    if (!result.affectedRows) return res.status(500).json({ message: "Bursar access was not updated" });
    await logAccountsAudit(
      req,
      "STAFF_STATUS",
      `Changed ${staff.name} (${staff.email}) from ${staff.status} to ${status}`,
      staffId
    );
    return res.json({ success: true, status });
  } catch (error) {
    console.error("Accounts staff status error:", error);
    return res.status(500).json({ message: "Failed to update bursar access" });
  }
});

router.get("/audit", requireAccountsOwner, async (req, res) => {
  const requestedPage = Number(req.query?.page || 1);
  const requestedLimit = Number(req.query?.limit || 30);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isInteger(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 100))
    : 30;
  const offset = (page - 1) * limit;

  try {
    await ensureAccountsSchemaReady();
    const [[countRow], [rows]] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) AS total,
           MAX(CASE WHEN action = 'ACCOUNTS_LOGIN' THEN created_at END) AS lastLoginAt
         FROM audit_logs
         WHERE LEFT(action, 9) = 'ACCOUNTS_'`
      ),
      pool.query(
        `SELECT
           al.id,
           al.user_id AS userId,
           al.action,
           al.description,
           al.ip_address AS ipAddress,
           al.created_at AS createdAt,
           au.name AS staffName
         FROM audit_logs al
         LEFT JOIN accounts_users au
           ON au.id = al.user_id - ${ACCOUNTS_AUDIT_STAFF_OFFSET}
         WHERE LEFT(al.action, 9) = 'ACCOUNTS_'
         ORDER BY al.created_at DESC, al.id DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      ),
    ]);

    const total = Number(countRow?.total || 0);
    return res.json({
      logs: (rows || []).map(({ staffName, ...row }) => ({
        ...row,
        actor: Number(row.userId) < ACCOUNTS_AUDIT_STAFF_OFFSET
          ? req.accountsAdmin?.username || "Accounts Owner"
          : staffName || "Bursar",
      })),
      total,
      lastLoginAt: countRow?.lastLoginAt || null,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("Accounts audit error:", error);
    return res.status(500).json({ message: "Failed to load Accounts activity" });
  }
});

router.get("/meta", async (_req, res) => {
  try {
    await ensureAccountsSchemaReady();
    const [rows] = await pool.query(`
      SELECT class_level, stream
      FROM (
        SELECT UPPER(TRIM(class_level)) AS class_level, TRIM(stream) AS stream
        FROM students
        WHERE COALESCE(NULLIF(status, ''), 'active') = 'active'
        UNION
        SELECT
          UPPER(SUBSTRING_INDEX(TRIM(stream), ' ', 1)) AS class_level,
          TRIM(SUBSTRING(TRIM(stream), LENGTH(SUBSTRING_INDEX(TRIM(stream), ' ', 1)) + 1)) AS stream
        FROM alevel_learners
        WHERE COALESCE(NULLIF(status, ''), 'active') = 'active'
      ) register_streams
      WHERE class_level IN ('S1','S2','S3','S4','S5','S6') AND stream <> ''
      ORDER BY FIELD(class_level, 'S1','S2','S3','S4','S5','S6'), stream
    `);

    const classes = ACCOUNTS_CLASSES.map((classLevel) => ({
      class_level: classLevel,
      streams: (rows || [])
        .filter((row) => row.class_level === classLevel)
        .map((row) => row.stream),
    })).filter((item) => item.streams.length > 0);

    return res.json({ classes, terms: ACCOUNTS_TERMS });
  } catch (error) {
    console.error("Accounts metadata error:", error);
    return res.status(500).json({ message: "Failed to load the Accounts register" });
  }
});

router.get("/funds-summary", async (req, res) => {
  const term = normalizeAccountsTerm(req.query?.term);
  const year = Number(req.query?.year);
  if (!term || !Number.isInteger(year) || year < 2020 || year > 2100) {
    return res.status(400).json({ message: "Choose a valid term and year" });
  }

  try {
    await ensureAccountsSchemaReady();
    const [[summary]] = await pool.query(
      `SELECT
         COALESCE(SUM(COALESCE(amount_paid, 0)), 0) AS totalCollected,
         COALESCE(SUM(CASE WHEN residence_type = 'Day' THEN COALESCE(amount_paid, 0) ELSE 0 END), 0) AS dayCollected,
         COALESCE(SUM(CASE WHEN residence_type = 'Boarding' THEN COALESCE(amount_paid, 0) ELSE 0 END), 0) AS hostelCollected,
         SUM(CASE WHEN amount_paid IS NOT NULL THEN 1 ELSE 0 END) AS recordedEntries,
         SUM(CASE WHEN amount_paid = 0 THEN 1 ELSE 0 END) AS notPaidEntries,
         MAX(updated_at) AS updatedAt
       FROM accounts_learner_payments
       WHERE academic_year = ? AND term = ?`,
      [year, term]
    );

    return res.json({
      term,
      year,
      total_collected: Number(summary?.totalCollected || 0),
      day_collected: Number(summary?.dayCollected || 0),
      hostel_collected: Number(summary?.hostelCollected || 0),
      recorded_entries: Number(summary?.recordedEntries || 0),
      not_paid_entries: Number(summary?.notPaidEntries || 0),
      updated_at: summary?.updatedAt || null,
    });
  } catch (error) {
    console.error("Accounts funds summary error:", error);
    return res.status(500).json({ message: "Failed to load the funds summary" });
  }
});

router.get("/recent-transactions", async (_req, res) => {
  try {
    await ensureAccountsSchemaReady();
    res.set("Cache-Control", "private, no-store");

    const [rows] = await pool.query(`
      SELECT *
      FROM (
        ${PAYMENT_ACTIVITY_SOURCE_SQL}
      ) recent
      ORDER BY created_at DESC, id DESC
      LIMIT 5
    `);

    return res.json({ transactions: rows || [] });
  } catch (error) {
    console.error("Accounts recent transactions error:", error);
    return res.status(500).json({ message: "Failed to load recent transactions" });
  }
});

router.get("/insights/today", async (_req, res) => {
  try {
    await ensureAccountsSchemaReady();
    res.set("Cache-Control", "private, no-store");
    const { startEpoch, endEpoch } = getKampalaDayEpochRange();
    const [[summary]] = await pool.query(
      `SELECT
         COUNT(*) AS transaction_count,
         COALESCE(SUM(CASE WHEN amount_change > 0 THEN amount_change ELSE 0 END), 0) AS collected,
         COALESCE(SUM(CASE WHEN residence_type = 'Day' AND amount_change > 0 THEN amount_change ELSE 0 END), 0) AS day_collected,
         COALESCE(SUM(CASE WHEN residence_type = 'Boarding' AND amount_change > 0 THEN amount_change ELSE 0 END), 0) AS hostel_collected,
         SUM(CASE WHEN transaction_type IN ('payment_corrected','payment_cleared') THEN 1 ELSE 0 END) AS corrections,
         MAX(created_at) AS latest_at
       FROM (${PAYMENT_ACTIVITY_SOURCE_SQL}) activity
       WHERE UNIX_TIMESTAMP(created_at) >= ? AND UNIX_TIMESTAMP(created_at) < ?`,
      [startEpoch, endEpoch]
    );

    return res.json({
      transaction_count: Number(summary?.transaction_count || 0),
      collected: Number(summary?.collected || 0),
      day_collected: Number(summary?.day_collected || 0),
      hostel_collected: Number(summary?.hostel_collected || 0),
      corrections: Number(summary?.corrections || 0),
      latest_at: summary?.latest_at || null,
    });
  } catch (error) {
    console.error("Accounts today collections error:", error);
    return res.status(500).json({ message: "Failed to load today's collections" });
  }
});

router.get("/insights/outstanding", async (req, res) => {
  const period = parseInsightPeriod(req.query);
  if (!period) return res.status(400).json({ message: "Choose a valid term and year" });

  const classLevel = normalizeAccountsClass(req.query?.class_level);
  const stream = String(req.query?.stream || "").trim();
  const search = String(req.query?.search || "").trim().slice(0, 80);
  const conditions = ["academic_year = ?", "term = ?", "expected_amount_snapshot > COALESCE(amount_paid, 0)"];
  const params = [period.year, period.term];
  if (classLevel) {
    conditions.push("class_level_snapshot = ?");
    params.push(classLevel);
  }
  if (stream) {
    conditions.push("LOWER(stream_snapshot) = LOWER(?)");
    params.push(stream);
  }
  if (search) {
    conditions.push("learner_name_snapshot LIKE ?");
    params.push(`%${search}%`);
  }

  try {
    await ensureAccountsSchemaReady();
    res.set("Cache-Control", "private, no-store");
    const [rows] = await pool.query(
      `SELECT
         learner_level,
         learner_id,
         learner_name_snapshot AS learner_name,
         class_level_snapshot AS class_level,
         stream_snapshot AS stream,
         residence_type,
         expected_amount_snapshot AS expected_amount,
         COALESCE(amount_paid, 0) AS amount_paid,
         expected_amount_snapshot - COALESCE(amount_paid, 0) AS balance,
         updated_at,
         COUNT(*) OVER() AS total_learners,
         SUM(expected_amount_snapshot - COALESCE(amount_paid, 0)) OVER() AS total_balance
       FROM accounts_learner_payments
       WHERE ${conditions.join(" AND ")}
       ORDER BY balance DESC, learner_name_snapshot ASC
       LIMIT 50`,
      params
    );

    return res.json({
      learners: rows || [],
      summary: {
        learners: Number(rows?.[0]?.total_learners || 0),
        total_balance: Number(rows?.[0]?.total_balance || 0),
      },
    });
  } catch (error) {
    console.error("Accounts outstanding balances error:", error);
    return res.status(500).json({ message: "Failed to load outstanding balances" });
  }
});

router.get("/transactions", async (req, res) => {
  const period = parseInsightPeriod(req.query);
  if (!period) return res.status(400).json({ message: "Choose a valid term and year" });

  const search = String(req.query?.search || "").trim().slice(0, 80);
  const classLevel = normalizeAccountsClass(req.query?.class_level);
  const stream = String(req.query?.stream || "").trim();
  const conditions = ["academic_year = ?", "term = ?"];
  const params = [period.year, period.term];
  if (search) {
    conditions.push("(learner_name LIKE ? OR recorded_by_name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (classLevel) {
    conditions.push("class_level = ?");
    params.push(classLevel);
  }
  if (stream) {
    conditions.push("LOWER(stream) = LOWER(?)");
    params.push(stream);
  }

  try {
    await ensureAccountsSchemaReady();
    res.set("Cache-Control", "private, no-store");
    const [rows] = await pool.query(
      `SELECT *
       FROM (${PAYMENT_ACTIVITY_SOURCE_SQL}) activity
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      params
    );
    return res.json({ transactions: rows || [] });
  } catch (error) {
    console.error("Accounts transaction search error:", error);
    return res.status(500).json({ message: "Failed to search transactions" });
  }
});

router.get("/insights/corrections", async (_req, res) => {
  try {
    await ensureAccountsSchemaReady();
    res.set("Cache-Control", "private, no-store");
    const [rows] = await pool.query(
      `SELECT
         id,
         learner_level,
         learner_id,
         learner_name_snapshot AS learner_name,
         class_level_snapshot AS class_level,
         stream_snapshot AS stream,
         academic_year,
         term,
         previous_amount,
         new_amount,
         amount_change,
         transaction_type,
         recorded_by_name,
         created_at
       FROM accounts_payment_transactions
       WHERE transaction_type IN ('payment_corrected','payment_cleared')
       ORDER BY created_at DESC, id DESC
       LIMIT 10`
    );
    return res.json({ corrections: rows || [] });
  } catch (error) {
    console.error("Accounts correction alerts error:", error);
    return res.status(500).json({ message: "Failed to load correction alerts" });
  }
});

router.get("/insights/bursar-activity", async (_req, res) => {
  try {
    await ensureAccountsSchemaReady();
    res.set("Cache-Control", "private, no-store");
    const { startEpoch, endEpoch } = getKampalaDayEpochRange();
    const [rows] = await pool.query(
      `SELECT
         recorded_by_name,
         COUNT(*) AS transaction_count,
         COALESCE(SUM(CASE WHEN amount_change > 0 THEN amount_change ELSE 0 END), 0) AS collected,
         SUM(CASE WHEN transaction_type IN ('payment_corrected','payment_cleared') THEN 1 ELSE 0 END) AS corrections,
         MAX(created_at) AS last_activity_at
       FROM (${PAYMENT_ACTIVITY_SOURCE_SQL}) activity
       WHERE UNIX_TIMESTAMP(created_at) >= ? AND UNIX_TIMESTAMP(created_at) < ?
       GROUP BY recorded_by_name
       ORDER BY collected DESC, transaction_count DESC, recorded_by_name ASC`,
      [startEpoch, endEpoch]
    );
    return res.json({ staff: rows || [] });
  } catch (error) {
    console.error("Accounts bursar activity error:", error);
    return res.status(500).json({ message: "Failed to load bursar activity" });
  }
});

router.get("/learners", async (req, res) => {
  const scope = parseScope(req.query);
  if (!scope) {
    return res.status(400).json({ message: "Class, stream, term and year are required" });
  }

  try {
    await ensureAccountsSchemaReady();
    const learners = await loadScopedLearners(pool, scope.classLevel, scope.stream);
    const learnerLevel = getLearnerLevelForClass(scope.classLevel);

    const [[feeSetting]] = await pool.query(
      `SELECT day_amount, boarding_amount, updated_at
       FROM accounts_fee_settings
       WHERE academic_year = ? AND term = ? AND class_level = ? AND stream = ?
       LIMIT 1`,
      [scope.year, scope.term, scope.classLevel, scope.stream]
    );

    const [paymentRows] = await pool.query(
      `SELECT
         alp.learner_id,
         alp.residence_type,
         alp.expected_amount_snapshot,
         alp.amount_paid,
         COALESCE(staff.name, alp.updated_by) AS updated_by,
         alp.updated_at
       FROM accounts_learner_payments alp
       LEFT JOIN accounts_users staff
         ON LOWER(staff.email) = LOWER(alp.updated_by)
       WHERE alp.learner_level = ? AND alp.academic_year = ? AND alp.term = ?
         AND alp.class_level_snapshot = ? AND alp.stream_snapshot = ?`,
      [learnerLevel, scope.year, scope.term, scope.classLevel, scope.stream]
    );
    const paymentsByLearner = new Map(
      (paymentRows || []).map((row) => [Number(row.learner_id), row])
    );

    const result = learners.map((learner) => {
      const payment = paymentsByLearner.get(Number(learner.id));
      return {
        ...learner,
        residence_type: payment?.residence_type || "Day",
        expected_amount: payment?.expected_amount_snapshot ?? null,
        amount_paid: payment?.amount_paid ?? null,
        payment_updated_by: payment?.updated_by || null,
        payment_updated_at: payment?.updated_at || null,
      };
    });

    const totalPaid = result.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0);
    return res.json({
      ...scope,
      learners: result,
      fee_setting: feeSetting || null,
      summary: {
        learners: result.length,
        recorded: result.filter((row) => row.amount_paid !== null).length,
        total_paid: Number(totalPaid.toFixed(2)),
      },
    });
  } catch (error) {
    console.error("Accounts learners error:", error);
    return res.status(500).json({ message: "Failed to load learner accounts" });
  }
});

router.get("/learners/:learnerLevel/:learnerId/payment-history", async (req, res) => {
  const learnerLevel = String(req.params?.learnerLevel || "").trim().toUpperCase();
  const learnerId = Number(req.params?.learnerId);
  if (!["O_LEVEL", "A_LEVEL"].includes(learnerLevel) || !Number.isInteger(learnerId) || learnerId < 1) {
    return res.status(400).json({ message: "Choose a valid learner" });
  }

  try {
    await ensureAccountsSchemaReady();

    let learner;
    if (learnerLevel === "A_LEVEL") {
      // Some older A-Level registers predate registration timestamps. Detect
      // the column so payment history remains available on those deployments.
      const [[createdAtColumn]] = await pool.query(`
        SELECT COUNT(*) AS count
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'alevel_learners'
          AND COLUMN_NAME = 'created_at'
      `);
      const addedAtExpression = Number(createdAtColumn?.count || 0) > 0
        ? "created_at"
        : "NULL";
      const [[row]] = await pool.query(
        `SELECT
           id,
           TRIM(CONCAT_WS(' ', first_name, NULLIF(last_name, ''))) AS learner_name,
           gender,
           UPPER(SUBSTRING_INDEX(TRIM(stream), ' ', 1)) AS class_level,
           TRIM(SUBSTRING(TRIM(stream), LENGTH(SUBSTRING_INDEX(TRIM(stream), ' ', 1)) + 1)) AS stream,
           ${addedAtExpression} AS added_at
         FROM alevel_learners
         WHERE id = ?
         LIMIT 1`,
        [learnerId]
      );
      learner = row;
    } else {
      const [[row]] = await pool.query(
        `SELECT
           id,
           name AS learner_name,
           gender,
           class_level,
           stream,
           created_at AS added_at
         FROM students
         WHERE id = ?
         LIMIT 1`,
        [learnerId]
      );
      learner = row;
    }

    if (!learner) {
      return res.status(404).json({ message: "Learner not found" });
    }

    const [history] = await pool.query(
      `SELECT
         alp.id,
         alp.academic_year AS academic_year,
         alp.term,
         alp.class_level_snapshot AS class_level,
         alp.stream_snapshot AS stream,
         alp.residence_type AS section,
         alp.expected_amount_snapshot AS expected_amount,
         alp.amount_paid,
         COALESCE(staff.name, alp.updated_by) AS saved_by,
         alp.created_at AS added_at,
         alp.updated_at AS updated_at
       FROM accounts_learner_payments alp
       LEFT JOIN accounts_users staff
         ON LOWER(staff.email) = LOWER(alp.updated_by)
       WHERE alp.learner_level = ? AND alp.learner_id = ?
       ORDER BY alp.academic_year DESC,
         FIELD(alp.term, 'Term 3', 'Term 2', 'Term 1') DESC,
         alp.updated_at DESC`,
      [learnerLevel, learnerId]
    );

    const totalPaid = (history || []).reduce(
      (sum, row) => sum + Number(row.amount_paid || 0),
      0
    );

    return res.json({
      learner: {
        ...learner,
        learner_level: learnerLevel,
      },
      history: history || [],
      summary: {
        records: history?.length || 0,
        total_paid: Number(totalPaid.toFixed(2)),
      },
    });
  } catch (error) {
    console.error("Accounts learner payment history error:", error);
    return res.status(500).json({ message: "Failed to load learner payment history" });
  }
});

router.put("/fee-settings", requireAccountsOwner, async (req, res) => {
  const scope = parseScope(req.body);
  const dayAmount = parseMoneyAmount(req.body?.day_amount);
  const boardingAmount = parseMoneyAmount(req.body?.boarding_amount);
  if (!scope || dayAmount === null || boardingAmount === null) {
    return res.status(400).json({ message: "Enter valid Day and Boarding term amounts" });
  }

  try {
    await ensureAccountsSchemaReady();
    await pool.query(
      `INSERT INTO accounts_fee_settings
        (academic_year, term, class_level, stream, day_amount, boarding_amount, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         day_amount = VALUES(day_amount),
         boarding_amount = VALUES(boarding_amount),
         updated_by = VALUES(updated_by)`,
      [
        scope.year,
        scope.term,
        scope.classLevel,
        scope.stream,
        dayAmount,
        boardingAmount,
        req.accountsAdmin?.username || "accounts",
      ]
    );

    await logAccountsAudit(
      req,
      "UPDATE_FEE_SETTING",
      `Updated ${scope.classLevel} ${scope.stream} fees for ${scope.term} ${scope.year}`
    );
    return res.json({ success: true, day_amount: dayAmount, boarding_amount: boardingAmount });
  } catch (error) {
    console.error("Accounts fee setting error:", error);
    return res.status(500).json({ message: "Failed to save fee settings" });
  }
});

router.put("/payments/batch", async (req, res) => {
  const scope = parseScope(req.body);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!scope || rows.length === 0 || rows.length > 500) {
    return res.status(400).json({ message: "Choose a valid register and at least one learner" });
  }

  const connection = await pool.getConnection();
  try {
    await ensureAccountsSchemaReady();
    const [[feeSetting]] = await connection.query(
      `SELECT day_amount, boarding_amount
       FROM accounts_fee_settings
       WHERE academic_year = ? AND term = ? AND class_level = ? AND stream = ?
       LIMIT 1`,
      [scope.year, scope.term, scope.classLevel, scope.stream]
    );
    if (!feeSetting) {
      return res.status(409).json({ message: "Save the Day and Boarding fee setup for this stream first" });
    }

    const scopedLearners = await loadScopedLearners(connection, scope.classLevel, scope.stream);
    const learnersById = new Map(scopedLearners.map((row) => [Number(row.id), row]));
    const learnerLevel = getLearnerLevelForClass(scope.classLevel);
    const actorName = String(
      req.accountsAdmin?.name || req.accountsAdmin?.username || "Accounts User"
    ).trim().slice(0, 100);
    const actorId = Number(req.accountsAdmin?.id);
    const actorRole = String(req.accountsAdmin?.role || "accounts_user").slice(0, 40);
    const normalizedRows = rows.map((row) => {
      const learnerId = Number(row?.learner_id);
      const learner = learnersById.get(learnerId);
      const residenceType = normalizeResidenceType(row?.residence_type);
      const amountPaid = parseMoneyAmount(row?.amount_paid, { nullable: true });
      if (!learner || !residenceType || (row?.amount_paid !== "" && row?.amount_paid != null && amountPaid === null)) {
        throw new Error("INVALID_PAYMENT_ROW");
      }
      return {
        learner,
        residenceType,
        amountPaid,
        expectedAmount: Number(
          residenceType === "Boarding" ? feeSetting.boarding_amount : feeSetting.day_amount
        ),
      };
    });
    if (new Set(normalizedRows.map((row) => Number(row.learner.id))).size !== normalizedRows.length) {
      throw new Error("INVALID_PAYMENT_ROW");
    }

    await connection.beginTransaction();
    const learnerIds = normalizedRows.map((row) => Number(row.learner.id));
    const [existingPaymentRows] = await connection.query(
      `SELECT learner_id, amount_paid
       FROM accounts_learner_payments
       WHERE learner_level = ?
         AND academic_year = ?
         AND term = ?
         AND learner_id IN (?)
       FOR UPDATE`,
      [learnerLevel, scope.year, scope.term, learnerIds]
    );
    const previousPayments = new Map(
      (existingPaymentRows || []).map((row) => [
        Number(row.learner_id),
        row.amount_paid === null ? null : Number(row.amount_paid),
      ])
    );

    for (const row of normalizedRows) {
      const previousAmount = previousPayments.has(Number(row.learner.id))
        ? previousPayments.get(Number(row.learner.id))
        : null;
      const transaction = buildPaymentTransaction(previousAmount, row.amountPaid);

      await connection.query(
        `INSERT INTO accounts_learner_payments
          (learner_level, learner_id, learner_name_snapshot, class_level_snapshot,
           stream_snapshot, academic_year, term, residence_type,
           expected_amount_snapshot, amount_paid, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           learner_name_snapshot = VALUES(learner_name_snapshot),
           class_level_snapshot = VALUES(class_level_snapshot),
           stream_snapshot = VALUES(stream_snapshot),
           residence_type = VALUES(residence_type),
           expected_amount_snapshot = VALUES(expected_amount_snapshot),
           amount_paid = VALUES(amount_paid),
           updated_by = VALUES(updated_by)`,
        [
          learnerLevel,
          row.learner.id,
          row.learner.learner_name,
          scope.classLevel,
          scope.stream,
          scope.year,
          scope.term,
          row.residenceType,
          row.expectedAmount,
          row.amountPaid,
          actorName,
        ]
      );

      if (transaction) {
        await connection.query(
          `INSERT INTO accounts_payment_transactions
            (learner_level, learner_id, learner_name_snapshot, class_level_snapshot,
             stream_snapshot, academic_year, term, residence_type, previous_amount,
             new_amount, amount_change, transaction_type, recorded_by_user_id,
             recorded_by_role, recorded_by_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            learnerLevel,
            row.learner.id,
            row.learner.learner_name,
            scope.classLevel,
            scope.stream,
            scope.year,
            scope.term,
            row.residenceType,
            previousAmount,
            row.amountPaid,
            transaction.amountChange,
            transaction.type,
            Number.isInteger(actorId) && actorId > 0 ? actorId : null,
            actorRole,
            actorName,
          ]
        );
      }
    }
    await connection.commit();

    await logAccountsAudit(
      req,
      "SAVE_PAYMENTS",
      `${actorName} saved ${normalizedRows.length} learner account row(s) for ${scope.classLevel} ${scope.stream}, ${scope.term} ${scope.year}`
    );
    return res.json({ success: true, saved: normalizedRows.length, saved_by: actorName });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error?.message === "INVALID_PAYMENT_ROW") {
      return res.status(400).json({ message: "One or more learner payment rows are invalid" });
    }
    console.error("Accounts payment save error:", error);
    return res.status(500).json({ message: "Failed to save learner payments" });
  } finally {
    connection.release();
  }
});

export default router;
