<?php
/**
 * PoultryMart — Admin API Controller
 *
 * Thin router: parse input → call service → emit Response.
 * No SQL lives here.
 *
 * GET  ?action=login            POST { email, password }
 * GET  ?action=dashboard
 * GET  ?action=orders
 * GET  ?action=order&id=N
 * POST ?action=update_order
 * POST ?action=pack_order
 * POST ?action=assign_rider
 * POST ?action=verify_payment
 * POST ?action=cancel_order
 * GET  ?action=products
 * POST ?action=save_product
 * POST ?action=toggle_featured
 * POST ?action=archive_product
 * GET  ?action=users
 * POST ?action=update_user_status
 * POST ?action=save_user
 * GET  ?action=inventory
 * POST ?action=add_batch
 * GET  ?action=promos
 * POST ?action=save_promo
 * GET  ?action=report
 * GET  ?action=riders
 * GET  ?action=settings
 */
require_once __DIR__ . '/db.php';

$action   = $_GET['action'] ?? '';
$body     = json_decode(file_get_contents('php://input'), true) ?? [];

// ── Service instances ────────────────────────────────────────────
$auth      = new AuthService($conn);
$users     = new UserService($conn);
$products  = new ProductService($conn);
$inventory = new InventoryService($conn);
$orders    = new OrderService($conn);
$reports   = new ReportService($conn);

// ── LOGIN (no role guard required) ──────────────────────────────
if ($action === 'login') {
    $result = $auth->login(
        trim($body['email']    ?? ''),
        $body['password']      ?? '',
        ['Super Admin', 'Fulfillment Staff', 'Delivery Rider']
    );
    if (!$result['success']) {
        Response::error($result['message'], 401);
    }
    Response::ok(['message' => $result['message'], 'user' => $result['user']]);
}

// ── Role guard for all other actions ────────────────────────────
$adminId = (int) ($body['admin_id'] ?? $_GET['admin_id'] ?? 0);
if ($adminId > 0) {
    $guard = $auth->verifyRole($adminId, ['Super Admin', 'Fulfillment Staff', 'Delivery Rider']);
    if (!$guard) {
        Response::error('Access denied.', 403);
    }
    $adminRole = $guard['role_name'];
} else {
    $adminRole = 'Super Admin'; // Demo mode — remove in production
}

// ════════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════════
if ($action === 'dashboard') {
    Response::ok(['data' => $reports->getDashboard()]);
}

// ════════════════════════════════════════════════════════════════
//  ORDERS LIST
// ════════════════════════════════════════════════════════════════
if ($action === 'orders') {
    $result = $orders->getOrders(
        $_GET['status'] ?? '',
        trim($_GET['search'] ?? ''),
        max(1, (int) ($_GET['page'] ?? 1)),
        20
    );
    Response::ok([
        'data'  => $result['orders'],
        'total' => $result['total'],
        'page'  => $result['page'],
        'pages' => $result['pages'],
    ]);
}

// ════════════════════════════════════════════════════════════════
//  SINGLE ORDER DETAIL
// ════════════════════════════════════════════════════════════════
if ($action === 'order') {
    $oid   = (int) ($_GET['id'] ?? 0);
    if (!$oid) Response::error('id required', 422);
    $order = $orders->getOrderDetail($oid);
    if (!$order) Response::error('Not found', 404);
    Response::ok(['data' => $order]);
}

// ════════════════════════════════════════════════════════════════
//  UPDATE ORDER STATUS
// ════════════════════════════════════════════════════════════════
if ($action === 'update_order') {
    $oid    = (int) ($body['order_id'] ?? 0);
    $status = $body['status'] ?? '';
    if (!$oid || !$status) Response::error('Invalid params', 422);
    try {
        $orders->updateOrderStatus($oid, $status, $adminId);
        Response::ok(['message' => "Order status updated to $status."]);
    } catch (InvalidArgumentException $e) {
        Response::error($e->getMessage(), 422);
    }
}

// ════════════════════════════════════════════════════════════════
//  PACK ORDER
// ════════════════════════════════════════════════════════════════
if ($action === 'pack_order') {
    $oid   = (int) ($body['order_id'] ?? 0);
    $items = $body['items'] ?? [];
    if (!$oid || empty($items)) Response::error('order_id and items required', 422);
    try {
        $finalTotal = $orders->packOrderAdmin($oid, $items, $adminId);
        Response::ok(['message' => 'Order packed.', 'final_total' => $finalTotal]);
    } catch (Throwable $e) {
        Response::error($e->getMessage(), 500);
    }
}

