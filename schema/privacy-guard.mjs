import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const wranglerPkgPath = require.resolve("wrangler/package.json");
const wranglerPkg = require("wrangler/package.json");
const binRelative =
  typeof wranglerPkg.bin === "string" ? wranglerPkg.bin : wranglerPkg.bin.wrangler;
const wranglerBin = path.join(path.dirname(wranglerPkgPath), binRelative);

const ALLOWED_COLUMNS = {
  inbox_event: [
    "id",
    "event_id",
    "event_type",
    "message_type",
    "source_type",
    "source_hash",
    "occurred_at",
    "received_at",
    "payload_bytes",
    "payload_sha256",
    "status",
    "attempts",
    "last_error",
    "body_ref",
    "created_at",
  ],
  job_queue: [
    "id",
    "event_id",
    "kind",
    "status",
    "attempts",
    "next_run_at",
    "idem_key",
    "event_occurred_at",
    "last_error",
    "created_at",
  ],
  person: ["id", "person_code", "department", "role", "created_at"],
  person_link: [
    "id",
    "person_code",
    "source_type",
    "source_hash",
    "linked_at",
    "created_at",
  ],
  ledger: [
    "id",
    "action_type",
    "outcome",
    "reference_id",
    "actor_code",
    "occurred_at",
    "created_at",
  ],
  sync_state: [
    "source_key",
    "checkpoint",
    "source_occurred_at",
    "synced_at",
    "updated_at",
    "created_at",
  ],
};
const allowedColumns = new Map(
  Object.entries(ALLOWED_COLUMNS).map(([table, columns]) => [table, new Set(columns)]),
);
const constraintWords = new Set([
  "primary",
  "foreign",
  "unique",
  "check",
  "constraint",
]);
const rawLineIdPattern = /^(?:U|C)[0-9a-f]{32}$/i;

const migrationsDir = new URL("./migrations/", import.meta.url);
const migrationFiles = (await readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error("No SQL migration was found. Add one under schema/migrations and rerun the guard.");
}

