# AI Manager (aim)

> **กติกาประจำรีโปอยู่ที่ `CLAUDE.md` — อ่านก่อนแตะอะไรทั้งสิ้น**
> สถานะและคำตัดสินที่เป็นทางการอยู่ที่ `docs/DECISIONS_P0.md` (ล่าสุด D-P0-14)

**สถานะ ณ 2026-08-28 — เดินจริงบน production แล้ว:**
Worker `aim-ingest` deploy แล้ว · D1 `aim-db` · Cron ทุก 1 นาที (วัดแล้ว 572 นาทีติดไม่มีนาทีไหนหาย)
· endpoint `POST /ingest/line` · `POST /ask` · `GET /healthz`
· สะพานฝั่ง LIVE (`vendor-ksk`) ส่ง event เข้ามาจริง และถาม-ตอบผ่าน LINE ได้ทั้งแชท 1:1 และในกลุ่มทดสอบ
· เปิดใช้เฉพาะ **2 บัญชีทดสอบ** เท่านั้น ยังไม่ขยายออกกลุ่มจริง

*(ข้อความเดิมตรงนี้เขียนว่า "ไม่มี Cron, consumer, bridge หรือการ deploy จริง" ซึ่งผิดทั้งสี่ข้อ
ตั้งแต่ 27 ส.ค. — เอกสารที่ล้าสมัยทำให้รายงานสถานะผิด จึงถือเป็นบั๊กชนิดหนึ่ง)*

## รันในเครื่อง

ต้องใช้ Node.js 22 ขึ้นไป จาก root ของ repo:

```powershell
npm ci
npm run db:migration:check
npm run db:migrate:local
npm run typecheck
npm test
```

ถ้าจะเปิด Worker local ให้สร้าง `worker/.dev.vars` (ไฟล์นี้ถูก ignore) และใส่
`AIM_INGEST_KEY` · `AIM_SOURCE_HASH_SALT` · `AIM_ASK_KEY` · `AIM_NOTIFY_KEY` และ
`AIM_NOTIFY_URL` จาก secret manager แล้วรัน:
(ไม่ใส่ `AIM_ASK_KEY` = `POST /ask` ตอบ 503 โดยไม่บอกสาเหตุ — WP-P2-B2)

`AIM_NOTIFY_KEY` และ `AIM_NOTIFY_URL` ใช้ส่งสรุปตามเวลาไปยัง endpoint ภายในฝั่งรับ
โดยฝั่งรับต้องใช้ `X-AIM-Idempotency-Key` กันการส่งซ้ำจริง ไม่ใช่เพียงรับ header ทิ้งไว้
ถ้าขาดค่าตัวใดตัวหนึ่ง Worker จะบันทึกว่า config ยังไม่พร้อมและเก็บรอบนั้นไว้ลองใหม่
หลังตั้งค่าครบ แทนการปิดรอบนั้นเป็นผลถาวร

```powershell
npm run dev
```

ปลายทางคือ `POST /ingest/line` พร้อม header `X-AIM-Key` และ `GET /healthz`

## Dump

```powershell
npm run db:dump
```

คำสั่งนี้ใช้ D1 local โดยปริยาย ไฟล์ dump อยู่ใน `dumps/` ซึ่งถูก ignore
ถ้าจะใช้ remote ต้องสร้าง `worker/wrangler.toml` จาก environment ด้วย
`npm run cf:config` ก่อน และเลือกโหมด `--remote`/`AIM_D1_MODE=remote`
ตามสคริปต์ ห้าม commit ไฟล์ config หรือ dump
