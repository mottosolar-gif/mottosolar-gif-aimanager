import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";

const migrationsUrl = new URL("./migrations/", import.meta.url);
const files = (await readdir(migrationsUrl))
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  throw new Error("No migration found. Add a SQL file under schema/migrations and retry.");
}

const database = new DatabaseSync(":memory:");
try {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const file of files) {
      database.exec(await readFile(new URL(file, migrationsUrl), "utf8"));
    }
  }

  const expectedTables = [
    "inbox_event",
    "job_queue",
    "ledger",
    "person",
    "person_link",
    "sync_state",
  ];
  const actualTables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    throw new Error(
      `Migration table set is incomplete. Expected ${expectedTables.join(", ")}; got ${actualTables.join(", ")}.`,
    );
  }

  let rejectedBodyRef = false;
  try {
    database
      .prepare(
        `INSERT INTO inbox_event (
          event_id, event_type, source_type, source_hash, occurred_at, received_at,
          payload_bytes, payload_sha256, status, attempts, body_ref, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "migration-check",
        "message",
        "group",
        "a".repeat(64),
        "2026-08-27T00:00:00.000Z",
        "2026-08-27T00:00:01.000Z",
        1,
        "b".repeat(64),
        "pending",
        0,
        "must-not-be-stored",
        "2026-08-27T00:00:01.000Z",
      );
  } catch {
    rejectedBodyRef = true;
  }
  if (!rejectedBodyRef) {
    throw new Error(
      "Migration allowed a non-NULL inbox_event.body_ref. Restore the phase-P0 CHECK constraint and retry.",
    );
  }
} finally {
  database.close();
}

console.log(`Migration check passed twice in memory (${files.length} file(s)); body_ref remains NULL-only.`);
