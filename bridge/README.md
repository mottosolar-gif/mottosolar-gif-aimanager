# bridge

`aim_forward.php` ส่งสำเนา LINE event ของกลุ่มทดสอบไปยัง AI Manager แบบ fire-and-forget และ `aim.credentials.example.php` เป็น config ตัวอย่างที่ไม่มี secret จริง

**สถานะ: ติดตั้งแล้วจริงบน production (2026-08-27)**

1. `aim_forward.php` ถูกคัดลอกไปที่ `C:\WebApp\vendor-ksk\lib\aim_forward.php` (ไม่ใช่ `api/` — เป็นไลบรารีฟังก์ชัน ไม่ใช่ endpoint ของตัวเอง)
2. `aim.credentials.example.php` ถูกคัดลอกไปเป็น `C:\WebApp\vendor-ksk\config\aim.credentials.php` (ไม่เข้า git ตาม pattern `config/*.credentials.php` ที่มีอยู่แล้ว) พร้อมค่าจริง
3. `api/line_webhook.php` มี `require_once __DIR__ . '/../lib/aim_forward.php';` และเรียก `aim_forward_events($events);` หลัง `ll_verify_signature()` ผ่านแล้ว ก่อน `foreach` ประมวลผล event จริง — ค้นคำว่า "WP-P0-5" ในไฟล์นั้นเพื่อหาตำแหน่ง
4. `enabled => true` พร้อม `test_group_id` ของกลุ่มทดสอบจริงแล้ว — ส่งเฉพาะ event จากกลุ่มนั้นเท่านั้น กลุ่มอื่น/แชท 1:1 ไม่ถูกส่งออกเลย
5. ผ่าน code-reviewer อิสระแล้ว (ดู `docs/DECISIONS_P0.md` D-P0-07) — พบและแก้บั๊กจริง 1 จุด: `webhookEventId` ของ LINE จริงขึ้นต้นด้วยตัวเลขได้ (ULID) ต้องแก้ regex ฝั่ง Worker (`worker/src/payload.ts`) ให้รับตัวเลขนำหน้าด้วย
