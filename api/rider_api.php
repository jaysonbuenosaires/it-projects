<?php
// ════════════════════════════════════════════════════════════════
//  PoultryMart — Rider API
//  Endpoint: api/rider_api.php
//
//  Actions (GET):
//    ?action=my_orders&rider_id=N          → assigned orders for rider
//    ?action=order&id=N&rider_id=N         → single order detail
//    ?action=notifications&rider_id=N      → unread rider notifications
//    ?action=performance&rider_id=N        → delivery performance stats
//
//  Actions (POST, body must include rider_id):
//    ?action=update_status      { order_id, status }
//    ?action=upload_pod         { order_id, proof_url }
//    ?action=verify_payment     { order_id }
//    ?action=complete_order     { order_id, proof_url }
//    ?action=failed_delivery    { order_id, reason, notes }
//    ?action=update_profile     { phone?, current_password?, new_password? }
//    ?action=remit_cash         { amount, notes? }
//    ?action=mark_notif_read    { notification_id }
//
// ════════════════════════════════════════════════════════════════
require_once __DIR__ . '/db.php';

// Ensure we are sending JSON and not HTML errors
header('Content-Type: application/json');

$action   = $_GET['action'] ?? '';
$body     = json_decode(file_get_contents('php://input'), true) ?? [];

