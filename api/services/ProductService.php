<?php
/**
 * ProductService — product catalogue and product management.
 */
class ProductService extends BaseService
{
    // ── Public catalogue ──────────────────────────────────────────

    /**
     * Return all active categories with a product count.
     */
    public function getCategories(): array
    {
        return $this->fetchAll(
            "SELECT c.*, COUNT(p.product_id) AS product_count
             FROM categories c
             LEFT JOIN products p ON p.category_id = c.category_id AND p.status = 'active'
             GROUP BY c.category_id
             ORDER BY c.category_id ASC"
        );
    }

    /**
     * Return active products with optional category, search, and sort filters.
     */
    public function getActiveProducts(?int $categoryId, string $search, string $sort): array
    {
        $conditions = ["p.status = 'active'"];
        $types      = '';
        $params     = [];

        if ($categoryId) {
            $conditions[] = 'p.category_id = ?';
            $types .= 'i';
            $params[] = $categoryId;
        }
        if ($search !== '') {
            $conditions[] = 'p.name LIKE ?';
            $types .= 's';
            $params[] = "%$search%";
        }

        $where = implode(' AND ', $conditions);
        $orderBy = match ($sort) {
            'price_asc'  => 'p.base_price ASC',
            'price_desc' => 'p.base_price DESC',
            'az'         => 'p.name ASC',
            'za'         => 'p.name DESC',
            default      => 'p.is_featured DESC, p.product_id ASC',
        };

        return $this->fetchAll(
            "SELECT p.*, c.name AS category_name,
                    COALESCE(AVG(r.rating), 0) AS avg_rating,
                    COUNT(r.review_id)          AS review_count
             FROM products p
             JOIN categories c ON c.category_id = p.category_id
             LEFT JOIN reviews r ON r.product_id = p.product_id
             WHERE $where
             GROUP BY p.product_id
             ORDER BY $orderBy",
            $types,
            $params
        );
    }

    /**
     * Return a single active product with its reviews and wholesale tiers.
     */
    public function getProduct(int $id): ?array
    {
        $row = $this->fetchOne(
            "SELECT p.*, c.name AS category_name,
                    COALESCE(AVG(r.rating), 0) AS avg_rating,
                    COUNT(r.review_id)          AS review_count
             FROM products p
             JOIN categories c ON c.category_id = p.category_id
             LEFT JOIN reviews r ON r.product_id = p.product_id
             WHERE p.product_id = ? AND p.status = 'active'
             GROUP BY p.product_id
             LIMIT 1",
            'i',
            [$id]
        );

        if (!$row) {
            return null;
        }

        $row['reviews'] = $this->fetchAll(
            "SELECT r.rating, r.review_text, r.created_at, u.first_name, u.last_name
             FROM reviews r
             JOIN users u ON u.user_id = r.user_id
             WHERE r.product_id = ?
             ORDER BY r.created_at DESC LIMIT 5",
            'i',
            [$id]
        );

        $row['wholesale_tiers'] = $this->fetchAll(
            "SELECT min_qty, tier_unit, tier_unit_price
             FROM wholesale_tiers
             WHERE product_id = ? ORDER BY min_qty ASC",
            'i',
            [$id]
        );

        return $row;
    }

    // ── Admin catalogue ───────────────────────────────────────────

    /**
     * Return all products (including archived) with optional filters.
     */
    public function getAdminProducts(string $search, int $categoryId, string $status): array
    {
        $conditions = ['1=1'];
        $types      = '';
        $params     = [];

        if ($search !== '') {
            $conditions[] = 'p.name LIKE ?';
            $types .= 's';
            $params[] = "%$search%";
        }
        if ($categoryId > 0) {
            $conditions[] = 'p.category_id = ?';
            $types .= 'i';
            $params[] = $categoryId;
        }
        if ($status !== '') {
            $conditions[] = 'p.status = ?';
            $types .= 's';
            $params[] = $status;
        }

        $where = implode(' AND ', $conditions);

        return $this->fetchAll(
            "SELECT p.product_id, p.category_id, p.name, p.description,
                    p.base_price, p.pricing_model, p.unit_of_measure,
                    p.estimated_weight, p.is_featured, p.is_catch_weight,
                    p.status, p.created_at,
                    c.name AS category_name,
                    COALESCE(SUM(pb.remaining_qty), 0) AS stock_qty
             FROM products p
             JOIN categories c ON c.category_id = p.category_id
             LEFT JOIN product_batches pb ON pb.product_id = p.product_id
             WHERE $where
             GROUP BY p.product_id
             ORDER BY p.category_id ASC, p.name ASC",
            $types,
            $params
        );
    }

