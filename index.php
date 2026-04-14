<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PoultryMart – Fresh Poultry Delivered in Albay</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/customer-entry.css" />
</head>
<body>

<!-- ══════════════════════════════════════════════
     HEADER
══════════════════════════════════════════════ -->
<header class="site-header" id="site-header">
  <div class="header-inner container">
    <a href="#" class="logo" onclick="navigate('home')">
      <span class="logo-icon">🐓</span>
      <span class="logo-text">Poultry<strong>Mart</strong></span>
    </a>

    <nav class="main-nav" id="main-nav">
      <a href="#" class="nav-link" onclick="navigate('catalog');closeMobileNav()">Shop</a>
      <a href="#" class="nav-link" onclick="navigate('orders');closeMobileNav()">My Orders</a>
      <a href="#" class="nav-link" onclick="navigate('profile');closeMobileNav()">Profile</a>
    </nav>

    <div class="header-actions">
      <button class="icon-btn search-toggle" aria-label="Search" onclick="toggleSearch()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </button>

      <!-- Hamburger — mobile only -->
      <button class="icon-btn hamburger-btn" id="hamburger-btn" aria-label="Menu" aria-expanded="false" onclick="toggleMobileNav()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>

      <!-- Notification Bell (shown only when logged in) -->
      <div class="notif-wrapper" id="notif-wrapper" hidden>
        <button class="icon-btn notif-btn" aria-label="Notifications" onclick="toggleNotifPanel()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span class="notif-badge" id="notif-badge" hidden>0</span>
        </button>
        <!-- Notification Dropdown Panel -->
        <div class="notif-panel" id="notif-panel" hidden>
          <div class="notif-panel-header">
            <span>Notifications</span>
            <button class="notif-mark-all" onclick="markAllNotificationsRead()">Mark all read</button>
          </div>
          <div class="notif-list" id="notif-list">
            <div class="notif-empty">No notifications yet.</div>
          </div>
        </div>
      </div>

      <button class="icon-btn cart-btn" aria-label="Cart" onclick="navigate('cart')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        <span class="cart-badge" id="cart-badge" style="display:none">0</span>
      </button>
      <button class="btn-primary btn-sm" id="auth-btn" onclick="navigate('auth')">Sign In</button>
    </div>
  </div>
  <div class="search-bar-overlay" id="search-overlay" style="display:none">
    <div class="container">
      <input type="text" id="global-search" placeholder="Search for chicken, duck, eggs…" oninput="globalSearch(this.value)" />
      <button onclick="toggleSearch()">✕</button>
    </div>
  </div>
</header>

<!-- Mobile nav drawer -->
<div id="mobile-nav-overlay" class="mobile-nav-overlay" style="display:none" onclick="closeMobileNav()"></div>
<div id="mobile-nav-drawer" class="mobile-nav-drawer" style="display:none" aria-hidden="true">
  <div class="mobile-nav-header">
    <div class="notif-wrapper" id="mobile-notif-wrapper" hidden>
      <span class="logo-icon">🐓</span>
      <span class="logo-text">Poultry<strong>Mart</strong></span>
    </div>
    <button class="icon-btn" aria-label="Close menu" onclick="closeMobileNav()">✕</button>
  </div>
  <nav class="mobile-nav-links">
    <a href="#" class="mobile-nav-link" onclick="navigate('home');closeMobileNav()">🏠 Home</a>
    <a href="#" class="mobile-nav-link" onclick="navigate('catalog');closeMobileNav()">🛍 Shop</a>
    <a href="#" class="mobile-nav-link" onclick="navigate('orders');closeMobileNav()">📦 My Orders</a>
    <a href="#" class="mobile-nav-link" onclick="navigate('profile');closeMobileNav()">👤 Profile</a>
  </nav>
</div>

<!-- ══════════════════════════════════════════════
     PAGE VIEWS
