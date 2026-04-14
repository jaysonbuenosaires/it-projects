<?php
/**
 * ReportService — dashboard stats, sales reports, and operational settings.
 */
class ReportService extends BaseService
{
    /**
     * Build the full admin dashboard payload.
     */
    public function getDashboard(): array
    {
        // Summary stats
        $totalOrders   = (int) ($this->fetchOne("SELECT COUNT(*) AS n FROM orders")['n'] ?? 0);
        $pendingCount  = (int) ($this->fetchOne("SELECT COUNT(*) AS n FROM orders WHERE status = 'Pending'")['n'] ?? 0);
        $completedRev  = (float) ($this->fetchOne(
            "SELECT COALESCE(SUM(final_total), 0) AS n FROM orders WHERE status = 'Completed'"
        )['n'] ?? 0);
        $productCount  = (int) ($this->fetchOne("SELECT COUNT(*) AS n FROM products WHERE status = 'active'")['n'] ?? 0);
        $customerCount = (int) ($this->fetchOne(
            "SELECT COUNT(*) AS n FROM users u
             JOIN roles r ON r.role_id = u.role_id
             WHERE r.role_name = 'Customer'"
        )['n'] ?? 0);
        $todayOrders   = (int) ($this->fetchOne(
            "SELECT COUNT(*) AS n FROM orders WHERE DATE(created_at) = CURDATE()"
        )['n'] ?? 0);
        $todayRev      = (float) ($this->fetchOne(
            "SELECT COALESCE(SUM(final_total), 0) AS n FROM orders WHERE status = 'Completed' AND DATE(created_at) = CURDATE()"
        )['n'] ?? 0);

        // Recent 10 orders
        $recent = $this->fetchAll(
            "SELECT o.order_id, o.order_number, o.status, o.estimated_total, o.final_total,
                    o.payment_method, o.delivery_date, o.created_at,
                    u.first_name, u.last_name
             FROM orders o
             JOIN users u ON u.user_id = o.user_id
             ORDER BY o.created_at DESC LIMIT 10"
        );

        // Weekly revenue (last 7 days)
        $weekly = $this->fetchAll(
            "SELECT DATE(created_at) AS d, COALESCE(SUM(final_total), 0) AS rev
             FROM orders
             WHERE status = 'Completed' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
             GROUP BY DATE(created_at)
             ORDER BY d ASC"
        );

        // Low stock (products with < 5 units remaining across all batches)
        $lowStock = $this->fetchAll(
            "SELECT p.name, SUM(pb.remaining_qty) AS total_remaining
             FROM product_batches pb
             JOIN products p ON p.product_id = pb.product_id
             WHERE p.status = 'active'
             GROUP BY pb.product_id
             HAVING total_remaining < 5
             ORDER BY total_remaining ASC LIMIT 8"
        );

        // Status distribution (single GROUP BY query instead of N separate queries)
        $distRows = $this->fetchAll(
            "SELECT status, COUNT(*) AS n FROM orders
             WHERE status IN ('Pending','Packed','Out for Delivery','Arrived at Location','Completed','Cancelled')
             GROUP BY status"
        );
        $dist = array_fill_keys(
            ['Pending', 'Packed', 'Out for Delivery', 'Arrived at Location', 'Completed', 'Cancelled'],
            0
        );
        foreach ($distRows as $row) {
            $dist[$row['status']] = (int) $row['n'];
        }

        return [
            'stats' => [
                'total_orders'  => $totalOrders,
                'pending'       => $pendingCount,
                'revenue'       => $completedRev,
                'products'      => $productCount,
                'customers'     => $customerCount,
                'today_orders'  => $todayOrders,
                'today_revenue' => $todayRev,
            ],
            'recent_orders'  => $recent,
            'weekly_revenue' => $weekly,
            'low_stock'      => $lowStock,
            'status_dist'    => $dist,
        ];
    }

