export interface Env {
  AIM_ASK_KEY: string;
  AIM_LINK_KEY: string;
  AIM_INGEST_KEY: string;
  AIM_NOTIFY_KEY?: string;
  // ไม่ตั้ง = /admin/summary ปิดอยู่ (503) — ปุ่มฉุกเฉินควรปิดโดยปริยาย ไม่ใช่เปิดโดยปริยาย
  AIM_ADMIN_KEY?: string;
  // ไม่ตั้ง = /sync/tasks ปิดอยู่ (503) — ประตูที่เขียนตารางงานได้ ต้องปิดโดยปริยาย
  AIM_SYNC_KEY?: string;
  AIM_NOTIFY_URL?: string;
  AIM_SOURCE_HASH_SALT: string;
  DB: D1Database;
}

export interface EventMetadata {
  eventId: string;
  eventType: string;
  messageType: string | null;
  sourceType: string;
  sourceHash: string | null;
  postbackData: string | null;
  occurredAt: string;
  receivedAt: string;
  payloadBytes: number;
  payloadSha256: string;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
}