    /**
     * Create or update a product.
     *
     * @return int  product_id of the saved record.
     */
    public function saveProduct(
        int    $pid,
        string $name,
        string $description,
        int    $categoryId,
        float  $basePrice,
        string $pricingModel,
        float  $estimatedWeight,
        bool   $isFeatured,
        string $status
    ): int {
        $allowedModels = ['catch_weight', 'fixed_pack', 'per_piece'];
        if (!in_array($pricingModel, $allowedModels, true)) {
            $pricingModel = 'catch_weight';
        }

        $uomMap        = ['catch_weight' => 'kg', 'fixed_pack' => 'pack', 'per_piece' => 'piece'];
        $unitOfMeasure = $uomMap[$pricingModel];
        $isCatchWeight = ($pricingModel === 'catch_weight') ? 1 : 0;
        $featInt       = (int) $isFeatured;

        if ($pid > 0) {
            $this->execute(
                "UPDATE products SET
                    category_id = ?, name = ?, description = ?,
                    base_price = ?, pricing_model = ?, unit_of_measure = ?,
                    estimated_weight = ?, is_featured = ?, is_catch_weight = ?, status = ?
                 WHERE product_id = ?",
                'isssdssiii' . 'i',
                [
                    $categoryId, $name, $description,
                    $basePrice, $pricingModel, $unitOfMeasure,
                    $estimatedWeight, $featInt, $isCatchWeight, $status,
                    $pid,
                ]
            );
            return $pid;
        }

        return $this->insertGetId(
            "INSERT INTO products
                (category_id, name, description, base_price, pricing_model,
                 unit_of_measure, estimated_weight, is_featured, is_catch_weight, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            'isssdssiii',
            [
                $categoryId, $name, $description, $basePrice, $pricingModel,
                $unitOfMeasure, $estimatedWeight, $featInt, $isCatchWeight, $status,
            ]
        );
    }

    /**
     * Toggle the is_featured flag. Returns the new value.
     */
    public function toggleFeatured(int $pid): int
    {
        $this->execute(
            "UPDATE products SET is_featured = 1 - is_featured WHERE product_id = ?",
            'i',
            [$pid]
        );
        $row = $this->fetchOne(
            "SELECT is_featured FROM products WHERE product_id = ? LIMIT 1",
            'i',
            [$pid]
        );
        return (int) ($row['is_featured'] ?? 0);
    }

    /**
     * Set a product's status to 'active' or 'archived'.
     */
    public function archiveProduct(int $pid, string $status): void
    {
        $status = ($status === 'active') ? 'active' : 'archived';
        $this->execute(
            "UPDATE products SET status = ? WHERE product_id = ?",
            'si',
            [$status, $pid]
        );
    }

    /**
     * Add a customer product review (enforces one review per user/product/order).
     */
    public function addReview(int $uid, int $productId, int $orderId, int $rating, string $text): void
    {
        // Verify order is completed and belongs to user
        $ord = $this->fetchOne(
            "SELECT status FROM orders WHERE order_id = ? AND user_id = ? LIMIT 1",
            'ii',
            [$orderId, $uid]
        );
        if (!$ord || $ord['status'] !== 'Completed') {
            throw new RuntimeException('You can only review products from your completed orders.');
        }

        // Verify product was in that order
        $inOrder = $this->fetchOne(
            "SELECT order_item_id FROM order_items WHERE order_id = ? AND product_id = ? LIMIT 1",
            'ii',
            [$orderId, $productId]
        );
        if (!$inOrder) {
            throw new RuntimeException('This product was not part of the specified order.');
        }

        $affected = $this->execute(
            "INSERT IGNORE INTO reviews (user_id, product_id, order_id, rating, review_text)
             VALUES (?, ?, ?, ?, ?)",
            'iiiis',
            [$uid, $productId, $orderId, $rating, $text]
        );

        if ($affected === 0) {
            throw new RuntimeException('You have already reviewed this product for this order.');
        }
    }
}