══════════════════════════════════════════════ -->
<main id="app-root">

  <!-- ── HOME ─────────────────────────────────── -->
  <div id="page-home" class="page active">
    <!-- Hero -->
    <section class="hero">
      <div class="hero-bg"></div>
      <div class="container hero-content">
        <span class="hero-badge">🌿 Farm-Fresh · Albay, Bicol</span>
        <h1>Fresh Poultry<br/><em>Delivered to You</em></h1>
        <p>From live-weight whole birds to marinated cuts — ordered online, delivered fresh to your door in Legazpi City and beyond.</p>
        <div class="hero-actions">
          <button class="btn-primary btn-lg" onclick="navigate('catalog')">Shop Now</button>
          <button class="btn-ghost btn-lg" onclick="document.getElementById('home-categories').scrollIntoView({behavior:'smooth'})">Browse Categories</button>
        </div>
        <div class="hero-stats">
          <div><strong>54+</strong><span>Products</span></div>
          <div><strong>8</strong><span>Categories</span></div>
          <div><strong>100%</strong><span>Fresh</span></div>
        </div>
      </div>
    </section>

    <!-- Featured Products -->
    <section class="section">
      <div class="container">
        <div class="section-header">
          <h2>Featured Products</h2>
          <a href="#" class="view-all" onclick="navigate('catalog')">View All →</a>
        </div>
        <div class="product-grid" id="home-featured"></div>
      </div>
    </section>

    <!-- Categories -->
    <section class="section section-alt" id="home-categories">
      <div class="container">
        <div class="section-header">
          <h2>Browse by Category</h2>
        </div>
        <div class="category-grid" id="home-categories-grid"></div>
      </div>
    </section>

    <!-- Catch-Weight Banner -->
    <section class="promo-banner container">
      <div class="promo-inner">
        <div>
          <h3>How Our Pricing Works</h3>
          <p>We sell whole birds and cuts by actual weight (catch-weight), fixed-weight packs, and per piece for eggs. Your estimated total at checkout may vary slightly once our staff weighs your items — you'll see the final amount before delivery.</p>
        </div>
        <button class="btn-outline" onclick="navigate('catalog')">Start Shopping</button>
      </div>
    </section>

    <!-- Footer -->
    <footer class="site-footer">
      <div class="container footer-inner">
        <div class="footer-brand">
          <span class="logo-icon">🐓</span>
          <span class="logo-text">Poultry<strong>Mart</strong></span>
          <p>Bringing the wet-market experience online. Fresh, local, and delivered.</p>
        </div>
        <div class="footer-links">
          <h4>Shop</h4>
          <a href="#" onclick="navigate('catalog')">All Products</a>
          <a href="#" onclick="navigate('catalog','Whole Birds')">Whole Birds</a>
          <a href="#" onclick="navigate('catalog','Eggs')">Eggs</a>
        </div>
        <div class="footer-links">
          <h4>Account</h4>
          <a href="#" onclick="navigate('orders')">My Orders</a>
          <a href="#" onclick="navigate('profile')">Profile</a>
          <a href="#" onclick="navigate('auth')">Sign In</a>
        </div>
        <div class="footer-links">
          <h4>Info</h4>
<p class="footer-note">📍 Legazpi City, Albay</p>
          <p class="footer-note" id="footer-store-hours">🕐 Mon–Sat 7AM–5PM</p>
          <p class="footer-note">📞 +63 917 000 0000</p>
        </div>
      </div>
      <div class="footer-bottom container">
        <p>© 2025 PoultryMart. All rights reserved.</p>
      </div>
    </footer>
  </div>

  <!-- ── CATALOG ───────────────────────────────── -->
  <div id="page-catalog" class="page">
    <div class="page-hero-sm">
      <div class="container">
        <h2>Product Catalog</h2>
        <p>All categories · Fresh &amp; Processed</p>
      </div>
    </div>
    <div class="container catalog-layout">
      <aside class="catalog-sidebar">
        <div class="filter-block">
          <h3>Search</h3>
          <input type="text" id="catalog-search" class="filter-input" placeholder="Search products…" oninput="debouncedFilterProducts()" />
        </div>
        <div class="filter-block">
          <h3>Categories</h3>
          <div id="cat-filter-list">
            <label class="filter-label active">
              <input type="radio" name="cat-filter" value="" checked onchange="filterProducts()" /> All
            </label>
          </div>
        </div>
        <div class="filter-block">
          <h3>Sort By</h3>
          <select class="filter-input" id="catalog-sort" onchange="loadCatalog()">
            <option value="featured">Featured</option>
            <option value="az">A → Z</option>
            <option value="za">Z → A</option>
            <option value="price_asc">Price: Low → High</option>
            <option value="price_desc">Price: High → Low</option>
          </select>
        </div>
        <div class="filter-block">
          <h3>Pricing Type</h3>
          <div id="model-filter-list">
            <label class="filter-label"><input type="radio" name="model-filter" value="" checked onchange="filterProducts()" /> All</label>
            <label class="filter-label"><input type="radio" name="model-filter" value="catch_weight" onchange="filterProducts()" /> ⚖ Catch-Weight (by kg)</label>
            <label class="filter-label"><input type="radio" name="model-filter" value="fixed_pack" onchange="filterProducts()" /> 📦 Fixed Pack</label>
            <label class="filter-label"><input type="radio" name="model-filter" value="per_piece" onchange="filterProducts()" /> 🥚 Per Piece</label>
          </div>
        </div>
      </aside>
      <div class="catalog-main">
        <div class="catalog-toolbar">
          <span id="catalog-count" class="result-count"></span>
        </div>
