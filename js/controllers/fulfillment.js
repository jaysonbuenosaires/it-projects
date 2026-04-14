/**
 * fulfillment.js — Fulfillment Staff Portal Controller
 *
 * Depends on (load before this file):
 *   shared/constants.js
 *   shared/utils.js
 *   shared/uiHelpers.js
 *   shared/apiService.js
 *
 * Responsibilities:
 *   • Owns `session` (logged-in user + cached data)
 *   • All network calls go through apiGet / apiPost / rawPost
 *   • All formatting delegated to utils.js
 *   • All toasts / modals delegated to uiHelpers.js
 *   • Zero raw fetch() or SQL anywhere in this file
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════*/

const session = {
  user:        null,
  riders:      [],
  orders:      { queue: [], packed: [], dispatch: [], all: [], returns: [] },
  inventory:   [],
  batchCache:  {},          // product_id → [batches]
  seenCancels: new Set(),   // notification/log ids already shown
  pollTimer:   null,
};

/** Per-modal pack state — reset on every openPackModal() call. */
const packState = {
  order:       null,
  deliveryFee: 0,
  discountAmt: 0,
  batchData:   {},  // product_id → fifo batch array
};

const assignState      = { orderId: null, orderNum: '', currentRiderId: null };
const adjustState      = { batchId: null };
const batchAssignState = { orderIds: [], zoneLabel: '' };

let zoneViewActive      = false;
let scanModeActive      = false;
let selectedQueueOrders = new Set();

/* ════════════════════════════════════════════════════════════
   API SERVICE
═══════════════════════════════════════════════════════════════*/

const FULFILLMENT_API = 'api/fulfillment_api.php';

const { apiGet, apiPost } = createApiService({
  baseUrl:     FULFILLMENT_API,
  callerKey:   'staff_id',
  getCallerId: () => session.user?.user_id ?? 0,
});

/* ── Toast shorthand ─────────────────────────────────────── */
const toast = (msg, type = '') => showToast(msg, type, 'staff-toast');

/* ── Fulfillment-specific pay badge ─────────────────────── */
function payBadge(ps) {
  const safe = ps || 'Unpaid';
  return `<span class="status-badge pay-status-${safe}">${safe}</span>`;
}

/* ════════════════════════════════════════════════════════════
   ACCESSIBILITY — WCAG AA FOCUS TRAP
═══════════════════════════════════════════════════════════════*/

const FOCUSABLE_SELECTORS =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let _focusTrapActive   = null;   // currently trapped modal element
let _focusTrapHandler  = null;   // keydown handler reference for cleanup
let _previousFocus     = null;   // element that had focus before modal opened

/**
 * Trap keyboard focus inside `modalEl` per WCAG 2.1 SC 2.1.2.
 * Call once when a modal opens; call releaseFocusTrap() on close.
 */
function trapFocus(modalEl) {
  if (!modalEl) return;
  releaseFocusTrap();                          // clean up any prior trap

  _previousFocus    = document.activeElement;
  _focusTrapActive  = modalEl;

  const getFocusable = () =>
    [...modalEl.querySelectorAll(FOCUSABLE_SELECTORS)]
      .filter(el => !el.closest('[hidden]') && el.offsetParent !== null);

  // Initial focus: first focusable, or the modal box itself
  const first = getFocusable()[0] || modalEl;
  first.focus();

  _focusTrapHandler = e => {
    if (e.key !== 'Tab') return;
    const focusable = getFocusable();
    if (!focusable.length) { e.preventDefault(); return; }
    const firstEl = focusable[0];
    const lastEl  = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    } else {
      if (document.activeElement === lastEl)  { e.preventDefault(); firstEl.focus(); }
    }
  };
  modalEl.addEventListener('keydown', _focusTrapHandler);

  // Announce opening to screen readers via the overlay's aria-label
  modalEl.setAttribute('aria-hidden', 'false');
}

/** Release the active focus trap and restore prior focus. */
function releaseFocusTrap() {
  if (_focusTrapActive && _focusTrapHandler) {
    _focusTrapActive.removeEventListener('keydown', _focusTrapHandler);
    _focusTrapActive.setAttribute('aria-hidden', 'true');
  }
  _focusTrapActive  = null;
  _focusTrapHandler = null;
  if (_previousFocus && typeof _previousFocus.focus === 'function') {
    _previousFocus.focus();
  }
  _previousFocus = null;
}

/* ════════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════════*/

