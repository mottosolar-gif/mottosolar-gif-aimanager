# AI Manager (aim)

Cloudflare Worker + D1 ที่รับ LINE event จากระบบ LINE OA เดิม (`vendor-ksk`/`cim-server`)
ผ่านสะพาน PHP ใน `bridge/` แล้วขับเคลื่อนงานภาคสนามด้วย state machine 10 สถานะ พร้อมแชทบอทไทย
("น้องกุ้ง") ที่ตอบคำถามเกี่ยวกับงานแบบ rule-based (ไม่ใช้ LLM) — Worker ชื่อจริงคือ **`aim-ingest`**
อย่าสับสนกับ Worker เดิมของ homelab ชื่อ `mottosolar-line-relay` ซึ่งเป็นคนละระบบ

> **ก่อนแตะโค้ดหรือรันคำสั่งใด ๆ ที่กระทบของจริง (deploy/migrate remote/dump) ให้อ่าน [`CLAUDE.md`](./CLAUDE.md)
> ก่อนเสมอ** — เป็นเอกสารที่อัปเดตสถานะ/กติกาล่าสุดของรีโปนี้ (ตรวจกับของจริงแล้ว ไม่ใช่จากความจำ)
> README นี้อธิบายว่า "ระบบนี้คืออะไรและพัฒนายังไง" ส่วน "ตอนนี้สถานะเป็นยังไง" ให้ดูที่ CLAUDE.md เท่านั้น
> เพราะตัวเลขสถานะเปลี่ยนได้ทุกวันและ README ไม่ใช่ที่เก็บของแบบนั้น

---

## สารบัญ

