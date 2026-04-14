/**
 * rider.js — Delivery Rider Portal Controller
 *
 * Depends on (load before this file):
 *   shared/constants.js
 *   shared/utils.js
 *   shared/uiHelpers.js
 *   shared/apiService.js
 *
 * Responsibilities:
 *   • Owns `rSession` (logged-in user + cached orders/notifications)
 *   • All network calls go through apiGet / apiPost from apiService
 *   • All formatting delegated to utils.js
 *   • All toasts / accessible-modal helpers delegated to uiHelpers.js
 *   • Fully WCAG AA: focus trap, aria-hidden, live regions, aria-current
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════*/

const rSession = {
  user:          null,
  notifications: [],
  orders: {
    active:    [],
    completed: [],
  },
};

/** Per-modal state — reset on open. */
const rModal = {
  order:   null,   // currently open order object
  podData: null,   // base64 image data for POD
  podMime: null,
};

/** Confirm-dialog state. */
const rConfirm = {
  onOk:          null,
  previousFocus: null,
};

/* Cleanup references for focus traps — one per modal. */
let _orderModalCleanup    = null;
let _completeModalCleanup = null;
let _issueModalCleanup    = null;
let _issueOrderId         = null;

/* ════════════════════════════════════════════════════════════
   API SERVICE
═══════════════════════════════════════════════════════════════*/

const RIDER_API = 'api/rider_api.php';

const { apiGet, apiPost } = createApiService({
  baseUrl:     RIDER_API,
  callerKey:   'rider_id',
  getCallerId: () => rSession.user?.user_id ?? 0,
});

/* ── Toast shorthand (stacked toasts) ───────────────────── */
const toast = (msg, type = 'info') => showToastStack(msg, type, 'portal-toast-stack');

/* ════════════════════════════════════════════════════════════
   PAGE NAVIGATION
═══════════════════════════════════════════════════════════════*/

const PAGE_TITLES = {
  dashboard:   'Dashboard',
  active:      'Active Deliveries',
  history:     'Delivery History',
  performance: 'My Performance',
  settings:    'Settings',
};

function showPage(pageId) {
  document.querySelectorAll('.rider-page').forEach(p => {
    p.classList.remove('active');
    p.hidden = true;
  });
  document.querySelectorAll('.rider-nav-btn').forEach(b => {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });

  const page = document.getElementById('rider-page-' + pageId);
  if (page) {
    page.classList.add('active');
    page.hidden = false;
    page.focus();
  }

  const btn = document.querySelector(`.rider-nav-btn[data-page="${pageId}"]`);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-current', 'page');
  }

  const titleEl = document.getElementById('rider-topbar-title');
  if (titleEl) titleEl.textContent = PAGE_TITLES[pageId] || 'Rider Portal';

  closeMobileSidebar();

  if (pageId === 'dashboard')   loadDashboard();
  if (pageId === 'active')      loadActiveOrders();
  if (pageId === 'history')     loadHistory();
  if (pageId === 'performance') loadPerformance();
  if (pageId === 'settings')    loadSettings();
}

/* ════════════════════════════════════════════════════════════
   MOBILE SIDEBAR
═══════════════════════════════════════════════════════════════*/

function toggleMobileSidebar() {
  const sidebar = document.getElementById('portal-sidebar');
  const overlay = document.getElementById('portal-sidebar-overlay');
  const menuBtn = document.querySelector('.rider-menu-btn');
  const isOpen  = sidebar.classList.toggle('open');

  overlay.classList.toggle('open', isOpen);
  menuBtn?.setAttribute('aria-expanded', String(isOpen));

  if (isOpen) sidebar.querySelector('.rider-nav-btn')?.focus();
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('portal-sidebar');
  const overlay = document.getElementById('portal-sidebar-overlay');
  const menuBtn = document.querySelector('.rider-menu-btn');

  sidebar?.classList.remove('open');
  overlay?.classList.remove('open');
  menuBtn?.setAttribute('aria-expanded', 'false');
}

/* ════════════════════════════════════════════════════════════
   PASSWORD TOGGLE
═══════════════════════════════════════════════════════════════*/

function togglePasswordVisibility(btn) {
  const input   = document.getElementById('r-pass');
  const isShown = input.type === 'text';
  input.type    = isShown ? 'password' : 'text';
  btn.setAttribute('aria-pressed', String(!isShown));
  btn.setAttribute('aria-label',   isShown ? 'Show password' : 'Hide password');
}

/* ════════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════════*/

