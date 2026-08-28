import { constantTimeEqual, sha256Bytes } from "./crypto.ts";
import { enqueueEvents, personIsLinked, readHealth } from "./db/repository.ts";
import { writeSafeLog } from "./logger.ts";
import { extractMetadata, InvalidPayloadError } from "./payload.ts";
import { askQuestion } from "./queryEngine.ts";
import { processQueue } from "./queue.ts";
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

function logAsk(ts: string, result: string, intent: string, length: number): void {
  writeSafeLog({ ts, eventType: "ask", result, ref: `${intent}:${length}` });
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
      return json({ ok: false, next: error.message }, 400);
    }
    log(now, "ingest", "queue_unavailable", requestRef);
    return json(
      { ok: false, next: "check D1 availability and retry the same event ID" },
      503,
    );
  }
}

async function handleAsk(request: Request, env: Env, now: string): Promise<Response> {
  if (!env.AIM_ASK_KEY) {
    logAsk(now, "unavailable", "none", 0);
    return json(
      { ok: false, next: "configure the Worker ask secret and retry" },
      503,
    );
  }

  const suppliedKey = request.headers.get("X-AIM-Ask-Key") ?? "";
  let authorized = false;
  try {
    authorized = await constantTimeEqual(suppliedKey, env.AIM_ASK_KEY);
  } catch {
    logAsk(now, "unavailable", "none", 0);
    return json(
      { ok: false, next: "check Worker cryptography support and retry" },
      503,
    );
  }
  if (!authorized) {
    logAsk(now, "forbidden", "none", 0);
    return json({ ok: false, next: "check caller authorization and retry" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    logAsk(now, "invalid_payload", "none", 0);
    return json(
      { ok: false, next: "send a valid JSON body with person_code and question" },
      400,
    );
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    logAsk(now, "invalid_payload", "none", 0);
    return json(
      { ok: false, next: "send a JSON object with person_code and question" },
      400,
    );
  }

  const body = payload as Record<string, unknown>;
  const personCode = body.person_code;
  const question = body.question;
  // ★ F6 (code-reviewer 2026-08-28): นับความยาวเป็น code point ให้ตรงกับ mb_strlen ฝั่ง PHP
  //   เดิมใช้ .length ซึ่งนับเป็น UTF-16 unit ⇒ คำถามที่มีอิโมจิเยอะและฝั่ง PHP ถือว่าผ่าน
  //   จะโดนที่นี่ตอบ 400 แล้วผู้ใช้เห็นเป็นข้อความขอโทษลอย ๆ โดยไม่มีใครรู้สาเหตุ
  if (
    typeof personCode !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(personCode) ||
    typeof question !== "string" ||
    [...question].length > 500
  ) {
    logAsk(now, "invalid_payload", "none", 0);
    return json(
      {
        ok: false,
        next: "send person_code as 1-64 letters, digits, underscores or hyphens and question as at most 500 characters",
      },
      400,
    );
  }

  // ★ F7: รับเฉพาะคนที่ผูกบัญชีจริงแล้ว — คำตอบที่ส่งกลับเหมือน 403 ของคีย์ผิดทุกตัวอักษร
  //   เพื่อไม่ให้กลายเป็นเครื่องมือเดาว่ามีใครอยู่ในระบบบ้าง · แยกความต่างไว้ที่ log ฝั่งเราเท่านั้น
  let linked = false;
  try {
    linked = await personIsLinked(env.DB, personCode);
  } catch {
    logAsk(now, "unavailable", "none", 0);
    return json(
      { ok: false, next: "check D1 availability and retry the same question" },
      503,
    );
  }
  if (!linked) {
    logAsk(now, "unlinked", "none", 0);
    return json({ ok: false, next: "check caller authorization and retry" }, 403);
  }

  try {
    const answer = await askQuestion(
      env.DB,
      personCode,
      question,
      new Date().toISOString(),
    );
    logAsk(now, "ok", answer.intent, answer.text.length);
    return json({ ok: true, ...answer });
  } catch {
    logAsk(now, "unavailable", "none", 0);
    return json(
      { ok: false, next: "check D1 availability and retry the same question" },
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

  if (url.pathname === "/ask") {
    if (request.method !== "POST") {
      logAsk(now, "method_not_allowed", "none", 0);
      return json(
        { ok: false, next: "call POST /ask" },
        405,
        { allow: "POST" },
      );
    }
    return handleAsk(request, env, now);
  }

  const ref = safeReference();
  log(now, "request", "not_found", ref);
  return json(
    { ok: false, next: "use GET /healthz, POST /ingest/line or POST /ask" },
    404,
  );
}

export async function handleScheduled(env: Env, now: string): Promise<void> {
  const result = await processQueue(env.DB, now);
  log(now, "cron", "tick", String(result.processed));
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
  scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    const now = new Date(controller.scheduledTime).toISOString();
    ctx.waitUntil(handleScheduled(env, now));
  },
} satisfies ExportedHandler<Env>;
