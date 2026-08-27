# ใบสั่งงาน P1 — งาน + สถานะ 12 + วงจรรับ/ปฏิเสธ/ถึงแล้ว/ปิดงาน

เขียน 2026-08-27 · ต่อจาก P0 (deploy จริงแล้ว ผ่าน code-reviewer แล้ว)

## 0. จุดตัดสินสถาปัตยกรรมที่บังคับไว้แล้ว (ไม่ใช่ทางเลือก — พิสูจน์จากข้อมูลจริง)

**พนักงานทั้ง 11 คนผูก LINE ไว้กับ OA เดียว: KSK.122 (น้องกุ้ง) ที่ vendor-ksk ถือ token อยู่**
(ตรวจฐานจริง: `tbl_line_user` active=11 — VERIFIED 2026-08-27)

⇒ **คลาวด์ส่งการ์ดงานหาพนักงานตรง ๆ ไม่ได้** ต้อง "สั่ง" ให้ vendor-ksk เป็นคนส่งแทนเสมอ
⇒ สถาปัตยกรรมของ P1 จึงเป็นวงจรสองทาง (P0 มีแค่ทางเดียว: PHP → คลาวด์):

```
①  หัวหน้าสั่งงาน (LINE/เว็บ) ─────▶ vendor-ksk (มีอยู่แล้ว บางส่วน)
②  vendor-ksk fan-out event ──────▶ คลาวด์ (aim_forward_events — มีแล้วจาก P0-5)
③  คลาวด์ตัดสิน "ต้องแจ้งใคร" ─────▶ เขียนคิว "ต้องพูด" (ใหม่ใน P1)
④  Cron คลาวด์หยิบคิว "ต้องพูด" ───▶ เรียก endpoint ใหม่บน vendor-ksk (ใหม่ใน P1 — ⚠ แตะ LIVE)
⑤  vendor-ksk ส่ง Flex การ์ดจริงหาพนักงานที่ระบุ (ใช้ฟังก์ชันเดิมที่มีอยู่แล้ว)
⑥  พนักงานกดปุ่ม → postback เข้า vendor-ksk ──▶ fan-out กลับเข้าคลาวด์ (③ วนซ้ำ)
```

**หลักการ:** คลาวด์ (D1) ยังเป็น **source of truth เดียวของสถานะงาน** ตามที่ตั้งไว้ตั้งแต่ ARCHITECTURE.md
vendor-ksk เป็นแค่ "ปาก" (ส่ง/รับ LINE) ไม่เก็บสถานะงานคู่ขนานเอง — กันปัญหา "สองความจริง" ที่กติกาบ้านเตือนไว้ซ้ำ ๆ

## 1. แบ่งเป็น 2 ชุดงาน — ชุดแรกปลอดภัย (คลาวด์ล้วน) ชุดสองแตะ LIVE อีกครั้ง

### ชุด A — เครื่องยนต์งาน (คลาวด์ล้วน ไม่แตะ vendor-ksk เลย)
ทำได้ทันที ทดสอบได้ครบในเครื่อง ไม่มีความเสี่ยงต่อระบบเดิม

### ชุด B — วงจรสั่งการ์ดจริง (แตะ vendor-ksk อีกครั้ง)
รอชุด A เสร็จ+ตรวจผ่านก่อน แล้วขออนุมัติแยกเหมือน WP-P0-5

---

## WP-P1-A1 · Schema งาน (D1)

**ตารางใหม่ 2 ตาราง** เพิ่มเข้า `schema/migrations/0002_task.sql` (migration ใหม่ ไม่แก้ไฟล์เดิม):

```sql
CREATE TABLE IF NOT EXISTS task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_ref TEXT NOT NULL UNIQUE,           -- ULID สร้างเอง (ไม่ชนกับ event_id ฝั่ง inbox)
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',    -- ดู §2 รายการสถานะ
  assignee_person_code TEXT,               -- FK -> person.person_code, NULL จนกว่าจะมอบหมายสำเร็จ
  creator_person_code TEXT,
  priority TEXT NOT NULL DEFAULT 'normal', -- low | normal | high | urgent
  scheduled_at TEXT,
  due_at TEXT,
  location_text TEXT,
  location_lat REAL,
  location_lng REAL,
  accepted_at TEXT,
  started_at TEXT,       -- = en_route
  arrived_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  completion_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (assignee_person_code) REFERENCES person (person_code) ON DELETE SET NULL,
  FOREIGN KEY (creator_person_code) REFERENCES person (person_code) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_task_status_due ON task (status, due_at);
CREATE INDEX IF NOT EXISTS idx_task_assignee ON task (assignee_person_code, status);

CREATE TABLE IF NOT EXISTS task_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_ref TEXT NOT NULL,
  actor_person_code TEXT,
  old_status TEXT,
  new_status TEXT NOT NULL,
  source TEXT NOT NULL,      -- line | web | ai | system
  note TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (task_ref) REFERENCES task (task_ref) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_task_event_ref ON task_event (task_ref, occurred_at);

CREATE TABLE IF NOT EXISTS outbound_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- task_card | task_update (ขยายได้ในอนาคต)
  task_ref TEXT NOT NULL,
  target_person_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT NOT NULL,
  idem_key TEXT NOT NULL UNIQUE,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (task_ref) REFERENCES task (task_ref) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_outbound_pick ON outbound_queue (status, next_run_at);
```

