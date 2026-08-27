# DATABASE_SCHEMA — AI Manager (ตอบสเปค §7, §20, §25, §26, §27)
สร้าง 2026-08-26 · **ยังไม่รัน migration ใด ๆ** (กติกาบ้าน ข้อ 1: ห้ามแตะฐานจริงก่อนอนุมัติ)

ฐาน: `db_customs` (vendor-ksk) — ระบบงาน/LINE อยู่ที่นี่ทั้งหมด
FIM (`db_fim`) เป็นคนละบ้าน = คลัง/ศุลกากร **ห้ามเอางาน HR/งานหน้างานไปปน**

---

## A. ตารางที่ "มีอยู่แล้ว" และแมปตรงกับสเปค

| สเปค §26 ขอ | ของจริงในบ้าน | หมายเหตุ |
|---|---|---|
| users | `tbl_user` (ของ CIM) | ผู้ใช้ทั้ง estate ใช้ร่วมกัน |
| workers | `tbl_line_user` (active 11) | ผูก Line_User_ID ↔ User_ID + Department |
| teams | `tbl_project` + `Department` | ยังไม่มีทีมเต็มรูป |
| tasks | `tbl_task` (20 แถว) | ดู B |
| task_events | `tbl_task_log` · `tbl_site_activity_log` | 2 บ้านตามชนิดงาน |
| issues | `tbl_task` Status='blocked' + log | ยังไม่แยกตาราง |
| attachments | `tbl_task_photo` · `tbl_pack_photo` | ดู C |
| messages | `tbl_bridge_event` / LINE log | บางส่วน |
| notifications | `lib/notify.php` + `tbl_*_remind` fields | ศูนย์กลางเดียว |
| audit_logs | `tbl_task_log`, `tbl_site_activity_log`, `022_next_action_audit` | ไม่มีตารางกลาง |
| ai_actions | `tbl_ai_usage` (202 แถว) | **เก็บแค่ token/ms/ok — ไม่ใช่ audit การตัดสินใจ** |
| settings | `lib/app_setting.php` + `config/` | มีแล้ว |

---

## B. `tbl_task` — ของจริงวันนี้ vs สเปค §7

ของจริง (SHOW COLUMNS · 26 ส.ค.):
```
ID · Project_ID · Title · Assigner_User_ID · Assignee_User_ID · Due_Date
Status enum('draft','open','doing','done','blocked','cancelled')
Work_Note · Created_At · Updated_At · Done_At
Remind_Time · Last_Remind · Last_Nudge · Nudge_Count
```

สเปคขอเพิ่ม (**ข้อเสนอ — ยังไม่รัน**):
```sql
-- 041_task_ops.sql  (ทุกคอลัมน์ NULL ได้ → งาน 20 ใบเดิมไม่พัง)
ALTER TABLE tbl_task
  ADD COLUMN Description   TEXT         NULL AFTER Title,
  ADD COLUMN Priority      VARCHAR(10)  NOT NULL DEFAULT 'normal',  -- low|normal|high|urgent (VARCHAR ไม่ใช่ ENUM: sql_mode ว่าง)
  ADD COLUMN Scheduled_At  DATETIME     NULL,      -- วัน+เวลานัดหมาย (Due_Date เดิมคือ "กำหนดส่ง" คนละความหมาย)
  ADD COLUMN Location_Text VARCHAR(255) NULL,
  ADD COLUMN Location_Lat  DECIMAL(10,7) NULL,     -- พิกัด "ของงาน" ไม่ใช่ของคน
  ADD COLUMN Location_Lng  DECIMAL(10,7) NULL,
  ADD COLUMN Accepted_At   DATETIME NULL,
  ADD COLUMN Started_At    DATETIME NULL,
  ADD COLUMN Arrived_At    DATETIME NULL,
  ADD COLUMN Cancelled_At  DATETIME NULL,
  ADD COLUMN Cancel_Reason VARCHAR(255) NULL,
  ADD COLUMN Completion_Note VARCHAR(500) NULL,
  ADD KEY idx_sched (Scheduled_At);
```

**สถานะ — ข้อเสนอ (สำคัญ):** สเปคขอ 12 สถานะ ของจริงมี 6
ทางที่ปลอดภัย = **เพิ่มท้าย ENUM ไม่แตะค่าเดิม** และแมป 1:1 ให้ชัด

| สเปค | ค่าในฐาน | วิธี |
|---|---|---|
| DRAFT | `draft` | มีแล้ว |
| PENDING_CONFIRMATION | `draft` + การ์ดยืนยัน | ไม่ต้องเพิ่มค่า |
| ASSIGNED | `open` | มีแล้ว |
| ACCEPTED | **`accepted` (ใหม่)** | วันนี้กด "รับงาน" กระโดดเป็น doing ทันที |
| REJECTED | **`rejected` (ใหม่)** | วันนี้ไม่มีทางปฏิเสธเลย |
| EN_ROUTE | **`en_route` (ใหม่)** | |
| ARRIVED | **`arrived` (ใหม่)** | |
| IN_PROGRESS | `doing` | มีแล้ว |
| BLOCKED | `blocked` | มีแล้ว |
| COMPLETED | `done` | มีแล้ว |
| CANCELLED | `cancelled` | มีแล้ว |
| OVERDUE | **อนุมาน ไม่เก็บเป็นสถานะ** | เหตุผล: กติกา `overdue-is-derived-state` — overdue คำนวณจาก Due_Date ทุกคืน คนตั้งเองไม่ได้ |