<div class="product-grid" id="catalog-grid"></div>
        <!-- Load More button is injected here by _renderLoadMoreBtn() -->
        <div id="catalog-empty" class="empty-state" style="display:none">
          <span>🔍</span>
          <h3>No products found</h3>
          <p>Try a different search or category.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- ── PRODUCT DETAIL ────────────────────────── -->
  <div id="page-detail" class="page">
    <div class="container">
      <button class="back-btn" onclick="navigateBack()">← Back</button>
      <div class="detail-layout" id="detail-content"></div>
    </div>
  </div>

  <!-- ── CART ──────────────────────────────────── -->
  <div id="page-cart" class="page">
    <div class="page-hero-sm">
      <div class="container"><h2>Your Cart</h2></div>
    </div>
    <div class="container cart-layout">
      <div class="cart-items-col" id="cart-items-container"></div>
      <aside class="cart-summary" id="cart-summary"></aside>
    </div>
  </div>

<!-- ── CHECKOUT ───────────────────────────────── -->
  <div id="page-checkout" class="page">
    <div class="page-hero-sm">
      <div class="container"><h2>Checkout</h2></div>
    </div>
    <!-- Guest notice banner (shown only when not signed in) -->
    <div id="co-guest-banner" class="checkout-guest-banner" hidden>
      👋 You're browsing as a guest. You can review your order below, then sign in to confirm it.
    </div>
    <div class="container checkout-layout">
      <div class="checkout-form-col">
        <!-- Guest sign-in prompt (shown only when not signed in) -->
        <div id="co-guest-prompt" class="card card--alert" hidden>
          <h3>Sign In to Place Your Order</h3>
          <p class="modal-subtitle">
            Your cart is saved. Sign in or create a free account to complete checkout.
          </p>
          <div class="modal-actions">
            <button class="btn-primary" onclick="navigate('auth')">Sign In / Register</button>
          </div>
        </div>

        <!-- Delivery Address -->
        <div class="card" id="co-address-card">
          <h3>Delivery Address</h3>
          <!-- Saved address picker (shown when user has saved addresses) -->
          <div id="co-saved-address-section" style="display:none">
            <div class="form-group form-group--spaced">
              <label>Delivery Address</label>
              <select id="co-saved-address" class="form-input" onchange="onSavedAddressChange()">
                <option value="">— Enter a new address below —</option>
              </select>
            </div>
            <div id="co-zone-notice" class="zone-notice" style="display:none"></div>
            <div class="address-divider">or enter a new address</div>
          </div>
          <div class="form-grid" id="co-address-form">
            <div class="form-group">
              <label>First Name</label>
              <input type="text" id="co-first" class="form-input" placeholder="Maria" />
            </div>
            <div class="form-group">
              <label>Last Name</label>
              <input type="text" id="co-last" class="form-input" placeholder="Reyes" />
            </div>
            <div class="form-group full">
              <label>Phone Number</label>
              <input type="tel" id="co-phone" class="form-input" placeholder="09XX XXX XXXX" />
            </div>
            <div class="form-group full">
              <label>Street Address</label>
              <input type="text" id="co-street" class="form-input" placeholder="123 Mayon Street" />
            </div>
            <div class="form-group">
              <label>Municipality / City</label>
              <select id="co-city" class="form-input" onchange="populateBarangays('co-city','co-barangay'); _autoMatchZone(document.getElementById('co-barangay')?.value, this.value)">
                <option value="">— Select municipality —</option>
              </select>
            </div>
            <div class="form-group">
              <label>Barangay</label>
              <select id="co-barangay" class="form-input" onchange="_autoMatchZone(this.value, document.getElementById('co-city')?.value)">
                <option value="">— Select barangay —</option>
              </select>
            </div>
