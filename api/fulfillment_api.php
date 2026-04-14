<?php
/**
 * PoultryMart – Fulfillment Staff API (fulfillment_api.php)
 * Dedicated endpoint for all fulfillment staff operations.
 * Does NOT modify admin_api.php.
 *
 * GET  ?action=login                    → staff authentication
 * GET  ?action=orders&status=X          → paginated orders
 * GET  ?action=order&id=N               → single order detail
 * GET  ?action=riders                   → active riders list
 * GET  ?action=inventory                → product batches (FIFO)
 * GET  ?action=batches_for_product&product_id=N → active batches for a product
 * GET  ?action=notifications_poll       → unread cancellation alerts
 * GET  ?action=delivery_zones           → zones + slots grouped
 *
 * POST ?action=pack_order               → set actual weights, deduct FIFO batches, audit log
 * POST ?action=mark_out_of_stock        → zero out an item, recalc total, notify customer
 * POST ?action=assign_rider             → assign rider + upsert deliveries row
 * POST ?action=dispatch_order           → transition to Out for Delivery, set dispatched_at
 * POST ?action=complete_delivery        → mark delivered, set delivered_at
 * POST ?action=adjust_stock             → spoilage/shrinkage adjustment with audit log
 * POST ?action=batch_assign_riders      → assign one rider to many orders (zone batching)
 * POST ?action=mark_notifications_read  → dismiss cancellation alerts
 */

require_once __DIR__ . '/db.php';

header('Content-Type: application/json');

$action = $_GET['action'] ?? '';
$body   = json_decode(file_get_contents('php://input'), true) ?? [];

// ── Staff role guard ──────────────────────────────────────────
// Accepts staff_id in body or query; validates role.
$staff_id = (int)($body['staff_id'] ?? $_GET['staff_id'] ?? 0);
$staff_role = null;

if ($action !== 'login') {
    if (!$staff_id) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Authentication required.']);
        exit;
    }
    $sRes = mysqli_fetch_assoc(mysqli_query($conn,
        "SELECT u.user_id, r.role_name FROM users u
         JOIN roles r ON r.role_id = u.role_id
         WHERE u.user_id = $staff_id AND u.status = 'active' LIMIT 1"));
    if (!$sRes || !in_array($sRes['role_name'], ['Fulfillment Staff', 'Super Admin'])) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Access denied. Fulfillment Staff only.']);
        exit;
    }
    $staff_role = $sRes['role_name'];
}