⚠ **ผลกระทบต้องรู้ก่อนอนุมัติ:** ทุกจุดที่คิวรี `Status='doing'` (tasks.php · work_items.php · task_remind.php · flex card) ต้องขยายเป็นชุดสถานะ "กำลังดำเนินการ" มิฉะนั้นงานที่ `accepted/en_route/arrived` **จะหายจากจอเงียบ ๆ**
⇒ ต้องไล่แก้พร้อมกันทั้งชุด + เพิ่มยามใน smoke test

---

## C. `tbl_task_photo` — สเปค §12 ขอ metadata ครบ
```sql
-- 042_task_photo_meta.sql (ข้อเสนอ)
ALTER TABLE tbl_task_photo
  ADD COLUMN Worker_User_ID INT NULL,
  ADD COLUMN File_Hash  CHAR(64) NULL,        -- sha256 กันรูปซ้ำ/กันสลับไฟล์
  ADD COLUMN File_Bytes INT NULL,
  ADD COLUMN Taken_At   DATETIME NULL,        -- จาก EXIF ถ้ามี (ห้ามเดา = NULL)
  ADD COLUMN Gps_Lat DECIMAL(10,7) NULL,      -- เก็บก็ต่อเมื่อมี consent §29
  ADD COLUMN Gps_Lng DECIMAL(10,7) NULL,
  ADD KEY idx_hash (File_Hash);
```

---

## D. ตารางใหม่ที่สเปคบังคับ (§27 AI action log · §33 queue · §16 escalation)

```sql
-- 043_ai_action.sql — ตรวจย้อนได้ว่า AI ตัดสินใจอะไร ด้วยข้อมูลอะไร ใครยืนยัน
CREATE TABLE IF NOT EXISTS tbl_ai_action (
  ID BIGINT AUTO_INCREMENT PRIMARY KEY,
  Actor_Line_ID VARCHAR(64) NULL,
  Actor_User_ID INT NULL,
  Input_Text    TEXT NULL,              -- ข้อความต้นทาง (ตัด 500 ตามที่ webhook ตัดอยู่แล้ว)
  Intent        VARCHAR(32) NOT NULL,   -- CREATE_TASK · GET_DAILY_SUMMARY ...
  Structured    JSON NULL,              -- คำสั่งที่ AI แปลงได้
  Confidence    DECIMAL(4,3) NULL,
  Requires_Confirmation TINYINT(1) NOT NULL DEFAULT 1,
  Confirmed_By  INT NULL,
  Confirmed_At  DATETIME NULL,
  Action_Taken  VARCHAR(64) NULL,
  Result        VARCHAR(255) NULL,
  Ref_Task_ID   INT NULL,
  Created_At    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_intent (Intent, Created_At), KEY idx_task (Ref_Task_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 044_job_queue.sql — §32/§33/§34: webhook ตอบเร็ว งานหนักไปทำข้างหลัง
CREATE TABLE IF NOT EXISTS tbl_job_queue (
  ID BIGINT AUTO_INCREMENT PRIMARY KEY,
  Kind        VARCHAR(32) NOT NULL,     -- nlu_parse · line_push · ai_vision ...
  Payload     JSON NOT NULL,
  Idem_Key    VARCHAR(120) NOT NULL,    -- กัน retry สร้างงานซ้ำ (§34)
  Status      VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|running|done|failed|dead
  Attempts    INT NOT NULL DEFAULT 0,
  Next_Run_At DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- exponential backoff
  Last_Error  VARCHAR(255) NULL,
  Created_At  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idem (Idem_Key),
  KEY idx_pick (Status, Next_Run_At)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 045_escalation.sql — §16 บันได 4 ขั้น (นับจาก "เวลาเหตุการณ์จริง" ตามกติกาฐานการนับวัน)
CREATE TABLE IF NOT EXISTS tbl_escalation (
  ID BIGINT AUTO_INCREMENT PRIMARY KEY,
  Task_ID   INT NOT NULL,
  Level     TINYINT NOT NULL,           -- 1 reminder · 2 manager · 3 owner · 4 ai-advice
  Reason    VARCHAR(64) NOT NULL,       -- not_accepted · overdue · no_update · blocked_long
  Notified_To VARCHAR(120) NULL,
  Created_At DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_task_level_reason (Task_ID, Level, Reason),  -- กันเตือนซ้ำระดับเดิม
  KEY idx_task (Task_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## E. Index ที่สเปค §26 บังคับ — ตรวจแล้วมีอยู่แล้ว
`idx_assignee (Assignee_User_ID, Status)` · `idx_due (Status, Due_Date)` · `idx_project` ✅
ขาดเฉพาะ `Scheduled_At` (อยู่ใน 041 ข้างบน)

---

## F. กติกาเขียนสคีมาของบ้านนี้ (ห้ามพลาด)
1. **สถานะ/ประเภทใช้ VARCHAR ไม่ใช่ ENUM** สำหรับตารางใหม่ — `sql_mode` เครื่องนี้ว่าง ค่าหลุด ENUM กลายเป็นค่าว่างเงียบ ๆ แล้ว `execute()` ยังคืน true (บันทึกไว้ใน `029_site_activity.sql`)
   (`tbl_task` เดิมเป็น ENUM อยู่แล้ว — ขยายค่าเดิมต่อได้ แต่ต้องมี migration ชัด)
2. คอลัมน์เวลาเหตุการณ์ต้องแยกจากเวลาบันทึก — การนับอายุ/เส้นตายทุกจุดใช้ **เวลาเหตุการณ์จริง** เท่านั้น
3. ห้ามสร้างตารางวันหยุดของตัวเอง — ปฏิทินอยู่ `db_customs.tbl_holiday` บ้านเดียว (อ่านผ่าน `lib/holiday.php`)
4. ห้ามสร้างยอดคู่ขนานกับ FIM (หลักเดียวกับที่เขียนไว้ใน `034_arrival_check.sql`)
