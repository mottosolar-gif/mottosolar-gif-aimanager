import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index.ts";
import { processQueue } from "../src/queue.ts";
import type { Env } from "../src/types.ts";

interface StoredInbox {
  event_id: string;
  event_type: string;
  message_type: string | null;
  source_type: string;
  source_hash: string;
  occurred_at: string;
  received_at: string;
  payload_bytes: number;
  payload_sha256: string;
  status: string;
  body_ref: null;
}

interface StoredJob {
  id: number;
  event_id: string;
  kind: string;
  idem_key: string;
  status: string;
  attempts: number;
  next_run_at: string;
  event_occurred_at: string;
  last_error: string | null;
  created_at: string;
}

interface StoredLedger {
  action_type: string;
  outcome: string;
  reference_id: string | null;
  actor_code: null;
  occurred_at: string;
  created_at: string;
}

class MemoryStatement {
  values: unknown[] = [];

  constructor(
    readonly database: MemoryD1,
    readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this as unknown as D1PreparedStatement;
  }

  async all<T>(): Promise<D1Result<T>> {
    return this.database.execute(this) as D1Result<T>;
  }

  async run(): Promise<D1Result> {
    return this.database.execute(this);
  }
}

class MemoryD1 {
  inboxEvents: StoredInbox[] = [];
  jobs: StoredJob[] = [];
  ledgerRows: StoredLedger[] = [];
  failDoneUpdateOnce = false;

  failNextDoneUpdate(): void {
    this.failDoneUpdateOnce = true;
  }

  seedJob(options: {
    eventId: string;
    kind: string;
    status: string;
    attempts: number;
    nextRunAt: string;
  }): StoredJob {
    const job: StoredJob = {
      id: this.jobs.reduce((max, row) => Math.max(max, row.id), 0) + 1,
      event_id: options.eventId,
      kind: options.kind,
      idem_key: options.eventId,
      status: options.status,
      attempts: options.attempts,
      next_run_at: options.nextRunAt,
      event_occurred_at: options.nextRunAt,
      last_error: null,
      created_at: options.nextRunAt,
    };
    this.inboxEvents.push({
      event_id: options.eventId,
      event_type: "message",
      message_type: "text",
      source_type: "group",
      source_hash: "a".repeat(64),
      occurred_at: options.nextRunAt,
      received_at: options.nextRunAt,
      payload_bytes: 1,
      payload_sha256: "b".repeat(64),
      status: "pending",
      body_ref: null,
    });
    this.jobs.push(job);
    return job;
  }

  prepare(query: string): D1PreparedStatement {
    return new MemoryStatement(this, query) as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    return statements.map((statement) =>
      this.execute(statement as unknown as MemoryStatement),
    );
  }