// 1. LOGIN ACTION (Must stay above the verify_rider check)
if ($action === 'login') {
    $email = mysqli_real_escape_string($conn, $body['email'] ?? '');
    $pass  = $body['password'] ?? '';

    $res = mysqli_query($conn, 
        "SELECT u.*, r.role_name FROM users u 
         JOIN roles r ON u.role_id = r.role_id 
         WHERE u.email = '$email' LIMIT 1");
    
    if (!$res) {
        echo json_encode(['success' => false, 'message' => 'DB Error: ' . mysqli_error($conn)]);
        exit;
    }

    $user = mysqli_fetch_assoc($res);

    // Using basic string comparison as requested
    if ($user && $user['status'] === 'active' && $user['role_name'] === 'Delivery Rider' && password_verify($pass, $user['password_hash'])) { 
        echo json_encode([
            'success' => true,
            'user' => [
                'user_id' => $user['user_id'],
                'first_name' => $user['first_name'],
                'last_name' => $user['last_name'],
                'role_name' => $user['role_name']
            ]
        ]);
    } else {
        echo json_encode(['success' => false, 'message' => 'Invalid email or password.']);
    }
    exit;
}

// 2. NOW perform the rider check for all other actions
$rider_id = (int)($_GET['rider_id'] ?? 0);
if (!$rider_id && isset($body['rider_id'])) {
    $rider_id = (int)$body['rider_id'];
}

// ── Simple rider guard ──────────────────────────────────────────
// Verify the rider_id belongs to a Delivery Rider account
function verify_rider(mysqli $conn, int $rider_id): bool {
    if ($rider_id <= 0) return false;
    $res = mysqli_query($conn,
        "SELECT u.user_id FROM users u
         JOIN roles r ON r.role_id = u.role_id
         WHERE u.user_id = $rider_id AND r.role_name = 'Delivery Rider'
           AND u.status = 'active' LIMIT 1");
    return mysqli_num_rows($res) > 0;
}

if (!verify_rider($conn, $rider_id)) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Unauthorized. Delivery Rider account required.']);
    exit;
}

// ════════════════════════════════════════════════════════════════
//  HELPER: fetch a full order detail row
// ════════════════════════════════════════════════════════════════
function fetch_order_detail(mysqli $conn, int $oid): ?array {
    $res = mysqli_query($conn,
        "SELECT o.*,
                u.first_name, u.last_name, u.email, u.phone,
                a.label AS addr_label, a.street,
                b.name  AS barangay, m_addr.name AS city, 'Albay' AS province,
                a.latitude, a.longitude,
                ts.slot_label, ts.end_time AS slot_end_time,
                dz.delivery_fee AS zone_fee,
                pc.code AS promo_code,
                pay.status AS pay_status, pay.method AS pay_method,
                pay.verified_at,
                d.status AS delivery_status,
                d.proof_of_delivery_url, d.dispatched_at, d.delivered_at
         FROM orders o
         JOIN users u    ON u.user_id      = o.user_id
         JOIN addresses a ON a.address_id  = o.address_id
         LEFT JOIN barangays      b      ON b.barangay_id        = a.barangay_id
         LEFT JOIN municipalities m_addr ON m_addr.municipality_id = a.municipality_id
         LEFT JOIN time_slots ts   ON ts.slot_id   = o.slot_id
         LEFT JOIN delivery_zones dz ON dz.zone_id = o.zone_id
         LEFT JOIN promo_codes pc  ON pc.promo_id  = o.promo_id
         LEFT JOIN payments pay    ON pay.order_id = o.order_id
         LEFT JOIN deliveries d    ON d.order_id   = o.order_id
         WHERE o.order_id = $oid LIMIT 1");

    $order = mysqli_fetch_assoc($res);
    if (!$order) return null;

    $ires = mysqli_query($conn,
        "SELECT oi.*, p.name, p.is_catch_weight, p.estimated_weight AS product_est_weight
         FROM order_items oi
         JOIN products p ON p.product_id = oi.product_id
         WHERE oi.order_id = $oid");
    $items = [];
    while ($r = mysqli_fetch_assoc($ires)) $items[] = $r;
    $order['items'] = $items;
    return $order;
}

// ════════════════════════════════════════════════════════════════
//  MY ORDERS — list of orders assigned to this rider
// ════════════════════════════════════════════════════════════════
if ($action === 'my_orders') {
    $status_filter = $_GET['status'] ?? '';
    $date_filter   = $_GET['date']   ?? '';

    $where = ["d.rider_id = $rider_id"];

    if ($status_filter && $status_filter !== 'all') {
        $sf = mysqli_real_escape_string($conn, $status_filter);
        $where[] = "o.status = '$sf'";
    }
    if ($date_filter) {
        $df = mysqli_real_escape_string($conn, $date_filter);
        $where[] = "o.delivery_date = '$df'";
    }

    $where_sql = implode(' AND ', $where);

    $res = mysqli_query($conn,
        "SELECT o.order_id, o.order_number, o.delivery_date, o.status,
                o.estimated_total, o.final_total, o.discount_amount,
                o.delivery_fee, o.payment_method, o.special_instructions,
                o.created_at,
                u.first_name, u.last_name, u.phone,
                a.street, b.name AS barangay, m_addr.name AS city, 'Albay' AS province,
                a.latitude, a.longitude,
                ts.slot_label, ts.end_time AS slot_end_time,
                pay.status AS pay_status,
                d.status AS delivery_status, d.proof_of_delivery_url,
                d.dispatched_at, d.delivered_at
         FROM deliveries d
         JOIN orders o   ON o.order_id   = d.order_id
         JOIN users u    ON u.user_id    = o.user_id
         JOIN addresses a ON a.address_id = o.address_id
         LEFT JOIN barangays      b      ON b.barangay_id        = a.barangay_id
         LEFT JOIN municipalities m_addr ON m_addr.municipality_id = a.municipality_id
         LEFT JOIN time_slots ts ON ts.slot_id = o.slot_id
         LEFT JOIN payments pay  ON pay.order_id = o.order_id
         WHERE $where_sql
         ORDER BY
           FIELD(o.status, 'Out for Delivery', 'Arrived at Location', 'Packed', 'Completed') ASC,
           o.delivery_date ASC,
           ts.start_time ASC");

    $orders = [];
    while ($r = mysqli_fetch_assoc($res)) $orders[] = $r;

    // Summary counts
    $counts_res = mysqli_query($conn,
        "SELECT o.status, COUNT(*) AS cnt
         FROM deliveries d
         JOIN orders o ON o.order_id = d.order_id
         WHERE d.rider_id = $rider_id
           AND o.status IN ('Packed','Out for Delivery','Arrived at Location','Completed')
         GROUP BY o.status");
    $counts = [];
    while ($r = mysqli_fetch_assoc($counts_res)) {
        $counts[$r['status']] = (int)$r['cnt'];
    }

    echo json_encode([
        'success' => true,
        'data'    => $orders,
        'counts'  => $counts,
    ]);
    exit;
}

// ════════════════════════════════════════════════════════════════
//  SINGLE ORDER DETAIL
// ════════════════════════════════════════════════════════════════
if ($action === 'order') {
    $oid = (int)($_GET['id'] ?? 0);
    if (!$oid) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'id required']);
        exit;
    }

    // Verify this order is assigned to this rider
    $check = mysqli_fetch_assoc(mysqli_query($conn,
        "SELECT d.delivery_id FROM deliveries d WHERE d.order_id = $oid AND d.rider_id = $rider_id LIMIT 1"));
    if (!$check) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Order not assigned to you.']);
        exit;
    }

    $order = fetch_order_detail($conn, $oid);
    if (!$order) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Order not found.']);
        exit;
    }

    echo json_encode(['success' => true, 'data' => $order]);
    exit;
}

