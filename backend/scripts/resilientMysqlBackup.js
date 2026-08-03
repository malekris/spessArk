import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  promises as fs,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import mysql from "mysql2/promise";
import { getDatabaseBackupPolicy } from "../services/databaseBackupService.js";

const connectionUrl = String(
  process.env.MYSQL_BACKUP_URL || process.env.MYSQL_DIAGNOSTIC_URL || ""
).trim();

if (!connectionUrl) {
  console.error(
    "MYSQL_BACKUP_URL is required. Set it to Railway's MYSQL_PUBLIC_URL for this backup."
  );
  process.exit(1);
}

const timestamp = new Date()
  .toISOString()
  .replace(/[:]/g, "-")
  .replace(/\.\d{3}Z$/, "")
  .replace("T", "_");

const requestedResumeDirectory = String(
  process.env.MYSQL_BACKUP_RESUME_DIR || ""
).trim();
const resolvedResumeDirectory = requestedResumeDirectory
  ? path.resolve(requestedResumeDirectory)
  : "";
const backupRoot = resolvedResumeDirectory
  ? path.dirname(resolvedResumeDirectory)
  : path.resolve(
      process.env.MYSQL_BACKUP_DIR ||
        path.join(homedir(), "Documents", "SPESS_ARK_Backups")
    );
const backupName = resolvedResumeDirectory
  ? path.basename(resolvedResumeDirectory).replace(/_parts$/, "")
  : `spess_ark_railway_resilient_${timestamp}`;
const stagingDirectory =
  resolvedResumeDirectory || path.join(backupRoot, `${backupName}_parts`);
const archivePath = path.join(backupRoot, `${backupName}.tar.gz`);
const maxAttempts = Math.max(
  3,
  Math.min(20, Number(process.env.MYSQL_BACKUP_MAX_ATTEMPTS) || 10)
);
const connectionPauseMs = Math.max(
  0,
  Math.min(10_000, Number(process.env.MYSQL_BACKUP_DELAY_MS) || 750)
);
const backupPolicy = getDatabaseBackupPolicy();
const requirePrivateUpload =
  backupPolicy.backgroundJobEnabled ||
  ["1", "true", "yes", "on"].includes(
    String(process.env.MYSQL_BACKUP_REQUIRE_PRIVATE_UPLOAD || "")
      .trim()
      .toLowerCase()
  );
const deleteLocalAfterPrivateUpload = ["1", "true", "yes", "on"].includes(
  String(process.env.MYSQL_BACKUP_DELETE_LOCAL_AFTER_UPLOAD || "")
    .trim()
    .toLowerCase()
);

const parsedUrl = new URL(connectionUrl);
if (parsedUrl.protocol !== "mysql:") {
  console.error("MYSQL_BACKUP_URL must use the mysql:// protocol.");
  process.exit(1);
}

const credentials = {
  host: parsedUrl.hostname,
  port: Number(parsedUrl.port || 3306),
  user: decodeURIComponent(parsedUrl.username),
  password: decodeURIComponent(parsedUrl.password),
  database: decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, "")),
};

if (
  !credentials.host ||
  !credentials.user ||
  !credentials.database ||
  !Number.isInteger(credentials.port)
) {
  console.error("MYSQL_BACKUP_URL is missing required connection details.");
  process.exit(1);
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const describeError = (error) => {
  const details = [
    error?.code,
    error?.errno,
    error?.message,
    ...(Array.isArray(error?.errors)
      ? error.errors.flatMap((nestedError) => [
          nestedError?.code,
          nestedError?.message,
        ])
      : []),
  ].filter(Boolean);
  return [...new Set(details.map(String))].join(": ") || String(error);
};

const retryWaitMs = (attempt) =>
  Math.min(30_000, 4_000 * 2 ** Math.max(0, attempt - 1));

const safeFilename = (value) =>
  String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function hasCompletionMarker(filePath) {
  const stats = await fs.stat(filePath);
  if (stats.size === 0) return false;

  const tailSize = Math.min(stats.size, 16 * 1024);
  const handle = await fs.open(filePath, "r");
  try {
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, stats.size - tailSize);
    return tail.toString("utf8").includes("-- Dump completed on ");
  } finally {
    await handle.close();
  }
}

