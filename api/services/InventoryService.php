<?php
/**
 * InventoryService — product batches, FIFO stock deduction, and adjustments.
 */
class InventoryService extends BaseService
{
    /**
     * Return all batches (admin view, includes depleted).
     */
    public function getBatches(): array
    {
        return $this->fetchAll(
            "SELECT pb.batch_id, pb.product_id, pb.batch_unit,
                    pb.batch_date, pb.quantity, pb.remaining_qty, pb.created_at,
                    p.name AS product_name, p.pricing_model, p.unit_of_measure,
                    c.name AS category_name
             FROM product_batches pb
             JOIN products   p ON p.product_id  = pb.product_id
             JOIN categories c ON c.category_id = p.category_id
             ORDER BY pb.batch_date DESC, pb.batch_id DESC"
        );
    }

    /**
     * Return only active batches (fulfillment view, FIFO-ordered).
     */
    public function getActiveBatches(): array
    {
        return $this->fetchAll(
            "SELECT pb.batch_id, pb.product_id, pb.batch_date,
                    pb.quantity, pb.remaining_qty, pb.batch_unit,
                    p.name AS product_name, p.is_catch_weight,
                    c.name AS category_name
             FROM product_batches pb
             JOIN products   p ON p.product_id  = pb.product_id
             JOIN categories c ON c.category_id = p.category_id
             WHERE pb.remaining_qty > 0 AND p.status = 'active'
             ORDER BY pb.product_id ASC, pb.batch_date ASC"
        );
    }

    /**
     * Return active batches for a single product (for fulfillment staff dropdown).
     */
    public function getBatchesForProduct(int $productId): array
    {
        return $this->fetchAll(
            "SELECT batch_id, batch_date, remaining_qty, batch_unit
             FROM product_batches
             WHERE product_id = ? AND remaining_qty > 0
             ORDER BY batch_date ASC",
            'i',
            [$productId]
        );
    }

    /**
     * Add a new stock batch. The batch_unit is derived from the product's unit_of_measure.
     *
     * @return array  ['batch_id' => int, 'batch_unit' => string]
     */
    public function addBatch(int $productId, string $batchDate, float $quantity): array
    {
        $product = $this->fetchOne(
            "SELECT unit_of_measure FROM products WHERE product_id = ? LIMIT 1",
            'i',
            [$productId]
        );
        if (!$product) {
            throw new RuntimeException('Product not found.');
        }

        $batchUnit = $product['unit_of_measure'];
        $batchId   = $this->insertGetId(
            "INSERT INTO product_batches (product_id, batch_unit, batch_date, quantity, remaining_qty)
             VALUES (?, ?, ?, ?, ?)",
            'issdd',
            [$productId, $batchUnit, $batchDate, $quantity, $quantity]
        );

        return ['batch_id' => $batchId, 'batch_unit' => $batchUnit];
    }

    /**
     * Adjust a batch to an exact physical count (spoilage / shrinkage).
     *
     * @return array  ['old_qty' => float, 'new_qty' => float, 'variance' => float]
     */
    public function adjustStock(
        int    $batchId,
        float  $newQty,
        string $reasonCode,
        string $notes,
        int    $staffId
    ): array {
        $allowed = ['Shrinkage/Water Loss', 'Spoilage', 'Damaged in Handling', 'Count Correction'];
        if (!in_array($reasonCode, $allowed, true)) {
            $reasonCode = 'Count Correction';
        }

        $batch = $this->fetchOne(
            "SELECT batch_id, product_id, remaining_qty FROM product_batches WHERE batch_id = ? LIMIT 1",
            'i',
            [$batchId]
        );
        if (!$batch) {
            throw new RuntimeException('Batch not found.');
        }

        $oldQty   = (float) $batch['remaining_qty'];
        $variance = round($newQty - $oldQty, 4);

        $this->execute(
            "UPDATE product_batches SET remaining_qty = ? WHERE batch_id = ?",
            'di',
            [$newQty, $batchId]
        );

        $detail = "Batch #$batchId | reason=$reasonCode | old_qty={$oldQty} | new_qty={$newQty} | variance={$variance} | notes: $notes";
        $this->execute(
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
             VALUES (?, 'stock_adjustment', 'product_batch', ?, ?)",
            'iis',
            [$staffId, $batchId, $detail]
        );

        return ['old_qty' => $oldQty, 'new_qty' => $newQty, 'variance' => $variance];
    }