// ════════════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════════════
if ($action === 'login') {
    $email    = trim($body['email'] ?? '');
    $password = $body['password'] ?? '';

    if (!$email || !$password) {
        echo json_encode(['success' => false, 'message' => 'Email and password are required.']);
        exit;
    }

    $emailSafe = mysqli_real_escape_string($conn, $email);
    $res = mysqli_query($conn,
        "SELECT u.user_id, u.first_name, u.last_name, u.email, u.password_hash, u.status, r.role_name
         FROM users u JOIN roles r ON r.role_id = u.role_id
         WHERE u.email = '$emailSafe' LIMIT 1");
    $user = mysqli_fetch_assoc($res);

    if (!$user || $user['status'] !== 'active' || !password_verify($password, $user['password_hash'])) {
        echo json_encode(['success' => false, 'message' => 'Invalid email or password.']);
        exit;
    }
    if (!in_array($user['role_name'], ['Fulfillment Staff', 'Super Admin'])) {
        echo json_encode(['success' => false, 'message' => 'Access denied. This portal is for Fulfillment Staff only.']);
        exit;
    }

    unset($user['password_hash']);
    echo json_encode(['success' => true, 'message' => 'Login successful.', 'user' => $user]);
    exit;
}

// ════════════════════════════════════════════════════════
//  ORDERS LIST
// ════════════════════════════════════════════════════════
if ($action === 'orders') {
    $status = $_GET['status'] ?? '';
    $search = trim($_GET['search'] ?? '');
    $page   = max(1, (int)($_GET['page'] ?? 1));
    $limit  = 30;
    $offset = ($page - 1) * $limit;

    $where = ['1=1'];
    if ($status) {
        $s = mysqli_real_escape_string($conn, $status);
        $where[] = "o.status = '$s'";
    }
    if ($search) {
        $q = mysqli_real_escape_string($conn, $search);
        $where[] = "(o.order_number LIKE '%$q%' OR u.first_name LIKE '%$q%' OR u.last_name LIKE '%$q%' OR u.email LIKE '%$q%')";
    }
    $wSql = implode(' AND ', $where);

    $total = (int)mysqli_fetch_assoc(mysqli_query($conn,
        "SELECT COUNT(*) AS n FROM orders o JOIN users u ON u.user_id=o.user_id WHERE $wSql"))['n'];

    $res = mysqli_query($conn,
        "SELECT o.order_id, o.order_number, o.status, o.estimated_total, o.final_total,
                o.discount_amount, o.delivery_fee, o.payment_method, o.delivery_date, o.created_at,
                o.zone_id, o.slot_id,
                u.first_name, u.last_name, u.email,
                ts.slot_label,
                m.name AS zone_city,
                p.status AS pay_status
         FROM orders o
         JOIN users u ON u.user_id = o.user_id
         LEFT JOIN payments p ON p.order_id = o.order_id
         LEFT JOIN time_slots ts ON ts.slot_id = o.slot_id
         LEFT JOIN delivery_zones dz ON dz.zone_id = o.zone_id
         LEFT JOIN municipalities m  ON m.municipality_id = dz.municipality_id
         WHERE $wSql
         ORDER BY o.delivery_date ASC, o.created_at ASC
         LIMIT $limit OFFSET $offset");
    $orders = [];
    while ($r = mysqli_fetch_assoc($res)) $orders[] = $r;

    echo json_encode(['success' => true, 'data' => $orders, 'total' => $total, 'page' => $page, 'pages' => ceil($total / $limit)]);
    exit;
}

// ════════════════════════════════════════════════════════
//  SINGLE ORDER DETAIL
// ════════════════════════════════════════════════════════
if ($action === 'order') {
    $oid = (int)($_GET['id'] ?? 0);
    if (!$oid) { http_response_code(422); echo json_encode(['success' => false, 'message' => 'id required']); exit; }

    $res = mysqli_query($conn,
        "SELECT o.*, u.first_name, u.last_name, u.email, u.phone,
                a.label AS addr_label, a.street,
                b.name AS barangay, m_addr.name AS city, 'Albay' AS province,
                ts.slot_label, ts.slot_id,
                dz.zone_id, m_zone.name AS zone_city, dz.delivery_fee AS zone_fee,
                pc.code AS promo_code,
                p.status AS pay_status, p.verified_at,
                d.rider_id, d.status AS delivery_status, d.proof_of_delivery_url,
                d.dispatched_at, d.delivered_at,
                ru.first_name AS rider_first, ru.last_name AS rider_last, ru.phone AS rider_phone
         FROM orders o
         JOIN users u ON u.user_id = o.user_id
         JOIN addresses a ON a.address_id = o.address_id
         LEFT JOIN barangays      b      ON b.barangay_id       = a.barangay_id
         LEFT JOIN municipalities m_addr ON m_addr.municipality_id = a.municipality_id
         LEFT JOIN time_slots ts ON ts.slot_id = o.slot_id
         LEFT JOIN delivery_zones dz ON dz.zone_id = o.zone_id
         LEFT JOIN municipalities m_zone ON m_zone.municipality_id = dz.municipality_id
         LEFT JOIN promo_codes pc ON pc.promo_id = o.promo_id
         LEFT JOIN payments p ON p.order_id = o.order_id
         LEFT JOIN deliveries d ON d.order_id = o.order_id
         LEFT JOIN users ru ON ru.user_id = d.rider_id
         WHERE o.order_id = $oid LIMIT 1");
    $order = mysqli_fetch_assoc($res);
    if (!$order) { http_response_code(404); echo json_encode(['success' => false, 'message' => 'Order not found.']); exit; }

    $iRes = mysqli_query($conn,
        "SELECT oi.order_item_id, oi.order_id, oi.product_id,
                oi.quantity, oi.unit_price, oi.pricing_model,
                oi.estimated_weight, oi.actual_weight,
                oi.estimated_subtotal, oi.final_subtotal,
                p.name, p.is_catch_weight, p.unit_of_measure,
                c.name AS category_name
         FROM order_items oi
         JOIN products p ON p.product_id = oi.product_id
         JOIN categories c ON c.category_id = p.category_id
         WHERE oi.order_id = $oid");
    $items = [];
    while ($r = mysqli_fetch_assoc($iRes)) {
        // Alias unit_price as price_per_kg for JS compatibility
        $r['price_per_kg'] = $r['unit_price'];
        $items[] = $r;
    }
    $order['items'] = $items;

    echo json_encode(['success' => true, 'data' => $order]);
    exit;
}

// ════════════════════════════════════════════════════════
//  RIDERS LIST
// ════════════════════════════════════════════════════════
if ($action === 'riders') {
    $res = mysqli_query($conn,
        "SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone, u.status
         FROM users u JOIN roles r ON r.role_id = u.role_id
         WHERE r.role_name = 'Delivery Rider' AND u.status = 'active'
         ORDER BY u.first_name ASC");
    $riders = [];
    while ($r = mysqli_fetch_assoc($res)) $riders[] = $r;
    echo json_encode(['success' => true, 'data' => $riders]);
    exit;
}

// ════════════════════════════════════════════════════════
//  INVENTORY (product batches, FIFO ordered)
// ════════════════════════════════════════════════════════
if ($action === 'inventory') {
    $res = mysqli_query($conn,
        "SELECT pb.batch_id, pb.product_id, pb.batch_date, pb.quantity, pb.remaining_qty, pb.batch_unit,
                p.name AS product_name, p.is_catch_weight,
                c.name AS category_name
         FROM product_batches pb
         JOIN products p ON p.product_id = pb.product_id
         JOIN categories c ON c.category_id = p.category_id
         WHERE pb.remaining_qty > 0 AND p.status = 'active'
         ORDER BY pb.product_id ASC, pb.batch_date ASC");
    $batches = [];
    while ($r = mysqli_fetch_assoc($res)) $batches[] = $r;
    echo json_encode(['success' => true, 'data' => $batches]);
    exit;
}

// ════════════════════════════════════════════════════════
//  BATCHES FOR A SPECIFIC PRODUCT (for manual override dropdown)
// ════════════════════════════════════════════════════════
if ($action === 'batches_for_product') {
    $pid = (int)($_GET['product_id'] ?? 0);
    if (!$pid) { echo json_encode(['success' => false, 'message' => 'product_id required']); exit; }

    $res = mysqli_query($conn,
        "SELECT batch_id, batch_date, remaining_qty, batch_unit
         FROM product_batches
         WHERE product_id = $pid AND remaining_qty > 0
         ORDER BY batch_date ASC");
    $batches = [];
    while ($r = mysqli_fetch_assoc($res)) $batches[] = $r;
    echo json_encode(['success' => true, 'data' => $batches]);
    exit;
}

// ════════════════════════════════════════════════════════
//  NOTIFICATIONS POLL (cancellation alerts for active orders)
// ════════════════════════════════════════════════════════
if ($action === 'notifications_poll') {
    // Primary: unread 'cancelled' notifications joined to cancellation_logs for order data
    $res = mysqli_query($conn,
        "SELECT cl.log_id, cl.order_id, cl.reason, cl.created_at,
                o.order_number, o.status
         FROM cancellation_logs cl
         JOIN orders o ON o.order_id = cl.order_id
         WHERE cl.created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
         ORDER BY cl.created_at DESC LIMIT 20");
    $cancels = [];
    while ($r = mysqli_fetch_assoc($res)) $cancels[] = $r;
    echo json_encode(['success' => true, 'data' => $cancels, 'type' => 'cancellations']);
    exit;
}

// ════════════════════════════════════════════════════════
//  DELIVERY ZONES (for zone-based dispatch view)
// ════════════════════════════════════════════════════════
if ($action === 'delivery_zones') {
    $res = mysqli_query($conn,
        "SELECT dz.zone_id, m.name AS municipality_name, m.municipality_id,
                dz.delivery_fee,
                COUNT(o.order_id) AS packed_count
         FROM delivery_zones dz
         JOIN municipalities m ON m.municipality_id = dz.municipality_id
         LEFT JOIN orders o ON o.zone_id = dz.zone_id AND o.status = 'Packed'
         GROUP BY dz.zone_id
         ORDER BY m.name ASC");
    $zones = [];
    while ($r = mysqli_fetch_assoc($res)) $zones[] = $r;

    $sRes = mysqli_query($conn, "SELECT slot_id, slot_label, start_time, end_time FROM time_slots ORDER BY start_time ASC");
    $slots = [];
    while ($r = mysqli_fetch_assoc($sRes)) $slots[] = $r;

    echo json_encode(['success' => true, 'data' => ['zones' => $zones, 'slots' => $slots]]);
    exit;
}

// ════════════════════════════════════════════════════════
//  PACK ORDER — FIFO batch deduction + audit log
// ════════════════════════════════════════════════════════
if ($action === 'pack_order') {
    $oid   = (int)($body['order_id'] ?? 0);
    $items = $body['items'] ?? [];
    // items: [{order_item_id, actual_weight, pricing_model, batch_overrides: [{batch_id, weight}]}]

    if (!$oid || empty($items)) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'order_id and items required.']);
        exit;
    }

    mysqli_begin_transaction($conn);
    try {
        $final_subtotal_sum = 0;
        $batch_alerts = [];

        foreach ($items as $item) {
            $item_id = (int)($item['order_item_id'] ?? 0);
            if (!$item_id) continue;

            $snap = mysqli_fetch_assoc(mysqli_query($conn,
                "SELECT oi.unit_price, oi.pricing_model, oi.quantity, oi.product_id, oi.estimated_weight
                 FROM order_items oi
                 WHERE oi.order_item_id = $item_id LIMIT 1"));
            if (!$snap) continue;

            $qty           = (int)$snap['quantity'];
            $unit_price    = (float)$snap['unit_price'];
            $pm            = $snap['pricing_model'] ?? ($snap['is_catch_weight'] ? 'catch_weight' : 'fixed_pack');
            $product_id    = (int)$snap['product_id'];
            $est_weight    = (float)$snap['estimated_weight'];

            if ($pm === 'catch_weight' || (isset($item['is_catch_weight']) && $item['is_catch_weight'])) {
                $actual_w  = (float)($item['actual_weight'] ?? 0);
                if ($actual_w <= 0) $actual_w = $est_weight * $qty;

                $final_sub = round($unit_price * $actual_w, 2);

                mysqli_query($conn,
                    "UPDATE order_items SET actual_weight = $actual_w, final_subtotal = $final_sub
                     WHERE order_item_id = $item_id");

                // ── FIFO batch deduction ─────────────────────────────
                $batch_overrides = $item['batch_overrides'] ?? null;

                if ($batch_overrides && is_array($batch_overrides) && count($batch_overrides) > 0) {
                    // Manual or split-batch deduction
                    foreach ($batch_overrides as $bo) {
                        $bid = (int)($bo['batch_id'] ?? 0);
                        $bwt = (float)($bo['weight'] ?? 0);
                        if (!$bid || $bwt <= 0) continue;

                        $bRow = mysqli_fetch_assoc(mysqli_query($conn,
                            "SELECT remaining_qty FROM product_batches WHERE batch_id = $bid LIMIT 1"));
                        if (!$bRow) continue;

                        $deduct = min($bwt, (float)$bRow['remaining_qty']);
                        $newQty = max(0, (float)$bRow['remaining_qty'] - $deduct);
                        mysqli_query($conn,
                            "UPDATE product_batches SET remaining_qty = $newQty WHERE batch_id = $bid");

                        if ($newQty == 0) {
                            $batch_alerts[] = "Batch #$bid is now completely depleted.";
                        } elseif ($newQty < 5) {
                            $batch_alerts[] = "Batch #$bid is low: " . number_format($newQty, 3) . " kg remaining.";
                        }

                        // Audit per batch deduction
                        $detail = mysqli_real_escape_string($conn,
                            "Batch #$bid deducted {$deduct} kg for order_item #{$item_id} (actual_weight={$actual_w})");
                        mysqli_query($conn,
                            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                             VALUES ($staff_id, 'batch_deduction', 'product_batch', $bid, '$detail')");
                    }
                } else {
                    // Auto-FIFO: deduct from oldest batches first
                    $remaining_to_deduct = $actual_w;
                    $batchRes = mysqli_query($conn,
                        "SELECT batch_id, remaining_qty FROM product_batches
                         WHERE product_id = $product_id AND remaining_qty > 0
                         ORDER BY batch_date ASC");

                    while ($remaining_to_deduct > 0 && ($bRow = mysqli_fetch_assoc($batchRes))) {
                        $bid      = (int)$bRow['batch_id'];
                        $avail    = (float)$bRow['remaining_qty'];
                        $deduct   = min($remaining_to_deduct, $avail);
                        $newQty   = max(0, $avail - $deduct);

                        mysqli_query($conn,
                            "UPDATE product_batches SET remaining_qty = $newQty WHERE batch_id = $bid");

                        $remaining_to_deduct -= $deduct;

                        if ($newQty == 0) {
                            $batch_alerts[] = "Batch #$bid is now completely depleted.";
                        } elseif ($newQty < 5) {
                            $batch_alerts[] = "Batch #$bid is low: " . number_format($newQty, 3) . " kg remaining.";
                        }

                        $detail = mysqli_real_escape_string($conn,
                            "FIFO deducted {$deduct} kg from batch #{$bid} for order_item #{$item_id} (actual_weight={$actual_w})");
                        mysqli_query($conn,
                            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                             VALUES ($staff_id, 'batch_deduction', 'product_batch', $bid, '$detail')");
                    }

                    if ($remaining_to_deduct > 0.001) {
                        mysqli_rollback($conn);
                        http_response_code(422);
                        echo json_encode([
                            'success' => false,
                            'message' => "Insufficient stock: " . number_format($remaining_to_deduct, 3) . " kg could not be fulfilled from available batches. Please check inventory.",
                        ]);
                        exit;
                    }
                }

                // ── Weight variance audit log (FR: accountability) ────
                $variance   = round($actual_w - ($est_weight * $qty), 4);
                $varDetail  = mysqli_real_escape_string($conn,
                    "order_item_id=$item_id | est_weight=" . ($est_weight * $qty) .
                    "kg | actual_weight={$actual_w}kg | variance={$variance}kg");
                mysqli_query($conn,
                    "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                     VALUES ($staff_id, 'weight_variance', 'order_item', $item_id, '$varDetail')");

            } else {
                // Fixed / per-piece items
                $final_sub = round($unit_price * $qty, 2);
                mysqli_query($conn,
                    "UPDATE order_items SET final_subtotal = $final_sub WHERE order_item_id = $item_id");

                // Deduct fixed-quantity items from FIFO batches
                $remaining_fixed = (float)$qty;
                $fixed_batches = mysqli_query($conn,
                    "SELECT batch_id, remaining_qty FROM product_batches
                     WHERE product_id = $product_id AND remaining_qty > 0
                     ORDER BY batch_date ASC");
                while ($fb = mysqli_fetch_assoc($fixed_batches)) {
                    if ($remaining_fixed <= 0) break;
                    $bid_f   = (int)$fb['batch_id'];
                    $avail_f = (float)$fb['remaining_qty'];
                    $deduct_f = min($remaining_fixed, $avail_f);
                    $newQty_f = max(0, $avail_f - $deduct_f);
                    mysqli_query($conn,
                        "UPDATE product_batches SET remaining_qty = $newQty_f WHERE batch_id = $bid_f");
                    $remaining_fixed -= $deduct_f;
                    if ($newQty_f == 0)  $batch_alerts[] = "Batch #$bid_f is now completely depleted.";
                    elseif ($newQty_f < 5) $batch_alerts[] = "Batch #$bid_f is low: " . number_format($newQty_f, 3) . " remaining.";
                    $fd = mysqli_real_escape_string($conn,
                        "FIFO deducted {$deduct_f} units from batch #{$bid_f} for order_item #{$item_id} (fixed, qty={$qty})");
                    mysqli_query($conn,
                        "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                         VALUES ($staff_id, 'batch_deduction', 'product_batch', $bid_f, '$fd')");
                }
            }

            $final_subtotal_sum += $final_sub;
        }

        // Recalculate final total
        $ord = mysqli_fetch_assoc(mysqli_query($conn,
            "SELECT delivery_fee, discount_amount, user_id, order_number FROM orders WHERE order_id = $oid LIMIT 1"));
        $final_total = round($final_subtotal_sum - (float)$ord['discount_amount'] + (float)$ord['delivery_fee'], 2);

        mysqli_query($conn,
            "UPDATE orders SET status = 'Packed', final_total = $final_total WHERE order_id = $oid");
        mysqli_query($conn,
            "UPDATE payments SET amount = $final_total WHERE order_id = $oid");

        // Notify customer
        $uid  = (int)$ord['user_id'];
        $onum = mysqli_real_escape_string($conn, $ord['order_number']);
        mysqli_query($conn,
            "INSERT INTO notifications (user_id, message, type)
             VALUES ($uid, 'Your order $onum has been packed. Final total: ₱$final_total', 'packed')");

        // Pack audit log
        $packDetail = mysqli_real_escape_string($conn,
            "Order #{$oid} packed by staff #{$staff_id}. Final total: {$final_total}");
        mysqli_query($conn,
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES ($staff_id, 'pack_order', 'order', $oid, '$packDetail')");

        mysqli_commit($conn);
        echo json_encode([
            'success'       => true,
            'message'       => 'Order packed.',
            'final_total'   => $final_total,
            'batch_alerts'  => $batch_alerts,
        ]);

    } catch (Exception $ex) {
        mysqli_rollback($conn);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $ex->getMessage()]);
    }
    exit;
}

// ════════════════════════════════════════════════════════
//  MARK ITEM OUT OF STOCK (partial fulfillment)
// ════════════════════════════════════════════════════════
if ($action === 'mark_out_of_stock') {
    $oid     = (int)($body['order_id'] ?? 0);
    $item_id = (int)($body['order_item_id'] ?? 0);

    if (!$oid || !$item_id) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'order_id and order_item_id required.']);
        exit;
    }

    mysqli_begin_transaction($conn);
    try {
        // Zero out the item
        mysqli_query($conn,
            "UPDATE order_items SET actual_weight = 0, final_subtotal = 0, quantity = 0
             WHERE order_item_id = $item_id AND order_id = $oid");

        // Recalculate final total from all items
        $itemsRes = mysqli_query($conn,
            "SELECT oi.order_item_id, oi.unit_price, oi.pricing_model, oi.quantity,
                    oi.actual_weight, oi.final_subtotal, oi.estimated_subtotal
             FROM order_items oi WHERE oi.order_id = $oid");
        $total_items = 0;
        while ($i = mysqli_fetch_assoc($itemsRes)) {
            if ((int)$i['order_item_id'] === $item_id) continue;
            $sub = $i['final_subtotal'] > 0 ? (float)$i['final_subtotal'] : (float)$i['estimated_subtotal'];
            $total_items += $sub;
        }

        $ord = mysqli_fetch_assoc(mysqli_query($conn,
            "SELECT o.delivery_fee, o.discount_amount, o.user_id, o.order_number,
                    o.promo_id, pc.min_order_value, pc.discount_type, pc.discount_value
             FROM orders o
             LEFT JOIN promo_codes pc ON pc.promo_id = o.promo_id
             WHERE o.order_id = $oid LIMIT 1"));

        // Re-validate promo min_order_value against the new items total
        $valid_discount = (float)$ord['discount_amount'];
        if ($ord['promo_id'] && $ord['min_order_value'] !== null) {
            if ($total_items < (float)$ord['min_order_value']) {
                $valid_discount = 0;
                mysqli_query($conn, "UPDATE orders SET promo_id = NULL, discount_amount = 0 WHERE order_id = $oid");
            }
        }
        $new_total = round($total_items - $valid_discount + (float)$ord['delivery_fee'], 2);
        if ($new_total < 0) $new_total = 0;

        // Auto-cancel if every item is zeroed out
        $remaining_items = mysqli_fetch_assoc(mysqli_query($conn,
            "SELECT COUNT(*) AS n FROM order_items
             WHERE order_id = $oid AND quantity > 0 AND (final_subtotal > 0 OR estimated_subtotal > 0)"));
        if ((int)$remaining_items['n'] === 0 || $new_total <= 0) {
            mysqli_query($conn, "UPDATE orders SET status = 'Cancelled', final_total = 0 WHERE order_id = $oid");
            mysqli_query($conn, "UPDATE payments SET amount = 0 WHERE order_id = $oid");
            mysqli_query($conn, "INSERT INTO cancellation_logs (order_id, initiated_by, reason)
                                 VALUES ($oid, $staff_id, 'Auto-cancelled: all items out of stock')");
            $msg_cancel = mysqli_real_escape_string($conn,
                "All items in your order {$ord['order_number']} were unavailable. Your order has been cancelled.");
            mysqli_query($conn, "INSERT INTO notifications (user_id, message, type)
                                 VALUES ({$ord['user_id']}, '$msg_cancel', 'cancelled')");
            mysqli_commit($conn);
            echo json_encode(['success' => true, 'message' => 'Order cancelled — all items out of stock.', 'new_total' => 0, 'auto_cancelled' => true]);
            exit;
        }

        mysqli_query($conn,
            "UPDATE orders SET final_total = $new_total WHERE order_id = $oid");
        mysqli_query($conn,
            "UPDATE payments SET amount = $new_total WHERE order_id = $oid");

        // Audit log
        $detail = mysqli_real_escape_string($conn,
            "order_item_id=$item_id marked Out of Stock by staff $staff_id. New order total: $new_total");
        mysqli_query($conn,
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES ($staff_id, 'mark_out_of_stock', 'order_item', $item_id, '$detail')");

        // Notify customer
        $uid  = (int)$ord['user_id'];
        $onum = mysqli_real_escape_string($conn, $ord['order_number']);
        mysqli_query($conn,
            "INSERT INTO notifications (user_id, message, type)
             VALUES ($uid, 'We could not fulfill an item in order $onum (out of stock). Your updated total is ₱$new_total.', 'partial_fulfillment')");

        mysqli_commit($conn);
        echo json_encode([
            'success'    => true,
            'message'    => 'Item marked out of stock. Order total updated.',
            'new_total'  => $new_total,
        ]);

    } catch (Exception $ex) {
        mysqli_rollback($conn);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $ex->getMessage()]);
    }
    exit;
}

// ════════════════════════════════════════════════════════
//  ASSIGN RIDER
// ════════════════════════════════════════════════════════
if ($action === 'assign_rider') {
    $oid      = (int)($body['order_id'] ?? 0);
    $rider_id = (int)($body['rider_id'] ?? 0);
    if (!$oid || !$rider_id) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'order_id and rider_id required.']);
        exit;
    }

    mysqli_query($conn,
        "INSERT INTO deliveries (order_id, rider_id, assigned_by, status)
         VALUES ($oid, $rider_id, $staff_id, 'Assigned')
         ON DUPLICATE KEY UPDATE rider_id = $rider_id, assigned_by = $staff_id, status = 'Assigned'");

    $detail = mysqli_real_escape_string($conn, "Rider $rider_id assigned to order $oid by staff $staff_id");
    mysqli_query($conn,
        "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
         VALUES ($staff_id, 'assign_rider', 'order', $oid, '$detail')");

    echo json_encode(['success' => true, 'message' => 'Rider assigned.']);
    exit;
}

// ════════════════════════════════════════════════════════
//  BATCH ASSIGN RIDERS (zone-based, one rider → many orders)
// ════════════════════════════════════════════════════════
if ($action === 'batch_assign_riders') {
    $order_ids = $body['order_ids'] ?? [];
    $rider_id  = (int)($body['rider_id'] ?? 0);

    if (empty($order_ids) || !$rider_id) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'order_ids array and rider_id required.']);
        exit;
    }

    mysqli_begin_transaction($conn);
    try {
        $assigned = 0;
        foreach ($order_ids as $oid) {
            $oid = (int)$oid;
            if (!$oid) continue;

            $ordRow = mysqli_fetch_assoc(mysqli_query($conn,
                "SELECT status FROM orders WHERE order_id = $oid LIMIT 1"));
            if (!$ordRow || $ordRow['status'] !== 'Packed') continue;

            mysqli_query($conn,
                "INSERT INTO deliveries (order_id, rider_id, assigned_by, status)
                 VALUES ($oid, $rider_id, $staff_id, 'Assigned')
                 ON DUPLICATE KEY UPDATE rider_id = $rider_id, assigned_by = $staff_id, status = 'Assigned'");
            $assigned++;
        }
        mysqli_commit($conn);
        echo json_encode(['success' => true, 'message' => "$assigned orders assigned to rider.", 'assigned' => $assigned]);
    } catch (Exception $ex) {
        mysqli_rollback($conn);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $ex->getMessage()]);
    }
    exit;
}

// ════════════════════════════════════════════════════════
//  DISPATCH ORDER (Out for Delivery)
// ════════════════════════════════════════════════════════
if ($action === 'dispatch_order') {
    $oid = (int)($body['order_id'] ?? 0);
    if (!$oid) { http_response_code(422); echo json_encode(['success' => false, 'message' => 'order_id required.']); exit; }

    mysqli_begin_transaction($conn);
    try {
        mysqli_query($conn,
            "UPDATE orders SET status = 'Out for Delivery' WHERE order_id = $oid AND status IN ('Packed')");
        mysqli_query($conn,
            "UPDATE deliveries SET status = 'Out for Delivery', dispatched_at = NOW()
             WHERE order_id = $oid");

        $ord = mysqli_fetch_assoc(mysqli_query($conn,
            "SELECT user_id, order_number FROM orders WHERE order_id = $oid LIMIT 1"));
        $uid  = (int)$ord['user_id'];
        $onum = mysqli_real_escape_string($conn, $ord['order_number']);
        mysqli_query($conn,
            "INSERT INTO notifications (user_id, message, type)
             VALUES ($uid, 'Your order $onum is now out for delivery! 🛵', 'dispatched')");

        $detail = mysqli_real_escape_string($conn, "Order $oid dispatched by staff $staff_id");
        mysqli_query($conn,
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES ($staff_id, 'dispatch_order', 'order', $oid, '$detail')");

        mysqli_commit($conn);
        echo json_encode(['success' => true, 'message' => 'Order dispatched for delivery.']);
    } catch (Exception $ex) {
        mysqli_rollback($conn);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $ex->getMessage()]);
    }
    exit;
}

// ════════════════════════════════════════════════════════
//  COMPLETE DELIVERY
// ════════════════════════════════════════════════════════
if ($action === 'complete_delivery') {
    $oid = (int)($body['order_id'] ?? 0);
    if (!$oid) { http_response_code(422); echo json_encode(['success' => false, 'message' => 'order_id required.']); exit; }

    mysqli_begin_transaction($conn);
    try {
        mysqli_query($conn,
            "UPDATE orders SET status = 'Completed' WHERE order_id = $oid");
        mysqli_query($conn,
            "UPDATE deliveries SET status = 'Delivered', delivered_at = NOW()
             WHERE order_id = $oid");

        $detail = mysqli_real_escape_string($conn, "Order $oid marked completed by staff $staff_id");
        mysqli_query($conn,
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES ($staff_id, 'complete_delivery', 'order', $oid, '$detail')");

        mysqli_commit($conn);
        echo json_encode(['success' => true, 'message' => 'Delivery marked as completed.']);
    } catch (Exception $ex) {
        mysqli_rollback($conn);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $ex->getMessage()]);
    }
    exit;
}

// ════════════════════════════════════════════════════════
//  ADJUST STOCK (spoilage / shrinkage — without an order)
// ════════════════════════════════════════════════════════
if ($action === 'adjust_stock') {
    $batch_id    = (int)($body['batch_id'] ?? 0);
    $new_qty     = (float)($body['actual_physical_qty'] ?? -1);
    $reason_code = mysqli_real_escape_string($conn, $body['reason_code'] ?? 'Count Correction');
    $notes       = mysqli_real_escape_string($conn, $body['notes'] ?? '');

    if (!$batch_id || $new_qty < 0) {
        http_response_code(422);
        echo json_encode(['success' => false, 'message' => 'batch_id and actual_physical_qty (>=0) required.']);
        exit;
    }

    $allowed_reasons = ['Shrinkage/Water Loss', 'Spoilage', 'Damaged in Handling', 'Count Correction'];
    if (!in_array($reason_code, $allowed_reasons)) {
        $reason_code = 'Count Correction';
    }

    mysqli_begin_transaction($conn);
    try {
        $bRow = mysqli_fetch_assoc(mysqli_query($conn,
            "SELECT batch_id, product_id, remaining_qty FROM product_batches WHERE batch_id = $batch_id LIMIT 1"));
        if (!$bRow) {
            mysqli_rollback($conn);
            echo json_encode(['success' => false, 'message' => 'Batch not found.']);
            exit;
        }

        $old_qty   = (float)$bRow['remaining_qty'];
        $variance  = round($new_qty - $old_qty, 4);

        mysqli_query($conn,
            "UPDATE product_batches SET remaining_qty = $new_qty WHERE batch_id = $batch_id");

        $detail = mysqli_real_escape_string($conn,
            "Batch #$batch_id | reason=$reason_code | old_qty={$old_qty}kg | new_qty={$new_qty}kg | variance={$variance}kg | notes: $notes");
        mysqli_query($conn,
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES ($staff_id, 'stock_adjustment', 'product_batch', $batch_id, '$detail')");

        mysqli_commit($conn);
        echo json_encode([
            'success'  => true,
            'message'  => 'Stock adjusted.',
            'old_qty'  => $old_qty,
            'new_qty'  => $new_qty,
            'variance' => $variance,
        ]);
    } catch (Exception $ex) {
        mysqli_rollback($conn);
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $ex->getMessage()]);
    }
    exit;
}

// ════════════════════════════════════════════════════════
//  MARK NOTIFICATIONS READ
// ════════════════════════════════════════════════════════
if ($action === 'mark_notifications_read') {
    $ids = $body['notification_ids'] ?? [];
    if (!empty($ids)) {
        $safe_ids = implode(',', array_map('intval', $ids));
        mysqli_query($conn, "UPDATE notifications SET is_read = 1 WHERE notification_id IN ($safe_ids)");
    }
    echo json_encode(['success' => true]);
    exit;
}

http_response_code(400);
echo json_encode(['success' => false, 'message' => 'Invalid action.']);