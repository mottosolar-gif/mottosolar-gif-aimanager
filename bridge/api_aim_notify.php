<?php
/**
 * รับคำสั่งจากคลาวด์ (AI Manager) ให้ส่งการ์ดงานจริงหาพนักงาน — WP-P1-B2
 * ทิศทางตรงข้ามกับ api/line_webhook.php (ที่นั่นคือ LINE -> เรา -> คลาวด์, ที่นี่คือ คลาวด์ -> เรา -> LINE)
 * ใช้กุญแจร่วมคนละดวงกับ aim.credentials.php (aim_forward.php) โดยเจตนา
 */
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/line_leave.php';   // ll_line_push_to, ll_log
require_once __DIR__ . '/../lib/aim_notify.php';   // aim_send_task_card

header('Content-Type: application/json; charset=utf-8');

$cfg = @include __DIR__ . '/../config/aim_notify.credentials.php';
if (!is_array($cfg) || empty($cfg['enabled']) || empty($cfg['notify_key'])) {
    http_response_code(503);
    echo json_encode(array('ok' => false, 'next' => 'service not configured'));
    exit;
}

$suppliedKey = isset($_SERVER['HTTP_X_AIM_NOTIFY_KEY']) ? (string)$_SERVER['HTTP_X_AIM_NOTIFY_KEY'] : '';
if (!hash_equals((string)$cfg['notify_key'], $suppliedKey)) {
    http_response_code(403);
    echo json_encode(array('ok' => false, 'next' => 'invalid credentials'));
    exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(array('ok' => false, 'next' => 'send valid JSON body'));
    exit;
}

$personCode = isset($data['person_code']) ? (string)$data['person_code'] : '';
$taskRef = isset($data['task_ref']) ? (string)$data['task_ref'] : '';
$title = isset($data['title']) ? (string)$data['title'] : '';

if ($personCode === '' || $taskRef === '' || $title === '') {
    http_response_code(400);
    echo json_encode(array('ok' => false, 'next' => 'person_code, task_ref, and title are required'));
    exit;
}

$personMap = @include __DIR__ . '/../config/aim_person_map.php';
$lineUserId = (is_array($personMap) && isset($personMap[$personCode]))
    ? (string)$personMap[$personCode] : '';

if ($lineUserId === '') {
    http_response_code(404);
    echo json_encode(array('ok' => false, 'next' => 'unknown person_code, check aim_person_map.php'));
    exit;
}

$sent = aim_send_task_card($lineUserId, $taskRef, $title);
ll_log('aim_notify: task ' . $taskRef . ' -> ' . ($sent ? 'sent' : 'failed'));

http_response_code($sent ? 200 : 502);
echo json_encode(array('ok' => $sent));
