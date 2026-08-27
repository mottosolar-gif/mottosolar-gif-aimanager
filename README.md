# AI Manager (aim) · P0

รอบนี้มีเฉพาะ Worker รับ LINE event, คิว D1, schema/migration, privacy guard,
สคริปต์ dump และ GitHub Actions ของ WP-P0-1 ถึง WP-P0-3 เท่านั้น ไม่มี Cron,
consumer, bridge ฝั่งระบบ LIVE หรือการ deploy จริง

## รันในเครื่อง

ต้องใช้ Node.js 22 ขึ้นไป จาก root ของ repo:

```powershell
npm ci
npm run db:migration:check
npm run db:migrate:local
npm run typecheck
npm test
npm run privacy:check
```

ถ้าจะเปิด Worker local ให้สร้าง `worker/.dev.vars` (ไฟล์นี้ถูก ignore) และใส่
`AIM_INGEST_KEY` กับ `AIM_SOURCE_HASH_SALT` จาก secret manager แล้วรัน:

```powershell
npm run dev
```

ปลายทางคือ `POST /ingest/line` พร้อม header `X-AIM-Key` และ `GET /healthz`

## Dump และตรวจ privacy

```powershell
npm run db:dump
npm run privacy:check:local
```

สองคำสั่งนี้ใช้ D1 local โดยปริยาย ไฟล์ dump อยู่ใน `dumps/` ซึ่งถูก ignore
ถ้าจะใช้ remote ต้องสร้าง `worker/wrangler.toml` จาก environment ด้วย
`npm run cf:config` ก่อน และเลือกโหมด `--remote`/`AIM_D1_MODE=remote`
ตามสคริปต์ ห้าม commit ไฟล์ config หรือ dump

