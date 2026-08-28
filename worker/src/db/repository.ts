import type { EventMetadata, IngestResult } from "../types.ts";

export interface PendingJob {
  id: number;
  eventId: string;
  kind: string;
  attempts: number;
}

export interface SummaryDeliveryClaim {
  ledgerId: number;
  attempt: number;
}

export type SummaryTerminalOutcome =
  | "sent"
  | "empty"
  | "missed";

const summaryActionType = "scheduled_summary";
const summaryTerminalOutcomes = ["sent", "empty", "missed"] as const;

const insertInboxSql = `
  INSERT OR IGNORE INTO inbox_event (
    event_id, event_type, message_type, source_type, source_hash,
    postback_data, occurred_at, received_at, payload_bytes, payload_sha256,
    status, attempts, last_error, body_ref, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?)
`;

const insertJobSql = `
  INSERT OR IGNORE INTO job_queue (
    event_id, kind, status, attempts, next_run_at, idem_key,
    event_occurred_at, last_error, created_at
  ) VALUES (?, 'line_event', 'pending', 0, ?, ?, ?, NULL, ?)
`;

const selectPendingJobsSql = `
  SELECT id, event_id, kind, attempts
  FROM job_queue
  WHERE status = 'pending' AND next_run_at <= ?
  ORDER BY next_run_at ASC
  LIMIT ?
`;

const insertLedgerSql = `
  INSERT INTO ledger (
    action_type, outcome, reference_id, actor_code, occurred_at, created_at
  ) VALUES (?, ?, ?, NULL, ?, ?)
`;

export async function enqueueEvents(
  db: D1Database,
  events: EventMetadata[],
): Promise<IngestResult> {
  const statements: D1PreparedStatement[] = [];
  for (const event of events) {
    statements.push(
      db
        .prepare(insertInboxSql)
        .bind(
          event.eventId,
          event.eventType,
          event.messageType,
          event.sourceType,
          event.sourceHash,
          event.postbackData,
          event.occurredAt,
          event.receivedAt,
          event.payloadBytes,
          event.payloadSha256,
          event.receivedAt,
        ),
      db
        .prepare(insertJobSql)
        .bind(
          event.eventId,
          event.receivedAt,
          event.eventId,
          event.occurredAt,
          event.receivedAt,
        ),
    );
  }

  // D1 batch is transactional. The unique keys make concurrent retries safe without
  // persisting the original payload in either table.
  const results = await db.batch(statements);
  let accepted = 0;
  let duplicates = 0;
  for (let index = 0; index < events.length; index += 1) {
    const inboxResult = results[index * 2];
    if ((inboxResult.meta.changes ?? 0) > 0) accepted += 1;
    else duplicates += 1;
  }
  return { accepted, duplicates };
}

export async function readHealth(db: D1Database): Promise<{
  queueDepth: number;
  lastIngestAt: string | null;
}> {
  const [queue, ingest] = await db.batch([
    db.prepare("SELECT COUNT(*) AS depth FROM job_queue WHERE status = 'pending'"),
    db.prepare("SELECT MAX(received_at) AS last_ingest_at FROM inbox_event"),
  ]);
  const queueRow = queue.results[0] as { depth?: number | string } | undefined;
  const ingestRow = ingest.results[0] as { last_ingest_at?: string | null } | undefined;
  return {
    queueDepth: Number(queueRow?.depth ?? 0),
    lastIngestAt: ingestRow?.last_ingest_at ?? null,
  };
}

export async function readPendingJobs(
  db: D1Database,
  now: string,
  limit: number,
): Promise<PendingJob[]> {
  const query = await db
    .prepare(selectPendingJobsSql)
    .bind(now, limit)
    .all<{ id: number; event_id: string; kind: string; attempts: number }>();
  return query.results.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    kind: row.kind,
    attempts: row.attempts,
  }));
}