<div class="form-group full">
              <label>Special Instructions</label>
              <textarea id="co-notes" class="form-input" rows="3" placeholder="Leave at gate, call on arrival…"></textarea>
            </div>
            <!-- Save-as-default: only shown when entering a new address manually.
                 Hidden via JS (onSavedAddressChange) when a saved address is selected. -->
            <div id="co-save-default-wrap" class="form-group full form-group--tight">
              <label class="checkbox-label">
                <input type="checkbox" id="co-save-default" />
                Save this address to my profile for future orders
              </label>
            </div>
          </div>
        </div>

        <!-- Delivery Schedule -->
        <div class="card">
          <h3>Delivery Schedule</h3>
          <div class="form-grid">
            <div class="form-group">
              <label>Delivery Date</label>
              <!-- [IMPROVEMENT] Date picker will only enable operational days (set via JS) -->
              <input type="date" id="co-date" class="form-input" onchange="onDeliveryDateChange()" />
              <p id="co-date-hint" class="form-hint" hidden></p>
            </div>
            <div class="form-group">
              <label>Time Slot</label>
              <select id="co-slot" class="form-input">
                <option value="">Loading…</option>
              </select>
            </div>
            <div class="form-group full" id="co-zone-group" hidden aria-hidden="true" style="display:none">
              <label>Delivery Zone</label>
              <select id="co-zone" class="form-input" onchange="updateCheckoutSummary()" style="pointer-events:none;opacity:.6" tabindex="-1">
                <option value="">Loading…</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Payment Method -->
        <div class="card">
          <h3>Payment Method</h3>
          <div class="payment-options">
            <label class="payment-opt">
              <input type="radio" name="payment" value="COD" checked onchange="onPaymentMethodChange()" />
              <span class="payment-card">
                <span class="payment-icon">💵</span>
                <span>
                  <strong>Cash on Delivery</strong>
                  <small>Pay when your order arrives</small>
                </span>
              </span>
            </label>
            <label class="payment-opt">
              <input type="radio" name="payment" value="GCash" onchange="onPaymentMethodChange()" />
              <span class="payment-card">
                <span class="payment-icon">📱</span>
                <span>
                  <strong>GCash</strong>
                  <small>Pay via GCash e-wallet</small>
                </span>
              </span>
            </label>
          </div>
          <!-- GCash instructions panel — revealed by JS when GCash is selected -->
          <div id="co-gcash-panel" style="display:none;margin-top:1rem">
            <div class="gcash-instructions">
              <p><strong>📱 Send payment to:</strong></p>
              <p class="gcash-number">09XX XXX XXXX · <em>Juan D.</em></p>
              <img src="/img/gcash-qr.png" alt="GCash QR Code" class="gcash-qr"
                   onerror="this.style.display='none'" />
            </div>
            <div class="form-group" style="margin-top:.75rem">
              <label>GCash Reference Number <span class="required-mark" aria-hidden="true">*</span></label>
              <input type="text" id="co-gcash-ref" class="form-input"
                     placeholder="13-digit reference number" maxlength="30" />
            </div>
            <div class="form-group">
              <label>Receipt Screenshot <small class="label-muted">(optional)</small></label>
              <input type="file" id="co-gcash-receipt" class="form-input" accept="image/*" />
            </div>
          </div>
        </div>

        <!-- [IMPROVED] Promo Code — real-time validation + remove button -->
        <div class="card">
          <h3>Promo Code</h3>
          <div id="promo-applied-row" class="promo-applied-row" hidden>
            <span id="promo-applied-label" class="promo-applied-label"></span>
            <button class="btn-danger btn-sm" onclick="removePromo()">Remove</button>
          </div>
          <div id="promo-input-row" class="promo-row">
            <input type="text" id="co-promo" class="form-input form-input--uppercase" placeholder="Enter promo code" />
            <button class="btn-outline" id="promo-apply-btn" onclick="applyPromo()">Apply</button>
          </div>
          <p id="promo-msg" class="promo-msg"></p>
        </div>
      </div>

      <aside class="checkout-summary" id="checkout-summary-panel"></aside>
    </div>
  </div>

  <!-- ── ORDERS ─────────────────────────────────── -->
