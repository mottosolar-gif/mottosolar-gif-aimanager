# bridge

⚠ **โฟลเดอร์นี้เป็นสำเนา staging เท่านั้น ไม่ใช่ของที่รันจริง** ของจริงอยู่ที่ `C:\WebApp\vendor-ksk`
เสมอ — เปลี่ยนไฟล์ในนี้แล้ว **ต้องคัดลอกไปติดตั้งเองที่เครื่องนั้น** การแก้ที่นี่ไม่มีผลกับ production
โดยอัตโนมัติ และมีตัวอย่างที่เคยหลุดจริงแล้ว: `api_aim_notify.php` ในนี้ยังขาดแพตช์ `is_scalar()` 3 จุด
ที่ของจริงบน `vendor-ksk` มี — ถ้าก๊อปสำเนานี้ทับของจริงจะย้อนแพตช์ความปลอดภัยทิ้งแบบไม่มีเสียงเตือน

สะพานนี้เชื่อม LINE OA เดิม (`vendor-ksk`) กับ Worker `aim-ingest` ของ AI Manager **สองทิศทาง**

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ทิศทาง | ทำอะไร | ติดตั้งจริงที่ |
|---|---|---|---|
| `aim_forward.php` | LINE → cloud | ฟังก์ชัน `aim_forward_events($events)` ส่งสำเนา event ไป `POST /ingest/line` | `C:\WebApp\vendor-ksk\lib\aim_forward.php` |
| `aim.credentials.example.php` | — | template config ของ `aim_forward.php` (ไม่มี secret จริง) | คัดลอกเป็น `C:\WebApp\vendor-ksk\config\aim.credentials.php` พร้อมค่าจริง |
| `aim_notify.php` | cloud → LINE | ฟังก์ชัน `aim_send_task_card($lineUserId, $taskRef, $title)` ส่งการ์ดงาน + ปุ่ม รับ/ปฏิเสธ | เรียกจาก `api_aim_notify.php` |
| `api_aim_notify.php` | cloud → LINE | HTTP endpoint ที่คลาวด์เรียกเข้ามาเพื่อสั่งส่งการ์ด | ติดตั้งเป็น endpoint จริงบน `vendor-ksk` |
| `aim_notify.credentials.example.php` | — | template config ของ `api_aim_notify.php` (secret คนละตัวกับ `aim.credentials.php` โดยตั้งใจ) | คัดลอกพร้อมค่าจริง |
| `aim_person_map.example.php` | — | template ผูก `person_code` → LINE `userId` จริง (flat file ชั่วคราวสำหรับช่วงทดสอบ) | คัดลอกพร้อมค่าจริง |
| `test_aim_forward.ps1` | — | ตรวจสไตล์/โครงสร้างของ `aim_forward.php` แบบ static (ดูหมายเหตุด้านล่าง) | รันจากเครื่องนี้ |
| `test_aim_notify.ps1` | — | ตรวจสไตล์/โครงสร้างของอีก 4 ไฟล์ฝั่ง notify แบบ static | รันจากเครื่องนี้ |

## ขาไป: LINE → cloud (`aim_forward.php`)

**สถานะ: ติดตั้งแล้วจริงบน production**

1. `aim_forward.php` ถูกคัดลอกไปที่ `C:\WebApp\vendor-ksk\lib\aim_forward.php` (ไม่ใช่ `api/` —
   เป็นไลบรารีฟังก์ชัน ไม่ใช่ endpoint ของตัวเอง)
2. `aim.credentials.example.php` ถูกคัดลอกไปเป็น `C:\WebApp\vendor-ksk\config\aim.credentials.php`
   (ไม่เข้า git ตาม pattern `config/*.credentials.php` ที่มีอยู่แล้ว) พร้อมค่าจริง
3. `api/line_webhook.php` มี `require_once __DIR__ . '/../lib/aim_forward.php';` และเรียก
   `aim_forward_events($events);` หลัง `ll_verify_signature()` ผ่านแล้ว ก่อน `foreach` ประมวลผล event จริง —
   ค้นคำว่า "WP-P0-5" ในไฟล์นั้นเพื่อหาตำแหน่ง
4. ฟังก์ชันนี้ส่งออกจาก **สองเส้นทางอิสระกัน**:
   - ข้อความ (`message`) จากกลุ่มที่อยู่ในรายการที่อนุญาต — `test_group_id` (ค่าเดียว) หรือ `ask_group_ids` (หลายค่า)
     ตัดสินที่ `aim_ask_allowed_groups()` ที่เดียว · group id ที่ผิดรูปถูกทิ้ง ไม่ปล่อยผ่าน
     (ถ้า `test_group_id` ว่าง เส้นทางนี้ไม่ส่งอะไรเลย)
   - postback ที่ `postback.data` ขึ้นต้นด้วย `act=aim_` — เส้นทางนี้ส่งออก **ไม่ว่าจะมาจากแชท 1:1 /
     กลุ่ม / ห้องใดก็ตาม และไม่ขึ้นกับ `test_group_id`** (เพิ่มเข้ามาที่ WP-P1-B3 — ก่อนหน้านั้นมีแค่
     เส้นทางกลุ่มทดสอบเท่านั้น)
