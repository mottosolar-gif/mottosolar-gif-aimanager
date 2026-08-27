# คำตัดสินของผู้ออกแบบ — P0 (มีผลเหนือใบสั่งงานเดิมเมื่อขัดกัน)

## D-P0-01 · `inbox_event` เก็บ metadata เท่านั้น ห้ามเก็บเนื้อความ
2026-08-27 · เกิดจาก Codex ทักว่า WP-P0-3 ("เก็บ event ดิบ") ขัดกับกฎห้ามข้อมูลบุคคลขึ้นคลาวด์ — **Codex ทักถูก**

**เก็บได้:**
- `event_id` (LINE `webhookEventId`) UNIQUE — กุญแจกันซ้ำ
- `event_type` (message / postback / join / leave / follow …)
- `message_type` (text / image / audio / location / sticker …) — ชนิดเท่านั้น
- `source_type` (user / group / room)
- `source_hash` — SHA-256 ของ userId/groupId + salt จาก env · **ห้ามเก็บ id ดิบ**
- `occurred_at` — เวลาที่เหตุการณ์เกิดจริง (จาก LINE timestamp)
- `received_at` — เวลาที่คลาวด์รับเข้ามา
- `payload_bytes` (INTEGER) · `payload_sha256` — พิสูจน์ว่าได้รับอะไรมาโดยไม่ต้องเก็บของจริง
- `status` · `attempts` · `last_error` (error ของระบบเท่านั้น)
- `body_ref` (TEXT NULL) — ช่องไว้ชี้ที่เก็บเนื้อความภายนอกในอนาคต · **เฟสนี้ต้องเป็น NULL เสมอ**

**ห้ามเก็บเด็ดขาด:** ข้อความที่ผู้ใช้พิมพ์ · ชื่อ/นามสกุล/ชื่อแสดงผล · เบอร์โทร · อีเมล · เหตุผลการลา · URL รูปที่ดาวน์โหลดได้ · LINE id ดิบ

**เหตุผล:** P0 มีเป้าหมายเดียว — พิสูจน์ว่าท่อทะลุและกันซ้ำได้ ซึ่ง metadata เพียงพอ
เนื้อความจะถูกอ่านโดยชั้นสมองที่รันบนเครื่องภายใน (homelab) ในเฟสถัดไป **ไม่เก็บถาวรบนคลาวด์**

**ยาม privacy ต้องตรวจ 3 อย่าง:**
1. schema ไม่มีคอลัมน์ต้องห้าม (`name` `fullname` `phone` `email` `reason` `text` `message`)
2. `body_ref` เป็น NULL ทุกแถว
3. ไม่มีค่าที่หน้าตาเป็น LINE id ดิบ (`^U[0-9a-f]{32}$` / `^C[0-9a-f]{32}$`) อยู่ในฐาน

**เทสบังคับเพิ่ม:** ยิง event ที่มีข้อความยาว → ตรวจว่าข้อความนั้นไม่ปรากฏที่ใดในฐานเลย

---

## D-P0-02 · ⛔ ห้ามแตะ Worker `mottosolar-line-relay`
2026-08-27 · ตรวจจากหน้า Cloudflare จริงของเจ้าของ

Worker ชื่อนี้มีอยู่แล้วในบัญชีเดียวกัน และ **ทำงานจริง 22,370 invocations ใน 24 ชม.** (~15 ครั้ง/นาที · Errors 0 · binding = Durable Object `QUEUE`)
เป็นของระบบ **homelab** ที่รับ LINE webhook ไปพักไว้ให้ปลายทางดึง — ถ้า deploy ทับ ระบบนั้นตายทันที

⇒ **Worker ของโครงการนี้ต้องชื่อ `aim-ingest`**
⇒ `wrangler.toml` อ่าน `account_id` จาก environment (`CLOUDFLARE_ACCOUNT_ID`) ห้ามฝังในไฟล์

**โควตาที่ต้องเคารพ:** แพลนฟรีให้ 100,000 invocations/วัน **ต่อบัญชี** และตัวเดิมใช้ไปแล้ว ~22%
⇒ ห้ามออกแบบให้ poll ถี่ · Cron ทุก 1 นาที = ~1,440 ครั้ง/วัน ถือว่าเหมาะสม

---

## D-P0-03 · ขอบเขตรอบนี้
ทำเฉพาะ **WP-P0-1 · WP-P0-2 · WP-P0-3**
**ห้ามทำ** WP-P0-4 (Cron+ตัวกินคิว) · WP-P0-5 (แตะ `line_webhook.php` ของระบบ LIVE) · WP-P0-6 — ทั้งสามใบรอคำอนุมัติจากเจ้าของระบบ