<div id="page-orders" class="page">
    <div class="page-hero-sm">
      <div class="container"><h2>My Orders</h2></div>
    </div>
    <div class="container">
      <!-- Order filter bar -->
      <div class="orders-filter-bar">
        <select id="order-filter-status" class="form-input filter-input--status" onchange="applyOrderFilters()">
          <option value="">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Packed">Packed</option>
          <option value="Out for Delivery">Out for Delivery</option>
          <option value="Arrived at Location">Arrived at Location</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <input type="date" id="order-filter-from" class="form-input filter-input--date" placeholder="From date" onchange="applyOrderFilters()" />
        <input type="date" id="order-filter-to" class="form-input filter-input--date" placeholder="To date" onchange="applyOrderFilters()" />
        <button class="btn-ghost-dark btn-sm" onclick="clearOrderFilters()">✕ Clear</button>
      </div>
      <div id="orders-list"></div>
    </div>
  </div>

  <!-- ── PROFILE ────────────────────────────────── -->
  <div id="page-profile" class="page">
    <div class="page-hero-sm">
      <div class="container"><h2>My Profile</h2></div>
    </div>
    <div class="container profile-layout">
      <aside class="profile-nav">
        <button class="profile-nav-btn active" onclick="showProfileTab('info', event)">👤 Personal Info</button>
        <button class="profile-nav-btn" onclick="showProfileTab('addresses', event)">📍 Addresses</button>
        <!-- [NEW] Security tab -->
        <button class="profile-nav-btn" onclick="showProfileTab('security', event)">🔒 Security</button>
      </aside>
      <div class="profile-content">
        <div id="profile-info-tab" class="profile-tab active">
          <div class="card">
            <h3>Personal Information</h3>
            <div class="form-grid">
              <div class="form-group">
                <label>First Name</label>
                <input type="text" id="pf-first" class="form-input" />
              </div>
              <div class="form-group">
                <label>Last Name</label>
                <input type="text" id="pf-last" class="form-input" />
              </div>
              <div class="form-group full">
                <label>Email</label>
                <input type="email" id="pf-email" class="form-input" readonly />
              </div>
              <div class="form-group full">
                <label>Phone</label>
                <input type="tel" id="pf-phone" class="form-input" />
              </div>
            </div>
            <button class="btn-primary" onclick="saveProfile()">Save Changes</button>
          </div>
        </div>

        <div id="profile-addresses-tab" class="profile-tab">
          <div class="card">
            <div class="section-header">
              <h3>Saved Addresses</h3>
              <button class="btn-outline btn-sm" onclick="showAddressForm()">+ Add Address</button>
            </div>
            <div id="address-list"></div>
