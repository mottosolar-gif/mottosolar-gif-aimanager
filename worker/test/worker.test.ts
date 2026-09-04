import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index.ts";
import { processQueue } from "../src/queue.ts";
import type { Env } from "../src/types.ts";
import { SQLiteD1 } from "./helpers/sqliteD1.ts";

interface StoredInbox {
  event_id: string;
  event_type: string;
  message_type: string | null;
  source_type: string;
  source_hash: string | null;
  postback_data: string | null;
  occurred_at: string;
  received_at: string;
  payload_bytes: number;
  payload_sha256: string;
  status: string;
  body_ref: null;
  last_error?: string | null;   // killJob เขียนลงแถวนี้ด้วยตั้งแต่ 2026-08-28
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
  syncState: Array<{ source_key: string; synced_at: string }> = [];
  failDoneUpdateOnce = false;
  failNextWrite = false;
  failPendingJobsRead = false;
  emptyHealthCounts = false;
  failHealthRead = false;

  failNextDoneUpdate(): void {
    this.failDoneUpdateOnce = true;
  }

  failNextMutation(): void {
    this.failNextWrite = true;
  }

  failNextPendingJobsRead(): void {
    this.failPendingJobsRead = true;
  }

  returnEmptyHealthCounts(): void {
    this.emptyHealthCounts = true;
  }