// ════════════════════════════════════════════════════════════════
//  ASSIGN RIDER
// ════════════════════════════════════════════════════════════════
if ($action === 'assign_rider') {
    $oid      = (int) ($body['order_id'] ?? 0);
    $riderId  = (int) ($body['rider_id'] ?? 0);
    if (!$oid || !$riderId) Response::error('order_id and rider_id required', 422);
    $orders->assignRider($oid, $riderId, $adminId);
    Response::ok(['message' => 'Rider assigned.']);
}

// ════════════════════════════════════════════════════════════════
//  VERIFY PAYMENT
// ════════════════════════════════════════════════════════════════
if ($action === 'verify_payment') {
    $oid = (int) ($body['order_id'] ?? 0);
    if (!$oid) Response::error('order_id required', 422);
    $orders->verifyPayment($oid, $adminId);
    Response::ok(['message' => 'Payment verified.']);
}

// ════════════════════════════════════════════════════════════════
//  CANCEL ORDER
// ════════════════════════════════════════════════════════════════
if ($action === 'cancel_order') {
    $oid    = (int) ($body['order_id'] ?? 0);
    $reason = $body['reason'] ?? 'Admin cancellation';
    if (!$oid) Response::error('order_id required', 422);
    try {
        $orders->cancelOrder($oid, $adminId, $reason);
        Response::ok(['message' => 'Order cancelled.']);
    } catch (RuntimeException $e) {
        Response::error($e->getMessage(), 422);
    }
}

// ════════════════════════════════════════════════════════════════
//  PRODUCTS LIST
// ════════════════════════════════════════════════════════════════
if ($action === 'products') {
    $data = $products->getAdminProducts(
        trim($_GET['search']      ?? ''),
        (int) ($_GET['category_id'] ?? 0),
        $_GET['status']           ?? ''
    );
    Response::ok(['data' => $data]);
}

// ════════════════════════════════════════════════════════════════
//  SAVE PRODUCT
// ════════════════════════════════════════════════════════════════
if ($action === 'save_product') {
    $pid        = (int) ($body['product_id'] ?? 0);
    $name       = trim($body['name']         ?? '');
    $desc       = trim($body['description']  ?? '');
    $catId      = (int) ($body['category_id']  ?? 0);
    $basePrice  = (float) ($body['base_price'] ?? 0);
    $pm         = $body['pricing_model']     ?? 'catch_weight';
    $estWeight  = (float) ($body['estimated_weight'] ?? 1);
    $isFeatured = !empty($body['is_featured']);
    $status     = in_array($body['status'] ?? '', ['active', 'archived']) ? $body['status'] : 'active';

    if (!$name || !$catId || $basePrice <= 0) {
        Response::error('name, category_id, and base_price are required', 422);
    }
    try {
        $productId = $products->saveProduct($pid, $name, $desc, $catId, $basePrice, $pm, $estWeight, $isFeatured, $status);
        Response::ok(['message' => 'Product saved.', 'product_id' => $productId]);
    } catch (Throwable $e) {
        Response::error($e->getMessage(), 500);
    }
}

// ════════════════════════════════════════════════════════════════
//  TOGGLE FEATURED
// ════════════════════════════════════════════════════════════════
if ($action === 'toggle_featured') {
    $pid = (int) ($body['product_id'] ?? 0);
    if (!$pid) Response::error('product_id required', 422);
    $newVal = $products->toggleFeatured($pid);
    Response::ok(['is_featured' => $newVal]);
}

// ════════════════════════════════════════════════════════════════
//  ARCHIVE / RESTORE PRODUCT
// ════════════════════════════════════════════════════════════════
if ($action === 'archive_product') {
    $pid    = (int) ($body['product_id'] ?? 0);
    $status = $body['status'] ?? 'archived';
    if (!$pid) Response::error('product_id required', 422);
    $products->archiveProduct($pid, $status);
    Response::ok(['message' => "Product $status."]);
}

// ════════════════════════════════════════════════════════════════
//  USERS LIST
// ════════════════════════════════════════════════════════════════
if ($action === 'users') {
    $data = $users->getUsers(
        trim($_GET['search'] ?? ''),
        trim($_GET['role']   ?? ''),
        trim($_GET['status'] ?? '')
    );
    Response::ok(['data' => $data]);
}