export async function findPersonCodeBySourceHash(
  db: D1Database,
  sourceHash: string,
): Promise<string | null> {
  const query = await db
    .prepare("SELECT person_code FROM person_link WHERE source_hash = ?")
    .bind(sourceHash)
    .all<{ person_code: string }>();
  return query.results[0]?.person_code ?? null;
}

// ★ 2026-08-28 (WP-P2-B2 · F7 จาก code-reviewer): เดิม /ask เชื่อ person_code ที่ผู้เรียกส่งมา
//   โดยไม่ตรวจอะไรเลย ⇒ ใครถือ AIM_ASK_KEY ถามแทนใครก็ได้ ต่างจากเส้นทางปุ่มกดที่ taskMachine
//   ตรวจ ownership ซ้ำอีกชั้น · รับเฉพาะคนที่ผูกบัญชีจริงแล้ว = ชั้นป้องกันที่ได้จากข้อมูลที่มีอยู่แล้ว
export async function personIsLinked(
  db: D1Database,
  personCode: string,
): Promise<boolean> {
  const query = await db
    .prepare("SELECT 1 AS linked FROM person_link WHERE person_code = ? LIMIT 1")
    .bind(personCode)
    .all<{ linked: number }>();
  return query.results.length > 0;
}

export async function readLinkedPersonCodes(db: D1Database): Promise<string[]> {
  const query = await db
    .prepare(
      `SELECT DISTINCT person.person_code
       FROM person
       INNER JOIN person_link ON person_link.person_code = person.person_code
       ORDER BY person.person_code`,
    )
    .all<{ person_code: string }>();
  return query.results.map((row) => row.person_code);
}

