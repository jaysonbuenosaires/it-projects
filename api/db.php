<?php
/**
 * db.php — database bootstrap.
 *
 * Establishes the MySQLi connection and loads all helpers + services.
 * Every API controller just requires this single file.
 */
require_once __DIR__ . '/config.php';

$conn = mysqli_connect(DB_HOST, DB_USER, DB_PASS, DB_NAME);
if (!$conn) {
    http_response_code(500);
    die(json_encode(['success' => false, 'message' => 'DB connection failed: ' . mysqli_connect_error()]));
}
mysqli_set_charset($conn, DB_CHARSET);

// ── HTTP headers ────────────────────────────────────────────────
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Autoload helpers and services ───────────────────────────────
require_once __DIR__ . '/helpers/Response.php';
require_once __DIR__ . '/services/BaseService.php';
require_once __DIR__ . '/services/AuthService.php';
require_once __DIR__ . '/services/NotificationService.php';
require_once __DIR__ . '/services/UserService.php';
require_once __DIR__ . '/services/ProductService.php';
require_once __DIR__ . '/services/CartService.php';
require_once __DIR__ . '/services/InventoryService.php';
require_once __DIR__ . '/services/OrderService.php';
require_once __DIR__ . '/services/ReportService.php';