async function isReusablePart(filePath) {
  try {
    return await hasCompletionMarker(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const [code] = await once(child, "close");
  if (code !== 0) {
    throw new Error(stderr.trim() || `${command} exited with status ${code}`);
  }

  return stdout;
}

async function uploadArchiveToPrivateStorage({
  archiveSha256,
  archiveStats,
  identity,
  manifestParts,
}) {
  if (!backupPolicy.privateStorage) return null;

  const storage = backupPolicy.privateStorage;
  const client = new S3Client({
    region: "auto",
    endpoint: storage.endpoint,
    credentials: {
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
    },
  });
  const archiveKey = `${storage.prefix}/${backupName}.tar.gz`;

  await client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: archiveKey,
      Body: createReadStream(archivePath),
      ContentLength: archiveStats.size,
      ContentType: "application/gzip",
      ContentDisposition: `attachment; filename="${backupName}.tar.gz"`,
      CacheControl: "no-store",
      Metadata: {
        database: credentials.database,
        sha256: archiveSha256,
        parts: String(manifestParts.length),
      },
    })
  );

  const latestStatus = {
    format: "spess-ark-private-backup-status-v1",
    generated_at: new Date().toISOString(),
    database: credentials.database,
    mysql_version: identity.mysql_version,
    archive_key: archiveKey,
    archive_bytes: archiveStats.size,
    archive_sha256: archiveSha256,
    parts: manifestParts.length,
  };
  await client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: `${storage.prefix}/latest.json`,
      Body: Buffer.from(`${JSON.stringify(latestStatus, null, 2)}\n`, "utf8"),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "no-store",
    })
  );

  return { archiveKey };
}

async function dumpToFile(args, filePath) {
  const partialPath = `${filePath}.partial`;
  await fs.rm(partialPath, { force: true });

  const child = spawn("mysqldump", args, {
    env: {
      ...process.env,
      MYSQL_PWD: credentials.password,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const output = createWriteStream(partialPath, {
      encoding: "utf8",
      flags: "wx",
    });
    const [[code]] = await Promise.all([
      once(child, "close"),
      pipeline(child.stdout, output),
    ]);

    if (code !== 0) {
      throw new Error(stderr.trim() || `mysqldump exited with status ${code}`);
    }
    if (!(await hasCompletionMarker(partialPath))) {
      throw new Error("mysqldump output has no completion marker");
    }

    await fs.rename(partialPath, filePath);
  } catch (error) {
    child.kill("SIGTERM");
    await fs.rm(partialPath, { force: true });
    throw error;
  }
}

async function dumpWithRetries(args, filePath, label) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await dumpToFile(args, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const waitMs = retryWaitMs(attempt);
        console.warn(
          `\n  ${label} connection unavailable (attempt ${attempt}/${maxAttempts}); retrying in ${Math.round(
            waitMs / 1000
          )}s...`
        );
        await delay(waitMs);
      }
    }
  }

  throw new Error(`${label} failed: ${describeError(lastError)}`);
}

const baseArgs = [
  "--protocol=TCP",
  "--host",
  credentials.host,
  "--port",
  String(credentials.port),
  "--user",
  credentials.user,
  "--single-transaction",
  "--quick",
  "--network-timeout",
  "--set-gtid-purged=OFF",
  "--skip-lock-tables",
  "--skip-add-locks",
  "--no-tablespaces",
  "--hex-blob",
  "--triggers",
  "--column-statistics=0",
  "--default-character-set=utf8mb4",
];

async function readDatabaseInventory() {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let connection;
    try {
      connection = await mysql.createConnection({
        uri: connectionUrl,
        connectTimeout: 20_000,
      });

      const [[identity]] = await connection.query(`
        SELECT DATABASE() AS database_name, VERSION() AS mysql_version
      `);
      const [objects] = await connection.query(`
        SELECT TABLE_NAME AS object_name, TABLE_TYPE AS object_type
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY
          CASE WHEN TABLE_TYPE = 'BASE TABLE' THEN 0 ELSE 1 END,
          TABLE_NAME
      `);
      return { identity, objects };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const waitMs = retryWaitMs(attempt);
        console.warn(
          `Database inventory connection unavailable (attempt ${attempt}/${maxAttempts}); retrying in ${Math.round(
            waitMs / 1000
          )}s...`
        );
        await delay(waitMs);
      }
    } finally {
      await connection?.end().catch(() => {});
    }
  }

  throw new Error(`Database inventory failed: ${describeError(lastError)}`);
}