  execute(statement: MemoryStatement): D1Result {
      if (/INSERT OR IGNORE INTO inbox_event/i.test(statement.query)) {
        const [
          eventId,
          eventType,
          messageType,
          sourceType,
          sourceHash,
          occurredAt,
          receivedAt,
          payloadBytes,
          payloadSha256,
        ] = statement.values;
        const duplicate = this.inboxEvents.some((row) => row.event_id === eventId);
        if (!duplicate) {
          this.inboxEvents.push({
            event_id: String(eventId),
            event_type: String(eventType),
            message_type: messageType === null ? null : String(messageType),
            source_type: String(sourceType),
            source_hash: String(sourceHash),
            occurred_at: String(occurredAt),
            received_at: String(receivedAt),
            payload_bytes: Number(payloadBytes),
            payload_sha256: String(payloadSha256),
            status: "pending",
            body_ref: null,
          });
        }
        return result([], duplicate ? 0 : 1);
      }
      if (/INSERT OR IGNORE INTO job_queue/i.test(statement.query)) {
        const [eventId, nextRunAt, idemKey, eventOccurredAt, createdAt] = statement.values;
        const duplicate = this.jobs.some((row) => row.idem_key === idemKey);
        if (!duplicate) {
          this.jobs.push({
            id: this.jobs.reduce((max, row) => Math.max(max, row.id), 0) + 1,
            event_id: String(eventId),
            kind: "line_event",
            idem_key: String(idemKey),
            status: "pending",
            attempts: 0,
            next_run_at: String(nextRunAt),
            event_occurred_at: String(eventOccurredAt),
            last_error: null,
            created_at: String(createdAt ?? nextRunAt),
          });
        }
        return result([], duplicate ? 0 : 1);
      }
      if (/SELECT id, event_id, kind, attempts/i.test(statement.query)) {
        const [now, limit] = statement.values;
        const rows = this.jobs
          .filter((job) => job.status === "pending" && job.next_run_at <= String(now))
          .sort((left, right) => left.next_run_at.localeCompare(right.next_run_at))
          .slice(0, Number(limit))
          .map(({ id, event_id, kind, attempts }) => ({
            id,
            event_id,
            kind,
            attempts,
          }));
        return result(rows);
      }
      if (/SET status = 'processing'.*status = 'pending'/is.test(statement.query)) {
        const [jobId] = statement.values;
        const job = this.jobs.find(
          (row) => row.id === Number(jobId) && row.status === "pending",
        );
        if (job) job.status = "processing";
        return result([], job ? 1 : 0);
      }
      if (/UPDATE job_queue SET status = 'done'/i.test(statement.query)) {
        if (this.failDoneUpdateOnce) {
          this.failDoneUpdateOnce = false;
          throw new Error("simulated completeJob failure");
        }
        const [jobId] = statement.values;
        const job = this.jobs.find((row) => row.id === Number(jobId));
        if (job) job.status = "done";
        return result([], job ? 1 : 0);
      }
      if (/UPDATE inbox_event SET status = 'done'/i.test(statement.query)) {
        const [eventId] = statement.values;
        const event = this.inboxEvents.find((row) => row.event_id === String(eventId));
        if (event) event.status = "done";
        return result([], event ? 1 : 0);
      }
      if (/SET status = 'pending', attempts = \?/is.test(statement.query)) {
        const [attempts, nextRunAt, lastError, jobId] = statement.values;
        const job = this.jobs.find((row) => row.id === Number(jobId));
        if (job) {
          job.status = "pending";
          job.attempts = Number(attempts);
          job.next_run_at = String(nextRunAt);
          job.last_error = String(lastError);
        }
        return result([], job ? 1 : 0);
      }
      if (/SET status = 'dead', attempts = \?/is.test(statement.query)) {
        const [attempts, lastError, jobId] = statement.values;
        const job = this.jobs.find((row) => row.id === Number(jobId));
        if (job) {
          job.status = "dead";
          job.attempts = Number(attempts);
          job.last_error = String(lastError);
        }
        return result([], job ? 1 : 0);
      }
      if (/INSERT INTO ledger/i.test(statement.query)) {
        const [actionType, outcome, referenceId, occurredAt, createdAt] = statement.values;
        this.ledgerRows.push({
          action_type: String(actionType),
          outcome: String(outcome),
          reference_id: referenceId === null ? null : String(referenceId),
          actor_code: null,
          occurred_at: String(occurredAt),
          created_at: String(createdAt),
        });
        return result([], 1);
      }
      if (/COUNT\(\*\) AS depth/i.test(statement.query)) {
        return result([{ depth: this.jobs.filter((job) => job.status === "pending").length }]);
      }
      if (/MAX\(received_at\)/i.test(statement.query)) {
        const times = this.inboxEvents.map((row) => row.received_at).sort();
        return result([{ last_ingest_at: times.at(-1) ?? null }]);
      }
      throw new Error("Test D1 received an unsupported statement");
  }
}

function result(rows: unknown[], changes = 0): D1Result {
  return {
    success: true,
    results: rows,
    meta: { changes },
  } as unknown as D1Result;
}

const ingestKey = "test-ingest-key";
const sourceSalt = "test-source-salt";
const rawGroupId = `C${"a".repeat(32)}`;
const privateText = "ข้อความลับที่ยาวและห้ามปรากฏในฐาน-7f5b6f5e";

function validPayload(eventId = "evt-001"): Record<string, unknown> {
  return {
    destination: `U${"b".repeat(32)}`,
    events: [
      {
        webhookEventId: eventId,
        type: "message",
        timestamp: 1_787_765_432_000,
        source: { type: "group", groupId: rawGroupId },
        message: { id: "123456789", type: "text", text: privateText },
      },
    ],
  };
}

function makeEnv(database: MemoryD1): Env {
  return {
    AIM_INGEST_KEY: ingestKey,
    AIM_SOURCE_HASH_SALT: sourceSalt,
    DB: database as unknown as D1Database,
  };
}

function ingestRequest(body: string, key = ingestKey): Request {
  return new Request("https://aim.example/ingest/line", {
    method: "POST",
    headers: { "content-type": "application/json", "X-AIM-Key": key },
    body,
  });
}

