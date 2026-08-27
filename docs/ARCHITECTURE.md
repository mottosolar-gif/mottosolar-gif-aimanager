# AI Manager + LINE Workforce Ops — ARCHITECTURE
สร้าง 2026-08-26 · ตอบสเปค MASTER SPECIFICATION §1–§45
สถานะ: **เอกสารสำรวจ+ออกแบบ ยังไม่แตะโค้ด** (กติกาบ้าน CLAUDE.md ข้อ 4)

---

## 0. ข้อค้นพบสำคัญที่สุด (VERIFIED — วัดจากไฟล์/ฐานจริง 26 ส.ค. 2569)

**ระบบตามสเปคนี้ ~70% มีอยู่แล้วและรันจริงกับพนักงาน 11 คน** ไม่ใช่ greenfield

| หลักฐาน | ค่าที่วัดได้ |
|---|---|
| LINE webhook | `api/line_webhook.php` **2,443 บรรทัด** · 54 ฟังก์ชัน · รองรับ text/image/audio/postback/follow |
| งานมอบหมาย | `tbl_task` 20 ใบจริง (doing 6 · done 6 · cancelled 8) + `tbl_task_log` + `tbl_task_photo` |
| งานหน้างาน | `tbl_site_activity` 22 ใบ (open 3 · done 13 · log 2 · dropped 4) + `_log` |
| ผู้ใช้ LINE | `tbl_line_user` **active 11 คน** (ผูกกับ `tbl_user` ของ CIM) |
| AI ที่ใช้จริง | `tbl_ai_usage` **202 ครั้ง** · Gemini (NLU/วิเคราะห์รูป) + Claude (`api.anthropic.com`) |
| Scheduler | Windows Scheduled Tasks **~30 งาน** ที่ขึ้นต้น `ksk-*` (task-remind · followup-remind · site-task-scan · s5-remind-15min …) |
| หน้าเว็บจัดการ | `tasks.php` 778 บรรทัด (รีดีไซน์เสร็จ 25–26 ส.ค.) + `lib/work_items.php` รวม 2 ระบบงานเป็นการ์ดเดียว |
| ยามอัตโนมัติ | `bin/smoke_tasks_render.php` 36/36 PASS · smoke_* อีก 20 ไฟล์ |

⇒ **สเปค §46 ข้อ 4–5 ("ห้ามลบระบบเดิม · reuse existing components") บังคับให้ต่อยอด ไม่ใช่สร้างใหม่**
⇒ §45 (monorepo `/apps /services /packages`) **ขัดกับของจริง** — ถ้าย้ายไปโครงนั้นคือเขียนใหม่ทั้งหมด
   และทิ้งของที่พนักงานใช้อยู่ทุกวัน · ข้อเสนอ: **ยึดโครงเดิม แล้วทำ "โมดูลตรรกะ" ให้ชัดแทนโครงโฟลเดอร์**

---

## 1. สถาปัตยกรรมจริงวันนี้ (AS-IS)

```
หัวหน้า (LINE / เว็บ tasks.php)
   │  พิมพ์ไทยธรรมชาติ "สั่งงานให้กานดา เช็คสต็อก ส่งศุกร์นี้"
   ▼
api/line_webhook.php  ── ll_handle_text()
   │  1) ดัก state สนทนาค้าง (tbl_line_state)
   │  2) ดักคีย์เวิร์ดตายตัว (เศษซาก/เครื่องมือ/5ส/วันหยุด/สรุป)
   │  3) forceTask regex กันตัวจำแนกตีตก  ← กันบั๊ก "สั่งงานแล้วเงียบ" (18 ส.ค.)
   │  4) ll_parse_message()  → Gemini → intent: leave | pack | task | other
   ▼
ll_task_assign() → resolve assignee (ปุ่มรายชื่อ) → resolve due (ปุ่มวันที่) → การ์ดยืนยัน
   ▼
tbl_task (draft → open)  +  tbl_task_log  ← SOURCE OF TRUTH
   ▼
LINE Flex card → ลูกน้อง กด [รับงาน] / [ติดปัญหา] / [เสร็จแล้ว] / [เลื่อน]
   ▼
Scheduled Tasks (ksk-task-remind · ksk-followup-remind · ksk-site-task-scan)
   ▼
lib/notify.php (ศูนย์กลางแจ้งเตือนที่เดียว) → LINE / อีเมล
```

