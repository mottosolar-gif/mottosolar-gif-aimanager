import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const forbiddenColumns = new Set([
  "name",
  "fullname",
  "full_name",
  "first_name",
  "last_name",
  "surname",
  "display_name",
  "phone",
  "telephone",
  "mobile",
  "email",
  "reason",
  "leave_reason",
  "text",
  "message",
]);
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
  const tablePattern = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+[`"[]?([A-Za-z0-9_]+)[`"\]]?\s*\(([\s\S]*?)\)\s*;/gi;
  let tableMatch;
  while ((tableMatch = tablePattern.exec(sql)) !== null) {
    const [, tableName, body] = tableMatch;
    const columns = [];
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim().replace(/,$/, "");
      if (!line) continue;
      const columnMatch = line.match(/^[`"[]?([A-Za-z_][A-Za-z0-9_]*)[`"\]]?\s+/);
      if (!columnMatch) continue;
      const column = columnMatch[1].toLowerCase();
      if (constraintWords.has(column)) continue;
      columns.push(column);
      if (forbiddenColumns.has(column)) {
        violations.push(`${file}: ${tableName}.${column} is a forbidden personal-data column`);
      }
    }
    if (!columns.includes("created_at")) {
      violations.push(`${file}: ${tableName} has no created_at column`);
    }
    if (tableName === "inbox_event" && !/body_ref\s+TEXT\s+CHECK\s*\(body_ref\s+IS\s+NULL\)/i.test(body)) {
      violations.push(`${file}: inbox_event.body_ref is not constrained to NULL`);
    }
  }

  if (/\bENUM\s*\(/i.test(sql)) {
    violations.push(`${file}: ENUM is forbidden; use TEXT for status and type columns`);
  }
}

if (violations.length > 0) {
  throw new Error(`Privacy schema guard failed:\n- ${violations.join("\n- ")}\nRemove the forbidden fields and rerun npm run privacy:check.`);
}

const mode = process.argv.includes("--remote")
  ? "remote"
  : process.argv.includes("--local")
    ? "local"
    : "schema-only";

if (mode !== "schema-only") {
  const outputPath = join(tmpdir(), `aim-privacy-${randomUUID()}.sql`);
  const config = mode === "remote" ? "worker/wrangler.toml" : "worker/wrangler.local.toml";
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  try {
    const result = spawnSync(
      npx,
      [
        "--no-install",
        "wrangler",
        "d1",
        "export",
        "aim-db",
        `--${mode}`,
        "--config",
        config,
        "--output",
        outputPath,
      ],
      { cwd: resolve("."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (result.status !== 0) {
      throw new Error(
        `Could not inspect the ${mode} D1 database. Apply migrations and check its Wrangler configuration, then rerun this guard. ${(result.stderr || result.stdout).trim()}`,
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
