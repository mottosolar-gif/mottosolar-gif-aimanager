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
  LIMIT 10
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
): Promise<PendingJob[]> {
  const query = await db
    .prepare(selectPendingJobsSql)
    .bind(now)
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