// ════════════════════════════════════════════════════════════════
//  UPDATE STATUS  (Out for Delivery | Arrived at Location)
// ════════════════════════════════════════════════════════════════
if ($action === 'update_status') {
    $oid    = (int)($body['order_id'] ?? 0);
    $status = $body['status'] ?? '';
    $allowed = ['Out for Delivery', 'Arrived at Location'];

    if (!$oid || !in_array($status, $allowed)) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'order_id and valid status required.']);
        exit;
    }

    // Verify assignment
    $check = mysqli_fetch_assoc(mysqli_query($conn,
        "SELECT d.delivery_id FROM deliveries d WHERE d.order_id = $oid AND d.rider_id = $rider_id LIMIT 1"));
    if (!$check) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Order not assigned to you.']);
        exit;
    }

    $s = mysqli_real_escape_string($conn, $status);
    mysqli_begin_transaction($conn);
    try {
        mysqli_query($conn, "UPDATE orders SET status='$s' WHERE order_id=$oid");

        $del_status = $s;
        if ($status === 'Out for Delivery') {
            mysqli_query($conn, "UPDATE deliveries SET status='Out for Delivery', dispatched_at=NOW() WHERE order_id=$oid AND rider_id=$rider_id");
        } else {
            mysqli_query($conn, "UPDATE deliveries SET status='Arrived at Location' WHERE order_id=$oid AND rider_id=$rider_id");
        }

        // Notification for customer
        $ord_row = mysqli_fetch_assoc(mysqli_query($conn, "SELECT user_id, order_number FROM orders WHERE order_id=$oid LIMIT 1"));
        if ($ord_row) {
            $cuid = (int)$ord_row['user_id'];
            $onum = mysqli_real_escape_string($conn, $ord_row['order_number']);
            $msg  = $status === 'Out for Delivery'
                ? "Your order #$onum is now out for delivery! 🚴"
                : "Your rider has arrived at your location for order #$onum.";
            $msg  = mysqli_real_escape_string($conn, $msg);
            mysqli_query($conn, "INSERT INTO notifications (user_id, message, type) VALUES ($cuid, '$msg', 'dispatched')");
        }

        mysqli_query($conn, "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
            VALUES ($rider_id, 'update_status', 'order', $oid, 'Rider set status to $s')");

        mysqli_commit($conn);
        echo json_encode(['success' => true, 'message' => "Status updated to $status."]);
    } catch (Exception $ex) {
        mysqli_rollback($conn);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $ex->getMessage()]);
    }
    exit;
}

