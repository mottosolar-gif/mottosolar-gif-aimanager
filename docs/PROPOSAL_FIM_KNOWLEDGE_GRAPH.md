# ข้อเสนอ — Knowledge Graph (Graphify + Obsidian + AI Agent) สำหรับ FIM/estate

เขียน 2026-09-07 · **เอกสารข้อเสนอ อ่านอย่างเดียว — ไม่มีการแก้ CIM / FIM / vendor portal / ฐานข้อมูล / scheduled task / service / production config ใด ๆ**
ผู้เขียน: Claude (บทบาทสถาปัตยกรรม+ตรวจงาน ตาม `CLAUDE.md` §1) · ยังไม่ใช่ใบสั่งงาน · ยังไม่มีคำอนุมัติ

> **กติกาการอ่านเอกสารนี้**
> - `[VERIFIED]` = เห็นของจริงในรีโปนี้ (commit `c4e10e4`) หรือวัดได้จริงในเครื่องที่เขียน · อ้าง `ไฟล์:บรรทัด` ทุกจุด
> - `[อ้างเอกสาร]` = มีบันทึกไว้ในเอกสารของรีโปนี้ (`docs/*.md` · `CLAUDE.md`) แต่ผู้เขียน **ไม่เห็นของจริง**
> - `[รอยืนยัน]` = ไม่มีหลักฐานในมือ · ระบุไว้ท้ายบรรทัดว่าต้องใช้หลักฐานอะไร
> - `[INFERRED]` = ผู้เขียนอนุมานเอง · ห้ามนำไปใช้ตัดสินใจโดยไม่ยืนยันก่อน
> - Knowledge graph ในเอกสารนี้คือ **ดัชนีช่วยค้น ไม่ใช่ source of truth** — ความจริงอยู่ในไฟล์/ตารางจริงเสมอ

---

## 0. ขอบเขตหลักฐานที่ใช้เขียน (อ่านก่อนเชื่ออะไรในเอกสารนี้)

| เห็น/ไม่เห็น | สิ่งที่ตรวจ | หลักฐาน |
|---|---|---|
| ✅ เห็นของจริง | รีโป `mottosolar-gif-aimanager` ทั้งก้อน (Worker `aim-ingest` · migration 3 ใบ · เอกสาร 10 ฉบับ · bridge config ตัวอย่าง) | `git log -1` = `c4e10e4` 2026-09-05 |
| ✅ วัดได้จริง | Graphify `0.9.55` รันจริงบนสำเนาของรีโปนี้ (โหมด `--code-only` ไม่มี LLM ไม่มีข้อมูลออกเครื่อง) | ภาคผนวก ก |
| ✅ อ่านได้จริง | README ของ Graphify (`Graphify-Labs/graphify` · Apache-2.0 · branch `v8`) | อ่านผ่านเว็บ 2026-09-07 |
| ❌ **ไม่เห็น** | `C:\WebApp\vendor-ksk` (PHP ฝั่ง LIVE) · โค้ด FIM (Node) · ฐาน MySQL `db_customs`/`db_fim` · Windows Scheduled Tasks · MCP ฝั่ง homelab | เครื่องที่เขียนเอกสารนี้ไม่มีทางเข้าถึง · repo `mottosolar-gif/KSK-Decepticons` ตอบ 404 กับ token ที่มี |
| ❌ **ไม่พบ** | คำว่า `goods_tomorrow` | `rg goods_tomorrow` ทั้งรีโป = 0 ผลลัพธ์ ⇒ ทุกอย่างเกี่ยวกับงานนี้เป็น `[รอยืนยัน]` |

⇒ **"แผนผัง FIM ที่ตรวจพบจริง" ในเอกสารนี้จึงครบเฉพาะชั้น ① (คลาวด์)** ส่วนชั้น ③ (cim-server: vendor-ksk · CIM · FIM) ทำได้แค่รวบรวมสิ่งที่เอกสารในรีโปนี้อ้างถึง แล้วทำรายการหลักฐานที่ต้องเก็บเพิ่มให้พี่เต้/ผู้ที่อยู่หน้าเครื่องรันเอง (ภาคผนวก ข — ทุกคำสั่งเป็น read-only)

ข้อสังเกตระหว่างตรวจ (ไม่แก้ในรอบนี้ เพราะนอกขอบเขต): `CLAUDE.md` หัวข้อ "⛔ สองท่าที่ทำแล้วกู้ไม่ได้" ข้อ 1 ยังเขียนว่า "รีโปนี้ไม่มี remote · branch ชื่อ `master`" แต่ของจริงมี `origin` แล้วและ branch คือ `main` (`git remote -v` · D-P0-14 บันทึกการเปลี่ยนไว้แล้ว) — เอกสารสถานะขัดกับดิสก์ ควรแก้ตามกติกา §9 ในรอบถัดไป

---

## 1. ข้อสรุป — ควรทำหรือไม่

**ควรทำ — แต่เป็น "hybrid · pilot เล็ก · read-only · อยู่ในบ้าน" เท่านั้น** ภายใต้ 5 เงื่อนไข:

1. **Graphify ใช้เฉพาะโหมด `--code-only`** (AST ในเครื่อง ไม่มี LLM ไม่มีอะไรออกเครื่อง) — semantic pass ของเอกสาร/รูป **ห้ามใช้ backend นอกบ้าน** (ค่าเริ่มต้นของ `graphify extract` จะเลือก Gemini → Kimi → Claude → OpenAI ตาม API key ที่เจอ · Kimi วิ่งไปเซิร์ฟเวอร์ในจีน — README §Privacy) ถ้าจะใช้กับเอกสารต้อง `--backend ollama` บนเครื่องภายในเท่านั้น และ estate ยังไม่มีเครื่อง Ollama (`docs/WORK_PACKAGES_P2.md:21` "โปรเจกต์เครื่อง Ollama แยกยังรอจัดซื้อ" `[อ้างเอกสาร]`)
2. **ต้องมี extractor เฉพาะ FIM คู่กันตั้งแต่วันแรก** เพราะวัดแล้วว่า Graphify ตอบคำถาม 4 ใน 7 ข้อของโจทย์ไม่ได้เลย (§4.1 · ภาคผนวก ก): ไม่มีเส้นเชื่อม **โค้ด → ตาราง** สักเส้น (786 edge เป็น `contains/calls/imports` ทั้งหมด) · ไม่มี node ระดับ **คอลัมน์** · ไม่รู้จัก **Windows Scheduled Task** · ไม่รู้จัก **MySQL** (มีแต่ live-introspection ของ PostgreSQL) · ไม่รู้จัก "หลักฐานว่างานเดินจริง" (log/`tbl_notify_log`/`LastRunTime`)
3. **กราฟและ vault อยู่บนเครื่องภายใน (cim-server หรือ homelab) เท่านั้น** ห้าม commit `graphify-out/` ที่สร้างจาก vendor-ksk/FIM ขึ้น GitHub (README ของ Graphify แนะนำให้ commit — **ขนบนั้นไม่ใช้กับ estate นี้** เพราะกราฟถือชื่อไฟล์ config · ชื่อตาราง · ชื่อ scheduled task ทั้งหมด)
4. **KG เป็นดัชนี ไม่ใช่ความจริง** — ทุกคำตอบจาก MCP ต้องแนบ `evidence` ที่ชี้ไฟล์:บรรทัด/ตาราง/task-name และ agent ต้องเปิดไฟล์จริงก่อนแก้เสมอ (สอดคล้อง `CLAUDE.md` §9 "ของจริงชนะเสมอ")
5. **ประตูก่อนขยายพ้น pilot:** ผ่านคำถามทดสอบ 10 ข้อตามเกณฑ์ §6 · ไม่มีข้อมูลต้องห้ามหลุดเข้ากราฟ (ตรวจด้วยสคริปต์ที่พิสูจน์แล้วว่าตกได้) · ภาระดูแลต่ำกว่า 1 คำสั่งต่อ commit

**ไม่ควรทำ (ปฏิเสธชัด ๆ):**
- ❌ รัน `/graphify .` ทับทั้ง `C:\WebApp` ตรง ๆ ในโหมดเริ่มต้น — จะอ่าน `config/*.credentials.php` (Graphify parse `.php` ทุกไฟล์) และส่ง `.md` ทุกฉบับไปโมเดลนอกบ้าน
- ❌ ใช้ Graphify Enterprise / `app.graphify.com` (always-on บนคลาวด์ของเขา) — ขัด `IMPLEMENTATION_PLAN.md` §5 ข้อ 3 "ตรรกะธุรกิจห้ามอยู่ใน SaaS" และ §3 "ข้อมูลศุลกากรห้ามออกจากเครื่อง"
- ❌ ให้ MCP ตัวใหม่มีสิทธิ์เขียน CIM/FIM ทุกรูปแบบ — write ingress ที่เสนอใน §5.3 เขียนได้แค่ "กล่องรับเรื่อง" ของตัวเอง
- ❌ ให้ agent เชื่อกราฟแล้วแก้ไฟล์โดยไม่เปิดไฟล์จริง (Graphify มี `--strict` ที่ **บล็อก** การอ่านไฟล์ครั้งแรก — **ห้ามเปิดโหมดนี้** ใน estate นี้)

**ทำไมถึงคุ้มแม้ต้องเขียน extractor เอง:** โจทย์ 7 ข้อของพี่เต้ ส่วนที่มีมูลค่าสูงสุด (lineage · impact · งานเงียบ · report กำพร้า · job ไร้ watchdog) **ล้วนเป็นความสัมพันธ์ที่ Graphify ไม่สกัดอยู่แล้ว** — ส่วนที่ Graphify ให้ฟรี (call graph · import · community) มีค่ากับข้อ 7 (ช่วย Claude ค้นก่อนอ่าน) และได้มาในราคา 0 token · 1.4 วินาที · 74 MB RAM (วัดจริง) จึงเอาส่วนฟรีมาใช้ แล้วลงแรงกับส่วนที่ไม่มีใครทำให้

---

## 2. แผนผัง FIM/estate ที่ตรวจพบจริง

### 2.1 ภาพรวม 4 ชั้น (ตาม `docs/IMPLEMENTATION_PLAN.md` §2 `[อ้างเอกสาร]` · ตรวจโค้ดจริงได้เฉพาะชั้น ①)

