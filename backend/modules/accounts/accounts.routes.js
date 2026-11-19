import express from "express";
import jwt from "jsonwebtoken";
import { pool } from "../../server.js";
import authAccountsAdmin from "../../middleware/authAccountsAdmin.js";
import { createDatabaseRateLimit } from "../../middleware/databaseRateLimit.js";
import { getJwtSecret, requireSecret } from "../../config/security.js";
import { getSessionExpiry, resolveRequestedSessionMode } from "../../utils/deviceSession.js";
import { extractClientIp, logAuditEvent } from "../../utils/auditLogger.js";
import {
  ACCOUNTS_CLASSES,
  ACCOUNTS_TERMS,
  getLearnerLevelForClass,
  normalizeAccountsClass,
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
    })().catch((error) => {
      accountsSchemaReadyPromise = null;
      throw error;
    });
  }
  return accountsSchemaReadyPromise;
}

async function logAccountsAudit(req, action, description, entityId = null) {
  await logAuditEvent({
    userId: Number(req?.accountsAdmin?.id || 1),
    userRole: "admin",
    action: action.startsWith("ACCOUNTS_") ? action : `ACCOUNTS_${action}`,
    entityType: "system",
    entityId,
    description,
    ipAddress: extractClientIp(req),
  });
}

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

  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (
    !safeCredentialEquals(username, expectedUsername) ||
    !safeCredentialEquals(password, expectedPassword)
  ) {
    return res.status(401).json({ message: "Invalid Accounts credentials" });
  }

  try {
    await ensureAccountsSchemaReady();
    const sessionMode = resolveRequestedSessionMode(req, req.body?.session_mode);
    const token = jwt.sign(
      {
        id: 1,
        username: expectedUsername,
        name: "SPESS Bursar",
        role: "accounts_admin",
        session_mode: sessionMode,
      },
      getJwtSecret(),
      { expiresIn: getSessionExpiry(sessionMode, "12h") }
    );

    req.accountsAdmin = { id: 1, username: expectedUsername };
    await logAccountsAudit(req, "LOGIN", `Accounts login successful (${expectedUsername})`, 1);
    return res.json({
      token,
      session_mode: sessionMode,
      user: { id: 1, username: expectedUsername, name: "SPESS Bursar", role: "accounts_admin" },
    });
  } catch (error) {
    console.error("Accounts login error:", error);
    return res.status(500).json({ message: "Accounts login failed" });
  }
});

router.get("/me", authAccountsAdmin, (req, res) => {
  return res.json({
    id: req.accountsAdmin?.id || 1,
    username: req.accountsAdmin?.username || "accounts",
    name: req.accountsAdmin?.name || "SPESS Bursar",
  });
});

router.get("/meta", authAccountsAdmin, async (_req, res) => {
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

router.get("/learners", authAccountsAdmin, async (req, res) => {
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
      `SELECT learner_id, residence_type, expected_amount_snapshot, amount_paid, updated_at
       FROM accounts_learner_payments
       WHERE learner_level = ? AND academic_year = ? AND term = ?
         AND class_level_snapshot = ? AND stream_snapshot = ?`,
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

router.put("/fee-settings", authAccountsAdmin, async (req, res) => {
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

router.put("/payments/batch", authAccountsAdmin, async (req, res) => {
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

    await connection.beginTransaction();
    for (const row of normalizedRows) {
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
          req.accountsAdmin?.username || "accounts",
        ]
      );
    }
    await connection.commit();

    await logAccountsAudit(
      req,
      "SAVE_PAYMENTS",
      `Saved ${normalizedRows.length} learner account row(s) for ${scope.classLevel} ${scope.stream}, ${scope.term} ${scope.year}`
    );
    return res.json({ success: true, saved: normalizedRows.length });
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