// ════════════════════════════════════════════════════════════════
//  COMPLETE ORDER  (upload POD + verify payment + mark Completed)
// ════════════════════════════════════════════════════════════════
if ($action === 'complete_order') {
    $oid       = (int)($body['order_id'] ?? 0);
    $proof_url = trim($body['proof_url'] ?? '');

    if (!$oid) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'order_id required.']);
        exit;
    }

    // Verify assignment and current status
    $del = mysqli_fetch_assoc(mysqli_query($conn,
        "SELECT d.delivery_id, o.status, o.user_id, o.order_number, o.payment_method
         FROM deliveries d
         JOIN orders o ON o.order_id = d.order_id
         WHERE d.order_id = $oid AND d.rider_id = $rider_id LIMIT 1"));
    if (!$del) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Order not assigned to you.']);
        exit;
    }
    if (!in_array($del['status'], ['Out for Delivery', 'Arrived at Location'])) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'Order must be Out for Delivery or Arrived at Location to complete.']);
        exit;
    }

    $proof_sql = $proof_url ? "'" . mysqli_real_escape_string($conn, $proof_url) . "'" : 'NULL';

    mysqli_begin_transaction($conn);
    try {
        // Mark order completed
        mysqli_query($conn, "UPDATE orders SET status='Completed' WHERE order_id=$oid");

        // Update delivery record
        mysqli_query($conn,
            "UPDATE deliveries
             SET status='Completed', delivered_at=NOW(),
                 proof_of_delivery_url=$proof_sql
             WHERE order_id=$oid AND rider_id=$rider_id");

        // Mark payment paid ONLY for COD — GCash must be verified by finance before dispatch.
        if (strtolower($del['payment_method'] ?? '') === 'cod') {
            mysqli_query($conn,
                "UPDATE payments SET status='Paid', verified_by=$rider_id, verified_at=NOW()
                 WHERE order_id=$oid AND status='Unpaid'");
        }
        // NOTE: Inventory deduction is intentionally NOT performed here.
        // Stock must be reserved at checkout or deducted during the Packing stage
        // by warehouse staff so that items are not sold twice while on the rider's motorcycle.

        // Notify customer
        $cuid = (int)$del['user_id'];
        $onum = mysqli_real_escape_string($conn, $del['order_number']);
        $msg  = mysqli_real_escape_string($conn, "Your order #$onum has been delivered and completed. Thank you! 🎉");
        mysqli_query($conn,
            "INSERT INTO notifications (user_id, message, type) VALUES ($cuid, '$msg', 'general')");

        mysqli_query($conn,
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES ($rider_id, 'complete_order', 'order', $oid, 'Rider completed order')");

        mysqli_commit($conn);
        echo json_encode(['success' => true, 'message' => 'Order marked as Completed.']);
    } catch (Exception $ex) {
        mysqli_rollback($conn);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $ex->getMessage()]);
    }
    exit;
}

// ════════════════════════════════════════════════════════════════
//  UPLOAD PROOF OF DELIVERY  (URL string from base64 upload)
// ════════════════════════════════════════════════════════════════
if ($action === 'upload_pod') {
    $oid       = (int)($body['order_id'] ?? 0);
    $proof_url = trim($body['proof_url'] ?? '');

    if (!$oid || !$proof_url) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'order_id and proof_url required.']);
        exit;
    }

    $check = mysqli_fetch_assoc(mysqli_query($conn,
        "SELECT delivery_id FROM deliveries WHERE order_id=$oid AND rider_id=$rider_id LIMIT 1"));
    if (!$check) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Order not assigned to you.']);
        exit;
    }

    $pu = mysqli_real_escape_string($conn, $proof_url);
    mysqli_query($conn,
        "UPDATE deliveries SET proof_of_delivery_url='$pu' WHERE order_id=$oid AND rider_id=$rider_id");

    echo json_encode(['success' => true, 'message' => 'Proof of delivery saved.']);
    exit;
}

// ════════════════════════════════════════════════════════════════
//  RIDER PROFILE  (basic self-service read)
// ════════════════════════════════════════════════════════════════
if ($action === 'profile') {
    $res = mysqli_fetch_assoc(mysqli_query($conn,
        "SELECT user_id, first_name, last_name, email, phone, status FROM users WHERE user_id=$rider_id LIMIT 1"));
    echo json_encode(['success' => true, 'data' => $res]);
    exit;
}