1. [ภาพรวมระบบ](#ภาพรวมระบบ)
2. [สถาปัตยกรรม](#สถาปัตยกรรม)
3. [โครงสร้าง repo](#โครงสร้าง-repo)
4. [เริ่มพัฒนาในเครื่อง](#เริ่มพัฒนาในเครื่อง)
5. [รัน Worker ในเครื่อง](#รัน-worker-ในเครื่อง)
6. [Endpoints](#endpoints)
7. [Cron / คิวประมวลผล](#cron--คิวประมวลผล)
8. [State machine ของงาน](#state-machine-ของงาน)
9. [Visibility model (ใครเห็นงานใคร)](#visibility-model-ใครเห็นงานใคร)
10. [แชทบอทน้องกุ้ง (query engine)](#แชทบอทน้องกุ้ง-query-engine)
11. [ฐานข้อมูล (D1)](#ฐานข้อมูล-d1)
12. [สะพานเชื่อม LINE (`bridge/`)](#สะพานเชื่อม-line-bridge)
13. [Deploy จริง](#deploy-จริง)
14. [Dump ฐานข้อมูล](#dump-ฐานข้อมูล)
15. [ความปลอดภัย / ข้อมูลส่วนบุคคล](#ความปลอดภัย--ข้อมูลส่วนบุคคล)
16. [CI](#ci)
17. [เทส](#เทส)
18. [กติกาที่ต้องรู้ก่อนแตะของจริง](#กติกาที่ต้องรู้ก่อนแตะของจริง)
19. [เอกสารอื่น ๆ ในรีโปนี้](#เอกสารอื่น-ๆ-ในรีโปนี้)

---

## ภาพรวมระบบ

ระบบนี้เชื่อมสองฝั่งเข้าด้วยกัน:

- **ฝั่ง LINE ของจริง** อยู่ที่ `C:\WebApp\vendor-ksk` (เครื่อง `cim-server`) — ระบบเดิมที่รับ/ส่ง LINE
  message อยู่แล้ว ไฟล์ PHP ใน `bridge/` ของรีโปนี้เป็นแค่ **สำเนา staging** ของไฟล์ที่ deploy จริงที่นั่น
- **ฝั่งคลาวด์ใหม่** คือ Cloudflare Worker `aim-ingest` + ฐาน D1 `aim-db` ในรีโปนี้ — รับ event ที่สะพานส่งมา
  เก็บลงคิว ประมวลผลด้วย Cron ทุก 1 นาที ขับเคลื่อน state machine ของ "งาน" (task) แต่ละใบ
  และตอบคำถามภาษาไทยผ่าน query engine

พูดสั้น ๆ: พนักงานกดปุ่ม "รับงาน/ปฏิเสธ/ถึงที่แล้ว/เริ่มงาน/งานเสร็จ" บนการ์ด LINE → สะพาน PHP
ส่ง postback มาที่ Worker → Worker เปลี่ยนสถานะงานใน D1 → (ในอนาคต) ส่งการ์ดหรือคำตอบกลับไปที่ LINE

## สถาปัตยกรรม

สถาปัตยกรรมจริงที่ใช้อยู่คือ **4 ชั้น แยกบ้านกันชัดเจน** ตาม `docs/IMPLEMENTATION_PLAN.md` §2
(เอกสารนี้เขียนทับดีไซน์เดิมใน `docs/ARCHITECTURE.md`/`docs/DATABASE_SCHEMA.md` ที่เสนอให้ต่อยอด
ฐานข้อมูลเดิมบน `cim-server` ในบ้านเดียว — ดีไซน์นั้นถูกเปลี่ยนไปแล้ววันถัดมา อย่าใช้เป็นสถาปัตยกรรมปัจจุบัน):

| ชั้น | คืออะไร | หน้าที่ |
|---|---|---|
| ① Cloudflare Workers (รีโปนี้) | ประตูหน้าสาธารณะ | รับ webhook เร็วระดับ ms · enqueue · ถือนาฬิกา Cron |
| ② homelab ("เต้น้อย") | สมอง | งาน LLM/รูปภาพ (ยังไม่ตั้งค่าในเฟสนี้) · ถือ token กลุ่ม LINE OA |
| ③ cim-server (`vendor-ksk`) | ของเดิม | แหล่งความจริงของข้อมูล HR/งานเดิม — **อ่านอย่างเดียว ห้ามเขียน** จากระบบใหม่ |
| ④ GitHub + Notion | บ้านถาวรของโค้ด | โค้ด + CI (ที่นี่) และหน้าตั้งค่ากติกาแบบ no-code (Notion) |

D1 (`aim-db`) คือแหล่งความจริงของข้อมูล "งาน/สถานะ" ชุดใหม่ ไม่ใช่ MySQL ของ `cim-server`

## โครงสร้าง repo

```
.
├── worker/            Cloudflare Worker (TypeScript) — ตัวรับ event, คิว, state machine, query engine
│   ├── src/           โค้ดจริง (index.ts, payload.ts, queue.ts, taskMachine.ts, visibility.ts, queryEngine.ts, ...)
│   ├── test/          Vitest — บางชุดยิงกับ D1 จำลองด้วย node:sqlite จริง ไม่ใช่ mock
│   ├── scripts/       db-dump.mjs, render-wrangler-config.mjs
│   ├── wrangler.local.toml     config dev ในเครื่อง (commit จริง)
│   └── wrangler.toml.example   template ของ config deploy จริง (ตัวจริง wrangler.toml ถูก gitignore)
├── schema/
│   ├── migrations/    ไฟล์ .sql 3 ใบ (0001_initial, 0002_task, 0003_postback)
│   └── check-migration.mjs   ตรวจว่า migration รันซ้ำได้ + ตารางครบ + body_ref ห้ามไม่ NULL
├── bridge/             สำเนา staging ของ PHP ฝั่ง vendor-ksk (ของจริงอยู่ที่ C:\WebApp\vendor-ksk เท่านั้น)
├── docs/               เอกสารดีไซน์/แผนงาน/คำตัดสิน — ดูหัวข้อ "เอกสารอื่น ๆ" ด้านล่าง
├── CLAUDE.md           กติกาถาวร + สถานะล่าสุด — อ่านก่อนเสมอ
├── HANDOFF.md          บันทึกส่งงานรอบ WP-P0-1..3 (2026-08-27) — ประวัติศาสตร์ ไม่ใช่สถานะปัจจุบัน
└── QUESTIONS.md        คำถามเปิด/ปิดของรอบ WP-P0-1..3 — ประวัติศาสตร์เช่นกัน
```

## เริ่มพัฒนาในเครื่อง

ต้องใช้ **Node.js ≥ 22** จาก root ของ repo:

```powershell
npm ci
npm run typecheck          # tsc --noEmit
npm test                   # vitest run
npm run lint                # eslint . (บังคับ no-floating-promises / no-misused-promises)
npm run db:migration:check  # รัน migration ซ้ำในหน่วยความจำ 2 รอบ + ตรวจ body_ref ยัง NULL-only
npm run db:migrate:local    # apply migration ลง D1 local จริง (ผ่าน wrangler.local.toml)
```

`npm run lint` สำคัญเป็นพิเศษ: กฎ `no-floating-promises`/`no-misused-promises` มีไว้กัน
`await` หายจาก `canView()` (สิทธิ์การมองเห็น) ซึ่งลืมครั้งเดียว = สิทธิ์รั่วทั้งระบบ

## รัน Worker ในเครื่อง

สร้าง `worker/.dev.vars` (gitignore ไว้แล้ว) แล้วใส่:

```
AIM_INGEST_KEY=<secret สำหรับ header X-AIM-Key>
AIM_SOURCE_HASH_SALT=<salt สำหรับแฮช source id ของ LINE>
```

แล้วรัน:

```powershell
npm run dev
```

## Endpoints

ทุกเส้นทางจับคู่ตรงด้วย `pathname` และตอบ JSON เสมอ · เส้นทางที่ไม่รู้จักตอบ `404`

| Method | Path | Auth | คำอธิบาย |
|---|---|---|---|
| `GET` | `/healthz` | ไม่ต้อง | สุขภาพระบบ: คิวค้าง · งานที่ตายถาวร · event ที่ค้างเกิน 15 นาที |
| `POST` | `/ingest/line` | `X-AIM-Key` | รับ LINE webhook envelope แล้ว enqueue แบบ idempotent |
| `POST` | `/ask` | `X-AIM-Ask-Key` | ถาม-ตอบเรื่องงาน (rule-based ไม่ใช้ LLM) ผ่าน `canView()` เสมอ |
| `POST` | `/link` | `X-AIM-Link-Key` | ผูก LINE id (แฮชแล้ว) เข้ากับ `person_code` |
| `POST` | `/sync/tasks` | `X-AIM-Sync-Key` | รับสำเนางานจากฝั่ง LIVE **ทางเดียว** — ห้ามมี endpoint เขียนกลับ |
| `POST` | `/admin/summary` | `X-AIM-Admin-Key` | สั่งยิงสรุปหนึ่งรอบ หรือ `preview` ดูก่อนส่ง |

**กุญแจแยกดวงต่อหน้าที่โดยเจตนา** — ยืมกุญแจกันเมื่อไร คนที่ควรได้แค่ถาม จะสั่งเขียนตารางงานได้ทันที
ไม่ตั้ง secret ของเส้นทางไหน = เส้นทางนั้นปิด (`503`) · กุญแจผิดตอบ `403` เหมือนกันทุกตัวอักษร

> จำนวนและรายละเอียดของ endpoint เปลี่ยนได้ตามเฟส — ยึด `worker/src/index.ts` เป็นความจริง

## Cron / คิวประมวลผล

Worker มี `scheduled` handler ที่ยิงทุก **1 นาที** (`crons = ["*/1 * * * *"]` ใน wrangler config)
เรียก `processQueue()`:

1. ดึงงานค้าง (pending) สูงสุด 10 รายการต่อรอบจาก `job_queue`
2. อ่าน postback ที่แนบมากับ `inbox_event` แล้วแปลง `act=` เป็นสถานะงานใหม่:

   | postback `act` | สถานะใหม่ |
   |---|---|
   | `aim_accept` | `accepted` |
   | `aim_reject` | `rejected` |
   | `aim_enroute` | `en_route` |
   | `aim_arrived` | `arrived` |
   | `aim_start` | `in_progress` |
   | `aim_complete` | `completed` |

2. ผูกผู้กดปุ่ม (source hash) เข้ากับ `person_code` ผ่านตาราง `person_link` แล้วเรียก state machine
3. ถ้าล้มเหลว: retry แบบ exponential backoff (`30 × 2^(attempts-1)` วินาที) สูงสุด 5 ครั้ง ก่อนย้ายไปสถานะ `dead`
4. บันทึกทุกรอบลง `ledger` (ไม่ว่าจะมีงานให้ทำหรือไม่)

## State machine ของงาน

`worker/src/taskMachine.ts` เป็นจุดตัดสิน ownership การเปลี่ยนสถานะงานจุดเดียว — 10 สถานะ:

```
draft → assigned → accepted → en_route → arrived → in_progress → completed
                 ↘ rejected              ↘ blocked ↺ in_progress
                                          in_progress/accepted → cancelled
```

- ทุกการเปลี่ยนสถานะที่มาจาก LINE (`source === "line"`) ต้องเป็นผู้รับมอบหมายงาน (assignee) เท่านั้น
  ที่กดปุ่มได้ — ตรวจจาก `person_code` ที่ resolve มาจาก LINE sender
- ใช้ optimistic concurrency (`UPDATE ... WHERE status = <เดิม>`) กันสองรอบแก้ทับกัน
- ทุกการเปลี่ยนสถานะถูกบันทึกลง `task_event` (audit trail)

## Visibility model (ใครเห็นงานใคร)

`worker/src/visibility.ts::canView()` เป็นจุดตัดสินสิทธิ์การมองเห็นจุดเดียว ห้ามเขียนเงื่อนไข
role/department ซ้ำที่อื่น:

- เห็นข้อมูลตัวเองเสมอ
- role `owner` เห็นทุกคน
- role `manager` เห็นเฉพาะคนแผนกเดียวกัน (แผนกว่างของฝั่งใดฝั่งหนึ่ง = ไม่ให้เห็น เพราะถือเป็นข้อมูลไม่ครบ ไม่ใช่สิทธิ์)
- role อื่น (`worker`, `guest`, ฯลฯ) เห็นเฉพาะตัวเอง

## แชทบอทน้องกุ้ง (query engine)

`worker/src/queryEngine.ts` เป็นแชทบอทภาษาไทยแบบ **rule-based จับคำสำคัญ ไม่ใช่ LLM** ชื่อ **"น้องกุ้ง"**
(ลงท้ายด้วย ค่ะ/คะ เสมอ) รองรับ 19 คำถามมาตรฐาน แบ่งเป็น 3 กลุ่ม:

- **งานของฉัน** — งานทั้งหมด/ค้างอยู่/เกินกำหนด/เสร็จวันนี้/เสร็จสัปดาห์นี้/งานถัดไป/งานล่าสุดที่ได้รับ
- **งานทีม** (เฉพาะ role `manager`/`owner` — ผ่าน `canAskTeamQuestion`) — ใครยังไม่รับงาน, ใครค้างมากสุด,
  งานเกินกำหนดของทีม, สรุปวันนี้ทั้งทีม, ใครปฏิเสธงาน, งานที่ยังไม่มีคนรับ
- **สถิติ** (กรองด้วย visibility model) — งานเสร็จ/ถูกปฏิเสธเดือนนี้, เวลาเฉลี่ยรับงานถึงเสร็จ,
  ใครรับงานเร็วที่สุด, งานใหม่วันนี้, `help`, `system_status`

วันเวลาทุกจุดคำนวณเป็นเขตเวลาไทย (UTC+7) และแสดงผลปีเป็น พ.ศ. คำตอบถูกจำกัดความยาวไม่เกิน
budget ของข้อความ LINE เสมอ (ตัดรายการ + บอกว่า "แสดง N จาก M")

## ฐานข้อมูล (D1)

3 migration (`schema/migrations/0001_initial.sql`, `0002_task.sql`, `0003_postback.sql`) สร้าง 9 ตาราง:

| ตาราง | ใช้ทำอะไร |
|---|---|
| `inbox_event` | event ที่รับเข้ามา (metadata เท่านั้น — ดูกฎความเป็นส่วนตัวด้านล่าง) |
| `job_queue` | คิวงานที่ Cron ดึงไปประมวลผล |
| `person` | ทะเบียนคน — เก็บแค่ `person_code`/แผนก/บทบาท ไม่มีชื่อจริง |
| `person_link` | ผูก source hash (LINE) เข้ากับ `person_code` |
| `ledger` | log ผลลัพธ์ทุกการกระทำ |
| `sync_state` | checkpoint การ sync ต่อแหล่งข้อมูลภายนอก |
| `task` | งานแต่ละใบ + สถานะ + กำหนดเวลา/ตำแหน่ง |
| `task_event` | audit trail การเปลี่ยนสถานะงาน |
| `outbound_queue` | คิวการแจ้งเตือนขาออกที่ผูกกับงาน/ผู้รับ |

**`docs/ARCHITECTURE.md`/`docs/DATABASE_SCHEMA.md` อธิบายสคีมาคนละชุดกับของจริง** (ดีไซน์เริ่มต้นที่ถูกแทนที่แล้ว)
ถ้าต้องการโครงสร้างตัวจริง ให้อ่าน `schema/migrations/*.sql` โดยตรง

## สะพานเชื่อม LINE (`bridge/`)

ดูรายละเอียดเต็มที่ [`bridge/README.md`](./bridge/README.md) — สรุปสั้น ๆ: โฟลเดอร์นี้เป็น **สำเนา staging**
ของไฟล์ PHP ที่ deploy จริงอยู่ที่ `C:\WebApp\vendor-ksk` เท่านั้น ไม่ใช่ของที่รันจริง ต้อง sync มือ

- **ขาไป (LINE → cloud)**: `aim_forward.php` ส่ง event ไป `POST /ingest/line` แบบ fire-and-forget
  จากสองเส้นทาง — (1) ข้อความในกลุ่มทดสอบที่ตั้งค่าไว้ (2) postback ที่ `data` ขึ้นต้นด้วย `act=aim_`
  **ไม่ว่าจะมาจากแชท 1:1/กลุ่ม/ห้องใดก็ตาม** (ตั้งแต่ WP-P1-B3)
- **ขากลับ (cloud → LINE)**: `aim_notify.php` + endpoint `api_aim_notify.php` ให้คลาวด์สั่งส่งการ์ดงาน
  พร้อมปุ่ม รับ/ปฏิเสธ กลับไปหาพนักงานคนที่ถูกต้องจริงบน LINE

## Deploy จริง

⚠ คำสั่งเหล่านี้ **แตะของจริงทันที** ไม่มีขั้นยืนยันซ้ำ:

| คำสั่ง | ผลจริง |
|---|---|
| `npm run cf:config` | สร้าง `worker/wrangler.toml` (gitignore) จาก `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_D1_DATABASE_ID` ใน env |
| `npm run db:migrate:remote` | apply migration ลง D1 production |
| `npm run deploy` | deploy ทับ Worker `aim-ingest` บน production |

ต้องมี `CLOUDFLARE_API_TOKEN` ใน env ก่อนสองคำสั่งหลังจะรันได้จริง — **ห้ามเขียน token ลงไฟล์**
ให้อยู่ใน env ของ session เท่านั้น

## Dump ฐานข้อมูล

```powershell
npm run db:dump
```

⚠ **ค่าเริ่มต้นคือ local ไม่ใช่ remote** (`AIM_D1_MODE ?? "local"`) — ถ้าจะ dump ของจริงต้องรัน
`npm run db:dump -- --remote` หรือ set `AIM_D1_MODE=remote` ไฟล์ผลลัพธ์อยู่ใน `dumps/` (gitignore)
และสคริปต์จะไม่ยอมเขียนทับไฟล์เดิมที่ path เดียวกัน

## ความปลอดภัย / ข้อมูลส่วนบุคคล

- D1 เก็บได้แค่ **metadata**: `person_code` + แผนก + บทบาท ไม่มีชื่อจริง/เบอร์โทร/ข้อความดิบ
- `inbox_event.body_ref` มี `CHECK (body_ref IS NULL)` ที่ระดับ schema — ใส่ค่าอื่นไม่ได้เลย
  (`npm run db:migration:check` ตรวจกฎนี้ทุกครั้ง)
- source id ของ LINE (userId/groupId/roomId) ถูกแฮชด้วย `AIM_SOURCE_HASH_SALT` ก่อนเก็บเสมอ ไม่เก็บดิบ
- **ไม่มีตัวกัน PII อัตโนมัติแล้ว** — เคยมี `schema/privacy-guard.mjs` แต่ถูกถอดออกตามการตัดสินใจ
  ของเจ้าของระบบ (เพราะชื่อในกลุ่มทดสอบเป็นชื่อเล่น/ปลอมทั้งหมด) **migration ใหม่ทุกใบต้องตรวจคอลัมน์ด้วยตา**
- ห้ามเขียนลงฐานของ `cim-server` — ฝั่งนั้นอ่านอย่างเดียว

## CI

`.github/workflows/deploy.yml` (`test-and-deploy`) ยิงเมื่อ push เข้า branch `main`:

- **job `test`**: checkout → setup Node 22 → `npm ci` → `npm run typecheck` → `npm test` →
  `npm run lint` → `npm run db:migration:check`
- **job `deploy`** (ต้องรอ `test` ผ่านก่อน, environment `production`): `npm run cf:config` →
  `npm run db:migrate:remote` → `npm run deploy` — ต้องมี secrets `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_D1_DATABASE_ID`, `CLOUDFLARE_API_TOKEN` ตั้งไว้ในรีโป GitHub

## เทส

`npm test` รัน Vitest 5 ชุดใน `worker/test/`:

- `worker.test.ts` — endpoint ทั้งสอง + คิว ด้วย D1 จำลองในหน่วยความจำ
- `queueTaskAction.test.ts` — postback → เปลี่ยนสถานะงาน แบบ end-to-end
- `taskMachine.test.ts` — transition/optimistic concurrency
- `visibility.test.ts` — `canView()` กับ D1 จริง (SQLite ผ่าน `node:sqlite`, ไม่ใช่ mock)
- `queryEngine.test.ts` — คำถามภาษาไทยทั้ง 19 intent กับ D1 จริงเช่นกัน

ชุด `visibility`/`queryEngine` ยิงกับ schema จริงที่ migrate แล้ว ไม่ใช่ mock ที่จับคู่สตริง SQL —
ตั้งใจให้แน่ใจว่าพิสูจน์อะไรได้จริง ไม่ใช่แค่พิสูจน์ว่า mock ทำงาน

## กติกาที่ต้องรู้ก่อนแตะของจริง

รายละเอียดเต็มอยู่ที่ [`CLAUDE.md`](./CLAUDE.md) สรุปกฎที่พลาดแล้วเจ็บมาก่อน:

- **ห้ามแตะ Worker ชื่อ `mottosolar-line-relay`** — เป็นของ homelab รันอยู่จริง ~22,000 ครั้ง/วัน
  deploy ทับ = ระบบนั้นตายทันที โควตาฟรีของบัญชี Cloudflare (100,000 invocation/วัน) ใช้ร่วมกันทั้งบัญชี
- โควตา LINE push จริงมีจำกัดต่อเดือน — เช็คตัวเลขล่าสุดที่ CLAUDE.md ก่อนอ้างอิง อย่าเชื่อเอกสารเก่า
- ห้ามผูก vendor (บริษัทภายนอก) เข้ากับ LINE — งาน AI Manager เป็นพื้นที่ของพนักงานภายในเท่านั้น
- SQL มาตรฐานเท่านั้น ห้ามให้ Durable Objects/Queues เป็นกระดูกสันหลังจนย้ายบ้านไม่ได้
- ห้ามคุยทดสอบในกลุ่ม LINE จริง — ใช้กลุ่มทดสอบเท่านั้น

## เอกสารอื่น ๆ ในรีโปนี้

| ไฟล์ | เนื้อหา |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | กติกาถาวร + สถานะล่าสุด — **อ่านก่อนเสมอ** |
| [`docs/DECISIONS_P0.md`](./docs/DECISIONS_P0.md) | บันทึกคำตัดสิน D-P0-01 ถึง D-P0-13 (append-only) ที่ห้ามรื้อซ้ำ |
| [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) | สถาปัตยกรรม 4 ชั้นจริง (ใช้แทน ARCHITECTURE.md) + แผนเฟส P0–P5 |
| [`docs/WORK_PACKAGES_P0.md`](./docs/WORK_PACKAGES_P0.md) / [`P1`](./docs/WORK_PACKAGES_P1.md) / [`P2`](./docs/WORK_PACKAGES_P2.md) | ใบสั่งงานรายเฟส — **P1 น่าเชื่อถือว่าปิดจริง**, P0/P2 ให้เช็คสถานะจาก CLAUDE.md แทนไฟล์นี้ |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) / [`docs/DATABASE_SCHEMA.md`](./docs/DATABASE_SCHEMA.md) | ดีไซน์เริ่มต้น (2026-08-26) **ถูกแทนที่แล้ว** วันถัดมาโดย IMPLEMENTATION_PLAN.md — ใช้อ้างอิงตรรกะ state machine ได้ แต่อย่าใช้เป็นสถาปัตยกรรม/schema ปัจจุบัน |
| [`bridge/README.md`](./bridge/README.md) | รายละเอียดสะพาน PHP ↔ LINE |
| [`HANDOFF.md`](./HANDOFF.md) / [`QUESTIONS.md`](./QUESTIONS.md) | บันทึกส่งงาน/คำถามของรอบ WP-P0-1..3 (2026-08-27) — **ประวัติศาสตร์ ไม่ใช่สถานะปัจจุบัน** |
