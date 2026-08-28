<?php
// ตัวอย่าง config สำหรับ bridge/aim_forward.php — คัดลอกไปเป็น config/aim.credentials.php
// แล้วใส่ค่าจริง (ไฟล์จริงต้องไม่เข้า git — เพิ่มใน .gitignore เหมือน scrapbot.credentials.php)
return array(
    'enabled'       => false,                          // เปิด/ปิดทั้งระบบด้วยค่าเดียว
    'endpoint'      => 'https://aim-ingest.mottosolar.workers.dev/ingest/line',
    'ingest_key'    => 'PASTE_AIM_INGEST_KEY_HERE',     // ต้องตรงกับ secret AIM_INGEST_KEY บน Worker
    'test_group_id' => '',                              // groupId ของกลุ่มทดสอบ — ว่าง = ไม่ส่งอะไรเลย
    'ask_enabled'   => false,                           // เปิดหลัง deploy /ask และตั้ง secret ทั้งสองฝั่งแล้วเท่านั้น
    'ask_endpoint'  => 'https://aim-ingest.mottosolar.workers.dev/ask',
    'ask_key'       => 'PASTE_AIM_ASK_KEY_HERE',        // คนละค่ากับ AIM_INGEST_KEY โดยเจตนา
    'cacert'        => 'C:/WebApp/cim/chcustoms/admin/cacert.pem',
);