describe("aim-ingest Worker", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("accepts a valid event and persists metadata only", async () => {
    const database = new MemoryD1();
    const response = await handleRequest(
      ingestRequest(JSON.stringify(validPayload())),
      makeEnv(database),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, dup: false, accepted: 1 });
    expect(database.inboxEvents).toHaveLength(1);
    expect(database.jobs).toHaveLength(1);
    expect(database.inboxEvents[0].source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(database.inboxEvents[0].source_hash).not.toBe(rawGroupId);
    expect(database.inboxEvents[0].body_ref).toBeNull();

    const persisted = JSON.stringify({ inbox: database.inboxEvents, jobs: database.jobs });
    expect(persisted).not.toContain(privateText);
    expect(persisted).not.toContain(rawGroupId);
    expect(persisted).not.toContain(`U${"b".repeat(32)}`);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(privateText);
  });

  it("accepts a webhookEventId starting with a digit (real LINE ULID shape)", async () => {
    const database = new MemoryD1();
    const payload = validPayload("01HZZZTESTULIDSTARTWITHDIGIT0");

    const response = await handleRequest(
      ingestRequest(JSON.stringify(payload)),
      makeEnv(database),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: 1 });
  });

  it("returns 403 and writes nothing when the shared header is wrong", async () => {
    const database = new MemoryD1();
    const wrongResponse = await handleRequest(
      ingestRequest(JSON.stringify(validPayload()), "wrong-key"),
      makeEnv(database),
    );
    const missingResponse = await handleRequest(
      new Request("https://aim.example/ingest/line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validPayload()),
      }),
      makeEnv(database),
    );

    expect(wrongResponse.status).toBe(403);
    expect(missingResponse.status).toBe(403);
    expect(database.inboxEvents).toHaveLength(0);
    expect(database.jobs).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("wrong-key");
  });

  it("creates one inbox row and one job when the same event is sent three times", async () => {
    const database = new MemoryD1();
    const env = makeEnv(database);
    const body = JSON.stringify(validPayload("evt-idempotent"));

    const responses = await Promise.all([
      handleRequest(ingestRequest(body), env),
      handleRequest(ingestRequest(body), env),
      handleRequest(ingestRequest(body), env),
    ]);
    const responseBodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(responseBodies.filter((body) => (body as { dup: boolean }).dup)).toHaveLength(2);
    expect(database.inboxEvents).toHaveLength(1);
    expect(database.jobs).toHaveLength(1);
  });

  it("returns a useful 400 response for malformed JSON without crashing", async () => {
    const database = new MemoryD1();
    const response = await handleRequest(ingestRequest("{not-json"), makeEnv(database));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, next: expect.any(String) });
    expect(database.inboxEvents).toHaveLength(0);
    expect(database.jobs).toHaveLength(0);
  });

  it("rejects requests containing more than 50 events with a useful 400 response", async () => {
    const database = new MemoryD1();
    const payload = validPayload();
    payload.events = Array.from({ length: 51 }, (_, index) => ({
      ...(payload.events as Array<Record<string, unknown>>)[0],
      webhookEventId: `evt-batch-${index}`,
    }));

    const response = await handleRequest(
      ingestRequest(JSON.stringify(payload)),
      makeEnv(database),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      next: "send at most 50 events per request; split into multiple requests",
    });
    expect(database.inboxEvents).toHaveLength(0);
    expect(database.jobs).toHaveLength(0);
  });

  it("reports queue depth and the last ingest time from D1", async () => {
    const database = new MemoryD1();
    const env = makeEnv(database);
    await handleRequest(ingestRequest(JSON.stringify(validPayload())), env);

    const response = await handleRequest(new Request("https://aim.example/healthz"), env);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, queueDepth: 1 });
    expect(body.lastIngestAt).toEqual(expect.any(String));
    expect(body.ts).toEqual(expect.any(String));
  });

  it("rejects unrecognized metadata instead of storing an attacker-controlled label", async () => {
    const database = new MemoryD1();
    const payload = validPayload();
    (payload.events as Array<Record<string, unknown>>)[0].type = privateText;

    const response = await handleRequest(
      ingestRequest(JSON.stringify(payload)),
      makeEnv(database),
    );

    expect(response.status).toBe(400);
    expect(database.inboxEvents).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(privateText);
  });

  it("rejects a raw LINE identifier used in the event ID field", async () => {
    const database = new MemoryD1();
    const payload = validPayload(`U${"c".repeat(32)}`);

    const response = await handleRequest(
      ingestRequest(JSON.stringify(payload)),
      makeEnv(database),
    );

    expect(response.status).toBe(400);
    expect(database.inboxEvents).toHaveLength(0);
    expect(database.jobs).toHaveLength(0);
  });
});

