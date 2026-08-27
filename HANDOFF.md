# HANDOFF · WP-P0-1 ถึง WP-P0-3

วันที่ 2026-08-27 · ผู้เขียน: Codex (น้องกุ้ง) · สถานะ: ชุดตรวจผ่าน; local commit ถูก sandbox บล็อก

## ขอบเขตและสิ่งที่เปลี่ยน

- **VERIFIED (จากไฟล์):** งานยังจำกัดอยู่ที่ WP-P0-1, WP-P0-2 และ WP-P0-3 ตาม D-P0-03; ไม่ได้ทำ WP-P0-4, WP-P0-5 หรือ WP-P0-6
- **VERIFIED (จากไฟล์):** ไม่ได้เพิ่มการ deploy, push, remote migration หรือการเปิดบริการเสียเงิน
- **VERIFIED (npm registry):** `wrangler` เวอร์ชันล่าสุดคือ `4.126.0`; peerOptional ที่ต้องการคือ `@cloudflare/workers-types@^5.20260825.1`
- **VERIFIED (npm registry):** `@cloudflare/workers-types` เวอร์ชันล่าสุดคือ `5.20260826.1`
- **VERIFIED (จากไฟล์):** ปรับ `package.json` เป็น `wrangler@^4.126.0` และ `@cloudflare/workers-types@^5.20260826.1`; ช่วงเวอร์ชันสอดคล้องกับ peer requirement
- **VERIFIED (จากไฟล์):** `npm install` สร้าง `package-lock.json` จริง และไม่มีการใช้ `--force` หรือ `--legacy-peer-deps`
- **VERIFIED (`git check-ignore`):** `.gitignore` กัน `node_modules/` และ `.npm-cache/`; `package-lock.json` ไม่ถูก ignore
- **VERIFIED (จาก typecheck):** ปรับ `sha256Text()` ให้ส่ง `ArrayBuffer` จาก `TextEncoder` เข้า `sha256Bytes()` เพื่อรองรับ type definitions รุ่นปัจจุบัน โดยไม่เปลี่ยนข้อมูลที่นำไป hash

## ผลรันจริง 2026-08-27

`npm view wrangler version`

```text
4.126.0
```

`npm view @cloudflare/workers-types version`

```text
5.20260826.1
```

`npm install`

```text
added 85 packages, and audited 86 packages in 26s
found 0 vulnerabilities
```

`npm run typecheck`

```text
> tsc --noEmit
Exit code: 0
```

`npm test`

```text
Test Files  1 passed (1)
Tests       7 passed (7)
Duration    749ms
```

`npm run db:migration:check`

```text
Migration check passed twice in memory (1 file(s)); body_ref remains NULL-only.
```

`npm run privacy:check`

```text
Privacy guard passed (schema-only); checked 1 migration file(s).
```

## สถานะการยืนยัน

- **VERIFIED (ผลคำสั่งของผู้เขียน):** คำสั่งบังคับทั้ง 4 ชุดจบด้วย exit code 0 ตามผลด้านบน
- **VERIFIED (ผลตรวจเดิมจากผู้ตรวจ):** โครงสร้างและโค้ดผ่านการตรวจด้วยตาแล้วก่อนรอบนี้
- **INFERRED:** การแก้ dependency และ type mismatch น่าจะปิดเหตุขัดข้องเดิมได้ แต่ผลรันข้างต้นยังเป็นผลจากผู้เขียน จึงต้องให้ Claude/พี่เต้รัน `npm ci`, `npm run typecheck`, `npm test`, `npm run db:migration:check` และ `npm run privacy:check` ซ้ำก่อนรับงาน

## Blocker ของ local commit

- **VERIFIED (ผล `git add -A`):** staging ถูกปฏิเสธด้วย `fatal: Unable to create 'C:/WebApp/aim/.git/index.lock': Permission denied`
- **VERIFIED (ข้อจำกัด environment):** รอบนี้เขียนไฟล์งานใน `C:\WebApp\aim` ได้ แต่ `.git` เป็น read-only และ policy ไม่อนุญาตให้ขอสิทธิ์เพิ่ม
- **VERIFIED:** จึงยังไม่มี local commit และไม่มีการ push; รายละเอียดทางไปต่ออยู่ใน `QUESTIONS.md`

## สิ่งที่ยังไม่ทำ

