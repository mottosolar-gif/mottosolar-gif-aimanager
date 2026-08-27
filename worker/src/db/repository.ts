import type { EventMetadata, IngestResult } from "../types.ts";

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