export async function readLatestCronBefore(
  db: D1Database,
  now: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MAX(occurred_at) AS occurred_at
       FROM ledger
       WHERE action_type = 'cron_tick' AND occurred_at < ?`,
    )
    .bind(now)
    .first<{ occurred_at: string | null }>();
  return row?.occurred_at ?? null;
}

export async function claimSummaryDelivery(
  db: D1Database,
  referenceId: string,
  personCode: string,
  now: string,
): Promise<SummaryDeliveryClaim | null> {
  const history = await db
    .prepare(
      `SELECT outcome, occurred_at
       FROM ledger
       WHERE action_type = ? AND reference_id = ? AND actor_code = ?
       ORDER BY id`,
    )
    .bind(summaryActionType, referenceId, personCode)
    .all<{ outcome: string; occurred_at: string }>();

  if (history.results.some((row) => isSummaryTerminalOutcome(row.outcome))) {
    return null;
  }

  const failedAttempts = history.results.filter(
    (row) => row.outcome === "processing" || row.outcome.startsWith("retry:"),
  ).length;
  const retries = history.results.filter((row) => row.outcome.startsWith("retry:"));
  const latestRetry = retries.at(-1);
  if (latestRetry) {
    const delayMilliseconds = 60_000 * 2 ** Math.max(0, retries.length - 1);
    if (Date.parse(now) < Date.parse(latestRetry.occurred_at) + delayMilliseconds) {
      return null;
    }
  }

  // A fetch is aborted after 10 seconds. Fifteen minutes is therefore safely stale,
  // while still preventing overlapping cron invocations from sending the same round.
  const staleBefore = new Date(Date.parse(now) - 15 * 60_000).toISOString();
  const terminalPlaceholders = summaryTerminalOutcomes.map(() => "?").join(", ");
  const inserted = await db
    .prepare(
      `INSERT INTO ledger (
         action_type, outcome, reference_id, actor_code, occurred_at, created_at
       )
       SELECT ?, 'processing', ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM ledger
         WHERE action_type = ? AND reference_id = ? AND actor_code = ?
           AND (outcome IN (${terminalPlaceholders}) OR outcome LIKE 'dead:%')
       )
       AND NOT EXISTS (
         SELECT 1 FROM ledger
         WHERE action_type = ? AND reference_id = ? AND actor_code = ?
           AND outcome = 'processing' AND occurred_at > ?
       )`,
    )
    .bind(
      summaryActionType,
      referenceId,
      personCode,
      now,
      now,
      summaryActionType,
      referenceId,
      personCode,
      ...summaryTerminalOutcomes,
      summaryActionType,
      referenceId,
      personCode,
      staleBefore,
    )
    .run();

  if ((inserted.meta.changes ?? 0) === 0) return null;
  return {
    ledgerId: Number(inserted.meta.last_row_id),
    attempt: failedAttempts + 1,
  };
}

export async function finishSummaryDelivery(
  db: D1Database,
  ledgerId: number,
  outcome: SummaryTerminalOutcome | `retry:${string}` | `dead:${string}`,
): Promise<void> {
  const updated = await db
    .prepare("UPDATE ledger SET outcome = ? WHERE id = ? AND outcome = 'processing'")
    .bind(outcome, ledgerId)
    .run();
  if ((updated.meta.changes ?? 0) === 0) {
    throw new Error("summary delivery claim was not resolved; retry the cron tick");
  }
}

export async function recordSummaryTerminal(
  db: D1Database,
  referenceId: string,
  personCode: string,
  outcome: Extract<SummaryTerminalOutcome, "missed">,
  now: string,
): Promise<boolean> {
  const terminalPlaceholders = summaryTerminalOutcomes.map(() => "?").join(", ");
  const staleBefore = new Date(Date.parse(now) - 15 * 60_000).toISOString();
  const inserted = await db
    .prepare(
      `INSERT INTO ledger (
         action_type, outcome, reference_id, actor_code, occurred_at, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM ledger
         WHERE action_type = ? AND reference_id = ? AND actor_code = ?
           AND (outcome IN (${terminalPlaceholders}) OR outcome LIKE 'dead:%')
       )
       AND NOT EXISTS (
         SELECT 1 FROM ledger
         WHERE action_type = ? AND reference_id = ? AND actor_code = ?
           AND outcome = 'processing' AND occurred_at > ?
       )`,
    )
    .bind(
      summaryActionType,
      outcome,
      referenceId,
      personCode,
      now,
      now,
      summaryActionType,
      referenceId,
      personCode,
      ...summaryTerminalOutcomes,
      summaryActionType,
      referenceId,
      personCode,
      staleBefore,
    )
    .run();
  return (inserted.meta.changes ?? 0) > 0;
}

export async function recordSummaryPassIssue(
  db: D1Database,
  referenceId: string,
  outcome: "config_missing" | "pass_error",
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ledger (
         action_type, outcome, reference_id, actor_code, occurred_at, created_at
       )
       SELECT 'scheduled_summary_pass', ?, ?, NULL, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM ledger
         WHERE action_type = 'scheduled_summary_pass'
           AND outcome = ? AND reference_id = ?
       )`,
    )
    .bind(outcome, referenceId, now, now, outcome, referenceId)
    .run();
}

export async function recordSummaryPersonIssue(
  db: D1Database,
  referenceId: string,
  personCode: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ledger (
         action_type, outcome, reference_id, actor_code, occurred_at, created_at
       ) VALUES ('scheduled_summary_error', 'retry', ?, ?, ?, ?)`,
    )
    .bind(referenceId, personCode, now, now)
    .run();
}

export async function recordSummaryCatchupSkip(
  db: D1Database,
  skippedRounds: number,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ledger (
         action_type, outcome, reference_id, actor_code, occurred_at, created_at
       ) VALUES ('scheduled_summary_catchup', 'skipped', ?, NULL, ?, ?)`,
    )
    .bind(String(skippedRounds), now, now)
    .run();
}

function isSummaryTerminalOutcome(outcome: string): boolean {
  return (
    summaryTerminalOutcomes.some((candidate) => candidate === outcome) ||
    outcome.startsWith("dead:")
  );
}