- **VERIFIED:** ยังไม่ได้สร้าง D1/Worker บน Cloudflare, ไม่ได้รัน remote migration, ไม่ได้ deploy และไม่ได้ push
- **VERIFIED:** ยังไม่ได้ stage หรือ commit เพราะ sandbox ปฏิเสธการสร้าง `.git/index.lock`
- **VERIFIED:** ยังไม่ได้รัน `npm run db:migrate:local` หรือ `npm run privacy:check:local` เพราะไม่อยู่ในคำสั่งรอบนี้
- **VERIFIED:** ยังไม่ได้ใช้ groupId กลุ่มทดสอบ; เรื่องนี้อยู่ใน WP-P0-5 ซึ่งยังห้ามทำ

## แก้บั๊ก db-dump/privacy-guard บน Windows (2026-08-27 — ตรวจโดยผู้ตรวจอิสระ)

**บั๊กที่พบระหว่าง WP-P0-6 (deploy จริง + ทดสอบด้วยมือ):**
- `worker/scripts/db-dump.mjs` และ `schema/privacy-guard.mjs` เรียก `spawnSync('npx.cmd', [...])`
  โดยไม่ใส่ `{ shell: true }` → บน Windows ล้มเหลวด้วย `EINVAL` เงียบ ๆ (`result.error` ไม่ถูกเช็ค)
  ทำให้ error message ที่โยนออกมาไม่มีรายละเอียดจริงเลย ("Wrangler returned no detail")

**วิธีแก้ (VERIFIED — ทดสอบจริงบนเครื่องนี้แล้ว):**
resolve path ของ wrangler CLI ตรงผ่าน `createRequire` + `require.resolve('wrangler/package.json')`
แล้วเรียกด้วย `spawnSync(process.execPath, [wranglerBin, ...args])` — ไม่ต้องพึ่ง shell เลย
ปลอดภัยกว่า `shell: true` (ไม่มีความเสี่ยง command injection) และทำงานข้ามแพลตฟอร์ม
เพิ่มการเช็ค `result.error` แยกจาก `result.status !== 0` ในทั้งสองไฟล์

**ผลทดสอบจริงหลังแก้ (รันโดยผู้ตรวจอิสระ ไม่ใช่ผู้เขียนโค้ด):**
```
$ npm run typecheck        → ผ่าน
$ npm test                 → 7/7 ผ่าน
$ npm run db:dump          → "D1 remote dump written to dumps/....sql" (ไฟล์ 83 บรรทัด สคีมาครบ)
$ npm run privacy:check:remote → "Privacy guard passed (remote); checked 1 migration file(s)."
```

⚠ หมายเหตุ: รอบแรกที่รัน `db:dump` เจอ wrangler subprocess crash เอง (`0xc0000005 access violation`)
**หลังจากที่มันเขียนไฟล์ dump เสร็จแล้ว** — เป็นความไม่เสถียรของตัว wrangler บน Windows เอง
ไม่เกี่ยวกับวิธี spawn ที่แก้ (ลองซ้ำผ่านสะอาด) — ไฟล์ dump ที่ได้ทั้งสองรอบสมบูรณ์ถูกต้อง

## สรุปผล WP-P0-6 (ประตูปิดเฟส) — ทดสอบกับของจริงบน Cloudflare ครบ

1. ✅ พิมพ์ event ทดสอบ → เข้าคิว/ledger ของคลาวด์ (ยิงตรงผ่าน curl แทนกลุ่มทดสอบจริง เพราะยังไม่มี groupId)
2. ✅ ยิงซ้ำ 3 ครั้ง → `queueDepth` คงที่ที่ 1, `duplicates:1` ทุกครั้งหลังครั้งแรก
3. ✅ ปิด header ลับ → 403 เสมอ
4. ⏳ ปิด cim-server แล้ว cloud ยังเดิน — ยังทดสอบไม่ได้จนกว่าจะมี WP-P0-4 (Cron)
5. ✅ `npm run db:dump` ดึงข้อมูลกลับมาเก็บที่เครื่องได้จริง
6. ✅ ตรวจฐานจริงด้วย `wrangler d1 execute` ตรง: ไม่มีข้อความ/PII ใด ๆ หลุดเข้าฐาน, `body_ref` เป็น NULL ทุกแถว, `source_hash` เป็นแฮชไม่ใช่ userId ดิบ
7. ⏳ รอ code-reviewer ตรวจรอบสุดท้าย

**Worker ที่ deploy จริง:** `https://aim-ingest.mottosolar.workers.dev` · ฐาน `aim-db` (region APAC)
**ยืนยันแล้วว่าไม่กระทบ `mottosolar-line-relay`** (ของ homelab — modified_on ไม่เปลี่ยนก่อน/หลัง deploy)

## แก้ผลตรวจจาก code-reviewer 2026-08-27

