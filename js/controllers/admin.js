/**
 * admin.js — Admin Portal Controller
 *
 * Depends on (must be loaded first):
 *   shared/constants.js
 *   shared/utils.js
 *   shared/uiHelpers.js
 *   shared/apiService.js
 *
 * Responsibilities:
 *   • Owns adminState (session / cached data only)
 *   • Calls apiGet / apiPost from apiService
 *   • Delegates all formatting to utils.js
 *   • Delegates all UI (toast, modal, pagination) to uiHelpers.js
 *   • Contains ZERO raw SQL / fetch() calls
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════*/

const adminState = {
  user:            null,
  currentView:     'dashboard',
  orders:          [],
  products:        [],
  categories:      [],
  users:           [],
  inventory:       [],
  promos:          [],
  riders:          [],
  reportData:      null,
  pendingBadge:    0,
  pollCancelTimer: null,
  pollNotifTimer:  null,
  barcodeMode:     false,
  bulkSelected:    new Set(),
  wholesaleTiers:  {},
  _modalCleanup:   {},
};

/* ════════════════════════════════════════════════════════════
   API SERVICE  (bound to this portal)
═══════════════════════════════════════════════════════════════*/

const ADMIN_API = 'api/admin_api.php';

const { apiGet, apiPost } = createApiService({
  baseUrl:     ADMIN_API,
  callerKey:   'admin_id',
  getCallerId: () => adminState.user?.user_id ?? 0,
});

/* ── Toast shorthand ────────────────────────────────────────── */
const toast = (msg, type = '') => showToast(msg, type, 'portal-toast');

/* ════════════════════════════════════════════════════════════
   REAL-TIME POLLING  (cancellations + notifications)
═══════════════════════════════════════════════════════════════*/

function startAdminPolling() {
  if (adminState.pollCancelTimer) return;

  async function pollCancellations() {
    if (!adminState.user) return;
    const data = await apiGet('recent_cancellations');
    if (!data.success || !data.data?.length) return;
    data.data.forEach(o => {
      showToastStack(
        `⚠️ Order ${escHtml(o.order_number)} was cancelled by customer.`,
        'warning', 'portal-toast-stack'
      );
    });
    if (['orders','packing','delivery'].includes(adminState.currentView)) {
      const loaders = { orders: loadOrders, packing: loadPacking, delivery: loadDelivery };
      loaders[adminState.currentView]?.();
    }
  }

  async function pollNotifications() {
    if (!adminState.user) return;
    const data = await apiGet('admin_notifications');
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    const count = data.success ? (data.data?.length ?? 0) : 0;
    badge.textContent    = count || '';
    badge.style.display  = count > 0 ? 'block' : 'none';
  }

  pollCancellations();
  pollNotifications();
  adminState.pollCancelTimer = setInterval(pollCancellations, POLL_INTERVAL_MS);
  adminState.pollNotifTimer  = setInterval(pollNotifications, POLL_INTERVAL_MS);
}

function stopAdminPolling() {
  clearInterval(adminState.pollCancelTimer);
  clearInterval(adminState.pollNotifTimer);
  adminState.pollCancelTimer = null;
  adminState.pollNotifTimer  = null;
}

/* ════════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════════*/

function adminNavigate(view) {
  adminState.currentView = view;

  document.querySelectorAll('.sidebar-link, .portal-nav__btn[data-view]').forEach(l => {
    l.classList.toggle('active', l.dataset.view === view);
  });
  document.querySelectorAll('.admin-view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${view}`);
  });

  const titles = {
    dashboard: ['Dashboard',     'Welcome back, ' + (adminState.user?.first_name || 'Admin')],
    orders:    ['Orders',        'Manage and track all orders'],
    packing:   ['Packing Queue', 'Weigh items and set final totals'],
    delivery:  ['Delivery',      'Assign riders and track deliveries'],
    products:  ['Products',      'Manage product catalog'],
    inventory: ['Inventory',     'Track stock batches (FIFO)'],
    users:     ['Users & Staff', 'Manage customers and staff accounts'],
    promos:    ['Promo Codes',   'Create and manage discount vouchers'],
    reports:   ['Reports',       'Sales analytics and performance'],
    settings:  ['Settings',      'Operational hours, zones, and time slots'],
  };
  const [title, sub] = titles[view] || ['Admin', ''];
  document.getElementById('topbar-title').innerHTML =
    `${escHtml(title)}<small>${escHtml(sub)}</small>`;

  closeSidebarUI('portal-sidebar', 'portal-sidebar-overlay');

  const loaders = {
    dashboard: loadDashboard,
    orders:    loadOrders,
    packing:   loadPacking,
    delivery:  loadDelivery,
    products:  loadProducts,
    inventory: loadInventory,
    users:     loadUsers,
    promos:    loadPromos,
    reports:   loadReports,
    settings:  loadSettings,
  };
  loaders[view]?.();
}

function toggleSidebar() { toggleSidebarUI('portal-sidebar', 'portal-sidebar-overlay'); }
function closeSidebar()   { closeSidebarUI('portal-sidebar', 'portal-sidebar-overlay'); }

/* ════════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════════*/

async function adminLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const btn   = document.getElementById('login-btn');
  const err   = document.getElementById('login-error');

  err.textContent = '';
  btn.disabled    = true;
  btn.textContent = 'Signing in…';

  const data = await loginFetch(ADMIN_API, email, pass);

  btn.disabled    = false;
  btn.textContent = 'Sign In';

  if (!data.success) { err.textContent = data.message; return; }

  const allowedRoles = ['Super Admin', 'Fulfillment Staff', 'Delivery Rider'];
  if (!allowedRoles.includes(data.user.role_name)) {
    err.textContent = 'Access denied. Admin accounts only.';
    return;
  }

  adminState.user = data.user;
  document.getElementById('login-screen').hidden = true;
  document.getElementById('portal-app').hidden   = false;

  document.getElementById('sb-user-name').textContent =
    `${data.user.first_name} ${data.user.last_name}`;
  document.getElementById('sb-user-role').textContent = data.user.role_name;
  document.getElementById('sb-avatar').textContent =
    (data.user.first_name[0] + data.user.last_name[0]).toUpperCase();

  applyRoleRestrictions(data.user.role_name);
  startAdminPolling();
  adminNavigate('dashboard');
}

function applyRoleRestrictions(role) {
  const allViews = ['dashboard','orders','packing','delivery','products','inventory','users','promos','reports','settings'];
  const roleMap  = {
    'Super Admin':       allViews,
    'Fulfillment Staff': ['dashboard','orders','packing','inventory'],
    'Delivery Rider':    ['delivery'],
  };
  const allowed = roleMap[role] || ['dashboard'];
  document.querySelectorAll('.sidebar-link[data-view], .portal-nav__btn[data-view]').forEach(link => {
    link.style.display = allowed.includes(link.dataset.view) ? '' : 'none';
  });
  if (role === 'Delivery Rider') adminNavigate('delivery');
}

