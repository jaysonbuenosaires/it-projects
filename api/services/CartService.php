<?php
/**
 * CartService — get/add/remove/clear cart items.
 */
class CartService extends BaseService
{
    /**
     * Compute the estimated subtotal for one cart/order line.
     *
     *   catch_weight → qty × estimated_weight × base_price
     *   fixed_pack   → qty × base_price
     *   per_piece    → qty × base_price
     */
    public static function estimatedSubtotal(
        string $pricingModel,
        int    $qty,
        float  $basePrice,
        float  $estimatedWeight
    ): float {
        if ($pricingModel === 'catch_weight') {
            return round($qty * $estimatedWeight * $basePrice, 2);
        }
        return round($qty * $basePrice, 2);
    }

    /**
     * Return (creating if missing) the cart_id and its items for a user.
     */
    public function getCart(int $uid): array
    {
        $cart = $this->fetchOne(
            "SELECT cart_id FROM carts WHERE user_id = ? LIMIT 1",
            'i',
            [$uid]
        );

        if (!$cart) {
            $cartId = $this->insertGetId(
                "INSERT INTO carts (user_id) VALUES (?)",
                'i',
                [$uid]
            );
        } else {
            $cartId = (int) $cart['cart_id'];
        }

        $items = $this->fetchAll(
            "SELECT ci.*,
                    p.name, p.base_price, p.pricing_model,
                    p.unit_of_measure, p.estimated_weight, p.is_catch_weight,
                    p.status AS product_status,
                    IF(ci.unit_price_snapshot <> p.base_price, 1, 0) AS price_changed,
                    c.name AS category_name
             FROM cart_items ci
             JOIN products   p ON p.product_id  = ci.product_id
             JOIN categories c ON c.category_id = p.category_id
             WHERE ci.cart_id = ?
             ORDER BY ci.added_at ASC",
            'i',
            [$cartId]
        );

        return ['cart_id' => $cartId, 'items' => $items];
    }

    /**
     * Upsert a cart item (add or update quantity).
     */
    public function addItem(int $uid, int $productId, int $quantity): array
    {
        if ($quantity < 1) {
            throw new InvalidArgumentException('Quantity must be at least 1.');
        }

        $cart   = $this->getCart($uid);
        $cartId = $cart['cart_id'];

$product = $this->fetchOne(
            "SELECT base_price, pricing_model, estimated_weight
             FROM products WHERE product_id = ? AND status = 'active' LIMIT 1",
            'i',
            [$productId]
        );
        if (!$product) {
            throw new RuntimeException('Product not found or unavailable.');
        }

        // Backend stock guard — never trust the client quantity
        $stockRow = $this->fetchOne(
            "SELECT COALESCE(SUM(remaining_qty), 0) AS total
             FROM product_batches WHERE product_id = ?",
            'i',
            [$productId]
        );
        $available = (float) ($stockRow['total'] ?? 0);
        if ($available <= 0) {
            throw new RuntimeException('Sorry, this item is currently out of stock.');
        }
        if ((float) $quantity > $available) {
            throw new RuntimeException(
                'Only ' . floor($available) . ' unit(s) available. Please reduce the quantity.'
            );
        }

        $unitPrice    = (float) $product['base_price'];
        $pricingModel = $product['pricing_model'];
        $estWeight    = (float) $product['estimated_weight'];
        $estPrice     = self::estimatedSubtotal($pricingModel, $quantity, $unitPrice, $estWeight);

        $this->execute(
            "INSERT INTO cart_items
                 (cart_id, product_id, quantity, unit_price_snapshot, pricing_model, estimated_price)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 quantity            = ?,
                 unit_price_snapshot = ?,
                 pricing_model       = ?,
                 estimated_price     = ?",
            'iiidsdisds',
            [
                $cartId, $productId, $quantity, $unitPrice, $pricingModel, $estPrice,
                $quantity, $unitPrice, $pricingModel, $estPrice,
            ]
        );

        return $this->getCart($uid);
    }

    public function getStockLevels(array $productIds): array {
    if (empty($productIds)) return [];

    $placeholders = implode(',', array_fill(0, count($productIds), '?'));
    $types = str_repeat('i', count($productIds));

    $sql = "SELECT product_id, SUM(remaining_qty) as remaining_qty 
            FROM product_batches 
            WHERE product_id IN ($placeholders) 
            GROUP BY product_id";

    $results = $this->fetchAll($sql, $types, $productIds);

    $stockMap = [];
    foreach ($results as $row) {
        $stockMap[$row['product_id']] = (int)$row['remaining_qty'];
    }
    return $stockMap;
}

    /**
     * Remove one product from the cart.
     */
    public function removeItem(int $uid, int $productId): array
    {
        $cart = $this->fetchOne(
            "SELECT cart_id FROM carts WHERE user_id = ? LIMIT 1",
            'i',
            [$uid]
        );
        if ($cart) {
            $this->execute(
                "DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?",
                'ii',
                [(int) $cart['cart_id'], $productId]
            );
        }
        return $this->getCart($uid);
    }

    /**
     * Remove all items from the cart.
     */
    public function clearCart(int $uid): void
    {
        $cart = $this->fetchOne(
            "SELECT cart_id FROM carts WHERE user_id = ? LIMIT 1",
            'i',
            [$uid]
        );
        if ($cart) {
            $this->execute(
                "DELETE FROM cart_items WHERE cart_id = ?",
                'i',
                [(int) $cart['cart_id']]
            );
        }
    }
}