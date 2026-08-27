import { constantTimeEqual, sha256Bytes } from "./crypto.ts";
import { enqueueEvents, readHealth } from "./db/repository.ts";
import { writeSafeLog } from "./logger.ts";
import { extractMetadata, InvalidPayloadError } from "./payload.ts";
import type { Env } from "./types.ts";

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function safeReference(): string {
  return crypto.randomUUID();
}

function log(ts: string, eventType: string, result: string, ref: string): void {
  writeSafeLog({ ts, eventType, result, ref });
}

async function handleHealth(env: Env, now: string): Promise<Response> {
  const ref = safeReference();
  try {
    const health = await readHealth(env.DB);
    log(now, "health", "ok", ref);
    return json({ ok: true, ts: now, ...health });
  } catch {
    log(now, "health", "unavailable", ref);
    return json(
      {
        ok: false,
        ts: now,
        queueDepth: null,
        lastIngestAt: null,
        next: "check the D1 binding and apply migrations, then retry",
      },
      503,
    );
  }
}

async function handleIngest(request: Request, env: Env, now: string): Promise<Response> {
  const requestRef = safeReference();
  const suppliedKey = request.headers.get("X-AIM-Key") ?? "";
  if (!env.AIM_INGEST_KEY) {
    log(now, "ingest", "unavailable", requestRef);
    return json(
      { ok: false, next: "configure the Worker ingest secret and retry" },
      503,
    );
  }
  if (!(await constantTimeEqual(suppliedKey, env.AIM_INGEST_KEY))) {
    log(now, "ingest", "forbidden", requestRef);
    return json({ ok: false, next: "check caller authorization and retry" }, 403);
  }
  if (!env.AIM_SOURCE_HASH_SALT) {
    log(now, "ingest", "unavailable", requestRef);
    return json(
      { ok: false, next: "configure the source hashing secret and retry" },
      503,
    );
  }

  let rawBody: ArrayBuffer;
  let payload: unknown;
  try {
    rawBody = await request.arrayBuffer();
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    log(now, "ingest", "invalid_payload", requestRef);
    return json(
      { ok: false, next: "send a valid LINE webhook JSON body and retry" },
      400,
    );
  }

  try {
    const payloadSha256 = await sha256Bytes(rawBody);
    const events = await extractMetadata(
      payload,
      now,
      rawBody.byteLength,
      payloadSha256,
      env.AIM_SOURCE_HASH_SALT,
    );
    const result = await enqueueEvents(env.DB, events);
    const eventType = events.length === 1 ? events[0].eventType : "batch";
    const outcome =
      result.accepted === 0
        ? "duplicate"
        : result.duplicates === 0
          ? "accepted"
          : "accepted_with_duplicates";
    const ref = events.length === 1 ? events[0].eventId : requestRef;
    log(now, eventType, outcome, ref);
    return json({
      ok: true,
      dup: result.accepted === 0,
      accepted: result.accepted,
      duplicates: result.duplicates,
    });
  } catch (error) {
    if (error instanceof InvalidPayloadError) {
      log(now, "ingest", "invalid_payload", requestRef);
      return json(
        { ok: false, next: "send supported LINE event metadata and retry" },
        400,
      );
    }
    log(now, "ingest", "queue_unavailable", requestRef);
    return json(
      { ok: false, next: "check D1 availability and retry the same event ID" },
      503,
    );
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const now = new Date().toISOString();

  if (url.pathname === "/healthz") {
    if (request.method !== "GET") {
      const ref = safeReference();
      log(now, "health", "method_not_allowed", ref);
      return json(
        { ok: false, next: "call GET /healthz" },
        405,
        { allow: "GET" },
      );
    }
    return handleHealth(env, now);
  }

  if (url.pathname === "/ingest/line") {
    if (request.method !== "POST") {
      const ref = safeReference();
      log(now, "ingest", "method_not_allowed", ref);
      return json(
        { ok: false, next: "call POST /ingest/line" },
        405,
        { allow: "POST" },
      );
    }
    return handleIngest(request, env, now);
  }

  const ref = safeReference();
  log(now, "request", "not_found", ref);
  return json(
    { ok: false, next: "use GET /healthz or POST /ingest/line" },
    404,
  );
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
