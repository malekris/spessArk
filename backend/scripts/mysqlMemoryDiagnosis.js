import mysql from "mysql2/promise";

const connectionUrl = String(process.env.MYSQL_DIAGNOSTIC_URL || "").trim();

if (!connectionUrl) {
  console.error(
    "MYSQL_DIAGNOSTIC_URL is required. Use Railway's MYSQL_PUBLIC_URL for this read-only check."
  );
  process.exit(1);
}

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMb = (bytes) => `${(toNumber(bytes) / 1024 / 1024).toFixed(2)} MB`;

const rowsToMap = (rows) =>
  Object.fromEntries(
    rows.map((row) => [String(row.Variable_name), String(row.Value)])
  );

let connection;

try {
  connection = await mysql.createConnection({
    uri: connectionUrl,
    connectTimeout: 15_000,
  });

  const [[identity]] = await connection.query(`
    SELECT
      DATABASE() AS database_name,
      VERSION() AS mysql_version,
      UTC_TIMESTAMP() AS checked_at_utc
  `);

  const [[totals]] = await connection.query(`
    SELECT
      COUNT(*) AS table_count,
      COALESCE(SUM(TABLE_ROWS), 0) AS estimated_rows,
      COALESCE(SUM(DATA_LENGTH), 0) AS data_bytes,
      COALESCE(SUM(INDEX_LENGTH), 0) AS index_bytes,
      COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) AS total_bytes
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
  `);

  const [largestTables] = await connection.query(`
    SELECT
      TABLE_NAME AS table_name,
      TABLE_ROWS AS estimated_rows,
      ROUND(DATA_LENGTH / 1024 / 1024, 2) AS data_mb,
      ROUND(INDEX_LENGTH / 1024 / 1024, 2) AS index_mb,
      ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) AS total_mb
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY DATA_LENGTH + INDEX_LENGTH DESC
    LIMIT 30
  `);

  const [variableRows] = await connection.query(`
    SHOW GLOBAL VARIABLES
    WHERE Variable_name IN (
      'innodb_buffer_pool_size',
      'innodb_page_size',
      'max_connections',
      'tmp_table_size',
      'max_heap_table_size',
      'table_open_cache',
      'performance_schema',
      'sort_buffer_size',
      'join_buffer_size',
      'read_buffer_size',
      'read_rnd_buffer_size'
    )
  `);

  const [statusRows] = await connection.query(`
    SHOW GLOBAL STATUS
    WHERE Variable_name IN (
      'Threads_connected',
      'Threads_running',
      'Max_used_connections',
      'Created_tmp_tables',
      'Created_tmp_disk_tables',
      'Opened_tables',
      'Open_tables',
      'Innodb_buffer_pool_pages_total',
      'Innodb_buffer_pool_pages_data',
      'Innodb_buffer_pool_pages_dirty',
      'Innodb_buffer_pool_pages_free',
      'Innodb_buffer_pool_reads',
      'Innodb_buffer_pool_read_requests'
    )
  `);

  const [processSummary] = await connection.query(`
    SELECT
      COMMAND AS command_name,
      COUNT(*) AS connection_count,
      MAX(TIME) AS longest_seconds
    FROM information_schema.PROCESSLIST
    GROUP BY COMMAND
    ORDER BY connection_count DESC
  `);

  const variables = rowsToMap(variableRows);
  const status = rowsToMap(statusRows);
  const pageSize = toNumber(variables.innodb_page_size) || 16_384;
  const poolPages = toNumber(status.Innodb_buffer_pool_pages_total);
  const dataPages = toNumber(status.Innodb_buffer_pool_pages_data);
  const freePages = toNumber(status.Innodb_buffer_pool_pages_free);
  const readRequests = toNumber(status.Innodb_buffer_pool_read_requests);
  const diskReads = toNumber(status.Innodb_buffer_pool_reads);
  const tempTables = toNumber(status.Created_tmp_tables);
  const diskTempTables = toNumber(status.Created_tmp_disk_tables);

  console.log("\nSPESS ARK MySQL read-only memory diagnosis");
  console.table([
    {
      database: identity.database_name,
      mysql_version: identity.mysql_version,
      checked_at_utc: identity.checked_at_utc,
    },
  ]);

  console.log("\nDatabase footprint");
  console.table([
    {
      tables: toNumber(totals.table_count),
      estimated_rows: toNumber(totals.estimated_rows),
      data: formatMb(totals.data_bytes),
      indexes: formatMb(totals.index_bytes),
      total: formatMb(totals.total_bytes),
    },
  ]);

  console.log("\nLargest tables");
  console.table(largestTables);

  console.log("\nMySQL memory configuration");
  console.table([
    {
      buffer_pool: formatMb(variables.innodb_buffer_pool_size),
      tmp_table_limit: formatMb(variables.tmp_table_size),
      heap_table_limit: formatMb(variables.max_heap_table_size),
      max_connections: toNumber(variables.max_connections),
      table_open_cache: toNumber(variables.table_open_cache),
      performance_schema: variables.performance_schema,
    },
  ]);

  console.log("\nCurrent and historical status");
  console.table([
    {
      threads_connected: toNumber(status.Threads_connected),
      threads_running: toNumber(status.Threads_running),
      max_used_connections: toNumber(status.Max_used_connections),
      open_tables: toNumber(status.Open_tables),
      opened_tables: toNumber(status.Opened_tables),
      temp_tables: tempTables,
      disk_temp_tables: diskTempTables,
    },
  ]);

  console.log("\nInnoDB buffer-pool evidence");
  console.table([
    {
      configured_pool: formatMb(variables.innodb_buffer_pool_size),
      resident_data_pages: formatMb(dataPages * pageSize),
      free_pool_pages: formatMb(freePages * pageSize),
      pool_utilization_pct:
        poolPages > 0 ? ((dataPages / poolPages) * 100).toFixed(2) : "n/a",
      buffer_hit_pct:
        readRequests > 0
          ? ((1 - diskReads / readRequests) * 100).toFixed(4)
          : "n/a",
      disk_temp_pct:
        tempTables > 0 ? ((diskTempTables / tempTables) * 100).toFixed(2) : "0.00",
    },
  ]);

  console.log("\nConnection summary (query text intentionally omitted)");
  console.table(processSummary);
} catch (error) {
  console.error(
    "Read-only MySQL diagnosis failed:",
    error?.code || error?.message || error
  );
  process.exitCode = 1;
} finally {
  await connection?.end().catch(() => {});
}