async function riderLogin() {
  const emailEl = document.getElementById('r-email');
  const passEl  = document.getElementById('r-pass');
  const errEl   = document.getElementById('r-login-error');
  const btn     = document.getElementById('r-login-btn');

  const email = emailEl.value.trim();
  const pass  = passEl.value;

  errEl.hidden      = true;
  errEl.textContent = '';

  if (!email || !pass) {
    errEl.textContent = 'Please enter your email and password.';
    errEl.hidden      = false;
    emailEl.focus();
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Signing in…';

  const data = await loginFetch(RIDER_API, email, pass);

  btn.disabled    = false;
  btn.textContent = 'Sign In';

  if (!data.success) {
    errEl.textContent = data.message || 'Login failed. Please try again.';
    errEl.hidden      = false;
    emailEl.focus();
    return;
  }

  if (data.user.role_name !== 'Delivery Rider') {
    errEl.textContent = 'This portal is for Delivery Riders only.';
    errEl.hidden      = false;
    emailEl.focus();
    return;
  }

  rSession.user = data.user;
  sessionStorage.setItem('rider_user', JSON.stringify(data.user));
  initRiderApp();
}

function riderLogout() {
  rSession.user = null;
  sessionStorage.removeItem('rider_user');

  document.getElementById('portal-app').hidden          = true;
  document.getElementById('portal-login-screen').hidden = false;
  document.getElementById('r-email').value             = '';
  document.getElementById('r-pass').value              = '';
  document.getElementById('r-email').focus();
}

/* ════════════════════════════════════════════════════════════
   APP INIT
═══════════════════════════════════════════════════════════════*/

function initRiderApp() {
  const u = rSession.user;
  document.getElementById('rider-user-name').textContent    =
    `${u.first_name} ${u.last_name}`;
  document.getElementById('rider-avatar-initial').textContent =
    (u.first_name?.[0] || 'R').toUpperCase();

  document.getElementById('portal-login-screen').hidden = true;
  document.getElementById('portal-app').hidden          = false;

  startClock('rider-clock');
  showPage('dashboard');

  pollNotifications();
  setInterval(pollNotifications, 30_000);

  // Silently refresh active orders every 60 s when that page is visible
  setInterval(() => {
    const activeBtn = document.querySelector('.rider-nav-btn[data-page="active"].active');
    if (activeBtn) loadActiveOrders(true);
  }, 60_000);

  // Cancellation poll — check active orders for mid-route cancellations every 30 s
  setInterval(pollCancellations, 30_000);
}

/* ════════════════════════════════════════════════════════════
   CANCELLATION POLLING
═══════════════════════════════════════════════════════════════*/

async function pollCancellations() {
  if (!rSession.user || !rSession.orders.active.length) return;
  const res = await apiGet('my_orders');
  if (!res.success) return;

  const freshOrders = res.data || [];
  const cancelledIds = [];

  rSession.orders.active.forEach(local => {
    const fresh = freshOrders.find(o => o.order_id === local.order_id);
    if (fresh && fresh.status === 'Cancelled') {
      cancelledIds.push({ id: local.order_id, num: local.order_number });
    }
  });

  if (cancelledIds.length) {
    // Remove cancelled from local cache
    rSession.orders.active = rSession.orders.active.filter(
      o => !cancelledIds.find(c => c.id === o.order_id));
    updateNavBadge(rSession.orders.active.length);
    cancelledIds.forEach(c => showCancellationAlert(c.num));
  }
}

function showCancellationAlert(orderNum) {
  // Remove any existing alert
  document.getElementById('cancellation-alert-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id    = 'cancellation-alert-overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'cancel-alert-title');
  overlay.setAttribute('aria-live', 'assertive');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(239,68,68,.92);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1.5rem';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:2rem;max-width:400px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4)">
      <div style="font-size:3rem;margin-bottom:.5rem" aria-hidden="true">🚨</div>
      <h2 id="cancel-alert-title" style="color:var(--error,#ef4444);margin:0 0 .75rem;font-size:1.4rem">
        ORDER CANCELLED
      </h2>
      <p style="font-size:1rem;margin-bottom:.5rem">
        <strong>Order ${escHtml(orderNum)}</strong> has been cancelled by the customer or admin.
      </p>
      <p style="font-size:1rem;font-weight:700;color:var(--error,#ef4444);margin-bottom:1.5rem">
        ⛔ ABORT THE DROP-OFF — Return all items to the hub immediately.
      </p>
      <button class="btn-primary" type="button"
        onclick="document.getElementById('cancellation-alert-overlay').remove();refreshCurrentPage();"
        style="min-width:160px">
        Understood — Return to Hub
      </button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('button').focus();
}

/* ════════════════════════════════════════════════════════════
   REFRESH HELPER
═══════════════════════════════════════════════════════════════*/

function refreshCurrentPage() {
  const active = document.querySelector('.rider-nav-btn.active')?.dataset.page;
  if (active === 'dashboard') loadDashboard();
  else if (active === 'active')  loadActiveOrders();
  else if (active === 'history') loadHistory();
}

/* ════════════════════════════════════════════════════════════
   DUTY STATUS TOGGLE
═══════════════════════════════════════════════════════════════*/

let _riderOnDuty = true;

async function toggleDutyStatus() {
  _riderOnDuty = !_riderOnDuty;
  const btn    = document.getElementById('rider-duty-toggle');
  const icon   = document.getElementById('rider-duty-icon');
  const label  = document.getElementById('rider-duty-label');

  if (btn) {
    btn.setAttribute('aria-pressed', String(_riderOnDuty));
    btn.setAttribute('aria-label', `Toggle duty status — currently ${_riderOnDuty ? 'On Duty' : 'Off Duty'}`);
  }
  if (icon)  icon.textContent  = _riderOnDuty ? '🟢' : '🔴';
  if (label) label.textContent = _riderOnDuty ? 'On Duty' : 'Off Duty';

  const res = await apiPost('set_duty_status', { on_duty: _riderOnDuty ? 1 : 0 });
  if (res.success) {
    toast(_riderOnDuty ? 'Status: On Duty ✅' : 'Status: Off Duty 🔴', 'info');
  } else {
    // Revert on failure
    _riderOnDuty = !_riderOnDuty;
    if (icon)  icon.textContent  = _riderOnDuty ? '🟢' : '🔴';
    if (label) label.textContent = _riderOnDuty ? 'On Duty' : 'Off Duty';
    toast(res.message || 'Failed to update duty status.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   NAV BADGE
═══════════════════════════════════════════════════════════════*/

function updateNavBadge(count) {
  const badge = document.getElementById('active-orders-badge');
  if (!badge) return;
  const n = count !== undefined
    ? count
    : rSession.orders.active.filter(o =>
        ['Packed', 'Out for Delivery', 'Arrived at Location'].includes(o.status)).length;
  badge.textContent = n > 0 ? String(n) : '';
  badge.setAttribute('aria-label', n > 0 ? `${n} active orders` : '');
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════*/

async function loadDashboard() {
  const summaryEl  = document.getElementById('dash-summary-bar');
  const urgentEl   = document.getElementById('dash-urgent-list');
  const shiftEl    = document.getElementById('dash-shift-summary');
  summaryEl.innerHTML = spinnerHTML('Loading summary');
  urgentEl.innerHTML  = spinnerHTML('Loading deliveries');

  const [sumRes, ordRes] = await Promise.all([
    apiGet('summary'),
    apiGet('my_orders'),
  ]);

  // Summary pills
  if (sumRes.success) {
    const s = sumRes.data;
    summaryEl.innerHTML =
      statPillHTML('pill-orange', '🚴', s.in_transit      || 0, 'In Transit')      +
      statPillHTML('pill-blue',   '📦', s.pending_pickup  || 0, 'Pending Pickup')  +
      statPillHTML('pill-green',  '✅', s.completed       || 0, 'Delivered Today') +
      statPillHTML('pill-money',  '💰', fmtPrice(s.collected_today), 'Collected Today');
  } else {
    summaryEl.innerHTML = errorHTML(sumRes.message);
  }

  // Shift Summary — COD vs GCash/Prepaid breakdown
  if (shiftEl && ordRes.success) {
    const completed = (ordRes.data || []).filter(o => o.status === 'Completed');
    let codTotal     = 0;
    let gcashTotal   = 0;
    let prepaidTotal = 0;
    completed.forEach(o => {
      const amt = parseFloat(o.final_total ?? o.estimated_total ?? 0);
      if (o.payment_method === 'COD' || o.payment_method === 'Cash on Delivery') codTotal += amt;
      else if (o.payment_method === 'GCash') gcashTotal += amt;
      else prepaidTotal += amt;
    });
    shiftEl.innerHTML = `
      <div class="shift-summary-card" aria-label="Shift cash summary"
        style="background:var(--surface,#fff);border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:1rem;margin-bottom:1.25rem">
        <h4 style="margin:0 0 .75rem;font-size:.9rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#6b7280)">
          <span aria-hidden="true">💼</span> Shift Summary — Today's Collections
        </h4>
        <div style="display:flex;gap:1rem;flex-wrap:wrap">
          <div style="flex:1;min-width:140px;padding:.75rem;background:var(--warning-light,#fef3c7);border-radius:8px;text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:#92400e">${fmtPrice(codTotal)}</div>
            <div style="font-size:.8rem;color:#92400e;font-weight:600">💵 Cash (COD) — Hand to Hub</div>
          </div>
          <div style="flex:1;min-width:140px;padding:.75rem;background:#e0f2fe;border-radius:8px;text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:#0369a1">${fmtPrice(gcashTotal)}</div>
            <div style="font-size:.8rem;color:#0369a1;font-weight:600">💙 GCash — Digital</div>
          </div>
          ${prepaidTotal > 0 ? `
          <div style="flex:1;min-width:140px;padding:.75rem;background:#d1fae5;border-radius:8px;text-align:center">
            <div style="font-size:1.4rem;font-weight:700;color:#065f46">${fmtPrice(prepaidTotal)}</div>
            <div style="font-size:.8rem;color:#065f46;font-weight:600">✅ Prepaid — No Collection</div>
          </div>` : ''}
        </div>
      </div>`;
  }

  // Active delivery cards
  if (ordRes.success) {
    const active = (ordRes.data || []).filter(o =>
      ['Packed', 'Out for Delivery', 'Arrived at Location'].includes(o.status));
    rSession.orders.active = active;
    urgentEl.innerHTML = active.length === 0
      ? emptyStateHTML('🎉', 'All clear!', 'No active deliveries right now. Check back soon.')
      : active.map(renderDeliveryCard).join('');
  } else {
    urgentEl.innerHTML = errorHTML(ordRes.message);
  }

  updateNavBadge();
}

/* ════════════════════════════════════════════════════════════
   ACTIVE ORDERS PAGE
═══════════════════════════════════════════════════════════════*/

async function loadActiveOrders(silent = false) {
  const listEl  = document.getElementById('active-orders-list');
  const dateVal = document.getElementById('active-date-filter')?.value || '';
  const tabVal  = document.getElementById('active-tab-value')?.value   || '';

  if (!silent) listEl.innerHTML = spinnerHTML('Loading orders');

  const params = { action: 'my_orders' };
  if (dateVal)                       params.date   = dateVal;
  if (tabVal && tabVal !== 'all')    params.status = tabVal;

  const res = await apiGet('my_orders', params);
  if (!res.success) { listEl.innerHTML = errorHTML(res.message); return; }

  const orders = (res.data || []).filter(
    o => o.status !== 'Completed' && o.status !== 'Cancelled');
  rSession.orders.active = orders;
  updateNavBadge(orders.length);

  if (!orders.length) {
    listEl.innerHTML = emptyStateHTML('📭', 'No active deliveries', 'You have no deliveries matching this filter.');
    return;
  }

  // Group by zone_barangay (fall back to barangay field)
  const groups = {};
  orders.forEach(o => {
    const zone = o.zone_barangay || o.barangay || 'Unassigned Zone';
    if (!groups[zone]) groups[zone] = [];
    groups[zone].push(o);
  });

  listEl.innerHTML = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([zone, zoneOrders]) => `
      <div class="zone-group" aria-label="Zone: ${escHtml(zone)}">
        <h4 class="zone-group-heading" style="margin:1rem 0 .4rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#6b7280);border-bottom:1px solid var(--border,#e5e7eb);padding-bottom:.25rem">
          <span aria-hidden="true">📍</span> ${escHtml(zone)} (${zoneOrders.length})
        </h4>
        ${zoneOrders.map(renderDeliveryCard).join('')}
      </div>`)
    .join('');
}

/* Tab filter */
function setActiveTab(status) {
  document.getElementById('active-tab-value').value = status;
  document.querySelectorAll('#active-status-tabs .tab-btn').forEach(b => {
    const selected = b.dataset.tab === status;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-selected', String(selected));
  });
  loadActiveOrders();
}

/* ════════════════════════════════════════════════════════════
   DELIVERY HISTORY
═══════════════════════════════════════════════════════════════*/

async function loadHistory() {
  const tbodyEl  = document.getElementById('history-tbody');
  const dateFrom = document.getElementById('hist-date-from')?.value || '';
  const dateTo   = document.getElementById('hist-date-to')?.value   || '';

  tbodyEl.innerHTML = `<tr><td colspan="7">${spinnerHTML('Loading history')}</td></tr>`;

  const res = await apiGet('my_orders', { status: 'Completed' });
  if (!res.success) {
    tbodyEl.innerHTML = `<tr><td colspan="7">${errorHTML(res.message)}</td></tr>`;
    return;
  }

  let orders = res.data || [];
  if (dateFrom) orders = orders.filter(o => o.delivery_date >= dateFrom);
  if (dateTo)   orders = orders.filter(o => o.delivery_date <= dateTo);
  rSession.orders.completed = orders;

  if (!orders.length) {
    tbodyEl.innerHTML =
      `<tr><td colspan="7">${emptyStateHTML('📋', '', 'No completed deliveries found.')}</td></tr>`;
    return;
  }

  tbodyEl.innerHTML = orders.map(o => `
    <tr>
      <td class="order-num">${escHtml(o.order_number)}</td>
      <td>${escHtml(o.first_name + ' ' + o.last_name)}</td>
      <td>${escHtml(o.barangay + ', ' + o.city)}</td>
      <td>${fmtDate(o.delivery_date)}</td>
      <td>${statusBadge(o.status)}</td>
      <td>
        <strong>${fmtPrice(o.final_total ?? o.estimated_total)}</strong><br>
        <small>${payBadge(o.pay_status)}</small>
      </td>
      <td>
        <button class="btn-outline btn-sm"
          onclick="openOrderModal(${o.order_id})"
          aria-label="View details for order ${escHtml(o.order_number)}"
          type="button">View</button>
      </td>
    </tr>`).join('');
}

/* ── Pay badge helper ───────────────────────────────────── */
function payBadge(payStatus) {
  const safe = payStatus || 'Unpaid';
  return `<span class="pay-status-badge pay-status-${safe}" aria-label="Payment status: ${safe}">${safe}</span>`;
}

/* ════════════════════════════════════════════════════════════
   DELIVERY CARD RENDERING
═══════════════════════════════════════════════════════════════*/

/** Check if the order's time-slot window has already passed. */
function timeWindowWarning(o) {
  const endTimeStr = o.slot_end_time || '';
  if (!endTimeStr || !isToday(o.delivery_date)) return '';
  const [h, m] = endTimeStr.split(':').map(Number);
  const endDate = new Date();
  endDate.setHours(h, m, 0, 0);
  if (new Date() > endDate) {
    return `
      <div class="time-window-warning" role="alert" aria-live="assertive">
        <span aria-hidden="true">⏰</span>
        <strong>Time window passed</strong> — Customer's slot ended at ${fmtTime12(endTimeStr)}.
      </div>`;
  }
  return '';
}

function renderDeliveryCard(o) {
  const urgent   = isUrgent(o.delivery_date);
  const priority = ['Out for Delivery', 'Arrived at Location'].includes(o.status)
    ? 'priority-active'
    : urgent ? 'priority-urgent' : 'priority-normal';

  const finalAmt   = o.final_total ?? o.estimated_total;
  const mapsUrl    = buildMapsUrl(o);
  const actionBtns = renderCardActions(o);

  return `
    <article class="delivery-card ${priority}" aria-labelledby="card-title-${o.order_id}">
      ${timeWindowWarning(o)}
      <div class="delivery-card-header">
        <span class="delivery-order-num" id="card-title-${o.order_id}">${escHtml(o.order_number)}</span>
        ${statusBadge(o.status)}
        ${o.slot_label
          ? `<span class="delivery-slot-badge"><span aria-hidden="true">🕐</span> ${escHtml(o.slot_label)}</span>`
          : ''}
        ${urgent
          ? `<span class="delivery-urgency-badge" aria-label="Urgency: ${deliveryLabel(o.delivery_date)}">
               <span aria-hidden="true">⚡</span> ${deliveryLabel(o.delivery_date)}
             </span>`
          : `<span class="delivery-slot-badge" aria-label="Delivery date: ${deliveryLabel(o.delivery_date)}">
               ${deliveryLabel(o.delivery_date)}
             </span>`}
        <div class="delivery-card-header-actions">
          <button class="btn-outline btn-sm" type="button"
            onclick="openOrderModal(${o.order_id})"
            aria-label="View details for order ${escHtml(o.order_number)}">Details</button>
        </div>
      </div>

      <div class="delivery-card-body">
        <div class="delivery-customer-col">
          <div class="delivery-col-label" aria-hidden="true">Customer</div>
          <div class="delivery-customer-name">${escHtml(o.first_name + ' ' + o.last_name)}</div>
          <div class="delivery-customer-phone">
            ${o.phone ? `
              <a href="tel:${escHtml(o.phone)}" class="btn-outline btn-sm"
                style="margin-right:.25rem"
                aria-label="Call ${escHtml(o.first_name)} at ${escHtml(o.phone)}">
                <span aria-hidden="true">📞</span> Call
              </a>
              <a href="sms:${escHtml(o.phone)}" class="btn-outline btn-sm"
                aria-label="Send SMS to ${escHtml(o.first_name)} at ${escHtml(o.phone)}">
                <span aria-hidden="true">💬</span> SMS
              </a>
              <span class="sr-only">${escHtml(o.phone)}</span>
            ` : `<span class="text-muted">No phone</span>`}
          </div>
        </div>

        <div class="delivery-address-col">
          <div class="delivery-col-label" aria-hidden="true">Delivery Address</div>
          <address class="delivery-address-text">
            ${escHtml(o.street)},<br>
            ${escHtml(o.barangay)}, ${escHtml(o.city)},<br>
            ${escHtml(o.province)}
          </address>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.35rem">
            <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer"
              class="btn-outline btn-sm delivery-map-link"
              aria-label="Navigate to order ${escHtml(o.order_number)} in Google Maps (opens new tab)">
              <span aria-hidden="true">🗺️</span> Google Maps
            </a>
            <a href="https://waze.com/ul?q=${encodeURIComponent([o.street,o.barangay,o.city,o.province].filter(Boolean).join(', '))}&navigate=yes"
              target="_blank" rel="noopener noreferrer"
              class="btn-outline btn-sm"
              aria-label="Navigate to order ${escHtml(o.order_number)} in Waze (opens new tab)">
              <span aria-hidden="true">🚗</span> Waze
            </a>
          </div>
        </div>
      </div>

      <div class="delivery-card-footer">
        <div>
          <div class="delivery-total" aria-label="Order total: ${fmtPrice(finalAmt)}">
            ${fmtPrice(finalAmt)}
          </div>
          <div class="delivery-pay-method">
            <span aria-hidden="true">${payIcon(o.payment_method)}</span>
            ${escHtml(o.payment_method)} · ${payBadge(o.pay_status)}
          </div>
        </div>
        <div class="delivery-footer-actions">${actionBtns}</div>
      </div>
    </article>`;
}

/** Render action buttons appropriate for the order's current status. */
function renderCardActions(o) {
  const num = escHtml(o.order_number);

  if (o.status === 'Packed') {
    return `
      <button class="btn-primary btn-sm" type="button"
        onclick="confirmStartDelivery(${o.order_id}, '${num}')"
        aria-label="Start delivery for order ${num}">
        <span aria-hidden="true">🚴</span> Start Delivery
      </button>`;
  }

  if (o.status === 'Out for Delivery') {
    return `
      <button class="btn-outline btn-sm" type="button"
        onclick="undoStatus(${o.order_id}, 'Packed', '${num}')"
        aria-label="Undo — revert order ${num} back to Packed">
        <span aria-hidden="true">↩️</span> Undo
      </button>
      <button class="btn-outline btn-sm" type="button"
        onclick="markArrived(${o.order_id})"
        aria-label="Mark arrived at location for order ${num}">
        <span aria-hidden="true">📍</span> Mark Arrived
      </button>
      <button class="btn-primary btn-sm" type="button"
        onclick="openCompleteModal(${o.order_id})"
        aria-label="Complete delivery for order ${num}">
        <span aria-hidden="true">✅</span> Complete
      </button>
      <button class="btn-danger btn-sm" type="button"
        onclick="openIssueModal(${o.order_id})"
        aria-label="Report failed delivery for order ${num}">
        <span aria-hidden="true">⚠️</span> Report Issue
      </button>`;
  }

  if (o.status === 'Arrived at Location') {
    return `
      <button class="btn-outline btn-sm" type="button"
        onclick="undoStatus(${o.order_id}, 'Out for Delivery', '${num}')"
        aria-label="Undo — revert order ${num} back to Out for Delivery">
        <span aria-hidden="true">↩️</span> Undo
      </button>
      <button class="btn-primary btn-sm" type="button"
        onclick="openCompleteModal(${o.order_id})"
        aria-label="Complete delivery for order ${num}">
        <span aria-hidden="true">✅</span> Complete Delivery
      </button>
      <button class="btn-danger btn-sm" type="button"
        onclick="openIssueModal(${o.order_id})"
        aria-label="Report failed delivery for order ${num}">
        <span aria-hidden="true">⚠️</span> Report Issue
      </button>`;
  }

  return '';
}

/* ════════════════════════════════════════════════════════════
   ORDER DETAIL MODAL
═══════════════════════════════════════════════════════════════*/

async function openOrderModal(orderId) {
  const body = document.getElementById('rider-modal-body');
  body.innerHTML = spinnerHTML('Loading order details');
  _orderModalCleanup = openAccessibleModal('rider-order-modal-overlay', 'rider-modal-close');

  const res = await apiGet('order', { id: orderId });
  if (!res.success) { body.innerHTML = errorHTML(res.message); return; }

  const o    = res.data;
  rModal.order = o;

  const finalAmt = o.final_total ?? o.estimated_total;
  const mapsUrl  = buildMapsUrl(o);

  const itemRows = (o.items || []).map(item => `
    <tr>
      <td class="item-name-cell">${escHtml(item.name)}</td>
      <td>${escHtml(String(item.quantity))}</td>
      <td>${item.price_per_kg ? fmtPrice(item.price_per_kg) + '/kg' : '—'}</td>
      <td class="item-weight-actual">
        ${item.actual_weight
          ? parseFloat(item.actual_weight).toFixed(3) + ' kg'
          : '<span class="text-muted">—</span>'}
      </td>
      <td class="text-right">
        <strong>${fmtPrice(item.final_subtotal ?? item.estimated_subtotal)}</strong>
      </td>
    </tr>`).join('');

  body.innerHTML = `
    <section class="detail-section" aria-labelledby="detail-status-title">
      <h3 class="detail-section-title" id="detail-status-title">Order Status</h3>
      ${detailRow('Status', statusBadge(o.status))}
      ${detailRow('Delivery Date', fmtDate(o.delivery_date))}
      ${o.slot_label ? detailRow('Time Slot', `<span aria-hidden="true">🕐</span> ${escHtml(o.slot_label)}`) : ''}
      ${o.dispatched_at ? detailRow('Dispatched', fmtDateTime(o.dispatched_at)) : ''}
    </section>

    <section class="detail-section" aria-labelledby="detail-customer-title">
      <h3 class="detail-section-title" id="detail-customer-title">Customer</h3>
      ${detailRow('Name', escHtml(o.first_name + ' ' + o.last_name))}
      ${detailRow('Phone', o.phone ? `
        <a href="tel:${escHtml(o.phone)}" class="btn-outline btn-sm" style="margin-right:.25rem"
          aria-label="Call ${escHtml(o.first_name)} at ${escHtml(o.phone)}">
          <span aria-hidden="true">📞</span> Call
        </a>
        <a href="sms:${escHtml(o.phone)}" class="btn-outline btn-sm"
          aria-label="Send SMS to ${escHtml(o.first_name)} at ${escHtml(o.phone)}">
          <span aria-hidden="true">💬</span> SMS
        </a>
        <span style="margin-left:.5rem;color:var(--text-muted,#6b7280);font-size:.85rem">${escHtml(o.phone)}</span>
      ` : '—')}
    </section>

    <section class="detail-section" aria-labelledby="detail-address-title">
      <h3 class="detail-section-title" id="detail-address-title">Delivery Address</h3>
      <address class="detail-address">
        ${escHtml(o.street)},<br>
        ${escHtml(o.barangay)}, ${escHtml(o.city)}<br>
        ${escHtml(o.province)}
      </address>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem">
        <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer"
          class="btn-outline btn-sm delivery-map-link"
          aria-label="Navigate in Google Maps (opens new tab)">
          <span aria-hidden="true">🗺️</span> Google Maps
        </a>
        <a href="https://waze.com/ul?q=${encodeURIComponent([o.street,o.barangay,o.city,o.province].filter(Boolean).join(', '))}&navigate=yes"
          target="_blank" rel="noopener noreferrer"
          class="btn-outline btn-sm"
          aria-label="Navigate in Waze (opens new tab)">
          <span aria-hidden="true">🚗</span> Waze
        </a>
      </div>
      ${o.special_instructions ? `
        <div class="detail-row" style="margin-top:.5rem">
          <span class="detail-row-label">Special Instructions</span>
          <span class="detail-row-value special-instructions">
            ${escHtml(o.special_instructions)}
          </span>
        </div>` : ''}
    </section>

    <section class="detail-section" aria-labelledby="detail-items-title">
      <h3 class="detail-section-title" id="detail-items-title">Order Items</h3>
      <div class="rider-table-wrap" tabindex="0" role="region" aria-label="Order items table">
        <table class="order-items-table" aria-label="Items in this order">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Qty</th>
              <th scope="col">Price</th>
              <th scope="col">Actual Wt.</th>
              <th scope="col" class="text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
      </div>
    </section>

    <section class="detail-section" aria-labelledby="detail-payment-title">
      <h3 class="detail-section-title" id="detail-payment-title">Payment Summary</h3>
      ${o.estimated_total !== o.final_total && o.final_total
        ? detailRow('Est. Subtotal', fmtPrice(o.estimated_total)) : ''}
      ${parseFloat(o.discount_amount) > 0
        ? detailRow(
            `Discount${o.promo_code ? ' (' + escHtml(o.promo_code) + ')' : ''}`,
            `<span style="color:var(--error)">−${fmtPrice(o.discount_amount)}</span>`)
        : ''}
      ${parseFloat(o.delivery_fee) > 0
        ? detailRow('Delivery Fee', fmtPrice(o.delivery_fee)) : ''}
      <div class="detail-row total-row"
        aria-label="${o.final_total ? 'Final' : 'Estimated'} total: ${fmtPrice(finalAmt)}">
        <span class="detail-row-label">${o.final_total ? 'Final Total' : 'Estimated Total'}</span>
        <span class="detail-row-value">${fmtPrice(finalAmt)}</span>
      </div>
      ${detailRow('Payment Method', `<span aria-hidden="true">${payIcon(o.payment_method)}</span> ${escHtml(o.payment_method)}`)}
      ${detailRow('Payment Status', payBadge(o.pay_status))}
    </section>

    ${o.proof_of_delivery_url ? `
    <section class="detail-section" aria-labelledby="detail-pod-title">
      <h3 class="detail-section-title" id="detail-pod-title">Proof of Delivery</h3>
      <img src="${escHtml(o.proof_of_delivery_url)}"
        alt="Proof of delivery photo for order ${escHtml(o.order_number)}"
        class="pod-image">
    </section>` : ''}`;

  renderModalFooter(o);
  document.getElementById('rider-modal-title').textContent = 'Order ' + o.order_number;
}

function renderModalFooter(o) {
  const footer  = document.getElementById('rider-modal-footer');
  const actions = [];

  if (o.status === 'Packed') {
    actions.push(`
      <button class="btn-primary" type="button"
        onclick="confirmStartDelivery(${o.order_id}, '${escHtml(o.order_number)}')">
        <span aria-hidden="true">🚴</span> Start Delivery
      </button>`);
  }
  if (o.status === 'Out for Delivery') {
    actions.push(`
      <button class="btn-outline" type="button"
        onclick="undoStatus(${o.order_id}, 'Packed', '${escHtml(o.order_number)}')">
        <span aria-hidden="true">↩️</span> Undo
      </button>
      <button class="btn-outline" type="button" onclick="markArrived(${o.order_id})">
        <span aria-hidden="true">📍</span> Mark Arrived
      </button>
      <button class="btn-primary" type="button" onclick="openCompleteModal(${o.order_id})">
        <span aria-hidden="true">✅</span> Complete Delivery
      </button>
      <button class="btn-danger" type="button" onclick="openIssueModal(${o.order_id})">
        <span aria-hidden="true">⚠️</span> Report Issue
      </button>`);
  }
  if (o.status === 'Arrived at Location') {
    actions.push(`
      <button class="btn-outline" type="button"
        onclick="undoStatus(${o.order_id}, 'Out for Delivery', '${escHtml(o.order_number)}')">
        <span aria-hidden="true">↩️</span> Undo
      </button>
      <button class="btn-primary" type="button" onclick="openCompleteModal(${o.order_id})">
        <span aria-hidden="true">✅</span> Complete Delivery
      </button>
      <button class="btn-danger" type="button" onclick="openIssueModal(${o.order_id})">
        <span aria-hidden="true">⚠️</span> Report Issue
      </button>`);
  }

  footer.innerHTML = `
    <button class="btn-outline" type="button" onclick="closeOrderModal()">Close</button>
    ${actions.join('')}`;
}

function closeOrderModal() {
  closeAccessibleModal('rider-order-modal-overlay', document.activeElement, _orderModalCleanup);
  _orderModalCleanup = null;
  rModal.order   = null;
  rModal.podData = null;
  rModal.podMime = null;
}

/* ════════════════════════════════════════════════════════════
   ACTION: START DELIVERY  (Packed → Out for Delivery)
═══════════════════════════════════════════════════════════════*/

function confirmStartDelivery(orderId, orderNum) {
  document.getElementById('rider-confirm-title').textContent  = 'Start Delivery';
  document.getElementById('rider-confirm-body').textContent   =
    `Are you ready to pick up and deliver Order ${orderNum}?`;
  document.getElementById('rider-confirm-icon').textContent   = '🚴';
  document.getElementById('rider-confirm-amount').hidden      = true;
  document.getElementById('rider-confirm-ok').textContent     = 'Yes, Start';
  document.getElementById('rider-confirm-ok').className       = 'btn-primary';

  rConfirm.previousFocus = document.activeElement;
  rConfirm.onOk          = async () => {
    closeConfirm();
    await updateOrderStatus(orderId, 'Out for Delivery');
  };

  openAccessibleModal('rider-confirm-overlay', 'rider-confirm-ok');
}

/* ════════════════════════════════════════════════════════════
   ACTION: MARK ARRIVED  (Out for Delivery → Arrived at Location)
═══════════════════════════════════════════════════════════════*/

async function markArrived(orderId) {
  await updateOrderStatus(orderId, 'Arrived at Location');
}

/* ════════════════════════════════════════════════════════════
   ACTION: UNDO  (revert to a previous status)
═══════════════════════════════════════════════════════════════*/

function undoStatus(orderId, targetStatus, orderNum) {
  document.getElementById('rider-confirm-title').textContent  = 'Undo Status';
  document.getElementById('rider-confirm-body').textContent   =
    `Revert Order ${orderNum} back to "${targetStatus}"?`;
  document.getElementById('rider-confirm-icon').textContent   = '↩️';
  document.getElementById('rider-confirm-amount').hidden      = true;
  document.getElementById('rider-confirm-ok').textContent     = 'Yes, Undo';
  document.getElementById('rider-confirm-ok').className       = 'btn-outline';

  rConfirm.previousFocus = document.activeElement;
  rConfirm.onOk          = async () => {
    closeConfirm();
    await updateOrderStatus(orderId, targetStatus);
  };

  openAccessibleModal('rider-confirm-overlay', 'rider-confirm-ok');
}

/* ════════════════════════════════════════════════════════════
   GENERIC STATUS UPDATE
═══════════════════════════════════════════════════════════════*/

async function updateOrderStatus(orderId, newStatus) {
  const res = await apiPost('update_status', { order_id: orderId, status: newStatus });
  if (res.success) {
    toast(res.message || `Status updated to ${newStatus}.`, 'success');
    closeOrderModal();
    refreshCurrentPage();
  } else {
    toast(res.message || 'Failed to update status.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   COMPLETE DELIVERY MODAL  (POD upload + confirmation)
═══════════════════════════════════════════════════════════════*/

function openCompleteModal(orderId) {
  const order = rSession.orders.active.find(o => o.order_id == orderId)
             || (rModal.order?.order_id == orderId ? rModal.order : null);

  closeOrderModal();

  // Require barcode scan confirmation before opening modal
  const scanKey = `scan_confirmed_${orderId}`;
  if (!sessionStorage.getItem(scanKey)) {
    showScanGuard(orderId, order, () => {
      sessionStorage.setItem(scanKey, '1');
      if (!order) openCompleteModalFetch(orderId);
      else _renderCompleteModal(order);
    });
    return;
  }

  if (!order) {
    openCompleteModalFetch(orderId);
    return;
  }
  _renderCompleteModal(order);
}

function showScanGuard(orderId, order, onConfirmed) {
  const orderNum = order?.order_number || String(orderId);
  // Build a lightweight inline scan-guard overlay
  const overlay = document.createElement('div');
  overlay.id    = 'scan-guard-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'scan-guard-title');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  overlay.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:14px;padding:1.5rem;max-width:420px;width:100%;text-align:center">
      <div style="font-size:2rem;margin-bottom:.5rem" aria-hidden="true">📦</div>
      <h2 id="scan-guard-title" style="margin:0 0 .5rem;font-size:1.1rem">Scan Package Barcode</h2>
      <p style="font-size:.9rem;color:var(--text-muted,#6b7280);margin-bottom:1rem">
        Scan the thermal label on the package to confirm this is Order <strong>${escHtml(orderNum)}</strong>.
      </p>
      <input id="scan-guard-input" type="text" class="form-input"
        placeholder="Scan barcode or enter order number…"
        style="text-align:center;font-size:1.1rem;letter-spacing:.05em;margin-bottom:.75rem"
        autocomplete="off" autofocus>
      <p id="scan-guard-error" style="color:var(--error,#ef4444);font-size:.85rem;min-height:1.2em"></p>
      <div style="display:flex;gap:.5rem;justify-content:center;margin-top:.5rem">
        <button class="btn-outline" type="button" onclick="document.getElementById('scan-guard-overlay').remove()">
          Cancel
        </button>
        <button class="btn-primary" type="button" id="scan-guard-confirm">
          <span aria-hidden="true">✅</span> Confirm Scan
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input   = overlay.querySelector('#scan-guard-input');
  const errEl   = overlay.querySelector('#scan-guard-error');
  const confirm = overlay.querySelector('#scan-guard-confirm');
  input.focus();

  function validate() {
    const val = input.value.trim();
    if (!val) { errEl.textContent = 'Please scan or enter the barcode.'; return; }
    // Accept the order number itself, the numeric order_id, or any value containing them
    if (val === orderNum || val === String(orderId) || val.includes(orderNum) || val.includes(String(orderId))) {
      overlay.remove();
      onConfirmed();
    } else {
      errEl.textContent = `Barcode does not match Order ${orderNum}. Check the label and try again.`;
      input.value = '';
      input.focus();
    }
  }
  confirm.addEventListener('click', validate);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') validate(); });
}

async function openCompleteModalFetch(orderId) {
  const res = await apiGet('order', { id: orderId });
  if (res.success) _renderCompleteModal(res.data);
  else toast(res.message || 'Could not load order.', 'error');
}

function _renderCompleteModal(o) {
  rModal.order   = o;
  rModal.podData = null;
  rModal.podMime = null;

  const finalAmt = o.final_total ?? o.estimated_total;
  const body     = document.getElementById('rider-complete-modal-body');
  const footer   = document.getElementById('rider-complete-modal-footer');

  document.getElementById('rider-complete-modal-title').textContent =
    'Complete — ' + o.order_number;

  const isCOD            = o.payment_method === 'COD' || o.payment_method === 'Cash on Delivery';
  const isGCash          = o.payment_method === 'GCash';
  const gcashUnverified  = isGCash && (o.pay_status === 'Unverified' || o.pay_status === 'Pending');

  body.innerHTML = `
    <section class="detail-section" aria-labelledby="complete-amount-title">
      <h3 class="detail-section-title" id="complete-amount-title">Amount to Collect</h3>
      <div class="rider-confirm-amount" style="display:block;margin-bottom:0">
        <div class="amount-label">
          ${escHtml(o.final_total ? 'Final Total' : 'Estimated Total')} ·
          <span aria-hidden="true">${payIcon(o.payment_method)}</span> ${escHtml(o.payment_method)}
        </div>
        <div class="amount-value" aria-label="Amount: ${fmtPrice(finalAmt)}">${fmtPrice(finalAmt)}</div>
      </div>
      ${isCOD ? `
        <div class="cod-collect-banner" role="alert" aria-live="assertive"
          style="background:var(--warning,#f59e0b);color:#000;border-radius:8px;padding:1rem;margin-top:.75rem;font-size:1.1rem;font-weight:700;text-align:center;">
          <span aria-hidden="true">💵</span>
          COLLECT CASH: <span style="font-size:1.4rem">${fmtPrice(finalAmt)}</span>
          <div style="font-size:.85rem;font-weight:400;margin-top:.25rem">
            Hand the customer their items only after collecting the exact amount above.
          </div>
        </div>` : ''}
      ${gcashUnverified ? `
        <div class="gcash-unverified-warning" role="alert" aria-live="assertive"
          style="background:var(--error,#ef4444);color:#fff;border-radius:8px;padding:1rem;margin-top:.75rem;font-weight:600;text-align:center;">
          <span aria-hidden="true">🚫</span>
          GCash payment is <strong>UNVERIFIED</strong>.<br>
          <span style="font-size:.9rem;font-weight:400">Do NOT hand over the package.<br>Contact admin for payment clearance before proceeding.</span>
        </div>` : ''}
      ${isGCash && !gcashUnverified ? `
        <div class="gcash-notice" role="note">
          <span aria-hidden="true">💙</span>
          <strong>GCash order:</strong> Payment verified. Do <em>not</em> collect cash.
        </div>` : ''}
      ${!o.final_total ? `
        <p class="estimated-warning" role="note">
          <span aria-hidden="true">⚠️</span>
          Final weight not yet recorded. Collect the estimated amount; it will be reconciled by staff.
        </p>` : ''}
    </section>

    <section class="detail-section" aria-labelledby="pod-section-title">
      <h3 class="detail-section-title" id="pod-section-title">
        Proof of Delivery
        <span class="optional-label" aria-hidden="true">(optional but recommended)</span>
      </h3>

      <!-- POD tab switcher -->
      <div role="tablist" aria-label="Proof of delivery method" style="display:flex;gap:.5rem;margin-bottom:.75rem">
        <button class="tab-btn btn-outline btn-sm active" role="tab" aria-selected="true"
          id="pod-tab-photo" aria-controls="pod-panel-photo"
          onclick="switchPodTab('photo')" type="button">
          <span aria-hidden="true">📷</span> Photo
        </button>
        <button class="tab-btn btn-outline btn-sm" role="tab" aria-selected="false"
          id="pod-tab-sig" aria-controls="pod-panel-sig"
          onclick="switchPodTab('sig')" type="button">
          <span aria-hidden="true">✍️</span> Signature
        </button>
      </div>

      <!-- Photo tab -->
      <div id="pod-panel-photo" role="tabpanel" aria-labelledby="pod-tab-photo">
        <div id="pod-upload-area" class="pod-upload-area"
          role="button" tabindex="0"
          aria-label="Upload proof of delivery photo. Click or press Enter to browse."
          onclick="document.getElementById('pod-file-input').click()"
          onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('pod-file-input').click()}"
          ondragover="event.preventDefault();this.classList.add('dragover')"
          ondragleave="this.classList.remove('dragover')"
          ondrop="handlePodDrop(event)">
          <span class="pod-upload-icon" aria-hidden="true">📷</span>
          <p class="pod-upload-text">
            <strong>Click or drag</strong> to upload a photo<br>
            <small>JPG, PNG, HEIC — max 15 MB (auto-compressed)</small>
          </p>
        </div>
        <input type="file" id="pod-file-input" accept="image/*" class="sr-only"
          aria-label="Select proof of delivery image"
          onchange="handlePodFileChange(event)">
        <div id="pod-preview" class="pod-preview" aria-live="polite" hidden>
          <img id="pod-preview-img" src="" alt="Proof of delivery preview">
          <button class="pod-preview-remove" type="button"
            onclick="removePod()" aria-label="Remove proof of delivery photo">
            <span aria-hidden="true">🗑️</span> Remove photo
          </button>
        </div>
      </div>

      <!-- Signature tab -->
      <div id="pod-panel-sig" role="tabpanel" aria-labelledby="pod-tab-sig" hidden>
        <p style="font-size:.85rem;color:var(--text-muted,#6b7280);margin-bottom:.5rem">
          Ask the customer to sign below with their finger.
        </p>
        <canvas id="pod-sig-canvas"
          style="width:100%;height:180px;border:2px solid var(--border,#e5e7eb);border-radius:8px;background:#fff;touch-action:none;cursor:crosshair"
          aria-label="Customer signature pad"
          width="600" height="180">
        </canvas>
        <div style="display:flex;gap:.5rem;margin-top:.5rem">
          <button class="btn-outline btn-sm" type="button" onclick="clearSignaturePad()">
            <span aria-hidden="true">🗑️</span> Clear
          </button>
          <button class="btn-primary btn-sm" type="button" onclick="captureSignature()">
            <span aria-hidden="true">✅</span> Use Signature
          </button>
        </div>
        <p id="sig-capture-status" style="font-size:.85rem;margin-top:.4rem" aria-live="polite"></p>
      </div>
    </section>

    <p id="complete-error" class="form-error" role="alert" aria-live="assertive" hidden></p>`;

  const _gcashLocked = (o.payment_method === 'GCash') &&
    (o.pay_status === 'Unverified' || o.pay_status === 'Pending');

  footer.innerHTML = `
    <button class="btn-outline" type="button" onclick="closeCompleteModal()">Cancel</button>
    <button class="btn-primary" id="complete-confirm-btn" type="button"
      onclick="submitCompleteOrder()"
      ${_gcashLocked ? 'disabled aria-disabled="true"' : ''}>
      <span aria-hidden="true">✅</span> Confirm Delivery Complete
    </button>
    ${_gcashLocked ? `
      <p role="alert" style="width:100%;text-align:center;color:var(--error,#ef4444);font-size:.85rem;margin-top:.5rem">
        <span aria-hidden="true">🔒</span> Contact Admin for Payment Clearance
      </p>` : ''}`;

  _completeModalCleanup = openAccessibleModal('rider-complete-modal-overlay', 'complete-confirm-btn');
}

function closeCompleteModal() {
  // Clear scan guard so the same order can be re-scanned if reopened
  if (rModal.order?.order_id) {
    sessionStorage.removeItem(`scan_confirmed_${rModal.order.order_id}`);
  }
  closeAccessibleModal(
    'rider-complete-modal-overlay',
    rConfirm.previousFocus || document.activeElement,
    _completeModalCleanup);
  _completeModalCleanup = null;
  rModal.podData        = null;
  rModal.podMime        = null;
}

/* ── POD image handling ─────────────────────────────────── */

function handlePodFileChange(evt) {
  const file = evt.target.files[0];
  if (file) processPodFile(file);
}

function handlePodDrop(evt) {
  evt.preventDefault();
  document.getElementById('pod-upload-area')?.classList.remove('dragover');
  const file = evt.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) processPodFile(file);
  else if (file) toast('Please drop an image file.', 'error');
}

function processPodFile(file) {
  if (file.size > 15 * 1024 * 1024) {
    toast('Image too large. Maximum size is 15 MB before compression.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const MAX_WIDTH  = 800;
      const scale      = img.width > MAX_WIDTH ? MAX_WIDTH / img.width : 1;
      const canvas     = document.createElement('canvas');
      canvas.width     = Math.round(img.width  * scale);
      canvas.height    = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

      const dataUrl    = canvas.toDataURL('image/jpeg', 0.55);
      rModal.podData   = dataUrl.split(',')[1];
      rModal.podMime   = 'image/jpeg';

      const preview    = document.getElementById('pod-preview');
      const previewImg = document.getElementById('pod-preview-img');
      const uploadArea = document.getElementById('pod-upload-area');

      previewImg.src    = dataUrl;
      preview.hidden    = false;
      uploadArea.hidden = true;
      preview.querySelector('button')?.focus();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removePod() {
  rModal.podData = null;
  rModal.podMime = null;

  const preview    = document.getElementById('pod-preview');
  const uploadArea = document.getElementById('pod-upload-area');
  const fileInput  = document.getElementById('pod-file-input');

  preview.hidden    = true;
  uploadArea.hidden = false;
  if (fileInput) fileInput.value = '';
  uploadArea.focus();
}

/* ── Signature Pad ──────────────────────────────────────── */

let _sigDrawing = false;

function switchPodTab(tab) {
  const photoPanel = document.getElementById('pod-panel-photo');
  const sigPanel   = document.getElementById('pod-panel-sig');
  const photoTab   = document.getElementById('pod-tab-photo');
  const sigTab     = document.getElementById('pod-tab-sig');
  if (tab === 'photo') {
    photoPanel.hidden = false; sigPanel.hidden = true;
    photoTab.setAttribute('aria-selected', 'true');   photoTab.classList.add('active');
    sigTab.setAttribute('aria-selected', 'false');    sigTab.classList.remove('active');
  } else {
    photoPanel.hidden = true;  sigPanel.hidden = false;
    sigTab.setAttribute('aria-selected', 'true');     sigTab.classList.add('active');
    photoTab.setAttribute('aria-selected', 'false');  photoTab.classList.remove('active');
    initSignaturePad();
  }
}

function initSignaturePad() {
  const canvas = document.getElementById('pod-sig-canvas');
  if (!canvas || canvas._sigInit) return;
  canvas._sigInit = true;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth   = 2.5;
  ctx.lineCap     = 'round';

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / r.width;
    const scaleY = canvas.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * scaleX, y: (src.clientY - r.top) * scaleY };
  }
  canvas.addEventListener('pointerdown', (e) => {
    _sigDrawing = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!_sigDrawing) return;
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    e.preventDefault();
  });
  ['pointerup', 'pointerleave'].forEach(ev =>
    canvas.addEventListener(ev, () => { _sigDrawing = false; }));
}

function clearSignaturePad() {
  const canvas = document.getElementById('pod-sig-canvas');
  if (!canvas) return;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  const status = document.getElementById('sig-capture-status');
  if (status) status.textContent = '';
  rModal.podData = null;
  rModal.podMime = null;
}

function captureSignature() {
  const canvas = document.getElementById('pod-sig-canvas');
  if (!canvas) return;
  const dataUrl  = canvas.toDataURL('image/jpeg', 0.8);
  rModal.podData = dataUrl.split(',')[1];
  rModal.podMime = 'image/jpeg';
  const status   = document.getElementById('sig-capture-status');
  if (status) {
    status.textContent = '✅ Signature captured! You can now confirm the delivery.';
    status.style.color = 'var(--success,#16a34a)';
  }
}

/* ── Offline delivery queue ─────────────────────────────── */

const OFFLINE_QUEUE_KEY = 'rider_offline_queue';

function offlineQueueAdd(action, payload) {
  const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  queue.push({ action, payload, ts: Date.now() });
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

async function offlineQueueSync() {
  const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  if (!queue.length) return;
  const remaining = [];
  for (const item of queue) {
    try {
      const res = await apiPost(item.action, item.payload);
      if (!res.success) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  if (remaining.length < queue.length) {
    toast(`Synced ${queue.length - remaining.length} offline action(s). ✅`, 'success');
    refreshCurrentPage();
    loadDashboard();
  }
}

window.addEventListener('online', offlineQueueSync);

/* ── Submit complete order ──────────────────────────────── */

async function submitCompleteOrder() {
  const btn   = document.getElementById('complete-confirm-btn');
  const errEl = document.getElementById('complete-error');
  const order = rModal.order;
  if (!order) return;

  errEl.hidden    = true;
  btn.disabled    = true;
  btn.textContent = 'Verifying…';

  // Pre-flight: confirm order is still assigned to this rider and out for delivery
  try {
    const check = await apiGet('order', { id: order.order_id });
    if (check.success) {
      const live = check.data;
      if (live.status === 'Cancelled') {
        errEl.textContent = 'This order has been cancelled. Please return to hub.';
        errEl.hidden = false;
        btn.disabled = false;
        btn.innerHTML = '<span aria-hidden="true">✅</span> Confirm Delivery Complete';
        showCancellationAlert(order.order_number);
        return;
      }
      if (live.status === 'Completed') {
        errEl.textContent = 'This order has already been marked as Completed.';
        errEl.hidden = false;
        btn.disabled = false;
        btn.innerHTML = '<span aria-hidden="true">✅</span> Confirm Delivery Complete';
        return;
      }
      if (!['Out for Delivery', 'Arrived at Location'].includes(live.status)) {
        errEl.textContent = `Order status changed to "${live.status}". Cannot complete now.`;
        errEl.hidden = false;
        btn.disabled = false;
        btn.innerHTML = '<span aria-hidden="true">✅</span> Confirm Delivery Complete';
        return;
      }
    }
  } catch { /* network check failed — proceed optimistically */ }

  btn.textContent = 'Processing…';

  // FIX: Send base64 data-URI so the server can decode and save it as a file.
  // The data-URI format (data:<mime>;base64,<data>) is what the patched
  // rider_api.php expects. We no longer embed raw base64 directly in JSON
  // to stay within the VARCHAR(500) proof_of_delivery_url column — the API
  // now writes the image to disk and stores only the short file path.
  const proof_url = rModal.podData
    ? `data:${rModal.podMime};base64,${rModal.podData}`
    : '';

  // Capture geolocation for backend audit trail
  let delivery_lat = null;
  let delivery_lng = null;
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 }));
    delivery_lat = pos.coords.latitude;
    delivery_lng = pos.coords.longitude;
  } catch { /* geolocation unavailable — proceed without coordinates */ }

  let res;
  try {
    res = await apiPost('complete_order', {
      order_id: order.order_id,
      proof_url,
      delivery_lat,
      delivery_lng,
    });
  } catch {
    res = { success: false, _network: true };
  }

  if (!res.success && res._network) {
    offlineQueueAdd('complete_order', { order_id: order.order_id, proof_url, delivery_lat, delivery_lng });
    closeCompleteModal();
    toast('No signal — delivery saved offline. Will sync when connected. 📶', 'warning');
    return;
  }

  if (res.success) {
    closeCompleteModal();
    toast('Delivery completed! 🎉', 'success');
    refreshCurrentPage();
    loadDashboard();
  } else {
    errEl.textContent = res.message || 'Failed to complete order.';
    errEl.hidden      = false;
    btn.disabled      = false;
    btn.innerHTML     = '<span aria-hidden="true">✅</span> Confirm Delivery Complete';
  }
}

/* ════════════════════════════════════════════════════════════
   CONFIRM DIALOG
═══════════════════════════════════════════════════════════════*/

function closeConfirm() {
  closeAccessibleModal('rider-confirm-overlay', rConfirm.previousFocus, null);
}

function confirmOk() {
  if (typeof rConfirm.onOk === 'function') rConfirm.onOk();
  rConfirm.onOk = null;
}

/* ════════════════════════════════════════════════════════════
   REPORT ISSUE / FAILED DELIVERY MODAL
═══════════════════════════════════════════════════════════════*/

function openIssueModal(orderId) {
  _issueOrderId = orderId;

  const reasonEl = document.getElementById('issue-reason');
  const notesEl  = document.getElementById('issue-notes');
  const errEl    = document.getElementById('issue-error');
  if (reasonEl) reasonEl.value    = '';
  if (notesEl)  notesEl.value     = '';
  if (errEl)  { errEl.hidden = true; errEl.textContent = ''; }

  // Inject partial delivery item selector if order items are available
  const order = rSession.orders.active.find(o => o.order_id == orderId)
             || rModal.order;
  const partialContainer = document.getElementById('partial-delivery-container');
  if (partialContainer && order?.items?.length) {
    partialContainer.hidden = false;
    const fullAmt = parseFloat(order.final_total ?? order.estimated_total ?? 0);
    partialContainer.innerHTML = `
      <div style="margin-top:1rem">
        <label style="font-weight:600;display:block;margin-bottom:.5rem">
          <span aria-hidden="true">📦</span> Partial Delivery — Select items to RETURN:
        </label>
        <div id="partial-items-list">
          ${(order.items || []).map((item, idx) => {
            const sub = parseFloat(item.final_subtotal ?? item.estimated_subtotal ?? 0);
            return `
              <label class="partial-item-row" style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border,#e5e7eb)">
                <input type="checkbox" class="partial-item-check" data-idx="${idx}" data-subtotal="${sub}"
                  onchange="recalcPartialCOD(${fullAmt})"
                  aria-label="Return ${escHtml(item.name)}">
                <span style="flex:1">${escHtml(item.name)} × ${escHtml(String(item.quantity))}</span>
                <strong>${fmtPrice(sub)}</strong>
              </label>`;
          }).join('')}
        </div>
        <div id="partial-cod-display" style="margin-top:.75rem;padding:.6rem;background:var(--surface-alt,#f3f4f6);border-radius:6px;font-weight:600;text-align:right">
          Adjusted COD to Collect: <span id="partial-cod-val">${fmtPrice(fullAmt)}</span>
        </div>
      </div>`;
  } else if (partialContainer) {
    partialContainer.hidden = true;
  }

  closeOrderModal();
  _issueModalCleanup = openAccessibleModal('rider-issue-modal-overlay', 'issue-reason');
}

function recalcPartialCOD(fullAmt) {
  const checks   = document.querySelectorAll('.partial-item-check:checked');
  let returned   = 0;
  checks.forEach(c => { returned += parseFloat(c.dataset.subtotal || 0); });
  const adjusted = Math.max(0, fullAmt - returned);
  const display  = document.getElementById('partial-cod-val');
  if (display) display.textContent = fmtPrice(adjusted);
}

function closeIssueModal() {
  closeAccessibleModal('rider-issue-modal-overlay', document.activeElement, _issueModalCleanup);
  _issueModalCleanup = null;
  _issueOrderId      = null;
}

async function submitFailedDelivery() {
  const reason = document.getElementById('issue-reason')?.value || '';
  const notes  = document.getElementById('issue-notes')?.value  || '';
  const errEl  = document.getElementById('issue-error');
  const btn    = document.getElementById('issue-confirm-btn');

  errEl.hidden = true;
  if (!reason) {
    errEl.textContent = 'Please select a reason.';
    errEl.hidden      = false;
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Submitting…';

  const partialChecks = [...document.querySelectorAll('.partial-item-check:checked')]
    .map(c => parseInt(c.dataset.idx, 10));

  let res;
  try {
    res = await apiPost('failed_delivery', {
      order_id:        _issueOrderId,
      reason,
      notes,
      returned_items:  partialChecks,
    });
  } catch {
    res = { success: false, _network: true };
  }

  if (!res.success && res._network) {
    offlineQueueAdd('failed_delivery', {
      order_id:       _issueOrderId,
      reason,
      notes,
      returned_items: partialChecks,
    });
    closeIssueModal();
    toast('No signal — issue saved offline. Will sync when connected. 📶', 'warning');
    return;
  }

  if (res.success) {
    closeIssueModal();
    toast('Failed delivery recorded. Order has been cancelled.', 'info');
    refreshCurrentPage();
    loadDashboard();
  } else {
    errEl.textContent = res.message || 'Failed to record issue.';
    errEl.hidden      = false;
    btn.disabled      = false;
    btn.innerHTML     = '<span aria-hidden="true">⚠️</span> Confirm Failed Delivery';
  }
}

/* ════════════════════════════════════════════════════════════
   NOTIFICATIONS
═══════════════════════════════════════════════════════════════*/

async function pollNotifications() {
  const res = await apiGet('notifications', { limit: 20 });
  if (!res.success) return;

  const badge = document.getElementById('notif-badge');
  if (badge) {
    const count = res.unread || 0;
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.hidden      = count === 0;
    badge.setAttribute('aria-label', count > 0 ? `${count} unread notifications` : '');
  }

  rSession.notifications = res.data || [];
}

function toggleNotifPanel() {
  const panel = document.getElementById('rider-notif-panel');
  const btn   = document.getElementById('rider-notif-btn');
  const isOpen = !panel.hidden;

  panel.hidden = isOpen;
  btn.setAttribute('aria-expanded', String(!isOpen));

  if (!isOpen) renderNotifPanel();
}

function renderNotifPanel() {
  const list  = document.getElementById('notif-panel-list');
  const items = rSession.notifications || [];

  if (!items.length) {
    list.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
    return;
  }

  list.innerHTML = items.map(n => `
    <div class="notif-item${n.is_read == 1 ? ' read' : ''}" data-id="${n.notification_id}">
      <p class="notif-msg">${escHtml(n.message)}</p>
      <time class="notif-time">${fmtDateTime(n.created_at)}</time>
    </div>`).join('');
}

async function markAllNotifsRead() {
  await apiPost('mark_notif_read', { notification_id: 0 });
  await pollNotifications();
  renderNotifPanel();
}

// Close notification panel when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('rider-notif-panel');
  const btn   = document.getElementById('rider-notif-btn');
  if (panel && !panel.hidden && !panel.contains(e.target) && !btn?.contains(e.target)) {
    panel.hidden = true;
    btn?.setAttribute('aria-expanded', 'false');
  }
});

/* ════════════════════════════════════════════════════════════
   PERFORMANCE PAGE
═══════════════════════════════════════════════════════════════*/

async function loadPerformance() {
  const statsBar = document.getElementById('perf-stats-bar');
  const tbody    = document.getElementById('perf-daily-tbody');

  const today    = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

  const fromEl = document.getElementById('perf-date-from');
  const toEl   = document.getElementById('perf-date-to');
  if (fromEl && !fromEl.value) fromEl.value = monthAgo;
  if (toEl   && !toEl.value)   toEl.value   = today;

  const dateFrom = fromEl?.value || monthAgo;
  const dateTo   = toEl?.value   || today;

  statsBar.innerHTML = spinnerHTML('Loading performance');
  tbody.innerHTML    = `<tr><td colspan="4">${spinnerHTML('Loading')}</td></tr>`;

  const res = await apiGet('performance', { date_from: dateFrom, date_to: dateTo });

  if (!res.success) {
    statsBar.innerHTML = errorHTML(res.message);
    tbody.innerHTML    = '';
    return;
  }

  const s      = res.data;
  const avgMin = s.avg_delivery_minutes != null ? `${s.avg_delivery_minutes} min` : '—';

  // Estimated commission: ₱15 per completed drop (platform default — adjust as needed)
  const COMMISSION_PER_DROP = 15;
  const estCommission       = (s.completed || 0) * COMMISSION_PER_DROP;
  const failedPct           = s.total_deliveries > 0
    ? Math.round(((s.failed || 0) / s.total_deliveries) * 100)
    : 0;

  statsBar.innerHTML =
    statPillHTML('pill-green',  '✅', s.completed         || 0, 'Completed')        +
    statPillHTML('pill-orange', '❌', s.failed            || 0, 'Failed')            +
    statPillHTML('pill-blue',   '📦', s.total_deliveries  || 0, 'Total')             +
    statPillHTML('pill-money',  '⏱️', avgMin,                   'Avg. Delivery Time') +
    statPillHTML('pill-green',  '🎯', (s.completion_rate || 0) + '%', 'Completion Rate') +
    statPillHTML('pill-money',  '💵', fmtPrice(estCommission),  'Est. Commission')   +
    statPillHTML('pill-orange', '📉', failedPct + '%',           'Failed Rate');

  const daily = res.daily || [];
  if (!daily.length) {
    tbody.innerHTML =
      `<tr><td colspan="4">${emptyStateHTML('📋', '', 'No data for this period.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = daily.map(d => {
    const rate = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
    return `
      <tr>
        <td>${fmtDate(d.delivery_date)}</td>
        <td>${d.total}</td>
        <td>${d.completed}</td>
        <td>
          <div class="perf-rate-bar">
            <div class="perf-rate-fill" style="width:${rate}%" aria-hidden="true"></div>
            <span>${rate}%</span>
          </div>
        </td>
      </tr>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════
   SETTINGS / PROFILE PAGE
═══════════════════════════════════════════════════════════════*/

async function loadSettings() {
  const infoEl = document.getElementById('settings-profile-info');
  if (infoEl) {
    const res = await apiGet('profile');
    if (res.success) {
      const u = res.data;
      infoEl.innerHTML = `
        <div class="settings-profile-row">
          <span class="detail-row-label">Name</span>
          <span>${escHtml(u.first_name + ' ' + u.last_name)}</span>
        </div>
        <div class="settings-profile-row">
          <span class="detail-row-label">Email</span>
          <span>${escHtml(u.email)}</span>
        </div>`;
      const phoneInput = document.getElementById('settings-phone');
      if (phoneInput && u.phone) phoneInput.value = u.phone;
    }
  }
  loadRemittanceHistory();
}

async function savePhone() {
  const phone  = document.getElementById('settings-phone')?.value.trim() || '';
  const errEl  = document.getElementById('settings-phone-error');
  const succEl = document.getElementById('settings-phone-success');
  errEl.hidden  = true;
  succEl.hidden = true;

  if (!phone) {
    errEl.textContent = 'Please enter a phone number.';
    errEl.hidden      = false;
    return;
  }

  const res = await apiPost('update_profile', { phone });
  if (res.success) {
    succEl.textContent = res.message;
    succEl.hidden      = false;
    toast('Phone number updated.', 'success');
  } else {
    errEl.textContent = res.message || 'Failed to update phone.';
    errEl.hidden      = false;
  }
}

async function savePassword() {
  const curPass  = document.getElementById('settings-cur-pass')?.value     || '';
  const newPass  = document.getElementById('settings-new-pass')?.value     || '';
  const confPass = document.getElementById('settings-confirm-pass')?.value || '';
  const errEl    = document.getElementById('settings-pass-error');
  const succEl   = document.getElementById('settings-pass-success');
  errEl.hidden  = true;
  succEl.hidden = true;

  if (!curPass || !newPass || !confPass) {
    errEl.textContent = 'Please fill in all password fields.';
    errEl.hidden      = false;
    return;
  }
  if (newPass !== confPass) {
    errEl.textContent = 'New passwords do not match.';
    errEl.hidden      = false;
    return;
  }
  if (newPass.length < 8) {
    errEl.textContent = 'New password must be at least 8 characters.';
    errEl.hidden      = false;
    return;
  }

  const res = await apiPost('update_profile', {
    current_password: curPass,
    new_password:     newPass,
  });

  if (res.success) {
    succEl.textContent = res.message;
    succEl.hidden      = false;
    document.getElementById('settings-cur-pass').value     = '';
    document.getElementById('settings-new-pass').value     = '';
    document.getElementById('settings-confirm-pass').value = '';
    toast('Password updated.', 'success');
  } else {
    errEl.textContent = res.message || 'Failed to update password.';
    errEl.hidden      = false;
  }
}

/* ════════════════════════════════════════════════════════════
   CASH REMITTANCE
═══════════════════════════════════════════════════════════════*/

async function submitRemittance() {
  const amount = parseFloat(document.getElementById('remit-amount')?.value || 0);
  const notes  = document.getElementById('remit-notes')?.value.trim() || '';
  const errEl  = document.getElementById('remit-error');
  const succEl = document.getElementById('remit-success');
  errEl.hidden  = true;
  succEl.hidden = true;

  if (!amount || amount <= 0) {
    errEl.textContent = 'Please enter a valid amount.';
    errEl.hidden      = false;
    return;
  }

  const res = await apiPost('remit_cash', { amount, notes });
  if (res.success) {
    succEl.textContent = res.message;
    succEl.hidden      = false;
    document.getElementById('remit-amount').value = '';
    document.getElementById('remit-notes').value  = '';
    toast('Remittance submitted!', 'success');
    loadRemittanceHistory();
  } else {
    errEl.textContent = res.message || 'Failed to submit remittance.';
    errEl.hidden      = false;
  }
}

async function loadRemittanceHistory() {
  const container = document.getElementById('remit-history');
  if (!container) return;

  container.innerHTML = spinnerHTML('Loading remittances');

  const res = await apiGet('remittance_history');
  if (!res.success) { container.innerHTML = errorHTML(res.message); return; }

  const rows = res.data || [];
  if (!rows.length) {
    container.innerHTML =
      `<p class="text-muted" style="font-size:.85rem">No remittances submitted yet.</p>`;
    return;
  }

  container.innerHTML = `
    <table class="rider-table" aria-label="Remittance history">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Amount</th>
          <th scope="col">Status</th>
          <th scope="col">Notes</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${fmtDateTime(r.remitted_at)}</td>
            <td><strong>${fmtPrice(r.amount)}</strong></td>
            <td>
              <span class="remit-status remit-status-${escHtml(r.status)}">
                ${escHtml(r.status)}
              </span>
            </td>
            <td class="text-muted">${escHtml(r.notes || '—')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ════════════════════════════════════════════════════════════
   GLOBAL KEYBOARD HANDLERS
═══════════════════════════════════════════════════════════════*/

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;

  if (document.getElementById('rider-issue-modal-overlay').classList.contains('open')) {
    closeIssueModal();
  } else if (document.getElementById('rider-complete-modal-overlay').classList.contains('open')) {
    closeCompleteModal();
  } else if (document.getElementById('rider-order-modal-overlay').classList.contains('open')) {
    closeOrderModal();
  } else if (document.getElementById('rider-confirm-overlay').classList.contains('open')) {
    closeConfirm();
  }
});

/* ════════════════════════════════════════════════════════════
   END OF SHIFT / HUB CHECK-IN
═══════════════════════════════════════════════════════════════*/

let _shiftModalCleanup = null;

async function openShiftModal() {
  const body   = document.getElementById('rider-shift-modal-body');
  const footer = document.getElementById('rider-shift-modal-footer');
  body.innerHTML = spinnerHTML('Building shift summary');
  _shiftModalCleanup = openAccessibleModal('rider-shift-modal-overlay', 'rider-shift-modal-close');

  const res = await apiGet('my_orders');
  if (!res.success) { body.innerHTML = errorHTML(res.message); return; }

  const today      = new Date().toISOString().slice(0, 10);
  const allOrders  = res.data || [];
  const completed  = allOrders.filter(o => o.status === 'Completed' && o.delivery_date === today);
  const failed     = allOrders.filter(o =>
    (o.status === 'Cancelled' || o.status === 'Failed') && o.delivery_date === today);

  let codCollected = 0;
  completed.forEach(o => {
    if (o.payment_method === 'COD' || o.payment_method === 'Cash on Delivery') {
      codCollected += parseFloat(o.final_total ?? o.estimated_total ?? 0);
    }
  });

  const payload = {
    rider_id:      rSession.user?.user_id,
    rider_name:    `${rSession.user?.first_name} ${rSession.user?.last_name}`,
    shift_date:    today,
    completed:     completed.length,
    failed:        failed.length,
    cod_collected: codCollected.toFixed(2),
    order_ids:     completed.map(o => o.order_id),
    failed_ids:    failed.map(o => o.order_id),
    ts:            Date.now(),
  };

  const qrData = encodeURIComponent(JSON.stringify(payload));
  const qrUrl  = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${qrData}`;

  body.innerHTML = `
    <div style="text-align:center">
      <p style="margin-bottom:.75rem;font-size:.9rem;color:var(--text-muted,#6b7280)">
        Show this QR code to the hub admin to log your shift handoff.
      </p>
      <img src="${qrUrl}" alt="Shift summary QR code for hub scanning"
        style="border:4px solid var(--border,#e5e7eb);border-radius:10px;max-width:220px">
    </div>

    <div style="margin-top:1.25rem">
      <h4 style="font-size:.85rem;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.6rem;color:var(--text-muted,#6b7280)">
        Shift Summary — ${today}
      </h4>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1rem">
        <div style="flex:1;min-width:120px;padding:.6rem;background:#d1fae5;border-radius:8px;text-align:center">
          <div style="font-size:1.6rem;font-weight:700;color:#065f46">${completed.length}</div>
          <div style="font-size:.8rem;color:#065f46">✅ Delivered</div>
        </div>
        <div style="flex:1;min-width:120px;padding:.6rem;background:#fee2e2;border-radius:8px;text-align:center">
          <div style="font-size:1.6rem;font-weight:700;color:#991b1b">${failed.length}</div>
          <div style="font-size:.8rem;color:#991b1b">❌ Failed Returns</div>
        </div>
        <div style="flex:1;min-width:120px;padding:.6rem;background:#fef3c7;border-radius:8px;text-align:center">
          <div style="font-size:1.6rem;font-weight:700;color:#92400e">${fmtPrice(codCollected)}</div>
          <div style="font-size:.8rem;color:#92400e">💵 COD to Remit</div>
        </div>
      </div>

      ${failed.length ? `
        <h5 style="font-size:.85rem;margin-bottom:.4rem">Failed / Return Items:</h5>
        <ul style="font-size:.85rem;padding-left:1.2rem;color:var(--text-muted,#6b7280)">
          ${failed.map(o => `<li>${escHtml(o.order_number)} — ${escHtml(o.first_name + ' ' + o.last_name)}</li>`).join('')}
        </ul>` : ''}
    </div>`;

  // Store payload on window so the inline onclick can reference it safely
  window._pendingShiftPayload = payload;

  footer.innerHTML = `
    <button class="btn-outline" type="button" onclick="closeShiftModal()">Close</button>
    <button class="btn-primary" type="button" onclick="submitShiftCheckin(window._pendingShiftPayload)">
      <span aria-hidden="true">✅</span> Submit to Hub
    </button>`;
}

function closeShiftModal() {
  closeAccessibleModal('rider-shift-modal-overlay', document.activeElement, _shiftModalCleanup);
  _shiftModalCleanup = null;
}

async function submitShiftCheckin(payload) {
  const res = await apiPost('shift_checkin', payload);
  if (res.success) {
    toast('Shift check-in submitted! Hand over cash to admin. ✅', 'success');
    closeShiftModal();
  } else {
    toast(res.message || 'Failed to submit shift check-in.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════*/

document.addEventListener('DOMContentLoaded', () => {
  // Restore session from sessionStorage (persists across page refreshes)
  const stored = sessionStorage.getItem('rider_user');
  if (stored) {
    try {
      rSession.user = JSON.parse(stored);
      initRiderApp();
    } catch {
      sessionStorage.removeItem('rider_user');
    }
  }

  // Sync any offline queue from a previous session
  if (navigator.onLine) offlineQueueSync();

  // Allow Enter key to submit login form
  ['r-email', 'r-pass'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') riderLogin();
    });
  });
});