<!-- Edit Address modal (hidden by default) -->
            <div id="edit-address-form" style="display:none" class="address-form">
              <h4>Edit Address</h4>
              <input type="hidden" id="eaf-id" />
              <div class="form-grid">
                <div class="form-group">
                  <label>Label</label>
                  <input type="text" id="eaf-label" class="form-input" placeholder="Home / Office" />
                </div>
                <div class="form-group">
                  <label>Municipality / City</label>
                  <select id="eaf-city" class="form-input" onchange="populateBarangays('eaf-city','eaf-barangay')">
                    <option value="">— Select municipality —</option>
                  </select>
                </div>
                <div class="form-group full">
                  <label>Street</label>
                  <input type="text" id="eaf-street" class="form-input" />
                </div>
                <div class="form-group">
                  <label>Barangay</label>
                  <select id="eaf-barangay" class="form-input">
                    <option value="">— Select barangay —</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Province</label>
                  <input type="text" id="eaf-province" class="form-input" />
                </div>
                <div class="form-group full">
                  <label class="checkbox-label">
                    <input type="checkbox" id="eaf-default" /> Set as default address
                  </label>
                </div>
              </div>
              <div class="address-form-actions">
                <button class="btn-primary" onclick="submitEditAddress()">Update Address</button>
                <button class="btn-ghost-dark" onclick="document.getElementById('edit-address-form').style.display='none'">Cancel</button>
              </div>
            </div>

            <div id="address-form" style="display:none" class="address-form">
              <h4>Add New Address</h4>
              <div class="form-grid">
                <div class="form-group">
                  <label>Label</label>
                  <input type="text" id="af-label" class="form-input" placeholder="Home / Office" />
                </div>
                <div class="form-group">
                  <label>Municipality / City</label>
                  <select id="af-city" class="form-input" onchange="populateBarangays('af-city','af-barangay')">
                    <option value="">— Select municipality —</option>
                  </select>
                </div>
                <div class="form-group full">
                  <label>Street</label>
                  <input type="text" id="af-street" class="form-input" />
                </div>
                <div class="form-group">
                  <label>Barangay</label>
                  <select id="af-barangay" class="form-input">
                    <option value="">— Select barangay —</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Province</label>
                  <input type="text" id="af-province" class="form-input" value="Albay" />
                </div>
                <div class="form-group full">
                  <label class="checkbox-label">
                    <input type="checkbox" id="af-default" /> Set as default address
                  </label>
                </div>
              </div>
              <div class="address-form-actions">
                <button class="btn-primary" onclick="submitAddress()">Save Address</button>
                <button class="btn-ghost-dark" onclick="document.getElementById('address-form').style.display='none'">Cancel</button>
              </div>
            </div>
          </div>
        </div>

        <!-- [NEW] Security / Change Password tab -->
        <div id="profile-security-tab" class="profile-tab">
          <div class="card">
            <h3>Change Password</h3>
            <p class="modal-subtitle">
              For your security, enter your current password before setting a new one.
            </p>
            <div class="form-grid">
              <div class="form-group full">
                <label>Current Password</label>
                <input type="password" id="sec-current" class="form-input" placeholder="••••••••" />
              </div>
              <div class="form-group full">
                <label>New Password <small class="label-muted">(min. 8 characters)</small></label>
                <input type="password" id="sec-new" class="form-input" placeholder="••••••••" />
              </div>
              <div class="form-group full">
                <label>Confirm New Password</label>
                <input type="password" id="sec-confirm" class="form-input" placeholder="••••••••" />
              </div>
            </div>
            <p id="sec-error" class="form-error" hidden></p>
            <button class="btn-primary" onclick="changePassword()">Update Password</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── AUTH ──────────────────────────────────── -->
  <div id="page-auth" class="page">
    <div class="auth-wrapper">
      <div class="auth-card">
        <div class="auth-logo">
          <span class="logo-icon">🐓</span>
          <span class="logo-text">Poultry<strong>Mart</strong></span>
        </div>

        <!-- Login Form -->
        <div id="login-form">
          <h2>Welcome Back</h2>
          <p class="auth-sub">Sign in to your account</p>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="login-email" class="form-input" placeholder="you@email.com" />
          </div>
          <div class="form-group">
            <label>Password</label>
            <div class="password-field">
              <input type="password" id="login-password" class="form-input" placeholder="••••••••" />
            </div>
          </div>
          <p id="login-error" class="form-error" hidden></p>
          <button class="btn-primary full-width" onclick="doLogin()">Sign In</button>
          <p class="auth-toggle">Don't have an account? <a href="#" onclick="toggleAuthForm()">Register</a></p>
        </div>

        <!-- Register Form -->
        <div id="register-form" hidden>
          <h2>Create Account</h2>
          <p class="auth-sub">Join PoultryMart today</p>
          <div class="form-grid">
            <div class="form-group">
              <label>First Name</label>
              <input type="text" id="reg-first" class="form-input" />
            </div>
            <div class="form-group">
              <label>Last Name</label>
              <input type="text" id="reg-last" class="form-input" />
            </div>
            <div class="form-group full">
              <label>Email</label>
              <input type="email" id="reg-email" class="form-input" />
            </div>
            <div class="form-group full">
              <label>Phone (optional)</label>
              <input type="tel" id="reg-phone" class="form-input" />
            </div>
            <div class="form-group full">
              <label>Password <small class="label-muted">(min. 8 characters)</small></label>
              <input type="password" id="reg-password" class="form-input" />
            </div>
          </div>
          <p id="reg-error" class="form-error" hidden></p>
          <button class="btn-primary full-width" onclick="doRegister()">Create Account</button>
          <p class="auth-toggle">Already have an account? <a href="#" onclick="toggleAuthForm()">Sign In</a></p>
        </div>
      </div>
    </div>
  </div>

