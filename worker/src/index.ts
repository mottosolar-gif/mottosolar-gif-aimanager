import type { MirroredTask } from "./db/repository.ts";
import { constantTimeEqual, hashSourceId, sha256Bytes } from "./crypto.ts";
import {
  enqueueEvents,
  HEALTH_INGEST_SOURCE,
  HEALTH_SYNC_SOURCE,
  linkPerson,
  personIsLinked,
  readHealth,
  recordEndpointSuccess,
  upsertMirroredTasks,
  recordSummaryPassIssue,
} from "./db/repository.ts";
import { writeSafeLog } from "./logger.ts";
import { extractMetadata, InvalidPayloadError } from "./payload.ts";
import { askQuestion } from "./queryEngine.ts";
import { processQueue } from "./queue.ts";
import { previewSummaryRound, processScheduledSummaries, runSummaryRoundNow } from "./summary.ts";
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
  const unavailable = {
    ok: false,
    ts: now,
    d1: "unreachable",
    queueDepth: null,
    lastIngestAt: null,
    lastSyncAt: null,
    // รูปร่างต้องเหมือนตอนปกติเสมอ — ผู้อ่าน (selfcheck) จะได้แยก "อ่านค่าไม่ได้" (null)
    // ออกจาก "ไม่มีของค้าง" (0) ได้ · ถ้าไม่ใส่ field มาเลย ผู้อ่านจะตีความเป็น 0 แล้วเงียบ
    deadJobs: null,
    strandedEvents: null,
    next: "check the D1 binding and apply migrations, then retry",
  };
  if (!env.DB) {
    log(now, "health", "unavailable", ref);
    return json(unavailable, 503);
  }
  try {
    const health = await readHealth(env.DB);
    log(now, "health", "ok", ref);
    return json({ ok: true, ts: now, ...health });
  } catch {
    log(now, "health", "unavailable", ref);
    return json(unavailable, 503);
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
  if (!env.DB) {
    log(now, "ingest", "unavailable", requestRef);
    return json(
      { ok: false, next: "check D1 availability and retry the same event ID" },
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
    await recordEndpointSuccess(env.DB, HEALTH_INGEST_SOURCE, now);
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

/**
 * POST /admin/summary — สั่งยิงสรุปหนึ่งรอบเดี๋ยวนี้ (WP-P2-B3 · พี่เต้สั่ง 2026-08-28)
 *
 * มีไว้เพราะรอบตามเวลาเป็นของนาฬิกา ถ้าวันไหนระบบสะดุดก็ไม่มีทางกู้รอบนั้นเลย
 * และก่อนเปิดใช้จริงก็ไม่มีทางดูของจริงได้จนกว่าจะถึงเวลา
 *
 * กุญแจแยกดวงของตัวเอง (AIM_ADMIN_KEY) ตามขนบ estate — ไม่ยืมของ ask/ingest/notify
 * ยืมกุญแจ = ใครที่ควรได้แค่ถาม กลายเป็นสั่งยิงหาทุกคนได้ทันที
 * ไม่ตั้งกุญแจ = 503 (ปิดอยู่) · กุญแจผิด = 403 เหมือนกันทุกตัวอักษร ไม่บอกว่าผิดตรงไหน
 */
const MIRROR_STATUSES = new Set([
  "draft", "assigned", "accepted", "rejected", "en_route",
  "arrived", "in_progress", "blocked", "completed", "cancelled",
]);
const MAX_SYNC_TASKS = 500;

/**
 * POST /sync/tasks — ฝั่ง LIVE ส่งงานขึ้นมาให้คลาวด์เก็บเป็นสำเนา (พี่เต้ตัดสิน 2026-08-28 · ทางเลือก ก)
 *
 * **ทางเดียวเท่านั้น** — ความจริงเรื่องงานอยู่ที่ db_customs.tbl_task ฝั่ง LIVE
 * ที่นี่เป็นสำเนาอ่านอย่างเดียว มีไว้ให้ queryEngine ตอบคำถามได้ · ห้ามมี endpoint เขียนกลับ
 *
 * กุญแจแยกดวง (AIM_SYNC_KEY) — ยืมของ ask/notify ไม่ได้ เพราะสิทธิ์คนละระดับ:
 * ใครถือกุญแจนี้ เขียนทับตารางงานทั้งตารางได้
 */
async function handleSyncTasks(request: Request, env: Env, now: string): Promise<Response> {
  const ref = safeReference();
  if (!env.AIM_SYNC_KEY) {
    log(now, "sync_tasks", "unavailable", ref);
    return json({ ok: false, next: "configure the Worker sync secret and retry" }, 503);
  }
  if (!env.DB) {
    log(now, "sync_tasks", "unavailable", ref);
    return json({ ok: false, next: "check the D1 binding and retry" }, 503);
  }

  const suppliedKey = request.headers.get("X-AIM-Sync-Key") ?? "";
  let authorized = false;
  try {
    authorized = await constantTimeEqual(suppliedKey, env.AIM_SYNC_KEY);
  } catch {
    log(now, "sync_tasks", "unavailable", ref);
    return json({ ok: false, next: "check Worker cryptography support and retry" }, 503);
  }
  if (!authorized) {
    log(now, "sync_tasks", "forbidden", ref);
    return json({ ok: false, next: "check caller authorization and retry" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    log(now, "sync_tasks", "bad_request", ref);
    return json({ ok: false, next: "send a JSON body with a tasks array" }, 400);
  }
  const rows = (payload as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(rows)) {
    log(now, "sync_tasks", "bad_request", ref);
    return json({ ok: false, next: "send a JSON body with a tasks array" }, 400);
  }
  if (rows.length > MAX_SYNC_TASKS) {
    // ปฏิเสธทั้งชุดดีกว่ารับครึ่งเดียวเงียบ ๆ — ฝั่งส่งจะได้รู้ว่าต้องแบ่งชุด ไม่ใช่คิดว่าครบแล้ว
    log(now, "sync_tasks", "too_large", ref);
    return json({ ok: false, next: `send at most ${MAX_SYNC_TASKS} tasks per request` }, 413);
  }

  const tasks: MirroredTask[] = [];
  let rejected = 0;
  for (const raw of rows) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const taskRef = typeof row.task_ref === "string" ? row.task_ref : "";
    const title = typeof row.title === "string" ? row.title : "";
    const status = typeof row.status === "string" ? row.status : "";
    // ปฏิเสธรายแถวที่รูปแบบไม่ถูก แล้วรายงานจำนวนกลับไป — ไม่เงียบ ไม่เดาค่าให้
    if (!taskRef.startsWith("L-") || taskRef.length > 64 || title === "" || !MIRROR_STATUSES.has(status)) {
      rejected += 1;
      continue;
    }
    const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
    tasks.push({
      taskRef,
      title: title.slice(0, 500),
      status,
      assigneePersonCode: text(row.assignee_person_code),
      creatorPersonCode: text(row.creator_person_code),
      dueAt: text(row.due_at),
      completedAt: text(row.completed_at),
      cancelledAt: text(row.cancelled_at),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    });
  }

  try {
    const result = await upsertMirroredTasks(env.DB, tasks, now);
    await recordEndpointSuccess(env.DB, HEALTH_SYNC_SOURCE, now);
    log(now, "sync_tasks", "ok", ref);
    return json({
      ok: true,
      written: result.written,
      skipped: result.skipped,
      rejected: rejected + result.rejected,
    });
  } catch {
    log(now, "sync_tasks", "error", ref);
    return json({ ok: false, next: "check the D1 binding and retry" }, 503);
  }
}

async function handleAdminSummary(request: Request, env: Env, now: string): Promise<Response> {
  const ref = safeReference();
  if (!env.AIM_ADMIN_KEY) {
    log(now, "admin_summary", "unavailable", ref);
    return json({ ok: false, next: "configure the Worker admin secret and retry" }, 503);
  }
  if (!env.DB) {
    log(now, "admin_summary", "unavailable", ref);
    return json({ ok: false, next: "check the D1 binding and retry" }, 503);
  }

  const suppliedKey = request.headers.get("X-AIM-Admin-Key") ?? "";
  let authorized = false;
  try {
    authorized = await constantTimeEqual(suppliedKey, env.AIM_ADMIN_KEY);
  } catch {
    log(now, "admin_summary", "unavailable", ref);
    return json({ ok: false, next: "check Worker cryptography support and retry" }, 503);
  }
  if (!authorized) {
    log(now, "admin_summary", "forbidden", ref);
    return json({ ok: false, next: "check caller authorization and retry" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    log(now, "admin_summary", "bad_request", ref);
    return json({ ok: false, next: "send a JSON body with round: morning|evening" }, 400);
  }
  const body = (payload ?? {}) as Record<string, unknown>;
  const round = body.round;
  if (round !== "morning" && round !== "evening") {
    log(now, "admin_summary", "bad_request", ref);
    return json({ ok: false, next: "send round: morning|evening" }, 400);
  }

  // preview = ดูของจริงก่อนปล่อย · ไม่ส่งหาใคร ไม่แตะ ledger ⇒ เรียกกี่ครั้งก็ได้
  if (body.preview === true) {
    try {
      const previews = await previewSummaryRound(env, round, now);
      log(now, "admin_summary", "preview", ref);
      return json({ ok: true, round, preview: true, items: previews });
    } catch {
      log(now, "admin_summary", "error", ref);
      return json({ ok: false, next: "check the D1 binding and retry" }, 503);
    }
  }

  try {
    const result = await runSummaryRoundNow(env, round, now);
    log(now, "admin_summary", result.sent > 0 ? "sent" : "nothing_sent", ref);
    // บอกผลตามจริงทุกช่อง — คนกดปุ่มต้องรู้ว่า "ไม่ส่ง" เพราะอะไร ไม่ใช่เห็นแค่ ok:true แล้วเดาเอง
    return json({ ok: true, round, ...result });
  } catch {
    log(now, "admin_summary", "error", ref);
    return json({ ok: false, next: "check the D1 binding and the notify secrets, then retry" }, 503);
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
  if (!env.DB) {
    logAsk(now, "unavailable", "none", 0);
    return json(
      { ok: false, next: "check D1 availability and retry the same question" },
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

const ALLOWED_ROLES = new Set(["worker", "manager", "owner"]);

/**
 * ★ WP-P2-C1 · POST /link — ผูก LINE id เข้ากับ person_code
 *
 * ทำไมต้องมี: คลาวด์เก็บแต่ `source_hash = sha256(salt + userId)` และ salt เป็น secret ของ Worker
 * ส่วนฝั่งที่รู้ว่า LINE id ไหนคือใครคือ `config/aim_person_map.php` บน vendor-ksk เท่านั้น
 * ⇒ ไม่มีฝั่งไหนผูกเองได้ ต้องให้ vendor-ksk เป็นคนบอก
 *
 * ★ คีย์ดวงที่ 3 แยกจาก ingest และ ask โดยเจตนา — ใครถือคีย์นี้ผูก LINE id ใดก็ได้เข้ากับ person
 * ใดก็ได้ = สวมสิทธิ์เป็นใครก็ได้ ซึ่งอันตรายกว่าคีย์ถาม-ตอบคนละระดับ
 */
async function handleLink(request: Request, env: Env, now: string): Promise<Response> {
  const ref = safeReference();
  if (!env.AIM_LINK_KEY || !env.AIM_SOURCE_HASH_SALT) {
    log(now, "link", "unavailable", ref);
    return json({ ok: false, next: "configure the Worker link secrets and retry" }, 503);
  }
  if (!env.DB) {
    log(now, "link", "unavailable", ref);
    return json({ ok: false, next: "check D1 availability and retry" }, 503);
  }

  const supplied = request.headers.get("X-AIM-Link-Key") ?? "";
  let authorized = false;
  try {
    authorized = await constantTimeEqual(supplied, env.AIM_LINK_KEY);
  } catch {
    log(now, "link", "unavailable", ref);
    return json({ ok: false, next: "check Worker cryptography support and retry" }, 503);
  }
  if (!authorized) {
    log(now, "link", "forbidden", ref);
    return json({ ok: false, next: "check caller authorization and retry" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    log(now, "link", "invalid_payload", ref);
    return json({ ok: false, next: "send a valid JSON body" }, 400);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    log(now, "link", "invalid_payload", ref);
    return json({ ok: false, next: "send a JSON object" }, 400);
  }

  const body = payload as Record<string, unknown>;
  const personCode = body.person_code;
  const lineUserId = body.line_user_id;
  const department = typeof body.department === "string" ? body.department : "operations";
  const role = typeof body.role === "string" ? body.role : "worker";
  if (
    typeof personCode !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(personCode) ||
    typeof lineUserId !== "string" ||
    !/^U[0-9a-f]{32}$/.test(lineUserId) ||
    department.length === 0 ||
    department.length > 64 ||
    !ALLOWED_ROLES.has(role)
  ) {
    // ห้ามสะท้อน line_user_id กลับไปในข้อความ error ไม่ว่ากรณีใด (D-P0-01)
    log(now, "link", "invalid_payload", ref);
    return json(
      {
        ok: false,
        next: "send person_code, a LINE user id, a department, and role worker|manager|owner",
      },
      400,
    );
  }

  try {
    const sourceHash = await hashSourceId(lineUserId, env.AIM_SOURCE_HASH_SALT);
    const outcome = await linkPerson(env.DB, personCode, sourceHash, department, role, now);
    if (outcome.status === "conflict") {
      // ตัวตนชนกัน — ห้ามทับเงียบ ๆ ให้คนตัดสิน · ไม่บอกว่าเจ้าของเดิมคือใคร
      log(now, "link", "conflict", personCode);
      return json(
        { ok: false, next: "this LINE account is already linked to a different person; unlink it first" },
        409,
      );
    }
    log(now, "link", outcome.status, personCode);
    return json({ ok: true, created: outcome.status === "created" });
  } catch {
    log(now, "link", "unavailable", ref);
    return json({ ok: false, next: "check D1 availability and retry" }, 503);
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const now = new Date().toISOString();

  if (url.pathname === "/healthz" || url.pathname === "/health") {
    if (request.method !== "GET") {
      const ref = safeReference();
      log(now, "health", "method_not_allowed", ref);
      return json(
        { ok: false, next: "call GET /healthz or GET /health" },
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

  if (url.pathname === "/sync/tasks") {
    if (request.method !== "POST") {
      return json({ ok: false, next: "call POST /sync/tasks" }, 405);
    }
    return handleSyncTasks(request, env, now);
  }

  if (url.pathname === "/admin/summary") {
    if (request.method !== "POST") {
      return json({ ok: false, next: "call POST /admin/summary" }, 405);
    }
    return handleAdminSummary(request, env, now);
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

  if (url.pathname === "/link") {
    if (request.method !== "POST") {
      log(now, "link", "method_not_allowed", safeReference());
      return json({ ok: false, next: "call POST /link" }, 405, { allow: "POST" });
    }
    return handleLink(request, env, now);
  }

  const ref = safeReference();
  log(now, "request", "not_found", ref);
  return json(
    { ok: false, next: "use GET /healthz, POST /ingest/line, POST /ask or POST /admin/summary" },
    404,
  );
}

export async function handleScheduled(env: Env, now: string): Promise<void> {
  let checkpointSafe = false;
  try {
    const summaries = await processScheduledSummaries(env, now);
    checkpointSafe = summaries.checkpointSafe;
    log(
      now,
      "summary_cron",
      "tick",
      `${summaries.sent}:${summaries.empty}:${summaries.retried}:${summaries.dead}:${summaries.missed}:${summaries.configMissing}`,
    );
  } catch {
    if (env.DB) {
      await recordSummaryPassIssue(env.DB, `cron:${now}`, "pass_error", now);
    }
    log(now, "summary_cron", "unavailable", "check-ledger-and-retry");
  }
  try {
    const result = await processQueue(env.DB, now, checkpointSafe);
    log(now, "cron", "tick", String(result.processed));
  } catch {
    log(now, "cron", "unavailable", "check-d1-and-retry");
    throw new Error("queue processing failed; cron_tick was not recorded");
  }
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
