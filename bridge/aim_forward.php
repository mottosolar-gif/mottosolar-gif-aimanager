<?php
/**
 * ส่งสำเนา LINE event ไปยัง AI Manager (คลาวด์) แบบ fire-and-forget — WP-P0-5
 * ไม่มีทางกระทบระบบเดิม: ปิดสวิตช์ได้ทันที, timeout สั้น, กลืน error ทุกกรณี
 * กรอง 2 ทางที่เป็นอิสระต่อกัน (WP-P1-B3): (1) ข้อความในกลุ่มทดสอบ — ทำงานเฉพาะเมื่อตั้ง test_group_id ไว้
 * (2) postback ที่มาจากการ์ด AI Manager เอง — ทำงานเสมอ ไม่ขึ้นกับ test_group_id
 *
 * ต้องเรียกหลัง ll_verify_signature() ผ่านแล้ว และก่อน foreach ประมวลผล event จริง
 * อ่าน config จาก config/aim.credentials.php (ไฟล์นี้ไม่เข้า git — เหมือน scrapbot.credentials.php)
 */
function aim_forward_events($events)
{
    static $cfg = null;
    if ($cfg === null) {
        $loaded = @include __DIR__ . '/../config/aim.credentials.php';
        $cfg = is_array($loaded) ? $loaded : array('enabled' => false);
    }

    if (empty($cfg['enabled'])) return;
    if (empty($cfg['endpoint']) || empty($cfg['ingest_key'])) return;

    $testGroupId = isset($cfg['test_group_id']) ? (string)$cfg['test_group_id'] : '';

    $filtered = array();
    if (is_array($events)) {
        foreach ($events as $ev) {
            // เส้นทางที่ 1: ข้อความในกลุ่มทดสอบ — ทำงานเฉพาะเมื่อตั้ง test_group_id ไว้เท่านั้น (ยังไม่ตั้ง =
            // ยังไม่พร้อมทดสอบกลุ่ม แต่ต้องไม่กระทบเส้นทางที่ 2 ด้านล่าง — นี่คือจุดที่ code-reviewer แก้ไว้)
            if ($testGroupId !== '') {
                $gid = (isset($ev['source']) && isset($ev['source']['groupId']) && is_scalar($ev['source']['groupId']))
                    ? (string)$ev['source']['groupId'] : '';
                if ($gid !== '' && $gid === $testGroupId) {
                    $filtered[] = $ev;
                    continue;
                }
            }

            // เส้นทางที่ 2 (WP-P1-B3): postback จากการ์ดที่ AI Manager ส่งเอง (data ขึ้นต้น act=aim_) forward
            // เสมอ ไม่ว่าจะมาจากแชท 1:1/กลุ่ม/ห้อง และไม่ขึ้นกับ test_group_id ข้างบน — data string นี้
            // vendor-ksk เป็นคนกำหนดเองตอนสร้างการ์ด (aim_send_task_card) ผู้ใช้แตะปุ่มใน LINE app ปลอมค่านี้
            // เองไม่ได้ · ownership บังคับซ้ำอีกชั้นที่ฝั่งคลาวด์แล้ว (taskMachine.ts applyTransition)
            $evType = (isset($ev['type']) && is_scalar($ev['type'])) ? (string)$ev['type'] : '';
            if ($evType === 'postback'
                && isset($ev['postback']) && isset($ev['postback']['data'])
                && is_scalar($ev['postback']['data'])
            ) {
                $pbData = (string)$ev['postback']['data'];
                if (strpos($pbData, 'act=aim_') === 0) {
                    $filtered[] = $ev;
                }
            }
        }
    }
    if (!$filtered) return;

    try {
        $payload = json_encode(array('events' => $filtered), JSON_UNESCAPED_UNICODE);
        if ($payload === false) return;

        $ch = @curl_init($cfg['endpoint']);
        if ($ch === false) return;

        @curl_setopt_array($ch, array(
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => array(
                'Content-Type: application/json',
                'X-AIM-Key: ' . $cfg['ingest_key'],
            ),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT_MS        => 1500,
            CURLOPT_CONNECTTIMEOUT_MS => 1500,
            CURLOPT_SSL_VERIFYPEER    => true,
        ));
        if (!empty($cfg['cacert']) && is_file($cfg['cacert'])) {
            @curl_setopt($ch, CURLOPT_CAINFO, $cfg['cacert']);
        }

        @curl_exec($ch);
        $code = (int)@curl_getinfo($ch, CURLINFO_HTTP_CODE);
        @curl_close($ch);

        if (function_exists('ll_log')) {
            @ll_log('aim_forward: HTTP ' . $code . ' (' . count($filtered) . ' event(s))');
        }
    } catch (Throwable $e) {
        if (function_exists('ll_log')) {
            @ll_log('aim_forward error: ' . get_class($e) . ': ' . $e->getMessage());
        }
    }
}
