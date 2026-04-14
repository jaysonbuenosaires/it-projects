/**
 * customer.js — Customer Portal Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Improvements in this version:
 *  • Direct quantity text-input in cart & product detail
 *  • Real-time promo code validation (validate_promo endpoint)
 *  • Remove applied promo code
 *  • Delivery date restricted to operational_hours days only
 *  • Time slots: past slots hidden for same-day delivery
 *  • Out-of-stock warnings (product_batches.remaining_qty)
 *  • Order tracking timeline (step-by-step visual)
 *  • Dispatch / delivery timestamps on order detail
 *  • Proof of Delivery display
 *  • Cancellation reason dropdown
 *  • Payment verification status (GCash)
 *  • Leave a Review button on completed orders
 *  • File a Dispute button on completed orders
 *  • Dispute status tracking
 *  • Change Password in profile
 *  • Default address tagged in checkout dropdown
 *  • Low-stock warnings on catalog cards
 *  • Wholesale tier banner on product cards
 *
 * Depends on (loaded before this file):
 *   shared/constants.js · shared/utils.js · shared/uiHelpers.js · shared/apiService.js
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════*/

const state = {
  user:           null,
  cart:           [],
  products:       [],       // full product list with stock & wholesale data
  categories:     [],
  currentProduct: null,
  pageHistory:    ['home'],
  detailQty:      1,
  checkoutPromo:  null,     // { promo_id, code, discount_type, discount_value, discount_amount }
  checkoutMeta:   null,     // { zones, slots, hours }
  savedAddresses: [],
  notifications:  [],
notifFilter:    '',       // active notification type filter ('' = all)
serverTime:     null,     // { date, time, dow } from Asia/Manila server clock
  allOrders:      null,     // raw order list cache for client-side filtering
  stockMap:       {},       // product_id → remaining_qty  (refreshed on cart/catalog load)
};

/* ════════════════════════════════════════════════════════════
   API SERVICE
═══════════════════════════════════════════════════════════════*/

const CUSTOMER_API = 'api/customer_api.php';
const { apiFetch, apiUrl } = createSimpleApiFetch(CUSTOMER_API);

/* ════════════════════════════════════════════════════════════
   ALBAY ADDRESS DATA
═══════════════════════════════════════════════════════════════*/

// ALBAY_DATA is now loaded from the API on first use.
// Use loadGeoData() below; do not reference ALBAY_DATA directly.
let ALBAY_DATA = {};

let _geoDataPromise = null;
async function loadGeoData() {
  if (Object.keys(ALBAY_DATA).length > 0) return; // already loaded
  if (_geoDataPromise) return _geoDataPromise;     // in-flight — reuse same promise
  _geoDataPromise = (async () => {
  try {
    const res = await apiFetch(apiUrl('geo_data'));
    if (res.success && Array.isArray(res.data)) {
      res.data.forEach(muni => {
        ALBAY_DATA[muni.name] = muni.barangays.map(b => ({
          ...b,
          municipality_id: muni.municipality_id,
        }));
      });
    }
  } catch (e) {
    console.error('[PoultryMart] Failed to load geo data', e);
  }
  })();
  return _geoDataPromise;
}

/**
 * Populate the municipality select, then wire barangay cascade.
 * Call once on page load for each form that uses these dropdowns.
 */
async function initMunicipalitySelect(cityId, barangayId) {
  const cityEl = document.getElementById(cityId);
  if (!cityEl) return;
  await loadGeoData();

  const municipalities = Object.entries(ALBAY_DATA).sort((a,b) => a[0].localeCompare(b[0]));
  cityEl.innerHTML = '<option value="">— Select municipality —</option>' +
    municipalities.map(([name, bgys]) => {
      // Find municipality_id from any barangay entry (all share the same parent)
      const mid = bgys[0]?.municipality_id ?? '';
      return `<option value="${name}" data-municipality-id="${mid}">${name}</option>`;
    }).join('');
  // Wire cascade
  cityEl.onchange = () => populateBarangays(cityId, barangayId);
}

function populateBarangays(cityId, barangayId) {
  const cityEl = document.getElementById(cityId);
  const bgyEl  = document.getElementById(barangayId);
  if (!cityEl || !bgyEl) return;
  const barangays = ALBAY_DATA[cityEl.value] || [];
  bgyEl.innerHTML = '<option value="">— Select barangay —</option>' +
    barangays.map(b => {
      // b is either {barangay_id, name} (DB-loaded) or a plain string (fallback)
      const id   = b.barangay_id ?? b;
      const name = b.name        ?? b;
      return `<option value="${id}" data-name="${name}">${name}</option>`;
    }).join('');
}

/**
 * Set both dropdowns to pre-existing values (used when editing a saved address).
 */
async function setAddressDropdowns(cityId, barangayId, cityVal, barangayVal) {
  const cityEl = document.getElementById(cityId);
  if (!cityEl) return;
  // Await geo data — options now come from DB, not a static const
  if (cityEl.options.length <= 1) await initMunicipalitySelect(cityId, barangayId);
  cityEl.value = cityVal || '';
  populateBarangays(cityId, barangayId);
  const bgyEl = document.getElementById(barangayId);
  if (bgyEl) bgyEl.value = barangayVal || '';
}

/* ── Toast shorthand (stacked toast) ────────────────── */
const toast = (msg, type = '') => showToastStack(msg, type, 'toast');

/* ════════════════════════════════════════════════════════════
   PRICING MODEL DISPLAY HELPERS  (unchanged from original)
═══════════════════════════════════════════════════════════════*/

function pricingLabel(basePrice, pricingModel) {
  const p = fmtPrice(basePrice);
  if (pricingModel === 'catch_weight') return `${p}<small class="price-unit">/kg</small>`;
  if (pricingModel === 'fixed_pack')   return `${p}<small class="price-unit">/pack</small>`;
  if (pricingModel === 'per_piece')    return `${p}<small class="price-unit">/pc</small>`;
  return p;
}

function pricingModelBadge(pricingModel) {
  if (pricingModel === 'catch_weight') return '<span class="badge-catch">⚖ Catch-Weight</span>';
  if (pricingModel === 'fixed_pack')   return '<span class="badge-pack">📦 Fixed Pack</span>';
  if (pricingModel === 'per_piece')    return '<span class="badge-piece">🔢 Per Piece</span>';
  return '';
}

function lineSubLabel(item) {
  const bp = parseFloat(item.base_price || item.unit_price || 0);
  const ew = parseFloat(item.estimated_weight || 0);
  const pm = item.pricing_model || 'catch_weight';
  if (pm === 'catch_weight') return `${fmtPrice(bp)}/kg · Est. ${ew.toFixed(3)}kg ea.`;
  if (pm === 'fixed_pack')   return `${fmtPrice(bp)}/pack`;
  return `${fmtPrice(bp)}/piece`;
}

/* ════════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════════*/

function navigate(page, param) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');

  if (page !== state.pageHistory[state.pageHistory.length - 1]) {
    state.pageHistory.push(page);
  }
  window.scrollTo(0, 0);

  if (page === 'home')     loadHome();
  if (page === 'catalog')  loadCatalog(param);
  if (page === 'cart')     renderCart();
  if (page === 'checkout') loadCheckout();
  if (page === 'orders')   loadOrders();
  if (page === 'profile')  loadProfile();
}

function navigateBack() {
  state.pageHistory.pop();
  navigate(state.pageHistory[state.pageHistory.length - 1] || 'home');
}

/* ════════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════════*/

function toggleAuthForm() {
  const lf = document.getElementById('login-form');
  const rf = document.getElementById('register-form');
  lf.style.display = lf.style.display === 'none' ? 'block' : 'none';
  rf.style.display = rf.style.display === 'none' ? 'block' : 'none';
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!email || !pass) {
    errEl.textContent   = 'Please fill in all fields.';
    errEl.style.display = 'block';
    return;
  }

const data = await apiFetch(apiUrl('login'), {
    method: 'POST',
    body: JSON.stringify({ email, password: pass }),
  });
  if (data.success) {
    state.user           = data.user;
    state.products       = [];
    state.categories     = [];
    state.stockMap       = {};
    state.checkoutMeta   = null;
    updateAuthUI();
    // Merge any guest cart items into the authenticated user's server-side cart before fetching
    const guestItems = [...state.cart];
    state.cart = [];
    if (guestItems.length) {
      await Promise.all(guestItems.map(item =>
        apiFetch(apiUrl('cart_add'), {
          method: 'POST',
          body:   JSON.stringify({ user_id: data.user.user_id, product_id: item.product_id, quantity: item.quantity }),
        })
      ));
    }
    await Promise.all([loadCartFromAPI(), loadNotifications()]);
    toast(`Welcome back, ${data.user.first_name}! 🎉`, 'success');
    navigate('home');
  } else {
    errEl.textContent   = data.message;
    errEl.style.display = 'block';
  }
}

async function doRegister() {
  const first = document.getElementById('reg-first').value.trim();
  const last  = document.getElementById('reg-last').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const pass  = document.getElementById('reg-password').value;
  const errEl = document.getElementById('reg-error');
  errEl.style.display = 'none';

if (!first || !last || !email || !pass) {
    errEl.textContent   = 'Please fill in all required fields.';
    errEl.style.display = 'block';
    return;
  }
  if (pass.length < 8) {
    errEl.textContent   = 'Password must be at least 8 characters long.';
    errEl.style.display = 'block';
    document.getElementById('reg-password').focus();
    return;
  }
  if (!email.includes('@') || !email.includes('.')) {
    errEl.textContent   = 'Please enter a valid email address.';
    errEl.style.display = 'block';
    return;
  }

  const data = await apiFetch(apiUrl('register'), {
    method: 'POST',
    body:   JSON.stringify({ first_name: first, last_name: last, email, phone, password: pass }),
  });

  if (data.success) {
    state.user         = data.user;
    state.checkoutMeta = null;
    state.stockMap     = {};
    updateAuthUI();
    // Merge any guest cart items into the new account's server-side cart before fetching
    const guestItems = [...state.cart];
    state.cart = [];
    if (guestItems.length) {
      await Promise.all(guestItems.map(item =>
        apiFetch(apiUrl('cart_add'), {
          method: 'POST',
          body:   JSON.stringify({ user_id: data.user.user_id, product_id: item.product_id, quantity: item.quantity }),
        })
      ));
    }
    await Promise.all([loadCartFromAPI(), loadNotifications()]);
    toast(`Account created! Welcome, ${first}! 🐓`, 'success');
    navigate('home');
  } else {
    errEl.textContent   = data.message;
    errEl.style.display = 'block';
  }
}

function logout() {
  state.user           = null;
  state.cart           = [];
  state.notifications  = [];
  state.savedAddresses = [];
  state.stockMap       = {};
  state.products       = [];
  state.categories     = [];
  state.checkoutMeta   = null;
  updateAuthUI();
  updateCartBadge();
  updateNotifBadge();
  toast('Signed out successfully.');
  navigate('home');
}

function updateAuthUI() {
  const btn       = document.getElementById('auth-btn');
  const notifWrap = document.getElementById('notif-wrapper');
  if (state.user) {
    btn.textContent = 'Sign Out';
    btn.onclick     = logout;
    if (notifWrap) notifWrap.style.display = 'block';
  } else {
    btn.textContent = 'Sign In';
    btn.onclick     = () => navigate('auth');
    if (notifWrap) notifWrap.style.display = 'none';
  }
}

/* ════════════════════════════════════════════════════════════
   NOTIFICATIONS  (unchanged)
═══════════════════════════════════════════════════════════════*/

async function loadNotifications() {
  if (!state.user) return;
  const data = await apiFetch(`${CUSTOMER_API}?action=notifications&user_id=${state.user.user_id}`);
  if (data.success) {
    state.notifications = data.data || [];
    updateNotifBadge(data.unread_count || 0);
    renderNotifList();
  }
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const n = count !== undefined ? count : state.notifications.filter(n => n.is_read == 0).length;
  badge.textContent   = n > 99 ? '99+' : n;
  badge.style.display = n > 0 ? 'flex' : 'none';
}

function renderNotifList() {
  const el = document.getElementById('notif-list');
  if (!el) return;
 
  // [NEW] Apply active type filter
  const filtered = state.notifFilter
    ? state.notifications.filter(n => n.type === state.notifFilter)
    : state.notifications;
 
  if (!filtered.length) {
    el.innerHTML = `<div class="notif-empty">${state.notifFilter ? 'No notifications in this category.' : 'No notifications yet.'}</div>`;
    return;
  }
 
  // Notification types that link to a specific order
  const ORDER_TYPES = new Set(['order_placed','packed','dispatched','final_total','partial_fulfillment','cancelled']);
 
  el.innerHTML = filtered.map(n => {
    const hasOrderLink = ORDER_TYPES.has(n.type) && n.related_order_id;
    const clickAction  = hasOrderLink
      ? `onNotifClick(${n.notification_id}, ${n.related_order_id})`
      : `markOneNotificationRead(${n.notification_id})`;
 
    return `
      <div class="notif-item ${n.is_read == 0 ? 'notif-unread' : ''} ${hasOrderLink ? 'notif-clickable' : ''}"
           onclick="${clickAction}" role="button" tabindex="0"
           onkeydown="if(event.key==='Enter'||event.key===' '){${clickAction}}">
        <div class="notif-icon">${notifTypeIcon(n.type)}</div>
        <div class="notif-body">
          <div class="notif-msg">${escHtml(n.message)}</div>
          <div class="notif-time">${fmtDateTime(n.created_at)}</div>
          ${hasOrderLink ? '<div class="notif-link-hint">Tap to view order →</div>' : ''}
        </div>
        ${n.is_read == 0 ? '<div class="notif-dot"></div>' : ''}
      </div>`;
  }).join('');
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) loadNotifications();
}