```
LINE OA (webhook URL เดียว → fimandksk122.com/vendor/api/line_webhook.php)      [อ้างเอกสาร WP-P0 :10]
   │ fan-out สำเนา event (lib/aim_forward.php · 1500 ms · try/catch)             [อ้างเอกสาร bridge/README]
   ▼
① Cloudflare Worker `aim-ingest` + D1 `aim-db`                                    [VERIFIED worker/src/*]
   ├─ POST /ingest/line  (X-AIM-Key)         → inbox_event + job_queue
   ├─ POST /sync/tasks   (X-AIM-Sync-Key)    ← bin/aim_task_sync.php ทุก 10 นาที (สำเนา tbl_task ทางเดียว)
   ├─ POST /ask          (X-AIM-Ask-Key)     ← lib/aim_ask.php (2 บัญชี)
   ├─ POST /link         (X-AIM-Link-Key)    ← vendor-ksk บอกว่า LINE id ไหน = person_code ไหน
   ├─ POST /admin/summary(X-AIM-Admin-Key)   → ยิงสรุปเช้า/เย็นทันที หรือ preview
   ├─ GET  /healthz                          → queueDepth · deadJobs · strandedEvents (selfcheck อ่าน)
   └─ cron */1 * * * *  → processScheduledSummaries() → processQueue() → ledger
        │ callback: POST AIM_NOTIFY_URL (X-AIM-Notify-Key + X-AIM-Idempotency-Key)
        ▼
③ cim-server  `C:\WebApp\vendor-ksk` (PHP 8.1.9 · MySQL db_customs)              [อ้างเอกสาร — ไม่เห็นของจริง]
   ├─ api/aim_notify.php → lib/aim_notify.php → ll_line_push_to() → LINE
   ├─ ปุ่มการ์ด → ll_task_postback() เขียน tbl_task (ความจริงของงาน · D-P0-18)
   ├─ lib/notify.php + nt_registry() + tbl_notify_log + lib/holiday.php (ด่านวันหยุด)
   ├─ Scheduled Tasks ksk-* (~30) · bin/selfcheck.php เฝ้า schtasks + nt_registry + /healthz
   └─ FIM (Node · db_fim · scripts\deploy.ps1) = คลัง/ศุลกากร                      [รอยืนยัน ทุกอย่างข้างใน]
② homelab "เต้น้อย" — Worker mottosolar-line-relay (Durable Object) · MCP read-only `ksk_get_answer(ref)`
   · Tailscale 100.79.23.116 ↔ 100.97.46.101 · heartbeat tbl_bridge_event                [อ้างเอกสาร]
④ GitHub `mottosolar-gif/mottosolar-gif-aimanager` (private · main · CI test-only · deploy = workflow_dispatch) [VERIFIED]
```

### 2.2 ชั้น ① — ของจริงที่ตรวจได้ครบ `[VERIFIED]`

**ระบบย่อย / โมดูล** (`worker/src/`, บรรทัดรวม 2,840)

| โมดูล | หน้าที่ | จุดตัดสินเดียว (single decision point) |
|---|---|---|
| `index.ts` (584) | router 6 endpoint + `scheduled()` | กุญแจแยกดวงต่อ endpoint · `constantTimeEqual` · ไม่ตั้ง secret = 503 · ผิด = 403 |
| `payload.ts` (147) | `extractMetadata()` ปอก PII ออกก่อนลง D1 | **ด่านความเป็นส่วนตัวด่านเดียว** (`CLAUDE.md` §2 ข้อ 2) |
| `queue.ts` (109) | `processQueue()` — postback `act=aim_*` → สถานะ · backoff 30×2^(n-1) · 5 ครั้ง → `dead` | |
| `taskMachine.ts` (112) | `applyTransition()` 10 สถานะ · optimistic concurrency · `L-*` อ่านอย่างเดียว (`:80-88`) | **ownership ของการเปลี่ยนสถานะ** |
| `visibility.ts` (94) | `canView()` | **สิทธิ์การมองเห็นจุดเดียว** (`CLAUDE.md` §2 ข้อ 3) |
| `queryEngine.ts` (1,139) | 20 intent ภาษาไทย "น้องกุ้ง" · rule-based ไม่มี LLM | ทุกตัวเลขมาจาก SQL ผ่าน `canView()` |
| `summary.ts` (475) | สรุปเช้า/เย็น · catch-up ≤ 4 รอบ · terminal `sent/empty/missed/skipped_holiday` | |
| `outbound.ts` (103) | `sendTextNotification()` → `AIM_NOTIFY_URL` · timeout · แยก 4xx ถาวร/5xx ชั่วคราว (408/429 = ชั่วคราว) | |
| `db/repository.ts` · `db/queries.ts` | SQL ทั้งหมด (D1) | |
| `crypto.ts` (34) | `hashSourceId()` sha256(salt+id) · `constantTimeEqual()` | |

**ตาราง D1 (9 ตาราง · 3 migration)** — `schema/migrations/0001_initial.sql` · `0002_task.sql` · `0003_postback.sql`

| ตาราง | คอลัมน์สำคัญ / ข้อจำกัดที่กราฟต้องจำ | ใครเขียน (จากโค้ด) |
|---|---|---|
| `inbox_event` | `event_id` UNIQUE · `source_hash` len=64 · **`body_ref CHECK (IS NULL)`** · `postback_data` ≤256 + `NOT GLOB '*[^A-Za-z0-9=&_-]*'` (0003) | `enqueueEvents()` |
| `job_queue` | `idem_key` UNIQUE · FK→inbox_event | `enqueueEvents()` · `claimPendingJob/retryJob/killJob/completeJob` |
| `person` | `person_code` UNIQUE · `department` · `role` — **ไม่มีชื่อจริง** | `linkPerson()` |
| `person_link` | `source_hash` UNIQUE len=64 · FK→person | `linkPerson()` (ผ่าน `/link` เท่านั้น — D-P0-14 หนี้ข้อ 1 ปิดแล้วโดย WP-P2-C1) |
| `ledger` | `action_type` · `outcome` · `reference_id` · `actor_code` FK→person | `recordCronTick` · `recordSummary*` · `processQueue` |
| `sync_state` | checkpoint ต่อแหล่ง | |
| `task` | `task_ref` UNIQUE (`L-*` = สำเนาจาก LIVE · `T-DEMO-001` ใส่มือ) · `status` CHECK 10 ค่า · `priority` CHECK 4 ค่า · FK assignee/creator→person | `upsertMirroredTasks()` (จาก `/sync/tasks` · ≤500 แถว/ครั้ง) · `applyTaskTransition()` (เฉพาะไม่ใช่ `L-*`) |
| `task_event` | `source` CHECK `line/web/ai/system` · FK→task | `applyTaskTransition()` |
| `outbound_queue` | `idem_key` UNIQUE · FK→task | (ว่างมาตลอด — D-P0-18) |

**"ตาราง" ที่ไม่มี DDL แต่มีอยู่ในความหมาย** — `ledger.action_type` เป็นทะเบียนงานตามเวลาของคลาวด์: `cron_tick` · `scheduled_summary` (outcome terminal 4 ค่า) · `scheduled_summary_pass` · `scheduled_summary_error` · `scheduled_summary_catchup` (`db/repository.ts:23,205,360-400,567`) — **กราฟต้องมี node ชนิด `LedgerActionType` เพราะนี่คือหลักฐานว่างานเดินจริง**

**งานตามเวลา (คลาวด์):** cron 1 ตัว `*/1 * * * *` (`wrangler.toml.example`) → `handleScheduled()` (`index.ts:553-570`) — ไม่มี cron อื่น

**ช่องทางแจ้งเตือน (คลาวด์เป็นผู้สั่ง ไม่ได้ส่งเอง):** ทางเดียวคือ `POST AIM_NOTIFY_URL` (`outbound.ts:28-45`) → ฝั่ง LIVE ส่ง LINE · คลาวด์ **ไม่ถือ token LINE**

**ยาม/watchdog ของชั้น ①:** `GET /healthz` (`index.ts:37-60` — รูปร่าง JSON คงที่ · `null` ≠ `0` โดยตั้งใจ) · ถูก `bin/selfcheck.php` อ่านผ่าน `$sites` (`[อ้างเอกสาร]` D-P0-14) · `scripts/dump-daily.ps1` = task `ksk-aim-dump` (`[VERIFIED]` ไฟล์ · `[รอยืนยัน]` ว่าลงทะเบียน schtasks จริง) · `.github/workflows/deploy.yml` job `test` (typecheck · test · lint · migration check) `[VERIFIED]`

**ความลับ (ชื่อเท่านั้น — ค่าไม่อยู่ในรีโป · ห้ามเข้ากราฟเป็นค่า):** `AIM_INGEST_KEY` · `AIM_ASK_KEY` · `AIM_LINK_KEY` · `AIM_SYNC_KEY` · `AIM_ADMIN_KEY` · `AIM_NOTIFY_KEY` · `AIM_NOTIFY_URL` · `AIM_SOURCE_HASH_SALT` (`types.ts:1-13`) · ฝั่ง LIVE `ingest_key` · `notify_key` · `CLOUDFLARE_D1_TOKEN` ใน `.dev.vars` (`dump-daily.ps1:30-36`)

**บทบาท/สิทธิ์:** `role ∈ {worker, manager, owner}` (`index.ts:393`) · กฎอยู่ที่ `canView()` เท่านั้น · ฝั่ง `/ask` เปิดให้ 2 บัญชี (`[อ้างเอกสาร]` D-P0-14 B1)

### 2.3 ชั้น ③ — cim-server / vendor-ksk / CIM `[อ้างเอกสาร]` — ทุกบรรทัดต้องยืนยันด้วยตาบนเครื่องจริงก่อนใช้

**โค้ด PHP ที่เอกสารในรีโปนี้เอ่ยถึง**

| ไฟล์ | หน้าที่ตามเอกสาร | อ้างจาก |
|---|---|---|
| `api/line_webhook.php` (2,443 บรรทัด · 54 ฟังก์ชัน) | webhook LINE ทั้งหมด · `ll_handle_text()` · `ll_parse_message()` (Gemini) · `ll_task_assign()` · **มี hunk ยังไม่ commit** | `ARCHITECTURE.md` §0-1 · D-P0-14 หนี้ข้อ 2 |
| `lib/aim_forward.php` | fan-out event → คลาวด์ (2 เส้นทาง · ส่ง event ดิบทั้งก้อน) | `CLAUDE.md` §2 ข้อ 2 · `bridge/README.md` |
| `lib/aim_notify.php` · `api/aim_notify.php` | รับคำสั่งจากคลาวด์ → การ์ด/ข้อความ LINE · `ll_task_postback()` | D-P0-10 · `taskMachine.ts:83` |
| `lib/aim_ask.php` | ดักคำถาม 2 บัญชี → `/ask` | D-P0-14 |
| `lib/notify.php` · `nt_registry()` | ศูนย์กลางแจ้งเตือนที่เดียว → LINE/อีเมล | `ARCHITECTURE.md` §1 · `CLAUDE.md` §8 |
| `lib/holiday.php` → `tbl_holiday` | ด่านปฏิทิน (ตอบ 412 ให้คลาวด์จด `skipped_holiday`) | D-P0-16 §2 |
| `lib/work_items.php` · `tasks.php` (778) · `lib/escalation.php` · `next_action.php` · `staff_session.php` · `leave.php` · `lib/app_setting.php` | งาน/หน้าเว็บ/สิทธิ์/ตั้งค่า | `ARCHITECTURE.md` · `CLAUDE.md` §2 ข้อ 3 |
| `bin/aim_task_sync.php` · `bin/aim_reconcile.php` (`--streak`) · `bin/selfcheck.php` · `bin/check_send_channels.php` · `bin/task_escalate.php` · `bin/aim_summary_to_group.php` · `bin/ksk_send_daily.php` · `bin/tunnel_watchdog.ps1` | งานตามเวลา / ยาม | `QUEUE.md` · `WORK_PACKAGES_P4/P5.md` · `CLAUDE.md` §8 |
| `bin/smoke_*.php` | ยามถาวร: `smoke_escalation` 32 · `smoke_tasks_render` 36 · `smoke_aim_ask` 41 · `smoke_aim_notify` 27 · `smoke_line_register` 20 · `smoke_aim_forward` 16 · `smoke_tool_loan*` | `QUEUE.md:36-37` · `CLAUDE.md` §7 |
| `config/*.credentials.php` · `config/aim_person_map.php` | ความลับ + แมป person_code ↔ LINE id | **ห้ามเข้ากราฟทั้งไฟล์** |

