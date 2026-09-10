// endpoints.test.ts — ยามที่วิ่งผ่าน "ทางเข้าจริง" (default export ของ worker/src/index.ts)
//
// บทเรียนที่มาก่อนไฟล์นี้ (ดู CLAUDE.md §"Why"): ฝั่ง PHP มีบั๊กที่ webhook ส่งตัวแปรที่ยังไม่ได้กำหนดค่าเข้าไป
// แล้ว "เทสระดับ library" 49 ข้อยังเขียวหมด เพราะไม่มีเทสไหนเรียกผ่านจุดที่ webhook จริงถูกเรียก
// worker.test.ts (ไฟล์เดิม) เรียก `handleRequest` (named export) เกือบทั้งหมด — ไม่มีเทสไหนเรียกผ่าน
// `export default { fetch, scheduled }` ที่ Cloudflare เรียกจริงเลยสักครั้ง ⇒ ถ้าตัวห่อ `fetch()` เอง
// พังโดยที่ `handleRequest` ยังถูกต้อง เทสเดิมทั้งหมดจะยังเขียวเหมือนเคสฝั่ง PHP
// ไฟล์นี้จึงเรียกผ่าน `worker.fetch(new Request(...), env)` (default export) ทุกเคส ไม่เรียก `handleRequest` ตรง ๆ
//
// ขอบเขต: เพิ่มเฉพาะเคสที่ worker.test.ts ยังไม่มี (อ้างอิงเลขบรรทัดของ worker.test.ts ที่ตรวจแล้วตอนเขียนไฟล์นี้)
// 1) POST /sync/tasks: ชุดผสม L-/ไม่ใช่ L- ในคำขอเดียว + ส่งซ้ำต้องไม่ซ้ำแถว — worker.test.ts มีเคสใกล้เคียง
//    (บรรทัด ~1297, ~1316, ~1336) แต่ไม่มีเคสที่ผสม L- กับไม่ใช่ L- ในชุดเดียวกันแล้วตรวจทั้ง written/rejected
//    พร้อมส่งซ้ำทั้งชุดเพื่อพิสูจน์ idempotent — เพิ่มใหม่
// 2) POST /ask: unlinked ⇒ 403 เหมือนกุญแจผิด มีอยู่แล้ว (บรรทัด ~719) แต่ "หลัง POST /link แล้ว /ask
//    ต้องได้ 200" ไม่เคยมีเทสไหนต่อสองปลายทางนี้เข้าด้วยกัน — เพิ่มใหม่
// 3) POST /ingest/line: กุญแจผิด ⇒ 403 มีอยู่แล้ว (บรรทัด ~447) แต่ใช้ MemoryD1 (mock ในหน่วยความจำ)
//    ไม่เคยมีเทสไหนอ่านคอลัมน์ body_ref จาก SQLite จริงหลัง /ingest/line สำเร็จ — เพิ่มใหม่ (D-P0-01)
// 4) GET /healthz: มีเทสอยู่แล้ว (บรรทัด ~519) ที่ตรวจ ok:true และ queueDepth เป็นตัวเลข แต่เรียกผ่าน
//    handleRequest ไม่ใช่ default export — เพิ่มเคสเดียวกันแต่เรียกผ่าน fetch() จริงเพื่อปิดช่องว่างของทางเข้า
//    ตอนนี้ version/builtAt มีแล้ว (worker/scripts/write-version.mjs เขียนทับตอน deploy) — เพิ่มการตรวจสอบด้วย
// 5) เส้นทางที่ไม่รู้จัก ⇒ 404: ไม่พบเทสนี้ที่ไหนใน worker.test.ts เลย (ตรวจด้วย grep แล้ว) — เพิ่มใหม่
import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";
import type { Env } from "../src/types.ts";
import { SQLiteD1 } from "./helpers/sqliteD1.ts";