- **VERIFIED (จากไฟล์):** เปลี่ยน `schema/privacy-guard.mjs` จาก denylist ชื่อคอลัมน์เป็น `ALLOWED_COLUMNS` ตายตัวสำหรับ 6 ตาราง โดย unknown table และคอลัมน์นอก allowlist ทำให้ guard ล้มทันที พร้อมทางไปต่อ เก็บการตรวจ ENUM, `body_ref` แบบ NULL-only และ raw LINE ID เดิมไว้ครบ รวมทั้งตรวจ `ALTER TABLE ... ADD COLUMN` ด้วย
- **VERIFIED (จากผลทดสอบของผู้เขียน):** `worker/src/payload.ts` ปฏิเสธ request ที่มีมากกว่า 50 events ด้วย `InvalidPayloadError`; handler ตอบ HTTP 400 และ `next` ระบุให้ส่งไม่เกิน 50 events พร้อมแบ่งเป็นหลาย request โดย regression test ใหม่ผ่าน
- **VERIFIED (จากไฟล์):** `.github/workflows/deploy.yml` มี step `Verify no PII reached the remote database` หลัง `Deploy aim-ingest` เรียก `npm run privacy:check:remote` และรับ `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` จาก secrets; รอบนี้ไม่ได้รัน workflow หรือ deploy จริง

### ผลชุดทดสอบบังคับหลังแก้

```text
$ npm run typecheck
> tsc --noEmit
Exit code: 0

$ npm test
Test Files  1 passed (1)
Tests       8 passed (8)
Duration    577ms
Exit code: 0

$ npm run db:migration:check
Migration check passed twice in memory (1 file(s)); body_ref remains NULL-only.
Exit code: 0

$ npm run privacy:check
Privacy guard passed (schema-only); checked 1 migration file(s).
Exit code: 0
```

### ผลทดลองช่องโหว่ `note TEXT`

สร้าง `schema/migrations/9999_privacy_guard_note_test.sql` ชั่วคราวด้วยเนื้อหา `ALTER TABLE inbox_event ADD COLUMN note TEXT;` แล้วรัน:

```text
$ npm run privacy:check
Error: Privacy schema guard failed:
- 9999_privacy_guard_note_test.sql: inbox_event.note is not in ALLOWED_COLUMNS; remove it or add it only after confirming it holds no PII
Remove unapproved schema fields and rerun npm run privacy:check.
Exit code: 1
```

หลังลบ migration ทดสอบแล้วรันซ้ำ:

```text
$ npm run privacy:check
Privacy guard passed (schema-only); checked 1 migration file(s).
Exit code: 0

TEMP_REMOVED
```

- **VERIFIED (จากผลคำสั่งของผู้เขียน):** reproduction เดิมถูกบล็อกแล้ว และไม่มีไฟล์ migration ทดสอบเหลืออยู่
- **INFERRED:** การแก้ทั้งสามข้อพร้อมส่งให้ Claude/พี่เต้ตรวจซ้ำ; ยังไม่ถือเป็นผลยืนยันอิสระของโค้ดรอบนี้จนกว่าจะมี code review และ rerun จากผู้ตรวจค่ะ

### ผลพยายามสร้าง local commit และ `git log --oneline`

```text
$ git add -A
fatal: Unable to create 'C:/WebApp/aim/.git/index.lock': Permission denied
Exit code: 128

$ git log --oneline
e6781ec แก้ spawnSync บน Windows: เรียก wrangler ผ่าน node ตรง ไม่พึ่ง shell/npx.cmd
1d8fffa P0-1..P0-3: โครง repo + Worker aim-ingest + D1 schema (metadata-only)
```

- **VERIFIED (จากผลคำสั่ง):** sandbox รอบนี้ให้ `.git` เป็น read-only จึง stage การแก้รอบนี้และสร้าง commit ใหม่ไม่ได้; HEAD ยังเป็น `e6781ec` และไม่มีการ push
- **VERIFIED (จาก `git diff --cached --name-status`):** `docs/DECISIONS_P0.md` ถูก stage ไว้จากภายนอกก่อนความพยายามนี้ ส่วนไฟล์ที่น้องกุ้งแก้ยังไม่ถูก stage; ไม่ได้ unstage หรือแก้ staged change เดิม
- **ทางไปต่อ:** รัน `git add -A`, `git diff --cached --check`, `git commit -m "Harden privacy guard and ingest limits"` และ `git log --oneline` จาก process ที่เขียน `C:\WebApp\aim\.git` ได้ โดยห้าม push ค่ะ