async function staffLogin() {
  const email = document.getElementById('sf-email').value.trim();
  const pass  = document.getElementById('sf-pass').value;
  const errEl = document.getElementById('sf-login-error');
  const btn   = document.getElementById('sf-login-btn');

  errEl.style.display = 'none';
  if (!email || !pass) {
    errEl.textContent   = 'Please enter your email and password.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Signing in…';

  const data = await loginFetch(FULFILLMENT_API, email, pass);

  btn.disabled    = false;
  btn.textContent = 'Sign In';

  if (!data.success) {
    errEl.textContent   = data.message || 'Login failed.';
    errEl.style.display = 'block';
    return;
  }

  session.user = data.user;
  sessionStorage.setItem('pm_staff_session', JSON.stringify(data.user));
  initApp();
}

function staffLogout() {
  clearInterval(session.pollTimer);
  session.user = null;
  sessionStorage.removeItem('pm_staff_session');
  document.getElementById('portal-app').hidden           = true;
  document.getElementById('portal-login-screen').hidden  = false;
  document.getElementById('sf-email').value                   = '';
  document.getElementById('sf-pass').value                    = '';
  document.getElementById('sf-login-error').style.display     = 'none';
}


/* ════════════════════════════════════════════════════════════
   APP INIT
═══════════════════════════════════════════════════════════════*/

function initApp() {
  document.getElementById('portal-login-screen').hidden = true;
  document.getElementById('portal-app').hidden          = false;

  const u = session.user;
  document.getElementById('staff-user-name').textContent      = `${u.first_name} ${u.last_name}`;
  document.getElementById('staff-avatar-initial').textContent = u.first_name.charAt(0).toUpperCase();

  startClock('staff-clock');
  loadRidersCache();
  startActiveOrderPoll();
  showPage('queue');
}

async function loadRidersCache() {
  const data = await apiGet('riders');
  if (data.success) session.riders = data.data;
}

/* ════════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════════*/

const PAGE_TITLES = {
  'queue':      ['📦', 'Packing Queue'],
  'packed':     ['✅', 'Assign Riders'],
  'dispatch':   ['🛵', 'Active Dispatch'],
  'all-orders': ['📋', 'All Orders'],
  'inventory':  ['🏷️', 'Inventory'],
  'returns':    ['↩️', 'Returns & Restock'],
};

function showPage(pageId) {
  document.querySelectorAll('.staff-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.staff-nav-btn').forEach(b => {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });

  document.getElementById('page-' + pageId)?.classList.add('active');

  const activeBtn = document.querySelector(`[data-page="${pageId}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.setAttribute('aria-current', 'page');
  }

  const [icon, title] = PAGE_TITLES[pageId] || ['📄', pageId];
  document.getElementById('staff-topbar-title').innerHTML =
    `<span aria-hidden="true">${icon}</span> ${title}`;

  if (window.innerWidth <= 900) closeSidebar();

  if (pageId === 'queue')      loadQueue();
  if (pageId === 'packed')     loadPacked();
  if (pageId === 'dispatch')   loadDispatch();
  if (pageId === 'all-orders') loadAllOrders();
  if (pageId === 'inventory')  loadInventory();
  if (pageId === 'returns')    loadReturns();
}

function toggleSidebar() {
  const sidebar = document.getElementById('portal-sidebar');
  const menuBtn = document.getElementById('staff-menu-btn');
  const overlay = document.getElementById('portal-sidebar-overlay');
  const isOpen  = sidebar.classList.contains('open');
  sidebar.classList.toggle('open', !isOpen);
  menuBtn.setAttribute('aria-expanded', String(!isOpen));
  overlay?.classList.toggle('visible', !isOpen);
}

function closeSidebar() {
  document.getElementById('portal-sidebar').classList.remove('open');
  document.getElementById('staff-menu-btn').setAttribute('aria-expanded', 'false');
  document.getElementById('portal-sidebar-overlay')?.classList.remove('visible');
}

function refreshCurrentPage() {
  const active = document.querySelector('.staff-page.active');
  if (!active) return;
  const pageId = active.id.replace('page-', '');
  // Invalidate the relevant session cache before reloading
  if (pageId === 'queue')      session.orders.queue    = [];
  if (pageId === 'packed')     session.orders.packed   = [];
  if (pageId === 'dispatch')   session.orders.dispatch = [];
  if (pageId === 'all-orders') session.orders.all      = [];
  if (pageId === 'inventory')  session.inventory       = [];
  if (pageId === 'returns')    session.orders.returns  = [];
  showPage(pageId);
}

/* ════════════════════════════════════════════════════════════
   BARCODE / SCAN MODE
═══════════════════════════════════════════════════════════════*/

function toggleScanMode() {
  scanModeActive = !scanModeActive;
  const btn   = document.getElementById('scan-mode-btn');
  const input = document.getElementById('scan-input');
  btn.classList.toggle('scan-mode-active', scanModeActive);
  btn.setAttribute('aria-pressed', String(scanModeActive));
  if (scanModeActive) {
    input.classList.add('scan-input-visible');
    input.value = '';
    input.focus();
    toast('🔍 Scan Mode active — scan an order barcode.', 'info');
  } else {
    input.classList.remove('scan-input-visible');
    input.value = '';
  }
}

/**
 * handleScanInput is intentionally a no-op.
 * Commercial barcode scanners terminate every scan with a carriage-return / Enter
 * keystroke. All commit logic lives in the keydown listener below, which fires
 * reliably regardless of scanner hardware latency or USB HID buffering speed.
 * The old 120 ms debounce was unreliable because slow scanners spread characters
 * across multiple input events, causing the timer to fire on a partial buffer.
 */
function handleScanInput(_val) { /* committed on Enter — see keydown listener */ }

document.addEventListener('keydown', e => {
  if (!scanModeActive) return;
  // '\r' covers scanners that send a bare carriage-return instead of 'Enter'
  if (e.key !== 'Enter' && e.key !== '\r') return;
  const input = document.getElementById('scan-input');
  if (!input) return;
  const code = input.value.trim();
  if (!code) return;
  input.value = '';        // clear immediately so next scan starts fresh
  scanLookup(code);
});

async function scanLookup(orderNum) {
  toast(`🔍 Looking up ${orderNum}…`, 'info');
  const data = await apiGet('orders', { search: orderNum, page: 1 });
  if (!data.success || !data.data?.length) {
    toast(`Order "${orderNum}" not found.`, 'error');
    return;
  }
  const o = data.data[0];
  if (o.status === 'Pending') { openPackModal(o.order_id); return; }
  if (o.status === 'Packed')  { openAssignModal(o.order_id, o.order_number); return; }
  openDetailModal(o.order_id);
}

/* ════════════════════════════════════════════════════════════
   ACTIVE ORDER POLLING — cancellations + customer edits
═══════════════════════════════════════════════════════════════*/

function startActiveOrderPoll() {
  pollActiveOrders();
  session.pollTimer = setInterval(pollActiveOrders, POLL_INTERVAL_MS);
}

async function pollActiveOrders() {
  const data = await apiGet('notifications_poll');
  if (!data.success || !data.data?.length) return;

  const cancelAlerts = [];
  const editAlerts   = [];

  data.data.forEach(c => {
    const key = c.log_id || c.notification_id;
    if (!key || session.seenCancels.has(key)) return;
    session.seenCancels.add(key);
    if (c.type === 'order_edited' || c.event === 'order_edited') {
      editAlerts.push(c);
    } else {
      cancelAlerts.push(c);
    }
  });

  if (cancelAlerts.length) {
    updateNotifBell(cancelAlerts.length);
    renderCancelNotifPanel(cancelAlerts);
    showCancelOverlay(
      `Stop: Order #${cancelAlerts[0].order_number || 'Unknown'} has been cancelled.`);
  }

  if (editAlerts.length) {
    updateNotifBell(editAlerts.length);
    appendEditNotifPanel(editAlerts);
    applyEditBadgesToQueue(editAlerts);
  }
}

function appendEditNotifPanel(alerts) {
  const body = document.getElementById('notif-panel-body');
  if (!body) return;
  // Remove the placeholder text if present
  const placeholder = body.querySelector('p');
  if (placeholder) placeholder.remove();
  body.insertAdjacentHTML('afterbegin', alerts.map(a => `
    <div class="notif-panel-item notif-panel-item--edit">
      <span class="notif-panel-icon">✏️</span>
      <div>
        <strong>Order #${escHtml(a.order_number)} Updated by Customer</strong>
        <div style="font-size:.8rem;color:var(--text-muted)">
          ${escHtml(a.reason || 'Delivery date or time slot was changed')}
          · ${fmtDateTime(a.created_at)}
        </div>
      </div>
    </div>`).join(''));
}

function applyEditBadgesToQueue(alerts) {
  alerts.forEach(a => {
    if (!a.order_id) return;

    // Stamp the badge on the card if it is currently rendered
    const checkbox = document.querySelector(`.queue-checkbox[data-order-id="${a.order_id}"]`);
    const card     = checkbox?.closest('.queue-card');
    if (card && !card.querySelector('.queue-edit-badge')) {
      const badge = document.createElement('span');
      badge.className   = 'queue-edit-badge';
      badge.textContent = '✏️ Updated';
      badge.setAttribute('aria-label', 'Order updated by customer');
      badge.style.cssText =
        'background:var(--orange,#f59e0b);color:#fff;font-size:.7rem;' +
        'font-weight:700;padding:.15rem .45rem;border-radius:99px;margin-left:.4rem';
      card.querySelector('.queue-card-header')?.appendChild(badge);
    }

    // Patch the cached order so re-renders reflect the new date/slot
    const cached = session.orders.queue.find(o => o.order_id === a.order_id);
    if (cached) {
      if (a.new_delivery_date) cached.delivery_date = a.new_delivery_date;
      if (a.new_slot_label)    cached.slot_label    = a.new_slot_label;
    }
  });
}

function showCancelOverlay(msg) {
  document.getElementById('cancel-overlay-msg').textContent = msg;
  document.getElementById('cancel-overlay').style.display   = 'flex';
}

function dismissCancelOverlay() {
  document.getElementById('cancel-overlay').style.display = 'none';
}

function updateNotifBell(count) {
  const badge = document.getElementById('notif-bell-badge');
  if (!badge) return;
  if (count > 0) {
    const prev = parseInt(badge.textContent) || 0;
    badge.textContent = prev + count;
    badge.style.display = 'block';
  }
}

function resetNotifBell() {
  const badge = document.getElementById('notif-bell-badge');
  if (badge) badge.style.display = 'none';
}

function renderCancelNotifPanel(alerts) {
  const body = document.getElementById('notif-panel-body');
  if (!body) return;
  body.innerHTML = alerts.map(a => `
    <div class="notif-panel-item">
      <span class="notif-panel-icon">🚨</span>
      <div>
        <strong>Order #${escHtml(a.order_number)} Cancelled</strong>
        <div style="font-size:.8rem;color:var(--text-muted)">
          ${escHtml(a.reason || '')} · ${fmtDateTime(a.created_at)}
        </div>
      </div>
    </div>`).join('');
}

function toggleNotifPanel() {
  const p = document.getElementById('notif-panel');
  if (!p) return;
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

function dismissAllAlerts() {
  const panel = document.getElementById('notif-panel');
  if (panel) panel.style.display = 'none';
  resetNotifBell();
}

/* ════════════════════════════════════════════════════════════
   PAGE: PACKING QUEUE
═══════════════════════════════════════════════════════════════*/

async function loadQueue() {
  const list = document.getElementById('queue-list');
  list.innerHTML = spinnerHTML('Loading orders…');
  selectedQueueOrders.clear();

  const data = await apiGet('orders', { status: 'Pending', page: 1 });
  if (!data.success) {
    list.innerHTML = emptyStateHTML('⚠️', 'Could not load orders', data.message);
    return;
  }

  session.orders.queue = data.data || [];
  updateQueueBadge(session.orders.queue.length);
  renderQueue();
}

function filterQueue() { renderQueue(); }

function renderQueue() {
  const list      = document.getElementById('queue-list');
  const dateVal   = document.getElementById('queue-date-filter')?.value  || '';
  const searchVal = (document.getElementById('queue-search')?.value || '').toLowerCase();

  const orders = session.orders.queue
    .filter(o => {
      const matchDate   = !dateVal   || (o.delivery_date || '').startsWith(dateVal);
      const matchSearch = !searchVal ||
        o.order_number.toLowerCase().includes(searchVal) ||
        `${o.first_name} ${o.last_name}`.toLowerCase().includes(searchVal);
      return matchDate && matchSearch;
    })
    .sort((a, b) => {
      const ua = isToday(a.delivery_date) ? 0 : isTomorrow(a.delivery_date) ? 1 : 2;
      const ub = isToday(b.delivery_date) ? 0 : isTomorrow(b.delivery_date) ? 1 : 2;
      return ua !== ub ? ua - ub : (a.delivery_date || '').localeCompare(b.delivery_date || '');
    });

  const todayCount = orders.filter(o => isToday(o.delivery_date)).length;
  const tomCount   = orders.filter(o => isTomorrow(o.delivery_date)).length;

  document.getElementById('queue-summary-bar').innerHTML = `
    <div class="queue-stat-pill" role="status">
      <span class="qsp-icon">📦</span><span>Pending:</span><span class="qsp-val">${orders.length}</span>
    </div>
    <div class="queue-stat-pill" role="status">
      <span class="qsp-icon">🔴</span><span>Today:</span><span class="qsp-val">${todayCount}</span>
    </div>
    <div class="queue-stat-pill" role="status">
      <span class="qsp-icon">🟡</span><span>Tomorrow:</span><span class="qsp-val">${tomCount}</span>
    </div>
    <div class="queue-stat-pill" role="status" style="margin-left:auto">
      <span class="qsp-icon">☑️</span><span>Selected:</span>
      <span class="qsp-val" id="selected-count">0</span>
    </div>`;

  if (!orders.length) {
    list.innerHTML = emptyStateHTML('✅', 'No pending orders', 'The packing queue is empty!');
    return;
  }
  list.innerHTML = orders.map(renderQueueCard).join('');
}

function renderQueueCard(o) {
  const urgent  = isUrgent(o.delivery_date);
  const label   = deliveryLabel(o.delivery_date);
  const name    = `${o.first_name} ${o.last_name}`;
  const checked = selectedQueueOrders.has(o.order_id);

  return `
    <article class="queue-card ${urgent ? 'priority-urgent' : 'priority-normal'}"
      aria-label="Order ${escHtml(o.order_number)} for ${escHtml(name)}">
      <header class="queue-card-header">
        <label class="queue-checkbox-wrap" aria-label="Select order ${escHtml(o.order_number)} for prep sheet">
          <input type="checkbox" class="queue-checkbox" data-order-id="${o.order_id}"
            ${checked ? 'checked' : ''} onchange="toggleQueueSelect(${o.order_id}, this.checked)"/>
        </label>
        <span class="queue-order-num">${escHtml(o.order_number)}</span>
        <span class="queue-delivery-badge">${label}</span>
        ${urgent ? '<span class="queue-urgency-badge">Urgent</span>' : ''}
        <div class="queue-card-header-actions">
          <button class="btn-action btn-action-muted" onclick="openDetailModal(${o.order_id})"
            aria-label="View details for order ${escHtml(o.order_number)}">👁 View</button>
        </div>
      </header>

      <div class="queue-card-body">
        <div class="queue-customer-col">
          <div class="queue-col-label">Customer</div>
          <div class="queue-customer-name">${escHtml(name)}</div>
          <div class="queue-customer-detail">
            ${escHtml(o.email || '')} <br/>
            ${escHtml(o.payment_method)} &nbsp;·&nbsp; ${escHtml(o.slot_label || 'No slot')}
          </div>
        </div>
        <div class="queue-items-col">
          <div class="queue-col-label">Items</div>
          <div id="queue-items-${o.order_id}" class="queue-items-list-wrap">
            <span style="color:var(--text-muted);font-size:.82rem">Loading…</span>
          </div>
        </div>
        <div class="queue-action-col">
          <div class="queue-est-total">
            <span>Estimated Total</span>
            <strong>${fmtPrice(o.estimated_total)}</strong>
          </div>
          <button class="btn-primary" onclick="openPackModal(${o.order_id})"
            aria-label="Pack order ${escHtml(o.order_number)}">⚖ Pack Order</button>
          <button class="btn-outline btn-sm" onclick="openDetailModal(${o.order_id})">View Details</button>
        </div>
      </div>
    </article>`;
}

function toggleQueueSelect(orderId, checked) {
  if (checked) selectedQueueOrders.add(orderId);
  else         selectedQueueOrders.delete(orderId);
  const el = document.getElementById('selected-count');
  if (el) el.textContent = selectedQueueOrders.size;
}

function toggleSelectAll() {
  const visibleCheckboxes = document.querySelectorAll('.queue-checkbox');
  const allChecked = [...visibleCheckboxes].every(cb => cb.checked);
  visibleCheckboxes.forEach(cb => {
    const oid = parseInt(cb.dataset.orderId);
    cb.checked = !allChecked;
    if (!allChecked) selectedQueueOrders.add(oid);
    else             selectedQueueOrders.delete(oid);
  });
  const el = document.getElementById('selected-count');
  if (el) el.textContent = selectedQueueOrders.size;
  const btn = document.getElementById('select-all-btn');
  if (btn) btn.textContent = allChecked ? '☑️ Select All' : '🔲 Deselect All';
}

async function loadQueueCardItems(orderId) {
  const el = document.getElementById(`queue-items-${orderId}`);
  if (!el || el.dataset.loaded) return;
  el.dataset.loaded = 'true';

  const data = await apiGet('order', { id: orderId });
  if (!data.success || !el) return;

  const items = data.data.items || [];
  if (!items.length) {
    el.innerHTML = '<span style="color:var(--text-muted);font-size:.82rem">No items</span>';
    return;
  }
  const shown = items.slice(0, 3);
  el.innerHTML = `
    <ul class="queue-items-list">
      ${shown.map(i => `
        <li>
          <span>${escHtml(i.name)}</span>
          <span style="color:var(--text-muted)">×${i.quantity}</span>
          ${i.pricing_model === 'catch_weight' ? '<span class="queue-item-catch">⚖</span>' : ''}
        </li>`).join('')}
    </ul>
    ${items.length > 3
      ? `<p class="queue-items-more">+${items.length - 3} more item${items.length - 3 > 1 ? 's' : ''}</p>`
      : ''}`;
}

function updateQueueBadge(count) {
  const b = document.getElementById('nav-badge-queue');
  if (b) {
    b.textContent = count > 0 ? count : '';
    b.setAttribute('aria-label', `${count} pending orders`);
  }
}

/* ════════════════════════════════════════════════════════════
   DAILY PREP SHEET
═══════════════════════════════════════════════════════════════*/

async function openPrepSheetModal() {
  const orderIds = [...selectedQueueOrders];
  if (!orderIds.length) {
    toast('Select at least one order using the checkboxes first.', 'error');
    return;
  }

  const overlay = document.getElementById('prep-sheet-modal-overlay');
  const content = document.getElementById('prep-sheet-content');
  document.getElementById('prep-sheet-subtitle').textContent =
    `Aggregating ${orderIds.length} order${orderIds.length > 1 ? 's' : ''} from the packing queue.`;
  overlay.style.display = 'flex';
  trapFocus(overlay.querySelector('.modal-box') || overlay);
  content.innerHTML     = spinnerHTML('Aggregating items');

  // Aggregate items across all selected orders
  const aggregated = {};
  for (const oid of orderIds) {
    const data = await apiGet('order', { id: oid });
    if (!data.success) continue;
    (data.data.items || []).forEach(i => {
      if (!aggregated[i.name]) {
        aggregated[i.name] = { name: i.name, total_kg: 0, qty: 0, catch_weight: i.pricing_model === 'catch_weight' };
      }
      aggregated[i.name].total_kg += parseFloat(i.estimated_weight || 0) * parseInt(i.quantity || 1);
      aggregated[i.name].qty      += parseInt(i.quantity || 1);
    });
  }

  const rows = Object.values(aggregated).sort((a, b) => a.name.localeCompare(b.name));
  if (!rows.length) { content.innerHTML = '<p>No items found.</p>'; return; }

  const now = new Date().toLocaleString('en-PH');
  content.innerHTML = `
    <div class="prep-sheet-meta">
      📅 Generated: ${now} &nbsp;·&nbsp; 🛒 Orders: ${orderIds.length}
    </div>
    <table class="staff-table prep-sheet-table" aria-label="Prep sheet items">
      <thead>
        <tr>
          <th>Product</th>
          <th style="text-align:right">Est. Total (kg)</th>
          <th style="text-align:center">Units</th>
          <th>Type</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td><strong>${escHtml(r.name)}</strong></td>
            <td style="text-align:right;font-weight:700;font-family:'Playfair Display',serif">
              ${r.total_kg.toFixed(3)}
            </td>
            <td style="text-align:center">${r.qty}</td>
            <td>
              ${r.catch_weight
                ? '<span class="pack-item-catch-tag">⚖ Catch-Weight</span>'
                : '<span class="pack-item-fixed-tag">Fixed</span>'}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  // Printable version
  document.getElementById('prep-sheet-print').innerHTML = `
    <div class="slip-header">
      <div class="slip-brand">🐓 PoultryMart</div>
      <div class="slip-portal">Daily Prep Sheet — ${now}</div>
    </div>
    <hr class="slip-hr"/>
    <table class="slip-items-table">
      <thead><tr><th>Product</th><th>Est. Total (kg)</th><th>Units</th><th>Type</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${escHtml(r.name)}</td>
            <td>${r.total_kg.toFixed(3)}</td>
            <td>${r.qty}</td>
            <td>${r.catch_weight ? 'Catch-Weight' : 'Fixed'}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="slip-footer">Orders: ${orderIds.join(', ')}<br/>PoultryMart Fulfillment</div>`;
}

function closePrepSheetModal(event) {
  if (event && event.target !== event.currentTarget) return;
  releaseFocusTrap();
  document.getElementById('prep-sheet-modal-overlay').style.display = 'none';
}

function printPrepSheet() {
  document.getElementById('print-slip').innerHTML     = '';
  document.getElementById('thermal-labels').innerHTML = '';
  document.querySelectorAll('[data-print-mode]').forEach(el => el.removeAttribute('data-print-mode'));
  const prepEl      = document.getElementById('prep-sheet-print');
  prepEl.setAttribute('data-print-mode', 'active');

  const afterPrint3 = () => {
    prepEl.removeAttribute('data-print-mode');
    window.removeEventListener('afterprint', afterPrint3);
  };
  window.addEventListener('afterprint', afterPrint3);
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

/* ════════════════════════════════════════════════════════════
   PACK ORDER MODAL  (FIFO + Split Batch + Manual Override)
═══════════════════════════════════════════════════════════════*/

async function openPackModal(orderId) {
  const overlay = document.getElementById('pack-modal-overlay');
  overlay.style.display = 'flex';
  packState.batchData   = {};
  trapFocus(overlay.querySelector('.modal-box') || overlay);

  // Reset UI
  document.getElementById('pack-modal-meta').textContent      = 'Loading order…';
  document.getElementById('pack-items-list').innerHTML        = spinnerHTML('Loading items');
  document.getElementById('pack-customer-strip').innerHTML    = '';
  document.getElementById('pack-items-subtotal').textContent  = '₱0.00';
  document.getElementById('pack-grand-total-val').textContent = '₱0.00';
  document.getElementById('pack-confirm-btn').disabled        = false;

  const data = await apiGet('order', { id: orderId });
  if (!data.success) {
    document.getElementById('pack-items-list').innerHTML =
      `<p style="color:var(--error)">Failed to load order: ${escHtml(data.message)}</p>`;
    return;
  }

  const order         = data.data;
  packState.order       = order;
  packState.deliveryFee = parseFloat(order.delivery_fee || 0);
  packState.discountAmt = parseFloat(order.discount_amount || 0);

  document.getElementById('pack-modal-meta').innerHTML =
    `Order <strong>${escHtml(order.order_number)}</strong> &nbsp;·&nbsp;
     Delivery: ${fmtDate(order.delivery_date)} &nbsp;·&nbsp; ${escHtml(order.slot_label || '')}`;

  document.getElementById('pack-customer-strip').innerHTML = `
    <div>
      <div class="pack-cs-label">Customer</div>
      <div class="pack-cs-val">${escHtml(order.first_name)} ${escHtml(order.last_name)}</div>
    </div>
    <div>
      <div class="pack-cs-label">Phone</div>
      <div class="pack-cs-val">${escHtml(order.phone || '—')}</div>
    </div>
    <div>
      <div class="pack-cs-label">Address</div>
      <div class="pack-cs-val">
        ${escHtml(order.street || '')}, ${escHtml(order.barangay || '')}, ${escHtml(order.city || '')}
      </div>
    </div>
    <div>
      <div class="pack-cs-label">Payment</div>
      <div class="pack-cs-val">${escHtml(order.payment_method)}</div>
    </div>
    ${order.special_instructions ? `
    <div style="grid-column:1/-1">
      <div class="pack-cs-label">Special Instructions</div>
      <div class="pack-cs-val" style="color:var(--orange)">${escHtml(order.special_instructions)}</div>
    </div>` : ''}`;

  // Pre-fetch FIFO batches for all catch-weight items
  const catchItems     = (order.items || []).filter(i => i.pricing_model === 'catch_weight');
  const uniqueProducts = [...new Set(catchItems.map(i => i.product_id))];
  await Promise.all(uniqueProducts.map(async pid => {
    const bd = await apiGet('batches_for_product', { product_id: pid });
    packState.batchData[pid] = bd.success ? bd.data : [];
  }));

  // Render each item row
  document.getElementById('pack-items-list').innerHTML =
    (order.items || []).map((item, idx) => {
      const isCatch    = item.pricing_model === 'catch_weight';
      const batches    = isCatch ? (packState.batchData[item.product_id] || []) : [];
      const firstBatch = batches[0];
      const estTotal   = parseFloat(item.estimated_weight || 0) * parseInt(item.quantity || 1);

            const batchPill = firstBatch ? `
        <div class="batch-pill" id="batch-pill-${item.order_item_id}">
          📦 Pulling from: Batch #${firstBatch.batch_id}
          (Rcvd: ${fmtDate(firstBatch.batch_date)}) |
          Available: <strong>${fmtKg(firstBatch.remaining_qty)}</strong>
          &nbsp;<button class="batch-change-btn"
            onclick="openBatchOverride(${item.order_item_id}, ${item.product_id})"
            aria-label="Change batch for ${escHtml(item.name)}">[Change Batch]</button>
        </div>
        <div class="batch-remaining-preview" id="batch-remaining-${item.order_item_id}"></div>
        <div class="batch-override-select" id="batch-override-${item.order_item_id}" style="display:none"></div>
        ${isCatch ? `<div class="split-batch-area" id="split-batch-${item.order_item_id}" style="display:none"></div>` : ''}
        ` : '';

      const outOfStockRow = `
        <div class="oos-toggle-row">
          <label class="oos-toggle-label" for="oos-${item.order_item_id}">
            <input type="checkbox" id="oos-${item.order_item_id}" class="oos-checkbox"
              data-item-id="${item.order_item_id}"
              onchange="toggleOutOfStock(${item.order_item_id}, this.checked)"/>
            Mark as Out of Stock
          </label>
        </div>`;

      const unitLabel = item.pricing_model === 'per_piece' ? 'pc' : 'pack';

      return `
        <div class="pack-item-row" id="pack-row-${item.order_item_id}"
          role="group" aria-label="${escHtml(item.name)}">
          <div class="pack-item-info">
            <div class="pack-item-name">
              ${escHtml(item.name)}
              ${isCatch
                ? '<span class="pack-item-catch-tag">⚖ Catch-Weight</span>'
                : `<span class="pack-item-fixed-tag">${item.pricing_model === 'per_piece' ? 'Per Piece' : 'Fixed Pack'}</span>`}
            </div>
            <div class="pack-item-meta">
              Qty: ${item.quantity} &nbsp;·&nbsp;
              ${isCatch
                ? `${fmtPrice(item.price_per_kg || item.unit_price)}/kg &nbsp;·&nbsp; Est. ${item.estimated_weight} kg/pc`
                : `${fmtPrice(item.price_per_kg || item.unit_price)}/${unitLabel}`}
            </div>
            ${batchPill}
            ${outOfStockRow}
          </div>

          <div class="pack-item-weight-group">
            ${isCatch ? `
            <label for="pack-wt-${item.order_item_id}">Actual Weight (kg)</label>
            <input
              type="number"
              id="pack-wt-${item.order_item_id}"
              class="pack-weight-input"
              data-idx="${idx}"
              data-item-id="${item.order_item_id}"
              data-product-id="${item.product_id}"
              data-price="${item.price_per_kg || item.unit_price}"
              data-qty="${item.quantity}"
              data-est="${estTotal}"
              data-first-batch-id="${firstBatch?.batch_id || ''}"
              data-first-batch-avail="${firstBatch?.remaining_qty || 0}"
              value="${estTotal.toFixed(3)}"
              min="0" step="0.001"
              aria-label="Actual weight in kg for ${escHtml(item.name)}"
              oninput="recalcPackTotal(); checkSplitBatch(${item.order_item_id})"
            />` : `
            <div class="pack-fixed-summary"
              id="pack-fixed-${item.order_item_id}"
              data-item-id="${item.order_item_id}"
              data-price="${item.price_per_kg || item.unit_price}"
              data-qty="${item.quantity}"
              data-est="${estTotal}"
              data-oos="0">
              <span style="font-size:.8rem;color:var(--text-muted)">Qty</span>
              <strong>${item.quantity}</strong>
              <span style="font-size:.8rem;color:var(--text-muted)">×</span>
              <strong>${fmtPrice(item.price_per_kg || item.unit_price)}</strong>
            </div>`}
          </div>

          <div class="pack-item-subtotal" id="pack-sub-${item.order_item_id}" aria-live="polite">
            ${fmtPrice(item.estimated_subtotal)}
          </div>
        </div>`;
    }).join('');

  // Discount / delivery fee rows
  const discRow = document.getElementById('pack-discount-row');
  discRow.style.display = packState.discountAmt > 0 ? 'flex' : 'none';
  if (packState.discountAmt > 0)
    document.getElementById('pack-discount-val').textContent = '−' + fmtPrice(packState.discountAmt);
  document.getElementById('pack-delivery-fee').textContent = fmtPrice(packState.deliveryFee);

  recalcPackTotal();
}

/* ── Batch change: opens a select dropdown ─────────────── */
function openBatchOverride(itemId, productId) {
  const batches   = packState.batchData[productId] || [];
  const container = document.getElementById(`batch-override-${itemId}`);
  if (!container) return;

  container.style.display = 'block';
  container.innerHTML = `
    <label class="batch-override-label" for="batch-sel-${itemId}">Choose batch:</label>
    <select id="batch-sel-${itemId}" class="form-input batch-override-sel"
      onchange="applyBatchOverride(${itemId}, ${productId}, this.value)">
      ${batches.map((b, i) => `
        <option value="${b.batch_id}" ${i === 0 ? 'selected' : ''}>
          Batch #${b.batch_id} (${fmtDate(b.batch_date)}) — ${fmtKg(b.remaining_qty)}
          ${i === 0 ? ' — Recommended' : ''}
        </option>`).join('')}
    </select>`;
}

function applyBatchOverride(itemId, productId, batchId) {
  batchId       = parseInt(batchId);
  const batches = packState.batchData[productId] || [];
  const chosen  = batches.find(b => b.batch_id === batchId);
  if (!chosen) return;

  const pill = document.getElementById(`batch-pill-${itemId}`);
  if (pill) {
    pill.innerHTML = `
      📦 Pulling from: Batch #${chosen.batch_id}
      (Rcvd: ${fmtDate(chosen.batch_date)}) | Available: <strong>${fmtKg(chosen.remaining_qty)}</strong>
      &nbsp;<button class="batch-change-btn"
        onclick="openBatchOverride(${itemId}, ${productId})">[Change Batch]</button>`;
  }

  const input = document.getElementById(`pack-wt-${itemId}`);
  if (input) {
    input.dataset.firstBatchId    = chosen.batch_id;
    input.dataset.firstBatchAvail = chosen.remaining_qty;
  }

  document.getElementById(`batch-override-${itemId}`).style.display = 'none';
  checkSplitBatch(itemId);
}

/* ── Split batch UI — N-batch dynamic ──────────────────── */
function checkSplitBatch(itemId) {
  const input    = document.getElementById(`pack-wt-${itemId}`);
  const splitDiv = document.getElementById(`split-batch-${itemId}`);
  const remDiv   = document.getElementById(`batch-remaining-${itemId}`);
  if (!input || !splitDiv) return;

  const actualWt  = parseFloat(input.value) || 0;
  const avail     = parseFloat(input.dataset.firstBatchAvail) || 0;
  const productId = parseInt(input.dataset.productId);
  const batches   = packState.batchData[productId] || [];

  // Primary-batch remaining preview
  if (remDiv && avail > 0) {
    const afterPack    = Math.max(0, avail - Math.min(actualWt, avail));
    remDiv.textContent = `Remaining after pack: ${afterPack.toFixed(3)} kg`;
    remDiv.className   = 'batch-remaining-preview' +
      (afterPack <= 0 ? ' depleted' : afterPack < LOW_STOCK_THRESHOLD ? ' low' : '');
  }

  if (actualWt > avail && avail > 0 && batches.length > 1) {
    input.classList.add('split-needed');

    // Walk batches FIFO and allocate until the requested weight is satisfied
    let remaining = actualWt;
    const rows    = [];
    for (let i = 0; i < batches.length && remaining > 0.0001; i++) {
      const b      = batches[i];
      const bAvail = i === 0 ? avail : parseFloat(b.remaining_qty || 0);
      const take   = Math.min(remaining, bAvail);
      remaining   -= take;
      rows.push({ batch: b, take, bAvail, isFirst: i === 0 });
    }

    splitDiv.style.display = 'block';
    splitDiv.innerHTML = `
      <div class="split-batch-header">⚠️ Split across ${rows.length} batch${rows.length > 1 ? 'es' : ''}:</div>
      ${rows.map((r, i) => `
        <div class="split-batch-row">
          <span class="split-label">
            Batch #${r.batch.batch_id}
            ${r.isFirst ? '(primary — fully allocated)' : `(${fmtKg(r.bAvail)} available)`}
          </span>
          <input type="number"
            id="split-wt-${itemId}-${i}"
            class="split-wt-input"
            value="${r.take.toFixed(3)}"
            step="0.001" min="0"
            data-batch-id="${r.batch.batch_id}"
            ${r.isFirst ? 'readonly aria-readonly="true"' : ''}
            oninput="syncMultiSplitToMain(${itemId}); recalcPackTotal()"
            aria-label="Weight from batch #${r.batch.batch_id}"/>
          <span class="split-unit">kg</span>
        </div>`).join('')}
      ${remaining > 0.0001 ? `
        <div class="split-batch-warning" role="alert"
          style="color:var(--error,#d32f2f);font-size:.82rem;margin-top:.4rem;font-weight:600">
          ⚠ Insufficient stock across all batches: ${remaining.toFixed(3)} kg unallocated.
          Reduce the requested weight or restock before packing.
        </div>` : ''}`;
  } else {
    input.classList.remove('split-needed');
    splitDiv.style.display = 'none';
    splitDiv.innerHTML     = '';
  }

  recalcPackTotal();
}

/** Keep the main weight input in sync when staff adjusts any split-row input. */
function syncMultiSplitToMain(itemId) {
  const input     = document.getElementById(`pack-wt-${itemId}`);
  if (!input) return;
  const productId = parseInt(input.dataset.productId);
  const batches   = packState.batchData[productId] || [];
  let total       = 0;
  batches.forEach((_, i) => {
    const si = document.getElementById(`split-wt-${itemId}-${i}`);
    if (si) total += parseFloat(si.value) || 0;
  });
  input.value = total.toFixed(3);
}

function toggleOutOfStock(itemId, checked) {
  const input    = document.getElementById(`pack-wt-${itemId}`);      // catch-weight
  const fixedDiv = document.getElementById(`pack-fixed-${itemId}`);   // fixed / per-piece
  const row      = document.getElementById(`pack-row-${itemId}`);
  const splitDiv = document.getElementById(`split-batch-${itemId}`);

  if (input) {
    // Catch-weight path — zero the weight input
    if (checked) {
      input.value    = '0';
      input.disabled = true;
      row?.classList.add('oos-active');
      if (splitDiv) splitDiv.style.display = 'none';
    } else {
      input.value    = (parseFloat(input.dataset.est) || 0).toFixed(3);
      input.disabled = false;
      row?.classList.remove('oos-active');
      checkSplitBatch(itemId);
    }
  } else if (fixedDiv) {
    // Fixed-pack / per-piece path — flag the div; recalc reads this flag
    fixedDiv.dataset.oos = checked ? '1' : '0';
    row?.classList.toggle('oos-active', checked);
  }
  recalcPackTotal();
}

function recalcPackTotal() {
  let subtotal = 0;
  (packState.order?.items || []).forEach(item => {
    const isCatch  = item.pricing_model === 'catch_weight';
    const input    = isCatch
      ? document.getElementById(`pack-wt-${item.order_item_id}`)
      : null;
    const fixedDiv = !isCatch
      ? document.getElementById(`pack-fixed-${item.order_item_id}`)
      : null;
    // Skip only if the expected element for this item type is missing from the DOM
    if (isCatch && !input)   return;
    if (!isCatch && !fixedDiv) return;

    const price = parseFloat(item.price_per_kg || item.unit_price) || 0;
    const qty   = parseInt(item.quantity) || 1;
    let sub;
    if (isCatch) {
      const wt = parseFloat(input.value) || 0;
      sub = price * wt;
    } else {
      sub = (fixedDiv.dataset.oos === '1') ? 0 : price * qty;
    }
    subtotal += sub;
    const subEl = document.getElementById(`pack-sub-${item.order_item_id}`);
    if (subEl) subEl.textContent = fmtPrice(sub);
  });

  const grand = subtotal - packState.discountAmt + packState.deliveryFee;
  document.getElementById('pack-items-subtotal').textContent  = fmtPrice(subtotal);
  document.getElementById('pack-grand-total-val').textContent = fmtPrice(grand);
}

function closePackModal(event) {
  if (event.target !== event.currentTarget) return;
  const hasInput = (packState.order?.items || []).some(item => {
    const input = document.getElementById(`pack-wt-${item.order_item_id}`);
    if (!input || item.pricing_model !== 'catch_weight') return false;
    return Math.abs(parseFloat(input.value) - parseFloat(input.dataset.est)) > 0.001;
  });
  if (hasInput && !confirm('You have unsaved weight entries. Close anyway? All entries will be lost.')) return;
  closePackModalDirect();
}
function closePackModalDirect() {
  releaseFocusTrap();
  document.getElementById('pack-modal-overlay').style.display = 'none';
  packState.order     = null;
  packState.batchData = {};
}

/* ── Confirm pack: build payload and POST ───────────────── */
async function confirmPackOrder() {
  const order = packState.order;
  if (!order) return;

  const btn = document.getElementById('pack-confirm-btn');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  const items = (order.items || []).map(item => {
    const isCatch = item.pricing_model === 'catch_weight';

    if (!isCatch) {
      const fixedDiv  = document.getElementById(`pack-fixed-${item.order_item_id}`);
      const isOos     = fixedDiv?.dataset.oos === '1';
      return {
        order_item_id:   item.order_item_id,
        pricing_model:   item.pricing_model,
        is_catch_weight: false,
        is_out_of_stock: isOos,
        actual_qty:      isOos ? 0 : parseInt(item.quantity || 1),
        batch_overrides: null,
      };
    }

    const input    = document.getElementById(`pack-wt-${item.order_item_id}`);
    const actualWt = parseFloat(input?.value) || (parseFloat(item.estimated_weight) * parseInt(item.quantity || 1));
    const batches  = packState.batchData[item.product_id] || [];
    const firstDs  = input?.dataset;

    let batch_overrides = null;
    const avail = parseFloat(firstDs?.firstBatchAvail || 0);
    const bid1  = parseInt(firstDs?.firstBatchId || batches[0]?.batch_id || 0);

    // Collect all N dynamic split inputs that were rendered by checkSplitBatch
    const splitRows = [];
    batches.forEach((b, i) => {
      const si = document.getElementById(`split-wt-${item.order_item_id}-${i}`);
      if (si) splitRows.push({ batch_id: b.batch_id, weight: parseFloat(si.value) || 0 });
    });

    if (splitRows.length > 0) {
      batch_overrides = splitRows.filter(b => b.batch_id && b.weight > 0);
    } else {
      // No split UI rendered — single-batch deduction
      batch_overrides = [{ batch_id: bid1, weight: actualWt }].filter(b => b.batch_id && b.weight > 0);
    }

    return {
      order_item_id:   item.order_item_id,
      actual_weight:   actualWt,
      pricing_model:   item.pricing_model,
      is_catch_weight: true,
      batch_overrides,
    };
  });

  const data = await apiPost('pack_order', { order_id: order.order_id, items });
  btn.disabled    = false;
  btn.textContent = '✓ Confirm Pack & Set Final Total';

  if (data.success) {
    toast(`✅ Order ${order.order_number} packed! Final total: ${fmtPrice(data.final_total)}`, 'success');
    if (data.batch_alerts?.length) {
      injectLowStockPanel(data.batch_alerts);
    }
    closePackModalDirect();
    loadQueue();
    loadPacked();
  } else {
    toast(data.message || 'Failed to pack order.', 'error');
  }
}

/* ── Thermal labels (40×60mm) ───────────────────────────── */
function printItemLabels() {
  const order = packState.order;
  if (!order) return;

  const labelsHtml = (order.items || []).map(item => {
    const isCatch = item.pricing_model === 'catch_weight';
    const input   = isCatch ? document.getElementById(`pack-wt-${item.order_item_id}`) : null;
    const price   = parseFloat(item.price_per_kg || item.unit_price);
    const qty     = parseInt(item.quantity || 1);
    let sub, wtDisplay;
    if (isCatch) {
      const wt  = parseFloat(input?.value) || (parseFloat(item.estimated_weight) * qty);
      sub        = price * wt;
      wtDisplay  = wt.toFixed(3) + ' kg';
    } else {
      sub        = price * qty;
      wtDisplay  = `${qty} ${item.pricing_model === 'per_piece' ? 'pc' : 'pack'}`;
    }
    return `
      <div class="thermal-label">
        <div class="tl-brand">🐓 PoultryMart</div>
        <div class="tl-product">${escHtml(item.name)}</div>
        <div class="tl-order">${escHtml(order.order_number)}</div>
        <div class="tl-weight">${wtDisplay}</div>
        <div class="tl-price">${fmtPrice(sub)}</div>
        <div class="tl-customer">${escHtml(order.first_name)} ${escHtml(order.last_name)}</div>
        <div class="tl-date">${fmtDate(order.delivery_date)}</div>
      </div>`;
  }).join('');

  const labelsEl = document.getElementById('thermal-labels');
  labelsEl.innerHTML = labelsHtml;
  document.getElementById('print-slip').innerHTML = '';
  labelsEl.setAttribute('data-print-mode', 'active');

  const afterPrint = () => {
    labelsEl.removeAttribute('data-print-mode');
    window.removeEventListener('afterprint', afterPrint);
  };
  window.addEventListener('afterprint', afterPrint);
  // Double rAF ensures the browser has completed layout of the injected
  // thermal-label DOM before handing off to the OS print spooler.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

/* ── Packing slip ───────────────────────────────────────── */
function printPackingSlip() {
  const order = packState.order;
  if (!order) return;

  let subtotal = 0;
  const itemRows = (order.items || []).map(item => {
    const isCatch = item.pricing_model === 'catch_weight';
    const input   = isCatch ? document.getElementById(`pack-wt-${item.order_item_id}`) : null;
    const price   = parseFloat(item.price_per_kg || item.unit_price);
    const qty     = parseInt(item.quantity || 1);
    const unitSuffix = item.pricing_model === 'per_piece' ? 'pc' : 'pack';
    let sub, wtDisplay, priceDisplay;
    if (isCatch) {
      const wt   = parseFloat(input?.value) || (parseFloat(item.estimated_weight) * qty);
      sub          = price * wt;
      wtDisplay    = wt.toFixed(3) + ' kg';
      priceDisplay = fmtPrice(price) + '/kg';
    } else {
      sub          = price * qty;
      wtDisplay    = `${qty} ${unitSuffix}`;
      priceDisplay = fmtPrice(price) + '/' + unitSuffix;
    }
    subtotal += sub;
    return `<tr>
      <td>${escHtml(item.name)}</td>
      <td>${qty}</td>
      <td>${wtDisplay}</td>
      <td>${priceDisplay}</td>
      <td>${fmtPrice(sub)}</td>
    </tr>`;
  }).join('');

  const grand = subtotal - packState.discountAmt + packState.deliveryFee;
  const now   = new Date().toLocaleString('en-PH');

  document.getElementById('print-slip').innerHTML = `
    <div class="slip-header">
      <div class="slip-brand">🐓 PoultryMart</div>
      <div class="slip-portal">Fulfillment Packing Slip</div>
    </div>
    <hr class="slip-hr"/>
    <div class="slip-title">Order: ${escHtml(order.order_number)}</div>
    <div class="slip-meta-grid">
      <div class="slip-meta-item">
        <div class="slip-meta-label">Customer</div>
        <div class="slip-meta-val">${escHtml(order.first_name)} ${escHtml(order.last_name)}</div>
      </div>
      <div class="slip-meta-item">
        <div class="slip-meta-label">Phone</div>
        <div class="slip-meta-val">${escHtml(order.phone || '—')}</div>
      </div>
      <div class="slip-meta-item">
        <div class="slip-meta-label">Delivery Date</div>
        <div class="slip-meta-val">${fmtDate(order.delivery_date)}</div>
      </div>
      <div class="slip-meta-item">
        <div class="slip-meta-label">Time Slot</div>
        <div class="slip-meta-val">${escHtml(order.slot_label || '—')}</div>
      </div>
      <div class="slip-meta-item" style="grid-column:1/-1">
        <div class="slip-meta-label">Address</div>
        <div class="slip-meta-val">
          ${escHtml(order.street || '')}, ${escHtml(order.barangay || '')},
          ${escHtml(order.city || '')}, ${escHtml(order.province || '')}
        </div>
      </div>
      <div class="slip-meta-item">
        <div class="slip-meta-label">Payment</div>
        <div class="slip-meta-val">${escHtml(order.payment_method)}</div>
      </div>
      <div class="slip-meta-item">
        <div class="slip-meta-label">Printed</div>
        <div class="slip-meta-val">${now}</div>
      </div>
    </div>
    <hr class="slip-hr"/>
    <table class="slip-items-table">
      <thead>
        <tr><th>Product</th><th>Qty</th><th>Actual Wt.</th><th>Price/kg</th><th>Subtotal</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <hr class="slip-hr"/>
    <div class="slip-totals">
      <div class="slip-total-row"><span>Items Subtotal</span><span>${fmtPrice(subtotal)}</span></div>
      ${packState.discountAmt > 0
        ? `<div class="slip-total-row">
             <span>Discount</span><span>−${fmtPrice(packState.discountAmt)}</span>
           </div>` : ''}
      <div class="slip-total-row"><span>Delivery Fee</span><span>${fmtPrice(packState.deliveryFee)}</span></div>
      <div class="slip-total-row slip-grand-row">
        <span>FINAL TOTAL</span><span>${fmtPrice(grand)}</span>
      </div>
    </div>
    ${order.special_instructions
      ? `<div class="slip-notes">
           <strong>Special Instructions:</strong> ${escHtml(order.special_instructions)}
         </div>` : ''}
    <div class="slip-footer">
      PoultryMart · Fresh Poultry Delivered in Albay<br/>
      Packed by: ${escHtml(session.user?.first_name || '')} ${escHtml(session.user?.last_name || '')}
    </div>`;

  document.getElementById('thermal-labels').innerHTML   = '';
  document.getElementById('prep-sheet-print').innerHTML = '';

  const slipEl      = document.getElementById('print-slip');
  const afterPrint2 = () => {
    // Clean up the injected slip markup after printing so it doesn't
    // linger in screen layout or affect subsequent print jobs.
    slipEl.innerHTML = '';
    window.removeEventListener('afterprint', afterPrint2);
  };
  window.addEventListener('afterprint', afterPrint2);
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

/* ════════════════════════════════════════════════════════════
   PAGE: ASSIGN RIDERS
═══════════════════════════════════════════════════════════════*/

async function loadPacked() {
  const list = document.getElementById('packed-list');
  list.innerHTML = spinnerHTML('Loading packed orders…');

  const data = await apiGet('orders', { status: 'Packed', page: 1 });
  if (!data.success) {
    list.innerHTML = emptyStateHTML('⚠️', 'Error loading orders', data.message);
    return;
  }
  session.orders.packed = data.data || [];
  zoneViewActive ? renderZoneView() : renderPacked();
}

function filterPacked() { zoneViewActive ? renderZoneView() : renderPacked(); }

function toggleZoneView() {
  zoneViewActive = !zoneViewActive;
  const btn = document.getElementById('zone-view-btn');
  btn.textContent = zoneViewActive ? '📋 List View' : '🗺️ Zone View';
  btn.setAttribute('aria-pressed', String(zoneViewActive));
  zoneViewActive ? renderZoneView() : renderPacked();
}

function renderPacked() {
  const list      = document.getElementById('packed-list');
  const searchVal = (document.getElementById('packed-search')?.value || '').toLowerCase();
  const orders    = session.orders.packed.filter(o =>
    !searchVal ||
    o.order_number.toLowerCase().includes(searchVal) ||
    `${o.first_name} ${o.last_name}`.toLowerCase().includes(searchVal));

  if (!orders.length) {
    list.innerHTML = emptyStateHTML(
      '✅', 'No packed orders awaiting assignment',
      'Pack orders first to assign them to riders.');
    return;
  }

  list.innerHTML = orders.map(o => `
    <article class="packed-card" aria-label="Packed order ${escHtml(o.order_number)}">
      <div class="packed-info">
        <div class="packed-order-num">${escHtml(o.order_number)}</div>
        <div class="packed-customer">
          ${escHtml(o.first_name + ' ' + o.last_name)} &nbsp;·&nbsp; ${escHtml(o.payment_method)}
        </div>
        <div class="packed-meta">
          📅 ${fmtDate(o.delivery_date)} &nbsp;·&nbsp; 📍 ${escHtml(o.zone_city || '—')}
        </div>
      </div>
      <div class="packed-final">
        <div class="packed-final-amount">${fmtPrice(o.final_total)}</div>
        <div class="packed-final-label">Final Total</div>
      </div>
      <div class="btn-actions-row">
        <button class="btn-action btn-action-blue"
          onclick="openDispatchModal(${o.order_id}, '${escHtml(o.order_number)}')">🚀 Dispatch</button>
        <button class="btn-action btn-action-blue"
          onclick="openAssignModal(${o.order_id}, '${escHtml(o.order_number)}')">🛵 Assign Rider</button>
        <button class="btn-action btn-action-muted"
          onclick="openDetailModal(${o.order_id})">👁 Details</button>
        <button class="btn-action btn-action-muted"
          onclick="openPackModal(${o.order_id})">⚖ Re-Pack</button>
      </div>
    </article>`).join('');
}

function renderZoneView() {
  const list   = document.getElementById('packed-list');
  const orders = session.orders.packed;
  if (!orders.length) { renderPacked(); return; }

  // Group by zone
  const zones = {};
  orders.forEach(o => {
    const zkey = o.zone_city || 'Unassigned Zone';
    if (!zones[zkey]) zones[zkey] = { label: zkey, orders: [], ids: [] };
    zones[zkey].orders.push(o);
    zones[zkey].ids.push(o.order_id);
  });

  list.innerHTML = Object.values(zones).map(z => `
    <div class="zone-group-card">
      <div class="zone-group-header">
        <div>
          <span class="zone-group-icon">📍</span>
          <strong>${escHtml(z.label)}</strong>
          <span class="zone-order-count">${z.orders.length} order${z.orders.length > 1 ? 's' : ''}</span>
        </div>
        <button class="btn-action btn-action-blue zone-batch-btn"
          onclick="openBatchAssignModal(${JSON.stringify(z.ids)}, '${escHtml(z.label)}')"
          aria-label="Batch assign all orders in ${escHtml(z.label)} to one rider">
          🛵 Assign All to One Rider
        </button>
      </div>
      <div class="zone-order-list">
        ${z.orders.map(o => `
          <div class="zone-order-row">
            <span class="zone-order-num">${escHtml(o.order_number)}</span>
            <span>${escHtml(o.first_name)} ${escHtml(o.last_name)}</span>
            <span>${escHtml(o.slot_label || '—')}</span>
            <span>${fmtPrice(o.final_total)}</span>
            <button class="btn-action btn-action-muted btn-sm"
              onclick="openAssignModal(${o.order_id}, '${escHtml(o.order_number)}')">🛵 Assign</button>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

/* ── Assign Rider Modal ─────────────────────────────────── */
async function openAssignModal(orderId, orderNum) {
  assignState.orderId        = orderId;
  assignState.orderNum       = orderNum;
  assignState.currentRiderId = null;

  const overlay = document.getElementById('assign-modal-overlay');
  overlay.style.display = 'flex';

  const infoEl = document.getElementById('assign-modal-order-info');
  infoEl.textContent = `Loading order details for ${orderNum}…`;
  document.getElementById('assign-error').style.display = 'none';

  const data = await apiGet('order', { id: orderId });
  if (data.success && data.data.rider_id) {
    assignState.currentRiderId = data.data.rider_id;
    const rName = `${data.data.rider_first || ''} ${data.data.rider_last || ''}`.trim();
    infoEl.innerHTML = `
      Assigning a rider for order <strong>${escHtml(orderNum)}</strong><br/>
      <span role="alert" style="
        display:inline-block;margin-top:.4rem;padding:.35rem .65rem;
        background:var(--warning-bg,#fff8e1);border:1px solid var(--warning,#f59e0b);
        border-radius:var(--radius-sm,4px);font-size:.85rem;color:var(--warning-dark,#b45309)">
        ⚠ Currently assigned to: <strong>${escHtml(rName)}</strong>.
        Re-assigning will revoke their active order notification.
      </span>`;
  } else {
    infoEl.textContent = `Assigning a rider for order ${orderNum}`;
  }

  document.getElementById('rider-select').innerHTML =
    '<option value="">— Choose a rider —</option>' +
    session.riders.map(r =>
      `<option value="${r.user_id}"
         ${r.user_id === assignState.currentRiderId ? 'disabled title="Currently assigned"' : ''}>
         ${escHtml(r.first_name)} ${escHtml(r.last_name)}${r.phone ? ' · ' + r.phone : ''}
       </option>`).join('');

  trapFocus(overlay.querySelector('.modal-box') || overlay);
}
function closeAssignModal(event) {
  if (event.target === event.currentTarget) closeAssignModalDirect();
}
function closeAssignModalDirect() {
  releaseFocusTrap();
  document.getElementById('assign-modal-overlay').style.display = 'none';
}

async function confirmAssignRider() {
  const riderId = parseInt(document.getElementById('rider-select').value);
  const errEl   = document.getElementById('assign-error');
  if (!riderId) {
    errEl.textContent   = 'Please select a rider.';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  const data = await apiPost('assign_rider', {
    order_id:          assignState.orderId,
    rider_id:          riderId,
    previous_rider_id: assignState.currentRiderId || null,
    notify_revoke:     !!assignState.currentRiderId,
  });
  if (data.success) {
    toast(`Rider assigned to ${assignState.orderNum}! 🛵`, 'success');
    closeAssignModalDirect();
    loadPacked();
  } else {
    errEl.textContent   = data.message || 'Failed to assign rider.';
    errEl.style.display = 'block';
  }
}

/* ── Batch Assign Modal ─────────────────────────────────── */
function openBatchAssignModal(orderIds, zoneLabel) {
  batchAssignState.orderIds  = orderIds;
  batchAssignState.zoneLabel = zoneLabel;
  document.getElementById('batch-assign-subtitle').textContent =
    `${orderIds.length} orders in "${zoneLabel}"`;
  document.getElementById('batch-assign-error').style.display = 'none';

  const ordersInZone = session.orders.packed.filter(o => orderIds.includes(o.order_id));
  document.getElementById('batch-assign-orders').innerHTML = ordersInZone.map(o =>
    `<div class="zone-mini-order">
       ${escHtml(o.order_number)} — ${escHtml(o.first_name)} ${escHtml(o.last_name)}
     </div>`).join('');

  document.getElementById('batch-rider-select').innerHTML =
    '<option value="">— Choose a rider —</option>' +
    session.riders.map(r =>
      `<option value="${r.user_id}">${escHtml(r.first_name)} ${escHtml(r.last_name)}</option>`
    ).join('');

  document.getElementById('batch-assign-modal-overlay').style.display = 'flex';
}
function closeBatchAssignModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('batch-assign-modal-overlay').style.display = 'none';
}

async function confirmBatchAssign() {
  const riderId = parseInt(document.getElementById('batch-rider-select').value);
  const errEl   = document.getElementById('batch-assign-error');
  if (!riderId) {
    errEl.textContent   = 'Please select a rider.';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  const data = await apiPost('batch_assign_riders', {
    order_ids: batchAssignState.orderIds,
    rider_id:  riderId,
  });
  if (data.success) {
    toast(`${data.assigned} orders assigned to rider! 🛵`, 'success');
    document.getElementById('batch-assign-modal-overlay').style.display = 'none';
    loadPacked();
  } else {
    errEl.textContent   = data.message || 'Failed to assign.';
    errEl.style.display = 'block';
  }
}

/* ── Dispatch from Assign page ──────────────────────────── */
async function openDispatchModal(orderId, orderNum) {
  const overlay = document.getElementById('dispatch-confirm-overlay');
  const msgEl   = document.getElementById('dispatch-confirm-msg');
  const btn     = document.getElementById('dispatch-confirm-btn');

  overlay.style.display = 'flex';
  msgEl.textContent     = `Verifying payment status for order ${orderNum}…`;
  btn.disabled          = true;
  btn.onclick           = null;

  const data = await apiGet('order', { id: orderId });
  if (!data.success) {
    msgEl.textContent = 'Unable to verify order details. Please refresh and try again.';
    return;
  }

  const order          = data.data;
  const DIGITAL_METHODS = ['gcash', 'maya', 'paymaya', 'bank transfer', 'online payment', 'e-wallet'];
  const methodLower    = (order.payment_method || '').toLowerCase();
  const isDigital      = DIGITAL_METHODS.some(m => methodLower.includes(m));
  const isCleared      = ['Verified', 'Paid'].includes(order.pay_status);

  if (isDigital && !isCleared) {
    msgEl.innerHTML = `
      <div role="alert" style="
        background:var(--error-bg,#fff0f0);
        border:2px solid var(--error,#d32f2f);
        border-radius:var(--radius-md,8px);
        padding:.9rem 1rem;
        text-align:left">
        <strong style="color:var(--error,#d32f2f);font-size:1rem;display:block;margin-bottom:.4rem">
          🚫 Payment Clearance Required
        </strong>
        Order <strong>${escHtml(orderNum)}</strong> uses
        <strong>${escHtml(order.payment_method)}</strong>
        and is currently
        <strong style="color:var(--error,#d32f2f)">${escHtml(order.pay_status || 'Unpaid')}</strong>.
        <br/><br/>
        <span style="font-size:.85rem;color:var(--text-muted,#666)">
          Digital payments must be marked <strong>Verified</strong> or <strong>Paid</strong>
          before dispatch. Contact a <strong>Super Admin</strong> for financial clearance before
          proceeding.
        </span>
      </div>`;
    // btn stays disabled — dispatch is blocked
    return;
  }

  msgEl.textContent = `Dispatch order ${orderNum} for delivery now? This will notify the customer.`;
  btn.disabled      = false;
  btn.onclick       = () => confirmDispatch(orderId, orderNum);
}

function closeDispatchConfirm(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('dispatch-confirm-overlay').style.display = 'none';
}

async function confirmDispatch(orderId, orderNum) {
  document.getElementById('dispatch-confirm-overlay').style.display = 'none';
  const data = await apiPost('dispatch_order', { order_id: orderId });
  if (data.success) {
    toast(`Order ${orderNum} dispatched! 🛵`, 'success');
    loadPacked();
    loadDispatch();
    updateDispatchBadge();
  } else {
    toast(data.message || 'Failed to dispatch.', 'error');
  }
}


/* ════════════════════════════════════════════════════════════
   PAGE: ACTIVE DISPATCH
═══════════════════════════════════════════════════════════════*/

async function loadDispatch() {
  const list = document.getElementById('dispatch-list');
  list.innerHTML = spinnerHTML('Loading active deliveries');

  const data = await apiGet('orders', { status: 'Out for Delivery', page: 1 });
  if (!data.success) {
    list.innerHTML = emptyStateHTML('⚠️', 'Error', data.message);
    return;
  }
  session.orders.dispatch = data.data || [];
  updateDispatchBadge();
  renderDispatch();
}

function filterDispatch() { renderDispatch(); }

function updateDispatchBadge() {
  const b = document.getElementById('nav-badge-dispatch');
  const n = session.orders.dispatch.length;
  if (b) b.textContent = n > 0 ? n : '';
}

function renderDispatch() {
  const list      = document.getElementById('dispatch-list');
  const searchVal = (document.getElementById('dispatch-search')?.value || '').toLowerCase();
  const orders    = session.orders.dispatch.filter(o =>
    !searchVal ||
    o.order_number.toLowerCase().includes(searchVal) ||
    `${o.first_name} ${o.last_name}`.toLowerCase().includes(searchVal));

  if (!orders.length) {
    list.innerHTML = emptyStateHTML(
      '🛵', 'No active deliveries',
      'All riders have returned or no orders dispatched yet.');
    return;
  }

  list.innerHTML = orders.map(o => `
    <article class="dispatch-card" aria-label="Dispatched order ${escHtml(o.order_number)}">
      <div class="dispatch-status-indicator" aria-hidden="true">🛵</div>
      <div class="dispatch-info">
        <div class="dispatch-order-num">${escHtml(o.order_number)}</div>
        <div class="dispatch-customer">${escHtml(o.first_name + ' ' + o.last_name)}</div>
        <div class="dispatch-meta">
          📅 ${fmtDate(o.delivery_date)} &nbsp;·&nbsp;
          📍 ${escHtml(o.zone_city || '—')}
          &nbsp;·&nbsp; ${escHtml(o.slot_label || '—')}
        </div>
      </div>
      <div class="dispatch-total">
        <div>${fmtPrice(o.final_total)}</div>
        <div style="font-size:.75rem;color:var(--text-muted)">Final</div>
      </div>
      <div class="btn-actions-row">
        <button class="btn-action btn-action-green"
          onclick="markDelivered(${o.order_id}, '${escHtml(o.order_number)}')"
          aria-label="Mark order ${escHtml(o.order_number)} as delivered">✅ Mark Delivered</button>
        <button class="btn-action btn-action-muted"
          onclick="openDetailModal(${o.order_id})">👁 Details</button>
      </div>
    </article>`).join('');
}

async function markDelivered(orderId, orderNum) {
  if (!confirm(`Mark order ${orderNum} as delivered and completed?`)) return;
  const data = await apiPost('complete_delivery', { order_id: orderId });
  if (data.success) {
    toast(`Order ${orderNum} marked as delivered! ✅`, 'success');
    loadDispatch();
    loadAllOrders();
  } else {
    toast(data.message || 'Failed.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   PAGE: RETURNS & RESTOCK
═══════════════════════════════════════════════════════════════*/

async function loadReturns() {
  const list = document.getElementById('returns-list');
  list.innerHTML = spinnerHTML('Loading failed deliveries…');

  const data = await apiGet('orders', { status: 'Failed Delivery', page: 1 });
  if (!data.success) {
    list.innerHTML = emptyStateHTML('⚠️', 'Error loading returns', data.message);
    return;
  }

  const orders = data.data || [];
  const badge  = document.getElementById('nav-badge-returns');
  if (badge) {
    badge.textContent = orders.length > 0 ? orders.length : '';
    badge.setAttribute('aria-label', `${orders.length} failed deliveries awaiting review`);
  }

  if (!orders.length) {
    list.innerHTML = emptyStateHTML('✅', 'No pending returns', 'All failed deliveries have been processed.');
    return;
  }

  session.orders.returns = orders;
  renderReturns();
}

function filterReturns() {
  renderReturns();
}

function renderReturns() {
  const list      = document.getElementById('returns-list');
  const searchVal = (document.getElementById('returns-search')?.value || '').toLowerCase();
  const orders    = (session.orders.returns || []).filter(o =>
    !searchVal ||
    o.order_number.toLowerCase().includes(searchVal) ||
    `${o.first_name} ${o.last_name}`.toLowerCase().includes(searchVal));

  if (!orders.length) {
    list.innerHTML = emptyStateHTML('🔍', 'No matching returns', 'Try a different search.');
    return;
  }

  list.innerHTML = orders.map(o => `
    <article class="queue-card" aria-label="Returned order ${escHtml(o.order_number)}">
      <header class="queue-card-header">
        <span class="queue-order-num">${escHtml(o.order_number)}</span>
        <span class="queue-delivery-badge" style="background:var(--error-bg,#fff0f0);color:var(--error,#d32f2f)">
          ↩ Failed Delivery
        </span>
        <div class="queue-card-header-actions">
          <button class="btn-action btn-action-muted" onclick="openDetailModal(${o.order_id})"
            aria-label="View details for order ${escHtml(o.order_number)}">👁 View</button>
        </div>
      </header>
      <div class="queue-card-body">
        <div class="queue-customer-col">
          <div class="queue-col-label">Customer</div>
          <div class="queue-customer-name">${escHtml(o.first_name)} ${escHtml(o.last_name)}</div>
          <div class="queue-customer-detail">
            ${escHtml(o.payment_method)} &nbsp;·&nbsp; ${escHtml(o.slot_label || 'No slot')}
          </div>
        </div>
        <div class="queue-items-col">
          <div class="queue-col-label">Rider Note</div>
          <div style="font-size:.85rem;color:var(--text-muted)">
            ${escHtml(o.failed_delivery_reason || 'No reason provided')}
          </div>
        </div>
        <div class="queue-action-col">
          <div class="queue-est-total">
            <span>Final Total</span>
            <strong>${fmtPrice(o.final_total)}</strong>
          </div>
          <button class="btn-primary" style="background:var(--green,#16a34a)"
            onclick="confirmRestockReturn(${o.order_id}, '${escHtml(o.order_number)}')"
            aria-label="Restock goods from order ${escHtml(o.order_number)}">
            📦 Restock to Inventory
          </button>
          <button class="btn-outline" style="border-color:var(--error,#d32f2f);color:var(--error,#d32f2f)"
            onclick="confirmMarkSpoiled(${o.order_id}, '${escHtml(o.order_number)}')"
            aria-label="Mark goods from order ${escHtml(o.order_number)} as spoiled">
            🚫 Mark as Spoiled
          </button>
        </div>
      </div>
    </article>`).join('');
}

async function confirmRestockReturn(orderId, orderNum) {
  if (!confirm(`Restock all returned goods from order ${orderNum} back to inventory?\nThis will restore batch quantities and mark the order as Restocked.`))
    return;
  const data = await apiPost('restock_return', { order_id: orderId, action: 'restock' });
  if (data.success) {
    toast(`Order ${orderNum} goods restocked to inventory. ✅`, 'success');
    loadReturns();
    loadInventory();
  } else {
    toast(data.message || 'Restock failed.', 'error');
  }
}

async function confirmMarkSpoiled(orderId, orderNum) {
  if (!confirm(`Mark all returned goods from order ${orderNum} as spoiled?\nThis will log a spoilage adjustment and cannot be undone.`))
    return;
  const data = await apiPost('restock_return', { order_id: orderId, action: 'spoiled' });
  if (data.success) {
    toast(`Order ${orderNum} goods marked as spoiled and logged. 🚫`, 'warning');
    loadReturns();
    loadInventory();
  } else {
    toast(data.message || 'Failed to mark as spoiled.', 'error');
  }
}

function openPodModal(url, orderNum) {
  document.getElementById('pod-modal-img').src           = url;
  document.getElementById('pod-modal-caption').textContent = `Proof of delivery — Order ${orderNum}`;
  document.getElementById('pod-modal-overlay').style.display = 'flex';
}
function closePodModal(event) {
  if (!event || event.target === event.currentTarget)
    document.getElementById('pod-modal-overlay').style.display = 'none';
}

/* ════════════════════════════════════════════════════════════
   PAGE: ALL ORDERS
═══════════════════════════════════════════════════════════════*/

async function loadAllOrders() {
  const tbody = document.getElementById('all-orders-tbody');
  tbody.innerHTML = '<tr><td colspan="9" class="table-loading">Loading…</td></tr>';

  const status = document.getElementById('ao-status-filter')?.value || '';
  const search = document.getElementById('ao-search')?.value        || '';
  const data   = await apiGet('orders', { status, search, page: 1 });

  if (!data.success) {
    tbody.innerHTML =
      `<tr><td colspan="9" class="table-loading" style="color:var(--error)">${escHtml(data.message)}</td></tr>`;
    return;
  }
  session.orders.all = data.data || [];

  if (!session.orders.all.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-loading">No orders found.</td></tr>';
    return;
  }

  tbody.innerHTML = session.orders.all.map(o => {
    const name     = `${o.first_name} ${o.last_name}`;
    const isPacked = ['Packed', 'Out for Delivery', 'Arrived at Location', 'Completed'].includes(o.status);
    return `
      <tr>
        <td><strong style="font-family:'Playfair Display',serif">${escHtml(o.order_number)}</strong></td>
        <td>
          ${escHtml(name)}<br/>
          <small style="color:var(--text-muted)">${escHtml(o.email || '')}</small>
        </td>
        <td>${fmtDate(o.delivery_date)}</td>
        <td>${escHtml(o.slot_label || '—')}</td>
        <td>${fmtPrice(o.estimated_total)}</td>
        <td>
          ${isPacked && o.final_total
            ? `<strong style="color:var(--green)">${fmtPrice(o.final_total)}</strong>`
            : '<span style="color:var(--text-muted)">—</span>'}
        </td>
        <td>${statusBadge(o.status)}</td>
        <td>${payBadge(o.pay_status)}</td>
        <td>
          <div class="btn-actions-row">
            <button class="btn-action btn-action-muted"
              onclick="openDetailModal(${o.order_id})">👁 View</button>
            ${o.status === 'Pending'
              ? `<button class="btn-action btn-action-green"
                   onclick="openPackModal(${o.order_id})">⚖ Pack</button>` : ''}
            ${o.status === 'Packed'
              ? `<button class="btn-action btn-action-blue"
                   onclick="openAssignModal(${o.order_id},'${escHtml(o.order_number)}')">🛵 Assign</button>` : ''}
            ${o.status === 'Out for Delivery'
              ? `<button class="btn-action btn-action-green"
                   onclick="markDelivered(${o.order_id},'${escHtml(o.order_number)}')">✅ Delivered</button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════
   PAGE: INVENTORY
═══════════════════════════════════════════════════════════════*/

async function loadInventory() {
  const tbody  = document.getElementById('inventory-tbody');
  const alerts = document.getElementById('inventory-alerts');
  tbody.innerHTML  = '<tr><td colspan="8" class="table-loading">Loading…</td></tr>';
  alerts.innerHTML = '';

  const data = await apiGet('inventory');
  if (!data.success) {
    tbody.innerHTML =
      `<tr><td colspan="8" class="table-loading" style="color:var(--error)">${escHtml(data.message)}</td></tr>`;
    return;
  }
  session.inventory = data.data || [];

  // Build per-product totals for low-stock alerts
  const productMap = {};
  session.inventory.forEach(b => {
    if (!productMap[b.product_id])
      productMap[b.product_id] = { name: b.product_name, total: 0 };
    productMap[b.product_id].total += parseFloat(b.remaining_qty);
  });

  const lowItems = Object.values(productMap).filter(p => p.total < LOW_STOCK_THRESHOLD);
  if (lowItems.length) {
    alerts.innerHTML = lowItems.map(p => `
      <div class="inventory-alert-banner" role="alert">
        <span class="alert-icon">⚠️</span>
        <div class="alert-text">
          <strong>${escHtml(p.name)}</strong>
          <span> — only <strong>${p.total.toFixed(3)} kg</strong> remaining. Restock soon.</span>
        </div>
      </div>`).join('');
  }

  if (!session.inventory.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-loading">No batches found.</td></tr>';
    return;
  }

  tbody.innerHTML = session.inventory.map(b => {
    const remaining = parseFloat(b.remaining_qty);
    const quantity  = parseFloat(b.quantity);
    const pct       = quantity > 0 ? Math.min(100, (remaining / quantity) * 100) : 0;
    const level     = remaining < LOW_STOCK_THRESHOLD ? 'critical' : remaining < 15 ? 'low' : 'ok';
    return `
      <tr>
        <td><strong>${escHtml(b.product_name)}</strong></td>
        <td><span style="font-size:.8rem;color:var(--text-muted)">${escHtml(b.category_name)}</span></td>
        <td><span class="batch-id-tag">#${b.batch_id}</span></td>
        <td>${fmtDate(b.batch_date)}</td>
        <td>${quantity.toFixed(3)} kg</td>
        <td>${remaining.toFixed(3)} kg</td>
        <td>
          <div class="stock-bar-wrap stock-${level}">
            <div class="stock-bar" role="progressbar"
              aria-valuenow="${pct.toFixed(0)}" aria-valuemin="0" aria-valuemax="100">
              <div class="stock-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="stock-val">${remaining.toFixed(1)} kg</span>
          </div>
        </td>
        <td>
          <button class="btn-action btn-action-muted"
            onclick="openAdjustStockModal(${b.batch_id}, '${escHtml(b.product_name)}', ${remaining})"
            aria-label="Adjust stock for batch ${b.batch_id}">➖ Adjust</button>
        </td>
      </tr>`;
  }).join('');
}

/* ── Adjust Stock Modal ─────────────────────────────────── */
function openAdjustStockModal(batchId, productName, currentQty) {
  adjustState.batchId = batchId;
  document.getElementById('adjust-stock-info').textContent    = `Batch #${batchId} — ${productName}`;
  document.getElementById('adjust-stock-current').value       = currentQty.toFixed(3) + ' kg';
  document.getElementById('adjust-stock-new').value           = '';
  document.getElementById('adjust-notes').value               = '';
  document.getElementById('adjust-stock-error').style.display = 'none';
  const overlay = document.getElementById('adjust-stock-modal-overlay');
  overlay.style.display = 'flex';
  trapFocus(overlay.querySelector('.modal-box') || overlay);
}
function closeAdjustStockModal(event) {
  if (event && event.target !== event.currentTarget) return;
  releaseFocusTrap();
  document.getElementById('adjust-stock-modal-overlay').style.display = 'none';
}

async function confirmAdjustStock() {
  const newQty  = parseFloat(document.getElementById('adjust-stock-new').value);
  const reason  = document.getElementById('adjust-reason').value;
  const notes   = document.getElementById('adjust-notes').value;
  const errEl   = document.getElementById('adjust-stock-error');

  if (isNaN(newQty) || newQty < 0) {
    errEl.textContent   = 'Please enter a valid quantity (0 or more).';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  // ── Pre-flight: verify the batch has no active order allocations that
  //   would be broken by reducing stock below the allocated amount. ────
  const allocData = await apiGet('batch_allocations', { batch_id: adjustState.batchId });
  if (allocData.success && parseFloat(allocData.allocated_qty || 0) > 0) {
    const allocQty = parseFloat(allocData.allocated_qty);
    if (newQty < allocQty) {
      const conflictList = (allocData.conflicting_orders || [])
        .map(o => `#${o.order_number}`)
        .join(', ');
      errEl.innerHTML = `
        <strong>⚠ Adjustment Blocked — Active Allocation Conflict</strong><br/>
        This batch has <strong>${allocQty.toFixed(3)} kg</strong> allocated
        to orders currently in <em>Packed</em> or <em>Out for Delivery</em> status:
        <strong>${escHtml(conflictList || 'see order list')}</strong>.<br/>
        <span style="font-size:.85rem">
          The new physical quantity (<strong>${newQty.toFixed(3)} kg</strong>) is below
          the allocated amount. Fulfil or cancel the conflicting orders before
          reducing this batch.
        </span>`;
      errEl.style.display = 'block';
      return;
    }
  }

  const data = await apiPost('adjust_stock', {
    batch_id:            adjustState.batchId,
    actual_physical_qty: newQty,
    reason_code:         reason,
    notes,
  });

  if (data.success) {
    const dir    = data.variance >= 0 ? '▲' : '▼';
    const varAbs = Math.abs(data.variance).toFixed(3);
    toast(`Stock adjusted. ${dir} ${varAbs} kg variance logged.`, 'success');
    closeAdjustStockModal();
    loadInventory();
  } else {
    errEl.textContent   = data.message || 'Failed.';
    errEl.style.display = 'block';
  }
}

/* ════════════════════════════════════════════════════════════
   ORDER DETAIL MODAL (read-only)
═══════════════════════════════════════════════════════════════*/

async function openDetailModal(orderId) {
  const overlay = document.getElementById('detail-modal-overlay');
  const content = document.getElementById('detail-modal-content');
  overlay.style.display = 'flex';
  content.innerHTML     = spinnerHTML('Loading order');

  const data = await apiGet('order', { id: orderId });
  if (!data.success) {
    content.innerHTML = `<p style="color:var(--error)">${escHtml(data.message)}</p>`;
    return;
  }

  const o        = data.data;
  const isPacked = ['Packed', 'Out for Delivery', 'Arrived at Location', 'Completed'].includes(o.status);
  const items    = o.items || [];
  let itemsTotal = 0;

  const itemRows = items.map(i => {
    const sub = isPacked && i.final_subtotal
      ? parseFloat(i.final_subtotal)
      : parseFloat(i.estimated_subtotal);
    itemsTotal += sub;
    return `
      <tr>
        <td>
          ${escHtml(i.name)}
          ${i.pricing_model === 'catch_weight'
            ? '<span style="font-size:.7rem;color:var(--orange);font-weight:700;margin-left:.3rem">⚖</span>'
            : ''}
        </td>
        <td style="text-align:center">${i.quantity}</td>
        <td>
          ${i.pricing_model === 'catch_weight'
            ? (isPacked && i.actual_weight
                ? `<strong>${parseFloat(i.actual_weight).toFixed(3)} kg</strong>`
                : `~${i.estimated_weight} kg`)
            : `${i.quantity} ${i.pricing_model === 'per_piece' ? 'pc' : 'pack'}`}
        </td>
        <td>${i.pricing_model === 'catch_weight'
          ? fmtPrice(i.price_per_kg || i.unit_price) + '/kg'
          : fmtPrice(i.price_per_kg || i.unit_price) + '/' + (i.pricing_model === 'per_piece' ? 'pc' : 'pack')}</td>
        <td style="text-align:right;font-weight:700">
          ${isPacked && i.final_subtotal
            ? `<span style="color:var(--green)">${fmtPrice(i.final_subtotal)}</span>`
            : fmtPrice(i.estimated_subtotal)}
        </td>
        ${o.status === 'Pending'
          ? `<td>
               <button class="btn-action btn-action-muted" style="font-size:.72rem"
                 onclick="markItemOos(${o.order_id}, ${i.order_item_id}, '${escHtml(i.name)}')"
                 aria-label="Mark ${escHtml(i.name)} as out of stock">🚫 OOS</button>
             </td>`
          : '<td></td>'}
      </tr>`;
  }).join('');

  const riderInfo    = o.rider_first
    ? `${o.rider_first} ${o.rider_last} ${o.rider_phone ? `(${o.rider_phone})` : ''}`
    : 'Not assigned';
  const dispatchedAt = o.dispatched_at ? fmtDateTime(o.dispatched_at) : '—';
  const deliveredAt  = o.delivered_at  ? fmtDateTime(o.delivered_at)  : '—';
  const hasPod       = o.proof_of_delivery_url;

  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;flex-wrap:wrap">
      <h2 style="font-size:1.2rem;margin:0">${escHtml(o.order_number)}</h2>
      ${statusBadge(o.status)} ${payBadge(o.pay_status)}
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Customer &amp; Delivery</div>
      <div class="detail-info-grid">
        <div class="detail-info-item">
          <div class="detail-info-label">Customer</div>
          <div class="detail-info-val">${escHtml(o.first_name)} ${escHtml(o.last_name)}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Phone</div>
          <div class="detail-info-val">${escHtml(o.phone || '—')}</div>
        </div>
        <div class="detail-info-item" style="grid-column:1/-1">
          <div class="detail-info-label">Address</div>
          <div class="detail-info-val">
            ${escHtml(o.addr_label || '')}: ${escHtml(o.street)},
            ${escHtml(o.barangay)}, ${escHtml(o.city)}, ${escHtml(o.province)}
          </div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Delivery Date</div>
          <div class="detail-info-val">${fmtDate(o.delivery_date)}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Time Slot</div>
          <div class="detail-info-val">${escHtml(o.slot_label || '—')}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Payment Method</div>
          <div class="detail-info-val">${escHtml(o.payment_method)}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Rider</div>
          <div class="detail-info-val">${escHtml(riderInfo)}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Dispatched At</div>
          <div class="detail-info-val">${dispatchedAt}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Delivered At</div>
          <div class="detail-info-val">${deliveredAt}</div>
        </div>
        ${hasPod ? `
        <div class="detail-info-item" style="grid-column:1/-1">
          <div class="detail-info-label">Proof of Delivery</div>
          <div class="detail-info-val">
            <button class="btn-action btn-action-blue"
              onclick="openPodModal('${escHtml(o.proof_of_delivery_url)}', '${escHtml(o.order_number)}')">
              📸 View Photo
            </button>
          </div>
        </div>` : ''}
        ${o.special_instructions ? `
        <div class="detail-info-item" style="grid-column:1/-1">
          <div class="detail-info-label">Special Instructions</div>
          <div class="detail-info-val" style="color:var(--orange)">${escHtml(o.special_instructions)}</div>
        </div>` : ''}
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Items (${items.length})</div>
      <table class="detail-items-table">
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center">Qty</th>
            <th>Weight</th>
            <th>Price/kg</th>
            <th style="text-align:right">Subtotal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div class="detail-total-rows">
        <div class="detail-total-row"><span>Items</span><span>${fmtPrice(itemsTotal)}</span></div>
        ${o.discount_amount > 0
          ? `<div class="detail-total-row" style="color:var(--green)">
               <span>Discount</span><span>−${fmtPrice(o.discount_amount)}</span>
             </div>` : ''}
        <div class="detail-total-row">
          <span>Delivery Fee</span><span>${fmtPrice(o.delivery_fee)}</span>
        </div>
        ${isPacked && o.final_total
          ? `<div class="detail-total-row grand">
               <span>✓ Final Total</span><span>${fmtPrice(o.final_total)}</span>
             </div>`
          : `<div class="detail-total-row grand">
               <span>Estimated Total</span><span>${fmtPrice(o.estimated_total)}</span>
             </div>`}
      </div>
    </div>

    <div style="display:flex;gap:.75rem;margin-top:1rem;flex-wrap:wrap">
      ${o.status === 'Pending'
        ? `<button class="btn-primary"
             onclick="closeDetailModalDirect(); openPackModal(${o.order_id})">⚖ Pack This Order</button>` : ''}
      ${o.status === 'Packed'
        ? `<button class="btn-primary"
             onclick="closeDetailModalDirect(); openAssignModal(${o.order_id}, '${escHtml(o.order_number)}')">
             🛵 Assign Rider</button>
           <button class="btn-outline"
             onclick="closeDetailModalDirect(); openDispatchModal(${o.order_id}, '${escHtml(o.order_number)}')">
             🚀 Dispatch</button>` : ''}
      ${o.status === 'Out for Delivery'
        ? `<button class="btn-primary"
             onclick="closeDetailModalDirect(); markDelivered(${o.order_id}, '${escHtml(o.order_number)}')">
             ✅ Mark Delivered</button>` : ''}
    </div>`;
}

async function markItemOos(orderId, itemId, itemName) {
  if (!confirm(`Mark "${itemName}" as Out of Stock? This will zero the item and recalculate the order total.`))
    return;
  closeDetailModalDirect();

  const data = await apiPost('mark_out_of_stock', {
    order_id:      orderId,
    order_item_id: itemId,
  });
  if (data.success) {
    toast(`"${itemName}" marked Out of Stock. New total: ${fmtPrice(data.new_total)}`, 'warning');
    loadQueue();
    loadAllOrders();
  } else {
    toast(data.message || 'Failed.', 'error');
  }
}

function closeDetailModal(event) {
  if (event.target === event.currentTarget) closeDetailModalDirect();
}
function closeDetailModalDirect() {
  document.getElementById('detail-modal-overlay').style.display = 'none';
}

/* ════════════════════════════════════════════════════════════
   PERSISTENT LOW-STOCK ALERT PANEL
═══════════════════════════════════════════════════════════════*/

/**
 * Inject (or update) a persistent, dismissible "Action Required: Low Stock"
 * summary panel at the top of the Packing Queue page.
 * Replaces the old approach of spamming individual ephemeral toasts.
 *
 * @param {string[]} alerts  Array of human-readable alert strings from the API.
 */
function injectLowStockPanel(alerts) {
  if (!alerts?.length) return;

  const queuePage = document.getElementById('page-queue');
  if (!queuePage) return;

  // Reuse an existing panel if one is already displayed
  let panel = document.getElementById('low-stock-alert-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'low-stock-alert-panel';
    panel.setAttribute('role', 'alert');
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('aria-atomic', 'true');
    panel.style.cssText =
      'background:var(--warning-bg,#fffbeb);border:2px solid var(--warning,#f59e0b);' +
      'border-radius:var(--radius-md,8px);padding:.85rem 1rem 1rem;margin:0 0 1rem;' +
      'position:relative;';
    // Insert before the summary bar so it appears at the top of the queue body
    const summaryBar = document.getElementById('queue-summary-bar');
    if (summaryBar) {
      queuePage.insertBefore(panel, summaryBar);
    } else {
      queuePage.prepend(panel);
    }
  }

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
      <strong style="color:var(--warning-dark,#b45309);font-size:.95rem">
        ⚠ Action Required: Low Stock
      </strong>
      <button
        onclick="document.getElementById('low-stock-alert-panel').remove()"
        aria-label="Dismiss low stock alert"
        style="background:none;border:none;cursor:pointer;font-size:1rem;
               color:var(--warning-dark,#b45309);line-height:1;padding:.1rem .3rem">
        ✕
      </button>
    </div>
    <ul style="margin:0;padding-left:1.25rem;font-size:.88rem;
               color:var(--warning-dark,#b45309);line-height:1.6">
      ${alerts.map(a => `<li>${escHtml(a)}</li>`).join('')}
    </ul>
    <p style="margin:.6rem 0 0;font-size:.8rem;color:var(--text-muted,#666)">
      These batches require immediate re-ordering. Contact your supplier.
    </p>`;
}

/* ════════════════════════════════════════════════════════════
   KEYBOARD ACCESSIBILITY
═══════════════════════════════════════════════════════════════*/

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('pack-modal-overlay').style.display        !== 'none') closePackModalDirect();
  if (document.getElementById('assign-modal-overlay').style.display      !== 'none') closeAssignModalDirect();
  if (document.getElementById('detail-modal-overlay').style.display      !== 'none') closeDetailModalDirect();
  if (document.getElementById('adjust-stock-modal-overlay').style.display !== 'none') closeAdjustStockModal();
  if (document.getElementById('batch-assign-modal-overlay').style.display !== 'none') closeBatchAssignModal();
  if (document.getElementById('prep-sheet-modal-overlay').style.display  !== 'none') closePrepSheetModal();
  if (document.getElementById('pod-modal-overlay').style.display         !== 'none') closePodModal();
  if (document.getElementById('dispatch-confirm-overlay').style.display  !== 'none') closeDispatchConfirm();
  if (document.getElementById('cancel-overlay').style.display            !== 'none') dismissCancelOverlay();
  const notifPanel = document.getElementById('notif-panel');
  if (notifPanel && notifPanel.style.display !== 'none') notifPanel.style.display = 'none';
});

/* ════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════*/

document.addEventListener('DOMContentLoaded', () => {
  // Restore session from sessionStorage (survives page refresh, cleared on tab close)
  const saved = sessionStorage.getItem('pm_staff_session');
  if (saved) {
    try {
      session.user = JSON.parse(saved);
      initApp();
    } catch(e) {
      sessionStorage.removeItem('pm_staff_session');
    }
  }
  // Create mobile sidebar overlay dynamically (same pattern as original)
  const overlay = document.createElement('div');
  overlay.id        = 'portal-sidebar-overlay';
  overlay.className = 'portal-sidebar-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.addEventListener('click', closeSidebar);
  document.body.appendChild(overlay);

  // Lazy-load queue card items when cards appear in the DOM
  const queueObserver = new MutationObserver(() => {
    document.querySelectorAll('[id^="queue-items-"]').forEach(el => {
      const orderId = el.id.replace('queue-items-', '');
      if (!el.dataset.loaded) loadQueueCardItems(orderId);
    });
  });
  const ql = document.getElementById('queue-list');
  if (ql) queueObserver.observe(ql, { childList: true });
});