**ตาราง MySQL `db_customs` ที่เอกสารเอ่ยถึง:** `tbl_user` · `tbl_line_user` (active 11) · `tbl_task` (ENUM 6 สถานะ · `Remind_Time/Last_Remind/Last_Nudge/Nudge_Count`) · `tbl_task_log` · `tbl_task_photo` (`Path`,`Created_At` — WP-P4-A จะเพิ่ม hash) · `tbl_site_activity` + `_log` · `tbl_project` · `tbl_holiday` · `tbl_notify_log` (`Code`,`Result`) · `tbl_bridge_event` · `tbl_bridge_read` (เก็บ 7 วัน) · `tbl_ai_usage` · `tbl_line_state` · `tbl_arrival_check` (034 — "ถามของเข้า" · "ห้ามสร้างยอดคู่ขนานกับ FIM") · `tbl_tool` · `tbl_tool_loan` · `022_next_action_audit` · `029_site_activity.sql`
⇒ ทั้งหมด `[รอยืนยัน]` **ชื่อคอลัมน์จริง** ด้วย `SHOW CREATE TABLE` (ภาคผนวก ข)

**Scheduled Tasks (Windows · ขึ้นต้น `ksk-*` ~30 งาน):** ที่เอกสารระบุชื่อ — `ksk-task-remind` · `ksk-followup-remind` · `ksk-site-task-scan` · `ksk-s5-remind-15min` · `ksk-aim-task-sync` (ทุก 10 นาที) · `ksk-aim-reconcile` (23:30) · `ksk-aim-dump` ⇒ อีก ~23 งาน `[รอยืนยัน]` ด้วย `schtasks /query /xml`

**ช่องทางแจ้งเตือน:** LINE reply (ไม่นับโควตา) · LINE push (`ll_line_push_to()` · โควตา 15,000/เดือน ใช้ ~36.8/วัน `[อ้างเอกสาร]` WP-P4) · อีเมล (ผ่าน `lib/notify.php`) · ทะเบียน `nt_registry()` · log `tbl_notify_log`
⚠ **ช่องที่ไม่ผ่านทะเบียน (ไม่มี holiday gate · ไม่มีสวิตช์ปิด):** `lib/aim_notify.php` ยิง `ll_line_push_to()` ตรง (`CLAUDE.md` §8) — นี่คือตัวอย่างจริงของ "notification ที่ไม่มี watchdog" ที่โจทย์ข้อ 5 ต้องการหา

**FIM (Node · `db_fim` · deploy ผ่าน `scripts\deploy.ps1` เท่านั้น · "คลัง/ศุลกากร"):** `[อ้างเอกสาร]` `ARCHITECTURE.md:127` · `DATABASE_SCHEMA.md:5,158` — **ไม่มีข้อมูลอื่นใดในรีโปนี้** ⇒ `[รอยืนยัน]` ทั้งหมด: โครงโฟลเดอร์ · จำนวนไฟล์ · ORM/ตัวต่อ MySQL · ตารางใน `db_fim` · งานตามเวลา (รวม `goods_tomorrow`) · report ที่ผลิต · ช่องแจ้งเตือน · watchdog

**`goods_tomorrow`:** ไม่พบในรีโปนี้ · `[INFERRED]` จากชื่อ = งานรายวันที่ดู "ของที่จะเข้าพรุ่งนี้" อาจสัมพันธ์กับ `tbl_arrival_check` (034 "ถามของเข้า") — **ห้ามยึดข้อนี้เป็นความจริง** · หลักฐานที่ต้องใช้: (1) `schtasks /query /tn <ชื่อ> /xml` (2) path สคริปต์ที่ task เรียก (3) ตาราง/ไฟล์/log ที่มันเขียนทุกครั้งที่รัน (4) `Code` ใน `tbl_notify_log` ถ้าแจ้งเตือน (5) ใครอ่านผลของมัน

### 2.4 การไหลของข้อมูลจริง (lineage ที่ยืนยันได้จากชั้น ① + สัญญากับชั้น ③)

```
tbl_task (LIVE · ความจริง) ──bin/aim_task_sync.php ทุก 10 นาที──▶ POST /sync/tasks ──upsertMirroredTasks()──▶ task (L-*)
                                                                                                             │
   ┌── queryEngine.ts (20 intent · canView) ◀────────────────────────────────────────────────────────────────┘
   │        ▲                                   ▲
   │   POST /ask ◀── lib/aim_ask.php        summary.ts (cron) ── buildSummary() ──▶ sendTextNotification() ──▶ api/aim_notify.php ──▶ LINE
   │                                                                     │
   └── ledger: scheduled_summary{sent|empty|missed|skipped_holiday} ◀────┘   ◀── หลักฐานเดียวว่า "สรุปส่งจริง" (คลาวด์)
LINE ปุ่ม act=aim_* ──lib/aim_forward.php──▶ POST /ingest/line ──▶ inbox_event(postback_data) ──▶ job_queue ──cron──▶ applyTransition (ไม่ใช่ L-*)
                                                                                                 └▶ ledger.cron_tick (หลักฐานว่านาฬิกาเดิน)
เทียบทุกคืน: bin/aim_reconcile.php (ksk-aim-reconcile 23:30) ──▶ tbl_notify_log Code='aim_reconcile' Result ──▶ --streak (ประตู P4 = 7 วันติด)
```

---

## 3. ตาราง use case × แหล่งข้อมูล × ประโยชน์ × ความเสี่ยง

| # | Use case | แหล่งข้อมูลที่ต้องเข้ากราฟ | Graphify ให้ได้? | ประโยชน์ที่วัดได้ | ความเสี่ยง / สิ่งที่ห้าม |
|---|---|---|---|---|---|
| 1 | Data lineage ต้นทาง → รายงาน | DDL (`SHOW CREATE TABLE` แบบปอกค่า) · SQL ในโค้ด PHP/TS/Node (`reads/writes` ต่อตาราง+คอลัมน์) · สคริปต์ที่ผลิตรายงาน · ช่องส่ง | ❌ ไม่มี edge โค้ด→ตาราง (วัดแล้ว) | ตอบ "ตัวเลขนี้มาจากคอลัมน์ไหน ผ่านสคริปต์อะไร" ในไม่กี่วินาที แทนไล่ grep ข้ามภาษา | SQL แบบต่อสตริง/ชื่อตารางแบบไดนามิกจะหลุด ⇒ ทุก edge ต้องมี `provenance` · **ห้ามเก็บค่าในแถว** เก็บแค่ schema |
| 2 | Impact ก่อนแก้ table/field/module | เหมือน 1 + `imports/calls` (Graphify) + smoke test ที่ครอบไฟล์นั้น | ⚠ ได้ครึ่ง (โค้ด→โค้ด) | ลิสต์ "ไฟล์ · task · report · เทส" ที่แตะคอลัมน์ ก่อนเขียน migration — ปิดบั๊กแบบ D-P0-18 (`applyTransition` เขียนสำเนาแล้วถูก sync ทับ) ที่เอกสารรู้แต่โค้ดไม่รู้ | กราฟเก่ากว่าโค้ด ⇒ ทุกคำตอบต้องบอก `graph_built_at` + `git rev` · ถ้าไฟล์เปลี่ยนหลังสร้างกราฟต้องติดธง `stale` |
| 3 | ตรวจงานรายวันที่เงียบ (เช่น `goods_tomorrow`) | ทะเบียน job (schtasks XML + cron) · **หลักฐานการเดิน**: `tbl_notify_log` · `ledger` · log file mtime · `LastRunTime/LastTaskResult` | ❌ ไม่รู้จัก schtasks/log | เปลี่ยน "เงียบ = ปกติ" เป็น "เงียบ = ไม่มีหลักฐาน" — ปัญหาที่ `CLAUDE.md` §8 บันทึกว่ากำลังเกิดกับ `aim_forward` | อ่าน log/ตารางต้องเป็น read-only account · ห้ามตอบ "ไม่พบงานเงียบ" ถ้าอ่านหลักฐานไม่ได้ (§5.1 ข้อ "empty ≠ ok") |
| 4 | Report ไม่มี producer/consumer | ทะเบียน report (ไฟล์ output · หน้าเว็บ · ข้อความสรุป) · edges `produces` / `consumes` | ❌ | ลิสต์รายงานกำพร้า = ของที่ลบได้ หรือของที่ "คนอ่านแต่ไม่มีใครผลิตแล้ว" (บั๊กเงียบ) | consumer ที่เป็น "คนเปิดดู" ไม่มีในโค้ด ⇒ ต้องมี edge `MANUAL` ที่พี่เต้ยืนยัน · ห้ามลบอะไรจากกราฟอย่างเดียว |
| 5 | Job/notification ไม่มี watchdog | ทะเบียน job · `nt_registry()` · รายการที่ `selfcheck.php`/`check_send_channels.php` เฝ้า | ❌ | หาช่องแบบ `lib/aim_notify.php` (ยิงตรง ไม่ผ่านทะเบียน) ได้เป็นระบบ ไม่ใช่เจอโดยบังเอิญ | ผลบวกปลอมถ้าอ่านทะเบียนยามไม่ครบ ⇒ ต้องรายงาน `watchdog_sources_read` ทุกครั้ง |
| 6 | วิเคราะห์ incident · ค้นเหตุผลการตัดสินใจเดิม | `DECISIONS_P0.md` (D-P0-01..31) · คอมเมนต์ `★ YYYY-MM-DD` ในโค้ด · `# WHY:`/`# NOTE:` | ⚠ Graphify ทำ `# NOTE:/# WHY:` เป็น node ได้ (README) · ไม่รู้จักรูปแบบ `★ 2026-08-28 (D-P0-18)` และคอมเมนต์ไทย · ต้องใช้ LLM กับ `.md` | เชื่อม "โค้ดบรรทัดนี้" ↔ "คำตัดสินใบนี้" — กัน "ถามซ้ำเรื่องที่ปิดแล้ว" ที่ D-P0-17/19 บันทึกว่าเกิดซ้ำ | เอกสารมีชื่อเล่น/ตัวเลขจริง ⇒ semantic pass ต้องรันในบ้านเท่านั้น หรือใช้ regex extractor เฉพาะ (`D-P0-\d+` · `★ 20\d\d-\d\d-\d\d`) ซึ่งไม่ต้องใช้ LLM เลย |
| 7 | ช่วย Claude ค้นส่วนเกี่ยวข้องก่อนอ่าน/แก้ไฟล์จริง | call graph · imports · community (Graphify) + edges จากข้อ 1–6 | ✅ ตรงจุดแข็ง | ลด token ที่ใช้ "อ่านไฟล์เพื่อหาว่าอะไรอยู่ไหน" — ตัวอย่างจริง: `graphify explain canView` คืน caller ครบใน 5 บรรทัด | agent ต้องไม่หยุดที่กราฟ — ต้องเปิดไฟล์จริงก่อนแก้ทุกครั้ง (กติกาข้อ 4 ใน §1) |