**หลักที่ระบบนี้ยึดอยู่แล้วและตรงกับสเปค §44:**
- DB = source of truth (ไม่ใช่แชต) — เขียนไว้เป็นคอมเมนต์หัวตาราง `029_site_activity.sql`
- LINE = worker interface · เว็บ = management interface
- AI ไม่ตัดสินใจเอง — ทุกงานจบที่ "การ์ดให้กดยืนยัน"

---

## 2. ช่องว่างเทียบสเปค (GAP — สิ่งที่ยังไม่มีจริง)

| § | สเปคขอ | สถานะจริง | ช่องว่าง |
|---|---|---|---|
| §7–8 | 12 สถานะ + state machine | `tbl_task` มี 6 (`draft/open/doing/done/blocked/cancelled`) | ขาด ACCEPTED · EN_ROUTE · ARRIVED · OVERDUE · REJECTED · PENDING_CONFIRMATION |
| §7,§22 | location / lat / lng / map_link / ปุ่มนำทาง | **ไม่มีคอลัมน์สถานที่เลยในงาน** | ต้องเพิ่ม + ปุ่ม [นำทาง] |
| §11 | flow เดินทาง→ถึง→เริ่ม | มีแค่ รับ→ทำ→เสร็จ | ขาด 3 ขั้นกลาง (`tbl_arrival_check` เป็นคนละเรื่อง — ถามของเข้า ไม่ใช่ถึงหน้างาน) |
| §12 | รูปเก็บ GPS + file_hash + metadata | `tbl_task_photo` มีแค่ Path + Created_At | ขาด hash/GPS/ผู้ส่ง/ขนาด |
| §16 | escalation 4 ระดับ (reminder→manager→owner→AI แนะนำ) | มี nudge/remind + `Nudge_Count` แต่ไม่มีบันได 4 ขั้น | ต้องทำ policy table |
| §19 | หัวหน้าถาม AI จากฐานจริง ("ใครยังไม่รับงาน") | **ไม่มี** — chat ตอบมุขได้เฉพาะ 1 คน (`LL_CHAT_TEST_USER`) | ต้องทำ read-only query agent + กันมั่ว |
| §25,§27 | audit log + AI action log (input/intent/confidence/confirmed_by) | `tbl_ai_usage` เก็บแค่ token/ms/ok · log งานอยู่ 2 ตารางแยก | ขาด `tbl_ai_action` ที่ตรวจย้อนได้ว่า AI ตัดสินใจอะไร |
| §31 | REST API 20 endpoint | ไม่มี API งาน (มีแต่ endpoint ฝั่ง ksk122/bridge) | ต้องทำถ้าจะมี client อื่น |
| §32–34 | queue + retry + idempotency | webhook ทำงาน **sync ทั้งหมด** รวมเรียก Gemini ใน request เดียว | ⚠ เสี่ยง LINE timeout 10 วิ จริง |
| §20 | worker availability/skills | `tbl_line_user` มี Status/Department ไม่มี skill/availability | ขาด |
| §21 | smart assignment | ไม่มี | เฟสท้าย |
| §29 | consent / retention / export-delete | ไม่มีเอกสาร | ต้องมีก่อนแตะ GPS |

---

## 3. สิ่งที่สเปคขอ แต่ **ขัดกติกาบ้าน** (ต้องพี่เต้ตัดสินก่อน)