</main>

<!-- ══════════════════════════════════════════════
     TOAST NOTIFICATION
══════════════════════════════════════════════ -->
<div id="toast" class="toast" aria-live="polite"></div>

<!-- ══════════════════════════════════════════════
     ORDER DETAIL MODAL
══════════════════════════════════════════════ -->
<div id="order-modal-overlay" class="modal-overlay" style="display:none" onclick="closeOrderModal()">
  <div class="modal-box" onclick="event.stopPropagation()">
    <button class="modal-close" onclick="closeOrderModal()">✕</button>
    <div id="order-modal-content"></div>
  </div>
</div>

<!-- Edit Pending Order modal -->
<div id="edit-order-modal-overlay" class="modal-overlay" style="display:none"
  onclick="closeEditOrderModal()">
  <div class="modal-box modal-box--sm" onclick="event.stopPropagation()">    <button class="modal-close" onclick="closeEditOrderModal()">✕</button>
    <h3 class="modal-title">✏️ Edit Order</h3>
    <input type="hidden" id="eo-order-id" />
    <div class="form-grid">
      <div class="form-group full">
        <label>Delivery Date</label>
        <input type="date" id="eo-date" class="form-input" />
      </div>
      <div class="form-group full">
        <label>Time Slot</label>
        <select id="eo-slot" class="form-input"></select>
      </div>
      <div class="form-group full">
        <label>Delivery Zone</label>
        <select id="eo-zone" class="form-input"></select>
      </div>
      <div class="form-group full">
        <label>Payment Method</label>
        <select id="eo-payment" class="form-input">
          <option value="COD">💵 Cash on Delivery</option>
          <option value="GCash">📱 GCash</option>
        </select>
      </div>
      <div class="form-group full">
        <label>Special Instructions</label>
        <textarea id="eo-notes" class="form-input" rows="3"></textarea>
      </div>
    </div>
    <p id="eo-error" class="form-error" hidden></p>
    <div class="modal-actions">
      <button class="btn-primary btn--grow" onclick="submitEditOrder()">Save Changes</button>
      <button class="btn-ghost-dark" onclick="closeEditOrderModal()">Cancel</button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════
     CANCEL ORDER MODAL  [NEW — reason picker]
══════════════════════════════════════════════ -->
<div id="cancel-modal-overlay" class="modal-overlay" style="display:none" onclick="closeCancelModal()">
  <div class="modal-box modal-box-sm" onclick="event.stopPropagation()">
    <button class="modal-close" onclick="closeCancelModal()">✕</button>
    <div class="modal-cancel-body">
      <h3>Cancel Order</h3>
      <p class="modal-subtitle">
        Please let us know why you're cancelling this order.
      </p>
      <div class="form-group">
        <label>Reason</label>
        <select id="cancel-reason-select" class="form-input" onchange="onCancelReasonChange()">
          <option value="Changed my mind">Changed my mind</option>
          <option value="Ordered by mistake">Ordered by mistake</option>
          <option value="Found a better price elsewhere">Found a better price elsewhere</option>
          <option value="Delivery date not suitable">Delivery date not suitable</option>
          <option value="Other">Other (please specify)</option>
        </select>
      </div>
      <div id="cancel-other-wrap" class="form-group" hidden>
        <label>Specify Reason</label>
        <textarea id="cancel-reason-other" class="form-input" rows="2" placeholder="Tell us more…"></textarea>
      </div>
      <input type="hidden" id="cancel-order-id" value="" />
      <div class="modal-actions">
        <button class="btn-danger btn--grow" onclick="confirmCancelOrder()">Confirm Cancellation</button>
        <button class="btn-ghost-dark btn--grow" onclick="closeCancelModal()">Keep Order</button>
      </div>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════
     REVIEW MODAL  [NEW]
