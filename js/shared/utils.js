/**
 * utils.js — Pure formatting and DOM utility helpers.
 *
 * Shared across all four portals.  Every function is stateless
 * and has no side effects (except setLoading / setEmpty which
 * mutate a single DOM element you pass the id of).
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   STRING / HTML HELPERS
═══════════════════════════════════════════════════════════════*/

/**
 * Escape HTML special characters.
 * @param {*} s
 * @returns {string}
 */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ════════════════════════════════════════════════════════════
   NUMBER / DATE FORMATTERS
═══════════════════════════════════════════════════════════════*/

/**
 * Format a number as Philippine Peso (₱1,234.56).
 * @param {number|string} n
 * @returns {string}
 */
function fmtPrice(n) {
  return '₱' + parseFloat(n || 0)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a kilogram quantity to 3 decimal places.
 * @param {number|string} n
 * @returns {string}
 */
function fmtKg(n) {
  return parseFloat(n || 0).toFixed(3) + ' kg';
}

/**
 * Format a YYYY-MM-DD (or datetime) string to localised en-PH date.
 * @param {string} d
 * @returns {string}
 */
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

/**
 * Format a datetime string to short en-PH date + time.
 * @param {string} d
 * @returns {string}
 */
function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' ' +
         dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format HH:MM:SS to 12-hour string.
 * @param {string} t
 * @returns {string}
 */
function fmtTime12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/* ════════════════════════════════════════════════════════════
   DATE PREDICATES
═══════════════════════════════════════════════════════════════*/

/**
 * Return true if dateStr (YYYY-MM-DD) is today.
 * @param {string} dateStr
 * @returns {boolean}
 */
function isToday(dateStr) {
  return !!dateStr && dateStr.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

/**
 * Return true if dateStr is tomorrow.
 * @param {string} dateStr
 * @returns {boolean}
 */
function isTomorrow(dateStr) {
  if (!dateStr) return false;
  const tom = new Date();
  tom.setDate(tom.getDate() + 1);
  return dateStr.slice(0, 10) === tom.toISOString().slice(0, 10);
}

/**
 * Human-readable urgency label for a delivery date.
 * @param {string} dateStr
 * @returns {string}
 */
function deliveryLabel(dateStr) {
  if (isToday(dateStr))    return '🔴 Today';
  if (isTomorrow(dateStr)) return '🟡 Tomorrow';
  return '🟢 ' + fmtDate(dateStr);
}

/**
 * Return true if the delivery date is today or tomorrow.
 * @param {string} dateStr
 * @returns {boolean}
 */
function isUrgent(dateStr) {
  return isToday(dateStr) || isTomorrow(dateStr);
}

/* ════════════════════════════════════════════════════════════
   PRODUCT / PRICING HELPERS
═══════════════════════════════════════════════════════════════*/

/**
 * Return the emoji icon for a category name.
 * Requires CAT_ICONS from constants.js.
 * @param {string} catName
 * @returns {string}
 */
function productIcon(catName) {
  return CAT_ICONS[catName] || '🐓';
}

/**
 * Return the human-readable label for a pricing_model enum value.
 * @param {string} model
 * @returns {string}
 */
function pricingModelLabel(model) {
  return PRICING_MODELS[model]?.label || model;
}

/**
 * Return the unit suffix string for a unit_of_measure value.
 * @param {string} unit
 * @returns {string}
 */
function unitLabel(unit) {
  return UNIT_LABELS[unit] || unit;
}

/**
 * Return the CSS badge class for a pricing_model value.
 * @param {string} model
 * @returns {string}
 */
function pricingModelBadgeClass(model) {
  return PRICING_MODELS[model]?.badgeClass || '';
}

/**
 * Return the CSS badge class for a unit_of_measure / batch_unit value.
 * @param {string} unit
 * @returns {string}
 */
function unitBadgeClass(unit) {
  // Map unit → badgeClass via PRICING_MODELS
  const entry = Object.values(PRICING_MODELS).find(p => p.unit === unit);
  return entry?.unitBadge || '';
}

/**
 * Compute the estimated subtotal for one cart/order line.
 * Mirrors the PHP CartService::estimatedSubtotal() exactly.
 *
 *   catch_weight → qty × estimated_weight × base_price
 *   fixed_pack   → qty × base_price
 *   per_piece    → qty × base_price
 *
 * @param {string} pricingModel
 * @param {number} qty
 * @param {number} basePrice
 * @param {number} estimatedWeight
 * @returns {number}
 */
function estimatedSubtotal(pricingModel, qty, basePrice, estimatedWeight) {
  qty             = parseInt(qty);
  basePrice       = parseFloat(basePrice);
  estimatedWeight = parseFloat(estimatedWeight);
  if (pricingModel === 'catch_weight') {
    return qty * estimatedWeight * basePrice;
  }
  return qty * basePrice;
}

/* ════════════════════════════════════════════════════════════
   STATUS BADGE BUILDERS
═══════════════════════════════════════════════════════════════*/

/**
 * Build an order status badge HTML string.
 * @param {string} s
 * @returns {string}
 */
function statusBadge(s) {
  const cls = {
    'Pending':             'status-Pending',
    'Packed':              'status-Packed',
    'Out for Delivery':    'status-Out-for-Delivery',
    'Arrived at Location': 'status-Arrived',
    'Completed':           'status-Completed',
    'Cancelled':           'status-Cancelled',
  }[s] || '';
  return `<span class="status-badge ${cls}">${escHtml(s)}</span>`;
}

/**
 * Build a payment-status badge HTML string.
 * @param {string} ps
 * @returns {string}
 */
function payBadge(ps) {
  const safe = ps || 'Unpaid';
  return `<span class="status-badge pay-status-${safe}">${safe}</span>`;
}

/**
 * Return the icon for a payment method.
 * @param {string} method
 * @returns {string}
 */
function payIcon(method) {
  return method === 'GCash' ? '💙' : '💵';
}

/**
 * Return the emoji icon for a notification type.
 * @param {string} type
 * @returns {string}
 */
function notifTypeIcon(type) {
  const icons = {
    order_placed:        '📦',
    final_total:         '⚖',
    packed:              '📬',
    dispatched:          '🚴',
    cancelled:           '❌',
    partial_fulfillment: '⚠️',
    general:             '🔔',
  };
  return icons[type] || '🔔';
}

/* ════════════════════════════════════════════════════════════
   REUSABLE HTML SNIPPETS
═══════════════════════════════════════════════════════════════*/

/**
 * Build a loading spinner HTML string.
 * @param {string} [label]
 * @returns {string}
 */
function spinnerHTML(label = 'Loading') {
  return `<div class="spinner" role="status" aria-label="${escHtml(label)}">
    <span class="sr-only">${escHtml(label)}…</span>
  </div>`;
}

/**
 * Build a generic error HTML string.
 * @param {string} msg
 * @returns {string}
 */
function errorHTML(msg) {
  return `<p class="form-error" role="alert">${escHtml(msg || 'An error occurred.')}</p>`;
}

/**
 * Build an empty-state HTML string.
 * @param {string} icon
 * @param {string} heading
 * @param {string} body
 * @returns {string}
 */
function emptyStateHTML(icon, heading, body) {
return `<div class="empty-state" role="status">
  <span class="empty-state__icon" aria-hidden="true">${icon}</span>
    ${heading ? `<h4>${escHtml(heading)}</h4>` : ''}
    <p>${escHtml(body)}</p>
  </div>`;
}

/**
 * Build a stat pill HTML string.
 * @param {string} modClass
 * @param {string} icon
 * @param {string|number} val
 * @param {string} label
 * @returns {string}
 */
function statPillHTML(modClass, icon, val, label) {
  return `<div class="rider-stat-pill ${modClass}" role="figure" aria-label="${escHtml(label)}: ${escHtml(String(val))}">
    <span class="rsp-icon" aria-hidden="true">${icon}</span>
    <div class="rsp-info">
      <span class="rsp-val" aria-hidden="true">${escHtml(String(val))}</span>
      <span class="rsp-label">${escHtml(label)}</span>
    </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════════
   DOM HELPERS
═══════════════════════════════════════════════════════════════*/

/**
 * Set an element to a loading state.
 * @param {string} id  - element id
 * @param {string} [msg]
 */
function setLoading(id, msg = 'Loading…') {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="table-loading">${escHtml(msg)}</div>`;
}

/**
 * Set an element to an empty state.
 * @param {string} id  - element id
 * @param {string} icon
 * @param {string} msg
 */
function setEmpty(id, icon, msg) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="empty-state"><span class="empty-state__icon" aria-hidden="true">${icon}</span><p class="empty-state__body">${escHtml(msg)}</p></div>`}

/**
 * Render a numbered/ellipsis pagination bar into a container.
 * @param {string}   containerId
 * @param {number}   currentPage
 * @param {number}   totalPages
 * @param {Function} onPageChange  - called with the new page number
 */
function renderPagination(containerId, currentPage, totalPages, onPageChange) {
  const el = document.getElementById(containerId);
  if (!el || totalPages <= 1) { if (el) el.innerHTML = ''; return; }

  let html = `<button class="page-btn" ${currentPage <= 1 ? 'disabled' : ''} aria-label="Previous">‹</button>`;
  html = html.replace('>', ` onclick="(${onPageChange})(${currentPage - 1})">`);

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 2) {
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="(${onPageChange})(${i})">${i}</button>`;
    } else if (Math.abs(i - currentPage) === 3) {
      html += `<span style="padding:0 .25rem;color:var(--text-muted)">…</span>`;
    }
  }

  html += `<button class="page-btn" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="Next">›</button>`;
  html = html.replace(/aria-label="Next">/, `aria-label="Next" onclick="(${onPageChange})(${currentPage + 1})">`);

  el.innerHTML = html;
}

/* ════════════════════════════════════════════════════════════
   ACCESSIBILITY HELPERS (shared with rider)
═══════════════════════════════════════════════════════════════*/

/**
 * Trap keyboard Tab focus within a container element.
 * Returns a cleanup function that removes the event listener.
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
function trapFocus(container) {
  const focusable = container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];

  function handler(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first?.focus(); }
    }
  }

  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

/**
 * Build a Google Maps URL from order address/coords.
 * @param {Object} o
 * @returns {string}
 */
function buildMapsUrl(o) {
  if (o.latitude && o.longitude) {
    return `https://maps.google.com/?q=${o.latitude},${o.longitude}`;
  }
  return `https://maps.google.com/?q=${encodeURIComponent(
    [o.street, o.barangay, o.city].filter(Boolean).join(', ')
  )}`;
}