const ingestKey = "endpoints-ingest-key";
const askKey = "endpoints-ask-key";
const linkKey = "endpoints-link-key";
const syncKey = "endpoints-sync-key";
const sourceSalt = "endpoints-source-salt";

function baseEnv(database: SQLiteD1): Env {
  return {
    AIM_ASK_KEY: askKey,
    AIM_LINK_KEY: linkKey,
    AIM_INGEST_KEY: ingestKey,
    AIM_SYNC_KEY: syncKey,
    AIM_SOURCE_HASH_SALT: sourceSalt,
    DB: database.asD1(),
  };
}

function req(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json", ...(options.headers ?? {}) });
  const init: RequestInit = { method: options.method ?? "GET", headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  return new Request(`https://aim.example${path}`, init);
}

describe("POST /sync/tasks ผ่าน fetch จริง (default export)", () => {
  it("ชุดผสม L- กับไม่ใช่ L-: L- ถูก upsert ที่เหลือถูกปฏิเสธรายแถว นับถูก และส่งซ้ำไม่เกิดแถวซ้ำ", async () => {
    const database = new SQLiteD1();
    try {
      const batch = {
        tasks: [
          { task_ref: "L-100", title: "งานที่ 1", status: "assigned" },
          { task_ref: "X-100", title: "ไม่ใช่ L- ต้องถูกปฏิเสธ", status: "assigned" },
          { task_ref: "L-101", title: "งานที่ 2", status: "in_progress" },
          { task_ref: "L-102", title: "", status: "assigned" }, // title ว่าง = ปฏิเสธตาม index.ts:206
        ],
      };

      const first = await worker.fetch(
        req("/sync/tasks", { method: "POST", headers: { "X-AIM-Sync-Key": syncKey }, body: batch }),
        baseEnv(database),
      );
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ ok: true, written: 2, rejected: 2 });

      const afterFirst = await database
        .asD1()
        .prepare("SELECT task_ref FROM task ORDER BY task_ref")
        .all<{ task_ref: string }>();
      expect(afterFirst.results.map((row) => row.task_ref)).toEqual(["L-100", "L-101"]);

      // ส่งชุดเดิมซ้ำ — L- ต้องทับของเดิม (ON CONFLICT DO UPDATE) ไม่ใช่เพิ่มแถวใหม่
      const second = await worker.fetch(
        req("/sync/tasks", { method: "POST", headers: { "X-AIM-Sync-Key": syncKey }, body: batch }),
        baseEnv(database),
      );
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ ok: true, written: 2, rejected: 2 });

      const afterSecond = await database
        .asD1()
        .prepare("SELECT task_ref FROM task ORDER BY task_ref")
        .all<{ task_ref: string }>();
      expect(afterSecond.results).toHaveLength(2);
      expect(afterSecond.results.map((row) => row.task_ref)).toEqual(["L-100", "L-101"]);
    } finally {
      database.close();
    }
  });
});

describe("POST /ask ผ่าน fetch จริง (default export)", () => {
  it("unlinked person_code ตอบ 403 เหมือนกุญแจผิดทุกตัวอักษร แล้วหลัง POST /link ตอบ 200 ok:true", async () => {
    const database = new SQLiteD1();
    try {
      const personCode = "P-ENDPOINT-ASK";
      const question = "งานของฉันมีอะไรบ้าง";

      const unlinked = await worker.fetch(
        req("/ask", {
          method: "POST",
          headers: { "X-AIM-Ask-Key": askKey },
          body: { person_code: personCode, question },
        }),
        baseEnv(database),
      );
      const wrongKey = await worker.fetch(
        req("/ask", {
          method: "POST",
          headers: { "X-AIM-Ask-Key": "wrong-ask-key" },
          body: { person_code: personCode, question },
        }),
        baseEnv(database),
      );

      expect(unlinked.status).toBe(403);
      expect(wrongKey.status).toBe(403);
      expect(await unlinked.json()).toEqual(await wrongKey.json());

      const lineUserId = "U" + "d".repeat(32);
      const link = await worker.fetch(
        req("/link", {
          method: "POST",
          headers: { "X-AIM-Link-Key": linkKey },
          body: {
            person_code: personCode,
            line_user_id: lineUserId,
            department: "operations",
            role: "worker",
          },
        }),
        baseEnv(database),
      );
      expect(link.status).toBe(200);
      expect(await link.json()).toMatchObject({ ok: true, created: true });

      const linked = await worker.fetch(
        req("/ask", {
          method: "POST",
          headers: { "X-AIM-Ask-Key": askKey },
          body: { person_code: personCode, question },
        }),
        baseEnv(database),
      );
      expect(linked.status).toBe(200);
      expect(await linked.json()).toMatchObject({ ok: true });
    } finally {
      database.close();
    }
  });
});