function adminLogout() {
  stopAdminPolling();
  adminState.user = null;
  document.getElementById('login-screen').hidden = false;
  document.getElementById('portal-app').hidden   = true;
  document.getElementById('login-email').value = '';
  document.getElementById('login-pass').value  = '';
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════*/

async function loadDashboard() {
  const data = await apiGet('dashboard');
  if (!data.success) { toast(data.message, 'error'); return; }

  const { stats, recent_orders, weekly_revenue, low_stock, status_dist } = data.data;

  document.getElementById('stat-revenue').textContent   = fmtPrice(stats.revenue);
  document.getElementById('stat-orders').textContent    = stats.total_orders;
  document.getElementById('stat-pending').textContent   = stats.pending;
  document.getElementById('stat-products').textContent  = stats.products;
  document.getElementById('stat-customers').textContent = stats.customers;
  document.getElementById('stat-today-rev').textContent = fmtPrice(stats.today_revenue);
  document.getElementById('stat-today-ord').textContent = stats.today_orders + ' today';

  const badge = document.getElementById('pending-badge');
  if (badge) badge.textContent = stats.pending;
  adminState.pendingBadge = stats.pending;

  // Recent orders table
  const tbody = document.getElementById('dash-recent-orders');
  tbody.innerHTML = recent_orders.length === 0
    ? '<tr><td colspan="6" class="table-empty"><span>📋</span>No orders yet</td></tr>'
    : recent_orders.map(o => `
      <tr style="cursor:pointer" onclick="openOrderDetail(${o.order_id})">
        <td><strong>${escHtml(o.order_number)}</strong></td>
        <td>${escHtml(o.first_name)} ${escHtml(o.last_name)}</td>
        <td>${statusBadge(o.status)}</td>
        <td>${escHtml(o.payment_method)}</td>
        <td>${fmtPrice(o.final_total || o.estimated_total)}</td>
        <td>${fmtDateTime(o.created_at)}</td>
      </tr>`).join('');

  renderWeeklyChart(weekly_revenue);
  renderLowStock(low_stock);
  renderStatusDist(status_dist);
}

function renderWeeklyChart(weekly) {
  const el = document.getElementById('dash-weekly-chart');
  if (!el) return;
  if (!weekly.length) {
    el.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:1rem">No data yet</p>';
    return;
  }
  const max = Math.max(...weekly.map(w => parseFloat(w.rev)), 1);
  el.innerHTML = `<div class="report-bar-chart" style="height:120px;padding:0 1.5rem 0.5rem">
    ${weekly.map(w => {
      const pct = Math.max(4, (parseFloat(w.rev) / max) * 100);
      return `<div class="report-bar-wrap">
        <div class="report-bar-val">${parseFloat(w.rev) > 0 ? fmtPrice(w.rev) : ''}</div>
        <div class="report-bar" style="height:${pct}%" title="${w.d}: ${fmtPrice(w.rev)}"></div>
        <div class="report-bar-label">${w.d.slice(5)}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderLowStock(low_stock) {
  const el = document.getElementById('dash-low-stock');
  if (!el) return;
  el.innerHTML = low_stock.length === 0
    ? '<div class="table-empty"><span>✅</span><p>All stock levels OK</p></div>'
    : low_stock.map(i => `
      <div class="low-stock-item">
        <span style="font-size:1.2rem">${productIcon(i.name)}</span>
        <span class="low-stock-name">${escHtml(i.name)}</span>
        <span class="low-stock-qty">
          ${parseFloat(i.total_remaining).toFixed(2)}
          ${i.unit_of_measure ? unitLabel(i.unit_of_measure) : 'kg'} left
        </span>
      </div>`).join('');
}

function renderStatusDist(dist) {
  const el = document.getElementById('dash-status-dist');
  if (!el) return;
  const total  = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
  const colors = {
    'Pending':'#F9A825','Packed':'#1976D2','Out for Delivery':'#F57C00',
    'Arrived at Location':'#3949AB','Completed':'#2E7D32','Cancelled':'#D32F2F',
  };
  el.innerHTML = Object.entries(dist).map(([s, n]) => `
    <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.5rem;font-size:.85rem">
      <span style="width:10px;height:10px;border-radius:2px;background:${colors[s]||'#ccc'};flex-shrink:0;display:inline-block"></span>
      <span style="flex:1">${escHtml(s)}</span>
      <strong>${n}</strong>
      <span style="color:var(--text-muted);min-width:40px;text-align:right">${Math.round(n/total*100)}%</span>
    </div>
    <div style="background:var(--border);border-radius:999px;height:6px;margin-bottom:.75rem">
      <div style="background:${colors[s]||'#ccc'};width:${Math.round(n/total*100)}%;height:100%;border-radius:999px"></div>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════
   ORDERS
═══════════════════════════════════════════════════════════════*/

let ordersFilter = { status: '', search: '', page: 1 };

async function loadOrders() {
  setLoading('orders-tbody', 'Loading orders…');
  const data = await apiGet('orders', {
    status: ordersFilter.status,
    search: ordersFilter.search,
    page:   ordersFilter.page,
  });
  if (!data.success) { toast(data.message, 'error'); return; }

  adminState.orders = data.data;
  renderOrdersTable(data.data, data.total, data.pages);
}

function renderOrdersTable(orders, total, pages) {
  const tbody = document.getElementById('orders-tbody');
  tbody.innerHTML = orders.length === 0
    ? `<tr><td colspan="8"><div class="table-empty"><span>📋</span><p>No orders found</p></div></td></tr>`
    : orders.map(o => `
      <tr style="cursor:pointer" onclick="openOrderDetail(${o.order_id})">
        <td><strong style="font-family:'Playfair Display',serif">${escHtml(o.order_number)}</strong></td>
        <td>${escHtml(o.first_name)} ${escHtml(o.last_name)}<br>
            <small style="color:var(--text-muted)">${escHtml(o.email)}</small></td>
        <td>${statusBadge(o.status)}</td>
        <td>${fmtDate(o.delivery_date)}</td>
        <td>${escHtml(o.payment_method)}</td>
        <td>${fmtPrice(o.final_total || o.estimated_total)}</td>
        <td><span class="badge ${o.pay_status === 'Paid' ? 'badge-paid' : 'badge-unpaid'}">${o.pay_status || 'Unpaid'}</span></td>
        <td>${fmtDateTime(o.created_at)}</td>
      </tr>`).join('');

  renderPagination('orders-pagination', ordersFilter.page, pages, (p) => {
    ordersFilter.page = p;
    loadOrders();
  });
}

function filterOrders() {
  ordersFilter.status = document.getElementById('order-status-filter').value;
  ordersFilter.search = document.getElementById('order-search').value.trim();
  ordersFilter.page   = 1;
  loadOrders();
}

async function openOrderDetail(orderId) {
  const body = document.getElementById('order-detail-body');
  body.innerHTML = '<div class="table-loading">Loading order details</div>';
  const _cleanup = openAccessibleModal('order-detail-modal', 'order-modal-title');
  adminState._modalCleanup['order-detail-modal'] = _cleanup;

  const data = await apiGet('order', { id: orderId });
  if (!data.success) {
    body.innerHTML = `<p style="color:var(--error)">${escHtml(data.message)}</p>`;
    return;
  }

  const o       = data.data;
  const stepIdx = STATUS_FLOW.indexOf(o.status);

  const itemsTable = (items) => `
    <table class="data-table" style="margin-bottom:1rem">
      <thead><tr>
        <th>Product</th><th>Qty</th><th>Unit Price</th>
        <th>Model</th><th>Est. Weight</th><th>Actual Weight</th><th>Subtotal</th>
      </tr></thead>
      <tbody>${items.map(item => {
        const unitPriceLabel = fmtPrice(item.unit_price) +
          `<small style="color:var(--text-muted)">/${unitLabel(item.unit_of_measure || 'kg')}</small>`;
        const actualWeightCell = item.pricing_model === 'catch_weight'
          ? (item.actual_weight
              ? `${item.actual_weight} kg`
              : '<em style="color:var(--text-muted)">Pending</em>')
          : '<span style="color:var(--text-muted);font-size:.78rem">N/A</span>';
        return `<tr>
          <td><strong>${escHtml(item.name)}</strong></td>
          <td>${item.quantity}</td>
          <td>${unitPriceLabel}</td>
          <td><span class="badge ${pricingModelBadgeClass(item.pricing_model)}" style="font-size:.65rem">
            ${pricingModelLabel(item.pricing_model)}</span></td>
          <td>${item.estimated_weight} kg</td>
          <td>${actualWeightCell}</td>
          <td>${fmtPrice(item.final_subtotal || item.estimated_subtotal)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;

  body.innerHTML = `
    <div class="order-stepper">
      ${STATUS_FLOW.filter(s => s !== 'Cancelled').map((s, i) => {
        const done   = stepIdx > i && o.status !== 'Cancelled';
        const active = s === o.status;
        return `<div class="step-item ${done?'done':''} ${active?'active':''}">
          <div class="step-dot">${done ? '✓' : i+1}</div>
          <span class="step-label">${s}</span>
        </div>`;
      }).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem">
      <div>
        <p class="form-section-divider">Customer</p>
        <p><strong>${escHtml(o.first_name)} ${escHtml(o.last_name)}</strong></p>
        <p style="font-size:.85rem;color:var(--text-muted)">${escHtml(o.email)}</p>
        <p style="font-size:.85rem;color:var(--text-muted)">${escHtml(o.phone||'—')}</p>
      </div>
      <div>
        <p class="form-section-divider">Delivery</p>
        <p style="font-size:.875rem">${escHtml(o.street)}, ${escHtml(o.barangay)}, ${escHtml(o.city)}, ${escHtml(o.province)}</p>
        <p style="font-size:.82rem;color:var(--text-muted)">${escHtml(o.slot_label||'—')} · ${fmtDate(o.delivery_date)}</p>
        ${o.special_instructions ? `<p style="font-size:.82rem;color:var(--orange);margin-top:.3rem">📝 ${escHtml(o.special_instructions)}</p>` : ''}
      </div>
    </div>

    <p class="form-section-divider">Order Items</p>
    ${itemsTable(o.items)}

    <div style="display:flex;justify-content:flex-end;gap:2rem;font-size:.9rem;border-top:1px solid var(--border);padding-top:1rem">
      <span>Delivery Fee: <strong>${fmtPrice(o.delivery_fee)}</strong></span>
      <span>Discount: <strong style="color:var(--error)">-${fmtPrice(o.discount_amount)}</strong></span>
      <span>Est. Total: <strong>${fmtPrice(o.estimated_total)}</strong></span>
      ${o.final_total ? `<span>Final Total: <strong style="color:var(--green);font-size:1.05rem">${fmtPrice(o.final_total)}</strong></span>` : ''}
    </div>

    ${o.pay_status ? `
    <div style="display:flex;align-items:center;gap:1rem;margin-top:1rem;padding:.75rem 1rem;background:var(--bg-alt);border-radius:var(--radius-sm)">
      <span>Payment: <span class="badge ${o.pay_status==='Paid'?'badge-paid':'badge-unpaid'}">${o.pay_status}</span></span>
      <span style="font-size:.82rem;color:var(--text-muted)">${escHtml(o.payment_method)}</span>
      ${o.pay_status !== 'Paid' ? `<button class="btn-primary btn-sm" onclick="verifyPayment(${o.order_id})">Mark Paid</button>` : ''}
    </div>` : ''}

    ${o.rider_first ? `
    <div style="margin-top:.75rem;font-size:.875rem;color:var(--text-muted)">
      🛵 Rider: <strong>${escHtml(o.rider_first)} ${escHtml(o.rider_last)}</strong>
      · Delivery Status: ${statusBadge(o.delivery_status)}
    </div>
    ${o.proof_of_delivery_url ? `
    <div style="margin-top:.75rem">
      <p class="form-section-divider">Proof of Delivery</p>
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;max-width:420px">
        <img src="${escHtml(o.proof_of_delivery_url)}"
             alt="Proof of delivery photo"
             style="width:100%;display:block;cursor:zoom-in"
             onclick="openPodViewer('${escHtml(o.proof_of_delivery_url)}')"
             onerror="this.parentElement.innerHTML='<p style=padding:.75rem;color:var(--text-muted)>POD image unavailable. <a href=${escHtml(o.proof_of_delivery_url)} target=_blank>Open link</a></p>'"
        />
      </div>
    </div>` : ''}` : ''}

    ${o.dispute ? `
    <p class="form-section-divider">⚖️ Customer Dispute</p>
    <div style="background:var(--error-pale,#fff5f5);border:1px solid var(--error);border-radius:var(--radius-sm);padding:.875rem 1rem;font-size:.875rem">
      <div style="font-weight:600;margin-bottom:.35rem">${escHtml(o.dispute.reason)}</div>
      <div style="color:var(--text-muted);margin-bottom:.5rem">${fmtDateTime(o.dispute.created_at)}</div>
      ${o.dispute.evidence_url ? `
      <img src="${escHtml(o.dispute.evidence_url)}"
           alt="Dispute evidence"
           style="max-width:100%;max-height:180px;border-radius:4px;cursor:zoom-in;margin-top:.35rem"
           onclick="openPodViewer('${escHtml(o.dispute.evidence_url)}')"
      />` : ''}
      ${!['resolved','Completed','Cancelled'].includes(o.dispute.status||'') ? `
      <div style="margin-top:.65rem;display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn-primary btn-sm" onclick="resolveDispute(${o.order_id},${o.dispute.dispute_id},'resolved')">✔ Mark Resolved</button>
        <button class="btn-danger  btn-sm" onclick="resolveDispute(${o.order_id},${o.dispute.dispute_id},'rejected')">✖ Reject Claim</button>
      </div>` : `<span style="margin-top:.5rem;display:block;font-weight:600;color:var(--green)">${escHtml(o.dispute.status)}</span>`}
    </div>` : ''}

    ${o.reviews?.length ? `
    <p class="form-section-divider">⭐ Customer Reviews</p>
    ${o.reviews.map(rv => `
    <div style="background:var(--bg-alt);border-radius:var(--radius-sm);padding:.75rem 1rem;margin-bottom:.5rem;font-size:.875rem">
      <div style="display:flex;justify-content:space-between;margin-bottom:.25rem">
        <strong>${escHtml(rv.product_name)}</strong>
        <span>${starsHTML(rv.rating)}</span>
      </div>
      ${rv.comment ? `<p style="color:var(--text-muted);margin:0">${escHtml(rv.comment)}</p>` : ''}
      ${rv.is_hidden ? `<span style="font-size:.72rem;color:var(--error)">Hidden from public</span>` : ''}
      <button class="btn-outline btn-sm" style="margin-top:.4rem"
        onclick="toggleReviewVisibility(${rv.review_id},${rv.is_hidden?0:1})">
        ${rv.is_hidden ? 'Unhide Review' : 'Hide Review'}
      </button>
    </div>`).join('')}` : ''}`;

  // Footer actions
  const footer  = document.getElementById('order-detail-footer');
  const actions = [];
  const isSuperAdmin = adminState.user?.role_name === 'Super Admin';

  if (!['Completed','Cancelled'].includes(o.status))
    actions.push(`<button class="btn-danger" onclick="adminCancelOrder(${o.order_id})">Cancel Order</button>`);
  if (o.status === 'Pending')
    actions.push(`<button class="btn-primary btn-sm" onclick="closeOrderDetail();adminNavigate('packing')">Go to Packing</button>`);
  if (o.status === 'Packed' && !o.rider_id)
    actions.push(`<button class="btn-primary btn-sm" onclick="openAssignRider(${o.order_id})">Assign Rider</button>`);

  // Undo Status (Super Admin, non-terminal)
  const curIdx = STATUS_FLOW.indexOf(o.status);
  if (isSuperAdmin && curIdx > 0 && !['Completed','Cancelled'].includes(o.status)) {
    const prevStatus = STATUS_FLOW[curIdx - 1];
    actions.push(`<button class="btn-outline btn-sm" style="color:var(--warning);border-color:var(--warning)"
      onclick="undoOrderStatus(${o.order_id},'${escHtml(prevStatus)}')">↩ Undo to ${escHtml(prevStatus)}</button>`);
  }

  if (!['Completed','Cancelled'].includes(o.status)) {
    const nextStatuses = STATUS_FLOW.filter(s => STATUS_FLOW.indexOf(s) > STATUS_FLOW.indexOf(o.status) && s !== 'Cancelled');
    if (nextStatuses.length) {
      actions.push(`<select class="action-select" id="order-status-sel">
        <option value="">Update Status…</option>
        ${nextStatuses.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('')}
      </select>
      <button class="btn-primary btn-sm" onclick="updateOrderStatus(${o.order_id})">Apply</button>`);
    }
  }

  // Super Admin: edit order items / promo / schedule
  if (isSuperAdmin && !['Completed','Cancelled'].includes(o.status)) {
    actions.push(`<button class="btn-outline btn-sm" onclick="openOrderEditModal(${o.order_id})">✏️ Edit Order</button>`);
  }

  footer.innerHTML = `<button class="btn-outline btn-sm" onclick="closeOrderDetail()">Close</button>` + actions.join('');
}

async function updateOrderStatus(orderId) {
  const sel = document.getElementById('order-status-sel');
  if (!sel?.value) return;
  const data = await apiPost('update_order', { order_id: orderId, status: sel.value });
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) { closeOrderDetail(); loadOrders(); }
}

async function verifyPayment(orderId) {
  const data = await apiPost('verify_payment', { order_id: orderId });
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) openOrderDetail(orderId);
}

function closeOrderDetail() {
  closeAccessibleModal(
    'order-detail-modal',
    document.activeElement,
    adminState._modalCleanup['order-detail-modal']
  );
}

async function undoOrderStatus(orderId, prevStatus) {
  if (!confirm(`Revert this order to "${prevStatus}"? Use only to correct a mistake.`)) return;
  const data = await apiPost('update_order', { order_id: orderId, status: prevStatus });
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) openOrderDetail(orderId);
}

async function resolveDispute(orderId, disputeId, resolution) {
  const data = await apiPost('resolve_dispute', { order_id: orderId, dispute_id: disputeId, resolution });
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) openOrderDetail(orderId);
}

async function toggleReviewVisibility(reviewId, hide) {
  const data = await apiPost('toggle_review', { review_id: reviewId, is_hidden: hide });
  toast(data.message, data.success ? 'success' : 'error');
}

function openPodViewer(url) {
  const overlay = document.getElementById('pod-viewer-overlay');
  const img     = document.getElementById('pod-viewer-img');
  if (!overlay || !img) return;
  img.src = url;
  overlay.style.display = 'flex';
}

async function openOrderEditModal(orderId) {
  const data = await apiGet('order', { id: orderId });
  if (!data.success) { toast(data.message, 'error'); return; }
  const o = data.data;

  const slotsData = await apiGet('settings');
  const slots     = slotsData.success ? slotsData.data.slots : [];
  const slotOpts  = slots.map(s =>
    `<option value="${s.slot_id}" ${o.slot_id == s.slot_id ? 'selected' : ''}>${escHtml(s.slot_label)}</option>`
  ).join('');

  const itemRows = o.items.map(item => `
    <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.5rem">
      <span style="flex:1;font-size:.875rem"><strong>${escHtml(item.name)}</strong>
        <small style="color:var(--text-muted)"> ${fmtPrice(item.unit_price)}/${unitLabel(item.unit_of_measure||'kg')}</small>
      </span>
      <input type="number" class="form-input" style="width:80px"
             id="edit-qty-${item.order_item_id}"
             value="${item.quantity}" min="0" step="1"
             data-item-id="${item.order_item_id}" />
    </div>`).join('');

  openSimpleModal('✏️ Edit Order (Admin Override)', `
    <p class="form-section-divider">Item Quantities</p>
    ${itemRows}
    <p class="form-section-divider" style="margin-top:1rem">Promo Code</p>
    <div class="form-row">
      <div class="form-field">
        <input class="form-input" id="edit-promo" placeholder="Promo code or leave blank"
               value="${escHtml(o.promo_code||'')}">
      </div>
    </div>
    <p class="form-section-divider">Reschedule Delivery</p>
    <div class="form-row">
      <div class="form-field">
        <label>Date</label>
        <input class="form-input" type="date" id="edit-date" value="${o.delivery_date||''}">
      </div>
      <div class="form-field">
        <label>Time Slot</label>
        <select class="form-input" id="edit-slot">${slotOpts}</select>
      </div>
    </div>`,
    async () => {
      const items = o.items.map(item => ({
        order_item_id: item.order_item_id,
        quantity:      parseInt(document.getElementById(`edit-qty-${item.order_item_id}`)?.value) || 0,
      }));
      const payload = {
        order_id:      orderId,
        items,
        promo_code:    document.getElementById('edit-promo').value.trim() || null,
        delivery_date: document.getElementById('edit-date').value || null,
        slot_id:       parseInt(document.getElementById('edit-slot').value) || null,
      };
      const res = await apiPost('admin_edit_order', payload);
      toast(res.message, res.success ? 'success' : 'error');
      if (res.success) { closeModal('simple-modal'); openOrderDetail(orderId); }
    }, 'Save Override'
  );
}

async function adminCancelOrder(orderId) {
  const reason = prompt('Reason for cancellation (optional):') || 'Admin cancellation';
  if (reason === null) return;
  const data = await apiPost('cancel_order', { order_id: orderId, reason });
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) { closeOrderDetail(); loadOrders(); }
}

async function openAssignRider(orderId) {
  if (!adminState.riders.length) {
    const d = await apiGet('riders');
    if (d.success) adminState.riders = d.data;
  }
  const ridersHtml = adminState.riders.length
    ? adminState.riders.map(r =>
        `<option value="${r.user_id}">${escHtml(r.first_name)} ${escHtml(r.last_name)}${r.zone ? ' — ' + escHtml(r.zone) : ''}</option>`
      ).join('')
    : '<option disabled>No riders available</option>';

  openSimpleModal('Assign Delivery Rider', `
    <div class="form-field">
      <label for="rider-sel">Select Rider</label>
      <select class="form-input" id="rider-sel">${ridersHtml}</select>
    </div>`,
    async () => {
      const rid = parseInt(document.getElementById('rider-sel').value);
      if (!rid) return;
      const data = await apiPost('assign_rider', { order_id: orderId, rider_id: rid });
      toast(data.message, data.success ? 'success' : 'error');
      if (data.success) {
        const _c = adminState._modalCleanup['simple-modal'];
        closeAccessibleModal('simple-modal', null, _c);
      }
    }
  );
  const _cleanup = openAccessibleModal('simple-modal', 'simple-modal-title');
  adminState._modalCleanup['simple-modal'] = _cleanup;
}

/* ════════════════════════════════════════════════════════════
   PACKING QUEUE
═══════════════════════════════════════════════════════════════*/

async function loadPacking() {
  adminState.bulkSelected.clear();
  setLoading('packing-list', 'Loading packing queue…');
  const data = await apiGet('orders', { status: 'Pending', page: 1 });
  if (!data.success) { toast(data.message, 'error'); return; }

  const el = document.getElementById('packing-list');
  if (!data.data.length) {
    el.innerHTML = `<div class="table-empty"><span>✅</span><p>No pending orders to pack!</p></div>`;
    renderBulkBar();
    return;
  }

  el.innerHTML = data.data.map(o => {
    const urgency = deliveryLabel(o.delivery_date);
    const urgentCls = isUrgent(o.delivery_date) ? 'packing-card--urgent' : '';
    return `
    <div class="packing-card ${urgentCls}" id="pack-card-${o.order_id}">
      <div class="packing-card-header">
        <div style="display:flex;align-items:flex-start;gap:.6rem">
          <input type="checkbox" class="bulk-check" aria-label="Select order ${escHtml(o.order_number)}"
                 onchange="toggleBulkSelect(${o.order_id},this.checked)">
          <div>
            <div class="packing-order-num">${escHtml(o.order_number)}</div>
            <div class="packing-meta">
              ${escHtml(o.first_name)} ${escHtml(o.last_name)}
              <span style="margin-left:.5rem">${urgency}</span>
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
          ${statusBadge(o.status)}
          <button class="btn-outline btn-sm" onclick="printPackingSlip(${o.order_id})" title="Print Packing Slip">🖨 Slip</button>
          <button class="btn-outline btn-sm" onclick="printThermalLabel(${o.order_id})" title="Print Thermal Label">🏷 Label</button>
          <button class="btn-primary btn-sm" onclick="loadPackingItems(${o.order_id})">Load Items</button>
        </div>
      </div>
      <div class="packing-card-body" id="pack-items-${o.order_id}">
        <p style="color:var(--text-muted);font-size:.875rem">Click "Load Items" to begin packing this order.</p>
      </div>
      <div class="packing-card-footer" id="pack-footer-${o.order_id}" style="display:none">
        <div class="packing-totals">
          Est. Total: <strong id="pack-est-${o.order_id}">${fmtPrice(o.estimated_total)}</strong>
          &nbsp;→ Final Total: <strong id="pack-final-${o.order_id}">—</strong>
        </div>
        <button class="btn-primary" onclick="submitPacking(${o.order_id})">✓ Confirm Pack &amp; Set Final Total</button>
      </div>
    </div>`;
  }).join('');

  renderBulkBar();
}

function toggleBulkSelect(orderId, checked) {
  checked ? adminState.bulkSelected.add(orderId) : adminState.bulkSelected.delete(orderId);
  renderBulkBar();
}

function renderBulkBar() {
  const bar = document.getElementById('packing-bulk-bar');
  if (!bar) return;
  const n = adminState.bulkSelected.size;
  bar.style.display = n ? 'flex' : 'none';
  const countEl = bar.querySelector('#bulk-count');
  if (countEl) countEl.textContent = `${n} selected`;
}

async function bulkPrintLabels() {
  adminState.bulkSelected.forEach(id => printThermalLabel(id));
}

async function bulkPrintSlips() {
  adminState.bulkSelected.forEach(id => printPackingSlip(id));
}

function handleBarcodeInput(e) {
  if (e.key !== 'Enter') return;
  const val = e.target.value.trim();
  if (!val) return;
  e.target.value = '';
  const match = document.querySelector(`.packing-order-num`);
  // Search rendered packing cards for matching order number
  document.querySelectorAll('.packing-order-num').forEach(el => {
    if (el.textContent.trim() === val) {
      const card = el.closest('.packing-card');
      const id   = card?.id?.replace('pack-card-','');
      if (id) { card.scrollIntoView({ behavior:'smooth', block:'center' }); loadPackingItems(parseInt(id)); }
    }
  });
}

async function loadPackingItems(orderId) {
  const [orderRes, batchRes] = await Promise.all([
    apiGet('order',          { id: orderId }),
    apiGet('fifo_preview',   { order_id: orderId }),
  ]);
  if (!orderRes.success) { toast(orderRes.message, 'error'); return; }

  const o       = orderRes.data;
  const batches = batchRes.success ? (batchRes.data || {}) : {};
  const el      = document.getElementById(`pack-items-${orderId}`);
  const fEl     = document.getElementById(`pack-footer-${orderId}`);

  el.innerHTML = `
    <div class="packing-item-row">
      <div class="col-head">Product</div>
      <div class="col-head">Qty</div>
      <div class="col-head packing-type-col">Type</div>
      <div class="col-head est-weight-col">Est. Wt (kg)</div>
      <div class="col-head">Weight / Amount</div>
      <div class="col-head">Stock</div>
    </div>
    ${o.items.map(item => {
      const isCatchWeight = item.pricing_model === 'catch_weight';
      const itemBatches   = batches[item.product_id] || [];
      const batchInfo     = itemBatches.length
        ? itemBatches.map(b =>
            `<small style="color:var(--text-muted);display:block">
              Batch ${fmtDate(b.batch_date)}: ${parseFloat(b.available).toFixed(3)} kg avail.
            </small>`).join('')
        : '';

      const overrideId = `batch-override-${item.order_item_id}`;
      const batchOverride = itemBatches.length > 1 ? `
        <details style="margin-top:.35rem;font-size:.78rem">
          <summary style="cursor:pointer;color:var(--green)">Manual batch override</summary>
          <select class="form-input" id="${overrideId}" style="margin-top:.3rem;font-size:.78rem"
                  onchange="updatePackingTotal(${orderId})">
            <option value="">Auto (FIFO)</option>
            ${itemBatches.map(b =>
              `<option value="${b.batch_id}">
                Batch ${fmtDate(b.batch_date)} — ${parseFloat(b.available).toFixed(3)} kg
              </option>`).join('')}
          </select>
        </details>` : '';

      const weightCell = isCatchWeight
        ? `<input type="number" class="packing-weight-input"
             id="actual-weight-${item.order_item_id}"
             data-order-item-id="${item.order_item_id}"
             data-unit-price="${item.unit_price}"
             data-qty="${item.quantity}"
             data-order-id="${orderId}"
             data-pricing-model="${item.pricing_model}"
             value="${item.actual_weight || (parseFloat(item.estimated_weight) * item.quantity).toFixed(3)}"
             step="0.001" min="0"
             oninput="updatePackingTotal(${orderId})"
           />`
        : `<div class="packing-weight-readonly"
             id="actual-weight-${item.order_item_id}"
             data-order-item-id="${item.order_item_id}"
             data-unit-price="${item.unit_price}"
             data-qty="${item.quantity}"
             data-order-id="${orderId}"
             data-pricing-model="${item.pricing_model}"
           >${fmtPrice(item.unit_price * item.quantity)} (auto)</div>`;

      const oosId = `oos-toggle-${item.order_item_id}`;
      return `
        <div class="packing-item-row" id="pack-row-${item.order_item_id}">
          <div>
            <strong>${escHtml(item.name)}</strong><br>
            <small style="color:var(--text-muted)">${fmtPrice(item.unit_price)}/${unitLabel(item.unit_of_measure || 'kg')}</small>
            ${batchInfo}
            ${batchOverride}
          </div>
          <div>${item.quantity}</div>
          <div class="packing-type-col">
            <span class="badge ${pricingModelBadgeClass(item.pricing_model)}" style="font-size:.62rem">
              ${pricingModelLabel(item.pricing_model)}
            </span>
          </div>
          <div class="est-weight-col" style="color:var(--text-muted)">${isCatchWeight ? item.estimated_weight : '—'}</div>
          <div>${weightCell}</div>
          <div>
            <label style="display:flex;align-items:center;gap:.35rem;font-size:.78rem;cursor:pointer;white-space:nowrap">
              <input type="checkbox" id="${oosId}"
                     onchange="togglePackItemOos(${item.order_item_id},${orderId},this.checked)">
              Out of Stock
            </label>
          </div>
        </div>`;
    }).join('')}`;

  fEl.style.display = 'flex';
  updatePackingTotal(orderId);
}

function togglePackItemOos(itemId, orderId, isOos) {
  const weightEl = document.getElementById(`actual-weight-${itemId}`);
  const row      = document.getElementById(`pack-row-${itemId}`);
  if (weightEl) {
    weightEl.dataset.oos = isOos ? '1' : '0';
    if (weightEl.tagName === 'INPUT') weightEl.disabled = isOos;
    row?.style.setProperty('opacity', isOos ? '0.45' : '1');
  }
  updatePackingTotal(orderId);
}

function updatePackingTotal(orderId) {
  let total = 0;
  document.querySelectorAll(`[data-order-id="${orderId}"]`).forEach(el => {
    if (el.dataset.oos === '1') return;
    const unitPrice = parseFloat(el.dataset.unitPrice) || 0;
    const qty       = parseInt(el.dataset.qty) || 1;
    const model     = el.dataset.pricingModel;
    if (model === 'catch_weight') {
      // actual_weight input stores the TOTAL measured weight for all units combined.
      // Correct formula: total_actual_weight × price_per_kg  (no × qty)
      total += (parseFloat(el.value) || 0) * unitPrice;
    } else {
      total += unitPrice * qty;
    }
  });
  const finalEl = document.getElementById(`pack-final-${orderId}`);
  if (finalEl) finalEl.textContent = fmtPrice(total);
}

async function submitPacking(orderId) {
  const allElements = document.querySelectorAll(`[data-order-id="${orderId}"]`);
  const items = [];
  let valid   = true;
  let hasOos  = false;

  allElements.forEach(el => {
    const model      = el.dataset.pricingModel;
    const itemId     = parseInt(el.dataset.orderItemId);
    const isOos      = el.dataset.oos === '1';
    const batchSel   = document.getElementById(`batch-override-${itemId}`);
    const batchId    = batchSel?.value ? parseInt(batchSel.value) : null;

    if (isOos) {
      hasOos = true;
      items.push({ order_item_id: itemId, actual_weight: null, pricing_model: model, out_of_stock: true });
      return;
    }

    if (model === 'catch_weight') {
      const w = parseFloat(el.value);
      if (isNaN(w) || w < 0) { valid = false; el.style.borderColor = 'var(--error)'; }
      else { el.style.borderColor = ''; items.push({ order_item_id: itemId, actual_weight: w, pricing_model: model, batch_id: batchId }); }
    } else {
      items.push({ order_item_id: itemId, actual_weight: null, pricing_model: model, batch_id: batchId });
    }
  });

  if (!valid) { toast('Please enter valid weights for all catch-weight items.', 'error'); return; }

  if (hasOos && !confirm('Some items are marked Out of Stock and will be excluded from this order (partial fulfillment). Continue?')) return;

  const data = await apiPost('pack_order', { order_id: orderId, items });
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) {
    document.getElementById(`pack-card-${orderId}`)?.remove();
    const list = document.getElementById('packing-list');
    if (!list.querySelector('.packing-card'))
      list.innerHTML = `<div class="table-empty"><span>✅</span><p>All orders packed!</p></div>`;
  }
}

/* ════════════════════════════════════════════════════════════
   DELIVERY
═══════════════════════════════════════════════════════════════*/

let deliverySortZone = false;

async function loadDelivery() {
  setLoading('delivery-list', 'Loading delivery queue…');
  const data = await apiGet('orders', { page: 1 });
  if (!data.success) { toast(data.message, 'error'); return; }

  let relevant = data.data.filter(o => ['Packed','Out for Delivery','Arrived at Location'].includes(o.status));
  const el = document.getElementById('delivery-list');
  if (!relevant.length) {
    el.innerHTML = `<div class="table-empty"><span>🛵</span><p>No active deliveries right now.</p></div>`;
    return;
  }

  if (!adminState.riders.length) {
    const rd = await apiGet('riders');
    if (rd.success) adminState.riders = rd.data;
  }

  // Zone View: group by barangay → city, sort alphabetically
  if (deliverySortZone) {
    relevant = [...relevant].sort((a, b) => {
      const zA = (a.zone_city || a.city || '').trim();
      const zB = (b.zone_city || b.city || '').trim();
      return zA.localeCompare(zB);
    });
  }

  const zoneSortBtn = document.getElementById('delivery-zone-sort');
  if (zoneSortBtn) zoneSortBtn.textContent = deliverySortZone ? '📍 Zone View (ON)' : '📍 Zone View';

  el.innerHTML = relevant.map(o => {
    const curIdx  = STATUS_FLOW.indexOf(o.status);
    const prevSt  = curIdx > 0 ? STATUS_FLOW[curIdx - 1] : null;
    const isSA    = adminState.user?.role_name === 'Super Admin';
    const zoneStr = o.zone_city || [o.barangay, o.city].filter(Boolean).join(', ');

    return `
    <div class="rider-card">
      <div class="rider-card-header">
        <div>
          <div class="packing-order-num">${escHtml(o.order_number)}</div>
          <div class="packing-meta">
            ${escHtml(o.first_name)} ${escHtml(o.last_name)}
            · ${deliveryLabel(o.delivery_date)}
            ${zoneStr ? `<span style="margin-left:.5rem;font-size:.75rem;color:var(--text-muted)">📍 ${escHtml(zoneStr)}</span>` : ''}
          </div>
        </div>
        ${statusBadge(o.status)}
      </div>
      <div class="rider-card-body">
        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
          <div style="flex:1">
            <div style="font-size:.78rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:.4rem">Payment</div>
            <span class="badge ${o.pay_status==='Paid'?'badge-paid':'badge-unpaid'}">${o.pay_status||'Unpaid'}</span>
            <span style="margin-left:.5rem;font-size:.875rem">${escHtml(o.payment_method)}</span>
          </div>
          <div class="rider-total">
            <div>
              <div class="rider-total-label">Final Total</div>
              <div class="rider-total-amount">${fmtPrice(o.final_total||o.estimated_total)}</div>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:.75rem;margin-top:.75rem;flex-wrap:wrap;align-items:center">
          ${o.status === 'Packed' ? `
            <select class="action-select" id="rider-sel-${o.order_id}">
              <option value="">Assign rider…</option>
              ${adminState.riders.map(r =>
                `<option value="${r.user_id}"
                  ${r.zone && r.zone === o.barangay ? 'style="font-weight:700"' : ''}>
                  ${escHtml(r.first_name)} ${escHtml(r.last_name)}
                  ${r.zone ? '· ' + escHtml(r.zone) : ''}
                </option>`).join('')}
            </select>
            <button class="btn-primary btn-sm" onclick="assignAndDispatch(${o.order_id})">Assign &amp; Dispatch</button>` : ''}
          ${o.status === 'Out for Delivery' ? `
            <button class="btn-primary btn-sm" onclick="quickStatus(${o.order_id},'Arrived at Location')">Mark Arrived</button>` : ''}
          ${o.status === 'Arrived at Location' ? `
            <button class="btn-primary btn-sm" onclick="quickStatus(${o.order_id},'Completed')">Mark Completed</button>
            ${o.pay_status !== 'Paid' ? `<button class="btn-outline btn-sm" onclick="verifyPayment(${o.order_id})">Verify Payment</button>` : ''}` : ''}
          ${isSA && prevSt && !['Completed','Cancelled'].includes(o.status) ? `
            <button class="btn-outline btn-sm" style="color:var(--warning);border-color:var(--warning)"
              onclick="undoQuickStatus(${o.order_id},'${escHtml(prevSt)}')">↩ Undo</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleDeliveryZoneSort() {
  deliverySortZone = !deliverySortZone;
  loadDelivery();
}

async function undoQuickStatus(orderId, prevStatus) {
  if (!confirm(`Revert to "${prevStatus}"?`)) return;
  const data = await apiPost('update_order', { order_id: orderId, status: prevStatus });
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) loadDelivery();
}

async function assignAndDispatch(orderId) {
  const sel = document.getElementById(`rider-sel-${orderId}`);
  if (!sel?.value) { toast('Please select a rider.', 'error'); return; }
  const assign = await apiPost('assign_rider', { order_id: orderId, rider_id: parseInt(sel.value) });
  if (!assign.success) { toast(assign.message, 'error'); return; }
  const status = await apiPost('update_order', { order_id: orderId, status: 'Out for Delivery' });
  toast(status.message, status.success ? 'success' : 'error');
  if (status.success) loadDelivery();
}

async function quickStatus(orderId, status) {
  const data = await apiPost('update_order', { order_id: orderId, status });
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) loadDelivery();
}

/* ════════════════════════════════════════════════════════════
   PRODUCTS
═══════════════════════════════════════════════════════════════*/

async function loadProducts() {
  setLoading('products-tbody', 'Loading products…');

  if (!adminState.categories.length) {
    const c = await coreFetch('api/categories.php');
    if (c.success) adminState.categories = c.data;
  }

  const search = document.getElementById('product-search')?.value  || '';
  const cat    = document.getElementById('product-cat-filter')?.value || '';
  const status = document.getElementById('product-status-filter')?.value || '';

  const data = await apiGet('products', { search, category_id: cat, status });
  if (!data.success) { toast(data.message, 'error'); return; }

  adminState.products = data.data;
  const tbody = document.getElementById('products-tbody');

  if (!data.data.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="table-empty"><span>📦</span><p>No products found</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.data.map(p => {
    const stockQty  = parseFloat(p.stock_qty || 0);
    const dec       = p.unit_of_measure === 'kg' ? 2 : 0;
    const isOos     = stockQty <= 0;
    const isLow     = !isOos && stockQty <= LOW_STOCK_THRESHOLD;
    const stockBadge = isOos
      ? `<span class="badge badge-blocked" style="font-size:.65rem">Out of Stock</span>`
      : isLow
        ? `<span class="badge badge-suspended" style="font-size:.65rem">Low Stock</span>`
        : '';
    return `
    <tr>
      <td>
        <div class="product-thumb">
          <div class="product-thumb-icon">${productIcon(p.category_name)}</div>
          <div class="product-thumb-info">
            <strong>${escHtml(p.name)}</strong>
            <small>${escHtml(p.category_name)}</small>
            ${stockBadge}
          </div>
        </div>
      </td>
      <td>${fmtPrice(p.base_price)}<small style="color:var(--text-muted)">/${unitLabel(p.unit_of_measure)}</small></td>
      <td><span class="badge ${pricingModelBadgeClass(p.pricing_model)}">${pricingModelLabel(p.pricing_model)}</span></td>
      <td>${p.estimated_weight} ${unitLabel(p.unit_of_measure)}</td>
      <td>
        ${stockQty.toFixed(dec)} ${unitLabel(p.unit_of_measure)}
        ${stockBadge}
      </td>
      <td>${p.is_featured ? '<span class="badge badge-featured">Featured</span>' : ''}</td>
      <td><span class="badge ${p.status === 'active' ? 'badge-active' : 'badge-archived'}">${p.status}</span></td>
      <td class="td-actions">
        <button class="btn-primary btn-sm" onclick="openProductModal(${p.product_id})">Edit</button>
        <button class="btn-outline btn-sm" onclick="openWholesaleTiers(${p.product_id})">Tiers</button>
        <button class="btn-outline btn-sm" onclick="toggleFeatured(${p.product_id})">★</button>
        <button class="btn-danger btn-sm" onclick="archiveProduct(${p.product_id},'${p.status === 'active' ? 'archived' : 'active'}')">
          ${p.status === 'active' ? 'Archive' : 'Restore'}
        </button>
      </td>
    </tr>`;
  }).join('');
}

async function openProductModal(productId = null) {
  if (!adminState.categories.length) {
    const c = await coreFetch('api/categories.php');
    if (c.success) adminState.categories = c.data;
  }
  const catOptions = adminState.categories.map(c =>
    `<option value="${c.category_id}">${escHtml(c.name)}</option>`).join('');
  const p = productId ? adminState.products.find(pr => pr.product_id === productId) : null;

  openSimpleModal(p ? 'Edit Product' : 'Add New Product', `
    <div class="form-row">
      <div class="form-field">
        <label>Category <span class="req">*</span></label>
        <select class="form-input" id="p-category" required>
          ${catOptions.replace(`value="${p?.category_id}"`, `value="${p?.category_id}" selected`)}
        </select>
      </div>
      <div class="form-field">
        <label>Status</label>
        <select class="form-input" id="p-status">
          <option value="active"   ${(!p || p.status === 'active')    ? 'selected' : ''}>Active</option>
          <option value="archived" ${p?.status === 'archived'         ? 'selected' : ''}>Archived</option>
        </select>
      </div>
    </div>
    <div class="form-row single">
      <div class="form-field">
        <label>Product Name <span class="req">*</span></label>
        <input class="form-input" id="p-name" value="${escHtml(p?.name || '')}" required>
      </div>
    </div>
    <div class="form-row single">
      <div class="form-field">
        <label>Description</label>
        <textarea class="form-input" id="p-desc" rows="3">${escHtml(p?.description || '')}</textarea>
      </div>
    </div>
    <div class="form-row fourths">
      <div class="form-field">
        <label>Base Price (₱) <span class="req">*</span></label>
        <input class="form-input" type="number" id="p-price" value="${p?.base_price || ''}" step="0.01" min="0" required>
        <span class="field-hint" id="p-price-hint">Price per unit</span>
      </div>
      <div class="form-field">
        <label>Pricing Model <span class="req">*</span></label>
        <select class="form-input" id="p-pricing-model" onchange="onPricingModelChange()" required>
          <option value="catch_weight" ${(!p || p.pricing_model === 'catch_weight') ? 'selected' : ''}>Catch-weight (kg)</option>
          <option value="fixed_pack"   ${p?.pricing_model === 'fixed_pack'          ? 'selected' : ''}>Fixed Pack</option>
          <option value="per_piece"    ${p?.pricing_model === 'per_piece'           ? 'selected' : ''}>Per Piece</option>
        </select>
      </div>
      <div class="form-field">
        <label>Unit of Measure</label>
        <input class="form-input" id="p-uom" readonly value="${p?.unit_of_measure || 'kg'}"
               style="background:var(--bg-alt);cursor:not-allowed">
        <span class="field-hint">Auto-set by pricing model</span>
      </div>
      <div class="form-field">
        <label>Est. Weight (kg)</label>
        <input class="form-input" type="number" id="p-weight" value="${p?.estimated_weight || '1.000'}" step="0.001" min="0">
      </div>
    </div>
    <div class="pricing-hint" id="p-pricing-hint">Loading hint…</div>
    <div class="form-row single" style="margin-top:.75rem">
      <div class="form-field">
        <label>Flags</label>
        <label style="display:flex;align-items:center;gap:.5rem;text-transform:none;letter-spacing:0;font-weight:500;font-size:.875rem;cursor:pointer;margin-top:.25rem">
          <input type="checkbox" id="p-featured" ${p?.is_featured ? 'checked' : ''}> Featured
        </label>
      </div>
    </div>`,
    async () => {
      const pricingModel = document.getElementById('p-pricing-model').value;
      const payload = {
        product_id:       productId || 0,
        category_id:      parseInt(document.getElementById('p-category').value),
        name:             document.getElementById('p-name').value.trim(),
        description:      document.getElementById('p-desc').value.trim(),
        base_price:       parseFloat(document.getElementById('p-price').value),
        pricing_model:    pricingModel,
        estimated_weight: parseFloat(document.getElementById('p-weight').value),
        is_featured:      document.getElementById('p-featured').checked,
        status:           document.getElementById('p-status').value,
      };
      if (!payload.name || !payload.category_id || !payload.base_price) {
        toast('Please fill required fields.', 'error'); return;
      }
      const data = await apiPost('save_product', payload);
      toast(data.message, data.success ? 'success' : 'error');
      if (data.success) { closeModal('simple-modal'); loadProducts(); }
    }, 'Save Product'
  );
  setTimeout(onPricingModelChange, 50);
}

function onPricingModelChange() {
  const model  = document.getElementById('p-pricing-model')?.value;
  const uomEl  = document.getElementById('p-uom');
  const hintEl = document.getElementById('p-pricing-hint');
  const phEl   = document.getElementById('p-price-hint');
  if (!model || !uomEl || !hintEl) return;

  const uomMap  = { catch_weight: 'kg', fixed_pack: 'pack', per_piece: 'piece' };
  const hints   = {
    catch_weight: '<strong>Catch-weight:</strong> Price is per <strong>kg</strong>. Staff weighs at packing. Est. Weight is used for cart estimate only.',
    fixed_pack:   '<strong>Fixed Pack:</strong> Price is per <strong>pack</strong>. No weighing needed.',
    per_piece:    '<strong>Per Piece:</strong> Price is per <strong>individual piece</strong>. No weighing needed.',
  };
  const priceLabels = { catch_weight: 'Price per kg', fixed_pack: 'Price per pack', per_piece: 'Price per piece' };

  uomEl.value       = uomMap[model] || 'kg';
  hintEl.innerHTML  = hints[model] || '';
  if (phEl) phEl.textContent = priceLabels[model] || 'Price per unit';
}

async function toggleFeatured(productId) {
  const data = await apiPost('toggle_featured', { product_id: productId });
  if (data.success) {
    toast(data.is_featured ? 'Marked as featured.' : 'Removed from featured.', 'success');
    loadProducts();
  }
}

async function archiveProduct(productId, newStatus) {
  const data = await apiPost('archive_product', { product_id: productId, status: newStatus });
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) loadProducts();
}

/* ════════════════════════════════════════════════════════════
   WHOLESALE TIERS
═══════════════════════════════════════════════════════════════*/

async function openWholesaleTiers(productId) {
  const data = await apiGet('wholesale_tiers', { product_id: productId });
  if (!data.success) { toast(data.message, 'error'); return; }

  adminState.wholesaleTiers[productId] = data.data || [];
  renderWholesaleTierModal(productId);
}

function renderWholesaleTierModal(productId) {
  const tiers = adminState.wholesaleTiers[productId] || [];
  const product = adminState.products.find(p => p.product_id === productId);

  const tierRows = tiers.map((t, i) => `
    <div class="form-row" style="align-items:flex-end" id="tier-row-${t.tier_id||'new'+i}">
      <div class="form-field">
        <label>Min Qty</label>
        <input class="form-input" type="number" min="1" step="1"
               id="tier-minqty-${t.tier_id||'new'+i}" value="${t.min_quantity||''}">
      </div>
      <div class="form-field">
        <label>Tier Price (₱/${unitLabel(product?.unit_of_measure||'kg')})</label>
        <input class="form-input" type="number" min="0" step="0.01"
               id="tier-price-${t.tier_id||'new'+i}" value="${t.price||''}">
      </div>
      <div class="form-field" style="flex:0">
        <button class="btn-danger btn-sm"
          onclick="deleteWholesaleTier(${productId},${t.tier_id||0},'tier-row-${t.tier_id||'new'+i}')">✕</button>
      </div>
    </div>`).join('');

  openSimpleModal(`Wholesale Tiers — ${escHtml(product?.name||'')}`, `
    <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:.75rem">
      Define quantity breaks where customers automatically receive a lower price.
    </p>
    <div id="tier-rows-wrap">${tierRows || '<p style="color:var(--text-muted)">No tiers yet.</p>'}</div>
    <button class="btn-outline btn-sm" style="margin-top:.65rem"
      onclick="addWholesaleTierRow(${productId})">+ Add Tier</button>`,
    () => saveWholesaleTiers(productId),
    'Save Tiers'
  );
}

function addWholesaleTierRow(productId) {
  const product = adminState.products.find(p => p.product_id === productId);
  const wrap    = document.getElementById('tier-rows-wrap');
  if (!wrap) return;
  const uid = 'new' + Date.now();
  const div = document.createElement('div');
  div.className = 'form-row';
  div.id = `tier-row-${uid}`;
  div.style.alignItems = 'flex-end';
  div.innerHTML = `
    <div class="form-field">
      <label>Min Qty</label>
      <input class="form-input" type="number" min="1" step="1" id="tier-minqty-${uid}">
    </div>
    <div class="form-field">
      <label>Tier Price (₱/${unitLabel(product?.unit_of_measure||'kg')})</label>
      <input class="form-input" type="number" min="0" step="0.01" id="tier-price-${uid}">
    </div>
    <div class="form-field" style="flex:0">
      <button class="btn-danger btn-sm"
        onclick="document.getElementById('tier-row-${uid}').remove()">✕</button>
    </div>`;
  wrap.appendChild(div);
}

async function saveWholesaleTiers(productId) {
  const rows  = document.querySelectorAll('#tier-rows-wrap [id^="tier-row-"]');
  const tiers = [];
  rows.forEach(row => {
    const uid   = row.id.replace('tier-row-','');
    const minQ  = parseInt(document.getElementById(`tier-minqty-${uid}`)?.value);
    const price = parseFloat(document.getElementById(`tier-price-${uid}`)?.value);
    if (minQ > 0 && price >= 0) tiers.push({ tier_id: isNaN(parseInt(uid)) ? 0 : parseInt(uid), min_quantity: minQ, price });
  });
  const data = await apiPost('save_wholesale_tiers', { product_id: productId, tiers });
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) closeModal('simple-modal');
}

async function deleteWholesaleTier(productId, tierId, rowId) {
  if (tierId) {
    const data = await apiPost('delete_wholesale_tier', { tier_id: tierId });
    if (!data.success) { toast(data.message, 'error'); return; }
  }
  document.getElementById(rowId)?.remove();
}

/* ════════════════════════════════════════════════════════════
   PRINT UTILITIES
═══════════════════════════════════════════════════════════════*/

async function printPackingSlip(orderId) {
  const data = await apiGet('order', { id: orderId });
  if (!data.success) { toast(data.message, 'error'); return; }
  const o = data.data;
  const w = window.open('', '_blank', 'width=700,height=900');
  w.document.write(`<!DOCTYPE html><html><head><title>Packing Slip — ${escHtml(o.order_number)}</title>
  <style>
    body{font-family:sans-serif;font-size:13px;padding:1.5rem;color:#111}
    h2{margin:0 0 .5rem}table{width:100%;border-collapse:collapse;margin-top:.75rem}
    th,td{border:1px solid #ccc;padding:.35rem .5rem;text-align:left}
    th{background:#f5f5f5}.total-row td{font-weight:700}
    .meta{color:#555;font-size:12px;margin-bottom:.5rem}
    @media print{button{display:none}}
  </style></head><body>
  <h2>🐓 PoultryMart — Packing Slip</h2>
  <div class="meta">Order: <strong>${escHtml(o.order_number)}</strong> &nbsp;|&nbsp; Date: ${fmtDate(o.created_at)}</div>
  <div class="meta">Customer: <strong>${escHtml(o.first_name)} ${escHtml(o.last_name)}</strong> &nbsp;|&nbsp; ${escHtml(o.phone||'')}</div>
  <div class="meta">Delivery: ${fmtDate(o.delivery_date)} — ${escHtml(o.slot_label||'')} &nbsp;|&nbsp; ${escHtml([o.street,o.barangay,o.city].filter(Boolean).join(', '))}</div>
  <table>
    <thead><tr><th>Product</th><th>Model</th><th>Qty</th><th>Est. Wt</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
    <tbody>
    ${o.items.map(i=>`<tr>
      <td>${escHtml(i.name)}</td>
      <td>${pricingModelLabel(i.pricing_model)}</td>
      <td>${i.quantity}</td>
      <td>${i.pricing_model==='catch_weight'?i.estimated_weight+' kg':'—'}</td>
      <td>${fmtPrice(i.unit_price)}</td>
      <td>${fmtPrice(i.estimated_subtotal)}</td>
    </tr>`).join('')}
    <tr class="total-row"><td colspan="5" style="text-align:right">Est. Total</td><td>${fmtPrice(o.estimated_total)}</td></tr>
    </tbody>
  </table>
  <p style="margin-top:1rem;font-size:11px;color:#888">Actual weight items will be re-weighed at packing. Final total may differ.</p>
  <button onclick="window.print()" style="margin-top:1rem;padding:.5rem 1rem">🖨 Print</button>
  </body></html>`);
  w.document.close();
}

async function printThermalLabel(orderId) {
  const data = await apiGet('order', { id: orderId });
  if (!data.success) { toast(data.message, 'error'); return; }
  const o = data.data;
  const w = window.open('', '_blank', 'width=400,height=500');
  w.document.write(`<!DOCTYPE html><html><head><title>Label — ${escHtml(o.order_number)}</title>
  <style>
    body{font-family:monospace;font-size:14px;padding:1rem;width:320px;border:2px dashed #000}
    h3{margin:0 0 .5rem;font-size:18px}p{margin:.2rem 0}
    .big{font-size:22px;font-weight:700;letter-spacing:2px}hr{border:1px dashed #000}
    @media print{button{display:none}body{border:none}}
  </style></head><body>
  <h3>🐓 PoultryMart</h3>
  <hr>
  <div class="big">${escHtml(o.order_number)}</div>
  <p><strong>${escHtml(o.first_name)} ${escHtml(o.last_name)}</strong></p>
  <p>${escHtml(o.phone||'')}</p>
  <p>${escHtml([o.street,o.barangay,o.city].filter(Boolean).join(', '))}</p>
  <hr>
  <p>Delivery: <strong>${fmtDate(o.delivery_date)}</strong></p>
  <p>Slot: ${escHtml(o.slot_label||'—')}</p>
  <p>Payment: ${escHtml(o.payment_method)} — <strong>${o.pay_status||'Unpaid'}</strong></p>
  <p>Total: <strong>${fmtPrice(o.final_total||o.estimated_total)}</strong></p>
  <button onclick="window.print()" style="margin-top:.75rem;width:100%;padding:.4rem">🖨 Print Label</button>
  </body></html>`);
  w.document.close();
}

async function printDailyPrepSheet() {
  const date = new Date().toISOString().slice(0,10);
  const data = await apiGet('daily_prep', { date });
  if (!data.success) { toast(data.message, 'error'); return; }
  const items = data.data || [];
  const w = window.open('', '_blank', 'width=800,height=900');
  w.document.write(`<!DOCTYPE html><html><head><title>Daily Prep Sheet — ${date}</title>
  <style>
    body{font-family:sans-serif;font-size:13px;padding:1.5rem}
    h2{margin:0 0 .5rem}table{width:100%;border-collapse:collapse;margin-top:.75rem}
    th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}th{background:#f5f5f5}
    @media print{button{display:none}}
  </style></head><body>
  <h2>🐓 Daily Prep Sheet — ${date}</h2>
  <table>
    <thead><tr><th>Product</th><th>Category</th><th>Total Orders</th><th>Est. Qty Needed</th><th>Unit</th></tr></thead>
    <tbody>
    ${items.map(r=>`<tr>
      <td>${escHtml(r.product_name)}</td>
      <td>${escHtml(r.category_name)}</td>
      <td>${r.order_count}</td>
      <td>${parseFloat(r.total_qty).toFixed(3)}</td>
      <td>${escHtml(r.unit_of_measure)}</td>
    </tr>`).join('')}
    </tbody>
  </table>
  <button onclick="window.print()" style="margin-top:1rem;padding:.5rem 1rem">🖨 Print</button>
  </body></html>`);
  w.document.close();
}

/* ════════════════════════════════════════════════════════════
   INVENTORY
═══════════════════════════════════════════════════════════════*/

async function loadInventory() {
  setLoading('inventory-tbody', 'Loading inventory…');
  const data = await apiGet('inventory');
  if (!data.success) { toast(data.message, 'error'); return; }

  adminState.inventory = data.data;
  const tbody = document.getElementById('inventory-tbody');
  if (!data.data.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="table-empty"><span>📦</span><p>No inventory batches</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.data.map(b => {
    const pct    = b.quantity > 0 ? Math.round((b.remaining_qty / b.quantity) * 100) : 0;
    const color  = pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--warning)' : 'var(--error)';
    const unit   = b.batch_unit || 'kg';
    const dec    = unit === 'kg' ? 2 : 0;
    return `<tr>
      <td><strong>${escHtml(b.product_name)}</strong><br><small style="color:var(--text-muted)">${escHtml(b.category_name)}</small></td>
      <td>${fmtDate(b.batch_date)}</td>
      <td>${parseFloat(b.quantity).toFixed(dec)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:.5rem">
          <div style="flex:1;background:var(--border);border-radius:999px;height:8px">
            <div style="background:${color};width:${pct}%;height:100%;border-radius:999px"></div>
          </div>
          <span style="font-size:.82rem;font-weight:600;color:${color}">${parseFloat(b.remaining_qty).toFixed(dec)}</span>
        </div>
      </td>
      <td><span class="unit-badge ${unitBadgeClass(unit)}">${unit}</span></td>
      <td><span class="badge ${pct > 20 ? 'badge-active' : 'badge-blocked'}">${pct}%</span></td>
      <td>${fmtDate(b.created_at)}</td>
    </tr>`;
  }).join('');
}

async function openAddBatchModal() {
  if (!adminState.products.length) {
    const d = await apiGet('products', { status: 'active' });
    if (d.success) adminState.products = d.data;
  }
  const prodOptions = adminState.products.filter(p => p.status === 'active').map(p =>
    `<option value="${p.product_id}" data-unit="${escHtml(p.unit_of_measure)}">
       ${escHtml(p.name)} (${pricingModelLabel(p.pricing_model)})
     </option>`).join('');

  openSimpleModal('Add Inventory Batch', `
    <div class="form-row single">
      <div class="form-field">
        <label>Product <span class="req">*</span></label>
        <select class="form-input" id="batch-product" onchange="updateBatchQtyLabel()">${prodOptions}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Batch Date <span class="req">*</span></label>
        <input class="form-input" type="date" id="batch-date" value="${new Date().toISOString().split('T')[0]}">
      </div>
      <div class="form-field">
        <label id="batch-qty-label">Quantity (kg) <span class="req">*</span></label>
        <input class="form-input" type="number" id="batch-qty" step="0.001" min="0.001" placeholder="e.g. 50">
        <span class="field-hint" id="batch-qty-hint">Unit is auto-set from product pricing model</span>
      </div>
    </div>`,
    async () => {
      const pid  = parseInt(document.getElementById('batch-product').value);
      const date = document.getElementById('batch-date').value;
      const qty  = parseFloat(document.getElementById('batch-qty').value);
      if (!pid || !date || isNaN(qty) || qty <= 0) { toast('Fill all required fields.', 'error'); return; }
      const data = await apiPost('add_batch', { product_id: pid, batch_date: date, quantity: qty });
      toast(data.message, data.success ? 'success' : 'error');
      if (data.success) { closeModal('simple-modal'); loadInventory(); }
    }, 'Add Batch'
  );
  setTimeout(updateBatchQtyLabel, 50);
}

function updateBatchQtyLabel() {
  const sel   = document.getElementById('batch-product');
  const lblEl = document.getElementById('batch-qty-label');
  const stepEl = document.getElementById('batch-qty');
  if (!sel || !lblEl) return;
  const unit = sel.options[sel.selectedIndex]?.dataset?.unit || 'kg';
  lblEl.innerHTML = `${({kg:'Quantity (kg)',pack:'Quantity (packs)',piece:'Quantity (pieces)'}[unit]||'Quantity')} <span class="req">*</span>`;
  if (stepEl) stepEl.step = ({kg:'0.001',pack:'1',piece:'1'}[unit]||'0.001');
}

/* ════════════════════════════════════════════════════════════
   USERS
═══════════════════════════════════════════════════════════════*/

async function loadUsers() {
  setLoading('users-tbody', 'Loading users…');
  const data = await apiGet('users', {
    search: document.getElementById('user-search')?.value  || '',
    role:   document.getElementById('user-role-filter')?.value || '',
    status: document.getElementById('user-status-filter')?.value || '',
  });
  if (!data.success) { toast(data.message, 'error'); return; }

  adminState.users = data.data;
  const tbody = document.getElementById('users-tbody');
  if (!data.data.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="table-empty"><span>👤</span><p>No users found</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.data.map(u => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:.6rem">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--green-pale);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.82rem;color:var(--green);flex-shrink:0">
            ${(u.first_name[0]+u.last_name[0]).toUpperCase()}
          </div>
          <div>
            <strong>${escHtml(u.first_name)} ${escHtml(u.last_name)}</strong><br>
            <small style="color:var(--text-muted)">${escHtml(u.email)}</small>
          </div>
        </div>
      </td>
      <td><span class="badge ${
        u.role_name==='Super Admin'?'badge-featured':
        u.role_name==='Fulfillment Staff'?'badge-catch':
        u.role_name==='Delivery Rider'?'badge-paid':'badge-active'
      }">${escHtml(u.role_name)}</span></td>
      <td>${escHtml(u.phone||'—')}</td>
      <td>${u.order_count}</td>
      <td><span class="badge ${
        u.status==='active'?'badge-active':
        u.status==='suspended'?'badge-suspended':'badge-blocked'
      }">${u.status}</span></td>
      <td>${fmtDate(u.created_at)}</td>
      <td class="td-actions">
        <button class="btn-primary btn-sm" onclick="openUserModal(${u.user_id})">Edit</button>
        ${u.status === 'active'
          ? `<button class="btn-danger btn-sm" onclick="setUserStatus(${u.user_id},'suspended')">Suspend</button>`
          : `<button class="btn-outline btn-sm" onclick="setUserStatus(${u.user_id},'active')">Restore</button>`}
      </td>
    </tr>`).join('');
}

async function setUserStatus(userId, status) {
  const data = await apiPost('update_user_status', { user_id: userId, status });
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) loadUsers();
}

function openUserModal(userId = null) {
  const u     = userId ? adminState.users.find(u => u.user_id === userId) : null;
  const roles = ['Customer','Fulfillment Staff','Delivery Rider','Super Admin'];

  openSimpleModal(u ? 'Edit User' : 'Add New User', `
    <div class="form-row">
      <div class="form-field">
        <label>First Name <span class="req">*</span></label>
        <input class="form-input" id="u-first" value="${escHtml(u?.first_name||'')}">
      </div>
      <div class="form-field">
        <label>Last Name <span class="req">*</span></label>
        <input class="form-input" id="u-last" value="${escHtml(u?.last_name||'')}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Email <span class="req">*</span></label>
        <input class="form-input" type="email" id="u-email" value="${escHtml(u?.email||'')}">
      </div>
      <div class="form-field">
        <label>Phone</label>
        <input class="form-input" id="u-phone" value="${escHtml(u?.phone||'')}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Role</label>
        <select class="form-input" id="u-role">
          ${roles.map(r => `<option value="${r}" ${u?.role_name===r?'selected':''}>${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label>Password ${u ? '(leave blank to keep)' : '<span class="req">*</span>'}</label>
        <input class="form-input" type="password" id="u-pass" placeholder="Min. 8 characters">
      </div>
    </div>`,
    async () => {
      const payload = {
        user_id:    userId || 0,
        first_name: document.getElementById('u-first').value.trim(),
        last_name:  document.getElementById('u-last').value.trim(),
        email:      document.getElementById('u-email').value.trim(),
        phone:      document.getElementById('u-phone').value.trim(),
        role:       document.getElementById('u-role').value,
        password:   document.getElementById('u-pass').value,
      };
      if (!payload.first_name || !payload.last_name || !payload.email) {
        toast('Fill required fields.', 'error'); return;
      }
      const data = await apiPost('save_user', payload);
      toast(data.message, data.success ? 'success' : 'error');
      if (data.success) { closeModal('simple-modal'); loadUsers(); }
    }, userId ? 'Save Changes' : 'Create User'
  );
}

/* ════════════════════════════════════════════════════════════
   PROMO CODES
═══════════════════════════════════════════════════════════════*/

async function loadPromos() {
  setLoading('promos-tbody', 'Loading promo codes…');
  const data = await apiGet('promos');
  if (!data.success) { toast(data.message, 'error'); return; }

  adminState.promos = data.data;
  const tbody = document.getElementById('promos-tbody');
  tbody.innerHTML = data.data.length === 0
    ? `<tr><td colspan="7"><div class="table-empty"><span>🏷️</span><p>No promo codes yet</p></div></td></tr>`
    : data.data.map(p => `
      <tr>
        <td><strong style="font-family:'Playfair Display',serif;letter-spacing:.5px">${escHtml(p.code)}</strong></td>
        <td>${p.discount_type==='percentage'?`${p.discount_value}%`:`₱${p.discount_value}`}</td>
        <td>${fmtPrice(p.min_order_value)}</td>
        <td>${p.valid_from?fmtDate(p.valid_from):'—'} → ${p.valid_to?fmtDate(p.valid_to):'—'}</td>
        <td>${p.times_used}${p.usage_limit?' / '+p.usage_limit:''}</td>
        <td><span class="badge ${p.is_active?'badge-active':'badge-archived'}">${p.is_active?'Active':'Disabled'}</span></td>
        <td class="td-actions">
          <button class="btn-primary btn-sm" onclick="openPromoModal(${p.promo_id})">Edit</button>
        </td>
      </tr>`).join('');
}

function openPromoModal(promoId = null) {
  const p = promoId ? adminState.promos.find(pr => pr.promo_id === promoId) : null;

  openSimpleModal(p ? 'Edit Promo Code' : 'New Promo Code', `
    <div class="form-row">
      <div class="form-field">
        <label>Code <span class="req">*</span></label>
        <input class="form-input" id="promo-code" value="${escHtml(p?.code||'')}" placeholder="e.g. WELCOME10" style="text-transform:uppercase">
      </div>
      <div class="form-field">
        <label>Status</label>
        <select class="form-input" id="promo-active">
          <option value="1" ${(!p||p.is_active)?'selected':''}>Active</option>
          <option value="0" ${p&&!p.is_active?'selected':''}>Disabled</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Discount Type</label>
        <select class="form-input" id="promo-type">
          <option value="percentage" ${p?.discount_type==='percentage'?'selected':''}>Percentage (%)</option>
          <option value="flat"       ${p?.discount_type==='flat'?'selected':''}>Flat Amount (₱)</option>
        </select>
      </div>
      <div class="form-field">
        <label>Discount Value <span class="req">*</span></label>
        <input class="form-input" type="number" id="promo-val" value="${p?.discount_value||''}" step="0.01" min="0">
      </div>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Min Order Value (₱)</label>
        <input class="form-input" type="number" id="promo-min" value="${p?.min_order_value||'0'}" step="0.01" min="0">
      </div>
      <div class="form-field">
        <label>Usage Limit</label>
        <input class="form-input" type="number" id="promo-limit" value="${p?.usage_limit||''}" placeholder="Unlimited">
      </div>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Valid From</label>
        <input class="form-input" type="date" id="promo-from" value="${p?.valid_from||''}">
      </div>
      <div class="form-field">
        <label>Valid To</label>
        <input class="form-input" type="date" id="promo-to" value="${p?.valid_to||''}">
      </div>
    </div>`,
    async () => {
      const code = document.getElementById('promo-code').value.trim().toUpperCase();
      const val  = parseFloat(document.getElementById('promo-val').value);
      if (!code || isNaN(val) || val <= 0) { toast('Code and discount value required.', 'error'); return; }
      const payload = {
        promo_id:       promoId || 0,
        code,
        discount_type:  document.getElementById('promo-type').value,
        discount_value: val,
        min_order_value: parseFloat(document.getElementById('promo-min').value) || 0,
        is_active:      parseInt(document.getElementById('promo-active').value),
        valid_from:     document.getElementById('promo-from').value || null,
        valid_to:       document.getElementById('promo-to').value   || null,
        usage_limit:    parseInt(document.getElementById('promo-limit').value) || null,
      };
      const data = await apiPost('save_promo', payload);
      toast(data.message, data.success ? 'success' : 'error');
      if (data.success) { closeModal('simple-modal'); loadPromos(); }
    }, promoId ? 'Save Changes' : 'Create Promo'
  );
}

/* ════════════════════════════════════════════════════════════
   REPORTS
═══════════════════════════════════════════════════════════════*/

async function loadReports(period = 30) {
  document.getElementById('report-period').value = period;
  setLoading('report-chart-wrap', 'Generating report…');

  const data = await apiGet('report', { period });
  if (!data.success) { toast(data.message, 'error'); return; }

  adminState.reportData = data.data;
  const { daily, by_category, top_products, totals } = data.data;

  document.getElementById('rep-total-orders').textContent   = totals.total_orders;
  document.getElementById('rep-total-rev').textContent      = fmtPrice(totals.total_revenue);
  document.getElementById('rep-total-disc').textContent     = fmtPrice(totals.total_discounts);
  document.getElementById('rep-total-delivery').textContent = fmtPrice(totals.total_delivery_fees);

  // Daily chart
  const chartEl = document.getElementById('report-chart-wrap');
  if (!daily.length) {
    chartEl.innerHTML = '<div class="table-empty"><span>📊</span><p>No completed orders in this period</p></div>';
  } else {
    const max = Math.max(...daily.map(d => parseFloat(d.revenue)), 1);
    chartEl.innerHTML = `<div class="report-bar-chart">
      ${daily.map(d => {
        const h = Math.max(4, (parseFloat(d.revenue) / max) * 100);
        return `<div class="report-bar-wrap">
          <div class="report-bar-val">${parseFloat(d.revenue) > 0 ? '₱'+(parseFloat(d.revenue)/1000).toFixed(1)+'k' : ''}</div>
          <div class="report-bar" style="height:${h}%" title="${d.d}: ${fmtPrice(d.revenue)}"></div>
          <div class="report-bar-label">${d.d.slice(5)}</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // By category
  const catEl  = document.getElementById('rep-by-cat');
  const maxRev = Math.max(...by_category.map(c => parseFloat(c.revenue)), 1);
  catEl.innerHTML = by_category.map(c => `
    <div style="margin-bottom:.75rem">
      <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:.3rem">
        <span><strong>${escHtml(c.category)}</strong></span>
        <span style="color:var(--green)">${fmtPrice(c.revenue)}</span>
      </div>
      <div style="background:var(--border);border-radius:999px;height:8px">
        <div style="background:var(--green);width:${Math.round(parseFloat(c.revenue)/maxRev*100)}%;height:100%;border-radius:999px"></div>
      </div>
      <div style="font-size:.72rem;color:var(--text-muted);margin-top:.2rem">${c.items_sold} items sold</div>
    </div>`).join('') || '<p style="color:var(--text-muted)">No data</p>';

  // Top products
  const tpEl = document.getElementById('rep-top-products');
  tpEl.innerHTML = !top_products.length
    ? '<tr><td colspan="4"><div class="table-empty"><span>📊</span><p>No data</p></div></td></tr>'
    : top_products.map((p, i) => `
        <tr>
          <td><span style="color:var(--text-muted);margin-right:.5rem">${i+1}.</span><strong>${escHtml(p.name)}</strong></td>
          <td><small style="color:var(--text-muted)">${escHtml(p.category)}</small></td>
          <td style="text-align:center">${p.times_ordered}</td>
          <td style="text-align:right">${parseFloat(p.total_qty).toFixed(2)} units</td>
        </tr>`).join('');
}

/* ════════════════════════════════════════════════════════════
   SETTINGS
═══════════════════════════════════════════════════════════════*/

async function loadSettings() {
  const data = await apiGet('settings');
  if (!data.success) { toast(data.message, 'error'); return; }
  const { hours, zones, slots } = data.data;

  document.getElementById('settings-hours').innerHTML = hours.map(h => `
    <div class="toggle-wrap">
      <div class="toggle-label">
        <strong>${DAY_NAMES[h.day_of_week]}</strong>
        <small>${h.open_time} – ${h.close_time}</small>
      </div>
      <label class="toggle">
        <input type="checkbox" ${h.is_active?'checked':''} disabled>
        <span class="toggle-slider"></span>
      </label>
    </div>`).join('');

  document.getElementById('settings-zones').innerHTML = `
    <table class="data-table">
      <thead><tr><th>Municipality</th><th style="text-align:right">Fee</th></tr></thead>
      <tbody>
        ${zones.map(z => `
          <tr>
            <td>${escHtml(z.municipality_name)}</td>
            <td style="text-align:right;font-weight:700;color:var(--green)">${fmtPrice(z.delivery_fee)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  document.getElementById('settings-slots').innerHTML = slots.map(s => `
    <div class="toggle-wrap">
      <div class="toggle-label">
        <strong>${escHtml(s.slot_label)}</strong>
        <small>${s.start_time} – ${s.end_time}</small>
      </div>
      <label class="toggle">
        <input type="checkbox" ${s.is_active?'checked':''} disabled>
        <span class="toggle-slider"></span>
      </label>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════*/

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const orderModal = document.getElementById('order-detail-modal');
    const simpleModal = document.getElementById('simple-modal');
    if (orderModal && !orderModal.getAttribute('aria-hidden')) closeOrderDetail();
    else if (simpleModal && simpleModal.style.display !== 'none') closeModal('simple-modal');
    const podOverlay = document.getElementById('pod-viewer-overlay');
    if (podOverlay && podOverlay.style.display !== 'none') podOverlay.style.display = 'none';
    closeSidebarUI('portal-sidebar', 'portal-sidebar-overlay');
  });

  document.getElementById('portal-sidebar-overlay')?.addEventListener('click', closeSidebar);

  // Barcode scanner input
  document.getElementById('barcode-scan-input')?.addEventListener('keydown', handleBarcodeInput);

  // POD viewer close on overlay click
  document.getElementById('pod-viewer-overlay')?.addEventListener('click', function(e) {
    if (e.target === this) this.style.display = 'none';
  });
});