  failNextHealthRead(): void {
    this.failHealthRead = true;
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
      postback_data: null,
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
      if (this.failNextWrite && /INSERT|UPDATE/i.test(statement.query)) {
        this.failNextWrite = false;
        throw new Error("simulated D1 write failure");
      }
      if (/INSERT INTO sync_state/i.test(statement.query)) {
        const [sourceKey, syncedAt] = statement.values;
        const key = String(sourceKey);
        const existing = this.syncState.find((row) => row.source_key === key);
        if (existing) existing.synced_at = String(syncedAt);
        else this.syncState.push({ source_key: key, synced_at: String(syncedAt) });
        return result([], 1);
      }
      if (/FROM sync_state/i.test(statement.query) && /source_key/i.test(statement.query)) {
        return result(
          this.syncState.map((row) => ({ source_key: row.source_key, synced_at: row.synced_at })),
        );
      }
      if (/INSERT OR IGNORE INTO inbox_event/i.test(statement.query)) {
        const [
          eventId,
          eventType,
          messageType,
          sourceType,
          sourceHash,
          postbackData,
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
            source_hash: sourceHash === null ? null : String(sourceHash),
            postback_data: postbackData === null ? null : String(postbackData),
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
        if (this.failPendingJobsRead) {
          this.failPendingJobsRead = false;
          throw new Error("simulated pending-jobs read failure");
        }
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
      if (/SELECT postback_data, source_hash FROM inbox_event/i.test(statement.query)) {
        const event = this.inboxEvents.find(
          (row) => row.event_id === String(statement.values[0]),
        );
        return result(
          event
            ? [{ postback_data: event.postback_data, source_hash: event.source_hash }]
            : [],
        );
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
      // ★ 2026-08-28 — /healthz มองเห็นของที่ตายและของที่ค้างแล้ว (เดิมเห็นแต่คิว pending)
      if (/status = 'dead'/i.test(statement.query) && /COUNT\(\*\) AS n/i.test(statement.query)) {
        if (this.emptyHealthCounts) return result([]);
        return result([{ n: this.jobs.filter((job) => job.status === "dead").length }]);
      }
      if (/inbox_event/i.test(statement.query) && /COUNT\(\*\) AS n/i.test(statement.query)) {
        if (this.emptyHealthCounts) return result([]);
        // เกณฑ์เดียวกับของจริง: ยัง pending และรับเข้ามาเกิน 15 นาทีแล้ว
        const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
        return result([
          {
            n: this.inboxEvents.filter(
              (row) => row.status === "pending" && String(row.received_at) < cutoff,
            ).length,
          },
        ]);
      }
      // ★ killJob ปิดแถว inbox ตามไปด้วย — ถ้าไม่รู้จักประโยคนี้ เทสจะฟ้องว่า D1 ไม่รองรับ
      if (/UPDATE inbox_event SET status = 'dead'/i.test(statement.query)) {
        const [lastError, eventId] = statement.values;
        const row = this.inboxEvents.find((r) => r.event_id === String(eventId));
        if (row) {
          row.status = "dead";
          row.last_error = String(lastError);
        }
        return result([], row ? 1 : 0);
      }
      if (/COUNT\(\*\) AS depth/i.test(statement.query)) {
        if (this.failHealthRead) {
          this.failHealthRead = false;
          throw new Error("simulated health D1 failure");
        }
        if (this.emptyHealthCounts) return result([]);
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

function postbackPayload(eventId: string, data: unknown): Record<string, unknown> {
  return {
    destination: `U${"b".repeat(32)}`,
    events: [
      {
        webhookEventId: eventId,
        type: "postback",
        timestamp: 1_787_765_432_000,
        source: { type: "group", groupId: rawGroupId },
        postback: { data },
      },
    ],
  };
}

function makeEnv(database: MemoryD1): Env {
  return {
    AIM_ASK_KEY: "test-ask-key",
    AIM_LINK_KEY: "test-link-key",
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

  it("stores valid postback data", async () => {
    const database = new MemoryD1();
    const response = await handleRequest(
      ingestRequest(
        JSON.stringify(
          postbackPayload("evt-postback", "act=aim_accept&task=T-001"),
        ),
      ),
      makeEnv(database),
    );

    expect(response.status).toBe(200);
    expect(database.inboxEvents[0].postback_data).toBe(
      "act=aim_accept&task=T-001",
    );
  });

  it("stores malformed postback data as NULL while accepting other events", async () => {
    const database = new MemoryD1();
    const payload = postbackPayload("evt-bad-postback", "act=aim accept!");
    payload.events = [
      ...(payload.events as Array<Record<string, unknown>>),
      (validPayload("evt-after-bad").events as Array<Record<string, unknown>>)[0],
    ];

    const response = await handleRequest(
      ingestRequest(JSON.stringify(payload)),
      makeEnv(database),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: 2 });
    expect(database.inboxEvents).toHaveLength(2);
    expect(database.inboxEvents[0].postback_data).toBeNull();
  });

  it("always stores postback data as NULL for non-postback events", async () => {
    const database = new MemoryD1();
    const payload = validPayload("evt-message-with-postback-field");
    (payload.events as Array<Record<string, unknown>>)[0].postback = {
      data: "act=aim_accept&task=T-001",
    };

    const response = await handleRequest(
      ingestRequest(JSON.stringify(payload)),
      makeEnv(database),
    );

    expect(response.status).toBe(200);
    expect(database.inboxEvents[0].postback_data).toBeNull();
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

  it("reports queue depth, last ingest time, last sync time, dead-letter depth, and D1 reachability", async () => {
    const database = new MemoryD1();
    const env = makeEnv(database);
    await handleRequest(ingestRequest(JSON.stringify(validPayload())), env);

    const healthz = await handleRequest(new Request("https://aim.example/healthz"), env);
    const health = await handleRequest(new Request("https://aim.example/health"), env);
    const healthzBody = (await healthz.json()) as Record<string, unknown>;
    const healthBody = (await health.json()) as Record<string, unknown>;

    expect(healthz.status).toBe(200);
    expect(health.status).toBe(200);
    expect(healthzBody).toMatchObject({
      ok: true,
      d1: "ok",
      queueDepth: 1,
      deadJobs: 0,
      strandedEvents: 0,
      lastSyncAt: null,
    });
    expect(healthzBody.lastIngestAt).toEqual(expect.any(String));
    expect(healthzBody.ts).toEqual(expect.any(String));
    expect(healthBody).toMatchObject({
      ok: true,
      d1: "ok",
      queueDepth: 1,
      lastIngestAt: healthzBody.lastIngestAt,
      lastSyncAt: null,
    });
  });

  it("returns 503 from /healthz when D1 throws or returns empty counts, not 200 with zeros", async () => {
    const thrown = new MemoryD1();
    thrown.failNextHealthRead();
    const thrownResponse = await handleRequest(
      new Request("https://aim.example/healthz"),
      makeEnv(thrown),
    );
    const empty = new MemoryD1();
    empty.returnEmptyHealthCounts();
    const emptyResponse = await handleRequest(
      new Request("https://aim.example/health"),
      makeEnv(empty),
    );
    const missingDb = await handleRequest(new Request("https://aim.example/healthz"), {
      ...makeEnv(new MemoryD1()),
      DB: undefined as unknown as D1Database,
    });

    for (const response of [thrownResponse, emptyResponse, missingDb]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        ok: false,
        d1: "unreachable",
        queueDepth: null,
        lastIngestAt: null,
        lastSyncAt: null,
        deadJobs: null,
        strandedEvents: null,
        next: expect.any(String),
      });
    }
  });

  it("returns 503 from /ingest/line when D1 cannot persist, not 200 with accepted:0", async () => {
    const database = new MemoryD1();
    database.failNextMutation();
    const response = await handleRequest(
      ingestRequest(JSON.stringify(validPayload("evt-d1-down"))),
      makeEnv(database),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, next: expect.any(String) });
    expect(database.inboxEvents).toHaveLength(0);
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

describe("POST /ask", () => {
  const askKey = "test-ask-key";

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  function askEnv(database: SQLiteD1, key = askKey): Env {
    return {
      AIM_ASK_KEY: key,
      AIM_LINK_KEY: "test-link-key",
      AIM_INGEST_KEY: ingestKey,
      AIM_SOURCE_HASH_SALT: sourceSalt,
      DB: database.asD1(),
    };
  }

  function askRequest(body: string, key: string | null = askKey): Request {
    const headers = new Headers({ "content-type": "application/json" });
    if (key !== null) headers.set("X-AIM-Ask-Key", key);
    return new Request("https://aim.example/ask", {
      method: "POST",
      headers,
      body,
    });
  }

  function askDatabase(): SQLiteD1 {
    const database = new SQLiteD1();
    database.exec(
      "INSERT INTO person (person_code, department, role) VALUES ('P-ASSIST', 'operations', 'worker')",
    );
    // ★ F7: /ask รับเฉพาะคนที่ผูกบัญชีแล้ว ⇒ ฐานทดสอบต้องมี person_link เหมือนของจริง
    database.exec(
      "INSERT INTO person_link (person_code, source_type, source_hash, linked_at) VALUES ('P-ASSIST', 'user', '" +
        "a".repeat(64) +
        "', '2026-08-28T00:00:00.000Z')",
    );
    return database;
  }

  it("returns a query-engine answer when the ask key is correct", async () => {
    const database = askDatabase();
    try {
      const response = await handleRequest(
        askRequest(
          JSON.stringify({
            person_code: "P-ASSIST",
            question: "งานของฉันมีอะไรบ้าง",
          }),
        ),
        askEnv(database),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        intent: "my_tasks",
        matched: true,
        denied: false,
      });
    } finally {
      database.close();
    }
  });

  it("refuses a person who has no person_link, indistinguishably from a bad key", async () => {
    const database = askDatabase();
    try {
      // มีแถวใน person แต่ยังไม่เคยผูกบัญชี — เป็นคนที่ระบบรู้จักแต่ยังยืนยันตัวตนไม่ได้
      database.exec(
        "INSERT INTO person (person_code, department, role) VALUES ('P-NOLINK', 'operations', 'worker')",
      );
      const unlinked = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-NOLINK", question: "งานของฉันมีอะไรบ้าง" })),
        askEnv(database),
      );
      const ghost = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-GHOST", question: "งานของฉันมีอะไรบ้าง" })),
        askEnv(database),
      );
      const badKey = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-ASSIST", question: "งานของฉันมีอะไรบ้าง" }), "wrong"),
        askEnv(database),
      );

      expect(unlinked.status).toBe(403);
      // คนที่มีตัวตนแต่ยังไม่ผูก · คนที่ไม่มีตัวตนเลย · คีย์ผิด — ต้องแยกจากกันไม่ได้เลย
      // ไม่งั้น endpoint กลายเป็นเครื่องมือเดาว่ามีใครอยู่ในระบบบ้าง
      const [a, b, c] = await Promise.all([unlinked.json(), ghost.json(), badKey.json()]);
      expect(a).toEqual(b);
      expect(a).toEqual(c);
      expect(ghost.status).toBe(403);
    } finally {
      database.close();
    }
  });

  it("accepts a question whose length is legal in code points but not UTF-16 units", async () => {
    const database = askDatabase();
    try {
      // 300 อิโมจิ = 300 code point (PHP ผ่าน) แต่ 600 UTF-16 unit (โค้ดเดิมตอบ 400)
      const emojiQuestion = "งานของฉันมีอะไรบ้าง " + "🦐".repeat(300);
      expect([...emojiQuestion].length).toBeLessThanOrEqual(500);
      expect(emojiQuestion.length).toBeGreaterThan(500);

      const response = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-ASSIST", question: emojiQuestion })),
        askEnv(database),
      );

      expect(response.status).toBe(200);
    } finally {
      database.close();
    }
  });

  it("returns the same 403 shape for a wrong or missing ask key", async () => {
    const database = askDatabase();
    try {
      const wrong = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-ASSIST", question: "งานของฉัน" }), "wrong"),
        askEnv(database),
      );
      const missing = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-ASSIST", question: "งานของฉัน" }), null),
        askEnv(database),
      );

      expect(wrong.status).toBe(403);
      expect(missing.status).toBe(403);
      expect(await wrong.json()).toEqual(await missing.json());
    } finally {
      database.close();
    }
  });

  it("returns 503 with a next step when the ask secret is not configured", async () => {
    const database = askDatabase();
    try {
      const response = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-ASSIST", question: "งานของฉัน" })),
        askEnv(database, ""),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, next: expect.any(String) });
    } finally {
      database.close();
    }
  });