export type LinkOutcome =
  | { status: "created" }
  | { status: "exists" }
  | { status: "conflict"; existingPersonCode: string };

// ★ 2026-08-28 (WP-P2-C1): ผูก person_code เข้ากับ source_hash
//   จนถึงวันนี้ไม่มีโค้ด production ตัวไหนเขียนตารางนี้เลย — 2 แถวที่มีอยู่มาจากการพิมพ์
//   wrangler d1 execute ด้วยมือ ⇒ พนักงานคนที่ 3 เป็นต้นไปติด 403 ตลอดกาลหลัง /ask บังคับ link
//   ห้ามทับของเดิมเงียบ ๆ: hash เดิมที่ผูกกับคนอื่นอยู่แล้วต้องคืน conflict ให้คนตัดสิน
export async function linkPerson(
  db: D1Database,
  personCode: string,
  sourceHash: string,
  department: string,
  role: string,
  now: string,
): Promise<LinkOutcome> {
  const existing = await db
    .prepare("SELECT person_code FROM person_link WHERE source_hash = ?")
    .bind(sourceHash)
    .all<{ person_code: string }>();
  const bound = existing.results[0]?.person_code;
  if (bound !== undefined) {
    return bound === personCode
      ? { status: "exists" }
      : { status: "conflict", existingPersonCode: bound };
  }

  // person อาจยังไม่มี — สร้างให้ แต่ถ้ามีอยู่แล้วห้ามแก้ department/role ของเดิม
  await db
    .prepare(
      "INSERT OR IGNORE INTO person (person_code, department, role) VALUES (?, ?, ?)",
    )
    .bind(personCode, department, role)
    .run();

  await db
    .prepare(
      `INSERT INTO person_link (person_code, source_type, source_hash, linked_at)
       VALUES (?, 'user', ?, ?)`,
    )
    .bind(personCode, sourceHash, now)
    .run();

  await db
    .prepare(insertLedgerSql)
    .bind("person_linked", "ok", personCode, now, now)
    .run();

  return { status: "created" };
}

export async function readInboxPostback(
  db: D1Database,
  eventId: string,
): Promise<{ postbackData: string | null; sourceHash: string | null } | null> {
  const query = await db
    .prepare(
      "SELECT postback_data, source_hash FROM inbox_event WHERE event_id = ?",
    )
    .bind(eventId)
    .all<{ postback_data: string | null; source_hash: string | null }>();
  const row = query.results[0];
  return row
    ? { postbackData: row.postback_data, sourceHash: row.source_hash }
    : null;
}

export async function claimPendingJob(
  db: D1Database,
  jobId: number,
): Promise<boolean> {
  const claimed = await db
    .prepare(
      "UPDATE job_queue SET status = 'processing' WHERE id = ? AND status = 'pending'",
    )
    .bind(jobId)
    .run();
  return (claimed.meta.changes ?? 0) > 0;
}

export async function completeJob(
  db: D1Database,
  jobId: number,
  eventId: string,
  now: string,
): Promise<void> {
  await db.batch([
    db.prepare("UPDATE job_queue SET status = 'done' WHERE id = ?").bind(jobId),
    db
      .prepare("UPDATE inbox_event SET status = 'done' WHERE event_id = ?")
      .bind(eventId),
    db
      .prepare(insertLedgerSql)
      .bind("line_event_processed", "ok", eventId, now, now),
  ]);
}

export async function retryJob(
  db: D1Database,
  jobId: number,
  eventId: string,
  attempts: number,
  nextRunAt: string,
  errorMessage: string,
  now: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE job_queue
         SET status = 'pending', attempts = ?, next_run_at = ?, last_error = ?
         WHERE id = ?`,
      )
      .bind(attempts, nextRunAt, errorMessage, jobId),
    db
      .prepare(insertLedgerSql)
      .bind("line_event_processed", "retry", eventId, now, now),
  ]);
}

export async function killJob(
  db: D1Database,
  jobId: number,
  eventId: string,
  attempts: number,
  errorMessage: string,
  now: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE job_queue
         SET status = 'dead', attempts = ?, last_error = ?
         WHERE id = ?`,
      )
      .bind(attempts, errorMessage, jobId),
    db
      .prepare(insertLedgerSql)
      .bind("line_event_processed", "dead", eventId, now, now),
  ]);
}

