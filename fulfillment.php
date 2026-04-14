<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>PoultryMart — Fulfillment Staff</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <!-- Shared design tokens -->
  <link rel="stylesheet" href="/css/fulfillment-entry.css"/>
</head>
<body class="portal-body portal-body--fulfillment">

<!-- ══════════════════════════════════════════════════════════════
     LOGIN SCREEN
══════════════════════════════════════════════════════════════ -->
<div id="portal-login-screen" class="portal-login" role="main" aria-label="Staff login">
  <div class="portal-login__card">
    <header class="portal-login__brand" aria-label="PoultryMart Fulfillment Portal">
      <span class="brand-chicken" aria-hidden="true">🐓</span>
      <div>
        <div class="brand-wordmark">Poultry<strong>Mart</strong></div>
        <div class="brand-portal-label">Fulfillment Portal</div>
      </div>
    </header>
    <h1 class="portal-login__heading">Staff Sign In</h1>
    <p class="portal-login__sub">For Fulfillment Staff accounts only.</p>
    <div class="form-group">
      <label for="sf-email">Email address</label>
      <input type="email" id="sf-email" class="form-input" placeholder="staff@poultrymart.com"
        autocomplete="email" required aria-required="true"
        onkeydown="if(event.key==='Enter')document.getElementById('sf-pass').focus()"/>
    </div>
    <div class="form-group form-group--spaced">
      <label for="sf-pass">Password</label>
      <input type="password" id="sf-pass" class="form-input" placeholder="••••••••"
        autocomplete="current-password" required aria-required="true"
        onkeydown="if(event.key==='Enter')staffLogin()"/>
    </div>
    <p id="sf-login-error" class="form-error" role="alert" hidden></p>
    <button id="sf-login-btn" class="btn-primary full-width btn--mt" onclick="staffLogin()">
      Sign In
    </button>
    <p class="portal-login__hint">
      <strong>Demo:</strong> <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="364542575050764659435a42444f5b5744421855595b">[email&#160;protected]</a> / password123
    </p>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════
     STAFF APP SHELL
══════════════════════════════════════════════════════════════ -->
<div id="portal-app" hidden aria-label="Fulfillment Staff Application">

  <!-- ── SIDEBAR ──────────────────────────────────────────────── -->
  <nav id="staff-sidebar" class="portal-sidebar" aria-label="Main navigation">
    <div class="portal-sidebar__header">
      <span class="brand-chicken" aria-hidden="true">🐓</span>
      <div class="brand-wordmark">Poultry<strong>Mart</strong></div>
    </div>

    <div class="portal-user-pill" id="staff-user-pill">
      <div class="portal-avatar" id="staff-avatar-initial" aria-hidden="true">S</div>
      <div class="portal-user-info">
        <div class="portal-user-name" id="staff-user-name">Staff</div>
        <div class="portal-role-tag">Fulfillment Staff</div>
      </div>
    </div>

    <ul class="portal-nav" role="list">
      <li>
        <button class="portal-nav__btn active" data-page="queue" onclick="showPage('queue')" aria-current="page">
          <span class="portal-nav__icon"aria-hidden="true">📦</span>
          Packing Queue
          <span class="nav-badge" id="nav-badge-queue" aria-label="pending orders"></span>
        </button>
      </li>
      <li>
        <button class="portal-nav__btn" data-page="packed" onclick="showPage('packed')">
          <span class="portal-nav__icon"aria-hidden="true">✅</span>
          Assign Riders
        </button>
      </li>
      <li>
        <button class="portal-nav__btn" data-page="dispatch" onclick="showPage('dispatch')">
          <span class="portal-nav__icon"aria-hidden="true">🛵</span>
          Active Dispatch
          <span class="nav-badge nav-badge-orange" id="nav-badge-dispatch" aria-label="orders out for delivery"></span>
        </button>
      </li>
      <li>
        <button class="portal-nav__btn" data-page="all-orders" onclick="showPage('all-orders')">
          <span class="portal-nav__icon"aria-hidden="true">📋</span>
          All Orders
        </button>
      </li>
      <li>
        <button class="portal-nav__btn" data-page="inventory" onclick="showPage('inventory')">
          <span class="portal-nav__icon"aria-hidden="true">🏷️</span>
          Inventory
        </button>
      </li>
      <li>
        <button class="portal-nav__btn" data-page="returns" onclick="showPage('returns')">
          <span class="portal-nav__icon" aria-hidden="true">↩️</span>
          Returns &amp; Restock
          <span class="nav-badge nav-badge-red" id="nav-badge-returns" aria-label="failed deliveries awaiting review"></span>
        </button>
      </li>
    </ul>

    <button class="staff-signout-btn" onclick="staffLogout()">
      <span aria-hidden="true">⏻</span> Sign Out
    </button>
  </nav>

  <!-- ── MAIN CONTENT ──────────────────────────────────────────── -->
  <div class="portal-main" id="staff-main">

    <!-- Topbar -->
    <header class="staff-topbar" role="banner">
      <button class="staff-menu-btn" onclick="toggleSidebar()" aria-label="Toggle navigation menu"
        aria-controls="staff-sidebar" aria-expanded="false" id="staff-menu-btn">
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
      </button>

      <div class="staff-topbar-title" id="staff-topbar-title">
        <span aria-hidden="true">📦</span> Packing Queue
      </div>

      <!-- Scan Mode toggle -->
      <div class="topbar-scan-area" id="topbar-scan-area">
        <button class="scan-mode-btn" id="scan-mode-btn" onclick="toggleScanMode()" title="Toggle Barcode Scan Mode" aria-label="Toggle scan mode" aria-pressed="false">
          <span aria-hidden="true">🔍</span> Scan Mode
        </button>
        <input type="text" id="scan-input" class="scan-input-hidden" aria-label="Barcode scanner input"
          placeholder="Scan barcode…" autocomplete="off" oninput="handleScanInput(this.value)"/>
      </div>

      <div class="staff-topbar-actions">
        <!-- Notification Bell -->
        <button class="notif-bell-btn" id="notif-bell-btn" onclick="toggleNotifPanel()"
          aria-label="Notifications" title="Alerts">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span class="notif-bell-badge" id="notif-bell-badge" style="display:none"></span>
        </button>

        <button class="staff-refresh-btn" onclick="refreshCurrentPage()" aria-label="Refresh current view" title="Refresh">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
        </button>
        <span class="staff-topbar-clock" id="staff-clock" aria-live="polite" aria-label="Current time"></span>
      </div>
    </header>

    <!-- Notification panel -->
    <div id="notif-panel" class="notif-panel" style="display:none" role="region" aria-label="Cancellation Alerts">
      <div class="notif-panel-header">
        <strong>🔔 Cancellation Alerts</strong>
        <button onclick="dismissAllAlerts()" class="notif-dismiss-all">Mark all read</button>
      </div>
      <div id="notif-panel-body">
        <p style="color:var(--text-muted);font-size:.85rem;padding:.75rem 1rem">No recent alerts.</p>
      </div>
    </div>

    <!-- Cancellation overlay (full-screen warning) -->
    <div id="cancel-overlay" class="cancel-overlay" style="display:none" role="alertdialog"
      aria-labelledby="cancel-overlay-title" aria-live="assertive">
      <div class="cancel-overlay-inner">
        <div class="cancel-overlay-icon" aria-hidden="true">🚨</div>
        <h2 id="cancel-overlay-title">Order Cancelled!</h2>
        <p id="cancel-overlay-msg"></p>
        <button class="btn-primary" onclick="dismissCancelOverlay()">Acknowledge</button>
      </div>
    </div>

    <!-- ── PAGE: PACKING QUEUE ──────────────────────────────── -->
    <section id="page-queue" class="staff-page active" aria-label="Packing Queue" role="region">
      <div class="staff-page-header">
        <div>
          <h2>Packing Queue</h2>
          <p class="staff-page-sub">Pending orders awaiting physical weighing and packing.</p>
        </div>
        <div class="staff-filter-row" role="search">
          <label for="queue-date-filter" class="sr-only">Filter by delivery date</label>
          <input type="date" id="queue-date-filter" class="form-input staff-filter-input"
            onchange="filterQueue()" aria-label="Filter by delivery date"/>
          <label for="queue-search" class="sr-only">Search orders</label>
          <input type="text" id="queue-search" class="form-input staff-filter-input"
            placeholder="Search order #, customer…" oninput="filterQueue()" aria-label="Search orders"/>
          <!-- Bulk actions -->
          <button class="btn-outline btn-sm" id="select-all-btn" onclick="toggleSelectAll()"
            title="Select / deselect all visible orders" style="white-space:nowrap">
            ☑️ Select All
          </button>
          <button class="btn-outline btn-sm" id="prep-sheet-btn" onclick="openPrepSheetModal()"
            title="Generate daily prep sheet for selected orders" style="white-space:nowrap">
            📋 Prep Sheet
          </button>
        </div>
      </div>

      <!-- Summary bar -->
      <div class="queue-summary-bar" id="queue-summary-bar" aria-live="polite" aria-atomic="true"></div>

      <!-- Queue list -->
      <div id="queue-list" aria-label="Pending orders list" aria-live="polite"></div>
    </section>

    <!-- ── PAGE: ASSIGN RIDERS ──────────────────────────────── -->
    <section id="page-packed" class="staff-page" aria-label="Assign Riders" role="region">
      <div class="staff-page-header">
        <div>
          <h2>Assign Riders</h2>
          <p class="staff-page-sub">Packed orders ready for delivery assignment.</p>
        </div>
        <div class="staff-filter-row">
          <!-- Zone grouping toggle -->
          <button class="btn-outline btn-sm" id="zone-view-btn" onclick="toggleZoneView()"
            aria-pressed="false" style="white-space:nowrap">
            🗺️ Zone View
          </button>
          <label for="packed-search" class="sr-only">Search packed orders</label>
          <input type="text" id="packed-search" class="form-input staff-filter-input"
            placeholder="Order # or customer…" oninput="filterPacked()" aria-label="Search packed orders"/>
        </div>
      </div>
      <div id="packed-list" aria-label="Packed orders list" aria-live="polite"></div>
    </section>

    <!-- ── PAGE: ACTIVE DISPATCH ────────────────────────────── -->
    <section id="page-dispatch" class="staff-page" aria-label="Active Dispatch" role="region">
      <div class="staff-page-header">
        <div>
          <h2>Active Dispatch</h2>
          <p class="staff-page-sub">Orders currently out for delivery. Monitor and confirm completion.</p>
        </div>
        <div class="staff-filter-row">
          <label for="dispatch-search" class="sr-only">Search dispatched orders</label>
          <input type="text" id="dispatch-search" class="form-input staff-filter-input"
            placeholder="Order # or customer…" oninput="filterDispatch()" aria-label="Search dispatched orders"/>
        </div>
      </div>
      <div id="dispatch-list" aria-label="Dispatched orders" aria-live="polite"></div>
    </section>

    <!-- ── PAGE: ALL ORDERS ──────────────────────────────────── -->
    <section id="page-all-orders" class="staff-page" aria-label="All Orders" role="region">
      <div class="staff-page-header">
        <div>
          <h2>All Orders</h2>
          <p class="staff-page-sub">Full order history across all statuses.</p>
        </div>
        <div class="staff-filter-row">
          <label for="ao-status-filter" class="sr-only">Filter by status</label>
          <select id="ao-status-filter" class="form-input staff-filter-input"
            onchange="loadAllOrders()" aria-label="Filter by order status">
            <option value="">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Packed">Packed</option>
            <option value="Out for Delivery">Out for Delivery</option>
            <option value="Arrived at Location">Arrived at Location</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
          <label for="ao-search" class="sr-only">Search all orders</label>
          <input type="text" id="ao-search" class="form-input staff-filter-input"
            placeholder="Order # or customer…" oninput="loadAllOrders()" aria-label="Search all orders"/>
        </div>
      </div>
      <div class="card" style="overflow:auto">
        <table class="staff-table" id="all-orders-table" aria-label="All orders">
          <thead>
            <tr>
              <th scope="col">Order #</th>
              <th scope="col">Customer</th>
              <th scope="col">Delivery Date</th>
              <th scope="col">Time Slot</th>
              <th scope="col">Est. Total</th>
              <th scope="col">Final Total</th>
              <th scope="col">Status</th>
              <th scope="col">Payment</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody id="all-orders-tbody">
            <tr><td colspan="9" class="table-loading">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── PAGE: INVENTORY ──────────────────────────────────── -->
    <section id="page-inventory" class="staff-page" aria-label="Inventory Batches" role="region">
      <div class="staff-page-header">
        <div>
          <h2>Inventory Batches</h2>
          <p class="staff-page-sub">FIFO stock levels. Low stock items highlighted in amber.</p>
        </div>
      </div>

      <!-- Low stock alert -->
      <div id="inventory-alerts" aria-live="polite" aria-label="Low stock alerts"></div>

      <div class="card" style="overflow:auto">
        <table class="staff-table" id="inventory-table" aria-label="Inventory batches">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Category</th>
              <th scope="col">Batch #</th>
              <th scope="col">Batch Date</th>
              <th scope="col">Received (kg)</th>
              <th scope="col">Remaining (kg)</th>
              <th scope="col">Stock Level</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody id="inventory-tbody">
            <tr><td colspan="8" class="table-loading">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </section>

  <!-- ── PAGE: RETURNS & RESTOCK ──────────────────────── -->
    <section id="page-returns" class="staff-page" aria-label="Returns and Restock" role="region">
      <div class="staff-page-header">
        <div>
          <h2>Returns &amp; Restock</h2>
          <p class="staff-page-sub">Failed deliveries returned by riders. Inspect goods and restock or mark as spoiled.</p>
        </div>
        <div class="staff-filter-row">
          <label for="returns-search" class="sr-only">Search returns</label>
          <input type="text" id="returns-search" class="form-input staff-filter-input"
            placeholder="Order # or customer…" oninput="filterReturns()" aria-label="Search returned orders"/>
        </div>
      </div>
      <div id="returns-list" aria-label="Returned orders" aria-live="polite"></div>
    </section>

  </div><!-- /staff-main -->
</div><!-- /staff-app -->

<!-- ══════════════════════════════════════════════════════════════
     PACK ORDER MODAL (Enhanced with FIFO batch display)
══════════════════════════════════════════════════════════════ -->
<div id="pack-modal-overlay" class="modal-overlay" style="display:none" role="dialog"
  aria-modal="true" aria-labelledby="pack-modal-title" onclick="closePackModal(event)">
  <div class="modal-box pack-modal-box" onclick="event.stopPropagation()">
    <button class="modal-close" onclick="closePackModalDirect()" aria-label="Close packing modal">✕</button>

    <div class="pack-modal-header">
      <h2 id="pack-modal-title" class="pack-modal-heading">
        <span aria-hidden="true">⚖</span> Pack Order
      </h2>
      <div class="pack-modal-order-meta" id="pack-modal-meta"></div>
    </div>

    <!-- Customer info strip -->
    <div class="pack-customer-strip" id="pack-customer-strip"></div>

    <!-- Catch-weight items section -->
    <fieldset class="pack-items-fieldset">
      <legend class="pack-items-legend">
        Enter actual weighed weight for each catch-weight item
      </legend>
      <div id="pack-items-list" aria-label="Order items weight input"
        aria-live="polite" aria-atomic="false" aria-relevant="additions text"></div>
    </fieldset>

    <!-- Running final total -->
    <div class="pack-total-strip" aria-live="polite" aria-atomic="true" id="pack-total-strip">
      <div class="pack-total-row">
        <span>Items Subtotal</span>
        <span id="pack-items-subtotal">₱0.00</span>
      </div>
      <div class="pack-total-row">
        <span>Delivery Fee</span>
        <span id="pack-delivery-fee">₱0.00</span>
      </div>
      <div class="pack-total-row" id="pack-discount-row" style="display:none">
        <span>Discount</span>
        <span id="pack-discount-val" style="color:var(--green)">−₱0.00</span>
      </div>
      <div class="pack-total-row pack-grand-total">
        <span>Final Total</span>
        <strong id="pack-grand-total-val">₱0.00</strong>
      </div>
    </div>

    <div class="pack-modal-actions">
      <button class="btn-outline" onclick="printPackingSlip()" aria-label="Print packing slip">
        🖨 Print Slip
      </button>
      <button class="btn-outline" onclick="printItemLabels()" aria-label="Print thermal item labels">
        🏷️ Item Labels
      </button>
      <button class="btn-primary" id="pack-confirm-btn" onclick="confirmPackOrder()"
        aria-label="Confirm packing and set final total">
        ✓ Confirm Pack &amp; Set Final Total
      </button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════
     ASSIGN RIDER MODAL
══════════════════════════════════════════════════════════════ -->
<div id="assign-modal-overlay" class="modal-overlay" style="display:none" role="dialog"
  aria-modal="true" aria-labelledby="assign-modal-title" onclick="closeAssignModal(event)">
  <div class="modal-box" onclick="event.stopPropagation()" style="max-width:480px">
    <button class="modal-close" onclick="closeAssignModalDirect()" aria-label="Close">✕</button>
    <h2 id="assign-modal-title" style="margin-bottom:.5rem">🛵 Assign Rider</h2>
    <p class="staff-page-sub" id="assign-modal-order-info" style="margin-bottom:1.25rem"></p>
    <div class="form-group">
      <label for="rider-select">Select Delivery Rider</label>
      <select id="rider-select" class="form-input" aria-required="true">
        <option value="">— Choose a rider —</option>
      </select>
    </div>
    <p id="assign-error" class="form-error" role="alert" style="display:none"></p>
    <div style="display:flex;gap:.75rem;margin-top:1.25rem">
      <button class="btn-primary" onclick="confirmAssignRider()">Assign Rider</button>
      <button class="btn-outline" onclick="closeAssignModalDirect()">Cancel</button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════
     BATCH ASSIGN MODAL (zone-based, one rider → multiple orders)
══════════════════════════════════════════════════════════════ -->
<div id="batch-assign-modal-overlay" class="modal-overlay" style="display:none" role="dialog"
  aria-modal="true" aria-labelledby="batch-assign-title" onclick="closeBatchAssignModal(event)">
  <div class="modal-box" onclick="event.stopPropagation()" style="max-width:500px">
    <button class="modal-close" onclick="closeBatchAssignModal()" aria-label="Close">✕</button>
    <h2 id="batch-assign-title" style="margin-bottom:.25rem">🗺️ Batch Assign Rider</h2>
    <p id="batch-assign-subtitle" class="staff-page-sub" style="margin-bottom:1rem"></p>
    <div class="zone-assign-order-list" id="batch-assign-orders"></div>
    <div class="form-group" style="margin-top:1rem">
      <label for="batch-rider-select">Assign All to Rider</label>
      <select id="batch-rider-select" class="form-input" aria-required="true">
        <option value="">— Choose a rider —</option>
      </select>
    </div>
    <p id="batch-assign-error" class="form-error" role="alert" style="display:none"></p>
    <div style="display:flex;gap:.75rem;margin-top:1.25rem">
      <button class="btn-primary" onclick="confirmBatchAssign()">Assign All</button>
      <button class="btn-outline" onclick="closeBatchAssignModal()">Cancel</button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════
     ORDER DETAIL MODAL (read-only)
══════════════════════════════════════════════════════════════ -->
<div id="detail-modal-overlay" class="modal-overlay" style="display:none" role="dialog"
  aria-modal="true" aria-labelledby="detail-modal-title" onclick="closeDetailModal(event)">
  <div class="modal-box" onclick="event.stopPropagation()" style="max-width:640px">
    <button class="modal-close" onclick="closeDetailModalDirect()" aria-label="Close order detail">✕</button>
    <div id="detail-modal-content"></div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════
     ADJUST STOCK MODAL (spoilage / shrinkage)
══════════════════════════════════════════════════════════════ -->
<div id="adjust-stock-modal-overlay" class="modal-overlay" style="display:none" role="dialog"
  aria-modal="true" aria-labelledby="adjust-stock-title" onclick="closeAdjustStockModal(event)">
  <div class="modal-box" onclick="event.stopPropagation()" style="max-width:460px">
    <button class="modal-close" onclick="closeAdjustStockModal()" aria-label="Close">✕</button>
    <h2 id="adjust-stock-title" style="margin-bottom:.5rem">➖ Adjust Stock</h2>
    <p class="staff-page-sub" id="adjust-stock-info" style="margin-bottom:1.25rem"></p>
    <div class="form-group">
      <label>Current Stock</label>
      <input type="text" id="adjust-stock-current" class="form-input" readonly aria-readonly="true"/>
    </div>
    <div class="form-group form-group--spaced">
      <label for="adjust-stock-new">Actual Physical Stock (kg)</label>
      <input type="number" id="adjust-stock-new" class="form-input"
        min="0" step="0.001" placeholder="0.000" aria-required="true"/>
    </div>
    <div class="form-group form-group--spaced">
      <label for="adjust-reason">Reason Code</label>
      <select id="adjust-reason" class="form-input" aria-required="true">
        <option value="Shrinkage/Water Loss">Shrinkage / Water Loss</option>
        <option value="Spoilage">Spoilage</option>
        <option value="Damaged in Handling">Damaged in Handling</option>
        <option value="Count Correction">Count Correction</option>
      </select>
    </div>
    <div class="form-group form-group--spaced">
      <label for="adjust-notes">Notes (optional)</label>
      <textarea id="adjust-notes" class="form-input" rows="2" placeholder="Additional details…"></textarea>
    </div>
    <p id="adjust-stock-error" class="form-error" role="alert" style="display:none"></p>
    <div style="display:flex;gap:.75rem;margin-top:1.25rem">
      <button class="btn-primary" onclick="confirmAdjustStock()">Save Adjustment</button>
      <button class="btn-outline" onclick="closeAdjustStockModal()">Cancel</button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════
     DAILY PREP SHEET MODAL
══════════════════════════════════════════════════════════════ -->
<div id="prep-sheet-modal-overlay" class="modal-overlay" style="display:none" role="dialog"
  aria-modal="true" aria-labelledby="prep-sheet-title" onclick="closePrepSheetModal(event)">
  <div class="modal-box" onclick="event.stopPropagation()" style="max-width:620px">
    <button class="modal-close" onclick="closePrepSheetModal()" aria-label="Close">✕</button>
    <h2 id="prep-sheet-title" style="margin-bottom:.25rem">📋 Daily Prep Sheet</h2>
    <p class="staff-page-sub" id="prep-sheet-subtitle" style="margin-bottom:1rem">
      Aggregate quantities needed from cold storage.
    </p>
    <div id="prep-sheet-content"></div>
    <div style="display:flex;gap:.75rem;margin-top:1.25rem;justify-content:flex-end">
      <button class="btn-outline" onclick="printPrepSheet()">🖨 Print Sheet</button>
      <button class="btn-primary" onclick="closePrepSheetModal()">Close</button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════
     PROOF OF DELIVERY MODAL
══════════════════════════════════════════════════════════════ -->
<div id="pod-modal-overlay" class="modal-overlay" style="display:none" role="dialog"
  aria-modal="true" aria-labelledby="pod-modal-title" onclick="closePodModal(event)">
  <div class="modal-box" onclick="event.stopPropagation()" style="max-width:520px;text-align:center">
    <button class="modal-close" onclick="closePodModal()" aria-label="Close">✕</button>
    <h2 id="pod-modal-title" style="margin-bottom:1rem">📸 Proof of Delivery</h2>
    <img id="pod-modal-img" src="" alt="Proof of delivery photo"
      style="max-width:100%;border-radius:var(--radius-md);border:1px solid var(--border)"/>
    <p id="pod-modal-caption" style="margin-top:.75rem;color:var(--text-muted);font-size:.85rem"></p>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════
     DISPATCH CONFIRM MODAL
══════════════════════════════════════════════════════════════ -->
<div id="dispatch-confirm-overlay" class="modal-overlay" style="display:none" role="dialog"
  aria-modal="true" aria-labelledby="dispatch-confirm-title" onclick="closeDispatchConfirm(event)">
  <div class="modal-box" onclick="event.stopPropagation()" style="max-width:420px;text-align:center">
    <button class="modal-close" onclick="closeDispatchConfirm()" aria-label="Close">✕</button>
    <div style="font-size:2rem;margin-bottom:.5rem">🛵</div>
    <h2 id="dispatch-confirm-title" style="margin-bottom:.5rem">Dispatch Order?</h2>
    <p id="dispatch-confirm-msg" class="staff-page-sub" style="margin-bottom:1.25rem"></p>
    <div style="display:flex;gap:.75rem;justify-content:center">
      <button class="btn-primary" id="dispatch-confirm-btn">Dispatch Now</button>
      <button class="btn-outline" onclick="closeDispatchConfirm()">Cancel</button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════════
     PRINT PACKING SLIP (hidden, revealed on print)
══════════════════════════════════════════════════════════════ -->
<div id="print-slip" class="print-only" aria-hidden="true"></div>

<!-- ══════════════════════════════════════════════════════════════
     THERMAL LABEL PRINT AREA
══════════════════════════════════════════════════════════════ -->
<div id="thermal-labels" class="print-only thermal-labels-area" aria-hidden="true"></div>

<!-- ══════════════════════════════════════════════════════════════
     PREP SHEET PRINT AREA
══════════════════════════════════════════════════════════════ -->
<div id="prep-sheet-print" class="print-only" aria-hidden="true"></div>

<!-- ══════════════════════════════════════════════════════════════
     TOAST NOTIFICATION
══════════════════════════════════════════════════════════════ -->
<div id="staff-toast" class="toast" role="status" aria-live="polite" aria-atomic="true"></div>

<!-- Scripts -->
<script src="js/shared/constants.js"></script>
<script src="js/shared/utils.js"></script>
<script src="js/shared/uiHelpers.js"></script>
<script src="js/shared/apiService.js"></script>
<script src="js/controllers/fulfillment.js"></script>

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
</style>
</body>
</html>