  it("returns 400 with a next step for malformed JSON", async () => {
    const database = askDatabase();
    try {
      const response = await handleRequest(askRequest("{broken"), askEnv(database));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, next: expect.any(String) });
    } finally {
      database.close();
    }
  });

  it.each([
    { person_code: "P ASSIST", question: "งานของฉัน" },
    { person_code: ["P-ASSIST"], question: "งานของฉัน" },
  ])("returns 400 for an invalid person_code: %j", async (body) => {
    const database = askDatabase();
    try {
      const response = await handleRequest(
        askRequest(JSON.stringify(body)),
        askEnv(database),
      );
      expect(response.status).toBe(400);
    } finally {
      database.close();
    }
  });

  it("returns 400 when the question is longer than 500 characters", async () => {
    const database = askDatabase();
    try {
      const response = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-ASSIST", question: "ก".repeat(501) })),
        askEnv(database),
      );
      expect(response.status).toBe(400);
    } finally {
      database.close();
    }
  });

  it("returns unmatched rather than an error for an unknown question pattern", async () => {
    const database = askDatabase();
    try {
      const response = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-ASSIST", question: "คำถามที่ไม่มีแพตเทิร์น 987654" })),
        askEnv(database),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        intent: "unmatched",
        matched: false,
        denied: false,
      });
    } finally {
      database.close();
    }
  });

  it("returns denied for a worker asking a team question", async () => {
    const database = askDatabase();
    try {
      const response = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-ASSIST", question: "ใครยังไม่รับงาน" })),
        askEnv(database),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        intent: "team_unaccepted",
        matched: true,
        denied: true,
      });
    } finally {
      database.close();
    }
  });

  it("never logs question or answer text", async () => {
    const database = askDatabase();
    const privateQuestion = "ข้อความลับห้ามอยู่ในล็อก-ask-12345";
    try {
      const response = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-ASSIST", question: privateQuestion })),
        askEnv(database),
      );
      const body = await response.text();
      const logs = JSON.stringify(vi.mocked(console.log).mock.calls);

      expect(response.status).toBe(200);
      expect(body).not.toBe("");
      expect(logs).not.toContain(privateQuestion);
      expect(logs).not.toContain("น้องกุ้งยังไม่เข้าใจคำถามนี้");
    } finally {
      database.close();
    }
  });

  it("returns 405 with Allow: POST for other methods", async () => {
    const database = askDatabase();
    try {
      const response = await handleRequest(
        new Request("https://aim.example/ask", { method: "GET" }),
        askEnv(database),
      );

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(await response.json()).toMatchObject({ ok: false, next: "call POST /ask" });
    } finally {
      database.close();
    }
  });

  it("returns 503 from /ask when D1 cannot answer, not 200 with an empty-looking success", async () => {
    const database = askDatabase();
    try {
      const broken = {
        prepare(sql: string): D1PreparedStatement {
          if (/FROM person_link/i.test(sql) && /person_code = \?/i.test(sql)) {
            return database.asD1().prepare(sql);
          }
          throw new Error("simulated ask D1 failure");
        },
      } as unknown as D1Database;
      const missingDb = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-ASSIST", question: "งานของฉันมีอะไรบ้าง" })),
        { ...askEnv(database), DB: undefined as unknown as D1Database },
      );
      const down = await handleRequest(
        askRequest(JSON.stringify({ person_code: "P-ASSIST", question: "งานของฉันมีอะไรบ้าง" })),
        { ...askEnv(database), DB: broken },
      );

      expect(missingDb.status).toBe(503);
      expect(down.status).toBe(503);
      expect(await missingDb.json()).toMatchObject({ ok: false, next: expect.any(String) });
      expect(await down.json()).toMatchObject({ ok: false, next: expect.any(String) });
    } finally {
      database.close();
    }
  });
});