describe("scheduled queue processing", () => {
  const now = "2026-08-27T08:00:00.000Z";

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("processes zero jobs but still writes a cron_tick ledger row", async () => {
    const database = new MemoryD1();

    await expect(
      processQueue(database as unknown as D1Database, now),
    ).resolves.toEqual({ processed: 0, retried: 0, dead: 0 });
    expect(database.ledgerRows).toEqual([
      expect.objectContaining({
        action_type: "cron_tick",
        outcome: "ok",
        reference_id: "0",
      }),
    ]);
  });

  it("completes a pending line_event job and marks inbox_event done", async () => {
    const database = new MemoryD1();
    const job = database.seedJob({
      eventId: "evt-ready",
      kind: "line_event",
      status: "pending",
      attempts: 0,
      nextRunAt: "2026-08-27T07:59:00.000Z",
    });

    const queueResult = await processQueue(database as unknown as D1Database, now);

    expect(queueResult).toEqual({ processed: 1, retried: 0, dead: 0 });
    expect(job.status).toBe("done");
    expect(database.inboxEvents[0].status).toBe("done");
    expect(database.ledgerRows).toContainEqual(
      expect.objectContaining({
        action_type: "line_event_processed",
        outcome: "ok",
        reference_id: "evt-ready",
      }),
    );
  });

  it("resolves a job to retry even when completeJob itself throws, and still records the cron tick", async () => {
    const database = new MemoryD1();
    const job = database.seedJob({
      eventId: "evt-complete-failure",
      kind: "line_event",
      status: "pending",
      attempts: 0,
      nextRunAt: "2026-08-27T07:59:00.000Z",
    });
    database.failNextDoneUpdate();

    const queueResult = await processQueue(database as unknown as D1Database, now);

    expect(queueResult).toEqual({ processed: 0, retried: 1, dead: 0 });
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(Date.parse(job.next_run_at)).toBeGreaterThan(Date.parse(now));
    expect(database.ledgerRows).toContainEqual(
      expect.objectContaining({
        action_type: "line_event_processed",
        outcome: "retry",
        reference_id: "evt-complete-failure",
      }),
    );
    expect(database.ledgerRows).toContainEqual(
      expect.objectContaining({
        action_type: "cron_tick",
        outcome: "ok",
        reference_id: "0",
      }),
    );
  });

  it("claims a job atomically so two concurrent ticks never double-process it", async () => {
    const database = new MemoryD1();
    database.seedJob({
      eventId: "evt-race",
      kind: "line_event",
      status: "pending",
      attempts: 0,
      nextRunAt: "2026-08-27T07:59:00.000Z",
    });

    const results = await Promise.all([
      processQueue(database as unknown as D1Database, now),
      processQueue(database as unknown as D1Database, now),
    ]);

    expect(results.reduce((sum, item) => sum + item.processed, 0)).toBe(1);
    expect(
      database.ledgerRows.filter(
        (row) => row.action_type === "line_event_processed" && row.outcome === "ok",
      ),
    ).toHaveLength(1);
    expect(database.jobs[0].status).toBe("done");
  });

  it("retries an unrecognized job kind with exponential backoff", async () => {
    const database = new MemoryD1();
    const job = database.seedJob({
      eventId: "evt-retry",
      kind: "something_unknown",
      status: "pending",
      attempts: 0,
      nextRunAt: "2026-08-27T07:59:00.000Z",
    });

    const queueResult = await processQueue(database as unknown as D1Database, now);

    expect(queueResult).toEqual({ processed: 0, retried: 1, dead: 0 });
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    const retryDelayMs = Date.parse(job.next_run_at) - Date.parse(now);
    expect(retryDelayMs).toBeGreaterThanOrEqual(29_000);
    expect(retryDelayMs).toBeLessThanOrEqual(31_000);
    expect(job.last_error).toContain("unknown job kind");
    expect(database.ledgerRows).toContainEqual(
      expect.objectContaining({
        action_type: "line_event_processed",
        outcome: "retry",
        reference_id: "evt-retry",
      }),
    );
  });

  it("kills a job after the fifth failed attempt", async () => {
    const database = new MemoryD1();
    const job = database.seedJob({
      eventId: "evt-dead",
      kind: "something_unknown",
      status: "pending",
      attempts: 4,
      nextRunAt: "2026-08-27T07:59:00.000Z",
    });

    const queueResult = await processQueue(database as unknown as D1Database, now);

    expect(queueResult).toEqual({ processed: 0, retried: 0, dead: 1 });
    expect(job.status).toBe("dead");
    expect(job.attempts).toBe(5);
    expect(database.ledgerRows).toContainEqual(
      expect.objectContaining({
        action_type: "line_event_processed",
        outcome: "dead",
        reference_id: "evt-dead",
      }),
    );
  });

  it("does not pick up a job scheduled in the future", async () => {
    const database = new MemoryD1();
    const job = database.seedJob({
      eventId: "evt-future",
      kind: "line_event",
      status: "pending",
      attempts: 0,
      nextRunAt: "2026-08-27T09:00:00.000Z",
    });

    const queueResult = await processQueue(database as unknown as D1Database, now);

    expect(queueResult).toEqual({ processed: 0, retried: 0, dead: 0 });
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
    expect(
      database.ledgerRows.filter(
        (row) => row.action_type === "line_event_processed",
      ),
    ).toHaveLength(0);
  });
});