export async function recordCronTick(
  db: D1Database,
  processed: number,
  now: string,
): Promise<void> {
  await db
    .prepare(insertLedgerSql)
    .bind("cron_tick", "ok", String(processed), now, now)
    .run();
}

type TaskRow = import("../taskMachine.ts").TaskRow;

interface TaskDatabaseRow {
  id: number;
  task_ref: string;
  title: string;
  description: string | null;
  status: string;
  assignee_person_code: string | null;
  creator_person_code: string | null;
  priority: string;
  scheduled_at: string | null;
  due_at: string | null;
  location_text: string | null;
  location_lat: number | null;
  location_lng: number | null;
  accepted_at: string | null;
  started_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  completion_note: string | null;
  created_at: string;
  updated_at: string;
}

function mapTaskRow(row: TaskDatabaseRow): TaskRow {
  return {
    id: row.id,
    taskRef: row.task_ref,
    title: row.title,
    description: row.description,
    status: row.status,
    assigneePersonCode: row.assignee_person_code,
    creatorPersonCode: row.creator_person_code,
    priority: row.priority,
    scheduledAt: row.scheduled_at,
    dueAt: row.due_at,
    locationText: row.location_text,
    locationLat: row.location_lat,
    locationLng: row.location_lng,
    acceptedAt: row.accepted_at,
    startedAt: row.started_at,
    arrivedAt: row.arrived_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    completionNote: row.completion_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function readTaskByRef(
  db: D1Database,
  taskRef: string,
): Promise<TaskRow | null> {
  const query = await db
    .prepare("SELECT * FROM task WHERE task_ref = ?")
    .bind(taskRef)
    .all<TaskDatabaseRow>();
  const row = query.results[0];
  return row ? mapTaskRow(row) : null;
}

export async function applyTaskTransition(
  db: D1Database,
  current: TaskRow,
  toStatus: string,
  actorPersonCode: string | null,
  source: string,
  note: string | null,
  now: string,
): Promise<TaskRow> {
  const assignments = ["status = ?", "updated_at = ?"];
  const values: unknown[] = [toStatus, now];

  const timestampColumn: Partial<Record<string, string>> = {
    accepted: "accepted_at",
    en_route: "started_at",
    arrived: "arrived_at",
    completed: "completed_at",
    cancelled: "cancelled_at",
  };
  const column = timestampColumn[toStatus];
  if (column) {
    assignments.push(`${column} = ?`);
    values.push(now);
  }
  if (toStatus === "cancelled" && note !== null) {
    assignments.push("cancel_reason = ?");
    values.push(note);
  }
  if (toStatus === "completed" && note !== null) {
    assignments.push("completion_note = ?");
    values.push(note);
  }

  values.push(current.taskRef, current.status);
  const updateResult = await db
    .prepare(
      `UPDATE task SET ${assignments.join(", ")} WHERE task_ref = ? AND status = ?`,
    )
    .bind(...values)
    .run();

  if ((updateResult.meta.changes ?? 0) === 0) {
    throw new Error(
      `task status changed concurrently: expected '${current.status}' for ${current.taskRef}, retry the transition`,
    );
  }

  await db
    .prepare(
      `INSERT INTO task_event (
        task_ref, actor_person_code, old_status, new_status,
        source, note, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      current.taskRef,
      actorPersonCode,
      current.status,
      toStatus,
      source,
      note,
      now,
    )
    .run();

  const updated = await readTaskByRef(db, current.taskRef);
  if (!updated) throw new Error("task not found after transition: " + current.taskRef);
  return updated;
}