describe("POST /ingest/line ผ่าน fetch จริง (default export)", () => {
  const rawGroupId = "C" + "e".repeat(32);

  function linePayload(eventId: string): Record<string, unknown> {
    return {
      destination: "U" + "f".repeat(32),
      events: [
        {
          webhookEventId: eventId,
          type: "message",
          timestamp: 1_787_765_432_000,
          source: { type: "group", groupId: rawGroupId },
          message: { id: "999888777", type: "text", text: "ข้อความทดสอบ endpoints.test" },
        },
      ],
    };
  }

  it("กุญแจผิดตอบ 403 ไม่เขียนอะไรลงฐาน", async () => {
    const database = new SQLiteD1();
    try {
      const response = await worker.fetch(
        req("/ingest/line", {
          method: "POST",
          headers: { "X-AIM-Key": "wrong-ingest-key" },
          body: linePayload("evt-endpoints-wrong-key"),
        }),
        baseEnv(database),
      );
      expect(response.status).toBe(403);

      const rows = await database
        .asD1()
        .prepare("SELECT COUNT(*) AS n FROM inbox_event")
        .all<{ n: number }>();
      expect(rows.results[0].n).toBe(0);
    } finally {
      database.close();
    }
  });

  it("envelope ถูกต้องเก็บ event จริง แล้ว body_ref เป็น NULL เมื่ออ่านตรงจากตาราง sqlite (D-P0-01)", async () => {
    const database = new SQLiteD1();
    try {
      const eventId = "01JENDPOINTSBODYREFCHECK01";
      const response = await worker.fetch(
        req("/ingest/line", {
          method: "POST",
          headers: { "X-AIM-Key": ingestKey },
          body: linePayload(eventId),
        }),
        baseEnv(database),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, accepted: 1 });

      const rows = await database
        .asD1()
        .prepare("SELECT event_id, body_ref FROM inbox_event WHERE event_id = ?")
        .bind(eventId)
        .all<{ event_id: string; body_ref: string | null }>();
      expect(rows.results).toHaveLength(1);
      expect(rows.results[0].body_ref).toBeNull();
    } finally {
      database.close();
    }
  });
});

describe("GET /healthz ผ่าน fetch จริง (default export)", () => {
  it("ตอบ 200, ok:true, queueDepth เป็นตัวเลข, และ version/builtAt เป็น string ไม่ว่างเปล่า", async () => {
    const database = new SQLiteD1();
    try {
      const response = await worker.fetch(req("/healthz"), baseEnv(database));
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(typeof body.queueDepth).toBe("number");
      expect(typeof body.version).toBe("string");
      expect(body.version).not.toBe("");
      expect(typeof body.builtAt).toBe("string");
    } finally {
      database.close();
    }
  });
});

describe("เส้นทางที่ไม่รู้จักผ่าน fetch จริง (default export)", () => {
  it("path ที่ไม่มีในระบบตอบ 404", async () => {
    const database = new SQLiteD1();
    try {
      const response = await worker.fetch(req("/no-such-path"), baseEnv(database));
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ ok: false });
    } finally {
      database.close();
    }
  });
});