describe("scheduled queue processing", () => {
  const now = "2026-08-27T08:00:00.000Z";

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("does not record a successful cron_tick when reading the queue from D1 fails", async () => {
    const database = new MemoryD1();
    database.failNextPendingJobsRead();

    await expect(processQueue(database as unknown as D1Database, now)).rejects.toThrow(
      /pending-jobs read failure/,
    );
    expect(database.ledgerRows).toEqual([]);
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

// ★ WP-P2-C1 · POST /link — ผูก LINE id เข้ากับ person_code
//   จนถึง 2026-08-28 ไม่มีโค้ด production ตัวไหนเขียน person_link เลย (2 แถวที่มีมาจากการพิมพ์
//   wrangler ด้วยมือ) ⇒ หลัง /ask บังคับ link พนักงานคนที่ 3 จะติด 403 ตลอดกาล
describe("POST /link", () => {
  const linkKey = "test-link-key";
  const lineUserId = "U" + "c".repeat(32);

  function linkEnv(database: SQLiteD1, key = linkKey): Env {
    return {
      AIM_ASK_KEY: "test-ask-key",
      AIM_LINK_KEY: key,
      AIM_INGEST_KEY: ingestKey,
      AIM_SOURCE_HASH_SALT: sourceSalt,
      DB: database.asD1(),
    };
  }

  function linkRequest(body: unknown, key: string | null = linkKey): Request {
    const headers = new Headers({ "content-type": "application/json" });
    if (key !== null) headers.set("X-AIM-Link-Key", key);
    return new Request("https://aim.example/link", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  const validBody = {
    person_code: "P-NEW",
    line_user_id: lineUserId,
    department: "operations",
    role: "worker",
  };

  it("links a new person and is safe to call twice", async () => {
    const database = new SQLiteD1();
    try {
      const first = await handleRequest(linkRequest(validBody), linkEnv(database));
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ ok: true, created: true });

      const second = await handleRequest(linkRequest(validBody), linkEnv(database));
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ ok: true, created: false });

      const links = await database
        .asD1()
        .prepare("SELECT person_code, source_hash FROM person_link")
        .all<{ person_code: string; source_hash: string }>();
      expect(links.results).toHaveLength(1);
      expect(links.results[0].person_code).toBe("P-NEW");
      // ห้ามเก็บ LINE id ดิบลงฐานเด็ดขาด (D-P0-01)
      expect(links.results[0].source_hash).not.toContain(lineUserId);
      expect(links.results[0].source_hash).toHaveLength(64);
    } finally {
      database.close();
    }
  });

  it("refuses to rebind a LINE account that already belongs to someone else", async () => {
    const database = new SQLiteD1();
    try {
      await handleRequest(linkRequest(validBody), linkEnv(database));
      const stolen = await handleRequest(
        linkRequest({ ...validBody, person_code: "P-OTHER" }),
        linkEnv(database),
      );

      expect(stolen.status).toBe(409);
      // ห้ามบอกว่าเจ้าของเดิมคือใคร — จะกลายเป็นเครื่องมือเดาตัวตน
      expect(JSON.stringify(await stolen.json())).not.toContain("P-NEW");

      const links = await database
        .asD1()
        .prepare("SELECT person_code FROM person_link")
        .all<{ person_code: string }>();
      expect(links.results).toHaveLength(1);
      expect(links.results[0].person_code).toBe("P-NEW");
    } finally {
      database.close();
    }
  });

  it("rejects a wrong key, a bad role, and a malformed LINE id", async () => {
    const database = new SQLiteD1();
    try {
      const badKey = await handleRequest(linkRequest(validBody, "wrong"), linkEnv(database));
      const noKey = await handleRequest(linkRequest(validBody, null), linkEnv(database));
      const badRole = await handleRequest(
        linkRequest({ ...validBody, role: "superuser" }),
        linkEnv(database),
      );
      const badUser = await handleRequest(
        linkRequest({ ...validBody, line_user_id: "not-a-line-id" }),
        linkEnv(database),
      );

      expect(badKey.status).toBe(403);
      expect(noKey.status).toBe(403);
      expect(await badKey.json()).toEqual(await noKey.json());
      expect(badRole.status).toBe(400);
      expect(badUser.status).toBe(400);
      // ข้อความ error ห้ามสะท้อน LINE id กลับไป
      expect(JSON.stringify(await badUser.json())).not.toContain("not-a-line-id");

      const links = await database.asD1().prepare("SELECT * FROM person_link").all();
      expect(links.results).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  // ★ เทสที่สำคัญที่สุดของใบนี้: ถ้าสูตรแฮชของ /link เพี้ยนจากของ payload.ts แม้แต่นิดเดียว
  //   ระบบจะ "ผูกสำเร็จ" แต่ไม่มีวันใช้งานได้ และไม่มีอะไรฟ้องเลย
  it("produces the same source_hash that an ingested event from that user produces", async () => {
    const database = new SQLiteD1();
    try {
      await handleRequest(linkRequest(validBody), linkEnv(database));

      const event = {
        events: [
          {
            webhookEventId: "01JLINKPARITYCHECK000001",
            type: "message",
            timestamp: 1787900000000,
            source: { type: "user", userId: lineUserId },
            message: { type: "text", text: "ข้อความทดสอบ" },
          },
        ],
      };
      const ingest = await handleRequest(
        new Request("https://aim.example/ingest/line", {
          method: "POST",
          headers: { "content-type": "application/json", "X-AIM-Key": ingestKey },
          body: JSON.stringify(event),
        }),
        linkEnv(database),
      );
      expect(ingest.status).toBe(200);

      const rows = await database
        .asD1()
        .prepare(
          `SELECT (SELECT source_hash FROM person_link WHERE person_code = 'P-NEW') AS linked,
                  (SELECT source_hash FROM inbox_event LIMIT 1) AS ingested`,
        )
        .all<{ linked: string; ingested: string }>();

      expect(rows.results[0].ingested).toBe(rows.results[0].linked);
    } finally {
      database.close();
    }
  });
});

describe("POST /sync/tasks", () => {
  const syncKey = "test-sync-key";

  function syncEnv(database: SQLiteD1, key: string | null = syncKey): Env {
    return {
      AIM_ASK_KEY: "test-ask-key",
      AIM_LINK_KEY: "test-link-key",
      AIM_INGEST_KEY: ingestKey,
      AIM_SOURCE_HASH_SALT: sourceSalt,
      // null = ไม่ตั้งกุญแจเลย · ส่ง undefined ตรง ๆ ไม่ได้ เพราะพารามิเตอร์มีค่าเริ่มต้น
      // แล้ว JS จะคืนค่าเริ่มต้นให้แทน ⇒ เทส "ปิดอยู่" จะกลายเป็นเทสที่ไม่ได้ทดสอบอะไร
      ...(key === null ? {} : { AIM_SYNC_KEY: key }),
      DB: database.asD1(),
    };
  }

  function syncRequest(body: unknown, key: string | null = syncKey): Request {
    const headers = new Headers({ "content-type": "application/json" });
    if (key !== null) headers.set("X-AIM-Sync-Key", key);
    return new Request("https://aim.example/sync/tasks", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  const liveTask = {
    task_ref: "L-42",
    title: "เช็คสต็อกคลัง",
    status: "in_progress",
    assignee_person_code: null,
    creator_person_code: null,
    due_at: "2026-09-01T00:00:00.000Z",
  };

  async function readTasks(database: SQLiteD1) {
    const rows = await database
      .asD1()
      .prepare("SELECT task_ref, title, status FROM task ORDER BY task_ref")
      .all<{ task_ref: string; title: string; status: string }>();
    return rows.results;
  }

  it("รับงานจากฝั่ง LIVE แล้วทับของเดิมได้ (ส่งซ้ำต้องไม่เกิดแถวซ้ำ)", async () => {
    const database = new SQLiteD1();
    try {
      const first = await handleRequest(syncRequest({ tasks: [liveTask] }), syncEnv(database));
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ ok: true, written: 1, rejected: 0 });

      const changed = { ...liveTask, title: "เช็คสต็อกคลัง (แก้ชื่อ)", status: "completed" };
      await handleRequest(syncRequest({ tasks: [changed] }), syncEnv(database));

      // ฝั่ง LIVE เป็นเจ้าของความจริง ⇒ ส่งมาใหม่ต้องทับของเดิม ไม่ใช่เพิ่มแถว
      expect(await readTasks(database)).toEqual([
        { task_ref: "L-42", title: "เช็คสต็อกคลัง (แก้ชื่อ)", status: "completed" },
      ]);
    } finally {
      database.close();
    }
  });

  it("ไม่แตะแถวที่ไม่ได้ขึ้นต้นด้วย L- (ใบที่ใส่มือไว้ต้องรอด)", async () => {
    const database = new SQLiteD1();
    try {
      await database
        .asD1()
        .prepare("INSERT INTO task (task_ref, title, status) VALUES ('T-DEMO-001','ใบตัวอย่าง','assigned')")
        .run();
      const res = await handleRequest(
        syncRequest({ tasks: [{ ...liveTask, task_ref: "T-DEMO-001", title: "โดนทับ" }] }),
        syncEnv(database),
      );
      expect(await res.json()).toMatchObject({ ok: true, written: 0, rejected: 1 });
      expect(await readTasks(database)).toEqual([
        { task_ref: "T-DEMO-001", title: "ใบตัวอย่าง", status: "assigned" },
      ]);
    } finally {
      database.close();
    }
  });

  it("ปฏิเสธสถานะที่ไม่รู้จักรายแถว แล้วบอกจำนวน ไม่กลืนเงียบ", async () => {
    const database = new SQLiteD1();
    try {
      const res = await handleRequest(
        syncRequest({ tasks: [liveTask, { ...liveTask, task_ref: "L-43", status: "ไม่รู้จัก" }] }),
        syncEnv(database),
      );
      expect(await res.json()).toMatchObject({ ok: true, written: 1, rejected: 1 });
      expect((await readTasks(database)).map((r) => r.task_ref)).toEqual(["L-42"]);
    } finally {
      database.close();
    }
  });

  it("records lastSyncAt on /health after a successful /sync/tasks call", async () => {
    const database = new SQLiteD1();
    try {
      const synced = await handleRequest(syncRequest({ tasks: [liveTask] }), syncEnv(database));
      expect(synced.status).toBe(200);

      const health = await handleRequest(
        new Request("https://aim.example/health"),
        syncEnv(database),
      );
      const body = (await health.json()) as Record<string, unknown>;
      expect(health.status).toBe(200);
      expect(body).toMatchObject({ ok: true, d1: "ok", lastSyncAt: expect.any(String) });
    } finally {
      database.close();
    }
  });

  it("returns 503 from /sync/tasks when D1 cannot write, not 200 with written:0", async () => {
    const database = new SQLiteD1();
    try {
      const base = database.asD1();
      const broken = {
        prepare(sql: string): D1PreparedStatement {
          if (/INSERT INTO task/i.test(sql) || /INTO sync_state/i.test(sql)) {
            throw new Error("simulated sync D1 failure");
          }
          return base.prepare(sql);
        },
        batch: base.batch.bind(base),
      } as unknown as D1Database;
      const down = await handleRequest(syncRequest({ tasks: [liveTask] }), {
        ...syncEnv(database),
        DB: broken,
      });
      const missingDb = await handleRequest(syncRequest({ tasks: [liveTask] }), {
        ...syncEnv(database),
        DB: undefined as unknown as D1Database,
      });

      expect(down.status).toBe(503);
      expect(missingDb.status).toBe(503);
      expect(await down.json()).toMatchObject({ ok: false, next: expect.any(String) });
      expect(await readTasks(database)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("ปิดอยู่ถ้าไม่ตั้งกุญแจ · กุญแจผิดตอบ 403 · ชุดใหญ่เกินถูกปฏิเสธทั้งชุด", async () => {
    const database = new SQLiteD1();
    try {
      const off = await handleRequest(syncRequest({ tasks: [] }), syncEnv(database, null));
      expect(off.status).toBe(503);

      const wrong = await handleRequest(syncRequest({ tasks: [] }, "wrong"), syncEnv(database));
      expect(wrong.status).toBe(403);

      const huge = Array.from({ length: 501 }, (_, i) => ({ ...liveTask, task_ref: `L-${i}` }));
      const tooBig = await handleRequest(syncRequest({ tasks: huge }), syncEnv(database));
      expect(tooBig.status).toBe(413);
      // ปฏิเสธทั้งชุด ไม่ใช่รับครึ่งเดียว — ฝั่งส่งต้องรู้ว่ายังไม่ครบ
      expect(await readTasks(database)).toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe("sync กับ person_code ที่ไม่มีจริง", () => {
  it("ไม่ยอมให้งานถูกผูกกับคนที่ไม่มีในระบบ", async () => {
    const database = new SQLiteD1();
    try {
      const res = await handleRequest(
        new Request("https://aim.example/sync/tasks", {
          method: "POST",
          headers: new Headers({ "content-type": "application/json", "X-AIM-Sync-Key": "k" }),
          body: JSON.stringify({
            tasks: [{ task_ref: "L-777", title: "งานผูกคนผี", status: "assigned",
                      assignee_person_code: "P-GHOST" }],
          }),
        }),
        {
          AIM_ASK_KEY: "a", AIM_LINK_KEY: "b", AIM_INGEST_KEY: ingestKey,
          AIM_SOURCE_HASH_SALT: sourceSalt, AIM_SYNC_KEY: "k", DB: database.asD1(),
        },
      );
      const body = (await res.json()) as Record<string, unknown>;
      const rows = await database.asD1()
        .prepare("SELECT task_ref, assignee_person_code FROM task").all<{ task_ref: string; assignee_person_code: string | null }>();
      // ถ้าเก็บได้ = งานลอยอยู่โดยไม่มีเจ้าของจริง ⇒ canView() ตัดสินจากค่าที่ไม่มีความหมาย
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, written: 0, rejected: 1 });
      expect(rows.results.length).toBe(0);
    } finally {
      database.close();
    }
  });
});