async function acquireDatabaseBackupLock() {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let connection;
    try {
      connection = await mysql.createConnection({
        uri: connectionUrl,
        connectTimeout: 20_000,
      });
      const [[row]] = await connection.query(
        "SELECT GET_LOCK('spess_ark_database_backup_v1', 0) AS acquired"
      );
      if (Number(row?.acquired) !== 1) {
        await connection.end().catch(() => {});
        throw new Error("Another resilient database backup is already running.");
      }
      return connection;
    } catch (error) {
      lastError = error;
      await connection?.end().catch(() => {});
      if (String(error?.message || "").includes("already running")) throw error;
      if (attempt < maxAttempts) {
        const waitMs = retryWaitMs(attempt);
        console.warn(
          `Backup lock connection unavailable (attempt ${attempt}/${maxAttempts}); retrying in ${Math.round(
            waitMs / 1000
          )}s...`
        );
        await delay(waitMs);
      }
    }
  }

  throw new Error(`Backup lock failed: ${describeError(lastError)}`);
}

let backupLockConnection;
let backupLockHeartbeat;
let backupLockError;
let archiveValidated = false;

try {
  if (requirePrivateUpload && !backupPolicy.privateStorage) {
    throw new Error(
      "Private backup upload is required, but dedicated BACKUP_R2_* storage is not configured."
    );
  }

  await fs.mkdir(backupRoot, { recursive: true });
  if (resolvedResumeDirectory) {
    const stagingStats = await fs.stat(stagingDirectory);
    if (!stagingStats.isDirectory()) {
      throw new Error(
        `MYSQL_BACKUP_RESUME_DIR is not a directory: ${stagingDirectory}`
      );
    }
  } else {
    await fs.mkdir(stagingDirectory, { recursive: false });
  }

  backupLockConnection = await acquireDatabaseBackupLock();
  backupLockHeartbeat = setInterval(() => {
    backupLockConnection.query("SELECT 1").catch((error) => {
      backupLockError = error;
    });
  }, 15_000);
  backupLockHeartbeat.unref();

  const { identity, objects } = await readDatabaseInventory();

  const tables = objects.filter(
    (object) => object.object_type === "BASE TABLE"
  );
  const views = objects.filter((object) => object.object_type === "VIEW");
  const manifestParts = [];
  const totalParts = tables.length + views.length + 1;
  let completedParts = 0;

  console.log("\nSPESS ARK resilient production backup");
  console.log(`Database: ${identity.database_name}`);
  console.log(`MySQL: ${identity.mysql_version}`);
  console.log(`Tables: ${tables.length}; views: ${views.length}`);
  console.log(`Connection retries: ${maxAttempts}; pacing: ${connectionPauseMs}ms`);
  if (resolvedResumeDirectory) {
    console.log(`Resuming validated SQL parts from: ${stagingDirectory}`);
  }
  console.log(
    "Each object uses a fresh read-only connection to avoid Railway proxy timeouts.\n"
  );

  for (const [index, table] of tables.entries()) {
    const partName = `${String(index + 1).padStart(3, "0")}_table_${safeFilename(
      table.object_name
    )}.sql`;
    const partPath = path.join(stagingDirectory, partName);
    const label = `table ${table.object_name}`;
    if (backupLockError) {
      throw new Error(`Backup lock connection was lost: ${describeError(backupLockError)}`);
    }
    const reused = await isReusablePart(partPath);

    if (reused) {
      process.stdout.write(
        `[${completedParts + 1}/${totalParts}] ${label} ... RESUMED `
      );
    } else {
      process.stdout.write(
        `[${completedParts + 1}/${totalParts}] ${label} ... `
      );
      await dumpWithRetries(
        [...baseArgs, credentials.database, table.object_name],
        partPath,
        label
      );
      await delay(connectionPauseMs);
    }

    const stats = await fs.stat(partPath);
    manifestParts.push({
      file: partName,
      type: "table",
      name: table.object_name,
      bytes: stats.size,
      sha256: await sha256File(partPath),
    });
    completedParts += 1;
    console.log(`OK (${formatBytes(stats.size)})`);
  }

  for (const [index, view] of views.entries()) {
    const partName = `${String(tables.length + index + 1).padStart(
      3,
      "0"
    )}_view_${safeFilename(view.object_name)}.sql`;
    const partPath = path.join(stagingDirectory, partName);
    const label = `view ${view.object_name}`;
    if (backupLockError) {
      throw new Error(`Backup lock connection was lost: ${describeError(backupLockError)}`);
    }
    const reused = await isReusablePart(partPath);

    if (reused) {
      process.stdout.write(
        `[${completedParts + 1}/${totalParts}] ${label} ... RESUMED `
      );
    } else {
      process.stdout.write(
        `[${completedParts + 1}/${totalParts}] ${label} ... `
      );
      await dumpWithRetries(
        [...baseArgs, "--no-data", credentials.database, view.object_name],
        partPath,
        label
      );
      await delay(connectionPauseMs);
    }

    const stats = await fs.stat(partPath);
    manifestParts.push({
      file: partName,
      type: "view",
      name: view.object_name,
      bytes: stats.size,
      sha256: await sha256File(partPath),
    });
    completedParts += 1;
    console.log(`OK (${formatBytes(stats.size)})`);
  }

  const metadataName = `${String(totalParts).padStart(
    3,
    "0"
  )}_routines_and_events.sql`;
  const metadataPath = path.join(stagingDirectory, metadataName);
  if (backupLockError) {
    throw new Error(`Backup lock connection was lost: ${describeError(backupLockError)}`);
  }
  const reusedMetadata = await isReusablePart(metadataPath);
  if (reusedMetadata) {
    process.stdout.write(
      `[${completedParts + 1}/${totalParts}] routines and events ... RESUMED `
    );
  } else {
    process.stdout.write(
      `[${completedParts + 1}/${totalParts}] routines and events ... `
    );
    await dumpWithRetries(
      [
        ...baseArgs,
        "--no-data",
        "--no-create-info",
        "--skip-triggers",
        "--routines",
        "--events",
        "--ignore-views",
        credentials.database,
      ],
      metadataPath,
      "routines and events"
    );
  }
  const metadataStats = await fs.stat(metadataPath);
  manifestParts.push({
    file: metadataName,
    type: "metadata",
    name: "routines_and_events",
    bytes: metadataStats.size,
    sha256: await sha256File(metadataPath),
  });
  completedParts += 1;
  console.log(`OK (${formatBytes(metadataStats.size)})`);

  const manifest = {
    format: "spess-ark-split-mysqldump-v1",
    generated_at: new Date().toISOString(),
    database: credentials.database,
    mysql_version: identity.mysql_version,
    host: credentials.host,
    port: credentials.port,
    restore_order: manifestParts.map((part) => part.file),
    parts: manifestParts,
  };
  await fs.writeFile(
    path.join(stagingDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  await runCommand("tar", [
    "-czf",
    archivePath,
    "-C",
    backupRoot,
    path.basename(stagingDirectory),
  ]);
  await runCommand("tar", ["-tzf", archivePath]);

  const archiveStats = await fs.stat(archivePath);
  const archiveSha256 = await sha256File(archivePath);
  archiveValidated = true;
  let privateUpload = null;

  if (backupPolicy.privateStorage) {
    try {
      privateUpload = await uploadArchiveToPrivateStorage({
        archiveSha256,
        archiveStats,
        identity,
        manifestParts,
      });
    } catch (error) {
      if (requirePrivateUpload) throw error;
      console.warn(
        `Private backup upload failed; the validated local archive was retained: ${describeError(
          error
        )}`
      );
    }
  }

  await fs.rm(stagingDirectory, { recursive: true, force: true });
  const localArchiveRetained = !(privateUpload && deleteLocalAfterPrivateUpload);
  if (!localArchiveRetained) {
    await fs.rm(archivePath, { force: true });
  }

  console.log("\nBACKUP COMPLETE AND VALIDATED");
  console.log(
    localArchiveRetained
      ? `Archive: ${archivePath}`
      : "Local archive: removed after verified private upload"
  );
  console.log(`Size: ${formatBytes(archiveStats.size)}`);
  console.log(`Parts: ${manifestParts.length}`);
  console.log(`SHA-256: ${archiveSha256}`);
  console.log(
    privateUpload
      ? `Private archive: ${privateUpload.archiveKey}`
      : "Private archive: not configured; validated local archive retained"
  );
  console.log(
    "The final archive was created only after every SQL part passed validation."
  );
} catch (error) {
  console.error(`\nBACKUP FAILED: ${error?.message || error}`);
  if (archiveValidated) {
    console.error(`A validated local archive remains at:\n${archivePath}`);
  } else {
    console.error(
      `No completed archive was approved. Partial files, if any, remain in:\n${stagingDirectory}`
    );
  }
  process.exitCode = 1;
} finally {
  if (backupLockHeartbeat) clearInterval(backupLockHeartbeat);
  if (backupLockConnection) {
    await backupLockConnection
      .query("SELECT RELEASE_LOCK('spess_ark_database_backup_v1')")
      .catch(() => {});
    await backupLockConnection.end().catch(() => {});
  }
}