══════════════════════════════════════════════ -->
<div id="review-modal-overlay" class="modal-overlay" style="display:none" onclick="closeReviewModal()">
  <div class="modal-box modal-box-sm" onclick="event.stopPropagation()">
    <button class="modal-close" onclick="closeReviewModal()">✕</button>
    <div class="modal-review-body">
      <h3>Leave a Review</h3>
      <p id="review-product-name" class="modal-subtitle"></p>
      <input type="hidden" id="review-product-id" />
      <input type="hidden" id="review-order-id" />
      <div class="form-group">
        <label>Rating</label>
        <div class="star-picker" id="star-picker" role="group" aria-label="Rating">
          <span class="star-pick" data-val="1" onclick="setReviewRating(1)" title="1 star">★</span>
          <span class="star-pick" data-val="2" onclick="setReviewRating(2)" title="2 stars">★</span>
          <span class="star-pick" data-val="3" onclick="setReviewRating(3)" title="3 stars">★</span>
          <span class="star-pick" data-val="4" onclick="setReviewRating(4)" title="4 stars">★</span>
          <span class="star-pick" data-val="5" onclick="setReviewRating(5)" title="5 stars">★</span>
        </div>
        <input type="hidden" id="review-rating" value="0" />
      </div>
      <div class="form-group">
        <label>Your Review <small class="label-muted">(optional)</small></label>
        <textarea id="review-text" class="form-input" rows="3" placeholder="How was this product?"></textarea>
      </div>
      <p id="review-error" class="form-error" hidden></p>      <button class="btn-primary full-width" onclick="submitReview()">Submit Review</button>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════
     DISPUTE MODAL  [NEW]
══════════════════════════════════════════════ -->
<div id="dispute-modal-overlay" class="modal-overlay" style="display:none" onclick="closeDisputeModal()">
  <div class="modal-box modal-box-sm" onclick="event.stopPropagation()">
    <button class="modal-close" onclick="closeDisputeModal()">✕</button>
    <div class="modal-dispute-body">
      <h3>Report an Issue</h3>
      <p class="modal-subtitle">
        Describe the problem and our team will review it shortly.
      </p>
      <input type="hidden" id="dispute-order-id" />
      <div class="form-group">
        <label>Description <span class="required-mark" aria-hidden="true">*</span></label>
        <textarea id="dispute-description" class="form-input" rows="4"
          placeholder="e.g. Items were missing, product was spoiled, wrong item delivered…"></textarea>
      </div>
      <div class="form-group">
        <label>Photo Evidence <small class="label-muted">(optional — upload from device)</small></label>
        <input type="file" id="dispute-evidence" class="form-input" accept="image/*" />
        <p class="form-hint" style="margin-top:.35rem">Accepted formats: JPG, PNG, WEBP (max 5 MB)</p>
      </div>
      <p id="dispute-error" class="form-error" hidden></p>
      <button class="btn-primary full-width" onclick="submitDispute()">Submit Report</button>
    </div>
  </div>
</div>

<!-- Notification panel outside click handler -->
<script>
  document.addEventListener('click', function(e) {
    const panel = document.getElementById('notif-panel');
    const wrapper = document.getElementById('notif-wrapper');
    if (panel && !wrapper.contains(e.target)) {
      panel.style.display = 'none';
    }
  });
</script>

<script src="js/shared/constants.js"></script>
<script src="js/shared/utils.js"></script>
<script src="js/shared/uiHelpers.js"></script>
<script src="js/shared/apiService.js"></script>
<script src="js/controllers/customer.js"></script>
</body>
</html>