1. **§22 GPS tracking** — บ้านนี้มีหลัก "ห้ามติดตามแบบลับ ๆ" ตรงกับสเปค แต่ยังไม่มีระบบ consent เลย
   ⇒ ข้อเสนอ: เฟสแรก **ไม่เก็บพิกัดคน** เก็บแค่ "พิกัดของงาน" (ที่หมาย) + ปุ่มนำทาง
2. **§15 ตรวจทุก 5 นาที** — บ้านนี้ scheduler เป็น Windows Task รายงาน ไม่ใช่ daemon
   ⇒ ใช้ task ราย 5 นาทีได้ แต่ต้องกันซ้อน (บทเรียน `ghost-pm2-fork-nightly`)
3. **§2 .env** — vendor-ksk ใช้ `config/` + `lib/app_setting.php` อยู่แล้ว ไม่มี .env loader
   ⇒ ไม่ควรมีสองบ้านของ secret · เสนอคงระบบเดิม (ซึ่งไม่ hard-code อยู่แล้ว)
4. **§45 โครงโฟลเดอร์ใหม่** — ดูข้อ 0 ⇒ เสนอไม่ย้าย
5. **§13 เสียง→ข้อความ** — `ll_handle_audio()` มีอยู่แล้ว ต้องยืนยันว่าถอดเสียงไทยได้จริงแค่ไหนก่อนขยาย

---

## 4. สถาปัตยกรรมเป้าหมาย (TO-BE) — ต่อยอด ไม่รื้อ

```
                    ┌───────────────────────────────┐
LINE (worker)  ───▶ │ api/line_webhook.php          │  รับ+ตอบเร็ว (<3 วิ)
                    │  · verify signature (มีแล้ว)  │
                    │  · เขียนคิว แล้วตอบ ack ทันที │  ◀── §32 ใหม่
                    └──────────────┬────────────────┘
                                   ▼
                    ┌───────────────────────────────┐
                    │ tbl_job_queue (DB queue §33)  │  idempotency_key §34
                    └──────────────┬────────────────┘
                                   ▼  worker: bin/queue_run.php (Scheduled Task ทุก 1 นาที)
        ┌──────────────────────────┴───────────────────────────┐
        ▼                          ▼                           ▼
 lib/ai_command.php        lib/task_engine.php          lib/notify.php
 (NLU + policy §5,§6)      (state machine §8)           (มีแล้ว — ห้ามแตกบ้านที่ 2)
        │                          │
        └────────────┬─────────────┘
                     ▼
        tbl_task / tbl_task_log / tbl_ai_action (audit §25,§27)
                     ▼
        tasks.php (เว็บหัวหน้า — มีแล้ว) + AI chat §19
```

**หลักการที่จะไม่ทำลายของเดิม**
- ตรรกะใหม่ทั้งหมดอยู่ใน `lib/*.php` ใหม่ — `line_webhook.php` แค่เรียก (ไฟล์ 2,443 บรรทัดห้ามโตอีก)
- สถานะใหม่เพิ่มท้าย ENUM ไม่แตะค่าที่มีอยู่ (งาน 20 ใบยังอ่านได้เหมือนเดิม)
- ทุก migration เพิ่มคอลัมน์แบบ nullable — ของเดิมไม่พัง
- แจ้งเตือนทุกชนิดผ่าน `notify.php` ที่เดียว (กติกา `notify-center-single-source`)

---

## 5. Definition of Done ที่บ้านนี้บังคับเพิ่มจากสเปค §47
- ผ่าน `bin/smoke_tasks_render.php` (36/36) และยามใหม่ของงานนี้
- ผ่าน code-reviewer + รายงานผลตรวจให้พี่เต้เห็น (กติกาข้อ 5)
- vendor-ksk = แก้แล้วมีผลทันที **ไม่มีขั้น build** ⇒ ทดสอบก่อนเซฟเสมอ
- ถ้าแตะ FIM (Node) ต้อง `scripts\deploy.ps1` เท่านั้น