---

## 4. แบบ knowledge graph

### 4.1 หลักการ 4 ข้อ

1. **ดัชนี ไม่ใช่ความจริง** — ทุก node/edge มี `evidence[]` ที่ชี้กลับได้ (`file:line` · `table.column` · `schtasks:<name>` · `doc:D-P0-18`) · node ที่ไม่มี evidence ห้ามมี
2. **แยก provenance 4 ระดับ ห้ามปน** (ขยายจาก `EXTRACTED/INFERRED/AMBIGUOUS` ของ Graphify):

   | ระดับ | ที่มา | ตัวอย่าง |
   |---|---|---|
   | `EXTRACTED` | AST / DDL / XML ตรง ๆ ไม่มีการเดา | `handleSyncTasks() calls upsertMirroredTasks()` (`index.ts:226`) |
   | `DERIVED` | กติกา deterministic ที่เขียนไว้เป็นโค้ด (regex/parser) ตรวจซ้ำได้ | `upsertMirroredTasks() writes task` จาก SQL ใน template string |
   | `INFERRED` | LLM / heuristic / ชื่อพ้อง | `goods_tomorrow relates_to tbl_arrival_check` |
   | `MANUAL` | คนยืนยัน พร้อมชื่อผู้ยืนยัน + วันที่ | `report X consumed_by พี่เต้ (เปิดดูทุกเช้า)` |

   คำตอบ MCP ต้องนับแยก (`edges: {extracted: n, derived: n, inferred: n, manual: n}`) และ **ค่าเริ่มต้นตัด `INFERRED` ออก** ต้องขอเอง
3. **ไม่มีค่าข้อมูล (data values) ในกราฟ** — มีแค่ schema/โครง/ชื่อ · ยกเว้น "หลักฐานการเดิน" ที่เป็นเวลา/สถานะ (`last_seen_at` · `last_result`) ซึ่งไม่ใช่ข้อมูลธุรกิจ
4. **จัดเก็บด้วย SQL มาตรฐาน** (กติกา `IMPLEMENTATION_PLAN.md` §5 ข้อ 1) — ตัวจริงคือ `fim-graph.sqlite` (ตาราง `node` · `edge` · `evidence` · `build`) · `graph.json` (รูปแบบ Graphify/networkx node-link) และ Obsidian vault เป็น **export** ที่สร้างใหม่ได้เสมอ ไม่ใช่ที่เก็บหลัก

### 4.2 ชนิด node (13 ชนิด)

| ชนิด | คีย์ (id) | คุณสมบัติที่ต้องมี | ตัวอย่างจากของจริง |
|---|---|---|---|
| `System` | ชื่อระบบ | layer (①–④) · host · owner | `aim-ingest` · `vendor-ksk` · `FIM` · `homelab` |
| `Module` | path ไฟล์ | lang · lines · git_rev · sha256 | `worker/src/visibility.ts` · `lib/notify.php` |
| `Function` | path#name | line · exported · is_decision_point | `visibility.ts#canView` (decision_point=true) |
| `Endpoint` | method+path | auth_header · secret_name · status_codes | `POST /sync/tasks` · X-AIM-Sync-Key · 200/400/403/413/503 |
| `Table` | db.table | engine · row_count_at_build(optional) | `aim-db.task` · `db_customs.tbl_task` |
| `Column` | db.table.column | type · nullable · check/enum · fk | `aim-db.inbox_event.body_ref` (CHECK IS NULL) |
| `Job` | scheduler:name | schedule · runner · script · enabled · last_run_evidence_source | `cf-cron:aim-ingest */1` · `schtasks:ksk-aim-task-sync` |
| `Report` | ชื่อ/route | format · audience_role · schedule | `สรุปเช้า/เย็น` · `tasks.php` |
| `NotifyChannel` | ช่อง+code | channel (line_push/line_reply/email/http_callback) · registry (`nt_registry`/none) · holiday_gate | `line_push:aim_notify (registry=none)` |
| `Watchdog` | ชื่อยาม | what_it_watches[] · how (smoke/selfcheck/healthz/streak) | `bin/selfcheck.php` · `GET /healthz` · `smoke_aim_ask (41)` |
| `Role` | ชื่อ | where_enforced | `owner/manager/worker` → `canView()` |
| `SecretRef` | ชื่อตัวแปร **เท่านั้น** | where_read · where_set (ไม่มีค่า · ไม่มี path ของไฟล์ค่า) | `AIM_SYNC_KEY` · `notify_key` |
| `Decision` | `D-P0-18` | date · title · supersedes | `D-P0-18 tbl_task คือความจริง` |
| `Evidence` | hash | kind (ast/ddl/schtasks/log/manual) · locator · observed_at · git_rev | `index.ts:226@c4e10e4` |

### 4.3 ชนิด edge (15 ชนิด · ทุกเส้นมี `provenance` + `evidence_id`)

| edge | จาก → ไป | ที่มาหลัก |
|---|---|---|
| `contains` | Module→Function · System→Module | Graphify EXTRACTED |
| `calls` · `imports` | Function→Function · Module→Module | Graphify EXTRACTED |
| `reads` · `writes` | Function→Table/Column | **extractor FIM** (SQL ในสตริง · DDL) DERIVED |
| `fk_to` | Column→Column | DDL EXTRACTED |
| `mirrors` | Table→Table (สำเนาทางเดียว) | MANUAL/DERIVED — `aim-db.task mirrors db_customs.tbl_task` (D-P0-18) |
| `runs` | Job→Module/Function | schtasks XML · cron config · DERIVED |
| `leaves_evidence_in` | Job→Table/Column/File | **หัวใจของ use case 3** — `Job(aim-reconcile) leaves_evidence_in tbl_notify_log.Code='aim_reconcile'` |
| `emits` | Function→NotifyChannel | DERIVED (เรียก `ll_line_push_to`/`notify()`/`fetch(AIM_NOTIFY_URL)`) |
| `registered_in` | NotifyChannel/Job→Watchdog | DERIVED จาก `nt_registry()` · `$sites` · schtasks enumeration |
| `produces` · `consumes` | Function/Job→Report · Report→Role/Function | DERIVED + MANUAL |
| `exposes` | Endpoint→Function | EXTRACTED |
| `guarded_by` | Endpoint/Function→SecretRef/Function(decision point) | DERIVED — `POST /ask guarded_by AIM_ASK_KEY` · `queryEngine guarded_by canView` |
| `decided_by` | any→Decision | regex `D-P0-\d+` ในคอมเมนต์/เอกสาร DERIVED |
| `tested_by` | Module/Function→Watchdog(smoke/vitest) | DERIVED (import ในไฟล์เทส) |

**คำถาม 5 ข้อของโจทย์กลายเป็น query ตรง ๆ:**
- silent job = `Job` ที่ **ไม่มี** `leaves_evidence_in` **หรือ** evidence.last_seen เกิน `schedule × 2`
- report กำพร้า = `Report` ที่ in-degree `produces` = 0 หรือ out-degree `consumes` = 0
- ไร้ watchdog = `Job`/`NotifyChannel` ที่ไม่มี `registered_in`
- impact(column) = BFS ย้อน `reads/writes` → `Function` → `Job/Endpoint/Report` + `tested_by`
- lineage(report) = BFS ย้อน `produces` → `reads` → `Column` → `writes` → ต้นทาง

### 4.4 Obsidian vault — ใช้เป็น "หน้าต่างอ่าน" ไม่ใช่ที่เก็บ

