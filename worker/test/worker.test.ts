import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index.ts";
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
  body_ref: null;
}

interface StoredJob {
  event_id: string;
  idem_key: string;
  status: string;
  event_occurred_at: string;
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
}

class MemoryD1 {
  inboxEvents: StoredInbox[] = [];
  jobs: StoredJob[] = [];

  prepare(query: string): D1PreparedStatement {
    return new MemoryStatement(this, query) as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const results: D1Result[] = [];
    for (const rawStatement of statements) {
      const statement = rawStatement as unknown as MemoryStatement;
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
            body_ref: null,
          });
        }
        results.push(result([], duplicate ? 0 : 1));
        continue;
      }
      if (/INSERT OR IGNORE INTO job_queue/i.test(statement.query)) {
        const [eventId, nextRunAt, idemKey, eventOccurredAt, createdAt] = statement.values;
        const duplicate = this.jobs.some((row) => row.idem_key === idemKey);
        if (!duplicate) {
          this.jobs.push({
            event_id: String(eventId),
            idem_key: String(idemKey),
            status: "pending",
            event_occurred_at: String(eventOccurredAt),
            created_at: String(createdAt ?? nextRunAt),
          });
        }
        results.push(result([], duplicate ? 0 : 1));
        continue;
      }
      if (/COUNT\(\*\) AS depth/i.test(statement.query)) {
        results.push(result([{ depth: this.jobs.filter((job) => job.status === "pending").length }]));
        continue;
      }
      if (/MAX\(received_at\)/i.test(statement.query)) {
        const times = this.inboxEvents.map((row) => row.received_at).sort();
        results.push(result([{ last_ingest_at: times.at(-1) ?? null }]));
        continue;
      }
      throw new Error("Test D1 received an unsupported statement");
    }
    return results;
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
