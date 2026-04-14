<?php
/**
 * OrderService — the core domain service for all order lifecycle operations.
 *
 * Covers: listing, detail, placement, packing (admin & fulfillment),
 * cancellation, rider assignment, dispatch, delivery completion,
 * payment verification, and rider-specific actions.
 */
class OrderService extends BaseService
{
    private NotificationService $notifications;
    private InventoryService    $inventory;

    public function __construct(mysqli $conn)
    {
        parent::__construct($conn);
        $this->notifications = new NotificationService($conn);
        $this->inventory     = new InventoryService($conn);
    }

    // ── Shared order queries ──────────────────────────────────────

    /**
     * Paginated order list used by both admin and fulfillment staff.
     *
     * @param string $extraSelect  Additional SELECT columns (e.g. zone/slot cols for fulfillment).
     * @param string $extraJoin    Additional JOINs.
     * @param string $orderBy      ORDER BY clause.
     */
    public function getOrders(
        string $status,
        string $search,
        int    $page,
        int    $limit,
        string $extraSelect = '',
        string $extraJoin   = '',
        string $orderBy     = 'o.created_at DESC'
    ): array {
        $conditions = ['1=1'];
        $types      = '';
        $params     = [];

        if ($status !== '') {
            $conditions[] = 'o.status = ?';
            $types .= 's';
            $params[] = $status;
        }
        if ($search !== '') {
            $conditions[] = '(o.order_number LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)';
            $like = "%$search%";
            $types .= 'ssss';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $where  = implode(' AND ', $conditions);
        $offset = ($page - 1) * $limit;

        $countRow = $this->fetchOne(
            "SELECT COUNT(*) AS n
             FROM orders o
             JOIN users u ON u.user_id = o.user_id
             $extraJoin
             WHERE $where",
            $types,
            $params
        );
        $total = (int) ($countRow['n'] ?? 0);

        $listSql = "SELECT o.order_id, o.order_number, o.status,
                           o.estimated_total, o.final_total, o.discount_amount,
                           o.delivery_fee, o.payment_method, o.delivery_date, o.created_at,
                           u.first_name, u.last_name, u.email,
                           p.status AS pay_status
                           $extraSelect
                    FROM orders o
                    JOIN users    u ON u.user_id   = o.user_id
                    LEFT JOIN payments p ON p.order_id = o.order_id
                    $extraJoin
                    WHERE $where
                    ORDER BY $orderBy
                    LIMIT ? OFFSET ?";

        $listTypes  = $types . 'ii';
        $listParams = array_merge($params, [$limit, $offset]);
        $orders     = $this->fetchAll($listSql, $listTypes, $listParams);

        return [
            'orders' => $orders,
            'total'  => $total,
            'page'   => $page,
            'pages'  => (int) ceil($total / max(1, $limit)),
        ];
    }

    /**
     * Full detail of a single order including items (admin / fulfillment view).
     */
    public function getOrderDetail(int $oid): ?array
    {
        $order = $this->fetchOne(
            "SELECT o.*, u.first_name, u.last_name, u.email, u.phone,
                    a.label AS addr_label, a.street,
                    b.name AS barangay, m_addr.name AS city, 'Albay' AS province,
                    ts.slot_label,
                    m_zone.name AS zone_city, dz.delivery_fee AS zone_fee,
                    pc.code AS promo_code,
                    p.status AS pay_status, p.verified_at,
                    d.rider_id, d.status AS delivery_status, d.proof_of_delivery_url,
                    d.dispatched_at, d.delivered_at,
                    ru.first_name AS rider_first, ru.last_name AS rider_last, ru.phone AS rider_phone
             FROM orders o
             JOIN users    u  ON u.user_id     = o.user_id
             JOIN addresses a ON a.address_id  = o.address_id
             LEFT JOIN barangays      b      ON b.barangay_id        = a.barangay_id
             LEFT JOIN municipalities m_addr ON m_addr.municipality_id = a.municipality_id
             LEFT JOIN time_slots     ts ON ts.slot_id   = o.slot_id
             LEFT JOIN delivery_zones dz ON dz.zone_id   = o.zone_id
             LEFT JOIN municipalities m_zone ON m_zone.municipality_id = dz.municipality_id
             LEFT JOIN promo_codes    pc ON pc.promo_id   = o.promo_id
             LEFT JOIN payments        p ON p.order_id    = o.order_id
             LEFT JOIN deliveries      d ON d.order_id    = o.order_id
             LEFT JOIN users          ru ON ru.user_id    = d.rider_id
             WHERE o.order_id = ? LIMIT 1",
            'i',
            [$oid]
        );

        if (!$order) {
            return null;
        }

        $items = $this->fetchAll(
            "SELECT oi.order_item_id, oi.order_id, oi.product_id,
                    oi.quantity, oi.unit_price, oi.pricing_model,
                    oi.estimated_weight, oi.actual_weight,
                    oi.estimated_subtotal, oi.final_subtotal,
                    p.name, p.is_catch_weight, c.name AS category_name,
                    oi.unit_price AS price_per_kg
             FROM order_items oi
             JOIN products   p ON p.product_id  = oi.product_id
             JOIN categories c ON c.category_id = p.category_id
             WHERE oi.order_id = ?",
            'i',
            [$oid]
        );

        $order['items'] = $items;
        return $order;
    }

    /**
     * Simplified order detail used by the customer-facing API.
     */
    public function getCustomerOrderDetail(int $oid): ?array
    {
        $order = $this->fetchOne(
            "SELECT o.*,
                    a.street,
                    b.name AS barangay, m_addr.name AS city, 'Albay' AS province,
                    ts.slot_label,
                    dz.delivery_fee AS zone_fee,
                    pay.status      AS pay_status,
                    pay.method      AS pay_method,
                    pay.verified_at AS pay_verified_at,
                    d.proof_of_delivery_url,
                    d.dispatched_at,
                    d.delivered_at
             FROM orders o
             LEFT JOIN addresses      a      ON a.address_id        = o.address_id
             LEFT JOIN barangays      b      ON b.barangay_id        = a.barangay_id
             LEFT JOIN municipalities m_addr ON m_addr.municipality_id = a.municipality_id
             LEFT JOIN time_slots     ts  ON ts.slot_id    = o.slot_id
             LEFT JOIN delivery_zones dz  ON dz.zone_id    = o.zone_id
             LEFT JOIN payments       pay ON pay.order_id  = o.order_id
             LEFT JOIN deliveries     d   ON d.order_id    = o.order_id
             WHERE o.order_id = ? LIMIT 1",
            'i',
            [$oid]
        );
 
        if (!$order) {
            return null;
        }
 
        $order['items'] = $this->fetchAll(
            "SELECT oi.*, p.name, p.pricing_model, p.unit_of_measure, p.is_catch_weight,
                    p.estimated_weight AS product_estimated_weight
             FROM order_items oi
             JOIN products p ON p.product_id = oi.product_id
             WHERE oi.order_id = ?",
            'i',
            [$oid]
        );
 
        // Dispute for this order (if any)
        $order['dispute'] = $this->fetchOne(
            "SELECT dispute_id, status AS dispute_status, description, evidence_url, created_at,
                    resolved_at
             FROM disputes
             WHERE order_id = ? AND user_id = ?
             ORDER BY dispute_id DESC LIMIT 1",
            'ii',
            [$oid, (int)$order['user_id']]
        );
 
        return $order;
    }


    /**
     * Full order detail for a rider (includes GPS coordinates, payment details).
     */
    public function getRiderOrderDetail(int $oid): ?array
    {
        $order = $this->fetchOne(
            "SELECT o.*,
                    u.first_name, u.last_name, u.email, u.phone,
                    a.label AS addr_label, a.street,
                    b.name AS barangay, m_addr.name AS city, 'Albay' AS province,
                    a.latitude, a.longitude,
                    ts.slot_label, ts.end_time AS slot_end_time,
                    dz.delivery_fee AS zone_fee,
                    pc.code AS promo_code,
                    pay.status AS pay_status, pay.method AS pay_method, pay.verified_at,
                    d.status AS delivery_status, d.proof_of_delivery_url,
                    d.dispatched_at, d.delivered_at
             FROM orders o
             JOIN users      u   ON u.user_id     = o.user_id
             JOIN addresses  a      ON a.address_id        = o.address_id
             LEFT JOIN barangays      b      ON b.barangay_id        = a.barangay_id
             LEFT JOIN municipalities m_addr ON m_addr.municipality_id = a.municipality_id
             LEFT JOIN time_slots     ts  ON ts.slot_id   = o.slot_id
             LEFT JOIN delivery_zones dz  ON dz.zone_id   = o.zone_id
             LEFT JOIN promo_codes    pc  ON pc.promo_id   = o.promo_id
             LEFT JOIN payments       pay ON pay.order_id  = o.order_id
             LEFT JOIN deliveries     d   ON d.order_id    = o.order_id
             WHERE o.order_id = ? LIMIT 1",
            'i',
            [$oid]
        );

        if (!$order) {
            return null;
        }

        $items = $this->fetchAll(
            "SELECT oi.*, p.name, p.is_catch_weight, p.estimated_weight AS product_est_weight
             FROM order_items oi
             JOIN products p ON p.product_id = oi.product_id
             WHERE oi.order_id = ?",
            'i',
            [$oid]
        );

        $order['items'] = $items;
        return $order;
    }

    // ── Customer: place order ─────────────────────────────────────

    /**
     * Place a new order from a user's cart.
     */
public function placeOrder(
        int    $uid,
        int    $addressId,
        int    $slotId,
        int    $zoneId,
        string $paymentMethod,
        string $deliveryDate,
        string $specialInstructions,
        string $promoCode
    ): array {
// Verify address ownership
        $addressCheck = $this->fetchOne(
            "SELECT address_id, barangay_id, municipality_id FROM addresses WHERE address_id = ? AND user_id = ? LIMIT 1",
            'ii',
            [$addressId, $uid]
        );
        if (!$addressCheck) {
            throw new RuntimeException('Invalid address selection. Please choose one of your saved addresses.');
        }

        // Load cart
        $cart = $this->fetchOne(
            "SELECT cart_id FROM carts WHERE user_id = ? LIMIT 1",
            'i',
            [$uid]
        );
        if (!$cart) {
            throw new RuntimeException('Cart not found.');
        }
        $cartId = (int) $cart['cart_id'];

        $cartItems = $this->fetchAll(
            "SELECT ci.cart_item_id, ci.product_id, ci.quantity,
                    p.name, p.base_price, p.pricing_model, p.estimated_weight, p.unit_of_measure
             FROM cart_items ci
             JOIN products p ON p.product_id = ci.product_id
             WHERE ci.cart_id = ?",
            'i',
            [$cartId]
        );

        if (empty($cartItems)) {
            throw new RuntimeException('Cart is empty.');
        }
 
        // [NEW] Reject order if any product is archived
        $productIds   = array_map(fn($i) => (int) $i['product_id'], $cartItems);
        $placeholders = implode(',', array_fill(0, count($productIds), '?'));
        $types        = str_repeat('i', count($productIds));
        $archivedRows = $this->fetchAll(
            "SELECT name FROM products
             WHERE product_id IN ($placeholders) AND status = 'archived'",
            $types,
            $productIds
        );
        if (!empty($archivedRows)) {
            $names = implode(', ', array_column($archivedRows, 'name'));
            throw new RuntimeException(
                "The following item(s) are no longer available and must be removed from your cart before checking out: $names"
            );
        }

// Stock validation with row-level locking to prevent overselling
        $this->beginTransaction();
        try {
            $stockPlaceholders = implode(',', array_fill(0, count($productIds), '?'));
            $stockRows = $this->fetchAll(
                "SELECT product_id, COALESCE(SUM(remaining_qty), 0) AS total
                 FROM product_batches
                 WHERE product_id IN ($stockPlaceholders)
                 GROUP BY product_id
                 FOR UPDATE",
                str_repeat('i', count($productIds)),
                $productIds
            );

            $stockMap = [];
            foreach ($stockRows as $sr) {
                $stockMap[(int) $sr['product_id']] = (float) $sr['total'];
            }

            $shortItems = [];
            foreach ($cartItems as $item) {
                $pid       = (int) $item['product_id'];
                $available = $stockMap[$pid] ?? 0.0;
                if ((float) $item['quantity'] > $available) {
                    $shortItems[] = $item['name'] . ' (available: ' . floor($available) . ', requested: ' . $item['quantity'] . ')';
                }
            }

            if (!empty($shortItems)) {
                $this->rollback();
                throw new RuntimeException(
                    'Insufficient stock for the following item(s): ' . implode('; ', $shortItems) .
                    '. Please update your cart before checking out.'
                );
            }

            // Delivery Fee — look up the zone by ID only (frontend already matched barangay/city)
            $deliveryFee = 0.0;
            if ($zoneId > 0) {
                $zone = $this->fetchOne(
                    "SELECT zone_id, delivery_fee FROM delivery_zones WHERE zone_id = ? LIMIT 1",
                    'i',
                    [$zoneId]
                );
                if (!$zone) {
                    throw new RuntimeException('Invalid delivery zone. Please refresh and try again.');
                }
                $deliveryFee = (float) $zone['delivery_fee'];
            }

            // Estimated total
            $estTotal = 0.0;
            foreach ($cartItems as $item) {
                $estTotal += CartService::estimatedSubtotal(
                    $item['pricing_model'],
                    (int) $item['quantity'],
                    (float) $item['base_price'],
                    (float) $item['estimated_weight']
                );
            }

            // Promo validation
            $discount = 0.0;
            $promoId  = null;

            if ($promoCode !== '') {
                $promoExists = $this->fetchOne(
                    "SELECT pc.promo_id, pc.is_active, pc.valid_from, pc.valid_to,
                            pc.usage_limit, pc.discount_type, pc.discount_value, pc.min_order_value,
                            (SELECT COUNT(*) FROM orders
                             WHERE promo_id = pc.promo_id
                               AND status NOT IN ('Cancelled')) AS times_used
                     FROM promo_codes pc WHERE pc.code = ? LIMIT 1",
                    's',
                    [strtoupper($promoCode)]
                );
                if (!$promoExists) {
                    throw new RuntimeException("Promo code \"{$promoCode}\" does not exist.");
                }
                $today = date('Y-m-d');
                if (!$promoExists['is_active']) {
                    throw new RuntimeException("Promo code \"{$promoCode}\" is no longer active.");
                }
                if ($promoExists['valid_to'] && $today > $promoExists['valid_to']) {
                    throw new RuntimeException("Promo code \"{$promoCode}\" has expired.");
                }
                if ($promoExists['usage_limit'] !== null
                    && (int) $promoExists['times_used'] >= (int) $promoExists['usage_limit']) {
                    throw new RuntimeException("Promo code \"{$promoCode}\" has reached its usage limit.");
                }
                if ($estTotal < (float) $promoExists['min_order_value']) {
                    throw new RuntimeException(
                        "Your cart total must be at least ₱" .
                        number_format($promoExists['min_order_value'], 2) .
                        " to use promo code \"{$promoCode}\"."
                    );
                }
                $promoId  = (int) $promoExists['promo_id'];
                $discount = $promoExists['discount_type'] === 'percentage'
                    ? round($estTotal * (float) $promoExists['discount_value'] / 100, 2)
                    : (float) $promoExists['discount_value'];
                $discount = min($discount, $estTotal);
            }

            // Validate delivery date
            $today = date('Y-m-d');
            if ($deliveryDate < $today) {
                throw new RuntimeException('Delivery date cannot be in the past.');
            }
            $dow            = date('w', strtotime($deliveryDate));
            $operationalDay = $this->fetchOne(
                "SELECT day_of_week FROM operational_hours
                 WHERE day_of_week = ? AND is_active = 1 LIMIT 1",
                'i',
                [$dow]
            );
            if (!$operationalDay) {
                throw new RuntimeException('Delivery is not available on the selected date. Please choose a day when the store is open.');
            }

            // Validate time slot
            if ($slotId > 0) {
                $slot = $this->fetchOne(
                    "SELECT slot_id, start_time, is_active FROM time_slots WHERE slot_id = ? LIMIT 1",
                    'i',
                    [$slotId]
                );
                if (!$slot || !$slot['is_active']) {
                    throw new RuntimeException('Selected time slot is not available.');
                }
                if ($deliveryDate === $today) {
                    $currentTime = date('H:i:s');
                    if ($currentTime >= $slot['start_time']) {
                        throw new RuntimeException('The selected time slot has already passed for today. Please choose a later slot or a future date.');
                    }
                }
            }

            $estimatedTotal = round($estTotal - $discount + $deliveryFee, 2);
            $orderNumber    = 'PM-' . strtoupper(substr(md5(uniqid('', true)), 0, 8));

            $oid = $this->insertGetId(
                "INSERT INTO orders
                     (user_id, address_id, promo_id, zone_id, slot_id,
                      order_number, delivery_date, estimated_total,
                      discount_amount, delivery_fee, payment_method,
                      special_instructions, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')",
                'iiiiissdddss',
                [
                    $uid, $addressId,
                    $promoId ?: null, $zoneId ?: null, $slotId ?: null,
                    $orderNumber, $deliveryDate, $estimatedTotal,
                    $discount, $deliveryFee, $paymentMethod, $specialInstructions,
                ]
            );

            foreach ($cartItems as $item) {
                $qty       = (int) $item['quantity'];
                $unitPrice = (float) $item['base_price'];
                $estWeight = (float) $item['estimated_weight'];
                $pm        = $item['pricing_model'];
                $estSub    = CartService::estimatedSubtotal($pm, $qty, $unitPrice, $estWeight);
                $pid       = (int) $item['product_id'];

                $orderItemId = $this->insertGetId(
                    "INSERT INTO order_items
                         (order_id, product_id, quantity, unit_price, pricing_model,
                          estimated_weight, estimated_subtotal)
                     VALUES (?, ?, ?, ?, ?, ?, ?)",
                    'iiidsdd',
                    [$oid, $pid, $qty, $unitPrice, $pm, $estWeight, $estSub]
                );

                $remaining = (float) $qty;
                $batches   = $this->fetchAll(
                    "SELECT batch_id, remaining_qty
                     FROM product_batches
                     WHERE product_id = ? AND remaining_qty > 0
                     ORDER BY batch_date ASC",
                    'i',
                    [$pid]
                );

                foreach ($batches as $batch) {
                    if ($remaining <= 0) break;
                    $batchId   = (int) $batch['batch_id'];
                    $available = (float) $batch['remaining_qty'];
                    $deduct    = min($remaining, $available);
                    $newQty    = $available - $deduct;
                    $this->execute(
                        "UPDATE product_batches SET remaining_qty = ? WHERE batch_id = ?",
                        'di',
                        [$newQty, $batchId]
                    );
                    $remaining -= $deduct;
                    $this->execute(
                        "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                         VALUES (?, 'stock_reservation', 'product_batch', ?, ?)",
                        'iis',
                        [$uid, $batchId, "Reserved {$deduct} units for order_item #{$orderItemId} (order pending)"]
                    );
                }

                if ($remaining > 0) {
                    throw new RuntimeException("Stock reservation failed for {$item['name']}. Please contact support.");
                }
            }

            $this->execute(
                "INSERT INTO payments (order_id, amount, method, status) VALUES (?, ?, ?, 'Unpaid')",
                'ids',
                [$oid, $estimatedTotal, $paymentMethod]
            );

            if ($promoId) {
                $this->execute(
                    "UPDATE promo_codes SET times_used = times_used + 1 WHERE promo_id = ?",
                    'i',
                    [$promoId]
                );
            }

            $this->execute(
                "DELETE FROM cart_items WHERE cart_id = ?",
                'i',
                [$cartId]
            );

            $this->notifications->send(
                $uid,
                "Your order #$orderNumber has been placed! Estimated total: ₱$estimatedTotal",
                'order_placed'
            );

            $this->commit();
            return [
                'order_id'        => $oid,
                'order_number'    => $orderNumber,
                'estimated_total' => $estimatedTotal,
            ];
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }
    
/**
     * Allow a customer to edit a Pending order's date, slot, zone, payment method,
     * and special instructions. Items are not editable here (cancel and reorder instead).
     *
     * @throws RuntimeException if the order is not Pending or does not belong to the user.
     */
public function updatePendingOrder(
        int    $orderId,
        int    $uid,
        string $deliveryDate,
        int    $slotId,
        int    $zoneId,
        string $paymentMethod,
        string $specialInstructions
    ): void {
        $order = $this->fetchOne(
            "SELECT o.order_id, o.status, o.user_id
             FROM orders o
             WHERE o.order_id = ? LIMIT 1",
            'i',
            [$orderId]
        );
        if (!$order) {
            throw new RuntimeException('Order not found.');
        }
        if ((int) $order['user_id'] !== $uid) {
            throw new RuntimeException('You do not have permission to edit this order.');
        }
        if ($order['status'] !== 'Pending') {
            throw new RuntimeException('Only Pending orders can be edited. This order is already ' . $order['status'] . '.');
        }
if (!in_array($paymentMethod, ['COD', 'GCash'], true)) {
            throw new RuntimeException('Invalid payment method.');
        }

        // Validate delivery date (same as placeOrder)
        $today = date('Y-m-d');
        if ($deliveryDate < $today) {
            throw new RuntimeException('Delivery date cannot be in the past.');
        }
        $dow = date('w', strtotime($deliveryDate));
        $operationalDay = $this->fetchOne(
            "SELECT day_of_week FROM operational_hours WHERE day_of_week = ? AND is_active = 1 LIMIT 1",
            'i',
            [$dow]
        );
        if (!$operationalDay) {
            throw new RuntimeException('Delivery is not available on the selected date.');
        }

        // Validate time slot (same as placeOrder)
        if ($slotId > 0) {
            $slot = $this->fetchOne(
                "SELECT slot_id, start_time, is_active FROM time_slots WHERE slot_id = ? LIMIT 1",
                'i',
                [$slotId]
            );
            if (!$slot || !$slot['is_active']) {
                throw new RuntimeException('Selected time slot is not available.');
            }
            if ($deliveryDate === $today) {
                $currentTime = date('H:i:s');
                if ($currentTime >= $slot['start_time']) {
                    throw new RuntimeException('The selected time slot has already passed for today.');
                }
            }
        }

        // Recalculate delivery fee AND verify zone matches address

        // Validate zone matches address (prevent zone manipulation)
// Recalculate delivery fee AND verify zone matches address
        $deliveryFee = 0.0;
        if ($zoneId > 0) {
            $zone = $this->fetchOne(
                "SELECT zone_id, delivery_fee FROM delivery_zones WHERE zone_id = ? LIMIT 1",
                'i',
                [$zoneId]
            );
            if (!$zone) {
                throw new RuntimeException('Delivery zone does not match your order address.');
            }
            $deliveryFee = (float) $zone['delivery_fee'];
        }

        $this->execute(
            "UPDATE orders
             SET delivery_date        = ?,
                 slot_id              = ?,
                 zone_id              = ?,
                 delivery_fee         = ?,
                 payment_method       = ?,
                 special_instructions = ?,
                 updated_at           = NOW()
             WHERE order_id = ?",
            'siidssi',
            [$deliveryDate, $slotId ?: null, $zoneId ?: null,
             $deliveryFee, $paymentMethod, $specialInstructions, $orderId]
        );

        $this->notifications->send(
            $uid,
            "Your order #{$orderId} has been updated.",
            'order_updated'
        );
    }

    // ── Admin: pack order (no FIFO) ───────────────────────────────

    /**
     * Pack an order (admin view): compute final totals, no batch FIFO deduction.
     */

        public function getStockLevels(array $productIds): array
    {
        if (empty($productIds)) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($productIds), '?'));
        $types        = str_repeat('i', count($productIds));
 
        $rows = $this->fetchAll(
            "SELECT product_id, COALESCE(SUM(remaining_qty), 0) AS remaining_qty
             FROM product_batches
             WHERE product_id IN ($placeholders)
             GROUP BY product_id",
            $types,
            $productIds
        );
 
        $map = [];
        foreach ($rows as $r) {
            $map[(int)$r['product_id']] = (float)$r['remaining_qty'];
        }
        return $map;
    }
    public function packOrderAdmin(int $oid, array $items, int $actorId): float
    {
        $this->beginTransaction();
        try {
            $finalSubtotalSum = 0.0;

            foreach ($items as $item) {
                $itemId = (int) ($item['order_item_id'] ?? 0);
                if (!$itemId) {
                    continue;
                }

                $snap = $this->fetchOne(
                    "SELECT unit_price, pricing_model, quantity FROM order_items WHERE order_item_id = ? LIMIT 1",
                    'i',
                    [$itemId]
                );
                if (!$snap) {
                    continue;
                }

                $qty       = (int) $snap['quantity'];
                $unitPrice = (float) $snap['unit_price'];
                $pm        = $snap['pricing_model'];

                if ($pm === 'catch_weight') {
                    $actualW  = (float) ($item['actual_weight'] ?? 0);
                    if ($actualW <= 0) {
                        continue;
                    }
                    $finalSub = round($unitPrice * $actualW * $qty, 2);
                    $this->execute(
                        "UPDATE order_items SET actual_weight = ?, final_subtotal = ? WHERE order_item_id = ?",
                        'ddi',
                        [$actualW, $finalSub, $itemId]
                    );
                } else {
                    $finalSub = round($unitPrice * $qty, 2);
                    $this->execute(
                        "UPDATE order_items SET final_subtotal = ? WHERE order_item_id = ?",
                        'di',
                        [$finalSub, $itemId]
                    );
                }

                $finalSubtotalSum += $finalSub;
            }

            $ord        = $this->fetchOne(
                "SELECT delivery_fee, discount_amount, user_id, order_number FROM orders WHERE order_id = ? LIMIT 1",
                'i',
                [$oid]
            );
            $finalTotal = round($finalSubtotalSum - (float) $ord['discount_amount'] + (float) $ord['delivery_fee'], 2);

            $this->execute(
                "UPDATE orders SET status = 'Packed', final_total = ? WHERE order_id = ?",
                'di',
                [$finalTotal, $oid]
            );
            $this->execute(
                "UPDATE payments SET amount = ? WHERE order_id = ?",
                'di',
                [$finalTotal, $oid]
            );

            $uid     = (int) $ord['user_id'];
            $orderNo = $ord['order_number'];
            $this->notifications->send(
                $uid,
                "Your order $orderNo has been packed. Final total: ₱$finalTotal",
                'packed'
            );

            $this->execute(
                "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                 VALUES (?, 'pack_order', 'order', ?, ?)",
                'iis',
                [$actorId, $oid, "Order #$oid packed by actor #$actorId. Final total: $finalTotal"]
            );

            $this->commit();
            return $finalTotal;
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }

    // ── Fulfillment: pack order with FIFO ─────────────────────────

    /**
     * Pack an order (fulfillment view): FIFO batch deduction + audit trail.
     *
     * @return array  ['final_total' => float, 'batch_alerts' => string[]]
     */
    public function packOrderFulfillment(int $oid, array $items, int $staffId): array
    {
        $this->beginTransaction();
        try {
            $finalSubtotalSum = 0.0;
            $batchAlerts      = [];

            foreach ($items as $item) {
                $itemId = (int) ($item['order_item_id'] ?? 0);
                if (!$itemId) {
                    continue;
                }

                $snap = $this->fetchOne(
                    "SELECT oi.unit_price, oi.pricing_model, oi.quantity, oi.product_id, oi.estimated_weight
                     FROM order_items oi WHERE oi.order_item_id = ? LIMIT 1",
                    'i',
                    [$itemId]
                );
                if (!$snap) {
                    continue;
                }

                $qty       = (int) $snap['quantity'];
                $unitPrice = (float) $snap['unit_price'];
                $pm        = $snap['pricing_model'] ?? 'fixed_pack';
                $productId = (int) $snap['product_id'];
                $estWeight = (float) $snap['estimated_weight'];

                if ($pm === 'catch_weight') {
                    $actualW = (float) ($item['actual_weight'] ?? 0);
                    if ($actualW <= 0) {
                        $actualW = $estWeight * $qty;
                    }

                    $finalSub = round($unitPrice * $actualW, 2);
                    $this->execute(
                        "UPDATE order_items SET actual_weight = ?, final_subtotal = ? WHERE order_item_id = ?",
                        'ddi',
                        [$actualW, $finalSub, $itemId]
                    );

                    // FIFO batch deduction
                    $alerts      = $this->inventory->fifoDeduct(
                        $productId,
                        $actualW,
                        $staffId,
                        $itemId,
                        $item['batch_overrides'] ?? null
                    );
                    $batchAlerts = array_merge($batchAlerts, $alerts);

                    // Weight-variance audit
                    $variance  = round($actualW - ($estWeight * $qty), 4);
                    $varDetail = "order_item_id=$itemId | est_weight=" . ($estWeight * $qty) .
                                 " | actual_weight=$actualW | variance=$variance";
                    $this->execute(
                        "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                         VALUES (?, 'weight_variance', 'order_item', ?, ?)",
                        'iis',
                        [$staffId, $itemId, $varDetail]
                    );
                } else {
                    $finalSub = round($unitPrice * $qty, 2);
                    $this->execute(
                        "UPDATE order_items SET final_subtotal = ? WHERE order_item_id = ?",
                        'di',
                        [$finalSub, $itemId]
                    );
                }

                $finalSubtotalSum += $finalSub;
            }

            $ord        = $this->fetchOne(
                "SELECT delivery_fee, discount_amount, user_id, order_number FROM orders WHERE order_id = ? LIMIT 1",
                'i',
                [$oid]
            );
            $finalTotal = round($finalSubtotalSum - (float) $ord['discount_amount'] + (float) $ord['delivery_fee'], 2);

            $this->execute(
                "UPDATE orders SET status = 'Packed', final_total = ? WHERE order_id = ?",
                'di',
                [$finalTotal, $oid]
            );
            $this->execute(
                "UPDATE payments SET amount = ? WHERE order_id = ?",
                'di',
                [$finalTotal, $oid]
            );

            $this->notifications->send(
                (int) $ord['user_id'],
                "Your order {$ord['order_number']} has been packed. Final total: ₱$finalTotal",
                'packed'
            );

            $this->execute(
                "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                 VALUES (?, 'pack_order', 'order', ?, ?)",
                'iis',
                [$staffId, $oid, "Order #$oid packed by staff #$staffId. Final total: $finalTotal"]
            );

            $this->commit();
            return ['final_total' => $finalTotal, 'batch_alerts' => $batchAlerts];
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }

    // ── Shared: cancel ────────────────────────────────────────────

    /**
     * Cancel an order. The customer can only cancel Pending orders.
     * Admin/staff can cancel any non-Completed order.
     */
    public function cancelOrder(int $oid, int $initiatorId, string $reason, bool $customerInitiated = false): void
    {
        $ord = $this->fetchOne(
            "SELECT status, user_id, order_number FROM orders WHERE order_id = ? LIMIT 1",
            'i',
            [$oid]
        );
        if (!$ord) {
            throw new RuntimeException('Order not found.');
        }
        if ($ord['status'] === 'Completed') {
            throw new RuntimeException('Cannot cancel a completed order.');
        }
        if ($customerInitiated) {
            if ($ord['status'] !== 'Pending') {
                throw new RuntimeException('Only Pending orders can be cancelled by the customer.');
            }
            if ((int) $ord['user_id'] !== $initiatorId) {
                throw new RuntimeException('You cannot cancel someone else\'s order.');
            }
        }

        $this->beginTransaction();
        try {
            $this->execute(
                "UPDATE orders SET status = 'Cancelled' WHERE order_id = ?",
                'i',
                [$oid]
            );
            $this->execute(
                "INSERT INTO cancellation_logs (order_id, initiated_by, reason) VALUES (?, ?, ?)",
                'iis',
                [$oid, $initiatorId, $reason]
            );
            $this->notifications->send(
                (int) $ord['user_id'],
                "Your order {$ord['order_number']} has been cancelled. Reason: $reason",
                'cancelled'
            );
            // Restore reserved stock when canceling a Pending order
            if ($ord['status'] === 'Pending') {
                $items = $this->fetchAll(
                    "SELECT product_id, quantity FROM order_items WHERE order_id = ?",
                    'i',
                    [$oid]
                );
                foreach ($items as $item) {
                    $pid     = (int) $item['product_id'];
                    $qty     = (float) $item['quantity'];
                    $batches = $this->fetchAll(
                        "SELECT batch_id FROM product_batches
                         WHERE product_id = ? ORDER BY batch_date ASC LIMIT 1",
                        'i',
                        [$pid]
                    );
                    if (!empty($batches)) {
                        $batchId = (int) $batches[0]['batch_id'];
                        $this->execute(
                            "UPDATE product_batches
                             SET remaining_qty = remaining_qty + ?
                             WHERE batch_id = ?",
                            'di',
                            [$qty, $batchId]
                        );
                        $this->execute(
                            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                             VALUES (?, 'stock_restoration', 'product_batch', ?, ?)",
                            'iis',
                            [$initiatorId, $batchId, "Restored {$qty} units from cancelled order #{$oid}"]
                        );
                    }
                }
            }

            $this->commit();
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }

    // ── Admin actions ─────────────────────────────────────────────

    /**
     * Update an order's status (admin).
     */
    public function updateOrderStatus(int $oid, string $status, int $adminId): void
    {
        $allowed = ['Pending', 'Packed', 'Out for Delivery', 'Arrived at Location', 'Completed', 'Cancelled'];
        if (!in_array($status, $allowed, true)) {
            throw new InvalidArgumentException('Invalid status.');
        }

        $this->execute(
            "UPDATE orders SET status = ? WHERE order_id = ?",
            'si',
            [$status, $oid]
        );
        $this->execute(
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES (?, 'update_status', 'order', ?, ?)",
            'iis',
            [$adminId, $oid, "Status changed to $status"]
        );
    }

    /**
     * Mark a payment as verified.
     */
    public function verifyPayment(int $oid, int $verifiedBy): void
    {
        $this->execute(
            "UPDATE payments SET status = 'Paid', verified_by = ?, verified_at = NOW() WHERE order_id = ?",
            'ii',
            [$verifiedBy, $oid]
        );
    }

    /**
     * Assign (or re-assign) a rider to an order.
     */
    public function assignRider(int $oid, int $riderId, int $assignedBy): void
    {
        $this->execute(
            "INSERT INTO deliveries (order_id, rider_id, assigned_by, status)
             VALUES (?, ?, ?, 'Assigned')
             ON DUPLICATE KEY UPDATE rider_id = ?, assigned_by = ?, status = 'Assigned'",
            'iiiiii',
            [$oid, $riderId, $assignedBy, $riderId, $assignedBy, $oid]
        );
        $this->execute(
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES (?, 'assign_rider', 'order', ?, ?)",
            'iis',
            [$assignedBy, $oid, "Rider $riderId assigned to order $oid by $assignedBy"]
        );
    }

    // ── Fulfillment actions ───────────────────────────────────────

    /**
     * Assign one rider to many orders at once (zone-based dispatch).
     *
     * @param int[] $orderIds
     * @return int  Number of successfully assigned orders.
     */
    public function batchAssignRiders(array $orderIds, int $riderId, int $staffId): int
    {
        $this->beginTransaction();
        try {
            $assigned = 0;
            foreach ($orderIds as $oid) {
                $oid = (int) $oid;
                if (!$oid) {
                    continue;
                }
                $this->execute(
                    "INSERT INTO deliveries (order_id, rider_id, assigned_by, status)
                     VALUES (?, ?, ?, 'Assigned')
                     ON DUPLICATE KEY UPDATE rider_id = ?, assigned_by = ?, status = 'Assigned'",
                    'iiiiii',
                    [$oid, $riderId, $staffId, $riderId, $staffId, $oid]
                );
                $assigned++;
            }
            $this->commit();
            return $assigned;
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }

    /**
     * Mark an order as "Out for Delivery" and log the dispatch.
     */
    public function dispatchOrder(int $oid, int $staffId): void
    {
        $this->beginTransaction();
        try {
            $this->execute(
                "UPDATE orders SET status = 'Out for Delivery' WHERE order_id = ? AND status = 'Packed'",
                'i',
                [$oid]
            );
            $this->execute(
                "UPDATE deliveries SET status = 'Out for Delivery', dispatched_at = NOW() WHERE order_id = ?",
                'i',
                [$oid]
            );

            $ord = $this->fetchOne(
                "SELECT user_id, order_number FROM orders WHERE order_id = ? LIMIT 1",
                'i',
                [$oid]
            );
            if ($ord) {
                $this->notifications->send(
                    (int) $ord['user_id'],
                    "Your order {$ord['order_number']} is now out for delivery! 🛵",
                    'dispatched'
                );
            }

            $this->execute(
                "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                 VALUES (?, 'dispatch_order', 'order', ?, ?)",
                'iis',
                [$staffId, $oid, "Order $oid dispatched by staff $staffId"]
            );

            $this->commit();
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }

    /**
     * Mark a delivery as complete (fulfillment staff action).
     */
    public function completeDeliveryStaff(int $oid, int $staffId): void
    {
        $this->beginTransaction();
        try {
            $this->execute(
                "UPDATE orders SET status = 'Completed' WHERE order_id = ?",
                'i',
                [$oid]
            );
            $this->execute(
                "UPDATE deliveries SET status = 'Delivered', delivered_at = NOW() WHERE order_id = ?",
                'i',
                [$oid]
            );
            $this->execute(
                "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                 VALUES (?, 'complete_delivery', 'order', ?, ?)",
                'iis',
                [$staffId, $oid, "Order $oid marked completed by staff $staffId"]
            );
            $this->commit();
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }

    /**
     * Zero out one order item (out-of-stock) and recalculate the order total.
     */
    public function markOutOfStock(int $oid, int $itemId, int $staffId): float
    {
        $this->beginTransaction();
        try {
            $this->execute(
                "UPDATE order_items SET actual_weight = 0, final_subtotal = 0, quantity = 0
                 WHERE order_item_id = ? AND order_id = ?",
                'ii',
                [$itemId, $oid]
            );

            $allItems = $this->fetchAll(
                "SELECT order_item_id, final_subtotal, estimated_subtotal
                 FROM order_items WHERE order_id = ?",
                'i',
                [$oid]
            );
            $totalItems = 0.0;
            foreach ($allItems as $i) {
                if ((int) $i['order_item_id'] === $itemId) {
                    continue;
                }
                $sub         = (float) $i['final_subtotal'] > 0 ? (float) $i['final_subtotal'] : (float) $i['estimated_subtotal'];
                $totalItems += $sub;
            }

            $ord      = $this->fetchOne(
                "SELECT delivery_fee, discount_amount, user_id, order_number FROM orders WHERE order_id = ? LIMIT 1",
                'i',
                [$oid]
            );
            $newTotal = round($totalItems - (float) $ord['discount_amount'] + (float) $ord['delivery_fee'], 2);
            if ($newTotal < 0) {
                $newTotal = 0.0;
            }

            $this->execute(
                "UPDATE orders SET final_total = ? WHERE order_id = ?",
                'di',
                [$newTotal, $oid]
            );
            $this->execute(
                "UPDATE payments SET amount = ? WHERE order_id = ?",
                'di',
                [$newTotal, $oid]
            );

            $detail = "order_item_id=$itemId marked Out of Stock by staff $staffId. New total: $newTotal";
            $this->execute(
                "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                 VALUES (?, 'mark_out_of_stock', 'order_item', ?, ?)",
                'iis',
                [$staffId, $itemId, $detail]
            );

            $this->notifications->send(
                (int) $ord['user_id'],
                "We could not fulfil an item in order {$ord['order_number']} (out of stock). Your updated total is ₱$newTotal.",
                'partial_fulfillment'
            );

            $this->commit();
            return $newTotal;
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }

    // ── Rider actions ─────────────────────────────────────────────

    /**
     * Return all orders assigned to a rider with optional status/date filters.
     */
    public function getRiderOrders(int $riderId, string $statusFilter, string $dateFilter): array
    {
        $conditions = ['d.rider_id = ?'];
        $types      = 'i';
        $params     = [$riderId];

        if ($statusFilter !== '' && $statusFilter !== 'all') {
            $conditions[] = 'o.status = ?';
            $types .= 's';
            $params[] = $statusFilter;
        }
        if ($dateFilter !== '') {
            $conditions[] = 'o.delivery_date = ?';
            $types .= 's';
            $params[] = $dateFilter;
        }

        $where = implode(' AND ', $conditions);
        $orders = $this->fetchAll(
            "SELECT o.order_id, o.order_number, o.delivery_date, o.status,
                    o.estimated_total, o.final_total, o.discount_amount,
                    o.delivery_fee, o.payment_method, o.special_instructions, o.created_at,
                    u.first_name, u.last_name, u.phone,
                    a.street,
                    b.name AS barangay, m_addr.name AS city, 'Albay' AS province,
                    a.latitude, a.longitude,
                    ts.slot_label, ts.end_time AS slot_end_time,
                    pay.status AS pay_status,
                    d.status AS delivery_status, d.proof_of_delivery_url,
                    d.dispatched_at, d.delivered_at
             FROM deliveries d
             JOIN orders o    ON o.order_id    = d.order_id
             JOIN users u     ON u.user_id     = o.user_id
             JOIN addresses a      ON a.address_id        = o.address_id
             LEFT JOIN barangays      b      ON b.barangay_id        = a.barangay_id
             LEFT JOIN municipalities m_addr ON m_addr.municipality_id = a.municipality_id
             LEFT JOIN time_slots ts  ON ts.slot_id  = o.slot_id
             LEFT JOIN payments  pay ON pay.order_id = o.order_id
             WHERE $where
             ORDER BY
               FIELD(o.status, 'Out for Delivery', 'Arrived at Location', 'Packed', 'Completed') ASC,
               o.delivery_date ASC,
               ts.start_time ASC",
            $types,
            $params
        );

        $countRows = $this->fetchAll(
            "SELECT o.status, COUNT(*) AS cnt
             FROM deliveries d
             JOIN orders o ON o.order_id = d.order_id
             WHERE d.rider_id = ?
               AND o.status IN ('Packed', 'Out for Delivery', 'Arrived at Location', 'Completed')
             GROUP BY o.status",
            'i',
            [$riderId]
        );
        $counts = [];
        foreach ($countRows as $row) {
            $counts[$row['status']] = (int) $row['cnt'];
        }

        return ['orders' => $orders, 'counts' => $counts];
    }

    /**
     * Verify that an order belongs to (is assigned to) a specific rider.
     */
    public function verifyRiderAssignment(int $oid, int $riderId): bool
    {
        $row = $this->fetchOne(
            "SELECT delivery_id FROM deliveries WHERE order_id = ? AND rider_id = ? LIMIT 1",
            'ii',
            [$oid, $riderId]
        );
        return $row !== null;
    }

    /**
     * Update an order status by a rider (Out for Delivery | Arrived at Location).
     */
    public function riderUpdateStatus(int $oid, int $riderId, string $status): void
    {
        $allowed = ['Out for Delivery', 'Arrived at Location'];
        if (!in_array($status, $allowed, true)) {
            throw new InvalidArgumentException('Invalid status.');
        }

        $this->beginTransaction();
        try {
            $this->execute(
                "UPDATE orders SET status = ? WHERE order_id = ?",
                'si',
                [$status, $oid]
            );

            if ($status === 'Out for Delivery') {
                $this->execute(
                    "UPDATE deliveries SET status = 'Out for Delivery', dispatched_at = NOW()
                     WHERE order_id = ? AND rider_id = ?",
                    'ii',
                    [$oid, $riderId]
                );
            } else {
                $this->execute(
                    "UPDATE deliveries SET status = 'Arrived at Location'
                     WHERE order_id = ? AND rider_id = ?",
                    'ii',
                    [$oid, $riderId]
                );
            }

            $ord = $this->fetchOne(
                "SELECT user_id, order_number FROM orders WHERE order_id = ? LIMIT 1",
                'i',
                [$oid]
            );
            if ($ord) {
                $msg = $status === 'Out for Delivery'
                    ? "Your order #{$ord['order_number']} is now out for delivery! 🚴"
                    : "Your rider has arrived at your location for order #{$ord['order_number']}.";
                $this->notifications->send((int) $ord['user_id'], $msg, 'dispatched');
            }

            $this->execute(
                "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                 VALUES (?, 'update_status', 'order', ?, ?)",
                'iis',
                [$riderId, $oid, "Rider set status to $status"]
            );

            $this->commit();
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }

    /**
     * Complete an order delivery: set Completed, update delivery record, mark COD payment.
     */
    public function riderCompleteOrder(int $oid, int $riderId, string $proofUrl): void
    {
        $del = $this->fetchOne(
            "SELECT d.delivery_id, o.status, o.user_id, o.order_number, o.payment_method
             FROM deliveries d
             JOIN orders o ON o.order_id = d.order_id
             WHERE d.order_id = ? AND d.rider_id = ? LIMIT 1",
            'ii',
            [$oid, $riderId]
        );
        if (!$del) {
            throw new RuntimeException('Order not assigned to you.');
        }
        if (!in_array($del['status'], ['Out for Delivery', 'Arrived at Location'], true)) {
            throw new RuntimeException('Order must be Out for Delivery or Arrived at Location to complete.');
        }

        $this->beginTransaction();
        try {
            $this->execute(
                "UPDATE orders SET status = 'Completed' WHERE order_id = ?",
                'i',
                [$oid]
            );
            $this->execute(
                "UPDATE deliveries
                 SET status = 'Completed', delivered_at = NOW(), proof_of_delivery_url = ?
                 WHERE order_id = ? AND rider_id = ?",
                'sii',
                [$proofUrl ?: null, $oid, $riderId]
            );

            if (strtolower($del['payment_method'] ?? '') === 'cod') {
                $this->execute(
                    "UPDATE payments SET status = 'Paid', verified_by = ?, verified_at = NOW()
                     WHERE order_id = ? AND status = 'Unpaid'",
                    'ii',
                    [$riderId, $oid]
                );
            }

            $msg = "Your order #{$del['order_number']} has been delivered and completed. Thank you! 🎉";
            $this->notifications->send((int) $del['user_id'], $msg, 'general');

            $this->execute(
                "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                 VALUES (?, 'complete_order', 'order', ?, 'Rider completed order')",
                'ii',
                [$riderId, $oid]
            );

            $this->commit();
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }

    /**
     * Upload a proof-of-delivery URL to the delivery record.
     */
    public function uploadPod(int $oid, int $riderId, string $proofUrl): void
    {
        $this->execute(
            "UPDATE deliveries SET proof_of_delivery_url = ? WHERE order_id = ? AND rider_id = ?",
            'sii',
            [$proofUrl, $oid, $riderId]
        );
    }

    /**
     * Record a failed delivery and cancel the order.
     */
    public function failedDelivery(int $oid, int $riderId, string $reason, string $notes): void
    {
        $del = $this->fetchOne(
            "SELECT d.delivery_id, o.user_id, o.order_number, o.status
             FROM deliveries d
             JOIN orders o ON o.order_id = d.order_id
             WHERE d.order_id = ? AND d.rider_id = ? LIMIT 1",
            'ii',
            [$oid, $riderId]
        );
        if (!$del) {
            throw new RuntimeException('Order not assigned to you.');
        }
        if (!in_array($del['status'], ['Out for Delivery', 'Arrived at Location'], true)) {
            throw new RuntimeException('Order must be Out for Delivery or Arrived at Location.');
        }

        $this->beginTransaction();
        try {
            $this->execute(
                "UPDATE orders SET status = 'Cancelled' WHERE order_id = ?",
                'i',
                [$oid]
            );
            $this->execute(
                "UPDATE deliveries SET status = 'Failed' WHERE order_id = ? AND rider_id = ?",
                'ii',
                [$oid, $riderId]
            );
            $this->execute(
                "INSERT INTO cancellation_logs (order_id, cancelled_by, reason, notes, created_at)
                 VALUES (?, ?, ?, ?, NOW())",
                'iiss',
                [$oid, $riderId, $reason, $notes]
            );

            $msg = "We were unable to deliver order #{$del['order_number']}. Reason: $reason. Our team will contact you shortly.";
            $this->notifications->send((int) $del['user_id'], $msg, 'general');

            $this->execute(
                "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                 VALUES (?, 'failed_delivery', 'order', ?, ?)",
                'iis',
                [$riderId, $oid, "Reason: $reason"]
            );

            $this->commit();
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }

    /**
     * Submit a COD cash remittance record.
     */
    public function remitCash(int $riderId, float $amount, string $notes): void
    {
        $this->beginTransaction();
        try {
            $this->execute(
                "INSERT INTO cash_remittances (rider_id, amount, notes, remitted_at, status)
                 VALUES (?, ?, ?, NOW(), 'Pending')",
                'ids',
                [$riderId, $amount, $notes]
            );
            $this->execute(
                "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                 VALUES (?, 'remit_cash', 'rider', ?, ?)",
                'iis',
                [$riderId, $riderId, "Rider submitted remittance of $amount"]
            );
            $this->commit();
        } catch (Throwable $ex) {
            $this->rollback();
            throw $ex;
        }
    }

    /**
     * File a customer dispute against a completed order.
     */
    public function fileDispute(int $uid, int $oid, string $description, string $evidenceUrl): int
    {
        $ord = $this->fetchOne(
            "SELECT status FROM orders WHERE order_id = ? AND user_id = ? LIMIT 1",
            'ii',
            [$oid, $uid]
        );
        if (!$ord) {
            throw new RuntimeException('Order not found.');
        }
        if ($ord['status'] !== 'Completed') {
            throw new RuntimeException('Disputes can only be filed for completed orders.');
        }

        return $this->insertGetId(
            "INSERT INTO disputes (order_id, user_id, description, evidence_url, status)
             VALUES (?, ?, ?, ?, 'Open')",
            'iiss',
            [$oid, $uid, $description, $evidenceUrl ?: null]
        );
    }
}