// ════════════════════════════════════════════════════════════════
//  TODAY'S SUMMARY  (stat pills for dashboard)
// ════════════════════════════════════════════════════════════════
if ($action === 'summary') {
    $today = date('Y-m-d');

    $res = mysqli_query($conn,
        "SELECT
           COUNT(*) AS total_assigned,
           SUM(CASE WHEN o.status='Completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN o.status='Out for Delivery' THEN 1 ELSE 0 END) AS in_transit,
           SUM(CASE WHEN o.status IN ('Packed','Assigned') THEN 1 ELSE 0 END) AS pending_pickup,
           SUM(CASE WHEN o.status='Completed' AND pay.status='Paid' THEN COALESCE(o.final_total, o.estimated_total) ELSE 0 END) AS collected_today
         FROM deliveries d
         JOIN orders o  ON o.order_id = d.order_id
         LEFT JOIN payments pay ON pay.order_id = o.order_id
         WHERE d.rider_id = $rider_id AND o.delivery_date = '$today'");

    $summary = mysqli_fetch_assoc($res) ?: [];
    echo json_encode(['success' => true, 'data' => $summary]);
    exit;
}

// ════════════════════════════════════════════════════════════════
//  FAILED DELIVERY / REPORT ISSUE
// ════════════════════════════════════════════════════════════════
if ($action === 'failed_delivery') {
    $oid    = (int)($body['order_id'] ?? 0);
    $reason = trim($body['reason'] ?? '');
    $notes  = trim($body['notes']  ?? '');

    $allowed_reasons = [
        'Customer Unreachable',
        'Wrong Address',
        'Customer Refused Delivery',
        'Damaged Goods',
        'Other',
    ];

    if (!$oid || !in_array($reason, $allowed_reasons)) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'order_id and a valid reason are required.']);
        exit;
    }

    // Verify assignment
    $del = mysqli_fetch_assoc(mysqli_query($conn,
        "SELECT d.delivery_id, o.user_id, o.order_number, o.status
         FROM deliveries d
         JOIN orders o ON o.order_id = d.order_id
         WHERE d.order_id = $oid AND d.rider_id = $rider_id LIMIT 1"));
    if (!$del) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Order not assigned to you.']);
        exit;
    }
    if (!in_array($del['status'], ['Out for Delivery', 'Arrived at Location'])) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'Order must be Out for Delivery or Arrived at Location to report a failed delivery.']);
        exit;
    }

    $r_esc = mysqli_real_escape_string($conn, $reason);
    $n_esc = mysqli_real_escape_string($conn, $notes);

    mysqli_begin_transaction($conn);
    try {
        mysqli_query($conn, "UPDATE orders SET status='Cancelled' WHERE order_id=$oid");
        mysqli_query($conn, "UPDATE deliveries SET status='Failed' WHERE order_id=$oid AND rider_id=$rider_id");

        // Log in cancellation_logs
        mysqli_query($conn,
            "INSERT INTO cancellation_logs (order_id, cancelled_by, reason, notes, created_at)
             VALUES ($oid, $rider_id, '$r_esc', '$n_esc', NOW())");

        // Notify customer
        $cuid = (int)$del['user_id'];
        $onum = mysqli_real_escape_string($conn, $del['order_number']);
        $msg  = mysqli_real_escape_string($conn,
            "We were unable to deliver order #$onum. Reason: $reason. Our team will contact you shortly.");
        mysqli_query($conn,
            "INSERT INTO notifications (user_id, message, type) VALUES ($cuid, '$msg', 'general')");

        mysqli_query($conn,
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES ($rider_id, 'failed_delivery', 'order', $oid, 'Reason: $r_esc')");

        mysqli_commit($conn);
        echo json_encode(['success' => true, 'message' => 'Failed delivery recorded.']);
    } catch (Exception $ex) {
        mysqli_rollback($conn);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $ex->getMessage()]);
    }
    exit;
}