    /**
     * Sales report for a given number of days.
     */
    public function getReport(int $days): array
    {
        $days = max(7, min(365, $days));

        $daily = $this->fetchAll(
            "SELECT DATE(created_at) AS d,
                    COUNT(*) AS order_count,
                    COALESCE(SUM(final_total), 0) AS revenue
             FROM orders
             WHERE status = 'Completed'
               AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
             GROUP BY DATE(created_at)
             ORDER BY d ASC",
            'i',
            [$days]
        );

        $byCategory = $this->fetchAll(
            "SELECT c.name AS category,
                    COUNT(oi.order_item_id) AS items_sold,
                    COALESCE(SUM(oi.final_subtotal), SUM(oi.estimated_subtotal)) AS revenue
             FROM order_items oi
             JOIN products p ON p.product_id = oi.product_id
             JOIN categories c ON c.category_id = p.category_id
             JOIN orders o ON o.order_id = oi.order_id
             WHERE o.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
             GROUP BY c.category_id
             ORDER BY revenue DESC",
            'i',
            [$days]
        );

        $topProducts = $this->fetchAll(
            "SELECT p.name, c.name AS category,
                    COUNT(oi.order_item_id) AS times_ordered,
                    SUM(oi.quantity) AS total_qty
             FROM order_items oi
             JOIN products p ON p.product_id = oi.product_id
             JOIN categories c ON c.category_id = p.category_id
             JOIN orders o ON o.order_id = oi.order_id
             WHERE o.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
             GROUP BY oi.product_id
             ORDER BY total_qty DESC LIMIT 10",
            'i',
            [$days]
        );

        $totals = $this->fetchOne(
            "SELECT COUNT(*) AS total_orders,
                    COALESCE(SUM(final_total), 0)      AS total_revenue,
                    COALESCE(SUM(discount_amount), 0)  AS total_discounts,
                    COALESCE(SUM(delivery_fee), 0)     AS total_delivery_fees
             FROM orders
             WHERE status = 'Completed'
               AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)",
            'i',
            [$days]
        );