async function markOneNotificationRead(notifId) {
  if (!state.user) return;
  await apiFetch(apiUrl('mark_read'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id, notification_id: notifId }),
  });
  const n = state.notifications.find(n => n.notification_id == notifId);
  if (n) n.is_read = 1;
  updateNotifBadge();
  renderNotifList();
}

async function markAllNotificationsRead() {
  if (!state.user) return;
  await apiFetch(apiUrl('mark_read'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id }),
  });
  state.notifications.forEach(n => n.is_read = 1);
  updateNotifBadge(0);
  renderNotifList();
}

function setNotifFilter(filter, btn) {
  state.notifFilter = filter;
  document.querySelectorAll('.notif-filter-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderNotifList();
}

async function onNotifClick(notifId, orderId) {
  await markOneNotificationRead(notifId);
  const panel = document.getElementById('notif-panel');
  if (panel) panel.style.display = 'none';
  if (orderId) showOrderDetail(orderId);
}

/* ════════════════════════════════════════════════════════════
   CART API
═══════════════════════════════════════════════════════════════*/

async function loadCartFromAPI() {
  if (!state.user) return;
  const data = await apiFetch(`${CUSTOMER_API}?action=cart&user_id=${state.user.user_id}`);
  if (data.success) {
    state.cart = data.data.items || [];
    updateCartBadge();
    await refreshCartStockMap();
  }
}

/**
 * Refresh the stockMap for all products currently in the cart.
 * Called after cart loads / changes so stock warnings stay current.
 */
async function refreshCartStockMap() {
  if (!state.cart.length) return;
  const ids = state.cart.map(i => i.product_id).join(',');
  const data = await apiFetch(`${CUSTOMER_API}?action=cart_stock&user_id=${state.user.user_id}`);
  if (data.success) {
    Object.assign(state.stockMap, data.data || {});
  }
}

async function addToCart(productId, quantity = 1) {
  // Guests can build a local cart — sign-in is only required at final order placement
  if (!state.user) {
    // Stock check still applies (fetch on demand)
    let stock = state.stockMap[productId];
    if (stock === undefined) {
      const sd = await apiFetch(`${CUSTOMER_API}?action=product_stock&product_id=${productId}`);
      if (sd.success) { stock = parseFloat(sd.data.remaining_qty); state.stockMap[productId] = stock; }
    }
    if (stock !== undefined) {
      const existingQty = state.cart.find(i => i.product_id == productId)?.quantity || 0;
      const newTotal    = existingQty + quantity;
      if (stock === 0) { toast('Sorry, this item is currently out of stock.', 'error'); return; }
      if (newTotal > stock) {
        toast(`Only ${Math.floor(stock)} ${stock === 1 ? 'unit' : 'units'} available.`, 'error');
        return;
      }
    }
    // Fetch product details to hydrate the local cart row
    const pd = await apiFetch(`${CUSTOMER_API}?action=product&id=${productId}`);
    if (!pd.success) { toast('Could not load product details.', 'error'); return; }
    const p = pd.data;
    const existing = state.cart.find(i => i.product_id == productId);
    if (existing) {
      existing.quantity = quantity; // cart_add replaces, matching server upsert behaviour
    } else {
      state.cart.push({
        product_id:       p.product_id,
        name:             p.name,
        base_price:       p.base_price,
        pricing_model:    p.pricing_model,
        estimated_weight: p.estimated_weight,
        unit_of_measure:  p.unit_of_measure,
        category_name:    p.category_name,
        quantity,
        product_status:   'active',
        price_changed:    0,
        unit_price_snapshot: p.base_price,
      });
    }
    updateCartBadge();
    toast('Added to cart! 🛒 Sign in at checkout to place your order.', 'success');
    return;
  }

  // Always resolve stock before allowing add — fetch on demand if not yet in map
  let stock = state.stockMap[productId];
  if (stock === undefined) {
    const sd = await apiFetch(`${CUSTOMER_API}?action=product_stock&product_id=${productId}`);
    if (sd.success) {
      stock = parseFloat(sd.data.remaining_qty);
      state.stockMap[productId] = stock;
    }
  }
  // Now the check is never skipped
  if (stock !== undefined) {
    const existingQty = state.cart.find(i => i.product_id == productId)?.quantity || 0;
    const newTotal    = existingQty + quantity;
    if (stock === 0) { toast('Sorry, this item is currently out of stock.', 'error'); return; }
    if (newTotal > stock) {
      toast(`Only ${Math.floor(stock)} ${stock === 1 ? 'unit' : 'units'} available in stock.`, 'error');
      return;
    }
  }

  const data = await apiFetch(apiUrl('cart_add'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id, product_id: productId, quantity }),
  });
  if (data.success) {
    state.cart = data.data.items || [];
    updateCartBadge();
    await refreshCartStockMap();
    toast('Added to cart! 🛒', 'success');
  } else {
    if (!_handleSuspendedError(data)) toast(data.message, 'error');
  }
}

async function removeFromCart(productId) {
  if (!state.user) return;
  const data = await apiFetch(apiUrl('cart_remove'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id, product_id: productId }),
  });
  if (data.success) {
    state.cart = data.data.items || [];
    updateCartBadge();
    renderCart();
  }
}

/** Empty the entire cart after confirmation. */
async function clearEntireCart() {
  if (!state.user) {
    // Guest: clear local cart only
    if (!confirm('Remove all items from your cart?')) return;
    state.cart = [];
    updateCartBadge();
    renderCart();
    toast('Cart cleared.', 'info');
    return;
  }
  if (!confirm('Remove all items from your cart? This cannot be undone.')) return;
  const data = await apiFetch(apiUrl('cart_clear'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id }),
  });
  if (data.success) {
    state.cart = [];
    updateCartBadge();
    renderCart();
    toast('Cart cleared.', 'info');
  } else {
    toast(data.message || 'Could not clear cart.', 'error');
  }
}

async function updateCartQty(productId, quantity) {
  if (!state.user || quantity < 1) return;

  // [NEW] Stock check on qty update
  const stock = state.stockMap[productId];
  if (stock !== undefined && quantity > stock) {
    toast(`Only ${Math.floor(stock)} ${stock === 1 ? 'unit' : 'units'} available.`, 'error');
    return;
  }

  const data = await apiFetch(apiUrl('cart_add'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id, product_id: productId, quantity }),
  });
  if (data.success) {
    state.cart = data.data.items || [];
    updateCartBadge();
    renderCart();
  }
}

/**
 * [NEW] Direct quantity text-input handler — called on blur/enter from qty input field in cart.
 */
