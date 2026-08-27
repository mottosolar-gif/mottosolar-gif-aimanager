<?php
/**
 * สร้าง+ส่งการ์ดงานจริงหา LINE ของพนักงาน — WP-P1-B2
 * ใช้ ll_line_push_to() ที่มีอยู่แล้ว (ไม่สร้างระบบส่ง LINE ใหม่)
 * postback data ต้องตรงรูปแบบ act=aim_<verb>&task=<ref> ที่ฝั่งคลาวด์ (WP-P1-B1) รองรับแล้ว
 */
function aim_send_task_card($lineUserId, $taskRef, $title)
{
    $safeTaskRef = preg_replace('/[^A-Za-z0-9_-]/', '', (string)$taskRef);
    if ($safeTaskRef === '' || (string)$lineUserId === '') return false;

    $displayTitle = mb_substr((string)$title, 0, 200, 'UTF-8');
    $msg = array(
        'type' => 'text',
        'text' => "🔔 งานใหม่จาก AI Manager\n\n" . $displayTitle . "\n\n(อ้างอิง: " . $safeTaskRef . ")",
        'quickReply' => array('items' => array(
            array(
                'type' => 'action',
                'action' => array(
                    'type' => 'postback',
                    'label' => '✅ รับงาน',
                    'data' => 'act=aim_accept&task=' . $safeTaskRef,
                    'displayText' => 'รับงาน',
                ),
            ),
            array(
                'type' => 'action',
                'action' => array(
                    'type' => 'postback',
                    'label' => '❌ ปฏิเสธ',
                    'data' => 'act=aim_reject&task=' . $safeTaskRef,
                    'displayText' => 'ปฏิเสธงาน',
                ),
            ),
        )),
    );

    return ll_line_push_to($lineUserId, array($msg));
}
