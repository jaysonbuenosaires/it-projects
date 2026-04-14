/**
 * uiHelpers.js — Reusable UI components: toasts, modals, clock, stars.
 *
 * Each function is designed to work independently of any portal's
 * state object.  Portal-specific toast element IDs are passed in
 * or configured per-call.
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   TOAST NOTIFICATION SYSTEM
   Two variants:
     1. showToast(msg, type, toastId)   — single-element toast (admin / fulfillment)
     2. showToastStack(msg, type)       — stacked, self-removing toasts (rider / customer)
═══════════════════════════════════════════════════════════════*/

/**
 * Show a single-element toast notification.
 * Used by admin and fulfillment portals that have one persistent toast element.
 *
 * @param {string} msg
 * @param {string} [type]    - CSS modifier: 'success' | 'error' | 'warning' | 'info' | ''
 * @param {string} [toastId] - id of the toast element (default 'admin-toast')
 */
function showToast(msg, type = '', toastId = 'portal-toast') {
  const el = document.getElementById(toastId);
  if (!el) return;
  el.innerHTML = msg; // allow emoji / basic HTML
  el.className = `toast show ${type}`.trim();
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast'; }, 4500);
}

/**
 * Show a stacked, self-removing toast.
 * Used by portals that have a #rider-toast-container element.
 *
 * @param {string} msg
 * @param {'success'|'error'|'info'} [type]
 * @param {string} [containerId]
 */
function showToastStack(msg, type = 'info', containerId = 'portal-toast-stack') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `rider-toast ${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${icons[type] || 'ℹ️'}</span>
    <span class="toast-msg">${escHtml(msg)}</span>
    <button class="toast-close" aria-label="Dismiss notification" type="button">✕</button>`;

  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

/* ════════════════════════════════════════════════════════════
   SIMPLE MODAL SYSTEM  (admin portal)
   Uses #simple-modal, #simple-modal-title, #simple-modal-body,
   #simple-modal-confirm elements.
═══════════════════════════════════════════════════════════════*/

/**
 * Open the shared "simple" modal with custom title, body HTML, and confirm callback.
 *
 * @param {string}   title
 * @param {string}   bodyHtml
 * @param {Function} onConfirm
 * @param {string}   [confirmLabel]
 */
function openSimpleModal(title, bodyHtml, onConfirm, confirmLabel = 'Save') {
  document.getElementById('simple-modal-title').textContent = title;
  document.getElementById('simple-modal-body').innerHTML   = bodyHtml;
  const btn = document.getElementById('simple-modal-confirm');
  btn.textContent = confirmLabel;
  btn.onclick     = onConfirm;
  document.getElementById('simple-modal').style.display = 'flex';
}

/**
 * Close a modal by id.
 * @param {string} id
 */
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

/* ════════════════════════════════════════════════════════════
   ACCESSIBLE MODAL HELPERS  (rider portal)
   Manages aria-hidden, CSS .open class, focus trap, and
   body scroll-lock.
═══════════════════════════════════════════════════════════════*/

/**
 * Open a modal overlay with focus management.
 *
 * @param {string} overlayId
 * @param {string} firstFocusId - id of the element to focus inside the modal
 * @returns {Function} cleanup (removes focus-trap listener)
 */
function openAccessibleModal(overlayId, firstFocusId) {
  const overlay = document.getElementById(overlayId);
  overlay.removeAttribute('aria-hidden');
  overlay.classList.add('open');
  document.body.classList.add('modal-open');

  const modal   = overlay.querySelector('.rider-modal, .rider-confirm-box');
  const cleanup = trapFocus(modal);

  setTimeout(() => {
    const el = document.getElementById(firstFocusId) || modal?.querySelector('button');
    el?.focus();
  }, 120);

  return cleanup;
}

/**
 * Close a modal overlay and restore focus.
 *
 * @param {string}          overlayId
 * @param {HTMLElement|null} returnFocus
 * @param {Function|null}    cleanup
 */
function closeAccessibleModal(overlayId, returnFocus, cleanup) {
  const overlay = document.getElementById(overlayId);
  overlay.setAttribute('aria-hidden', 'true');
  overlay.classList.remove('open');
  document.body.classList.remove('modal-open');
  cleanup?.();
  returnFocus?.focus();
}

/* ════════════════════════════════════════════════════════════
   SIDEBAR TOGGLE  (admin / fulfillment)
═══════════════════════════════════════════════════════════════*/

/**
 * Toggle the sidebar open/closed (simple class toggle variant).
 * @param {string} sidebarId
 * @param {string} overlayId
 */
function toggleSidebarUI(sidebarId, overlayId) {
  document.getElementById(sidebarId)?.classList.toggle('open');
  document.getElementById(overlayId)?.classList.toggle('visible');
}

/**
 * Close the sidebar.
 * @param {string} sidebarId
 * @param {string} overlayId
 */
function closeSidebarUI(sidebarId, overlayId) {
  document.getElementById(sidebarId)?.classList.remove('open');
  document.getElementById(overlayId)?.classList.remove('visible');
}

/* ════════════════════════════════════════════════════════════
   LIVE CLOCK
═══════════════════════════════════════════════════════════════*/

/**
 * Start a live clock and update the given element every second.
 * @param {string} elementId
 */
function startClock(elementId) {
  const tick = () => {
    const el = document.getElementById(elementId);
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-PH', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    if (el.tagName === 'TIME') el.setAttribute('datetime', now.toISOString());
  };
  tick();
  setInterval(tick, 1000);
}

/* ════════════════════════════════════════════════════════════
   STAR RATING
═══════════════════════════════════════════════════════════════*/

/**
 * Build a star rating HTML string.
 * @param {number|string} rating
 * @returns {string}
 */
function starsHTML(rating) {
  const r = Math.round(parseFloat(rating || 0));
  return `<span class="star-filled">${'★'.repeat(r)}</span>` +
         `<span class="star-empty">${'☆'.repeat(5 - r)}</span>`;
}

/* ════════════════════════════════════════════════════════════
   DETAIL ROW (rider modal)
═══════════════════════════════════════════════════════════════*/

/**
 * Build a label/value detail row HTML string.
 * @param {string} label
 * @param {string} value
 * @returns {string}
 */
function detailRow(label, value) {
  return `<div class="detail-row">
    <span class="detail-row-label">${escHtml(label)}</span>
    <span class="detail-row-value">${value}</span>
  </div>`;
}