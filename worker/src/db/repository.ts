import type { EventMetadata, IngestResult } from "../types.ts";

export interface PendingJob {
  id: number;
  eventId: string;
  kind: string;
  attempts: number;
}

const insertInboxSql = `
  INSERT OR IGNORE INTO inbox_event (
    event_id, event_type, message_type, source_type, source_hash,
    occurred_at, received_at, payload_bytes, payload_sha256,
    status, attempts, last_error, body_ref, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?)
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

  values.push(current.taskRef);
  await db.batch([
    db
      .prepare(`UPDATE task SET ${assignments.join(", ")} WHERE task_ref = ?`)
      .bind(...values),
    db
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
      ),
  ]);

  const updated = await readTaskByRef(db, current.taskRef);
  if (!updated) throw new Error("task not found after transition: " + current.taskRef);
  return updated;
}
