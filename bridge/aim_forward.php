<?php
/**
 * ส่งสำเนา LINE event ไปยัง AI Manager (คลาวด์) แบบ fire-and-forget — WP-P0-5
 * ไม่มีทางกระทบระบบเดิม: ปิดสวิตช์ได้ทันที, timeout สั้น, กลืน error ทุกกรณี, กรองเฉพาะกลุ่มทดสอบ
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
    if ($testGroupId === '') return;   // ยังไม่ตั้งกลุ่มทดสอบ = ไม่ส่งอะไรเลย (ปลอดภัยโดยปริยาย)

    $filtered = array();
    if (is_array($events)) {
        foreach ($events as $ev) {
            $gid = (isset($ev['source']) && isset($ev['source']['groupId']))
                ? (string)$ev['source']['groupId'] : '';
            if ($gid !== '' && $gid === $testGroupId) {
                $filtered[] = $ev;
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
