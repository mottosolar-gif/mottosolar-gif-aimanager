-- ★ 2026-08-27: GLOB '[A-Za-z0-9=&_-]*' เดิมเช็คแค่ตัวอักษรตัวแรก (* ท้าย pattern จับคู่อะไรก็ได้ต่อจากนั้น)
--   ทดสอบยืนยันด้วย node:sqlite แล้วว่าข้อความมีช่องว่าง/ภาษาไทย/<script> หลุดผ่านได้หมดถ้าตัวแรกอยู่ในชุดที่อนุญาต
--   ต้องใช้ NOT GLOB '*[^...]*' (ปฏิเสธถ้ามีอักขระนอกชุดอยู่ที่ไหนก็ตาม) ถึงจะตรวจทั้งสตริงจริง
ALTER TABLE inbox_event ADD COLUMN postback_data TEXT
  CHECK (postback_data IS NULL OR (length(postback_data) <= 256 AND postback_data NOT GLOB '*[^A-Za-z0-9=&_-]*'));