// ════════════════════════════════════════════════════════════════
//  UPDATE USER STATUS
// ════════════════════════════════════════════════════════════════
if ($action === 'update_user_status') {
    $uid    = (int) ($body['user_id'] ?? 0);
    $status = $body['status'] ?? 'active';
    if (!$uid) Response::error('user_id required', 422);
    try {
        $users->updateUserStatus($uid, $status);
        Response::ok(['message' => "User $status."]);
    } catch (InvalidArgumentException $e) {
        Response::error($e->getMessage(), 422);
    }
}

// ════════════════════════════════════════════════════════════════
//  SAVE USER
// ════════════════════════════════════════════════════════════════
if ($action === 'save_user') {
    $uid      = (int) ($body['user_id']    ?? 0);
    $first    = trim($body['first_name']   ?? '');
    $last     = trim($body['last_name']    ?? '');
    $email    = trim($body['email']        ?? '');
    $phone    = trim($body['phone']        ?? '');
    $role     = $body['role']              ?? 'Customer';
    $password = $body['password']          ?? '';

    try {
        $newId = $users->saveUser($uid, $first, $last, $email, $phone, $role, $password);
        $msg   = $uid > 0 ? 'User updated.' : 'User created.';
        $extra = $uid > 0 ? [] : ['user_id' => $newId];
        Response::ok(array_merge(['message' => $msg], $extra));
    } catch (InvalidArgumentException $e) {
        Response::error($e->getMessage(), 422);
    } catch (RuntimeException $e) {
        Response::error($e->getMessage(), 500);
    }
}

// ════════════════════════════════════════════════════════════════
//  INVENTORY
// ════════════════════════════════════════════════════════════════
if ($action === 'inventory') {
    Response::ok(['data' => $inventory->getBatches()]);
}

// ════════════════════════════════════════════════════════════════
//  ADD BATCH
// ════════════════════════════════════════════════════════════════
if ($action === 'add_batch') {
    $pid  = (int) ($body['product_id'] ?? 0);
    $date = $body['batch_date'] ?? date('Y-m-d');
    $qty  = (float) ($body['quantity'] ?? 0);

    if (!$pid || $qty <= 0) Response::error('product_id and quantity required', 422);

    try {
        $result = $inventory->addBatch($pid, $date, $qty);
        Response::ok([
            'message'    => 'Batch added.',
            'batch_id'   => $result['batch_id'],
            'batch_unit' => $result['batch_unit'],
        ]);
    } catch (RuntimeException $e) {
        Response::error($e->getMessage(), 404);
    }
}

// ════════════════════════════════════════════════════════════════
//  PROMO CODES
// ════════════════════════════════════════════════════════════════
if ($action === 'promos') {
    Response::ok(['data' => $reports->getPromos()]);
}

if ($action === 'save_promo') {
    $pid        = (int) ($body['promo_id']        ?? 0);
    $code       = strtoupper(trim($body['code']   ?? ''));
    $type       = $body['discount_type']          ?? 'flat';
    $val        = (float) ($body['discount_value']  ?? 0);
    $min        = (float) ($body['min_order_value'] ?? 0);
    $isActive   = !empty($body['is_active']);
    $validFrom  = !empty($body['valid_from'])  ? $body['valid_from']  : null;
    $validTo    = !empty($body['valid_to'])    ? $body['valid_to']    : null;
    $usageLimit = (isset($body['usage_limit']) && $body['usage_limit'] !== '') ? (int) $body['usage_limit'] : null;

    try {
        $savedId = $reports->savePromo($pid, $code, $type, $val, $min, $isActive, $validFrom, $validTo, $usageLimit, $adminId);
        $msg     = $pid > 0 ? 'Promo updated.' : 'Promo created.';
        $extra   = $pid > 0 ? [] : ['promo_id' => $savedId];
        Response::ok(array_merge(['message' => $msg], $extra));
    } catch (Throwable $e) {
        Response::error($e->getMessage(), 500);
    }
}

// ════════════════════════════════════════════════════════════════
//  REPORT
// ════════════════════════════════════════════════════════════════
if ($action === 'report') {
    $days = max(7, min(365, (int) ($_GET['period'] ?? 30)));
    Response::ok(['data' => $reports->getReport($days)]);
}

// ════════════════════════════════════════════════════════════════
//  RIDERS LIST
// ════════════════════════════════════════════════════════════════
if ($action === 'riders') {
    Response::ok(['data' => $users->getRiders()]);
}

// ════════════════════════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════════════════════════
if ($action === 'settings') {
    Response::ok(['data' => $reports->getSettings()]);
}

Response::error('Invalid action.', 400);