const violations = [];
for (const file of migrationFiles) {
  const sql = await readFile(new URL(file, migrationsDir), "utf8");
  const tablePattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([A-Za-z0-9_]+)[`"\]]?\s*\(([\s\S]*?)\)\s*;/gi;
  let tableMatch;
  while ((tableMatch = tablePattern.exec(sql)) !== null) {
    const [, rawTableName, body] = tableMatch;
    const tableName = rawTableName.toLowerCase();
    const tableAllowlist = allowedColumns.get(tableName);
    if (!tableAllowlist) {
      violations.push(
        `${file}: unknown table ${rawTableName} — add it to ALLOWED_COLUMNS in privacy-guard.mjs after confirming it holds no PII`,
      );
    }
    const columns = [];
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim().replace(/,$/, "");
      if (!line) continue;
      const columnMatch = line.match(/^[`"[]?([A-Za-z_][A-Za-z0-9_]*)[`"\]]?\s+/);
      if (!columnMatch) continue;
      const column = columnMatch[1].toLowerCase();
      if (constraintWords.has(column)) continue;
      columns.push(column);
      if (tableAllowlist && !tableAllowlist.has(column)) {
        violations.push(
          `${file}: ${rawTableName}.${column} is not in ALLOWED_COLUMNS; remove it or add it only after confirming it holds no PII`,
        );
      }
    }
    if (!columns.includes("created_at")) {
      violations.push(`${file}: ${tableName} has no created_at column`);
    }
    if (tableName === "inbox_event" && !/body_ref\s+TEXT\s+CHECK\s*\(body_ref\s+IS\s+NULL\)/i.test(body)) {
      violations.push(`${file}: inbox_event.body_ref is not constrained to NULL`);
    }
  }

  const addColumnPattern = /ALTER\s+TABLE\s+[`"[]?([A-Za-z0-9_]+)[`"\]]?\s+ADD(?:\s+COLUMN)?\s+[`"[]?([A-Za-z_][A-Za-z0-9_]*)[`"\]]?/gi;
  let addColumnMatch;
  while ((addColumnMatch = addColumnPattern.exec(sql)) !== null) {
    const [, rawTableName, rawColumn] = addColumnMatch;
    const tableName = rawTableName.toLowerCase();
    const column = rawColumn.toLowerCase();
    const tableAllowlist = allowedColumns.get(tableName);
    if (!tableAllowlist) {
      violations.push(
        `${file}: unknown table ${rawTableName} — add it to ALLOWED_COLUMNS in privacy-guard.mjs after confirming it holds no PII`,
      );
    } else if (!tableAllowlist.has(column)) {
      violations.push(
        `${file}: ${rawTableName}.${column} is not in ALLOWED_COLUMNS; remove it or add it only after confirming it holds no PII`,
      );
    }
  }

  if (/\bENUM\s*\(/i.test(sql)) {
    violations.push(`${file}: ENUM is forbidden; use TEXT for status and type columns`);
  }
}

if (violations.length > 0) {
  throw new Error(`Privacy schema guard failed:\n- ${violations.join("\n- ")}\nRemove unapproved schema fields and rerun npm run privacy:check.`);
}

const mode = process.argv.includes("--remote")
  ? "remote"
  : process.argv.includes("--local")
    ? "local"
    : "schema-only";

if (mode !== "schema-only") {
  const outputPath = path.join(tmpdir(), `aim-privacy-${randomUUID()}.sql`);
  const config = mode === "remote" ? "worker/wrangler.toml" : "worker/wrangler.local.toml";
  try {
    const result = spawnSync(
      process.execPath,
      [
        wranglerBin,
        "d1",
        "export",
        "aim-db",
        `--${mode}`,
        "--config",
        config,
        "--output",
        outputPath,
      ],
      {
        cwd: path.resolve("."),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (result.error) {
      throw new Error(`ไม่สามารถเรียก wrangler ได้: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        `Could not inspect the ${mode} D1 database. Apply migrations and check its Wrangler configuration, then rerun this guard. ${(result.stderr || result.stdout || "no output captured").trim()}`,
      );
    }
    const dump = await readFile(outputPath, "utf8");
    const database = new DatabaseSync(":memory:");
    let rawIdCount = 0;
    let nonNullBodyRefCount = 0;
    try {
      database.exec(dump);
      nonNullBodyRefCount = Number(
        database
          .prepare("SELECT COUNT(*) AS count FROM inbox_event WHERE body_ref IS NOT NULL")
          .get().count,
      );
      const tables = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .all()
        .map((row) => String(row.name));
      for (const table of tables) {
        const quotedTable = `"${table.replaceAll('"', '""')}"`;
        const columns = database
          .prepare(`PRAGMA table_info(${quotedTable})`)
          .all()
          .map((row) => String(row.name));
        for (const column of columns) {
          const quotedColumn = `"${column.replaceAll('"', '""')}"`;
          const rows = database
            .prepare(
              `SELECT ${quotedColumn} AS value FROM ${quotedTable} WHERE typeof(${quotedColumn}) = 'text'`,
            )
            .all();
          for (const row of rows) {
            if (rawLineIdPattern.test(String(row.value))) rawIdCount += 1;
          }
        }
      }
    } finally {
      database.close();
    }
    if (rawIdCount > 0 || nonNullBodyRefCount > 0) {
      throw new Error(
        `Privacy data guard failed: raw LINE ID matches=${rawIdCount}, non-NULL body_ref rows=${nonNullBodyRefCount}. Remove the prohibited values, then rerun this guard.`,
      );
    }
  } finally {
    await rm(outputPath, { force: true });
  }
}

console.log(`Privacy guard passed (${mode}); checked ${migrationFiles.length} migration file(s).`);
