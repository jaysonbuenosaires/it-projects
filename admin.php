<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PoultryMart — Admin Panel</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/admin-entry.css" />
</head>
<body>

<!-- ═══════════════════════════════════════════════════════
     LOGIN SCREEN
═══════════════════════════════════════════════════════ -->
<div id="login-screen" class="portal-login">
  <div class="portal-login__card">
    <div class="portal-login__logo">
      <span class="logo-icon">🐓</span>
      <span>Poultry<strong>Mart</strong></span>
    </div>
    <h2>Admin Sign In</h2>
    <p class="portal-login__sub">Access the PoultryMart management dashboard</p>

    <form onsubmit="adminLogin(event)" novalidate>
      <div class="form-group">
        <label for="login-email">Email Address</label>
        <input type="email" id="login-email" class="form-input" placeholder="admin@poultrymart.com"
          autocomplete="email" required aria-required="true" />
      </div>
      <div class="form-group">
        <label for="login-pass">Password</label>
        <input type="password" id="login-pass" class="form-input" placeholder="••••••••"
          autocomplete="current-password" required aria-required="true" />
      </div>

      <p id="login-error" class="form-error" role="alert" aria-live="polite"></p>

      <button type="submit" id="login-btn" class="btn-primary full-width">
        Sign In to Admin
      </button>
    </form>

    <p class="auth-demo-hint">
      Demo credentials: <strong><a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="78191c1511163808170d140c0a0115190a0c561b1715">[email&#160;protected]</a></strong> / <strong>password</strong>
    </p>
    <p class="auth-back-link">
      <a href="/index.php" class="link-green">← Back to Store</a>
    </p>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════
     ADMIN APP SHELL
═══════════════════════════════════════════════════════ -->
<div id="portal-app" class="portal-body portal-body--admin" hidden>

  <!-- ── SIDEBAR OVERLAY (mobile) ──────────────────────── -->
  <div id="portal-sidebar-overlay" class="portal-sidebar-overlay" aria-hidden="true"
       onclick="closeSidebar()"></div>

  <!-- ── SIDEBAR ────────────────────────────────────────── -->
  <aside id="portal-sidebar" class="portal-sidebar" aria-label="Admin navigation">

    <!-- Logo -->
    <a href="#" class="portal-sidebar__header" onclick="adminNavigate('dashboard')" aria-label="PoultryMart Admin Home">
      <span class="logo-icon" aria-hidden="true">🐓</span>
      <span class="logo-text">Poultry<strong>Mart</strong></span>
      <span class="admin-tag" aria-label="Admin panel">Admin</span>
    </a>

    <!-- User info -->
    <div class="portal-user-pill" aria-label="Logged in user">
      <div class="portal-avatar" id="sb-avatar" aria-hidden="true">SA</div>
      <div>
        <div class="portal-user-name" id="sb-user-name">Super Admin</div>
        <div class="portal-role-tag" id="sb-user-role">Super Admin</div>
      </div>
    </div>

    <!-- Navigation -->
    <nav class="portal-nav" aria-label="Admin sections">

      <span class="portal-nav__section" aria-hidden="true">Overview</span>
      <button class="portal-nav__btn sidebar-link active" data-view="dashboard" onclick="adminNavigate('dashboard')" aria-label="Dashboard">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        Dashboard
      </button>

      <span class="portal-nav__section" aria-hidden="true">Orders</span>
      <button class="portal-nav__btn sidebar-link" data-view="orders" onclick="adminNavigate('orders')" aria-label="All orders">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
        </svg>
        All Orders
        <span class="nav-badge" id="pending-badge" aria-label="pending orders">0</span>
      </button>
      <button class="portal-nav__btn sidebar-link" data-view="packing" onclick="adminNavigate('packing')" aria-label="Packing queue">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
        </svg>
        Packing Queue
      </button>
      <button class="portal-nav__btn sidebar-link" data-view="delivery" onclick="adminNavigate('delivery')" aria-label="Delivery management">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
          <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
        Delivery
      </button>

      <span class="portal-nav__section" aria-hidden="true">Catalog</span>
      <button class="portal-nav__btn sidebar-link" data-view="products" onclick="adminNavigate('products')" aria-label="Products management">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
          <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        Products
      </button>
      <button class="portal-nav__btn sidebar-link" data-view="inventory" onclick="adminNavigate('inventory')" aria-label="Inventory management">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <ellipse cx="12" cy="5" rx="9" ry="3"/>
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
        </svg>
        Inventory
      </button>

      <span class="portal-nav__section" aria-hidden="true">Management</span>
      <button class="portal-nav__btn sidebar-link" data-view="users" onclick="adminNavigate('users')" aria-label="Users and staff">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        Users &amp; Staff
      </button>
      <button class="portal-nav__btn sidebar-link" data-view="promos" onclick="adminNavigate('promos')" aria-label="Promo codes">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
          <line x1="7" y1="7" x2="7.01" y2="7"/>
        </svg>
        Promo Codes
      </button>
      <button class="portal-nav__btn sidebar-link" data-view="reports" onclick="adminNavigate('reports')" aria-label="Sales reports">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
        </svg>
        Reports
      </button>
      <button class="portal-nav__btn sidebar-link" data-view="settings" onclick="adminNavigate('settings')" aria-label="System settings">
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.07 4.93a10 10 0 0 1 1.41 13.93M4.93 4.93a10 10 0 0 0-1.41 13.93"/>
          <path d="M12 2a10 10 0 0 1 7.07 17.07M12 22a10 10 0 0 1-7.07-17.07"/>
        </svg>
        Settings
      </button>

    </nav>

    <!-- Logout -->
    <div class="portal-sidebar__footer">
      <button class="portal-nav__logout" onclick="adminLogout()" aria-label="Sign out">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Sign Out
      </button>
    </div>
  </aside>

  <!-- ── MAIN CONTENT ──────────────────────────────────── -->
  <div class="portal-main">

    <!-- Top bar -->
    <header class="portal-topbar">
      <button class="topbar-menu-btn icon-btn" onclick="toggleSidebar()" aria-label="Toggle sidebar" aria-expanded="false">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      <div id="topbar-title" class="topbar-title">
        Dashboard
        <small>Welcome to PoultryMart Admin</small>
      </div>
      <div class="topbar-actions">
        <button class="btn-outline btn-sm" style="position:relative"
                aria-label="Notifications" onclick="adminNavigate('orders')">
          🔔
          <span id="notif-badge"
                style="display:none;position:absolute;top:-5px;right:-5px;
                       background:var(--error);color:#fff;border-radius:999px;
                       font-size:.65rem;font-weight:700;min-width:16px;height:16px;
                       line-height:16px;text-align:center;padding:0 3px"
                aria-label="Unread notifications"></span>
        </button>
        <a href="/index.php" class="btn-outline btn-sm" target="_blank" aria-label="View store in new tab">
          View Store ↗
        </a>
      </div>
    </header>

    <!-- ─── Content ─────────────────────────────────────── -->
    <main class="admin-content" id="admin-views">

      <!-- ═══════════════════════════════════════════════
           DASHBOARD
      ═══════════════════════════════════════════════ -->
      <section id="view-dashboard" class="admin-view active" aria-label="Dashboard">

        <!-- Stats -->
        <div class="stats-grid" role="region" aria-label="Key statistics">
          <div class="stat-card">
            <div class="stat-icon green" aria-hidden="true">₱</div>
            <div class="stat-info">
              <div class="stat-label">Total Revenue</div>
              <div class="stat-value" id="stat-revenue">—</div>
              <div class="stat-sub" id="stat-today-rev">Today: —</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon orange" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div class="stat-info">
              <div class="stat-label">Total Orders</div>
              <div class="stat-value" id="stat-orders">—</div>
              <div class="stat-sub" id="stat-today-ord">Today: —</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon blue" aria-hidden="true">⏳</div>
            <div class="stat-info">
              <div class="stat-label">Pending Orders</div>
              <div class="stat-value" id="stat-pending">—</div>
              <div class="stat-sub">Awaiting packing</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon purple" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div class="stat-info">
              <div class="stat-label">Customers</div>
              <div class="stat-value" id="stat-customers">—</div>
              <div class="stat-sub"><span id="stat-products">—</span> products active</div>
            </div>
          </div>
        </div>

        <!-- Dashboard grid -->
        <div class="dashboard-grid">

          <!-- Recent Orders -->
          <div class="admin-panel span2">
            <div class="panel-header">
              <h2 class="panel-title">Recent Orders</h2>
              <button class="btn-primary btn-sm" onclick="adminNavigate('orders')">View All</button>
            </div>
            <div class="panel-body no-pad">
              <table class="data-table" aria-label="Recent orders">
                <thead>
                  <tr>
                    <th scope="col">Order #</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Status</th>
                    <th scope="col">Payment</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Date</th>
                  </tr>
                </thead>
                <tbody id="dash-recent-orders">
                  <tr><td colspan="6"><div class="table-loading">Loading</div></td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Weekly Revenue Chart -->
          <div class="admin-panel">
            <div class="panel-header">
              <h2 class="panel-title">Revenue <small>last 7 days</small></h2>
            </div>
            <div id="dash-weekly-chart" class="panel-body no-pad">
              <div class="table-loading">Loading chart</div>
            </div>
          </div>

          <!-- Status Distribution -->
          <div class="admin-panel">
            <div class="panel-header">
              <h2 class="panel-title">Order Status</h2>
            </div>
            <div class="panel-body" id="dash-status-dist">
              <div class="table-loading">Loading</div>
            </div>
          </div>

          <!-- Low Stock Alert -->
          <div class="admin-panel span2">
            <div class="panel-header">
              <h2 class="panel-title">⚠️ Low Stock Alert</h2>
              <button class="btn-outline btn-sm" onclick="adminNavigate('inventory')">Manage Inventory</button>
            </div>
            <div id="dash-low-stock" class="panel-body no-pad">
              <div class="table-loading">Loading</div>
            </div>
          </div>

        </div>
      </section>

      <!-- ═══════════════════════════════════════════════
           ALL ORDERS
      ═══════════════════════════════════════════════ -->
      <section id="view-orders" class="admin-view" aria-label="Orders management">
        <div class="admin-panel">
          <div class="panel-header">
            <h2 class="panel-title">Orders</h2>
            <div class="filter-bar" role="search" aria-label="Filter orders">
              <div class="search-input-wrap">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="search" id="order-search" class="form-input" placeholder="Search orders…"
                  oninput="filterOrders()" aria-label="Search orders" />
              </div>
              <select id="order-status-filter" class="form-input" onchange="filterOrders()" aria-label="Filter by status">
                <option value="">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Packed">Packed</option>
                <option value="Out for Delivery">Out for Delivery</option>
                <option value="Arrived at Location">Arrived at Location</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div class="panel-body no-pad">
            <table class="data-table" aria-label="Orders list">
              <thead>
                <tr>
                  <th scope="col">Order #</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Status</th>
                  <th scope="col">Delivery</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Pay Status</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody id="orders-tbody">
                <tr><td colspan="8"><div class="table-loading">Loading</div></td></tr>
              </tbody>
            </table>
            <div id="orders-pagination" class="pagination" aria-label="Pagination"></div>
          </div>
        </div>
      </section>

      <!-- ═══════════════════════════════════════════════
           PACKING QUEUE
      ═══════════════════════════════════════════════ -->
      <section id="view-packing" class="admin-view" aria-label="Packing queue">
      <div class="admin-panel admin-panel--spaced">
        <div class="panel-header">
          <h2 class="panel-title">Packing Queue</h2>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
            <button class="btn-outline btn-sm" onclick="printDailyPrepSheet()" title="Print Daily Prep Sheet">📋 Prep Sheet</button>
            <button class="btn-primary btn-sm" onclick="loadPacking()">Refresh</button>
          </div>
        </div>
        <div class="panel-body panel-body--flush-bottom">
          <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin-bottom:.75rem">
            <label for="barcode-scan-input" style="font-size:.82rem;font-weight:600;color:var(--text-muted);white-space:nowrap">
              📷 Barcode Scan:
            </label>
            <input id="barcode-scan-input" class="form-input" style="max-width:220px"
                   placeholder="Scan or type order number…"
                   aria-label="Barcode scanner input — press Enter to locate order" />
          </div>
          <p class="panel-hint">
            For <strong>catch-weight</strong> items, enter the <em>total</em> measured weight (kg) across all units.
            Fixed-pack and per-piece items calculate automatically from quantity.
            Mark items <strong>Out of Stock</strong> to process partial fulfillments safely.
            Confirm to set the Final Total.
          </p>
        </div>
      </div>
      <!-- Bulk action bar (hidden until checkboxes are ticked) -->
      <div id="packing-bulk-bar" role="toolbar" aria-label="Bulk actions"
           style="display:none;align-items:center;gap:.75rem;padding:.6rem 1rem;
                  background:var(--green-pale);border-radius:var(--radius-sm);margin-bottom:.75rem;flex-wrap:wrap">
        <span id="bulk-count" style="font-weight:600;font-size:.875rem"></span>
        <button class="btn-outline btn-sm" onclick="bulkPrintLabels()">🏷 Print Labels</button>
        <button class="btn-outline btn-sm" onclick="bulkPrintSlips()">🖨 Print Slips</button>
      </div>
      <div id="packing-list">
        <div class="table-loading">Loading packing queue</div>
      </div>
      </section>

      <!-- ═══════════════════════════════════════════════
           DELIVERY
      ═══════════════════════════════════════════════ -->
      <section id="view-delivery" class="admin-view" aria-label="Delivery management">
      <div class="admin-panel admin-panel--spaced">
        <div class="panel-header">
          <h2 class="panel-title">Delivery Queue</h2>
          <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
            <button id="delivery-zone-sort" class="btn-outline btn-sm"
                    onclick="toggleDeliveryZoneSort()">📍 Zone View</button>
            <button class="btn-primary btn-sm" onclick="loadDelivery()">Refresh</button>
          </div>
        </div>
        <div class="panel-body panel-body--flush-bottom">
          <p class="panel-hint">
            Assign riders to packed orders and track deliveries in progress.
            Use <strong>Zone View</strong> to sort orders by delivery area for efficient routing.
            Super Admins can <strong>Undo</strong> a status step to correct mistakes.
          </p>
        </div>
      </div>
      <div id="delivery-list">
        <div class="table-loading">Loading delivery queue</div>
      </div>
      </section>

      <!-- ═══════════════════════════════════════════════
           PRODUCTS
      ═══════════════════════════════════════════════ -->
      <section id="view-products" class="admin-view" aria-label="Products management">
        <div class="admin-panel">
          <div class="panel-header">
            <h2 class="panel-title">Product Catalog</h2>
            <div class="panel-controls">
              <div class="filter-bar" role="search" aria-label="Filter products">
                <div class="search-input-wrap">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input type="search" id="product-search" class="form-input" placeholder="Search products…"
                    oninput="loadProducts()" aria-label="Search products" />
                </div>
                <select id="product-cat-filter" class="form-input" onchange="loadProducts()" aria-label="Filter by category">
                  <option value="">All Categories</option>
                </select>
                <select id="product-status-filter" class="form-input" onchange="loadProducts()" aria-label="Filter by status">
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <button class="btn-primary btn-sm" onclick="openProductModal()">+ Add Product</button>
            </div>
          </div>
          <div class="panel-body no-pad">
            <table class="data-table" aria-label="Products list">
              <thead>
                <tr>
                    <th scope="col">Product</th>
                    <!--
                    SCHEMA CHANGE: was "Price/kg" — now generic "Base Price"
                    because pricing_model drives what this number means:
                        catch_weight → ₱/kg  |  fixed_pack → ₱/pack  |  per_piece → ₱/piece
                    -->
                    <th scope="col">Base Price</th>
                    <!--
                    SCHEMA CHANGE: label now shows unit dynamically via JS
                    (kg / pack / piece) instead of always "/kg"
                    -->
                    <th scope="col">Pricing Model</th>
                    <th scope="col">Est. Weight</th>
                    <th scope="col">Stock</th>
                    <th scope="col">Flags</th>
                    <th scope="col">Status</th>
                    <th scope="col">Wholesale</th>
                    <th scope="col">Actions</th>
                </tr>
                </thead>
              <tbody id="products-tbody">
                <tr><td colspan="7"><div class="table-loading">Loading</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ═══════════════════════════════════════════════
           INVENTORY
      ═══════════════════════════════════════════════ -->
      <section id="view-inventory" class="admin-view" aria-label="Inventory management">
        <div class="admin-panel">
          <div class="panel-header">
            <h2 class="panel-title">Inventory Batches <small>(FIFO)</small></h2>
            <button class="btn-primary btn-sm" onclick="openAddBatchModal()">+ Add Batch</button>
          </div>
          <div class="panel-body no-pad">
            <table class="data-table" aria-label="Inventory batches">
                <thead>
                    <tr>
                        <th scope="col">Product</th>
                        <th scope="col">Batch Date</th>
                        <!--
                        SCHEMA CHANGE: batch_unit column added to product_batches.
                        Label is now generic "Received" — JS appends the unit
                        in parentheses when rendering rows (kg / pack / piece).
                        -->
                        <th scope="col">Received</th>
                        <th scope="col">Remaining</th>
                        <!--
                        SCHEMA CHANGE: new "Unit" column shows batch_unit value
                        so staff always know what "500" means in a given row.
                        -->
                        <th scope="col">Unit</th>
                        <th scope="col">Level</th>
                        <th scope="col">Added</th>
                    </tr>
                </thead>
              <tbody id="inventory-tbody">
                <tr><td colspan="7"><div class="table-loading">Loading</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ═══════════════════════════════════════════════
           USERS & STAFF
      ═══════════════════════════════════════════════ -->
      <section id="view-users" class="admin-view" aria-label="Users and staff management">
        <div class="admin-panel">
          <div class="panel-header">
            <h2 class="panel-title">Users &amp; Staff</h2>
            <div class="panel-controls">
              <div class="filter-bar" role="search" aria-label="Filter users">
                <div class="search-input-wrap">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input type="search" id="user-search" class="form-input" placeholder="Search users…"
                    oninput="loadUsers()" aria-label="Search users" />
                </div>
                <select id="user-role-filter" class="form-input" onchange="loadUsers()" aria-label="Filter by role">
                  <option value="">All Roles</option>
                  <option value="Customer">Customer</option>
                  <option value="Fulfillment Staff">Fulfillment Staff</option>
                  <option value="Delivery Rider">Delivery Rider</option>
                  <option value="Super Admin">Super Admin</option>
                </select>
                <select id="user-status-filter" class="form-input" onchange="loadUsers()" aria-label="Filter by status">
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
              <button class="btn-primary btn-sm" onclick="openUserModal()">+ Add User</button>
            </div>
          </div>
          <div class="panel-body no-pad">
            <table class="data-table" aria-label="Users list">
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Role</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Status</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody id="users-tbody">
                <tr><td colspan="7"><div class="table-loading">Loading</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ═══════════════════════════════════════════════
           PROMO CODES
      ═══════════════════════════════════════════════ -->
      <section id="view-promos" class="admin-view" aria-label="Promo codes management">
        <div class="admin-panel">
          <div class="panel-header">
            <h2 class="panel-title">Promo Codes</h2>
            <button class="btn-primary btn-sm" onclick="openPromoModal()">+ New Promo</button>
          </div>
          <div class="panel-body no-pad">
            <table class="data-table" aria-label="Promo codes list">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Discount</th>
                  <th scope="col">Min. Order</th>
                  <th scope="col">Validity</th>
                  <th scope="col">Usage</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody id="promos-tbody">
                <tr><td colspan="7"><div class="table-loading">Loading</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ═══════════════════════════════════════════════
           REPORTS
      ═══════════════════════════════════════════════ -->
      <section id="view-reports" class="admin-view" aria-label="Sales reports">

        <!-- Report controls -->
        <div class="admin-panel" style="margin-bottom:1.25rem">
          <div class="panel-header">
            <h2 class="panel-title">Sales Reports</h2>
            <div class="filter-bar">
              <label for="report-period" class="sr-only">Report period</label>
              <select id="report-period" class="form-input" onchange="loadReports(this.value)" aria-label="Report period">
                <option value="7">Last 7 days</option>
                <option value="30" selected>Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last 365 days</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Summary stats -->
        <div class="stats-grid" role="region" aria-label="Report summary">
          <div class="stat-card">
            <div class="stat-icon green" aria-hidden="true">₱</div>
            <div class="stat-info">
              <div class="stat-label">Total Revenue</div>
              <div class="stat-value" id="rep-total-rev">—</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon orange" aria-hidden="true">📋</div>
            <div class="stat-info">
              <div class="stat-label">Completed Orders</div>
              <div class="stat-value" id="rep-total-orders">—</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon purple" aria-hidden="true">🏷️</div>
            <div class="stat-info">
              <div class="stat-label">Total Discounts</div>
              <div class="stat-value" id="rep-total-disc">—</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon blue" aria-hidden="true">🛵</div>
            <div class="stat-info">
              <div class="stat-label">Delivery Fees</div>
              <div class="stat-value" id="rep-total-delivery">—</div>
            </div>
          </div>
        </div>

        <div class="dashboard-grid">
          <!-- Daily Revenue Chart -->
          <div class="admin-panel span2">
            <div class="panel-header">
              <h2 class="panel-title">Daily Revenue</h2>
            </div>
            <div id="report-chart-wrap" class="panel-body no-pad">
              <div class="table-loading">Loading chart</div>
            </div>
          </div>

          <!-- By Category -->
          <div class="admin-panel">
            <div class="panel-header">
              <h2 class="panel-title">Revenue by Category</h2>
            </div>
            <div class="panel-body" id="rep-by-cat">
              <div class="table-loading">Loading</div>
            </div>
          </div>

          <!-- Top Products -->
          <div class="admin-panel">
            <div class="panel-header">
              <h2 class="panel-title">Top Products</h2>
            </div>
            <div class="panel-body no-pad">
              <table class="data-table" aria-label="Top selling products">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Category</th>
                    <th scope="col" style="text-align:center">Orders</th>
                    <th scope="col" style="text-align:right">Qty Sold</th>
                  </tr>
                </thead>
                <tbody id="rep-top-products">
                  <tr><td colspan="4"><div class="table-loading">Loading</div></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- ═══════════════════════════════════════════════
           SETTINGS
      ═══════════════════════════════════════════════ -->
      <section id="view-settings" class="admin-view" aria-label="System settings">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem" class="settings-grid">

          <!-- Operational Hours -->
          <div class="admin-panel">
            <div class="panel-header">
              <h2 class="panel-title">Operational Hours</h2>
            </div>
            <div class="panel-body" id="settings-hours">
              <div class="table-loading">Loading</div>
            </div>
          </div>

          <!-- Delivery Zones -->
          <div class="admin-panel">
            <div class="panel-header">
              <h2 class="panel-title">Delivery Zones &amp; Fees</h2>
            </div>
            <div class="panel-body no-pad" id="settings-zones">
              <div class="table-loading">Loading</div>
            </div>
          </div>

          <!-- Time Slots -->
          <div class="admin-panel">
            <div class="panel-header">
              <h2 class="panel-title">Delivery Time Slots</h2>
            </div>
            <div class="panel-body" id="settings-slots">
              <div class="table-loading">Loading</div>
            </div>
          </div>

          <!-- Info card -->
          <div class="admin-panel">
            <div class="panel-header">
              <h2 class="panel-title">System Info</h2>
            </div>
            <div class="panel-body">
              <div style="display:flex;flex-direction:column;gap:.75rem;font-size:.875rem">
                <div style="display:flex;justify-content:space-between">
                  <span style="color:var(--text-muted)">Platform</span>
                  <strong>PoultryMart v1.0</strong>
                </div>
                <div style="display:flex;justify-content:space-between">
                  <span style="color:var(--text-muted)">Database</span>
                  <strong>MySQL (3NF)</strong>
                </div>
                <div style="display:flex;justify-content:space-between">
                  <span style="color:var(--text-muted)">Region</span>
                  <strong>Albay, Bicol, PH</strong>
                </div>
                <div style="display:flex;justify-content:space-between">
                  <span style="color:var(--text-muted)">Currency</span>
                  <strong>Philippine Peso (₱)</strong>
                </div>
                <div style="display:flex;justify-content:space-between">
                  <span style="color:var(--text-muted)">Catch-Weight</span>
                  <strong>Enabled</strong>
                </div>
              </div>
              <div style="margin-top:1.25rem;padding:1rem;background:var(--green-pale);border-radius:var(--radius-sm);font-size:.82rem;color:var(--text-muted);line-height:1.6">
                ⚙️ To modify operational hours, delivery zones, or time slots, please update the database directly or contact your system administrator.
              </div>
            </div>
          </div>

        </div>
      </section>

    </main><!-- /admin-content -->
  </div><!-- /admin-main -->
</div><!-- /admin-app -->

<!-- ═══════════════════════════════════════════════════════
     ORDER DETAIL MODAL
═══════════════════════════════════════════════════════ -->
<div id="order-detail-modal" class="admin-modal-overlay" aria-hidden="true"
  role="dialog" aria-modal="true" aria-labelledby="order-modal-title">
  <div class="admin-modal wide">
    <div class="modal-header">
      <h3 id="order-modal-title" tabindex="-1">Order Detail</h3>
      <button class="modal-close-btn" onclick="closeOrderDetail()" aria-label="Close order detail">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body" id="order-detail-body">
      <div class="table-loading">Loading order</div>
    </div>
    <div class="modal-footer" id="order-detail-footer">
      <button class="btn-outline btn-sm" onclick="closeOrderDetail()">Close</button>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════
     SIMPLE REUSABLE MODAL
═══════════════════════════════════════════════════════ -->
<div id="simple-modal" class="admin-modal-overlay" style="display:none"
  role="dialog" aria-modal="true" aria-labelledby="simple-modal-title">
  <div class="admin-modal">
    <div class="modal-header">
      <h3 id="simple-modal-title" tabindex="-1">Modal</h3>
      <button class="modal-close-btn" onclick="closeModal('simple-modal')" aria-label="Close modal">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body" id="simple-modal-body"></div>
    <div class="modal-footer">
      <button class="btn-outline btn-sm" onclick="closeModal('simple-modal')">Cancel</button>
      <button class="btn-primary" id="simple-modal-confirm">Save</button>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════
     TOAST NOTIFICATION
═══════════════════════════════════════════════════════ -->
<div id="portal-toast" class="toast" role="status" aria-live="polite" aria-atomic="true"></div>

<!-- Stacked toast container (real-time alerts) -->
<div id="portal-toast-stack" class="rider-toast-container" aria-live="polite" aria-atomic="false"
     style="position:fixed;bottom:1.25rem;right:1.25rem;display:flex;flex-direction:column;gap:.5rem;z-index:9999;max-width:360px"></div>

<!-- POD / Evidence Inline Viewer -->
<div id="pod-viewer-overlay" role="dialog" aria-modal="true" aria-label="Image viewer"
     style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:10000;
            align-items:center;justify-content:center;padding:1.5rem">
  <div style="position:relative;max-width:90vw;max-height:90vh">
    <img id="pod-viewer-img" src="" alt="Proof of delivery"
         style="max-width:100%;max-height:85vh;border-radius:var(--radius-sm);display:block" />
    <button onclick="document.getElementById('pod-viewer-overlay').style.display='none'"
            aria-label="Close image viewer"
            style="position:absolute;top:-14px;right:-14px;width:32px;height:32px;border-radius:50%;
                   background:#fff;border:none;font-size:1rem;cursor:pointer;line-height:1;
                   display:flex;align-items:center;justify-content:center">✕</button>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════
     SCRIPTS
═══════════════════════════════════════════════════════ -->
<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script><script src="js/shared/constants.js"></script>
<script src="js/shared/utils.js"></script>
<script src="js/shared/uiHelpers.js"></script>
<script src="js/shared/apiService.js"></script>
<script src="js/controllers/admin.js"></script>

<style>
/* Screen-reader only utility */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Accessible modal visibility — driven by JS openAccessibleModal / closeAccessibleModal */
.admin-modal-overlay[aria-hidden="true"] { display: none !important; }
.admin-modal-overlay.open               { display: flex !important; }

/* Urgent packing card highlight */
.packing-card--urgent {
  border-left: 4px solid var(--error, #D32F2F);
}

/* Rider toast (stack variant) */
.rider-toast {
  display: flex;
  align-items: flex-start;
  gap: .6rem;
  padding: .75rem 1rem;
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-card, #fff);
  box-shadow: 0 4px 16px rgba(0,0,0,.14);
  font-size: .875rem;
  animation: toast-in .22s ease;
}
.rider-toast.warning { border-left: 4px solid var(--warning, #F9A825); }
.rider-toast.error   { border-left: 4px solid var(--error,   #D32F2F); }
.rider-toast.success { border-left: 4px solid var(--green,   #2E7D32); }
.rider-toast.info    { border-left: 4px solid var(--blue,    #1976D2); }
.toast-msg           { flex: 1; }
.toast-close         { background: none; border: none; cursor: pointer; font-size: .9rem; color: var(--text-muted); padding: 0; line-height: 1; }
@keyframes toast-in  { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

/* Bulk action bar */
#packing-bulk-bar { border-left: 4px solid var(--green, #2E7D32); }
</style>
</body>
</html>