        return [
            'daily'        => $daily,
            'by_category'  => $byCategory,
            'top_products' => $topProducts,
            'totals'       => $totals,
            'period_days'  => $days,
        ];
    }

    /**
     * Operational settings: hours, zones, and time slots.
     */
    public function getSettings(): array
    {
        return [
            'hours' => $this->fetchAll("SELECT * FROM operational_hours ORDER BY day_of_week ASC"),
            'zones' => $this->fetchAll(
            "SELECT dz.zone_id, dz.municipality_id, dz.delivery_fee,
                    m.name AS municipality_name
             FROM delivery_zones dz
             JOIN municipalities m ON m.municipality_id = dz.municipality_id
             ORDER BY dz.delivery_fee ASC"
        ),
            'slots' => $this->fetchAll("SELECT * FROM time_slots ORDER BY start_time ASC"),
        ];
    }

    /**
     * Checkout meta: active zones, active slots, active hours.
     */
    public function getCheckoutMeta(): array
    {
        return [
            'zones' => $this->fetchAll(
            "SELECT dz.zone_id, dz.municipality_id, dz.delivery_fee,
                    m.name AS municipality_name
             FROM delivery_zones dz
             JOIN municipalities m ON m.municipality_id = dz.municipality_id
             ORDER BY dz.delivery_fee ASC"
        ),
            'slots' => $this->fetchAll("SELECT * FROM time_slots WHERE is_active = 1 ORDER BY start_time ASC"),
            'hours' => $this->fetchAll("SELECT * FROM operational_hours WHERE is_active = 1 ORDER BY day_of_week ASC"),
        ];
    }

    /**
     * Promo codes list (admin view).
     */
    public function getPromos(): array
    {
        return $this->fetchAll(
            "SELECT pc.*, u.first_name, u.last_name
             FROM promo_codes pc
             JOIN users u ON u.user_id = pc.created_by
             ORDER BY pc.promo_id DESC"
        );
    }

    /**
     * Create or update a promo code.
     *
     * @return int  promo_id of the saved record.
     */
    public function savePromo(
        int     $pid,
        string  $code,
        string  $discountType,
        float   $discountValue,
        float   $minOrderValue,
        bool    $isActive,
        ?string $validFrom,
        ?string $validTo,
        ?int    $usageLimit,
        int     $createdBy
    ): int {
        $type = in_array($discountType, ['percentage', 'flat'], true) ? $discountType : 'flat';

        if ($pid > 0) {
            $this->execute(
                "UPDATE promo_codes
                 SET code = ?, discount_type = ?, discount_value = ?,
                     min_order_value = ?, is_active = ?,
                     valid_from = ?, valid_to = ?, usage_limit = ?
                 WHERE promo_id = ?",
                'ssddiissi',
                [$code, $type, $discountValue, $minOrderValue, (int) $isActive,
                 $validFrom, $validTo, $usageLimit, $pid]
            );
            return $pid;
        }

        return $this->insertGetId(
            "INSERT INTO promo_codes
                (created_by, code, discount_type, discount_value,
                 min_order_value, is_active, valid_from, valid_to, usage_limit)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            'issddiiss',
            [$createdBy, $code, $type, $discountValue, $minOrderValue,
             (int) $isActive, $validFrom, $validTo, $usageLimit]
        );
    }

    /**
     * Delivery zones grouped with packed order counts and time slots
     * (for the fulfillment zone-dispatch view).
     */
    public function getDeliveryZones(): array
    {
        $zones = $this->fetchAll(
            "SELECT dz.zone_id, dz.municipality_id, dz.delivery_fee,
                    m.name AS municipality_name,
                    COUNT(o.order_id) AS packed_count
             FROM delivery_zones dz
             JOIN municipalities m ON m.municipality_id = dz.municipality_id
             LEFT JOIN orders o ON o.zone_id = dz.zone_id AND o.status = 'Packed'
             GROUP BY dz.zone_id
             ORDER BY m.name ASC"
        );

        $slots = $this->fetchAll(
            "SELECT slot_id, slot_label, start_time, end_time FROM time_slots ORDER BY start_time ASC"
        );

        return ['zones' => $zones, 'slots' => $slots];
    }

    /**
     * Rider delivery performance summary.
     */
    public function getRiderPerformance(int $riderId, string $dateFrom, string $dateTo): array
    {
        $summary = $this->fetchOne(
            "SELECT
               COUNT(*) AS total_deliveries,
               SUM(CASE WHEN o.status = 'Completed' THEN 1 ELSE 0 END) AS completed,
               SUM(CASE WHEN o.status = 'Cancelled' THEN 1 ELSE 0 END) AS failed,
               AVG(CASE
                 WHEN d.dispatched_at IS NOT NULL AND d.delivered_at IS NOT NULL
                 THEN TIMESTAMPDIFF(MINUTE, d.dispatched_at, d.delivered_at)
               END) AS avg_delivery_minutes
             FROM deliveries d
             JOIN orders o ON o.order_id = d.order_id
             WHERE d.rider_id = ?
               AND o.delivery_date BETWEEN ? AND ?",
            'iss',
            [$riderId, $dateFrom, $dateTo]
        ) ?: [];

        $daily = $this->fetchAll(
            "SELECT o.delivery_date,
                    COUNT(*) AS total,
                    SUM(CASE WHEN o.status = 'Completed' THEN 1 ELSE 0 END) AS completed
             FROM deliveries d
             JOIN orders o ON o.order_id = d.order_id
             WHERE d.rider_id = ?
               AND o.delivery_date BETWEEN ? AND ?
             GROUP BY o.delivery_date
             ORDER BY o.delivery_date ASC",
            'iss',
            [$riderId, $dateFrom, $dateTo]
        );

        $total = (int) ($summary['total_deliveries'] ?? 0);
        $done  = (int) ($summary['completed']        ?? 0);
        $summary['completion_rate']        = $total > 0 ? round(($done / $total) * 100, 1) : 0;
        $summary['avg_delivery_minutes']   = isset($summary['avg_delivery_minutes']) && $summary['avg_delivery_minutes'] !== null
            ? round((float) $summary['avg_delivery_minutes'], 1)
            : null;

        return ['summary' => $summary, 'daily' => $daily];
    }

    /**
     * Rider today's summary (stat pills on rider dashboard).
     */
    public function getRiderDailySummary(int $riderId): array
    {
        $today = date('Y-m-d');
        $row   = $this->fetchOne(
            "SELECT
               COUNT(*) AS total_assigned,
               SUM(CASE WHEN o.status = 'Completed' THEN 1 ELSE 0 END) AS completed,
               SUM(CASE WHEN o.status = 'Out for Delivery' THEN 1 ELSE 0 END) AS in_transit,
               SUM(CASE WHEN o.status IN ('Packed', 'Assigned') THEN 1 ELSE 0 END) AS pending_pickup,
               SUM(CASE WHEN o.status = 'Completed' AND pay.status = 'Paid'
                   THEN COALESCE(o.final_total, o.estimated_total) ELSE 0 END) AS collected_today
             FROM deliveries d
             JOIN orders o ON o.order_id = d.order_id
             LEFT JOIN payments pay ON pay.order_id = o.order_id
             WHERE d.rider_id = ? AND o.delivery_date = ?",
            'is',
            [$riderId, $today]
        );
        return $row ?: [];
    }

    /**
     * Rider remittance history.
     */
    public function getRemittanceHistory(int $riderId): array
    {
        return $this->fetchAll(
            "SELECT remittance_id, amount, notes, remitted_at, status, confirmed_by, confirmed_at
             FROM cash_remittances
             WHERE rider_id = ?
             ORDER BY remitted_at DESC
             LIMIT 30",
            'i',
            [$riderId]
        );
    }
}