**หมายเหตุสำคัญ (D-P0-06):** ยามอัตโนมัติกันข้อมูลบุคคลถูกถอดไปแล้วตามคำสั่งเจ้าของระบบ — `title`/`description`
เก็บเนื้อหาจริงได้ (เจ้าของระบบยืนยันแล้วว่ากลุ่มทดสอบไม่มีข้อมูลบุคคลจริงปนอยู่) **แต่ผู้ตรวจ (Claude/code-reviewer)
ยังต้องตรวจด้วยตาทุกครั้งที่มี migration ใหม่** ตามที่บันทึกไว้ใน D-P0-06

## WP-P1-A2 · State machine (12 สถานะ ตาม ARCHITECTURE.md)

**สถานะที่เก็บจริง (10 ค่า):** `draft, assigned, accepted, rejected, en_route, arrived, in_progress, blocked, completed, cancelled`
**สถานะที่อนุมาน ไม่เก็บ (ตามกติกาบ้าน `overdue-is-derived-state`):** `overdue` = `due_at < now() AND status ไม่ใช่ completed/cancelled/rejected` — คำนวณตอน query เท่านั้น ห้ามเก็บเป็นคอลัมน์
**`pending_confirmation`** = ไม่ใช่ค่าสถานะแยก — คือ `draft` ระหว่างรอยืนยัน (เหมือนที่ตัดสินใน DATABASE_SCHEMA.md เดิม)

**Transition ที่อนุญาต (ไฟล์ใหม่ `worker/src/taskMachine.ts`):**
```
draft        → assigned
assigned     → accepted | rejected
accepted     → en_route | cancelled
en_route     → arrived
arrived      → in_progress
in_progress  → completed | blocked
blocked      → in_progress | cancelled
```
ทุก transition อื่นนอกลิสต์นี้ = ปฏิเสธ (throw error พร้อมบอกสถานะปัจจุบันกับสถานะที่ขอ)

**ฟังก์ชันที่ต้องมี:**
- `isValidTransition(from: string, to: string): boolean`
- `applyTransition(db, taskRef, toStatus, actorPersonCode, source, note, now): Promise<Task>` —
  เขียน `task_event` เสมอทุกครั้งที่เปลี่ยนสถานะสำเร็จ (who/when/old/new/source/note ตามที่ ARCHITECTURE.md §8 กำหนด)
  ถ้า transition ไม่ถูกต้อง → throw ก่อนเขียนอะไรลงฐานเลย (all-or-nothing)
- `deriveOverdue(task, now): boolean` — คำนวณสด ไม่เก็บ

## WP-P1-A3 · เทส
ครอบทุก transition ที่อนุญาต + ทุก transition ที่ต้องถูกปฏิเสธอย่างน้อย 1 เคสต่อคู่ + `deriveOverdue` ตรงเงื่อนไข
+ `task_event` ถูกเขียนถูกต้องทุกครั้งที่ transition สำเร็จ + ไม่เขียนอะไรเลยถ้า transition ถูกปฏิเสธ

---

## WP-P1-B1 · endpoint ใหม่บน vendor-ksk (⚠ แตะ LIVE — รอคำอนุมัติแยก ยังไม่ทำตอนนี้)
บันทึกไว้ล่วงหน้าเพื่อวางแผน ไม่ใช่คำสั่งให้ลงมือ:
- `api/aim_notify.php` (ไฟล์ใหม่) — รับคำสั่งจากคลาวด์ (ยืนยันตัวตนด้วย key ร่วมแบบเดียวกับ P0-5)
  บอกว่า "ส่งการ์ดงาน X ให้พนักงานรหัส Y" → เรียกฟังก์ชันส่ง Flex การ์ดที่มีอยู่แล้วในระบบ (ดูแพทเทิร์น `tk_flex_card`)
- ต้องมีตาราง map `person_code` (ฝั่งคลาวด์) ↔ `Line_User_ID`/`User_ID` จริง (ฝั่ง vendor-ksk) — คลาวด์ไม่ควรรู้จัก
  ใครเป็นใครโดยตรง เห็นแค่รหัส
- postback จากปุ่มบนการ์ด (รับ/ปฏิเสธ/ถึงแล้ว) ต้อง fan-out กลับเข้าคลาวด์ผ่าน `aim_forward_events()` เดิม —
  **ต้องขยาย filter ใน `lib/aim_forward.php` จาก "เฉพาะ groupId ตรงกลุ่มทดสอบ" เป็น "หรือ postback ที่มี prefix
  เฉพาะของ AIM"** เพราะ postback จาก 1:1 chat ไม่มี groupId เลย — filter เดิมจะไม่มีวันจับ event พวกนี้ได้

---

## ลำดับที่แนะนำ
1. WP-P1-A1 + A2 + A3 (คลาวด์ล้วน) → deploy → code-reviewer ตรวจ
2. หยุดพัก ให้เจ้าของระบบทดสอบผ่าน API เปล่า ๆ ก่อน (ยังไม่มีการ์ด LINE จริง)
3. ค่อยขออนุมัติ WP-P1-B1 แยกต่างหาก เหมือนที่ทำกับ WP-P0-5