5. ทุกการเรียก HTTP ห่อด้วย `@`-suppression + `try/catch (Throwable $e)` และ timeout 1500ms —
   คลาวด์ล่มจะไม่มีทางทำให้ webhook ของ LINE เดิมพัง log (`ll_log`) บันทึกแค่ HTTP status + จำนวน event
   ไม่เคยบันทึกเนื้อหา event
6. ผ่านตรวจอิสระแล้ว (`docs/DECISIONS_P0.md` **D-P0-07**) — รอบนั้นไม่พบ finding ระดับ Critical/High
   จากการอ่านโค้ด แต่บั๊กจริงที่เจอทีหลัง (**D-P0-08**) มาจาก log การใช้งานจริงวันแรก ไม่ใช่จากรอบตรวจโค้ด:
   `webhookEventId` ของ LINE จริงเป็น ULID ซึ่งขึ้นต้นด้วยตัวเลขได้ แต่ regex เดิมฝั่ง Worker บังคับให้ขึ้นต้น
   ด้วยตัวอักษร ⇒ event จริงถูกปฏิเสธหมดตั้งแต่วันแรกที่ deploy โดยไม่มีใครรู้ แก้แล้วที่
   `worker/src/payload.ts` และยืนยันด้วยของจริงแล้ว

## ขากลับ: cloud → LINE (`aim_notify.php` + `api_aim_notify.php`)

**สถานะ: ติดตั้งแล้วจริงบน production** (WP-P1-B2, ตรวจอิสระผ่านที่ **D-P0-10**)

1. `api_aim_notify.php` เป็น HTTP endpoint ที่คลาวด์ (Worker) เรียกเข้ามาเมื่อจะสั่งส่งการ์ดงานหาใครสักคน —
   authenticate ด้วย `hash_equals((string)$cfg['notify_key'], $_SERVER['HTTP_X_AIM_NOTIFY_KEY'])`
   (`notify_key` เป็น **secret คนละตัว** กับ `aim.credentials.php` โดยตั้งใจ เพราะเป็นคนละทิศทาง)
2. รับ JSON body ที่ต้องมี `person_code`, `task_ref`, `title` — แปลง `person_code` เป็น LINE `userId` จริง
   ผ่าน `aim_person_map.php` (404 ถ้าไม่พบ) แล้วเรียก `aim_send_task_card()`
3. `aim_send_task_card()` สร้างข้อความ + ปุ่ม quick-reply สองปุ่ม ("✅ รับงาน" / "❌ ปฏิเสธ") ที่มี
   `data` เป็น `act=aim_accept&task=<task_ref>` / `act=aim_reject&task=<task_ref>` — ตรงกับ prefix
   `act=aim_` ที่ `aim_forward.php` เส้นทางที่สองดักส่งกลับเข้าคลาวด์ (วนครบวงจร กด → ส่งกลับ → เปลี่ยนสถานะ)
   ส่งผ่าน `ll_line_push_to()` เดิม ไม่มีกลไกส่ง LINE ใหม่
4. `task_ref` ถูก sanitize (`preg_replace('/[^A-Za-z0-9_-]/', '', ...)`) ก่อนใช้เสมอ, `title` ถูกตัดที่
   200 ตัวอักษร (UTF-8 safe)
5. WP-P1-B3 ขยายเส้นทางนี้ให้ใช้ได้จากแชท 1:1 ด้วย (ไม่ใช่แค่กลุ่มทดสอบ) — ผ่านตรวจอิสระรอบที่สองที่
   **D-P0-11** พบและแก้บั๊ก early-return ที่จะทำให้ postback forwarding ทั้งหมดตายเงียบ ๆ พร้อมเพิ่ม
   `is_scalar()` guard วงจรเต็ม LINE ↔ cloud ↔ LINE นี้ถูกพิสูจน์ด้วยข้อมูลจริง (พนักงานกดปุ่มจริงบนมือถือ)
   แล้วที่ **D-P0-12**

## การตรวจ (`test_aim_forward.ps1` / `test_aim_notify.ps1`)

สคริปต์ทั้งสองเป็น **การตรวจสไตล์/โครงสร้างซอร์สแบบ static (regex ต่อ source text) ไม่ใช่การรันจริง**
— ไม่ได้ยิง HTTP หรือเรียกฟังก์ชันจริง ตรวจ เช่น: ไม่มี arrow function/`??=`/`declare(strict_types)`/
typed property/typed return (PHP 8.1.9 ของจริงรันสิ่งเหล่านี้ได้สบาย แต่เทสไม่ให้ผ่าน — **ตั้งใจให้เข้ากับ
สไตล์โค้ดเดิมของ vendor-ksk** ไม่ใช่ข้อจำกัดของ runtime), `notify_key`/`ingest_key` ต้องไม่ถูก log หรือ
echo ที่ไหนเลย, ต้อง sanitize ก่อนใช้เสมอ (ตรวจลำดับโดยตำแหน่งในไฟล์ ไม่ใช่แค่ว่ามีบรรทัดนั้นอยู่)

⚠ สคริปต์เหล่านี้ตรวจ**สำเนาในโฟลเดอร์นี้** ไม่ใช่ไฟล์ที่รันจริงบน `vendor-ksk` — ยามไม่ได้เฝ้าของจริง
ถ้าแก้ของจริงตรง ๆ บนเครื่องนั้นโดยไม่เอากลับมา sync ที่นี่ เทสนี้จะไม่รู้เลย