    /**
     * Deduct a quantity from FIFO batches for a product.
     * Supports optional manual batch_overrides.
     *
     * @param array|null $batchOverrides  [{batch_id, weight}] or null for auto-FIFO.
     * @param int        $orderItemId     Used in audit log details.
     *
     * @return string[]  Alert messages for low/depleted batches.
     */
    public function fifoDeduct(
        int   $productId,
        float $totalWeight,
        int   $staffId,
        int   $orderItemId,
        ?array $batchOverrides
    ): array {
        $alerts = [];

        if (!empty($batchOverrides)) {
            // Manual per-batch override
            foreach ($batchOverrides as $bo) {
                $bid = (int) ($bo['batch_id'] ?? 0);
                $bwt = (float) ($bo['weight']   ?? 0);
                if (!$bid || $bwt <= 0) {
                    continue;
                }

                $bRow = $this->fetchOne(
                    "SELECT remaining_qty FROM product_batches WHERE batch_id = ? LIMIT 1",
                    'i',
                    [$bid]
                );
                if (!$bRow) {
                    continue;
                }

                $newQty = max(0.0, (float) $bRow['remaining_qty'] - $bwt);
                $this->execute(
                    "UPDATE product_batches SET remaining_qty = ? WHERE batch_id = ?",
                    'di',
                    [$newQty, $bid]
                );

                $alerts = array_merge($alerts, $this->batchAlerts($bid, $newQty));
                $detail = "Manual deducted {$bwt} from batch #{$bid} for order_item #{$orderItemId}";
                $this->execute(
                    "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                     VALUES (?, 'batch_deduction', 'product_batch', ?, ?)",
                    'iis',
                    [$staffId, $bid, $detail]
                );
            }
        } else {
            // Automatic FIFO: drain oldest batches first
            $remaining = $totalWeight;
            $batches   = $this->fetchAll(
                "SELECT batch_id, remaining_qty
                 FROM product_batches
                 WHERE product_id = ? AND remaining_qty > 0
                 ORDER BY batch_date ASC",
                'i',
                [$productId]
            );

            foreach ($batches as $bRow) {
                if ($remaining <= 0) {
                    break;
                }
                $bid    = (int) $bRow['batch_id'];
                $avail  = (float) $bRow['remaining_qty'];
                $deduct = min($remaining, $avail);
                $newQty = max(0.0, $avail - $deduct);

                $this->execute(
                    "UPDATE product_batches SET remaining_qty = ? WHERE batch_id = ?",
                    'di',
                    [$newQty, $bid]
                );

                $remaining -= $deduct;
                $alerts     = array_merge($alerts, $this->batchAlerts($bid, $newQty));

                $detail = "FIFO deducted {$deduct} from batch #{$bid} for order_item #{$orderItemId} (actual_weight={$totalWeight})";
                $this->execute(
                    "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
                     VALUES (?, 'batch_deduction', 'product_batch', ?, ?)",
                    'iis',
                    [$staffId, $bid, $detail]
                );
            }
        }

        return $alerts;
    }

    // ── Private helpers ───────────────────────────────────────────

    private function batchAlerts(int $batchId, float $remainingQty): array
    {
        if ($remainingQty == 0) {
            return ["Batch #$batchId is now completely depleted."];
        }
        if ($remainingQty < 5) {
            return ["Batch #$batchId is low: " . number_format($remainingQty, 3) . " remaining."];
        }
        return [];
    }
}