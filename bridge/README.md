# bridge — เหลือเฉพาะ config ตัวอย่าง (ไม่มีสำเนาโค้ดแล้ว)

โฟลเดอร์นี้เก็บ **config ตัวอย่างที่ไม่มี secret จริง** เท่านั้น
โค้ดฝั่ง LIVE ทั้งหมดมีบ้านเดียวคือ `C:\WebApp\vendor-ksk\` — อ่านและแก้ที่นั่นเสมอ

| ของจริงที่รันอยู่ | ยามที่เฝ้ามัน |
|---|---|
| `vendor-ksk/lib/aim_forward.php` | `vendor-ksk/bin/smoke_aim_forward.php` (16 ข้อ) |
| `vendor-ksk/lib/aim_ask.php` | `vendor-ksk/bin/smoke_aim_ask.php` (29 ข้อ) |
| `vendor-ksk/lib/aim_notify.php` · `vendor-ksk/api/aim_notify.php` | — |
| `vendor-ksk/bin/aim_link_person.php` | — |

## ทำไมสำเนาโค้ดถูกลบ (2026-08-28)

เคยมี `aim_forward.php` · `aim_notify.php` · `api_aim_notify.php` และเทส `.ps1` วางไว้ที่นี่เป็น staging
**แล้วมันเบี่ยงจากของจริงจนอันตราย** — วัดวันที่ลบ: `aim_forward.php` ต่าง 12 บรรทัด ·
`api_aim_notify.php` ต่าง 9 บรรทัดและ **ขาดแพตช์ `is_scalar` ทั้ง 3 จุด** ที่ code-reviewer สั่งแก้
(กัน type-confusion ทำ path ของเซิร์ฟเวอร์หลุด — D-P0-10) ⇒ ใครก๊อปทับของจริงคือย้อนแพตช์ความปลอดภัยทิ้ง

ซ้ำร้าย `test_aim_forward.ps1` อ่านไฟล์จาก **โฟลเดอร์นี้** ไม่ใช่ไฟล์ที่รันจริง ⇒ เป็นยามที่เฝ้าผิดตัว
และให้ความมั่นใจปลอม · ตอนนี้ยามตัวจริงอยู่ที่ `vendor-ksk/bin/smoke_aim_*.php` ซึ่งเทสต์ไฟล์ที่รันจริง
และพิสูจน์แล้วว่า**ตกได้จริง** (ซ่อนคอนฟิก/ขยาย timeout แล้วยามตกทันที)

**กติกา: ห้ามเอาสำเนาโค้ดกลับมาวางที่นี่อีก** — สำเนา = ความจริงสองชุด คือรากบั๊กหนักสุดของ estate นี้

1. `aim_forward.php` ถูกคัดลอกไปที่ `C:\WebApp\vendor-ksk\lib\aim_forward.php` (ไม่ใช่ `api/` — เป็นไลบรารีฟังก์ชัน ไม่ใช่ endpoint ของตัวเอง)
2. `aim.credentials.example.php` ถูกคัดลอกไปเป็น `C:\WebApp\vendor-ksk\config\aim.credentials.php` (ไม่เข้า git ตาม pattern `config/*.credentials.php` ที่มีอยู่แล้ว) พร้อมค่าจริง
3. `api/line_webhook.php` มี `require_once __DIR__ . '/../lib/aim_forward.php';` และเรียก `aim_forward_events($events);` หลัง `ll_verify_signature()` ผ่านแล้ว ก่อน `foreach` ประมวลผล event จริง — ค้นคำว่า "WP-P0-5" ในไฟล์นั้นเพื่อหาตำแหน่ง
4. `enabled => true` พร้อม `test_group_id` — ส่งออก **2 เส้นทางที่เป็นอิสระต่อกัน** (แก้ข้อความเดิมที่เขียนว่า "แชท 1:1 ไม่ถูกส่งออกเลย" ซึ่งผิดตั้งแต่ WP-P1-B3 เป็นต้นมา):
   - ข้อความในกลุ่มที่ตรงกับ `test_group_id` เท่านั้น — กลุ่มอื่นไม่ถูกส่งออก
   - postback ที่ `data` ขึ้นต้นด้วย `act=aim_` **จากที่ไหนก็ได้ รวมแชท 1:1** และไม่ขึ้นกับ `test_group_id` (ถ้าไปผูกกับค่านั้น ปุ่มที่กดในแชทส่วนตัวจะไม่มีวันถึงคลาวด์ — เคยพลาดมาแล้ว ดู D-P0-11)
5. ผ่าน code-reviewer อิสระแล้ว (ดู `docs/DECISIONS_P0.md` D-P0-07) — พบและแก้บั๊กจริง 1 จุด: `webhookEventId` ของ LINE จริงขึ้นต้นด้วยตัวเลขได้ (ULID) ต้องแก้ regex ฝั่ง Worker (`worker/src/payload.ts`) ให้รับตัวเลขนำหน้าด้วย