// ════════════════════════════════════════════════════════════════
//  RIDER NOTIFICATIONS  (assigned-order alerts sent to this rider)
// ════════════════════════════════════════════════════════════════
if ($action === 'notifications') {
    $limit = min((int)($_GET['limit'] ?? 20), 50);
    $res = mysqli_query($conn,
        "SELECT notification_id, message, type, is_read, created_at
         FROM notifications
         WHERE user_id = $rider_id
         ORDER BY created_at DESC
         LIMIT $limit");
    $notifs = [];
    while ($r = mysqli_fetch_assoc($res)) $notifs[] = $r;

    // Unread count
    $unread_res = mysqli_fetch_assoc(mysqli_query($conn,
        "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id=$rider_id AND is_read=0"));
    $unread = (int)($unread_res['cnt'] ?? 0);

    echo json_encode(['success' => true, 'data' => $notifs, 'unread' => $unread]);
    exit;
}

// ════════════════════════════════════════════════════════════════
//  MARK NOTIFICATION READ
// ════════════════════════════════════════════════════════════════
if ($action === 'mark_notif_read') {
    $nid = (int)($body['notification_id'] ?? 0);
    if ($nid) {
        mysqli_query($conn,
            "UPDATE notifications SET is_read=1
             WHERE notification_id=$nid AND user_id=$rider_id");
    } else {
        // Mark all read if no specific id
        mysqli_query($conn,
            "UPDATE notifications SET is_read=1 WHERE user_id=$rider_id");
    }
    echo json_encode(['success' => true]);
    exit;
}

// ════════════════════════════════════════════════════════════════
//  DELIVERY PERFORMANCE  (historical stats)
// ════════════════════════════════════════════════════════════════
if ($action === 'performance') {
    $date_from = $_GET['date_from'] ?? date('Y-m-d', strtotime('-30 days'));
    $date_to   = $_GET['date_to']   ?? date('Y-m-d');
    $df = mysqli_real_escape_string($conn, $date_from);
    $dt = mysqli_real_escape_string($conn, $date_to);

    $res = mysqli_fetch_assoc(mysqli_query($conn,
        "SELECT
           COUNT(*) AS total_deliveries,
           SUM(CASE WHEN o.status='Completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN o.status='Cancelled' THEN 1 ELSE 0 END) AS failed,
           AVG(CASE
             WHEN d.dispatched_at IS NOT NULL AND d.delivered_at IS NOT NULL
             THEN TIMESTAMPDIFF(MINUTE, d.dispatched_at, d.delivered_at)
           END) AS avg_delivery_minutes
         FROM deliveries d
         JOIN orders o ON o.order_id = d.order_id
         WHERE d.rider_id = $rider_id
           AND o.delivery_date BETWEEN '$df' AND '$dt'"));

    // Daily breakdown for sparkline
    $daily_res = mysqli_query($conn,
        "SELECT o.delivery_date,
                COUNT(*) AS total,
                SUM(CASE WHEN o.status='Completed' THEN 1 ELSE 0 END) AS completed
         FROM deliveries d
         JOIN orders o ON o.order_id = d.order_id
         WHERE d.rider_id = $rider_id
           AND o.delivery_date BETWEEN '$df' AND '$dt'
         GROUP BY o.delivery_date
         ORDER BY o.delivery_date ASC");
    $daily = [];
    while ($r = mysqli_fetch_assoc($daily_res)) $daily[] = $r;

    $summary = $res ?: [];
    $total  = (int)($summary['total_deliveries'] ?? 0);
    $done   = (int)($summary['completed'] ?? 0);
    $summary['completion_rate'] = $total > 0 ? round(($done / $total) * 100, 1) : 0;
    $summary['avg_delivery_minutes'] = $summary['avg_delivery_minutes']
        ? round((float)$summary['avg_delivery_minutes'], 1)
        : null;

    echo json_encode([
        'success'     => true,
        'data'        => $summary,
        'daily'       => $daily,
        'date_from'   => $date_from,
        'date_to'     => $date_to,
    ]);
    exit;
}

// ════════════════════════════════════════════════════════════════
//  UPDATE PROFILE  (phone and/or password)
// ════════════════════════════════════════════════════════════════
if ($action === 'update_profile' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $new_phone    = trim($body['phone']            ?? '');
    $current_pass = $body['current_password']      ?? '';
    $new_pass     = $body['new_password']          ?? '';

    $updates = [];

    if ($new_phone !== '') {
        if (!preg_match('/^\+?[0-9\s\-]{7,20}$/', $new_phone)) {
            http_response_code(422);
            echo json_encode(['success' => false, 'message' => 'Invalid phone number format.']);
            exit;
        }
        $ph = mysqli_real_escape_string($conn, $new_phone);
        $updates[] = "phone='$ph'";
    }

    if ($new_pass !== '') {
        if (strlen($new_pass) < 8) {
            http_response_code(422);
            echo json_encode(['success' => false, 'message' => 'New password must be at least 8 characters.']);
            exit;
        }
        // Verify current password first
        $cur = mysqli_fetch_assoc(mysqli_query($conn,
            "SELECT password_hash FROM users WHERE user_id=$rider_id LIMIT 1"));
        if (!$cur || !password_verify($current_pass, $cur['password_hash'])) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Current password is incorrect.']);
            exit;
        }
        $hash = mysqli_real_escape_string($conn, password_hash($new_pass, PASSWORD_BCRYPT));
        $updates[] = "password_hash='$hash'";
    }

    if (empty($updates)) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'No changes to save.']);
        exit;
    }

    $set_sql = implode(', ', $updates);
    mysqli_query($conn, "UPDATE users SET $set_sql WHERE user_id=$rider_id");

    mysqli_query($conn,
        "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
         VALUES ($rider_id, 'update_profile', 'user', $rider_id, 'Rider updated profile')");

    echo json_encode(['success' => true, 'message' => 'Profile updated successfully.']);
    exit;
}

// ════════════════════════════════════════════════════════════════
//  REMIT CASH  (record COD cash handoff to admin)
// ════════════════════════════════════════════════════════════════
if ($action === 'remit_cash' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $amount = (float)($body['amount'] ?? 0);
    $notes  = trim($body['notes'] ?? '');

    if ($amount <= 0) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'Amount must be greater than zero.']);
        exit;
    }

    $n_esc = mysqli_real_escape_string($conn, $notes);
    $today = date('Y-m-d');

    mysqli_begin_transaction($conn);
    try {
        mysqli_query($conn,
            "INSERT INTO cash_remittances (rider_id, amount, notes, remitted_at, status)
             VALUES ($rider_id, $amount, '$n_esc', NOW(), 'Pending')");

        mysqli_query($conn,
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES ($rider_id, 'remit_cash', 'rider', $rider_id,
                     'Rider submitted remittance of $amount')");

        mysqli_commit($conn);
        echo json_encode(['success' => true, 'message' => 'Remittance submitted. Please hand cash to the admin for confirmation.']);
    } catch (Exception $ex) {
        mysqli_rollback($conn);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $ex->getMessage()]);
    }
    exit;
}

// ════════════════════════════════════════════════════════════════
//  REMITTANCE HISTORY  (for the rider's own records)
// ════════════════════════════════════════════════════════════════
if ($action === 'remittance_history') {
    $res = mysqli_query($conn,
        "SELECT remittance_id, amount, notes, remitted_at, status, confirmed_by, confirmed_at
         FROM cash_remittances
         WHERE rider_id = $rider_id
         ORDER BY remitted_at DESC
         LIMIT 30");
    $rows = [];
    while ($r = mysqli_fetch_assoc($res)) $rows[] = $r;
    echo json_encode(['success' => true, 'data' => $rows]);
    exit;
}

http_response_code(400);
echo json_encode(['success' => false, 'message' => 'Invalid action.']);