# aim (AI Manager) — ทางเข้าสำหรับ AI agent

> ## 📋 งานของคุณอยู่ที่ [`docs/QUEUE.md`](docs/QUEUE.md) — เปิดอันนั้นก่อน
> ## 📖 กติกาทั้งหมดอยู่ที่ [`CLAUDE.md`](CLAUDE.md) — อ่านให้จบก่อนแตะอะไร
> **ห้ามคัดลอกกฎจาก `CLAUDE.md` มาไว้ที่นี่** — ระบบนี้เจ็บจากการมีตรรกะเรื่องเดียวกันสองที่มาหลายรอบแล้ว

ระบบนี้ **เดินอยู่บน production จริง** — Cloudflare Worker `aim-ingest` + D1 `aim-db`
ตอบคำถามและส่งสรุปถึงคนจริงผ่าน LINE ทุกวัน · ของที่พังที่นี่ คนเห็นทันที

---

## อ่านตามลำดับนี้

| ลำดับ | ไฟล์ | ได้อะไร |
|---|---|---|
| 1 | [`docs/QUEUE.md`](docs/QUEUE.md) | **คิวงาน** — หยิบใบบนสุดที่ยังไม่มีคนทำ · ข้อห้าม 6 ข้อ · ประตูที่ต้องรัน |
| 2 | [`CLAUDE.md`](CLAUDE.md) | กติกาประจำรีโป · คำสั่งที่แตะของจริง · กับดักที่จ่ายค่าเรียนไปแล้ว |
| 3 | [`docs/DECISIONS_P0.md`](docs/DECISIONS_P0.md) | **คำตัดสินที่ปิดไปแล้ว — ห้ามรื้อโดยไม่มีข้อเท็จจริงใหม่** |
| 4 | [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) §6 | ลำดับเฟสและประตู — **ห้ามข้ามประตู** |
| 5 | `docs/WORK_PACKAGES_P*.md` | ใบสั่งงานรายเฟส (รายละเอียดของสิ่งที่ QUEUE ชี้ไป) |

⚠ งานฝั่ง PHP อยู่คนละที่: `C:\WebApp\vendor-ksk` (มี `AGENTS.md` และ `CLAUDE.md` ของตัวเอง)
โฟลเดอร์ `bridge/` ที่นี่เป็น **สำเนา staging เท่านั้น ไม่ใช่ของที่รันจริง**

---

## แบ่งบทบาท (จาก IMPLEMENTATION_PLAN.md §7)

| ใคร | ทำอะไร |
|---|---|
| **Claude** | สถาปัตยกรรม · เขียนใบสั่งงาน · **ตรวจงาน** · ตัดสินเมื่อชนกติกาบ้าน |
| **Codex (คุณ)** | เขียนโค้ด Worker/บริการ/เทส/migration — **ห้ามตรวจงานตัวเอง** |

ทำเสร็จแล้ว commit + push แล้วบอกว่าทำใบไหน · **ต้องรายงานว่าพิสูจน์ยังไงว่ายามตกได้จริง**
(sabotage อะไร → ตกกี่ข้อ → คืน → ผ่านเท่าไร) ไม่ใช่แค่ "เขียวแล้ว"

---

## ก่อนบอกว่าเสร็จ ต้องรันครบ

```powershell
npm run typecheck ; npm test ; npm run lint ; npm run db:migration:check
```
ฝั่ง PHP (ถ้าใบสั่งแตะ `C:\WebApp\vendor-ksk`):
```powershell
php bin/aim_reconcile.php ; php bin/selfcheck.php --dry
php bin/smoke_escalation.php ; php bin/smoke_reconcile_streak.php
php bin/smoke_aim_ask.php ; php bin/smoke_aim_notify.php ; php bin/smoke_tasks_render.php
```
**จำนวนเทสห้ามลดลง** — ตัวเลขปัจจุบันอยู่ใน `docs/QUEUE.md`

---

## คำสั่งที่แตะของจริง — คิดก่อนพิมพ์

| คำสั่ง | ผลต่อของจริง |
|---|---|
| `npm run deploy` | **เปลี่ยนโค้ดที่คนใช้อยู่ทันที** |
| `npm run db:migrate:remote` | แก้ฐาน production |
| `php bin/task_escalate.php` (ไม่มี `--test`) | **ส่ง LINE ถึงพนักงานจริง** |
| `php bin/aim_summary_to_group.php` (ไม่มี `--dry`) | ส่งเข้ากลุ่ม LINE จริง |

ทดสอบใช้ `--dry` หรือ `--test` เสมอ · `--test` ส่งถึงเจ้าของระบบคนเดียวและไม่จดลงฐาน

---

## ตรวจสถานะเร็ว ๆ (อ่านอย่างเดียว ปลอดภัย)

```powershell
curl https://aim-ingest.mottosolar.workers.dev/healthz
php C:\WebApp\vendor-ksk\bin\aim_reconcile.php --streak   # P4 ผ่านประตูหรือยัง
php C:\WebApp\vendor-ksk\bin\selfcheck.php --dry          # ยามทั้ง estate
```