function handleCartQtyInput(productId, inputEl) {
  const raw = parseInt(inputEl.value, 10);
  if (isNaN(raw) || raw < 1) {
    // Reset display to current value
    const current = state.cart.find(i => i.product_id == productId)?.quantity || 1;
    inputEl.value = current;
    return;
  }
  updateCartQty(productId, raw);
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  const count = state.cart.reduce((s, i) => s + parseInt(i.quantity), 0);
  badge.textContent   = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

/* ════════════════════════════════════════════════════════════
   HOME PAGE
═══════════════════════════════════════════════════════════════*/

async function loadHome() {
  await Promise.all([loadFeaturedProducts(), loadCategoriesGrid(), loadStoreFooterHours()]);
}

async function loadFeaturedProducts() {
  const el = document.getElementById('home-featured');
  el.innerHTML = spinnerHTML('Loading products');
  // Use a dedicated home-only fetch so state.products is not pre-populated
  // with unpaginated data that would confuse the catalog's pagination state.
  const data = await apiFetch(`${CUSTOMER_API}?action=products_with_stock&sort=featured&page=1&page_size=24`);
  const allProducts = data.success ? (data.data || []) : [];
  const featured = allProducts.filter(p => p.is_featured == 1).slice(0, 4);
  el.innerHTML = featured.length
    ? featured.map(renderProductCard).join('')
    : '<p style="color:var(--text-muted)">No featured products available.</p>';
}

async function loadCategoriesGrid() {
  const el = document.getElementById('home-categories-grid');
  if (!el) return;
  if (!state.categories.length) {
    const data = await apiFetch(apiUrl('categories'));
    if (data.success) state.categories = data.data;
  }
  el.innerHTML = state.categories.map(c => `
    <div class="category-card" onclick="navigate('catalog','${c.name.replace(/'/g, "\\'")}')">
      <span class="cat-icon">${CAT_ICONS[c.name] || '🐓'}</span>
      <span class="cat-name">${c.name}</span>
      <span class="cat-count">${c.product_count} items</span>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════
   PRODUCT CARD  [IMPROVED — stock badge, wholesale badge]
═══════════════════════════════════════════════════════════════*/

function renderProductCard(p) {
  const icon      = productIcon(p.category_name);
  const pm        = p.pricing_model || 'catch_weight';
  const basePrice = parseFloat(p.base_price || 0);
  const estWeight = parseFloat(p.estimated_weight || 1);
  const stock     = parseFloat(p.remaining_qty ?? state.stockMap[p.product_id] ?? 999);

  let estLine = '';
  if (pm === 'catch_weight')
    estLine = `<div class="product-card-meta">Est. ~${fmtPrice(basePrice * estWeight)} per piece</div>`;
  else if (pm === 'fixed_pack')
    estLine = `<div class="product-card-meta">Declared weight: ${estWeight * 1000}g per pack</div>`;
  else
    estLine = `<div class="product-card-meta">Sold individually</div>`;

  // [NEW] Stock badge logic
  let stockBadge = '';
  if (stock === 0) {
    stockBadge = '<span class="badge-out-of-stock">Out of Stock</span>';
  } else if (stock <= LOW_STOCK_THRESHOLD) {
    stockBadge = `<span class="badge-low-stock">⚠ Only ${stock % 1 === 0 ? stock : stock.toFixed(1)} left</span>`;
  }

  // [NEW] Wholesale teaser badge
  const tierCount = parseInt(p.wholesale_tier_count || 0);
  const wholesaleBadge = tierCount > 0
    ? `<span class="badge-wholesale">🏷 Bulk Discounts</span>`
    : '';

  const isOutOfStock = stock === 0;

  return `
    <div class="product-card ${isOutOfStock ? 'product-card-oos' : ''}" onclick="loadProductDetail(${p.product_id})">
      <div class="product-card-img">${icon}</div>
      <div class="product-card-body">
        <div class="product-card-badges">
          ${p.is_featured == 1 ? '<span class="badge-featured">⭐ Featured</span> ' : ''}
          ${pricingModelBadge(pm)}
          ${stockBadge}
          ${wholesaleBadge}
        </div>
        <div class="product-card-cat">${p.category_name}</div>
        <div class="product-card-title">${p.name}</div>
        <div class="star-row">
          ${starsHTML(p.avg_rating || 0)}
          <span class="star-count">(${p.review_count || 0})</span>
        </div>
        <div class="product-card-price">${pricingLabel(basePrice, pm)}</div>
        ${estLine}
      </div>
      <div class="product-card-footer">
        <button class="btn-primary" ${isOutOfStock ? 'disabled' : ''}
          onclick="event.stopPropagation();${isOutOfStock ? '' : `addToCart(${p.product_id})`}">
          ${isOutOfStock ? 'Out of Stock' : '+ Add to Cart'}
        </button>
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   CATALOG PAGE
═══════════════════════════════════════════════════════════════*/

// Catalog pagination state
const CATALOG_PAGE_SIZE = 24;
let _catalogPage    = 1;
let _catalogHasMore = false;
let _catalogLoading = false;

async function loadCatalog(categoryFilter) {
  // Reset pagination state
  _catalogPage    = 1;
  _catalogHasMore = false;
  _catalogLoading = false;
  state.products  = [];
  
  // Show loading immediately to prevent empty state flicker
  const grid = document.getElementById('catalog-grid');
  const emptyEl = document.getElementById('catalog-empty');
  if (grid) grid.innerHTML = spinnerHTML('Loading products');
  if (emptyEl) emptyEl.style.display = 'none';// Clear previous products to force fresh load
  

  const cd = await apiFetch(apiUrl('categories'));
  if (cd.success) state.categories = cd.data;
  buildCategoryFilter(categoryFilter);

  if (categoryFilter) {
    const radio = document.querySelector(`input[name="cat-filter"][value="${categoryFilter}"]`);
    if (radio) radio.checked = true;
  }

  await _fetchCatalogPage(1);
  if (state.user) {
    const stockData = await apiFetch(`${CUSTOMER_API}?action=cart_stock&user_id=${state.user.user_id}`);
    if (stockData.success) Object.assign(state.stockMap, stockData.data || {});
  }
  filterProducts();
}

/** Fetch one page of products and append to state.products. */
async function _fetchCatalogPage(page) {
  if (_catalogLoading) return;
  _catalogLoading = true;
  const sort   = document.getElementById('catalog-sort')?.value || 'featured';
  const search = document.getElementById('catalog-search')?.value?.trim() || '';
  const catId  = state.categories.find(c =>
    c.name === document.querySelector('input[name="cat-filter"]:checked')?.value
  )?.category_id || '';

  const url  = `${CUSTOMER_API}?action=products_with_stock&sort=${encodeURIComponent(sort)}`
             + `&page=${page}&page_size=${CATALOG_PAGE_SIZE}`
             + (catId  ? `&category_id=${catId}`          : '')
             + (search ? `&search=${encodeURIComponent(search)}` : '');
const data = await apiFetch(url);

  if (data.success) {
    // Ensure data.data is always an array to prevent errors
    const products = Array.isArray(data.data) ? data.data : [];
    state.products  = page === 1 ? products : [...state.products, ...products];
    _catalogHasMore = data.has_more ?? false;
    _catalogPage    = page;
    
    // Debug: log if we got zero products unexpectedly
    if (page === 1 && products.length === 0) {
      console.warn('[Catalog] API returned zero products. Check filters or stock levels.');
    }
  } else {
    // Show error for any failed page
    const grid = document.getElementById('catalog-grid');
    if (page === 1 && grid) {
      grid.innerHTML = `<div class="table-empty" role="alert" style="padding:2rem">
        <span style="font-size:2rem">⚠️</span>
        <p>${escHtml(data.message || 'Failed to load products. Please try again.')}</p>
        <button class="btn-outline" style="margin-top:1rem" onclick="loadCatalog()">Retry</button>
      </div>`;
    } else if (page > 1) {
      console.error('[Catalog] Pagination failed:', data.message);
      toast('Failed to load more products.', 'error');
    }
  }
  _catalogLoading = false;
  _renderLoadMoreBtn();
}

function _renderLoadMoreBtn() {
  const existing = document.getElementById('catalog-load-more');
  if (existing) existing.remove();
  if (!_catalogHasMore) return;
  const btn = document.createElement('div');
  btn.id = 'catalog-load-more';
  btn.style.cssText = 'text-align:center;padding:1.5rem 0';
  btn.innerHTML = `<button class="btn-outline" onclick="loadMoreCatalog()">Load More Products</button>`;
  document.getElementById('catalog-grid')?.after(btn);
}

async function loadMoreCatalog() {
  await _fetchCatalogPage(_catalogPage + 1);
  filterProducts(); // re-render with the expanded list
}

function buildCategoryFilter(selected) {
  const list = document.getElementById('cat-filter-list');
  list.innerHTML = `
    <label class="filter-label">
      <input type="radio" name="cat-filter" value="" ${!selected ? 'checked' : ''} onchange="debouncedFilterProducts()" /> All
    </label>` +
    state.categories.map(c => `
      <label class="filter-label">
        <input type="radio" name="cat-filter" value="${c.name}" ${selected === c.name ? 'checked' : ''} onchange="debouncedFilterProducts()" />
        ${CAT_ICONS[c.name] || '🐓'} ${c.name}
      </label>`).join('');
}
// Debounce helper — triggers a full server-side search on every keystroke after 350 ms.
let _filterDebounceTimer = null;
function debouncedFilterProducts() {
  clearTimeout(_filterDebounceTimer);
  _filterDebounceTimer = setTimeout(async () => {
    _catalogPage    = 1;
    _catalogHasMore = false;
    state.products  = [];
    await _fetchCatalogPage(1);
    filterProducts();
  }, 350);
}

function filterProducts() {
  const search      = (document.getElementById('catalog-search')?.value || '').toLowerCase();
  const catFilter   = document.querySelector('input[name="cat-filter"]:checked')?.value || '';
  const modelFilter = document.querySelector('input[name="model-filter"]:checked')?.value || '';
  const sort        = document.getElementById('catalog-sort')?.value || 'featured';
  const grid        = document.getElementById('catalog-grid');
  const empty       = document.getElementById('catalog-empty');
  const count       = document.getElementById('catalog-count');
  const catBanner = document.getElementById('category-description-banner');
  if (catBanner) {
    const selectedCat = catFilter ? state.categories.find(c => c.name === catFilter) : null;
    if (selectedCat?.description) {
      catBanner.innerHTML = `
        <span class="cat-desc-icon" aria-hidden="true">${CAT_ICONS[selectedCat.name] || '🐓'}</span>
        <div>
          <strong class="cat-desc-title">${escHtml(selectedCat.name)}</strong>
          <p class="cat-desc-text">${escHtml(selectedCat.description)}</p>
        </div>`;
      catBanner.style.display = 'flex';
    } else {
      catBanner.style.display = 'none';
    }
  }
  let filtered = [...state.products];
  if (catFilter)   filtered = filtered.filter(p => p.category_name === catFilter);
  if (modelFilter) filtered = filtered.filter(p => p.pricing_model === modelFilter);
  if (search)      filtered = filtered.filter(p =>
    p.name.toLowerCase().includes(search) || p.description?.toLowerCase().includes(search));

  filtered.sort((a, b) => {
    const pa = parseFloat(a.base_price || 0);
    const pb = parseFloat(b.base_price || 0);
    if (sort === 'az')         return a.name.localeCompare(b.name);
    if (sort === 'za')         return b.name.localeCompare(a.name);
    if (sort === 'price_asc')  return pa - pb;
    if (sort === 'price_desc') return pb - pa;
    return b.is_featured - a.is_featured;
  });

  count.textContent = `${filtered.length} product${filtered.length !== 1 ? 's' : ''} found`;
  if (!filtered.length) { grid.innerHTML = ''; empty.style.display = 'block'; }
  else { empty.style.display = 'none'; grid.innerHTML = filtered.map(renderProductCard).join(''); }
}

let _globalSearchTimer = null;
function debouncedGlobalSearch(val) {
  clearTimeout(_globalSearchTimer);
  _globalSearchTimer = setTimeout(() => globalSearch(val), 400);
}

function globalSearch(val) {
  toggleSearch();
  navigate('catalog');
  setTimeout(async () => {
    const inp = document.getElementById('catalog-search');
    if (inp) inp.value = val;
    _catalogPage    = 1;
    _catalogHasMore = false;
    state.products  = [];
    await _fetchCatalogPage(1);
    filterProducts();
  }, 100);
}

/* ════════════════════════════════════════════════════════════
   PRODUCT DETAIL  [IMPROVED — direct qty input, stock aware]
═══════════════════════════════════════════════════════════════*/

async function loadProductDetail(productId) {
  navigate('detail');
  state.detailQty = 1;
  const el = document.getElementById('detail-content');
  el.innerHTML = spinnerHTML('Loading product');

  const [detailData, stockData] = await Promise.all([
    apiFetch(`${CUSTOMER_API}?action=product&id=${productId}`),
    apiFetch(`${CUSTOMER_API}?action=product_stock&product_id=${productId}`),
  ]);

  if (!detailData.success) { el.innerHTML = '<p>Product not found.</p>'; return; }

  const p          = detailData.data;
  state.currentProduct = p;
  const stock      = stockData.success ? parseFloat(stockData.data.remaining_qty) : null;
  if (stock !== null) state.stockMap[productId] = stock;

  const icon       = productIcon(p.category_name);
  const pm         = p.pricing_model || 'catch_weight';
  const basePrice  = parseFloat(p.base_price || 0);
  const estWeight  = parseFloat(p.estimated_weight || 1);
  const isOOS      = stock !== null && stock === 0;
  const isLowStock = stock !== null && stock > 0 && stock <= LOW_STOCK_THRESHOLD;

  // Stock warning banner
  let stockNotice = '';
  if (isOOS) {
    stockNotice = `<div class="stock-notice stock-notice-oos">⛔ This item is currently out of stock.</div>`;
  } else if (isLowStock) {
    stockNotice = `<div class="stock-notice stock-notice-low">⚠️ Only ${stock % 1 === 0 ? stock : stock.toFixed(1)} units remaining — order soon!</div>`;
  }

  let priceInfoHTML = '';
  if (pm === 'catch_weight')
    priceInfoHTML = `<div style="margin-top:.5rem;font-size:.85rem;color:var(--text-muted)">
      Est. weight: ~${estWeight}kg &nbsp;|&nbsp; Est. price: ~${fmtPrice(basePrice * estWeight)}/pc</div>`;
  else if (pm === 'fixed_pack')
    priceInfoHTML = `<div style="margin-top:.5rem;font-size:.85rem;color:var(--text-muted)">
      Declared pack weight: ${(estWeight * 1000).toFixed(0)}g</div>`;
  else
    priceInfoHTML = `<div style="margin-top:.5rem;font-size:.85rem;color:var(--text-muted)">
      Avg. weight per piece: ~${(estWeight * 1000).toFixed(0)}g</div>`;

  const cwNote = pm === 'catch_weight' ? `
    <div class="catch-weight-note">
      <strong>⚖ Catch-Weight Item</strong><br/>
      Your order will be weighed by our staff before packaging.
      The final price may differ slightly from the estimate shown.
    </div>` : '';

  const reviewsHTML = !(p.reviews || []).length
    ? '<p style="color:var(--text-muted);font-size:.9rem">No reviews yet.</p>'
    : p.reviews.map(r => `
        <div class="review-card">
          <div class="review-meta">
            <div class="star-row">${starsHTML(r.rating)}</div>
            <span class="reviewer-name">${r.first_name} ${r.last_name.charAt(0)}.</span>
            <span class="review-date">${r.created_at?.split(' ')[0] || ''}</span>
          </div>
          <div class="review-text">${r.review_text || ''}</div>
        </div>`).join('');

  const tiersHTML = (p.wholesale_tiers || []).length > 0 ? `
    <div class="wholesale-tiers">
      <h4>Wholesale Pricing</h4>
      <div class="tiers-list">
        ${p.wholesale_tiers.map(t => `
          <div class="tier-row">
            <span>Buy ${t.min_qty}+ ${t.tier_unit || 'pcs'}</span>
            <strong>${fmtPrice(t.tier_unit_price || t.price_per_kg)}/${t.tier_unit || 'kg'}</strong>
          </div>`).join('')}
      </div>
    </div>` : '';

  const qtyUnit     = pm === 'per_piece' ? 'pieces' : pm === 'fixed_pack' ? 'packs' : 'pieces';
  const maxQty      = stock !== null && stock > 0 ? Math.floor(stock) : 999;

  el.innerHTML = `
    <div><div class="detail-image-box">${icon}</div></div>
    <div>
      <div class="detail-badges">
        ${p.is_featured == 1 ? '<span class="badge-featured">⭐ Featured</span>' : ''}
        ${pricingModelBadge(pm)}
      </div>
      <div class="detail-category">${p.category_name}</div>
      <h2 class="detail-title">${p.name}</h2>
      <div class="star-row" style="margin-bottom:1rem;font-size:1rem">
        ${starsHTML(p.avg_rating || 0)}
        <span style="color:var(--text-muted)">${parseFloat(p.avg_rating || 0).toFixed(1)} (${p.review_count} review${p.review_count != 1 ? 's' : ''})</span>
      </div>
      ${stockNotice}
      <div class="detail-price-box">
        <div class="price-label">Base Price</div>
        <div class="price-main">${pricingLabel(basePrice, pm)}</div>
        ${priceInfoHTML}
      </div>
      ${cwNote}
      <p class="detail-desc">${p.description || ''}</p>
      ${tiersHTML}
      <div class="qty-selector">
        <button class="qty-btn" onclick="changeDetailQty(-1)" ${isOOS ? 'disabled' : ''}>−</button>
        <!-- [NEW] Direct text input for quantity -->
        <input type="number" id="detail-qty" class="qty-input-direct" value="1" min="1"
          max="${maxQty}" ${isOOS ? 'disabled' : ''}
          onchange="onDetailQtyInput(this)"
          onkeydown="if(event.key==='Enter')this.blur()" />
        <button class="qty-btn" onclick="changeDetailQty(1)" ${isOOS ? 'disabled' : ''}>+</button>
        <span style="font-size:.85rem;color:var(--text-muted)">${qtyUnit}</span>
      </div>
      <button class="btn-primary btn-lg" ${isOOS ? 'disabled' : ''} onclick="addToCart(${p.product_id}, state.detailQty)">
        ${isOOS ? '⛔ Out of Stock' : '🛒 Add to Cart'}
      </button>
      <div class="reviews-section">
        <h3>Customer Reviews</h3>
        ${reviewsHTML}
      </div>
    </div>`;
}

function changeDetailQty(delta) {
  const p       = state.currentProduct;
  const stock   = p ? (state.stockMap[p.product_id] ?? 999) : 999;
  const max     = stock > 0 ? Math.floor(stock) : 999;
  state.detailQty = Math.max(1, Math.min(max, state.detailQty + delta));
  const inp = document.getElementById('detail-qty');
  if (inp) inp.value = state.detailQty;
}

function onDetailQtyInput(inputEl) {
  const p     = state.currentProduct;
  const stock = p ? (state.stockMap[p.product_id] ?? 999) : 999;
  const max   = stock > 0 ? Math.floor(stock) : 999;
  let val     = parseInt(inputEl.value, 10);
  if (isNaN(val) || val < 1) val = 1;
  if (val > max) { val = max; toast(`Max ${max} units available.`, 'error'); }
  state.detailQty = val;
  inputEl.value   = val;
}

/* ════════════════════════════════════════════════════════════
   WHOLESALE PRICING HELPER
═══════════════════════════════════════════════════════════════*/

/**
 * Evaluate an item's wholesale_tiers against its current quantity and return
 * the correct unit price (tier_unit_price or price_per_kg).
 * Falls back to base_price when no tier applies.
 */
function resolveWholesalePrice(item) {
  const tiers = item.wholesale_tiers;
  if (!tiers || !tiers.length) return parseFloat(item.base_price || 0);
  const qty    = parseFloat(item.quantity || 1);
  const sorted = [...tiers].sort((a, b) => parseFloat(b.min_qty) - parseFloat(a.min_qty));
  const match  = sorted.find(t => qty >= parseFloat(t.min_qty));
  if (match) return parseFloat(match.tier_unit_price || match.price_per_kg || item.base_price || 0);
  return parseFloat(item.base_price || 0);
}

/* ════════════════════════════════════════════════════════════
   CART PAGE  [IMPROVED — direct qty input in cart]
═══════════════════════════════════════════════════════════════*/

function renderCart() {
  const container = document.getElementById('cart-items-container');
  const summary   = document.getElementById('cart-summary');

  if (!state.user) {
    container.innerHTML = `<div class="empty-state"><span>🔐</span><h3>Please sign in</h3><p>Sign in to view your cart.</p><br/>
      <button class="btn-primary" onclick="navigate('auth')">Sign In</button></div>`;
    summary.innerHTML = '';
    return;
  }
  if (!state.cart.length) {
    container.innerHTML = `<div class="empty-state"><span>🛒</span><h3>Your cart is empty</h3><p>Start shopping to add items.</p><br/>
      <button class="btn-primary" onclick="navigate('catalog')">Browse Products</button></div>`;
    summary.innerHTML = '';
    return;
  }

  const subtotal = state.cart.reduce((s, i) => s + estimatedSubtotal(
    i.pricing_model || 'catch_weight', i.quantity, resolveWholesalePrice(i), i.estimated_weight || 1), 0);

  container.innerHTML = state.cart.map(item => {
const pm         = item.pricing_model || 'catch_weight';
    const lineEst    = estimatedSubtotal(pm, item.quantity, resolveWholesalePrice(item), item.estimated_weight || 1);
    const stock      = state.stockMap[item.product_id] ?? null;
    const isOOS      = stock !== null && stock === 0;
    const isLow      = stock !== null && stock > 0 && stock <= LOW_STOCK_THRESHOLD;
    const maxQty     = stock !== null && stock > 0 ? Math.floor(stock) : 999;
    // [NEW] Archived and price-change flags (from CartService patch)
    const isArchived = item.product_status === 'archived';
    const hasChange  = item.price_changed == 1;
 
    let stockNote = '';
    if (isArchived) {
      stockNote = `<div class="cart-stock-warn warn-oos">🚫 This item has been discontinued — please remove it to continue</div>`;
    } else {
      if (hasChange) {
        stockNote += `<div class="cart-price-changed-warn">💲 Price updated: was ${fmtPrice(item.unit_price_snapshot)}, now ${fmtPrice(item.base_price)}</div>`;
      }
      if (isOOS)      stockNote += `<div class="cart-stock-warn warn-oos">⛔ Out of stock — please remove this item</div>`;
      else if (isLow) stockNote += `<div class="cart-stock-warn warn-low">⚠ Only ${stock % 1 === 0 ? stock : stock.toFixed(1)} left</div>`;
    }

    return `
      <div class="cart-item ${isOOS || isArchived ? 'cart-item-oos' : ''}">
        <div class="cart-item-img">${productIcon(item.category_name || '')}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-sub">${lineSubLabel(item)}</div>
          ${stockNote}
          <div class="cart-item-actions">
            <button class="qty-btn" onclick="updateCartQty(${item.product_id}, ${parseInt(item.quantity) - 1})"
              ${item.quantity <= 1 || isOOS ? 'disabled' : ''}>−</button>
            <!-- [NEW] Direct quantity input in cart -->
            <input type="number" class="qty-input-direct" value="${item.quantity}" min="1" max="${maxQty}"
              ${isOOS ? 'disabled' : ''}
              onblur="handleCartQtyInput(${item.product_id}, this)"
              onkeydown="if(event.key==='Enter')this.blur()" />
            <button class="qty-btn" onclick="updateCartQty(${item.product_id}, ${parseInt(item.quantity) + 1})"
              ${isOOS || parseInt(item.quantity) >= maxQty ? 'disabled' : ''}>+</button>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="cart-item-price">${fmtPrice(lineEst)}</div>
          <div class="cart-item-sub" style="margin-top:.25rem">${pm === 'catch_weight' ? 'estimated' : 'fixed'}</div>
          <button class="btn-danger" style="margin-top:.5rem" onclick="removeFromCart(${item.product_id})">Remove</button>
        </div>
      </div>`;
  }).join('');

  const hasCatchWeight = state.cart.some(i => (i.pricing_model || 'catch_weight') === 'catch_weight');
  const hasArchived    = state.cart.some(i => i.product_status === 'archived');
  const hasOOS         = state.cart.some(i => {
    const stock = state.stockMap[i.product_id];
    return i.product_status === 'archived' || (stock !== undefined && stock === 0);
  });

summary.innerHTML = `
    <h3>Order Summary</h3>
    <div class="summary-row"><span>Subtotal (est.)</span><span>${fmtPrice(subtotal)}</span></div>
    <div class="summary-row" style="color:var(--text-muted);font-size:.85rem"><span>Delivery Fee</span><span>Calculated at checkout</span></div>
    <div class="summary-row total"><span>Est. Subtotal</span><span>${fmtPrice(subtotal)}</span></div>
    ${hasCatchWeight ? `<div class="catch-weight-disclaimer">
      ⚖️ <strong>Catch-Weight Notice:</strong> Some items are priced by actual weight.
      Your final total will be confirmed after packing.</div>` : ''}
    ${hasArchived
      ? `<div class="catch-weight-disclaimer" style="background:var(--red-light,#fff0f0);border-color:var(--red)">
           🚫 Some items are no longer available. Remove them to continue.</div>`
      : hasOOS
        ? `<div class="catch-weight-disclaimer" style="background:var(--red-light,#fff0f0);border-color:var(--red)">
             ⛔ Some items are out of stock. Remove them before checking out.</div>`
        : ''}
    <button class="btn-primary full-width" onclick="navigate('checkout')" style="margin-top:.75rem"
      ${hasArchived || hasOOS ? 'disabled' : ''}>Proceed to Checkout →</button>
    <button class="btn-ghost-dark" style="width:100%;margin-top:.5rem" onclick="navigate('catalog')">Continue Shopping</button>
    <button class="btn-danger" style="width:100%;margin-top:.5rem;opacity:.8"
      onclick="clearEntireCart()">🗑 Empty Cart</button>`;
}

/* ════════════════════════════════════════════════════════════
   CHECKOUT PAGE
═══════════════════════════════════════════════════════════════*/

async function loadCheckout() {
  if (!state.cart.length) { navigate('cart'); return; }

  // Auth wall: guests must sign in before the delivery form is rendered.
  // Cart state is preserved in state.cart — no inputs are lost.
  if (!state.user) {
    toast('Please sign in or create a free account to continue checkout. Your cart is saved! 🛒', 'info');
    navigate('auth');
    return;
  }

  const guestBanner = document.getElementById('co-guest-banner');
  const guestPrompt = document.getElementById('co-guest-prompt');
  if (guestBanner) guestBanner.style.display = 'none';
  if (guestPrompt) guestPrompt.style.display = 'none';

  // Persist applied promo across page navigations — silently re-validate against current subtotal.
  if (state.checkoutPromo) {
    const currentSubtotal = state.cart.reduce((s, i) => s + estimatedSubtotal(
      i.pricing_model || 'catch_weight', i.quantity, resolveWholesalePrice(i), i.estimated_weight || 1), 0);
    const minOrder = parseFloat(state.checkoutPromo.min_order_value ?? 0);
    if (currentSubtotal < minOrder) {
      const removedCode   = state.checkoutPromo.code;
      state.checkoutPromo = null;
      toast(`Promo "${removedCode}" was removed — your cart total is below the minimum required.`, 'info');
    }
    // If still valid, leave state.checkoutPromo unchanged so _syncPromoUI shows the applied row.
  }
  _syncPromoUI();

  const fi = document.getElementById('co-first');
  const li = document.getElementById('co-last');
  const pi = document.getElementById('co-phone');
  if (fi) fi.value = state.user.first_name || '';
  if (li) li.value = state.user.last_name  || '';
  if (pi) pi.value = state.user.phone      || '';

  await loadCheckoutMeta();
  initMunicipalitySelect('co-city', 'co-barangay');
  await loadSavedAddressesForCheckout();
  updateCheckoutSummary();
}

async function loadCheckoutMeta() {
  if (!state.checkoutMeta) {
    const data = await apiFetch(apiUrl('checkout_meta'));
    if (data.success) state.checkoutMeta = data.data;
  }

  if (state.checkoutMeta) {
    populateZones(state.checkoutMeta.zones || []);
    // Awaited so fetchServerTime resolves before onDeliveryDateChange populates slots
    await setupDeliveryDatePicker(state.checkoutMeta.hours || []);
    // NOTE: populateSlots is intentionally removed here — setupDeliveryDatePicker →
    // onDeliveryDateChange handles slot population after server time is known.
  } else {
    // Fallback
    const zoneEl = document.getElementById('co-zone');
    if (zoneEl && zoneEl.options.length <= 1)
      // zones are always populated from DB; no hardcoded fallback
      zoneEl.innerHTML = `<option value="">— Select delivery zone —</option>
                          <option value="2" data-fee="60">Sagpon – ₱60.00</option>`;
    const slotEl = document.getElementById('co-slot');
    if (slotEl && slotEl.options.length <= 1)
      slotEl.innerHTML = `<option value="1">8:00 AM – 10:00 AM</option>
                          <option value="2">10:00 AM – 12:00 PM</option>`;
  }
}

/**
 * [NEW] Set up the date picker to only allow days that are operational.
 * operational_hours.day_of_week values: 0=Sun … 6=Sat
 */
/**
 * Fetch the current server date/time in Asia/Manila and cache it in
 * state.serverTime = { date: 'YYYY-MM-DD', time: 'HH:MM', dow: N }.
 * Falls back to browser time if the request fails.
 */
async function fetchServerTime() {
  if (state.serverTime) return state.serverTime;
  try {
    const data = await apiFetch(apiUrl('server_time'));
    if (data.success) {
      state.serverTime = data.data;
      return state.serverTime;
    }
  } catch (_) { /* intentional fallthrough */ }
  // Graceful fallback to browser time (still protects against basic tampering)
  const now = new Date();
  state.serverTime = {
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().slice(0, 5),
    dow:  now.getDay(),
  };
  return state.serverTime;
}

async function setupDeliveryDatePicker(hours) {
  const dateInput = document.getElementById('co-date');
  if (!dateInput) return;

  const allowedDays = new Set(hours.map(h => parseInt(h.day_of_week)));

  // Use server Manila time instead of local browser clock
  const srv = await fetchServerTime();

  // Build "tomorrow" relative to the server date
  const srvDate  = new Date(srv.date + 'T00:00:00');
  const tomorrow = new Date(srvDate);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let candidate = new Date(tomorrow);
  let limit = 60;
  while (limit-- > 0 && !allowedDays.has(candidate.getDay())) {
    candidate.setDate(candidate.getDate() + 1);
  }

  const minDate = candidate.toISOString().split('T')[0];
  dateInput.min   = minDate;
  dateInput.value = minDate;

  dateInput._allowedDays  = allowedDays;
  dateInput._srvTodayDate = srv.date; // stored for onDeliveryDateChange
  dateInput.addEventListener('change', function () {
    const chosen = new Date(this.value + 'T00:00:00');
    if (!allowedDays.has(chosen.getDay())) {
      let next  = new Date(chosen);
      let guard = 7;
      do { next.setDate(next.getDate() + 1); } while (!allowedDays.has(next.getDay()) && --guard > 0);
      this.value = next.toISOString().split('T')[0];
      const hint    = document.getElementById('co-date-hint');
      const dayName = DAY_NAMES[next.getDay()];
      if (hint) {
        hint.textContent = `We don't deliver on that day. Moved to the next available day (${dayName}).`;
        hint.style.display = 'block';
        setTimeout(() => { hint.style.display = 'none'; }, 4000);
      }
    }
    onDeliveryDateChange();
  });

  onDeliveryDateChange();
}

/**
 * [NEW] When delivery date changes, filter time slots:
 * For same-day delivery, hide slots whose start_time has already passed.
 */
function onDeliveryDateChange() {
  const dateInput = document.getElementById('co-date');
  const chosen    = dateInput?.value;
  if (!chosen || !state.checkoutMeta) return;

  const slots = state.checkoutMeta.slots || [];
  // Use the server date/time cached by fetchServerTime() — never the browser clock
  const srvDate  = state.serverTime?.date ?? '';
  const srvTime  = state.serverTime?.time ?? '00:00';
  const isToday  = chosen === srvDate;

  const validSlots = slots.filter(s => {
    if (s.is_active == 0) return false;
    if (isToday) {
      // Hide slots whose start time has already passed according to server time
      return (s.start_time || '23:59').slice(0, 5) > srvTime;
    }
    return true;
  });

  populateSlots(validSlots, chosen);
}

function populateZones(zones) {
  const el = document.getElementById('co-zone');
  if (!el || !zones.length) return;
  el.innerHTML = zones.map(z =>
    `<option value="${z.zone_id}" data-fee="${z.delivery_fee}">${z.municipality_name} – ₱${parseFloat(z.delivery_fee).toFixed(2)}</option>`
  ).join('');
  updateCheckoutSummary();
}

function populateSlots(slots, _date) {
  const el = document.getElementById('co-slot');
  if (!el) return;
  if (!slots.length) {
    el.innerHTML = '<option value="">No available time slots</option>';
    return;
  }
  el.innerHTML = slots.map(s =>
    `<option value="${s.slot_id}">${s.slot_label} (${fmtTime12(s.start_time)}–${fmtTime12(s.end_time)})</option>`
  ).join('');
}

async function loadSavedAddressesForCheckout() {
  if (!state.user) return;
  const data = await apiFetch(`${CUSTOMER_API}?action=profile&user_id=${state.user.user_id}`);
  if (!data.success) return;

  const addresses = data.data.addresses || [];
  state.savedAddresses = addresses;
  const section = document.getElementById('co-saved-address-section');
  const select  = document.getElementById('co-saved-address');
  if (!section || !select) return;

  if (addresses.length > 0) {
    section.style.display = 'block';
    // [IMPROVED] Explicitly label the default address
    select.innerHTML = '<option value="">— Enter a new address below —</option>' +
      addresses.map(a =>
        `<option value="${a.address_id}" data-street="${a.street}" data-barangay="${a.barangay}" data-city="${a.city}">
          ${a.is_default == 1 ? '(Default) ' : ''}${a.label}: ${a.street}, ${a.barangay}, ${a.city}
        </option>`
      ).join('');
    const def = addresses.find(a => a.is_default == 1) || addresses[0];
    if (def) {
      select.value = def.address_id;
      onSavedAddressChange();
    }
  } else {
    section.style.display = 'none';
  }

  // Wire auto-zone-match listeners once per element — guard with dataset flag to
  // prevent accumulation when the user navigates to checkout multiple times.
  // NOTE: wired unconditionally so users with no saved addresses also get auto-zone on manual entry.
  const cityEl = document.getElementById('co-city');
  const bgyEl  = document.getElementById('co-barangay');
  if (cityEl && !cityEl.dataset.zoneWired) {
    cityEl.dataset.zoneWired = '1';
    cityEl.addEventListener('change', () => {
      const savedSel = document.getElementById('co-saved-address');
      if (!savedSel?.value) _autoMatchZone(
        document.getElementById('co-barangay')?.value, cityEl.value
      );
    });
  }
  if (bgyEl && !bgyEl.dataset.zoneWired) {
    bgyEl.dataset.zoneWired = '1';
    bgyEl.addEventListener('change', () => {
      const savedSel = document.getElementById('co-saved-address');
      if (!savedSel?.value) _autoMatchZone(
        bgyEl.value, document.getElementById('co-city')?.value
      );
    });
  }
}

async function onSavedAddressChange() {
  const select  = document.getElementById('co-saved-address');
  const opt     = select?.options[select.selectedIndex];
  const defWrap = document.getElementById('co-save-default-wrap');
  const form    = document.getElementById('co-address-form');

  const isNewAddress = !opt?.value;

  // Show/hide the "save as default" checkbox and manual form
  if (defWrap) defWrap.style.display = isNewAddress ? '' : 'none';

  if (!isNewAddress) {
    // Lock the manual fields — user selected a saved address
    const addr = state.savedAddresses.find(a => a.address_id == opt.value);
    if (addr && form) {
      // Populate read-only display fields
      document.getElementById('co-street').value  = addr.street   || '';
      document.getElementById('co-notes') && null; // notes stays editable
      await setAddressDropdowns('co-city', 'co-barangay', addr.city, addr.barangay_id);
      // Disable all address fields
      form.querySelectorAll('input, select').forEach(el => {
        if (el.id !== 'co-notes') el.disabled = true;
      });
    }
    // Auto-match delivery zone by barangay + city
    // Use addr fields directly (more reliable than dataset which may be stale)
    const matchBgy  = addr?.barangay || opt.dataset.barangay;
    const matchCity = addr?.city     || opt.dataset.city;
    _autoMatchZone(matchBgy, matchCity);
  } else {
    // Re-enable manual fields for new address entry
    if (form) {
      form.querySelectorAll('input, select').forEach(el => el.disabled = false);
    }
    updateCheckoutSummary();
  }
}

function _autoMatchZone(barangay, city) {
  const zones  = state.checkoutMeta?.zones || [];
  const zoneEl = document.getElementById('co-zone');
  if (!zoneEl || !zones.length) return;

  const cityLow = (city || '').toLowerCase().trim();

  // Zones are now municipality-level only; match on municipality_name
  const match = cityLow
    ? zones.find(z => (z.municipality_name || '').toLowerCase().trim() === cityLow)
    : null;

  const zoneGroup = document.getElementById('co-zone-group');
  if (match) {
    zoneEl.value = match.zone_id;
    // Matched — keep zone group hidden and show the fee notice inline
    if (zoneGroup) { zoneGroup.hidden = true; zoneGroup.setAttribute('aria-hidden', 'true'); }
    const feeNotice = document.getElementById('co-zone-notice');
    if (feeNotice) {
      feeNotice.textContent = `📍 Delivery to ${match.municipality_name} — ₱${parseFloat(match.delivery_fee).toFixed(2)}`;
      feeNotice.style.display = 'block';
    }
  } else {
    zoneEl.value = '';
    // No auto-match — reveal the zone dropdown so the user can pick manually
    if (zoneGroup) { zoneGroup.hidden = false; zoneGroup.removeAttribute('aria-hidden'); }
    const feeNotice = document.getElementById('co-zone-notice');
    if (feeNotice) {
      feeNotice.textContent = '⚠️ Your address area was not recognised. Please select your delivery zone below.';
      feeNotice.style.display = 'block';
    }
  }
  updateCheckoutSummary();
}

function updateCheckoutSummary() {
  const panel = document.getElementById('checkout-summary-panel');
  if (!panel) return;

  const subtotal = state.cart.reduce((s, i) => s + estimatedSubtotal(
    i.pricing_model || 'catch_weight', i.quantity, resolveWholesalePrice(i), i.estimated_weight || 1), 0);

  const zoneEl      = document.getElementById('co-zone');
  const deliveryFee = parseFloat(zoneEl?.options[zoneEl.selectedIndex]?.dataset.fee || 0);

let discount = 0;
  if (state.checkoutPromo) {
    const minOrder = parseFloat(state.checkoutPromo.min_order_value ?? 0);
    if (subtotal < minOrder) {
      // Cart no longer qualifies — silently clear the promo and notify the customer
      const removedCode = state.checkoutPromo.code;
      state.checkoutPromo = null;
      _syncPromoUI();
      toast(`Promo "${removedCode}" removed — cart total dropped below the minimum order value.`, 'info');
    } else {
      // Re-calculate discount from stored promo fields (server snapshot)
      if (state.checkoutPromo.discount_type === 'percentage') {
        discount = subtotal * state.checkoutPromo.discount_value / 100;
      } else {
        discount = state.checkoutPromo.discount_value;
      }
      discount = Math.min(discount, subtotal);
      // Keep discount_amount in sync so the summary label stays accurate
      state.checkoutPromo.discount_amount = discount;
    }
  }

  const total          = subtotal - discount + deliveryFee;
  const hasCatchWeight = state.cart.some(i => (i.pricing_model || 'catch_weight') === 'catch_weight');

  panel.innerHTML = `
    <div class="card" style="margin-bottom:0">
      <h3>Order Summary</h3>
      ${state.cart.map(i => {
        const lineEst = estimatedSubtotal(i.pricing_model || 'catch_weight', i.quantity, resolveWholesalePrice(i), i.estimated_weight || 1);
        const wsPrice = resolveWholesalePrice(i);
        const wsNote  = wsPrice < parseFloat(i.base_price || 0)
          ? ` <small style="color:var(--green)">(wholesale ₱${wsPrice.toFixed(2)})</small>` : '';
        return `<div style="display:flex;justify-content:space-between;padding:.4rem 0;font-size:.85rem;border-bottom:1px solid var(--bg-alt)">
          <span>${i.name} ×${i.quantity}${wsNote}</span><span>${fmtPrice(lineEst)}</span></div>`;
      }).join('')}
      <div class="summary-row" style="margin-top:.75rem"><span>Subtotal</span><span>${fmtPrice(subtotal)}</span></div>
      ${discount > 0 ? `<div class="summary-row" style="color:var(--green)"><span>Discount (${state.checkoutPromo?.code})</span><span>−${fmtPrice(discount)}</span></div>` : ''}
      <div class="summary-row"><span>Delivery Fee</span><span>${fmtPrice(deliveryFee)}</span></div>
      <div class="summary-row total"><span>Est. Total</span><span>${fmtPrice(total)}</span></div>
      ${hasCatchWeight ? `<div class="catch-weight-disclaimer">⚖️ Final amount confirmed after weighing.</div>` : ''}
      <button class="btn-primary full-width" onclick="placeOrder()" style="margin-top:1rem">✓ Confirm Order</button>
    </div>`;
}

/* ── Payment method toggle — reveals GCash instructions panel ── */

function onPaymentMethodChange() {
  const method     = document.querySelector('input[name="payment"]:checked')?.value || 'COD';
  const gcashPanel = document.getElementById('co-gcash-panel');
  if (gcashPanel) gcashPanel.style.display = method === 'GCash' ? 'block' : 'none';
  updateCheckoutSummary();
}

/* ── Promo code — [IMPROVED] real-time validation + remove ──── */

async function applyPromo() {
  const code    = document.getElementById('co-promo').value.trim().toUpperCase();
  const msg     = document.getElementById('promo-msg');
  const btn     = document.getElementById('promo-apply-btn');
  if (!code) { msg.textContent = 'Please enter a promo code.'; msg.className = 'promo-msg error'; return; }

  // Calculate current subtotal for min_order_value check — use wholesale-resolved price for accuracy
  const subtotal = state.cart.reduce((s, i) => s + estimatedSubtotal(
    i.pricing_model || 'catch_weight', i.quantity, resolveWholesalePrice(i), i.estimated_weight || 1), 0);

  msg.textContent = 'Validating…';
  msg.className   = 'promo-msg';
  btn.disabled    = true;

  const data = await apiFetch(apiUrl('validate_promo'), {
    method: 'POST',
    body:   JSON.stringify({ code, order_total: subtotal }),
  });

  btn.disabled = false;

  if (data.success) {
    state.checkoutPromo = { ...data.promo, discount_amount: data.discount_amount };
    msg.textContent     = '';
    msg.className       = 'promo-msg';
    _syncPromoUI();
    updateCheckoutSummary();
    toast(`Promo "${code}" applied — saving ${fmtPrice(data.discount_amount)}! 🎉`, 'success');
  } else {
    state.checkoutPromo = null;
    msg.textContent     = data.message;
    msg.className       = 'promo-msg error';
    _syncPromoUI();
    updateCheckoutSummary();
  }
}

function removePromo() {
  state.checkoutPromo = null;
  const inp = document.getElementById('co-promo');
  if (inp) inp.value = '';
  const msg = document.getElementById('promo-msg');
  if (msg) { msg.textContent = ''; msg.className = 'promo-msg'; }
  _syncPromoUI();
  updateCheckoutSummary();
  toast('Promo code removed.', 'info');
}

/** Sync the promo input row vs applied row based on state. */
function _syncPromoUI() {
  const inputRow   = document.getElementById('promo-input-row');
  const appliedRow = document.getElementById('promo-applied-row');
  const label      = document.getElementById('promo-applied-label');
  if (!inputRow || !appliedRow) return;

  if (state.checkoutPromo) {
    const p = state.checkoutPromo;
    const discStr = p.discount_type === 'percentage'
      ? `${p.discount_value}% off`
      : `₱${parseFloat(p.discount_value).toFixed(2)} off`;
    label.textContent       = `✅ "${p.code}" — ${discStr} applied`;
    inputRow.style.display   = 'none';
    appliedRow.style.display = 'flex';
  } else {
    inputRow.style.display   = '';
    appliedRow.style.display = 'none';
  }
}

async function placeOrder() {
// Guests must sign in before order placement — redirect with cart preserved
  if (!state.user) {
    toast('Please sign in or create an account to complete your order. Your cart has been saved.', 'info');
    navigate('auth');
    return;
  }
  const slotId    = parseInt(document.getElementById('co-slot')?.value || 0) || null;
  const zoneEl    = document.getElementById('co-zone');
  const zoneId    = parseInt(zoneEl?.value || 0) || null;
  const payment   = document.querySelector('input[name="payment"]:checked')?.value || 'COD';
  const date      = document.getElementById('co-date')?.value;

  // Zone must be resolved before we go further — if it's missing, run auto-match one more time
  // using the currently selected saved address or the manually entered address fields.
  if (!zoneId) {
    const savedSel = document.getElementById('co-saved-address');
    if (savedSel?.value) {
      const opt = savedSel.options[savedSel.selectedIndex];
      _autoMatchZone(opt?.dataset?.barangay, opt?.dataset?.city);
    } else {
      _autoMatchZone(
        document.getElementById('co-barangay')?.value,
        document.getElementById('co-city')?.value
      );
    }
    // Re-read after retry
    const retryZoneId = parseInt(zoneEl?.value || 0) || null;
    if (!retryZoneId) {
      toast('We could not determine your delivery zone from your address. Please contact us or choose a different address.', 'error');
      const zoneGroup = document.getElementById('co-zone-group');
      if (zoneGroup) { zoneGroup.hidden = false; zoneGroup.removeAttribute('aria-hidden'); }
      const feeNotice = document.getElementById('co-zone-notice');
      if (feeNotice) { feeNotice.textContent = '⚠️ Your delivery area is outside our current zones. Please call us to arrange delivery.'; feeNotice.style.display = 'block'; }
      return;
    }
  }

  // Guard: slot must be selected before proceeding
  if (!slotId) {
    toast('Please select a delivery time slot before confirming your order.', 'error');
    document.getElementById('co-slot')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // GCash: require reference number before proceeding
  let gcashRef     = null;
  let gcashReceipt = null;
  if (payment === 'GCash') {
    gcashRef = document.getElementById('co-gcash-ref')?.value?.trim() || '';
    if (!gcashRef) {
      toast('Please enter your GCash Reference Number to continue.', 'error');
      document.getElementById('co-gcash-ref')?.focus();
      return;
    }
    const receiptFile = document.getElementById('co-gcash-receipt')?.files?.[0];
    if (receiptFile) {
      gcashReceipt = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Receipt read failed'));
        reader.readAsDataURL(receiptFile);
      });
    }
  }
  const notes     = document.getElementById('co-notes')?.value || '';
  const promoCode = state.checkoutPromo ? state.checkoutPromo.code : '';
  if (!date) { toast('Please select a delivery date.', 'error'); return; }

  let addressId = null;
  const savedSelect = document.getElementById('co-saved-address');
  if (savedSelect?.value) {
    addressId = parseInt(savedSelect.value);
  } else {
    const street   = document.getElementById('co-street')?.value?.trim();
const bgyEl        = document.getElementById('co-barangay');
    const cityEl       = document.getElementById('co-city');
    const barangayId   = parseInt(bgyEl?.value)  || 0;
    const municipalityId = parseInt(
      cityEl?.options[cityEl.selectedIndex]?.dataset.municipalityId ?? 0
    );
    if (!street || !barangayId) { toast('Please enter your delivery address (street and barangay).', 'error'); return; }
    const saveAsDefault = document.getElementById('co-save-default')?.checked ? 1 : 0;
    const addrData = await apiFetch(apiUrl('add_address'), {
      method: 'POST',
      body:   JSON.stringify({
        user_id: state.user.user_id, label: 'Delivery',
        street, barangay_id: barangayId, municipality_id: municipalityId,
        is_default: saveAsDefault,
      }),
    });
    if (!addrData.success) { toast('Could not save address: ' + addrData.message, 'error'); return; }
    const addrs = addrData.data?.addresses || [];
    if (addrs.length) addressId = addrs[addrs.length - 1].address_id;
  }
  if (!addressId) { toast('Unable to determine delivery address.', 'error'); return; }

  // Zone is guaranteed non-null at this point — validated and retried above.

  const btn = document.querySelector('#checkout-summary-panel .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Placing order…'; }

  const data = await apiFetch(apiUrl('place_order'), {
    method: 'POST',
    body:   JSON.stringify({
      user_id: state.user.user_id, address_id: addressId, slot_id: slotId,
      zone_id: zoneId, payment_method: payment, delivery_date: date,
      special_instructions: notes, promo_code: promoCode,
      gcash_reference: gcashRef || null,
      gcash_receipt:   gcashReceipt || null,
    }),
  });

  if (data.success) {
    state.cart = []; state.checkoutPromo = null;
    updateCartBadge();
    toast(`Order ${data.order_number} placed! 🎉`, 'success');
    await loadNotifications();
    navigate('orders');
  } else {
    if (!_handleSuspendedError(data)) {
      toast(data.message || 'Failed to place order.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm Order'; }
    }
  }
}
/* ════════════════════════════════════════════════════════════
   ORDERS PAGE
═══════════════════════════════════════════════════════════════*/

async function loadOrders() {
  const el = document.getElementById('orders-list');
  el.innerHTML = spinnerHTML('Loading orders');
  if (!state.user) {
    el.innerHTML = `<div class="empty-state"><span>🔐</span><h3>Sign in to see your orders</h3><br/>
      <button class="btn-primary" onclick="navigate('auth')">Sign In</button></div>`;
    return;
  }
  const data = await apiFetch(`${CUSTOMER_API}?action=orders&user_id=${state.user.user_id}`);
  if (!data.success) { el.innerHTML = '<p class="empty-state">Could not load orders. Please try again.</p>'; return; }

const orders = data.data || [];
  state.allOrders = orders; // cache for client-side filtering

  renderOrderList(orders);
}

/** Render an array of order objects into #orders-list. */
function renderOrderList(orders) {
  const el = document.getElementById('orders-list');
  if (!orders.length) {
    el.innerHTML = `<div class="empty-state"><span>📦</span><h3>No orders found</h3><p>Try adjusting your filters, or place your first order.</p><br/>
      <button class="btn-primary" onclick="navigate('catalog')">Start Shopping</button></div>`;
    return;
  }

  el.innerHTML = '<div style="padding:1.5rem 0 3rem">' + orders.map(o => {
    const isPacked   = ['Packed','Out for Delivery','Arrived at Location','Completed'].includes(o.status);
    const amount     = isPacked && o.final_total ? o.final_total : o.estimated_total;
    const amtLabel   = isPacked && o.final_total ? 'Final Total' : 'Est. Total';
    const statusClass = 'status-' + o.status.replace(/\s+/g, '-');
    return `<div class="order-card" onclick="showOrderDetail(${o.order_id})">
      <div style="font-size:2rem">📦</div>
      <div class="order-info">
        <div class="order-number">${o.order_number}</div>
        <div class="order-date">${fmtDate(o.delivery_date)} · ${o.payment_method}</div>
        <div style="margin-top:.4rem"><span class="status-badge ${statusClass}">${o.status}</span></div>
      </div>
      <div class="order-amount">
        <div class="amount-main">${fmtPrice(amount)}</div>
        <div class="amount-label">${amtLabel}</div>
      </div>
<div style="color:var(--text-muted);font-size:1.2rem">›</div>
    </div>`;
  }).join('') + '</div>';
}

/** Apply status + date-range filters to the cached order list. */
function applyOrderFilters() {
  if (!state.allOrders) return;
  const statusVal = document.getElementById('order-filter-status')?.value ?? '';
  const fromVal   = document.getElementById('order-filter-from')?.value   ?? '';
  const toVal     = document.getElementById('order-filter-to')?.value     ?? '';

  const filtered = state.allOrders.filter(o => {
    if (statusVal && o.status !== statusVal) return false;
    if (fromVal   && o.delivery_date < fromVal) return false;
    if (toVal     && o.delivery_date > toVal)   return false;
    return true;
  });
  renderOrderList(filtered);
}

/** Reset all filter inputs and re-render the full list. */
function clearOrderFilters() {
  const s = document.getElementById('order-filter-status');
  const f = document.getElementById('order-filter-from');
  const t = document.getElementById('order-filter-to');
  if (s) s.value = '';
  if (f) f.value = '';
  if (t) t.value = '';
  renderOrderList(state.allOrders || []);
}

/* ════════════════════════════════════════════════════════════
   ORDER DETAIL MODAL  [MAJOR IMPROVEMENT]
═══════════════════════════════════════════════════════════════*/

async function showOrderDetail(orderId) {
  const overlay = document.getElementById('order-modal-overlay');
  const content = document.getElementById('order-modal-content');
  overlay.style.display = 'flex';
  content.innerHTML     = spinnerHTML('Loading order');

  const data = await apiFetch(`${CUSTOMER_API}?action=order&order_id=${orderId}`);
  if (!data.success) { content.innerHTML = '<p>Could not load order.</p>'; return; }

  const o         = data.data;
  const isPacked  = ['Packed','Out for Delivery','Arrived at Location','Completed'].includes(o.status);
  const isPending = o.status === 'Pending';
  const isDone    = o.status === 'Completed';

  // Order tracking timeline — handles linear progress AND terminal alternative states
  const timelineSteps = ['Pending','Packed','Out for Delivery','Arrived at Location','Completed'];
  const currentIdx    = timelineSteps.indexOf(o.status);
  const TERMINAL_STATES = {
    'Cancelled':       { icon: '🚫', label: 'This order was cancelled.'              },
    'Failed Delivery': { icon: '❌', label: 'Delivery could not be completed.'       },
  };
  const terminal = TERMINAL_STATES[o.status];
  const timelineHTML = terminal
    ? `<div class="order-cancelled-banner">${terminal.icon} ${terminal.label}
         ${o.cancellation_reason ? `<p class="cancel-reason-note" style="margin-top:.4rem;font-size:.85rem;color:var(--text-muted)">${escHtml(o.cancellation_reason)}</p>` : ''}
       </div>`
    : `<div class="order-timeline">
      ${timelineSteps.map((step, idx) => {
        let cls = 'timeline-step';
        if (idx < currentIdx)  cls += ' step-done';
        if (idx === currentIdx) cls += ' step-active';
        const icons = { 'Pending':'🕐', 'Packed':'📦', 'Out for Delivery':'🚴', 'Arrived at Location':'📍', 'Completed':'✅' };
        return `<div class="${cls}">
          <div class="timeline-dot">${icons[step] || '●'}</div>
          <div class="timeline-label">${step}</div>
        </div>`;
      }).join('<div class="timeline-connector"></div>')}
    </div>`;

  // [NEW] Dispatch / delivery timestamps
  let timestampsHTML = '';
  if (o.dispatched_at || o.delivered_at) {
    timestampsHTML = `<div class="order-timestamps">`;
    if (o.dispatched_at) timestampsHTML += `<div class="ts-row"><span>🚴 Dispatched:</span><span>${fmtDateTime(o.dispatched_at)}</span></div>`;
    if (o.delivered_at)  timestampsHTML += `<div class="ts-row"><span>✅ Delivered:</span><span>${fmtDateTime(o.delivered_at)}</span></div>`;
    timestampsHTML += `</div>`;
  }

  // [NEW] Proof of delivery
  const podHTML = isDone && o.proof_of_delivery_url ? `
    <div class="pod-section">
      <h4>📸 Proof of Delivery</h4>
      <a href="${escHtml(o.proof_of_delivery_url)}" target="_blank" rel="noopener" class="pod-link">
        View Photo →
      </a>
    </div>` : '';

  // [NEW] Payment verification status
  let payStatusHTML = '';
  if (o.payment_method !== 'COD') {
    const verifiedAt = o.pay_verified_at;
    const payStatus  = o.pay_status || 'Unpaid';
    payStatusHTML = `
      <div class="pay-verify-row">
        <span>💙 GCash Payment:</span>
        <span class="${payStatus === 'Paid' ? 'pay-verified' : 'pay-unverified'}">
          ${payStatus === 'Paid'
            ? `✅ Verified ${verifiedAt ? '(' + fmtDate(verifiedAt) + ')' : ''}`
            : '⏳ Pending verification by finance team'}
        </span>
      </div>`;
  }

  // [NEW] Action buttons for completed orders
  let actionButtons = '';
  if (isDone) {
    // Review buttons per item
    const reviewBtns = (o.items || []).map(i => `
      <button class="btn-outline btn-sm" style="margin:.25rem"
        onclick="openReviewModal(${i.product_id}, ${o.order_id}, '${escHtml(i.name)}')">
        ⭐ Review: ${escHtml(i.name)}
      </button>`).join('');

    // Dispute button (one per order) + status if already filed
    let disputeSection = '';
    if (o.dispute) {
    const dStatusMap = { 'Open': '🟡 Open', 'Under Review': '🔵 Under Review', 'Resolved': '🟢 Resolved', 'Rejected': '🔴 Rejected' };
      // [NEW] Show resolved_at if available
      const resolvedStr = o.dispute.resolved_at
        ? ` · Resolved: ${fmtDateTime(o.dispute.resolved_at)}`
        : '';
      disputeSection = `<div class="dispute-status-row">
        📋 Dispute: <strong>${dStatusMap[o.dispute.dispute_status] || o.dispute.dispute_status}</strong>
        <span style="color:var(--text-muted);font-size:.8rem"> — filed ${fmtDate(o.dispute.created_at)}${escHtml(resolvedStr)}</span>
      </div>`;
    } else {
      disputeSection = `<button class="btn-outline btn-sm btn-danger-outline" style="margin:.25rem"
        onclick="openDisputeModal(${o.order_id})">🚨 Report Issue</button>`;
    }

    actionButtons = `
      <div class="modal-action-section">
        <h4 style="margin-bottom:.5rem">Post-Order Actions</h4>
        <div class="modal-review-btns">${reviewBtns}</div>
        ${disputeSection}
      </div>`;
  }

// Cancel button (Pending only)
  const cancelBtn = (isPending && state.user?.user_id == o.user_id)
    ? `<button class="btn-danger" style="margin-top:1rem;width:100%;justify-content:center"
        onclick="openCancelModal(${o.order_id})">Cancel Order</button>`
    : '';

  // Edit button (Pending only) — passes the full order object as JSON
  const editBtn = (isPending && state.user?.user_id == o.user_id)
    ? `<button class="btn-outline full-width" style="margin-top:.5rem;justify-content:center"
        onclick='openEditOrderModal(${JSON.stringify(o)})'>✏️ Edit Order</button>`
    : '';

  // Reorder button (all statuses except Pending, since Pending is already active)
  const reorderBtn = !isPending
    ? `<button id="reorder-btn-${o.order_id}" class="btn-outline full-width"
        style="margin-top:.75rem;justify-content:center"
        onclick="reorderFromOrder(${o.order_id})">🛒 Reorder</button>`
    : '';

  content.innerHTML = `
    <div class="modal-order-header">
      <h3>${o.order_number}</h3>
      <div style="margin-top:.4rem"><span class="status-badge status-${o.status.replace(/\s+/g, '-')}">${o.status}</span></div>
      <div style="font-size:.85rem;color:var(--text-muted);margin-top:.4rem">
        Delivery: ${fmtDate(o.delivery_date)} · ${o.slot_label || ''}<br/>Payment: ${o.payment_method}
      </div>
      ${o.street ? `<div style="font-size:.85rem;color:var(--text-muted);margin-top:.4rem">📍 ${o.street}, ${o.barangay}, ${o.city}</div>` : ''}
    </div>

    ${timelineHTML}
    ${timestampsHTML}
    ${payStatusHTML}
    ${podHTML}

    <div class="modal-items">
      <h4 style="margin-bottom:.5rem">Items</h4>
      ${(o.items || []).map(i => {
        const pm = i.pricing_model || 'catch_weight';
        return `<div class="modal-item">
          <span>${i.name} ×${i.quantity}<small style="display:block;color:var(--text-muted);font-size:.75rem">${pricingModelBadge(pm)}</small></span>
          <span>
          ${isPacked && i.actual_weight && pm === 'catch_weight'
              ? `<div class="weight-comparison-col">
                   <div class="weight-comparison">
                     <span class="weight-est" title="Estimated weight">~${parseFloat(i.estimated_weight || 0).toFixed(3)} kg</span>
                     <span class="weight-arrow">→</span>
                     <span class="weight-actual" title="Actual weight">${parseFloat(i.actual_weight).toFixed(3)} kg</span>
                   </div>
                   <div style="font-weight:700;color:var(--green)">${fmtPrice(i.final_subtotal)}</div>
                 </div>`
              : isPacked && pm !== 'catch_weight' && i.final_subtotal
                ? `<span style="color:var(--green);font-weight:700">${fmtPrice(i.final_subtotal)}</span>`
                : `<span style="color:var(--text-muted)">~${fmtPrice(i.estimated_subtotal)}</span>`}
          </span>
        </div>`;
      }).join('')}
    </div>

    <div class="modal-totals">
      <div class="summary-row"><span>Delivery Fee</span><span>${fmtPrice(o.delivery_fee)}</span></div>
      ${o.discount_amount > 0 ? `<div class="summary-row" style="color:var(--green)"><span>Discount</span><span>−${fmtPrice(o.discount_amount)}</span></div>` : ''}
      ${isPacked && o.final_total
        ? `<div class="summary-row total"><span>✓ Final Total</span><span style="color:var(--green)">${fmtPrice(o.final_total)}</span></div>
           <p style="font-size:.78rem;color:var(--text-muted);margin-top:.5rem">✓ Weighed and confirmed by staff</p>`
        : `<div class="summary-row total"><span>Estimated Total</span><span>${fmtPrice(o.estimated_total)}</span></div>
           <p style="font-size:.78rem;color:var(--orange);margin-top:.5rem">⚖ Final total confirmed after packing</p>`}
    </div>

${actionButtons}
    ${editBtn}
    ${cancelBtn}
    ${reorderBtn}`;
}

/**
 * Reorder: bulk-add all items from a past order into the current cart.
 * Skips archived products silently and reports a summary toast.
 */
async function reorderFromOrder(orderId) {
  if (!state.user) { navigate('auth'); return; }

  const data = await apiFetch(`${CUSTOMER_API}?action=order&order_id=${orderId}`);
  if (!data.success) { toast('Could not load order details.', 'error'); return; }

  const items   = data.data.items || [];
  const btn     = document.getElementById(`reorder-btn-${orderId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }

  let added = 0, skipped = 0;
  for (const item of items) {
    try {
      const res = await apiFetch(apiUrl('cart_add'), {
        method: 'POST',
        body:   JSON.stringify({ user_id: state.user.user_id, product_id: item.product_id, quantity: item.quantity }),
      });
      if (res.success) added++; else skipped++;
    } catch (_) { skipped++; }
  }

  // Refresh cart state
  const cartData = await apiFetch(`${CUSTOMER_API}?action=cart&user_id=${state.user.user_id}`);
  if (cartData.success) { state.cart = cartData.data?.items || []; updateCartBadge(); }

  if (btn) { btn.disabled = false; btn.textContent = '🛒 Reorder'; }
  closeOrderModal();

  const msg = skipped > 0
    ? `Added ${added} item(s) to cart. ${skipped} item(s) are no longer available.`
    : `Added ${added} item(s) to cart! 🛒`;
  toast(msg, added > 0 ? 'success' : 'error');
  if (added > 0) navigate('cart');
}

function closeOrderModal() {
  document.getElementById('order-modal-overlay').style.display = 'none';
}

/** Open the Edit Order modal pre-filled with the current order values. */
function openEditOrderModal(o) {
  document.getElementById('eo-order-id').value  = o.order_id;
  document.getElementById('eo-date').value       = o.delivery_date || '';
  document.getElementById('eo-payment').value    = o.payment_method || 'COD';
  document.getElementById('eo-notes').value      = o.special_instructions || '';
  document.getElementById('eo-error').style.display = 'none';

  // Populate slots and zones from cached checkoutMeta
  const slotSel = document.getElementById('eo-slot');
  const zoneSel = document.getElementById('eo-zone');
  const meta    = state.checkoutMeta;

  if (meta?.slots) {
    slotSel.innerHTML = meta.slots.map(s =>
      `<option value="${s.slot_id}" ${s.slot_id == o.slot_id ? 'selected' : ''}>${s.slot_label}</option>`
    ).join('');
  }
  if (meta?.zones) {
    zoneSel.innerHTML = meta.zones.map(z =>
      `<option value="${z.zone_id}" ${z.zone_id == o.zone_id ? 'selected' : ''}>${z.barangay}, ${z.city} – ₱${parseFloat(z.delivery_fee).toFixed(2)}</option>`
    ).join('');
  }

  // Ensure checkoutMeta is loaded if it wasn't already
  if (!meta) {
    apiFetch(apiUrl('checkout_meta')).then(d => {
      if (d.success) {
        state.checkoutMeta = d.data;
        openEditOrderModal(o); // re-open with data
      }
    });
    return;
  }

  document.getElementById('edit-order-modal-overlay').style.display = 'flex';
}

function closeEditOrderModal() {
  document.getElementById('edit-order-modal-overlay').style.display = 'none';
}

async function submitEditOrder() {
  if (!state.user) return;
  const orderId = parseInt(document.getElementById('eo-order-id').value);
  const date    = document.getElementById('eo-date').value;
  const slotId  = parseInt(document.getElementById('eo-slot').value) || 0;
  const zoneId  = parseInt(document.getElementById('eo-zone').value) || 0;
  const pm      = document.getElementById('eo-payment').value;
  const notes   = document.getElementById('eo-notes').value.trim();
  const errEl   = document.getElementById('eo-error');
  errEl.style.display = 'none';

  if (!date) { errEl.textContent = 'Please select a delivery date.'; errEl.style.display = 'block'; return; }

  const data = await apiFetch(apiUrl('edit_order'), {
    method: 'POST',
    body:   JSON.stringify({
      user_id: state.user.user_id, order_id: orderId,
      delivery_date: date, slot_id: slotId, zone_id: zoneId,
      payment_method: pm, special_instructions: notes,
    }),
  });

  if (data.success) {
    toast('Order updated successfully! ✓', 'success');
    closeEditOrderModal();
    showOrderDetail(orderId); // refresh the detail modal
  } else {
    errEl.textContent   = data.message;
    errEl.style.display = 'block';
  }
}

/* ════════════════════════════════════════════════════════════
   CANCEL ORDER MODAL  [NEW — reason picker]
═══════════════════════════════════════════════════════════════*/

function openCancelModal(orderId) {
  document.getElementById('cancel-order-id').value = orderId;
  document.getElementById('cancel-reason-select').value = 'Changed my mind';
  document.getElementById('cancel-other-wrap').style.display = 'none';
  document.getElementById('cancel-modal-overlay').style.display = 'flex';
}

function closeCancelModal() {
  document.getElementById('cancel-modal-overlay').style.display = 'none';
}

function onCancelReasonChange() {
  const val = document.getElementById('cancel-reason-select').value;
  document.getElementById('cancel-other-wrap').style.display = val === 'Other' ? 'block' : 'none';
}

async function confirmCancelOrder() {
  if (!state.user) return;
  const orderId  = parseInt(document.getElementById('cancel-order-id').value);
  const selected = document.getElementById('cancel-reason-select').value;
  const other    = document.getElementById('cancel-reason-other').value.trim();
  const reason   = selected === 'Other' ? (other || 'Other') : selected;

  const data = await apiFetch(apiUrl('cancel_order'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id, order_id: orderId, reason }),
  });

  if (data.success) {
    toast('Order cancelled.', 'success');
    closeCancelModal();
    closeOrderModal();
    loadOrders();
    loadNotifications();
  } else {
    toast(data.message || 'Could not cancel order.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   REVIEW MODAL  [NEW]
═══════════════════════════════════════════════════════════════*/

let _reviewRating = 0;

function openReviewModal(productId, orderId, productName) {
  _reviewRating = 0;
  document.getElementById('review-product-id').value  = productId;
  document.getElementById('review-order-id').value    = orderId;
  document.getElementById('review-product-name').textContent = productName;
  document.getElementById('review-text').value         = '';
  document.getElementById('review-rating').value       = '0';
  document.getElementById('review-error').style.display = 'none';
  _renderStarPicker(0);
  document.getElementById('review-modal-overlay').style.display = 'flex';
}

function closeReviewModal() {
  document.getElementById('review-modal-overlay').style.display = 'none';
}

function setReviewRating(val) {
  _reviewRating = val;
  document.getElementById('review-rating').value = val;
  _renderStarPicker(val);
}

function _renderStarPicker(active) {
  document.querySelectorAll('.star-pick').forEach(s => {
    const v = parseInt(s.dataset.val);
    s.classList.toggle('star-pick-active', v <= active);
  });
}

async function submitReview() {
  const productId = parseInt(document.getElementById('review-product-id').value);
  const orderId   = parseInt(document.getElementById('review-order-id').value);
  const rating    = parseInt(document.getElementById('review-rating').value);
  const text      = document.getElementById('review-text').value.trim();
  const errEl     = document.getElementById('review-error');
  errEl.style.display = 'none';

  if (!state.user || !productId || !orderId) return;
  if (rating < 1 || rating > 5) {
    errEl.textContent   = 'Please select a rating (1–5 stars).';
    errEl.style.display = 'block';
    return;
  }

  const data = await apiFetch(apiUrl('add_review'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id, product_id: productId, order_id: orderId, rating, review_text: text }),
  });

  if (data.success) {
    toast('Review submitted! Thank you ⭐', 'success');
    closeReviewModal();
  } else {
    errEl.textContent   = data.message;
    errEl.style.display = 'block';
  }
}

/* ════════════════════════════════════════════════════════════
   DISPUTE MODAL  [NEW]
═══════════════════════════════════════════════════════════════*/

function openDisputeModal(orderId) {
  document.getElementById('dispute-order-id').value        = orderId;
  document.getElementById('dispute-description').value     = '';
  // Reset file input by replacing it with a fresh clone (value='' does not clear file inputs in all browsers)
  const fileInput = document.getElementById('dispute-evidence');
  if (fileInput) {
    const clone = fileInput.cloneNode(true);
    fileInput.parentNode.replaceChild(clone, fileInput);
  }
  document.getElementById('dispute-error').style.display   = 'none';
  document.getElementById('dispute-modal-overlay').style.display = 'flex';
}

function closeDisputeModal() {
  document.getElementById('dispute-modal-overlay').style.display = 'none';
}

async function submitDispute() {
  const orderId     = parseInt(document.getElementById('dispute-order-id').value);
  const description = document.getElementById('dispute-description').value.trim();
  const fileInput   = document.getElementById('dispute-evidence');
  const errEl       = document.getElementById('dispute-error');
  errEl.style.display = 'none';

  if (!state.user || !orderId) return;
  if (!description) {
    errEl.textContent   = 'Please describe the issue.';
    errEl.style.display = 'block';
    return;
  }

  // Read the selected file as a Base64 data-URL for multipart submission
  let evidenceData = null;
  if (fileInput.files && fileInput.files[0]) {
    const file = fileInput.files[0];
    if (file.size > 5 * 1024 * 1024) {
      errEl.textContent   = 'Photo file must be 5 MB or smaller.';
      errEl.style.display = 'block';
      return;
    }
    evidenceData = await new Promise((resolve, reject) => {
      const reader  = new FileReader();
      reader.onload  = () => resolve(reader.result);   // data:image/...;base64,...
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsDataURL(file);
    });
  }

  const data = await apiFetch(apiUrl('file_dispute'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id, order_id: orderId, description, evidence_data: evidenceData }),
  });

  if (data.success) {
    toast('Issue reported. Our team will review it. 📋', 'success');
    closeDisputeModal();
    // Re-open the order detail to show the new dispute status
    showOrderDetail(orderId);
  } else {
    errEl.textContent   = data.message;
    errEl.style.display = 'block';
  }
}

/* ════════════════════════════════════════════════════════════
   PROFILE PAGE  [IMPROVED — change password tab]
═══════════════════════════════════════════════════════════════*/

async function loadProfile() {
  if (!state.user) { navigate('auth'); return; }
  const data = await apiFetch(`${CUSTOMER_API}?action=profile&user_id=${state.user.user_id}`);
  if (!data.success) return;

const { user, addresses } = data.data;
  state.savedAddresses = addresses || [];
  document.getElementById('pf-first').value = user.first_name || '';
  document.getElementById('pf-last').value  = user.last_name  || '';
  document.getElementById('pf-email').value = user.email      || '';
  document.getElementById('pf-phone').value = user.phone      || '';
  renderAddresses(state.savedAddresses);
}

function renderAddresses(addresses) {
  const el = document.getElementById('address-list');
  if (!addresses?.length) { el.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem">No saved addresses yet.</p>'; return; }
  el.innerHTML = addresses.map(a => `
    <div class="address-item">
      <div>
        <span class="address-label-tag">
          ${a.label}${a.is_default == 1 ? ' <span class="default-tag">★ Default</span>' : ''}
        </span>
        <div class="address-text">${a.street}, ${a.barangay}, ${a.city}, ${a.province}</div>
      </div>
      <div style="display:flex;gap:.5rem">
        <button class="btn-outline btn-sm" onclick="editAddress(${a.address_id})">Edit</button>
        <button class="btn-danger btn-sm" onclick="deleteAddress(${a.address_id})">Remove</button>
      </div>
    </div>`).join('');
}

/** Populate and show the edit form pre-filled with the selected address data. */
async function editAddress(addressId) {
  const addr = state.savedAddresses.find(a => a.address_id == addressId);
  if (!addr) { toast('Address not found. Please refresh.', 'error'); return; }

  document.getElementById('eaf-id').value        = addr.address_id;
  document.getElementById('eaf-label').value     = addr.label     || 'Home';
  document.getElementById('eaf-street').value    = addr.street    || '';
  await setAddressDropdowns('eaf-city', 'eaf-barangay', addr.city || 'Legazpi City', addr.barangay_id || '');
  document.getElementById('eaf-province').value  = addr.province  || 'Albay';
  document.getElementById('eaf-default').checked = addr.is_default == 1;

  // Hide add form if open, show edit form
  document.getElementById('address-form').style.display      = 'none';
  document.getElementById('edit-address-form').style.display = 'block';
}

async function submitEditAddress() {
  if (!state.user) return;
  const addrId          = parseInt(document.getElementById('eaf-id').value);
  const label           = document.getElementById('eaf-label').value.trim()  || 'Home';
  const street          = document.getElementById('eaf-street').value.trim();
  const bgyEl           = document.getElementById('eaf-barangay');
  const cityEl          = document.getElementById('eaf-city');
  const barangay_id     = parseInt(bgyEl?.value) || 0;
  const municipality_id = parseInt(cityEl?.options[cityEl.selectedIndex]?.dataset.municipalityId ?? 0) || 0;
  const is_def          = document.getElementById('eaf-default')?.checked ? 1 : 0;

  if (!street || !barangay_id) { toast('Street and barangay are required.', 'error'); return; }

  const data = await apiFetch(apiUrl('update_address'), {
    method: 'POST',
    body:   JSON.stringify({
      user_id: state.user.user_id, address_id: addrId,
      label, street, barangay_id, municipality_id, is_default: is_def,
    }),
  });

  if (data.success) {
    state.savedAddresses = data.data.addresses || [];
    renderAddresses(state.savedAddresses);
    document.getElementById('edit-address-form').style.display = 'none';
    toast('Address updated! 📍', 'success');
  } else {
    toast(data.message || 'Could not update address.', 'error');
  }
}

async function saveProfile() {
  if (!state.user) return;
  const first = document.getElementById('pf-first').value.trim();
  const last  = document.getElementById('pf-last').value.trim();
  const phone = document.getElementById('pf-phone').value.trim();
  const data  = await apiFetch(apiUrl('update_profile'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id, first_name: first, last_name: last, phone }),
  });
  if (data.success) {
    state.user.first_name = first; state.user.last_name = last; state.user.phone = phone;
    toast('Profile updated! ✓', 'success');
  } else { toast(data.message, 'error'); }
}

/** [NEW] Change password handler */
async function changePassword() {
  if (!state.user) return;
  const current  = document.getElementById('sec-current').value;
  const newPass  = document.getElementById('sec-new').value;
  const confirm  = document.getElementById('sec-confirm').value;
  const errEl    = document.getElementById('sec-error');
  errEl.style.display = 'none';

  if (!current || !newPass || !confirm) {
    errEl.textContent   = 'Please fill in all fields.';
    errEl.style.display = 'block';
    return;
  }
  if (newPass !== confirm) {
    errEl.textContent   = 'New passwords do not match.';
    errEl.style.display = 'block';
    return;
  }
  if (newPass.length < 8) {
    errEl.textContent   = 'New password must be at least 8 characters.';
    errEl.style.display = 'block';
    return;
  }

  const data = await apiFetch(apiUrl('change_password'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id, current_password: current, new_password: newPass }),
  });

  if (data.success) {
    toast('Password changed successfully! 🔒', 'success');
    document.getElementById('sec-current').value = '';
    document.getElementById('sec-new').value     = '';
    document.getElementById('sec-confirm').value = '';
  } else {
    errEl.textContent   = data.message;
    errEl.style.display = 'block';
  }
}

function showProfileTab(tab, event) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.profile-nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('profile-' + tab + '-tab').classList.add('active');
  if (event) event.currentTarget.classList.add('active');
}

function showAddressForm() {
  initMunicipalitySelect('af-city', 'af-barangay'); document.getElementById('address-form').style.display = 'block'; }

async function submitAddress() {
  if (!state.user) return;
  const label           = document.getElementById('af-label').value.trim()  || 'Home';
  const street          = document.getElementById('af-street').value.trim();
  const bgyEl           = document.getElementById('af-barangay');
  const cityEl          = document.getElementById('af-city');
  const barangay_id     = parseInt(bgyEl?.value) || 0;
  const municipality_id = parseInt(cityEl?.options[cityEl.selectedIndex]?.dataset.municipalityId ?? 0) || 0;
  const is_def          = document.getElementById('af-default')?.checked ? 1 : 0;
  if (!street || !barangay_id) { toast('Please fill in street and barangay.', 'error'); return; }
  const data = await apiFetch(apiUrl('add_address'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id, label, street, barangay_id, municipality_id, is_default: is_def }),
  });
  if (data.success) {
    renderAddresses(data.data.addresses);
    document.getElementById('address-form').style.display = 'none';
    ['af-label','af-street'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    ['af-city','af-barangay'].forEach(id => { const el = document.getElementById(id); if(el) el.selectedIndex=0; });
    toast('Address added! 📍', 'success');
  } else { toast(data.message, 'error'); }
}

async function deleteAddress(addressId) {
  if (!state.user || !confirm('Remove this address?')) return;
  const data = await apiFetch(apiUrl('delete_address'), {
    method: 'POST',
    body:   JSON.stringify({ user_id: state.user.user_id, address_id: addressId }),
  });
  if (data.success) { renderAddresses(data.data.addresses); toast('Address removed.', ''); }
  else { toast(data.message || 'Could not remove address.', 'error'); }
}

/* ════════════════════════════════════════════════════════════
   SEARCH TOGGLE
═══════════════════════════════════════════════════════════════*/

function toggleSearch() {
  const el = document.getElementById('search-overlay');
  el.classList.toggle('open');
  el.style.display = el.classList.contains('open') ? 'block' : 'none';
  if (el.classList.contains('open')) document.getElementById('global-search').focus();
}

function _handleSuspendedError(data) {
  if (data && !data.success &&
      (data.message || '').toLowerCase().match(/suspended|blocked/)) {
    toast('Your account has been suspended. You have been signed out.', 'error');
    logout();
    return true;
  }
  return false;
}

async function loadStoreFooterHours() {
  if (!state.checkoutMeta) {
    const data = await apiFetch(apiUrl('checkout_meta'));
    if (data.success) state.checkoutMeta = data.data;
  }
  const hours = state.checkoutMeta?.hours;
  if (!hours?.length) return;
 
  const activeHours = hours.filter(h => h.is_active == 1);
  if (!activeHours.length) return;
 
  const dayAbbr = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dows    = activeHours.map(h => parseInt(h.day_of_week)).sort((a, b) => a - b);
  const first   = dayAbbr[dows[0]];
  const last    = dayAbbr[dows[dows.length - 1]];
  const dayStr  = first === last ? first : `${first}–${last}`;
  const sample  = activeHours[0];
 
  const el = document.getElementById('footer-store-hours');
  if (el) el.textContent = `🕐 ${dayStr} ${fmtTime12(sample.open_time)}–${fmtTime12(sample.close_time)}`;
}

function isStoreOpen() {
  const hours = state.checkoutMeta?.hours;
  if (!hours?.length) return true;
  // Exclusively use the server-supplied time — never the local browser clock.
  if (!state.serverTime) return true; // serverTime not yet loaded; optimistically assume open
  const todayDow = parseInt(state.serverTime.dow);          // 0 = Sun … 6 = Sat (Asia/Manila)
  const todayRow = hours.find(h => parseInt(h.day_of_week) === todayDow && h.is_active == 1);
  if (!todayRow) return false;
  const nowHHMM  = state.serverTime.time.slice(0, 5);       // "HH:MM" from server payload
  return nowHHMM >= todayRow.open_time.slice(0, 5) && nowHHMM < todayRow.close_time.slice(0, 5);
}


/* ════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════*/

/* ════════════════════════════════════════════════════════════
   MOBILE NAV
═══════════════════════════════════════════════════════════════*/

function toggleMobileNav() {
  const drawer  = document.getElementById('mobile-nav-drawer');
  const overlay = document.getElementById('mobile-nav-overlay');
  const btn     = document.getElementById('hamburger-btn');
  const isOpen  = drawer.classList.contains('open');
  drawer.classList.toggle('open', !isOpen);
  overlay.classList.toggle('open', !isOpen);
  drawer.style.display  = isOpen ? 'none' : 'block';
  overlay.style.display = isOpen ? 'none' : 'block';
  drawer.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
  btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  document.body.classList.toggle('mobile-nav-open', !isOpen);
}

function closeMobileNav() {
  const drawer  = document.getElementById('mobile-nav-drawer');
  const overlay = document.getElementById('mobile-nav-overlay');
  const btn     = document.getElementById('hamburger-btn');
  if (!drawer) return;
  drawer.classList.remove('open');
  overlay.classList.remove('open');
  drawer.style.display  = 'none';
  overlay.style.display = 'none';
  drawer.setAttribute('aria-hidden', 'true');
  btn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('mobile-nav-open');
}

document.addEventListener('DOMContentLoaded', () => {
  navigate('home');
});