วัดจริง: `graphify export obsidian` จากรีโปนี้ = 428 โน้ต · 1.9 MB · frontmatter มี `source_file` · `location` · tag `graphify/EXTRACTED` (ภาคผนวก ก) — ใช้ต่อได้ทันที แต่เสนอปรับ 3 จุดใน extractor ของเรา:
1. โน้ตต่อ node เพิ่ม `provenance` และ `evidence` เป็น callout ที่คลิกเปิดไฟล์จริงได้ (`file:///C:/WebApp/...#L226`)
2. โน้ต `Decision/D-P0-*.md` สร้างจาก `DECISIONS_P0.md` ด้วย regex ไม่ใช้ LLM
3. vault อยู่ที่ `C:\WebApp\fim-kg\vault\` (หรือ homelab) · **ไม่อยู่ในรีโปใด** · โน้ตที่คนเขียนเพิ่มเอง (`MANUAL`) แยกโฟลเดอร์ `manual/` เพื่อไม่ถูกทับตอน export ใหม่ (Graphify `--obsidian-dir` สัญญาว่าไม่ทับโน้ตของผู้ใช้ — ต้องพิสูจน์ก่อนเชื่อ)

---

## 5. เปรียบเทียบทางเลือก + แบบ MCP

### 5.1 เปรียบเทียบ 3 ทาง

ตัวเลขที่ระบุ "วัด" มาจากภาคผนวก ก (รีโปนี้ 35 ไฟล์โค้ด) · ตัวเลข "ประมาณ" เป็นการคาดคะเนของผู้เขียน ต้องวัดจริงใน pilot

| เกณฑ์ | A. Graphify ตรง ๆ | B. Extractor เฉพาะ FIM | C. **Hybrid (เสนอ)** |
|---|---|---|---|
| ครอบโจทย์ 7 ข้อ | ข้อ 7 ✅ · ข้อ 2/6 ครึ่ง · ข้อ 1/3/4/5 ❌ | ข้อ 1–6 ✅ · ข้อ 7 ต้องเขียน call graph เอง (แพง) | ครบ 7 — Graphify ทำ 7 + โครงโค้ด · extractor ทำ 1–6 |
| ภาษา/ไฟล์ | `.php .ts .js .sql .ps1 .json .md` ✅ (37 grammar) · **schtasks XML ❌ · MySQL live ❌ · log ❌** | ทำเฉพาะที่ต้องการ | เติมเฉพาะช่องว่าง |
| RAM | **วัด 74 MB** (35 ไฟล์) · ประมาณ < 1 GB ที่ 3,000 ไฟล์ (Graphify ตั้งเพดาน graph.json 512 MiB) | ประมาณ < 100 MB (PHP CLI + SQLite) | รวม ≈ A + B · รันคนละเวลาได้ |
| Disk | **วัด 508 KB** graph.json 402 KB · vault 1.9 MB (428 โน้ต) · ประมาณ ×50–100 สำหรับ vendor-ksk+FIM (ยังไม่รู้จำนวนไฟล์ `[รอยืนยัน]`) | `fim-graph.sqlite` ประมาณ < 50 MB | ประมาณ < 200 MB รวม vault |
| Token | **วัด 0** (code-only) · ถ้าเปิด semantic pass บนเอกสารรีโปนี้ (280 KB ไทย) ประมาณ 60–120k token/รอบเต็ม · `--update` ลดเหลือไฟล์ที่เปลี่ยน | 0 (regex/parser) · ยกเว้นขั้น `INFERRED` ที่เลือกเปิด | 0 ใน pilot · เปิด LLM ได้เฉพาะ Ollama ในบ้าน |
| เวลาสร้าง | **วัด 1.4 s** · ประมาณ < 1 นาทีทั้ง estate | ประมาณ < 1 นาที (แต่ต้องต่อ MySQL read-only) | < 2 นาที · ต่อ git post-commit hook ได้ |
| ภาระดูแล | ต่ำ — upgrade `uv tool upgrade graphifyy` · แต่ **upstream เปลี่ยนเร็ว** (branch `v8` · 989 issue เปิด · มี Enterprise/SaaS ผลักดัน) | สูงกว่า — โค้ดของเราเอง ต้องมีเทส "ยามที่ตกได้" ตามกติกาบ้าน | กลาง — 1 คำสั่ง `fim-kg build` ห่อทั้งสอง |
| ความเสี่ยงหลัก | (1) ค่าเริ่มต้นส่ง `.md`/รูปไป LLM นอกบ้าน (2) parse `config/*.php` ที่มีความลับถ้าไม่มี `.graphifyignore` (3) `--strict` บล็อกการอ่านไฟล์จริง (4) query log `~/.cache/graphify-queries.log` (README §Privacy บอกว่าเปิด · ตาราง env บอกว่าปิดโดยปริยาย — **ขัดกันเอง ต้องทดสอบ**) (5) lock-in กับรูปแบบ `graph.json` ของเขา | (1) เขียนเองพลาดแบบ regex ไม่ครอบ (บทเรียน ULID D-P0-08) (2) ไม่มี community/visual ฟรี | ความเสี่ยงของ A ถูกปิดด้วย `--code-only` + `.graphifyignore` + ห้าม `--strict` · ความเสี่ยงของ B ถูกลดด้วยการทำเฉพาะ edge ที่ Graphify ไม่ทำ |
| ย้ายบ้านได้ (กติกา §5) | `graph.json` = networkx node-link (เปิดได้ทุกที่) ✅ · แต่ semantic ของ id/relation เป็นของเขา | SQLite + schema ของเรา ✅ | ✅ ความจริงอยู่ใน SQLite ของเรา · graph.json เป็น export |
| **ตัดสิน** | ❌ ไม่พอ | ⚠ พอแต่แพงส่วนที่ได้ฟรีอยู่แล้ว | ✅ |

**หลักฐานที่ทำให้ A ตก (วัดจริง · ภาคผนวก ก):** `graphify path "handleSyncTasks" "task"` → *No directed path found* ทั้งที่ `index.ts:226` เรียก `upsertMirroredTasks()` ซึ่ง `INSERT INTO task` — เพราะ SQL อยู่ในสตริง Graphify จึงไม่สร้าง edge · และ `graphify query "which functions write to the ledger table"` คืน 91 node แบบ BFS รอบคำว่า ledger (รวม `StoredLedger` ในไฟล์เทส) โดย **ไม่มี** `recordSummaryPassIssue()`/`recordCronTick()` ที่เป็นผู้เขียนจริง ⇒ ถ้าใช้ตอบโจทย์ lineage จะ **ตอบผิดอย่างมั่นใจ** ซึ่งร้ายกว่าตอบไม่ได้

### 5.2 MCP read-only — `fim-kg-mcp` (5 tool บังคับ + 2 resource)

**ที่อยู่:** รันบน cim-server (ข้างกราฟ) หรือ homelab · bind `127.0.0.1` หรือ tailnet เท่านั้น · **ไม่มี route ผ่าน Cloudflare** · ใช้ Streamable HTTP + `Authorization: Bearer` (รูปแบบเดียวกับ `graphify-mcp --transport http --api-key` แต่เป็นเซิร์ฟเวอร์ของเรา เพราะต้องมี audit/coverage ที่ Graphify ไม่มี)

**สัญญาที่ทุก tool ต้องมีเหมือนกัน (ห้ามยกเว้น):**

| ข้อ | รายละเอียด |
|---|---|
| Authentication | Bearer key **แยกดวง** จากทุกกุญแจที่มีอยู่ (ขนบ estate: กุญแจต่อหน้าที่) · ไม่ตั้ง = เซิร์ฟเวอร์ไม่ขึ้น (fail-closed) · เทียบแบบ constant-time · ผิด = 403 เหมือนกันทุกตัวอักษร |
| จำกัดขนาด | input ≤ 2 KB · output ≤ 32 KB หรือ ≤ 200 node/edge ต่อคำตอบ · เกิน = ตัดแล้วบอก `truncated: true, total: N` (ห้ามตัดเงียบ) |
| จำกัดเวลา | 5 วินาทีต่อคำขอ · เกิน = `status: "timeout"` ไม่ใช่ผลว่าง |
| Rate limit | 60 คำขอ/นาที/กุญแจ · เกิน = 429 |
| Audit log | ทุกคำขอ 1 บรรทัด JSON: `ts` · `key_id` (ไม่ใช่ค่า) · `tool` · `args_sha256` · `nodes_returned` · `duration_ms` · `status` — เก็บ 90 วัน · **ไม่เก็บเนื้อคำถาม** ถ้ามีข้อความอิสระ (แบบเดียวกับ `writeSafeLog` ของ Worker) |
| หลักฐานต้นทาง | ทุก node/edge ที่คืนมี `evidence[]` (`locator` · `provenance` · `git_rev`/`observed_at`) · ไม่มี evidence = ไม่คืน |
| **empty ≠ ok** | ทุกคำตอบมี `graph: {built_at, git_rev, coverage: {files_indexed/files_total, tables_indexed/tables_total, jobs_indexed/jobs_total}}` และ `status ∈ {ok, partial, stale, unknown}` · ผลลัพธ์ว่างต้องคืน `result: "none_found"` + `searched_scope` + `not_indexed[]` — **ห้ามคืน `[]` เปล่า** · ถ้ากราฟอายุเกิน 24 ชม. หรือ `git_rev` ไม่ตรง HEAD → `stale` เสมอ |
| ค่าเริ่มต้น provenance | คืน `EXTRACTED+DERIVED+MANUAL` · `INFERRED` ต้องขอด้วย `include_inferred: true` และถูกแยกกลุ่มในคำตอบ |

**Tool ทั้ง 5:**

| tool | input | output (นอกเหนือจากสัญญาร่วม) | คำถามทดสอบที่ต้องตอบได้ |
|---|---|---|---|
| `fim_graph_query` | `question` (≤500 ตัวอักษร) · `node_types[]` · `max_hops` (≤3) · `include_inferred` | subgraph ≤200 node · `matched_terms[]` · `unmatched_terms[]` (คำที่หาไม่เจอในกราฟต้องบอก) | "อะไรบ้างที่แตะ `tbl_notify_log`" |
| `fim_get_node` | `id` **หรือ** `locator` (`file:line` / `db.table.column` / `schtasks:name`) | node + edges แยก in/out + evidence + `decisions[]` ที่เชื่อม | "`canView` ถูกเรียกจากไหน มีคำตัดสินอะไรผูก" |
| `fim_trace_field` | `column` (`db.table.column`) · `direction` (`upstream/downstream/both`) · `max_hops` | เส้นทางเป็นรายการ hop พร้อม edge type และ evidence ทุก hop · จุดที่ขาด (`gap_at`) ต้องบอกว่าขาดเพราะ "ไม่ได้ index" หรือ "ไม่มี edge" | "`task.status` บนคลาวด์มาจากไหน ไปโผล่ในรายงานอะไร" → ต้องได้ `tbl_task.Status → aim_task_sync.php → /sync/tasks → upsertMirroredTasks → task.status → queryEngine → สรุปเช้า/เย็น` |
| `fim_impact` | `target` (column/table/module/function) · `depth` (≤3) | จัดกลุ่ม: `code[]` · `jobs[]` · `reports[]` · `notifications[]` · `tests[]` · `decisions[]` · `mirrors[]` + `confidence_summary` | "ถ้าเปลี่ยน ENUM `tbl_task.Status` กระทบอะไร" → ต้องมี `mirrors: aim-db.task` และ `decisions: D-P0-18` และเตือน P4 "ห้ามเปลี่ยนสิ่งที่ถูกเทียบ" (`WORK_PACKAGES_P4.md:22`) |
| `fim_find_silent_job` | `window_hours` (ค่าเริ่มต้น 48) · `scheduler` (`all/schtasks/cf-cron`) | รายการ job แต่ละตัวมี `expected_evidence` (จาก `leaves_evidence_in`) · `last_seen_at` · `verdict ∈ {alive, silent, no_evidence_edge, evidence_unreadable}` · **`evidence_sources_checked[]` ต้องไม่ว่าง** | "`goods_tomorrow` ยังเดินอยู่ไหม" → ถ้าไม่มีในกราฟต้องตอบ `not_indexed` ไม่ใช่ `alive` · ถ้ามีแต่ไม่มี edge หลักฐาน → `no_evidence_edge` (แปลว่าเราไม่รู้ ไม่ใช่ปกติ) |

**Resource (อ่านอย่างเดียว):** `fim-kg://build/latest` (metadata การสร้างล่าสุด + coverage + รายการไฟล์ที่ถูก ignore ด้วยเหตุผล) · `fim-kg://schema` (ชนิด node/edge ที่รองรับ — ให้ agent ไม่ต้องเดา)

**สิ่งที่ MCP นี้ทำไม่ได้โดยโครงสร้าง:** ไม่มี tool เขียน · ไม่มี tool อ่านไฟล์จริง (agent ต้องใช้เครื่องมืออ่านไฟล์ของตัวเองซึ่งอยู่ในสิทธิ์ที่มีอยู่แล้ว) · ไม่มี tool คิวรี MySQL — กราฟถูกสร้างล่วงหน้าโดย `fim-kg build` ด้วยบัญชี read-only แล้วเซิร์ฟเวอร์อ่านแค่ SQLite ของตัวเอง ⇒ ต่อให้กุญแจ MCP หลุด ก็ไม่มีทางถึง `db_customs`/`db_fim`

### 5.3 Write ingress ขั้นต่ำฝั่ง homelab MCP — `ksk_submit_question` / `ksk_submit_note`

บริบท (จากคำถาม · `[อ้างผู้ถาม]`): MCP ฝั่ง cim-server ที่ homelab เรียกได้มีแค่ `ksk_get_answer(ref)` ไม่มีทางส่งคำถามเข้า

**หลักออกแบบ:** เขียนได้ที่เดียวคือ **กล่องรับเรื่องของ MCP เอง** (`tbl_mcp_inbox` ใน schema/ฐานแยก `db_mcp` **หรือ** SQLite `C:\WebApp\mcp-inbox\inbox.sqlite`) — **ไม่แตะ CIM/FIM/aim-db** · คนหรือ Claude เป็นฝ่ายมาอ่านกล่องแล้วตัดสิน (ไม่มี consumer อัตโนมัติที่แปลงเรื่องเป็นการกระทำ) — แพทเทิร์นเดียวกับ `inbox_event` ของ Worker ที่พิสูจน์แล้วว่ากันซ้ำได้ (D-P0-01)

| ข้อบังคับ | การออกแบบ |
|---|---|
| dedup ด้วย `ref` | `ref` เป็น UNIQUE · รูปแบบ `^[A-Za-z0-9_-]{8,64}$` · ส่งซ้ำ `ref` เดิม + เนื้อความเดิม (sha256 ตรง) = `status: duplicate` คืน `received_at` เดิม · `ref` เดิมแต่เนื้อความต่าง = `409 conflict` (ห้ามทับเงียบ — บทเรียน `/link` conflict `index.ts:465-471`) |
| จำกัดขนาด | `text` ≤ 2,000 ตัวอักษร (นับ code point แบบ `[...s].length` ให้ตรงกับ `mb_strlen` — บทเรียน F6 `index.ts:339-341`) · ไม่มีไฟล์แนบ · ไม่มี URL ที่ดาวน์โหลดได้ (ปฏิเสธ pattern `https?://` ยกเว้นโดเมนภายใน) |
| บันทึกผู้ส่ง+เวลา | `submitter_key_id` (รหัสกุญแจ ไม่ใช่ค่า) · `submitted_at` (เวลาเซิร์ฟเวอร์) · `client_claimed_at` (ถ้าส่งมา) · `text_sha256` · `source_ip_tailnet` |
| แยก authentication | กุญแจ **ดวงใหม่ `MCP_SUBMIT_KEY`** คนละดวงกับที่ใช้เรียก `ksk_get_answer` · ถือกุญแจส่งได้อย่างเดียว อ่านกล่องไม่ได้ · ไม่ตั้ง = tool ไม่ปรากฏใน `tools/list` |
| ไม่มีสิทธิ์แก้ CIM/FIM | บัญชีฐานข้อมูลของ MCP มี `INSERT` เฉพาะ `tbl_mcp_inbox` (หรือเขียนไฟล์ SQLite แยก) · **ไม่มี GRANT ใด ๆ บน `db_customs`/`db_fim`** · พิสูจน์ด้วยเทสที่พยายาม `INSERT INTO db_customs.tbl_task` แล้วต้องได้ permission denied (ยามที่ตกได้) |
| ตอบสถานะชัด | `{status: accepted|duplicate|rejected, ref, received_at, reason?, queue_depth_unread, oldest_unread_age_minutes}` — สองช่องท้ายมีไว้ **กันเข้าใจผิดว่ารับแล้ว = มีคนอ่านแล้ว** · `rejected.reason ∈ {too_long, bad_ref, forbidden_content, rate_limited, unauthorized}` |
| Rate limit | 30 เรื่อง/ชั่วโมง/กุญแจ · เกิน = `rejected: rate_limited` (กันลูปส่งซ้ำแบบที่ `IMPLEMENTATION_PLAN.md` §8 ข้อ 1 กังวล) |
| แยกชนิด | `ksk_submit_question` (`kind=question` · คาดหวังคำตอบ · ผูก `ref` กับ `ksk_get_answer(ref)` เดิม) · `ksk_submit_note` (`kind=note` · บันทึกอย่างเดียว ไม่คาดหวังคำตอบ) · ตารางเดียวกัน ต่างที่ `kind` |
| Retention | เรื่องที่ `read_at` แล้วเกิน 90 วันลบอัตโนมัติ · เรื่องที่ยังไม่อ่านไม่ลบ แต่ `oldest_unread_age_minutes` จะฟ้องผ่าน `bin/selfcheck.php` (เพิ่มการอ่านกล่องเข้าไปในยามที่มีอยู่แล้ว — ไม่สร้างยามใหม่ ตามหลัก `dump-daily.ps1:12-13`) |
| ห้าม | ห้ามส่งเนื้อความออกจากเครื่อง (ไม่ forward ไป LINE/คลาวด์อัตโนมัติ) · ห้ามมี tool `ksk_update_*`/`ksk_delete_*` |

**ต้องขออนุมัติแยก** ก่อนลงมือ เพราะเป็นการเพิ่มผิวสัมผัสเขียนบน cim-server แม้จะเป็นกล่องแยก (กติกา `CLAUDE.md` §2 ข้อ 1)

---

## 6. แผน pilot และเกณฑ์วัดผล

### 6.1 ขอบเขต — สองระยะ · รวมไม่เกิน 40 หน่วย

**Pilot-A (ทำได้ทันที · ไม่แตะ cim-server เลย):** รีโปนี้ทั้งก้อน = **35 ไฟล์โค้ด + 9 ตาราง D1** (นับจริง) — ทุกอย่างอยู่ใน git · ไม่มีความลับ · ไม่มี PII · ใช้ทดสอบ extractor ให้แน่ใจว่า "ยามตกได้" ก่อนไปแตะของที่แพงกว่า

**Pilot-B (ต้องพี่เต้อนุมัติ + รันบน cim-server ด้วยบัญชี read-only):** เฉพาะ **สะพาน AIM ฝั่ง LIVE** ~25–30 หน่วย:
- ไฟล์ (≈15): `lib/aim_forward.php` · `lib/aim_notify.php` · `api/aim_notify.php` · `lib/aim_ask.php` · `bin/aim_task_sync.php` · `bin/aim_reconcile.php` · `bin/selfcheck.php` · `lib/notify.php` · `lib/holiday.php` · `bin/smoke_aim_forward.php` · `bin/smoke_aim_ask.php` · `bin/smoke_aim_notify.php` · `lib/escalation.php` · `bin/task_escalate.php` · จุดแทรก 2 จุดใน `api/line_webhook.php` (เฉพาะ hunk `WP-P0-5`/B1 — ไม่ index ทั้งไฟล์ 2,443 บรรทัดในรอบนี้)
- ตาราง (DDL อย่างเดียว ≈6): `tbl_task` · `tbl_task_log` · `tbl_notify_log` · `tbl_holiday` · `tbl_line_user` (**ตัดคอลัมน์ `Line_User_ID` ออกจากกราฟ** — เก็บแค่ว่ามีคอลัมน์ ไม่เก็บชนิด/ตัวอย่าง) · `tbl_bridge_event`
- Job (≈5): `ksk-aim-task-sync` · `ksk-aim-reconcile` · `ksk-aim-dump` · `ksk-task-remind` · **+ `goods_tomorrow` 1 ตัว** (ถ้ามีจริง — เป็นตัวแทน FIM เพียงตัวเดียวใน pilot เพื่อพิสูจน์ว่า extractor อ่าน schtasks/log ของ Node ได้)
- **ห้ามเข้า:** `config/` ทั้งโฟลเดอร์ · `.dev.vars` · `wrangler.toml` · `dumps/` · `*.log` เนื้อหา (อ่านแค่ mtime/บรรทัดล่าสุดที่เป็น marker) · `tbl_user` · ตาราง vendor ทุกตัว · ตารางศุลกากร/ราคา/ใบขนทุกตัวใน `db_fim` · ค่าในแถวทุกตาราง

### 6.2 ข้อมูลที่เหมาะ vs ต้องห้าม (ใช้ทั้ง pilot และหลังจากนั้น)

| เหมาะนำเข้า (โครง ไม่ใช่ค่า) | **ต้องห้ามเด็ดขาด** |
|---|---|
| path/ชื่อไฟล์ · ชื่อฟังก์ชัน · call/import · บรรทัด | ค่าของ secret ทุกชนิด · ไฟล์ `config/*.credentials.php` · `.dev.vars` · `wrangler.toml` · token ใน env |
| DDL: ชื่อตาราง/คอลัมน์/ชนิด/CHECK/FK/index | **ค่าในแถว** ทุกตาราง (แม้แต่ 1 แถวตัวอย่าง) |
| ชื่อ scheduled task · schedule · path สคริปต์ · `LastRunTime/LastTaskResult` | บัญชีที่ task รันด้วย (`RunAs`) · รหัสผ่านใน XML |
| ชื่อ `Code` ใน `tbl_notify_log` · เวลาล่าสุด · `Result` | เนื้อความแจ้งเตือน · ผู้รับรายคน |
| ชื่อ endpoint · header · ชื่อ secret · status code | URL ที่มี token · `groupId`/`userId` LINE (แม้ prefix) |
| `D-P0-*` · วันที่ · หัวข้อ · ไฟล์ที่เกี่ยว | ชื่อจริง/ชื่อเล่นพนักงาน · เหตุผลการลา · `aim_person_map.php` |
| จำนวนเทสต่อ smoke file | ข้อมูลลูกค้า · vendor 41 บริษัท · เลขใบขน · ราคา/มูลค่า · ข้อมูลศุลกากรทุกชนิด (`IMPLEMENTATION_PLAN.md` §3) |

**ยามกันของต้องห้าม (ต้องมีก่อน Pilot-B และต้องพิสูจน์ว่าตกได้):** สคริปต์ `fim-kg check-forbidden` สแกน `fim-graph.sqlite` + vault ด้วย allowlist ของชนิด property ต่อชนิด node (ไม่ใช่ denylist — บทเรียน D-P0-05) + regex `^U[0-9a-f]{32}$` · `^C[0-9a-f]{32}$` · `[0-9a-f]{64}` (กุญแจ 64 hex) · `bcrypt \$2y\$` · เลขบัตร/โทรศัพท์ไทย — sabotage: ใส่ node ปลอมที่มี `U`+32hex แล้วสคริปต์ต้องตก

### 6.3 คำถามทดสอบ 10 ข้อ (ตอบผ่าน MCP เท่านั้น · ตรวจกับของจริงด้วยมือ)

| # | คำถาม | tool | คำตอบที่ถูก (ตรวจได้จากไฟล์จริง) | ผ่านเมื่อ |
|---|---|---|---|---|
| 1 | ใครเขียนตาราง `task` บนคลาวด์ | `fim_impact(task)` | `upsertMirroredTasks()` · `applyTaskTransition()` (`repository.ts`) · ทั้งคู่มี evidence บรรทัด | ครบ 2 · ไม่มีตัวปลอม · provenance=DERIVED |
| 2 | `task.status` มาจากไหน ไปไหน | `fim_trace_field(aim-db.task.status, both)` | upstream: `tbl_task.Status` → `aim_task_sync.php` → `/sync/tasks` · downstream: `queryEngine` → `/ask` · `summary.ts` → `api/aim_notify.php` | ≥ 5 hop ถูก · `gap_at` ระบุตรงที่ Pilot-A ไม่มีฝั่ง LIVE (ต้องบอก ไม่ใช่เดา) |
| 3 | เปลี่ยน ENUM `tbl_task.Status` กระทบอะไร (Pilot-B) | `fim_impact(db_customs.tbl_task.Status)` | `mirrors → aim-db.task` · `decisions: D-P0-18` · `tasks.php`/`work_items.php`/`task_remind` (`DATABASE_SCHEMA.md:76`) · เตือน P4 | มี `mirrors`+`decisions` · ไม่มี false positive เกิน 1 |
| 4 | job ไหนบนคลาวด์ที่ไม่มีหลักฐานว่าเดิน | `fim_find_silent_job(cf-cron)` | `cron */1` → evidence `ledger.cron_tick` · verdict `alive` **หรือ** `evidence_unreadable` ถ้าไม่มี dump ให้อ่าน — ห้ามเป็น `alive` โดยไม่มีหลักฐาน | `evidence_sources_checked` ไม่ว่าง |
| 5 | `goods_tomorrow` ยังเดินไหม (Pilot-B) | `fim_find_silent_job` | ตาม `leaves_evidence_in` ที่ extractor หาได้ · ถ้าไม่พบ edge → `no_evidence_edge` | **ห้ามตอบ `alive` ถ้าไม่มี edge** · ถ้าไม่มีในกราฟ → `not_indexed` |
| 6 | notification ช่องไหนไม่ผ่าน `nt_registry()` (Pilot-B) | `fim_graph_query("NotifyChannel without registered_in")` | `lib/aim_notify.php → ll_line_push_to` (registry=none) (`CLAUDE.md` §8) | เจอตัวนี้ · ทุกช่องที่คืนมีบรรทัดเรียก |
| 7 | report ไหนไม่มี producer หรือ consumer | `fim_graph_query("Report orphan")` | Pilot-A: `outbound_queue` = ช่องส่งที่ไม่มีใครเขียน (in-degree writes=0 — D-P0-18) · Pilot-B: ตามจริง | ผลตรงกับการ grep มือ 100% |
| 8 | `canView()` ถูกเรียกจากไหน มีคำตัดสินอะไรผูก | `fim_get_node(worker/src/visibility.ts#canView)` | callers: `createVisibilityMemo()` (`queryEngine.ts:885`) · เทส `visibility.test.ts` · decisions `D-P0-13` · guarded `queryEngine` | ครบ + `is_decision_point=true` |
| 9 | ทำไม `POST /admin/summary` ถึงตอบ 412 เป็น skipped_holiday | `fim_get_node` + `fim_graph_query` | `D-P0-16 §2` · `repository.ts:15-24` · `outbound.ts` แยก 4xx | คืน Decision node + บรรทัดโค้ดที่อ้าง |
| 10 | ถามสิ่งที่ไม่มีในกราฟ: "ตาราง `tbl_invoice` ใช้ที่ไหน" | `fim_impact(db_customs.tbl_invoice)` | `result: none_found` · `not_indexed: [db_fim.*, ...]` · `status: partial` | **ห้ามคืน `[]` เฉย ๆ** · ต้องบอก scope ที่ค้นและที่ไม่ได้ index |

**วิธีให้คะแนน:** ทุกข้อตรวจกับไฟล์/ตารางจริงด้วยตา (ผู้ตรวจ ≠ ผู้เขียน extractor — กติกา §1) · แต่ละ node/edge ที่คืนต้องเปิด evidence แล้วเห็นจริง

### 6.4 เกณฑ์ผ่าน / ไม่ผ่าน

| เกณฑ์ | ผ่าน | ไม่ผ่าน (หยุด) |
|---|---|---|
| ความถูกต้อง | ≥ 9/10 ข้อถูก · **ข้อ 5 และ 10 ต้องถูก** (คำตอบว่างที่หลอกว่าปกติ = ตกทั้ง pilot) | มี edge ปลอมที่ evidence เปิดแล้วไม่ตรง แม้ 1 เส้น ในระดับ `EXTRACTED/DERIVED` |
| ความเป็นส่วนตัว | `check-forbidden` = 0 · พิสูจน์ว่าตกได้ด้วย sabotage | พบข้อมูลต้องห้ามในกราฟ/vault/log แม้ 1 ค่า |
| ประโยชน์จริง | Claude ใช้กราฟก่อนอ่านไฟล์ใน 3 งานจริง แล้วจำนวนไฟล์ที่ต้องเปิดลดลง ≥ 30% (นับจาก transcript) | ไม่ลด หรือกราฟทำให้แก้ผิดไฟล์ |
| ภาระ | `fim-kg build` ≤ 2 นาที · RAM ≤ 1 GB · ไม่มีขั้นตอนมือ | ต้องแก้มือทุกครั้งที่ commit |
| ความจริงไม่แตกสองชุด | กราฟไม่ถูกใช้แทนการอ่านไฟล์ในการตัดสินใจใด · ไม่มีใครแก้กราฟด้วยมือนอก `manual/` | มีคน "แก้กราฟให้ตรง" แทนแก้โค้ด/เอกสาร |

### 6.5 เงื่อนไขหยุด / rollback

- **หยุดทันที** เมื่อ: พบข้อมูลต้องห้ามในกราฟ · MCP ถูกเรียกจากนอก tailnet · extractor ต้องการสิทธิ์เขียน/บัญชีที่ไม่ใช่ read-only · `graphify` เวอร์ชันใหม่เปลี่ยนพฤติกรรม privacy (ตรวจ CHANGELOG ก่อน upgrade ทุกครั้ง)
- **Rollback = ลบ 3 อย่าง:** `C:\WebApp\fim-kg\` (sqlite+graph.json+vault) · service/tak ของ MCP (ถ้าตั้ง) · กุญแจ `FIM_KG_MCP_KEY` · **ไม่มีอะไรใน CIM/FIM/aim ต้องย้อน** เพราะ pilot ไม่แตะ — นี่คือเหตุผลที่ต้องยืนยันตลอดว่า extractor เป็น read-only จริง (เทส: บัญชี MySQL ของ extractor ต้อง `INSERT` ไม่ได้)
- **ไม่ต่อ Pilot-B** ถ้า Pilot-A ตกข้อ 5/10 หรือ `check-forbidden` ยังตกไม่ได้

### 6.6 ลำดับงาน (ไม่ประเมินเป็นวัน — ประเมินเป็นชิ้น)

1. ใบสั่งงาน WP-KG-1 (Codex): `.graphifyignore` + สคริปต์ `fim-kg build` ห่อ `graphify extract --code-only` บนรีโปนี้ → `graph.json` (ไม่ commit output)
2. WP-KG-2: extractor `reads/writes` จาก SQL ใน `.ts` (template string · `prepare(...)`) + DDL → `fim-graph.sqlite` · merge กับ graph.json · เทสที่ตกได้ (ลบ regex แล้วต้องเจอ edge หาย)
3. WP-KG-3: `check-forbidden` + `fim-kg export obsidian` + MCP 5 tool (stdio ก่อน · http ทีหลัง) · เทสสัญญา "empty ≠ ok"
4. รัน 10 คำถามบน Pilot-A → Claude ตรวจ → ใบตัดสินใน `DECISIONS_P0.md` (D-KG-01)
5. ขออนุมัติ Pilot-B แยกใบ (แตะ cim-server แบบอ่าน) → เพิ่ม extractor PHP (`$pdo->prepare("... FROM tbl_x")` · `ll_line_push_to` · `nt_registry`) · schtasks XML · `tbl_notify_log` reader (read-only account)
6. ประตู: 10 คำถามผ่านทั้งสอง pilot → ค่อยคุยเรื่องขยายเข้า FIM เต็มตัว (ต้องมีแผนผัง FIM จริงจากภาคผนวก ข ก่อน)

---

## 7. ความเสี่ยงและวิธีป้องกัน

| # | ความเสี่ยง | ร้ายแรง | วิธีป้องกัน (ต้องเป็นของที่เครื่องบังคับ ไม่ใช่วินัย) |
|---|---|---|---|
| 1 | Graphify ค่าเริ่มต้นส่งเอกสาร/รูปไป LLM นอกบ้าน · เลือก backend เองจาก API key ที่เจอใน env | 🔴 | `--code-only` เท่านั้นใน `fim-kg build` · unset `GEMINI_API_KEY/OPENAI_API_KEY/ANTHROPIC_API_KEY/MOONSHOT_API_KEY` ใน env ของ task · เทส: ตั้ง key ปลอมแล้วรัน build ต้อง **ไม่มี** network call ออก (ตรวจด้วย firewall log หรือ `--timing` ที่ `semantic extract: 0.0s`) |
| 2 | parse ไฟล์ความลับ (`config/*.php` · `.dev.vars` · `wrangler.toml`) | 🔴 | `.graphifyignore` allowlist แบบ `*` + `!lib/**` … (README รองรับ `!` negation) · `check-forbidden` หลัง build ทุกครั้ง · build ตกถ้าพบ |
| 3 | กราฟกลายเป็น "ความจริงชุดที่สอง" — คนแก้กราฟแทนแก้โค้ด หรือ agent เชื่อกราฟที่เก่ากว่าโค้ด | 🔴 | กราฟ regenerate ทั้งก้อนทุกครั้ง (ไม่ incremental — เหตุผลเดียวกับ D-P0-18 "ส่งทั้งชุดทุกรอบ") · `status: stale` เมื่อ `git_rev ≠ HEAD` · ห้าม `--strict` |
| 4 | คำตอบว่างถูกอ่านว่า "ปกติ" (เช่น `find_silent_job` คืน `[]` เพราะอ่าน `tbl_notify_log` ไม่ได้) | 🔴 | สัญญา `empty ≠ ok` ใน §5.2 · เทสบังคับ: ตัดสิทธิ์อ่าน evidence source แล้วคำตอบต้องเป็น `evidence_unreadable` ไม่ใช่ `alive` |
| 5 | extractor regex ไม่ครอบรูปแบบจริง (SQL ต่อสตริง · ชื่อตารางจากตัวแปร) → edge หาย → impact ตอบไม่ครบอย่างมั่นใจ | 🟠 | รายงาน `coverage` ต่อไฟล์: จำนวน SQL statement ที่ parse ได้ / ที่พบ (`prepare(` ทั้งหมด) · ต่ำกว่า 100% ต้องติดธง `partial` ที่ node นั้น · fixture ต้องมาจากโค้ดจริง ไม่ใช่ที่ผู้เขียนเทสคิดเอง (บทเรียน ULID) |
| 6 | Upstream Graphify เปลี่ยนเร็ว/มุ่ง SaaS · รูปแบบ `graph.json` เปลี่ยน | 🟠 | pin เวอร์ชัน (`uv tool install graphifyy==0.9.55`) · ความจริงอยู่ใน `fim-graph.sqlite` ของเรา · แผนสำรอง 1 บรรทัด: ถ้า Graphify หายไป extractor ของเราใช้ tree-sitter ตรง (Apache-2.0 เหมือนกัน) สำหรับ call graph |
| 7 | MCP เปิดผิวสัมผัสใหม่บน cim-server | 🟠 | bind loopback/tailnet เท่านั้น · กุญแจแยกดวง · ไม่มี tool เขียน · ไม่มี GRANT บนฐานจริง · เพิ่ม `/health` ของ MCP เข้า `bin/selfcheck.php $sites` (ยามเดิม ไม่สร้างใหม่) |
| 8 | โควตา/ทรัพยากร: กราฟใหญ่จน Obsidian/HTML เปิดไม่ได้ · RAM บน cim-server | 🟡 | `--no-viz` เสมอบนเซิร์ฟเวอร์ · vault สร้างเฉพาะ community ที่ถาม · เพดาน 5,000 node ต่อ vault (README เตือน HTML > 5,000 node) |
| 9 | Query log ของ Graphify เก็บคำถาม (README ขัดกันเอง) | 🟡 | ตั้ง `GRAPHIFY_QUERY_LOG_DISABLE=1` ใน task และตรวจว่า `~/.cache/graphify-queries.log` ไม่โต — เราใช้ audit log ของ MCP ตัวเองแทน |
| 10 | ทำซ้ำเรื่องที่ตัดสินแล้ว / ข้ามประตู (บทเรียน D-P0-17/19) | 🟡 | งานนี้ **ไม่อยู่ในเฟส P0–P5** ของ AI Manager — เป็นเครื่องมือของผู้ตรวจ ไม่กระทบ P4 (ไม่แตะสิ่งที่ถูกเทียบ) · ต้องเขียนไว้ชัดในใบตัดสิน D-KG-01 ว่าไม่ใช่การเริ่ม P5 |

---

## 8. สิ่งที่แชร์กลับ Homelab ได้ · สิ่งที่ต้องอยู่ใน FIM/cim-server เท่านั้น

| แชร์กลับ homelab ได้ (ผ่าน tailnet · อ่านอย่างเดียว) | ต้องอยู่ที่ cim-server/FIM เท่านั้น |
|---|---|
| **โครงกราฟระดับ System/Module/Job/Report/NotifyChannel/Watchdog** ที่ผ่าน `check-forbidden` แล้ว — ชื่อไฟล์ ชื่อ task ชื่อ `Code` ชื่อคอลัมน์ | `fim-graph.sqlite` ตัวเต็ม (มี `Column` ทุกตารางรวม `db_fim`) |
| `coverage` + `build` metadata (สร้างเมื่อไร · กี่ไฟล์ · git rev) | Obsidian vault (มี snippet คอมเมนต์ไทยที่อาจมีชื่อเล่น/บริบทคน) |
| ผลของ `fim_find_silent_job` แบบสรุป (`job`, `verdict`, `last_seen_at`) — ไม่มีเนื้อ log | เนื้อหา log · `tbl_notify_log` ทั้งแถว · `LastTaskResult` รายละเอียด |
| รายการ `Decision` (id · วันที่ · หัวข้อ) — เอกสาร `DECISIONS_P0.md` อยู่บน GitHub อยู่แล้ว | คอลัมน์/ตารางของ `db_fim` ที่เกี่ยวศุลกากร ราคา ใบขน vendor — **ห้ามแม้แต่ชื่อคอลัมน์** ออกจากเครื่องจนกว่าพี่เต้จะเคาะรายชื่อที่อนุญาตทีละตาราง (`IMPLEMENTATION_PLAN.md` §3) |
| Audit log ของ MCP แบบรวมยอด (จำนวนคำขอ/ชม. · tool ที่ใช้) | Audit log รายคำขอ (มี `args_sha256` และ `key_id`) |
| `graph.json` ของ **รีโปนี้** (Pilot-A) — เป็นโค้ดสาธารณะภายในทีมอยู่แล้ว | `graph.json`/vault ของ vendor-ksk และ FIM |
| ข้อเสนอ write ingress §5.3 (สัญญา tool) | กล่อง `tbl_mcp_inbox` และกุญแจ `MCP_SUBMIT_KEY` |

หลักเดียว: **ออกจากเครื่องได้เฉพาะ "โครง" ที่ตอบคำถามว่า "อะไรเชื่อมกับอะไร" — ไม่ใช่ "ข้างในมีอะไร"** และทุกอย่างที่ออกต้องผ่าน `check-forbidden` ชุดเดียวกับที่ใช้กันข้อมูลคนออกจากบ้านใน AI Manager

---

## ภาคผนวก ก — การวัดจริง (Graphify 0.9.55 · สำเนารีโปนี้ · 2026-09-07 · ไม่มีอะไรออกเครื่อง)

```
graphify extract . --code-only --no-viz --timing
  found 35 code, 0 docs (17 docs skipped by --code-only), 3 unclassified (.gitignore, wrangler.*.toml)
  wrote graph.json: 408 nodes, 786 edges, 20 communities
  timing total 1.2s · wall 1.4s · max RSS 74 MB
  graphify-out/ = 508 KB (graph.json 402 KB · manifest 7 KB · cache/)
edge relations: contains 328 · calls 240 · imports 122 · imports_from 47 · method 39 · references 6 · inherits 4
confidence:     EXTRACTED 777 · INFERRED 9
SQL:            table nodes 9 ตาราง + FK เป็น `references` ✅ · **ไม่มี Column node** · **ไม่มี edge โค้ด→ตาราง**
graphify explain "canView"  → 5 connections ถูกต้องครบ (importer · caller L885 · test) ✅
graphify path "handleSyncTasks" "task" → "No directed path found" ❌ (ของจริง: index.ts:226 → upsertMirroredTasks → INSERT INTO task)
graphify query "which functions write to the ledger table" → 91 node BFS · ไม่มีผู้เขียนจริง (recordCronTick/recordSummary*) ❌
graphify export obsidian → 428 notes · 1.9 MB · frontmatter: source_file/type/community/location · tags graphify/EXTRACTED
graphify-mcp --help → tools: query_graph · get_node · get_neighbors · shortest_path (+ list_prs/get_pr_impact/triage_prs) · --transport http --api-key
สังเกต: ไฟล์เทส worker/test/* ถูก index ด้วย (StoredLedger ฯลฯ ปนกับของจริง) ⇒ ต้อง .graphifyignore หรือติด tag test
สังเกต: bridge/*.example.php และ package.json scripts (รวม `deploy`) กลายเป็น node ⇒ ของจริงใน config/ จะโดนแบบเดียวกันถ้าไม่ ignore
```

ข้อมูลอ้างอิงอื่นในเอกสาร: README Graphify §Privacy (code local · docs → LLM · backend auto-detect Gemini→Kimi→Claude→OpenAI→…) · §What files it handles (`.php .sql .ps1 .json .md` รองรับ · `.xml` ไม่รองรับ) · optional `--postgres DSN` (ไม่มี MySQL) · `GRAPHIFY_MAX_GRAPH_BYTES` 512 MiB · `--strict` บล็อกการอ่านไฟล์แรก

## ภาคผนวก ข — หลักฐานที่ต้องเก็บเพิ่ม (คำสั่ง read-only · ให้ผู้อยู่หน้าเครื่องรัน · **ห้ามส่งผลลัพธ์ดิบออกจากเครื่อง** — ปอกค่า/บัญชีก่อนแชร์)

| ต้องรู้ | คำสั่ง (อ่านอย่างเดียว) | ใช้เติมส่วนไหน |
|---|---|---|
| รายชื่อ scheduled task ทั้งหมด + schedule + สคริปต์ + ผลรันล่าสุด | `schtasks /query /fo LIST /v` แล้วกรอง `TaskName`, `Task To Run`, `Schedule Type`, `Last Run Time`, `Last Result` — **ตัด `Run As User` ออก** | §2.3 Job · `goods_tomorrow` |
| `goods_tomorrow` คืออะไร | `schtasks /query /tn "<ชื่อจริง>" /xml` (ตัด `<Principal>`) · `Get-Item <script path> \| Select LastWriteTime,Length` · หา `goods_tomorrow` ใน FIM: `Get-ChildItem C:\WebApp\<FIM> -Recurse -Include *.js,*.ts,*.sql,*.ps1 \| Select-String -List goods_tomorrow \| Select Path,LineNumber` | §2.3 · คำถามทดสอบข้อ 5 |
| โครง FIM | `Get-ChildItem C:\WebApp\<FIM> -Recurse -File \| Group Extension \| Sort Count -Desc` · `package.json` (ชื่อ dependencies เท่านั้น) · โฟลเดอร์ cron/scheduler/reports | §2.3 FIM · ขนาด pilot ระยะถัดไป |
| DDL จริง | `SHOW CREATE TABLE db_customs.tbl_task;` (ซ้ำสำหรับ 6 ตาราง Pilot-B) — **ห้าม `SELECT *`** · `db_fim` รอพี่เต้เคาะรายชื่อตารางที่อนุญาต | §4 Column node · คำถาม 2/3 |
| ทะเบียนแจ้งเตือน | `php -r 'require "lib/notify.php"; print_r(array_keys(nt_registry()));'` (ชื่อ code เท่านั้น) · `SELECT Code, MAX(Created_At), COUNT(*) FROM tbl_notify_log GROUP BY Code;` | §4 NotifyChannel · `leaves_evidence_in` |
| ยามเฝ้าอะไรบ้าง | อ่าน `bin/selfcheck.php` (`$sites`, รายการ task ที่คาด) · `bin/check_send_channels.php` | edge `registered_in` · คำถาม 6 |
| MCP ฝั่ง homelab ปัจจุบัน | สเปก `ksk_get_answer(ref)`: transport · auth · ที่เก็บคำตอบ · ใครเขียนคำตอบ | §5.3 ผูก `ref` |
| จำนวน SQL statement ต่อไฟล์ PHP (ตั้งเป้า coverage) | `Select-String -Path lib\*.php,api\*.php,bin\*.php -Pattern 'prepare\(\|->query\(' \| Group Path \| Select Name,Count` | §7 ข้อ 5 |

ผลลัพธ์จากตารางนี้จะเปลี่ยน `[รอยืนยัน]`/`[อ้างเอกสาร]` ใน §2.3 เป็น `[VERIFIED]` และเป็นเงื่อนไขก่อนเขียนใบสั่งงาน Pilot-B
