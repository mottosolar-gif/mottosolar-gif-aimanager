import type { Env } from "./types.ts";

export type OutboundResult =
  | { ok: true; reason: "sent" }
  | { ok: false; reason: string; retryable: boolean; skipped?: boolean };

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const notifyTimeoutMilliseconds = 10_000;

// 4xx ส่วนใหญ่ลองใหม่กี่ครั้งก็เหมือนเดิม แต่ 408/429 บอกว่า "ตอนนี้ยังไม่ได้" ไม่ใช่ "ไม่มีวันได้"
// ฝั่งรับไม่เคยตอบสองรหัสนี้ แต่ IIS/ARR ที่คั่นอยู่หน้าเขาตอบได้ (Dynamic IP Restriction ตอบ 429)
// เหมารวมว่าถาวร = สรุปรอบนั้นตายเพราะตัวคั่น ไม่ใช่เพราะปลายทางปฏิเสธจริง
const retryableClientStatuses: ReadonlySet<number> = new Set([408, 429]);

function isRetryableStatus(status: number): boolean {
  if (status < 400 || status >= 500) return true;
  return retryableClientStatuses.has(status);
}

export async function sendTextNotification(
  env: Env,
  personCode: string,
  text: string,
  idempotencyKey: string,
  fetcher: Fetcher = fetch,
): Promise<OutboundResult> {
  if (!env.AIM_NOTIFY_URL || !env.AIM_NOTIFY_KEY) {
    return { ok: false, reason: "config_missing", retryable: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), notifyTimeoutMilliseconds);
  try {
    const response = await fetcher(env.AIM_NOTIFY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "X-AIM-Notify-Key": env.AIM_NOTIFY_KEY,
        "X-AIM-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ kind: "text", person_code: personCode, text }),
      // ★ 2026-08-28: เดิมเป็น redirect:"error" ซึ่ง **Cloudflare Workers ไม่รองรับ**
      // (รองรับแค่ follow กับ manual) ⇒ fetch โยน TypeError ทิ้งตั้งแต่ยังไม่ออกจากคลาวด์
      // ผลคือสรุปตามเวลาส่งไม่ออกเลยแม้แต่ครั้งเดียวตั้งแต่เขียนมา และ log ของ IIS ก็ไม่มีร่องรอย
      // เพราะไม่เคยมีแพ็กเก็ตออกไปจริง — อาการเหมือน "ปลายทางล่ม" ทั้งที่ปลายทางไม่เคยถูกเรียก
      //
      // "manual" คงเจตนาเดิมไว้ครบ: ไม่เดินตาม redirect เอง แล้วเราตรวจ 3xx เองด้านล่าง
      // ⇒ ยังกันการถูกพาไปที่อื่นเงียบ ๆ เหมือนเดิม แต่ได้เหตุผลที่อ่านออกแทน TypeError เปล่า ๆ
      redirect: "manual",
      signal: controller.signal,
    });
    // 412 = ฝั่งรับตั้งใจไม่ส่ง เพราะวันนี้เป็นวันหยุดของผู้รับ (ปฏิทินอยู่ db_customs ฝั่งโน้น)
    // ไม่ใช่ความล้มเหลว และลองใหม่ในรอบเดิมก็ไม่เปลี่ยนอะไร ⇒ ต้องแยกออกจาก dead ให้ ledger จดตรง
    // (ก่อนฝั่งรับใส่ด่านนี้ 412 ไม่เคยเกิด ⇒ เพิ่มตรงนี้ไม่กระทบพฤติกรรมเดิมแม้แต่กรณีเดียว)
    if (response.status === 412) {
      return { ok: false, reason: "skipped_holiday", retryable: false, skipped: true };
    }
    // redirect = ตั้งค่าผิด ไม่ใช่เหตุขัดข้องชั่วคราว ⇒ ลองใหม่กี่ครั้งก็เหมือนเดิม
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, reason: "redirected", retryable: false };
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: `http_${response.status}`,
        retryable: isRetryableStatus(response.status),
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: "invalid_response", retryable: false };
    }
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      (body as Record<string, unknown>).ok !== true
    ) {
      return { ok: false, reason: "endpoint_rejected", retryable: false };
    }
    return { ok: true, reason: "sent" };
  } catch (error) {
    // "network" คำเดียวหยาบเกินไป — มันครอบทุก throw ในบล็อกนี้ ทั้ง DNS ล้ม · ต่อไม่ติด ·
    // ใบรับรองไม่ผ่าน · โดน redirect (เราตั้ง redirect:'error') · และ **URL ผิดรูป**
    // ซึ่งแต่ละอันต้องไล่คนละทางโดยสิ้นเชิง ⇒ ไล่บั๊กจากคำว่า "network" อย่างเดียวไม่ได้เลย
    // (เจอกับตัว 2026-08-28: สรุปยิงไม่ออกและใช้เวลาไล่นานเพราะเหตุผลบอกแค่ว่า network)
    //
    // เอาเฉพาะ "ชนิดของความผิดพลาด" ไม่เอาข้อความเต็ม — ข้อความอาจมี URL/ค่าที่ไม่ควรลง ledger
    // และขัดฟันหลอเหลือแต่ตัวอักษรปลอดภัย + ตัวพิมพ์เล็ก เพราะ safeOutcomeReason() รับแค่ [a-z0-9_]
    // (พลาดรอบแรก: ส่ง network_TypeError ไป แล้วมันถูกปัดเป็น "unknown" — ยามทำถูก แต่ข้อมูลหาย)
    const kind =
      error instanceof Error && typeof error.name === "string" && error.name !== ""
        ? error.name.replace(/[^A-Za-z0-9_]/g, "").toLowerCase().slice(0, 20)
        : "unknown";
    return { ok: false, reason: `network_${kind}`, retryable: true };
  } finally {
    clearTimeout(timeout);
  }
}
